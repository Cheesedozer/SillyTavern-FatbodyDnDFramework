/**
 * foundation-wizard.js — Fatbody Framework (Modern RPG mode, v3.0)
 *
 * The Foundation Builder: a multi-turn Q&A wizard that refines the user's
 * ideas (plus the active character card / persona / pasted documents) into a
 * schema-validated foundation JSON, previews it, and commits it — locking the
 * chat into Modern mode.
 *
 * Conversation runs on the secondary (state-model) connection via
 * sendAgentTurn(), the same multi-turn primitive the Lorebook Agent uses.
 * Generation is a bounded loop: extract fenced JSON → validateFoundation() →
 * feed the full error list back (≤3 retries) → preview → commit.
 *
 * Imports: state-manager.js, llm-client.js, foundation.js
 * Imported by: index.js (button wiring)
 */

import { getSettings } from './state-manager.js';
import { sendAgentTurn } from './llm-client.js';
import {
    FOUNDATION_SCHEMA_VERSION,
    validateFoundation,
    extractFoundationJson,
    renderFoundationProse,
    commitFoundationAndInit,
} from './foundation.js';
import { scheduleAutoApply } from './sysprompt.js';

const MAX_GENERATION_RETRIES = 3;

/** Schema description the model writes against. Kept in prose+example form —
 *  models follow examples far more reliably than abstract JSONSchema. */
const SCHEMA_SPEC = `
The foundation JSON object MUST have exactly this shape:

{
  "schemaVersion": ${FOUNDATION_SCHEMA_VERSION},
  "mode": "modern",
  "SETTING": { "name": "...", "synopsis": "2-4 sentences", "themes": ["..."], "toneNotes": "..." },
  "POWER_SYSTEM": {
    "name": "...", "description": "how powers work in this world",
    "resources": [ { "id": "mana", "name": "Mana", "description": "...", "baseFormula": "...", "regenRule": "..." } ],
    "diceProfile": {
      "primary": "d100", "subdice": ["d10","d20"], "queueLen": 12,
      "dcScale": [ {"label":"Trivial","value":20}, {"label":"Easy","value":35}, {"label":"Moderate","value":50}, {"label":"Hard","value":75}, {"label":"Near-impossible","value":95} ],
      "critRule": "optional"
    }
  },
  "PROGRESSION_RULES": {
    "maxLevel": 100, "xpCurveId": "modern_v1",
    "xpAwardGuidance": "optional override of the default percent brackets",
    "skillPointsPerLevel": 2, "milestoneEvery": 10, "milestoneBonus": 4,
    "respec": { "freeUntilLevel": 10, "currencyName": "...", "costMultiplier": 1.0 }
  },
  "CLASS_ROSTER": [ /* exactly 3 to 6 classes */
    { "id": "slug", "name": "...", "fantasy": "one-line class fantasy", "role": "damage|control|support|tank|hybrid", "primaryResource": "<a resources id>", "treeThemes": ["...","..."] }
  ],
  "JOB_RULES": { "enabled": true, "maxJobs": 2, "unlockNarrative": "how jobs unlock in-fiction", "jobSeeds": [ { "id":"slug", "name":"...", "description":"...", "unlockHint":"..." } ] },
  "SKILL_TAXONOMY": {
    "damageTypes": ["..."], "namingConvention": "...",
    "rarityTiers": [ {"id":"common","name":"Common","color":"#aaaaaa"}, {"id":"rare","name":"Rare","color":"#5588ff"}, {"id":"epic","name":"Epic","color":"#aa55ff"} ],
    "tierCount": 10, "levelGatePerTier": 10
  },
  "LETHALITY": {
    "template": "standard",
    "downedWindow": 3,
    "injuryTable": [ "6-10 thematic permanent injuries with their mechanical debuff in parentheses" ],
    "deathRule": "what finally causes true death"
  }
}

Constraints: every CLASS_ROSTER primaryResource must match a POWER_SYSTEM.resources id; 3-6 classes; resources must not be empty; respec.currencyName is the campaign currency.`;

function buildWizardSystemPrompt(context) {
    return `You are the Foundation Architect for a custom RPG campaign engine. Your job is to interview the user about the world and progression system they want, refine their ideas into something mechanically coherent, and finally produce a single foundation JSON document.

PHASE 1 — INTERVIEW (now): Ask focused questions, 2-4 at a time, about whatever is still undefined: the setting's tone, how powers work, what resource fuels active skills, what the currency is, what the 3-6 starting classes should feel like, whether professions ("Jobs") exist, and how deadly the world is. Build on the user's answers; propose concrete options when they are unsure. Keep replies under 200 words.

PHASE 2 — GENERATION (only when the user clicks "Generate Foundation"): output the complete foundation as ONE fenced \`\`\`json block matching the schema below, with no commentary after it. Fill any gaps the interview left with choices consistent with everything discussed.

${SCHEMA_SPEC}

${context ? `## SOURCE MATERIAL (character card / persona / documents provided by the user)\n${context}` : ''}`;
}

