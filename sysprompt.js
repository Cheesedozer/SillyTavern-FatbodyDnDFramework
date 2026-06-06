/**
 * sysprompt.js — Fatbody D&D Framework
 *
 * Builds and applies the State Model's system prompt: fetches the bundled
 * sysprompt template, strips XML blocks for disabled syspromptModules, swaps
 * quest-narrator guidance by mode, injects the module instruction text, and
 * writes the result into SillyTavern's Main prompt box (unless Suite Mode /
 * custom sysprompt is on — see the Megumin Suite contract).
 *
 * Imports: env.js, state-manager.js, constants.js, memo-processor.js
 * Extracted from index.js as part of the monolith split (behaviour unchanged).
 */

import { FOLDER_NAME } from './env.js';
import { getSettings } from './state-manager.js';
import { RT_PROMPTS, QUESTS_NARRATOR_LEGACY, QUESTS_NARRATOR_MODERN } from './constants.js';
import { buildModulesInstructionText } from './memo-processor.js';

let _autoApplyTimer = null;

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

    const fileName = s.diceFunctionTool ? 'sysprompt.txt' : 'sysprompt_legacy.txt';
    let content;
    try {
        const response = await fetch(`/scripts/extensions/third-party/${FOLDER_NAME}/${fileName}`);
        if (response.ok) {
            content = await response.text();
        } else {
            throw new Error(`Server returned ${response.status}`);
        }
    } catch (err) {
        console.warn(`[Fatbody Framework] autoApplySysprompt: could not fetch ${fileName}, using fallback:`, err);
        content = RT_PROMPTS[fileName];
    }
    if (!content) return;

    content = buildSysprompt(content);
    const mainTextarea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('main_prompt_quick_edit_textarea'));
    if (mainTextarea) {
        mainTextarea.value = content;
        mainTextarea.dispatchEvent(new Event('blur', { bubbles: true }));
    }
}

export function scheduleAutoApply() {
    if (_autoApplyTimer) clearTimeout(_autoApplyTimer);
    _autoApplyTimer = setTimeout(() => { _autoApplyTimer = null; autoApplySysprompt(); }, 400);
}

/**
 * Rebuilds the system prompt by stripping out XML blocks that are
 * disabled in settings.syspromptModules.
 * @param {string} rawText
 * @returns {string}
 */
export function buildSysprompt(rawText) {
    if (!rawText) return "";
    const s = getSettings();
    const mods = s.syspromptModules || {};

    // 1. Tag-based module stripping and Quest mode swap
    let content = rawText
        .replace(/<(\w[\w_-]*)>([\s\S]*?)<\/\1>/g, (match, tag) => {
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

    return content
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
