/**
 * origins-wizard.js — Origins RPG Framework (Origins character creation)
 *
 * The full-screen character-creation overlay for D&D-mode Origins campaigns
 * (spec §7), modeled on central-tension-compiler.js's overlay recipe and the
 * foundation wizard's generate → validate → retry(≤3) → preview → commit
 * shape. Six steps: campaign options → race → appearance → origin → origin
 * details → review & commit.
 *
 * Draft state persists in settings.chatStates[chatId].origin.draft on every
 * change (saveSettingsDebounced), so the wizard survives reloads and the HUD
 * can offer "Resume". Commit locks the origin (chatStates[chatId].origin
 * .committed), runs the D&D stat generation through the existing
 * sendDirectPrompt channel, and writes the engine-built [ORIGIN] memo block.
 *
 * DOM module — all DOM work stays inside exported/instance functions so the
 * smoke test can import the graph with a stubbed document.
 *
 * Imports: origins-data.js, origins-engine.js, state-manager.js,
 *          llm-client.js, foundation.js (JSON extraction reuse),
 *          shared-state.js; state-pass.js / index.js at call time (dynamic,
 *          mirrors skilltree-bridge.js).
 * Imported by: index.js (dynamically, on button click).
 */

import {
    RACES, RACES_BY_ID, ORIGINS_BY_ID, GOVERNMENT_TYPES, ENVIRONMENTS,
    PURSUER_BLOCK, APPEARANCE_FIELDS, INTIMATE_FIELDS, OPENING_FRAMES,
    ORIGINS_SETTING,
} from './origins-data.js';
import {
    WIZARD_STEPS, WIZARD_STEP_LABELS, deriveWizardStep, allowedOriginsForRace,
    vibesForNsfw, modifiersForContext, emptySelections, evaluateIncompatibilities,
    optionBlockReason, validateDraft, randomizeSelections, pursuerNeeded,
    buildProfileGenerationPrompt, validateOriginProfile, buildOriginMemoBlock,
    writeOriginToMemo, buildStatGenPrompt, buildFirstMessagePrompt,
} from './origins-engine.js';
import { getSettings, getEffectiveRouterCampaignPrefix } from './state-manager.js';
import { sendAgentTurn, sendStateRequest } from './llm-client.js';
import { extractFoundationJson as extractJsonBlock } from './foundation.js';
import { writeBookToDisk } from './router.js';
import { RT } from './shared-state.js';

const MAX_GENERATION_RETRIES = 3;

let _wizardOpen = false;

// ── Lorebook canon (the spec's Consistency Ledger; commitFoundation template) ─

/**
 * Writes the committed origin's canon into `${prefix}_Origin` in one
 * writeBookToDisk call: an active, keyword-triggered Nation entry (plus the
 * secondary home nation if present), an active Pursuer entry, and a disabled
 * full-profile backup entry (prose + fenced JSON, recoverable — the
 * foundation-book pattern). Adds the book to the campaign stack.
 */
async function writeOriginCanonBook(chatId, profile) {
    const prefix = getEffectiveRouterCampaignPrefix(chatId);
    if (!prefix) throw new Error('No campaign prefix — cannot write the origin lorebook.');
    const bookName = `${prefix}_Origin`;
    let bookData = null;
    try {
        bookData = await SillyTavern.getContext().loadWorldInfo(bookName);
    } catch (_) { /* new book */ }
    if (!bookData?.entries) {
        bookData = { entries: {}, name: bookName, scan_depth: 4, token_budget: 400, recursive: false, extensions: {} };
    }
    const uids = Object.keys(bookData.entries).map(Number).filter(n => !isNaN(n));
    let nextUid = uids.length > 0 ? Math.max(...uids) + 1 : 0;
    const baseEntry = {
        keysecondary: [], constant: false, selective: false, selectiveLogic: 0,
        addMemo: true, order: 100, position: 0, probability: 100,
        useProbability: false, depth: 4, group: '', groupOverride: false, groupWeight: 100,
    };
    const addEntry = (comment, key, content, disable) => {
        bookData.entries[nextUid] = { ...baseEntry, uid: nextUid, comment, key, content, disable };
        nextUid++;
    };

    const nationText = (n) =>
        `${n.name} — ${n.government}; culture: ${n.cultureVibes}; ${n.environment}; majority population ${n.majorityRace}.\n`
        + `Viewed by outsiders: ${n.outsiderView}\nDaily life & aesthetics: ${n.tone}\n`
        + `(Canon — reuse these facts verbatim; never re-roll them.)`;
    addEntry(`Origin Nation: ${profile.nation.name}`, [profile.nation.name], nationText(profile.nation), false);
    if (profile.secondaryNation?.name) {
        addEntry(`Home Nation: ${profile.secondaryNation.name}`, [profile.secondaryNation.name], nationText(profile.secondaryNation), false);
    }
    if (profile.pursuer) {
        const p = profile.pursuer;
        addEntry(`Pursuer: ${p.identity}`, [p.identity],
            `Pursuer of ${profile.name}: ${p.identity} (${p.affiliation}). Motive: ${p.motive}. `
            + `Capability: ${p.resources}. Awareness: ${p.awareness}.${p.leverage ? ` Leverage held: ${p.leverage}` : ''}\n`
            + `Persistent NPC/faction reference — instantiated once at character creation; never regenerate or merge.`, false);
    }
    addEntry(`Origin Profile: ${profile.name}`, [profile.name, profile.origin],
        `${profile.origin} — ${profile.name}${profile.title ? `, ${profile.title}` : ''} (${profile.race}).\n\n${profile.backstory}\n\n`
        + `Social lever: ${profile.socialLever.text} (legible to: ${profile.socialLever.legibleTo})\n`
        + `Personal lever: ${profile.personalLever.text}\nWorld-threat tie-in: ${profile.worldThreatTieIn}\n`
        + `Narrator-private quest directions (surface lazily, never as a list):\n${profile.questSeeds.map(q => `- ${q}`).join('\n')}\n\n`
        + `\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\``, true);

    await writeBookToDisk(bookName, bookData);

    const s = getSettings();
    const books = new Set(s.chatStates[chatId].campaignBooks || []);
    books.add(bookName);
    s.chatStates[chatId].campaignBooks = [...books];
    SillyTavern.getContext().saveSettingsDebounced();
}

