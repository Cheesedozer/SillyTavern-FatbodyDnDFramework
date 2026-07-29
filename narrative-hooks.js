/**
 * narrative-hooks.js — Fatbody D&D Framework
 * RNG engine, dice tools, chat interceptor, and narrative collector.
 * This file is the primary hook into the SillyTavern chat pipeline:
 * it intercepts outgoing messages to inject context (RNG queue, state memo,
 * quests) and collects incoming AI narrative for the state model pass.
 *
 * Imports: state-manager.js
 * Imported by: index.js (registration)
 *
 * NOTE: runStateModelPass is resolved at call-time via globalThis to avoid a
 * circular import. This will be cleaned up when index.js is split.
 */

import { getSettings, getActivationMode, getCampaignMode } from './state-manager.js';
import { parseQuestsFromMemo, buildActiveLorebookContext, estimateTokens, estimateExternalPromptTokens, budgetInjections, OUTPUT_HEADROOM_FRAC } from './memo-processor.js';
import { runRouterPass, saveSceneToLorebook, scanAssistantOutputForKeywords } from './router.js';
import { maybeRunWorldProgressionPass } from './world-progression.js';
import { markerPayloadTokens } from './preset-marker.js';
import { logTransaction } from './debug-viewer.js';

// ── Dice naming helpers ────────────────────────────────────────────────────────

export function getDiceToolName() {
    return 'RollTheDice';
}

export function getDiceCommandName() {
    return 'roll';
}

export function getDiceCommandAliases() {
    return ['r'];
}

// ── RNG Engine ─────────────────────────────────────────────────────────────────

export const RNG_QUEUE_LEN = 12;

/**
 * Per-mode dice compositions for the RNG queue. The D&D profile is the
 * historical byte-locked shape (test/narrative-hooks.test.js); Modern
 * campaigns derive theirs from the foundation's POWER_SYSTEM.diceProfile.
 */
export const DICE_PROFILES = {
    dnd: { primary: 'd20', subdice: ['d4', 'd6', 'd8', 'd10', 'd12'], queueLen: RNG_QUEUE_LEN },
};

/**
 * Builds a dice profile from a foundation's POWER_SYSTEM.diceProfile, falling
 * back to D&D for missing/malformed input.
 * @param {{primary?: string, subdice?: string[], queueLen?: number}|null} dp
 * @returns {{primary: string, subdice: string[], queueLen: number}}
 */
export function profileFromFoundation(dp) {
    if (!dp || !/^d\d{1,3}$/.test(dp.primary || '')) return DICE_PROFILES.dnd;
    const subdice = Array.isArray(dp.subdice)
        ? dp.subdice.filter(d => /^d\d{1,3}$/.test(d) && d !== dp.primary)
        : [];
    const queueLen = (Number.isFinite(dp.queueLen) && dp.queueLen >= 1 && dp.queueLen <= 24)
        ? Math.floor(dp.queueLen) : RNG_QUEUE_LEN;
    return { primary: dp.primary, subdice, queueLen };
}

export function rollDie(sides) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(4294967296 / sides) * sides;
    let roll;
    do { crypto.getRandomValues(buf); roll = buf[0]; } while (roll >= limit);
    return (roll % sides) + 1;
}

const dieSides = (d) => parseInt(String(d).slice(1), 10);

export function makeRngQueue(n = RNG_QUEUE_LEN, profile = DICE_PROFILES.dnd) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const entry = { [profile.primary]: rollDie(dieSides(profile.primary)) };
        for (const d of profile.subdice) entry[d] = rollDie(dieSides(d));
        out.push(entry);
    }
    return out;
}

export function buildRngBlock(queue, profile = DICE_PROFILES.dnd) {
    const turnId = Date.now();
    const formattedQueue = queue.map(dice => {
        const subs = profile.subdice.map(d => `${d}:${dice[d]}`).join(',');
        return subs ? `${dice[profile.primary]}(${subs})` : `${dice[profile.primary]}`;
    }).join(", ");
    return `[RNG_QUEUE v6.0_PROPER]\nturn_id=${turnId}\nscope=this_response\nqueue=[${formattedQueue}]\n[/RNG_QUEUE]\n\n`;
}

// ── Dice rolling ───────────────────────────────────────────────────────────────

