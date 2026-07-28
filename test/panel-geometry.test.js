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

const { loadPanelGeometry, savePanelGeometry, resetPanelGeometry } = await import('../panel-geometry.js');

function makePanel() {
    return { style: {} };
}

/**
 * A panel whose measured rect we control, for the save-side guards.
 * @param {{x?: number, y?: number, w: number, h: number}} rect
 */
function makeMeasuredPanel({ x = 10, y = 20, w, h }) {
    return {
        style: {},
        classList: { contains: () => false },
        getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h }),
    };
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

test('loadPanelGeometry: non-finite coordinates are dropped, not clamped to NaN', () => {
    // Clamping NaN yields NaN, which makes the left/top declarations invalid while
    // right/bottom have already been set to 'auto' — the fixed-position panel then has
    // no anchor at all and renders nowhere useful.
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: null, top: 'oops', width: 300, height: 420 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.left, undefined, 'null left is not applied');
    assert.equal(panel.style.top, undefined, 'non-numeric top is not applied');
    assert.equal(panel.style.right, undefined, 'right is not stranded on auto');
    assert.equal(panel.style.bottom, undefined, 'bottom is not stranded on auto');
});

test('loadPanelGeometry: a far off-screen position is clamped back into the viewport', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 99999, top: 99999, width: 300, height: 420 }));
    const panel = makePanel();
    loadPanelGeometry(panel);
    assert.equal(panel.style.left, `${1920 - 80}px`, 'left keeps a visible margin on screen');
    assert.equal(panel.style.top, `${1080 - 80}px`, 'top keeps a visible margin on screen');
});

test('savePanelGeometry: refuses to persist a hidden panel measuring zero', () => {
    // The ResizeObserver fires when the panel is hidden; saving that measurement used to
    // overwrite good geometry with {0,0,0,0} every time the HUD was closed.
    const good = JSON.stringify({ left: 300, top: 200, width: 400, height: 500 });
    globalThis.localStorage.setItem('rpg_tracker_geometry', good);
    savePanelGeometry(makeMeasuredPanel({ w: 0, h: 0 }));
    assert.equal(globalThis.localStorage.getItem('rpg_tracker_geometry'), good, 'existing geometry survives untouched');
});

test('savePanelGeometry: persists a normally laid-out panel', () => {
    globalThis.localStorage.removeItem('rpg_tracker_geometry');
    savePanelGeometry(makeMeasuredPanel({ x: 42, y: 84, w: 400, h: 500 }));
    assert.deepEqual(
        JSON.parse(globalThis.localStorage.getItem('rpg_tracker_geometry')),
        { left: 42, top: 84, width: 400, height: 500 },
    );
});

test('resetPanelGeometry: clears storage and strips inline positioning', () => {
    globalThis.localStorage.setItem('rpg_tracker_geometry', JSON.stringify({ left: 5, top: 5, width: 400, height: 500 }));
    const panel = { style: { left: '5px', top: '5px', right: 'auto', bottom: 'auto', width: '400px', height: '500px' } };
    resetPanelGeometry(panel);
    assert.equal(globalThis.localStorage.getItem('rpg_tracker_geometry'), null);
    for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        assert.equal(panel.style[prop], '', `${prop} falls back to the stylesheet`);
    }
});