// ── Opening narration (spec §8) ──────────────────────────────────────────────

/** Generates the opening narration — narrator connection first, state model
 *  as fallback (prose quality matters; the state model always works). */
async function generateOpeningNarration(profile, frameId, nsfw) {
    const ctx = SillyTavern.getContext();
    const prompt = buildFirstMessagePrompt(profile, frameId, nsfw);
    if (typeof ctx.generateRaw === 'function') {
        try {
            const result = await ctx.generateRaw({ prompt, systemPrompt: '', bypassAll: true });
            const text = typeof result === 'string' ? result : result?.choices?.[0]?.message?.content ?? '';
            if (text.trim()) return text.trim();
        } catch (e) {
            console.warn('[RPG Tracker] Narrator opening generation failed, falling back to the state model:', e);
        }
    }
    const text = await sendStateRequest(getSettings(), 'You are the narrator of a fantasy roleplay campaign. Follow the instructions exactly and output only prose.', prompt, null);
    return String(text || '').trim();
}

/**
 * Inserts the opening as the first ASSISTANT message of the chat. No repo
 * precedent exists for this (sendSystemMessage produces system messages), so
 * it feature-detects the context API and fails soft to a system message.
 * @returns {boolean} whether the text made it into the chat in any form
 */
async function insertOpeningMessage(text) {
    const ctx = SillyTavern.getContext();
    try {
        const name = ctx.characters?.[ctx.characterId]?.name || ctx.name2 || 'Narrator';
        const message = {
            name, is_user: false, is_system: false,
            send_date: new Date().toLocaleString(),
            mes: text,
            extra: { api: 'manual', model: 'origins-opening' },
        };
        ctx.chat.push(message);
        if (typeof ctx.addOneMessage === 'function') await ctx.addOneMessage(message);
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
        return true;
    } catch (e) {
        console.warn('[RPG Tracker] Could not insert the opening as an assistant message:', e);
        try {
            SillyTavern.getContext().sendSystemMessage?.('generic', text);
            return true;
        } catch (_) {
            return false;
        }
    }
}

// ── Draft persistence ────────────────────────────────────────────────────────

function chatStateFor(chatId) {
    const s = getSettings();
    if (!s.chatStates) s.chatStates = {};
    if (!s.chatStates[chatId]) s.chatStates[chatId] = {};
    return s.chatStates[chatId];
}

/** The persisted origin slot for a chat: { draft?, committed?, nsfw? }. */
export function getOriginState(chatId) {
    return getSettings().chatStates?.[chatId]?.origin || null;
}

function freshDraft() {
    return {
        step: 'options', nsfw: false, level: 1, frameId: 'quiet_start',
        raceId: null, appearance: {}, originId: null,
        selections: emptySelections(), profile: null,
    };
}

// ── Small helpers ────────────────────────────────────────────────────────────

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CARD_BTN = 'text-align:left;display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);cursor:pointer;color:inherit;font:inherit;width:100%;';
const CARD_BTN_ACTIVE = 'border-color:var(--rt-accent,#00c88c);background:rgba(0,200,140,0.12);';
const FIELD_LABEL = 'font-size:0.8em;font-weight:bold;opacity:0.85;margin:8px 0 2px;';
const HINT = 'font-size:0.72em;opacity:0.55;font-style:italic;';
const SELECT_STYLE = 'width:100%;padding:4px 6px;border-radius:4px;background:var(--black70a, rgba(0,0,0,0.6));color:inherit;border:1px solid rgba(255,255,255,0.2);';

// ── Wizard ───────────────────────────────────────────────────────────────────

