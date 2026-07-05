/**
 * Tests for world-progression.js's persistence accessors — the pieces that
 * only lightly touch the SillyTavern context stub (extensionSettings +
 * saveSettingsDebounced, per _bootstrap.js). The heavier network-calling
 * paths (runWorldProgressionAgentTurn) are exercised indirectly through the
 * pure logic they depend on in world-progression-schema.test.js; router.js
 * follows the same convention (only its pure helpers are unit-tested here).
 */
import './_bootstrap.js';
import { setSettings, rawStore } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getWorldProgKey,
    getWorldState,
    saveWorldState,
    getChatWorldProg,
    saveChatWorldProg,
    worldProgSettings,
    forkWorldState,
    resetWorldProgTick,
    pruneCommittedDeltas,
    rollbackDelta,
    rollbackDeltasForMessage,
    reconcileWorldProgRollbacks,
    replaceWorldState,
    replaceChatWorldProg,
    detectMeguminOverlap,
    detectMeguminFatbodyBlock,
} from '../world-progression.js';

/**
 * Seeds chatStates[chatId]. With no `worldProgOverride`, worldProg is
 * entirely absent (a chat World Progression has never touched), so
 * getChatWorldProg's default-creation path runs — passing `{}` would
 * defeat that check (an empty-but-present object is still truthy).
 */
function seedChat(chatId, worldProgOverride) {
    setSettings({
        routerCampaignPrefixOverride: '',
        chatStates: {
            [chatId]: worldProgOverride === undefined ? {} : { worldProg: worldProgOverride },
        },
    });
}

test('getWorldProgKey: falls back to the campaign-prefix convention when no fork override is set', () => {
    seedChat('chat1');
    // No worldStateKey override recorded — derives from the sanitized chat id, same as router.js.
    assert.equal(getWorldProgKey('chat1'), 'chat1');
});

test('getWorldProgKey: a per-chat fork override takes precedence over the live campaign prefix', () => {
    seedChat('chat1', { worldStateKey: 'chat1__fork_abc123' });
    assert.equal(getWorldProgKey('chat1'), 'chat1__fork_abc123');
});

test('getWorldState: creates a default state on first access and persists it under the resolved key', () => {
    seedChat('chat2');
    const ws = getWorldState('chat2');
    assert.ok(ws);
    assert.equal(ws.schemaVersion, 1);
    assert.deepEqual(ws.milestoneChain, []);
    assert.ok(rawStore().rpg_tracker.worldStates['chat2'], 'backfilled into settings.worldStates under the derived key');
});

test('getWorldState: returns null when there is no usable campaign prefix', () => {
    seedChat('');
    assert.equal(getWorldState(''), null);
});

test('saveWorldState: shallow patch merges without clobbering unrelated fields', () => {
    seedChat('chat3');
    const ws = getWorldState('chat3');
    ws.factions.f1 = { posture: 'scheming' };
    saveWorldState('chat3', { tectonicShiftsUsed: 2 });
    const after = getWorldState('chat3');
    assert.equal(after.tectonicShiftsUsed, 2);
    assert.deepEqual(after.factions, { f1: { posture: 'scheming' } }, 'in-place mutation before the patch call is preserved');
});

test('getChatWorldProg: creates a default and stamps worldStateKey from the campaign prefix', () => {
    seedChat('chat4');
    const prog = getChatWorldProg('chat4');
    assert.ok(prog);
    assert.equal(prog.worldStateKey, 'chat4');
    assert.equal(prog.pacing.mode, 'exploration');
});

test('getChatWorldProg: returns null without a chatId', () => {
    assert.equal(getChatWorldProg(''), null);
    assert.equal(getChatWorldProg(undefined), null);
});

test('worldProgSettings: remaps the worldProg* namespace onto the generic connection-settings shape', () => {
    const mapped = worldProgSettings({
        worldProgConnectionSource: 'openai',
        worldProgConnectionProfileId: 'p1',
        worldProgCompletionPresetId: '',
        worldProgOllamaUrl: 'http://x',
        worldProgOllamaModel: 'm',
        worldProgOpenaiUrl: 'http://y',
        worldProgOpenaiKey: 'k',
        worldProgOpenaiModel: 'gpt',
        worldProgMaxTokens: 500,
    });
    assert.equal(mapped.connectionSource, 'openai');
    assert.equal(mapped.connectionProfileId, 'p1');
    assert.equal(mapped.openaiUrl, 'http://y');
    assert.equal(mapped.maxTokens, 500);
});

