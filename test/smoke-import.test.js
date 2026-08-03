/**
 * Import smoke-test for the index.js split.
 *
 * Loads the ENTIRE module graph (index.js + every module it imports) under Node
 * with the DOM-heavy init() suppressed (globalThis.__FB_NO_INIT__). This catches
 * the split's most likely failure mode — a function moved to another file but
 * not exported/imported correctly — at link/eval time, before it ever reaches a
 * SillyTavern session. It does NOT exercise runtime DOM behaviour (that's the
 * manual ST smoke-test), only that the graph wires together.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Suppress the DOM init IIFE and provide a minimal document so top-level
// evaluation (globalThis bridges, env folder probe) doesn't throw.
globalThis.__FB_NO_INIT__ = true;
if (!globalThis.document) {
    globalThis.document = {
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: () => null,
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {} }),
        addEventListener() {},
        body: { appendChild() {} },
        head: { appendChild() {} },
    };
}
if (!globalThis.window) globalThis.window = globalThis;

test('index.js and its split modules link and evaluate without throwing', async () => {
    await import('../index.js');
    // origins-wizard.js is loaded dynamically at click time in production, so
    // it is NOT in index.js's static graph — import it explicitly or a broken
    // export/import in it would go unnoticed until a user clicks 🧬 Origins.
    const wizard = await import('../origins-wizard.js');
    assert.equal(typeof wizard.openOriginsWizard, 'function');
    assert.equal(typeof wizard.discardOriginDraft, 'function');
    assert.equal(typeof wizard.installSettingCard, 'function');
    // The Megumin/runtime global bridges must be installed at module load.
    assert.equal(typeof globalThis._rpgRenderRouterUI, 'function');
    assert.equal(typeof globalThis._rpgRefreshAgentManifest, 'function');
    assert.equal(typeof globalThis._rpgRunStateModelPass, 'function');
    // CYOA panel bridges — cyoa.js#registerSuggestChoicesTool calls
    // _rpgRenderCyoaPanel from inside the tool action, so it must exist by load.
    assert.equal(typeof globalThis._rpgRenderCyoaPanel, 'function');
    assert.equal(typeof globalThis._rpgSyncCyoaPanel, 'function');
});
