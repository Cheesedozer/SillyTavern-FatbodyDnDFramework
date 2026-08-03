/**
 * cyoa-regex.js — Origins RPG Framework
 * Installs and maintains the SillyTavern regex scripts that turn the narrator's
 * `<choices>` block into a styled box and keep stale blocks out of context.
 *
 * Imports: state-manager.js (getSettings), cyoa.js (CHOICE_BLOCK_SOURCE, activeSlots).
 * Imported by: index.js (lifecycle — settings changes, chat switch, render),
 *   test/cyoa-regex.test.js.
 *
 * Why the extension owns these instead of shipping a .json to import: the depth
 * cutoff and the row pattern are derived from live settings (`cyoaChoiceCount`,
 * `cyoaCleanupDepth`) and from CHOICE_BLOCK_SOURCE. A hand-imported copy goes
 * stale the moment either changes, and a user who skips the import gets raw
 * `<choices>` markup in their chat with no clue why.
 *
 * These are *global* scripts (`extension_settings.regex`), the same list the
 * Regex extension's UI edits. That UI reads the list when it renders, so a
 * script installed while ST is open shows up in the panel only after a refresh
 * — the scripts themselves take effect on the very next message either way.
 *
 * Anything the user edits by hand in these three entries is overwritten on the
 * next sync. That is the trade for them never drifting from the prompt.
 */

import { getSettings } from './state-manager.js';
import { CHOICE_BLOCK_SOURCE, activeSlots } from './cyoa.js';

/**
 * SillyTavern's regex_placement.AI_OUTPUT. Hardcoded rather than imported —
 * this extension never imports from ST's source tree, only from getContext().
 */
const AI_OUTPUT = 2;

/**
 * Fixed ids so a re-sync upgrades the same three entries in place instead of
 * appending a fourth copy every time a setting changes. Never regenerate these.
 */
const SCRIPT_IDS = {
    cleanup: 'origins-cyoa-cleanup-1f4c0e30',
    rows: 'origins-cyoa-rows-1f4c0e31',
    box: 'origins-cyoa-box-1f4c0e32',
};

const OWNED_IDS = new Set(Object.values(SCRIPT_IDS));

/**
 * Fingerprint of everything the scripts are built from. index.js#refreshRenderedView
 * calls this on every render, and rewriting settings (plus a debounced save) that
 * often is pure waste — so an unchanged fingerprint is a no-op.
 *
 * Assigned only *after* the write succeeds, mirroring the discipline the old
 * tool registration ended up needing: a fingerprint recorded up front survives a
 * throw and makes every later call short-circuit on a sync that never happened.
 */
let _lastSync = null;

/** ST parses `/pattern/flags`; a bare pattern gets no flags at all, not even `g`. */
function rx(pattern, flags) {
    return `/${pattern}/${flags}`;
}

/**
 * One script entry in ST's shape. Field-for-field the same object the Regex
 * extension writes, so an installed script is indistinguishable from a
 * hand-made one and can be inspected (or disabled) in its UI.
 */
function script({ id, scriptName, findRegex, replaceString, markdownOnly = true, promptOnly = false, minDepth = null, maxDepth = null }) {
    return {
        id,
        scriptName,
        findRegex,
        replaceString,
        trimStrings: [],
        placement: [AI_OUTPUT],
        disabled: false,
        markdownOnly,
        promptOnly,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth,
        maxDepth,
    };
}

/**
 * The three scripts for the current settings, in application order — ST runs
 * them down the array against the same string, and each stage assumes the
 * previous one has run:
 *
 *  1. cleanup — drop blocks older than the cutoff, from display AND prompt.
 *  2. rows    — rewrite each `slot | text | stake` line as a row div.
 *  3. box     — wrap whatever is left between the tags.
 *
 * Splitting it three ways is what makes it degrade well: a narrator that emits
 * three options when four are configured still gets three styled rows, where a
 * single all-or-nothing regex would have failed to match and shown raw markup.
 *
 * @param {ReturnType<import('./state-manager.js').getSettings>} s
 */
