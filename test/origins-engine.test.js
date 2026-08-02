// Tests for origins-engine.js — pure module, no bootstrap needed.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    WIZARD_STEPS, deriveWizardStep, allowedOriginsForRace, isOriginAllowedForRace,
    vibesForNsfw, modifiersForContext, emptySelections, evaluateIncompatibilities, pursuerNeeded,
    optionBlockReason, validateVibes, checkLeverGuarantee, validateDraft,
    randomizeSelections, validateOriginProfile, buildOriginMemoBlock,
    writeOriginToMemo, buildProfileGenerationPrompt, buildStatGenPrompt,
    buildFirstMessagePrompt, ORIGIN_PROFILE_SCHEMA_SPEC,
    ORIGINS, ORIGINS_BY_ID,
    leverageMandatory, checkRaceExclusivity, anchorsForDraft, personalLeverFor,
    ANTI_GENERIC_DIRECTIVE, antiGenericBlock, ANTI_GENERIC_TAILS,
    appearanceBlankIds, mergeAppearance, APPEARANCE_FIELDS, RACES_BY_ID,
    originsSettings, INTIMATE_FIELDS,
    detailBlankPaths, buildDetailFillPrompt, validateDetailFill, applyDetailFill,
    buildAppearanceFillPrompt, validateAppearanceFill, validateFieldProposals,
    markAiFilled, claimField, isAiFilled, aiFilledPaths, clearAiValues, pathSection,
} from '../origins-engine.js';

