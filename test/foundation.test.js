/**
 * Tests for foundation.js — schema validation, fenced-JSON extraction, and
 * prose/placeholder rendering for the v3.0 Modern mode foundation.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FOUNDATION_SCHEMA_VERSION,
    validateFoundation,
    extractFoundationJson,
    foundationPlaceholders,
    renderFoundationProse,
} from '../foundation.js';

/** Minimal but complete valid foundation fixture. */
function validFoundation() {
    return {
        schemaVersion: FOUNDATION_SCHEMA_VERSION,
        mode: 'modern',
        SETTING: {
            name: 'Neo-Khelt',
            synopsis: 'A rust-belt arcology where awakened psions broker memory contracts.',
            themes: ['memory', 'debt'],
            toneNotes: 'noir, grounded',
        },
        POWER_SYSTEM: {
            name: 'Psionic Resonance',
            description: 'Psions channel resonance through implanted lattices.',
            resources: [
                { id: 'focus', name: 'Focus', description: 'Mental stamina pool', regenRule: 'full on long rest' },
                { id: 'strain', name: 'Strain', description: 'Overcast debt' },
            ],
            diceProfile: {
                primary: 'd100',
                subdice: ['d10', 'd20'],
                queueLen: 12,
                dcScale: [
                    { label: 'Trivial', value: 20 },
                    { label: 'Moderate', value: 50 },
                    { label: 'Hard', value: 75 },
                    { label: 'Near-impossible', value: 95 },
                ],
            },
        },
        PROGRESSION_RULES: {
            maxLevel: 100,
            xpCurveId: 'modern_v1',
            skillPointsPerLevel: 2,
            milestoneEvery: 10,
            milestoneBonus: 4,
            respec: { freeUntilLevel: 10, currencyName: 'scrip', costMultiplier: 1.0 },
        },
        CLASS_ROSTER: [
            { id: 'render', name: 'Render', fantasy: 'Tears resonance into raw force.', role: 'damage', primaryResource: 'focus', treeThemes: ['force', 'overload'] },
            { id: 'weaver', name: 'Weaver', fantasy: 'Knits memory into shields and snares.', role: 'control', primaryResource: 'focus', treeThemes: ['barriers', 'memory'] },
            { id: 'chorus', name: 'Chorus', fantasy: 'Amplifies allies through shared resonance.', role: 'support', primaryResource: 'focus', treeThemes: ['links', 'amplify'] },
        ],
        JOB_RULES: {
            enabled: true,
            maxJobs: 2,
            unlockNarrative: 'Jobs unlock through guild contracts.',
            jobSeeds: [{ id: 'contractor', name: 'Memory Contractor', description: 'Brokers lattice debt.', unlockHint: 'Sign a guild charter.' }],
        },
        SKILL_TAXONOMY: {
            damageTypes: ['kinetic', 'resonant', 'thermal'],
            namingConvention: 'short psionic jargon',
            rarityTiers: [
                { id: 'common', name: 'Common', color: '#aaaaaa' },
                { id: 'rare', name: 'Rare', color: '#5588ff' },
                { id: 'apex', name: 'Apex', color: '#ff8800' },
            ],
            tierCount: 10,
            levelGatePerTier: 10,
        },
        LETHALITY: {
            template: 'standard',
            downedWindow: 3,
            injuryTable: ['Shattered lattice (-10 max Focus)', 'Burned hand (-2 to fine manipulation checks)'],
            deathRule: 'Third injury or unsurvivable narrative events mean true death.',
        },
    };
}

test('validateFoundation accepts the complete fixture', () => {
    setSettings({});
    const r = validateFoundation(validFoundation());
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
});

test('validateFoundation reports every problem at once (batch errors for the retry loop)', () => {
    setSettings({});
    const f = validFoundation();
    f.mode = 'classic';
    f.CLASS_ROSTER = f.CLASS_ROSTER.slice(0, 2);           // too few classes
    f.POWER_SYSTEM.resources = [];                          // no resource economy
    f.PROGRESSION_RULES.respec.currencyName = '';           // no currency
    const r = validateFoundation(f);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 4, `found ${r.errors.length} errors: ${r.errors.join(' | ')}`);
    assert.ok(r.errors.some(e => e.includes("mode must be 'modern'")));
    assert.ok(r.errors.some(e => e.includes('3 to 6 classes')));
    assert.ok(r.errors.some(e => e.includes('resources')));
    assert.ok(r.errors.some(e => e.includes('currencyName')));
});

