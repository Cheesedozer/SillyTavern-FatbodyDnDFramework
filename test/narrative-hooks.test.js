/**
 * Characterization tests for the RNG engine in narrative-hooks.js.
 * Locks the [RNG_QUEUE v6.0_PROPER] byte-format and queue SHAPE (not random
 * values) — this format is part of the Megumin Suite contract.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRngBlock, makeRngQueue, RNG_QUEUE_LEN, rollDie } from '../narrative-hooks.js';

test('buildRngBlock format is byte-stable except for turn_id', () => {
    const queue = [{ d20: 7, d4: 2, d6: 5, d8: 1, d10: 9, d12: 11 }];
    const block = buildRngBlock(queue);
    assert.match(
        block,
        /^\[RNG_QUEUE v6\.0_PROPER\]\nturn_id=\d+\nscope=this_response\nqueue=\[7\(d4:2,d6:5,d8:1,d10:9,d12:11\)\]\n\[\/RNG_QUEUE\]\n\n$/
    );
});

test('buildRngBlock joins multiple entries with ", "', () => {
    const queue = [
        { d20: 1, d4: 1, d6: 1, d8: 1, d10: 1, d12: 1 },
        { d20: 2, d4: 2, d6: 2, d8: 2, d10: 2, d12: 2 },
    ];
    const block = buildRngBlock(queue);
    assert.match(block, /queue=\[1\(d4:1,d6:1,d8:1,d10:1,d12:1\), 2\(d4:2,d6:2,d8:2,d10:2,d12:2\)\]/);
});

test('makeRngQueue yields N entries with all six die fields in range', () => {
    const q = makeRngQueue(RNG_QUEUE_LEN);
    assert.equal(q.length, RNG_QUEUE_LEN);
    const dice = [['d20', 20], ['d4', 4], ['d6', 6], ['d8', 8], ['d10', 10], ['d12', 12]];
    for (const row of q) {
        for (const [k, max] of dice) {
            assert.ok(Number.isInteger(row[k]) && row[k] >= 1 && row[k] <= max, `${k} out of range: ${row[k]}`);
        }
    }
});

test('RNG_QUEUE_LEN is 12 (contract length)', () => {
    assert.equal(RNG_QUEUE_LEN, 12);
});

test('rollDie stays within [1, sides]', () => {
    for (let i = 0; i < 500; i++) {
        const v = rollDie(6);
        assert.ok(v >= 1 && v <= 6, `rollDie(6) returned ${v}`);
    }
});

// ── Dice profiles (v3.0) ───────────────────────────────────────────────────────

test('DICE_PROFILES.dnd produces the exact historical queue shape and block format', async () => {
    const { DICE_PROFILES } = await import('../narrative-hooks.js');
    const q = makeRngQueue(2, DICE_PROFILES.dnd);
    assert.equal(q.length, 2);
    for (const entry of q) {
        assert.deepEqual(Object.keys(entry), ['d20', 'd4', 'd6', 'd8', 'd10', 'd12'], 'key order matches historical shape');
    }
    const block = buildRngBlock([{ d20: 7, d4: 2, d6: 5, d8: 1, d10: 9, d12: 11 }], DICE_PROFILES.dnd);
    assert.match(block, /queue=\[7\(d4:2,d6:5,d8:1,d10:9,d12:11\)\]/, 'explicit profile is byte-identical to the default');
});

test('custom (Modern) profiles drive queue composition and block format', async () => {
    const { profileFromFoundation } = await import('../narrative-hooks.js');
    const profile = profileFromFoundation({ primary: 'd100', subdice: ['d10', 'd20'], queueLen: 6 });
    assert.deepEqual(profile, { primary: 'd100', subdice: ['d10', 'd20'], queueLen: 6 });

    const q = makeRngQueue(profile.queueLen, profile);
    assert.equal(q.length, 6);
    for (const entry of q) {
        assert.ok(entry.d100 >= 1 && entry.d100 <= 100);
        assert.ok(entry.d10 >= 1 && entry.d10 <= 10);
        assert.ok(entry.d20 >= 1 && entry.d20 <= 20);
    }
    const block = buildRngBlock([{ d100: 73, d10: 4, d20: 18 }], profile);
    assert.match(block, /queue=\[73\(d10:4,d20:18\)\]/);

    // primary-only profile renders bare numbers
    const solo = profileFromFoundation({ primary: 'd100', subdice: [] });
    assert.match(buildRngBlock([{ d100: 42 }], solo), /queue=\[42\]/);
});

test('profileFromFoundation falls back to D&D on malformed input', async () => {
    const { profileFromFoundation, DICE_PROFILES } = await import('../narrative-hooks.js');
    assert.deepEqual(profileFromFoundation(null), DICE_PROFILES.dnd);
    assert.deepEqual(profileFromFoundation({ primary: 'twenty' }), DICE_PROFILES.dnd);
    const cleaned = profileFromFoundation({ primary: 'd100', subdice: ['d10', 'bogus', 'd100'], queueLen: 999 });
    assert.deepEqual(cleaned, { primary: 'd100', subdice: ['d10'], queueLen: 12 }, 'junk subdice/queueLen sanitized');
});

// ── Dice function-tool formula validation ─────────────────────────────────────
//
// The slash command is human-driven and may prompt or toast; a tool call cannot.
// Anything unrollable has to come back as an error string, because the previous
// behavior — doDiceRoll returning { total: '' } and the action coercing it with
// `parseInt(...) || 0` — handed the model a 0 it narrates as a critical failure.

test('validateToolDiceFormula rejects the "custom" sentinel instead of prompting', async () => {
    const { validateToolDiceFormula } = await import('../narrative-hooks.js');
    for (const v of ['custom', 'Custom', ' CUSTOM ']) {
        const r = validateToolDiceFormula(v);
        assert.equal(r.ok, false);
        assert.match(r.error, /not a dice formula/);
    }
});

test('validateToolDiceFormula rejects missing and non-string formulas', async () => {
    const { validateToolDiceFormula } = await import('../narrative-hooks.js');
    for (const v of ['', '   ', null, undefined, 42, {}]) {
        assert.equal(validateToolDiceFormula(v).ok, false);
    }
    assert.match(validateToolDiceFormula('').error, /No dice formula was provided/);
});

test('validateToolDiceFormula rejects out-of-range dice before touching droll', async () => {
    const { validateToolDiceFormula } = await import('../narrative-hooks.js');
    // droll is absent from the test stub, so reaching it would give the library
    // error instead — matching on the range message proves the order of checks.
    assert.match(validateToolDiceFormula('101d6').error, /out of range/);
    assert.match(validateToolDiceFormula('1d1001').error, /out of range/);
});

test('validateToolDiceFormula reports a missing dice library rather than rolling 0', async () => {
    const { validateToolDiceFormula } = await import('../narrative-hooks.js');
    const r = validateToolDiceFormula('1d20');
    assert.equal(r.ok, false);
    assert.match(r.error, /dice library is unavailable/);
    assert.match(r.error, /Do not report a numeric result/);
});

test('validateToolDiceFormula accepts valid formulas and rejects junk via droll', async () => {
    const { validateToolDiceFormula } = await import('../narrative-hooks.js');
    const prevLibs = globalThis.SillyTavern.libs;
    globalThis.SillyTavern.libs = { droll: { validate: (v) => /^\d*d\d+([+-]\d+)?$/.test(v) } };
    try {
        assert.deepEqual(validateToolDiceFormula(' 2d6+3 '), { ok: true, value: '2d6+3' });
        assert.deepEqual(validateToolDiceFormula('1d20'), { ok: true, value: '1d20' });
        const bad = validateToolDiceFormula('roll me a good one');
        assert.equal(bad.ok, false);
        assert.match(bad.error, /is not a valid dice formula/);
    } finally {
        globalThis.SillyTavern.libs = prevLibs;
    }
});
