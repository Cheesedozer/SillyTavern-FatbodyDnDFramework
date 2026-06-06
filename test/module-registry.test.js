/**
 * Tests for the module registry: locks the derived values byte-identical to the
 * historical literals, and guards registry<->constants consistency so adding a
 * module to one without the other is caught.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMO_MODULES, BLOCK_ORDER, DEFAULT_BLOCK_ORDER,
    getDefaultModuleToggles, getMemoModuleByTag, getRenderTypeForTag,
} from '../module-registry.js';
import { DEFAULT_STOCK_PROMPTS } from '../constants.js';

test('BLOCK_ORDER derives byte-identical to the historical literal', () => {
    assert.deepEqual(BLOCK_ORDER, ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'QUESTS']);
});

test('DEFAULT_BLOCK_ORDER excludes QUESTS (matches the per-chat default)', () => {
    assert.deepEqual(DEFAULT_BLOCK_ORDER, ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME']);
});

test('default module toggles are all-on for every stock module', () => {
    assert.deepEqual(getDefaultModuleToggles(), {
        combat: true, character: true, party: true, inventory: true,
        abilities: true, spells: true, xp: true, time: true, quests: true,
    });
});

test('consistency: every memo module has a matching DEFAULT_STOCK_PROMPTS entry', () => {
    for (const m of MEMO_MODULES) {
        assert.ok(m.id in DEFAULT_STOCK_PROMPTS, `missing stock prompt for "${m.id}"`);
    }
});

test('getMemoModuleByTag is case-insensitive', () => {
    assert.equal(getMemoModuleByTag('party').id, 'party');
    assert.equal(getMemoModuleByTag('PARTY').id, 'party');
    assert.equal(getMemoModuleByTag('nope'), null);
});

test('getRenderTypeForTag maps PARTY->CHARACTER and passes unknown tags through', () => {
    assert.equal(getRenderTypeForTag('PARTY'), 'CHARACTER');
    assert.equal(getRenderTypeForTag('COMBAT'), 'COMBAT');
    assert.equal(getRenderTypeForTag('CUSTOMTAG'), 'CUSTOMTAG');
});
