/**
 * Tests for default-foundation.js — the built-in Quick Start foundation must
 * always pass schema validation and ship the six canonical starter classes.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFoundation } from '../foundation.js';
import { defaultFoundation, DEFAULT_CLASS_IDS, CLASS_CRESTS } from '../default-foundation.js';

test('default foundation passes schema validation with zero errors', () => {
    setSettings({});
    const r = validateFoundation(defaultFoundation());
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
});

test('default foundation ships the six canonical starter classes', () => {
    const f = defaultFoundation();
    assert.deepEqual(f.CLASS_ROSTER.map(c => c.id), DEFAULT_CLASS_IDS);
    assert.deepEqual(DEFAULT_CLASS_IDS, ['fighter', 'monk', 'bard', 'rogue', 'ranger', 'wizard']);

    const resourceIds = new Set(f.POWER_SYSTEM.resources.map(r => r.id));
    for (const cls of f.CLASS_ROSTER) {
        assert.ok(resourceIds.has(cls.primaryResource), `${cls.id} resource exists`);
        assert.ok(cls.treeThemes.length >= 3, `${cls.id} has tree themes`);
    }
});

test('defaultFoundation is a factory — fresh object per call, mutation-safe', () => {
    const a = defaultFoundation();
    const b = defaultFoundation();
    assert.notEqual(a, b);
    a.CLASS_ROSTER.pop();
    a.SETTING.name = 'mutated';
    assert.equal(b.CLASS_ROSTER.length, 6);
    assert.equal(b.SETTING.name, 'The Awakened World');
});

test('every starter class has an SVG crest', () => {
    for (const id of DEFAULT_CLASS_IDS) {
        assert.ok(typeof CLASS_CRESTS[id] === 'string' && CLASS_CRESTS[id].includes('<svg'), `${id} crest present`);
    }
});