/** Deterministic PRNG for reproducible randomization tests. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Step machine ─────────────────────────────────────────────────────────────

test('deriveWizardStep clamps a persisted step to what the draft data supports', () => {
    assert.equal(deriveWizardStep(null), 'options');
    assert.equal(deriveWizardStep({ step: 'review' }), 'race');
    assert.equal(deriveWizardStep({ step: 'detail', raceId: 'human' }), 'origin');
    assert.equal(deriveWizardStep({ step: 'detail', raceId: 'human', originId: 'oathbreaker' }), 'detail');
    // Appearance now sits after Origin Details, so it is unreachable until an
    // origin exists — its AI fill needs the origin, nation and blanks as context.
    assert.equal(deriveWizardStep({ step: 'appearance', raceId: 'human' }), 'origin');
    assert.equal(deriveWizardStep({ step: 'appearance', raceId: 'human', originId: 'oathbreaker' }), 'appearance');
    assert.equal(deriveWizardStep({ step: 'bogus', raceId: 'human', originId: 'oathbreaker' }), 'options');
    assert.equal(WIZARD_STEPS.length, 6);
});

test('WIZARD_STEPS puts appearance after origin details', () => {
    assert.deepEqual([...WIZARD_STEPS], ['options', 'race', 'origin', 'detail', 'appearance', 'review']);
});

// ── Race–origin matrix ───────────────────────────────────────────────────────

test('vampire race is restricted to Vampire Lord and Exiled Royal', () => {
    assert.deepEqual(allowedOriginsForRace('vampire').map(o => o.id).sort(), ['exiled_royal', 'vampire_lord']);
});

test('living races may take every origin except Vampire Lord', () => {
    for (const raceId of ['human', 'elf', 'silkborn', 'orc']) {
        const ids = allowedOriginsForRace(raceId).map(o => o.id);
        assert.equal(ids.length, 7, raceId);
        assert.ok(!ids.includes('vampire_lord'), raceId);
    }
    assert.ok(!isOriginAllowedForRace('vampire_lord', 'human'));
    assert.ok(isOriginAllowedForRace('vampire_lord', 'vampire'));
    assert.deepEqual(allowedOriginsForRace('nonexistent'), []);
});

// ── NSFW filtering ───────────────────────────────────────────────────────────

test('NSFW toggle gates the pleasure vibe and the farm modifiers', () => {
    assert.ok(!vibesForNsfw(false).some(v => v.id === 'pleasure'));
    assert.ok(vibesForNsfw(true).some(v => v.id === 'pleasure'));
    const vl = ORIGINS_BY_ID['vampire_lord'];
    assert.ok(!modifiersForContext(vl, { raceId: 'vampire', nsfw: false }).some(m => m.id === 'farms'));
    assert.ok(modifiersForContext(vl, { raceId: 'vampire', nsfw: true }).some(m => m.id === 'farms'));
    // Race-gated: exiled royal's vampire_farms only for vampires.
    const er = ORIGINS_BY_ID['exiled_royal'];
    assert.ok(!modifiersForContext(er, { raceId: 'human', nsfw: true }).some(m => m.id === 'vampire_farms'));
    assert.ok(modifiersForContext(er, { raceId: 'vampire', nsfw: true }).some(m => m.id === 'vampire_farms'));
});

// ── Vibes ────────────────────────────────────────────────────────────────────

test('validateVibes enforces count, the matriarchal×patriarchal block, and the death sub-option', () => {
    assert.deepEqual(validateVibes(['strength'], null), []);
    assert.ok(validateVibes([], null).length > 0);
    assert.ok(validateVibes(['strength', 'wealth', 'magic'], null).length > 0);
    const blocked = validateVibes(['matriarchal', 'patriarchal'], null);
    assert.ok(blocked.some(e => e.includes('cannot be selected together')));
    assert.ok(validateVibes(['death'], null).some(e => e.includes('sub-option')));
    assert.deepEqual(validateVibes(['death'], 'reverence'), []);
});

// ── Incompatibilities ────────────────────────────────────────────────────────

test('oathbreaker: split personality × hidden visibility is a hard block', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const sel = emptySelections();
    sel.modifiers = { curse_type: 'split_personality', curse_visibility: 'hidden' };
    const results = evaluateIncompatibilities(ob, sel);
    assert.ok(results.some(r => r.level === 'hard' && !r.satisfied && r.id === 'split_hidden'));
    // optionBlockReason catches it prospectively:
    const selPartial = emptySelections();
    selPartial.modifiers = { curse_type: 'split_personality' };
    assert.ok(optionBlockReason(ob, selPartial, 'curse_visibility', 'hidden') !== null);
    assert.equal(optionBlockReason(ob, selPartial, 'curse_visibility', 'visible'), null);
});

test('vampire lord: intact power + intact memory demands the substitute lever', () => {
    const vl = ORIGINS_BY_ID['vampire_lord'];
    const sel = emptySelections();
    sel.modifiers = { power_state: 'intact', memory_state: 'intact' };
    let results = evaluateIncompatibilities(vl, sel);
    const rule = results.find(r => r.id === 'no_lever');
    assert.ok(rule && rule.level === 'hard' && !rule.satisfied);
    sel.substituteLever = 'sharpened_thirst';
    results = evaluateIncompatibilities(vl, sel);
    assert.ok(results.find(r => r.id === 'no_lever').satisfied);
    // Escapable rules must not block the option itself:
    const selPartial = emptySelections();
    selPartial.modifiers = { power_state: 'intact' };
    assert.equal(optionBlockReason(vl, selPartial, 'memory_state', 'intact'), null);
});

test('soft tensions are satisfied by a non-empty explanation', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const sel = emptySelections();
    sel.modifiers = { believed_dead: 'yes' };
    sel.pursuer = { identity: 'The Spymaster', affiliation: 'origin_body', motive: 'kill', resources: 'superior', awareness: 'closing_in', leverage: 'a hostage' };
    let results = evaluateIncompatibilities(er, sel);
    const soft = results.find(r => r.id === 'closing_in_vs_believed_dead');
    assert.ok(soft && soft.level === 'soft' && !soft.satisfied);
    sel.explanations = { closing_in_vs_believed_dead: 'The court believes you dead; the spymaster never did.' };
    results = evaluateIncompatibilities(er, sel);
    assert.ok(results.find(r => r.id === 'closing_in_vs_believed_dead').satisfied);
});

test('narrative rules surface as guidance, never as blockers', () => {
    const fu = ORIGINS_BY_ID['freed_undead'];
    const sel = emptySelections();
    sel.modifiers = { archetype: 'fallen_tyrant', decay: 'static' };
    const results = evaluateIncompatibilities(fu, sel);
    assert.ok(results.every(r => r.level === 'narrative' ? r.satisfied : true));
    assert.ok(results.some(r => r.id === 'tyrant_vindication' && r.level === 'narrative'));
    assert.equal(optionBlockReason(fu, emptySelections(), 'archetype', 'fallen_tyrant'), null);
});

test('pursuerNeeded follows each origin\'s pursuer mode', () => {
    const sel = emptySelections();
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['exiled_royal'], sel), true, 'required');
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['artifact_nobody'], sel), true, 'default_on');
    sel.modifiers.claimants = 'none';
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['artifact_nobody'], sel), false, 'default_on opted out');
    const sel2 = emptySelections();
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['vampire_lord'], sel2), false, 'conditional off');
    sel2.modifiers.slumber_reason = 'hiding';
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['vampire_lord'], sel2), true, 'conditional on');
    const sel3 = emptySelections();
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['abandoned_champion'], sel3), false, 'optional off');
    sel3.modifiers.replacement = 'rival_faith';
    assert.equal(pursuerNeeded(ORIGINS_BY_ID['abandoned_champion'], sel3), true, 'optional on');
});

// ── Lever Guarantee ──────────────────────────────────────────────────────────

test('an empty leverage box is never a DRAFT error — the AI proposes one', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const sel = emptySelections();
    sel.pursuer = { identity: '', affiliation: 'independent', motive: 'kill', resources: 'superior', awareness: 'searching_cold', leverage: '' };
    // The wizard promises "empty → the AI proposes"; the draft gate must honor
    // that. The guarantee is enforced on the generated profile instead.
    assert.deepEqual(checkLeverGuarantee(er, sel, 'human'), []);
    assert.deepEqual(checkLeverGuarantee(er, sel, 'silkborn'), []);
});

test('leverageMandatory: origin-gated, with the Silkborn Exiled Royal exemption', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const ds = ORIGINS_BY_ID['defector_spy'];
    assert.equal(leverageMandatory(er, 'human'), true);
    assert.equal(leverageMandatory(er, 'dragonborn'), true);
    // Severed Silkborn: the residual hive-thread is the personal lever instead.
    assert.equal(leverageMandatory(er, 'silkborn'), false);
    // Defector Spy has no Silkborn exemption (spec §5.8).
    assert.equal(leverageMandatory(ds, 'silkborn'), true);
    assert.equal(leverageMandatory(ORIGINS_BY_ID['oathbreaker'], 'human'), false);
    assert.equal(leverageMandatory(null, 'human'), false);
});

test('artifact nobody with no claimants requires the artifact agenda blank', () => {
    const an = ORIGINS_BY_ID['artifact_nobody'];
    const sel = emptySelections();
    sel.modifiers = { claimants: 'none' };
    assert.ok(checkLeverGuarantee(an, sel, 'human').some(e => e.includes('agenda')));
    sel.blanks = { artifact_agenda: 'It wants to be carried to the drowned temple.' };
    assert.deepEqual(checkLeverGuarantee(an, sel, 'human'), []);
});

test('abandoned champion with stable power needs a substitute pressure source', () => {
    const ac = ORIGINS_BY_ID['abandoned_champion'];
    const sel = emptySelections();
    sel.modifiers = { fading_power: 'stable', hunted_by_wronged: 'no' };
    assert.ok(checkLeverGuarantee(ac, sel, 'human').length > 0);
    sel.modifiers.replacement = 'rival_faith';
    assert.deepEqual(checkLeverGuarantee(ac, sel, 'human'), []);
    // 'hunted by the wronged' also satisfies:
    const sel2 = emptySelections();
    sel2.modifiers = { fading_power: 'stable', hunted_by_wronged: 'yes' };
    assert.deepEqual(checkLeverGuarantee(ac, sel2, 'human'), []);
});

// ── Full draft validation + randomization property test ─────────────────────

/** Builds a complete draft for an origin from randomized selections.
 *  Deliberately does NOT fill nation name / pursuer identity / leverage —
 *  those are the AI-proposed fields, and a draft must validate without them. */
function completeDraft(originId, raceId, seed) {
    const origin = ORIGINS_BY_ID[originId];
    const rng = mulberry32(seed);
    const sel = randomizeSelections(origin, raceId, false, rng);
    for (const b of origin.blanks) sel.blanks[b.id] = `Test ${b.id}.`;
    const draft = { step: 'review', nsfw: false, level: 1, raceId, originId, appearance: {}, selections: sel };
    // Satisfy any surfaced soft tensions and escapable hard rules.
    for (const r of evaluateIncompatibilities(origin, sel)) {
        if (r.level === 'soft' && !r.satisfied) sel.explanations[r.id] = 'Test explanation.';
        if (r.level === 'hard' && !r.satisfied) {
            const rule = origin.incompatibilities.find(x => x.id === r.id);
            if (rule?.substituteLever) sel.substituteLever = rule.substituteLever;
            if (rule?.requiresModifier) sel.modifiers[rule.requiresModifier.id] = rule.requiresModifier.anyOf[0];
            if (rule?.requiresBlank) sel.blanks[rule.requiresBlank] = 'Test escape.';
        }
    }
    return draft;
}

