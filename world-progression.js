/**
 * world-progression.js — Fatbody Framework (World Progression System)
 *
 * Orchestration layer: owns persistence accessors for the cross-chat
 * (settings.worldStates[campaignPrefix]) and per-chat (chatStates[chatId].worldProg)
 * state, the post-turn cycle that decides which layers need an LLM call this
 * cycle and runs the consolidated commit call, the chapter/phase-gate
 * lifecycle, rollback bookkeeping, manual override entry points, and the
 * Megumin Suite overlap check. Mirrors router.js's role for this feature.
 *
 * Imports: state-manager.js, llm-client.js, router.js (writeBookToDisk),
 *          world-progression-schema.js (all pure logic).
 * Imported by: narrative-hooks.js (post-turn hook), index.js (HUD, settings,
 *              manual overrides, rollback event listeners), central-tension-compiler.js.
 */

import { getSettings, getEffectiveRouterCampaignPrefix } from './state-manager.js';
import { sendAgentTurn } from './llm-client.js';
import { writeBookToDisk } from './router.js';
import {
    makeDefaultWorldState,
    makeDefaultChatWorldProg,
    makeDefaultChapter,
    validateWorldProgressionCommit,
    shouldCheckWorldArc,
    candidateCharacterArcBeats,
    shouldCheckRegionalState,
    computePressureGauge,
    evaluateTempoTransition,
    evaluatePhaseGate,
    buildCommitToolSchema,
    renderTempoDirective,
    applyWorldArcUpdate,
    applyCharacterArcUpdate,
    applyRegionalStateUpdate,
    invertMicroPatches,
    computeEngagementDeltas,
    resolveSurfacedBeats,
    resolveCurrentRegionId,
    TEMPO_MODES,
    CHAPTER_HISTORY_CAP,
    PENDING_DELTA_COMMIT_HORIZON,
    WORLD_ARC_DEFAULT_PROMPT,
    CHARACTER_ARC_DEFAULT_PROMPT,
    REGIONAL_STATE_DEFAULT_PROMPT,
    PACING_DEFAULT_PROMPT,
} from './world-progression-schema.js';

const PACING_PROMPT_KEY = 'rpg_tracker_worldprog_pacing';

// ── In-memory cycle bookkeeping (mirrors narrative-hooks.js's _routerAutoTick — resets on chat change, not persisted) ──

let _worldProgAutoTick = 0;
let _cyclesSinceWorldArcCheck = 0;
let _regionMessagesSinceCheck = {};
let _lastRegionId = null;

/** Call this whenever the active chat changes so throttle/region counters restart. Mirrors resetRouterTick. */
export function resetWorldProgTick() {
    _worldProgAutoTick = 0;
    _cyclesSinceWorldArcCheck = 0;
    _regionMessagesSinceCheck = {};
    _lastRegionId = null;
}

function currentChatId() {
    return (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : SillyTavern.getContext().chatId) || null;
}

// ── Persistence accessors ───────────────────────────────────────────────────────

/**
 * Resolves the World ID for a chat: a per-chat override (set after a branch
 * fork, §8) takes precedence, otherwise it's the same campaign-prefix
 * convention already used to group a campaign's lorebooks.
 * @param {string} chatId
 * @returns {string}
 */
export function getWorldProgKey(chatId) {
    const s = getSettings();
    const override = s.chatStates?.[chatId]?.worldProg?.worldStateKey;
    if (override) return override;
    return getEffectiveRouterCampaignPrefix(chatId);
}

/** @param {string} chatId @returns {object|null} settings.worldStates[campaignPrefix], created on first access */
export function getWorldState(chatId) {
    const key = getWorldProgKey(chatId);
    if (!key) return null;
    const s = getSettings();
    if (!s.worldStates) s.worldStates = {};
    if (!s.worldStates[key]) s.worldStates[key] = makeDefaultWorldState();
    return s.worldStates[key];
}

/**
 * Persists settings.worldStates. Callers that already mutated the live
 * object returned by getWorldState() in place can call this with no patch —
 * it just stamps updatedAt and debounce-saves.
 * @param {string} chatId
 * @param {object|null} [patch] - shallow merge patch
 */
export function saveWorldState(chatId, patch = null) {
    const key = getWorldProgKey(chatId);
    if (!key) return;
    const s = getSettings();
    if (!s.worldStates) s.worldStates = {};
    const existing = s.worldStates[key] || makeDefaultWorldState();
    s.worldStates[key] = patch ? { ...existing, ...patch } : existing;
    s.worldStates[key].updatedAt = new Date().toISOString();
    SillyTavern.getContext().saveSettingsDebounced();
}

/** @param {string} chatId @returns {object|null} chatStates[chatId].worldProg, created on first access */
export function getChatWorldProg(chatId) {
    if (!chatId) return null;
    const s = getSettings();
    if (!s.chatStates) s.chatStates = {};
    if (!s.chatStates[chatId]) s.chatStates[chatId] = {};
    if (!s.chatStates[chatId].worldProg) {
        const prog = makeDefaultChatWorldProg();
        prog.worldStateKey = getEffectiveRouterCampaignPrefix(chatId);
        s.chatStates[chatId].worldProg = prog;
    }
    return s.chatStates[chatId].worldProg;
}

