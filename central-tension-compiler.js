/**
 * central-tension-compiler.js — Fatbody Framework (World Progression System)
 *
 * Compiles the World Arc's Central Tension. Modeled directly on
 * foundation-wizard.js's generate → validate → retry → preview → commit
 * shape, but narrower: rather than a full interview, the user picks one of
 * three input modes (category presets, custom text, or "let the AI decide
 * from the character card") and the model expands that single input into
 * the full structure in one bounded generation loop. A short free-text
 * refine box lets the user nudge the result before committing.
 *
 * The raw input (preset picks / custom text / nothing) is NEVER used
 * verbatim as the working central tension — commitCentralTension only ever
 * writes the compiled, validated result.
 *
 * Imports: state-manager.js, llm-client.js, foundation.js (JSON extraction
 *          reuse), router.js (writeBookToDisk), world-progression.js,
 *          world-progression-schema.js
 * Imported by: index.js (button wiring), the World Progression HUD's empty state.
 */

import { getSettings } from './state-manager.js';
import { sendAgentTurn } from './llm-client.js';
import { extractFoundationJson as extractJsonBlock } from './foundation.js';
import { writeBookToDisk } from './router.js';
import { getWorldProgKey, getWorldState, getChatWorldProg, saveWorldState, saveChatWorldProg, worldProgSettings } from './world-progression.js';
import { CENTRAL_TENSION_CATEGORIES, validateCentralTension } from './world-progression-schema.js';
import { antiGenericBlock, buildOriginMemoBlock, writeOriginToMemo, ORIGINS_BY_ID } from './origins-engine.js';
import { RT } from './shared-state.js';

const MAX_GENERATION_RETRIES = 3;

const SCHEMA_SPEC = `
The central tension JSON object MUST have exactly this shape:

{
  "intimateConflict": "1-3 sentences: the personal, character-scale stake — how this affects the player directly",
  "epicConflict": "1-3 sentences: the world-scale stake that exists whether or not the player acts",
  "milestoneChain": [
    { "title": "short stable name", "description": "1-2 sentences: an invariant pressure point the world is heading toward" }
  ],
  "factionSeeds": [
    { "name": "...", "posture": "aggressive|defensive|scheming|fractured|ascendant|declining", "goal": "1 sentence" }
  ],
  "chapter1Seeds": [
    { "text": "a tangible, specific planted hook — not abstract foreshadowing", "tiedTo": "world|character|regional|none" }
  ]
}

Constraints: milestoneChain must have exactly 5 to 8 items — these are invariant plot pressure points the world is heading toward regardless of player action; the player decides HOW they play out and WHO they happen to, never WHETHER they happen. factionSeeds is optional (0-4 items). chapter1Seeds must have exactly 3 to 5 items, tangible and specific ("A raven watches from the rooftop and flies north" — never "you feel a sense of unease"), with at least one item tiedTo:"world" and at least one tiedTo:"character".`;