test('worldProgSettings: defaults connectionSource to "default" and maxTokens to 1000 when unset', () => {
    const mapped = worldProgSettings({});
    assert.equal(mapped.connectionSource, 'default');
    assert.equal(mapped.maxTokens, 1000);
});

test('forkWorldState: clones the live world state into a new key and repoints the chat', () => {
    seedChat('chat5');
    const ws = getWorldState('chat5');
    ws.milestoneChain = [{ id: 'ms_1', title: 'X', status: 'pending' }];
    saveWorldState('chat5');

    const ok = forkWorldState('chat5');
    assert.equal(ok, true);

    const newKey = rawStore().rpg_tracker.chatStates.chat5.worldProg.worldStateKey;
    assert.notEqual(newKey, 'chat5');
    assert.ok(newKey.startsWith('chat5__fork_'));
    assert.deepEqual(rawStore().rpg_tracker.worldStates[newKey].milestoneChain, ws.milestoneChain, 'forked copy starts as a snapshot of the live state');

    // Independence: mutating the fork must not affect the original.
    getWorldState('chat5').milestoneChain.push({ id: 'ms_2' });
    assert.equal(rawStore().rpg_tracker.worldStates['chat5'].milestoneChain.length, 1, 'original prefix state is untouched by the fork copy');
});

test('forkWorldState: no-op when there is nothing live to fork', () => {
    seedChat('chat6');
    assert.equal(forkWorldState('chat6'), false);
});

test('rollback bookkeeping: registerPendingDelta -> rollbackDelta restores prior state and removes the record', () => {
    seedChat('chat7');
    const ws = getWorldState('chat7');
    ws.factions.f1 = { posture: 'defensive', goal: 'hold' };
    saveWorldState('chat7');

    const prog = getChatWorldProg('chat7');
    // Simulate what applyWorldProgressionCommit does internally: snapshot before, mutate, record.
    const before = structuredClone(ws.factions.f1);
    ws.factions.f1 = { posture: 'aggressive', goal: 'attack' };
    prog.pendingDeltas.push({
        id: 'wpdelta_test_1', messageIndex: 5, swipeId: 0, appliedAt: new Date().toISOString(),
        crossChat: true, layer: 'worldArc',
        inversePatch: [{ path: ['factions', 'f1'], existed: true, value: before }],
        committed: false,
    });
    saveChatWorldProg('chat7');

    const ok = rollbackDelta('chat7', 'wpdelta_test_1');
    assert.equal(ok, true);
    assert.deepEqual(getWorldState('chat7').factions.f1, before);
    assert.equal(getChatWorldProg('chat7').pendingDeltas.length, 0);
});

test('rollbackDeltasForMessage: rolls back every delta id referenced by a message.extra payload', () => {
    seedChat('chat8');
    const ws = getWorldState('chat8');
    ws.factions.f1 = { posture: 'defensive' };
    ws.factions.f2 = { posture: 'defensive' };
    saveWorldState('chat8');
    const before1 = structuredClone(ws.factions.f1);
    const before2 = structuredClone(ws.factions.f2);
    ws.factions.f1.posture = 'scheming';
    ws.factions.f2.posture = 'fractured';

    const prog = getChatWorldProg('chat8');
    prog.pendingDeltas.push(
        { id: 'd1', messageIndex: 3, swipeId: 0, appliedAt: '', crossChat: true, layer: 'worldArc', inversePatch: [{ path: ['factions', 'f1'], existed: true, value: before1 }], committed: false },
        { id: 'd2', messageIndex: 3, swipeId: 0, appliedAt: '', crossChat: true, layer: 'worldArc', inversePatch: [{ path: ['factions', 'f2'], existed: true, value: before2 }], committed: false },
    );
    saveChatWorldProg('chat8');

    rollbackDeltasForMessage('chat8', { worldProgDeltaIds: ['d1', 'd2'] });
    assert.equal(getWorldState('chat8').factions.f1.posture, 'defensive');
    assert.equal(getWorldState('chat8').factions.f2.posture, 'defensive');
    assert.equal(getChatWorldProg('chat8').pendingDeltas.length, 0);
});