/**
 * Persists chatStates[chatId].worldProg (writes directly + saveSettingsDebounced,
 * same pattern as foundation.js#commitFoundation — this is NOT routed through
 * saveChatState's snapshot cycle).
 * @param {string} chatId
 * @param {object|null} [patch]
 */
export function saveChatWorldProg(chatId, patch = null) {
    if (!chatId) return;
    const s = getSettings();
    if (!s.chatStates?.[chatId]) return;
    if (patch) s.chatStates[chatId].worldProg = { ...(s.chatStates[chatId].worldProg || makeDefaultChatWorldProg()), ...patch };
    SillyTavern.getContext().saveSettingsDebounced();
}

/**
 * Full-replace setters for the HUD's manual JSON editor. Deliberately
 * bypass the validate/apply pipeline (no schema check, no pendingDeltas
 * entry) — this is an explicit user override, not a model output, mirroring
 * how the State Tracker panel lets users hand-edit the raw memo directly.
 * @param {string} chatId
 * @param {object} newWorldState
 */
export function replaceWorldState(chatId, newWorldState) {
    const key = getWorldProgKey(chatId);
    if (!key) return;
    const s = getSettings();
    if (!s.worldStates) s.worldStates = {};
    s.worldStates[key] = newWorldState;
    SillyTavern.getContext().saveSettingsDebounced();
}

