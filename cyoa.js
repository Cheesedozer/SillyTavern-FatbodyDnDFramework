/**
 * cyoa.js — Origins RPG Framework
 * Choose-Your-Own-Adventure mode: slot definitions, the SuggestChoices narrator
 * tool, validation, and per-chat choice storage.
 *
 * Imports: state-manager.js (getSettings), llm-client.js (sendAgentTurn),
 *   world-progression.js (worldProgSettings) — the latter two lazily.
 * Imported by: index.js (tool lifecycle, panel wiring), renderer.js
 *   (CYOA_SLOTS for the slot chips), test/cyoa.test.js.
 *
 * Design notes that are load-bearing:
 *  - The *narrator* emits the choices mid-turn via a function tool, not a
 *    separate post-turn pass. The model that just wrote the scene is the one
 *    that knows where it was going, and it costs no extra request.
 *  - Every choice fills a distinct narrative-function slot. Asking a model for
 *    "3 choices" reliably produces three rewordings of one idea; requiring
 *    distinct slots is the mechanical fix for that.
 *  - Choices never state or imply an outcome. Beyond spoiling the scene, a
 *    pre-declared result would undercut the RNG system's "declare the DC before
 *    you see the roll" commitment logic.
 */

import { getSettings } from './state-manager.js';

/**
 * Writes straight through to extension_settings, the same pattern as
 * world-progression.js#saveChatWorldProg — deliberately NOT routed through
 * index.js#saveSettings (circular import) or saveChatState's snapshot cycle.
 */
function persist() {
    SillyTavern.getContext().saveSettingsDebounced();
}

export const TOOL_NAME = 'SuggestChoices';

/** Max characters for a choice's action sentence / stake clause. */
export const MAX_TEXT_LEN = 200;
export const MAX_STAKE_LEN = 120;

/**
 * Ordered slot definitions. The first N are active for a given choice count,
 * so `character` only appears once the player raises the count to 4.
 * `description` is interpolated into the tool description — these strings are
 * the actual instructions the narrator sees.
 */
export const CYOA_SLOTS = [
    {
        id: 'advance',
        label: 'Advance',
        icon: '➤',
        description: 'Push the current thread directly — the active quest, the scene\'s obvious pressure, or whatever the player is plainly trying to do. The straightforward read of the moment.',
    },
    {
        id: 'diverge',
        label: 'Diverge',
        icon: '⤳',
        description: 'Chase something you put in the scene that is NOT the main thread — a detail, a bystander, a door nobody mentioned, a question left hanging. It must be grounded in what you actually wrote, never invented here.',
    },
    {
        id: 'cost',
        label: 'Cost',
        icon: '⚖',
        description: 'A real advantage the player can only have by paying for it: a resource, time, a relationship, safety, or a principle. The cost must be one the player can already see — never a hidden trap.',
    },
    {
        id: 'character',
        label: 'Character',
        icon: '❖',
        description: 'An action that follows from who this character is rather than what they want — their origin lever, a party member, a standing relationship, an established grudge or vow. Skip the plot; act in character.',
    },
];

export const MIN_CHOICES = 2;
export const MAX_CHOICES = CYOA_SLOTS.length;

/** The first `count` slots, clamped to the supported range. */
export function activeSlots(count) {
    const parsed = Number(count);
    // `|| 3` would swallow a literal 0, which should clamp to MIN_CHOICES.
    const n = Number.isFinite(parsed) ? Math.max(MIN_CHOICES, Math.min(MAX_CHOICES, Math.trunc(parsed))) : 3;
    return CYOA_SLOTS.slice(0, n);
}

/** Reads one [TAG]…[/TAG] block out of a memo. Returns '' when absent or empty. */
function readBlock(memo, tag) {
    const m = String(memo || '').match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i'));
    return m ? m[1].trim() : '';
}

/**
 * True while a fight is running. The [COMBAT] block is cleared by mergeMemo()
 * on END_COMBAT, so a populated block is the live signal.
 * @param {string} memo
 */
export function isCombatActive(memo) {
    const block = readBlock(memo, 'COMBAT');
    if (!block) return false;
    return !/^(?:REMOVED|EXPIRED|CLEARED|NONE|END_COMBAT)$/i.test(block);
}

/**
 * Compact one-line-per-category summary of what the player actually has, so the
 * narrator cannot offer a spell slot or item they don't own. Deliberately terse
 * — this rides in the tool description on every single turn.
 * @param {string} memo
 * @returns {string} '' when there is nothing to whitelist
 */
