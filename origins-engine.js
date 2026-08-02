/**
 * origins-engine.js — Origins RPG Framework (Origins character creation)
 *
 * Pure logic module for the Origins creation flow: wizard step derivation,
 * race→origin filtering, NSFW filtering, incompatibility evaluation (hard
 * blocks, soft tensions requiring explanations), the Lever Guarantee check
 * (spec §0.2), draft randomization, the origin-profile JSON contract
 * (schema spec + all-errors validator, modeled on foundation.js's
 * validateFoundation), the [ORIGIN] memo-block serializer, the origins*
 * connection remap, and the prompt builders (profile generation, D&D stat
 * generation, first message).
 *
 * Pure module: no DOM, no SillyTavern context, no settings reads — everything
 * is parameterized so it runs unchanged under `node --test`.
 *
 * Imports: origins-data.js (leaf).
 * Imported by: origins-wizard.js, index.js (wiring), central-tension-compiler.js.
 */

import {
    ORIGINS, ORIGINS_BY_ID, RACES, RACES_BY_ID, CULTURE_VIBES, VIBES_BY_ID,
    VIBE_HARD_BLOCKS, VIBE_PAIR_GUIDANCE, GOVERNMENT_TYPES, ENVIRONMENTS,
    PURSUER_BLOCK, APPEARANCE_FIELDS, INTIMATE_FIELDS, OPENING_FRAMES,
    ORIGINS_SETTING, SILKBORN_SEVERANCE, VAMPIRE_ALLOWED_ORIGINS,
    RACE_EXCLUSIVE_TERMS,
} from './origins-data.js';

// ── Wizard steps (spec §7.1) ─────────────────────────────────────────────────

/**
 * Ordered wizard step ids. 'options' also hosts the master NSFW toggle.
 *
 * Appearance sits after Origin Details on purpose: its AI fill button proposes
 * values for the descriptors the player left blank, and those proposals have to
 * agree with the origin, nation and story blanks. Run earlier — where this step
 * used to be — the pass would know the race and nothing else.
 */
export const WIZARD_STEPS = Object.freeze(['options', 'race', 'origin', 'detail', 'appearance', 'review']);

export const WIZARD_STEP_LABELS = Object.freeze({
    options: 'Campaign Options',
    race: 'Race',
    appearance: 'Appearance',
    origin: 'Origin',
    detail: 'Origin Details',
    review: 'Review & Commit',
});

/**
 * Derives the furthest step a draft may legally display. The wizard persists
 * `draft.step`; this clamps it so a reload never lands past missing data.
 * @param {object|null|undefined} draft
 * @returns {string} one of WIZARD_STEPS
 */
export function deriveWizardStep(draft) {
    const d = draft || {};
    const requested = WIZARD_STEPS.includes(d.step) ? d.step : 'options';
    const reachable = (() => {
        if (!d.raceId) return 'race';
        if (!d.originId) return 'origin';
        return 'review';
    })();
    return WIZARD_STEPS.indexOf(requested) <= WIZARD_STEPS.indexOf(reachable) ? requested : reachable;
}

// ── Race / origin filtering (spec §4.7) ──────────────────────────────────────

/** Origins selectable for a race id (Vampire is restricted; spec §3.11). */
export function allowedOriginsForRace(raceId) {
    const race = RACES_BY_ID[raceId];
    if (!race) return [];
    if (!race.living) return ORIGINS.filter(o => VAMPIRE_ALLOWED_ORIGINS.includes(o.id));
    return ORIGINS.filter(o => o.requiredRace !== 'vampire' || raceId === 'vampire');
}

/** Whether an origin/race pairing is legal. */
export function isOriginAllowedForRace(originId, raceId) {
    return allowedOriginsForRace(raceId).some(o => o.id === originId);
}

/** Culture vibes offered under the given NSFW setting. */
export function vibesForNsfw(nsfw) {
    return CULTURE_VIBES.filter(v => nsfw || !v.nsfw);
}

/** An origin's modifiers filtered for context (NSFW gate + race requirement). */
export function modifiersForContext(originDef, { raceId, nsfw } = {}) {
    return (originDef?.modifiers || []).filter(m => {
        if (m.nsfw && !nsfw) return false;
        if (m.requiresRace && m.requiresRace !== raceId) return false;
        return true;
    });
}

// ── Selections & incompatibility evaluation (spec §5 / §13) ──────────────────

/**
 * @typedef {Object} Selections
 * @property {Record<string,string>} modifiers      {modifierId: optionId}
 * @property {Record<string,string>} blanks         {blankId: text}
 * @property {string[]}              vibes          1–2 culture vibe ids
 * @property {string|null}           vibeSub        Death-focused sub-option id
 * @property {object}                nation         {name, majorityRaceId, governmentId, environmentId, ...}
 * @property {object|null}           pursuer        {identity, affiliation, motive, resources, awareness, leverage}
 * @property {Record<string,string>} explanations   {ruleId: player/AI explanation for soft tensions}
 */

/** Empty selections skeleton for a fresh draft. */
export function emptySelections() {
    return {
        modifiers: {}, blanks: {}, vibes: [], vibeSub: null,
        nation: { name: '', majorityRaceId: '', governmentId: '', environmentId: '' },
        pursuer: null, explanations: {},
    };
}

// ── AI-fill provenance (spec §7.1 "leave empty → the AI proposes") ───────────

/**
 * `draft.aiFilled` is a flat list of dotted paths recording which values came
 * from a fill pass rather than from the player — e.g. `modifiers.claimants`,
 * `nation.name`, `pursuer.leverage`, `appearance.hair`, `intimate.chest`.
 *
 * It exists so Regenerate can re-roll the AI's own picks and nothing else. The
 * moment the player edits an AI value the path is dropped (`claimField`), which
 * is what makes "yours is never overwritten" hold across repeated regenerations
 * — the same guarantee mergeAppearance gives descriptors at commit.
 */

/** The wizard step a path belongs to: 'appearance' or 'detail'. */
export function pathSection(path) {
    return /^(appearance|intimate)\./.test(String(path || '')) ? 'appearance' : 'detail';
}

/** Records paths as AI-proposed. Idempotent; returns the new list. */
export function markAiFilled(draft, paths) {
    const d = draft || {};
    d.aiFilled = [...new Set([...(d.aiFilled || []), ...(paths || [])])];
    return d.aiFilled;
}

/** True when this value is currently the AI's rather than the player's. */
export function isAiFilled(draft, path) {
    return (draft?.aiFilled || []).includes(path);
}

/**
 * Marks a path as the player's. Called from every input handler on the fill
 * steps, so touching an AI value claims it and future regenerations leave it be.
 */
export function claimField(draft, path) {
    const d = draft || {};
    if (!d.aiFilled?.length) return;
    d.aiFilled = d.aiFilled.filter(p => p !== path);
}

/** The AI-filled paths belonging to one step. */
export function aiFilledPaths(draft, section) {
    return (draft?.aiFilled || []).filter(p => pathSection(p) === section);
}

/** Empties one path back to its unset form, per the container it lives in. */
function resetDraftPath(draft, path) {
    const sel = draft.selections || (draft.selections = emptySelections());
    const app = draft.appearance || (draft.appearance = {});
    const dot = String(path).indexOf('.');
    const head = dot === -1 ? String(path) : String(path).slice(0, dot);
    const tail = dot === -1 ? '' : String(path).slice(dot + 1);
    switch (head) {
        case 'modifiers': case 'blanks': case 'explanations':
            if (sel[head]) delete sel[head][tail];
            break;
        // Cleared to '' rather than deleted: the wizard's selects read these keys
        // directly and validateDraft reports them as unset either way.
        case 'nation': if (sel.nation) sel.nation[tail] = ''; break;
        case 'pursuer': if (sel.pursuer) sel.pursuer[tail] = ''; break;
        case 'vibes': sel.vibes = []; break;
        case 'vibeSub': sel.vibeSub = null; break;
        case 'appearance': delete app[tail]; break;
        case 'intimate': if (app.intimate) delete app.intimate[tail]; break;
        default: break;
    }
}

/**
 * Returns one step's AI-proposed values to "unset" and forgets them, so the
 * next fill pass sees genuine blanks. The player's own values are untouched —
 * they were never in `aiFilled` to begin with.
 * @returns {number} how many paths were cleared
 */
export function clearAiValues(draft, section) {
    const d = draft || {};
    const paths = aiFilledPaths(d, section);
    for (const p of paths) resetDraftPath(d, p);
    d.aiFilled = (d.aiFilled || []).filter(p => !paths.includes(p));
    return paths.length;
}

/**
 * Whether the Pursuer Block form should be live for the current selections
 * (spec §4.5 + per-origin pursuer notes in §5).
 */
export function pursuerNeeded(originDef, selections) {
    const sel = selections || {};
    switch (originDef?.pursuer) {
        case 'required': return true;
        case 'default_on': return sel.modifiers?.claimants !== 'none';
        case 'conditional': return sel.modifiers?.slumber_reason === 'hiding';
        case 'optional': return !!sel.modifiers?.replacement;
        default: return false;
    }
}

function ruleMatches(rule, selections) {
    const mods = selections?.modifiers || {};
    for (const [modId, optId] of Object.entries(rule.when || {})) {
        if (mods[modId] !== optId) return false;
    }
    if (rule.conflictsWithPursuer) {
        const p = selections?.pursuer;
        if (!p) return false;
        for (const [field, value] of Object.entries(rule.conflictsWithPursuer)) {
            if (p[field] !== value) return false;
        }
    }
    return true;
}

/**
 * Evaluates an origin's incompatibility rules against current selections.
 * `narrativeRule: true` rules are generation-time guidance, not selection
 * blockers — they are returned with level 'narrative' so prompt builders can
 * inject them, and the wizard never blocks on them.
 *
 * @returns {Array<{id: string, level: 'hard'|'soft'|'narrative', message: string, satisfied: boolean}>}
 *   Only rules whose `when`/`conflictsWithPursuer` conditions currently match.
 *   Hard rules are satisfied only via their declared escape (substituteLever /
 *   requiresBlank / requiresModifier); soft rules via a non-empty explanation.
 */