/** @param {string} chatId @param {object} newChatWorldProg */
export function replaceChatWorldProg(chatId, newChatWorldProg) {
    if (!chatId) return;
    const s = getSettings();
    if (!s.chatStates?.[chatId]) return;
    s.chatStates[chatId].worldProg = newChatWorldProg;
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Remaps worldProg* settings onto the shape sendStateRequest/sendAgentTurn expect — exact pattern of router.js's routerSettings. */
export function worldProgSettings(settings) {
    return {
        ...settings,
        connectionSource: settings.worldProgConnectionSource || 'default',
        connectionProfileId: settings.worldProgConnectionProfileId,
        completionPresetId: settings.worldProgCompletionPresetId,
        ollamaUrl: settings.worldProgOllamaUrl,
        ollamaModel: settings.worldProgOllamaModel,
        openaiUrl: settings.worldProgOpenaiUrl,
        openaiKey: settings.worldProgOpenaiKey,
        openaiModel: settings.worldProgOpenaiModel,
        maxTokens: (settings.worldProgMaxTokens !== undefined && settings.worldProgMaxTokens !== null && settings.worldProgMaxTokens !== '') ? Number(settings.worldProgMaxTokens) : 1000,
    };
}

// ── Pacing: narrator-facing output via setExtensionPrompt (no interceptor change) ──

/**
 * Pushes the current tempo mode's fixed prose directive to the narrator via
 * ST's setExtensionPrompt — the same mechanism sysprompt.js already uses for
 * additive delivery. Zero LLM cost; safe to call every cycle. Clears the
 * prompt when disabled or no campaign has been compiled yet for this chat.
 * @param {string} chatId
 */
export function refreshWorldProgPacingPrompt(chatId) {
    const ctx = SillyTavern.getContext();
    const setExtensionPrompt = ctx.setExtensionPrompt;
    if (typeof setExtensionPrompt !== 'function') return;
    const settings = getSettings();
    // Check the gates before touching getWorldState(): it auto-creates and persists
    // an empty world-state record on first access, which would otherwise happen for
    // every chat merely switched into, including ones that never used Fatbody.
    if (!settings.enabled || !settings.worldProgEnabled || !chatId) {
        setExtensionPrompt(PACING_PROMPT_KEY, '', 0, 0);
        return;
    }
    const worldState = getWorldState(chatId);
    if (!worldState?.milestoneChain?.length) {
        setExtensionPrompt(PACING_PROMPT_KEY, '', 0, 0);
        return;
    }
    const chatWorldProg = getChatWorldProg(chatId);
    setExtensionPrompt(PACING_PROMPT_KEY, renderTempoDirective(chatWorldProg.pacing.mode), 0, 0);
}

/** Deterministic (no LLM) per-cycle pacing update: pressure gauge, tempo transition, phase-gate-adjacent counters. */
function updatePacingForCycle(worldState, chatWorldProg) {
    const pressureInputs = {
        activeSeedCount: (chatWorldProg.chapter?.seeds || []).filter(s => s.status === 'planted' || s.status === 'developing').length,
        milestoneProximity: worldState.worldClock?.pressureGauge || 'low',
        unresolvedFractureCount: Object.values(worldState.characterArcs || {}).filter(a => a.phase === 'fracture').length,
        regionalInstabilityCount: Object.values(chatWorldProg.regions || {}).reduce((sum, r) => sum + (r.conditionModifiers?.length || 0), 0),
        engagementTrend: 'flat',
    };
    chatWorldProg.pacing.pressureGaugeInputs = pressureInputs;
    const pressureGauge = computePressureGauge(pressureInputs);
    worldState.worldClock.pressureGauge = pressureGauge;
    worldState.worldClock.lastEvaluatedAt = new Date().toISOString();

    const phaseGateEval = evaluatePhaseGate(chatWorldProg.chapter);
    const transition = evaluateTempoTransition(chatWorldProg.pacing, pressureGauge, phaseGateEval.breakdown);

    if (transition.nextMode !== chatWorldProg.pacing.mode) {
        chatWorldProg.pacing.mode = transition.nextMode;
        chatWorldProg.pacing.modeEnteredAt = new Date().toISOString();
        chatWorldProg.pacing.exchangesSinceModeEntered = 0;
        if (transition.nextMode === 'aftermath') chatWorldProg.pacing.aftermathBreathingRoomGiven = 0;
    } else {
        chatWorldProg.pacing.exchangesSinceModeEntered = (chatWorldProg.pacing.exchangesSinceModeEntered || 0) + 1;
        if (chatWorldProg.pacing.mode === 'aftermath') {
            chatWorldProg.pacing.aftermathBreathingRoomGiven = (chatWorldProg.pacing.aftermathBreathingRoomGiven || 0) + 1;
            chatWorldProg.chapter.phaseGate.aftermathExchangeCount = chatWorldProg.pacing.aftermathBreathingRoomGiven;
        }
    }
    chatWorldProg.pacing.lastTransitionReason = transition.reason;
    return { pressureGauge, phaseGateEval };
}

// ── Rollback bookkeeping (§9 — event listeners that call these live in index.js) ──

function registerPendingDelta(chatWorldProg, layer, microPatches, messageIndex, swipeId, crossChat) {
    if (!microPatches.length) return null;
    if (!chatWorldProg.pendingDeltas) chatWorldProg.pendingDeltas = [];
    const id = `wpdelta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    chatWorldProg.pendingDeltas.push({ id, messageIndex, swipeId, appliedAt: new Date().toISOString(), crossChat, layer, inversePatch: microPatches, committed: false });
    return id;
}

/**
 * Rolls back one recorded delta (from a swiped/deleted message) and removes
 * it from pendingDeltas.
 * @param {string} chatId
 * @param {string} deltaId
 * @returns {boolean}
 */
export function rollbackDelta(chatId, deltaId) {
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg) return false;
    const idx = (chatWorldProg.pendingDeltas || []).findIndex(d => d.id === deltaId);
    if (idx === -1) return false;
    const delta = chatWorldProg.pendingDeltas[idx];
    if (delta.crossChat) {
        const worldState = getWorldState(chatId);
        if (worldState) invertMicroPatches(worldState, delta.inversePatch);
        saveWorldState(chatId);
    } else {
        invertMicroPatches(chatWorldProg, delta.inversePatch);
    }
    chatWorldProg.pendingDeltas.splice(idx, 1);
    saveChatWorldProg(chatId);
    return true;
}

/**
 * Rolls back every delta anchored to a given message (its `extra.worldProgDeltaIds`).
 * Called by index.js's MESSAGE_DELETED/MESSAGE_SWIPED listeners.
 * @param {string} chatId
 * @param {{worldProgDeltaIds?: string[]}|undefined} messageExtra
 */
export function rollbackDeltasForMessage(chatId, messageExtra) {
    for (const id of (messageExtra?.worldProgDeltaIds || [])) rollbackDelta(chatId, id);
}

/**
 * Re-checks every pendingDelta against the LIVE chat array and rolls back any
 * whose anchor id is no longer referenced by any message's `extra.worldProgDeltaIds`
 * — i.e. the message that triggered it was deleted, or (best-effort) swiped away.
 * Deliberately payload-agnostic (scans `chat[]` directly rather than trusting the
 * exact argument MESSAGE_DELETED/MESSAGE_SWIPED pass) since this repo has no prior
 * code exercising either event to confirm their exact contract against.
 *
 * Known limitation, to confirm against a real ST session: this assumes `.extra`
 * is per-message and changes (or the id list is absent) when a different swipe
 * becomes active. If a given ST version instead keeps `.extra` constant across
 * swipes of the same message, a delta anchored to a swiped-away generation could
 * be missed here — the reconciliation pass (§12) is the backstop for any such drift.
 * @param {string} chatId
 */
export function reconcileWorldProgRollbacks(chatId) {
    if (!getSettings().worldProgEnabled) return;
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg?.pendingDeltas?.length) return;
    const { chat } = SillyTavern.getContext();
    const stillReferenced = new Set();
    for (const msg of (chat || [])) {
        for (const id of (msg?.extra?.worldProgDeltaIds || [])) stillReferenced.add(id);
    }
    let rolledBack = false;
    for (const delta of [...chatWorldProg.pendingDeltas]) {
        if (!stillReferenced.has(delta.id)) { rollbackDelta(chatId, delta.id); rolledBack = true; }
    }
    if (rolledBack) globalThis._rpgRenderWorldProgHud?.();
}

/**
 * Drops pendingDeltas whose anchor message has scrolled past the rollback
 * horizon (default: more than PENDING_DELTA_COMMIT_HORIZON messages back) —
 * they're permanently committed, no longer swipe/delete-reversible. Bounds
 * the array the same way routerHistory/memoHistory are capped.
 * @param {string} chatId
 * @param {number} currentMessageIndex
 */
export function pruneCommittedDeltas(chatId, currentMessageIndex) {
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg?.pendingDeltas?.length) return;
    const before = chatWorldProg.pendingDeltas.length;
    chatWorldProg.pendingDeltas = chatWorldProg.pendingDeltas.filter(d => (currentMessageIndex - d.messageIndex) <= PENDING_DELTA_COMMIT_HORIZON);
    if (chatWorldProg.pendingDeltas.length !== before) saveChatWorldProg(chatId);
}

// ── Lorebook append-through (extends existing FAC/LOC entries, §13 — no new entry types) ──

/** Appends a timestamped delta line to an existing lorebook entry, mirroring the router's append-only-chronicle convention. Fire-and-forget safe. */
async function appendToLorebookEntry(entryId, deltaText) {
    if (!entryId || !deltaText) return;
    const [bookName, uid] = String(entryId).split('::');
    if (!bookName || uid === undefined) return;
    try {
        const ctx = SillyTavern.getContext();
        const book = await ctx.loadWorldInfo(bookName);
        if (!book?.entries?.[uid]) return;
        const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
        book.entries[uid].content = `${book.entries[uid].content || ''}\n[${stamp}] ${deltaText}`.trim();
        await writeBookToDisk(bookName, book);
    } catch (e) {
        console.warn('[RPG Tracker] World Progression: failed to append lorebook delta:', e);
    }
}

// ── Chapter / phase-gate lifecycle ──────────────────────────────────────────────

/**
 * Archives the current chapter and starts a new one. Fires automatically
 * when evaluatePhaseGate().readyToAdvance, or manually via the HUD. Also
 * triggers the automatic reconciliation pass per the spec (§12).
 * @param {string} chatId
 */
export async function advanceChapter(chatId) {
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg) return;
    if (!chatWorldProg.chapterHistory) chatWorldProg.chapterHistory = [];
    chatWorldProg.chapterHistory.unshift(chatWorldProg.chapter);
    if (chatWorldProg.chapterHistory.length > CHAPTER_HISTORY_CAP) chatWorldProg.chapterHistory.length = CHAPTER_HISTORY_CAP;
    chatWorldProg.chapter = makeDefaultChapter((chatWorldProg.chapter.index || 1) + 1);
    saveChatWorldProg(chatId);
    globalThis._rpgRenderWorldProgHud?.();
    try {
        await runWorldProgReconciliation(chatId);
    } catch (e) {
        console.error('[RPG Tracker] World Progression: automatic reconciliation after chapter advance failed:', e);
    }
}

// ── Manual overrides (debug/testing controls, HUD-driven) ──────────────────────

/** @param {string} chatId @param {string} targetMode @returns {boolean} */
export function forceAdvanceTempo(chatId, targetMode) {
    if (!TEMPO_MODES.includes(targetMode)) return false;
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg) return false;
    chatWorldProg.pacing.mode = targetMode;
    chatWorldProg.pacing.modeEnteredAt = new Date().toISOString();
    chatWorldProg.pacing.exchangesSinceModeEntered = 0;
    chatWorldProg.pacing.lastTransitionReason = 'manual override (debug)';
    saveChatWorldProg(chatId);
    refreshWorldProgPacingPrompt(chatId);
    return true;
}

/** @param {string} chatId */
export async function forcePhaseGate(chatId) {
    await advanceChapter(chatId);
}

/**
 * Forks a chat's World Progression state off the live campaign prefix into
 * an independent copy, so branches/checkpoints evolve separately (§8).
 * Manual escape hatch — also invoked automatically by the fork-detection
 * heuristic wired in index.js#syncCampaignPrefixAndWorldsForChat.
 * @param {string} chatId
 * @returns {boolean}
 */
export function forkWorldState(chatId) {
    const s = getSettings();
    const livePrefix = getEffectiveRouterCampaignPrefix(chatId);
    if (!livePrefix || !s.worldStates?.[livePrefix]) return false;
    const forkKey = `${livePrefix}__fork_${chatId.replace(/[^a-zA-Z0-9]+/g, '_')}_${Date.now()}`;
    s.worldStates[forkKey] = structuredClone(s.worldStates[livePrefix]);
    if (!s.chatStates) s.chatStates = {};
    if (!s.chatStates[chatId]) s.chatStates[chatId] = {};
    if (!s.chatStates[chatId].worldProg) s.chatStates[chatId].worldProg = makeDefaultChatWorldProg();
    s.chatStates[chatId].worldProg.worldStateKey = forkKey;
    SillyTavern.getContext().saveSettingsDebounced();
    return true;
}

// ── Deferred consequence queue (JS-only resolution for content-free items) ────

/**
 * Resolves purely-mechanical queued items with no LLM call (e.g. an
 * unengaged seed going dormant). Content-needing items stay queued and get
 * folded into the next cycle that actually runs the commit call.
 * @param {string} chatId
 */
export function drainDeferredConsequenceQueue(chatId) {
    const chatWorldProg = getChatWorldProg(chatId);
    if (!chatWorldProg?.deferredConsequenceQueue?.length) return;
    let changed = false;
    const remaining = [];
    for (const item of chatWorldProg.deferredConsequenceQueue) {
        if (item.resolvedAt) continue;
        if (item.kind === 'seed_drift') {
            const seed = chatWorldProg.chapter.seeds.find(s => s.id === item.payload?.seedId);
            if (seed && seed.status === 'planted') {
                seed.status = 'dormant';
                item.resolvedAt = new Date().toISOString();
                changed = true;
                continue;
            }
        }
        remaining.push(item);
    }
    chatWorldProg.deferredConsequenceQueue = remaining;
    if (changed) saveChatWorldProg(chatId);
}

/** Queues seeds planted 2+ chapters ago that never engaged for JS-only drift resolution next drain. */
function enqueueStaleSeedDrift(chatWorldProg) {
    for (const seed of (chatWorldProg.chapter?.seeds || [])) {
        if (seed.status !== 'planted' || seed.engaged) continue;
        const alreadyQueued = (chatWorldProg.deferredConsequenceQueue || []).some(i => i.kind === 'seed_drift' && i.payload?.seedId === seed.id);
        if (alreadyQueued) continue;
        const plantedAt = seed.createdAt ? new Date(seed.createdAt).getTime() : 0;
        const staleMs = 1000 * 60 * 60 * 6; // ~6 hours of real session time as a coarse staleness proxy
        if (plantedAt && Date.now() - plantedAt > staleMs) {
            if (!chatWorldProg.deferredConsequenceQueue) chatWorldProg.deferredConsequenceQueue = [];
            chatWorldProg.deferredConsequenceQueue.push({ id: `dcq_${Date.now()}_${seed.id}`, kind: 'seed_drift', payload: { seedId: seed.id }, resolvedAt: null });
        }
    }
}

// ── The consolidated commit call ────────────────────────────────────────────────

/** Text-fallback parser for `commit_world_progression(...)` — mirrors router.js#parseTextAction, scoped to the one tool this feature offers. */
function parseWorldProgTextAction(text) {
    const match = text?.match(/commit_world_progression\s*\(/i);
    if (!match) return null;
    const start = text.indexOf('(', match.index);
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;
    const raw = text.slice(start + 1, end).trim();
    try {
        return { name: 'commit_world_progression', args: JSON.parse(raw.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']')) };
    } catch (_) {
        return null;
    }
}

/** Applies a VALIDATED commit payload: per-layer state mutation + rollback bookkeeping + lorebook append-through + chapter/seed bookkeeping + phase-gate check. */
function applyWorldProgressionCommit(chatId, worldState, chatWorldProg, activeLayers, parsed, messageIndex, swipeId) {
    const now = new Date().toISOString();
    const deltaIds = [];

    if (activeLayers.has('worldArc') && parsed.worldArc) {
        const microPatches = applyWorldArcUpdate(worldState, parsed.worldArc);
        const id = registerPendingDelta(chatWorldProg, 'worldArc', microPatches, messageIndex, swipeId, true);
        if (id) deltaIds.push(id);
        if (parsed.worldArc.milestoneUpdates?.some(m => m.status === 'approaching' || m.status === 'triggered')) {
            chatWorldProg.chapter.phaseGate.worldClockThresholdReached = true;
        }
        for (const fu of parsed.worldArc.factionUpdates || []) {
            const entryId = worldState.factions[fu.factionId]?.lorebookEntryId;
            if (entryId && fu.actionSummary) appendToLorebookEntry(entryId, fu.actionSummary).catch(() => {});
        }
    }

    if (activeLayers.has('characterArc') && parsed.characterArc?.beats?.length) {
        const microPatches = applyCharacterArcUpdate(worldState, parsed.characterArc);
        const id = registerPendingDelta(chatWorldProg, 'characterArc', microPatches, messageIndex, swipeId, true);
        if (id) deltaIds.push(id);
        chatWorldProg.chapter.phaseGate.characterBeatFiredAndProcessed = true;
    }

    if (activeLayers.has('regionalState') && parsed.regionalState?.regionUpdates?.length) {
        const microPatches = applyRegionalStateUpdate(chatWorldProg, parsed.regionalState, messageIndex);
        const id = registerPendingDelta(chatWorldProg, 'regionalState', microPatches, messageIndex, swipeId, false);
        if (id) deltaIds.push(id);
        chatWorldProg.chapter.phaseGate.regionalShiftReady = true;
        for (const ru of parsed.regionalState.regionUpdates) {
            const entryId = chatWorldProg.regions[ru.regionId]?.lorebookEntryId;
            if (!entryId) continue;
            const bits = [
                ...(ru.addModifiers || []).map(m => `Condition: ${m.label}${m.note ? ' — ' + m.note : ''}`),
                ...(ru.addHooks || []).map(h => `Hook: ${h.text}`),
                ...(ru.addResidue || []).map(r => `Residue: ${r.text}`),
            ];
            if (bits.length) appendToLorebookEntry(entryId, bits.join(' | ')).catch(() => {});
        }
    }

    for (const s of (parsed.newSeeds || [])) {
        chatWorldProg.chapter.seeds.push({
            id: `seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            text: s.text, tiedTo: s.tiedTo || 'none', tiedToId: s.tiedToId || null,
            engaged: false, status: 'planted', createdAt: now,
        });
    }
    for (const d of (parsed.developments || [])) {
        chatWorldProg.chapter.developments.push({
            id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            seedId: d.seedId, kind: d.kind, text: d.text, createdAt: now,
        });
        const seed = chatWorldProg.chapter.seeds.find(s => s.id === d.seedId);
        if (seed) { seed.engaged = true; seed.status = 'developing'; }
    }
    if (parsed.convergenceResolved) {
        chatWorldProg.chapter.convergencesResolved = (chatWorldProg.chapter.convergencesResolved || 0) + 1;
    }

    if (messageIndex >= 0 && deltaIds.length) {
        const msg = SillyTavern.getContext().chat?.[messageIndex];
        if (msg) {
            if (!msg.extra) msg.extra = {};
            msg.extra.worldProgDeltaIds = [...(msg.extra.worldProgDeltaIds || []), ...deltaIds];
        }
    }

    enqueueStaleSeedDrift(chatWorldProg);
    saveWorldState(chatId);
    saveChatWorldProg(chatId);
    globalThis._rpgRenderWorldProgHud?.();

    const gateResult = evaluatePhaseGate(chatWorldProg.chapter);
    if (gateResult.readyToAdvance) {
        advanceChapter(chatId).catch(e => console.error('[RPG Tracker] World Progression: advanceChapter failed:', e));
    }

    return { ok: true, deltaIds, phaseGate: gateResult };
}

