/**
 * Characterization tests for getSettings() and the default-value contract.
 *
 * The two "independence" tests are the LINCHPIN guards for the Phase 1
 * getSettings() defaults-hoist: they prove that two separate stores never share
 * the same mutable nested objects. If a future refactor hoists `modules` /
 * `routerModules` into a shared frozen default, these fail.
 *
 * The byte-equality tests guard the values that the Phase 2 module registry
 * will derive — drift fails here immediately.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, DEFAULT_MODULES, migrateSystemPrompt, STATE_PROMPT_VERSION } from '../state-manager.js';
import { BLOCK_ORDER } from '../module-registry.js';

const EXPECTED_MEMO_MODULES = {
    character: true, party: true, combat: true, inventory: true,
    abilities: true, spells: true, time: true, xp: true, quests: true,
};
const EXPECTED_BLOCK_ORDER_DEFAULT = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];

test('getSettings fills defaults on an empty store', () => {
    setSettings({});
    const s = getSettings();
    assert.equal(s.suiteMode, false);
    assert.equal(s.rngEnabled, true);
    assert.equal(s.diceFunctionTool, true);
    assert.deepEqual(s.modules, EXPECTED_MEMO_MODULES);
    assert.deepEqual(s.blockOrder, EXPECTED_BLOCK_ORDER_DEFAULT);
});

test('getSettings does not clobber existing user values', () => {
    setSettings({ suiteMode: true, fontSize: 22 });
    const s = getSettings();
    assert.equal(s.suiteMode, true);
    assert.equal(s.fontSize, 22);
    // still backfills unspecified keys
    assert.equal(s.rngEnabled, true);
});

test('LINCHPIN: two fresh stores do not share the same nested modules object', () => {
    setSettings({});
    const a = getSettings();
    a.modules.combat = false;
    setSettings({});
    const b = getSettings();
    assert.equal(b.modules.combat, true, 'a fresh store must receive an independent modules object');
});

test('LINCHPIN: routerModules is deep-equal to but not aliased with DEFAULT_MODULES', () => {
    setSettings({});
    const s = getSettings();
    assert.deepEqual(s.routerModules, DEFAULT_MODULES);
    assert.notEqual(s.routerModules, DEFAULT_MODULES);
    s.routerModules.npc.enabled = false;
    assert.equal(DEFAULT_MODULES.npc.enabled, true, 'mutating settings must not mutate the hoisted default');
});

test('byte-equality guard: constants.BLOCK_ORDER literal is stable', () => {
    assert.deepEqual(BLOCK_ORDER, ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'QUESTS']);
});

test('byte-equality guard: settings.modules defaults are stable', () => {
    setSettings({});
    assert.deepEqual(getSettings().modules, EXPECTED_MEMO_MODULES);
});

test('migrateSystemPrompt: fresh install (latest default) just stamps the version', () => {
    setSettings({});
    const s = getSettings();
    const before = s.systemPromptTemplate;
    migrateSystemPrompt(s);
    assert.equal(s.systemPromptTemplate, before, 'latest default is left unchanged');
    assert.equal(s.systemPromptVersion, STATE_PROMPT_VERSION);
    assert.equal(s.systemPromptUpdateAvailable, false, 'no notice for an up-to-date install');
});

test('migrateSystemPrompt: a customized prompt is preserved and flagged', () => {
    setSettings({ systemPromptTemplate: 'MY CUSTOM EXTRACTOR PROMPT', systemPromptVersion: 0 });
    const s = getSettings();
    migrateSystemPrompt(s);
    assert.equal(s.systemPromptTemplate, 'MY CUSTOM EXTRACTOR PROMPT', 'never clobber a user prompt');
    assert.equal(s.systemPromptUpdateAvailable, true, 'surface an update notice instead');
    assert.equal(s.systemPromptVersion, STATE_PROMPT_VERSION);
});

test('migrateSystemPrompt: idempotent (version gate prevents re-running)', () => {
    setSettings({ systemPromptTemplate: 'MY CUSTOM EXTRACTOR PROMPT', systemPromptVersion: 0 });
    const s = getSettings();
    migrateSystemPrompt(s);
    s.systemPromptUpdateAvailable = false; // simulate UI consuming the notice
    migrateSystemPrompt(s);
    assert.equal(s.systemPromptUpdateAvailable, false, 'does not re-fire once version is current');
});

test('reset-by-delete: getSettings backfills a deleted key with an independent clone', () => {
    // The reset buttons (index.js) delete keys and rely on getSettings() to
    // re-merge defaults. This guards that the template-clone merge preserves it.
    setSettings({});
    const s = getSettings();
    delete s.modules;
    delete s.systemPromptTemplate;
    const s2 = getSettings();
    assert.deepEqual(s2.modules, EXPECTED_MEMO_MODULES, 'deleted object key is restored');
    assert.equal(typeof s2.systemPromptTemplate, 'string');
    assert.ok(s2.systemPromptTemplate.length > 0, 'deleted string key is restored');
    // restored object must be independent of any other store's defaults
    s2.modules.combat = false;
    setSettings({});
    assert.equal(getSettings().modules.combat, true);
});

// ── Router activation mode (v2.5.1) ───────────────────────────────────────────

test('routerActivationMode defaults to managed; helper normalizes junk values', async () => {
    const { getActivationMode } = await import('../state-manager.js');
    setSettings({});
    assert.equal(getActivationMode(getSettings()), 'managed');
    setSettings({ routerActivationMode: 'semantic' });
    assert.equal(getActivationMode(getSettings()), 'semantic');
    setSettings({ routerActivationMode: 'bogus' });
    assert.equal(getActivationMode(getSettings()), 'managed', 'unknown values fall back to managed');
});

test('migration: legacy routerNativeKeywordActivation=true becomes mode native, once', async () => {
    const { getActivationMode } = await import('../state-manager.js');
    setSettings({ routerNativeKeywordActivation: true });
    const s = getSettings();
    assert.equal(getActivationMode(s), 'native', 'legacy flag mapped to native mode');
    assert.equal(s.routerNativeKeywordActivation, false, 'legacy flag consumed');

    // User later switches to managed — re-reading settings must NOT force native back.
    s.routerActivationMode = 'managed';
    assert.equal(getActivationMode(getSettings()), 'managed', 'migration does not re-fire');
});