test('randomized selections + placeholders validate for every origin across seeds', () => {
    for (const origin of ORIGINS) {
        const raceId = origin.requiredRace === 'vampire' ? 'vampire' : 'human';
        for (let seed = 1; seed <= 25; seed++) {
            const draft = completeDraft(origin.id, raceId, seed);
            const { ok, errors } = validateDraft(draft);
            assert.ok(ok, `${origin.id} seed ${seed}: ${errors.join(' | ')}`);
        }
    }
});

test('random rolls never select NSFW-gated content', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const rng = mulberry32(seed);
        const sel = randomizeSelections(ORIGINS_BY_ID['vampire_lord'], 'vampire', true, rng);
        assert.ok(!sel.modifiers.farms, 'farms must stay an explicit opt-in');
        assert.ok(!sel.vibes.includes('pleasure'));
    }
});

test('validateDraft reports all errors at once, not just the first', () => {
    const draft = { step: 'review', nsfw: false, raceId: 'human', originId: 'defector_spy', selections: emptySelections() };
    const { ok, errors } = validateDraft(draft);
    assert.ok(!ok);
    assert.ok(errors.length >= 5, `expected many errors, got: ${errors.join(' | ')}`);
    assert.ok(errors.some(e => e.includes('Pursuer Block')));
    assert.ok(errors.some(e => e.includes('Government type')));
});

test('validateDraft never blocks on the three AI-proposed fields', () => {
    // The regression guard for "Forge me a character": randomizeSelections
    // leaves nation.name / pursuer.identity / pursuer.leverage empty on purpose,
    // and the forge button feeds that straight into generation.
    const draft = completeDraft('exiled_royal', 'dragonborn', 7);
    assert.equal(draft.selections.nation.name, '', 'fixture must exercise the empty case');
    assert.equal(draft.selections.pursuer.identity, '');
    assert.equal(draft.selections.pursuer.leverage, '');
    const { ok, errors } = validateDraft(draft);
    assert.ok(ok, errors.join(' | '));
});

test('validateDraft rejects NSFW selections when the toggle is off', () => {
    const draft = completeDraft('vampire_lord', 'vampire', 3);
    draft.selections.vibes = ['pleasure'];
    const { ok, errors } = validateDraft(draft);
    assert.ok(!ok);
    assert.ok(errors.some(e => e.includes('NSFW')));
});

test('validateDraft rejects an illegal race/origin pairing', () => {
    const draft = completeDraft('oathbreaker', 'human', 1);
    draft.raceId = 'vampire';
    const { ok, errors } = validateDraft(draft);
    assert.ok(!ok);
    assert.ok(errors.some(e => e.includes('matrix')));
});

// ── Connection remap ─────────────────────────────────────────────────────────

test('originsSettings: remaps the origins* namespace onto the generic connection-settings shape', () => {
    const mapped = originsSettings({
        connectionProfileId: 'tracker-profile',
        originsConnectionSource: 'openai',
        originsConnectionProfileId: 'p1',
        originsCompletionPresetId: 'creative',
        originsOllamaUrl: 'http://x',
        originsOllamaModel: 'm',
        originsOpenaiUrl: 'http://y',
        originsOpenaiKey: 'k',
        originsOpenaiModel: 'gpt',
        originsMaxTokens: 500,
    });
    assert.equal(mapped.connectionSource, 'openai');
    assert.equal(mapped.connectionProfileId, 'p1', "the tracker's profile must not leak through");
    assert.equal(mapped.completionPresetId, 'creative');
    assert.equal(mapped.ollamaUrl, 'http://x');
    assert.equal(mapped.ollamaModel, 'm');
    assert.equal(mapped.openaiUrl, 'http://y');
    assert.equal(mapped.openaiKey, 'k');
    assert.equal(mapped.openaiModel, 'gpt');
    assert.equal(mapped.maxTokens, 500);
});

test('originsSettings: defaults connectionSource to "default" and maxTokens to 0 when unset', () => {
    const mapped = originsSettings({});
    assert.equal(mapped.connectionSource, 'default');
    assert.equal(mapped.maxTokens, 0);
    assert.equal(originsSettings({ originsMaxTokens: '' }).maxTokens, 0);
    assert.equal(originsSettings(null).connectionSource, 'default');
});

// ── AI-fill provenance ───────────────────────────────────────────────────────

test('markAiFilled / claimField / aiFilledPaths track who owns a value', () => {
    const draft = {};
    markAiFilled(draft, ['nation.name', 'appearance.hair', 'blanks.sworn_to']);
    markAiFilled(draft, ['nation.name']);
    assert.equal(draft.aiFilled.length, 3, 'idempotent');
    assert.ok(isAiFilled(draft, 'nation.name'));
    assert.deepEqual(aiFilledPaths(draft, 'appearance'), ['appearance.hair']);
    assert.deepEqual(aiFilledPaths(draft, 'detail').sort(), ['blanks.sworn_to', 'nation.name']);

    claimField(draft, 'nation.name');
    assert.ok(!isAiFilled(draft, 'nation.name'), 'an edit makes it the player\'s');
    assert.equal(pathSection('intimate.chest'), 'appearance');
    assert.equal(pathSection('pursuer.leverage'), 'detail');
});