export function buildCyoaScripts(s) {
    const slotIds = activeSlots(s.cyoaChoiceCount).map(x => x.id);
    const depth = Number(s.cyoaCleanupDepth);

    return [
        script({
            id: SCRIPT_IDS.cleanup,
            scriptName: 'Origins CYOA — cleanup (auto)',
            findRegex: rx(`\\n*${CHOICE_BLOCK_SOURCE}`, 'gi'),
            replaceString: '',
            // Both flags true: applies to display and to the prompt, but never
            // rewrites the stored message. That is load-bearing — cyoa.js reads
            // the block straight out of msg.mes, so the raw text has to survive.
            markdownOnly: true,
            promptOnly: true,
            minDepth: Number.isFinite(depth) ? Math.max(1, Math.trunc(depth)) : 4,
        }),
        script({
            id: SCRIPT_IDS.rows,
            scriptName: 'Origins CYOA — rows (auto)',
            // Only the slots that are actually configured, so a stray prose line
            // can't be mistaken for a choice. The slot id rides through as a data
            // attribute; style.css turns it into the icon and the label.
            findRegex: rx(`^[ \\t]*(?:[-*•]\\s*)?(${slotIds.join('|')})[ \\t]*\\|[ \\t]*([^|\\n]*?)[ \\t]*(?:\\|[ \\t]*(.*?))?[ \\t]*$`, 'gim'),
            replaceString:
                '<div class="rt-cyoa-row">'
                + '<span class="rt-cyoa-row-slot" data-slot="$1"></span>'
                + '<span class="rt-cyoa-row-text">$2</span>'
                + '<span class="rt-cyoa-row-stake">$3</span>'
                + '</div>',
        }),
        script({
            id: SCRIPT_IDS.box,
            scriptName: 'Origins CYOA — box (auto)',
            findRegex: rx(CHOICE_BLOCK_SOURCE, 'gi'),
            replaceString: '<div class="rt-cyoa-block">$1</div>',
        }),
    ];
}

/**
 * Installs, updates, or removes the scripts to match current settings.
 * Idempotent and safe to call on every settings change / chat switch — this is
 * the lifecycle slot the SuggestChoices tool registration used to occupy.
 *
 * The gate matches the one buildSysprompt() applies to the `<cyoa>` block, for
 * the same reason it always did: if the rules ship without the scripts, the
 * narrator writes a block nothing renders.
 *
 * @param {boolean} [force] rewrite even when nothing observable changed
 */
export function syncCyoaRegexScripts(force = false) {
    try {
        const s = getSettings();
        const ctx = SillyTavern.getContext();
        const store = ctx.extensionSettings;
        if (!store) return;

        const enabled = !!s.enabled && s.syspromptModules?.cyoa !== false;
        const fingerprint = `${enabled ? 'on' : 'off'}:${JSON.stringify([s.cyoaChoiceCount, s.cyoaCleanupDepth])}`;
        if (!force && fingerprint === _lastSync) return;

        _lastSync = null;
        if (!Array.isArray(store.regex)) store.regex = [];

        // Drop ours wherever they are, then re-append in order. Rebuilding the
        // run order matters: the three stages are only correct in sequence, and
        // a user dragging one in the Regex UI would otherwise silently break it.
        const others = store.regex.filter(entry => !OWNED_IDS.has(entry?.id));
        store.regex = enabled ? [...others, ...buildCyoaScripts(s)] : others;

        ctx.saveSettingsDebounced();
        _lastSync = fingerprint;
    } catch (error) {
        // Leave the fingerprint clear so the next call retries rather than
        // caching a sync that never landed.
        _lastSync = null;
        console.error('[RPG Tracker] Error syncing CYOA regex scripts', error);
    }
}

/** True while the scripts are believed to be installed. Panel diagnostics only. */
export function areCyoaScriptsInstalled() {
    return _lastSync !== null && _lastSync.startsWith('on:');
}