export function buildResourceWhitelist(memo) {
    const lines = [];
    for (const [tag, label] of [['SPELLS', 'Spells'], ['ABILITIES', 'Abilities'], ['INVENTORY', 'Inventory']]) {
        const block = readBlock(memo, tag);
        if (!block) continue;
        const items = block
            .split('\n')
            .map(l => l.replace(/^[-*•]\s*/, '').trim())
            .filter(Boolean)
            .slice(0, 25);
        if (items.length) lines.push(`${label}: ${items.join('; ')}`);
    }
    return lines.join('\n');
}

/**
 * Text that would tell the player how their choice turns out.
 *
 * Deliberately narrow. An earlier version matched a bare "you lose/win/die",
 * which false-positived on perfectly good stake clauses ("You lose sight of the
 * hall", "you lose your place in the queue") and would have rejected a large
 * share of legitimate output. Only explicit predictions and dice mechanics
 * count: a future-tense marker, an adverb of success, or a DC/roll.
 */
const OUTCOME_PATTERN = new RegExp([
    /\bDC\s*\d/,                                                       // "(DC 15)"
    /\bd20\b/,                                                         // dice by name
    /\broll(?:s|ed|ing)?\s+(?:a|an|for|to)\b/,                         // "roll to vault"
    /\byou(?:'ll|'d| will| would| are going to)\s+(?:\w+\s+){0,2}(?:succeed|fail|die|win|lose|survive|be killed|be caught)\b/,
    /\b(?:this|that|it)\s+(?:will\s+)?(?:works?|succeeds?|fails?)\b/,  // "this works"
    /\bsuccessfully\b/,
    /\bguaranteed\b/,
    /\b(?:fail|succeed)\s+this\b/,                                     // "fail this and…"
].map(r => r.source).join('|'), 'i');

/**
 * Validates a SuggestChoices payload. Pure — no settings reads, no side effects.
 * @param {any} args raw tool arguments
 * @param {number} count expected number of choices
 * @returns {{ ok: boolean, errors: string[], choices: Array<{slot:string,text:string,stake:string}> }}
 */
export function validateChoices(args, count) {
    const errors = [];
    const slots = activeSlots(count);
    const wanted = slots.map(s => s.id);
    const raw = Array.isArray(args?.choices) ? args.choices : null;

    if (!raw) {
        return { ok: false, errors: ['`choices` must be an array.'], choices: [] };
    }
    if (raw.length !== wanted.length) {
        errors.push(`Expected exactly ${wanted.length} choices, got ${raw.length}.`);
    }

    const seen = new Set();
    const choices = [];
    for (const item of raw) {
        const slot = String(item?.slot || '').trim().toLowerCase();
        const text = String(item?.text || '').trim();
        const stake = String(item?.stake || '').trim();

        if (!wanted.includes(slot)) {
            errors.push(`Unknown slot "${slot || '(empty)'}" — must be one of: ${wanted.join(', ')}.`);
            continue;
        }
        if (seen.has(slot)) {
            errors.push(`Slot "${slot}" appears more than once — each slot must be filled exactly once.`);
            continue;
        }
        seen.add(slot);

        if (!text) {
            errors.push(`Slot "${slot}" has empty text.`);
            continue;
        }
        if (text.length > MAX_TEXT_LEN) {
            errors.push(`Slot "${slot}" text is ${text.length} chars — keep it under ${MAX_TEXT_LEN}, one sentence.`);
            continue;
        }
        if (stake.length > MAX_STAKE_LEN) {
            errors.push(`Slot "${slot}" stake is ${stake.length} chars — keep it under ${MAX_STAKE_LEN}, one short clause.`);
            continue;
        }
        if (OUTCOME_PATTERN.test(text) || OUTCOME_PATTERN.test(stake)) {
            errors.push(`Slot "${slot}" reveals an outcome, a roll, or a DC. State what the player does and what it risks — never how it turns out.`);
            continue;
        }

        choices.push({ slot, text, stake });
    }

    for (const id of wanted) {
        if (!seen.has(id)) errors.push(`Missing the "${id}" slot.`);
    }

    if (errors.length) return { ok: false, errors, choices: [] };

    // Return in canonical slot order regardless of the order the model emitted.
    choices.sort((a, b) => wanted.indexOf(a.slot) - wanted.indexOf(b.slot));
    return { ok: true, errors: [], choices };
}

// ── Per-chat storage ─────────────────────────────────────────────────────────

function currentChatId() {
    try {
        return SillyTavern.getContext().chatId
            || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null);
    } catch { return null; }
}

/** Index/swipe of the chat's last message, used to detect stale choices. */
function chatTail() {
    try {
        const chat = SillyTavern.getContext().chat || [];
        const messageIndex = chat.length - 1;
        return { messageIndex, swipeId: chat[messageIndex]?.swipe_id || 0 };
    } catch { return { messageIndex: -1, swipeId: 0 }; }
}

