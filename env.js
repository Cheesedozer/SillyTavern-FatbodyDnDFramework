/**
 * env.js — Origins RPG Framework
 *
 * Resolves the extension's install folder name so fetches and template loads work
 * regardless of what the user named the folder. Shared by index.js and any module
 * that fetches bundled assets.
 *
 * Resolution order:
 *   1. import.meta.url — the module's own URL. Always correct, needs no name list.
 *   2. A <script src> DOM probe against known historical names, for exotic loaders
 *      that rewrite module URLs.
 *   3. The canonical repo name.
 */

/** Folder names this extension has shipped under, newest first. */
const KNOWN_FOLDER_NAMES = [
    'SillyTavern-OriginsRPGFramework',
    'SillyTavern-FatbodyDnDFramework',
    'SillyTavern-RPGStateTracker',
];

const DEFAULT_FOLDER_NAME = KNOWN_FOLDER_NAMES[0];

/**
 * Pull the folder segment out of a .../third-party/<folder>/... URL.
 * @param {string} url
 * @returns {string|null}
 */
function folderFromUrl(url) {
    const match = /third-party\/([^\/]+)\//.exec(url || '');
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export const FOLDER_NAME = (function () {
    // 1. The module's own URL. This is the reliable source: it reflects wherever the
    //    user actually installed the extension, including a rename we've never heard
    //    of. The previous DOM probe only matched a hardcoded list of legacy names, so
    //    a fresh install under the current repo name resolved to a folder that does
    //    not exist and every template/sysprompt/asset fetch 404'd.
    try {
        const fromModule = folderFromUrl(import.meta.url);
        if (fromModule) return fromModule;
    } catch { /* fall through */ }

    // 2. DOM probe, kept as a safety net for loaders that hand modules a blob: or
    //    data: URL with no path to parse.
    try {
        const scripts = /** @type {HTMLScriptElement[]} */ (Array.from(document.querySelectorAll('script[src]')));
        const myScript = scripts.find(s => KNOWN_FOLDER_NAMES.some(name => s.src.includes(name)));
        if (myScript) {
            const fromScript = folderFromUrl(myScript.src);
            if (fromScript) return fromScript;
        }
    } catch { /* fall through */ }

    return DEFAULT_FOLDER_NAME;
})();
