/**
 * world-progression-schema.js — Fatbody Framework (World Progression System)
 *
 * Pure module: no DOM, no SillyTavern context, no settings reads — everything
 * is parameterized so it runs unchanged under `node --test`. Mirrors the
 * contract established by progression-engine.js.
 *
 * Owns: default state factories, the Central Tension category catalog,
 * hand-rolled schema validators (modeled on foundation.js#validateFoundation),
 * the deterministic (non-LLM) pre-check heuristics that decide whether a
 * layer needs an LLM call this cycle, the phase-gate/tempo/pressure-gauge
 * evaluators, the commit tool schema builder, and the four default per-layer
 * prompt templates plus the four static tempo-directive prose blocks.
 *
 * Imports: none (leaf module).
 * Imported by: world-progression.js, central-tension-compiler.js, state-manager.js.
 */

// ── Enums (shared by validators, tool schema, and state factories) ────────────

export const FACTION_POSTURES = ['aggressive', 'defensive', 'scheming', 'fractured', 'ascendant', 'declining'];
export const MILESTONE_STATUSES = ['pending', 'approaching', 'triggered', 'resolved'];
export const CHARACTER_ARC_PHASES = ['facade', 'fracture', 'crucible', 'transformation', 'reversion'];
export const RELATIONSHIP_DEPTHS = ['stranger', 'acquaintance', 'familiar', 'trusted', 'bonded'];
export const TEMPO_MODES = ['exploration', 'escalation', 'crisis', 'aftermath'];
export const PRESSURE_LEVELS = ['low', 'building', 'high', 'critical'];
export const SEED_STATUSES = ['planted', 'developing', 'converged', 'dormant', 'resolved_offscreen'];
export const SHIFT_TIERS = ['surface', 'structural', 'tectonic'];
export const CENTRAL_TENSION_SOURCES = ['preset', 'custom', 'ai_generated'];

// ── Bounds (spec-derived invariants) ───────────────────────────────────────────

export const MILESTONE_CHAIN_MIN = 5;
export const MILESTONE_CHAIN_MAX = 8;
export const CHAPTER_SEEDS_MIN = 3;
export const CHAPTER_SEEDS_MAX = 5;
export const CONVERGENCES_PER_CHAPTER_MAX = 2;
export const TECTONIC_SHIFTS_PER_ARC_MAX = 3;

// ── Persistence caps (array trimming, mirrors routerHistory=5 / memoHistory=1000) ──

export const CHAPTER_HISTORY_CAP = 25;
export const SHIFT_LOG_CAP = 50;
export const PENDING_DELTA_COMMIT_HORIZON = 2; // messages back before a delta is no longer rollback-eligible

// ── Central Tension category catalog ───────────────────────────────────────────

/**
 * Starter categories offered in the Central Tension setup UI. Spans the
 * user's original apocalyptic/cosmic-horror set plus lower-stakes categories
 * so campaigns don't have to be world-ending in scale.
 * @type {Array<{id: string, label: string, blurb: string}>}
 */
export const CENTRAL_TENSION_CATEGORIES = Object.freeze([
    { id: 'ancient_evil', label: 'Ancient Evils & Gods', blurb: 'An awakened entity, dark lord, or vengeful deity is actively working to unmake the world or remake it under absolute rule.' },
    { id: 'magic_cataclysm', label: 'Magic Cataclysm & Corruption', blurb: 'Unpredictable magical corruption, curses, or tears in the material world are leaking unknown threats from elsewhere.' },
    { id: 'undead_plague', label: 'Undead & Plagues', blurb: 'A magical or viral outbreak is rapidly zombifying or eradicating the sapient population.' },
    { id: 'possession', label: 'The Enemy Within', blurb: 'The player is being slowly possessed by an ancient evil that offers great power in exchange for their body.' },
    { id: 'dimensional_instability', label: 'Fraying Reality', blurb: "The player's own existence destabilizes their dimension; an interdimensional threat breaches the weakening barrier until it fails completely." },
    { id: 'political_intrigue', label: 'Succession Crisis', blurb: 'A ruling power is collapsing from within — rival claimants, a dying regime, or a coup in slow motion, and the player is caught between factions.' },
    { id: 'economic_collapse', label: 'The Long Winter', blurb: "A trade collapse, resource famine, or currency failure is grinding a region toward desperation and the player's choices decide who eats and who doesn't." },
    { id: 'hunted_secret', label: 'A Debt Long Buried', blurb: 'A generational curse or a secret from the past is catching up with the player or someone close to them, and those who want it kept buried are running out of patience.' },
    { id: 'frontier_expansion', label: 'The Edge of the Map', blurb: 'A frontier is opening — colonization, a gold rush, a newly-thawed land — and the player is shaping what gets built there before someone worse does.' },
    { id: 'rival_ascendant', label: "A Rival's Rise", blurb: 'A once-minor rival (person, guild, or nation) is rapidly gaining power and reshaping the balance the player depends on.' },
]);

// ── Default state factories ────────────────────────────────────────────────────

/**
 * Fresh Layer-1 (World Arc) + cross-session Character Arc state, keyed by
 * campaign prefix in settings.worldStates[prefix].
 * @returns {object}
 */
export function makeDefaultWorldState() {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        centralTension: {
            source: null,
            rawInput: '',
            intimateConflict: '',
            epicConflict: '',
            compiledAt: null,
            compilerVersion: 1,
        },
        milestoneChain: [],
        worldClock: {
            pressureGauge: 'low',
            proximityNote: '',
            nextMilestoneId: null,
            lastEvaluatedAt: null,
        },
        factions: {},
        characterArcs: {},
        tectonicShiftsUsed: 0,
    };
}

