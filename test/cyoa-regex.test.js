/**
 * Tests for the managed SillyTavern regex scripts (cyoa-regex.js): what gets
 * written into extension_settings.regex, and — by running the patterns the way
 * ST would — that the three stages actually turn a narrator's <choices> block
 * into the styled box.
 *
 * The pattern tests matter more than they look. The scripts are strings the
 * framework hands to another extension, so nothing else in this repo would ever
 * catch a regex that silently stops matching.
 */
import './_bootstrap.js';
import { setSettings, rawStore } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCyoaRegexScripts, buildCyoaScripts, areCyoaScriptsInstalled } from '../cyoa-regex.js';

const ENABLED = { enabled: true, syspromptModules: { cyoa: true }, cyoaChoiceCount: 3, cyoaCleanupDepth: 4 };

/** Seeds settings and clears any regex list left behind by a previous test. */
function seed(over = {}) {
    setSettings({ ...ENABLED, ...over });
    rawStore().regex = [];
}

/**
 * Changes settings mid-test without losing the installed scripts. The bootstrap's
 * setSettings() replaces the whole extension_settings store; ST only ever mutates
 * the rpg_tracker key, so carrying `regex` across is what makes these tests model
 * the real thing rather than a store that resets under them.
 */
function reseed(over = {}) {
    const regex = rawStore().regex;
    setSettings({ ...ENABLED, ...over });
    rawStore().regex = regex;
}

/** The framework's own entries, in the order ST would apply them. */
function ours() {
    return (rawStore().regex || []).filter(e => String(e.id).startsWith('origins-cyoa-'));
}

/** ST parses `/pattern/flags` out of a script's findRegex — mirror that here. */
function toRegExp(findRegex) {
    const m = String(findRegex).match(/^\/(.+)\/([a-z]*)$/s);
    assert.ok(m, `findRegex must be in /pattern/flags form so ST applies the flags: ${findRegex}`);
    return new RegExp(m[1], m[2]);
}

/** Runs a script list over a message the way ST's getRegexedString does. */
function applyScripts(scripts, text) {
    return scripts.reduce((acc, s) => acc.replace(toRegExp(s.findRegex), s.replaceString), text);
}

const BLOCK = [
    '<choices>',
    'advance | Follow the steward through the door. | You lose sight of the hall.',
    'diverge | Ask the scullery boy who else came through. |',
    'cost | Buy the guard\'s silence with the ring. | The ring is your proof of birth.',
    '</choices>',
].join('\n');

const MESSAGE = `The steward holds the door, saying nothing.\n\n*Level 3 | 09:12 AM, Day 4*\n\n${BLOCK}`;

// ── Installation lifecycle ───────────────────────────────────────────────────

test('syncCyoaRegexScripts: installs the three stages in application order', () => {
    seed();
    syncCyoaRegexScripts(true);

    const ids = ours().map(e => e.id);
    assert.deepEqual(ids, [
        'origins-cyoa-cleanup-1f4c0e30',
        'origins-cyoa-rows-1f4c0e31',
        'origins-cyoa-box-1f4c0e32',
    ], 'the stages are only correct in sequence');
    assert.equal(areCyoaScriptsInstalled(), true);
});

test('syncCyoaRegexScripts: every entry targets AI output and survives edits', () => {
    seed();
    syncCyoaRegexScripts(true);
    for (const entry of ours()) {
        assert.deepEqual(entry.placement, [2], 'placement 2 = AI_OUTPUT');
        assert.equal(entry.disabled, false);
        assert.equal(entry.runOnEdit, true);
        assert.equal(entry.substituteRegex, 0);
    }
});

// Load-bearing: cyoa.js reads the block straight out of msg.mes, so no script
// may ever rewrite the stored message. markdownOnly/promptOnly are what keep
// ST's rewrites confined to the display and prompt copies.
test('syncCyoaRegexScripts: no script rewrites the stored message', () => {
    seed();
    syncCyoaRegexScripts(true);
    for (const entry of ours()) {
        assert.ok(entry.markdownOnly || entry.promptOnly, `${entry.id} would rewrite msg.mes`);
    }
});

test('syncCyoaRegexScripts: only cleanup touches the prompt, and only past the cutoff', () => {
    seed({ cyoaCleanupDepth: 8 });
    syncCyoaRegexScripts(true);
    const [cleanup, rows, box] = ours();

    assert.equal(cleanup.promptOnly, true, 'stale blocks must leave the context, not just the view');
    assert.equal(cleanup.minDepth, 8);
    // The recent blocks stay in the prompt on purpose: they show the narrator
    // the format it is meant to produce.
    for (const entry of [rows, box]) {
        assert.equal(entry.promptOnly, false, 'the styled box is a view, never prompt content');
    }
});

// Re-syncing on every settings change and every render is the normal case; a
// fourth copy per change would be a slow-motion settings leak.
test('syncCyoaRegexScripts: a re-sync upgrades in place instead of appending', () => {
    seed();
    syncCyoaRegexScripts(true);
    syncCyoaRegexScripts(true);
    syncCyoaRegexScripts(true);
    assert.equal(ours().length, 3);
});

test('syncCyoaRegexScripts: preserves scripts the framework does not own', () => {
    seed();
    rawStore().regex = [{ id: 'user-script', scriptName: 'Mine', findRegex: '/x/g', replaceString: '' }];
    syncCyoaRegexScripts(true);
    assert.equal(rawStore().regex.filter(e => e.id === 'user-script').length, 1);

    reseed({ syspromptModules: { cyoa: false } });
    syncCyoaRegexScripts(true);
    assert.deepEqual(rawStore().regex.map(e => e.id), ['user-script']);
});