export async function doDiceRoll(customDiceFormula, quiet = false) {
    const nullValue = { total: '', rolls: [] };
    let value = typeof customDiceFormula === 'string' ? customDiceFormula.trim() : '1d20';

    if (value === 'custom') {
        const { Popup } = SillyTavern.getContext();
        value = await Popup.show.input('Enter the dice formula:<br><i>(for example, <tt>2d6</tt>)</i>', '', 'Roll', { cancelButton: 'Cancel' });
    }

    if (!value) return nullValue;

    const droll = SillyTavern.libs.droll;
    if (!droll) {
        toastr['error']('Dice library (droll) not found.');
        return nullValue;
    }

    const isValid = droll.validate(value);
    if (isValid) {
        const result = droll.roll(value);
        if (!result) return nullValue;
        if (!quiet) {
            const context = SillyTavern.getContext();
            context.sendSystemMessage('generic', `${context.name1} rolls a ${value}. The result is: ${result.total} (${result.rolls.join(', ')})`, { isSmallSys: true });
        }
        return { total: String(result.total), rolls: result.rolls.map(String) };
    } else {
        toastr['warning']('Invalid dice formula');
        return nullValue;
    }
}

/** Upper bounds for a model-supplied formula — enough for any plausible check. */
const MAX_TOOL_DICE_COUNT = 100;
const MAX_TOOL_DIE_SIDES = 1000;

