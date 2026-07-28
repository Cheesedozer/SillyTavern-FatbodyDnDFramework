/**
 * module-registry.js — Fatbody D&D Framework
 *
 * Single source of truth for the built-in "memo modules" — the State Memo
 * tracker sections (CHARACTER, COMBAT, PARTY, …). Before this registry existed,
 * adding a stock module meant editing ~5 scattered spots (the modules-default
 * map, BLOCK_ORDER, the render-type mapping, the settings UI, etc.) that could
 * silently fall out of sync. Now everything derives from MEMO_MODULES below.
 *
 * To add a built-in memo module:
 *   1. add its prompt text to DEFAULT_STOCK_PROMPTS in constants.js
 *   2. append one descriptor to MEMO_MODULES here
 * The defaults map, block order, and render-type routing all follow.
 *
 * Prompt TEXT still lives in constants.js (DEFAULT_STOCK_PROMPTS); descriptors
 * reference it by `id` so the (large) strings have exactly one home and cannot
 * drift from the registry.
 *
 * Imports: constants.js   (leaf — must NOT import anything that imports this file)
 */

import { DEFAULT_STOCK_PROMPTS } from './constants.js';

/**
 * @typedef {Object} MemoModule
 * @property {string}  id               Settings key in `settings.modules` and `DEFAULT_STOCK_PROMPTS`.
 * @property {string}  tag              Upper-case memo block tag, e.g. "CHARACTER".
 * @property {boolean} enabledByDefault Default value in `settings.modules`.
 * @property {number}  order            Position in BLOCK_ORDER (lower = earlier).
 * @property {string}  renderType       Which renderer.js implementation draws this block.
 * @property {boolean} [inDefaultBlockOrder] Present in the per-chat default `blockOrder` (QUESTS is not).
 * @property {boolean} [isQuest]        Quest module (special legacy/JSON handling).
 */

/** @type {MemoModule[]} Ordered by `order` to match the historical BLOCK_ORDER. */
export const MEMO_MODULES = [
    { id: 'combat',    tag: 'COMBAT',    enabledByDefault: true, order: 0, renderType: 'COMBAT',    inDefaultBlockOrder: true },
    { id: 'character', tag: 'CHARACTER', enabledByDefault: true, order: 1, renderType: 'CHARACTER', inDefaultBlockOrder: true },
    { id: 'party',     tag: 'PARTY',     enabledByDefault: true, order: 2, renderType: 'CHARACTER', inDefaultBlockOrder: true },
    { id: 'inventory', tag: 'INVENTORY', enabledByDefault: true, order: 3, renderType: 'INVENTORY', inDefaultBlockOrder: true },
    { id: 'abilities', tag: 'ABILITIES', enabledByDefault: true, order: 4, renderType: 'ABILITIES', inDefaultBlockOrder: true },
    { id: 'spells',    tag: 'SPELLS',    enabledByDefault: true, order: 5, renderType: 'SPELLS',    inDefaultBlockOrder: true },
    { id: 'xp',        tag: 'XP',        enabledByDefault: true, order: 6, renderType: 'XP',        inDefaultBlockOrder: true },
    { id: 'time',      tag: 'TIME',      enabledByDefault: true, order: 7, renderType: 'TIME',      inDefaultBlockOrder: true },
    { id: 'quests',    tag: 'QUESTS',    enabledByDefault: true, order: 8, renderType: 'QUESTS',    inDefaultBlockOrder: false, isQuest: true },
    // v3.0 Modern mode: acquired skill list (engine-written; extractor only
    // tracks usage). Disabled by default — Modern campaign creation enables it
    // per-chat. Appended LAST and excluded from the default block order so
    // existing D&D chats see zero reordering. Renders via the ABILITIES list
    // renderer (same `- Name (resource, description)` shape).
    { id: 'skills',    tag: 'SKILLS',    enabledByDefault: false, order: 9, renderType: 'ABILITIES', inDefaultBlockOrder: false },
    // v4.0 Origins: the committed origin profile (engine-written at character
    // creation; extractor may only touch the "Current Goal" line). Disabled by
    // default — Origins campaign commit enables it per-chat. Appended LAST and
    // excluded from the default block order so existing chats see zero
    // reordering. Renders via the default kv-line renderer (its own tag).
    { id: 'origin',    tag: 'ORIGIN',    enabledByDefault: false, order: 10, renderType: 'ORIGIN', inDefaultBlockOrder: false },
];

const ORDERED = [...MEMO_MODULES].sort((a, b) => a.order - b.order);

/**
 * Reserved stock module tags, in canonical order. Replaces the hand-maintained
 * BLOCK_ORDER literal; byte-identical to it.
 * @type {string[]}
 */
export const BLOCK_ORDER = ORDERED.map(m => m.tag);

/**
 * Default `blockOrder` for a fresh chat — the stock tags that participate in the
 * reorderable section list. (QUESTS renders separately and is excluded, matching
 * the historical default.)
 * @type {string[]}
 */
export const DEFAULT_BLOCK_ORDER = ORDERED.filter(m => m.inDefaultBlockOrder).map(m => m.tag);

/**
 * Default `settings.modules` toggle map: { id: enabledByDefault }.
 * @returns {Record<string, boolean>}
 */
export function getDefaultModuleToggles() {
    const out = {};
    for (const m of MEMO_MODULES) out[m.id] = m.enabledByDefault;
    return out;
}

const BY_TAG = new Map(MEMO_MODULES.map(m => [m.tag, m]));

/** Look up a memo module by its block tag (case-insensitive). */
export function getMemoModuleByTag(tag) {
    return BY_TAG.get(String(tag || '').toUpperCase()) || null;
}

/** The renderer.js render-type for a stock tag, or the tag itself if not a stock module. */
export function getRenderTypeForTag(tag) {
    return getMemoModuleByTag(tag)?.renderType || tag;
}

// Dev-time guard: every descriptor must have a matching prompt in constants so
// the two stay in sync. Quest uses an extra `quests_legacy` slot, handled elsewhere.
for (const m of MEMO_MODULES) {
    if (!(m.id in DEFAULT_STOCK_PROMPTS)) {
        console.warn(`[RPG Tracker] module-registry: no DEFAULT_STOCK_PROMPTS entry for "${m.id}".`);
    }
}
