/**
 * memo-processor.js — Fatbody D&D Framework
 * Pure text/logic utilities for memo management and state model context assembly.
 * Handles [TAG]...[/TAG] block merging, deduplication, delta computation,
 * lorebook assembly, and quest text serialization.
 * No DOM access. No module-level side effects.
 *
 * Imports: state-manager.js, constants.js
 * Imported by: index.js, renderer.js, quests.js
 */

import { getSettings } from './state-manager.js';
import { DEFAULT_STOCK_PROMPTS } from './constants.js';
import { MEMO_MODULES } from './module-registry.js';

/**
 * The set of memo block tags we recognize: the stock modules plus any custom
 * field tags the user defined. Used by the tolerant merge recovery so stray
 * brackets in narrative text (e.g. [2/6], [QUEST ACCEPTED]) are never mistaken
 * for block openers.
 */
function getKnownMemoTags(settings) {
    const tags = new Set(MEMO_MODULES.map(m => m.tag.toUpperCase()));
    for (const f of (settings.customFields || [])) {
        if (f && f.tag) tags.add(String(f.tag).toUpperCase());
    }
    return tags;
}

// ── Token budgeting ─────────────────────────────────────────────────────────────

/**
 * Chars-per-token heuristic. Matches the memo token estimate in index.js:1971.
 * A cheap synchronous estimate is preferred over ST's async getTokenCountAsync in
 * the generation hot path: it never throws, needs no worker/network, and the
 * interceptor reserves generous headroom so approximate is good enough.
 */
export const TOKEN_CHARS_PER_TOKEN = 2.62;

/** Estimated token cost of a string. */
export function estimateTokens(text) {
    return Math.ceil((text ? text.length : 0) / TOKEN_CHARS_PER_TOKEN);
}

/**
 * Memo block tags that carry the most generation-critical live state; kept first
 * when the memo must be trimmed to fit the context budget. Everything else
 * (e.g. INVENTORY, custom-field blocks, loose narrative text) is shed first.
 * [TIME] leads because it is tiny and anchors quest deadlines.
 */
const MEMO_TRIM_PRIORITY = ['TIME', 'CHARACTER', 'PARTY', 'COMBAT', 'XP', 'ABILITIES', 'SPELLS'];
const MEMO_TRIM_MARKER = '…(state memo trimmed to fit the context budget)\n';

/**
 * Trims a state memo so its estimated token cost fits within maxTokens, dropping
 * the lowest-value [TAG]...[/TAG] blocks first and preserving the highest-priority
 * ones (always trying to keep [TIME]). Any leading preamble before the first block
 * (e.g. an injected "### STATE MEMO" header) is preserved. Falls back to a tail
 * char-slice when the memo has no parseable blocks. Returns the memo unchanged when
 * it already fits.
 * @param {string} memo
 * @param {number} maxTokens
 */
export function trimMemoToBudget(memo, maxTokens) {
    if (!memo) return memo || '';
    if (estimateTokens(memo) <= maxTokens) return memo;

    const limitChars = Math.max(0, Math.floor(maxTokens * TOKEN_CHARS_PER_TOKEN));

    // Parse top-level [TAG]...[/TAG] blocks in document order.
    const blockRe = /\[([A-Z_]+)\]([\s\S]*?)\[\/\1\]/gi;
    const blocks = [];
    let m;
    while ((m = blockRe.exec(memo)) !== null) {
        blocks.push({ tag: m[1].toUpperCase(), text: m[0], order: m.index });
    }

    // No structured blocks — keep the tail (most-recent content) with a marker.
    if (blocks.length === 0) {
        const keep = Math.max(0, limitChars - MEMO_TRIM_MARKER.length);
        return MEMO_TRIM_MARKER + memo.slice(Math.max(0, memo.length - keep));
    }

    const preamble = memo.slice(0, blocks[0].order);   // e.g. the injected header
    let budget = limitChars - MEMO_TRIM_MARKER.length - preamble.length;

    const rank = tag => {
        const i = MEMO_TRIM_PRIORITY.indexOf(tag);
        return i === -1 ? MEMO_TRIM_PRIORITY.length : i;   // unknown/custom = lowest
    };
    // Decide inclusion by priority (then document order); keep blocks that still fit.
    const byPriority = [...blocks].sort((a, b) => rank(a.tag) - rank(b.tag) || a.order - b.order);
    const kept = new Set();
    for (const b of byPriority) {
        const cost = b.text.length + 2;   // + "\n\n" separator
        if (cost <= budget) { kept.add(b); budget -= cost; }
    }

    // Reassemble in original document order; mark that content was dropped.
    const body = blocks.filter(b => kept.has(b)).map(b => b.text).join('\n\n');
    return MEMO_TRIM_MARKER + preamble + body;
}

/**
 * Fraction of the model's context window held back for the reply (plus slack for
 * the approximate token estimate). The interceptor never lets its injected context
 * consume this reserve, so a large restored state memo can't crowd the output to
 * empty — the root cause of the intermittent blank replies under Chat-Linked Mode.
 */
export const OUTPUT_HEADROOM_FRAC = 0.20;
/** Below this remaining budget, skip the memo entirely rather than ship a stub. */
const MIN_MEMO_TOKENS = 200;

