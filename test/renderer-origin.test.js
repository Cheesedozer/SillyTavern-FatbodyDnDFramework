/**
 * Tests for the [ORIGIN] HUD card (renderer.js `case 'ORIGIN'`).
 *
 * The block is the player-facing card AND the narrator's always-on context, so
 * everything in it rides every turn. The appearance line is therefore a short
 * summary given full-width prose treatment rather than a squeezed kv value, and
 * intimate descriptors never appear on the card at all — they exist only in the
 * keyword-triggered lorebook entry. Those two are the invariants worth
 * protecting here.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockToItems } from '../renderer.js';
import { RT } from '../shared-state.js';

const SUMMARY = 'She carries herself like the court she lost, all straight spine and level grey eyes.';
const INTIMATE = 'Explicit paragraph that belongs in the lorebook entry and nowhere else.';

/** Seeds a committed origin on a known chat id and points the renderer at it. */
function withCommittedOrigin(committed) {
    RT.currentChatId = 'chat-origin-test';
    setSettings({ chatStates: { 'chat-origin-test': { origin: { committed, nsfw: true } } } });
}

test('the appearance line renders as prose, not a squeezed kv value', () => {
    withCommittedOrigin({ appearanceSummary: SUMMARY });
    const html = blockToItems('ORIGIN', `Origin: Exiled Royal\nAppearance: ${SUMMARY}\nRace: Human`).join('');

    assert.ok(html.includes('rt-card-prose'), 'gets the full-width prose treatment');
    assert.ok(html.includes('straight spine'), 'the sentence survives intact');
    // The other lines must keep the generic kv rendering.
    assert.ok(html.includes('rt-card-kv'), 'non-appearance lines still render as kv rows');
    assert.ok(html.includes('Exiled Royal'));
});

test('nothing intimate reaches the card, even on a campaign that stored prose', () => {
    // Campaigns committed while intimateProse was still generated keep the field.
    // Nothing reads it any more, so it must not surface on screen either.
    withCommittedOrigin({ appearanceSummary: SUMMARY, intimateProse: INTIMATE });
    const html = blockToItems('ORIGIN', `Origin: Exiled Royal\nAppearance: ${SUMMARY}`).join('');

    assert.ok(!html.includes('Explicit paragraph'));
    assert.ok(!html.includes('Intimate:'));
});

test('a pre-summary campaign still renders its descriptor list', () => {
    // Old committed profiles have no appearanceSummary; buildOriginMemoBlock falls
    // back to the ";"-joined list and the card must not swallow it.
    withCommittedOrigin({ appearance: { skin: 'Bronze scales' } });
    const legacy = 'Appearance: Skin / Body Color: Bronze scales; Height: 2.0 m';
    const html = blockToItems('ORIGIN', legacy).join('');
    assert.ok(html.includes('Bronze scales'));
    assert.ok(html.includes('2.0 m'), 'the whole list survives, not just the first pair');
});

test('an ORIGIN block with no appearance line renders unchanged', () => {
    withCommittedOrigin({ appearanceSummary: SUMMARY });
    const html = blockToItems('ORIGIN', 'Origin: Exiled Royal\nRace: Human').join('');
    assert.ok(html.includes('Exiled Royal') && html.includes('Human'));
    assert.ok(!html.includes('rt-card-prose'), 'no prose row without an appearance line');
});
