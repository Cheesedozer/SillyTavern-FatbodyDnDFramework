/**
 * cyoa.js — Origins RPG Framework
 * Choose-Your-Own-Adventure mode: slot definitions, the `<choices>` block the
 * narrator writes at the bottom of its message, validation, and per-chat
 * choice storage.
 *
 * Imports: state-manager.js (getSettings), llm-client.js (sendAgentTurn),
 *   world-progression.js (worldProgSettings) — the latter two lazily.
 * Imported by: index.js (ingest + panel wiring), sysprompt.js
 *   (buildChoiceInstructions for the {{cyoaSlots}} placeholder),
 *   narrative-hooks.js (reconcileAfterTurn, stripChoiceBlock), audit-chunker.js
 *   (stripChoiceBlock), renderer.js (CYOA_SLOTS for the slot chips),
 *   cyoa-regex.js (CHOICE_BLOCK_SOURCE), test/cyoa.test.js.
 *
 * Design notes that are load-bearing:
 *  - The *narrator* emits the choices as plain text at the end of its own
 *    message. This used to be a `SuggestChoices` function tool; it isn't any
 *    more, and the reasons are worth keeping:
 *      · The tool and `<end_of_output_footer>` both claimed the terminal
 *        position of the turn. A model that called the tool before writing the
 *        footer got no follow-up generation (the tool was `stealth: true`), so
 *        the status line never landed and the HUD's footer parse lost its input.
 *      · Any tool-call turn is a live source of a second generation, which is
 *        what "responses are repeating" looked like from the outside.
 *      · Large presets crowd out an unprompted every-turn tool call no matter
 *        how correctly the tool is registered.
 *    Text in the message body has none of those failure modes, and the model
 *    that just wrote the scene is still the one proposing — no extra request.
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

/**
 * The tag the narrator wraps its choices in. Deliberately NOT `cyoa`: that is
 * the sysprompt module tag, and a rules block the model can see named the same
 * thing as the block it must produce invites it to echo the rules back.
 */
export const CHOICES_TAG = 'choices';

/**
 * Regex *source* for one choices block, shared with cyoa-regex.js so the
 * SillyTavern regex scripts and the parser can never disagree about what a
 * block is. `cyoa` stays a tolerated alias — models do reach for it.
 */
export const CHOICE_BLOCK_SOURCE = '<(?:choices|cyoa)>([\\s\\S]*?)</(?:choices|cyoa)>';

/** Max characters for a choice's action sentence / stake clause. */
export const MAX_TEXT_LEN = 200;
export const MAX_STAKE_LEN = 120;

/**
 * Ordered slot definitions. The first N are active for a given choice count,
 * so `character` only appears once the player raises the count to 4.
 * `description` is interpolated into the `<cyoa>` sysprompt block via
 * buildChoiceInstructions() — these strings are the actual instructions the
 * narrator sees.
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
 * narrator cannot offer a spell slot or item they don't own. Deliberately terse.
 *
 * Only regenerateChoices() uses this now — it builds its prompt live, per call,
 * so it can afford a snapshot of the memo. The narrator's own `<cyoa>` block
 * points at the live State Memo the interceptor already ships instead.
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
 * Validates a choices payload. Pure — no settings reads, no side effects.
 *
 * The single judge of correctness for both producers: parseChoiceBlock() (the
 * narrator's own block) and regenerateChoices() (the World Progression
 * fallback's JSON) hand it the same shape, so every rule below — slot coverage,
 * length caps, the outcome-leak pattern — applies identically to both.
 *
 * @param {any} args `{ choices: [...] }`
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

/** Index/swipe of the chat's last message, used to detect stale choices. */
function chatTail() {
    try {
        const chat = SillyTavern.getContext().chat || [];
        const messageIndex = chat.length - 1;
        return { messageIndex, swipeId: chat[messageIndex]?.swipe_id || 0 };
    } catch { return { messageIndex: -1, swipeId: 0 }; }
}

function writeEntry(chatId, patch) {
    if (!chatId) return;
    const s = getSettings();
    if (!s.chatStates) s.chatStates = {};
    if (!s.chatStates[chatId]) s.chatStates[chatId] = {};
    const { messageIndex, swipeId } = chatTail();
    s.chatStates[chatId].cyoa = { messageIndex, swipeId, ts: Date.now(), ...patch };
    persist();
}

/** Writes choices for a chat, stamped against the message they belong to. */
export function storeChoices(chatId, choices, source = 'narrator') {
    writeEntry(chatId, { choices, source });
}

/**
 * Records that the narrator wrote a choices block but it was unusable. Kept so
 * the panel can say *why* it is empty instead of looking like nothing happened
 * — the difference matters when debugging a preset.
 */
export function storeRejection(chatId, errors) {
    writeEntry(chatId, { rejected: errors });
}

/**
 * Marks that a turn completed with the module on. Lets the panel distinguish
 * "no generation has run yet" from "a turn just ended and the narrator didn't
 * offer anything", which is the state that actually needs explaining.
 */