/**
 * Fits the priority-ordered injection items into the remaining context budget.
 * Items are emitted in their original array order, but inclusion is decided by
 * `tier` (lower = kept first). Tier 0 (RNG) is always kept; the trimmable memo
 * item is block-trimmed (trimMemoToBudget) as a last resort before being dropped.
 *
 * @param {object} p
 * @param {number} p.contextSize  max context window in tokens (from ST interceptor)
 * @param {number} p.chatTokens   estimated tokens already in the chat array
 * @param {{name:string,text:string,tier:number,trimmable?:boolean}[]} p.items  output-ordered
 * @returns {{injections:string, dropped:string[], trimmed:boolean}}
 */
export function budgetInjections({ contextSize, chatTokens, items }) {
    const dropped = [];
    let trimmed = false;

    // No usable budget signal → preserve legacy behavior (inject everything).
    if (!contextSize || contextSize <= 0) {
        return { injections: items.map(i => i.text || '').join(''), dropped, trimmed };
    }

    const reserved = Math.ceil(contextSize * OUTPUT_HEADROOM_FRAC);
    let budget = contextSize - reserved - chatTokens;

    // Decide inclusion in priority order; remember kept text by original index.
    const order = items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it.text)
        .sort((a, b) => (a.it.tier - b.it.tier) || (a.i - b.i));

    const keep = new Map();
    for (const { it, i } of order) {
        const cost = estimateTokens(it.text);
        if (it.tier === 0 || cost <= budget) {        // tier 0 (RNG) is never dropped
            keep.set(i, it.text);
            budget -= cost;
        } else if (it.trimmable && budget >= MIN_MEMO_TOKENS) {
            const t = trimMemoToBudget(it.text, budget);
            keep.set(i, t);
            budget -= estimateTokens(t);
            trimmed = true;
        } else {
            dropped.push(it.name);
        }
    }

    const injections = items.map((it, i) => keep.get(i) || '').join('');
    return { injections, dropped, trimmed };
}

// ── String utilities ──────────────────────────────────────────────────────────

/**
 * Computes NPC mood for a quest: -1.0 (very pleased) up to 1.0+ (very frustrated).
 * Canonical single source — re-exported by quests.js (which depends on this module, so
 * keeping the function here avoids a circular import). A low coefficient is "patient",
 * a high one is "volatile".
 * @param {object} quest
 * @param {string} currentTime
 * @returns {number} Mood value from -1 (pleased) upward (unbounded)
 */
export function computeFrustration(quest, currentTime) {
    if (quest.status !== 'active') return 0;
    const accepted = parseInWorldTime(quest.accepted_time);
    const current  = parseInWorldTime(currentTime);
    if (!accepted || !current) return 0;

    const elapsed = current - accepted;
    if (elapsed <= 0) return -1; // Just accepted — NPC is optimistic

    const coeff = Math.max(0.1, quest.frustration_coefficient ?? 1.0);

    if (!quest.deadline_time || String(quest.deadline_time).toLowerCase() === 'none') {
        // No deadline: NPC remains neutral regardless of time elapsed
        return 0;
    }

    const deadline = parseInWorldTime(quest.deadline_time);
    const window   = deadline - accepted;
    if (window <= 0) return 1;

    const ratio = elapsed / window;
    if (ratio <= 1.0) {
        // Before or at deadline: -1 (Very Pleased) to 0 (Neutral)
        return Math.pow(ratio, 1 / coeff) - 1;
    } else {
        // After deadline: 0 (Neutral) scaling upwards
        return (ratio - 1) * coeff;
    }
}

/**
 * Returns the human-readable mood label and color for a quest.
 * @param {object} quest
 * @param {string} currentTime
 * @param {boolean} showFrustration
 * @returns {{ label: string, color: string, value: number }}
 */
export function getQuestMood(quest, currentTime, showFrustration) {
    const frust = computeFrustration(quest, currentTime);
    let color = '#00cc77';
    let label = 'Pleased';
    if (showFrustration) {
        if (frust <= -0.5)      { color = '#00cc77'; label = 'Very Pleased'; }
        else if (frust <= -0.1) { color = '#44dd88'; label = 'Pleased'; }
        else if (frust <=  0.1) { color = '#aaaaaa'; label = 'Neutral'; }
        else if (frust <=  0.5) { color = '#ffcc00'; label = 'Mildly Frustrated'; }
        else if (frust <=  1.0) { color = '#ff8800'; label = 'Frustrated'; }
        else if (frust <=  1.5) { color = '#ff4400'; label = 'Very Frustrated'; }
        else                    { color = '#ff1111'; label = 'Furious'; }
    } else {
        if (frust <= 0)         { color = '#00cc77'; label = 'Ahead of Schedule'; }
        else if (frust <= 0.5)  { color = '#ffcc00'; label = 'On Time'; }
        else if (frust <= 1.0)  { color = '#ff8800'; label = 'Near Deadline'; }
        else                    { color = '#ff1111'; label = 'Overdue'; }
    }
    return { label, color, value: frust };
}

export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wraps parenthetical groups in a highlight span. */
export function highlightParens(text) {
    return text.replace(/\(([^)]+)\)/g, '<span class="rt-paren-highlight">($1)</span>');
}

