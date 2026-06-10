/**
 * Regression guard for the skill tree empty-state overlay: #st-empty spans
 * the whole canvas, so an author `display` rule silently defeats the [hidden]
 * attribute and the overlay swallows every node click. These assertions pin
 * the two CSS lines that keep it inert and hideable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../skilltree/skilltree.css', import.meta.url)), 'utf8');

test('#st-empty never intercepts pointer events', () => {
    const rule = css.match(/#st-empty\s*\{[^}]*\}/);
    assert.ok(rule, '#st-empty rule exists');
    assert.ok(rule[0].includes('pointer-events: none'), 'overlay is click-through');
});

test('#st-empty respects the [hidden] attribute despite its display rule', () => {
    assert.ok(/#st-empty\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css), '[hidden] override present');
});