test('pruneCommittedDeltas: drops deltas past the commit horizon, keeps recent ones', () => {
    seedChat('chat9');
    getWorldState('chat9'); // ensure backing world state exists
    const prog = getChatWorldProg('chat9');
    prog.pendingDeltas = [
        { id: 'old', messageIndex: 1, inversePatch: [], crossChat: false, layer: 'regionalState' },
        { id: 'recent', messageIndex: 9, inversePatch: [], crossChat: false, layer: 'regionalState' },
    ];
    saveChatWorldProg('chat9');

    pruneCommittedDeltas('chat9', 10); // horizon default is 2 messages back
    const remaining = getChatWorldProg('chat9').pendingDeltas.map(d => d.id);
    assert.deepEqual(remaining, ['recent']);
});

test('replaceWorldState / replaceChatWorldProg: HUD hand-edits fully overwrite, no rollback bookkeeping involved', () => {
    seedChat('chat12');
    getWorldState('chat12'); // backfill so the key exists
    getChatWorldProg('chat12');

    const handEdited = { schemaVersion: 1, milestoneChain: [{ id: 'ms_1', title: 'Hand-edited', status: 'triggered' }], factions: {}, characterArcs: {}, worldClock: { pressureGauge: 'critical' }, centralTension: {}, tectonicShiftsUsed: 0 };
    replaceWorldState('chat12', handEdited);
    assert.deepEqual(getWorldState('chat12'), handEdited);

    const handEditedProg = { schemaVersion: 1, worldStateKey: 'chat12', pacing: { mode: 'crisis' }, chapter: { index: 3 }, regions: {}, shiftLog: [], deferredConsequenceQueue: [], pendingDeltas: [] };
    replaceChatWorldProg('chat12', handEditedProg);
    assert.deepEqual(getChatWorldProg('chat12'), handEditedProg);
});

test('resetWorldProgTick: does not throw and is safe to call with no active chat', () => {
    assert.doesNotThrow(() => resetWorldProgTick());
});

test('detectMeguminOverlap: not installed when the Megumin-Suite settings key is absent', () => {
    setSettings({});
    assert.deepEqual(detectMeguminOverlap(), { installed: false, overlap: false });
});

test('detectMeguminOverlap: installed but no overlap when neither NPC Bank nor Story Planner is enabled', () => {
    setSettings({});
    rawStore()['Megumin-Suite'] = { profiles: { default: { npcBank: { enabled: false }, storyPlan: { enabled: false } } } };
    const result = detectMeguminOverlap();
    assert.equal(result.installed, true);
    assert.equal(result.overlap, false);
});

test('detectMeguminOverlap: reports overlapping feature names when enabled on the resolved profile', () => {
    setSettings({});
    rawStore()['Megumin-Suite'] = { profiles: { default: { npcBank: { enabled: true }, storyPlan: { enabled: true } } } };
    const result = detectMeguminOverlap();
    assert.equal(result.overlap, true);
    assert.deepEqual(result.overlapFeatures.sort(), ['NPC Bank', 'Story Planner / Evolving Arc'].sort());
});

test('detectMeguminOverlap: never mutates Megumin\'s settings object', () => {
    setSettings({});
    const meguminSettings = { profiles: { default: { npcBank: { enabled: true } } } };
    rawStore()['Megumin-Suite'] = meguminSettings;
    detectMeguminOverlap();
    assert.deepEqual(rawStore()['Megumin-Suite'], meguminSettings, 'read-only — must not write into another extension\'s settings object');
});

test('detectMeguminFatbodyBlock: not installed when the Megumin-Suite settings key is absent', () => {
    setSettings({});
    assert.deepEqual(detectMeguminFatbodyBlock(), { installed: false, active: false });
});