/**
 * Converts in-world time strings to a comparable numeric value (minutes since Day 1, 00:00).
 * Expected formats: "08:00 AM, Day 1", "Day 4", "10:00 PM"
 * @param {string} str 
 * @returns {number}
 */
export function parseInWorldTime(str) {
    if (!str) return 0;
    const dayMatch = str.match(/(?:Day|D)\s*(\d+)/i);
    const timeMatch = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    
    let d = dayMatch ? parseInt(dayMatch[1], 10) : 1;
    let h = 0, m = 0;
    
    if (timeMatch) {
        h = parseInt(timeMatch[1], 10);
        m = parseInt(timeMatch[2], 10);
        if (timeMatch[3]) {
            const mer = timeMatch[3].toUpperCase();
            if (mer === 'AM' && h === 12) h = 0;
            if (mer === 'PM' && h !== 12) h += 12;
        }
    }
    
    if (!dayMatch && !timeMatch) return 0;
    return (d - 1) * 1440 + h * 60 + m;
}

/**
 * Formats a minute difference into a human-readable "X days Y hours Z minutes" string.
 * @param {number} diffMinutes 
 * @param {boolean} isFuture - If true, returns "X left", else "X ago"
 * @returns {string}
 */
export function formatTimeDiff(diffMinutes, isFuture = false) {
    if (diffMinutes === 0) return isFuture ? "due now" : "just now";
    const absDiff = Math.abs(diffMinutes);
    const dDays = Math.floor(absDiff / 1440);
    const dH = Math.floor((absDiff % 1440) / 60);
    const dM = absDiff % 60;
    
    let parts = [];
    if (dDays > 0) parts.push(`${dDays} day${dDays > 1 ? 's' : ''}`);
    if (dH > 0) parts.push(`${dH} hour${dH > 1 ? 's' : ''}`);
    if (dM > 0) parts.push(`${dM} minute${dM > 1 ? 's' : ''}`);
    
    if (parts.length === 0) return isFuture ? "due now" : "just now";
    
    const timeStr = parts.join(' ');
    return isFuture ? `${timeStr} left` : `${timeStr} ago`;
}

// ── Memo deduplication ────────────────────────────────────────────────────────

/**
 * Sanitizes a memo string to ensure no duplicate [TAG] sections exist.
 * If duplicates are found, the last one in the string is preserved.
 */