/** Fresh chapter object. @param {number} [index] @returns {object} */
export function makeDefaultChapter(index = 1) {
    return {
        index,
        seeds: [],
        developments: [],
        convergencesResolved: 0,
        phaseGate: {
            worldClockThresholdReached: false,
            aftermathExchangeCount: 0,
            characterBeatFiredAndProcessed: false,
            regionalShiftReady: false,
        },
    };
}

/**
 * Fresh session-local Layer 2(partial)/3/4 + chapter machinery, stored in
 * chatStates[chatId].worldProg.
 * @returns {object}
 */
export function makeDefaultChatWorldProg() {
    return {
        schemaVersion: 1,
        worldStateKey: '',
        chapter: makeDefaultChapter(1),
        chapterHistory: [],
        regions: {},
        pacing: {
            mode: 'exploration',
            modeEnteredAt: null,
            exchangesSinceModeEntered: 0,
            aftermathBreathingRoomGiven: 0,
            lastTransitionReason: 'campaign start',
            pressureGaugeInputs: {
                activeSeedCount: 0,
                milestoneProximity: 'low',
                unresolvedFractureCount: 0,
                regionalInstabilityCount: 0,
                engagementTrend: 'flat',
            },
        },
        shiftLog: [],
        deferredConsequenceQueue: [],
        pendingDeltas: [],
    };
}

/** Fresh Regional State entry. @param {string} [name] @param {string} [lorebookEntryId] */
export function makeDefaultRegion(name = '', lorebookEntryId = '') {
    return {
        name,
        lorebookEntryId,
        baseline: { culture: '', geography: '', powerStructure: '', moodAtRest: '' },
        conditionModifiers: [],
        hooks: [],
        residue: [],
    };
}

/** Fresh Character Arc entry. @param {string} [name] */
export function makeDefaultCharacterArc(name = '') {
    return {
        name,
        phase: 'facade',
        relationshipDepth: 'stranger',
        pendingBeat: null,
        lastBeatFiredAt: null,
        engagementScore: 0,
    };
}

// ── Validators ──────────────────────────────────────────────────────────────────

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = Array.isArray;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates the Central Tension compiler's output. Modeled on
 * foundation.js#validateFoundation — collects every problem so the caller can
 * feed the full list back to the model in one retry turn.
 * @param {any} candidate
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCentralTension(candidate) {
    const errors = [];
    const err = (msg) => errors.push(msg);

    if (!isObj(candidate)) return { ok: false, errors: ['central tension must be a JSON object'] };

    if (!isStr(candidate.intimateConflict)) err('intimateConflict must be a non-empty string');
    if (!isStr(candidate.epicConflict)) err('epicConflict must be a non-empty string');

    const mc = candidate.milestoneChain;
    if (!isArr(mc) || mc.length < MILESTONE_CHAIN_MIN || mc.length > MILESTONE_CHAIN_MAX) {
        err(`milestoneChain must contain ${MILESTONE_CHAIN_MIN}-${MILESTONE_CHAIN_MAX} items`);
    } else {
        mc.forEach((m, i) => {
            if (!isStr(m?.title)) err(`milestoneChain[${i}].title must be a non-empty string`);
            if (!isStr(m?.description)) err(`milestoneChain[${i}].description must be a non-empty string`);
        });
    }

    const seeds = candidate.chapter1Seeds;
    if (!isArr(seeds) || seeds.length < CHAPTER_SEEDS_MIN || seeds.length > CHAPTER_SEEDS_MAX) {
        err(`chapter1Seeds must contain ${CHAPTER_SEEDS_MIN}-${CHAPTER_SEEDS_MAX} items`);
    } else {
        seeds.forEach((s, i) => {
            if (!isStr(s?.text)) err(`chapter1Seeds[${i}].text must be a non-empty string`);
        });
        const tiedToWorld = seeds.some(s => s?.tiedTo === 'world');
        const tiedToCharacter = seeds.some(s => s?.tiedTo === 'character');
        if (!tiedToWorld) err('chapter1Seeds must include at least one seed tied to the world arc (tiedTo: "world")');
        if (!tiedToCharacter) err('chapter1Seeds must include at least one seed tied to a character arc (tiedTo: "character")');
    }

    if (candidate.factionSeeds !== undefined) {
        if (!isArr(candidate.factionSeeds)) err('factionSeeds must be an array when provided');
        else candidate.factionSeeds.forEach((f, i) => {
            if (!isStr(f?.name)) err(`factionSeeds[${i}].name must be a non-empty string`);
            if (f?.posture !== undefined && !FACTION_POSTURES.includes(f.posture)) err(`factionSeeds[${i}].posture must be one of: ${FACTION_POSTURES.join(', ')}`);
            if (!isStr(f?.goal)) err(`factionSeeds[${i}].goal must be a non-empty string`);
        });
    }

    return { ok: errors.length === 0, errors };
}