/** Writes choices for a chat, stamped against the message they belong to. */
export function storeChoices(chatId, choices) {
    if (!chatId) return;
    const s = getSettings();
    if (!s.chatStates) s.chatStates = {};
    if (!s.chatStates[chatId]) s.chatStates[chatId] = {};
    const { messageIndex, swipeId } = chatTail();
    s.chatStates[chatId].cyoa = { choices, messageIndex, swipeId, ts: Date.now() };
    persist();
}

export function clearChoices(chatId) {
    if (!chatId) return;
    const s = getSettings();
    if (s.chatStates?.[chatId]?.cyoa) {
        delete s.chatStates[chatId].cyoa;
        persist();
    }
}

/**
 * Stored choices for a chat, or null when there are none *or* when they belong
 * to a message that has since been swiped or deleted. Stale choices are worse
 * than no choices — they describe a scene that no longer exists.
 * @param {string} chatId
 */
export function getChoicesForChat(chatId) {
    if (!chatId) return null;
    const entry = getSettings().chatStates?.[chatId]?.cyoa;
    if (!entry?.choices?.length) return null;
    const { messageIndex, swipeId } = chatTail();
    if (entry.messageIndex !== messageIndex || entry.swipeId !== swipeId) return null;
    return entry.choices;
}

// ── Prompt construction ──────────────────────────────────────────────────────

/**
 * The slot rules + whitelist text shared by the tool description and the
 * regenerate fallback, so both paths ask for exactly the same thing.
 * @param {number} count
 * @param {string} memo
 */
export function buildChoiceInstructions(count, memo) {
    const slots = activeSlots(count);
    const lines = [
        `Propose exactly ${slots.length} things the player could do next. Each one fills a different slot:`,
        ...slots.map(s => `- "${s.id}" (${s.label}): ${s.description}`),
        '',
        'RULES:',
        '- `text` is ONE sentence, second person, describing only what the player does. Never narrate the result.',
        '- `stake` is optional: one short clause naming what the action puts at risk or what it costs. It must be something the player can already see. Never predict success or failure, never state a DC or a roll.',
        '- No option may be marked or implied as the correct, best, or worst one. They should differ in what they cost and risk, not in how good they are.',
        '- Every option must be physically possible for the player right now, in this location, with what they have.',
        '- Do not offer spells, abilities, or items the player does not possess.',
    ];
    const whitelist = buildResourceWhitelist(memo);
    if (whitelist) {
        lines.push('', 'The player currently has ONLY these resources — do not invent others:', whitelist);
    }
    return lines.join('\n');
}

// ── Tool registration ────────────────────────────────────────────────────────

/**
 * Fingerprint of everything the registration depends on. refreshRenderedView()
 * calls this on every render (a collapse click, a page change), and tearing the
 * tool down and rebuilding it that often is both wasteful and disruptive if a
 * generation is in flight — so an unchanged fingerprint is a no-op.
 */
let _lastRegistration = null;

/**
 * Registers (or removes) the SuggestChoices narrator tool. Idempotent, and safe
 * to call on every settings change / chat switch — mirrors registerLogQuestTool.
 * @param {boolean} [force] re-register even when nothing observable changed
 */
