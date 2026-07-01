/**
 * Tests for central-tension-compiler.js's non-UI logic: commitCentralTension
 * (the function that turns a validated compiler candidate into the working
 * World Arc state — never the raw preset/custom-text input verbatim) and its
 * interaction with validateCentralTension from world-progression-schema.js.
 */
import './_bootstrap.js';
import { setSettings, rawStore } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { commitCentralTension } from '../central-tension-compiler.js';
import { validateCentralTension } from '../world-progression-schema.js';
import { getWorldState, getChatWorldProg } from '../world-progression.js';

// loadWorldInfo/writeBookToDisk touch ST's world-info HTTP API — stub them out
// for this pure-persistence test (faction lorebook seeding is exercised
// end-to-end only in a real ST session, matching router.js's own test boundary).
// _bootstrap.js's getContext() returns a FRESH object every call, so the
// override must replace the function itself, not mutate one returned instance.
const _baseGetContext = SillyTavern.getContext.bind(SillyTavern);
function stubWorldInfo(loadWorldInfoImpl) {
    SillyTavern.getContext = () => ({ ..._baseGetContext(), loadWorldInfo: loadWorldInfoImpl, saveWorldInfo: async () => {} });
}

function compiledCandidate(overrides = {}) {
    return {
        intimateConflict: 'The player is being courted by a voice that offers them power at a cost.',
        epicConflict: 'The barrier between this world and the Hollow is failing.',
        milestoneChain: Array.from({ length: 6 }, (_, i) => ({ title: `Milestone ${i + 1}`, description: `What happens at step ${i + 1}.` })),
        factionSeeds: [{ name: 'The Hollow Choir', posture: 'scheming', goal: 'Widen the tear between worlds.' }],
        chapter1Seeds: [
            { text: 'A raven watches from the rooftop and flies north.', tiedTo: 'world' },
            { text: 'An old friend hesitates when asked about the sealed door.', tiedTo: 'character' },
            { text: 'A symbol scratched into the tavern floorboards.', tiedTo: 'regional' },
        ],
        ...overrides,
    };
}

test('commitCentralTension: passes validateCentralTension first (sanity — the compiler never commits an invalid candidate)', () => {
    const { ok } = validateCentralTension(compiledCandidate());
    assert.equal(ok, true);
});

test('commitCentralTension: seeds worldState.milestoneChain, factions, and chapter1 seeds — never the raw input verbatim', async () => {
    setSettings({ chatStates: { chatA: {} } });
    stubWorldInfo(async () => null);

    const compiled = compiledCandidate();
    const worldState = await commitCentralTension('chatA', compiled, { source: 'custom', rawInput: 'a possession story' });

    assert.equal(worldState.centralTension.source, 'custom');
    assert.equal(worldState.centralTension.rawInput, 'a possession story');
    assert.equal(worldState.centralTension.intimateConflict, compiled.intimateConflict);
    assert.notEqual(worldState.centralTension.intimateConflict, 'a possession story', 'raw input is stored for provenance only, never used as the working tension text');

    assert.equal(worldState.milestoneChain.length, 6);
    assert.equal(worldState.milestoneChain[0].id, 'ms_1');
    assert.equal(worldState.milestoneChain[0].status, 'pending');
    assert.equal(worldState.worldClock.nextMilestoneId, 'ms_1');

    assert.equal(Object.keys(worldState.factions).length, 1);
    const faction = worldState.factions['seed_faction_1'];
    assert.equal(faction.posture, 'scheming');
    assert.equal(faction.goal, 'Widen the tear between worlds.');

    const chatWorldProg = getChatWorldProg('chatA');
    assert.equal(chatWorldProg.worldStateKey, 'chatA');
    assert.equal(chatWorldProg.chapter.seeds.length, 3);
    assert.ok(chatWorldProg.chapter.seeds.every(s => s.status === 'planted' && !s.engaged));
});

test('commitCentralTension: re-compiling replaces the milestone chain and factions rather than appending', async () => {
    setSettings({ chatStates: { chatB: {} } });
    stubWorldInfo(async () => null);

    await commitCentralTension('chatB', compiledCandidate(), { source: 'ai_generated', rawInput: '' });
    const second = compiledCandidate({ milestoneChain: Array.from({ length: 5 }, (_, i) => ({ title: `Redo ${i}`, description: 'd' })) });
    const worldState = await commitCentralTension('chatB', second, { source: 'ai_generated', rawInput: '' });

    assert.equal(worldState.milestoneChain.length, 5);
    assert.equal(worldState.milestoneChain[0].title, 'Redo 0');
});

test('commitCentralTension: throws when the chat has no resolvable campaign prefix', async () => {
    setSettings({ chatStates: {} });
    await assert.rejects(() => commitCentralTension('', compiledCandidate(), { source: 'ai_generated', rawInput: '' }));
});

test('commitCentralTension: faction lorebook seeding failure does not prevent the state commit', async () => {
    setSettings({ chatStates: { chatC: {} } });
    stubWorldInfo(async () => { throw new Error('network down'); });

    const worldState = await commitCentralTension('chatC', compiledCandidate(), { source: 'preset', rawInput: 'possession,dimensional_instability' });
    assert.equal(worldState.milestoneChain.length, 6, 'state still commits even though the lorebook write failed');
    assert.equal(worldState.factions['seed_faction_1'].lorebookEntryId, '', 'link stays empty since the write never succeeded');
});
