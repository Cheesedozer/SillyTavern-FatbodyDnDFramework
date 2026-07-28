// Tests for origins-data.js — pure leaf module, no bootstrap needed
// (the world-progression-schema.test.js pattern).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ORIGINS, ORIGINS_BY_ID, RACES, RACES_BY_ID, CULTURE_VIBES, VIBES_BY_ID,
    VIBE_HARD_BLOCKS, GOVERNMENT_TYPES, ENVIRONMENTS, PURSUER_BLOCK,
    APPEARANCE_FIELDS, INTIMATE_FIELDS, OPENING_FRAMES, ORIGINS_SETTING,
    SILKBORN_SEVERANCE, VAMPIRE_ALLOWED_ORIGINS,
} from '../origins-data.js';

test('there are exactly 12 races with unique ids and required fields', () => {
    assert.equal(RACES.length, 12);
    const ids = new Set(RACES.map(r => r.id));
    assert.equal(ids.size, 12);
    for (const r of RACES) {
        for (const key of ['name', 'emoji', 'summary', 'habitat', 'lifespan', 'naming', 'cultureDefaults', 'appearance']) {
            assert.ok(typeof r[key] === 'string' && r[key].length > 0, `${r.id}.${key}`);
        }
        assert.equal(typeof r.living, 'boolean', `${r.id}.living`);
    }
});

test('vampire is the only non-living race, and vampire/silkborn carry mechanics', () => {
    const nonLiving = RACES.filter(r => !r.living);
    assert.deepEqual(nonLiving.map(r => r.id), ['vampire']);
    assert.ok(RACES_BY_ID['vampire'].mechanics.includes('THIRST'));
    assert.ok(RACES_BY_ID['silkborn'].mechanics.includes('CHORUS-WEAVE'));
});

test('there are 12 culture vibes; each carries a substantial internal description', () => {
    assert.equal(CULTURE_VIBES.length, 12);
    for (const v of CULTURE_VIBES) {
        assert.ok(v.internal.length > 120, `${v.id} internal description too short`);
        assert.ok(v.summary.length > 0, `${v.id} summary`);
    }
});

test('death vibe requires sub-options; pleasure is the only NSFW vibe', () => {
    const death = VIBES_BY_ID['death'];
    assert.equal(death.subOptions.length, 2);
    for (const s of death.subOptions) assert.ok(s.internal.length > 100);
    assert.deepEqual(CULTURE_VIBES.filter(v => v.nsfw).map(v => v.id), ['pleasure']);
});

test('vibe hard blocks reference real vibes (matriarchal × patriarchal)', () => {
    assert.equal(VIBE_HARD_BLOCKS.length, 1);
    for (const [a, b] of VIBE_HARD_BLOCKS) {
        assert.ok(VIBES_BY_ID[a], a);
        assert.ok(VIBES_BY_ID[b], b);
    }
    assert.deepEqual([...VIBE_HARD_BLOCKS[0]].sort(), ['matriarchal', 'patriarchal']);
});

test('government and environment option lists exist with unique ids', () => {
    assert.ok(GOVERNMENT_TYPES.length >= 10);
    assert.ok(ENVIRONMENTS.length >= 12);
    assert.equal(new Set(GOVERNMENT_TYPES.map(g => g.id)).size, GOVERNMENT_TYPES.length);
    assert.equal(new Set(ENVIRONMENTS.map(e => e.id)).size, ENVIRONMENTS.length);
});

test('every race environmentId resolves to a real environment', () => {
    for (const r of RACES) {
        if (r.environmentId) assert.ok(ENVIRONMENTS.some(e => e.id === r.environmentId), r.id);
    }
});

test('there are exactly 8 origins with unique ids and complete lever/pitch data', () => {
    assert.equal(ORIGINS.length, 8);
    assert.equal(new Set(ORIGINS.map(o => o.id)).size, 8);
    for (const o of ORIGINS) {
        for (const key of ['name', 'emoji', 'pitch', 'nationMeaning', 'leverSocial', 'leverPersonal', 'classLeaning', 'worldThreatHint']) {
            assert.ok(typeof o[key] === 'string' && o[key].length > 0, `${o.id}.${key}`);
        }
        assert.ok(['required', 'default_on', 'optional', 'conditional'].includes(o.pursuer), `${o.id}.pursuer`);
        assert.ok(o.questSeeds.length >= 4, `${o.id} needs >=4 quest seeds`);
        assert.ok(o.blanks.length >= 3, `${o.id} needs >=3 blanks`);
        assert.ok(o.modifiers.length >= 4, `${o.id} needs >=4 modifiers`);
    }
});