export function evaluateIncompatibilities(originDef, selections) {
    const out = [];
    for (const rule of originDef?.incompatibilities || []) {
        if (!ruleMatches(rule, selections)) continue;
        if (rule.narrativeRule) {
            out.push({ id: rule.id, level: 'narrative', message: rule.message, satisfied: true });
            continue;
        }
        if (rule.type === 'soft') {
            const explained = !!(selections?.explanations?.[rule.id] || '').trim();
            out.push({ id: rule.id, level: 'soft', message: rule.message, satisfied: explained });
            continue;
        }
        // Hard rule: satisfied only if its declared escape hatch is met.
        let satisfied = false;
        if (rule.substituteLever) satisfied = selections?.substituteLever === rule.substituteLever;
        else if (rule.requiresBlank) satisfied = !!(selections?.blanks?.[rule.requiresBlank] || '').trim();
        else if (rule.requiresModifier) {
            const val = selections?.modifiers?.[rule.requiresModifier.id];
            satisfied = rule.requiresModifier.anyOf.includes(val);
        }
        out.push({ id: rule.id, level: 'hard', message: rule.message, satisfied });
    }
    return out;
}

/**
 * Would selecting `optionId` for `modifierId` trip an unsatisfiable hard rule?
 * Used by the wizard to disable options live, with the rule message as reason.
 * @returns {string|null} the blocking message, or null if allowed
 */
export function optionBlockReason(originDef, selections, modifierId, optionId) {
    const hypothetical = {
        ...selections,
        modifiers: { ...(selections?.modifiers || {}), [modifierId]: optionId },
    };
    for (const r of evaluateIncompatibilities(originDef, hypothetical)) {
        if (r.level !== 'hard' || r.satisfied) continue;
        const rule = (originDef.incompatibilities || []).find(x => x.id === r.id);
        // Only report rules with no escape hatch as blocking — escapable rules
        // (substituteLever / requiresBlank / requiresModifier) surface in
        // validation instead, so the option itself stays selectable.
        if (!rule?.substituteLever && !rule?.requiresBlank && !rule?.requiresModifier) return r.message;
    }
    return null;
}

/** Vibe selection check: 1–2 vibes, hard-blocked pairs, Death sub-option. */
export function validateVibes(vibeIds, vibeSub) {
    const errors = [];
    const vibes = Array.isArray(vibeIds) ? vibeIds : [];
    if (vibes.length < 1 || vibes.length > 2) errors.push('Select 1–2 culture vibes.');
    for (const id of vibes) {
        if (!VIBES_BY_ID[id]) errors.push(`Unknown culture vibe "${id}".`);
    }
    for (const [a, b] of VIBE_HARD_BLOCKS) {
        if (vibes.includes(a) && vibes.includes(b)) {
            errors.push(`${VIBES_BY_ID[a].label} and ${VIBES_BY_ID[b].label} cannot be selected together.`);
        }
    }
    if (vibes.includes('death') && !CULTURE_VIBES.find(v => v.id === 'death').subOptions.some(s => s.id === vibeSub)) {
        errors.push('Death-focused requires its sub-option (reverence for the dead, or embrace of bringing death).');
    }
    return errors;
}

// ── Lever Guarantee (spec §0.2, per-origin substitutions in §5) ──────────────

/**
 * Origins whose guaranteed personal lever IS the pursuer's leverage. An empty
 * leverage box is not a draft error for these — the generator proposes one and
 * validateOriginProfile enforces that it actually did (see leverageMandatory).
 */
const LEVERAGE_IS_THE_LEVER = Object.freeze(['exiled_royal', 'defector_spy']);

/**
 * Whether this origin/race pairing requires a non-empty pursuer.leverage in the
 * *generated profile*. Silkborn Exiled Royals are exempt: the residual
 * hive-thread (Severance Block) substitutes as the personal lever.
 * @param {object|null|undefined} originDef
 * @param {string|null|undefined} raceId
 * @returns {boolean}
 */
export function leverageMandatory(originDef, raceId) {
    if (!originDef || !LEVERAGE_IS_THE_LEVER.includes(originDef.id)) return false;
    // Severed Silkborn Exiled Royals substitute the residual hive-thread.
    // Defector Spy has no such exemption (spec §5.8).
    if (originDef.id === 'exiled_royal' && raceId === 'silkborn') return false;
    return true;
}

/**
 * Every character must finish creation with an active personal lever.
 * Origin-specific: most origins carry a non-disableable lever; the exceptions
 * are encoded as hard incompatibility rules with escape hatches (Vampire Lord
 * substitute Thirst, Artifact "no claimants" agenda, Champion stable-power
 * substitutes).
 *
 * Note this does NOT require the player to type a leverage. The two
 * leverage-is-the-lever origins are enforced on the generated profile
 * (validateOriginProfile) rather than on the draft, so an empty box means "the
 * AI proposes one" exactly as the wizard promises.
 * @returns {string[]} errors (empty = guaranteed)
 */
export function checkLeverGuarantee(originDef, selections, raceId) {
    const errors = [];
    if (!originDef) return ['No origin selected.'];
    void raceId;
    // Escapable hard rules (leverGuard) are enforced via evaluateIncompatibilities;
    // repeat them here so review-step validation reports everything in one list.
    for (const r of evaluateIncompatibilities(originDef, selections)) {
        if (r.level === 'hard' && !r.satisfied) {
            const rule = (originDef.incompatibilities || []).find(x => x.id === r.id);
            if (rule?.leverGuard) errors.push(r.message);
        }
    }
    return errors;
}

// ── Full draft validation (review-step gate) ─────────────────────────────────

/**
 * Validates a complete draft before profile generation / commit. Returns ALL
 * errors (never just the first) so the wizard can show the full list — the
 * validateFoundation contract.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDraft(draft) {
    const errors = [];
    const d = draft || {};
    const race = RACES_BY_ID[d.raceId];
    const origin = ORIGINS_BY_ID[d.originId];

    if (!race) errors.push('No race selected.');
    if (!origin) errors.push('No origin selected.');
    if (race && origin && !isOriginAllowedForRace(origin.id, race.id)) {
        errors.push(`${race.name} cannot take the ${origin.name} origin (see the race–origin matrix).`);
    }
    if (!origin) return { ok: false, errors };

    const sel = d.selections || emptySelections();

    // Required modifiers (context-filtered; optional ones may stay unset).
    for (const m of modifiersForContext(origin, { raceId: d.raceId, nsfw: !!d.nsfw })) {
        if (!m.optional && !sel.modifiers?.[m.id]) errors.push(`Modifier not set: ${m.label}.`);
    }
    // NSFW-gated selections must not exist when the toggle is off.
    if (!d.nsfw) {
        for (const m of origin.modifiers || []) {
            if (m.nsfw && sel.modifiers?.[m.id]) errors.push(`"${m.label}" requires the campaign NSFW toggle.`);
        }
        for (const v of sel.vibes || []) {
            if (VIBES_BY_ID[v]?.nsfw) errors.push(`Culture vibe "${VIBES_BY_ID[v].label}" requires the campaign NSFW toggle.`);
        }
    }

    // Core Nation Block. The name is deliberately NOT required — an empty box
    // means "propose one" (selectionSummary emits the hint; the generator fills
    // it). Only the structured selects, which the model cannot infer, are gated.
    errors.push(...validateVibes(sel.vibes, sel.vibeSub));
    if (!GOVERNMENT_TYPES.some(g => g.id === sel.nation?.governmentId)) errors.push('Government type not set.');
    if (!ENVIRONMENTS.some(e => e.id === sel.nation?.environmentId)) errors.push('Location/environment not set.');
    if (!RACES_BY_ID[sel.nation?.majorityRaceId]) errors.push('Majority population race not set.');

    // Pursuer Block.
    const needsPursuer = origin.pursuer === 'required'
        || (origin.pursuer === 'default_on' && sel.modifiers?.claimants !== 'none');
    if (needsPursuer) {
        const p = sel.pursuer;
        if (!p) errors.push('Pursuer Block is required for this origin.');
        else {
            // identity and leverage are proposable — only the structured
            // selects are gated here (same rule as the nation name above).
            if (!PURSUER_BLOCK.affiliations.some(x => x.id === p.affiliation)) errors.push('Pursuer affiliation not set.');
            if (!PURSUER_BLOCK.motives.some(x => x.id === p.motive)) errors.push('Pursuer motive not set.');
            if (!PURSUER_BLOCK.resources.some(x => x.id === p.resources)) errors.push('Pursuer resources/capability not set.');
            if (!PURSUER_BLOCK.awareness.some(x => x.id === p.awareness)) errors.push('Pursuer awareness not set.');
        }
    }

    // Incompatibilities: hard must be satisfied, soft must be explained.
    for (const r of evaluateIncompatibilities(origin, sel)) {
        if (r.level === 'hard' && !r.satisfied) errors.push(r.message);
        if (r.level === 'soft' && !r.satisfied) errors.push(`Needs an explanation: ${r.message}`);
    }

    // Lever Guarantee (deduplicated against leverGuard rules already reported).
    for (const e of checkLeverGuarantee(origin, sel, d.raceId)) {
        if (!errors.includes(e)) errors.push(e);
    }

    return { ok: errors.length === 0, errors };
}

// ── Randomization (spec §7.4) ────────────────────────────────────────────────

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Produces a valid random Selections object for an origin (🎲 Random and the
 * "Forge me a character" path). Honors NSFW gating (never selects gated
 * options), avoids blocked vibe pairs, avoids unsatisfiable hard rules by
 * re-rolling (bounded), and fills pursuer/leverage placeholders that the AI
 * blank-proposal pass then rewrites into real content.
 * @param {object} originDef
 * @param {string} raceId
 * @param {boolean} nsfw
 * @param {() => number} [rng] uniform [0,1) source; injectable for tests
 */
