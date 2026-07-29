/**
 * origins-engine.js — Origins RPG Framework (Origins character creation)
 *
 * Pure logic module for the Origins creation flow: wizard step derivation,
 * race→origin filtering, NSFW filtering, incompatibility evaluation (hard
 * blocks, soft tensions requiring explanations), the Lever Guarantee check
 * (spec §0.2), draft randomization, the origin-profile JSON contract
 * (schema spec + all-errors validator, modeled on foundation.js's
 * validateFoundation), the [ORIGIN] memo-block serializer, and the prompt
 * builders (profile generation, D&D stat generation, first message).
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

/** Ordered wizard step ids. 'options' also hosts the master NSFW toggle. */
export const WIZARD_STEPS = Object.freeze(['options', 'race', 'appearance', 'origin', 'detail', 'review']);

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
    opening: "For this task: open on this character's actual situation as the profile describes it — not on a scene this genre usually opens with.",
    stats: "For this task: gear and abilities must trace to this character's history, nation, and origin — not to a default loadout for their class.",
    worldArc: 'For this task: the milestone chain must follow from the seed material below. Do not fall back to an escalating-ancient-evil shape unless the seed material actually points there.',
});

/** ANTI_GENERIC_DIRECTIVE plus the named per-prompt tail. */
export function antiGenericBlock(kind) {
    const tail = ANTI_GENERIC_TAILS[kind];
    return tail ? `${ANTI_GENERIC_DIRECTIVE}\n${tail}` : ANTI_GENERIC_DIRECTIVE;
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
  "appearanceNotes": "1 short paragraph: origin-relevant physical traits ONLY (decay state, curse marks, artifact fusion) — the base appearance fields are supplied separately",
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
 * All-errors validator for the AI-generated origin profile.
 * @param {object} profile
 * @param {object} originDef
 * @param {string} [raceId] - enables the race-exclusivity check and the
 *   Silkborn exemption on the mandatory-leverage origins.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateOriginProfile(profile, originDef, raceId) {
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

/** Compact "Skin: …; Height: …" summary of the base appearance descriptors. */
export function formatAppearanceLine(appearance) {
    const app = appearance || {};
    return APPEARANCE_FIELDS.map(f => (app[f.id] || '').trim() ? `${f.label}: ${String(app[f.id]).trim()}` : null)
        .filter(Boolean).join('; ');
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
    const appearanceLine = formatAppearanceLine(p.appearance);
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

function selectionSummary(draft, originDef) {
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
    const appLines = APPEARANCE_FIELDS.map(f => app[f.id] ? `${f.label}: ${app[f.id]}` : null).filter(Boolean);
    if (appLines.length) lines.push(`Appearance: ${appLines.join('; ')}`);
    // Intimate descriptors are NSFW-gated at the source: an SFW draft must never
    // carry them into the prompt, since the system message asserts SFW.
    if (draft.nsfw) {
        const intimate = app.intimate || {};
        const intLines = INTIMATE_FIELDS.map(f => intimate[f.id] ? `${f.label}: ${intimate[f.id]}` : null).filter(Boolean);
        if (intLines.length) lines.push(`Intimate details: ${intLines.join('; ')}`);
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
Backstory: ${profile.backstory}
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