/**
 * Validates one cycle's `commit_world_progression` tool-call args before
 * anything is merged into state. Cross-reference integrity is checked against
 * `knownIds` (the caller's live state) so the model can't invent ids for
 * factions/NPCs/regions/seeds that don't exist.
 *
 * @param {any} candidate
 * @param {Set<string>|string[]} activeLayers - which top-level layer keys were offered this cycle
 * @param {{factionIds?: string[], npcIds?: string[], regionIds?: string[], seedIds?: string[]}} [knownIds]
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateWorldProgressionCommit(candidate, activeLayers, knownIds = {}) {
    const errors = [];
    const err = (msg) => errors.push(msg);
    const layers = activeLayers instanceof Set ? activeLayers : new Set(activeLayers || []);
    const factionIds = new Set(knownIds.factionIds || []);
    const npcIds = new Set(knownIds.npcIds || []);
    const regionIds = new Set(knownIds.regionIds || []);
    const seedIds = new Set(knownIds.seedIds || []);

    if (!isObj(candidate)) return { ok: false, errors: ['commit payload must be a JSON object'] };

    if (layers.has('worldArc') && candidate.worldArc !== undefined) {
        const wa = candidate.worldArc;
        if (!isObj(wa)) err('worldArc must be an object');
        else {
            (wa.factionUpdates || []).forEach((f, i) => {
                if (!isStr(f?.factionId)) err(`worldArc.factionUpdates[${i}].factionId is required`);
                else if (factionIds.size && !factionIds.has(f.factionId)) err(`worldArc.factionUpdates[${i}].factionId "${f.factionId}" does not match any known faction`);
                if (f?.posture !== undefined && !FACTION_POSTURES.includes(f.posture)) err(`worldArc.factionUpdates[${i}].posture must be one of: ${FACTION_POSTURES.join(', ')}`);
            });
            (wa.milestoneUpdates || []).forEach((m, i) => {
                if (!isStr(m?.milestoneId)) err(`worldArc.milestoneUpdates[${i}].milestoneId is required`);
                if (!MILESTONE_STATUSES.includes(m?.status)) err(`worldArc.milestoneUpdates[${i}].status must be one of: ${MILESTONE_STATUSES.join(', ')}`);
            });
            if (wa.tectonicShift !== undefined && wa.tectonicShift !== null) {
                const ts = wa.tectonicShift;
                if (!isObj(ts) || !isStr(ts.gained) || !isStr(ts.lost) || !isStr(ts.nowPossible) || !isStr(ts.nowImpossible)) {
                    err('worldArc.tectonicShift must answer gained/lost/nowPossible/nowImpossible in full when present');
                }
            }
        }
    }

    if (layers.has('characterArc') && candidate.characterArc !== undefined) {
        const ca = candidate.characterArc;
        if (!isObj(ca)) err('characterArc must be an object');
        else (ca.beats || []).forEach((b, i) => {
            if (!isStr(b?.npcId)) err(`characterArc.beats[${i}].npcId is required`);
            else if (npcIds.size && !npcIds.has(b.npcId)) err(`characterArc.beats[${i}].npcId "${b.npcId}" does not match any known NPC`);
            if (!CHARACTER_ARC_PHASES.includes(b?.phase)) err(`characterArc.beats[${i}].phase must be one of: ${CHARACTER_ARC_PHASES.join(', ')}`);
            if (b?.relationshipDepth !== undefined && !RELATIONSHIP_DEPTHS.includes(b.relationshipDepth)) err(`characterArc.beats[${i}].relationshipDepth must be one of: ${RELATIONSHIP_DEPTHS.join(', ')}`);
            if (!isStr(b?.beatNote)) err(`characterArc.beats[${i}].beatNote must be a non-empty string`);
        });
    }

    if (layers.has('regionalState') && candidate.regionalState !== undefined) {
        const rs = candidate.regionalState;
        if (!isObj(rs)) err('regionalState must be an object');
        else (rs.regionUpdates || []).forEach((r, i) => {
            if (!isStr(r?.regionId)) err(`regionalState.regionUpdates[${i}].regionId is required`);
            else if (regionIds.size && !regionIds.has(r.regionId)) err(`regionalState.regionUpdates[${i}].regionId "${r.regionId}" does not match any known region`);
        });
    }

    if (candidate.newSeeds !== undefined) {
        if (!isArr(candidate.newSeeds)) err('newSeeds must be an array when provided');
        else candidate.newSeeds.forEach((s, i) => {
            if (!isStr(s?.text)) err(`newSeeds[${i}].text must be a non-empty string`);
            if (s?.tiedTo !== undefined && !['character', 'world', 'regional', 'none'].includes(s.tiedTo)) {
                err(`newSeeds[${i}].tiedTo must be one of: character, world, regional, none`);
            }
        });
    }

    if (candidate.developments !== undefined) {
        if (!isArr(candidate.developments)) err('developments must be an array when provided');
        else candidate.developments.forEach((d, i) => {
            if (!isStr(d?.seedId)) err(`developments[${i}].seedId is required`);
            else if (seedIds.size && !seedIds.has(d.seedId)) err(`developments[${i}].seedId "${d.seedId}" does not match any known seed in the current chapter`);
            if (!['reveal', 'complicate', 'connect'].includes(d?.kind)) err(`developments[${i}].kind must be one of: reveal, complicate, connect`);
            if (!isStr(d?.text)) err(`developments[${i}].text must be a non-empty string`);
        });
    }

    return { ok: errors.length === 0, errors };
}

// ── Deterministic pre-check heuristics (no LLM) ────────────────────────────────

const WORLD_ARC_STALE_CYCLES = 6;
const WORLD_ARC_CRITICAL_CYCLES = 2;

/**
 * Whether the World Arc layer has anything worth an LLM call this cycle.
 * @param {object} worldState
 * @param {object} chatWorldProg
 * @param {number} cyclesSinceLastCheck
 * @returns {boolean}
 */
export function shouldCheckWorldArc(worldState, chatWorldProg, cyclesSinceLastCheck) {
    if (!worldState?.milestoneChain?.length) return false;
    const pressure = worldState.worldClock?.pressureGauge || 'low';
    if ((pressure === 'high' || pressure === 'critical') && cyclesSinceLastCheck >= WORLD_ARC_CRITICAL_CYCLES) return true;
    if (cyclesSinceLastCheck >= WORLD_ARC_STALE_CYCLES) return true;
    return false;
}

