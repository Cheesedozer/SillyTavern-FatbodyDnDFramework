/**
 * test/_bootstrap.js — characterization-test bootstrap.
 *
 * The pure-logic modules (memo-processor, narrative-hooks, quests, state-manager)
 * are DOM-free but call `SillyTavern.getContext()` inside functions like
 * getSettings(). This bootstrap stubs only what those reads touch so the modules
 * can be imported and exercised under `node --test` with no browser.
 *
 * It does NOT stub `document` — tests stay off the DOM by only importing pure
 * functions. `crypto.getRandomValues` is native in Node >= 19 (used by the RNG).
 *
 * Import this FIRST in every test file, then call setSettings(obj) to seed the
 * extension_settings['rpg_tracker'] store before calling functions that read it.
 */

let _store = { rpg_tracker: {} };
let _extensionPrompts = {};
let _chatId = '';
let _chat = [];

/** Seed the rpg_tracker settings object getSettings() will merge defaults into. */
export function setSettings(obj) {
    _store = { rpg_tracker: obj || {} };
}

/** Sets the id the context reports as the open chat (defaults to '' — no chat). */
export function setChatId(chatId) {
    _chatId = chatId || '';
}

/**
 * Sets the message array the context reports as the open chat (defaults to []).
 * Needed by anything that reads chat history — getNarrativeBlocks and, through
 * it, onGenerationEnded, which returns immediately on an empty chat.
 */
export function setChat(messages) {
    _chat = Array.isArray(messages) ? messages : [];
}

/** Raw access to the backing extension_settings store (post-merge inspection). */
export function rawStore() {
    return _store;
}

/** Recorded setExtensionPrompt(key, value, ...) calls, keyed by prompt key. */
export function extensionPrompts() {
    return _extensionPrompts;
}

/** Clears the setExtensionPrompt recorder — call at the start of tests that assert on it. */
export function resetExtensionPrompts() {
    _extensionPrompts = {};
}

globalThis.SillyTavern = {
    getContext() {
        return {
            extensionSettings: _store,
            chatId: _chatId,
            saveSettingsDebounced() {},
            saveSettings() {},
            chat: _chat,
            eventSource: { on() {}, emit() {} },
            setExtensionPrompt(key, value) { _extensionPrompts[key] = value; },
        };
    },
    libs: {},
};

// No-op toast surface (toastr.success/info/warning/error are called fire-and-forget).
globalThis.toastr = new Proxy({}, { get: () => () => {} });

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('These tests require Node >= 19 for crypto.getRandomValues (used by the RNG engine).');
}
