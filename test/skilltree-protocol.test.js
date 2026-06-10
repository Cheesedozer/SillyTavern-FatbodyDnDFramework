/**
 * Tests for skilltree-protocol.js — the shared staging math, prereq-closure
 * validation, respec costing, deterministic layout, and [SKILLS] memo builder
 * used by BOTH the opener bridge and the Skill Tree tab.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateApply,
    applyValidatedRequest,
    computeLayout,
    buildSkillsMemoBlock,
    channelName,
    PROTOCOL_VERSION,
} from '../skilltree-protocol.js';
import { respecCostPerPoint } from '../progression-engine.js';

const FOUNDATION = {
    PROGRESSION_RULES: { respec: { freeUntilLevel: 10, currencyName: 'scrip', costMultiplier: 1 } },
    POWER_SYSTEM: { resources: [{ id: 'focus', name: 'Focus' }] },
};

function makeTree() {
    return {
        root_a: { id: 'root_a', name: 'Root A', tier: 1, type: 'active', cost: 1, prereqs: [], levelGate: 10, effect: 'e', descriptor: 'A fist-sized bolt.', resourceCost: { resourceId: 'focus', amount: 10 } },
        root_b: { id: 'root_b', name: 'Root B', tier: 1, type: 'passive', cost: 2, prereqs: [], levelGate: 10, effect: 'e', descriptor: 'd' },
        mid_a:  { id: 'mid_a', name: 'Mid A', tier: 2, type: 'active', cost: 2, prereqs: ['root_a'], levelGate: 20, effect: 'e', descriptor: 'A roaring lance of force.', cooldown: { turns: 3 } },
        job_x:  { id: 'job_x', name: 'Job X', tier: 1, type: 'active', cost: 1, prereqs: ['root_a'], levelGate: 10, jobId: 'contractor', effect: 'e', descriptor: 'd', resourceCost: { resourceId: 'focus', amount: 5 } },
    };
}

function makeProgression(over = {}) {
    return {
        mode: 'modern', level: 25, xp: 0,
        skillPoints: { earned: 10, spent: 0 },
        respecSpentTotal: 0,
        tree: { nodes: makeTree(), layout: {}, tiersGenerated: {} },
        acquired: {},
        ...over,
    };
}

test('validateApply: legal allocation chain passes; costs add up', () => {
    const prog = makeProgression();
    const v = validateApply(prog, FOUNDATION, { allocate: ['root_a', 'mid_a'] });
    assert.deepEqual(v.errors, []);
    assert.equal(v.ok, true);
    assert.equal(v.pointsSpent, 3);
    assert.equal(v.currencyCost, 0, 'no refunds → no respec cost');
});

test('validateApply: rejects level gates, broken prereqs, double-buys, and overspending', () => {
    const prog = makeProgression({ level: 15 }); // mid_a needs 20
    const gate = validateApply(prog, FOUNDATION, { allocate: ['root_a', 'mid_a'] });
    assert.ok(gate.errors.some(e => e.includes('requires level 20')));

    const orphan = validateApply(makeProgression(), FOUNDATION, { allocate: ['mid_a'] });
    assert.ok(orphan.errors.some(e => e.includes('requires')), 'prereq closure: mid without root');

    const owned = makeProgression({ acquired: { root_a: { acquiredAtLevel: 5 } } });
    const dbl = validateApply(owned, FOUNDATION, { allocate: ['root_a'] });
    assert.ok(dbl.errors.some(e => e.includes('already acquired')));

    const poor = makeProgression({ skillPoints: { earned: 2, spent: 0 } });
    const broke = validateApply(poor, FOUNDATION, { allocate: ['root_a', 'root_b'] }); // costs 3
    assert.ok(broke.errors.some(e => e.includes('not enough skill points')));

    const unknown = validateApply(makeProgression(), FOUNDATION, { allocate: ['nope'] });
    assert.ok(unknown.errors.some(e => e.includes('unknown node')));
});

test('validateApply: refunds — dependents block, respec cost scales with level', () => {
    const prog = makeProgression({
        acquired: { root_a: {}, mid_a: {} },
        skillPoints: { earned: 10, spent: 3 },
    });

    // Refunding root_a while mid_a stays acquired breaks the chain
    const broken = validateApply(prog, FOUNDATION, { refund: ['root_a'] });
    assert.ok(broken.errors.some(e => e.includes('breaks the chain')));

    // Refunding both is fine; cost = points refunded × per-point cost at level 25
    const both = validateApply(prog, FOUNDATION, { refund: ['root_a', 'mid_a'] });
    assert.deepEqual(both.errors, []);
    assert.equal(both.pointsRefunded, 3);
    assert.equal(both.currencyCost, 3 * respecCostPerPoint(25, FOUNDATION.PROGRESSION_RULES.respec));

    // Free below the threshold
    const low = makeProgression({ level: 8, acquired: { root_a: {} }, skillPoints: { earned: 4, spent: 1 } });
    assert.equal(validateApply(low, FOUNDATION, { refund: ['root_a'] }).currencyCost, 0);

    // Refund + re-allocate in one batch frees the points for the new node
    const swap = validateApply(prog, FOUNDATION, { refund: ['mid_a'], allocate: ['root_b'] });
    assert.deepEqual(swap.errors, []);
    assert.equal(swap.pointsSpent, 2);
    assert.equal(swap.pointsRefunded, 2);
});

test('applyValidatedRequest mutates progression consistently', () => {
    const prog = makeProgression();
    const req = { allocate: ['root_a', 'mid_a'], refund: [] };
    const v = validateApply(prog, FOUNDATION, req);
    applyValidatedRequest(prog, req, v);
    assert.deepEqual(Object.keys(prog.acquired).sort(), ['mid_a', 'root_a']);
    assert.equal(prog.skillPoints.spent, 3);
    assert.equal(prog.acquired.root_a.acquiredAtLevel, 25);

    const refundReq = { allocate: [], refund: ['mid_a'] };
    const v2 = validateApply(prog, FOUNDATION, refundReq);
    applyValidatedRequest(prog, refundReq, v2);
    assert.deepEqual(Object.keys(prog.acquired), ['root_a']);
    assert.equal(prog.skillPoints.spent, 1);
    assert.equal(prog.respecSpentTotal, v2.currencyCost);

    assert.throws(() => applyValidatedRequest(prog, refundReq, { ok: false }), /failed validation/);
});

test('computeLayout: deterministic, separates class and job clusters', () => {
    const nodes = makeTree();
    const a = computeLayout(nodes);
    const b = computeLayout(nodes);
    assert.deepEqual(a, b, 'same tree → same coordinates');

    for (const id of Object.keys(nodes)) {
        assert.ok(Number.isFinite(a[id].x) && Number.isFinite(a[id].y), `${id} placed`);
    }
    assert.equal(a.root_a.cluster, '__class__');
    assert.equal(a.job_x.cluster, 'contractor');

    // Job cluster sits beyond the class rings
    const classDist = Math.hypot(a.mid_a.x, a.mid_a.y);
    const jobDist = Math.hypot(a.job_x.x, a.job_x.y);
    assert.ok(jobDist > classDist, 'job branch grafted outward');

    // No two nodes share a coordinate
    const seen = new Set(Object.values(a).map(p => `${p.x},${p.y}`));
    assert.equal(seen.size, Object.keys(nodes).length, 'no overlapping positions');
});

test('buildSkillsMemoBlock: actives only, costs and descriptors verbatim', () => {
    const prog = makeProgression({ acquired: { root_a: {}, root_b: {}, mid_a: {} } });
    const block = buildSkillsMemoBlock(prog, FOUNDATION);
    assert.ok(block.startsWith('[SKILLS]') && block.endsWith('[/SKILLS]'));
    assert.ok(block.includes('- Root A (10 Focus, active, A fist-sized bolt.)'), 'resource cost + descriptor');
    assert.ok(block.includes('- Mid A (CD 3 turns: ready, active, A roaring lance of force.)'), 'cooldown format');
    assert.ok(!block.includes('Root B'), 'passives excluded (baked into [CHARACTER])');

    assert.equal(buildSkillsMemoBlock(makeProgression(), FOUNDATION), '', 'empty when nothing acquired');
});

test('channel naming is chat-scoped and versioned', () => {
    assert.equal(channelName('abc 123'), 'fatbody-skilltree:abc 123');
    assert.equal(typeof PROTOCOL_VERSION, 'number');
});