/** Gathers card description + persona as wizard source material. */
function gatherSourceContext() {
    const ctx = SillyTavern.getContext();
    const parts = [];
    try {
        const char = ctx.characters?.[ctx.characterId];
        if (char?.description?.trim()) parts.push(`### Active character card (${char.name || 'unnamed'})\n${char.description.trim()}`);
    } catch (_) { /* no card */ }
    try {
        const persona = ctx.substituteParams ? ctx.substituteParams('{{persona}}').trim() : '';
        if (persona && persona !== '{{persona}}') parts.push(`### Player persona\n${persona}`);
    } catch (_) { /* no persona */ }
    return parts.join('\n\n');
}

// ── Modal UI ───────────────────────────────────────────────────────────────────

let _wizardOpen = false;

/**
 * Opens the Foundation Builder modal for the current chat.
 * No-op (with a toast) when a foundation conversation is already open or the
 * chat is already locked to a mode with a committed foundation.
 */
export function openFoundationWizard() {
    if (_wizardOpen) return;
    const ctx = SillyTavern.getContext();
    const chatId = ctx.chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null);
    if (!chatId) {
        toastr['warning']('Open a chat first — the foundation is stored per campaign.', 'Foundation Builder');
        return;
    }
    const s = getSettings();
    const existing = s.chatStates?.[chatId]?.foundation;

    _wizardOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'rt-foundation-wizard-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div id="rt-fw-modal" style="width:min(720px,94vw);max-height:90vh;display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor, #1a1a2a);border:1px solid var(--rt-accent-dim, rgba(255,255,255,0.2));border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="font-weight:bold;color:var(--rt-accent,#3498db);">🏗️ Foundation Builder — Custom RPG (Modern Mode)</div>
                <button id="rt-fw-close" class="menu_button interactable" style="padding:2px 10px;">✕</button>
            </div>
            <div id="rt-fw-status" style="padding:4px 14px;font-size:0.8em;opacity:0.75;">${existing ? `Foundation v${existing.foundationVersion} exists — committing creates v${existing.foundationVersion + 1} (acquired skills are never retconned).` : 'Describe the RPG system you want; the architect will interview you, then generate the foundation.'}</div>
            <div id="rt-fw-log" style="flex:1;min-height:240px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;"></div>
            <div id="rt-fw-preview" style="display:none;flex:1;min-height:240px;overflow-y:auto;padding:10px 14px;white-space:pre-wrap;font-size:0.85em;"></div>
            <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.1);">
                <details style="margin-bottom:8px;">
                    <summary style="cursor:pointer;font-size:0.8em;opacity:0.7;">📎 Paste source documents (optional)</summary>
                    <textarea id="rt-fw-docs" class="text_pole" rows="4" style="width:100%;margin-top:6px;" placeholder="Worldbuilding notes, magic system docs, anything the architect should read…"></textarea>
                </details>
                <div style="display:flex;gap:8px;">
                    <textarea id="rt-fw-input" class="text_pole" rows="2" style="flex:1;" placeholder="Describe your world / answer the architect…"></textarea>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <button id="rt-fw-send" class="menu_button interactable" style="white-space:nowrap;">Send 💬</button>
                        <button id="rt-fw-generate" class="menu_button interactable" style="white-space:nowrap;background:rgba(0,200,140,0.18);border-color:#00c88c;">Generate Foundation ⚒️</button>
                    </div>
                </div>
                <div id="rt-fw-commit-row" style="display:none;gap:8px;margin-top:8px;">
                    <button id="rt-fw-commit" class="menu_button interactable" style="flex:1;background:rgba(0,200,140,0.25);border-color:#00c88c;">✅ Commit foundation &amp; lock Modern mode</button>
                    <button id="rt-fw-back" class="menu_button interactable" style="flex:1;">↩ Keep refining</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const log = overlay.querySelector('#rt-fw-log');
    const input = /** @type {HTMLTextAreaElement} */ (overlay.querySelector('#rt-fw-input'));
    const docsEl = /** @type {HTMLTextAreaElement} */ (overlay.querySelector('#rt-fw-docs'));
    const statusEl = overlay.querySelector('#rt-fw-status');
    const previewEl = overlay.querySelector('#rt-fw-preview');
    const commitRow = overlay.querySelector('#rt-fw-commit-row');
    const sendBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector('#rt-fw-send'));
    const genBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector('#rt-fw-generate'));

    /** @type {Array<{role:string, content:string}>} */
    const messages = [];
    let docsInjected = false;
    let candidate = null;       // validated foundation awaiting commit
    let busy = false;

    const close = () => { _wizardOpen = false; overlay.remove(); };
    overlay.querySelector('#rt-fw-close').addEventListener('click', close);

    const append = (role, text) => {
        const bubble = document.createElement('div');
        const isUser = role === 'user';
        bubble.style.cssText = `max-width:85%;padding:8px 10px;border-radius:8px;font-size:0.88em;line-height:1.45;white-space:pre-wrap;align-self:${isUser ? 'flex-end' : 'flex-start'};background:${isUser ? 'var(--rt-accent-bg, rgba(52,152,219,0.18))' : 'rgba(255,255,255,0.06)'};border:1px solid rgba(255,255,255,0.1);`;
        bubble.textContent = text;
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
    };

    const setBusy = (b, label = '') => {
        busy = b;
        sendBtn.disabled = b;
        genBtn.disabled = b;
        statusEl.textContent = b ? label : 'Ready.';
    };

    const ensureSystemPrompt = () => {
        if (messages.length === 0) {
            messages.push({ role: 'system', content: buildWizardSystemPrompt(gatherSourceContext()) });
        }
        // Pasted documents join the conversation once, as a user-visible turn.
        const docs = docsEl.value.trim();
        if (docs && !docsInjected) {
            messages.push({ role: 'user', content: `Here are source documents to base the foundation on:\n\n${docs}` });
            docsInjected = true;
        }
    };

    const turn = async (label) => {
        setBusy(true, label);
        try {
            const { content } = await sendAgentTurn(getSettings(), messages, null, null);
            messages.push({ role: 'assistant', content });
            return content;
        } finally {
            setBusy(false);
        }
    };

    const send = async () => {
        const text = input.value.trim();
        if (!text || busy) return;
        ensureSystemPrompt();
        input.value = '';
        append('user', text);
        messages.push({ role: 'user', content: text });
        try {
            const reply = await turn('Architect is thinking…');
            append('assistant', reply);
        } catch (e) {
            append('assistant', `⚠️ ${e.message || e}`);
        }
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    genBtn.addEventListener('click', async () => {
        if (busy) return;
        ensureSystemPrompt();
        append('user', '⚒️ Generate the foundation JSON now.');
        messages.push({ role: 'user', content: 'Generate the complete foundation JSON now, as a single fenced ```json block matching the schema exactly. No commentary after the block.' });

        try {
            for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
                const reply = await turn(`Generating foundation (attempt ${attempt}/${MAX_GENERATION_RETRIES})…`);
                const parsed = extractFoundationJson(reply);
                if (!parsed) {
                    append('assistant', '⚠️ No JSON block found in the reply — asking again…');
                    messages.push({ role: 'user', content: 'Your reply contained no parseable ```json block. Output ONLY the foundation JSON in one fenced block.' });
                    continue;
                }
                const { ok, errors } = validateFoundation(parsed);
                if (!ok) {
                    append('assistant', `⚠️ Validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''}) — feeding errors back…\n- ${errors.slice(0, 8).join('\n- ')}${errors.length > 8 ? '\n- …' : ''}`);
                    messages.push({ role: 'user', content: `The foundation failed validation. Fix EVERY issue and output the corrected complete JSON again:\n- ${errors.join('\n- ')}` });
                    continue;
                }
                // Success → preview
                candidate = parsed;
                previewEl.textContent = renderFoundationProse({ ...parsed, foundationVersion: (existing?.foundationVersion || 0) + 1 });
                log.style.display = 'none';
                previewEl.style.display = 'block';
                commitRow.style.display = 'flex';
                statusEl.textContent = 'Review the foundation. Committing locks this chat to Modern mode.';
                return;
            }
            append('assistant', `❌ Could not produce a valid foundation in ${MAX_GENERATION_RETRIES} attempts. Refine the ideas and try again.`);
        } catch (e) {
            append('assistant', `⚠️ ${e.message || e}`);
            setBusy(false);
        }
    });

    overlay.querySelector('#rt-fw-back').addEventListener('click', () => {
        candidate = null;
        previewEl.style.display = 'none';
        commitRow.style.display = 'none';
        log.style.display = 'flex';
        statusEl.textContent = 'Keep refining, then generate again.';
    });

    // Commit: persist + initialize, then close — the HUD's empty state derives
    // the class-selection step from the committed foundation (classId === null).
    overlay.querySelector('#rt-fw-commit').addEventListener('click', async () => {
        if (!candidate || busy) return;
        setBusy(true, 'Committing foundation…');
        try {
            await commitFoundationAndInit(chatId, candidate);
            scheduleAutoApply();   // refresh Fatbody's own sysprompt + the additive cache for the newly-committed foundation
            close();
            globalThis._rpgRefreshRenderedView?.();
            globalThis._rpgRefreshHudHeaderButtons?.(chatId);
        } catch (e) {
            // Surface the failure in the conversation too, so "Keep refining"
            // lands on a log that tells the architect what to change (e.g. the
            // re-commit compatibility guard's list of missing ids).
            append('assistant', `❌ Commit failed: ${e.message || e}`);
            setBusy(false);   // setBusy resets the status line — write after it
            statusEl.textContent = 'Commit failed — see the conversation log.';
        }
    });
}
