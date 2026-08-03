/**
 * Tests for CYOA mode: slot selection, the payload validator, the combat gate,
 * the resource whitelist, and the parser that reads the narrator's <choices>
 * block back out of its message. DOM-free — the panel itself is only exercised
 * by the manual SillyTavern smoke test.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CYOA_SLOTS,
    activeSlots,
    validateChoices,
    isCombatActive,
    buildResourceWhitelist,
    buildChoiceInstructions,
    extractChoiceJson,
    parseChoiceBlock,
    stripChoiceBlock,
    ingestNarratorMessage,
    getChoicesForChat,
    getChoiceStatus,
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

test('buildChoiceInstructions: names every active slot', () => {
    const out = buildChoiceInstructions(3);
    for (const id of ['advance', 'diverge', 'cost']) assert.ok(out.includes(`\`${id}\``), `missing ${id}`);
    assert.ok(!out.includes('`character`'), 'character slot must be absent at count 3');
    assert.match(out, /exactly 3 lines/);
});

// Regression: the whitelist used to ride in the tool description, which was
// rebuilt every turn. It now rides in the sysprompt, where it would be a stale
// snapshot on every request — so it was pulled out and the rule points at the
// live State Memo the interceptor already ships instead.
test('buildChoiceInstructions: carries no resource whitelist', () => {
    const out = buildChoiceInstructions(3);
    assert.ok(!/Eldritch Blast/.test(out), 'no memo contents may be baked into the sysprompt');
    assert.match(out, /not in the State Memo/);
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

// ── parseChoiceBlock ─────────────────────────────────────────────────────────
// The narrator writes the choices as text at the bottom of its own message.
// parseChoiceBlock hands validateChoices the same shape the old function tool
// used to deliver, so every rule above applies to this path unchanged.

const PROSE = 'The steward holds the door, saying nothing.\n\n*Level 3 | 09:12 AM, Day 4*\n\n';

test('parseChoiceBlock: reads slot, text, and stake off each line', () => {
    const parsed = parseChoiceBlock(PROSE + [
        '<choices>',
        'advance | Follow the steward through the door. | You lose sight of the hall.',
        'diverge | Ask the scullery boy who else came through. |',
        'cost | Buy the guard\'s silence with the signet ring. | The ring is your proof of birth.',
        '</choices>',
    ].join('\n'));

    assert.deepEqual(parsed.choices.map(c => c.slot), ['advance', 'diverge', 'cost']);
    assert.equal(parsed.choices[0].text, 'Follow the steward through the door.');
    assert.equal(parsed.choices[0].stake, 'You lose sight of the hall.');
    assert.equal(parsed.choices[1].stake, '', 'an empty trailing field is a missing stake, not a parse error');
    assert.equal(validateChoices(parsed, 3).ok, true);
});

test('parseChoiceBlock: tolerates a missing stake field entirely', () => {
    const parsed = parseChoiceBlock('<choices>\nadvance | Push the door open.\n</choices>');
    assert.equal(parsed.choices[0].text, 'Push the door open.');
    assert.equal(parsed.choices[0].stake, '');
});

// Models reach for the sysprompt block's own tag name. Cheaper to accept it
// than to lose a whole turn's choices to it.
test('parseChoiceBlock: accepts <cyoa> as an alias for <choices>', () => {
    const parsed = parseChoiceBlock('<cyoa>\nadvance | Go through. | It shuts behind you.\n</cyoa>');
    assert.equal(parsed.choices[0].slot, 'advance');
    assert.equal(parsed.choices[0].stake, 'It shuts behind you.');
});

test('parseChoiceBlock: normalizes casing, indentation, and list bullets', () => {
    const parsed = parseChoiceBlock('  <choices>\n  - Advance | Go. | Now.\n  * DIVERGE | Wait. |\n  </choices>');
    assert.deepEqual(parsed.choices.map(c => c.slot), ['advance', 'diverge']);
    assert.equal(parsed.choices[0].text, 'Go.');
});

test('parseChoiceBlock: a literal pipe in the stake stays in the stake', () => {
    const parsed = parseChoiceBlock('<choices>\ncost | Pay the toll. | 5 GP | half your purse\n</choices>');
    assert.equal(parsed.choices[0].text, 'Pay the toll.');
    assert.equal(parsed.choices[0].stake, '5 GP | half your purse');
});

// A narrator that emits two blocks has restated itself; the later one belongs
// to the scene it actually finished on.
test('parseChoiceBlock: the last block wins', () => {
    const parsed = parseChoiceBlock(
        '<choices>\nadvance | Old option. |\n</choices>\nthen more prose\n<choices>\nadvance | New option. |\n</choices>',
    );
    assert.equal(parsed.choices.length, 1);
    assert.equal(parsed.choices[0].text, 'New option.');
});

test('parseChoiceBlock: null when there is no block at all', () => {
    assert.equal(parseChoiceBlock(PROSE), null);
    assert.equal(parseChoiceBlock(''), null);
    assert.equal(parseChoiceBlock(undefined), null);
});

// Regression: a module-level /g regex carries lastIndex between calls, which
// makes every second parse of the same text return null.
test('parseChoiceBlock: repeated calls on the same text are stable', () => {
    const msg = '<choices>\nadvance | Go. |\n</choices>';
    assert.ok(parseChoiceBlock(msg));
    assert.ok(parseChoiceBlock(msg), 'the block regex must not carry lastIndex between calls');
    assert.ok(parseChoiceBlock(msg));
});

// ── stripChoiceBlock ─────────────────────────────────────────────────────────
// The block is UI data the narrator happens to write inline. Left in, the state
// pass reads offered options as things that happened.

test('stripChoiceBlock: removes every block and leaves the prose', () => {
    const out = stripChoiceBlock(PROSE + '<choices>\nadvance | Go. |\n</choices>\ntail\n<cyoa>\ncost | Pay. |\n</cyoa>');
    assert.ok(!/choices|advance|cost/i.test(out), out);
    assert.match(out, /The steward holds the door/);
    assert.match(out, /tail/);
});

test('stripChoiceBlock: leaves a blockless message untouched', () => {
    assert.equal(stripChoiceBlock(PROSE), PROSE);
    assert.equal(stripChoiceBlock(''), '');
});

// ── ingestNarratorMessage ────────────────────────────────────────────────────
// The replacement for the old tool's action callback: same three outcomes.

const ENABLED = { enabled: true, syspromptModules: { cyoa: true }, cyoaChoiceCount: 3, chatStates: {} };

/** The bootstrap context reports an empty chat, so the tail stamp is (-1, 0). */
function seed(settings = {}) {
    setSettings({ ...ENABLED, ...settings });
}

