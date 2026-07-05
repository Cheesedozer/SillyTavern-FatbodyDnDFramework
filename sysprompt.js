/**
 * sysprompt.js — Fatbody D&D Framework
 *
 * Builds and applies the State Model's system prompt: fetches the bundled
 * sysprompt template, strips XML blocks for disabled syspromptModules, swaps
 * quest-narrator guidance by mode, injects the module instruction text, and
 * writes the result into SillyTavern's Main prompt box (unless Suite Mode /
 * custom sysprompt is on — see the Megumin Suite contract).
 *
 * Also maintains a synchronous cache of the additive (rules-only) variant,
 * exposed to other extensions via globalThis._rpgGetAdditiveSysprompt() (see
 * index.js) so Megumin Suite's [[FATBODY]] block can pull Fatbody's live
 * rules instead of shipping its own frozen copy.
 *
 * Imports: env.js, state-manager.js, constants.js, memo-processor.js, world-progression.js
 * Extracted from index.js as part of the monolith split (behaviour unchanged).
 */

import { FOLDER_NAME } from './env.js';
import { getSettings, getCampaignMode } from './state-manager.js';
import { RT_PROMPTS, QUESTS_NARRATOR_LEGACY, QUESTS_NARRATOR_MODERN } from './constants.js';
import { buildModulesInstructionText } from './memo-processor.js';
import { getFoundation, foundationPlaceholders } from './foundation.js';
import { detectMeguminFatbodyBlock } from './world-progression.js';

let _autoApplyTimer = null;

/** Synchronous cache backing globalThis._rpgGetAdditiveSysprompt() — see refreshAdditiveRulesCache(). */
let _additiveRulesCache = { content: '', chatId: null };

// ── Additive delivery (rules-only) ─────────────────────────────────────────────

/** Extension-prompt key used by additive delivery. Distinct from 'rpg_tracker_lore' (router). */
export const ADDITIVE_PROMPT_KEY = 'rpg_tracker_rules';

/**
 * Top-level sysprompt tags included in the additive (rules-only) variant.
 * Everything persona-adjacent (<role>, <narrative>, <party_join_leave>) is
 * excluded so another extension/preset (e.g. Megumin Suite) can own the
 * narrator persona while Fatbody layers pure mechanics on top.
 * <random_events>/<resting> stay listed: they are plain mechanics and remain
 * governed by the existing syspromptModules toggles inside buildSysprompt().
 */
export const ADDITIVE_TAGS = [
    'rng_system', 'combat', 'saving_throws', 'loot', 'random_events',
    'xp_system', 'quests', 'level_up_protocol', 'resting',
    'end_of_output_footer', 'state_memo', 'constraints',
    // Modern-mode (sysprompt_modern.txt) mechanics sections
    'power_system', 'skills', 'lethality',
];

export const ADDITIVE_HEADER =
    'The following mechanical subsystems are layered on top of your existing role and narration style. '
    + 'Do not change persona; apply these rules to all action resolution.';

/** Shared fetch (+ embedded fallback) for the bundled narrator sysprompt file. */
async function fetchSyspromptText(fileName) {
    try {
        const response = await fetch(`/scripts/extensions/third-party/${FOLDER_NAME}/${fileName}`);
        if (response.ok) return await response.text();
        throw new Error(`Server returned ${response.status}`);
    } catch (err) {
        console.warn(`[Fatbody Framework] could not fetch ${fileName}, using fallback:`, err);
        return RT_PROMPTS[fileName];
    }
}

/**
 * Resolves the narrator sysprompt source for the active chat:
 *  - Modern campaigns (committed foundation) → sysprompt_modern.txt with
 *    `{{foundation_*}}` placeholders substituted from the foundation.
 *  - Everything else → the classic D&D files (tool-call or legacy variant).
 * @returns {Promise<{content: string|undefined, mode: 'dnd'|'modern'}>}
 */
async function resolveSyspromptSource() {
    const s = getSettings();
    const ctx = SillyTavern.getContext();
    const chatId = ctx.chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : '');
    const foundation = chatId ? getFoundation(chatId) : null;
    const isModern = !!chatId && getCampaignMode(chatId) === 'modern' && !!foundation;

    if (isModern) {
        let content = await fetchSyspromptText('sysprompt_modern.txt');
        if (content) {
            const placeholders = foundationPlaceholders(foundation);
            for (const [key, value] of Object.entries(placeholders)) {
                content = content.split(`{{${key}}}`).join(value);
            }
            return { content, mode: 'modern' };
        }
        console.error('[Fatbody Framework] sysprompt_modern.txt unavailable — falling back to D&D sysprompt.');
    }

    const fileName = s.diceFunctionTool ? 'sysprompt.txt' : 'sysprompt_legacy.txt';
    return { content: await fetchSyspromptText(fileName), mode: 'dnd' };
}