test('syncCyoaRegexScripts: removes everything when the module or framework is off', () => {
    for (const off of [{ syspromptModules: { cyoa: false } }, { enabled: false }]) {
        seed();
        syncCyoaRegexScripts(true);
        assert.equal(ours().length, 3);

        reseed(off);
        syncCyoaRegexScripts(true);
        assert.equal(ours().length, 0);
        assert.equal(areCyoaScriptsInstalled(), false);
    }
});

test('syncCyoaRegexScripts: an unforced re-sync with no observable change is a no-op', () => {
    seed();
    syncCyoaRegexScripts(true);
    rawStore().regex = [];          // stand in for "nothing changed, so nothing was written"
    syncCyoaRegexScripts();
    syncCyoaRegexScripts();
    assert.equal(ours().length, 0, 'refreshRenderedView must not rewrite settings on every render');

    reseed({ cyoaChoiceCount: 4 });
    syncCyoaRegexScripts();
    assert.equal(ours().length, 3, 'a changed slot count must re-sync unforced');
});

// Regression, carried over from the tool registration this replaced: a
// fingerprint recorded before the write survives a throw, and every later
// unforced call then short-circuits on a sync that never happened.
test('syncCyoaRegexScripts: a throwing save is retried, not cached', () => {
    const base = globalThis.SillyTavern.getContext;
    seed();
    let attempts = 0;
    globalThis.SillyTavern.getContext = () => ({
        ...base(),
        saveSettingsDebounced() { attempts++; throw new Error('settings unavailable'); },
    });
    try {
        syncCyoaRegexScripts(true);
        syncCyoaRegexScripts();     // unforced — must NOT be skipped
        syncCyoaRegexScripts();
        assert.equal(attempts, 3, 'a failed sync must not be cached as done');
    } finally {
        globalThis.SillyTavern.getContext = base;
    }
});

// ── The patterns themselves ──────────────────────────────────────────────────

test('the display stages turn a block into the styled box', () => {
    const [, rows, box] = buildCyoaScripts(ENABLED);
    const html = applyScripts([rows, box], MESSAGE);

    assert.match(html, /<div class="rt-cyoa-block">/);
    assert.equal((html.match(/rt-cyoa-row"/g) || []).length, 3, 'one row per option');
    assert.match(html, /data-slot="advance"/);
    assert.match(html, /<span class="rt-cyoa-row-text">Follow the steward through the door\.<\/span>/);
    assert.match(html, /<span class="rt-cyoa-row-stake">You lose sight of the hall\.<\/span>/);
    assert.match(html, /The steward holds the door/, 'the prose is untouched');
    assert.ok(!/<choices>/.test(html), 'the raw tags must not survive');
});

test('the row stage leaves an omitted stake empty rather than dropping the row', () => {
    const [, rows] = buildCyoaScripts(ENABLED);
    const html = applyScripts([rows], 'diverge | Ask the scullery boy. |');
    assert.match(html, /<span class="rt-cyoa-row-stake"><\/span>/, 'CSS collapses :empty; a missing row would not');

    const noPipe = applyScripts([rows], 'diverge | Ask the scullery boy.');
    assert.match(noPipe, /rt-cyoa-row-text">Ask the scullery boy\.</);
});

// Splitting the render across three scripts is what buys this: one
// all-or-nothing regex would fail to match and leave raw markup on screen.
test('the row stage still styles a block with the wrong number of options', () => {
    const [, rows, box] = buildCyoaScripts(ENABLED);
    const html = applyScripts([rows, box], '<choices>\nadvance | Only one. |\n</choices>');
    assert.equal((html.match(/rt-cyoa-row"/g) || []).length, 1);
    assert.match(html, /<div class="rt-cyoa-block">/);
});

test('the row stage only matches configured slots', () => {
    const [, rows] = buildCyoaScripts({ ...ENABLED, cyoaChoiceCount: 3 });
    // `character` is the 4th slot — inactive at count 3, so it must pass through.
    assert.ok(!/rt-cyoa-row/.test(applyScripts([rows], 'character | Act on who you are. |')));
    // And ordinary prose that happens to contain a pipe is not a choice line.
    assert.ok(!/rt-cyoa-row/.test(applyScripts([rows], 'She advanced | slowly | into the hall.')));
});

test('the row stage widens with the choice count', () => {
    const [, rows] = buildCyoaScripts({ ...ENABLED, cyoaChoiceCount: 4 });
    assert.match(applyScripts([rows], 'character | Act on who you are. |'), /data-slot="character"/);
});

test('the cleanup stage removes the block and the blank line before it', () => {
    const [cleanup] = buildCyoaScripts(ENABLED);
    const out = applyScripts([cleanup], MESSAGE);
    assert.ok(!/<choices>|advance \|/.test(out), out);
    assert.equal(out, 'The steward holds the door, saying nothing.\n\n*Level 3 | 09:12 AM, Day 4*');
});

test('the cleanup stage matches the <cyoa> alias the parser also accepts', () => {
    const [cleanup] = buildCyoaScripts(ENABLED);
    const out = applyScripts([cleanup], 'prose\n<cyoa>\nadvance | Go. |\n</cyoa>');
    assert.equal(out, 'prose');
});

test('the cleanup depth is clamped to at least one message back', () => {
    // Depth 0 would strip the block from the turn that just produced it.
    assert.equal(buildCyoaScripts({ ...ENABLED, cyoaCleanupDepth: 0 })[0].minDepth, 1);
    assert.equal(buildCyoaScripts({ ...ENABLED, cyoaCleanupDepth: undefined })[0].minDepth, 4);
});