export function registerSuggestChoicesTool(force = false) {
    try {
        const s = getSettings();
        const { registerFunctionTool, unregisterFunctionTool } = SillyTavern.getContext();

        const fingerprint = JSON.stringify([
            !!s.enabled,
            s.syspromptModules?.cyoa !== false,
            isCombatActive(s.currentMemo),
            activeSlots(s.cyoaChoiceCount).length,
            buildResourceWhitelist(s.currentMemo),
        ]);
        if (!force && fingerprint === _lastRegistration) return;
        _lastRegistration = fingerprint;

        // Unregister first (idempotent).
        unregisterFunctionTool(TOOL_NAME);

        if (!s.enabled || s.syspromptModules?.cyoa === false) return;
        // Combat is authored by the RNG queue and the combat rules; narrative
        // choice slots are the wrong shape there, so the tool goes away entirely.
        if (isCombatActive(s.currentMemo)) return;

        const count = activeSlots(s.cyoaChoiceCount).length;
        const slots = activeSlots(count);

        registerFunctionTool({
            name: TOOL_NAME,
            displayName: TOOL_NAME,
            description:
                'Call this ONCE at the end of every turn, after you have finished narrating, to offer the player their next possible actions. '
                + 'Call it in addition to your prose, never instead of it.\n\n'
                + buildChoiceInstructions(count, s.currentMemo),
            parameters: {
                type: 'object',
                properties: {
                    choices: {
                        type: 'array',
                        description: `Exactly ${count} options, one per slot.`,
                        items: {
                            type: 'object',
                            properties: {
                                slot: {
                                    type: 'string',
                                    enum: slots.map(x => x.id),
                                    description: 'Which slot this option fills. Each slot exactly once.',
                                },
                                text: {
                                    type: 'string',
                                    description: 'One sentence, second person, describing only what the player does.',
                                },
                                stake: {
                                    type: 'string',
                                    description: 'Optional short clause naming what this puts at risk or costs. Omit rather than pad.',
                                },
                            },
                            required: ['slot', 'text'],
                        },
                    },
                },
                required: ['choices'],
            },
            action: async (args) => {
                const fresh = getSettings();
                const expected = activeSlots(fresh.cyoaChoiceCount).length;
                const { ok, errors, choices } = validateChoices(args, expected);
                if (!ok) {
                    // Returned to the model, which can correct itself on the next
                    // turn. Nothing is stored, so the panel keeps its prior state.
                    console.warn('[RPG Tracker] CYOA: rejected SuggestChoices payload:', errors);
                    return `Choices rejected: ${errors.join(' ')}`;
                }
                storeChoices(currentChatId(), choices);
                globalThis._rpgRenderCyoaPanel?.();
                return `${choices.length} choices offered.`;
            },
            // Same reasoning as LogQuest: `stealth` suppressed the follow-up
            // generation too, so a turn that only called the tool ended as an
            // empty message. An empty formatMessage hides the call and lets the
            // narration through.
            formatMessage: () => '',
        });
    } catch (error) {
        console.error('[RPG Tracker] Error registering SuggestChoices function tool', error);
    }
}

// ── Manual fallback ──────────────────────────────────────────────────────────

/** Pulls the first JSON object out of a fenced block or bare text. */
export function extractChoiceJson(text) {
    const src = String(text || '');
    const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : src.slice(src.indexOf('{'));
    try {
        return JSON.parse(candidate.trim().replace(/,\s*([}\]])/g, '$1'));
    } catch { return null; }
}

const REGEN_MAX_TURNS = 3;

/**
 * Fallback for narrators that don't tool-call: asks the World Progression
 * connection for choices against the last narrator message. Only ever runs when
 * the player clicks ↻ — this feature is free per-turn by design.
 * @param {string} chatId
 * @returns {Promise<{ok: boolean, reason?: string, errors?: string[]}>}
 */
export async function regenerateChoices(chatId) {
    const s = getSettings();
    if (!chatId) return { ok: false, reason: 'no-chat' };
    if (isCombatActive(s.currentMemo)) return { ok: false, reason: 'combat' };

    const { chat } = SillyTavern.getContext();
    const lastNarration = [...(chat || [])].reverse().find(m => !m.is_user && !m.is_system)?.mes;
    if (!lastNarration) return { ok: false, reason: 'no-narration' };

    const count = activeSlots(s.cyoaChoiceCount).length;
    const systemPrompt = `You propose the player's next possible actions in an ongoing tabletop RPG. You are not narrating — you only offer options.

${buildChoiceInstructions(count, s.currentMemo)}

## OUTPUT FORMAT
Respond with a single fenced JSON block and nothing else:
\`\`\`json
{"choices":[{"slot":"...","text":"...","stake":"..."}]}
\`\`\``;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `## MOST RECENT NARRATION\n${lastNarration}` },
    ];

    // Imported lazily: llm-client pulls in the ST context at module scope in a
    // way the DOM-free test bootstrap doesn't stub.
    const [{ sendAgentTurn }, { worldProgSettings }] = await Promise.all([
        import('./llm-client.js'),
        import('./world-progression.js'),
    ]);

    let lastErrors = [];
    for (let attempt = 0; attempt < REGEN_MAX_TURNS; attempt++) {
        let result;
        try {
            result = await sendAgentTurn(worldProgSettings(s), messages, null);
        } catch (e) {
            console.error('[RPG Tracker] CYOA: regenerate call failed:', e);
            return { ok: false, reason: 'network-error' };
        }

        const parsed = extractChoiceJson(result.content || '');
        const validation = validateChoices(parsed, count);
        if (validation.ok) {
            storeChoices(chatId, validation.choices);
            return { ok: true };
        }

        lastErrors = validation.errors;
        messages.push({ role: 'assistant', content: result.content || '' });
        messages.push({ role: 'user', content: `Invalid — fix and resend:\n- ${lastErrors.join('\n- ')}` });
    }

    console.warn('[RPG Tracker] CYOA: regenerate exhausted retries.', lastErrors);
    return { ok: false, reason: 'validation-exhausted', errors: lastErrors };
}