/**
 * Validates a dice formula that arrived from the model via the function tool.
 *
 * The slash command is driven by a human and may legitimately open a prompt or
 * warn via toastr; a tool call cannot. Anything unrollable has to come back as an
 * error string the model can act on, because the alternative — `doDiceRoll`
 * returning `{ total: '' }` and the action coercing it to `0` — hands the model a
 * natural 0 it will narrate as a catastrophic failure.
 *
 * @param {unknown} raw
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateToolDiceFormula(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
        return { ok: false, error: 'No dice formula was provided. Call the tool again with a formula such as "1d20".' };
    }
    if (value.toLowerCase() === 'custom') {
        // 'custom' is the slash command's sentinel for "ask the human". Reaching
        // Popup.show.input from a tool call would block generation on a dialog.
        return { ok: false, error: '"custom" is not a dice formula — it is reserved for the player\'s own manual rolls. Call the tool again with an explicit formula such as "1d20".' };
    }
    for (const m of value.matchAll(/(\d*)d(\d+)/gi)) {
        const count = m[1] === '' ? 1 : Number(m[1]);
        const sides = Number(m[2]);
        if (count > MAX_TOOL_DICE_COUNT || sides > MAX_TOOL_DIE_SIDES) {
            return {
                ok: false,
                error: `Dice formula "${value}" is out of range (at most ${MAX_TOOL_DICE_COUNT} dice of at most ${MAX_TOOL_DIE_SIDES} sides). Call the tool again with a smaller formula.`,
            };
        }
    }
    const droll = SillyTavern.libs?.droll;
    if (!droll) {
        return { ok: false, error: 'The dice library is unavailable, so no roll could be made. Do not report a numeric result — resolve this check narratively instead.' };
    }
    if (!droll.validate(value)) {
        return { ok: false, error: `"${value}" is not a valid dice formula. Call the tool again with a formula such as "1d20" or "2d6+3".` };
    }
    return { ok: true, value };
}

// ── Tool & slash command registration ─────────────────────────────────────────

export function registerDiceFunctionTool() {
    try {
        const ctx = SillyTavern.getContext();
        const { registerFunctionTool, unregisterFunctionTool } = ctx;
        if (!registerFunctionTool || !unregisterFunctionTool) return;

        unregisterFunctionTool('RollTheDice');
        unregisterFunctionTool('FatbodyRollTheDice');

        const settings = getSettings();
        if (!settings.enabled || !settings.diceFunctionTool) return;

        const toolName = getDiceToolName();
        const isLegacy = settings.legacyDiceNaming;

        const rollDiceSchema = isLegacy ? {
            type: 'object',
            properties: {
                who: { type: 'string', description: 'The name of the persona rolling the dice' },
                formula: { type: 'string', description: 'A dice formula to roll, e.g. 1d6' },
            },
            required: ['who', 'formula'],
        } : {
            type: 'object',
            properties: {
                who: { type: 'string', description: 'The name of the persona rolling the dice' },
                formula: { type: 'string', description: 'A dice formula to roll, e.g. 1d20' },
                dc: { type: 'number', description: 'The Difficulty Class (DC) for this roll. Anchors the difficulty before the roll is made.' },
            },
            required: ['who', 'formula', 'dc'],
        };

        registerFunctionTool({
            name: toolName,
            displayName: isLegacy ? 'Dice Roll' : 'Dice Roll (with DC)',
            description: 'Rolls the dice using the provided formula and returns the numeric result. Use when it is necessary to roll the dice to determine the outcome of an action or when the user requests it.',
            parameters: rollDiceSchema,
            action: async (args) => {
                const check = validateToolDiceFormula(args?.formula || (isLegacy ? '1d6' : '1d20'));
                if (!check.ok) return `ERROR: ${check.error}`;
                const formula = check.value;

                const roll = await doDiceRoll(formula, true);
                if (!roll.rolls.length) {
                    return `ERROR: rolling "${formula}" produced no result. Do not report a numeric outcome — resolve this check narratively instead.`;
                }
                const total = parseInt(roll.total) || 0;

                if (isLegacy) {
                    return args.who
                        ? `${args.who} rolls a ${formula}. The result is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`
                        : `The result of a ${formula} roll is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`;
                }

                const dc = Number(args?.dc) || 0;
                let result = args.who
                    ? `${args.who} rolls a ${formula} against DC ${dc}. The result is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`
                    : `The result of a ${formula} roll against DC ${dc} is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`;

                if (dc > 0) {
                    result += ` (Result: ${total >= dc ? 'SUCCESS' : 'FAILURE'})`;
                }
                return result;
            },
            formatMessage: () => '',
        });
    } catch (error) {
        console.error('[RPG Tracker] Error registering dice function tool', error);
    }
}

export function registerDiceSlashCommand() {
    const { SlashCommand, SlashCommandParser, ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } = SillyTavern.getContext();
    if (!SlashCommand || !SlashCommandParser) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: getDiceCommandName(),
        aliases: getDiceCommandAliases(),
        callback: async (args, value) => {
            const quiet = String(args.quiet) === 'true';
            const result = await doDiceRoll(String(value || (getSettings().legacyDiceNaming ? '1d6' : '1d20')), quiet);
            return result.total;
        },
        helpString: 'Roll the dice.',
        returns: 'roll result',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: 'Do not display the result in chat',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'dice formula, e.g. 2d6',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'router',
        callback: async (args, value) => {
            const val = String(value || '').trim().toLowerCase();
            if (val.startsWith('save')) {
                const hint = val.substring(4).trim();
                await saveSceneToLorebook(hint);
                return 'Scene save requested.';
            }
            if (val === 'run' || val === 'research') {
                const { chat } = SillyTavern.getContext();
                const s = getSettings();
                const combinedNarrative = getNarrativeBlocks(chat, -1, !!s.routerIncludeHidden);
                await runRouterPass(combinedNarrative, null, null, true);
                return 'Research pass started.';
            }
            return 'Usage: /router run | /router save [hint]';
        },
        helpString: 'Interact with the Router Agent (e.g. /router save)',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'command (e.g. save)',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));
}

// ── stripMemoHtml (local copy — canonical version moves to renderer.js in Phase 6) ──
function stripMemoHtml(text) {
    if (!text) return text;
    let stripped = text.replace(/<br\s*\/?>/gi, '\n');
    stripped = stripped.replace(/<[^>]+>/g, '');
    return stripped;
}

// ── Chat interceptor (registered on globalThis for ST manifest hook) ───────────

export function installInterceptor() {
    globalThis.rpgTrackerInterceptor = async function (chat, contextSize, abort, type) {
        // Fail open: any internal error must never break the outgoing generation.
        try {
            const settings = getSettings();
            // `paused` only suppresses automatic state tracker / lorebook runs (see onGenerationEnded).
            // Do not skip this hook when paused: RNG queue, memo, and quest context must still inject
            // into the outgoing user message or combat RNG breaks while updates are paused.
            if (!settings.enabled) return;

            let idx = -1;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (chat[i]['role'] === "user" || chat[i].is_user) { idx = i; break; }
            }
            if (idx === -1) return;

            const msg = chat[idx];
            const content = msg['content'] || msg.mes || '';

            // ── Campaign mode context (v3.0): Modern chats swap the dice profile
            // and may carry a pending level-up directive. ──
            const chatId = typeof globalThis._rpgCurrentChatId === 'function'
                ? globalThis._rpgCurrentChatId()
                : SillyTavern.getContext().chatId;
            const isModern = !!chatId && getCampaignMode(chatId) === 'modern';
            const chatState = isModern ? settings.chatStates?.[chatId] : null;

            // ── Tier 0: RNG queue (tiny, combat-critical — never dropped) ──
            let rngBlock = '';
            if (settings.rngEnabled && !content.includes("[RNG_QUEUE v6.0_PROPER]")) {
                const profile = isModern
                    ? profileFromFoundation(chatState?.foundation?.POWER_SYSTEM?.diceProfile)
                    : DICE_PROFILES.dnd;
                rngBlock = buildRngBlock(makeRngQueue(profile.queueLen, profile), profile);
            }

            // ── Tier 0b: pending level-up directive (Modern) — tiny, never dropped ──
            let levelUpDirective = '';
            const pending = chatState?.progression?.pendingLevelUp;
            if (pending) {
                levelUpDirective = `[SYSTEM DIRECTIVE: LEVEL UP — {{user}} reached Level ${pending.toLevel}. `
                    + `Follow the <level_up_protocol> NOW: pause the narrative, announce the level-up, `
                    + `grant +${pending.points} skill points${pending.milestone ? ' (milestone bonus included)' : ''}, `
                    + `and await the player before continuing.]\n\n`;
                pending.delivered = true;   // cleared in onGenerationEnded after this generation lands
            }

            // ── Tier 1: STATE MEMO (engine-written canon — outranks lore) ──
            // The memo carries the [ORIGIN] block, which is authoritative over any
            // lore entry. It used to sit at the bottom of the budget and be the
            // first thing trimmed, which meant context pressure deleted the canon
            // and kept the entries contradicting it. It is still the only trimmable
            // item, but it is now trimmed only after lore has been dropped.
            let memoText = '';
            if (settings.currentMemo && !content.includes("### STATE MEMO (DO NOT REPEAT)")) {
                // Strip the JSON [QUESTS] block from the narrative context to save tokens and avoid redundancy
                memoText = stripMemoHtml(settings.currentMemo).replace(/\[QUESTS\][\s\S]*?\[\/QUESTS\]/gi, '').trim();
            }
            const memoBlock = memoText ? `### STATE MEMO (DO NOT REPEAT)\n${memoText}\n\n` : '';

            // ── Tier 2: quest deadline check + active quests ──
            let questText = '';
            // Quest deadline check — fires before state model pass, deterministically
            if (settings.modules?.quests) {
                const memoQuests = parseQuestsFromMemo(settings.currentMemo);
                if (memoQuests.length) {
                    const { checkQuestDeadlines, renderQuestsAsPlainText } = await import('./quests.js');
                    checkQuestDeadlines();

                    // Inject active quests as plain text into narrative context
                    const timeMatch = (settings.currentMemo || '').match(/\[TIME\]([\s\S]*?)\[\/TIME\]/i);
                    const currentTime = timeMatch ? timeMatch[1].split('\n').filter(Boolean)[0]?.trim() || '' : '';
                    // Re-parse after checkQuestDeadlines may have mutated the memo
                    const freshQuests = parseQuestsFromMemo(settings.currentMemo);
                    questText = renderQuestsAsPlainText(freshQuests, currentTime) || '';
                }
            }

            // ── Tiers 2-4: keyword pre-scan + same-turn / persistent / agent lore ──
            // The PromptManager builds the prompt BEFORE this interceptor runs, so updating
            // activeRouterKeys is always one turn late on that path.
            // Fix: entries activated THIS scan are injected directly into the user message —
            // the same pattern as state memo and quests — guaranteeing same-turn presence.
            // Skipped in 'native' mode: keywords are handed to ST's WI scanner, which
            // doesn't want Fatbody's keyword scanner or manual lore injection.
            let keywordLore = '';   // tier 3: newly activated this turn
            let agentLore = '';     // tier 4: agent/direct-command owned
            let persistentLore = '';// tier 5: previously keyword-activated, re-injected
            // Lore is model-written and can drift from the engine-written canon in
            // the state memo. Saying so explicitly gives the narrator a rule to
            // apply instead of having to guess which source to believe.
            const LORE_SUBORDINATION = ' — recorded lore; the STATE MEMO and origin canon override any conflict here';
            if (settings.routerEnabled && getActivationMode(settings) === 'managed' && content) {
                const t0 = performance.now().toFixed(1);
                console.group(`[RPG|INTERCEPT] rpgTrackerInterceptor keyword pre-scan @ ${t0}ms`);
                console.log('activeRouterKeys BEFORE scan:', JSON.stringify(settings.activeRouterKeys || []));
                const triggered = await scanAssistantOutputForKeywords(content, { sweepEnabled: false }).catch(() => []);
                console.log('activeRouterKeys AFTER scan:', JSON.stringify(settings.activeRouterKeys || []));
                console.log('newly triggered this scan:', triggered);
                console.log(`scan finished @ ${performance.now().toFixed(1)}ms`);

                if (triggered.length > 0) {
                    try {
                        const loreBlock = await buildActiveLorebookContext(triggered);
                        if (loreBlock) {
                            keywordLore = `\n<font color="#d4a028">## NEWLY ACTIVATED LORE (KEYWORD MATCH)${LORE_SUBORDINATION}</font>\n${loreBlock}\n`;
                            console.log(`[RPG|INTERCEPT] Same-turn lore injected for ${triggered.length} entries.`);
                        }

                        // Trigger UI refresh so the Agent Panel updates immediately with yellow pills
                        if (typeof globalThis._rpgRenderRouterUI === 'function') {
                            globalThis._rpgRenderRouterUI();
                        }
                    } catch (e) {
                        console.warn('[RPG Tracker] Same-turn lore injection failed:', e);
                    }
                }

                // Re-inject previously keyword-activated lore on every subsequent turn.
                // These entries are still disable:true in the lorebook so ST's native system
                // won't inject them — we must keep doing it manually every generation.
                const triggeredSet = new Set(triggered);
                const persistent = (settings.keywordActivatedKeys || []).filter(id => !triggeredSet.has(id));
                if (persistent.length > 0) {
                    try {
                        const persistBlock = await buildActiveLorebookContext(persistent);
                        if (persistBlock) {
                            persistentLore = `\n<font color="#d4a028">## ACTIVE LORE (KEYWORD)${LORE_SUBORDINATION}</font>\n${persistBlock}\n`;
                        }
                    } catch (e) {
                        console.warn('[RPG Tracker] Persistent keyword lore re-injection failed:', e);
                    }
                }

                // Inject agent-activated lore (grey pills): entries in activeRouterKeys that are
                // NOT in the keyword pools. These were added by the Agent or Direct Command.
                // They are disable:true in the lorebook so ST's native scanner ignores them.
                // Neither of the keyword passes above covers them — this pass fills the gap.
                const alreadyInjected = new Set([...triggered, ...(settings.keywordActivatedKeys || [])]);
                const agentOwned = (settings.activeRouterKeys || []).filter(id => !alreadyInjected.has(id));
                if (agentOwned.length > 0) {
                    try {
                        const agentBlock = await buildActiveLorebookContext(agentOwned);
                        if (agentBlock) {
                            agentLore = `\n## ACTIVE LORE (AGENT)${LORE_SUBORDINATION}\n${agentBlock}\n`;
                        }
                    } catch (e) {
                        console.warn('[RPG Tracker] Agent-owned lore injection failed:', e);
                    }
                }

                console.groupEnd();
            }

            // ── Fit all injections into the context budget (output order preserved) ──
            let chatTokens = 0;
            for (const m of chat) chatTokens += estimateTokens(m.content || m.mes || '');

            // Other extensions' injections (VectFox memories, router lore, etc.) occupy
            // context too: registered extension prompts are measurable here; injectors
            // that run after the interceptor (Megumin Suite) are covered by the
            // user-configured external reserve. The [[ORIGINS]] marker payload is a
            // third case — it's ours, but with the marker on it lives in the preset
            // rather than the extension-prompt registry, so we measure it exactly.
            const externalTokens = estimateExternalPromptTokens(SillyTavern.getContext())
                + (settings.presetMarkerEnabled ? markerPayloadTokens() : 0)
                + (Number(settings.externalReserveTokens) > 0 ? Number(settings.externalReserveTokens) : 0);

            const { injections, dropped, trimmed } = budgetInjections({
                contextSize,
                chatTokens,
                externalTokens,
                items: [
                    { name: 'RNG',             tier: 0, text: rngBlock },
                    { name: 'LEVEL UP',        tier: 0, text: levelUpDirective },
                    { name: 'STATE MEMO',      tier: 1, text: memoBlock, trimmable: true },
                    { name: 'quests',          tier: 2, text: questText },
                    { name: 'keyword lore',    tier: 3, text: keywordLore },
                    { name: 'persistent lore', tier: 5, text: persistentLore },
                    { name: 'agent lore',      tier: 4, text: agentLore },
                ],
            });

            if (dropped.length || trimmed) {
                const reserved = Math.ceil(contextSize * OUTPUT_HEADROOM_FRAC);
                console.warn(`[RPG|BUDGET] context=${contextSize} chat=${chatTokens} external≈${externalTokens} reserved≈${reserved} dropped=[${dropped.join(', ')}] memoTrimmed=${trimmed}`);
            }

            if (!injections) return;

            const originalContent = msg.content || msg.mes || '';
            if (typeof msg.content === "string") msg.content = injections + msg.content;
            else if (typeof msg.mes === "string") msg.mes = injections + msg.mes;

            if (settings.debugMode) {
                console.log("[Fatbody Framework] Injections pushed to request.");
                logTransaction('Main Chat', [{ role: 'user', content: injections + originalContent }]);
            }
        } catch (e) {
            console.error('[RPG Tracker] Interceptor failed open (no injection applied):', e);
        }
    };
}


// ── Narrative collector ────────────────────────────────────────────────────────

/**
 * Collects AI narrative blocks from the chat array.
 * @param {any[]} chat
 * @param {number} limit  -1 = all since last user message; N = collect N blocks
 */