/**
 * Runs one consolidated commit call covering every layer active this cycle,
 * with a bounded validate-retry loop (not a ReAct research loop — the
 * caller already decided what's active; this call only needs to propose and
 * validate updates, reusing router.js's native-tools/text-fallback split).
 * @param {Set<string>} activeLayers
 * @param {{chatId: string, worldState: object, chatWorldProg: object, combinedNarrative?: string, narrativeContext?: string, extraPreamble?: string, fullSnapshot?: string, messageIndex: number, swipeId: number}} cycleContext
 */
async function runWorldProgressionAgentTurn(activeLayers, cycleContext) {
    const { chatId, worldState, chatWorldProg, messageIndex, swipeId } = cycleContext;
    const settings = getSettings();
    const wps = worldProgSettings(settings);

    const layerPrompts = [];
    if (activeLayers.has('worldArc')) layerPrompts.push(settings.worldArcSystemPromptTemplate || WORLD_ARC_DEFAULT_PROMPT);
    if (activeLayers.has('characterArc')) layerPrompts.push(settings.characterArcSystemPromptTemplate || CHARACTER_ARC_DEFAULT_PROMPT);
    if (activeLayers.has('regionalState')) layerPrompts.push(settings.regionalStateSystemPromptTemplate || REGIONAL_STATE_DEFAULT_PROMPT);
    if (activeLayers.has('pacing')) layerPrompts.push(settings.pacingSystemPromptTemplate || PACING_DEFAULT_PROMPT);

    const knownIds = {
        factionIds: Object.keys(worldState.factions || {}),
        npcIds: Object.keys(worldState.characterArcs || {}),
        regionIds: Object.keys(chatWorldProg.regions || {}),
        seedIds: (chatWorldProg.chapter?.seeds || []).map(s => s.id),
    };

    const contextSummary = cycleContext.fullSnapshot || JSON.stringify({
        centralTension: worldState.centralTension,
        milestoneChain: worldState.milestoneChain,
        worldClock: worldState.worldClock,
        activeFactions: worldState.factions,
        eligibleCharacterArcs: Object.fromEntries(knownIds.npcIds.map(id => [id, worldState.characterArcs[id]])),
        currentChapter: { index: chatWorldProg.chapter.index, seeds: chatWorldProg.chapter.seeds, convergencesResolved: chatWorldProg.chapter.convergencesResolved },
        regions: chatWorldProg.regions,
        currentTempo: chatWorldProg.pacing.mode,
    }, null, 2);

    const tools = buildCommitToolSchema(activeLayers);
    const usesNativeTools = ['openai', 'ollama'].includes(wps.connectionSource);

    const systemPrompt = `${cycleContext.extraPreamble ? cycleContext.extraPreamble + '\n\n' : ''}${layerPrompts.join('\n\n')}

<current_state>
${contextSummary}
</current_state>

Use the commit_world_progression tool exactly once to record this cycle's updates. Only include fields for layers that actually changed — omit anything that didn't need an update.${usesNativeTools ? '' : `

## OUTPUT FORMAT
Respond with exactly one call in this format and nothing else:
  commit_world_progression({...arguments as JSON matching this schema...})

Schema: ${JSON.stringify(tools[0].function.parameters)}`}`;

    const narrativeBlock = cycleContext.narrativeContext || cycleContext.combinedNarrative || '';
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `## NARRATIVE\n${narrativeBlock}` },
    ];

    const maxTurns = settings.worldProgMaxTurns || 3;
    let lastErrors = [];

    for (let attempt = 0; attempt < maxTurns; attempt++) {
        let result;
        try {
            result = await sendAgentTurn(wps, messages, usesNativeTools ? tools : null);
        } catch (e) {
            console.error('[RPG Tracker] World Progression: commit call failed, skipping cycle:', e);
            return { ok: false, reason: 'network-error', error: String(e) };
        }

        let parsed = null;
        if (result.toolCall?.name === 'commit_world_progression') {
            parsed = result.toolCall.args;
        } else if (!usesNativeTools) {
            const textAction = parseWorldProgTextAction(result.content || '');
            if (textAction?.name === 'commit_world_progression') parsed = textAction.args;
        }

        if (!parsed) {
            messages.push({ role: 'assistant', content: result.content || '' });
            messages.push({ role: 'user', content: 'You must call commit_world_progression exactly once. Try again.' });
            continue;
        }

        const validation = validateWorldProgressionCommit(parsed, activeLayers, knownIds);
        if (!validation.ok) {
            lastErrors = validation.errors;
            messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
            messages.push({ role: 'user', content: `Invalid commit — fix and resend:\n- ${validation.errors.join('\n- ')}` });
            continue;
        }

        // Validated. Nothing above this line has mutated state — apply now.
        return applyWorldProgressionCommit(chatId, worldState, chatWorldProg, activeLayers, parsed, messageIndex, swipeId);
    }

    console.warn('[RPG Tracker] World Progression: commit exhausted retries, skipping cycle unchanged.', lastErrors);
    return { ok: false, reason: 'validation-exhausted', errors: lastErrors };
}