test('clearAiValues empties one step\'s AI picks and leaves the player\'s alone', () => {
    const draft = {
        nsfw: true,
        selections: {
            ...emptySelections(),
            blanks: { sworn_to: 'AI text', how_broken: 'MY text' },
            nation: { name: 'AI-named', majorityRaceId: 'human', governmentId: 'theocracy', environmentId: 'coast' },
            vibes: ['strength'], vibeSub: null,
            pursuer: { identity: 'AI pursuer', affiliation: 'origin_body', motive: 'kill', resources: 'superior', awareness: 'searching_cold', leverage: 'MY leverage' },
        },
        appearance: { hair: 'AI hair', skin: 'MY skin', intimate: { chest: 'AI chest' } },
    };
    markAiFilled(draft, [
        'blanks.sworn_to', 'nation.name', 'nation.governmentId', 'vibes',
        'pursuer.identity', 'appearance.hair', 'intimate.chest',
    ]);

    assert.equal(clearAiValues(draft, 'detail'), 5);
    assert.equal(draft.selections.blanks.sworn_to, undefined, 'AI blank cleared');
    assert.equal(draft.selections.blanks.how_broken, 'MY text', 'player blank untouched');
    assert.equal(draft.selections.nation.name, '');
    assert.equal(draft.selections.nation.governmentId, '');
    assert.equal(draft.selections.nation.environmentId, 'coast', 'player select untouched');
    assert.deepEqual(draft.selections.vibes, []);
    assert.equal(draft.selections.pursuer.identity, '');
    assert.equal(draft.selections.pursuer.leverage, 'MY leverage', 'player leverage untouched');
    // The Appearance step is a separate bucket and must survive untouched.
    assert.equal(draft.appearance.hair, 'AI hair');
    assert.deepEqual(aiFilledPaths(draft, 'detail'), []);
    assert.deepEqual(aiFilledPaths(draft, 'appearance').sort(), ['appearance.hair', 'intimate.chest']);

    assert.equal(clearAiValues(draft, 'appearance'), 2);
    assert.equal(draft.appearance.hair, undefined);
    assert.equal(draft.appearance.skin, 'MY skin', 'player descriptor untouched');
    assert.equal(draft.appearance.intimate.chest, undefined);
    assert.deepEqual(draft.aiFilled, []);
});

// ── Step-level fill: Origin Details ──────────────────────────────────────────

/** A half-filled Oathbreaker draft: some choices made, the rest left open. */
function partialDetailDraft() {
    const sel = emptySelections();
    sel.modifiers = { oath_represented: 'justice' };
    sel.blanks = { sworn_to: 'The Grey Chapter, who I still believe in' };
    sel.nation.environmentId = 'coast';
    return { raceId: 'human', originId: 'oathbreaker', nsfw: false, selections: sel, appearance: {} };
}

test('detailBlankPaths lists what is open and nothing the player has set', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const paths = detailBlankPaths(partialDetailDraft(), ob);
    assert.ok(!paths.has('modifiers.oath_represented'), 'a set modifier is not open');
    assert.ok(paths.has('modifiers.party_status'), 'an unset required modifier is open');
    assert.ok(!paths.has('blanks.sworn_to'), 'a written blank is not open');
    assert.ok(paths.has('blanks.how_broken'));
    assert.ok(paths.has('nation.name') && paths.has('nation.governmentId') && paths.has('nation.majorityRaceId'));
    assert.ok(!paths.has('nation.environmentId'), 'a chosen select is not open');
    assert.ok(paths.has('vibes') && paths.has('vibeSub'));
    // Oathbreaker's pursuer is required, so the whole block is open.
    assert.ok(paths.has('pursuer.identity') && paths.has('pursuer.leverage') && paths.has('pursuer.motive'));
    assert.equal(detailBlankPaths(partialDetailDraft(), null).size, 0, 'no origin, nothing to fill');
});

test('buildDetailFillPrompt asks only for the open fields, with their catalogs', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const [system, user] = buildDetailFillPrompt(partialDetailDraft(), ob);
    assert.equal(system.role, 'system');
    assert.ok(system.content.includes(ANTI_GENERIC_TAILS.detail));
    assert.ok(user.content.includes('REQUESTED FIELDS'));
    assert.ok(user.content.includes('modifiers.party_status'), 'open modifier requested');
    assert.ok(!user.content.includes('modifiers.oath_represented —'), 'set modifier not requested');
    assert.ok(user.content.includes('blanks.how_broken'));
    assert.ok(!user.content.includes('blanks.sworn_to —'));
    assert.ok(user.content.includes('nation.governmentId'), 'select catalogs are offered as ids');
    assert.ok(!user.content.includes('nation.environmentId —'));
    assert.ok(user.content.includes('pursuer.leverage'));
});

/** A complete, legal fill for the draft above. */
function goodDetailFill() {
    return {
        modifiers: { party_status: 'standing', believed_dead: 'no', curse_type: 'armor_lock', curse_visibility: 'visible' },
        blanks: { how_broken: 'I opened the gate.', why_broken: 'They had my sister.', curse_nature: 'The plate will not come off.' },
        nation: { name: 'Aldermere', governmentId: 'theocracy', majorityRaceId: 'human' },
        vibes: ['strength'],
        pursuer: {
            identity: 'Warden Halloway', affiliation: 'origin_body', motive: 'capture',
            resources: 'superior', awareness: 'searching_cold', leverage: 'My sister is still in their keeping.',
        },
    };
}

test('validateDetailFill accepts a clean fill', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const check = validateDetailFill(goodDetailFill(), ob, partialDetailDraft());
    assert.ok(check.ok, check.errors.join(' | '));
});

test('validateDetailFill rejects each failure class, all at once', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const draft = partialDetailDraft();

    assert.ok(!validateDetailFill(null, ob, draft).ok);
    assert.ok(!validateDetailFill('nope', ob, draft).ok);

    // A proposal for something the player already decided.
    const overrides = { ...goodDetailFill(), modifiers: { ...goodDetailFill().modifiers, oath_represented: 'tyranny' } };
    const a = validateDetailFill(overrides, ob, draft);
    assert.ok(!a.ok);
    assert.ok(a.errors.some(e => e.includes('already set by the player')), a.errors.join(' | '));

    // Ids that don't exist in their catalog.
    const badIds = goodDetailFill();
    badIds.nation.governmentId = 'republic_of_letters';
    badIds.pursuer.motive = 'vibes';
    badIds.modifiers.party_status = 'not_an_option';
    const b = validateDetailFill(badIds, ob, draft);
    assert.ok(!b.ok);
    assert.ok(b.errors.some(e => e.includes('not a valid government id')));
    assert.ok(b.errors.some(e => e.includes('not a valid motive id')));
    assert.ok(b.errors.some(e => e.includes('is not one of its options')));

    // Empty free text is a non-answer.
    const blank = goodDetailFill();
    blank.blanks.how_broken = '   ';
    assert.ok(validateDetailFill(blank, ob, draft).errors.some(e => e.includes('non-empty string')));

    // Vibe rules are the wizard's own and run on the merged result.
    const tooMany = goodDetailFill();
    tooMany.vibes = ['strength', 'wealth', 'death'];
    assert.ok(!validateDetailFill(tooMany, ob, draft).ok);
});