export function getNarrativeBlocks(chat, limit = -1, includeHidden = false) {
    if (!chat || chat.length === 0) return "";
    let narrativeBlocks = [];
    let foundCount = 0;

    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (limit === -1 && msg.is_user) break;
        if (limit !== -1 && foundCount >= limit) break;
        if (msg.is_system) continue;
        if (!includeHidden && /** @type {any} */ (msg).is_hidden) continue;

        let mes = (msg.mes || '').trim();
        if (!mes) continue;
        if (mes.startsWith('[Summary') || mes.startsWith('(Summary') || mes.includes('Summary of past events:')) continue;
        if (msg.extra?.['summary'] || msg.extra?.['is_summary'] || msg.extra?.['summary_data']) continue;

        // Strip tool call & thinking UI (XML-tag variants)
        mes = mes.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, '');
        mes = mes.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '');
        mes = mes.replace(/<thought\b[^>]*>([\s\S]*?)<\/thought>/gi, '');
        mes = mes.replace(/<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi, '');
        mes = mes.replace(/<reasoning\b[^>]*>([\s\S]*?)<\/reasoning>/gi, '');
        // <think> tags used by DeepSeek, Qwen, etc.
        mes = mes.replace(/<think\b[^>]*>([\s\S]*?)<\/think>/gi, '');

        // If ST stored reasoning in extra.reasoning and it bled into mes, strip it
        const extraReasoning = /** @type {any} */ (msg).extra?.reasoning;
        if (extraReasoning && typeof extraReasoning === 'string' && mes.includes(extraReasoning)) {
            mes = mes.replace(extraReasoning, '');
        }

        mes = mes.trim();

        if (mes) { narrativeBlocks.unshift(mes); foundCount++; }
    }
    return narrativeBlocks.join('\n\n');
}