/**
 * Full-context (not incremental) audit pass: re-reads the complete current
 * state against a longer narrative lookback and asks for a corrective
 * commit. Triggered automatically at every chapter advance; also exposed as
 * a manual HUD button. Deliberately rare/expensive — the one place this
 * feature is allowed to run a full-context call (§12).
 * @param {string} chatId
 */
export async function runWorldProgReconciliation(chatId) {
    const settings = getSettings();
    if (!settings.worldProgEnabled) return { ok: false, reason: 'disabled' };
    const worldState = getWorldState(chatId);
    const chatWorldProg = getChatWorldProg(chatId);
    if (!worldState?.milestoneChain?.length || !chatWorldProg) return { ok: false, reason: 'no-campaign' };

    const { chat } = SillyTavern.getContext();
    const lookback = (chat || []).slice(-20).map(m => `${m.is_user ? 'User' : (m.name || 'Narrator')}: ${m.mes}`).join('\n\n');
    const messageIndex = (chat?.length || 1) - 1;

    return runWorldProgressionAgentTurn(new Set(['worldArc', 'characterArc', 'regionalState']), {
        chatId, worldState, chatWorldProg,
        narrativeContext: lookback,
        extraPreamble: 'You are auditing the World Progression state for internal consistency against the recent narrative below. This is a FULL-CONTEXT reconciliation pass, not an incremental update — propose corrections only for anything that has genuinely drifted out of sync with what happened in the narrative. Leave everything else untouched; do not invent changes just to have something to report.',
        messageIndex,
        swipeId: chat?.[messageIndex]?.swipe_id || 0,
    });
}