test('validateDetailFill rejects an option the player\'s other choices block', () => {
    // Oathbreaker: a split personality cannot also be a hidden curse.
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const draft = partialDetailDraft();
    draft.selections.modifiers.curse_type = 'split_personality';
    const blocked = optionBlockReason(ob, draft.selections, 'curse_visibility', 'hidden');
    assert.ok(blocked, 'precondition: the option really is blocked');

    const check = validateDetailFill({ modifiers: { curse_visibility: 'hidden' } }, ob, draft);
    assert.ok(!check.ok);
    assert.ok(check.errors.some(e => e.includes('is blocked')), check.errors.join(' | '));
});

test('applyDetailFill writes only open paths and reports them for marking', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const draft = partialDetailDraft();
    const fill = goodDetailFill();
    // Slip in a value for a field the player set — it must be ignored, not applied.
    fill.modifiers.oath_represented = 'tyranny';
    fill.blanks.sworn_to = 'something else entirely';

    const { selections, paths } = applyDetailFill(draft, ob, fill);
    assert.equal(selections.modifiers.oath_represented, 'justice', 'the player always wins');
    assert.equal(selections.blanks.sworn_to, 'The Grey Chapter, who I still believe in');
    assert.equal(selections.modifiers.party_status, 'standing');
    assert.equal(selections.nation.name, 'Aldermere');
    assert.equal(selections.nation.environmentId, 'coast', 'untouched, and not reported');
    assert.deepEqual(selections.vibes, ['strength']);
    assert.equal(selections.vibeSub, null, 'no sub-option without the death vibe');
    assert.equal(selections.pursuer.identity, 'Warden Halloway');

    assert.ok(!paths.includes('modifiers.oath_represented'));
    assert.ok(!paths.includes('nation.environmentId'));
    assert.ok(paths.includes('nation.name') && paths.includes('pursuer.leverage'));
    // The draft itself is left alone — the caller assigns the returned object.
    assert.equal(draft.selections.nation.name, '');
});

test('a filled draft passes validateDraft, which is what unblocks Next', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const draft = partialDetailDraft();
    const { selections } = applyDetailFill(draft, ob, goodDetailFill());
    draft.selections = selections;
    const { ok, errors } = validateDraft(draft);
    assert.ok(ok, errors.join(' | '));
    assert.equal(detailBlankPaths(draft, ob).size, 0, 'nothing left open');
});

// ── Step-level fill: Appearance ──────────────────────────────────────────────

test('buildAppearanceFillPrompt requests the blank descriptors and gates intimate on NSFW', () => {
    const ob = ORIGINS_BY_ID['oathbreaker'];
    const draft = partialDetailDraft();
    draft.appearance = { skin: 'Weathered brown' };

    const sfw = buildAppearanceFillPrompt(draft, ob)[1].content;
    assert.ok(sfw.includes('hair'), 'a blank descriptor is requested');
    assert.ok(!sfw.includes('- skin —'), 'a typed descriptor is not');
    assert.ok(!sfw.includes('Intimate descriptors'), 'SFW campaigns never see them');

    draft.nsfw = true;
    const nsfw = buildAppearanceFillPrompt(draft, ob)[1].content;
    assert.ok(nsfw.includes('Intimate descriptors'));
});

test('validateAppearanceFill shares the profile validator\'s proposal rules', () => {
    const blanks = appearanceBlankIds({ skin: 'Weathered brown' });

    assert.ok(validateAppearanceFill({ appearanceFilled: { hair: 'Cropped grey' } }, blanks, false).ok);

    const overrides = validateAppearanceFill({ appearanceFilled: { skin: 'MODEL OVERRIDE' } }, blanks, false);
    assert.ok(!overrides.ok);
    assert.ok(overrides.errors.some(e => e.includes('filled in by the player')));

    assert.ok(!validateAppearanceFill({ appearanceFilled: { nope: 'x' } }, blanks, false).ok, 'unknown ids fail');
    assert.ok(!validateAppearanceFill({}, blanks, false).ok, 'silence is a failure');
    assert.ok(!validateAppearanceFill(null, blanks, false).ok);

    const leaked = validateAppearanceFill(
        { appearanceFilled: { hair: 'Cropped grey' }, intimateFilled: { chest: 'x' } }, blanks, false);
    assert.ok(!leaked.ok, 'intimate proposals are rejected outright on an SFW campaign');
});

test('validateFieldProposals is the one definition both validators use', () => {
    const blanks = new Set(['hair']);
    assert.deepEqual(validateFieldProposals(undefined, APPEARANCE_FIELDS, blanks), [], 'absent is fine');
    assert.deepEqual(validateFieldProposals({ hair: 'Cropped grey' }, APPEARANCE_FIELDS, blanks), []);
    assert.equal(validateFieldProposals([], APPEARANCE_FIELDS, blanks).length, 1, 'an array is not an object');
    assert.ok(validateFieldProposals({ hair: '' }, APPEARANCE_FIELDS, blanks)[0].includes('non-empty'));
});

// ── Profile validation ───────────────────────────────────────────────────────

function sampleProfile() {
    return {
        name: 'Serane Vell', title: 'Duchess', race: 'Human', origin: 'Exiled Royal',
        nation: {
            name: 'Vessa', majorityRace: 'Human', government: 'Hereditary monarchy',
            cultureVibes: 'Strength-focused', environment: 'Temperate heartlands',
            outsiderView: 'A proud, wounded kingdom.', tone: 'Granite halls and old banners.',
        },
        secondaryNation: null,
        backstory: 'Long ago...', appearanceNotes: 'A brand on the wrist.',
        appearanceSummary: 'She carries herself like the court she lost, all straight spine and level grey eyes.',
        socialLever: { text: 'The signet brand', legibleTo: 'Anyone versed in Concord heraldry' },
        personalLever: { text: 'Her brother is held hostage.' },
        pursuer: {
            identity: 'Captain Marrow', affiliation: 'Part of the origin nation',
            motive: 'Capture', resources: 'Superior', awareness: 'Searching cold',
            leverage: 'Her brother, held in the citadel.',
        },
        currentGoal: 'Reach the border archive alive.',
        personalityVoice: 'Clipped court diction that slips when tired.',
        worldThreatTieIn: 'The usurper is arming beyond any one throne\'s needs.',
        questSeeds: ['Seed one.', 'Seed two.', 'Seed three.', 'Seed four.'],
    };
}

