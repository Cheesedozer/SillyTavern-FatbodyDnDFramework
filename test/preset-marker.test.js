/**
 * Tests for the [[ORIGINS]] preset marker (preset-marker.js).
 *
 * The marker is substituted at CHAT_COMPLETION_PROMPT_READY, so these exercise
 * handlePresetMarker() against the same `{ chat, dryRun }` shape SillyTavern
 * emits. The invariant worth protecting: the marker must NEVER survive into the
 * request as literal text, whatever the settings say.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applySysprompt, ADDITIVE_HEADER } from '../sysprompt.js';
import { handlePresetMarker, markerPayloadTokens, ORIGINS_MARKER, _resetMarkerWarning } from '../preset-marker.js';

/**
 * Seeds settings AND populates the additive cache the marker reads.
 * suiteMode is on so autoApplySysprompt() returns before touching the Main prompt
 * textarea — these tests are DOM-free, and it's the realistic marker config anyway.
 */
async function withMarkerOn(extra = {}) {
    setSettings({ suiteMode: true, presetMarkerEnabled: true, syspromptDelivery: 'standalone', ...extra });
    await applySysprompt();
}

const sys = content => ({ role: 'system', content });

test('substitutes the marker with the live additive rules', async () => {
    await withMarkerOn();
    const chat = [sys(`BEFORE\n${ORIGINS_MARKER}\nAFTER`)];
    handlePresetMarker({ chat });

    assert.ok(!chat[0].content.includes(ORIGINS_MARKER), 'marker consumed');
    assert.ok(chat[0].content.includes(ADDITIVE_HEADER), 'additive header substituted in');
    assert.ok(chat[0].content.includes('<rng_system>'), 'mechanics present');
    assert.ok(!chat[0].content.includes('<role>'), 'persona excluded');
    assert.ok(chat[0].content.startsWith('BEFORE'), 'surrounding text preserved');
    assert.ok(chat[0].content.trimEnd().endsWith('AFTER'), 'surrounding text preserved');
});

test('strips the marker rather than leaving it literal when the feature is off', async () => {
    setSettings({ presetMarkerEnabled: false, syspromptDelivery: 'additive' });
    await applySysprompt();
    const chat = [sys(`BEFORE\n${ORIGINS_MARKER}\nAFTER`)];
    handlePresetMarker({ chat });

    assert.ok(!chat[0].content.includes(ORIGINS_MARKER), 'marker never reaches the model as literal text');
    assert.ok(!chat[0].content.includes(ADDITIVE_HEADER), 'no rules substituted while off');
    assert.equal(chat[0].content, 'BEFORE\nAFTER', 'the blank line the marker sat on is removed too');
});

test('strips the marker when the cache is cold (marker on, nothing computed yet)', async () => {
    // Mirrors a fresh boot: presetMarkerEnabled is on but the async cache refresh
    // has not landed, so there is no payload to substitute yet.
    setSettings({ enabled: false, presetMarkerEnabled: true });
    await applySysprompt();
    setSettings({ enabled: true, presetMarkerEnabled: true });
    const chat = [sys(`A\n${ORIGINS_MARKER}\nB`)];
    handlePresetMarker({ chat });

    assert.ok(!chat[0].content.includes(ORIGINS_MARKER), 'no literal marker on a cold cache');
    assert.equal(chat[0].content, 'A\nB');
});

test('matches the marker case-insensitively and with surrounding whitespace', async () => {
    await withMarkerOn();
    for (const variant of ['[[ORIGINS]]', '[[origins]]', '[[Origins]]', '   [[OrIgInS]]   ']) {
        const chat = [sys(`X\n${variant}\nY`)];
        handlePresetMarker({ chat });
        assert.ok(chat[0].content.includes(ADDITIVE_HEADER), `substituted for ${variant.trim()}`);
        assert.ok(!/\[\[origins\]\]/i.test(chat[0].content), `no residue for ${variant.trim()}`);
    }
});

test('substitutes an inline marker without eating the rest of the line', async () => {
    await withMarkerOn();
    const chat = [sys(`Rules follow: ${ORIGINS_MARKER} — obey them.`)];
    handlePresetMarker({ chat });

    assert.ok(chat[0].content.startsWith('Rules follow: '), 'leading text kept');
    assert.ok(chat[0].content.endsWith(' — obey them.'), 'trailing text kept');
    assert.ok(chat[0].content.includes(ADDITIVE_HEADER));
});