export function randomizeSelections(originDef, raceId, nsfw, rng = Math.random) {
    const sel = emptySelections();
    // Modifiers: required ones only; skip optional/NSFW-gated (off by default per spec §9).
    for (const m of modifiersForContext(originDef, { raceId, nsfw })) {
        if (m.optional || m.nsfw) continue;
        for (let attempt = 0; attempt < 20; attempt++) {
            const opt = pick(rng, m.options).id;
            if (optionBlockReason(originDef, sel, m.id, opt) === null) { sel.modifiers[m.id] = opt; break; }
        }
        if (!sel.modifiers[m.id]) sel.modifiers[m.id] = m.options[0].id;
    }
    // Vibes: 1–2, no blocked pairs, no NSFW vibes unless enabled (random never picks them anyway).
    const pool = vibesForNsfw(false); // random rolls stay SFW; players opt into gated vibes manually
    const first = pick(rng, pool);
    sel.vibes = [first.id];
    if (rng() < 0.5) {
        const second = pick(rng, pool.filter(v =>
            v.id !== first.id && !VIBE_HARD_BLOCKS.some(([a, b]) =>
                (a === v.id && b === first.id) || (b === v.id && a === first.id))));
        if (second) sel.vibes.push(second.id);
    }
    if (sel.vibes.includes('death')) {
        sel.vibeSub = pick(rng, VIBES_BY_ID['death'].subOptions).id;
    }
    // Nation: majority race defaults to the character's race (spec §4.7); AI names it later.
    const race = RACES_BY_ID[raceId];
    sel.nation = {
        name: '',
        majorityRaceId: raceId === 'vampire' && originDef.id !== 'vampire_lord' ? 'human' : raceId,
        governmentId: pick(rng, GOVERNMENT_TYPES.filter(g => g.id !== 'other'
            && (g.id !== 'hive_consensus' || raceId === 'silkborn')
            && (g.id !== 'necrocracy' || raceId === 'vampire'))).id,
        environmentId: race?.environmentId || pick(rng, ENVIRONMENTS.filter(e => e.id !== 'other')).id,
    };
    if (originDef.id === 'vampire_lord') sel.nation.majorityRaceId = 'vampire';
    // Pursuer where the origin needs one.
    const needsPursuer = originDef.pursuer === 'required'
        || (originDef.pursuer === 'default_on' && sel.modifiers.claimants !== 'none');
    if (needsPursuer) {
        sel.pursuer = {
            identity: '',
            affiliation: pick(rng, PURSUER_BLOCK.affiliations).id,
            motive: pick(rng, PURSUER_BLOCK.motives).id,
            resources: pick(rng, PURSUER_BLOCK.resources).id,
            awareness: pick(rng, PURSUER_BLOCK.awareness).id,
            leverage: '',
        };
        // Modifier picks can hard-conflict with pursuer fields (e.g. destroyed
        // kingdom × pursuer from the origin body). Re-roll the offending
        // pursuer field until no escape-less hard rule matches.
        const fieldLists = {
            affiliation: PURSUER_BLOCK.affiliations, motive: PURSUER_BLOCK.motives,
            resources: PURSUER_BLOCK.resources, awareness: PURSUER_BLOCK.awareness,
        };
        for (let attempt = 0; attempt < 20; attempt++) {
            const blocking = (originDef.incompatibilities || []).find(rule =>
                rule.type === 'hard' && rule.conflictsWithPursuer
                && !rule.substituteLever && !rule.requiresBlank && !rule.requiresModifier
                && evaluateIncompatibilities(originDef, sel).some(r => r.id === rule.id && !r.satisfied));
            if (!blocking) break;
            for (const [field, value] of Object.entries(blocking.conflictsWithPursuer)) {
                const alternatives = fieldLists[field].filter(x => x.id !== value);
                sel.pursuer[field] = pick(rng, alternatives).id;
            }
        }
    }
    return sel;
}

// ── Anti-generic directive (shared across every generation prompt) ───────────

/**
 * Guards against the dominant failure mode: pattern-matching to genre
 * convention, or to the most vivid fixture already in context, instead of
 * reasoning from what the player actually chose. Interpolated into all four
 * generation prompts (profile, opening narration, stat sheet, World Arc).
 * Callers append a per-prompt tail naming the concrete referent for "this
 * fiction" — see ANTI_GENERIC_TAILS.
 */
export const ANTI_GENERIC_DIRECTIVE = `
BEFORE WRITING ANY DETAIL, CHECK YOURSELF:
Am I reasoning from THIS character's established specifics — their race, nation, modifiers, and filled blanks — or from genre convention, common tropes, and narrative defaults?
If you catch yourself thinking "this kind of character usually…" or "this kind of story usually…" — stop. Go back and re-read what has actually been established. The most common failure mode is pattern-matching to a familiar trope instead of reasoning from the actual material, closely followed by borrowing the most vivid fixture already in your context and attaching it to whoever you are writing.
Setting anchors and world canon are background the world contains — not a menu of features to hang on this character. A detail is only earned if it follows from a specific choice in front of you.`;

/** Per-prompt tails appended to ANTI_GENERIC_DIRECTIVE. */
export const ANTI_GENERIC_TAILS = Object.freeze({
    profile: 'For this task: the player selections below are the established fiction. The setting anchors are not.',
    detail: 'For this task: fill the gaps this particular character leaves, not the gaps this origin usually leaves. Every choice you make has to follow from what the player already set.',
    appearance: "For this task: this character's history, nation and origin are already fixed below — the descriptors you propose have to look like they belong to that person, not to a default member of their race.",
    opening: "For this task: open on this character's actual situation as the profile describes it — not on a scene this genre usually opens with.",
    stats: "For this task: gear and abilities must trace to this character's history, nation, and origin — not to a default loadout for their class.",
    worldArc: 'For this task: the milestone chain must follow from the seed material below. Do not fall back to an escalating-ancient-evil shape unless the seed material actually points there.',
});

/** ANTI_GENERIC_DIRECTIVE plus the named per-prompt tail. */
export function antiGenericBlock(kind) {
    const tail = ANTI_GENERIC_TAILS[kind];
    return tail ? `${ANTI_GENERIC_DIRECTIVE}\n${tail}` : ANTI_GENERIC_DIRECTIVE;
}

// ── Connection ───────────────────────────────────────────────────────────────

/**
 * Remaps the origins* settings namespace onto the shape sendStateRequest and
 * sendAgentTurn expect — the exact pattern of router.js's routerSettings and
 * world-progression.js's worldProgSettings.
 *
 * Every LLM call the creation flow makes goes through this, so the whole flow
 * can sit on a strong creative model while the State Tracker — which runs on
 * every turn — stays wherever the user put it. `originsConnectionSource`
 * defaults to "default", i.e. ST's active API via generateRaw({ bypassAll:
 * true }), which is what these calls used before Origins had its own block.
 *
 * @param {object} settings - raw extension settings
 */
export function originsSettings(settings) {
    const s = settings || {};
    return {
        ...s,
        connectionSource: s.originsConnectionSource || 'default',
        connectionProfileId: s.originsConnectionProfileId,
        completionPresetId: s.originsCompletionPresetId,
        ollamaUrl: s.originsOllamaUrl,
        ollamaModel: s.originsOllamaModel,
        openaiUrl: s.originsOpenaiUrl,
        openaiKey: s.originsOpenaiKey,
        openaiModel: s.originsOpenaiModel,
        maxTokens: (s.originsMaxTokens !== undefined && s.originsMaxTokens !== null && s.originsMaxTokens !== '')
            ? Number(s.originsMaxTokens)
            : 0,
    };
}

// ── Origin profile JSON contract (spec §6) ───────────────────────────────────

/**
 * Prose schema spec fed to the model (the foundation-wizard "models follow
 * examples far more reliably than JSONSchema" convention).
 */
export const ORIGIN_PROFILE_SCHEMA_SPEC = `
The origin profile JSON object MUST have exactly this shape:

{
  "name": "character's full name (never {{user}})",
  "title": "title if the origin implies one, else \\"\\"",
  "race": "race name",
  "origin": "origin name",
  "nation": {
    "name": "nation/kingdom name",
    "majorityRace": "race name",
    "government": "government type",
    "cultureVibes": "the 1-2 selected vibes, comma-separated",
    "environment": "location/environment",
    "outsiderView": "1-2 sentences: how outsiders see this nation (derived; canon once stated)",
    "tone": "1-2 sentences: daily life, aesthetics, architecture"
  },
  "secondaryNation": null OR the same shape as nation (Willing Cultist outsiders only),
  "backstory": "3-6 paragraphs of narrative prose synthesized from the blanks and modifiers",
  "appearanceNotes": "1 short paragraph: origin-relevant physical traits ONLY (decay state, curse marks, artifact fusion) — distinct from the base descriptors below",
  "appearanceFilled": { "<fieldId>": "proposed value" },
  "appearanceSummary": "1-2 sentences: how this character reads at a glance, in third person",
  "intimateFilled": { "<fieldId>": "proposed value" },
  "socialLever": { "text": "the mark/tell/symbol/reputation", "legibleTo": "who can read it" },
  "personalLever": { "text": "the active clock, cost, curse, dependency, or leverage" },
  "pursuer": null OR {
    "identity": "named individual, small group, or organized body",
    "affiliation": "...", "motive": "...", "resources": "...", "awareness": "...",
    "leverage": "what they hold over the player beyond force (empty string only if the origin allows it)"
  },
  "currentGoal": "1-2 sentences, player-facing: what the character wants right now",
  "personalityVoice": "2-4 sentences: how the character speaks and carries themselves, distinct from what happened to them",
  "worldThreatTieIn": "1-2 sentences: the thread connecting this origin to a campaign-scale threat",
  "questSeeds": ["4 to 8 short private quest directions for the narrator — never shown to the player"]
}

Constraints: every string field non-empty unless explicitly allowed empty above. backstory must be consistent with EVERY selected modifier and blank — contradicting a selection is a validation failure. questSeeds are directions, not pre-written quests; they surface lazily in play.

APPEARANCE. The player's selections list every descriptor field with its [fieldId]. The descriptive work happens in "appearanceFilled", which holds one entry for EVERY field marked (unset) — keyed by that exact fieldId — and NOTHING else: never restate, revise, or "improve" a value the player typed, and never invent a fieldId that wasn't listed. Proposals must fit the race appearance reference and agree with the backstory. "appearanceSummary" is then a BRIEF at-a-glance line — one or two sentences, no more — drawn from the finished picture (the player's values and yours together): no labels, no lists, no field names, and non-explicit no matter the campaign rating. It is not a substitute for the field data and not a paragraph to quote back; the fields carry the detail, the summary just says how this character reads on sight. "intimateFilled" follows the same rules as "appearanceFilled" and exists ONLY when intimate details were listed in the selections — omit the key entirely otherwise. There is NO intimate prose field: never write a prose description of intimate details anywhere in this profile, including in "appearanceSummary", "appearanceNotes", or the backstory.

VOICE — who reads which field. "socialLever.text", "personalLever.text", "currentGoal", and "personalityVoice" are displayed to the PLAYER in their character sheet. Write them in-fiction, naming the thing as the character themselves would experience and describe it. Do NOT use system vocabulary in them — no "social lever", no "personal lever", no "block", no "modifier", no rules-speak, and no naming of framework machinery. "A debt-mark burned under her palm-scales that any Caldian factor can read" is correct; "the Debt-Mark Block, a mechanic acting as her personal lever" is not. Mechanical and narrator-facing framing belongs in "questSeeds", which the player never sees.

RACE FIDELITY. A character has ONLY the mechanics their own race grants. Never give a character another race's signature mechanic, and never invent a variant of one for them — no hive-links, weave-threads, or severance for non-Silkborn; no thirst or feeding clock for the non-undead. If this character needs a personal lever, build it from their own origin, nation, pursuer, and history.`;