test('validateOriginProfile passes a complete profile and accumulates all errors otherwise', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    assert.deepEqual(validateOriginProfile(sampleProfile(), er), { ok: true, errors: [] });
    const broken = sampleProfile();
    broken.name = '';
    broken.nation.outsiderView = '';
    broken.questSeeds = ['only one'];
    broken.pursuer.leverage = '';
    const { ok, errors } = validateOriginProfile(broken, er);
    assert.ok(!ok);
    assert.ok(errors.length >= 4, errors.join(' | '));
    assert.ok(errors.some(e => e.includes('leverage')));
    assert.ok(validateOriginProfile(null, er).errors.length === 1);
});

// ── Memo block serializer ────────────────────────────────────────────────────

test('buildOriginMemoBlock produces a compact, parseable [ORIGIN] block', () => {
    const block = buildOriginMemoBlock(sampleProfile(), ORIGINS_BY_ID['exiled_royal']);
    assert.ok(block.startsWith('[ORIGIN]\n'));
    assert.ok(block.endsWith('\n[/ORIGIN]'));
    assert.ok(block.split('\n').length <= 15, 'must stay compact — the memo is injection tier 5');
    // The renderer/merge regex shape: [TAG]...[/TAG]
    const m = block.match(/\[([^\]/][^\]]*)\]([\s\S]*?)\[\/\1\]/);
    assert.ok(m && m[1] === 'ORIGIN');
    assert.ok(m[2].includes('Social Lever:'));
    assert.ok(m[2].includes('Personal Lever:'));
    // Pre-arc the tie-in is a private seed for the tension compiler, so it must
    // NOT be published here even though the profile carries it.
    assert.ok(!m[2].includes('World-Threat Tie-In:'));
});

test('buildOriginMemoBlock publishes the tie-in only once an arc has set arcTieIn', () => {
    const committed = { ...sampleProfile(), arcTieIn: 'The looms are mobilizing along the southern roads.' };
    const block = buildOriginMemoBlock(committed, ORIGINS_BY_ID['exiled_royal']);
    assert.ok(block.includes('World-Threat Tie-In: The looms are mobilizing'));
});

test('buildOriginMemoBlock carries the appearance summary, never any intimate detail', () => {
    const committed = {
        ...sampleProfile(),
        appearance: { skin: 'Bronze scales', intimate: { chest: 'should never appear' } },
        // A campaign committed while intimateProse was still generated: nothing
        // reads it any more, and it must not leak back into the block.
        intimateProse: 'explicit paragraph that must not ride every turn',
    };
    const block = buildOriginMemoBlock(committed, ORIGINS_BY_ID['exiled_royal']);
    assert.ok(block.includes('Appearance: She carries herself like the court she lost'), 'the summary, not a descriptor list');
    assert.ok(!block.includes('Skin / Body Color:'), 'the raw list is superseded once a summary exists');
    // The memo is BOTH always-on narrator context and the on-screen HUD card.
    assert.ok(!block.includes('should never appear'));
    assert.ok(!block.includes('explicit paragraph'), 'intimate detail is lorebook only');
});

test('buildOriginMemoBlock falls back through every generation of the appearance contract', () => {
    const { appearanceSummary, ...noSummary } = sampleProfile();
    void appearanceSummary;

    // Campaigns committed while the contract was a longer appearanceProse.
    const proseEra = { ...noSummary, appearanceProse: 'A tall woman with a courtier\'s spine.' };
    assert.ok(buildOriginMemoBlock(proseEra, ORIGINS_BY_ID['exiled_royal'])
        .includes('Appearance: A tall woman with a courtier\'s spine.'));

    // Campaigns committed before either existed.
    const fieldEra = {
        ...noSummary,
        appearance: { skin: 'Bronze scales', height: '2.0 m', eyes: 'Molten gold, slit pupils' },
    };
    assert.ok(buildOriginMemoBlock(fieldEra, ORIGINS_BY_ID['exiled_royal'])
        .includes('Appearance: Skin / Body Color: Bronze scales; Height: 2.0 m; Eyes: Molten gold, slit pupils'));

    // The summary wins over both when present.
    const current = { ...proseEra, appearanceSummary };
    assert.ok(buildOriginMemoBlock(current, ORIGINS_BY_ID['exiled_royal'])
        .includes('Appearance: She carries herself like the court she lost'));

    const bare = buildOriginMemoBlock(noSummary, ORIGINS_BY_ID['exiled_royal']);
    assert.ok(!bare.includes('Appearance:'), 'omitted entirely with neither summary, prose nor descriptors');
});

test('writeOriginToMemo appends once and replaces thereafter', () => {
    const block1 = '[ORIGIN]\nOrigin: A\n[/ORIGIN]';
    const block2 = '[ORIGIN]\nOrigin: B\n[/ORIGIN]';
    const memo = '[CHARACTER]\nName: X\n[/CHARACTER]';
    const appended = writeOriginToMemo(memo, block1);
    assert.ok(appended.includes('[CHARACTER]') && appended.includes('Origin: A'));
    const replaced = writeOriginToMemo(appended, block2);
    assert.ok(replaced.includes('Origin: B') && !replaced.includes('Origin: A'));
    assert.equal((replaced.match(/\[ORIGIN\]/g) || []).length, 1);
    assert.equal(writeOriginToMemo('', block1), block1);
});

// ── Prompt builders ──────────────────────────────────────────────────────────

test('buildProfileGenerationPrompt embeds the schema, selections, and SFW rule', () => {
    const draft = completeDraft('willing_cultist', 'elf', 7);
    const messages = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['willing_cultist']);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes('Vaelmarch'));
    assert.ok(messages[0].content.includes('"questSeeds"'));
    assert.ok(messages[0].content.includes('SFW'));
    assert.ok(messages[1].content.includes('PLAYER SELECTIONS'));
    assert.ok(messages[1].content.includes('Elf'));
    // Culture vibe internal descriptions ride along for generation consistency.
    assert.ok(messages[1].content.includes('never show to the player'));
});

test('buildStatGenPrompt targets the existing memo block contract at the chosen level', () => {
    const prompt = buildStatGenPrompt(sampleProfile(), ORIGINS_BY_ID['exiled_royal'], 3);
    assert.ok(prompt.includes('Level 3'));
    assert.ok(prompt.includes('[CHARACTER], [INVENTORY], and [ABILITIES]'));
    assert.ok(prompt.includes('Serane Vell'));
    assert.ok(prompt.includes('Do NOT invent a new character'));
    assert.ok(prompt.includes('Do NOT output an [ORIGIN] block'));
    // Level clamps:
    assert.ok(buildStatGenPrompt(sampleProfile(), null, 99).includes('Level 20'));
});

