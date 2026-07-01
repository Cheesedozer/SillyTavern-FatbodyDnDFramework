/**
 * Tests for world-progression-schema.js — pure logic for the World
 * Progression System (default state shapes, validators, deterministic
 * pre-check heuristics, phase-gate/tempo/pressure-gauge evaluators).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CENTRAL_TENSION_CATEGORIES,
    MILESTONE_CHAIN_MIN,
    MILESTONE_CHAIN_MAX,
    CHAPTER_SEEDS_MIN,
    CHAPTER_SEEDS_MAX,
    makeDefaultWorldState,
    makeDefaultChatWorldProg,
    makeDefaultChapter,
    makeDefaultRegion,
    makeDefaultCharacterArc,
    validateCentralTension,
    validateWorldProgressionCommit,
    shouldCheckWorldArc,
    candidateCharacterArcBeats,
    shouldCheckRegionalState,
    computePressureGauge,
    evaluateTempoTransition,
    evaluatePhaseGate,
    buildCommitToolSchema,
    renderTempoDirective,
} from '../world-progression-schema.js';

// ── Category catalog ────────────────────────────────────────────────────────────

test('CENTRAL_TENSION_CATEGORIES: 8-10 unique categories with required fields', () => {
    assert.ok(CENTRAL_TENSION_CATEGORIES.length >= 8 && CENTRAL_TENSION_CATEGORIES.length <= 10);
    const ids = new Set();
    for (const c of CENTRAL_TENSION_CATEGORIES) {
        assert.equal(typeof c.id, 'string');
        assert.ok(c.id.length > 0);
        assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
        ids.add(c.id);
        assert.ok(c.label && c.blurb, `${c.id} needs label + blurb`);
    }
    // Spans both apocalyptic and lower-stakes flavors (not apocalyptic-only).
    assert.ok(ids.has('ancient_evil'));
    assert.ok(ids.has('political_intrigue') || ids.has('economic_collapse'));
});

// ── Default factories produce deep-clonable, independent objects ──────────────

test('default factories: independent objects, no shared references', () => {
    const a = makeDefaultWorldState();
    const b = makeDefaultWorldState();
    a.factions.x = { posture: 'aggressive' };
    assert.deepEqual(b.factions, {}, 'mutating one instance must not affect another');

    const chapA = makeDefaultChapter(1);
    const chapB = makeDefaultChapter(1);
    chapA.seeds.push({ id: 's1' });
    assert.deepEqual(chapB.seeds, []);

    const region = makeDefaultRegion('Khelt', 'Book::0');
    assert.equal(region.name, 'Khelt');
    assert.deepEqual(region.conditionModifiers, []);

    const arc = makeDefaultCharacterArc('Thalric');
    assert.equal(arc.phase, 'facade');
    assert.equal(arc.relationshipDepth, 'stranger');

    const chatProg = makeDefaultChatWorldProg();
    assert.equal(chatProg.pacing.mode, 'exploration');
    assert.equal(chatProg.chapter.index, 1);
});

// ── validateCentralTension ──────────────────────────────────────────────────────

function validCentralTension() {
    return {
        intimateConflict: 'The player is slowly losing themselves to the voice in their head.',
        epicConflict: 'The barrier between this world and the Hollow is failing.',
        milestoneChain: Array.from({ length: 6 }, (_, i) => ({ title: `Milestone ${i}`, description: `Desc ${i}` })),
        chapter1Seeds: [
            { text: 'A raven watches from the rooftop and flies north.', tiedTo: 'world' },
            { text: 'An NPC hesitates when asked about the old mine.', tiedTo: 'character' },
            { text: 'A locked door with no visible lock.' },
        ],
    };
}

test('validateCentralTension: accepts a well-formed candidate', () => {
    const { ok, errors } = validateCentralTension(validCentralTension());
    assert.deepEqual(errors, []);
    assert.equal(ok, true);
});

test('validateCentralTension: rejects non-object', () => {
    assert.equal(validateCentralTension(null).ok, false);
    assert.equal(validateCentralTension('nope').ok, false);
});

test('validateCentralTension: enforces milestone chain bounds (5-8)', () => {
    const tooFew = validCentralTension();
    tooFew.milestoneChain = tooFew.milestoneChain.slice(0, MILESTONE_CHAIN_MIN - 1);
    assert.equal(validateCentralTension(tooFew).ok, false);

    const tooMany = validCentralTension();
    tooMany.milestoneChain = Array.from({ length: MILESTONE_CHAIN_MAX + 1 }, (_, i) => ({ title: `M${i}`, description: 'd' }));
    assert.equal(validateCentralTension(tooMany).ok, false);
});

test('validateCentralTension: enforces chapter1Seeds bounds and required tie-ins', () => {
    const tooFew = validCentralTension();
    tooFew.chapter1Seeds = tooFew.chapter1Seeds.slice(0, CHAPTER_SEEDS_MIN - 1);
    assert.equal(validateCentralTension(tooFew).ok, false);

    const noWorldTie = validCentralTension();
    noWorldTie.chapter1Seeds = noWorldTie.chapter1Seeds.map(s => s.tiedTo === 'world' ? { ...s, tiedTo: 'regional' } : s);
    const r1 = validateCentralTension(noWorldTie);
    assert.equal(r1.ok, false);
    assert.ok(r1.errors.some(e => e.includes('world arc')));

    const noCharacterTie = validCentralTension();
    noCharacterTie.chapter1Seeds = noCharacterTie.chapter1Seeds.map(s => s.tiedTo === 'character' ? { ...s, tiedTo: 'regional' } : s);
    const r2 = validateCentralTension(noCharacterTie);
    assert.equal(r2.ok, false);
    assert.ok(r2.errors.some(e => e.includes('character arc')));
});

// ── validateWorldProgressionCommit ─────────────────────────────────────────────

test('validateWorldProgressionCommit: accepts a well-formed commit for active layers', () => {
    const candidate = {
        worldArc: {
            factionUpdates: [{ factionId: 'Book::0', posture: 'scheming', goal: 'Undermine the council.', actionSummary: 'Bribed a guard captain.' }],
            milestoneUpdates: [{ milestoneId: 'ms_1', status: 'approaching' }],
            worldClockNote: 'Two seeds away from the next milestone.',
        },
        newSeeds: [{ text: 'A merchant mentions soldiers on the northern road.', tiedTo: 'world' }],
        convergenceResolved: false,
    };
    const { ok, errors } = validateWorldProgressionCommit(candidate, ['worldArc'], { factionIds: ['Book::0'] });
    assert.deepEqual(errors, []);
    assert.equal(ok, true);
});

test('validateWorldProgressionCommit: rejects unknown cross-referenced ids', () => {
    const candidate = { worldArc: { factionUpdates: [{ factionId: 'Book::99', posture: 'scheming' }] } };
    const { ok, errors } = validateWorldProgressionCommit(candidate, ['worldArc'], { factionIds: ['Book::0'] });
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes('does not match any known faction')));
});

test('validateWorldProgressionCommit: rejects invalid enum values', () => {
    const candidate = { characterArc: { beats: [{ npcId: 'n1', phase: 'nonsense', beatNote: 'x' }] } };
    const { ok, errors } = validateWorldProgressionCommit(candidate, ['characterArc'], {});
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes('phase must be one of')));
});

test('validateWorldProgressionCommit: requires full gained/lost/nowPossible/nowImpossible on a tectonic shift', () => {
    const candidate = { worldArc: { tectonicShift: { gained: 'power', lost: 'an ally' } } };
    const { ok, errors } = validateWorldProgressionCommit(candidate, ['worldArc'], {});
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes('tectonicShift')));
});

// ── Pre-check heuristics ────────────────────────────────────────────────────────

test('shouldCheckWorldArc: false with no milestone chain yet', () => {
    assert.equal(shouldCheckWorldArc(makeDefaultWorldState(), makeDefaultChatWorldProg(), 100), false);
});

test('shouldCheckWorldArc: true once stale, true early when pressure is critical', () => {
    const ws = makeDefaultWorldState();
    ws.milestoneChain = [{ id: 'ms_1', status: 'pending' }];
    assert.equal(shouldCheckWorldArc(ws, {}, 1), false, 'not stale, not critical yet');
    assert.equal(shouldCheckWorldArc(ws, {}, 6), true, 'stale cadence trips it');

    ws.worldClock.pressureGauge = 'critical';
    assert.equal(shouldCheckWorldArc(ws, {}, 2), true, 'critical pressure trips it earlier');
    assert.equal(shouldCheckWorldArc(ws, {}, 1), false, 'still below even the critical threshold');
});

test('candidateCharacterArcBeats: engagement threshold + tempo affinity + no double-staging', () => {
    const arcs = {
        npc1: { phase: 'facade', engagementScore: 0, pendingBeat: null },
        npc2: { phase: 'facade', engagementScore: 3, pendingBeat: null },
        npc3: { phase: 'crucible', engagementScore: 10, pendingBeat: null },
        npc4: { phase: 'facade', engagementScore: 5, pendingBeat: { type: 'fracture' } },
        npc5: { phase: 'transformation', engagementScore: 100, pendingBeat: null },
    };
    // Exploration tempo suits facade/fracture, not crucible.
    const eligible = candidateCharacterArcBeats(arcs, 'exploration');
    assert.deepEqual(eligible.sort(), ['npc2']);

    // Crisis tempo suits crucible, not facade.
    const eligibleCrisis = candidateCharacterArcBeats(arcs, 'crisis');
    assert.deepEqual(eligibleCrisis.sort(), ['npc3']);
});

test('candidateCharacterArcBeats: engagementDeltas can push a candidate over threshold this cycle', () => {
    const arcs = { npc1: { phase: 'facade', engagementScore: 2, pendingBeat: null } };
    assert.deepEqual(candidateCharacterArcBeats(arcs, 'exploration', {}), []);
    assert.deepEqual(candidateCharacterArcBeats(arcs, 'exploration', { npc1: 1 }), ['npc1']);
});

test('shouldCheckRegionalState: true on entry, false with no region, true when stale or hooks pending', () => {
    assert.equal(shouldCheckRegionalState(null, 0, true), true);
    assert.equal(shouldCheckRegionalState(null, 100, false), false);

    const region = makeDefaultRegion('Khelt');
    assert.equal(shouldCheckRegionalState(region, 1, false), false);
    assert.equal(shouldCheckRegionalState(region, 8, false), true);

    region.hooks.push({ id: 'h1', text: 'x', discovered: false, bloomed: false });
    assert.equal(shouldCheckRegionalState(region, 4, false), true, 'pending hook trips it at half the stale threshold');
});

// ── Pressure gauge / tempo / phase gate ────────────────────────────────────────

test('computePressureGauge: monotonic in every input, buckets correctly', () => {
    assert.equal(computePressureGauge({}), 'low');
    assert.equal(computePressureGauge({ activeSeedCount: 5, milestoneProximity: 'critical', unresolvedFractureCount: 4, regionalInstabilityCount: 4, engagementTrend: 'rising' }), 'critical');
    assert.equal(computePressureGauge({ milestoneProximity: 'building' }), 'building');
});

test('evaluateTempoTransition: follows the natural rhythm and always reports natural:true', () => {
    const r1 = evaluateTempoTransition({ mode: 'exploration', exchangesSinceModeEntered: 0 }, 'high', {});
    assert.equal(r1.nextMode, 'escalation');
    assert.equal(r1.natural, true);

    const r2 = evaluateTempoTransition({ mode: 'exploration', exchangesSinceModeEntered: 0 }, 'low', {});
    assert.equal(r2.nextMode, 'exploration');

    const r3 = evaluateTempoTransition({ mode: 'escalation', exchangesSinceModeEntered: 0 }, 'critical', {});
    assert.equal(r3.nextMode, 'crisis');

    const r4 = evaluateTempoTransition({ mode: 'crisis', exchangesSinceModeEntered: 0 }, 'low', { primaryConvergenceResolved: true });
    assert.equal(r4.nextMode, 'aftermath');

    const r5 = evaluateTempoTransition({ mode: 'aftermath', exchangesSinceModeEntered: 1 }, 'low', {});
    assert.equal(r5.nextMode, 'aftermath', 'not enough breathing room yet');

    const r6 = evaluateTempoTransition({ mode: 'aftermath', exchangesSinceModeEntered: 2 }, 'low', {});
    assert.equal(r6.nextMode, 'exploration');
});

test('evaluatePhaseGate: requires primary convergence AND a majority of the remaining five', () => {
    const chapter = makeDefaultChapter(1);
    chapter.seeds = [{ engaged: true }, { engaged: true }, { engaged: false }];
    chapter.convergencesResolved = 0;
    // No convergence yet -> never ready, regardless of everything else.
    chapter.phaseGate.worldClockThresholdReached = true;
    chapter.phaseGate.aftermathExchangeCount = 5;
    chapter.phaseGate.characterBeatFiredAndProcessed = true;
    chapter.phaseGate.regionalShiftReady = true;
    assert.equal(evaluatePhaseGate(chapter).readyToAdvance, false, 'primary convergence is mandatory');

    chapter.convergencesResolved = 1;
    const result = evaluatePhaseGate(chapter);
    assert.equal(result.readyToAdvance, true, 'convergence + 4/5 supporting criteria (>=3) is enough');
    assert.ok(result.breakdown.seedsEngagedPct >= 60);

    // Only 2 of 5 supporting criteria met -> not ready even with the convergence resolved.
    const weak = makeDefaultChapter(1);
    weak.seeds = [{ engaged: false }, { engaged: false }];
    weak.convergencesResolved = 1;
    weak.phaseGate.worldClockThresholdReached = true;
    weak.phaseGate.aftermathExchangeCount = 5;
    assert.equal(evaluatePhaseGate(weak).readyToAdvance, false);
});

// ── Tool schema builder ─────────────────────────────────────────────────────────

test('buildCommitToolSchema: only includes properties for active layers, always includes seed/development fields', () => {
    const tools = buildCommitToolSchema(['worldArc']);
    assert.equal(tools.length, 1);
    const props = tools[0].function.parameters.properties;
    assert.ok(props.worldArc);
    assert.ok(!props.characterArc);
    assert.ok(!props.regionalState);
    assert.ok(props.newSeeds, 'seed/development fields are always present regardless of active layers');
    assert.ok(props.developments);
    assert.ok(props.convergenceResolved);
});

test('buildCommitToolSchema: pacing layer adds pacingJustification', () => {
    const tools = buildCommitToolSchema(new Set(['pacing']));
    assert.ok(tools[0].function.parameters.properties.pacingJustification);
});

// ── Tempo directive prose ───────────────────────────────────────────────────────

test('renderTempoDirective: returns distinct, non-empty prose for each mode and falls back safely', () => {
    const modes = ['exploration', 'escalation', 'crisis', 'aftermath'];
    const texts = modes.map(renderTempoDirective);
    for (const t of texts) assert.ok(t && t.length > 20);
    assert.equal(new Set(texts).size, modes.length, 'each mode has distinct directive text');
    assert.equal(renderTempoDirective('bogus'), renderTempoDirective('exploration'));
});
