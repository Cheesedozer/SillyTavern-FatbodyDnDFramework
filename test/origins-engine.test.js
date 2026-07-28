// Tests for origins-engine.js — pure module, no bootstrap needed.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    WIZARD_STEPS, deriveWizardStep, allowedOriginsForRace, isOriginAllowedForRace,
    vibesForNsfw, modifiersForContext, emptySelections, evaluateIncompatibilities,
    optionBlockReason, validateVibes, checkLeverGuarantee, validateDraft,
    randomizeSelections, validateOriginProfile, buildOriginMemoBlock,
    writeOriginToMemo, buildProfileGenerationPrompt, buildStatGenPrompt,
    buildFirstMessagePrompt, ORIGIN_PROFILE_SCHEMA_SPEC,
    ORIGINS, ORIGINS_BY_ID,
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
    assert.equal(deriveWizardStep({ step: 'appearance', raceId: 'human' }), 'appearance');
    assert.equal(deriveWizardStep({ step: 'bogus', raceId: 'human', originId: 'oathbreaker' }), 'options');
    assert.equal(WIZARD_STEPS.length, 6);
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

// ── Lever Guarantee ──────────────────────────────────────────────────────────

test('exiled royal requires pursuer leverage — except for severed Silkborn', () => {
    const er = ORIGINS_BY_ID['exiled_royal'];
    const sel = emptySelections();
    sel.pursuer = { identity: 'X', affiliation: 'independent', motive: 'kill', resources: 'superior', awareness: 'searching_cold', leverage: '' };
    assert.ok(checkLeverGuarantee(er, sel, 'human').length > 0);
    assert.deepEqual(checkLeverGuarantee(er, sel, 'silkborn'), []);
    sel.pursuer.leverage = 'They hold your sister.';
    assert.deepEqual(checkLeverGuarantee(er, sel, 'human'), []);
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

/** Builds a complete draft for an origin: randomized selections + placeholder
 *  text for the fields the AI would normally propose. */
function completeDraft(originId, raceId, seed) {
    const origin = ORIGINS_BY_ID[originId];
    const rng = mulberry32(seed);
    const sel = randomizeSelections(origin, raceId, false, rng);
    sel.nation.name = 'Testholm';
    if (sel.pursuer) {
        sel.pursuer.identity = 'The Test Pursuer';
        sel.pursuer.leverage = 'They hold something dear.';
    }
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
    assert.ok(errors.some(e => e.includes('Nation name')));
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
    assert.ok(m[2].includes('World-Threat Tie-In:'));
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