test('buildFirstMessagePrompt honors the opening frame and SFW flag', () => {
    const inMedias = buildFirstMessagePrompt(sampleProfile(), 'in_medias_res', false);
    assert.ok(inMedias.includes('IN MEDIAS RES'));
    assert.ok(inMedias.includes('SFW'));
    const quiet = buildFirstMessagePrompt(sampleProfile(), 'quiet_start', true);
    assert.ok(quiet.includes('QUIETLY'));
    assert.ok(!quiet.includes('Keep the content SFW'));
    assert.ok(quiet.includes('Serane Vell'));
});

test('the schema spec names every profile field the validator checks', () => {
    for (const field of ['"name"', '"nation"', '"backstory"', '"socialLever"', '"personalLever"', '"pursuer"', '"currentGoal"', '"personalityVoice"', '"worldThreatTieIn"', '"questSeeds"']) {
        assert.ok(ORIGIN_PROFILE_SCHEMA_SPEC.includes(field), field);
    }
});

// ── Cross-race canon containment ─────────────────────────────────────────────

test('anchorsForDraft withholds race-locked canon from characters who cannot have it', () => {
    const dragonborn = completeDraft('exiled_royal', 'dragonborn', 3);
    const names = anchorsForDraft(dragonborn).map(a => a.name);
    assert.ok(!names.includes('The Chorus-Weave'), 'the Silkborn hivemind must not be offered to a Dragonborn');
    assert.ok(names.includes('The Argent Concord'), 'unlocked anchors still ride along');

    const silkborn = completeDraft('exiled_royal', 'silkborn', 3);
    assert.ok(anchorsForDraft(silkborn).map(a => a.name).includes('The Chorus-Weave'));

    // A hive-consensus nation needs the anchor whatever the player's own race is.
    const hiveNation = completeDraft('exiled_royal', 'dragonborn', 3);
    hiveNation.selections.nation.governmentId = 'hive_consensus';
    assert.ok(anchorsForDraft(hiveNation).map(a => a.name).includes('The Chorus-Weave'));
});

test('buildProfileGenerationPrompt keeps Silkborn canon out of a Dragonborn call', () => {
    const dragonborn = buildProfileGenerationPrompt(completeDraft('exiled_royal', 'dragonborn', 5), ORIGINS_BY_ID['exiled_royal']);
    const whole = dragonborn.map(m => m.content).join('\n');
    // The RACE FIDELITY rule names Silkborn as a counter-example, so assert on
    // the anchor description text rather than the bare word.
    assert.ok(!whole.includes('The Silkborn hivemind network'), 'setting anchor must be withheld');
    assert.ok(!whole.includes('Severance Block'), 'the origin\'s own lever text must not carry the Silkborn branch');
    assert.ok(!whole.includes('Chorus-Weave'), 'no Chorus-Weave canon in a Dragonborn call');
    assert.ok(!/hive-thread|hive-sense|hivemind|reachthread/i.test(whole), 'no Silkborn hive mechanics');
    // "hive" alone is legitimate — the Collectivist vibe uses it generically —
    // so this asserts on the Silkborn-specific vocabulary only.

    const silkborn = buildProfileGenerationPrompt(completeDraft('exiled_royal', 'silkborn', 5), ORIGINS_BY_ID['exiled_royal']);
    const silkWhole = silkborn.map(m => m.content).join('\n');
    assert.ok(silkWhole.includes('The Silkborn hivemind network'));
    assert.ok(silkWhole.includes('Severance Block'));
});

test('personalLeverFor resolves the race branch instead of concatenating them', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const dragonborn = personalLeverFor(er, 'dragonborn');
    assert.ok(!/silkborn|severance|hive/i.test(dragonborn), dragonborn);
    assert.ok(/leverage/i.test(dragonborn));
    assert.ok(/hive-thread/i.test(personalLeverFor(er, 'silkborn')));
    // Origins without a race branch fall through to the single string.
    assert.equal(personalLeverFor(ORIGINS_BY_ID['oathbreaker'], 'silkborn'), ORIGINS_BY_ID['oathbreaker'].leverPersonal);
    assert.equal(personalLeverFor(null, 'human'), '');
});

test('checkRaceExclusivity rejects another race\'s signature mechanic', () => {
    const p = sampleProfile();
    p.personalLever.text = 'The Silkborn Severance Block — a live hive-filament threaded into her nervous system, marking her as a node on the Chorus-Weave.';
    const errors = checkRaceExclusivity(p, 'dragonborn');
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('Silkborn'));
    assert.ok(errors[0].includes('Dragonborn'));
    // A real Silkborn keeps it.
    assert.deepEqual(checkRaceExclusivity(p, 'silkborn'), []);
    // Clean profiles are untouched, and a missing raceId disables the check.
    assert.deepEqual(checkRaceExclusivity(sampleProfile(), 'dragonborn'), []);
    assert.deepEqual(checkRaceExclusivity(p, null), []);
});

test('validateOriginProfile runs the race-exclusivity check when given a raceId', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const p = sampleProfile();
    p.personalLever.text = 'A residual thread of the Chorus-Weave the hive can still trace.';
    assert.ok(!validateOriginProfile(p, er, 'dragonborn').ok);
    assert.ok(validateOriginProfile(p, er, 'silkborn').ok);
    // Omitting raceId preserves the old, race-blind behavior.
    assert.ok(validateOriginProfile(p, er).ok);
});

test('validateOriginProfile applies the Silkborn leverage exemption only with a raceId', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const blank = sampleProfile();
    blank.pursuer.leverage = '';
    assert.ok(!validateOriginProfile(blank, er, 'dragonborn').ok, 'still mandatory for a Dragonborn');
    assert.ok(validateOriginProfile(blank, er, 'silkborn').ok, 'severed hive-thread substitutes');
    const ds = ORIGINS_BY_ID['defector_spy'];
    assert.ok(!validateOriginProfile(blank, ds, 'silkborn').ok, 'Defector Spy has no exemption');
});

// ── Intimate descriptors (NSFW-gated at the source) ─────────────────────────

