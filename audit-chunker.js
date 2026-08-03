/**
 * Audit chunker — partitions a chat log into token-budgeted chunks for the
 * sequential audit flows (State Tracker chunked audit, Lorebook Agent history
 * audit). Pure module: no DOM, no SillyTavern context access.
 *
 * Imports: memo-processor.js, cyoa.js (stripChoiceBlock)
 * Imported by: index.js, router.js, test/audit-chunker.test.js
 */

import { estimateTokens, cleanToolCallMessage } from './memo-processor.js';
import { stripChoiceBlock } from './cyoa.js';

/**
 * Formats one chat message as a "Player: ..." / "Narrator: ..." audit line, or
 * returns null when the message must be excluded from audit context. Filtering
 * is the union of the state-pass chat log and getNarrativeBlocks: system
 * messages, hidden messages (unless includeHidden), summary messages, and
 * tool-call payloads are dropped; thinking/tool-UI XML blocks are stripped.
 * @param {any} msg
 * @param {boolean} [includeHidden]
 * @returns {string|null}
 */
export function formatAuditMessage(msg, includeHidden = false) {
    if (!msg) return null;
    if (msg.is_system) return null;
    if (!includeHidden && msg.is_hidden) return null;

    let mes = (msg.mes || msg.content || '').trim();
    if (!mes) return null;
    if (mes.startsWith('[Summary') || mes.startsWith('(Summary') || mes.includes('Summary of past events:')) return null;
    if (msg.extra?.summary || msg.extra?.is_summary || msg.extra?.summary_data) return null;

    // Tool-call payloads carry no narrative state
    const cleaned = cleanToolCallMessage(mes);
    if (cleaned === null) return null;
    mes = cleaned;

    // Strip tool call & thinking UI (XML-tag variants)
    mes = mes.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, '');
    mes = mes.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '');
    mes = mes.replace(/<thought\b[^>]*>([\s\S]*?)<\/thought>/gi, '');
    mes = mes.replace(/<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi, '');
    mes = mes.replace(/<reasoning\b[^>]*>([\s\S]*?)<\/reasoning>/gi, '');
    mes = mes.replace(/<think\b[^>]*>([\s\S]*?)<\/think>/gi, '');

    // CYOA choices are UI data the narrator happens to write inline, not events
    // that occurred — an auditor reading them back would treat offered options as
    // things the player did.
    mes = stripChoiceBlock(mes);

    const extraReasoning = msg.extra?.reasoning;
    if (extraReasoning && typeof extraReasoning === 'string' && mes.includes(extraReasoning)) {
        mes = mes.replace(extraReasoning, '');
    }

    mes = mes.trim();
    if (!mes) return null;

    const name = msg.is_user ? 'Player' : (msg.name || 'Narrator');
    return `${name}: ${mes}`;
}

/**
 * Partitions a chat array into sequential token-budgeted chunks. Chunks split
 * on message boundaries only — a single message that alone exceeds the budget
 * becomes its own oversized chunk (warned, never split mid-message).
 * @param {any[]} chat
 * @param {number} budgetTokens
 * @param {{ includeHidden?: boolean }} [opts]
 * @returns {Array<{ text: string, startIndex: number, endIndex: number, messageCount: number, tokens: number }>}
 */
export function buildAuditChunks(chat, budgetTokens, opts = {}) {
    if (!chat || chat.length === 0) return [];
    const budget = Math.max(1, budgetTokens || 0);

    const chunks = [];
    let lines = [];
    let startIndex = -1;
    let endIndex = -1;
    let tokens = 0;

    const flush = () => {
        if (lines.length === 0) return;
        chunks.push({
            text: lines.join('\n\n'),
            startIndex,
            endIndex,
            messageCount: lines.length,
            tokens,
        });
        lines = [];
        startIndex = -1;
        endIndex = -1;
        tokens = 0;
    };

    for (let i = 0; i < chat.length; i++) {
        const line = formatAuditMessage(chat[i], !!opts.includeHidden);
        if (line === null) continue;

        // +2 covers the "\n\n" separator between joined lines
        const cost = estimateTokens(line) + (lines.length > 0 ? estimateTokens('\n\n') : 0);
        if (lines.length > 0 && tokens + cost > budget) flush();

        if (lines.length === 0 && estimateTokens(line) > budget) {
            console.warn(`[RPG Tracker] Audit chunker: message ${i} alone exceeds the ${budget}-token budget (~${estimateTokens(line)} tokens); emitting as an oversized chunk.`);
        }

        if (lines.length === 0) startIndex = i;
        lines.push(line);
        endIndex = i;
        tokens += cost;
    }
    flush();

    return chunks;
}