export function deduplicateMemo(memo) {
    if (!memo) return "";
    const settings = getSettings();

    const tagRegex = /\[([A-Z_]+)\]/gi;
    const tags = new Set();
    let match;
    while ((match = tagRegex.exec(memo)) !== null) {
        tags.add(match[1].toUpperCase());
    }

    let cleanedMemo = memo;
    for (const tag of tags) {
        const escapedTag = escapeRegex(tag);
        const pattern = new RegExp(`\\[${escapedTag}\\][\\s\\S]*?\\[\\/${escapedTag}\\]`, 'gi');
        const blocks = [...memo.matchAll(pattern)];

        if (blocks.length > 1) {
            if (settings.debugMode) console.warn(`[RPG Tracker] Deduplication: Found ${blocks.length} instances of [${tag}]. Keeping the last one.`);
            cleanedMemo = cleanedMemo.replace(pattern, "---DEDUP_MARKER---");
            const lastBlock = blocks[blocks.length - 1][0];
            const split = cleanedMemo.split("---DEDUP_MARKER---");
            cleanedMemo = split.join("").trim() + "\n\n" + lastBlock;
        }
    }

    return cleanedMemo.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Memo merge ────────────────────────────────────────────────────────────────

/**
 * Merge partial AI output into the existing memo.
 * Finds all [TAG]...[/TAG] blocks in the AI output and replaces the
 * matching section in the current memo. New sections are appended.
 * If the AI output contains no bracket tags at all, the current memo is preserved.
 */
export function mergeMemo(currentMemo, aiOutput) {
    const settings = getSettings();

    const tagPattern = /\[([^\]\/][^\]]*)\]([\s\S]*?)\[\/\1\]/gi;
    const matches = [...aiOutput.matchAll(tagPattern)];

    // Normalized entry list (preserve document order via source index).
    const entries = matches.map(m => ({ tag: m[1].trim(), content: m[2].trim(), index: m.index }));

    // ── Tolerant recovery ──────────────────────────────────────────────────────
    // A common State Extractor failure is emitting an opening [TAG] with a
    // missing or mismatched closing tag, which the strict regex above drops
    // silently → state drift. Recover any KNOWN block tag that opens but is not
    // part of a well-formed block, treating its content as running until the next
    // known opening tag or end-of-output.
    const knownTags = getKnownMemoTags(settings);
    const consumed = matches.map(m => [m.index, m.index + m[0].length]);
    const isConsumed = (i) => consumed.some(([a, b]) => i >= a && i < b);

    // All openings of recognized tags (strict ones serve as recovery boundaries).
    // The character class excludes '/' so closing tags [/TAG] are never matched.
    const openRe = /\[([^\[\]\/\n]+)\]/g;
    const knownOpenings = [];
    let om;
    while ((om = openRe.exec(aiOutput)) !== null) {
        const t = om[1].trim().toUpperCase();
        if (knownTags.has(t)) knownOpenings.push({ index: om.index, end: om.index + om[0].length, tag: t });
    }
    for (let k = 0; k < knownOpenings.length; k++) {
        const op = knownOpenings[k];
        if (isConsumed(op.index)) continue; // part of a well-formed [TAG]...[/TAG]
        // A malformed QUESTS JSON diff is unsafe to guess — preserve drop behavior.
        if (op.tag === 'QUESTS' && !settings.questLegacyMode) continue;
        const next = knownOpenings.slice(k + 1).find(o => o.index >= op.end);
        const boundary = next ? next.index : aiOutput.length;
        const content = aiOutput.slice(op.end, boundary).trim();
        if (!content) continue; // empty recovery → no-op (no spurious block/removal)
        entries.push({ tag: op.tag, content, index: op.index });
        if (settings.debugMode) console.warn(`[RPG Tracker] mergeMemo: RECOVERED [${op.tag}] (missing/mismatched closing tag).`);
    }

    if (entries.length === 0) {
        console.warn("[RPG Tracker] No valid [TAG]...[/TAG] blocks found in model output — treating as no-change. Output was:", aiOutput);
        return currentMemo;
    }

    entries.sort((a, b) => a.index - b.index);

    if (settings.debugMode) console.log(`[RPG Tracker] mergeMemo: found ${entries.length} tag(s):`, entries.map(e => e.tag));

    let memo = currentMemo;

    for (const entry of entries) {
        const tag = entry.tag;
        const newContent = entry.content;

        // [QUESTS] block — route to appropriate handler based on mode
        if (tag.toUpperCase() === 'QUESTS') {
            const s = getSettings();
            if (s.questLegacyMode) {
                // Legacy: state model wrote the full text block.
                // Let the standard replacement logic below integrate it into the memo string.
                // The memo text is the single source of truth — no separate settings.quests needed.
            } else {
                // Tool mode: state model emits a diff JSON.
                // Apply the diff to our local 'memo' string being built
                memo = mergeQuestUpdates(newContent, memo);
                continue;
            }
        }

        const isRemoval = /^(?:REMOVED|EXPIRED|CLEARED|NONE|END_COMBAT)$/i.test(newContent);

        const escapedTag = escapeRegex(tag);
        const existingPattern = new RegExp(
            `\\s*\\[${escapedTag}\\][\\s\\S]*?\\[\\/${escapedTag}\\]`,
            'i'
        );

        if (settings.debugMode) {
            console.log(`[RPG Tracker] mergeMemo: processing [${tag}], pattern: ${existingPattern}`);
        }

        if (isRemoval) {
            memo = memo.replace(existingPattern, "").trim();
            if (settings.debugMode) console.log(`[RPG Tracker] mergeMemo: [${tag}] REMOVED`);
        } else {
            const fullBlock = `[${tag}]\n${newContent}\n[/${tag}]`;
            const before = memo;
            memo = memo.replace(existingPattern, () => '\n\n' + fullBlock);
            if (memo !== before) {
                if (settings.debugMode) console.log(`[RPG Tracker] mergeMemo: [${tag}] REPLACED`);
            } else {
                memo = memo.trimEnd() + '\n\n' + fullBlock;
                if (settings.debugMode) console.log(`[RPG Tracker] mergeMemo: [${tag}] APPENDED (new section)`);
            }
        }
    }

    const cleaned = memo.replace(/\n{3,}/g, '\n\n').trim();
    return deduplicateMemo(cleaned);
}

/**
 * Applies a constrained {"updates":[...]} diff from the state model.
 * Parses quests from memoText, applies mutations, and returns the updated string.
 * @param {string} jsonText
 * @param {string} [memoText]
 * @returns {string}
 */
export function mergeQuestUpdates(jsonText, memoText = null) {
    const settings = getSettings();
    const target = (memoText !== null) ? memoText : settings.currentMemo;
    const quests = parseQuestsFromMemo(target);
    
    if (!quests.length) return target;

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (e) {
        console.warn('[RPG Tracker] mergeQuestUpdates: invalid JSON in [QUESTS] diff block:', jsonText);
        return target;
    }

    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
    if (!updates.length) return target;

    const mods = settings.syspromptModules || {};
    const isDeadlines = !!mods.questsDeadlines;
    const isFrustration = !!mods.questsFrustration;

    let changed = false;
    for (const update of updates) {
        const quest = quests.find(q => q.id === update.id);
        if (!quest) continue;
        if (quest.status === 'failed') continue;

        if (update.status && ['active', 'completed', 'past deadline', 'failed'].includes(update.status)) {
            let resolvedStatus = update.status;

            // Frustration ON: deadline expiry → 'past deadline', not 'failed' (AI may get this wrong)
            if (isFrustration && resolvedStatus === 'failed' && quest.deadline_time && quest.status === 'active') {
                resolvedStatus = 'past deadline';
            }
            // Deadlines ON, Frustration OFF: 'past deadline' is invalid → promote to 'failed'
            if (isDeadlines && !isFrustration && resolvedStatus === 'past deadline') {
                resolvedStatus = 'failed';
            }

            quest.status = resolvedStatus;
            changed = true;
        }

        if (Array.isArray(update.objectives)) {
            for (const objUpdate of update.objectives) {
                const obj = quest.objectives.find(o => o.id === objUpdate.id);
                if (!obj) continue;
                if (objUpdate.status && ['active', 'completed', 'failed'].includes(objUpdate.status)) {
                    obj.status = objUpdate.status;
                    changed = true;
                }
                if (typeof objUpdate.progress === 'number') {
                    obj.progress = objUpdate.progress;
                    changed = true;
                }
            }
        }
    }

    if (changed) {
        if (settings.debugMode) console.log('[RPG Tracker] mergeQuestUpdates: applied quest state changes.');
        const result = writeQuestsToMemo(quests, target);
        if (memoText === null) {
            SillyTavern.getContext().saveSettingsDebounced();
        }
        return /** @type {string} */ (result);
    }

    return target;
}