const CHARACTER_ARC_ENGAGEMENT_THRESHOLDS = { facade: 3, fracture: 5, crucible: 4 };
const CHARACTER_ARC_TEMPO_AFFINITY = {
    facade: ['exploration', 'aftermath'],
    fracture: ['exploration', 'aftermath'],
    crucible: ['escalation', 'crisis'],
    transformation: ['escalation', 'crisis'],
    reversion: ['escalation', 'crisis'],
};

/**
 * Returns the npcIds eligible for a character-arc beat this cycle: minimum
 * engagement threshold met, current tempo mode compatible with the NPC's
 * phase, and no beat already staged. Encodes "beats fire conditionally...
 * never on a fixed schedule" directly rather than leaving it to the prompt.
 * @param {Record<string, object>} characterArcs
 * @param {string} tempoMode
 * @param {Record<string, number>} [engagementDeltas] - this cycle's new engagement per npcId
 * @returns {string[]}
 */
export function candidateCharacterArcBeats(characterArcs, tempoMode, engagementDeltas = {}) {
    const candidates = [];
    for (const [npcId, arc] of Object.entries(characterArcs || {})) {
        if (!arc || arc.pendingBeat) continue;
        const phase = arc.phase || 'facade';
        if (phase === 'transformation' || phase === 'reversion') continue; // terminal — no further beats
        const threshold = CHARACTER_ARC_ENGAGEMENT_THRESHOLDS[phase];
        if (threshold === undefined) continue;
        const projectedScore = (arc.engagementScore || 0) + (engagementDeltas[npcId] || 0);
        if (projectedScore < threshold) continue;
        if (!(CHARACTER_ARC_TEMPO_AFFINITY[phase] || []).includes(tempoMode)) continue;
        candidates.push(npcId);
    }
    return candidates;
}

const REGIONAL_STATE_STALE_MESSAGES = 8;

/**
 * Whether a region's Regional State layer needs an LLM call this cycle.
 * @param {object|null} region
 * @param {number} messagesSinceLastCheck
 * @param {boolean} justEnteredRegion
 * @returns {boolean}
 */
export function shouldCheckRegionalState(region, messagesSinceLastCheck, justEnteredRegion) {
    if (justEnteredRegion) return true;
    if (!region) return false;
    if ((messagesSinceLastCheck || 0) >= REGIONAL_STATE_STALE_MESSAGES) return true;
    const unbloomedHooks = (region.hooks || []).filter(h => !h.discovered && !h.bloomed).length;
    return unbloomedHooks > 0 && messagesSinceLastCheck >= Math.floor(REGIONAL_STATE_STALE_MESSAGES / 2);
}

/**
 * Deterministic (non-LLM) qualitative pressure score. Feeds both
 * worldClock.pressureGauge (Layer 1) and pacing.pressureGaugeInputs (Layer 4).
 * @param {{activeSeedCount?: number, milestoneProximity?: 'low'|'building'|'high'|'critical', unresolvedFractureCount?: number, regionalInstabilityCount?: number, engagementTrend?: 'rising'|'flat'|'falling'}} inputs
 * @returns {'low'|'building'|'high'|'critical'}
 */
export function computePressureGauge(inputs = {}) {
    const {
        activeSeedCount = 0,
        milestoneProximity = 'low',
        unresolvedFractureCount = 0,
        regionalInstabilityCount = 0,
        engagementTrend = 'flat',
    } = inputs;

    const proximityScore = { low: 0, building: 1, high: 2, critical: 3 }[milestoneProximity] ?? 0;
    const trendScore = { rising: 1, flat: 0, falling: -1 }[engagementTrend] ?? 0;

    const score = Math.min(activeSeedCount, 5) * 0.5
        + proximityScore * 2
        + Math.min(unresolvedFractureCount, 4) * 1
        + Math.min(regionalInstabilityCount, 4) * 0.75
        + trendScore;

    if (score >= 7) return 'critical';
    if (score >= 4.5) return 'high';
    if (score >= 2) return 'building';
    return 'low';
}

const AFTERMATH_MIN_EXCHANGES = 2;

/**
 * Proposes the next tempo mode following the natural rhythm
 * Exploration → Escalation → Crisis → Aftermath → Exploration. This function
 * only ever proposes single-step natural transitions (`natural` is always
 * true) — deliberate skips/nests are a manual-override concern handled by the
 * caller (world-progression.js#forceAdvanceTempo), which sets natural:false
 * itself when it bypasses this evaluator.
 * @param {{mode: string, exchangesSinceModeEntered: number}} pacing
 * @param {'low'|'building'|'high'|'critical'} pressureGauge
 * @param {{primaryConvergenceResolved?: boolean}} [phaseGate]
 * @returns {{nextMode: string, natural: boolean, reason: string}}
 */
export function evaluateTempoTransition(pacing, pressureGauge, phaseGate = {}) {
    const mode = pacing?.mode || 'exploration';
    const exchanges = pacing?.exchangesSinceModeEntered || 0;

    if (mode === 'exploration') {
        if (pressureGauge === 'high' || pressureGauge === 'critical') {
            return { nextMode: 'escalation', natural: true, reason: 'pressure gauge elevated' };
        }
        return { nextMode: mode, natural: true, reason: 'holding exploration' };
    }
    if (mode === 'escalation') {
        if (pressureGauge === 'critical') {
            return { nextMode: 'crisis', natural: true, reason: 'pressure critical, threads converging' };
        }
        return { nextMode: mode, natural: true, reason: 'holding escalation' };
    }
    if (mode === 'crisis') {
        if (phaseGate?.primaryConvergenceResolved) {
            return { nextMode: 'aftermath', natural: true, reason: 'central decision made, consequences playing out' };
        }
        return { nextMode: mode, natural: true, reason: 'holding crisis' };
    }
    if (mode === 'aftermath') {
        if (exchanges >= AFTERMATH_MIN_EXCHANGES && pressureGauge !== 'critical') {
            return { nextMode: 'exploration', natural: true, reason: 'breathing room given' };
        }
        return { nextMode: mode, natural: true, reason: 'still processing aftermath' };
    }
    return { nextMode: 'exploration', natural: true, reason: 'unrecognized mode, resetting to exploration' };
}