function buildCompilerSystemPrompt(input, cardContext) {
    const { source, categoryIds, customText, originProfile } = input;
    let sourceInstruction;
    if (source === 'origin' && originProfile) {
        // v4.0 Origins: the committed origin seeds the tension — the personal
        // lever becomes the intimate stake, the world-threat tie-in the epic one.
        sourceInstruction = `The player committed an Origins character; build the central tension FROM their origin (spec: the world-threat tie-in is the connective thread between personal history and the campaign-scale problem).

### Committed origin
${originProfile.origin} — ${originProfile.name}${originProfile.title ? `, ${originProfile.title}` : ''} (${originProfile.race})
Backstory: ${originProfile.backstory}
Personal lever: ${originProfile.personalLever?.text || ''}
Social lever: ${originProfile.socialLever?.text || ''} (legible to: ${originProfile.socialLever?.legibleTo || ''})
${originProfile.pursuer ? `Pursuer: ${originProfile.pursuer.identity} — motive: ${originProfile.pursuer.motive}; ${originProfile.pursuer.awareness}.${originProfile.pursuer.leverage ? ` Leverage: ${originProfile.pursuer.leverage}` : ''}` : ''}
World-threat tie-in: ${originProfile.worldThreatTieIn}
Origin nation: ${originProfile.nation?.name} — ${originProfile.nation?.government}; ${originProfile.nation?.cultureVibes}; ${originProfile.nation?.outsiderView}

Rules for this mode: "intimateConflict" must grow out of the personal lever (and pursuer, if any) — the pressure already bearing on this character. "epicConflict" must grow out of the world-threat tie-in — the campaign-scale problem that proceeds whether or not the player acts. Personal closure and the world threat stay separate tracks that intersect narratively but never gate one another; the milestone chain tracks the WORLD threat's pressure points, not the character's personal quest list. Reuse the origin's named canon (nation, pursuer) rather than inventing parallel versions of them.`;
    } else if (source === 'custom') {
        sourceInstruction = `The player wrote this central tension idea in their own words:\n"${customText}"\n\nExpand and structure it into the schema below. Do not replace their core idea — sharpen it into something that can sustain a 5-8 milestone campaign.`;
    } else if (source === 'preset') {
        const blurb = CENTRAL_TENSION_CATEGORIES.filter(c => categoryIds.includes(c.id)).map(c => `- ${c.label}: ${c.blurb}`).join('\n');
        const blendClause = categoryIds.length === 1
            ? `Build the central tension around this candidate category — adapt and expand it to fit the world below; you do not need to follow it literally.`
            : `Blend or choose from these to create ONE coherent central tension — you do not need to use all of them, and you should adapt the flavor to fit the world below.`;
        sourceInstruction = `The player selected these candidate tension categories as inspiration:\n${blurb}\n\n${blendClause}`;
    } else {
        sourceInstruction = `The player wants you to invent a central tension entirely from what fits the world below — surprise them with something that suits the setting rather than defaulting to a generic threat.`;
    }

    return `You are the World Arc Architect for an AI-run roleplay campaign. Your job is to compile a campaign's Central Tension: a conflict that is simultaneously intimate (it affects the player character directly) and epic (it affects the world whether the player acts or not) — the tadpole-in-BG3 kind of stake, not a generic quest premise.

${sourceInstruction}

${cardContext ? `## WORLD CONTEXT (character card / persona)\n${cardContext}\n` : ''}
${antiGenericBlock('worldArc')}

Output a single fenced \`\`\`json block matching the schema below, with no commentary after it.

${SCHEMA_SPEC}`;
}

/** Gathers card description + persona as compiler source material — same pattern as foundation-wizard.js#gatherSourceContext. */
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

/** Writes 0-4 compiler-seeded factions into `<prefix>_Factions` as real FAC entries and links them back onto worldState.factions. Extends the existing FAC module rather than inventing a parallel store (spec §13). */
async function seedFactionLorebookEntries(prefix, worldState, factionSeeds) {
    if (!factionSeeds?.length || !prefix) return;
    const bookName = `${prefix}_Factions`;
    const ctx = SillyTavern.getContext();
    let book = null;
    try { book = await ctx.loadWorldInfo(bookName); } catch (_) { /* new book */ }
    if (!book?.entries) book = { entries: {}, name: bookName, scan_depth: 4, token_budget: 400, recursive: false, extensions: {} };

    let nextUid = Object.keys(book.entries).reduce((max, k) => Math.max(max, Number(k) || -1), -1) + 1;
    // Collect [factionId, entryId] pairs but do NOT link them onto worldState yet —
    // only do that after writeBookToDisk actually succeeds, so a failed write never
    // leaves worldState pointing at a lorebook entry that doesn't really exist.
    const pendingLinks = [];
    for (const [factionId, faction] of Object.entries(worldState.factions)) {
        if (faction.lorebookEntryId) continue; // already linked to a real entry
        const idx = Number((factionId.match(/^seed_faction_(\d+)$/) || [])[1]);
        const seed = Number.isFinite(idx) ? factionSeeds[idx - 1] : null;
        if (!seed) continue;
        const uid = String(nextUid++);
        book.entries[uid] = {
            uid: Number(uid), key: [seed.name], comment: seed.name,
            content: `Status: ${seed.posture || 'scheming'}. Goal: ${seed.goal || ''}`,
            disable: false, constant: false, order: 100, position: 0,
        };
        pendingLinks.push([factionId, `${bookName}::${uid}`]);
    }
    if (pendingLinks.length) {
        await writeBookToDisk(bookName, book);
        for (const [factionId, entryId] of pendingLinks) worldState.factions[factionId].lorebookEntryId = entryId;
    }
}