// ── Entry point (wired from narrative-hooks.js#onGenerationEnded) ──────────────

/**
 * Runs one World Progression cycle: Pacing always evaluates (cheap, no LLM);
 * deterministic pre-checks decide which of the other three layers need an
 * LLM call this cycle; the feature's own throttle (independent of the
 * Lorebook Agent's routerRunEvery) gates the expensive call, with a
 * critical-pressure escape hatch so urgent moments aren't delayed.
 * @param {string} combinedNarrative
 * @param {Array<object>} chat
 */
export async function maybeRunWorldProgressionPass(combinedNarrative, chat) {
    const settings = getSettings();
    if (!settings.worldProgEnabled || settings.worldProgPaused) return;
    const chatId = currentChatId();
    if (!chatId) return;
    if (!getWorldProgKey(chatId)) return;

    const worldState = getWorldState(chatId);
    const chatWorldProg = getChatWorldProg(chatId);
    if (!worldState || !chatWorldProg) return;

    const messageIndex = (chat?.length || 1) - 1;
    pruneCommittedDeltas(chatId, messageIndex);

    if (!worldState.milestoneChain?.length) {
        // No campaign compiled yet for this world — nothing to progress, but
        // still clear any stale pacing directive left over from a prior campaign.
        refreshWorldProgPacingPrompt(chatId);
        return;
    }

    // Always run: cheap, no LLM.
    const engagementDeltas = computeEngagementDeltas(combinedNarrative, worldState.characterArcs);
    for (const [npcId, delta] of Object.entries(engagementDeltas)) {
        if (worldState.characterArcs[npcId]) {
            worldState.characterArcs[npcId].engagementScore = (worldState.characterArcs[npcId].engagementScore || 0) + delta;
        }
    }
    // A staged beat blocks that NPC from ever being offered another one
    // (candidateCharacterArcBeats' no-double-staging guard) until it's been
    // surfaced in the narrative — clear it here once that's happened.
    for (const npcId of resolveSurfacedBeats(combinedNarrative, worldState.characterArcs)) {
        worldState.characterArcs[npcId].pendingBeat = null;
    }
    const { pressureGauge } = updatePacingForCycle(worldState, chatWorldProg);
    refreshWorldProgPacingPrompt(chatId);
    saveWorldState(chatId);
    saveChatWorldProg(chatId);

    // Deterministic pre-checks -> activeLayers.
    const activeLayers = new Set();
    if (shouldCheckWorldArc(worldState, chatWorldProg, _cyclesSinceWorldArcCheck)) activeLayers.add('worldArc');

    const beatCandidates = candidateCharacterArcBeats(worldState.characterArcs, chatWorldProg.pacing.mode, engagementDeltas);
    if (beatCandidates.length) activeLayers.add('characterArc');

    const currentRegionId = resolveCurrentRegionId(chatWorldProg.regions, combinedNarrative);
    const justEnteredRegion = !!currentRegionId && currentRegionId !== _lastRegionId;
    if (currentRegionId) {
        const region = chatWorldProg.regions[currentRegionId];
        const messagesSince = _regionMessagesSinceCheck[currentRegionId] || 0;
        if (shouldCheckRegionalState(region, messagesSince, justEnteredRegion)) activeLayers.add('regionalState');
        _regionMessagesSinceCheck[currentRegionId] = justEnteredRegion ? 0 : messagesSince + 1;
    } else if (/\(Location:\s*[^)]+\)/i.test(combinedNarrative || '')) {
        // A location footer is present but doesn't match any tracked region —
        // the player has entered somewhere new. Without this branch,
        // resolveCurrentRegionId can never return a region it doesn't already
        // know about, so no region would ever get a first entry.
        activeLayers.add('regionalState');
    }
    if (currentRegionId) _lastRegionId = currentRegionId;

    if (activeLayers.size === 0) {
        _cyclesSinceWorldArcCheck++;
        drainDeferredConsequenceQueue(chatId);
        return;
    }

    // Own throttle, independent of routerRunEvery — with a critical-pressure escape hatch.
    _worldProgAutoTick++;
    const runEvery = settings.worldProgRunEvery || 1;
    const throttleOk = _worldProgAutoTick >= runEvery || pressureGauge === 'critical';
    if (!throttleOk) {
        _cyclesSinceWorldArcCheck++;
        return;
    }
    _worldProgAutoTick = 0;
    _cyclesSinceWorldArcCheck = activeLayers.has('worldArc') ? 0 : _cyclesSinceWorldArcCheck + 1;

    await runWorldProgressionAgentTurn(activeLayers, {
        chatId, worldState, chatWorldProg, combinedNarrative,
        messageIndex,
        swipeId: chat?.[messageIndex]?.swipe_id || 0,
    });

    drainDeferredConsequenceQueue(chatId);
}

