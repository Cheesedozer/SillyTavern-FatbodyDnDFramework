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
    skills: false,   // v3.0 Modern-mode module — opt-in per chat
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

test('byte-equality guard: BLOCK_ORDER is the historical literal + SKILLS (v3.0)', () => {
    assert.deepEqual(BLOCK_ORDER, ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'QUESTS', 'SKILLS']);
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
    setSettings({ routerActivationMode: 'native' });
    assert.equal(getActivationMode(getSettings()), 'native');
    setSettings({ routerActivationMode: 'bogus' });
    assert.equal(getActivationMode(getSettings()), 'managed', 'unknown values fall back to managed');
    setSettings({ routerActivationMode: 'turbo' });
    assert.equal(getActivationMode(getSettings()), 'managed');
});

test('migration: removed semantic mode folds back to managed in stored settings', async () => {
    const { getActivationMode } = await import('../state-manager.js');
    setSettings({ routerActivationMode: 'semantic' });
    const s = getSettings();
    assert.equal(s.routerActivationMode, 'managed', 'stored value rewritten, not just normalized on read');
    assert.equal(getActivationMode(s), 'managed');

    // 'native' is untouched by the migration.
    setSettings({ routerActivationMode: 'native' });
    assert.equal(getSettings().routerActivationMode, 'native');
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

// ── v3.0 campaign mode plumbing ────────────────────────────────────────────────

test('v2→v3 migration stamps campaignMode=dnd on existing chatStates, preserving everything else', async () => {
    const { migrateCustomFields, getCampaignMode } = await import('../state-manager.js');
    setSettings({
        chatStates: {
            'old-chat': { currentMemo: '[XP]Level: 5 | XP: 6,500/14,000[/XP]', memoHistory: [], campaignBooks: ['Eldoria_NPCs'] },
            'modern-chat': { campaignMode: 'modern', currentMemo: '' },
        },
    });
    migrateCustomFields();
    const s = getSettings();
    assert.equal(s.chatStates['old-chat'].campaignMode, 'dnd', 'legacy chat stamped dnd');
    assert.equal(s.chatStates['old-chat'].currentMemo, '[XP]Level: 5 | XP: 6,500/14,000[/XP]', 'memo untouched');
    assert.deepEqual(s.chatStates['old-chat'].campaignBooks, ['Eldoria_NPCs'], 'books untouched');
    assert.equal(s.chatStates['modern-chat'].campaignMode, 'modern', 'explicit mode never overwritten');
    assert.equal(getCampaignMode('old-chat'), 'dnd');
    assert.equal(getCampaignMode('modern-chat'), 'modern');
    assert.equal(getCampaignMode('never-seen'), 'dnd', 'unknown chats default to dnd');
});

test('saveChatState carries campaignMode/foundation/progression/onboarding across normal saves', async () => {
    const { saveChatState } = await import('../state-manager.js');
    const foundation = { schemaVersion: 1, mode: 'modern', SETTING: { name: 'Neo-Khelt' } };
    const progression = { mode: 'modern', level: 4, xp: 1200, skillPoints: { earned: 8, spent: 2 } };
    setSettings({
        currentMemo: 'memo-live',
        chatStates: { c1: { campaignMode: 'modern', foundation, progression, onboarding: { mode: 'modern' } } },
    });
    saveChatState('c1');   // normal save cycle (e.g. chat switch)
    const st = getSettings().chatStates.c1;
    assert.equal(st.campaignMode, 'modern', 'mode survives the save cycle');
    assert.deepEqual(st.foundation, foundation, 'foundation survives');
    assert.deepEqual(st.progression, progression, 'progression survives');
    assert.deepEqual(st.onboarding, { mode: 'modern' }, 'onboarding flow flag survives');
    assert.equal(st.currentMemo, 'memo-live', 'normal fields still snapshot');
});

// ── isOnboardingArcReady (HUD "Start World Arc" gate) ──────────────────────────

test('isOnboardingArcReady: Modern campaign with a locked class is ready', async () => {
    const { isOnboardingArcReady } = await import('../state-manager.js');
    setSettings({ chatStates: { modernReady: { campaignMode: 'modern', progression: { classId: 'fighter' } } } });
    const st = getSettings().chatStates.modernReady;
    assert.equal(isOnboardingArcReady(st, 'modernReady'), true);
});

test('isOnboardingArcReady: Modern campaign without a locked class is not ready', async () => {
    const { isOnboardingArcReady } = await import('../state-manager.js');
    setSettings({ chatStates: { modernNoClass: { campaignMode: 'modern', progression: { classId: null } } } });
    const st = getSettings().chatStates.modernNoClass;
    assert.equal(isOnboardingArcReady(st, 'modernNoClass'), false);

    setSettings({ chatStates: { modernNoProgression: { campaignMode: 'modern' } } });
    const st2 = getSettings().chatStates.modernNoProgression;
    assert.equal(isOnboardingArcReady(st2, 'modernNoProgression'), false);
});

test('isOnboardingArcReady: D&D ruleset picked is ready — no class-lock concept exists for D&D', async () => {
    const { isOnboardingArcReady } = await import('../state-manager.js');
    setSettings({ chatStates: { dndPicked: { onboarding: { mode: 'dnd' } } } });
    const st = getSettings().chatStates.dndPicked;
    assert.equal(isOnboardingArcReady(st, 'dndPicked'), true);
});

test('isOnboardingArcReady: neither ruleset picked (fresh/mode-select) is not ready', async () => {
    const { isOnboardingArcReady } = await import('../state-manager.js');
    assert.equal(isOnboardingArcReady(null, 'unknown-chat'), false);
    assert.equal(isOnboardingArcReady({}, 'unknown-chat'), false);
    setSettings({ chatStates: { modernPicked: { onboarding: { mode: 'modern' } } } });
    const st = getSettings().chatStates.modernPicked;
    assert.equal(isOnboardingArcReady(st, 'modernPicked'), false, 'picking Modern alone (pre-foundation) is not enough');
});
