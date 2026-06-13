/**
 * Tests for audit-chunker.js — token-budgeted chat partitioning for the
 * sequential audit flows.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAuditMessage, buildAuditChunks } from '../audit-chunker.js';
import { estimateTokens } from '../memo-processor.js';

const user = (mes, extra = {}) => ({ is_user: true, mes, ...extra });
const ai = (mes, extra = {}) => ({ is_user: false, name: 'Narrator', mes, ...extra });

// ── formatAuditMessage ──────────────────────────────────────────────────────

test('formatAuditMessage labels user and AI messages', () => {
    assert.equal(formatAuditMessage(user('I attack')), 'Player: I attack');
    assert.equal(formatAuditMessage(ai('The orc dodges')), 'Narrator: The orc dodges');
    assert.equal(formatAuditMessage({ is_user: false, mes: 'Hi' }), 'Narrator: Hi');
});

test('formatAuditMessage drops system, hidden, empty, and summary messages', () => {
    assert.equal(formatAuditMessage({ is_system: true, mes: 'sys' }), null);
    assert.equal(formatAuditMessage(ai('secret', { is_hidden: true })), null);
    assert.equal(formatAuditMessage(ai('secret', { is_hidden: true }), true), 'Narrator: secret');
    assert.equal(formatAuditMessage(ai('')), null);
    assert.equal(formatAuditMessage(ai('[Summary] stuff happened')), null);
    assert.equal(formatAuditMessage(ai('ok', { extra: { is_summary: true } })), null);
});

test('formatAuditMessage drops tool-call payloads', () => {
    assert.equal(formatAuditMessage(ai('[{"name":"roll_dice","result":12}]')), null);
});

test('formatAuditMessage strips thinking/tool XML blocks', () => {
    const msg = ai('<think>hmm</think>The door opens.<details>tool ui</details>');
    assert.equal(formatAuditMessage(msg), 'Narrator: The door opens.');
});

test('formatAuditMessage returns null when stripping leaves nothing', () => {
    assert.equal(formatAuditMessage(ai('<thinking>only thoughts</thinking>')), null);
});

// ── buildAuditChunks ────────────────────────────────────────────────────────

test('buildAuditChunks returns empty for empty/missing chat', () => {
    assert.deepEqual(buildAuditChunks([], 100), []);
    assert.deepEqual(buildAuditChunks(null, 100), []);
});

test('buildAuditChunks puts everything in one chunk when it fits', () => {
    const chat = [user('Hello'), ai('Welcome, traveler')];
    const chunks = buildAuditChunks(chat, 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, 'Player: Hello\n\nNarrator: Welcome, traveler');
    assert.equal(chunks[0].startIndex, 0);
    assert.equal(chunks[0].endIndex, 1);
    assert.equal(chunks[0].messageCount, 2);
});

test('buildAuditChunks splits on message boundaries within budget', () => {
    const mes = 'x'.repeat(100);              // ~39 tokens per formatted line
    const chat = [user(mes), ai(mes), user(mes), ai(mes)];
    const perLine = estimateTokens(`Player: ${mes}`);
    const chunks = buildAuditChunks(chat, perLine * 2 + 2);   // fits 2 lines per chunk
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].messageCount, 2);
    assert.equal(chunks[1].messageCount, 2);
    assert.equal(chunks[0].startIndex, 0);
    assert.equal(chunks[0].endIndex, 1);
    assert.equal(chunks[1].startIndex, 2);
    assert.equal(chunks[1].endIndex, 3);
    assert.ok(chunks[0].tokens <= perLine * 2 + 2);
    // No message lost or split: rejoining the chunks restores every line
    const all = chunks.map(c => c.text).join('\n\n');
    assert.equal(all.split('\n\n').length, 4);
});

test('buildAuditChunks skips filtered messages without breaking indices', () => {
    const chat = [
        { is_system: true, mes: 'sys' },
        user('Hi'),
        ai('thinking only', { is_hidden: true }),
        ai('Hello there'),
    ];
    const chunks = buildAuditChunks(chat, 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].startIndex, 1);
    assert.equal(chunks[0].endIndex, 3);
    assert.equal(chunks[0].messageCount, 2);
});

test('buildAuditChunks emits an oversized single message as its own chunk', () => {
    const big = 'y'.repeat(2000);             // far over a 100-token budget
    const chat = [user('small'), ai(big), user('small again')];
    const chunks = buildAuditChunks(chat, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[1].messageCount, 1);
    assert.ok(chunks[1].tokens > 100);
    assert.match(chunks[1].text, /^Narrator: y+$/);
});