/**
 * Writes a quest array into a [QUESTS] block.
 * If memoText is provided, returns the updated string.
 * Otherwise, updates settings.currentMemo directly.
 * @param {any[]} quests
 * @param {string} [memoText]
 * @returns {string|void}
 */
export function writeQuestsToMemo(quests, memoText = null) {
    const settings = getSettings();
    let target = (memoText !== null) ? memoText : settings.currentMemo;

    const tag = 'QUESTS';
    const escapedTag = escapeRegex(tag);
    const pattern = new RegExp(`\\s*\\[${escapedTag}\\][\\s\\S]*?\\[\\/${escapedTag}\\]`, 'i');
    const blockExists = pattern.test(target);

    // Filter out completed quests to save AI context space
    const activeQuests = quests.filter(q => q.status !== 'completed');

    // If no active quests, remove the block if present — never insert an empty one
    if (!activeQuests || !activeQuests.length) {
        const result = blockExists ? target.replace(pattern, '').trim() : target;
        if (memoText !== null) return result;
        settings.currentMemo = result;
        return;
    }

    const content = settings.questLegacyMode
        ? serializeQuestsToText(activeQuests)
        : JSON.stringify(activeQuests, null, 2);

    const block = `\n\n[${tag}]\n${content}\n[/${tag}]`;

    let result;
    if (blockExists) {
        result = target.replace(pattern, block);
    } else {
        result = (target + block).trim();
    }

    if (memoText !== null) return result;
    settings.currentMemo = result;
}

/**
 * @deprecated Use writeQuestsToMemo(quests) instead. Kept for backward compat.
 */
export function syncQuestsToMemo() {
    const settings = getSettings();
    writeQuestsToMemo(settings.quests || []);
}

// ── Legacy quest text format ───────────────────────────────────────────────────

/**
 * Parses the state model's plain-text quest format into settings.quests[].
 * Each quest block starts with "QUEST: <title>" and contains labeled key: value lines.
 * @param {string} text - Content inside [QUESTS]...[/QUESTS]
 * @returns {object[]|null} Array of quest objects, or null on complete parse failure.
 */
export function parseQuestsFromText(text) {
    if (!text || !text.trim()) return [];

    const questBlocks = text.trim().split(/^QUEST:/m);
    const quests = [];

    for (const block of questBlocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n');
        const title = lines[0].trim();
        if (!title) continue;

        /** @param {string} key */
        const getField = (key) => {
            const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi');
            const m = block.match(re);
            return m ? m[1].trim() : null;
        };

        const rawGiver  = getField('GIVER') || '';
        const giverParts = rawGiver.split(' @ ');
        const giverName = giverParts[0]?.trim() || 'Unknown';
        const giverLoc  = giverParts[1]?.trim() || 'Unknown';

        const rawCoeff = getField('FRUSTRATION_COEFF');
        const coeff = rawCoeff ? parseFloat(rawCoeff) : null;

        // Objectives: OBJ_ACTIVE, OBJ_COMPLETED/OBJ_DONE, or OBJ_FAILED lines
        // Robust: handles both one-per-line and comma-separated objectives on a single line
        const objectives = [];
        const objRe = /^\s*(OBJ_ACTIVE|OBJ_DONE|OBJ_COMPLETED|OBJ_FAILED):\s*(.+)$/gmi;
        // Read OBJ_TOTAL lines into a map keyed by order index for assignment below
        const objTotals = [];
        const objTotalRe = /^\s*OBJ_TOTAL:\s*(\d+)$/gmi;
        let objTotalMatch;
        while ((objTotalMatch = objTotalRe.exec(block)) !== null) {
            objTotals.push(parseInt(objTotalMatch[1], 10));
        }
        let objMatch;
        let objIdx = 0;
        while ((objMatch = objRe.exec(block)) !== null) {
            const tag = objMatch[1].toUpperCase();
            const isDone = (tag === 'OBJ_DONE' || tag === 'OBJ_COMPLETED');
            const isFailed = (tag === 'OBJ_FAILED');
            const rawContent = objMatch[2].trim();

            // Detect comma-separated objectives: "Obj one (required), Obj two (optional)"
            // A comma-separated list will have "(required)" or "(optional)" mid-string
            const hasInlineMarkers = /\)\s*,/.test(rawContent);

            const parts = hasInlineMarkers
                ? rawContent.split(/,\s*(?=\S)/)   // split on ", " boundaries
                : [rawContent];

            for (const part of parts) {
                const p = part.trim();
                if (!p) continue;
                const isOptional = /\(optional\)$/i.test(p);
                // Strip (required)/(optional) suffix
                let objText = p.replace(/\s*\((required|optional)\)\s*$/i, '').trim();
                // Extract inline [progress/total] counter, e.g. "Collect mushrooms [4/6]"
                let progress = undefined;
                let total = objTotals[objIdx] ?? undefined;
                const progressMatch = objText.match(/\[(\d+)\/(\d+)\]\s*$/);
                if (progressMatch) {
                    progress = parseInt(progressMatch[1], 10);
                    total    = parseInt(progressMatch[2], 10);
                    objText  = objText.replace(/\s*\[\d+\/\d+\]\s*$/, '').trim();
                }
                if (!objText) continue;
                const entry = {
                    id:       `obj_${objIdx++}`,
                    text:     objText,
                    required: !isOptional,
                    status:   isDone ? 'completed' : (isFailed ? 'failed' : 'active'),
                };
                if (total != null)    entry.total    = total;
                if (progress != null) entry.progress = progress;
                objectives.push(entry);
            }
        }

        // Rewards: REWARD lines
        const rewards = [];
        const rewardRe = /^\s*REWARD:\s*(.+)$/gmi;
        let rewardMatch;
        while ((rewardMatch = rewardRe.exec(block)) !== null) {
            rewards.push(rewardMatch[1].trim());
        }

        quests.push({
            id:                     getField('ID') || `quest_${Date.now()}_${quests.length}`,
            title,
            status:                 getField('STATUS') || 'active',
            giver_name:             giverName,
            giver_location:         giverLoc,
            accepted_time:          getField('ACCEPTED'),
            deadline_time:          getField('DEADLINE'),
            difficulty:             getField('DIFFICULTY'),
            frustration_coefficient: coeff !== null && !isNaN(coeff) ? coeff : undefined,
            objectives,
            rewards,
        });
    }

    return quests;
}