test('detectMeguminFatbodyBlock: installed but inactive when the fatbody block is not in the resolved profile\'s blocks', () => {
    setSettings({});
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['info', 'mvu'] } } };
    assert.deepEqual(detectMeguminFatbodyBlock(), { installed: true, active: false });
});

test('detectMeguminFatbodyBlock: active when the resolved profile\'s blocks includes "fatbody"', () => {
    setSettings({});
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['info', 'fatbody'] } } };
    assert.deepEqual(detectMeguminFatbodyBlock(), { installed: true, active: true });
});

test('detectMeguminFatbodyBlock: never mutates Megumin\'s settings object', () => {
    setSettings({});
    const meguminSettings = { profiles: { default: { blocks: ['fatbody'] } } };
    rawStore()['Megumin-Suite'] = meguminSettings;
    detectMeguminFatbodyBlock();
    assert.deepEqual(rawStore()['Megumin-Suite'], meguminSettings, 'read-only — must not write into another extension\'s settings object');
});

test('reconcileWorldProgRollbacks: rolls back a delta whose message was deleted (id no longer referenced anywhere in chat)', () => {
    seedChat('chat10');
    rawStore().rpg_tracker.worldProgEnabled = true;
    const ws = getWorldState('chat10');
    ws.factions.f1 = { posture: 'defensive' };
    saveWorldState('chat10');
    const before = structuredClone(ws.factions.f1);
    ws.factions.f1.posture = 'scheming';

    const prog = getChatWorldProg('chat10');
    prog.pendingDeltas.push({ id: 'orphan-1', messageIndex: 4, swipeId: 0, appliedAt: '', crossChat: true, layer: 'worldArc', inversePatch: [{ path: ['factions', 'f1'], existed: true, value: before }], committed: false });
    saveChatWorldProg('chat10');

    // Simulate the message that carried this delta id no longer existing in chat[].
    const baseGetContext = SillyTavern.getContext.bind(SillyTavern);
    SillyTavern.getContext = () => ({ ...baseGetContext(), chat: [] });

    reconcileWorldProgRollbacks('chat10');
    assert.equal(getWorldState('chat10').factions.f1.posture, 'defensive');
    assert.equal(getChatWorldProg('chat10').pendingDeltas.length, 0);
});

test('reconcileWorldProgRollbacks: leaves a delta alone when its message still references the id', () => {
    seedChat('chat11');
    rawStore().rpg_tracker.worldProgEnabled = true;
    const ws = getWorldState('chat11');
    ws.factions.f1 = { posture: 'aggressive' };
    saveWorldState('chat11');

    const prog = getChatWorldProg('chat11');
    prog.pendingDeltas.push({ id: 'kept-1', messageIndex: 2, swipeId: 0, appliedAt: '', crossChat: true, layer: 'worldArc', inversePatch: [{ path: ['factions', 'f1'], existed: true, value: { posture: 'defensive' } }], committed: false });
    saveChatWorldProg('chat11');

    const baseGetContext = SillyTavern.getContext.bind(SillyTavern);
    SillyTavern.getContext = () => ({ ...baseGetContext(), chat: [{}, {}, { extra: { worldProgDeltaIds: ['kept-1'] } }] });

    reconcileWorldProgRollbacks('chat11');
    assert.equal(getWorldState('chat11').factions.f1.posture, 'aggressive', 'still-referenced delta is not rolled back');
    assert.equal(getChatWorldProg('chat11').pendingDeltas.length, 1);
});

test('reconcileWorldProgRollbacks: no-ops without touching chatStates when World Progression is disabled', () => {
    // MESSAGE_DELETED/MESSAGE_SWIPED listeners call this unconditionally
    // (index.js) — it must not stamp a stub worldProg record onto every chat
    // for users who never turned the feature on.
    setSettings({ routerCampaignPrefixOverride: '', chatStates: {} });
    rawStore().rpg_tracker.worldProgEnabled = false;
    reconcileWorldProgRollbacks('chat12');
    assert.equal(rawStore().rpg_tracker.chatStates.chat12, undefined);
});
