/**
 * Tests for the ((MARKER)) / ((MARKER:arg)) token system in renderer.js:
 * - legacy bare-form line-anchoring is unchanged (backward compatibility)
 * - the new inline colon-arg form works anywhere in a line
 * - the four new marker types: ((OBJ)), ((REWARD)), ((DIFFICULTY)), ((PROGRESS))
 * - the consolidated regex/type-map still drives blockToItems' entity-anchor sniffing
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tryRenderMarker, getDifficultyColor, blockToItems } from '../renderer.js';

test('legacy bare marker at line start still renders (unchanged behavior)', () => {
    const html = tryRenderMarker('((BAR)) Health: 45/100');
    assert.ok(html.includes('rt-hp-bar'), 'renders as a bar');
    assert.ok(html.includes('45') && html.includes('100'), 'shows the cur/max value');
});

test('bare marker NOT at line start is not treated as a marker at all', () => {
    const html = tryRenderMarker('Note: something ((BAR)) trailing text');
    assert.equal(html, null, 'falls through — no colon-arg means it must anchor the line');
});

test('inline colon-arg marker works with a label before it', () => {
    const html = tryRenderMarker('Health: ((BAR:45/100))');
    assert.ok(html.includes('rt-hp-bar'), 'renders as a bar');
    assert.ok(html.includes('Health'), 'label preserved');
    assert.ok(html.includes('45') && html.includes('100'), 'value parsed from the inline arg');
});

test('inline colon-arg marker appends trailing text as extra info', () => {
    const html = tryRenderMarker('((BAR:45/100)) (5 temp)');
    assert.ok(html.includes('45') && html.includes('100'));
    assert.ok(html.includes('5 temp'), 'trailing text appended, same convention as bare-form "extra"');
});

test('((OBJ)) defaults to active status with an open-circle glyph', () => {
    const html = tryRenderMarker('((OBJ)) Slay the dragon');
    assert.ok(html.includes('○'), 'active glyph');
    assert.ok(html.includes('Slay the dragon'));
    assert.ok(!html.includes('rt-marker-obj-done') && !html.includes('rt-marker-obj-failed'));
});

test('((OBJ:done)) renders a checkmark with the done state class', () => {
    const html = tryRenderMarker('((OBJ:done)) Rescue the villagers');
    assert.ok(html.includes('✓'));
    assert.ok(html.includes('rt-marker-obj-done'));
    assert.ok(html.includes('Rescue the villagers'));
});

test('((OBJ:failed)) renders an X with the failed state class', () => {
    const html = tryRenderMarker('((OBJ:failed)) Defend the keep');
    assert.ok(html.includes('✗'));
    assert.ok(html.includes('rt-marker-obj-failed'));
});

test('((OBJ)) mid-line (not at start) is not treated as a marker, even with a colon-arg', () => {
    const html = tryRenderMarker('Slay the dragon ((OBJ:done)) extra');
    assert.equal(html, null, 'objectives are a line-level concept, deliberately not inline-capable');
});

test('((REWARD)) and its alias ((RWD)) render a reward chip', () => {
    const a = tryRenderMarker('((REWARD)) 250 Gold');
    const b = tryRenderMarker('((RWD)) 250 Gold');
    assert.ok(a.includes('rt-reward-chip') && a.includes('250 Gold'));
    assert.ok(b.includes('rt-reward-chip') && b.includes('250 Gold'));
});

test('((REWARD:...)) works inline with no surrounding text', () => {
    const html = tryRenderMarker('((REWARD:250 Gold))');
    assert.ok(html.includes('rt-reward-chip') && html.includes('250 Gold'));
});

test('((DIFFICULTY)) color-codes known difficulty words and its alias ((DIFF)) matches', () => {
    const hard = tryRenderMarker('((DIFFICULTY)) Hard');
    assert.ok(hard.includes('rt-diff-badge'));
    assert.ok(hard.includes('HARD'));
    assert.ok(hard.includes(getDifficultyColor('Hard').bg));

    const diffAlias = tryRenderMarker('((DIFF)) Hard');
    assert.ok(diffAlias.includes('HARD'));
});

test('((DIFFICULTY)) falls back to a neutral badge for an unrecognized/custom string', () => {
    const html = tryRenderMarker('((DIFFICULTY)) Nightmare');
    assert.ok(html.includes('rt-diff-badge'));
    assert.ok(html.includes('NIGHTMARE'));
    const { bg } = getDifficultyColor('Nightmare');
    assert.equal(bg, 'rgba(120, 120, 120, 0.2)', 'unknown difficulty gets the gray fallback color');
});

test('getDifficultyColor is case-insensitive', () => {
    assert.equal(getDifficultyColor('very easy').bg, getDifficultyColor('Very Easy').bg);
    assert.equal(getDifficultyColor('VERY HARD').bg, getDifficultyColor('Very Hard').bg);
});

test('((PROGRESS)) and alias ((PRG)) render a labeled mini bar plus counter', () => {
    setSettings({});
    const bare = tryRenderMarker('((PROGRESS)) Mushrooms collected: 3/5', 'CHARACTER', 'Hero');
    assert.ok(bare.includes('rt-progress-bar'));
    assert.ok(bare.includes('3/5'));
    assert.ok(bare.includes('Mushrooms collected'));

    const inline = tryRenderMarker('Kills: ((PROGRESS:3/5))', 'CHARACTER', 'Hero');
    assert.ok(inline.includes('rt-progress-bar'));
    assert.ok(inline.includes('Kills'));
    assert.ok(inline.includes('3/5'));

    const alias = tryRenderMarker('((PRG)) 1/4', 'CHARACTER', 'Hero');
    assert.ok(alias.includes('rt-progress-bar'));
});

// ── Regression: consolidated blockToItems COMBAT/PARTY/CHARACTER loop ─────────

test('bare ((HP)) entity anchor still creates an entity row after the regex consolidation', () => {
    setSettings({});
    const items = blockToItems('COMBAT', '((HP)) Goblin: 4/12\nHealth: ((BAR:4/12))');
    const joined = items.join('');
    assert.ok(joined.includes('rt-entity-row'), 'entity row created from the bare ((HP)) anchor');
    assert.ok(joined.includes('Goblin'), 'entity name captured');
    assert.ok(joined.includes('rt-hp-bar'), 'follow-up inline marker line attaches as a sub-field bar');
});

test('classic "Name: X/Y HP" anchor (no marker at all) still works unchanged', () => {
    setSettings({});
    const items = blockToItems('COMBAT', 'Raider: 14/40 HP');
    const joined = items.join('');
    assert.ok(joined.includes('rt-entity-row'));
    assert.ok(joined.includes('Raider'));
});
