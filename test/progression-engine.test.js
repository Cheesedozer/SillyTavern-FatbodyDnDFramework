/**
 * Tests for progression-engine.js — the Modern-mode (v3.0) leveling math.
 * Locks the modern_v1 curve shape, the 240-point invariant, the respec cost
 * table, and threshold-crossing detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_LEVEL,
    xpToNext,
    XP_TOTALS,
    xpTotalForLevel,
    levelForXp,
    xpProgress,
    skillPointsForLevelUp,
    totalSkillPointsAtLevel,
    respecCostPerPoint,
    detectLevelUp,
    formatXpLine,
} from '../progression-engine.js';

test('curve: strictly increasing per-level cost, all multiples of 25', () => {
    let prev = 0;
    for (let l = 1; l < MAX_LEVEL; l++) {
        const step = xpToNext(l);
        assert.ok(step > 0, `xpToNext(${l}) > 0`);
        assert.equal(step % 25, 0, `xpToNext(${l}) rounds to 25s`);
        assert.ok(step >= prev, `xpToNext(${l}) is monotonic`);
        prev = step;
    }
    assert.equal(xpToNext(0), 0);
    assert.equal(xpToNext(MAX_LEVEL), 0, 'no XP needed past max level');
});

test('curve: anchor values stay in the planned magnitude bands', () => {
    assert.equal(xpToNext(1), 100, 'L1→2 costs exactly 100');
    assert.ok(XP_TOTALS[10] > 5_000 && XP_TOTALS[10] < 15_000, `L10 total ≈ 9k (got ${XP_TOTALS[10]})`);
    assert.ok(XP_TOTALS[50] > 250_000 && XP_TOTALS[50] < 900_000, `L50 total in band (got ${XP_TOTALS[50]})`);
    assert.ok(XP_TOTALS[100] > 2_000_000 && XP_TOTALS[100] < 8_000_000, `L100 total ≤7 digits (got ${XP_TOTALS[100]})`);
});

test('levelForXp is the inverse of xpTotalForLevel at every boundary', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
        const base = xpTotalForLevel(l);
        assert.equal(levelForXp(base), l, `exactly at threshold → level ${l}`);
        if (base > 0) {
            assert.equal(levelForXp(base - 1), l - 1, `one XP short stays level ${l - 1}`);
        }
    }
    assert.equal(levelForXp(0), 1);
    assert.equal(levelForXp(-50), 1);
    assert.equal(levelForXp(99_999_999), MAX_LEVEL, 'clamped at max level');
});

test('skill points: 2 per level-up, 6 at milestones, 240 lifetime at L100', () => {
    assert.equal(skillPointsForLevelUp(2), 2);
    assert.equal(skillPointsForLevelUp(9), 2);
    assert.equal(skillPointsForLevelUp(10), 6, 'milestone = 2 + 4 bonus');
    assert.equal(skillPointsForLevelUp(45), 2);
    assert.equal(skillPointsForLevelUp(100), 6);
    assert.equal(totalSkillPointsAtLevel(1), 2, 'starting grant');
    assert.equal(totalSkillPointsAtLevel(100), 240, 'the locked 240-point invariant');
});

test('respec: free through 10, significant by 45+, per the locked formula', () => {
    for (let l = 1; l <= 10; l++) assert.equal(respecCostPerPoint(l), 0, `free at level ${l}`);
    assert.equal(respecCostPerPoint(15), Math.round(10 * Math.pow(5, 1.8)));
    assert.equal(respecCostPerPoint(20), Math.round(10 * Math.pow(10, 1.8)));
    const at45 = respecCostPerPoint(45);
    assert.ok(at45 >= 5000, `major investment by 45 (got ${at45})`);
    assert.equal(respecCostPerPoint(20, { freeUntilLevel: 10, costMultiplier: 2 }),
        Math.round(10 * Math.pow(10, 1.8) * 2), 'foundation multiplier honored');
});

test('detectLevelUp: single crossing, milestone crossing, multi-level jump, no-op', () => {
    // No crossing
    assert.equal(detectLevelUp(0, 99), null);
    assert.equal(detectLevelUp(500, 400), null, 'XP loss never levels');

    // Single crossing 1→2
    const single = detectLevelUp(50, 150);
    assert.deepEqual(single, { fromLevel: 1, toLevel: 2, points: 2, milestone: false });

    // Crossing a milestone (9→10)
    const mile = detectLevelUp(xpTotalForLevel(10) - 10, xpTotalForLevel(10) + 10);
    assert.deepEqual(mile, { fromLevel: 9, toLevel: 10, points: 6, milestone: true });

    // Multi-level jump 8→11 awards every level's grant: 2 + 6 + 2
    const jump = detectLevelUp(xpTotalForLevel(8), xpTotalForLevel(11));
    assert.deepEqual(jump, { fromLevel: 8, toLevel: 11, points: 10, milestone: true });
});

test('xpProgress + formatXpLine: cumulative semantics matching the D&D footer', () => {
    const xp = xpTotalForLevel(3) + 40;
    const p = xpProgress(xp);
    assert.equal(p.level, 3);
    assert.equal(p.into, 40);
    assert.equal(p.span, xpToNext(3));

    const line = formatXpLine(xp);
    assert.match(line, /^Level: 3 \| XP: [\d,]+\/[\d,]+$/);
    const [cur, next] = line.match(/XP: ([\d,]+)\/([\d,]+)/).slice(1)
        .map(s => Number(s.replace(/,/g, '')));
    assert.equal(cur, xp, 'first number is the cumulative total');
    assert.equal(next, xpTotalForLevel(4), 'second number is the next threshold total');

    assert.match(formatXpLine(xpTotalForLevel(MAX_LEVEL) + 5), /\(MAX\)$/);
});