// ── Megumin Suite integration (read-only, never writes into Megumin's settings) ──

/**
 * Resolves the Megumin Suite profile for the current chat, mirroring Megumin's
 * own getCharacterKey() (group_<id> / character avatar / 'default'). Shared by
 * detectMeguminOverlap() and detectMeguminFatbodyBlock() so their notion of
 * "current profile" can't drift apart.
 */
function resolveMeguminProfile(megumin, ctx) {
    if (!megumin?.profiles) return null;
    let key = 'default';
    if (ctx.groupId != null) key = `group_${ctx.groupId}`;
    else if (ctx.characterId != null && ctx.characters?.[ctx.characterId]) key = ctx.characters[ctx.characterId].avatar;
    return megumin.profiles[key] || megumin.profiles['default'] || null;
}

/**
 * Checks whether Megumin Suite is installed with overlapping features
 * (NPC Bank, Story Planner/Evolving Arc) active for the current profile.
 * Read-only — never mutates Megumin's settings object.
 * @returns {{installed: boolean, overlap: boolean, overlapFeatures?: string[]}}
 */
export function detectMeguminOverlap() {
    try {
        const ctx = SillyTavern.getContext();
        const megumin = ctx.extensionSettings?.['Megumin-Suite'];
        if (!megumin?.profiles) return { installed: false, overlap: false };

        const profile = resolveMeguminProfile(megumin, ctx);
        if (!profile) return { installed: true, overlap: false };

        const overlapFeatures = [];
        if (profile.npcBank?.enabled) overlapFeatures.push('NPC Bank');
        if (profile.storyPlan?.enabled) overlapFeatures.push('Story Planner / Evolving Arc');

        return { installed: true, overlap: overlapFeatures.length > 0, overlapFeatures };
    } catch (_) {
        return { installed: false, overlap: false };
    }
}

/**
 * Checks whether Megumin Suite's own "fatbody" block is enabled for the current
 * profile — meaning Megumin will substitute its [[FATBODY]] macro (live-pulled
 * from Fatbody, or its static fallback) into this generation's prompt. Used by
 * sysprompt.js to decide whether Fatbody should suppress its own additive
 * extension-prompt push to avoid injecting the same mechanics twice.
 * Read-only — never mutates Megumin's settings object.
 * @returns {{installed: boolean, active: boolean}}
 */
export function detectMeguminFatbodyBlock() {
    try {
        const ctx = SillyTavern.getContext();
        const megumin = ctx.extensionSettings?.['Megumin-Suite'];
        if (!megumin?.profiles) return { installed: false, active: false };

        const profile = resolveMeguminProfile(megumin, ctx);
        if (!profile) return { installed: true, active: false };

        return { installed: true, active: Array.isArray(profile.blocks) && profile.blocks.includes('fatbody') };
    } catch (_) {
        return { installed: false, active: false };
    }
}