test('substitutes every occurrence across every message', async () => {
    await withMarkerOn();
    const chat = [
        sys(`one ${ORIGINS_MARKER} and ${ORIGINS_MARKER}`),
        { role: 'user', content: `two ${ORIGINS_MARKER}` },
        { role: 'assistant', content: 'no marker here' },
    ];
    handlePresetMarker({ chat });

    const all = chat.map(m => m.content).join('\n');
    assert.ok(!/\[\[origins\]\]/i.test(all), 'no marker survives anywhere');
    const occurrences = all.split(ADDITIVE_HEADER).length - 1;
    assert.equal(occurrences, 3, 'each of the three markers expanded');
});

test('dryRun passes are left completely untouched', async () => {
    await withMarkerOn();
    const original = `keep ${ORIGINS_MARKER} exactly`;
    const chat = [sys(original)];
    handlePresetMarker({ chat, dryRun: true });

    assert.equal(chat[0].content, original, 'token-count probes must not be rewritten');
});

test('does nothing when the framework is disabled or in Custom Sysprompt Mode', async () => {
    for (const s of [{ enabled: false }, { customSysprompt: true }]) {
        setSettings({ presetMarkerEnabled: true, ...s });
        const original = `mine ${ORIGINS_MARKER}`;
        const chat = [sys(original)];
        handlePresetMarker({ chat });
        assert.equal(chat[0].content, original, 'the marker is the user\'s own text at that point');
    }
});

test('tolerates malformed input without throwing', async () => {
    await withMarkerOn();
    handlePresetMarker(undefined);
    handlePresetMarker({});
    handlePresetMarker({ chat: null });
    handlePresetMarker({ chat: [null, undefined, {}, { content: 42 }, { content: [{ type: 'text' }] }] });
});

// ── Missing-marker fallback ───────────────────────────────────────────────────

test('appends the rules to the first system message when the marker is missing', async () => {
    _resetMarkerWarning();
    await withMarkerOn();
    const chat = [
        { role: 'user', content: 'hello' },
        sys('preset system prompt with no marker'),
        sys('second system message'),
    ];
    handlePresetMarker({ chat });

    assert.ok(chat[1].content.includes(ADDITIVE_HEADER), 'rules land on the first system message');
    assert.ok(chat[1].content.startsWith('preset system prompt with no marker'), 'original content kept');
    assert.ok(!chat[2].content.includes(ADDITIVE_HEADER), 'only one message gets them');
    assert.ok(!chat[0].content.includes(ADDITIVE_HEADER), 'user messages untouched');
});

test('the missing-marker fallback does not fire when the marker is present', async () => {
    _resetMarkerWarning();
    await withMarkerOn();
    const chat = [sys(`has ${ORIGINS_MARKER}`), sys('other system message')];
    handlePresetMarker({ chat });

    assert.ok(!chat[1].content.includes(ADDITIVE_HEADER), 'no double delivery');
});

test('the missing-marker fallback does not fire while the feature is off', async () => {
    setSettings({ presetMarkerEnabled: false, syspromptDelivery: 'additive' });
    await applySysprompt();
    const chat = [sys('no marker anywhere')];
    handlePresetMarker({ chat });

    assert.equal(chat[0].content, 'no marker anywhere', 'additive delivery already covers this case');
});

test('the missing-marker toast fires once per session, the console warning every time', async () => {
    _resetMarkerWarning();
    await withMarkerOn();
    const realToastr = globalThis.toastr;
    const realWarn = console.warn;
    let toasts = 0;
    let warns = 0;
    globalThis.toastr = { warning: () => { toasts++; } };
    console.warn = () => { warns++; };
    try {
        handlePresetMarker({ chat: [sys('no marker')] });
        handlePresetMarker({ chat: [sys('still no marker')] });
        handlePresetMarker({ chat: [sys('and again')] });
    } finally {
        globalThis.toastr = realToastr;
        console.warn = realWarn;
    }

    assert.equal(toasts, 1, 'the toast must not nag on every turn');
    assert.equal(warns, 3, 'the console warning stays diagnosable');
});

// ── Budget accounting ─────────────────────────────────────────────────────────

test('markerPayloadTokens reports the cached rules size, 0 when there is nothing to inject', async () => {
    await withMarkerOn();
    assert.ok(markerPayloadTokens() > 100, 'a real ruleset is measured');

    setSettings({ enabled: false, presetMarkerEnabled: true });
    await applySysprompt();
    assert.equal(markerPayloadTokens(), 0, 'nothing cached, nothing charged');
});
