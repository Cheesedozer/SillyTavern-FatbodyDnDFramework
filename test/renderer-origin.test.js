/**
 * Tests for the [ORIGIN] HUD card (renderer.js `case 'ORIGIN'`).
 *
 * The block is the player-facing card AND the narrator's always-on context, which
 * is why intimate prose is deliberately absent from it. The card reads that prose
 * from the committed profile instead, so the player sees it on screen while it
 * never enters a prompt — that split is the invariant worth protecting here.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockToItems } from '../renderer.js';
import { RT } from '../shared-state.js';

const PROSE = 'She carries herself like the court she lost, all straight spine and level grey eyes.';
const INTIMATE = 'Explicit paragraph the narrator only sees when the lorebook entry fires.';

/** Seeds a committed origin on a known chat id and points the renderer at it. */
function withCommittedOrigin(committed) {
    RT.currentChatId = 'chat-origin-test';
    setSettings({ chatStates: { 'chat-origin-test': { origin: { committed, nsfw: true } } } });
}

test('the appearance line renders as prose, not a squeezed kv value', () => {
    withCommittedOrigin({ appearanceProse: PROSE });
    const html = blockToItems('ORIGIN', `Origin: Exiled Royal\nAppearance: ${PROSE}\nRace: Human`).join('');

    assert.ok(html.includes('rt-card-prose'), 'gets the full-width prose treatment');
    assert.ok(html.includes('straight spine'), 'the paragraph survives intact');
    // The other lines must keep the generic kv rendering.
    assert.ok(html.includes('rt-card-kv'), 'non-appearance lines still render as kv rows');
    assert.ok(html.includes('Exiled Royal'));
});

test('intimate prose reaches the card from committed state, never from the block', () => {
    withCommittedOrigin({ appearanceProse: PROSE, intimateProse: INTIMATE });
    const block = `Origin: Exiled Royal\nAppearance: ${PROSE}`;
    assert.ok(!block.includes(INTIMATE), 'precondition: it is not in the memo text');

    const html = blockToItems('ORIGIN', block).join('');
    assert.ok(html.includes('Explicit paragraph'), 'the player still sees it on screen');
    assert.ok(html.includes('rt-card-prose-nsfw'));
});

test('no intimate prose committed means no intimate row', () => {
    withCommittedOrigin({ appearanceProse: PROSE });
    const html = blockToItems('ORIGIN', `Appearance: ${PROSE}`).join('');
    assert.ok(!html.includes('rt-card-prose-nsfw'));
    assert.ok(!html.includes('Intimate:'));
});

test('a pre-prose campaign still renders its descriptor list', () => {
    // Old committed profiles have no appearanceProse; buildOriginMemoBlock falls
    // back to the ";"-joined list and the card must not swallow it.
    withCommittedOrigin({ appearance: { skin: 'Bronze scales' } });
    const legacy = 'Appearance: Skin / Body Color: Bronze scales; Height: 2.0 m';
    const html = blockToItems('ORIGIN', legacy).join('');
    assert.ok(html.includes('Bronze scales'));
    assert.ok(html.includes('2.0 m'), 'the whole list survives, not just the first pair');
});

test('an ORIGIN block with no appearance line renders unchanged', () => {
    withCommittedOrigin({ intimateProse: INTIMATE });
    const html = blockToItems('ORIGIN', 'Origin: Exiled Royal\nRace: Human').join('');
    assert.ok(html.includes('Exiled Royal') && html.includes('Human'));
    assert.ok(!html.includes('Explicit paragraph'), 'intimate prose hangs off the appearance line only');
});