const PHASE_GATE_SEED_ENGAGEMENT_PCT = 60;
const PHASE_GATE_MIN_AFTERMATH_EXCHANGES = 2;
const PHASE_GATE_MIN_ADDITIONAL_CRITERIA = 3; // of the 5 non-mandatory criteria, per "not all conditions required"

/**
 * The six-condition phase-gate check from the spec. `primaryConvergenceResolved`
 * is treated as mandatory (a chapter cannot end without its payoff); the
 * remaining five are a "combination... not all required" per spec, encoded
 * here as a best-of majority (≥3 of 5).
 * @param {object} chapter
 * @returns {{readyToAdvance: boolean, breakdown: object}}
 */
export function evaluatePhaseGate(chapter) {
    const seeds = chapter?.seeds || [];
    const engagedCount = seeds.filter(s => s.engaged || s.status === 'resolved_offscreen' || s.status === 'dormant').length;
    const seedsEngagedPct = seeds.length ? Math.round((engagedCount / seeds.length) * 100) : 0;

    const primaryConvergenceResolved = (chapter?.convergencesResolved || 0) >= 1;
    const worldClockThresholdReached = !!chapter?.phaseGate?.worldClockThresholdReached;
    const aftermathExchangeCount = chapter?.phaseGate?.aftermathExchangeCount || 0;
    const characterBeatFiredAndProcessed = !!chapter?.phaseGate?.characterBeatFiredAndProcessed;
    const regionalShiftReady = !!chapter?.phaseGate?.regionalShiftReady;

    const additionalCriteria = [
        seedsEngagedPct >= PHASE_GATE_SEED_ENGAGEMENT_PCT,
        worldClockThresholdReached,
        aftermathExchangeCount >= PHASE_GATE_MIN_AFTERMATH_EXCHANGES,
        characterBeatFiredAndProcessed,
        regionalShiftReady,
    ];
    const additionalCriteriaMet = additionalCriteria.filter(Boolean).length;

    const breakdown = {
        primaryConvergenceResolved,
        seedsEngagedPct,
        worldClockThresholdReached,
        aftermathExchangeCount,
        characterBeatFiredAndProcessed,
        regionalShiftReady,
        additionalCriteriaMet,
    };

    const readyToAdvance = primaryConvergenceResolved && additionalCriteriaMet >= PHASE_GATE_MIN_ADDITIONAL_CRITERIA;

    return { readyToAdvance, breakdown };
}

// ── Commit tool schema builder ─────────────────────────────────────────────────

/**
 * Builds the OpenAI-format `tools[]` array for this cycle's commit call,
 * populating only the sub-object properties for layers active this cycle.
 * Mirrors how router.js builds `agentTools`/`categoryEnum` dynamically.
 * @param {Set<string>|string[]} activeLayers - subset of 'worldArc'|'characterArc'|'regionalState'|'pacing'
 * @returns {Array<object>}
 */
export function buildCommitToolSchema(activeLayers) {
    const layers = activeLayers instanceof Set ? activeLayers : new Set(activeLayers || []);
    const properties = {};

    if (layers.has('worldArc')) {
        properties.worldArc = {
            type: 'object',
            description: 'Updates to faction posture/goals, milestone status, and the world clock.',
            properties: {
                factionUpdates: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            factionId: { type: 'string' },
                            posture: { type: 'string', enum: FACTION_POSTURES },
                            goal: { type: 'string' },
                            actionSummary: { type: 'string', description: 'One sentence: what this faction did off-screen this cycle.' },
                        },
                        required: ['factionId'],
                    },
                },
                milestoneUpdates: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            milestoneId: { type: 'string' },
                            status: { type: 'string', enum: MILESTONE_STATUSES },
                            howItPlayedOut: { type: 'string' },
                        },
                        required: ['milestoneId', 'status'],
                    },
                },
                worldClockNote: { type: 'string', description: 'One qualitative sentence on proximity to the next milestone.' },
                tectonicShift: {
                    type: 'object',
                    description: 'Only include if a rare, campaign-redefining shift just occurred (max 2-3 per arc). Must answer all four fields.',
                    properties: {
                        gained: { type: 'string' },
                        lost: { type: 'string' },
                        nowPossible: { type: 'string' },
                        nowImpossible: { type: 'string' },
                    },
                },
            },
        };
    }

    if (layers.has('characterArc')) {
        properties.characterArc = {
            type: 'object',
            properties: {
                beats: {
                    type: 'array',
                    description: 'One entry per NPC whose arc beat fired this cycle.',
                    items: {
                        type: 'object',
                        properties: {
                            npcId: { type: 'string' },
                            phase: { type: 'string', enum: CHARACTER_ARC_PHASES },
                            relationshipDepth: { type: 'string', enum: RELATIONSHIP_DEPTHS },
                            beatNote: { type: 'string', description: 'What happened — a seed for the player to notice, not a full revelation.' },
                        },
                        required: ['npcId', 'phase', 'beatNote'],
                    },
                },
            },
        };
    }

    if (layers.has('regionalState')) {
        properties.regionalState = {
            type: 'object',
            properties: {
                regionUpdates: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            regionId: { type: 'string' },
                            addModifiers: {
                                type: 'array',
                                items: { type: 'object', properties: { label: { type: 'string' }, note: { type: 'string' } }, required: ['label'] },
                            },
                            removeModifierIds: { type: 'array', items: { type: 'string' } },
                            addHooks: {
                                type: 'array',
                                items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
                            },
                            addResidue: {
                                type: 'array',
                                items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
                            },
                        },
                        required: ['regionId'],
                    },
                },
            },
        };
    }

    if (layers.has('pacing')) {
        properties.pacingJustification = {
            type: 'string',
            description: 'One sentence justifying a nested or skipped tempo transition. Omit for a natural, single-step transition.',
        };
    }

    properties.newSeeds = {
        type: 'array',
        description: '0-5 planted hooks for the current/next chapter. At least one tied to the world arc and one to a character arc when reseeding a chapter.',
        items: {
            type: 'object',
            properties: {
                text: { type: 'string' },
                tiedTo: { type: 'string', enum: ['character', 'world', 'regional', 'none'] },
                tiedToId: { type: 'string' },
            },
            required: ['text'],
        },
    };
    properties.developments = {
        type: 'array',
        description: 'Existing seeds that grew this cycle, from player engagement or off-screen drift.',
        items: {
            type: 'object',
            properties: {
                seedId: { type: 'string' },
                kind: { type: 'string', enum: ['reveal', 'complicate', 'connect'] },
                text: { type: 'string' },
            },
            required: ['seedId', 'kind', 'text'],
        },
    };
    properties.convergenceResolved = {
        type: 'boolean',
        description: 'True only if this cycle resolved the current chapter\'s primary convergence (2-3 threads colliding at a real-tradeoff decision point).',
    };

    return [{
        type: 'function',
        function: {
            name: 'commit_world_progression',
            description: 'Commit this cycle\'s world-progression updates. Call exactly once, at the end of your reasoning.',
            parameters: { type: 'object', properties, required: [] },
        },
    }];
}