test('intimate descriptors reach the prompt only when NSFW is on', () => {
    const draft = completeDraft('exiled_royal', 'human', 11);
    draft.appearance = { skin: 'Pale', intimate: { chest: 'Small and high', parts: 'Vagina' } };

    draft.nsfw = false;
    const sfw = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['exiled_royal']).map(m => m.content).join('\n');
    assert.ok(!sfw.includes('Intimate details:'));
    assert.ok(!sfw.includes('Small and high'), 'stale intimate data must never leak into an SFW call');
    assert.ok(sfw.includes('Pale'), 'base appearance still rides along');

    draft.nsfw = true;
    const nsfw = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['exiled_royal']).map(m => m.content).join('\n');
    assert.ok(nsfw.includes('Intimate details:'));
    assert.ok(nsfw.includes('Small and high'));
    assert.ok(nsfw.includes('[hips]: (unset'), 'blank intimate fields are offered too when NSFW is on');
});

// ── AI-filled appearance blanks ──────────────────────────────────────────────

test('every blank descriptor is offered to the generator, filled ones as-is', () => {
    const draft = completeDraft('exiled_royal', 'human', 11);
    draft.appearance = { skin: 'Pale grey skin', height: 'tall' };
    const prompt = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['exiled_royal']).map(m => m.content).join('\n');

    assert.ok(prompt.includes('[skin]: Pale grey skin'), 'the player\'s value verbatim');
    assert.ok(prompt.includes('[height]: tall'));
    for (const id of ['bodyType', 'hair', 'eyes', 'face', 'marks']) {
        assert.ok(prompt.includes(`[${id}]: (unset — propose per the hint:`), `${id} offered to the model`);
    }
});

test('the race appearance reference reaches the generator', () => {
    // Player-facing UI text until now — without it, proposals ignore the race.
    const draft = completeDraft('exiled_royal', 'dwarf', 11);
    const prompt = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['exiled_royal']).map(m => m.content).join('\n');
    assert.ok(prompt.includes('Race appearance reference'));
    assert.ok(prompt.includes(RACES_BY_ID['dwarf'].appearance));
});

test('a forged (fully blank) character has every descriptor offered', () => {
    // randomizeSelections never touches appearance, so the ⚒️ path arrives here
    // with nothing set — and used to produce no description at all.
    const draft = completeDraft('exiled_royal', 'human', 11);
    draft.appearance = {};
    const prompt = buildProfileGenerationPrompt(draft, ORIGINS_BY_ID['exiled_royal']).map(m => m.content).join('\n');
    for (const f of APPEARANCE_FIELDS) assert.ok(prompt.includes(`[${f.id}]: (unset`), `${f.id} offered`);
});

test('mergeAppearance keeps the player authoritative and drops invented ids', () => {
    const own = { skin: 'Pale grey skin', height: 'tall', intimate: { chest: 'Small and high' } };
    const filled = { skin: 'MODEL OVERRIDE', hair: 'Ash-white, cropped', nonsense: 'not a field' };
    const merged = mergeAppearance(own, filled, { hips: 'Narrow' }, true);

    assert.equal(merged.skin, 'Pale grey skin', 'a typed value is never overwritten');
    assert.equal(merged.height, 'tall');
    assert.equal(merged.hair, 'Ash-white, cropped', 'blanks take the proposal');
    assert.ok(!('nonsense' in merged), 'hallucinated field ids are dropped');
    assert.equal(merged.intimate.chest, 'Small and high');
    assert.equal(merged.intimate.hips, 'Narrow');
});

test('mergeAppearance discards intimate proposals on an SFW campaign', () => {
    const merged = mergeAppearance({ skin: 'Pale' }, {}, { hips: 'should not land' }, false);
    assert.ok(!merged.intimate, 'an SFW campaign never accrues intimate descriptors');
});

test('validateOriginProfile rejects a missing summary and proposals for filled fields', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const blanks = appearanceBlankIds({ skin: 'Pale grey skin' });

    const noSummary = { ...sampleProfile(), appearanceSummary: '' };
    assert.ok(!validateOriginProfile(noSummary, er, 'human', blanks).ok, 'the summary is required');

    // The generator no longer writes intimate prose, so its absence is not an error.
    const { intimateProse, ...noIntimateProse } = { ...sampleProfile(), intimateProse: 'x' };
    void intimateProse;
    assert.ok(validateOriginProfile(noIntimateProse, er, 'human', blanks).ok, 'no intimate prose field is required');

    const overrides = { ...sampleProfile(), appearanceFilled: { skin: 'MODEL OVERRIDE' } };
    const check = validateOriginProfile(overrides, er, 'human', blanks);
    assert.ok(!check.ok);
    assert.ok(check.errors.some(e => e.includes('filled in by the player')), check.errors.join('; '));

    const badId = { ...sampleProfile(), appearanceFilled: { nope: 'x' } };
    assert.ok(!validateOriginProfile(badId, er, 'human', blanks).ok, 'unknown field ids fail the pass');

    const good = { ...sampleProfile(), appearanceFilled: { hair: 'Ash-white, cropped' } };
    assert.ok(validateOriginProfile(good, er, 'human', blanks).ok, 'a proposal for a genuine blank passes');
});

test('the opening narration is no longer written blind', () => {
    const prompt = buildFirstMessagePrompt(sampleProfile(), 'quiet', false);
    assert.ok(prompt.includes('Appearance: She carries herself like the court she lost'));
});

// ── Anti-generic guardrail ───────────────────────────────────────────────────

test('every generation prompt carries the anti-generic directive', () => {
    const marker = 'pattern-matching to a familiar trope';
    assert.ok(ANTI_GENERIC_DIRECTIVE.includes(marker));

    const profile = buildProfileGenerationPrompt(completeDraft('oathbreaker', 'human', 2), ORIGINS_BY_ID['oathbreaker']);
    assert.ok(profile[0].content.includes(marker), 'profile generation');
    assert.ok(buildStatGenPrompt(sampleProfile(), ORIGINS_BY_ID['exiled_royal'], 1).includes(marker), 'stat sheet');
    assert.ok(buildFirstMessagePrompt(sampleProfile(), 'quiet_start', false).includes(marker), 'opening narration');
});

test('antiGenericBlock appends the per-prompt tail and tolerates an unknown kind', () => {
    assert.ok(antiGenericBlock('profile').includes('The setting anchors are not.'));
    assert.ok(antiGenericBlock('worldArc').includes('escalating-ancient-evil'));
    assert.equal(antiGenericBlock('nope'), ANTI_GENERIC_DIRECTIVE);
});