test('validateFoundation accepts 6 classes but rejects 7', () => {
    setSettings({});
    const six = validFoundation();
    for (let i = 0; i < 3; i++) {
        six.CLASS_ROSTER.push({ id: `extra${i}`, name: `Extra ${i}`, fantasy: 'Filler class.', role: 'hybrid', primaryResource: 'focus', treeThemes: ['filler'] });
    }
    assert.equal(six.CLASS_ROSTER.length, 6);
    assert.equal(validateFoundation(six).ok, true, 'six classes accepted');

    six.CLASS_ROSTER.push({ id: 'extra3', name: 'Extra 3', fantasy: 'One too many.', role: 'hybrid', primaryResource: 'focus', treeThemes: ['filler'] });
    const r = validateFoundation(six);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('3 to 6 classes')), 'seven classes rejected');
});

test('validateFoundation catches cross-references: class resource must exist', () => {
    setSettings({});
    const f = validFoundation();
    f.CLASS_ROSTER[0].primaryResource = 'mana'; // not a POWER_SYSTEM resource
    const r = validateFoundation(f);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('does not match any POWER_SYSTEM resource')));
});

test('validateFoundation rejects junk roots and bad dice profiles', () => {
    setSettings({});
    assert.equal(validateFoundation(null).ok, false);
    assert.equal(validateFoundation([1, 2]).ok, false);
    const f = validFoundation();
    f.POWER_SYSTEM.diceProfile.primary = 'twenty';
    f.POWER_SYSTEM.diceProfile.dcScale = [{ label: 'Only', value: 50 }];
    const r = validateFoundation(f);
    assert.ok(r.errors.some(e => e.includes('primary')));
    assert.ok(r.errors.some(e => e.includes('dcScale')));
});

test('extractFoundationJson pulls the LAST fenced block, tolerates bare JSON, rejects junk', () => {
    const f = validFoundation();
    const fenced = 'Some chatter.\n```json\n{"draft": true}\n```\nFinal version:\n```json\n' + JSON.stringify(f) + '\n```\nDone!';
    const out = extractFoundationJson(fenced);
    assert.equal(out.SETTING.name, 'Neo-Khelt', 'last fence wins');

    assert.equal(extractFoundationJson(JSON.stringify(f)).mode, 'modern', 'bare JSON accepted');
    assert.equal(extractFoundationJson('no json here'), null);
    assert.equal(extractFoundationJson(''), null);
    assert.equal(extractFoundationJson('```json\n[1,2,3]\n```'), null, 'arrays rejected');
});

test('foundationPlaceholders renders every sysprompt token with the right content', () => {
    setSettings({});
    const p = foundationPlaceholders(validFoundation());
    assert.ok(p.foundation_setting.includes('Neo-Khelt'));
    assert.ok(p.foundation_power_system.includes('Focus'), 'resources listed');
    assert.ok(p.foundation_dice.includes('d100') && p.foundation_dice.includes('Near-impossible—95'));
    assert.ok(p.foundation_classes.includes('Render') && p.foundation_classes.includes('Chorus'));
    assert.equal(p.foundation_currency, 'scrip');
    assert.ok(p.foundation_award_guidance.includes('%'), 'percent-bracket guidance');
    assert.equal(p.foundation_lethality_template, 'standard');
    assert.equal(p.foundation_downed_window, '3');
});

test('renderFoundationProse produces a stable full document', () => {
    setSettings({});
    const doc = renderFoundationProse({ ...validFoundation(), foundationVersion: 2 });
    assert.ok(doc.startsWith('# FOUNDATION v2 — Neo-Khelt'));
    for (const heading of ['## Setting', '## Power System', '## Checks', '## Classes', '## Jobs', '## Progression', '## Lethality']) {
        assert.ok(doc.includes(heading), `${heading} present`);
    }
    assert.ok(doc.includes('Memory Contractor'), 'job seeds listed');
});