// ── Micro-patch primitives (generic apply/invert for rollback) ────────────────

/** @param {object} root @param {string[]} path @returns {{existed: boolean, value: any}} */
function snapshotAt(root, path) {
    let cur = root;
    for (const key of path) {
        if (cur == null) return { existed: false, value: undefined };
        cur = cur[key];
    }
    return { existed: cur !== undefined, value: cur === undefined ? undefined : structuredClone(cur) };
}

/** @param {object} root @param {string[]} path @param {any} value */
function setAt(root, path, value) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (cur[key] === undefined || cur[key] === null) cur[key] = {};
        cur = cur[key];
    }
    cur[path[path.length - 1]] = value;
}

/** @param {object} root @param {string[]} path */
function deleteAt(root, path) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        if (cur == null) return;
        cur = cur[path[i]];
    }
    if (cur != null) delete cur[path[path.length - 1]];
}

/**
 * Records a single field change and returns the micro-patch describing how
 * to undo it (captured BEFORE the write). Push the return value onto a
 * running `microPatches` array; replay with `invertMicroPatches` to roll
 * an entire cycle's changes back (rollback for swipe/delete, §9).
 * @param {object} root
 * @param {string[]} path
 * @param {any} value
 * @returns {{path: string[], existed: boolean, value: any}}
 */
export function recordAndSet(root, path, value) {
    const before = snapshotAt(root, path);
    setAt(root, path, value);
    return { path, existed: before.existed, value: before.value };
}

/**
 * Undoes a sequence of micro-patches against `root`, in reverse order (so
 * sequential mutations to the same path unwind correctly). Missing-before
 * fields are deleted rather than set to undefined, so a newly-created entity
 * disappears entirely on rollback rather than leaving an `undefined` husk.
 * @param {object} root
 * @param {Array<{path: string[], existed: boolean, value: any}>} microPatches
 */
export function invertMicroPatches(root, microPatches) {
    for (let i = microPatches.length - 1; i >= 0; i--) {
        const { path, existed, value } = microPatches[i];
        if (existed) setAt(root, path, value);
        else deleteAt(root, path);
    }
}

// ── Layer update appliers (pure — mutate the passed state, return the micro-patch log) ──

/**
 * Applies a validated `worldArc` commit payload to `worldState` (mutates in
 * place) and returns the micro-patch log for rollback. Caller must run
 * `validateWorldProgressionCommit` first — this performs no validation.
 * @param {object} worldState - settings.worldStates[campaignPrefix]
 * @param {{factionUpdates?: object[], milestoneUpdates?: object[], worldClockNote?: string, tectonicShift?: object|null}} payload
 * @returns {Array<{path: string[], existed: boolean, value: any}>}
 */
export function applyWorldArcUpdate(worldState, payload) {
    const microPatches = [];
    const now = new Date().toISOString();

    for (const fu of (payload.factionUpdates || [])) {
        const existing = worldState.factions[fu.factionId] || { lorebookEntryId: '', posture: 'defensive', goal: '', lastActionAt: null, lastActionSummary: '' };
        microPatches.push(recordAndSet(worldState, ['factions', fu.factionId], {
            ...existing,
            posture: fu.posture || existing.posture,
            goal: fu.goal !== undefined ? fu.goal : existing.goal,
            lastActionAt: now,
            lastActionSummary: fu.actionSummary !== undefined ? fu.actionSummary : existing.lastActionSummary,
        }));
    }

    for (const mu of (payload.milestoneUpdates || [])) {
        const idx = worldState.milestoneChain.findIndex(m => m.id === mu.milestoneId);
        if (idx === -1) continue;
        const existing = worldState.milestoneChain[idx];
        microPatches.push(recordAndSet(worldState, ['milestoneChain', idx], {
            ...existing,
            status: mu.status,
            triggeredAt: mu.status === 'triggered' && !existing.triggeredAt ? now : existing.triggeredAt,
            howItPlayedOut: mu.howItPlayedOut !== undefined ? mu.howItPlayedOut : existing.howItPlayedOut,
        }));
    }

    if (payload.worldClockNote !== undefined) {
        microPatches.push(recordAndSet(worldState, ['worldClock', 'proximityNote'], payload.worldClockNote));
        microPatches.push(recordAndSet(worldState, ['worldClock', 'lastEvaluatedAt'], now));
    }

    if (payload.tectonicShift) {
        microPatches.push(recordAndSet(worldState, ['tectonicShiftsUsed'], (worldState.tectonicShiftsUsed || 0) + 1));
    }

    microPatches.push(recordAndSet(worldState, ['updatedAt'], now));
    return microPatches;
}