/** Opens the Origins creation wizard for the current chat. No-op if open. */
export function openOriginsWizard() {
    if (_wizardOpen) return;
    const ctx = SillyTavern.getContext();
    const chatId = ctx.chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null);
    if (!chatId) {
        toastr['warning']('Open a chat first — the origin is stored per campaign.', 'Origins');
        return;
    }
    const st = chatStateFor(chatId);
    if (st.origin?.committed) {
        toastr['info']('This campaign already has a committed origin — origin choices lock at commit.', 'Origins');
        return;
    }
    if (!st.origin) st.origin = {};
    if (!st.origin.draft) st.origin.draft = freshDraft();
    const draft = st.origin.draft;

    _wizardOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'rt-og-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div id="rt-og-modal" style="width:min(860px,96vw);height:min(680px,92vh);display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor, #1a1a2a);border:1px solid var(--rt-accent-dim, rgba(255,255,255,0.2));border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <div style="font-weight:bold;color:var(--rt-accent,#00c88c);">🧬 Origins — Create Your Character <span style="opacity:0.6;font-weight:normal;">(${esc(ORIGINS_SETTING.name)})</span></div>
                <button id="rt-og-close" class="menu_button interactable" style="padding:2px 10px;">✕</button>
            </div>
            <div id="rt-og-status" style="padding:4px 14px;font-size:0.8em;opacity:0.75;flex-shrink:0;min-height:18px;">Your progress saves automatically — close and resume any time.</div>
            <div style="flex:1;display:flex;min-height:0;">
                <div id="rt-og-rail" style="width:172px;flex-shrink:0;border-right:1px solid rgba(255,255,255,0.1);padding:10px 8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;"></div>
                <div id="rt-og-content" style="flex:1;overflow-y:auto;padding:12px 16px;"></div>
            </div>
            <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <button id="rt-og-forge" class="menu_button interactable" title="Randomize everything and jump straight to review — a full character in one click.">⚒️ Forge me a character</button>
                <div style="flex:1;"></div>
                <button id="rt-og-prev" class="menu_button interactable">← Back</button>
                <button id="rt-og-next" class="menu_button interactable" style="background:rgba(0,200,140,0.18);border-color:#00c88c;">Next →</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('#rt-og-status');
    const railEl = overlay.querySelector('#rt-og-rail');
    const contentEl = overlay.querySelector('#rt-og-content');
    const prevBtn = overlay.querySelector('#rt-og-prev');
    const nextBtn = overlay.querySelector('#rt-og-next');
    const forgeBtn = overlay.querySelector('#rt-og-forge');

    let busy = false;

    const close = () => { _wizardOpen = false; overlay.remove(); globalThis._rpgRefreshRenderedView?.(); };
    overlay.querySelector('#rt-og-close').addEventListener('click', close);

    const save = () => { SillyTavern.getContext().saveSettingsDebounced(); };
    const setStatus = (msg) => { statusEl.textContent = msg; };
    const setBusy = (b, label = '') => {
        busy = b;
        forgeBtn.disabled = b;
        prevBtn.disabled = b;
        nextBtn.disabled = b;
        contentEl.style.opacity = b ? '0.55' : '1';
        contentEl.style.pointerEvents = b ? 'none' : 'auto';
        if (label) setStatus(label);
    };

    // ── Step navigation ──────────────────────────────────────────────────────

    function currentStep() { return deriveWizardStep(draft); }

    function goTo(stepId) {
        draft.step = stepId;
        save();
        render();
    }

    function stepReachable(stepId) {
        const clamped = deriveWizardStep({ ...draft, step: stepId });
        return clamped === stepId;
    }

    function renderRail() {
        const cur = currentStep();
        railEl.innerHTML = WIZARD_STEPS.map((id, i) => {
            const reachable = stepReachable(id);
            const active = id === cur;
            return `<button class="rt-og-rail-btn" data-step="${id}" ${reachable ? '' : 'disabled'} style="text-align:left;padding:6px 8px;border-radius:6px;border:1px solid ${active ? 'var(--rt-accent,#00c88c)' : 'transparent'};background:${active ? 'rgba(0,200,140,0.12)' : 'transparent'};color:inherit;font:inherit;font-size:0.82em;cursor:${reachable ? 'pointer' : 'default'};opacity:${reachable ? 1 : 0.4};">${i + 1}. ${esc(WIZARD_STEP_LABELS[id])}</button>`;
        }).join('');
        railEl.querySelectorAll('.rt-og-rail-btn').forEach(btn => {
            btn.addEventListener('click', () => { if (!busy) goTo(btn.dataset.step); });
        });
    }

    // ── Step renderers ───────────────────────────────────────────────────────

    function renderOptionsStep() {
        contentEl.innerHTML = `
            <div style="font-size:0.9em;line-height:1.45;opacity:0.9;">Origins builds a fully-realized character — race, appearance, and a BG3-style origin with real mechanical hooks: a <b>social lever</b> NPCs react to and a <b>personal lever</b> that pressures you over time. Everything feeds the tracker, the narrator, and your campaign's world threat.</div>
            <div style="${FIELD_LABEL}">Starting level</div>
            <select id="rt-og-level" class="text_pole" style="${SELECT_STYLE}max-width:140px;">
                ${[...Array(20).keys()].map(i => `<option value="${i + 1}"${draft.level === i + 1 ? ' selected' : ''}>Level ${i + 1}</option>`).join('')}
            </select>
            <div style="${FIELD_LABEL}">Mature content</div>
            <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:0.85em;">
                <input type="checkbox" id="rt-og-nsfw"${draft.nsfw ? ' checked' : ''} style="margin-top:2px;">
                <span>Enable NSFW content for this campaign.<br><span style="${HINT}">Reveals the optional Intimate Physical Details section and mature worldbuilding choices — each stays an individual opt-in, all off by default. Leave unchecked for a fully SFW campaign.</span></span>
            </label>
            <div style="margin-top:14px;${HINT}">Setting: ${esc(ORIGINS_SETTING.name)} — ${esc(ORIGINS_SETTING.blurb)}</div>`;
        contentEl.querySelector('#rt-og-level').addEventListener('change', e => { draft.level = Number(e.target.value) || 1; save(); });
        contentEl.querySelector('#rt-og-nsfw').addEventListener('change', e => {
            draft.nsfw = !!e.target.checked;
            // Turning NSFW off must drop any gated selections (spec §9).
            if (!draft.nsfw && draft.selections) {
                const origin = ORIGINS_BY_ID[draft.originId];
                for (const m of origin?.modifiers || []) if (m.nsfw) delete draft.selections.modifiers[m.id];
                const sfwIds = new Set(vibesForNsfw(false).map(v => v.id));
                draft.selections.vibes = (draft.selections.vibes || []).filter(v => sfwIds.has(v));
                if (draft.appearance) delete draft.appearance.intimate;
            }
            save();
        });
    }

    function renderRaceStep() {
        contentEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.9em;opacity:0.85;">Choose your race. The pick shapes your nation's defaults, appearance ranges, and which origins are open to you.</div>
                <button id="rt-og-race-random" class="menu_button interactable" style="flex-shrink:0;">🎲 Random</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
                ${RACES.map(r => `
                <button class="rt-og-race-btn" data-race="${r.id}" style="${CARD_BTN}${draft.raceId === r.id ? CARD_BTN_ACTIVE : ''}">
                    <span style="font-size:1.4em;flex-shrink:0;">${r.emoji}</span>
                    <span><b>${esc(r.name)}</b>${r.id === 'vampire' ? ' <span style="font-size:0.72em;opacity:0.7;">(Vampire Lord / Exiled Royal only)</span>' : ''}<br><span style="font-size:0.78em;opacity:0.7;">${esc(r.summary)}</span></span>
                </button>`).join('')}
            </div>`;
        const pickRace = (raceId) => {
            draft.raceId = raceId;
            if (draft.originId && !allowedOriginsForRace(raceId).some(o => o.id === draft.originId)) {
                draft.originId = null;
                draft.selections = emptySelections();
                draft.profile = null;
                setStatus(`${RACES_BY_ID[raceId].name} cannot take the previously selected origin — origin cleared.`);
            }
            save();
            render();
        };
        contentEl.querySelectorAll('.rt-og-race-btn').forEach(btn => btn.addEventListener('click', () => pickRace(btn.dataset.race)));
        contentEl.querySelector('#rt-og-race-random').addEventListener('click', () => {
            const living = RACES.filter(r => r.living);
            pickRace(living[Math.floor(Math.random() * living.length)].id);
        });
    }

    function renderAppearanceStep() {
        const race = RACES_BY_ID[draft.raceId];
        const app = draft.appearance || (draft.appearance = {});
        const intimate = app.intimate || {};
        contentEl.innerHTML = `
            <div style="font-size:0.9em;opacity:0.85;">Describe your character. Every field is optional — anything left empty is the narrator's to improvise.</div>
            <div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:0.75em;opacity:0.7;">${esc(race?.name)} range: ${esc(race?.appearance)}</div>
            ${APPEARANCE_FIELDS.map(f => `
                <div style="${FIELD_LABEL}">${esc(f.label)}</div>
                <input type="text" class="text_pole rt-og-app-field" data-field="${f.id}" value="${esc(app[f.id] || '')}" placeholder="${esc(f.hint)}" style="width:100%;">
            `).join('')}
            ${draft.nsfw ? `
            <details style="margin-top:14px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:8px;">
                <summary style="cursor:pointer;font-size:0.85em;font-weight:bold;opacity:0.85;">Intimate Physical Details (optional — NSFW)</summary>
                <div style="${HINT}margin-top:4px;">Fill in only what's relevant to the scenarios you plan to run — stated details keep the narrator from improvising anatomy. Skip freely.</div>
                ${INTIMATE_FIELDS.map(f => `
                    <div style="${FIELD_LABEL}">${esc(f.label)}</div>
                    <input type="text" class="text_pole rt-og-int-field" data-field="${f.id}" value="${esc(intimate[f.id] || '')}" placeholder="${esc(f.hint)}" style="width:100%;">
                `).join('')}
            </details>` : ''}`;
        contentEl.querySelectorAll('.rt-og-app-field').forEach(input => {
            input.addEventListener('input', () => { app[input.dataset.field] = input.value; save(); });
        });
        contentEl.querySelectorAll('.rt-og-int-field').forEach(input => {
            input.addEventListener('input', () => {
                if (!app.intimate) app.intimate = {};
                app.intimate[input.dataset.field] = input.value;
                save();
            });
        });
    }

    function renderOriginStep() {
        const allowed = allowedOriginsForRace(draft.raceId);
        contentEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.9em;opacity:0.85;">Choose your origin — who you were, and the two levers that keep it alive in play.</div>
                <button id="rt-og-origin-random" class="menu_button interactable" style="flex-shrink:0;">🎲 Random</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
                ${allowed.map(o => `
                <button class="rt-og-origin-btn" data-origin="${o.id}" style="${CARD_BTN}${draft.originId === o.id ? CARD_BTN_ACTIVE : ''}">
                    <span style="font-size:1.4em;flex-shrink:0;">${o.emoji}</span>
                    <span><b>${esc(o.name)}</b><br>
                        <span style="font-size:0.78em;opacity:0.75;">${esc(o.pitch)}</span><br>
                        <span style="font-size:0.72em;opacity:0.6;">👁 ${esc(o.leverSocial)}<br>⏳ ${esc(o.leverPersonal)}</span>
                    </span>
                </button>`).join('')}
            </div>`;
        const pickOrigin = (originId) => {
            if (draft.originId !== originId) {
                draft.originId = originId;
                draft.selections = emptySelections();
                draft.profile = null;
                const origin = ORIGINS_BY_ID[originId];
                const race = RACES_BY_ID[draft.raceId];
                draft.selections.nation.majorityRaceId = originId === 'vampire_lord' ? 'vampire' : draft.raceId;
                draft.selections.nation.environmentId = race?.environmentId || '';
                if (pursuerNeeded(origin, draft.selections)) {
                    draft.selections.pursuer = { identity: '', affiliation: '', motive: '', resources: '', awareness: '', leverage: '' };
                }
            }
            save();
            render();
        };
        contentEl.querySelectorAll('.rt-og-origin-btn').forEach(btn => btn.addEventListener('click', () => pickOrigin(btn.dataset.origin)));
        contentEl.querySelector('#rt-og-origin-random').addEventListener('click', () => {
            pickOrigin(allowed[Math.floor(Math.random() * allowed.length)].id);
        });
    }

    function renderDetailStep() {
        const origin = ORIGINS_BY_ID[draft.originId];
        const sel = draft.selections;
        const mods = modifiersForContext(origin, { raceId: draft.raceId, nsfw: draft.nsfw });
        const needsPursuer = pursuerNeeded(origin, sel);
        if (needsPursuer && !sel.pursuer) sel.pursuer = { identity: '', affiliation: '', motive: '', resources: '', awareness: '', leverage: '' };
        if (!needsPursuer && origin.pursuer !== 'optional' && origin.pursuer !== 'conditional') sel.pursuer = sel.pursuer || null;

        const rules = evaluateIncompatibilities(origin, sel);
        const softOpen = rules.filter(r => r.level === 'soft');
        const hardSub = rules.filter(r => r.level === 'hard').map(r => (origin.incompatibilities || []).find(x => x.id === r.id)).filter(x => x?.substituteLever);
        const vibes = vibesForNsfw(draft.nsfw);

        contentEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.9em;opacity:0.85;"><b>${origin.emoji} ${esc(origin.name)}</b> — set the shape; anything left blank, the AI proposes at review.</div>
                <button id="rt-og-detail-random" class="menu_button interactable" style="flex-shrink:0;">🎲 Randomize</button>
            </div>

            <div style="margin-top:10px;font-weight:bold;font-size:0.85em;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:2px;">Origin choices</div>
            ${mods.map(m => {
                const blockedNote = (optId) => optionBlockReason(origin, sel, m.id, optId);
                return `
                <div style="${FIELD_LABEL}">${esc(m.label)}${m.optional ? ' <span style="opacity:0.5;font-weight:normal;">(optional)</span>' : ''}${m.nsfw ? ' <span style="opacity:0.6;">🔞</span>' : ''}</div>
                ${m.note ? `<div style="${HINT}">${esc(m.note)}</div>` : ''}
                <select class="text_pole rt-og-mod" data-mod="${m.id}" style="${SELECT_STYLE}">
                    <option value="">${m.optional ? '— off —' : '— choose —'}</option>
                    ${m.options.map(o => {
                        const reason = sel.modifiers[m.id] === o.id ? null : blockedNote(o.id);
                        return `<option value="${o.id}"${sel.modifiers[m.id] === o.id ? ' selected' : ''}${reason ? ` disabled title="${esc(reason)}"` : ''}>${esc(o.label)}${reason ? ' 🚫' : ''}</option>`;
                    }).join('')}
                </select>`;
            }).join('')}

            <div style="margin-top:8px;font-weight:bold;font-size:0.85em;">Story blanks <span style="opacity:0.5;font-weight:normal;">(leave empty → the AI proposes)</span></div>
            ${origin.blanks.map(b => `
                <div style="${FIELD_LABEL}">${esc(b.label)}</div>
                <textarea class="text_pole rt-og-blank" data-blank="${b.id}" rows="2" placeholder="${esc(b.hint)}" style="width:100%;">${esc(sel.blanks[b.id] || '')}</textarea>
            `).join('')}

            <div style="margin-top:14px;font-weight:bold;font-size:0.85em;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:2px;">Nation — ${esc(origin.nationMeaning)}</div>
            <div style="${FIELD_LABEL}">Nation name <span style="opacity:0.5;font-weight:normal;">(empty → AI proposes)</span></div>
            <input type="text" id="rt-og-nation-name" class="text_pole" value="${esc(sel.nation.name || '')}" style="width:100%;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                <div><div style="${FIELD_LABEL}">Majority race</div>
                <select id="rt-og-nation-race" class="text_pole" style="${SELECT_STYLE}">${RACES.map(r => `<option value="${r.id}"${sel.nation.majorityRaceId === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
                <div><div style="${FIELD_LABEL}">Government</div>
                <select id="rt-og-nation-gov" class="text_pole" style="${SELECT_STYLE}"><option value="">— choose —</option>${GOVERNMENT_TYPES.map(g => `<option value="${g.id}"${sel.nation.governmentId === g.id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select></div>
                <div><div style="${FIELD_LABEL}">Environment</div>
                <select id="rt-og-nation-env" class="text_pole" style="${SELECT_STYLE}"><option value="">— choose —</option>${ENVIRONMENTS.map(e => `<option value="${e.id}"${sel.nation.environmentId === e.id ? ' selected' : ''}>${esc(e.label)}</option>`).join('')}</select></div>
            </div>
            <div style="${FIELD_LABEL}">Culture vibes (pick 1–2)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                ${vibes.map(v => `
                <label style="display:flex;gap:6px;align-items:flex-start;font-size:0.8em;padding:3px 5px;border-radius:4px;background:rgba(255,255,255,0.04);cursor:pointer;">
                    <input type="checkbox" class="rt-og-vibe" value="${v.id}"${sel.vibes.includes(v.id) ? ' checked' : ''} style="margin-top:2px;">
                    <span><b>${esc(v.label)}</b>${v.nsfw ? ' 🔞' : ''}<br><span style="opacity:0.65;">${esc(v.summary)}</span></span>
                </label>`).join('')}
            </div>
            <div id="rt-og-vibe-sub-wrap" style="display:${sel.vibes.includes('death') ? 'block' : 'none'};">
                <div style="${FIELD_LABEL}">Death-focused sub-option (required)</div>
                <select id="rt-og-vibe-sub" class="text_pole" style="${SELECT_STYLE}max-width:340px;">
                    <option value="">— choose —</option>
                    <option value="reverence"${sel.vibeSub === 'reverence' ? ' selected' : ''}>Reverence for the dead</option>
                    <option value="bringing_death"${sel.vibeSub === 'bringing_death' ? ' selected' : ''}>Embrace of bringing death</option>
                </select>
            </div>

            ${needsPursuer || sel.pursuer ? `
            <div style="margin-top:14px;font-weight:bold;font-size:0.85em;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:2px;">Pursuer — ${esc(origin.pursuerNote)}</div>
            <div style="${FIELD_LABEL}">Identity <span style="opacity:0.5;font-weight:normal;">(empty → AI proposes)</span></div>
            <input type="text" id="rt-og-pursuer-identity" class="text_pole" value="${esc(sel.pursuer?.identity || '')}" style="width:100%;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                ${[['affiliation', 'Affiliation', PURSUER_BLOCK.affiliations], ['motive', 'Motive', PURSUER_BLOCK.motives], ['resources', 'Capability vs you', PURSUER_BLOCK.resources], ['awareness', 'Current awareness', PURSUER_BLOCK.awareness]].map(([field, label, opts]) => `
                <div><div style="${FIELD_LABEL}">${label}</div>
                <select class="text_pole rt-og-pursuer" data-field="${field}" style="${SELECT_STYLE}"><option value="">— choose —</option>${opts.map(o => `<option value="${o.id}"${sel.pursuer?.[field] === o.id ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`).join('')}
            </div>
            <div style="${FIELD_LABEL}">Leverage — what they hold over you${origin.id === 'exiled_royal' || origin.id === 'defector_spy' ? ' <span style="color:#ffaa00;font-weight:normal;">(mandatory for this origin)</span>' : ' <span style="opacity:0.5;font-weight:normal;">(optional but preferred; empty → AI proposes)</span>'}</div>
            <textarea id="rt-og-pursuer-leverage" class="text_pole" rows="2" style="width:100%;" placeholder="A hostage, blackmail material, a person you still care about, a secret that would ruin you…">${esc(sel.pursuer?.leverage || '')}</textarea>
            ` : ''}

            ${hardSub.length ? hardSub.map(rule => `
            <div style="margin-top:12px;padding:8px;border:1px solid #ffaa00;border-radius:6px;font-size:0.82em;">
                ⚠️ ${esc(rule.message)}<br>
                <label style="display:flex;gap:6px;margin-top:6px;cursor:pointer;">
                    <input type="checkbox" class="rt-og-sub-lever" data-lever="${rule.substituteLever}"${sel.substituteLever === rule.substituteLever ? ' checked' : ''}>
                    <span>Accept the substitute lever</span>
                </label>
            </div>`).join('') : ''}

            ${softOpen.length ? `
            <div style="margin-top:12px;font-weight:bold;font-size:0.85em;">Tensions to explain <span style="opacity:0.5;font-weight:normal;">(your picks conflict interestingly — say how both are true)</span></div>
            ${softOpen.map(r => `
                <div style="margin-top:6px;padding:8px;border:1px solid rgba(255,170,0,0.5);border-radius:6px;font-size:0.82em;">
                    ${esc(r.message)}
                    <textarea class="text_pole rt-og-explain" data-rule="${r.id}" rows="2" style="width:100%;margin-top:4px;" placeholder="Explain how both are true…">${esc(sel.explanations[r.id] || '')}</textarea>
                </div>`).join('')}` : ''}

            <div id="rt-og-detail-errors" style="margin-top:12px;"></div>`;

        const rerender = () => { save(); render(); };
        contentEl.querySelectorAll('.rt-og-mod').forEach(el => el.addEventListener('change', () => {
            if (el.value) sel.modifiers[el.dataset.mod] = el.value; else delete sel.modifiers[el.dataset.mod];
            // Pursuer need may flip (claimants / slumber_reason / replacement).
            if (pursuerNeeded(origin, sel) && !sel.pursuer) sel.pursuer = { identity: '', affiliation: '', motive: '', resources: '', awareness: '', leverage: '' };
            if (!pursuerNeeded(origin, sel) && origin.pursuer !== 'required') sel.pursuer = null;
            draft.profile = null;
            rerender();
        }));
        contentEl.querySelectorAll('.rt-og-blank').forEach(el => el.addEventListener('input', () => { sel.blanks[el.dataset.blank] = el.value; save(); }));
        contentEl.querySelector('#rt-og-nation-name')?.addEventListener('input', e => { sel.nation.name = e.target.value; save(); });
        contentEl.querySelector('#rt-og-nation-race')?.addEventListener('change', e => { sel.nation.majorityRaceId = e.target.value; save(); });
        contentEl.querySelector('#rt-og-nation-gov')?.addEventListener('change', e => { sel.nation.governmentId = e.target.value; save(); });
        contentEl.querySelector('#rt-og-nation-env')?.addEventListener('change', e => { sel.nation.environmentId = e.target.value; save(); });
        contentEl.querySelectorAll('.rt-og-vibe').forEach(el => el.addEventListener('change', () => {
            const checked = [...contentEl.querySelectorAll('.rt-og-vibe:checked')].map(x => x.value);
            if (checked.length > 2) { el.checked = false; setStatus('Pick at most 2 culture vibes.'); return; }
            sel.vibes = checked;
            if (!sel.vibes.includes('death')) sel.vibeSub = null;
            draft.profile = null;
            rerender();
        }));
        contentEl.querySelector('#rt-og-vibe-sub')?.addEventListener('change', e => { sel.vibeSub = e.target.value || null; save(); });
        contentEl.querySelector('#rt-og-pursuer-identity')?.addEventListener('input', e => { if (sel.pursuer) { sel.pursuer.identity = e.target.value; save(); } });
        contentEl.querySelectorAll('.rt-og-pursuer').forEach(el => el.addEventListener('change', () => { if (sel.pursuer) { sel.pursuer[el.dataset.field] = el.value; draft.profile = null; rerender(); } }));
        contentEl.querySelector('#rt-og-pursuer-leverage')?.addEventListener('input', e => { if (sel.pursuer) { sel.pursuer.leverage = e.target.value; save(); } });
        contentEl.querySelectorAll('.rt-og-sub-lever').forEach(el => el.addEventListener('change', () => {
            sel.substituteLever = el.checked ? el.dataset.lever : null;
            rerender();
        }));
        contentEl.querySelectorAll('.rt-og-explain').forEach(el => el.addEventListener('input', () => { sel.explanations[el.dataset.rule] = el.value; save(); }));
        contentEl.querySelector('#rt-og-detail-random')?.addEventListener('click', () => {
            const keepBlanks = sel.blanks, keepName = sel.nation.name;
            draft.selections = randomizeSelections(origin, draft.raceId, draft.nsfw);
            draft.selections.blanks = keepBlanks;
            draft.selections.nation.name = keepName;
            draft.profile = null;
            rerender();
        });
    }

    function renderReviewStep() {
        const origin = ORIGINS_BY_ID[draft.originId];
        const { ok, errors } = validateDraft(draft);
        const p = draft.profile;
        contentEl.innerHTML = `
            ${!ok ? `<div style="padding:8px;border:1px solid #ff5555;border-radius:6px;font-size:0.82em;"><b>Fix before generating:</b><ul style="margin:4px 0 0 16px;">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
            ${!p ? `
            <div style="margin-top:10px;text-align:center;">
                <div style="font-size:0.9em;opacity:0.85;margin-bottom:10px;">The compiler fills every blank you left open and weaves the full profile — backstory, levers, nation canon, and the narrator's private quest directions. You can edit everything before committing.</div>
                <button id="rt-og-generate" class="menu_button interactable" style="background:rgba(0,200,140,0.18);border-color:#00c88c;padding:8px 18px;"${ok ? '' : ' disabled'}>⚒️ Generate Origin Profile</button>
            </div>` : `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-weight:bold;">${origin.emoji} ${esc(p.name)}${p.title ? ` — ${esc(p.title)}` : ''} <span style="opacity:0.6;font-weight:normal;">(${esc(p.race)}, ${esc(p.origin)}, Level ${draft.level})</span></div>
                <button id="rt-og-regenerate" class="menu_button interactable">↺ Regenerate</button>
            </div>
            ${[
                ['name', 'Name', 1], ['title', 'Title', 1], ['backstory', 'Backstory', 6],
                ['appearanceNotes', 'Origin-relevant physical traits', 2],
                ['currentGoal', 'Current goal', 2], ['personalityVoice', 'Personality & voice', 2],
                ['worldThreatTieIn', 'World-threat tie-in', 2],
            ].map(([key, label, rows]) => `
                <div style="${FIELD_LABEL}">${label}</div>
                <textarea class="text_pole rt-og-prof" data-key="${key}" rows="${rows}" style="width:100%;">${esc(p[key] || '')}</textarea>
            `).join('')}
            <div style="${FIELD_LABEL}">Social lever</div>
            <textarea class="text_pole rt-og-prof-lever" data-path="socialLever.text" rows="2" style="width:100%;">${esc(p.socialLever?.text || '')}</textarea>
            <div style="${HINT}">Legible to:</div>
            <input type="text" class="text_pole rt-og-prof-lever" data-path="socialLever.legibleTo" value="${esc(p.socialLever?.legibleTo || '')}" style="width:100%;">
            <div style="${FIELD_LABEL}">Personal lever</div>
            <textarea class="text_pole rt-og-prof-lever" data-path="personalLever.text" rows="2" style="width:100%;">${esc(p.personalLever?.text || '')}</textarea>
            <div style="${FIELD_LABEL}">Nation — ${esc(p.nation?.name || '')}</div>
            <div style="font-size:0.78em;opacity:0.75;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:6px;">${esc(p.nation?.government || '')} · ${esc(p.nation?.cultureVibes || '')} · ${esc(p.nation?.environment || '')} · majority ${esc(p.nation?.majorityRace || '')}<br>${esc(p.nation?.outsiderView || '')}<br>${esc(p.nation?.tone || '')}</div>
            ${p.pursuer ? `<div style="${FIELD_LABEL}">Pursuer — ${esc(p.pursuer.identity)}</div>
            <div style="font-size:0.78em;opacity:0.75;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:6px;">${esc(p.pursuer.affiliation)} · motive: ${esc(p.pursuer.motive)} · ${esc(p.pursuer.resources)} · ${esc(p.pursuer.awareness)}${p.pursuer.leverage ? `<br>Leverage: ${esc(p.pursuer.leverage)}` : ''}</div>` : ''}
            <div style="${FIELD_LABEL}">Opening frame</div>
            ${OPENING_FRAMES.map(f => `
                <label style="display:flex;gap:6px;font-size:0.82em;cursor:pointer;margin-top:2px;">
                    <input type="radio" name="rt-og-frame" value="${f.id}"${draft.frameId === f.id ? ' checked' : ''}>
                    <span><b>${esc(f.label)}</b> — ${esc(f.description)}</span>
                </label>`).join('')}
            <div style="margin-top:14px;display:flex;justify-content:flex-end;">
                <button id="rt-og-commit" class="menu_button interactable" style="background:rgba(0,200,140,0.25);border-color:#00c88c;padding:8px 18px;">✅ Commit — lock origin &amp; start</button>
            </div>
            <div style="${HINT}margin-top:4px;text-align:right;">Committing locks these choices for the campaign, builds your character sheet, and generates the opening scene.</div>
            `}`;
        contentEl.querySelector('#rt-og-generate')?.addEventListener('click', () => generateProfile(false));
        contentEl.querySelector('#rt-og-regenerate')?.addEventListener('click', () => generateProfile(true));
        contentEl.querySelectorAll('.rt-og-prof').forEach(el => el.addEventListener('input', () => { p[el.dataset.key] = el.value; save(); }));
        contentEl.querySelectorAll('.rt-og-prof-lever').forEach(el => el.addEventListener('input', () => {
            const [obj, key] = el.dataset.path.split('.');
            if (p[obj]) { p[obj][key] = el.value; save(); }
        }));
        contentEl.querySelectorAll('input[name="rt-og-frame"]').forEach(el => el.addEventListener('change', () => { draft.frameId = el.value; save(); }));
        contentEl.querySelector('#rt-og-commit')?.addEventListener('click', () => commit());
    }

    // ── Generation & commit ──────────────────────────────────────────────────

    /** @type {Array<{role: string, content: string}>} */
    let genMessages = [];

    async function generateProfile(isRegenerate) {
        if (busy) return;
        const origin = ORIGINS_BY_ID[draft.originId];
        const { ok, errors } = validateDraft(draft);
        if (!ok) { setStatus(`Fix first: ${errors[0]}`); return; }
        setBusy(true, 'Compiling origin profile…');
        try {
            if (!isRegenerate || genMessages.length === 0) {
                genMessages = buildProfileGenerationPrompt(draft, origin);
            } else {
                genMessages.push({ role: 'user', content: 'Regenerate the profile with fresh ideas where the player left blanks, keeping every explicit player selection identical. Output the corrected complete JSON again, one fenced block.' });
            }
            for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
                setBusy(true, `Compiling origin profile (attempt ${attempt}/${MAX_GENERATION_RETRIES})…`);
                const { content } = await sendAgentTurn(getSettings(), genMessages, null, null);
                genMessages.push({ role: 'assistant', content });
                const parsed = extractJsonBlock(content);
                if (!parsed) {
                    genMessages.push({ role: 'user', content: 'Your reply contained no parseable ```json block. Output ONLY the origin profile JSON in one fenced block.' });
                    continue;
                }
                const check = validateOriginProfile(parsed, origin);
                if (!check.ok) {
                    genMessages.push({ role: 'user', content: `The profile failed validation. Fix EVERY issue and output the corrected complete JSON again:\n- ${check.errors.join('\n- ')}` });
                    continue;
                }
                draft.profile = parsed;
                save();
                setBusy(false, 'Profile ready — review, edit anything, then commit.');
                render();
                return;
            }
            setBusy(false, `Could not produce a valid profile in ${MAX_GENERATION_RETRIES} attempts — try again.`);
        } catch (e) {
            setBusy(false, `⚠️ ${e.message || e}`);
        }
    }

    /** Post-commit opening-narration state: generated text awaits the player's
     *  accept (or regenerate) before being inserted into the chat. */
    let opening = { profile: null, text: '', error: '' };

    async function commit() {
        if (busy) return;
        const origin = ORIGINS_BY_ID[draft.originId];
        const draftCheck = validateDraft(draft);
        const profCheck = validateOriginProfile(draft.profile, origin);
        if (!draftCheck.ok || !profCheck.ok) {
            setStatus(`Fix first: ${[...draftCheck.errors, ...profCheck.errors][0]}`);
            return;
        }
        if (RT.stateModelRunning) {
            setStatus('State Model is busy — try committing again in a moment.');
            return;
        }
        setBusy(true, 'Locking origin & building your character sheet…');
        try {
            const s = getSettings();
            const st = chatStateFor(chatId);
            const profile = draft.profile;
            const frameId = draft.frameId;
            const nsfw = !!draft.nsfw;
            st.origin = {
                committed: {
                    ...profile,
                    committedAt: new Date().toISOString(),
                    raceId: draft.raceId, originId: draft.originId,
                    level: draft.level, frameId: draft.frameId,
                    appearance: JSON.parse(JSON.stringify(draft.appearance || {})),
                    selections: JSON.parse(JSON.stringify(draft.selections)),
                },
                nsfw,
            };
            delete st.onboarding; // the committed origin drives readiness from here
            SillyTavern.getContext().saveSettingsDebounced();

            // Character sheet via the existing direct-prompt channel.
            setBusy(true, 'Generating your character sheet (stats, gear, abilities)…');
            const { sendDirectPrompt } = await import('./state-pass.js');
            await sendDirectPrompt(buildStatGenPrompt(profile, origin, draft.level));

            // Deterministic [ORIGIN] block — engine-written, never model-emitted.
            s.modules.origin = true;
            s.currentMemo = writeOriginToMemo(s.currentMemo, buildOriginMemoBlock(profile, origin));
            const idx = await import('./index.js');
            idx.saveSettings();
            idx.syncMemoView();

            // Lorebook canon — non-blocking, like the tension compiler's
            // faction seeding: a lorebook failure must not lose the commit.
            setBusy(true, 'Writing nation & pursuer canon to the lorebook…');
            try {
                await writeOriginCanonBook(chatId, profile);
            } catch (e) {
                console.warn('[RPG Tracker] Origin lorebook write failed:', e);
                toastr['warning'](`Origin canon lorebook could not be written (${e.message || e}) — the profile is still saved in the tracker.`, 'Origins');
            }

            globalThis._rpgRefreshHudHeaderButtons?.(chatId);
            toastr['success'](`${profile.name} is ready. The origin is locked for this campaign.`, 'Origins');

            // Hand off to the opening-narration pane (regenerate before insert).
            opening = { profile, frameId, nsfw, text: '', error: '' };
            renderOpeningPane();
            await generateOpening();
        } catch (e) {
            setBusy(false, `❌ Commit failed: ${e.message || e} — click Commit again to resume.`);
        }
    }

    // ── Opening pane (spec §8: generate → review/regenerate → insert) ────────

    async function generateOpening() {
        setBusy(true, 'Writing your opening scene…');
        try {
            opening.text = await generateOpeningNarration(opening.profile, opening.frameId, opening.nsfw);
            opening.error = opening.text ? '' : 'The narrator returned an empty opening.';
        } catch (e) {
            opening.error = `${e.message || e}`;
        }
        setBusy(false, opening.error ? `⚠️ ${opening.error}` : 'Review your opening — regenerate freely, then begin.');
        renderOpeningPane();
    }

    function renderOpeningPane() {
        railEl.innerHTML = '';
        forgeBtn.style.display = 'none';
        prevBtn.style.visibility = 'hidden';
        nextBtn.style.visibility = 'hidden';
        contentEl.innerHTML = `
            <div style="font-weight:bold;">🎬 Opening Scene <span style="opacity:0.6;font-weight:normal;">(${esc(OPENING_FRAMES.find(f => f.id === opening.frameId)?.label || '')})</span></div>
            <div style="margin-top:8px;padding:10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;white-space:pre-wrap;font-size:0.88em;line-height:1.5;min-height:160px;">${opening.text ? esc(opening.text) : `<span style="opacity:0.5;font-style:italic;">${opening.error ? esc(opening.error) : 'Writing…'}</span>`}</div>
            <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
                <select id="rt-og-open-frame" class="text_pole" style="${SELECT_STYLE}max-width:200px;">
                    ${OPENING_FRAMES.map(f => `<option value="${f.id}"${opening.frameId === f.id ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}
                </select>
                <button id="rt-og-open-regen" class="menu_button interactable">↺ Regenerate</button>
                <button id="rt-og-open-accept" class="menu_button interactable" style="background:rgba(0,200,140,0.25);border-color:#00c88c;"${opening.text ? '' : ' disabled'}>✅ Begin adventure</button>
            </div>
            <div style="${HINT}margin-top:4px;text-align:right;">Accepting inserts this as the story's first message. Your character is already saved either way.</div>`;
        contentEl.querySelector('#rt-og-open-frame')?.addEventListener('change', e => { opening.frameId = e.target.value; });
        contentEl.querySelector('#rt-og-open-regen')?.addEventListener('click', () => { if (!busy) generateOpening(); });
        contentEl.querySelector('#rt-og-open-accept')?.addEventListener('click', async () => {
            if (busy || !opening.text) return;
            setBusy(true, 'Starting the story…');
            const inserted = await insertOpeningMessage(opening.text);
            if (!inserted) {
                setBusy(false, '⚠️ Could not write into the chat — copy the opening text manually.');
                return;
            }
            close();
        });
    }

    // ── Forge: full-random one-click path (spec §7.4) ────────────────────────

    forgeBtn.addEventListener('click', async () => {
        if (busy) return;
        if (!draft.raceId) {
            const living = RACES.filter(r => r.living);
            draft.raceId = living[Math.floor(Math.random() * living.length)].id;
        }
        if (!draft.originId) {
            const allowed = allowedOriginsForRace(draft.raceId);
            draft.originId = allowed[Math.floor(Math.random() * allowed.length)].id;
        }
        draft.selections = randomizeSelections(ORIGINS_BY_ID[draft.originId], draft.raceId, draft.nsfw);
        draft.profile = null;
        draft.step = 'review';
        save();
        render();
        await generateProfile(false);
    });

    // ── Footer nav ───────────────────────────────────────────────────────────

    prevBtn.addEventListener('click', () => {
        const i = WIZARD_STEPS.indexOf(currentStep());
        if (i > 0) goTo(WIZARD_STEPS[i - 1]);
    });
    nextBtn.addEventListener('click', () => {
        const cur = currentStep();
        const i = WIZARD_STEPS.indexOf(cur);
        if (cur === 'race' && !draft.raceId) { setStatus('Pick a race first.'); return; }
        if (cur === 'origin' && !draft.originId) { setStatus('Pick an origin first.'); return; }
        if (i < WIZARD_STEPS.length - 1) goTo(WIZARD_STEPS[i + 1]);
    });

    // ── Render loop ──────────────────────────────────────────────────────────

    function render() {
        renderRail();
        const cur = currentStep();
        prevBtn.style.visibility = cur === 'options' ? 'hidden' : 'visible';
        nextBtn.style.visibility = cur === 'review' ? 'hidden' : 'visible';
        switch (cur) {
            case 'options': renderOptionsStep(); break;
            case 'race': renderRaceStep(); break;
            case 'appearance': renderAppearanceStep(); break;
            case 'origin': renderOriginStep(); break;
            case 'detail': renderDetailStep(); break;
            case 'review': renderReviewStep(); break;
        }
    }

    render();
}

/** Discards the in-progress draft (Start Over). No-op if committed. */
export function discardOriginDraft(chatId) {
    const st = getSettings().chatStates?.[chatId];
    if (!st?.origin || st.origin.committed) return;
    delete st.origin.draft;
    SillyTavern.getContext().saveSettingsDebounced();
}