// ── Generation-ended handler ───────────────────────────────────────────────────

/** In-memory counter: how many generations have fired since the agent last ran. Resets on chat change. */
let _routerAutoTick = 0;

/**
 * Accumulates keyword-triggered entry IDs across throttled generations so the
 * agent receives the full set (not just the current turn) when it finally fires.
 * Reset whenever the agent runs or the chat changes.
 */
let _pendingKeywordTriggered = [];

/** Call this whenever the active chat changes so the interval counter and accumulator restart.
 * @param {boolean} [clearKeywordPool] - Pass true only when actually switching to a different chat.
 */
export function resetRouterTick(clearKeywordPool = false) {
    _routerAutoTick = 0;
    _pendingKeywordTriggered = [];
    // Keyword-activated entries are transient (they expire when the keyword leaves the scan window).
    // Only clear on a real chat change, not on same-chat reloads (swipe, regenerate).
    if (clearKeywordPool) {
        const s = getSettings();
        if (s.keywordActivatedKeys?.length) {
            s.keywordActivatedKeys = [];
        }
    }
}

/**
 * Fires on GENERATION_ENDED. Triggers the state model pass.
 * runStateModelPass is resolved via the module import below to avoid
 * a hard circular dep — it will be a direct import once memo-processor.js exists.
 */
