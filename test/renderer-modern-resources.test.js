/**
 * Tests for modern resource-pool rendering in [CHARACTER]: foundation resource
 * lines ("Mana: 20/30") must render as recolorable bars, while unknown labels
 * keep the generic highlight fallback. Chat resolution rides RT.currentChatId
 * (the test SillyTavern stub has no chatId).
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLineInEntityContext } from '../renderer.js';
import { RT } from '../shared-state.js';

function seedModernChat() {
    RT.currentChatId = 'modern-chat';
    setSettings({
        chatStates: {
            'modern-chat': {
                campaignMode: 'modern',
                foundation: {
                    POWER_SYSTEM: {
                        resources: [
                            { id: 'stamina', name: 'Stamina', description: 'physical pool' },
                            { id: 'mana', name: 'Mana', description: 'arcane pool' },
                        ],
                    },
                },
            },
        },
    });
}

test('foundation resource line renders as an hp bar with a recolor id', () => {
    seedModernChat();
    const html = renderLineInEntityContext('CHARACTER', 'Mana: 20/30', 'Hero', 'Mana: 20/30');
    assert.ok(html.includes('rt-hp-bar'), 'bar markup present');
    assert.ok(html.includes('data-recolor-id="CHARACTER:Hero:Mana"'), 'recolorable per resource');
    RT.currentChatId = null;
});

test('resource match is case-insensitive and requires an X/Y value', () => {
    seedModernChat();
    const bar = renderLineInEntityContext('CHARACTER', 'stamina: 12/40', 'Hero', 'stamina: 12/40');
    assert.ok(bar.includes('rt-hp-bar'), 'lowercase label still matches');
    const noPool = renderLineInEntityContext('CHARACTER', 'Mana: depleted', 'Hero', 'Mana: depleted');
    assert.ok(!noPool.includes('rt-hp-bar'), 'non-X/Y value falls through to highlight');
    RT.currentChatId = null;
});

test('non-resource labels and D&D chats keep the generic fallback', () => {
    seedModernChat();
    const unknown = renderLineInEntityContext('CHARACTER', 'Reputation: 5/10', 'Hero', 'Reputation: 5/10');
    assert.ok(!unknown.includes('rt-hp-bar'), 'unknown label is not a resource bar');
    RT.currentChatId = null;

    setSettings({ chatStates: {} });
    const dnd = renderLineInEntityContext('CHARACTER', 'Mana: 20/30', 'Hero', 'Mana: 20/30');
    assert.ok(!dnd.includes('rt-hp-bar'), 'no foundation → no resource bar');
});

test('foundation resources shadowing stock D&D labels still render as bars', () => {
    RT.currentChatId = 'modern-chat';
    setSettings({
        chatStates: {
            'modern-chat': {
                campaignMode: 'modern',
                foundation: {
                    POWER_SYSTEM: {
                        resources: [{ id: 'status', name: 'Status', description: 'a pool that collides with a stock rule key' }],
                    },
                },
            },
        },
    });
    const bar = renderLineInEntityContext('CHARACTER', 'Status: 5/10', 'Hero', 'Status: 5/10');
    assert.ok(bar.includes('rt-hp-bar'), 'resource wins over the stock pills rule in a Modern chat');
    const pills = renderLineInEntityContext('CHARACTER', 'Status: Poisoned (2h)', 'Hero', 'Status: Poisoned (2h)');
    assert.ok(!pills.includes('rt-hp-bar'), 'non-X/Y values still fall through to the stock rule');
    RT.currentChatId = null;
});
