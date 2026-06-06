/**
 * Tests for the injection budget that prevents Fatbody's injected context
 * (state memo + lore + RNG) from crowding out the model's reply — the root cause
 * of the intermittent blank responses under Chat-Linked Mode.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, trimMemoToBudget, TOKEN_CHARS_PER_TOKEN, budgetInjections, OUTPUT_HEADROOM_FRAC } from '../memo-processor.js';

const MARKER = '…(state memo trimmed';

test('estimateTokens: empty is 0 and grows with length', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.ok(estimateTokens('x'.repeat(262)) >= estimateTokens('x'.repeat(26)));
    assert.equal(estimateTokens('x'.repeat(262)), Math.ceil(262 / TOKEN_CHARS_PER_TOKEN));
});

test('budgetInjections: no context signal injects everything (legacy behavior)', () => {
    const items = [
        { name: 'RNG', tier: 0, text: 'AAA' },
        { name: 'STATE MEMO', tier: 5, text: 'BBB', trimmable: true },
    ];
    const r = budgetInjections({ contextSize: 0, chatTokens: 0, items });
    assert.equal(r.injections, 'AAABBB');
    assert.deepEqual(r.dropped, []);
    assert.equal(r.trimmed, false);
});

test('budgetInjections: everything fits → concatenated in original order, nothing dropped', () => {
    const items = [
        { name: 'RNG', tier: 0, text: 'r' },
        { name: 'STATE MEMO', tier: 5, text: 'm', trimmable: true },
        { name: 'quests', tier: 1, text: 'q' },
        { name: 'lore', tier: 2, text: 'l' },
    ];
    const r = budgetInjections({ contextSize: 10000, chatTokens: 0, items });
    assert.equal(r.injections, 'rmql');   // preserves array (output) order
    assert.deepEqual(r.dropped, []);
    assert.equal(r.trimmed, false);
});

test('budgetInjections: RNG (tier 0) is never dropped, even when over budget', () => {
    const items = [
        { name: 'RNG', tier: 0, text: 'RNGBLOCK' },
        { name: 'STATE MEMO', tier: 5, text: 'x'.repeat(5000), trimmable: true },
    ];
    // Huge chat already fills the window → budget is negative.
    const r = budgetInjections({ contextSize: 100, chatTokens: 1000, items });
    assert.ok(r.injections.includes('RNGBLOCK'));
    assert.ok(r.dropped.includes('STATE MEMO'));
    assert.equal(r.trimmed, false);
});

test('budgetInjections: drops lower-priority lore before higher-priority segments', () => {
    const bigLore = 'L'.repeat(4000);   // ~1527 tokens — will not fit
    const items = [
        { name: 'RNG', tier: 0, text: 'r' },
        { name: 'persistent lore', tier: 4, text: bigLore },
        { name: 'quests', tier: 1, text: 'Q' },
        { name: 'keyword lore', tier: 2, text: 'S' },
    ];
    const r = budgetInjections({ contextSize: 1000, chatTokens: 0, items });   // budget ≈ 800 tokens
    assert.deepEqual(r.dropped, ['persistent lore']);
    assert.equal(r.injections, 'rQS');   // big low-priority lore omitted, order preserved
    assert.ok(!r.injections.includes(bigLore));
});

test('budgetInjections: trims the STATE MEMO block-wise rather than dropping it whole', () => {
    const memo = '### STATE MEMO (DO NOT REPEAT)\n[TIME]morning[/TIME]\n[INVENTORY]' + 'x'.repeat(5000) + '[/INVENTORY]\n\n';
    const items = [
        { name: 'RNG', tier: 0, text: 'r' },
        { name: 'STATE MEMO', tier: 5, text: memo, trimmable: true },
    ];
    const r = budgetInjections({ contextSize: 1000, chatTokens: 0, items });   // budget ≈ 800 tokens
    assert.equal(r.trimmed, true);
    assert.ok(r.injections.includes(MARKER));
    assert.ok(r.injections.includes('[TIME]morning[/TIME]'));   // high-value tag kept
    assert.ok(!r.injections.includes('x'.repeat(5000)));        // bloated block dropped
});

test('trimMemoToBudget: returns the memo unchanged when it already fits', () => {
    const memo = '[TIME]noon[/TIME]';
    assert.equal(trimMemoToBudget(memo, 1000), memo);
});

test('trimMemoToBudget: keeps [TIME], drops bloated low-value blocks, marks the trim', () => {
    const memo = '[TIME]t[/TIME]\n[INVENTORY]' + 'x'.repeat(2000) + '[/INVENTORY]';
    const out = trimMemoToBudget(memo, 50);   // far smaller than the memo
    assert.ok(out.startsWith(MARKER));
    assert.ok(out.includes('[TIME]t[/TIME]'));
    assert.ok(!out.includes('x'.repeat(2000)));
});

test('trimMemoToBudget: falls back to a tail slice when there are no blocks', () => {
    const memo = 'a'.repeat(1000);
    const out = trimMemoToBudget(memo, 10);
    assert.ok(out.startsWith(MARKER));
    assert.ok(out.length < memo.length);
});

test('budgetInjections: never exceeds the window minus the output reserve', () => {
    const items = [
        { name: 'RNG', tier: 0, text: 'r'.repeat(50) },
        { name: 'quests', tier: 1, text: 'q'.repeat(2000) },
        { name: 'keyword lore', tier: 2, text: 'k'.repeat(2000) },
        { name: 'STATE MEMO', tier: 5, text: '[TIME]t[/TIME]\n[INVENTORY]' + 'm'.repeat(8000) + '[/INVENTORY]', trimmable: true },
    ];
    const contextSize = 2000;
    const r = budgetInjections({ contextSize, chatTokens: 0, items });
    const reserved = Math.ceil(contextSize * OUTPUT_HEADROOM_FRAC);
    // Tier-0 RNG is exempt; everything else must respect the budget.
    const nonRng = r.injections.replace('r'.repeat(50), '');
    assert.ok(estimateTokens(nonRng) <= contextSize - reserved);
});
