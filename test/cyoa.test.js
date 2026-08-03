/**
 * Tests for CYOA mode: slot selection, the payload validator, the combat gate,
 * the resource whitelist, and when the SuggestChoices tool is offered. DOM-free
 * — the panel itself is only exercised by the manual SillyTavern smoke test.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CYOA_SLOTS,
    TOOL_NAME,
    activeSlots,
    validateChoices,
    isCombatActive,
    buildResourceWhitelist,
    buildChoiceInstructions,
    extractChoiceJson,
    registerSuggestChoicesTool,
    isChoiceToolRegistered,
    MAX_TEXT_LEN,
} from '../cyoa.js';

const good = (over = {}) => ({
    choices: [
        { slot: 'advance', text: 'Follow the steward through the servants\' door.', stake: 'You lose sight of the hall.' },
        { slot: 'diverge', text: 'Ask the scullery boy who else came through tonight.' },
        { slot: 'cost', text: 'Buy the guard\'s silence with the signet ring.', stake: 'The ring is your proof of birth.' },
    ],
    ...over,
});

// ── activeSlots ──────────────────────────────────────────────────────────────

test('activeSlots: defaults to three slots in canonical order', () => {
    assert.deepEqual(activeSlots(3).map(s => s.id), ['advance', 'diverge', 'cost']);
});

test('activeSlots: four adds the character slot', () => {
    assert.deepEqual(activeSlots(4).map(s => s.id), ['advance', 'diverge', 'cost', 'character']);
});

test('activeSlots: clamps out-of-range and garbage input', () => {
    assert.equal(activeSlots(0).length, 2);
    assert.equal(activeSlots(99).length, CYOA_SLOTS.length);
    assert.equal(activeSlots(undefined).length, 3);
    assert.equal(activeSlots('nonsense').length, 3);
});

// ── validateChoices ──────────────────────────────────────────────────────────

test('validateChoices: accepts a well-formed payload', () => {
    const res = validateChoices(good(), 3);
    assert.equal(res.ok, true, res.errors.join(' | '));
    assert.deepEqual(res.choices.map(c => c.slot), ['advance', 'diverge', 'cost']);
    assert.equal(res.choices[1].stake, ''); // omitted stake normalizes to ''
});

test('validateChoices: returns choices in canonical slot order regardless of input order', () => {
    const shuffled = { choices: [good().choices[2], good().choices[0], good().choices[1]] };
    const res = validateChoices(shuffled, 3);
    assert.equal(res.ok, true);
    assert.deepEqual(res.choices.map(c => c.slot), ['advance', 'diverge', 'cost']);
});

test('validateChoices: rejects a duplicated slot', () => {
    const payload = good();
    payload.choices[1].slot = 'advance';
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /more than once/.test(e)));
});

test('validateChoices: rejects a missing slot', () => {
    const payload = { choices: good().choices.slice(0, 2) };
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /Missing the "cost" slot/.test(e)));
});

test('validateChoices: rejects the wrong number of choices', () => {
    const res = validateChoices(good(), 4);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /Expected exactly 4/.test(e)));
});

test('validateChoices: rejects an unknown slot name', () => {
    const payload = good();
    payload.choices[0].slot = 'heroic';
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /Unknown slot "heroic"/.test(e)));
});

test('validateChoices: rejects empty text', () => {
    const payload = good();
    payload.choices[0].text = '   ';
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /empty text/.test(e)));
});

test('validateChoices: rejects over-long text', () => {
    const payload = good();
    payload.choices[0].text = 'x'.repeat(MAX_TEXT_LEN + 1);
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /keep it under/.test(e)));
});

// The whole point of the design: a choice may not tell the player how it ends.
for (const spoiler of [
    'Pick the lock (DC 15).',
    'Roll a d20 to vault the railing.',
    'Charm the innkeeper — you will succeed.',
    'Slip past the guards; you successfully reach the stair.',
]) {
    test(`validateChoices: rejects outcome disclosure — ${JSON.stringify(spoiler)}`, () => {
        const payload = good();
        payload.choices[0].text = spoiler;
        const res = validateChoices(payload, 3);
        assert.equal(res.ok, false);
        assert.ok(res.errors.some(e => /reveals an outcome/.test(e)), res.errors.join(' | '));
    });
}

// Regression: the outcome check must not swallow ordinary stake language. An
// earlier pattern matched a bare "you lose", killing valid clauses like these.
for (const legit of [
    'You lose sight of the hall.',
    'You lose your place in the queue.',
    'The rope will not survive a second descent.',
    'It costs you the morning.',
]) {
    test(`validateChoices: allows ordinary stake language — ${JSON.stringify(legit)}`, () => {
        const payload = good();
        payload.choices[0].stake = legit;
        const res = validateChoices(payload, 3);
        assert.equal(res.ok, true, res.errors.join(' | '));
    });
}

test('validateChoices: rejects outcome disclosure hidden in the stake clause', () => {
    const payload = good();
    payload.choices[0].stake = 'Fail this and you die.';
    const res = validateChoices(payload, 3);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /reveals an outcome/.test(e)));
});

test('validateChoices: rejects a non-array payload', () => {
    assert.equal(validateChoices(null, 3).ok, false);
    assert.equal(validateChoices({}, 3).ok, false);
    assert.equal(validateChoices({ choices: 'nope' }, 3).ok, false);
});

// ── isCombatActive ───────────────────────────────────────────────────────────

test('isCombatActive: true for a populated block', () => {
    assert.equal(isCombatActive('[COMBAT]\nCOMBAT ROUND 1\nGrak (Goblin): 8/8 HP\n[/COMBAT]'), true);
});

test('isCombatActive: false when absent, empty, or ended', () => {
    assert.equal(isCombatActive(''), false);
    assert.equal(isCombatActive(null), false);
    assert.equal(isCombatActive('[CHARACTER]\nName: Bel\n[/CHARACTER]'), false);
    assert.equal(isCombatActive('[COMBAT]\n\n[/COMBAT]'), false);
    assert.equal(isCombatActive('[COMBAT]END_COMBAT[/COMBAT]'), false);
    assert.equal(isCombatActive('[COMBAT]\nNONE\n[/COMBAT]'), false);
});

// ── buildResourceWhitelist ───────────────────────────────────────────────────

const MEMO = `[CHARACTER]
Name: Bel
[/CHARACTER]
[SPELLS]
- Hex
- Eldritch Blast
[/SPELLS]
[INVENTORY]
- Rope (50 ft)
- 12 GP
[/INVENTORY]`;

test('buildResourceWhitelist: extracts and flattens the tracked blocks', () => {
    const out = buildResourceWhitelist(MEMO);
    assert.match(out, /Spells: Hex; Eldritch Blast/);
    assert.match(out, /Inventory: Rope \(50 ft\); 12 GP/);
    assert.ok(!/Abilities:/.test(out), 'absent blocks produce no line');
});

test('buildResourceWhitelist: empty for an empty or blockless memo', () => {
    assert.equal(buildResourceWhitelist(''), '');
    assert.equal(buildResourceWhitelist(undefined), '');
    assert.equal(buildResourceWhitelist('[CHARACTER]\nName: Bel\n[/CHARACTER]'), '');
});

// ── buildChoiceInstructions ──────────────────────────────────────────────────

test('buildChoiceInstructions: names every active slot and carries the whitelist', () => {
    const out = buildChoiceInstructions(3, MEMO);
    for (const id of ['advance', 'diverge', 'cost']) assert.ok(out.includes(`"${id}"`), `missing ${id}`);
    assert.ok(!out.includes('"character"'), 'character slot must be absent at count 3');
    assert.match(out, /do not invent others/);
    assert.match(out, /Eldritch Blast/);
});

test('buildChoiceInstructions: omits the whitelist section when there is nothing to list', () => {
    assert.ok(!/do not invent others/.test(buildChoiceInstructions(3, '')));
});

// ── extractChoiceJson ────────────────────────────────────────────────────────

test('extractChoiceJson: reads a fenced block, bare JSON, and trailing commas', () => {
    const payload = '{"choices":[{"slot":"advance","text":"Go."}]}';
    assert.deepEqual(extractChoiceJson('```json\n' + payload + '\n```').choices.length, 1);
    assert.deepEqual(extractChoiceJson('Sure!\n' + payload).choices.length, 1);
    assert.deepEqual(extractChoiceJson('{"choices":[{"slot":"advance","text":"Go.",},]}').choices.length, 1);
});

test('extractChoiceJson: null on unparseable content', () => {
    assert.equal(extractChoiceJson('no json here'), null);
    assert.equal(extractChoiceJson(''), null);
});

// ── registerSuggestChoicesTool ───────────────────────────────────────────────
// The bootstrap context has no tool API, so swap in a recording one. Everything
// below is about *whether and how* the tool is offered, never the panel.

function withToolRecorder(settings, fn) {
    const calls = { registered: [], unregistered: [] };
    const base = globalThis.SillyTavern.getContext;
    setSettings(settings);
    globalThis.SillyTavern.getContext = () => ({
        ...base(),
        registerFunctionTool: (def) => calls.registered.push(def),
        unregisterFunctionTool: (name) => calls.unregistered.push(name),
    });
    try { fn(calls); } finally { globalThis.SillyTavern.getContext = base; }
}

const ENABLED = { enabled: true, syspromptModules: { cyoa: true }, cyoaChoiceCount: 3, currentMemo: MEMO };

test('registerSuggestChoicesTool: offers the tool with the active slots as an enum', () => {
    withToolRecorder({ ...ENABLED }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.equal(calls.registered.length, 1);
        const def = calls.registered[0];
        assert.equal(def.name, TOOL_NAME);
        const slotProp = def.parameters.properties.choices.items.properties.slot;
        assert.deepEqual(slotProp.enum, ['advance', 'diverge', 'cost']);
        // The whitelist has to ride along or the narrator can invent resources.
        assert.match(def.description, /Eldritch Blast/);
        // The tool-call message must stay out of the chat log.
        assert.equal(def.formatMessage(), '');
    });
});

test('registerSuggestChoicesTool: four choices widens the enum', () => {
    withToolRecorder({ ...ENABLED, cyoaChoiceCount: 4 }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.deepEqual(
            calls.registered[0].parameters.properties.choices.items.properties.slot.enum,
            ['advance', 'diverge', 'cost', 'character'],
        );
    });
});

// Regression (the PR #37 bug report): the registration gate must match the one
// buildSysprompt applies to <cyoa> EXACTLY. Combat is a rule inside the block and
// a panel state — gating registration on it too left the narrator ordered to call
// a tool that wasn't in the request, which is what produced the original failure.
test('registerSuggestChoicesTool: stays registered during combat', () => {
    withToolRecorder({ ...ENABLED, currentMemo: MEMO + '\n[COMBAT]\nGrak (Goblin): 8/8 HP\n[/COMBAT]' }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.equal(calls.registered.length, 1, 'combat must not desync the tool from the sysprompt block');
    });
});

test('registerSuggestChoicesTool: withdraws the tool when the module or framework is off', () => {
    withToolRecorder({ ...ENABLED, syspromptModules: { cyoa: false } }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.equal(calls.registered.length, 0);
        assert.deepEqual(calls.unregistered, [TOOL_NAME]);
    });
    withToolRecorder({ ...ENABLED, enabled: false }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.equal(calls.registered.length, 0);
    });
});

test('registerSuggestChoicesTool: unforced re-registration with no observable change is a no-op', () => {
    withToolRecorder({ ...ENABLED }, (calls) => {
        registerSuggestChoicesTool(true);
        registerSuggestChoicesTool();
        registerSuggestChoicesTool();
        assert.equal(calls.registered.length, 1, 'refreshRenderedView must not churn the tool');
    });
});

test('registerSuggestChoicesTool: an unforced call re-registers when the whitelist changes', () => {
    withToolRecorder({ ...ENABLED }, (calls) => {
        registerSuggestChoicesTool(true);
        assert.equal(calls.registered.length, 1);
        setSettings({ ...ENABLED, currentMemo: MEMO + '\n[ABILITIES]\n- Second Wind\n[/ABILITIES]' });
        registerSuggestChoicesTool();
        assert.equal(calls.registered.length, 2);
        assert.match(calls.registered[1].description, /Second Wind/);
    });
});

// Regression: the fingerprint used to be recorded before registerFunctionTool
// ran, so a throw cached a registration that never happened and every later
// unforced call short-circuited forever.
test('registerSuggestChoicesTool: a throwing registry call is retried, not cached', () => {
    const base = globalThis.SillyTavern.getContext;
    setSettings({ ...ENABLED });
    let attempts = 0;
    globalThis.SillyTavern.getContext = () => ({
        ...base(),
        unregisterFunctionTool: () => {},
        registerFunctionTool: () => { attempts++; throw new Error('registry unavailable'); },
    });
    try {
        registerSuggestChoicesTool(true);
        registerSuggestChoicesTool();   // unforced — must NOT be skipped
        registerSuggestChoicesTool();
        assert.equal(attempts, 3, 'a failed registration must not be cached as done');
    } finally {
        globalThis.SillyTavern.getContext = base;
    }
});

// ── Panel states ─────────────────────────────────────────────────────────────
// An empty panel used to look identical whether the narrator stayed silent or
// answered and had the answer thrown away. That ambiguity is what made the
// original bug report hard to diagnose, so the three states must read apart.

test('renderChoicePanel: the three empty states are distinguishable', async () => {
    const { renderChoicePanel } = await import('../renderer.js');

    const pending = renderChoicePanel(null, { status: { state: 'pending' } });
    assert.match(pending, /arrive with the narrator/);

    const silent = renderChoicePanel(null, { status: { state: 'silent' } });
    assert.match(silent, /didn't offer choices this turn/);
    assert.match(silent, /auto-fallback/, 'must point at the setting that fixes it');

    const rejected = renderChoicePanel(null, {
        status: { state: 'rejected', errors: ['Missing the "cost" slot.'] },
    });
    assert.match(rejected, /didn't pass validation/);
    assert.match(rejected, /Missing the &quot;cost&quot; slot\./, 'reasons must be shown, and escaped');

    for (const html of [pending, silent, rejected]) {
        assert.match(html, /rt-cyoa-regen/, 'every empty state needs a way out');
    }
});

test('renderChoicePanel: combat state overrides everything and offers no reroll', async () => {
    const { renderChoicePanel } = await import('../renderer.js');
    const html = renderChoicePanel(null, { combat: true, status: { state: 'silent' } });
    assert.match(html, /paused during combat/);
    assert.ok(!/rt-cyoa-regen/.test(html));
});

test('renderChoicePanel: names an unregistered tool as the cause', async () => {
    const { renderChoicePanel } = await import('../renderer.js');
    const html = renderChoicePanel(null, { status: { state: 'silent' }, toolRegistered: false });
    assert.match(html, /failed to register/);
    assert.ok(!/crowd out the tool call/.test(html), 'must not blame the preset when the tool was never offered');
});

test('isChoiceToolRegistered: tracks the last successful registration', () => {
    withToolRecorder({ ...ENABLED }, () => {
        registerSuggestChoicesTool(true);
        assert.equal(isChoiceToolRegistered(), true);
    });
    withToolRecorder({ ...ENABLED, syspromptModules: { cyoa: false } }, () => {
        registerSuggestChoicesTool(true);
        assert.equal(isChoiceToolRegistered(), false);
    });
});