export async function onGenerationEnded() {
    const settings = getSettings();
    const isStateRunning = typeof globalThis._rpgStateModelRunning === 'function' && globalThis._rpgStateModelRunning();
    if (!settings.enabled || settings.paused || isStateRunning) return;

    // Modern mode: a level-up directive that was delivered with the generation
    // that just finished is consumed (fail-open — one delivery per level-up;
    // the state pass below may stage a NEW one from this generation's XP).
    try {
        const chatId = typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null;
        const prog = chatId ? settings.chatStates?.[chatId]?.progression : null;
        if (prog?.pendingLevelUp?.delivered) prog.pendingLevelUp = null;
    } catch (_) { /* never block the pipeline */ }

    const { chat } = SillyTavern.getContext();
    const combinedNarrative = getNarrativeBlocks(chat, -1, !!settings.routerIncludeHidden);
    if (!combinedNarrative) return;

    if (settings.debugMode) console.log("[RPG Tracker] Assistant generation ended. Running keyword scanner...");

    // Step 1: Scan assistant output for entry keywords and activate matches immediately.
    // Must run before the state model pass and on EVERY generation, regardless of throttle,
    // so entries are never one turn behind the narrator even when the agent is skipped.
    // Skipped in 'native' mode (ST's WI scanner owns activation).
    if (settings.routerEnabled && getActivationMode(settings) === 'managed') {
        const thisGenTriggered = await scanAssistantOutputForKeywords(combinedNarrative);
        if (thisGenTriggered.length > 0) {
            // Accumulate across throttled turns — deduplicate so IDs are not repeated.
            const accumulated = new Set([..._pendingKeywordTriggered, ...thisGenTriggered]);
            _pendingKeywordTriggered = [...accumulated];
            if (settings.debugMode) {
                console.log("[RPG Tracker] Keyword scanner activated entries:", thisGenTriggered, "| Pending total:", _pendingKeywordTriggered.length);
            }

            // Trigger UI refresh
            if (typeof globalThis._rpgRenderRouterUI === 'function') {
                globalThis._rpgRenderRouterUI();
            }
        }
    }

    if (settings.debugMode) console.log("[RPG Tracker] Triggering State Model pass...", combinedNarrative);

    // Step 2: State Tracker pass.
    if (typeof globalThis._rpgRunStateModelPass === 'function') {
        await globalThis._rpgRunStateModelPass(combinedNarrative);
    }

    // Step 2b: World Progression pass. MUST run here, before Step 3's early return —
    // that throttle only guards the Lorebook Agent, but this feature has its own
    // independent throttle (and Pacing must evaluate every cycle regardless of the
    // Lorebook Agent's cadence). Inserting this after Step 4 would make it inherit
    // the router's throttle and silently skip cycles it should have run.
    if (settings.worldProgEnabled) {
        try {
            await maybeRunWorldProgressionPass(combinedNarrative, chat);
        } catch (e) {
            console.error('[RPG Tracker] World Progression pass failed:', e);
        }
    }

    // Step 3: Run-every throttle — only fire the Lorebook Agent every N auto-generations.
    _routerAutoTick++;
    const runEvery = settings.routerRunEvery || 1;
    if (_routerAutoTick < runEvery) return;
    _routerAutoTick = 0;

    // Step 4: Lorebook Agent pass — passes the full accumulated set of keyword-triggered IDs
    // from all throttled turns since the last agent run (not just the current generation).
    const triggeredForAgent = [..._pendingKeywordTriggered];
    _pendingKeywordTriggered = []; // reset accumulator now that the agent is about to process them
    await runRouterPass(combinedNarrative, null, null, false, triggeredForAgent);
}