test('modifier options are unique per modifier; non-optional modifiers offer a real choice', () => {
    for (const o of ORIGINS) {
        for (const m of o.modifiers) {
            assert.ok(m.options.length >= 1, `${o.id}.${m.id}`);
            assert.equal(new Set(m.options.map(x => x.id)).size, m.options.length, `${o.id}.${m.id} duplicate options`);
            if (!m.optional) assert.ok(m.options.length >= 2, `${o.id}.${m.id} required but single-option`);
        }
    }
});

test('incompatibility rules reference existing modifiers, options, and pursuer fields', () => {
    const pursuerFieldValues = {
        affiliation: PURSUER_BLOCK.affiliations.map(x => x.id),
        motive: PURSUER_BLOCK.motives.map(x => x.id),
        resources: PURSUER_BLOCK.resources.map(x => x.id),
        awareness: PURSUER_BLOCK.awareness.map(x => x.id),
    };
    for (const o of ORIGINS) {
        const mods = Object.fromEntries(o.modifiers.map(m => [m.id, m]));
        for (const rule of o.incompatibilities || []) {
            assert.ok(['hard', 'soft'].includes(rule.type), `${o.id}.${rule.id}.type`);
            for (const [modId, optId] of Object.entries(rule.when || {})) {
                assert.ok(mods[modId], `${o.id}.${rule.id} unknown modifier ${modId}`);
                assert.ok(mods[modId].options.some(x => x.id === optId), `${o.id}.${rule.id} unknown option ${optId}`);
            }
            for (const [field, value] of Object.entries(rule.conflictsWithPursuer || {})) {
                assert.ok(pursuerFieldValues[field]?.includes(value), `${o.id}.${rule.id} pursuer ${field}=${value}`);
            }
            if (rule.requiresBlank) assert.ok(o.blanks.some(b => b.id === rule.requiresBlank), `${o.id}.${rule.id}.requiresBlank`);
            if (rule.requiresModifier) {
                assert.ok(mods[rule.requiresModifier.id], `${o.id}.${rule.id}.requiresModifier`);
                for (const v of rule.requiresModifier.anyOf) {
                    assert.ok(mods[rule.requiresModifier.id].options.some(x => x.id === v));
                }
            }
        }
    }
});

test('NSFW gating flags sit exactly where the spec puts them', () => {
    const gated = [];
    for (const o of ORIGINS) for (const m of o.modifiers) if (m.nsfw) gated.push(`${o.id}.${m.id}`);
    assert.deepEqual(gated.sort(), ['exiled_royal.vampire_farms', 'vampire_lord.farms']);
    // Gated modifiers must also be optional — the toggle reveals choices, never makes them.
    for (const o of ORIGINS) for (const m of o.modifiers) if (m.nsfw) assert.ok(m.optional, `${o.id}.${m.id}`);
});

test('vampire race restriction and vampire lord race requirement are encoded', () => {
    assert.deepEqual([...VAMPIRE_ALLOWED_ORIGINS].sort(), ['exiled_royal', 'vampire_lord']);
    assert.equal(ORIGINS_BY_ID['vampire_lord'].requiredRace, 'vampire');
});

test('appearance and intimate descriptor field sets match the spec sections', () => {
    assert.deepEqual(APPEARANCE_FIELDS.map(f => f.id), ['skin', 'bodyType', 'height', 'hair', 'eyes', 'face', 'marks']);
    assert.deepEqual(INTIMATE_FIELDS.map(f => f.id), ['chest', 'hips', 'parts', 'size', 'type', 'other']);
});

test('setting identity carries the fixed anchors and both opening frames exist', () => {
    assert.equal(ORIGINS_SETTING.name, 'Vaelmarch');
    assert.equal(ORIGINS_SETTING.anchors.length, 4);
    assert.ok(ORIGINS_SETTING.anchors.some(a => a.name.includes('Argent Concord')));
    assert.ok(ORIGINS_SETTING.anchors.some(a => a.name.includes('Sealed Lamp')));
    assert.deepEqual(OPENING_FRAMES.map(f => f.id), ['in_medias_res', 'quiet_start']);
    assert.equal(SILKBORN_SEVERANCE.rules.length, 4);
});
