/**
 * Tests for skill-forge.js — the pure validation pipeline that gates every
 * LLM-generated skill batch (power budget, prereq resolution, cycle detection,
 * active resource economy, descriptor contract).
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateSkillBatch,
    parseEffectNumbers,
    powerBudgetForTier,
    findCycle,
    extractNodeArray,
    NODES_PER_TIER,
} from '../skill-forge.js';

const FOUNDATION = {
    POWER_SYSTEM: { resources: [{ id: 'focus', name: 'Focus' }] },
    SKILL_TAXONOMY: {
        damageTypes: ['kinetic'],
        rarityTiers: [{ id: 'common', name: 'Common' }, { id: 'rare', name: 'Rare' }],
        tierCount: 10,
        levelGatePerTier: 10,
    },
};

function node(over = {}) {
    return {
        id: 'force_bolt', name: 'Force Bolt', tier: 1, type: 'active', cost: 1,
        prereqs: [],
        effect: 'Deals 2d6 kinetic damage to one target within 30 ft.',
        descriptor: 'A fist-sized bolt of compressed resonance snaps from the open palm, striking one target with a concussive crack.',
        resourceCost: { resourceId: 'focus', amount: 10 },
        rarity: 'common',
        ...over,
    };
}

/** A minimal valid tier-1 batch of 4 nodes. */
function validBatch() {
    return [
        node(),
        node({ id: 'kinetic_ward', name: 'Kinetic Ward', type: 'passive', resourceCost: undefined, effect: '+2 Defense while conscious.', descriptor: 'A constant whisper-thin shell of resonance hardens the air around the skin.' }),
        node({ id: 'focus_surge', name: 'Focus Surge', cooldown: { turns: 3 }, resourceCost: undefined, effect: 'Regain 1d6 Focus.', descriptor: 'A sharp inward breath pulls loose resonance back into the lattice, restoring a spark of focus.' }),
        node({ id: 'tremor_step', name: 'Tremor Step', effect: 'Move 10 ft and the next attack against you suffers a small penalty.', descriptor: 'A half-step blur — the body skips an inch sideways through humming air.' }),
    ];
}

setSettings({});

test('accepts a valid tier-1 batch and normalizes nodes (levelGate, nulls)', () => {
    const r = validateSkillBatch(validBatch(), { foundation: FOUNDATION, tier: 1 });
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.nodes.length, 4);
    assert.equal(r.nodes[0].levelGate, 10, 'levelGate = tier × gate');
    assert.equal(r.nodes[1].resourceCost, null, 'passives normalize resourceCost to null');
});

test('rejects overpowered nodes via the coarse power budget', () => {
    const b = powerBudgetForTier(1);
    const batch = validBatch();
    batch[0].effect = `Deals 40d10 kinetic damage and grants +${b.maxFlatBonus + 5} Defense and 90% damage reduction.`;
    const r = validateSkillBatch(batch, { foundation: FOUNDATION, tier: 1 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('dice total')), 'dice cap');
    assert.ok(r.errors.some(e => e.includes('flat bonus')), 'flat cap');
    assert.ok(r.errors.some(e => e.includes('%')), 'percent cap');
});

test('rejects dangling prereqs, duplicates, self-reference, and rootless tier-2 nodes', () => {
    const batch = validBatch();
    batch[0].prereqs = ['ghost_node'];
    batch[1].id = 'force_bolt'; // duplicate of batch[0]
    const r = validateSkillBatch(batch, { foundation: FOUNDATION, tier: 1 });
    assert.ok(r.errors.some(e => e.includes('does not resolve')));
    assert.ok(r.errors.some(e => e.includes('duplicate id')));

    const t2 = validBatch().map((n, i) => ({ ...n, id: `t2_${i}`, tier: 2, prereqs: [] }));
    const r2 = validateSkillBatch(t2, { foundation: FOUNDATION, tier: 2, existingTree: { force_bolt: node() } });
    assert.ok(r2.errors.some(e => e.includes('must have at least one prereq')), 'tier 2 must connect');
});

test('actives need a cost; passives must not have one; resources must exist', () => {
    const batch = validBatch();
    batch[0].resourceCost = undefined;            // active with nothing
    batch[1].resourceCost = { resourceId: 'focus', amount: 5 }; // passive with cost
    batch[3].resourceCost = { resourceId: 'mana', amount: 5 };  // unknown resource
    const r = validateSkillBatch(batch, { foundation: FOUNDATION, tier: 1 });
    assert.ok(r.errors.some(e => e.includes('no free spam')));
    assert.ok(r.errors.some(e => e.includes('passives cannot have a resourceCost')));
    assert.ok(r.errors.some(e => e.includes('not a foundation resource')));
});