export async function autoApplySysprompt() {
    const s = getSettings();
    // Master switch: never (re)write the Main prompt box while the extension is
    // disabled, so a disabled Fatbody leaves no D&D framing behind (otherwise the
    // model keeps running the level/XP system and defaults the character to Level 1).
    if (!s.enabled) return;
    if (s.customSysprompt) return;
    // Suite Mode: the Megumin Suite owns the Main prompt and injects Fatbody mechanics via its
    // [[FATBODY]] block, so do NOT overwrite the Main prompt box here.
    if (s.suiteMode) return;
    // Additive delivery: the Main prompt box belongs to the user/another extension.
    // Mechanics ship via the extension prompt instead (applyAdditiveSysprompt).
    if (s.syspromptDelivery === 'additive') return;

    const { content } = await resolveSyspromptSource();
    if (!content) return;

    const built = buildSysprompt(content);
    const mainTextarea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('main_prompt_quick_edit_textarea'));
    if (mainTextarea) {
        mainTextarea.value = built;
        mainTextarea.dispatchEvent(new Event('blur', { bubbles: true }));
    }
}

/**
 * Refreshes the synchronous additive-rules cache read by
 * globalThis._rpgGetAdditiveSysprompt() (Megumin Suite's live-pull API).
 * Populated whenever additive delivery is active locally OR Megumin's own
 * [[FATBODY]] block is active for the current profile — the latter case is
 * what makes "Suite Mode + standalone delivery" (today's documented common
 * setup) compute this content at all, since neither autoApplySysprompt() nor
 * applyAdditiveSysprompt() ever call resolveSyspromptSource() for it.
 * @param {boolean} meguminFatbodyActive
 */
async function refreshAdditiveRulesCache(meguminFatbodyActive) {
    const s = getSettings();
    if (!s.enabled || s.customSysprompt || !(s.syspromptDelivery === 'additive' || meguminFatbodyActive)) {
        _additiveRulesCache = { content: '', chatId: null };
        return;
    }

    const chatIdAtStart = SillyTavern.getContext().chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : '');
    const { content } = await resolveSyspromptSource();

    // Chat may have changed while the fetch was in flight — discard a stale result
    // rather than caching content built against a chat that's no longer active.
    const chatIdNow = SillyTavern.getContext().chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : '');
    if (chatIdNow !== chatIdAtStart) return;

    _additiveRulesCache = { content: content ? buildSysprompt(content, { variant: 'additive' }) : '', chatId: chatIdAtStart };
}

/** Synchronous read of the additive-rules cache — see refreshAdditiveRulesCache(). Never throws. */
export function getAdditiveSyspromptCache() {
    return _additiveRulesCache.content;
}

/**
 * Maintains the rules-only extension prompt for additive delivery.
 * Persistent like the router's 'rpg_tracker_lore' prompt: set once here, ST
 * includes it on every generation until cleared. Cleared whenever additive
 * delivery is not active so switching modes leaves no residue.
 * @param {boolean} [meguminFatbodyActive] - whether Megumin's own [[FATBODY]]
 *   block is active for the current profile. Defaults to a fresh detection so
 *   direct callers (disable handler, manual refresh button) stay correct
 *   without having to compute it themselves.
 */
export async function applyAdditiveSysprompt(meguminFatbodyActive = detectMeguminFatbodyBlock().active) {
    const ctx = SillyTavern.getContext();
    const setExtensionPrompt = ctx.setExtensionPrompt;
    if (typeof setExtensionPrompt !== 'function') return;

    const s = getSettings();
    if (!s.enabled || s.customSysprompt || s.syspromptDelivery !== 'additive') {
        setExtensionPrompt(ADDITIVE_PROMPT_KEY, '', 0, 0);
        return;
    }
    // Double-injection guard: Megumin's [[FATBODY]] block already pulls this same
    // cache live (see resolveFatbodyBlockContent() in Megumin's index.js). Only trust
    // that signal when the user has also told Fatbody "Megumin owns my prompt" via
    // Suite Mode — this narrows the risk of suppressing mechanics entirely because of
    // a stale Megumin flag left over from an unrelated preset that doesn't actually
    // reference [[FATBODY]].
    if (s.suiteMode && meguminFatbodyActive) {
        setExtensionPrompt(ADDITIVE_PROMPT_KEY, '', 0, 0);
        return;
    }

    setExtensionPrompt(ADDITIVE_PROMPT_KEY, getAdditiveSyspromptCache(), 0, 0);
}