/**
 * Turns a compiled, validated central-tension candidate into the working
 * World Arc state: milestone chain, faction seeds (linked to real FAC
 * lorebook entries), and Chapter 1's seeds. The raw input that produced the
 * candidate is never written as the working tension itself.
 * @param {string} chatId
 * @param {object} compiled - already passed validateCentralTension
 * @param {{source: string, rawInput: string}} provenance
 * @returns {Promise<object>} the updated world state
 */
export async function commitCentralTension(chatId, compiled, provenance) {
    const key = getWorldProgKey(chatId);
    if (!key) throw new Error('No campaign available for this chat — open/link a campaign first.');

    const worldState = getWorldState(chatId);
    const chatWorldProg = getChatWorldProg(chatId);

    worldState.centralTension = {
        source: provenance?.source || null,
        rawInput: provenance?.rawInput || '',
        intimateConflict: compiled.intimateConflict,
        epicConflict: compiled.epicConflict,
        compiledAt: new Date().toISOString(),
        compilerVersion: 1,
    };
    worldState.milestoneChain = compiled.milestoneChain.map((m, i) => ({
        id: `ms_${i + 1}`, title: m.title, description: m.description, order: i + 1,
        status: 'pending', triggeredAt: null, howItPlayedOut: null,
    }));
    worldState.worldClock.nextMilestoneId = worldState.milestoneChain[0]?.id || null;
    worldState.worldClock.pressureGauge = 'low';

    worldState.factions = {};
    (compiled.factionSeeds || []).forEach((f, i) => {
        worldState.factions[`seed_faction_${i + 1}`] = {
            lorebookEntryId: '', posture: f.posture || 'scheming', goal: f.goal || '',
            lastActionAt: null, lastActionSummary: '',
        };
    });

    chatWorldProg.worldStateKey = key;
    chatWorldProg.chapter.seeds = compiled.chapter1Seeds.map((s, i) => ({
        id: `seed_${Date.now()}_${i}`, text: s.text, tiedTo: s.tiedTo || 'none', tiedToId: null,
        engaged: false, status: 'planted', createdAt: new Date().toISOString(),
    }));

    try {
        await seedFactionLorebookEntries(key, worldState, compiled.factionSeeds || []);
    } catch (e) {
        console.warn('[RPG Tracker] World Progression: could not seed faction lorebook entries (state was still committed):', e);
    }

    try {
        await publishOriginArcTieIn(chatId, compiled.epicConflict);
    } catch (e) {
        console.warn('[RPG Tracker] World Progression: could not publish the origin arc tie-in (the arc was still committed):', e);
    }

    saveWorldState(chatId);
    saveChatWorldProg(chatId);
    return worldState;
}

/**
 * Promotes the compiled epic conflict into the committed origin's
 * World-Threat Tie-In and rewrites the [ORIGIN] memo block so the line appears.
 *
 * Pre-arc, the origin's `worldThreatTieIn` is only a private seed for this
 * compiler — buildOriginMemoBlock deliberately withholds it, because showing
 * the player a campaign-scale promise nothing has committed to reads as canon
 * that never arrives. Committing an arc is what makes it real.
 * @param {string} chatId
 * @param {string} epicConflict
 */
async function publishOriginArcTieIn(chatId, epicConflict) {
    const tieIn = (epicConflict || '').trim();
    if (!tieIn) return;
    const s = getSettings();
    const committed = s.chatStates?.[chatId]?.origin?.committed;
    if (!committed) return; // non-Origins campaign — nothing to publish into

    committed.arcTieIn = tieIn;
    s.currentMemo = writeOriginToMemo(
        s.currentMemo,
        buildOriginMemoBlock(committed, ORIGINS_BY_ID[committed.originId]),
    );
    // Same persistence path the origin commit uses (origins-wizard.js).
    const idx = await import('./index.js');
    idx.saveSettings();
    idx.syncMemoView();
}

// ── Modal UI ───────────────────────────────────────────────────────────────────