/**
 * Converts settings.quests[] back to the plain-text format for the Raw View.
 * @param {object[]} quests
 * @returns {string}
 */
export function serializeQuestsToText(quests) {
    if (!quests || !quests.length) return '';

    return quests.map(q => {
        const lines = [`QUEST: ${q.title}`];
        lines.push(`  ID: ${q.id}`);
        lines.push(`  STATUS: ${q.status || 'active'}`);
        lines.push(`  GIVER: ${q.giver_name} @ ${q.giver_location}`);
        if (q.accepted_time)          lines.push(`  ACCEPTED: ${q.accepted_time}`);
        if (q.deadline_time)          lines.push(`  DEADLINE: ${q.deadline_time}`);
        if (q.difficulty)             lines.push(`  DIFFICULTY: ${q.difficulty}`);
        if (q.frustration_coefficient != null)
                                      lines.push(`  FRUSTRATION_COEFF: ${q.frustration_coefficient}`);

        // Inject human-readable mood for the AI narrator
        if (q.status === 'active' || q.status === 'past deadline') {
            const settings = getSettings();
            const showFrustration = !!settings.syspromptModules?.questsFrustration;
            const currentTime = settings.currentMemo?.match(/\[TIME\]([\s\S]*?)\[\/TIME\]/i)?.[1]?.trim() || "";
            const { label } = getQuestMood(q, currentTime, showFrustration);
            lines.push(`  MOOD: ${label}`);
        }
        for (const obj of (q.objectives || [])) {
            let tag = 'OBJ_ACTIVE';
            if (obj.status === 'completed') tag = 'OBJ_COMPLETED';
            else if (obj.status === 'failed') tag = 'OBJ_FAILED';
            
            const suffix = obj.required ? '(required)' : '(optional)';
            const progressStr = (typeof obj.progress === 'number' && typeof obj.total === 'number')
                ? ` [${obj.progress}/${obj.total}]` : '';
            lines.push(`  ${tag}: ${obj.text}${progressStr} ${suffix}`);
            if (obj.total != null) lines.push(`  OBJ_TOTAL: ${obj.total}`);
        }
        for (const r of (q.rewards || [])) {
            lines.push(`  REWARD: ${r}`);
        }
        return lines.join('\n');
    }).join('\n\n');
}

/**
 * Parses the [QUESTS] block from a text string and returns a quest array.
 * Pure function — no side effects.
 * @param {string} memoText
 * @returns {any[]}
 */
export function parseQuestsFromMemo(memoText) {
    const match = (memoText || '').match(/\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i);
    if (!match) return [];

    const content = match[1].trim();

    // Auto-detect format: plain-text starts with QUEST:
    if (content.startsWith('QUEST:')) {
        return parseQuestsFromText(content);
    } else {
        try {
            const parsed = JSON.parse(content);
            const quests = Array.isArray(parsed) ? parsed : (parsed.quests || []);
            return quests;
        } catch (e) {
            console.warn('[RPG Tracker] parseQuestsFromMemo: Failed to parse [QUESTS] as JSON:', e);
            return [];
        }
    }
}

/**
 * Parses the [QUESTS] block from a text string and updates settings.quests.
 * Used when the user manually edits the Raw View.
 * @param {string} memoText
 */