/**
 * Race-exclusive mechanic terms found in the player-facing lever/goal/voice
 * fields of a profile belonging to a different race.
 * @returns {string[]} errors (empty = clean)
 */
export function checkRaceExclusivity(profile, raceId) {
    if (!profile || !raceId) return [];
    const haystack = [
        profile.socialLever?.text, profile.personalLever?.text,
        profile.currentGoal, profile.personalityVoice, profile.appearanceNotes,
    ].filter(s => typeof s === 'string').join(' \n ').toLowerCase();
    if (!haystack.trim()) return [];

    const errors = [];
    for (const [ownerRaceId, terms] of Object.entries(RACE_EXCLUSIVE_TERMS)) {
        if (ownerRaceId === raceId) continue;
        const hits = terms.filter(t => haystack.includes(t));
        if (hits.length) {
            const ownerName = RACES_BY_ID[ownerRaceId]?.name || ownerRaceId;
            const thisName = RACES_BY_ID[raceId]?.name || raceId;
            errors.push(
                `${ownerName}-exclusive mechanics appear on a ${thisName} character (${hits.join(', ')}). `
                + `A ${thisName} has none of these. Rewrite the lever, goal, voice, and appearance notes so every `
                + `mechanic follows from this character's own race, origin, nation, and pursuer.`);
        }
    }
    return errors;
}

/**
 * Descriptor proposals are only accepted for fields the player left blank.
 * Anything else is the model editing a choice it was told to honor, and a wrong
 * id would be dropped silently by mergeAppearance — so both fail the pass and
 * get retried.
 *
 * Shared by the full-profile validator and the Appearance step's fill pass so
 * the two can't drift on what a legal proposal is.
 *
 * @param {object|null|undefined} filled - {fieldId: proposed value}; absent is fine
 * @param {Array<{id: string}>} fields - APPEARANCE_FIELDS or INTIMATE_FIELDS
 * @param {Set<string>} [blanks] - ids the player left unset; omit to skip the check
 * @param {string} [label] - key name used in the error text
 * @returns {string[]} errors (empty = clean)
 */
export function validateFieldProposals(filled, fields, blanks, label = 'filled') {
    if (filled === undefined || filled === null) return [];
    if (typeof filled !== 'object' || Array.isArray(filled)) return [`${label} must be an object.`];
    const errors = [];
    for (const [id, value] of Object.entries(filled)) {
        if (!fields.some(f => f.id === id)) { errors.push(`${label}.${id} is not an appearance field id.`); continue; }
        if (typeof value !== 'string' || !value.trim()) errors.push(`${label}.${id} must be a non-empty string.`);
        if (blanks && !blanks.has(id)) errors.push(`${label}.${id} was filled in by the player — never restate or revise it.`);
    }
    return errors;
}

/**
 * All-errors validator for the AI-generated origin profile.
 * @param {object} profile
 * @param {object} originDef
 * @param {string} [raceId] - enables the race-exclusivity check and the
 *   Silkborn exemption on the mandatory-leverage origins.
 * @param {{appearance: Set<string>, intimate: Set<string>}} [blankIds] - which
 *   descriptor fields the player left unset, from appearanceBlankIds(). Omit to
 *   skip the "proposed a field the player already filled" check.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateOriginProfile(profile, originDef, raceId, blankIds) {
    const errors = [];
    const p = profile;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['Profile is not a JSON object.'] };

    const reqStr = (obj, key, label) => {
        if (typeof obj?.[key] !== 'string' || !obj[key].trim()) errors.push(`Missing or empty field: ${label || key}.`);
    };
    reqStr(p, 'name'); reqStr(p, 'race'); reqStr(p, 'origin');
    if (typeof p.title !== 'string') errors.push('title must be a string (may be empty).');
    if (!p.nation || typeof p.nation !== 'object') errors.push('Missing nation object.');
    else for (const k of ['name', 'majorityRace', 'government', 'cultureVibes', 'environment', 'outsiderView', 'tone']) {
        reqStr(p.nation, k, `nation.${k}`);
    }
    reqStr(p, 'backstory');
    if (typeof p.appearanceNotes !== 'string') errors.push('appearanceNotes must be a string.');
    reqStr(p, 'appearanceSummary');
    errors.push(...validateFieldProposals(p.appearanceFilled, APPEARANCE_FIELDS, blankIds?.appearance, 'appearanceFilled'));
    errors.push(...validateFieldProposals(p.intimateFilled, INTIMATE_FIELDS, blankIds?.intimate, 'intimateFilled'));
    if (!p.socialLever || typeof p.socialLever !== 'object') errors.push('Missing socialLever object.');
    else { reqStr(p.socialLever, 'text', 'socialLever.text'); reqStr(p.socialLever, 'legibleTo', 'socialLever.legibleTo'); }
    if (!p.personalLever || typeof p.personalLever !== 'object') errors.push('Missing personalLever object.');
    else reqStr(p.personalLever, 'text', 'personalLever.text');

    const pursuerRequired = originDef && (originDef.pursuer === 'required' || originDef.pursuer === 'default_on');
    if (pursuerRequired && !p.pursuer) {
        // default_on origins may legitimately omit the pursuer only when the
        // "no claimants" opt-out was selected — the caller passes selections-
        // aware originDef context; here we only enforce the required case.
        if (originDef.pursuer === 'required') errors.push('Missing pursuer (required for this origin).');
    }
    if (p.pursuer) {
        for (const k of ['identity', 'affiliation', 'motive', 'resources', 'awareness']) reqStr(p.pursuer, k, `pursuer.${k}`);
        if (typeof p.pursuer.leverage !== 'string') errors.push('pursuer.leverage must be a string.');
        // This is where the Lever Guarantee is enforced — on the generated
        // profile, not the draft, so an empty leverage box means "propose one".
        // raceId is optional for back-compat; without it the Silkborn exemption
        // cannot apply, so fall back to the origin-only rule.
        const leverageRequired = raceId
            ? leverageMandatory(originDef, raceId)
            : (originDef?.id === 'exiled_royal' || originDef?.id === 'defector_spy');
        if (leverageRequired && !(p.pursuer.leverage || '').trim()) {
            errors.push('pursuer.leverage is mandatory for this origin (Lever Guarantee) — propose something concrete they hold beyond force.');
        }
    }
    reqStr(p, 'currentGoal'); reqStr(p, 'personalityVoice'); reqStr(p, 'worldThreatTieIn');
    if (!Array.isArray(p.questSeeds) || p.questSeeds.length < 4 || p.questSeeds.length > 8) {
        errors.push('questSeeds must be an array of 4 to 8 strings.');
    } else if (p.questSeeds.some(q => typeof q !== 'string' || !q.trim())) {
        errors.push('questSeeds entries must be non-empty strings.');
    }
    errors.push(...checkRaceExclusivity(p, raceId));
    return { ok: errors.length === 0, errors };
}

// ── [ORIGIN] memo block serializer (spec §7.2; compact — memo is tier 5) ─────

/** Human-readable option label for a selected modifier value. */
function optionLabel(originDef, modId, optId) {
    const m = (originDef?.modifiers || []).find(x => x.id === modId);
    return m?.options.find(o => o.id === optId)?.label || optId;
}

/**
 * Which descriptor fields the player left blank — i.e. the exact set the model is
 * allowed to propose. Shared by the prompt builder and the validator so the two
 * can't drift apart on what counts as unset.
 * @param {object} appearance - draft appearance
 * @returns {{appearance: Set<string>, intimate: Set<string>}}
 */
export function appearanceBlankIds(appearance) {
    const app = appearance || {};
    const blanks = (fields, src) => new Set(fields.filter(f => !(src?.[f.id] || '').trim()).map(f => f.id));
    return { appearance: blanks(APPEARANCE_FIELDS, app), intimate: blanks(INTIMATE_FIELDS, app.intimate) };
}

/**
 * Folds the generator's proposals for blank descriptors into the player's own.
 *
 * The player always wins: a field they typed is never overwritten, however the
 * model answered. Same contract applyOriginCanon enforces on the memo block —
 * re-derive from what the player committed rather than trusting the model's copy.
 * Unknown field ids are dropped, so a hallucinated key can't reach the profile.
 *
 * @param {object} appearance - draft appearance ({...fields, intimate:{...}})
 * @param {object} [filled] - profile.appearanceFilled
 * @param {object} [intimateFilled] - profile.intimateFilled
 * @param {boolean} [nsfw] - when false, intimate proposals are discarded outright
 * @returns {object} a new appearance object
 */