let _wizardOpen = false;

/** Opens the Central Tension compiler modal for the current chat. No-op if already open. */
export function openCentralTensionWizard() {
    if (_wizardOpen) return;
    const ctx = SillyTavern.getContext();
    const chatId = ctx.chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null);
    if (!chatId) {
        toastr['warning']('Open a chat first — the central tension is stored per campaign.', 'World Progression');
        return;
    }
    const existing = getWorldState(chatId);
    const hasExisting = !!existing?.milestoneChain?.length;
    // v4.0 Origins: a committed origin unlocks (and preselects) the 4th mode.
    const originProfile = getSettings().chatStates?.[chatId]?.origin?.committed || null;

    _wizardOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'rt-ctc-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div id="rt-ctc-modal" style="width:min(720px,94vw);max-height:90vh;display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor, #1a1a2a);border:1px solid var(--rt-accent-dim, rgba(255,255,255,0.2));border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="font-weight:bold;color:var(--rt-accent,#3498db);">🌍 Start World Arc — Central Tension</div>
                <button id="rt-ctc-close" class="menu_button interactable" style="padding:2px 10px;">✕</button>
            </div>
            <div id="rt-ctc-status" style="padding:4px 14px;font-size:0.8em;opacity:0.75;">${hasExisting ? 'A central tension already exists for this campaign — compiling a new one replaces the milestone chain and faction seeds.' : 'Choose how to seed the campaign\'s central conflict.'}</div>

            <div id="rt-ctc-setup" style="flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px;">
                <div style="display:flex;gap:6px;">
                    ${originProfile ? '<button class="menu_button interactable rt-ctc-mode-btn" data-mode="origin" style="flex:1;">🧬 From my origin</button>' : ''}
                    <button class="menu_button interactable rt-ctc-mode-btn" data-mode="preset" style="flex:1;">Pick categories</button>
                    <button class="menu_button interactable rt-ctc-mode-btn" data-mode="custom" style="flex:1;">Write my own</button>
                    <button class="menu_button interactable rt-ctc-mode-btn" data-mode="ai" style="flex:1;">Let the AI decide</button>
                </div>
                <div id="rt-ctc-mode-origin" style="display:none;font-size:0.85em;opacity:0.8;">The architect builds the campaign's central tension from your committed origin: your <b>personal lever</b> seeds the intimate stake, your <b>world-threat tie-in</b> seeds the epic one, and your nation and pursuer stay canon.</div>
                <div id="rt-ctc-mode-preset" style="display:none;">
                    <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">Pick 1-4 categories — the architect will blend or choose from them to fit the current character card.</div>
                    <div id="rt-ctc-categories" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"></div>
                </div>
                <div id="rt-ctc-mode-custom" style="display:none;">
                    <textarea id="rt-ctc-custom-text" class="text_pole" rows="4" style="width:100%;" placeholder="Describe the central conflict you want in your own words…"></textarea>
                </div>
                <div id="rt-ctc-mode-ai" style="display:none;font-size:0.85em;opacity:0.8;">The architect will invent a central tension purely from the active character card and persona — no categories or custom text needed.</div>
            </div>

            <div id="rt-ctc-preview" style="display:none;flex:1;min-height:240px;overflow-y:auto;padding:10px 14px;white-space:pre-wrap;font-size:0.85em;"></div>

            <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.1);">
                <div id="rt-ctc-setup-actions" style="display:flex;justify-content:flex-end;">
                    <button id="rt-ctc-generate" class="menu_button interactable" style="background:rgba(0,200,140,0.18);border-color:#00c88c;" disabled>Compile Central Tension ⚒️</button>
                </div>
                <div id="rt-ctc-preview-actions" style="display:none;flex-direction:column;gap:8px;">
                    <textarea id="rt-ctc-refine" class="text_pole" rows="2" style="width:100%;" placeholder="Optional: describe what to change, then Regenerate…"></textarea>
                    <div style="display:flex;gap:8px;">
                        <button id="rt-ctc-regenerate" class="menu_button interactable" style="flex:1;">↺ Regenerate</button>
                        <button id="rt-ctc-back" class="menu_button interactable" style="flex:1;">↩ Back to setup</button>
                        <button id="rt-ctc-commit" class="menu_button interactable" style="flex:1;background:rgba(0,200,140,0.25);border-color:#00c88c;">✅ Commit &amp; start campaign</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('#rt-ctc-status');
    const setupEl = overlay.querySelector('#rt-ctc-setup');
    const previewEl = overlay.querySelector('#rt-ctc-preview');
    const setupActionsEl = overlay.querySelector('#rt-ctc-setup-actions');
    const previewActionsEl = overlay.querySelector('#rt-ctc-preview-actions');
    const genBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector('#rt-ctc-generate'));
    const categoriesEl = overlay.querySelector('#rt-ctc-categories');
    const customTextEl = /** @type {HTMLTextAreaElement} */ (overlay.querySelector('#rt-ctc-custom-text'));
    const refineEl = /** @type {HTMLTextAreaElement} */ (overlay.querySelector('#rt-ctc-refine'));

    let mode = null;
    let busy = false;
    let candidate = null;
    /** @type {Array<{role:string, content:string}>} */
    const messages = [];

    const close = () => { _wizardOpen = false; overlay.remove(); };
    overlay.querySelector('#rt-ctc-close').addEventListener('click', close);

    CENTRAL_TENSION_CATEGORIES.forEach(c => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;gap:6px;align-items:flex-start;font-size:0.82em;padding:4px;border-radius:4px;background:rgba(255,255,255,0.04);cursor:pointer;';
        label.innerHTML = `<input type="checkbox" value="${c.id}" style="margin-top:2px;"><span><b>${c.label}</b><br><span style="opacity:0.7;">${c.blurb}</span></span>`;
        categoriesEl.appendChild(label);
    });

    const setBusy = (b, label = '') => {
        busy = b;
        genBtn.disabled = b || !mode;
        statusEl.textContent = b ? label : 'Ready.';
    };

    const selectedCategoryIds = () => [...categoriesEl.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);

    const refreshGenerateEnabled = () => {
        if (mode === 'preset') genBtn.disabled = selectedCategoryIds().length < 1 || selectedCategoryIds().length > 4;
        else if (mode === 'custom') genBtn.disabled = !customTextEl.value.trim();
        else genBtn.disabled = !mode;
    };

    overlay.querySelectorAll('.rt-ctc-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            mode = btn.getAttribute('data-mode');
            overlay.querySelectorAll('.rt-ctc-mode-btn').forEach(b => b.style.opacity = b === btn ? '1' : '0.55');
            overlay.querySelector('#rt-ctc-mode-preset').style.display = mode === 'preset' ? 'block' : 'none';
            overlay.querySelector('#rt-ctc-mode-custom').style.display = mode === 'custom' ? 'block' : 'none';
            overlay.querySelector('#rt-ctc-mode-ai').style.display = mode === 'ai' ? 'block' : 'none';
            const originPanel = overlay.querySelector('#rt-ctc-mode-origin');
            if (originPanel) originPanel.style.display = mode === 'origin' ? 'block' : 'none';
            refreshGenerateEnabled();
        });
    });
    categoriesEl.addEventListener('change', refreshGenerateEnabled);
    customTextEl.addEventListener('input', refreshGenerateEnabled);

    // A committed origin preselects its mode — the World Arc gate flows
    // straight from origin commit to a tension seeded by it (spec §11).
    if (originProfile) {
        overlay.querySelector('.rt-ctc-mode-btn[data-mode="origin"]')?.click();
    }

    function currentInput() {
        if (mode === 'preset') return { source: 'preset', categoryIds: selectedCategoryIds(), customText: '' };
        if (mode === 'custom') return { source: 'custom', categoryIds: [], customText: customTextEl.value.trim() };
        if (mode === 'origin') return { source: 'origin', categoryIds: [], customText: '', originProfile };
        return { source: 'ai_generated', categoryIds: [], customText: '' };
    }

    async function generate(extraUserNote) {
        if (busy) return;
        setBusy(true, 'Compiling central tension…');
        try {
            const input = currentInput();
            if (messages.length === 0) {
                messages.push({ role: 'system', content: buildCompilerSystemPrompt(input, gatherSourceContext()) });
                messages.push({ role: 'user', content: 'Compile the central tension now, as a single fenced ```json block matching the schema exactly. No commentary after the block.' });
            } else if (extraUserNote) {
                messages.push({ role: 'user', content: `Regenerate with this change: ${extraUserNote}. Output the corrected complete JSON again, one fenced block.` });
            }

            for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
                const { content } = await sendAgentTurn(worldProgSettings(getSettings()), messages, null, null);
                messages.push({ role: 'assistant', content });
                const parsed = extractJsonBlock(content);
                if (!parsed) {
                    messages.push({ role: 'user', content: 'Your reply contained no parseable ```json block. Output ONLY the central tension JSON in one fenced block.' });
                    continue;
                }
                const { ok, errors } = validateCentralTension(parsed);
                if (!ok) {
                    messages.push({ role: 'user', content: `The central tension failed validation. Fix EVERY issue and output the corrected complete JSON again:\n- ${errors.join('\n- ')}` });
                    continue;
                }
                candidate = { parsed, input };
                previewEl.textContent = renderCentralTensionPreview(parsed);
                setupEl.style.display = 'none';
                previewEl.style.display = 'block';
                setupActionsEl.style.display = 'none';
                previewActionsEl.style.display = 'flex';
                statusEl.textContent = 'Review the central tension. Committing seeds the campaign and starts Chapter 1.';
                setBusy(false);
                return;
            }
            statusEl.textContent = `Could not produce a valid central tension in ${MAX_GENERATION_RETRIES} attempts — try again or adjust your input.`;
            setBusy(false);
        } catch (e) {
            statusEl.textContent = `⚠️ ${e.message || e}`;
            setBusy(false);
        }
    }

    genBtn.addEventListener('click', () => generate());
    overlay.querySelector('#rt-ctc-regenerate').addEventListener('click', () => generate(refineEl.value.trim()));

    overlay.querySelector('#rt-ctc-back').addEventListener('click', () => {
        candidate = null;
        messages.length = 0;
        previewEl.style.display = 'none';
        setupEl.style.display = 'flex';
        setupActionsEl.style.display = 'flex';
        previewActionsEl.style.display = 'none';
        statusEl.textContent = 'Choose how to seed the campaign\'s central conflict.';
        refreshGenerateEnabled();
    });

    overlay.querySelector('#rt-ctc-commit').addEventListener('click', async () => {
        if (!candidate || busy) return;
        setBusy(true, 'Committing central tension…');
        try {
            await commitCentralTension(chatId, candidate.parsed, {
                source: candidate.input.source,
                rawInput: candidate.input.source === 'preset' ? candidate.input.categoryIds.join(',')
                    : candidate.input.source === 'origin' ? `origin:${candidate.input.originProfile?.origin || ''} (${candidate.input.originProfile?.name || ''})`
                    : candidate.input.customText,
            });
            RT.worldArcGateSkippedChats.delete(chatId);
            close();
            globalThis._rpgRefreshRenderedView?.();
            globalThis._rpgRenderWorldProgHud?.();
            globalThis._rpgRenderWorldProgTensionSummary?.();
            globalThis._rpgRefreshHudHeaderButtons?.(chatId);
        } catch (e) {
            statusEl.textContent = `❌ Commit failed: ${e.message || e}`;
            setBusy(false);
        }
    });
}

function renderCentralTensionPreview(compiled) {
    const lines = [];
    lines.push(`INTIMATE: ${compiled.intimateConflict}`);
    lines.push(`EPIC: ${compiled.epicConflict}`);
    lines.push('');
    lines.push(`MILESTONE CHAIN (${compiled.milestoneChain.length}):`);
    compiled.milestoneChain.forEach((m, i) => lines.push(`  ${i + 1}. ${m.title} — ${m.description}`));
    if (compiled.factionSeeds?.length) {
        lines.push('');
        lines.push('FACTIONS:');
        compiled.factionSeeds.forEach(f => lines.push(`  • ${f.name} (${f.posture}) — ${f.goal}`));
    }
    lines.push('');
    lines.push('CHAPTER 1 SEEDS:');
    compiled.chapter1Seeds.forEach(s => lines.push(`  • [${s.tiedTo || 'none'}] ${s.text}`));
    return lines.join('\n');
}