export function syncQuestsFromMemo(memoText) {
    const settings = getSettings();
    const quests = parseQuestsFromMemo(memoText);
    const existingCompleted = (settings.quests || []).filter(q => q.status === 'completed');
    
    if (quests.length === 0) {
        const match = (memoText || '').match(/\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i);
        if (!match && settings.quests && settings.quests.length > 0) {
            if (settings.quests.length !== existingCompleted.length && settings.debugMode) {
                console.log('[RPG Tracker] syncQuestsFromMemo: active quests cleared because [QUESTS] block was removed.');
            }
            settings.quests = existingCompleted;
        } else if (settings.quests && settings.quests.length > 0) {
            settings.quests = existingCompleted;
        }
        return;
    }

    // Merge newly parsed quests (which are active/failed) with existing completed ones
    const newIds = new Set(quests.map(q => q.id));
    const merged = [...quests];
    for (const eq of existingCompleted) {
        if (!newIds.has(eq.id)) {
            merged.push(eq);
        }
    }

    settings.quests = merged;
    if (settings.debugMode) console.log(`[RPG Tracker] syncQuestsFromMemo: updated internal state with ${merged.length} quest(s).`);
}

// ── Delta display ─────────────────────────────────────────────────────────────

/**
 * Produces an HTML diff string for display in the delta panel.
 */
export function computeDelta(oldMemo, newMemo) {
    if (!oldMemo && !newMemo) return '<span class="delta-empty">No memo yet.</span>';
    if (!oldMemo) return '<span class="delta-added">+ (initial memo created)</span>';

    const oldLines = new Set(oldMemo.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = new Set(newMemo.split('\n').map(l => l.trim()).filter(Boolean));

    const added   = [...newLines].filter(l => !oldLines.has(l));
    const removed = [...oldLines].filter(l => !newLines.has(l));

    if (added.length === 0 && removed.length === 0) {
        return '<span class="delta-empty">No changes detected.</span>';
    }

    const html = [
        ...removed.map(l => `<div class="delta-removed">- ${escapeHtml(l)}</div>`),
        ...added.map(l   => `<div class="delta-added">+ ${escapeHtml(l)}</div>`),
    ];
    return html.join('');
}

// ── Tool-call message detection ───────────────────────────────────────────────

/**
 * Returns null if the message is a tool-call payload (discard it from context).
 * Returns the original text if it is regular narrative.
 * @param {string} text
 * @returns {string|null}
 */
export function cleanToolCallMessage(text) {
    if (!text) return text;
    const trimmed = text.trim();

    if (trimmed.includes('<code') && trimmed.includes('</code>')) {
        const codeStart   = trimmed.indexOf('<code');
        const contentStart = trimmed.indexOf('>', codeStart);
        const codeEnd     = trimmed.indexOf('</code>', contentStart);
        if (contentStart !== -1 && codeEnd !== -1) {
            const jsonText = trimmed.slice(contentStart + 1, codeEnd).trim();
            try {
                const parsed  = JSON.parse(jsonText);
                const entries = Array.isArray(parsed) ? parsed : [parsed];
                if (entries.some(e => e && (e.name || e.result !== undefined))) {
                    return null;
                }
            } catch { /* not valid JSON inside the code block */ }
        }
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed  = JSON.parse(trimmed);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            if (entries.some(e => e && (e.name || e.result !== undefined))) {
                return null;
            }
        } catch { /* not valid JSON */ }
    }

    return text;
}

// ── User action extraction ────────────────────────────────────────────────────

/**
 * Extracts the last user message from the chat, stripping injected blocks
 * (STATE MEMO, RNG_QUEUE) so only the player's actual typed input remains.
 */
export function getLastUserAction() {
    const { chat } = SillyTavern.getContext();
    if (!chat || chat.length === 0) return '';

    let raw = '';
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user || chat[i]['role'] === 'user') {
            raw = chat[i].mes || chat[i]['content'] || '';
            break;
        }
    }

    if (!raw) return '';

    raw = raw.replace(/###\s*STATE MEMO[^]*?(?=\n\[RNG_QUEUE|\n###|\n\[(?!RNG_QUEUE)[A-Z]|$)/i, '');
    raw = raw.replace(/\[RNG_QUEUE\s[^\]]*\][\s\S]*?\[\/RNG_QUEUE\][ \t]*\n?/gi, '');
    raw = raw.replace(/\[[A-Z_]+\][\s\S]*?\[\/[A-Z_]+\]/g, '');

    return raw.trim();
}

// ── Lorebook context builder ──────────────────────────────────────────────────

/**
 * Reads active Lorebooks from user settings and assembles them into
 * a context string prepended to the state model user prompt.
 */
