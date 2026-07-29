/**
 * preset-marker.js — Origins RPG Framework (preset marker substitution)
 *
 * Resolves the [[ORIGINS]] marker inside a chat-completion preset, substituting
 * it with the framework's live additive (rules-only) sysprompt at generation
 * time. This lets a big narrative preset own the persona and decide exactly
 * where the mechanics land, while the mechanics themselves stay live — they
 * follow the user's current module toggles and campaign mode instead of being a
 * hand-pasted snapshot that drifts out of date.
 *
 * Deliberately self-contained: nothing outside this repo has to know the marker
 * exists. We register our own CHAT_COMPLETION_PROMPT_READY listener and rewrite
 * the messages in place, so this works with ANY preset, not just ones whose
 * authoring extension has a cooperating block registry.
 *
 * Imports: state-manager.js, sysprompt.js, memo-processor.js
 * Imported by: index.js (event wiring, settings), narrative-hooks.js (budget).
 */

import { getSettings } from './state-manager.js';
import { getAdditiveSyspromptCache } from './sysprompt.js';
import { estimateTokens } from './memo-processor.js';

/** The literal users paste into their preset. Matched case-insensitively. */
export const ORIGINS_MARKER = '[[ORIGINS]]';

/**
 * Two-step match, mirroring how preset tag systems generally handle this: strip
 * the whole line first (so a marker sitting alone doesn't leave a blank gap),
 * then catch any remaining inline occurrences.
 * Both are /g, so `lastIndex` must be reset before each reuse — see resetRx().
 */
const MARKER_LINE_RX = /^[ \t]*\[\[origins\]\][ \t]*\r?\n?/gim;
const MARKER_ANY_RX = /\[\[origins\]\]/gi;

function resetRx() {
    MARKER_LINE_RX.lastIndex = 0;
    MARKER_ANY_RX.lastIndex = 0;
}

/** True when `text` contains the marker in any casing. Safe on non-strings. */
function hasMarker(text) {
    if (typeof text !== 'string' || !text) return false;
    resetRx();
    return MARKER_ANY_RX.test(text);
}

/**
 * Token cost of whatever the marker will expand to this turn. The interceptor's
 * budget math sums ctx.extensionPrompts; with the marker active the rules are
 * NOT in that registry (applyAdditiveSysprompt suppresses them), so without this
 * the budget under-counts by the full size of the ruleset.
 * @returns {number}
 */
export function markerPayloadTokens() {
    try {
        const payload = getAdditiveSyspromptCache();
        return payload ? estimateTokens(payload) : 0;
    } catch (_) {
        return 0;
    }
}

/** One-shot per session: the "you enabled the marker but never pasted it" nudge. */
let _warnedMissingMarker = false;

/** Test seam — lets the suite assert the warning fires exactly once per session. */
export function _resetMarkerWarning() {
    _warnedMissingMarker = false;
}

function warnMissingMarker() {
    console.warn(
        `[Origins Framework] Preset Marker is enabled but ${ORIGINS_MARKER} was not found in the prompt. `
        + 'Falling back to appending the mechanics to the first system message — paste the marker into your '
        + 'preset to control where they land.',
    );
    if (_warnedMissingMarker) return;
    _warnedMissingMarker = true;
    try {
        toastr['warning'](
            `Preset Marker is on but ${ORIGINS_MARKER} isn't in your preset. Mechanics were appended to the first `
            + 'system message instead. Paste the marker where you want them, or turn the setting off.',
            'Origins RPG Framework', { timeOut: 12000 },
        );
    } catch (_) { /* toastr unavailable (tests, headless) — the console warning stands */ }
}

/**
 * CHAT_COMPLETION_PROMPT_READY handler. Mutates `eventData.chat` in place.
 *
 * Runs regardless of whether the marker setting is on: a marker left in a preset
 * must NEVER survive into the request as literal text, so we always strip it.
 * The setting only governs whether we substitute content and whether the
 * missing-marker fallback applies.
 *
 * @param {{chat?: Array<{role?: string, content?: any}>, dryRun?: boolean}} eventData
 */
export function handlePresetMarker(eventData) {
    const messages = eventData?.chat;
    if (!Array.isArray(messages)) return;
    // Token counting / probe passes must not be mutated — they aren't real turns,
    // and rewriting them would make the reported count disagree with what we send.
    if (eventData.dryRun) return;

    const s = getSettings();
    // Master switch and Custom Sysprompt Mode both mean "don't touch prompts".
    // A stale marker is the user's own text at that point; leave it alone.
    if (!s.enabled || s.customSysprompt) return;

    const payload = s.presetMarkerEnabled ? getAdditiveSyspromptCache() : '';
    let found = false;

    for (const msg of messages) {
        if (typeof msg?.content !== 'string' || !hasMarker(msg.content)) continue;
        found = true;

        if (payload) {
            resetRx();
            msg.content = msg.content.replace(MARKER_ANY_RX, payload);
        } else {
            // No payload (marker off, extension mid-boot with a cold cache, or an
            // empty ruleset): remove the marker and the line it sat on.
            resetRx();
            msg.content = msg.content.replace(MARKER_LINE_RX, '');
            resetRx();
            msg.content = msg.content.replace(MARKER_ANY_RX, '');
        }
    }

    // Safety net: the marker is enabled and we have rules to inject, but the preset
    // never references it — without this the turn silently ships with no mechanics
    // at all, since applyAdditiveSysprompt() has already suppressed its own push.
    if (!found && payload) {
        const systemMsg = messages.find(m => m?.role === 'system' && typeof m.content === 'string');
        if (systemMsg) {
            systemMsg.content = `${systemMsg.content}\n\n${payload}`;
            warnMissingMarker();
        }
    }
}
