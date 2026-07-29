/**
 * shared-state.js — Fatbody D&D Framework
 *
 * Cross-module, in-memory runtime state for the (formerly monolithic) index.js.
 * ES import bindings are read-only, so values that get reassigned across modules
 * live as fields on this single holder object. Everything here is session state
 * (not persisted) — it was previously a set of module-level `let`s in index.js.
 *
 * Imported by: index.js and the modules split out of it.
 */

export const RT = {
    /** True while a state-model pass is in flight. */
    stateModelRunning: false,
    /** AbortController for the in-flight state pass (or null). */
    stateController: null,
    /** Current SillyTavern chat id. */
    currentChatId: null,
    /** Pending CHAT_CHANGED → prefix-derivation timer. */
    prefixDeriveTimer: null,
    /** Theme editor undo stack. */
    themeUndoStack: [],
    /** Active "click outside to deselect pill" document handler (or null). */
    pillDeselectHandler: null,
    /** Rebuilds the agent router UI; assigned in createPanel when the agent panel is wired. */
    renderRouterUI: null,
    /** Rebuilds CAMPAIGN RECORDS; assigned in createPanel when the agent panel is wired. */
    refreshAgentManifest: async () => {},
    /** Last lorebook/world sync diagnostics (JSON-serializable, or null). */
    loreActivationDebugLast: null,
    /** Memo history view index: -1 = live, 0 = most recent snapshot, higher = older. */
    historyViewIndex: -1,
    /** Whether the rendered (card) view is active vs the raw textarea. */
    renderedViewActive: false,
    /** In-memory lorebook redo stack; cleared when a new agent pass starts. */
    loreRedoStack: [],
    /** Per-tag pagination page index for the rendered memo sections. */
    sectionPages: {},
    /** Modern onboarding class setup in flight: { chatId, label } or null. */
    onboardingForge: null,
    /** chatIds where the user dismissed the "start your World Arc" gate this
     *  session ("skip for now") — intentionally in-memory only, not persisted,
     *  so the gate reappears on the next reload rather than being forgotten. */
    worldArcGateSkippedChats: new Set(),
};

// ── Framework-initiated LLM requests ───────────────────────────────────────────

/**
 * Depth of framework-initiated LLM requests currently in flight (router passes,
 * world-progression agent turns, state-model passes...). A counter rather than a
 * boolean so nested or overlapping internal calls can't clear the flag early.
 *
 * Lives here rather than in llm-client.js so prompt-side modules can consult it
 * without importing the networking layer (and its DOM-bound dependencies).
 */
let _internalRequestDepth = 0;

/** Marks the start of a framework-initiated request. Pair with endInternalRequest() in a finally. */
export function beginInternalRequest() {
    _internalRequestDepth++;
}

/** Marks the end of a framework-initiated request. Never goes negative. */
export function endInternalRequest() {
    if (_internalRequestDepth > 0) _internalRequestDepth--;
}

/**
 * True while the framework is talking to the model on its own behalf. Those
 * prompts are assembled by this extension via generateRaw and never contain the
 * user's preset, so preset-facing logic must sit them out.
 */
export function isInternalRequestActive() {
    return _internalRequestDepth > 0;
}

/** Test seam — drops the counter back to zero between cases. */
export function _resetInternalRequestDepth() {
    _internalRequestDepth = 0;
}