export async function buildLorebookContext() {
    const settings = getSettings();
    const stCtx = SillyTavern.getContext();
    const parts = [];

    if (settings.ctxWorldInfo) {
        try {
            const allowedBooks = settings.lorebookFilter || [];
            let booksToLoad = [];

            if (allowedBooks.length > 0) {
                booksToLoad = allowedBooks;
            } else {
                // Try the in-memory list first
                booksToLoad = stCtx.getWorldInfoNames?.() ?? [];

                // If empty, force-refresh from backend and retry
                if (!booksToLoad.length && stCtx.updateWorldInfoList) {
                    await stCtx.updateWorldInfoList();
                    booksToLoad = stCtx.getWorldInfoNames?.() ?? [];
                }

                // Final fallback: direct backend fetch
                if (!booksToLoad.length) {
                    try {
                        const resp = await fetch('/api/settings/get', {
                            method: 'POST',
                            headers: stCtx.getRequestHeaders(),
                            body: JSON.stringify({}),
                        });
                        if (resp.ok) {
                            const data = await resp.json();
                            booksToLoad = data.world_names ?? [];
                        }
                    } catch (fetchErr) {
                        console.warn('[RPG Tracker] Direct world_names fetch failed:', fetchErr);
                    }
                }
            }

            const entries = [];
            for (const bookName of booksToLoad) {
                try {
                    const bookData = await stCtx.loadWorldInfo(bookName);
                    if (!bookData?.entries) continue;
                    for (const entry of Object.values(/** @type {any} */(bookData).entries)) {
                        const e = /** @type {any} */ (entry);
                        if (!e.disable && e.content) entries.push(e.content);
                    }
                } catch (bookErr) {
                    console.warn(`[RPG Tracker] Failed to load lorebook "${bookName}":`, bookErr);
                }
            }

            if (entries.length > 0) {
                const label = allowedBooks.length > 0 ? `Filtered: ${allowedBooks.join(', ')}` : 'All Books';
                parts.push(`## WORLD LORE (${label})\n${entries.join('\n---\n')}`);
            }
        } catch (e) {
            console.warn('[RPG Tracker] Could not inject World Info:', e);
        }
    }

    return parts.join('\n\n');
}

/**
 * Loads the given active-lore keys ("bookName::uid") and assembles them into a block of
 * `### [label]\n<content>` sections. Each distinct lorebook is loaded once and cached.
 * Callers prepend their own header (e.g. "## ROUTER ACTIVE LORE"). Returns a trimmed string,
 * or "" when there are no keys or no matching entries.
 *
 * Shared by index.js (refreshExtensionPrompt / promptManager interceptor) and
 * narrative-hooks.js (same-turn keyword / persistent / agent-owned lore injection).
 * @param {string[]} keys
 * @returns {Promise<string>}
 */
export async function buildActiveLorebookContext(keys) {
    if (!keys || !keys.length) return "";
    const ctx = SillyTavern.getContext();
    const books = {};
    for (const k of keys) {
        const [bookName] = k.split('::');
        if (!(bookName in books)) books[bookName] = await ctx.loadWorldInfo(bookName);
    }
    let out = "";
    for (const k of keys) {
        const [bookName, uid] = k.split('::');
        const entry = books[bookName]?.entries?.[uid];
        if (entry && entry.content) {
            out += `### [${entry.key?.[0] || entry.comment || uid}]\n${entry.content}\n\n`;
        }
    }
    return out.trim();
}

// ── Module instruction builders ───────────────────────────────────────────────

/**
 * Builds the complete modules instruction block for the system prompt.
 */
export function buildModulesInstructionText(settings) {
    let modulesText = "";
    const promptsMap = settings.stockPrompts || DEFAULT_STOCK_PROMPTS;

    modulesText += "### CORE MODULES\n";
    for (const [key, prompt] of Object.entries(promptsMap)) {
        // Never emit the quests_legacy key as its own module — it's a data slot only
        if (key === 'quests_legacy') continue;

        if (settings.modules[key]) {
            let p = prompt;

            // ── Dynamic prompt swap for Legacy Quests ──────────────────────
            if (key === 'quests') {
                const useLegacy = !!settings.questLegacyMode;
                if (useLegacy) {
                    const isDeadlines = !!settings.syspromptModules?.questsDeadlines;
                    const isFrustration = !!settings.syspromptModules?.questsFrustration;
                    const isDifficulty = !!settings.syspromptModules?.questsDifficulty;
                    // Use the dedicated legacy format prompt
                    p = (promptsMap['quests_legacy'] || DEFAULT_STOCK_PROMPTS.quests_legacy);
                    if (!isDeadlines) p = p.replace(/\n\s*DEADLINE:.*?\n/g, '\n');
                    if (!isFrustration) p = p.replace(/\n\s*FRUSTRATION_COEFF:.*?\n/g, '\n');
                    if (!isDifficulty) {
                        p = p.replace(/\n\s*DIFFICULTY:.*?\n/g, '\n');
                        p = p.replace(/\n- For difficulty, use the DIFFICULTY marker.*\n/g, '\n');
                    }
                    console.log('[RPG Tracker] Quest prompt: using LEGACY format (questLegacyMode=true)');
                } else {
                    console.log('[RPG Tracker] Quest prompt: using MODERN/JSON format (questLegacyMode=false)');
                }
            }

            modulesText += `- [${key.toUpperCase()}]: ${p}\n`;
        }
    }

    const enabledCustomFields = (settings.customFields || []).filter(f => f.enabled && f.tag);
    if (enabledCustomFields.length > 0) {
        modulesText += "\n### CUSTOM MODULES\n";
        enabledCustomFields.forEach(f => {
            const instruction = buildModuleFormatInstruction(f);
            if (instruction) {
                modulesText += `- [${f.tag.toUpperCase()}]: ${instruction}\n`;
            }
        });
    }
    return modulesText.trim();
}

export function buildModuleFormatInstruction(field) {
    return field.prompt || '';
}
