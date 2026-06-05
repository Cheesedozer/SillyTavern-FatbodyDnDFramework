/**
 * Stub for SillyTavern core (`../../../../script.js`) under `node --test`.
 * Only `getRequestHeaders` is imported from ST core by router.js / index.js.
 * Resolved in place of the real ST core by test/_hooks.js.
 */
export function getRequestHeaders() {
    return { 'Content-Type': 'application/json' };
}