export function markTurnCompleted(chatId) {
    if (!chatId) return;
    const s = getSettings();
    const entry = s.chatStates?.[chatId]?.cyoa;
    const { messageIndex, swipeId } = chatTail();
    if (entry && entry.messageIndex === messageIndex && entry.swipeId === swipeId) return;
    writeEntry(chatId, { silent: true });
}

export function clearChoices(chatId) {
    if (!chatId) return;
    const s = getSettings();
    if (s.chatStates?.[chatId]?.cyoa) {
        delete s.chatStates[chatId].cyoa;
        persist();
    }
}

/** The stored entry for a chat, or null when it belongs to a superseded message. */
function currentEntry(chatId) {
    if (!chatId) return null;
    const entry = getSettings().chatStates?.[chatId]?.cyoa;
    if (!entry) return null;
    const { messageIndex, swipeId } = chatTail();
    if (entry.messageIndex !== messageIndex || entry.swipeId !== swipeId) return null;
    return entry;
}

/**
 * Stored choices for a chat, or null when there are none *or* when they belong
 * to a message that has since been swiped or deleted. Stale choices are worse
 * than no choices — they describe a scene that no longer exists.
 * @param {string} chatId
 */
export function getChoicesForChat(chatId) {
    const entry = currentEntry(chatId);
    return entry?.choices?.length ? entry.choices : null;
}

/**
 * What the panel should say when there are no choices to show.
 * @returns {{ state: 'pending'|'rejected'|'silent', errors?: string[] }}
 */
export function getChoiceStatus(chatId) {
    const entry = currentEntry(chatId);
    if (entry?.rejected?.length) return { state: 'rejected', errors: entry.rejected };
    if (entry?.silent) return { state: 'silent' };
    return { state: 'pending' };
}

// ── Prompt construction ──────────────────────────────────────────────────────

/**
 * The slot rules shared by the `<cyoa>` sysprompt block (via the {{cyoaSlots}}
 * placeholder) and the regenerate fallback, so both paths ask for exactly the
 * same thing.
 *
 * Deliberately does NOT include the resource whitelist. That was cheap in a
 * tool description rebuilt on every turn; in the sysprompt it would be stale
 * (the additive cache only refreshes on scheduleAutoApply / CHAT_CHANGED) and
 * it would ride on every single request. The interceptor already ships the live
 * `### STATE MEMO` with [SPELLS]/[ABILITIES]/[INVENTORY] every turn, so the
 * rule points at that instead. regenerateChoices() builds its prompt live and
 * still passes the whitelist explicitly.
 *
 * @param {number} count
 */
export function buildChoiceInstructions(count) {
    const slots = activeSlots(count);
    return [
        `Write exactly ${slots.length} lines, one per slot, in this order:`,
        ...slots.map(s => `- \`${s.id}\` (${s.label}): ${s.description}`),
        '',
        'RULES:',
        '- The middle field is ONE sentence, second person, describing only what {{user}} does. Never narrate the result.',
        '- The third field is optional: one short clause naming what the action puts at risk or what it costs. It must be something {{user}} can already see. Never predict success or failure, never state a DC or a roll. Leave it empty rather than padding it.',
        '- No option may be marked or implied as the correct, best, or worst one. They should differ in what they cost and risk, not in how good they are.',
        '- Every option must be physically possible for {{user}} right now, in this location, with what they have.',
        '- Do not offer spells, abilities, or items that are not in the State Memo.',
    ].join('\n');
}

// ── Block parsing ────────────────────────────────────────────────────────────

/** Fresh regex per call — a shared /g literal carries `lastIndex` between calls. */
function blockRx() {
    return new RegExp(CHOICE_BLOCK_SOURCE, 'gi');
}

/**
 * Pulls the choices out of a narrator message.
 *
 * Returns the same shape the function tool used to receive, so validateChoices()
 * is the single judge of correctness for both this path and the regenerate
 * fallback. Pure — no settings reads, no side effects.
 *
 * Takes the LAST block in the message: a narrator that emits two has restated
 * itself, and the later one is the one that belongs to the finished scene.
 *
 * @param {string} text raw message body
 * @returns {{ choices: Array<{slot:string,text:string,stake:string}> }|null} null when there is no block at all
 */
export function parseChoiceBlock(text) {
    const matches = [...String(text || '').matchAll(blockRx())];
    if (!matches.length) return null;

    const body = matches[matches.length - 1][1];
    const choices = body
        .split('\n')
        .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean)
        .map((line) => {
            // Split on the first two pipes only; a literal `|` inside a stake
            // clause is rare, and rejoining the tail degrades to "the stake has
            // a pipe in it" rather than a dropped choice.
            const parts = line.split('|');
            return {
                slot: (parts[0] || '').trim().toLowerCase(),
                text: (parts[1] || '').trim(),
                stake: parts.slice(2).join('|').trim(),
            };
        });

    return { choices };
}