export function mergeAppearance(appearance, filled, intimateFilled, nsfw = false) {
    const app = appearance || {};
    const merge = (fields, own, proposed) => {
        const out = {};
        for (const f of fields) {
            const mine = (own?.[f.id] || '').trim();
            const theirs = typeof proposed?.[f.id] === 'string' ? proposed[f.id].trim() : '';
            const value = mine || theirs;
            if (value) out[f.id] = value;
        }
        return out;
    };
    const merged = merge(APPEARANCE_FIELDS, app, filled);
    const intimate = merge(INTIMATE_FIELDS, app.intimate, nsfw ? intimateFilled : null);
    if (Object.keys(intimate).length) merged.intimate = intimate;
    return merged;
}

/**
 * Compact "Skin: …; Height: …" summary of the base appearance descriptors.
 * Superseded by `appearanceSummary` (and, for the campaigns committed in
 * between, the longer `appearanceProse` it replaced) — retained as the last
 * fallback for campaigns committed before either existed.
 */
export function formatAppearanceLine(appearance) {
    const app = appearance || {};
    return APPEARANCE_FIELDS.map(f => (app[f.id] || '').trim() ? `${f.label}: ${String(app[f.id]).trim()}` : null)
        .filter(Boolean).join('; ');
}

/**
 * The short appearance line for a profile, across all three generations of the
 * contract: today's `appearanceSummary`, the longer `appearanceProse` it
 * replaced, and the `;`-joined descriptor list from before either existed.
 *
 * Shared by the memo block, the opening prompt and the lorebook writer so the
 * three can't drift on which campaigns still render a description.
 *
 * @param {object} profile - a generated or committed profile; `profile.appearance`
 *   (present on st.origin.committed) feeds the last fallback.
 * @returns {string} '' when the profile carries nothing to show
 */
export function resolveAppearanceSummary(profile) {
    const p = profile || {};
    return (p.appearanceSummary || '').trim()
        || (p.appearanceProse || '').trim()
        || formatAppearanceLine(p.appearance);
}

/**
 * Serializes a committed profile into the compact [ORIGIN] memo block.
 * Deterministic — written by the framework at commit, never by the model.
 * Full canon (backstory, nation prose) lives in the lorebook, not here.
 *
 * The memo is BOTH the narrator's always-on context and the HUD card the
 * player reads, so anything added here is visible to both.
 *
 * @param {object} profile - the committed profile; `profile.appearance` (present
 *   on st.origin.committed) supplies the Appearance line when set.
 * @param {object} [originDef]
 */
export function buildOriginMemoBlock(profile, originDef) {
    const p = profile;
    const lines = [
        `Origin: ${p.origin}${p.title ? ` — ${p.title}` : ''} (${ORIGINS_SETTING.name})`,
        `Race: ${p.race}`,
    ];
    // Deliberately the short line, not the full description: this block is the
    // always-on narrator context as well as the HUD card, so anything here
    // rides every turn and sits permanently on screen. The field-by-field
    // description — and every intimate descriptor — lives in the
    // keyword-triggered lorebook entries instead.
    const appearanceLine = resolveAppearanceSummary(p);
    if (appearanceLine) lines.push(`Appearance: ${appearanceLine}`);
    lines.push(
        `Social Lever: ${p.socialLever.text} (legible to: ${p.socialLever.legibleTo})`,
        `Personal Lever: ${p.personalLever.text}`,
        `Nation: ${p.nation.name} — ${p.nation.government}; ${p.nation.cultureVibes}; ${p.nation.environment}; majority ${p.nation.majorityRace}`,
    );
    if (p.secondaryNation?.name) {
        lines.push(`Home Nation: ${p.secondaryNation.name} — ${p.secondaryNation.government}; majority ${p.secondaryNation.majorityRace}`);
    }
    if (p.pursuer) {
        const lev = (p.pursuer.leverage || '').trim();
        lines.push(`Pursuer: ${p.pursuer.identity} — motive: ${p.pursuer.motive}; awareness: ${p.pursuer.awareness}${lev ? `; leverage: ${lev}` : ''}`);
    }
    lines.push(`Current Goal: ${p.currentGoal}`);
    // World-Threat Tie-In is deliberately absent until a World Arc is compiled.
    // Pre-arc it is only a private seed for the tension compiler; publishing it
    // here would show the player a campaign promise nothing has committed to.
    // commitCentralTension sets `arcTieIn` and rewrites this block.
    const arcTieIn = (p.arcTieIn || '').trim();
    if (arcTieIn) lines.push(`World-Threat Tie-In: ${arcTieIn}`);
    lines.push(`Voice: ${p.personalityVoice}`);
    void originDef;
    return `[ORIGIN]\n${lines.join('\n')}\n[/ORIGIN]`;
}

/**
 * Serializes a committed profile into the immutable-canon section handed to the
 * Lorebook Agent on every pass.
 *
 * The agent otherwise sees only the labels of archived entries and a short
 * narrative window, so when it records an NPC first named in the backstory it has
 * nothing to check itself against and invents attributes. The backstory prose is
 * included verbatim for exactly that reason — it is where those NPCs come from.
 *
 * @param {object|null|undefined} profile - `chatStates[chatId].origin.committed`
 * @returns {string} the section, or '' when no origin is committed
 */
export function buildOriginCanonSection(profile) {
    const p = profile;
    if (!p || !p.name) return '';

    const lines = [
        `${p.origin || 'Unknown origin'} — ${p.name}${p.title ? `, ${p.title}` : ''} (${p.race || 'unknown race'})`,
    ];
    if (p.nation?.name) {
        lines.push(`Origin nation: ${p.nation.name} — ${p.nation.government || ''}; ${p.nation.cultureVibes || ''}; majority ${p.nation.majorityRace || 'unknown'}`);
    }
    if (p.secondaryNation?.name) {
        lines.push(`Home nation: ${p.secondaryNation.name} — ${p.secondaryNation.government || ''}; majority ${p.secondaryNation.majorityRace || 'unknown'}`);
    }
    if (p.socialLever?.text) lines.push(`Social lever: ${p.socialLever.text} (legible to: ${p.socialLever.legibleTo || ''})`);
    if (p.personalLever?.text) lines.push(`Personal lever: ${p.personalLever.text}`);
    if (p.pursuer?.identity) {
        const lev = (p.pursuer.leverage || '').trim();
        lines.push(`Pursuer: ${p.pursuer.identity} (${p.pursuer.affiliation || 'unaffiliated'}) — motive: ${p.pursuer.motive || ''}; awareness: ${p.pursuer.awareness || ''}${lev ? `; leverage: ${lev}` : ''}`);
    }
    if (p.backstory) lines.push(`\nBackstory:\n${p.backstory}`);

    return `## ORIGIN CANON (IMMUTABLE)\n${lines.join('\n')}\n\n`
        + `These facts were fixed at character creation. Never record, rewrite or consolidate an entry `
        + `that contradicts them — including the attributes of any person, place or faction named above. `
        + `If the narrative appears to contradict this canon, record the discrepancy as an explicit `
        + `unresolved tension inside the entry; do not assert a replacement fact.`;
}

/**
 * Normalizes the [ORIGIN] block in a merged memo back to engine truth — the same
 * contract applyModernProgression enforces for [XP], for the same reason.
 *
 * mergeMemo treats every tag uniformly: it clobbers a block wholesale on replace
 * and deletes it outright on [ORIGIN]REMOVED[/ORIGIN]. So the "engine owns this
 * block" guarantee in the extractor prompt (constants.js `origin`) was prose with
 * nothing behind it — the state model could rewrite the character's race, nation
 * or pursuer, or drop the block entirely.
 *
 * The one edit that prompt does permit is the Current Goal line, so that is
 * harvested rather than reverted. Persisting it back to `committed` also closes a
 * latent drift: publishOriginArcTieIn rebuilds this whole block from `committed`,
 * which would otherwise restore the creation-time goal.
 *
 * No-op for every campaign without a committed origin.
 *
 * @param {object} settings
 * @param {string} merged - the memo after mergeMemo
 * @param {string|null} [chatId] - defaults to the active chat
 * @returns {string}
 */
export function applyOriginCanon(settings, merged, chatId = null) {
    try {
        const id = chatId || (typeof globalThis._rpgCurrentChatId === 'function'
            ? globalThis._rpgCurrentChatId()
            : SillyTavern.getContext().chatId);
        if (!id) return merged;

        const committed = settings?.chatStates?.[id]?.origin?.committed;
        if (!committed) return merged;

        const block = String(merged || '').match(/\[ORIGIN\]([\s\S]*?)\[\/ORIGIN\]/i);
        if (block) {
            const goal = block[1].match(/^[ \t]*Current Goal:[ \t]*(.+)$/im);
            const next = goal?.[1]?.trim();
            if (next && next !== committed.currentGoal) committed.currentGoal = next;
        }

        // Re-derive from `committed`: reverts any other rewritten line, and
        // re-appends the block when the extractor deleted it.
        return writeOriginToMemo(merged, buildOriginMemoBlock(committed, ORIGINS_BY_ID[committed.originId]));
    } catch (e) {
        console.warn('[RPG Tracker] Origin canon normalization failed open:', e);
        return merged;
    }
}

/**
 * Pure regex replace-or-append of the [ORIGIN] block in a memo string
 * (the writeXpLineToMemo shape from memo-processor.js).
 */
export function writeOriginToMemo(memoText, originBlock) {
    const memo = String(memoText || '');
    if (/\[ORIGIN\][\s\S]*?\[\/ORIGIN\]/i.test(memo)) {
        return memo.replace(/\[ORIGIN\][\s\S]*?\[\/ORIGIN\]/i, originBlock);
    }
    return memo.trim() ? `${memo.trim()}\n\n${originBlock}` : originBlock;
}

// ── Prompt builders ──────────────────────────────────────────────────────────

/**
 * The complete draft rendered for a generation prompt, with every unset field
 * carrying an explicit `(unset — propose …)` marker.
 *
 * Exported because the two step-level fill passes need exactly this and nothing
 * else: the marked-up summary already names every field they are allowed to
 * touch, so they cannot drift from what the profile pass would have filled.
 */