/**
 * Applies a validated `characterArc` commit payload's beats to
 * `worldState.characterArcs` (mutates in place). Sets `pendingBeat` rather
 * than clearing it immediately — the caller marks it processed once the beat
 * has actually been surfaced in the narrative (phase-gate criterion).
 * @param {object} worldState
 * @param {{beats?: object[]}} payload
 * @returns {Array<{path: string[], existed: boolean, value: any}>}
 */
export function applyCharacterArcUpdate(worldState, payload) {
    const microPatches = [];
    const now = new Date().toISOString();

    for (const b of (payload.beats || [])) {
        const existing = worldState.characterArcs[b.npcId] || makeDefaultCharacterArc();
        microPatches.push(recordAndSet(worldState, ['characterArcs', b.npcId], {
            ...existing,
            phase: b.phase || existing.phase,
            relationshipDepth: b.relationshipDepth || existing.relationshipDepth,
            pendingBeat: { type: b.phase, note: b.beatNote, stagedAt: now },
            lastBeatFiredAt: now,
        }));
    }
    return microPatches;
}

/**
 * Applies a validated `regionalState` commit payload to `chatWorldProg.regions`
 * (mutates in place) — appends stackable condition modifiers, hooks, and
 * consequence residue.
 * @param {object} chatWorldProg - chatStates[chatId].worldProg
 * @param {{regionUpdates?: object[]}} payload
 * @param {number} atMessageIndex
 * @returns {Array<{path: string[], existed: boolean, value: any}>}
 */
export function applyRegionalStateUpdate(chatWorldProg, payload, atMessageIndex = -1) {
    const microPatches = [];
    const now = new Date().toISOString();

    for (const ru of (payload.regionUpdates || [])) {
        const existing = chatWorldProg.regions[ru.regionId] || makeDefaultRegion();
        let modifiers = existing.conditionModifiers || [];
        if (ru.removeModifierIds?.length) {
            modifiers = modifiers.filter(m => !ru.removeModifierIds.includes(m.id));
        }
        if (ru.addModifiers?.length) {
            modifiers = [...modifiers, ...ru.addModifiers.map((m, i) => ({ id: `mod_${Date.now()}_${i}`, label: m.label, note: m.note || '', appliedAt: now }))];
        }
        const hooks = ru.addHooks?.length
            ? [...(existing.hooks || []), ...ru.addHooks.map((h, i) => ({ id: `hook_${Date.now()}_${i}`, text: h.text, discovered: false, bloomed: false }))]
            : (existing.hooks || []);
        const residue = ru.addResidue?.length
            ? [...(existing.residue || []), ...ru.addResidue.map((r, i) => ({ id: `res_${Date.now()}_${i}`, text: r.text, fromMessageIndex: atMessageIndex, createdAt: now }))]
            : (existing.residue || []);

        microPatches.push(recordAndSet(chatWorldProg, ['regions', ru.regionId], {
            ...existing,
            conditionModifiers: modifiers,
            hooks,
            residue,
        }));
    }
    return microPatches;
}

// ── Narrative scanning helpers (cheap, no LLM) ─────────────────────────────────

/**
 * Naive engagement signal: +1 for any tracked NPC whose name appears
 * (case-insensitive substring) in this cycle's narrative. Cheap and coarse
 * by design — feeds candidateCharacterArcBeats' threshold check, not a
 * precision metric.
 * @param {string} combinedNarrative
 * @param {Record<string, {name?: string}>} characterArcs
 * @returns {Record<string, number>} npcId -> engagement delta this cycle
 */
export function computeEngagementDeltas(combinedNarrative, characterArcs) {
    const deltas = {};
    if (!combinedNarrative) return deltas;
    const lower = combinedNarrative.toLowerCase();
    for (const [npcId, arc] of Object.entries(characterArcs || {})) {
        const name = (arc?.name || '').trim();
        if (!name) continue;
        if (lower.includes(name.toLowerCase())) deltas[npcId] = 1;
    }
    return deltas;
}

/**
 * Resolves the region the narrative is currently set in by reusing the same
 * "(Location: X, Y, Z)" status-footer convention router.js already parses
 * (see router.js's `locationRegex`), matched against known region names.
 * @param {Record<string, {name?: string}>} regions
 * @param {string} combinedNarrative
 * @returns {string|null} regionId, or null if no known region matches
 */
export function resolveCurrentRegionId(regions, combinedNarrative) {
    const locMatch = combinedNarrative?.match(/\(Location:\s*([^)]+)\)/i);
    const hierarchy = locMatch ? locMatch[1].trim().toLowerCase() : '';
    if (!hierarchy) return null;
    for (const [regionId, region] of Object.entries(regions || {})) {
        if (region?.name && hierarchy.includes(region.name.toLowerCase())) return regionId;
    }
    return null;
}