test('descriptor contract: required and word-capped', () => {
    const batch = validBatch();
    batch[0].descriptor = '';
    batch[1].descriptor = Array(60).fill('word').join(' ');
    const r = validateSkillBatch(batch, { foundation: FOUNDATION, tier: 1 });
    assert.ok(r.errors.some(e => e.includes('descriptor (canonical narrative text) required')));
    assert.ok(r.errors.some(e => e.includes('words')));
});

test('job branches must graft onto the class tree via an anchor', () => {
    // All nodes chain internally but nothing touches an anchor → graft error.
    const floating = validBatch().map((n, i) => ({ ...n, id: `job_${i}`, prereqs: i === 0 ? ['job_1'] : i === 1 ? ['job_0'] : [`job_0`] }));
    floating[0].prereqs = ['job_1']; floating[1].prereqs = ['job_2']; floating[2].prereqs = ['job_3']; floating[3].prereqs = ['job_0'];
    const noAnchor = validateSkillBatch(floating, {
        foundation: FOUNDATION, tier: 1, jobId: 'contractor', graftAnchors: ['force_bolt'],
    });
    assert.ok(noAnchor.errors.some(e => e.includes('graft onto the class tree')), 'unanchored job batch rejected');

    // One node roots on the anchor; the rest chain inside the batch → valid.
    const batch = validBatch().map((n, i) => ({ ...n, id: `job_${i}`, prereqs: i === 0 ? ['force_bolt'] : ['job_0'] }));
    const anchored = validateSkillBatch(batch, {
        foundation: FOUNDATION, tier: 1, jobId: 'contractor', graftAnchors: ['force_bolt'],
    });
    assert.deepEqual(anchored.errors, []);
    assert.equal(anchored.ok, true);
    assert.equal(anchored.nodes[0]?.jobId, 'contractor', 'jobId stamped on normalized nodes');

    // Disconnected tier-1 job node (no prereqs at all) is rejected.
    const disconnected = validBatch().map((n, i) => ({ ...n, id: `job_${i}`, prereqs: i === 0 ? ['force_bolt'] : [] }));
    const r3 = validateSkillBatch(disconnected, {
        foundation: FOUNDATION, tier: 1, jobId: 'contractor', graftAnchors: ['force_bolt'],
    });
    assert.ok(r3.errors.some(e => e.includes('must connect')));
});

test('cycle detection: catches prereq cycles across existing tree + batch', () => {
    assert.equal(findCycle({ a: { prereqs: [] }, b: { prereqs: ['a'] } }), null);
    const cycle = findCycle({ a: { prereqs: ['b'] }, b: { prereqs: ['a'] } });
    assert.ok(Array.isArray(cycle) && cycle.length >= 2);

    // through the validator: batch node requiring a tree node that requires it back
    const existing = { old_node: { id: 'old_node', tier: 1, prereqs: ['new_node'] } };
    const batch = validBatch().map((n, i) => ({ ...n, id: i === 0 ? 'new_node' : `n${i}`, prereqs: i === 0 ? ['old_node'] : [] }));
    const r = validateSkillBatch(batch, { foundation: FOUNDATION, tier: 1, existingTree: existing });
    assert.ok(r.errors.some(e => e.includes('cycle')), 'cycle across tree+batch rejected');
});

test('parseEffectNumbers and extractNodeArray basics', () => {
    assert.deepEqual(parseEffectNumbers('Deals 2d6 + 3 damage and 15% slow'), { diceTotal: 12, maxFlat: 3, maxPercent: 15 });
    assert.deepEqual(parseEffectNumbers('no numbers'), { diceTotal: 0, maxFlat: 0, maxPercent: 0 });

    const arr = extractNodeArray('chatter\n```json\n[{"id":"x"}]\n```');
    assert.deepEqual(arr, [{ id: 'x' }]);
    assert.equal(extractNodeArray('```json\n{"not":"array"}\n```'), null);
    assert.equal(extractNodeArray(''), null);
});

test('batch size limits enforced', () => {
    const tooMany = Array.from({ length: NODES_PER_TIER.max + 1 }, (_, i) => node({ id: `n${i}` }));
    const r = validateSkillBatch(tooMany, { foundation: FOUNDATION, tier: 1 });
    assert.ok(r.errors.some(e => e.includes('nodes (got')));
    assert.equal(validateSkillBatch([], { foundation: FOUNDATION, tier: 1 }).ok, false);
});