/**
 * Every choices block removed. Used by the paths that feed message text to
 * another model (the state pass, the audit chunker) — the block is UI data, not
 * narration, and letting it through means the tracker starts parsing it.
 * @param {string} text
 */
export function stripChoiceBlock(text) {
    return String(text || '').replace(blockRx(), '');
}

/**
 * Reads a finished narrator message and files whatever it offered. This is the
 * replacement for the old tool's `action` callback and behaves identically
 * downstream: valid choices are stored, a malformed block is recorded as a
 * rejection so the panel can say *why* it is empty, and a message with no block
 * at all is left alone for reconcileAfterTurn() to classify as silence.
 *
 * @param {string} chatId
 * @param {string} text raw message body
 * @returns {boolean} true when anything was written (caller can skip a re-render)
 */
export function ingestNarratorMessage(chatId, text) {
    if (!chatId) return false;
    const parsed = parseChoiceBlock(text);
    if (!parsed) return false;

    const expected = activeSlots(getSettings().cyoaChoiceCount).length;
    const { ok, errors, choices } = validateChoices(parsed, expected);
    if (!ok) {
        console.warn('[RPG Tracker] CYOA: rejected choices block:', errors);
        storeRejection(chatId, errors);
        return true;
    }
    storeChoices(chatId, choices);
    return true;
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
 * Fallback for narrators that skip the block: asks the World Progression
 * connection for choices against the last narrator message.
 *
 * Costs a request, so it is never automatic unless the player opts in via
 * `cyoaAutoFallback`; otherwise it only runs when they click ↻.
 * @param {string} chatId
 * @returns {Promise<{ok: boolean, reason?: string, errors?: string[]}>}
 */
export async function regenerateChoices(chatId) {
    const s = getSettings();
    if (!chatId) return { ok: false, reason: 'no-chat' };
    if (isCombatActive(s.currentMemo)) return { ok: false, reason: 'combat' };

    const { chat } = SillyTavern.getContext();
    const lastRaw = [...(chat || [])].reverse().find(m => !m.is_user && !m.is_system)?.mes;
    // Strip any block the narrator did manage to write: this path exists because
    // the last set was missing or unusable, and handing the model its own
    // rejected output invites it to hand the same thing straight back.
    const lastNarration = stripChoiceBlock(lastRaw).trim();
    if (!lastNarration) return { ok: false, reason: 'no-narration' };

    const count = activeSlots(s.cyoaChoiceCount).length;
    // {{user}} is a SillyTavern macro the narrator's prompt gets substituted for;
    // this prompt goes out via generateRaw on a different connection, so spell it out.
    const instructions = buildChoiceInstructions(count).replace(/\{\{user\}\}/g, 'the player');
    const whitelist = buildResourceWhitelist(s.currentMemo);
    const systemPrompt = `You propose the player's next possible actions in an ongoing tabletop RPG. You are not narrating — you only offer options.

${instructions}${whitelist ? `\n\nThe player currently has ONLY these resources — do not invent others:\n${whitelist}` : ''}

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
            storeChoices(chatId, validation.choices, 'fallback');
            return { ok: true };
        }

        lastErrors = validation.errors;
        messages.push({ role: 'assistant', content: result.content || '' });
        messages.push({ role: 'user', content: `Invalid — fix and resend:\n- ${lastErrors.join('\n- ')}` });
    }

    console.warn('[RPG Tracker] CYOA: regenerate exhausted retries.', lastErrors);
    return { ok: false, reason: 'validation-exhausted', errors: lastErrors };
}

// ── Post-turn reconciliation ─────────────────────────────────────────────────

/**
 * Runs after each narrator turn, once ingestNarratorMessage() has had its shot
 * at the message. Two jobs, both about the narrator simply not writing a block:
 *
 *  1. Record that a turn completed with nothing offered, so the panel can say so
 *     rather than showing the same "no choices yet" text it shows at boot.
 *  2. If the player has opted into `cyoaAutoFallback`, generate them anyway.
 *
 * A large third-party preset (Megumin Suite is the worked example) can talk the
 * narrator out of a standing every-turn instruction, and no amount of
 * correctness on our side fixes a prompt-adherence problem.
 *
 * @param {string} chatId
 * @returns {Promise<void>}
 */
export async function reconcileAfterTurn(chatId) {
    const s = getSettings();
    if (!chatId || !s.enabled || s.syspromptModules?.cyoa === false) return;
    if (isCombatActive(s.currentMemo)) return;
    if (getChoicesForChat(chatId)) return;                       // narrator delivered
    if (getChoiceStatus(chatId).state === 'rejected') return;    // called, but unusable — don't paper over it

    markTurnCompleted(chatId);
    globalThis._rpgRenderCyoaPanel?.();

    if (!s.cyoaAutoFallback) return;
    await regenerateChoices(chatId);
    globalThis._rpgRenderCyoaPanel?.();
}