// ── Tempo directive prose (Layer 4 narrator-facing output, no LLM) ────────────

const TEMPO_DIRECTIVES = {
    exploration: `[World Progression — Tempo: Exploration]
Feeling: curiosity, possibility, open horizons. The player has room to breathe.
Prose: longer environmental descriptions; NPCs are talkative with their own concerns; details reward attention; allow humor, warmth, strangeness.
Do: plant seeds, introduce hooks, let the player wander and discover, build NPC relationships through low-stakes interaction, establish regional atmosphere.
Do not: force urgency, introduce major threats, rush through scenes, skip descriptive texture.`,
    escalation: `[World Progression — Tempo: Escalation]
Feeling: tension building. Something is coming. The ground is shifting underfoot.
Prose: shorter NPC dialogue; environmental details skew ominous or charged; previously introduced elements start connecting; consequences of earlier choices begin arriving.
Do: develop seeds into active threads, introduce complications, show faction movement, fire character-arc fracture beats, build mounting pressure through environment and NPC behavior.
Do not: resolve threads prematurely, dump all tension at once, remove player agency by making events feel inevitable.`,
    crisis: `[World Progression — Tempo: Crisis]
Feeling: compression. High stakes. The moment demands action and every choice forecloses others.
Prose: tight, urgent prose; fewer descriptive asides; NPCs are direct, desperate, or calculating; the environment reflects the stakes; time feels scarce even without a literal timer.
Do: fire convergence points, present hard choices with real trade-offs, fire character-arc crucible beats, resolve some accumulated threads (not all, not cleanly).
Do not: drag the crisis out past its natural duration, add new threads, provide easy outs, monologue.`,
    aftermath: `[World Progression — Tempo: Aftermath]
Feeling: exhale. Cost. Reflection. The dust settles and you see what's left.
Prose: quiet, observational; characters process what happened; the environment shows the marks of what occurred; small human moments; silence where there used to be noise.
Do: show consequences, fire character-arc transformation/reversion beats, allow relationship-building through shared experience, update regional atmosphere, plant the first seeds of the next cycle.
Do not: immediately escalate again, treat aftermath as dead time to skip, deny the player the emotional payoff of what just happened.`,
};

/**
 * Fixed, non-LLM prose block authoring the spec's "what the AI does/doesn't
 * do" + prose-signal content for the given tempo mode, delivered to the
 * narrator via setExtensionPrompt (never generated per-turn).
 * @param {string} mode
 * @returns {string}
 */
export function renderTempoDirective(mode) {
    return TEMPO_DIRECTIVES[mode] || TEMPO_DIRECTIVES.exploration;
}

// ── Default per-layer system prompt templates ──────────────────────────────────

export const WORLD_ARC_DEFAULT_PROMPT = `<world_arc_layer>
You are updating the World Arc — the spine of the campaign: faction states, the milestone chain, and the world clock.

Faction posture (aggressive/defensive/scheming/fractured/ascendant/declining) shifts based on world events and player interaction. Between player turns, a faction takes ONE logical step toward its current goal, constrained by resources and posture — not a full simulation. Record that single step as \`actionSummary\`.

The milestone chain is 5-8 INVARIANT events the world is heading toward regardless of player action. Never add or remove milestones. You may move a milestone from pending → approaching → triggered → resolved, and record how it played out (which is player-driven, even though the milestone itself was fixed).

The world clock is qualitative, not numeric. Update \`worldClockNote\` with a short sentence on proximity to the next milestone.

Only include a \`tectonicShift\` when something rare and campaign-redefining just happened (max 2-3 per arc) — a shift that redefines the terms of the story, not a normal development. It must answer what's gained, what's lost, and what's now possible/impossible.
</world_arc_layer>`;

export const CHARACTER_ARC_DEFAULT_PROMPT = `<character_arc_layer>
You are firing a Character Arc beat for one or more NPCs flagged as eligible this cycle (engagement threshold met, tempo mode compatible with their current phase).

Each NPC has a 4-phase arc: Facade (competence/charm/hostility/mystery, not the truth underneath) → Fracture (something cracks the facade — a seed, not a revelation) → Crucible (forced to confront what's behind the fracture, collides with world pressure) → Transformation or Reversion (changes for better or worse, or doubles down on who they were).

A Fracture beat should make the player curious, not informed. A Crucible beat should present a real choice affecting the NPC's trajectory. Transformation/Reversion should read as the consequence of accumulated interaction, not a single choice.

Relationship depth (stranger → acquaintance → familiar → trusted → bonded) determines what the NPC is willing to reveal, ask for, or risk — update it only when the accumulated interaction genuinely justifies a step change.
</character_arc_layer>`;

export const REGIONAL_STATE_DEFAULT_PROMPT = `<regional_state_layer>
You are updating Regional State — what it feels like to be in this place right now, relative to its baseline.

Condition modifiers stack and interact (e.g. "under occupation" + "flooded with refugees" tells a different story than either alone) — add or remove them as the situation actually changes.

Hooks are discoverable content, not quests — invitations to notice. Not every hook needs to bloom; some stay atmospheric.

Consequence residue is how the world demonstrates player actions mattered: if the player burned a bridge, the region reflects it; if they saved someone, that person is still there living the consequences. Add residue only for things the player actually did in this region, in their presence.
</regional_state_layer>`;

export const PACING_DEFAULT_PROMPT = `<pacing_layer>
You are justifying a nested or skipped tempo transition. The natural rhythm is Exploration → Escalation → Crisis → Aftermath → Exploration; nested pockets (a quiet camp scene during Escalation) are normal texture, but skipping a mode outright needs a one-sentence in-fiction justification for why the story is moving faster than the natural rhythm this cycle.
</pacing_layer>`;
