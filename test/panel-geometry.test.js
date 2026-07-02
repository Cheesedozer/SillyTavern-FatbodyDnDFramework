/**
 * Tests for loadPanelGeometry()'s defensive floors: a saved width/height smaller
 * than the panel's own practical minimum (e.g. a stale save from before a floor
 * existed) must be ignored rather than applied verbatim. panel-geometry.js is
 * framework-free (no SillyTavern, no extension settings) — only localStorage and
 * a DOM element are involved, so a minimal in-memory localStorage stub is enough;
 * no need for test/_bootstrap.js here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function makeMemoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: (k) => { data.delete(k); },
    };
}
globalThis.localStorage = makeMemoryStorage();
// loadPanelGeometry() clamps left/top against window.innerWidth/innerHeight to
// avoid "bricking" the panel off-screen — stub a viewport so that clamp doesn't
// throw (a bare catch{} in the source would otherwise swallow the whole load).
globalThis.window = { innerWidth: 1920, innerHeight: 1080 };

const { loadPanelGeometry } = await import('../panel-geometry.js');

function makePanel() {
    return { style: {} };
}

test('loadPanelGeometry: no saved geometry leaves the panel untouched', () => {
    globalThis.localStorage.removeItem('rpg_tracker_geometry');
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.width, undefined);
    assert.equal(panel.style.height, undefined);
});

test('loadPanelGeometry: a width at/below the 220px floor is ignored', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 10, top: 10, width: 220, height: 300 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.width, undefined, 'width == floor is not applied (strict >)');
    assert.equal(panel.style.height, '300px');
});

test('loadPanelGeometry: a width above the floor is applied', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 10, top: 10, width: 400, height: 300 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.width, '400px');
});

test('loadPanelGeometry: a height at/below the 80px floor is ignored (pre-existing guard)', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 10, top: 10, width: 300, height: 80 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.width, '300px');
    assert.equal(panel.style.height, undefined, 'stale header-only height is not applied');
});

test('loadPanelGeometry: a height above the floor is applied', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 10, top: 10, width: 300, height: 420 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.height, '420px');
});

test('loadPanelGeometry: malformed JSON in storage is swallowed, not thrown', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', '{not json');
    const panel = makePanel();
    assert.doesNotThrow(() => loadPanelGeometry(panel));
});