/** Single dispatcher: keeps both delivery paths consistent (each clears/skips itself when inactive). */
export async function applySysprompt() {
    const meguminFatbodyActive = detectMeguminFatbodyBlock().active;
    await refreshAdditiveRulesCache(meguminFatbodyActive);
    await autoApplySysprompt();
    await applyAdditiveSysprompt(meguminFatbodyActive);
}

export function scheduleAutoApply() {
    if (_autoApplyTimer) clearTimeout(_autoApplyTimer);
    _autoApplyTimer = setTimeout(() => { _autoApplyTimer = null; applySysprompt(); }, 400);
}

/**
 * Rebuilds the system prompt by stripping out XML blocks that are
 * disabled in settings.syspromptModules.
 * @param {string} rawText
 * @param {{variant?: 'standalone'|'additive'}} [opts] - 'additive' keeps only
 *   ADDITIVE_TAGS blocks and prepends ADDITIVE_HEADER (rules-only, no persona).
 * @returns {string}
 */
export function buildSysprompt(rawText, { variant = 'standalone' } = {}) {
    if (!rawText) return "";
    const s = getSettings();
    const mods = s.syspromptModules || {};
    const additive = variant === 'additive';

    // 1. Tag-based module stripping and Quest mode swap
    let content = rawText
        .replace(/<(\w[\w_-]*)>([\s\S]*?)<\/\1>/g, (match, tag) => {
            if (additive && !ADDITIVE_TAGS.includes(tag)) return '';
            if (mods[tag] === false) return '';
            // Inject correct instructions for quests based on legacy mode
            if (tag === 'quests') {
                let instruction = s.questLegacyMode ? QUESTS_NARRATOR_LEGACY : QUESTS_NARRATOR_MODERN;
                // Strip Mood guidance if Frustration is off
                if (!mods.questsFrustration) {
                    instruction = instruction.replace(/Use the MOOD field.*?\./g, '');
                }
                // Strip Difficulty guidance if Difficulty is off
                if (!mods.questsDifficulty) {
                    instruction = instruction.replace(/the difficulty \(Very Easy to Very Hard\), /g, '');
                    instruction = instruction.replace(/Assign an appropriate difficulty \(Very Easy to Very Hard\) based on the narrative stakes\. /g, '');
                }
                return `<quests>\n${instruction.trim()}\n</quests>`;
            }
            return match;
        });

    // 2. Inject current module instructions
    const modulesText = buildModulesInstructionText(s);
    content = content.replace("{{modulesText}}", modulesText);

    // 3. Handle Quests Hardcore rules stripping (Narrator guidance)
    if (!mods.questsDeadlines) {
        // Strip deadline assignment rule and auto_fail guidance
        content = content.replace(/- Assign an in-world Deadline.*\n/g, '');
        content = content.replace(/- Set auto_fail to true for quests.*\n/g, '');
        content = content.replace(/- If a duration is given.* Day N.*\n/g, '');
    }
    if (!mods.questsFrustration) {
        // Strip frustration coefficient and mood rules
        content = content.replace(/- Set a frustration_coefficient.*\n/g, '');
        content = content.replace(/ {2}· 0\.4 = Very patient.*\n/g, '');
        content = content.replace(/ {2}· 1\.0 = Normal.*\n/g, '');
        content = content.replace(/ {2}· 3\.0 = Volatile.*\n/g, '');
        content = content.replace(/- The NPC Mood evolves continuously.*\n/g, '');
        // Also strip the 'past deadline' override rule — only applies when Frustration is active
        content = content.replace(/- If a quest is time-sensitive and the deadline passes.*\n/g, '');
    }
    if (!mods.questsDifficulty) {
        // The <combat> block's enemy-scaling guidance references quest difficulty,
        // which will never be set without this toggle — collapse it to a shorter,
        // always-applicable line instead of shipping dead instructions every turn.
        content = content.replace(
            /SCALING TO QUEST DIFFICULTY[\s\S]*?applies only to quest-tied encounters\.\n?/,
            "Scale enemy strength to fit {{user}}'s current level and the narrative stakes of the scene.\n"
        );
    }

    content = content
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (additive && content) {
        content = `${ADDITIVE_HEADER}\n\n${content}`;
    }

    return content;
}