export function selectionSummary(draft, originDef) {
    const sel = draft.selections || emptySelections();
    const race = RACES_BY_ID[draft.raceId];
    const lines = [];
    lines.push(`Race: ${race?.name || draft.raceId}`);
    lines.push(`  Reference: habitat ${race?.habitat} lifespan ${race?.lifespan} naming: ${race?.naming}`);
    if (race?.mechanics) lines.push(`  Race mechanics (always on): ${race.mechanics}`);
    if (draft.raceId === 'silkborn') {
        lines.push(`  Silkborn Severance Block (apply if this character is severed from the Weave): ${SILKBORN_SEVERANCE.rules.join(' ')}`);
    }
    const app = draft.appearance || {};
    // Every field is listed, blank or not. A dropped blank is a field the model
    // doesn't know exists and therefore never proposes — which left forged and
    // half-filled characters with no physical description at all. The (unset)
    // marker is the same contract the origin blanks use further down.
    if (race?.appearance) lines.push(`  Race appearance reference (proposals must fit this): ${race.appearance}`);
    const fieldLine = (f, value) => `  ${f.label} [${f.id}]: ${(value || '').trim()
        || `(unset — propose per the hint: ${f.hint})`}`;
    lines.push(`Appearance:\n${APPEARANCE_FIELDS.map(f => fieldLine(f, app[f.id])).join('\n')}`);
    // Intimate descriptors are NSFW-gated at the source: an SFW draft must never
    // carry them into the prompt, since the system message asserts SFW.
    if (draft.nsfw) {
        const intimate = app.intimate || {};
        lines.push(`Intimate details:\n${INTIMATE_FIELDS.map(f => fieldLine(f, intimate[f.id])).join('\n')}`);
    }
    lines.push(`Origin: ${originDef.name} — ${originDef.pitch}`);
    lines.push(`  Nation block represents: ${originDef.nationMeaning}`);
    lines.push(`  Social lever: ${originDef.leverSocial}`);
    lines.push(`  Personal lever: ${personalLeverFor(originDef, draft.raceId)}`);
    for (const [modId, optId] of Object.entries(sel.modifiers || {})) {
        const m = (originDef.modifiers || []).find(x => x.id === modId);
        if (m) lines.push(`${m.label}: ${optionLabel(originDef, modId, optId)}`);
    }
    for (const b of originDef.blanks || []) {
        const v = (sel.blanks?.[b.id] || '').trim();
        lines.push(`${b.label}: ${v || '(unset — propose per the hint: ' + b.hint + ')'}`);
    }
    const vibeText = (sel.vibes || []).map(v => {
        const def = VIBES_BY_ID[v];
        if (v === 'death' && sel.vibeSub) {
            const sub = def.subOptions.find(s => s.id === sel.vibeSub);
            return `${def.label} (${sub?.label}): ${sub?.internal}`;
        }
        return `${def?.label}: ${def?.internal}`;
    }).join('\n  ');
    lines.push(`Nation: "${(sel.nation?.name || '').trim() || '(unnamed — propose a name per the majority race\'s naming conventions)'}"`);
    lines.push(`  Majority race: ${RACES_BY_ID[sel.nation?.majorityRaceId]?.name || '?'}; Government: ${GOVERNMENT_TYPES.find(g => g.id === sel.nation?.governmentId)?.label || '?'}; Environment: ${ENVIRONMENTS.find(e => e.id === sel.nation?.environmentId)?.label || '?'}`);
    lines.push(`  Culture vibes (AI-internal descriptions — never show to the player):\n  ${vibeText}`);
    lines.push(`  ${VIBE_PAIR_GUIDANCE}`);
    if (sel.pursuer) {
        const P = PURSUER_BLOCK;
        const typedLeverage = (sel.pursuer.leverage || '').trim();
        // An empty leverage box on the two leverage-is-the-lever origins is not
        // an error, but the profile validator will reject a blank one — so ask
        // for it in the strongest terms rather than the soft "propose" hint.
        const leverageHint = leverageMandatory(originDef, draft.raceId)
            ? '(unset — MANDATORY for this origin: propose something concrete they hold beyond force. This IS the character\'s guaranteed personal lever; a blank here is a validation failure)'
            : '(unset — propose something concrete)';
        lines.push(`Pursuer: identity "${(sel.pursuer.identity || '').trim() || '(unset — propose)'}"; affiliation ${P.affiliations.find(x => x.id === sel.pursuer.affiliation)?.label}; motive ${P.motives.find(x => x.id === sel.pursuer.motive)?.label}; capability ${P.resources.find(x => x.id === sel.pursuer.resources)?.label}; awareness ${P.awareness.find(x => x.id === sel.pursuer.awareness)?.label}; leverage: ${typedLeverage || leverageHint}`);
    }
    for (const r of evaluateIncompatibilities(originDef, sel)) {
        if (r.level === 'narrative') lines.push(`Generation rule: ${r.message}`);
        if (r.level === 'soft' && sel.explanations?.[r.id]) lines.push(`Resolved tension (${r.id}): ${sel.explanations[r.id]}`);
    }
    if (sel.substituteLever === 'sharpened_thirst') {
        lines.push('Substitute personal lever: the Thirst, sharpened — a lord\'s appetite grown imperious with age.');
    }
    return lines.join('\n');
}

/**
 * An origin's personal-lever description for a specific race. Origins whose
 * lever branches by race (Exiled Royal) keep the branches in
 * `leverPersonalByRace` so only the applicable one is ever shown to the player
 * or sent to the model — a combined string hands every race the others' canon.
 * @returns {string}
 */
export function personalLeverFor(originDef, raceId) {
    return originDef?.leverPersonalByRace?.[raceId] || originDef?.leverPersonal || '';
}

/**
 * Setting anchors visible to this draft's generation call. Anchors carrying a
 * race-exclusive mechanic (`raceLocked`) are withheld unless the character
 * actually touches them — either by being that race, or by having deliberately
 * chosen that race's government for their nation.
 *
 * Withholding matters: an unconditional anchor list is why a Dragonborn came
 * back wearing the Chorus-Weave. The model does not treat vivid canon as
 * background; it treats it as available material.
 * @returns {Array<{name: string, description: string}>}
 */
export function anchorsForDraft(draft) {
    const raceId = draft?.raceId;
    const governmentId = draft?.selections?.nation?.governmentId;
    return ORIGINS_SETTING.anchors.filter(a => {
        if (!a.raceLocked) return true;
        if (a.raceLocked === raceId) return true;
        // A nation running Silkborn hive consensus needs the Chorus-Weave in
        // context regardless of the player character's own race.
        if (a.raceLocked === 'silkborn' && governmentId === 'hive_consensus') return true;
        return false;
    });
}

/**
 * Messages for the profile-generation retry loop (sendAgentTurn shape).
 * The model fills every unset blank and synthesizes the full profile JSON.
 */
