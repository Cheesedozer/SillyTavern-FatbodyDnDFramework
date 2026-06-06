/**
 * Characterization tests for memo-processor.js pure logic.
 * These LOCK current output before the refactor — any drift fails loudly.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mergeMemo,
    deduplicateMemo,
    computeDelta,
    parseQuestsFromText,
    parseQuestsFromMemo,
} from '../memo-processor.js';

test('mergeMemo replaces a matching block in place', () => {
    setSettings({ debugMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]\n\n[TIME]\nDay 1\n[/TIME]';
    const out = mergeMemo(cur, '[CHARACTER]\nHP 5/10\n[/CHARACTER]');
    assert.equal(out, '[CHARACTER]\nHP 5/10\n[/CHARACTER]\n\n[TIME]\nDay 1\n[/TIME]');
});

test('mergeMemo with no tags is a no-op (returns current memo unchanged)', () => {
    setSettings({ debugMode: false });
    assert.equal(mergeMemo('[X]\na\n[/X]', 'just prose, no tags'), '[X]\na\n[/X]');
});

test('mergeMemo REMOVED deletes the section', () => {
    setSettings({ debugMode: false });
    assert.equal(mergeMemo('[COMBAT]\nx\n[/COMBAT]', '[COMBAT]REMOVED[/COMBAT]'), '');
});

test('mergeMemo appends a brand-new section', () => {
    setSettings({ debugMode: false });
    const out = mergeMemo('[CHARACTER]\nHP 10\n[/CHARACTER]', '[INVENTORY]\nSword\n[/INVENTORY]');
    assert.equal(out, '[CHARACTER]\nHP 10\n[/CHARACTER]\n\n[INVENTORY]\nSword\n[/INVENTORY]');
});

test('mergeMemo recovers a section with a MISSING closing tag (to EOF)', () => {
    setSettings({ debugMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]';
    const out = mergeMemo(cur, '[CHARACTER]\nHP 5/10');
    assert.equal(out, '[CHARACTER]\nHP 5/10\n[/CHARACTER]');
});

test('mergeMemo recovery is bounded by the next known opening tag', () => {
    setSettings({ debugMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]\n\n[INVENTORY]\nRope\n[/INVENTORY]';
    // CHARACTER has no close; INVENTORY is well-formed and must not be swallowed.
    const out = mergeMemo(cur, '[CHARACTER]\nHP 5/10\n[INVENTORY]\nSword\n[/INVENTORY]');
    assert.match(out, /\[CHARACTER\]\nHP 5\/10\n\[\/CHARACTER\]/);
    assert.match(out, /\[INVENTORY\]\nSword\n\[\/INVENTORY\]/);
    assert.doesNotMatch(out, /Sword[\s\S]*HP 5/); // CHARACTER content didn't eat INVENTORY
});

test('mergeMemo does NOT treat stray brackets as block openers', () => {
    setSettings({ debugMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]';
    // [2/6] and [QUEST ACCEPTED] are narrative noise, not known tags.
    const out = mergeMemo(cur, 'Picked up mushrooms [4/6]. *[QUEST ACCEPTED]*');
    assert.equal(out, cur);
});

test('mergeMemo recovery is idempotent (re-merging its own output is stable)', () => {
    setSettings({ debugMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]';
    const once = mergeMemo(cur, '[CHARACTER]\nHP 5/10');
    const twice = mergeMemo(once, once);
    assert.equal(twice, once);
});

test('mergeMemo skips a malformed QUESTS diff in non-legacy mode', () => {
    setSettings({ debugMode: false, questLegacyMode: false });
    const cur = '[CHARACTER]\nHP 10/10\n[/CHARACTER]';
    // Missing close on a JSON-diff QUESTS block → unsafe to guess → dropped.
    const out = mergeMemo(cur, '[QUESTS]\n{"updates":[{"id":"q1","status":"completed"}]}');
    assert.equal(out, cur);
});

test('deduplicateMemo keeps the last duplicate', () => {
    setSettings({ debugMode: false });
    const out = deduplicateMemo('[A]\n1\n[/A]\n[A]\n2\n[/A]');
    assert.match(out, /\[A\]\n2\n\[\/A\]/);
    assert.equal((out.match(/\[A\]/g) || []).length, 1);
});

test('deduplicateMemo of empty input is empty string', () => {
    setSettings({ debugMode: false });
    assert.equal(deduplicateMemo(''), '');
});

test('computeDelta marks added and removed lines', () => {
    const d = computeDelta('a\nb', 'a\nc');
    assert.equal(d, '<div class="delta-removed">- b</div><div class="delta-added">+ c</div>');
});

test('computeDelta reports no changes', () => {
    assert.match(computeDelta('a\nb', 'b\na'), /No changes detected/);
});

test('parseQuestsFromText extracts objectives with inline progress/total', () => {
    setSettings({ debugMode: false });
    const q = parseQuestsFromText(
        'QUEST: Kill Wolves\n  ID: q1\n  STATUS: active\n  GIVER: Bob @ Town\n  OBJ_ACTIVE: Slay 6 wolves [2/6] (required)'
    );
    assert.equal(q.length, 1);
    assert.equal(q[0].title, 'Kill Wolves');
    assert.equal(q[0].id, 'q1');
    assert.equal(q[0].giver_name, 'Bob');
    assert.equal(q[0].giver_location, 'Town');
    assert.equal(q[0].objectives[0].text, 'Slay 6 wolves');
    assert.equal(q[0].objectives[0].progress, 2);
    assert.equal(q[0].objectives[0].total, 6);
    assert.equal(q[0].objectives[0].required, true);
    assert.equal(q[0].objectives[0].status, 'active');
});

test('parseQuestsFromMemo reads a JSON [QUESTS] block', () => {
    setSettings({ debugMode: false });
    const memo = '[TIME]\nDay 1\n[/TIME]\n\n[QUESTS]\n[{"id":"q9","title":"Fetch","status":"active"}]\n[/QUESTS]';
    const q = parseQuestsFromMemo(memo);
    assert.equal(q.length, 1);
    assert.equal(q[0].id, 'q9');
    assert.equal(q[0].title, 'Fetch');
});

test('parseQuestsFromMemo returns [] when no block present', () => {
    setSettings({ debugMode: false });
    assert.deepEqual(parseQuestsFromMemo('[TIME]\nDay 1\n[/TIME]'), []);
});