test('ingestNarratorMessage: stores a valid block against the chat', () => {
    seed();
    const ok = ingestNarratorMessage('chat-a', PROSE + [
        '<choices>',
        'advance | Follow the steward through the door. | You lose sight of the hall.',
        'diverge | Ask the scullery boy who else came through. |',
        'cost | Buy the guard\'s silence with the ring. | The ring is your proof of birth.',
        '</choices>',
    ].join('\n'));

    assert.equal(ok, true);
    assert.deepEqual(getChoicesForChat('chat-a').map(c => c.slot), ['advance', 'diverge', 'cost']);
});

// An empty panel gives the player no way to tell "the narrator wrote nothing"
// from "it wrote something and we threw it away". Those must read apart.
test('ingestNarratorMessage: records a rejection when the block is malformed', () => {
    seed();
    const ok = ingestNarratorMessage('chat-b', '<choices>\nadvance | Only one option. |\n</choices>');

    assert.equal(ok, true);
    assert.equal(getChoicesForChat('chat-b'), null);
    const status = getChoiceStatus('chat-b');
    assert.equal(status.state, 'rejected');
    assert.ok(status.errors.some(e => /Expected exactly 3/.test(e)), status.errors.join(' | '));
});

test('ingestNarratorMessage: a message with no block writes nothing at all', () => {
    seed();
    assert.equal(ingestNarratorMessage('chat-c', PROSE), false);
    // Not 'silent' either — classifying the turn is reconcileAfterTurn's job,
    // and it must still see an untouched slot to do it.
    assert.equal(getChoiceStatus('chat-c').state, 'pending');
});

test('ingestNarratorMessage: honours the live choice count', () => {
    seed({ cyoaChoiceCount: 4 });
    ingestNarratorMessage('chat-d', [
        '<choices>',
        'advance | Follow the steward. |',
        'diverge | Ask the scullery boy. |',
        'cost | Buy the guard\'s silence. |',
        'character | Refuse, the way your father would have. |',
        '</choices>',
    ].join('\n'));
    assert.equal(getChoicesForChat('chat-d').length, 4);
});

test('ingestNarratorMessage: no chat id is a no-op', () => {
    seed();
    assert.equal(ingestNarratorMessage('', '<choices>\nadvance | Go. |\n</choices>'), false);
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
