/**
 * env.js — Fatbody D&D Framework
 *
 * Resolves the extension's install folder name from the loaded <script> URL so
 * fetches and template loads work regardless of what the user renamed the
 * folder to. Shared by index.js and any module that fetches bundled assets.
 * Falls back to the canonical name if the DOM probe fails.
 */

// Capture the folder name dynamically from the module URL so it works regardless of what the user names the folder
export const FOLDER_NAME = (function () {
    try {
        const scripts = /** @type {HTMLScriptElement[]} */ (Array.from(document.querySelectorAll('script[src]')));
        const myScript = scripts.find(s => s.src.includes('SillyTavern-FatbodyDnDFramework') || s.src.includes('SillyTavern-RPGStateTracker'));
        if (myScript) {
            const match = myScript.src.match(/third-party\/([^\/]+)\//);
            if (match) return decodeURIComponent(match[1]);
        }
    } catch (e) { }
    return 'SillyTavern-FatbodyDnDFramework';
})();