export function buildProfileGenerationPrompt(draft, originDef) {
    const system = `You are the character-origin compiler for a ${ORIGINS_SETTING.name} campaign. ${ORIGINS_SETTING.blurb}

Setting anchors (fixed canon): ${anchorsForDraft(draft).map(a => `${a.name} — ${a.description}`).join(' | ')}

From the player's selections below, produce the complete origin profile. Honor EVERY selection exactly — modifiers are hard inputs you never override; blanks marked (unset) are yours to propose in keeping with everything else. Backstory without mechanical consequence is not sufficient: the social and personal levers must be concrete and active.
${draft.nsfw ? 'This campaign has mature content enabled.' : 'This campaign is SFW: no sexual content anywhere in the profile.'}
${antiGenericBlock('profile')}
${ORIGIN_PROFILE_SCHEMA_SPEC}

Output ONLY the profile JSON in one fenced \`\`\`json block.`;
    const user = `PLAYER SELECTIONS\n\n${selectionSummary(draft, originDef)}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ── Step-level AI fill (Origin Details) ──────────────────────────────────────

/**
 * Every Origin Details field the player has left unset, as dotted paths.
 *
 * One definition serving three callers — the prompt (what to ask for), the
 * validator (what a proposal may touch) and the wizard (whether to offer the
 * button at all) — so none of them can disagree about what counts as blank.
 *
 * Optional modifiers are deliberately excluded: unset there means "off", which
 * is a choice, not a gap.
 *
 * @returns {Set<string>}
 */
export function detailBlankPaths(draft, originDef) {
    const d = draft || {};
    const sel = d.selections || emptySelections();
    const paths = new Set();
    if (!originDef) return paths;

    for (const m of modifiersForContext(originDef, { raceId: d.raceId, nsfw: !!d.nsfw })) {
        if (!m.optional && !sel.modifiers?.[m.id]) paths.add(`modifiers.${m.id}`);
    }
    for (const b of originDef.blanks || []) {
        if (!(sel.blanks?.[b.id] || '').trim()) paths.add(`blanks.${b.id}`);
    }
    if (!(sel.nation?.name || '').trim()) paths.add('nation.name');
    if (!GOVERNMENT_TYPES.some(g => g.id === sel.nation?.governmentId)) paths.add('nation.governmentId');
    if (!ENVIRONMENTS.some(e => e.id === sel.nation?.environmentId)) paths.add('nation.environmentId');
    if (!RACES_BY_ID[sel.nation?.majorityRaceId]) paths.add('nation.majorityRaceId');
    if (!(sel.vibes || []).length) {
        paths.add('vibes');
        // The sub-option is only meaningful once Death-focused is among the
        // vibes, which the same pass may be about to choose.
        paths.add('vibeSub');
    } else if (sel.vibes.includes('death') && !sel.vibeSub) {
        paths.add('vibeSub');
    }
    if (pursuerNeeded(originDef, sel)) {
        const p = sel.pursuer || {};
        if (!(p.identity || '').trim()) paths.add('pursuer.identity');
        if (!(p.leverage || '').trim()) paths.add('pursuer.leverage');
        if (!PURSUER_BLOCK.affiliations.some(x => x.id === p.affiliation)) paths.add('pursuer.affiliation');
        if (!PURSUER_BLOCK.motives.some(x => x.id === p.motive)) paths.add('pursuer.motive');
        if (!PURSUER_BLOCK.resources.some(x => x.id === p.resources)) paths.add('pursuer.resources');
        if (!PURSUER_BLOCK.awareness.some(x => x.id === p.awareness)) paths.add('pursuer.awareness');
    }
    for (const r of evaluateIncompatibilities(originDef, sel)) {
        if (r.level === 'soft' && !r.satisfied) paths.add(`explanations.${r.id}`);
    }
    return paths;
}

/** Prose schema for the Origin Details fill, in the examples-not-JSONSchema style. */
const DETAIL_FILL_SCHEMA_SPEC = `Return a JSON object containing ONLY the fields listed as REQUESTED below — omit every key you were not asked for. Shape:

{
  "modifiers": { "<modifierId>": "<optionId>" },
  "blanks": { "<blankId>": "1-3 sentences" },
  "nation": { "name": "…", "governmentId": "<id>", "environmentId": "<id>", "majorityRaceId": "<raceId>" },
  "vibes": ["<vibeId>"],
  "vibeSub": "reverence" OR "bringing_death",
  "pursuer": { "identity": "…", "affiliation": "<id>", "motive": "<id>", "resources": "<id>", "awareness": "<id>", "leverage": "…" },
  "explanations": { "<ruleId>": "1-2 sentences reconciling the two choices" }
}

Every dropdown value MUST be one of the ids offered for that field — never a label, never an id you invented, and never an option marked 🚫 (those are blocked by the player's other choices). Free text is written in-fiction, in the campaign's register, with no rules vocabulary. Nation names follow the majority race's naming conventions.`;

/**
 * Messages for the Origin Details fill pass (sendAgentTurn shape). Asks only
 * for what the player left unset, and says so field by field.
 */
export function buildDetailFillPrompt(draft, originDef) {
    const paths = detailBlankPaths(draft, originDef);
    const catalog = [];
    const mods = modifiersForContext(originDef, { raceId: draft.raceId, nsfw: !!draft.nsfw });
    const sel = draft.selections || emptySelections();
    for (const m of mods) {
        if (!paths.has(`modifiers.${m.id}`)) continue;
        const opts = m.options.map(o => {
            const blocked = optionBlockReason(originDef, sel, m.id, o.id);
            return `${o.id} (${o.label})${blocked ? ' 🚫 BLOCKED' : ''}`;
        }).join('; ');
        catalog.push(`modifiers.${m.id} — ${m.label}. Options: ${opts}`);
    }
    for (const b of originDef.blanks || []) {
        if (paths.has(`blanks.${b.id}`)) catalog.push(`blanks.${b.id} — ${b.label}. ${b.hint}`);
    }
    if (paths.has('nation.name')) catalog.push('nation.name — the nation\'s name.');
    if (paths.has('nation.governmentId')) catalog.push(`nation.governmentId — Options: ${GOVERNMENT_TYPES.map(g => `${g.id} (${g.label})`).join('; ')}`);
    if (paths.has('nation.environmentId')) catalog.push(`nation.environmentId — Options: ${ENVIRONMENTS.map(e => `${e.id} (${e.label})`).join('; ')}`);
    if (paths.has('nation.majorityRaceId')) catalog.push(`nation.majorityRaceId — Options: ${RACES.map(r => `${r.id} (${r.name})`).join('; ')}`);
    if (paths.has('vibes')) {
        catalog.push(`vibes — pick 1 or 2. Options: ${vibesForNsfw(draft.nsfw).map(v => `${v.id} (${v.label}: ${v.summary})`).join('; ')}. ${VIBE_PAIR_GUIDANCE}`);
    }
    if (paths.has('vibeSub')) catalog.push('vibeSub — required ONLY if "death" is among the culture vibes: "reverence" or "bringing_death". Omit otherwise.');
    for (const f of ['identity', 'affiliation', 'motive', 'resources', 'awareness', 'leverage']) {
        if (!paths.has(`pursuer.${f}`)) continue;
        const lists = {
            affiliation: PURSUER_BLOCK.affiliations, motive: PURSUER_BLOCK.motives,
            resources: PURSUER_BLOCK.resources, awareness: PURSUER_BLOCK.awareness,
        };
        catalog.push(lists[f]
            ? `pursuer.${f} — Options: ${lists[f].map(x => `${x.id} (${x.label})`).join('; ')}`
            : (f === 'identity'
                ? 'pursuer.identity — a named individual, small group, or organized body.'
                : 'pursuer.leverage — something concrete they hold over the character beyond force.'));
    }
    for (const r of evaluateIncompatibilities(originDef, sel)) {
        if (paths.has(`explanations.${r.id}`)) catalog.push(`explanations.${r.id} — reconcile: ${r.message}`);
    }

    const system = `You are the character-origin compiler for a ${ORIGINS_SETTING.name} campaign. ${ORIGINS_SETTING.blurb}

Setting anchors (fixed canon): ${anchorsForDraft(draft).map(a => `${a.name} — ${a.description}`).join(' | ')}

The player is partway through building a character and has asked you to fill in the choices they left open. Everything they HAVE chosen is fixed — never contradict, revise or "improve" it. Fill only the REQUESTED fields, and make them cohere with each other and with what is already set.
${draft.nsfw ? 'This campaign has mature content enabled.' : 'This campaign is SFW: no sexual content anywhere.'}
${antiGenericBlock('detail')}
${DETAIL_FILL_SCHEMA_SPEC}

Output ONLY the JSON in one fenced \`\`\`json block.`;
    const user = `CURRENT SELECTIONS\n\n${selectionSummary(draft, originDef)}\n\nREQUESTED FIELDS (fill exactly these, nothing else)\n${catalog.map(c => `- ${c}`).join('\n')}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * All-errors validator for an Origin Details fill, in the shape of
 * validateOriginProfile: it reports everything wrong at once so the retry loop
 * can hand the model a complete list.
 *
 * @param {object} fill - the parsed JSON
 * @param {object} originDef
 * @param {object} draft
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDetailFill(fill, originDef, draft) {
    if (!fill || typeof fill !== 'object' || Array.isArray(fill)) {
        return { ok: false, errors: ['The fill is not a JSON object.'] };
    }
    const errors = [];
    const paths = detailBlankPaths(draft, originDef);
    const sel = draft?.selections || emptySelections();

    /** A proposal is legal only for a field the player actually left open. */
    const gate = (path) => {
        if (paths.has(path)) return true;
        errors.push(`${path} is already set by the player — never restate or revise it.`);
        return false;
    };
    const reqText = (path, value) => {
        if (typeof value !== 'string' || !value.trim()) errors.push(`${path} must be a non-empty string.`);
    };
    const reqId = (path, value, list, what) => {
        if (!list.some(x => x.id === value)) errors.push(`${path}: "${value}" is not a valid ${what} id.`);
    };

    for (const [id, optId] of Object.entries(fill.modifiers || {})) {
        if (!gate(`modifiers.${id}`)) continue;
        const m = (originDef?.modifiers || []).find(x => x.id === id);
        if (!m) { errors.push(`modifiers.${id} is not a modifier of this origin.`); continue; }
        if (!m.options.some(o => o.id === optId)) { errors.push(`modifiers.${id}: "${optId}" is not one of its options.`); continue; }
        const blocked = optionBlockReason(originDef, sel, id, optId);
        if (blocked) errors.push(`modifiers.${id}: "${optId}" is blocked — ${blocked}`);
    }
    for (const [id, text] of Object.entries(fill.blanks || {})) {
        if (!gate(`blanks.${id}`)) continue;
        if (!(originDef?.blanks || []).some(b => b.id === id)) { errors.push(`blanks.${id} is not a blank of this origin.`); continue; }
        reqText(`blanks.${id}`, text);
    }
    for (const [key, value] of Object.entries(fill.nation || {})) {
        if (!gate(`nation.${key}`)) continue;
        if (key === 'name') reqText('nation.name', value);
        else if (key === 'governmentId') reqId('nation.governmentId', value, GOVERNMENT_TYPES, 'government');
        else if (key === 'environmentId') reqId('nation.environmentId', value, ENVIRONMENTS, 'environment');
        else if (key === 'majorityRaceId') reqId('nation.majorityRaceId', value, RACES, 'race');
        else errors.push(`nation.${key} is not a fillable field.`);
    }
    if (fill.vibes !== undefined && gate('vibes')) {
        if (!Array.isArray(fill.vibes)) errors.push('vibes must be an array of 1-2 vibe ids.');
        else {
            const allowed = vibesForNsfw(draft?.nsfw).map(v => v.id);
            for (const v of fill.vibes) if (!allowed.includes(v)) errors.push(`vibes: "${v}" is not selectable on this campaign.`);
        }
    }
    if (fill.vibeSub !== undefined && fill.vibeSub !== null) gate('vibeSub');
    // Count/pairing/sub-option rules are the wizard's own; run them on the
    // result rather than duplicating them here.
    const nextVibes = fill.vibes !== undefined ? fill.vibes : sel.vibes;
    const nextSub = fill.vibeSub !== undefined ? fill.vibeSub : sel.vibeSub;
    if (Array.isArray(nextVibes)) errors.push(...validateVibes(nextVibes, nextSub));

    for (const [key, value] of Object.entries(fill.pursuer || {})) {
        if (!gate(`pursuer.${key}`)) continue;
        if (key === 'identity' || key === 'leverage') reqText(`pursuer.${key}`, value);
        else if (key === 'affiliation') reqId('pursuer.affiliation', value, PURSUER_BLOCK.affiliations, 'affiliation');
        else if (key === 'motive') reqId('pursuer.motive', value, PURSUER_BLOCK.motives, 'motive');
        else if (key === 'resources') reqId('pursuer.resources', value, PURSUER_BLOCK.resources, 'capability');
        else if (key === 'awareness') reqId('pursuer.awareness', value, PURSUER_BLOCK.awareness, 'awareness');
        else errors.push(`pursuer.${key} is not a fillable field.`);
    }
    for (const [id, text] of Object.entries(fill.explanations || {})) {
        if (!gate(`explanations.${id}`)) continue;
        reqText(`explanations.${id}`, text);
    }

    // Individually-legal picks can still combine into a blocked character, so
    // the merged result goes through the same hard-rule gate the wizard uses.
    if (!errors.length) {
        const { selections } = applyDetailFill(draft, originDef, fill);
        for (const r of evaluateIncompatibilities(originDef, selections)) {
            if (r.level === 'hard' && !r.satisfied) errors.push(`These picks combine into a blocked character: ${r.message}`);
        }
    }
    return { ok: errors.length === 0, errors };
}

/**
 * Folds a validated fill into the draft's selections. The player always wins:
 * only paths still listed by detailBlankPaths are written, so a value they set
 * is never overwritten however the model answered — the same contract
 * mergeAppearance enforces on descriptors.
 *
 * @returns {{selections: object, paths: string[]}} a new selections object and
 *   the paths written, ready for markAiFilled().
 */
export function applyDetailFill(draft, originDef, fill) {
    const base = draft?.selections || emptySelections();
    const sel = JSON.parse(JSON.stringify(base));
    const open = detailBlankPaths(draft, originDef);
    const written = [];
    const put = (path, apply) => {
        if (!open.has(path)) return;
        apply();
        written.push(path);
    };

    for (const [id, optId] of Object.entries(fill?.modifiers || {})) {
        put(`modifiers.${id}`, () => { sel.modifiers[id] = optId; });
    }
    for (const [id, text] of Object.entries(fill?.blanks || {})) {
        put(`blanks.${id}`, () => { sel.blanks[id] = text; });
    }
    for (const [key, value] of Object.entries(fill?.nation || {})) {
        put(`nation.${key}`, () => { sel.nation[key] = value; });
    }
    if (Array.isArray(fill?.vibes)) put('vibes', () => { sel.vibes = [...fill.vibes]; });
    if (fill?.vibeSub) put('vibeSub', () => { sel.vibeSub = fill.vibeSub; });
    if (fill?.pursuer) {
        if (!sel.pursuer) sel.pursuer = { identity: '', affiliation: '', motive: '', resources: '', awareness: '', leverage: '' };
        for (const [key, value] of Object.entries(fill.pursuer)) {
            put(`pursuer.${key}`, () => { sel.pursuer[key] = value; });
        }
    }
    for (const [id, text] of Object.entries(fill?.explanations || {})) {
        put(`explanations.${id}`, () => { sel.explanations[id] = text; });
    }
    // A sub-option only survives while Death-focused is actually selected.
    if (!sel.vibes.includes('death')) sel.vibeSub = null;
    return { selections: sel, paths: written };
}

// ── Step-level AI fill (Appearance) ──────────────────────────────────────────

/**
 * Messages for the Appearance fill pass (sendAgentTurn shape). Returns the same
 * {appearanceFilled, intimateFilled} shape the profile pass uses, so
 * mergeAppearance applies it unchanged.
 */
export function buildAppearanceFillPrompt(draft, originDef) {
    const blanks = appearanceBlankIds(draft.appearance);
    const race = RACES_BY_ID[draft.raceId];
    const list = (fields, set) => fields.filter(f => set.has(f.id))
        .map(f => `- ${f.id} — ${f.label}. ${f.hint}`).join('\n');
    const wanted = [
        blanks.appearance.size ? `Base descriptors:\n${list(APPEARANCE_FIELDS, blanks.appearance)}` : '',
        (draft.nsfw && blanks.intimate.size) ? `Intimate descriptors:\n${list(INTIMATE_FIELDS, blanks.intimate)}` : '',
    ].filter(Boolean).join('\n\n');

    const system = `You are the character-origin compiler for a ${ORIGINS_SETTING.name} campaign. ${ORIGINS_SETTING.blurb}

Setting anchors (fixed canon): ${anchorsForDraft(draft).map(a => `${a.name} — ${a.description}`).join(' | ')}

The player has finished their character's origin and left some physical descriptors blank for you. Propose a value for EVERY requested field and nothing else — never restate, revise or "improve" a descriptor they typed, and never invent a field id.
${race?.appearance ? `Race appearance reference (your proposals must fit this): ${race.name} — ${race.appearance}` : ''}
Proposals must read like this specific character: their origin, nation, modifiers and story blanks are all below, and a life like that leaves marks. Keep each value short — a phrase or one sentence, the way the player would have typed it, not prose.
${draft.nsfw ? 'This campaign has mature content enabled; intimate descriptors are plain reference data, stated so the narrator never improvises anatomy. State them factually — do not write a description or any prose around them.' : 'This campaign is SFW: propose base descriptors only, and keep every value non-explicit.'}
${antiGenericBlock('appearance')}

Return a JSON object of exactly this shape, omitting a key entirely when nothing was requested for it:

{
  "appearanceFilled": { "<fieldId>": "proposed value" },
  "intimateFilled": { "<fieldId>": "proposed value" }
}

Output ONLY the JSON in one fenced \`\`\`json block.`;
    const user = `CURRENT SELECTIONS\n\n${selectionSummary(draft, originDef)}\n\nREQUESTED FIELDS (fill exactly these, nothing else)\n\n${wanted || '(none)'}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * All-errors validator for an Appearance fill. Shares validateFieldProposals
 * with the profile validator, so "proposals are for blanks only" means the same
 * thing on both paths.
 *
 * @param {object} fill - {appearanceFilled, intimateFilled}
 * @param {{appearance: Set<string>, intimate: Set<string>}} blankIds
 * @param {boolean} nsfw
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAppearanceFill(fill, blankIds, nsfw) {
    if (!fill || typeof fill !== 'object' || Array.isArray(fill)) {
        return { ok: false, errors: ['The fill is not a JSON object.'] };
    }
    const errors = [
        ...validateFieldProposals(fill.appearanceFilled, APPEARANCE_FIELDS, blankIds?.appearance, 'appearanceFilled'),
        ...validateFieldProposals(fill.intimateFilled, INTIMATE_FIELDS, blankIds?.intimate, 'intimateFilled'),
    ];
    if (!nsfw && Object.keys(fill.intimateFilled || {}).length) {
        errors.push('intimateFilled must be omitted on an SFW campaign.');
    }
    // Silence is a failure here: the whole point of the button is that the
    // requested blanks come back filled.
    const asked = (blankIds?.appearance?.size || 0) + (nsfw ? (blankIds?.intimate?.size || 0) : 0);
    const got = Object.keys(fill.appearanceFilled || {}).length + Object.keys(fill.intimateFilled || {}).length;
    if (asked && !got) errors.push('No proposals were returned — propose a value for every requested field.');
    return { ok: errors.length === 0, errors };
}

/**
 * One-shot D&D stat-generation instruction for sendDirectPrompt — the
 * origin-flavored equivalent of the archetype prompts in index.js. Produces
 * the [CHARACTER]/[INVENTORY]/[ABILITIES] (+[SPELLS]) blocks the tracker needs.
 */
export function buildStatGenPrompt(profile, originDef, level) {
    const lvl = Math.max(1, Math.min(20, Number(level) || 1));
    return `Generate the D&D character sheet for the following ALREADY-CREATED Level ${lvl} character. Do NOT invent a new character — use this name, race, and concept exactly.

Name: ${profile.name}${profile.title ? ` (${profile.title})` : ''}
Race: ${profile.race}
Concept: ${profile.origin} — ${profile.currentGoal}
Class leaning: ${originDef?.classLeaning || 'fitting the concept'} — pick the single best-fitting D&D class (and subclass flavor) for this concept.
Origin-relevant physical traits: ${profile.appearanceNotes || 'none beyond the base appearance'}

${antiGenericBlock('stats')}

Output [CHARACTER], [INVENTORY], and [ABILITIES] blocks (and [SPELLS] if the class is a spellcaster, using 'Cantrips:' for level 0 spells). All attributes, gear, and features consistent with Level ${lvl}. The character sheet must reflect the concept above — e.g. retained skills, signature equipment, or marks the concept implies. Do NOT output an [ORIGIN] block; the framework writes it.`;
}

/**
 * Prompt for the opening narration (spec §8) — generated from the committed
 * profile via the narrator connection, inserted as the first assistant message.
 */
export function buildFirstMessagePrompt(profile, frameId, nsfw) {
    const frame = OPENING_FRAMES.find(f => f.id === frameId) || OPENING_FRAMES[1];
    const frameText = frame.id === 'in_medias_res'
        ? 'Open IN MEDIAS RES: the origin\'s pressure is already live in the opening scene — the personal or social lever is actively in play from the first paragraph.'
        : 'Open QUIETLY: a scene of ordinary life in the character\'s current location. The levers are present but ambient — felt, not detonating.';
    return `Write the opening narration for a new ${ORIGINS_SETTING.name} campaign. This is the very first message of the story, addressed to the player character in second person.

THE CHARACTER
${profile.name}${profile.title ? `, ${profile.title}` : ''} — ${profile.race}, ${profile.origin}.
${resolveAppearanceSummary(profile) ? `Appearance: ${resolveAppearanceSummary(profile)}\n` : ''}Backstory: ${profile.backstory}
Social lever: ${profile.socialLever.text} (legible to: ${profile.socialLever.legibleTo})
Personal lever: ${profile.personalLever.text}
Current goal: ${profile.currentGoal}
${profile.pursuer ? `Pursuer: ${profile.pursuer.identity} — ${profile.pursuer.motive}; ${profile.pursuer.awareness}.` : ''}
Voice notes: ${profile.personalityVoice}

FRAME
${frameText}

${antiGenericBlock('opening')}

RULES
- 3 to 5 paragraphs of scene-setting prose, ending at a moment that invites the player to act. No dice, no mechanics, no questions to the player out of character.
- Ground the scene in the nation of ${profile.nation.name} (${profile.nation.tone}) or the character's stated current location from the backstory.
- Do not resolve anything; open threads, don't close them.${nsfw ? '' : '\n- Keep the content SFW.'}
- Output ONLY the narration prose — no titles, headers, or meta commentary.`;
}

// Re-exports so UI code has a single import surface for the catalog.
export {
    ORIGINS, ORIGINS_BY_ID, RACES, RACES_BY_ID, CULTURE_VIBES, VIBES_BY_ID,
    GOVERNMENT_TYPES, ENVIRONMENTS, PURSUER_BLOCK, APPEARANCE_FIELDS,
    INTIMATE_FIELDS, OPENING_FRAMES, ORIGINS_SETTING, SILKBORN_SEVERANCE,
};
