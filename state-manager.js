/**
 * state-manager.js — Fatbody D&D Framework
 * Game state schema, defaults, persistence, migration, and profile I/O.
 * Owns the single source of truth for all runtime state (currentMemo, quests,
 * modules, chat-linked snapshots, connection settings, etc.).
 * No DOM. No circular deps.
 *
 * Imports: constants.js
 * Imported by: virtually everything — the root dependency.
 */

import { DEFAULT_STOCK_PROMPTS } from './constants.js';
import { BLOCK_ORDER, DEFAULT_BLOCK_ORDER, getDefaultModuleToggles } from './module-registry.js';
import {
    WORLD_ARC_DEFAULT_PROMPT,
    CHARACTER_ARC_DEFAULT_PROMPT,
    REGIONAL_STATE_DEFAULT_PROMPT,
    PACING_DEFAULT_PROMPT,
} from './world-progression-schema.js';

// ── Module name (shared constant, settings key) ────────────────────────────────
export const MODULE_NAME = 'rpg_tracker';

// ── State Extractor prompt versioning / migration ──────────────────────────────
// Bump STATE_PROMPT_VERSION whenever the default `systemPromptTemplate` changes.
// Existing installs persist the prompt, so getSettings()'s undefined-only backfill
// never updates it; migrateSystemPrompt() force-upgrades installs still running a
// known prior default while preserving user-customized prompts.
export const STATE_PROMPT_VERSION = 1;

/** Tiny FNV-1a fingerprint (`<len>:<hash>`) used to recognize prior default prompts. */
function promptFingerprint(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${str.length}:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// Fingerprints of every default `systemPromptTemplate` that shipped before the
// current one. An install whose prompt matches one of these never customized it
// and is safe to auto-upgrade.
const LEGACY_STATE_PROMPT_FINGERPRINTS = new Set([
    '3722:7f9db8a7', // pre-v1 default (v2.4.x)
]);

// ── World Progression prompt versioning / migration ────────────────────────────
// Same contract as STATE_PROMPT_VERSION above, but tracks all four per-layer
// templates independently (a user may have customized only one of them).
export const WORLDPROG_PROMPT_VERSION = 1;
const WORLDPROG_PROMPT_KEYS = ['worldArcSystemPromptTemplate', 'characterArcSystemPromptTemplate', 'regionalStateSystemPromptTemplate', 'pacingSystemPromptTemplate'];
/** No prior defaults exist yet (feature is new) — future bumps add fingerprints here. */
const LEGACY_WORLDPROG_PROMPT_FINGERPRINTS = new Set();

// ── Default module definitions (single source of truth for reset logic) ─────────
export const DEFAULT_MODULES = {
    npc:   { enabled: true, tag: 'NPC',   format: 'Name | Description | Keywords',                    instruction: 'Named characters. Do NOT create an entry for {{user}}. Mention {{user}} in EVENT or QUEST entries as needed.' },
    loc:   { enabled: true, tag: 'LOC',   format: 'Name | Description | Keywords',                    instruction: 'Named places. The Name MUST be the full hierarchical path using " :: " as the separator (e.g. "Khelt :: Rust-Lantern District :: Marrow-Deep Mines Office"). Include each ancestor name as a keyword (e.g. "Khelt, Rust-Lantern District, mines").' },
    fac:   { enabled: true, tag: 'FAC',   format: 'Name | Status | Description | Keywords',           instruction: 'Named factions, guilds, organisations. **Status**: short current-state line (standing with the party, active conflicts, what changed recently). **Description**: longer narrative (history, ideology, schemes, notable members). **Keywords**: comma-separated terms for discovery.' },
    quest: { enabled: true, tag: 'QUEST', format: 'Name | Location | Description | Keywords',         instruction: 'ONLY record a quest when the player explicitly accepts it. A quest being mentioned or offered is NOT enough.' },
    event: { enabled: true, tag: 'EVENT', format: 'Name | Details | Keywords',                        instruction: 'Significant narrative events. The Name is a SHORT, STABLE identifier (e.g. "Siege of Ashford") — no timestamps in the name, no "Final"/"Update" suffixes. Put timestamps in the Details field. Reuse the exact same Name when adding new information — entries are chronicles that accumulate automatically.' }
};

// ── Core settings accessor ─────────────────────────────────────────────────────

/**
 * Returns the live extension settings object, deep-merging defaults for any
 * missing keys. All reads and writes to persistent state go through this.
 * @returns {Record<string, any>}
 */
/** Clone a default value for backfill: deep-clone objects/arrays, pass primitives/null through. */
function cloneDefault(v) {
    return (v !== null && typeof v === 'object') ? structuredClone(v) : v;
}

/** Builds the pristine default-settings template (called once at module load). */
function buildDefaultsTemplate() {
    return {
        currentMemo: "",
        mainPromptBackup: "",
        prevMemo1: "",
        prevMemo2: "",
        memoHistory: [],
        lastDelta: "",
        enabled: true,
        trackerCollapsed: false,
        agentCollapsed: false,
        debugMode: true,
        connectionSource: "default",
        connectionProfileId: "",
        completionPresetId: "",
        renderedViewActive: true,
        maxTokens: 0,
        // Token reserve for extensions that inject AFTER the interceptor runs
        // (e.g. Megumin Suite at CHAT_COMPLETION_PROMPT_READY) and are therefore
        // invisible to the injection budget. ~1000-2000 recommended with Megumin.
        externalReserveTokens: 0,
        fontSize: 14,
        agentFontSize: 13,
        customSysprompt: false,
        suiteMode: false,
        // Substitute the framework's live rules wherever [[ORIGINS]] appears in the
        // active chat-completion preset (see preset-marker.js). While on, the rules
        // are NOT also pushed as an extension prompt — the marker is the sole path.
        presetMarkerEnabled: false,
        // 'standalone' = Fatbody owns the Main prompt box (current behavior).
        // 'additive'   = rules-only variant delivered via setExtensionPrompt;
        //                the Main prompt box is never touched (Megumin/etc owns the role).
        syspromptDelivery: "standalone",
        rngEnabled: true,
        diceFunctionTool: true,
        barColors: {},
        modulePageSizes: {},
        customTheme: null,
        savedThemes: {},
        systemPromptTemplate:
            `You are the State Extractor Model. Your task is to maintain a structured State Memo based on the roleplay narrative.
<core_directives>
IGNORE NARRATIVE FLUFF: Do not track temporary dialogue or actions. Only track persistent state changes.
INTEGRATION: Track all durations stated by the narrative (e.g. 'poisoned for 3 turns'). Decrement by 1 each round in [COMBAT]. For out-of-combat/time-based durations, calculate the delta between the current [TIME] and the [TIME] in the PRIOR MEMO.
CREATION: You MAY create a section that did not exist in the Prior Memo when the narrative warrants it based on your enabled modules.
DELETION: To REMOVE a section entirely, you MUST output: \`[TAG]REMOVED[/TAG]\`.
</core_directives>

<modules>
You must track the following enabled modules:
{{modulesText}}

NEVER ignore a module.
</modules>

<rules>
1. Read the PRIOR MEMO and the NARRATIVE OUTPUT carefully.
2. Determine which sections changed. Only output sections that actually changed.
3. Use strict [TAG]...[/TAG] structure based on the modules requested above. ALWAYS include the matching closing tag for every section you open — never leave a section unclosed.
4. Omit unchanged sections entirely. Do NOT output a section if its contents did not change.
5. BLOCK PERSISTENCE: For list-based sections ([PARTY], [INVENTORY], [ABILITIES], [SPELLS], [COMBAT]), if any single item within that section changes, you MUST re-output the ENTIRE section containing all items. Never omit existing members or items unless they are explicitly logically removed.
6. If there are absolutely NO CHANGES to any section, you MUST output exactly: \`NO_CHANGES_DETECTED\`
7. Output ONLY the changed sections (or NO_CHANGES_DETECTED). No preamble, no explanation, no commentary, no markdown code fences, and no wrapper tags.
</rules>


<list_formatting>
For sections with multiple items ([ABILITIES], [INVENTORY], [SPELLS], [PARTY]):
1. Use a bulleted list with \`-\`.
2. Format: \`- Name (Resource/Max, Effect Description)\`.
3. If no resource tracker is needed, use: \`- Name (Effect Description)\`.
4. The parentheses MUST contain the resource count FIRST, followed by a comma, then the description.
5. In [SPELLS], write each spell as its plain canonical name only (e.g. \`Hex\`, \`Tasha's Hideous Laughter\`). Do NOT append parenthetical annotations like "(concentration)" or "(ritual)" to a spell's name; put such details in a Status/Traits line instead. Clean spell names keep the in-UI spell reference links working.
</list_formatting>

<buff_debuff_logic>
Duration Tracking: Record all durations explicitly. Use turns for combat (e.g., for 3 turns) and H:M for narrative time (e.g., 1h 30m).
Restoration Anchors: When a buff or debuff modifies a base statistic (AC, Attributes, etc.), record the base value directly in the respective field—e.g., 'AC 18 (base 13)'.
Status Formatting: Output the buff/debuff in the Status line with its absolute mathematical effect in parentheses. Example: 'Shield (+5 AC, 1 turn)'.
Auto-Reversion: During each State Sync, check if a duration has expired. If it has, use the modifier in the Status line to reverse the math on the base statistic (e.g., subtracting the +5 AC), restore the field, and remove the buff from the list.
Conditional Buffs: For effects without a set time, use event-based anchors. Example: 'Exhaustion (Disadvantage on Ability Checks, until Long Rest)'.
STATUS LABELING: In [CHARACTER], [PARTY], and [COMBAT] blocks, prefix positive status effects (buffs) with \`(+)\` and negative status effects (debuffs) with \`(-)\`. Every status MUST include its effect AND duration in parentheses. Example: \`Status: (+) Heroism (+2 Temp HP per turn, 9 turns), (-) Poisoned (Disadvantage on attacks, 2 turns)\`. Healthy or no effects needs no prefix.
</buff_debuff_logic>

<progression_logic>
Update abilities/attributes/HP/etc accordingly, such as an ability's 1d6 bonus increasing to 2d6, etc.
</progression_logic>

<custom_formatting>
You may be asked to use Markers: ((PLS)), ((B)), ((XB)), ((BDG)), ((HGT)). These are for graphical rendering options; use them if instructed but only if instructed in a specific [MODULE].
</custom_formatting>`,
        // 0 so existing installs run migrateSystemPrompt() once; fresh installs
        // are stamped to the current version by that same migration at init.
        systemPromptVersion: 0,
        systemPromptUpdateAvailable: false,
        modules: getDefaultModuleToggles(),
        stockPrompts: { ...DEFAULT_STOCK_PROMPTS },
        customFields: [],
        profiles: {},
        activeProfile: "",
        fullViewSections: [],
        blockOrder: [...DEFAULT_BLOCK_ORDER],
        legacyDiceNaming: false,
        closeCount: 0,
        hudHidden: false,
        trackerCollapseHintShown: false,
        lookbackMessages: 2,
        directPromptContext: 5,
        historyIndex: -1,
        ctxWorldInfo: false,
        lorebookFilter: [],
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "",
        openaiUrl: "",
        openaiKey: "",
        openaiModel: "",
        openaiMaxTokens: 0,
        chatLinkEnabled: true,
        chatStates: {},
        quests: [],
        questLegacyMode: false,
        // v4.0 Origins character creation
        originsEnabled: true,       // offer 🧬 Origins on the D&D onboarding step
        originsNsfwDefault: false,  // initial state of the per-campaign NSFW toggle
        syspromptModules: {
            loot: true,
            random_events: true,
            resting: true,
            quests: true,
            origin_levers: true,
            questsDeadlines: false,
            questsFrustration: false,
            questsDifficulty: false
        },
        routerEnabled: true,
        routerLog: [],
        activeRouterKeys: [],
        keywordActivatedKeys: [],  // entries activated by keyword scanner — auto-expire when keyword leaves scan window
        pinnedRouterKeys: [],      // engine-written canon — always active, exempt from the budget, undeactivatable
        routerConnectionSource: "default",
        routerOpenaiUrl: "",
        routerOpenaiKey: "",
        routerOpenaiModel: "",
        routerOllamaUrl: "http://localhost:11434",
        routerOllamaModel: "",
        routerConnectionProfileId: "",
        routerCompletionPresetId: "",
        routerMaxTokens: 0,
        routerMaxTurns: 5,
        routerMaxActivations: 8,
        routerCampaignPrefix: "",
        routerCampaignPrefixOverride: "",
        /** ST chat id for which `routerCampaignPrefixOverride` applies; empty = legacy (override only when chatId === active ctx chat id). */
        routerCampaignPrefixOverrideAnchorChatId: "",
        routerLookback: 4,
        routerDirectLookback: 10,
        routerDirectPrompt: "",
        routerBasicMode: false,
        /** @deprecated v2.5.1 — folded into routerActivationMode ('native'). Kept for migration. */
        routerNativeKeywordActivation: false,
        // How agent-managed lorebook entries get activated/injected:
        //  'managed'  - Fatbody's keyword scanner + manual injection (default, classic behavior)
        //  'native'   - entries left enabled; ST's native World Info keyword scanner activates them
        routerActivationMode: "managed",
        routerPaused: false,
        routerRunEvery: 1,
        routerIncludeHidden: false,
        routerPromptForPrefix: false,
        routerModules: JSON.parse(JSON.stringify(DEFAULT_MODULES)),
        routerCustomTags: [],
        routerHistory: [],
        routerCleanupTokenThreshold: 300,
        routerCleanupEvery: 0,
        routerCleanupUseThreshold: true,
        /** Shared input-token budget per audit chunk (state audit + lorebook history audit). */
        auditChunkTokens: 6000,
        /** Per-chunk agent turn cap for the lorebook history audit (lower than routerMaxTurns to bound cost). */
        routerAuditMaxTurns: 3,
        routerSystemPromptTemplate: `<basic_instructions>
You are the Researcher Agent, a specialized Dungeon Master's Assistant. Your role is to architect the AI Narrator's memory — keeping the Active Context saturated with the most relevant lore at all times.

You have the authority to browse the campaign's archive, search for relevant history, and update {{campaignRoot}} to reflect new developments.

Do not wait for the Narrator to forget something before you act. If a name, place, or faction is mentioned — even in passing — load it immediately. If the party is moving, pre-load the destination before they arrive.

Make multiple entries per turn if necessary. Thoroughness is your primary virtue.
</basic_instructions>

<context_maximization>
Your goal is to keep the Active Context saturated. Think of it as a stage: it is your job to have every prop, actor, and set piece in place before the scene begins.

- **Saturation Goal:** Keep Active entries as close to MAX as possible at all times. An underloaded context is a failure state.
- **Proactive Loading:** Do not wait for a gap to appear. If a name or location is mentioned, or if the party is about to move, activate the relevant entries immediately.
- **Context Rotation:** When the context is full and new entries are needed, deactivate "Exit Contexts" (rooms left, NPCs departed, resolved threads) to make room for "Entry Contexts" (current room, present NPCs, active quest objective). Treat it as a sliding window, not a hard ceiling.
- **Priority Tiering:** Use this order when deciding what to keep vs. rotate out:
  1. NPCs physically present in the current scene
  2. The current sub-location (room, street, building)
  3. The parent location (district, dungeon, city)
  4. The active objective of the current Quest
  5. Relevant Factions or STATS for present characters
  6. Regional or world lore

If you briefly exceed the budget due to newly activated entries, deactivate the lowest-priority items in the same turn to return within range. It is better to rotate aggressively than to leave the Narrator without context.

BUDGET VIOLATION notices mean you exceeded the limit. When you see one, immediately identify and deactivate the least relevant entries (Exit Contexts first) until you are within budget. List those IDs in the \`deactivate\` field of the same commit call.
</context_maximization>

<formatting>
When recording a new entry, keep the lorebook category separate from the entity label.

- Use the "category" field for the type (NPC, LOC, FAC, QUEST, EVENT, or a custom tag).
- Use the "label" field for the entity name only. Do NOT prefix labels with the category tag.

Correct examples:
- {"label": "Iron Syndicate", "category": "FAC"}
- {"label": "Thalric Thorne", "category": "STATS"}

Incorrect examples:
- {"label": "FAC: Iron Syndicate", "category": "FAC"}
- {"label": "STATS: Thalric Thorne", "category": "STATS"}
</formatting>

<quests>
When you log a quest, describe the location and the quest giver in a single paragraph, including details about them that will be relevant to location persistence when {{user}} eventually returns to turn in the quest.
</quests>

<updating_entities>
When an entity (location, NPC, etc.) changes in a meaningful way, update the associated lorebook entry.

Entries are append-only chronicles. Provide ONLY the new information as a timestamped delta (e.g. "[Day 3, 14:00] The forge was destroyed."). Do NOT rewrite or re-summarize the full entry. Do NOT copy, paraphrase, or reconstruct content already present in the existing entry. Only the net-new development belongs in your delta.

For locations: the [ID:] stamp at the top of every injected entry gives you the ID to pass to the update tool.
IMPORTANT: Never include the [ID:] line in the content field you write. It is managed automatically — only use the ID value in the "id" field of the update tool.

EVENT entries use this format:
  [Day X, HH:MM] <one-sentence fact>
  [Day X, HH:MM] <next development>
  [Day X, HH:MM] <next development after that, etc>
Each line is a standalone delta. Never write a paragraph. Never reference prior lines.
</updating_entities>

<timestamps>
The current world date/time is visible in the ## NARRATIVE section — look for the status footer in recent messages (e.g. "11:52 AM, Day 1").
When recording an EVENT or any time-sensitive entry, include the timestamp at the beginning of the content.
Example: "[Day 1, 11:52] Character signed the contract with Brodrik."
</timestamps>

<bravery>
Don't be afraid to hit the budget exactly. It's better to lean towards activating too much than too little.
</bravery>`,
        categoryRenderOptions: {},

        // ── World Progression System (four-layer world/character/regional/pacing engine) ──
        worldProgEnabled: false,
        worldProgPaused: false,
        worldProgRunEvery: 3,           // independent of routerRunEvery
        worldProgMaxTurns: 3,           // validate/retry budget for the commit call

        worldProgConnectionSource: "default",
        worldProgConnectionProfileId: "",
        worldProgCompletionPresetId: "",
        worldProgOllamaUrl: "http://localhost:11434",
        worldProgOllamaModel: "",
        worldProgOpenaiUrl: "",
        worldProgOpenaiKey: "",
        worldProgOpenaiModel: "",
        worldProgMaxTokens: 0,

        // ── Origins character creation ──
        // Its own connection so the creation flow can run on a strong creative
        // model without dragging the State Tracker (which runs every turn) onto
        // it. "default" = ST's active API, i.e. what Origins used before this
        // block existed, so an untouched install is unchanged.
        originsConnectionSource: "default",
        originsConnectionProfileId: "",
        originsCompletionPresetId: "",
        originsOllamaUrl: "http://localhost:11434",
        originsOllamaModel: "",
        originsOpenaiUrl: "",
        originsOpenaiKey: "",
        originsOpenaiModel: "",
        originsMaxTokens: 0,

        worldArcSystemPromptTemplate: WORLD_ARC_DEFAULT_PROMPT,
        characterArcSystemPromptTemplate: CHARACTER_ARC_DEFAULT_PROMPT,
        regionalStateSystemPromptTemplate: REGIONAL_STATE_DEFAULT_PROMPT,
        pacingSystemPromptTemplate: PACING_DEFAULT_PROMPT,
        // 0 so existing installs run migrateWorldProgPrompts() once; fresh installs
        // are stamped to the current version by that same migration at init.
        worldProgPromptVersion: 0,
        worldProgPromptUpdateAvailable: { worldArc: false, characterArc: false, regionalState: false, pacing: false },

        // Cross-chat macro state (Layer 1 World Arc + cross-session Layer 2 Character
        // Arc data), keyed by campaign prefix — see world-progression.js#getWorldProgKey.
        worldStates: {},

        worldProgHudVisible: false,
        worldProgHudCollapsed: false,
        worldProgMeguminWarningDismissed: false,
    };
}

/**
 * Pristine default settings, built once at module load and frozen. getSettings()
 * never mutates it — it only clones values out of it when backfilling missing
 * keys, so the common (already-initialised) path allocates nothing.
 */
const DEFAULTS_TEMPLATE = Object.freeze(buildDefaultsTemplate());

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = {};
    }

    // Deep merge — fills in missing keys without overwriting existing ones.
    // Values are cloned out of the frozen template only when actually backfilling,
    // so the hot path (all keys present) does pure reads and allocates nothing.
    for (const [key, value] of Object.entries(DEFAULTS_TEMPLATE)) {
        if (extensionSettings[MODULE_NAME][key] === undefined) {
            extensionSettings[MODULE_NAME][key] = cloneDefault(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                if (extensionSettings[MODULE_NAME][key][subKey] === undefined) {
                    extensionSettings[MODULE_NAME][key][subKey] = cloneDefault(subValue);
                }
            }
        }
    }
    
    // ── MIGRATION: routerModules (v1.8.35+) ───────────────────────────────────
    const s = extensionSettings[MODULE_NAME];

    // routerNativeKeywordActivation (≤2.4.x) → routerActivationMode (2.5.1+).
    // The legacy boolean is consumed (set false) so this runs exactly once and
    // routerActivationMode becomes the single source of truth.
    if (s.routerNativeKeywordActivation) {
        s.routerActivationMode = 'native';
        s.routerNativeKeywordActivation = false;
    }

    // 'semantic' activation mode (2.5.0–3.2.x) was removed in 3.3.0 — VectFox no
    // longer offers cross-extension surfacing. Fold stored values back to 'managed'.
    if (s.routerActivationMode === 'semantic') {
        s.routerActivationMode = 'managed';
    }

    if (s.routerModules && typeof s.routerModules.npc === 'boolean') {
        const old = s.routerModules;
        s.routerModules = {
            npc: { enabled: !!old.npc, tag: 'NPC', format: 'Name | Description | Keywords', instruction: DEFAULT_MODULES.npc.instruction },
            loc: { enabled: !!old.loc, tag: 'LOC', format: 'Name | Description | Keywords', instruction: 'Named places. Name MUST be the full hierarchical path using " :: " as the separator (e.g. "Khelt :: Rust-Lantern District :: Marrow-Deep Mines Office"). Include each ancestor as a keyword.' },
            fac: { enabled: !!old.fac, tag: 'FAC', format: 'Name | Status | Description | Keywords', instruction: 'Named factions, guilds, organisations. **Status**: short current-state line. **Description**: longer narrative (history, schemes, members). **Keywords**: comma-separated terms.' },
            quest: { enabled: !!old.quest, tag: 'QUEST', format: 'Name | Location | Description | Keywords', instruction: 'ONLY record a quest when the player explicitly accepts it. A quest being mentioned or offered is NOT enough.' },
            event: { enabled: !!old.event, tag: 'EVENT', format: 'Name | Details | Keywords', instruction: 'Significant narrative events. Use a SHORT, STABLE Name — no timestamps in the name. Reuse the exact same Name when adding new information.' }
        };
    }

    // FAC tag: 3-field format -> 4-field (v2.2.3+) so Status and Description are separate prompts to the model
    if (s.routerModules?.fac?.format === 'Name | Description | Keywords') {
        s.routerModules.fac.format = DEFAULT_MODULES.fac.format;
    }

    // Ensure all stock modules have a format field (in case of old saves missing it)
    for (const [key, def] of Object.entries(DEFAULT_MODULES)) {
        if (s.routerModules?.[key] && !s.routerModules[key].format) {
            s.routerModules[key].format = def.format;
        }
    }

    // Ensure all custom tags have a format field
    if (Array.isArray(s.routerCustomTags)) {
        for (const ct of s.routerCustomTags) {
            if (!ct.format) ct.format = 'Name | Description | Keywords';
        }
    }

    // Strip legacy NPC line about State Memo (tracker memo UI is optional / unused in many setups)
    if (s.routerModules?.npc?.instruction && typeof s.routerModules.npc.instruction === 'string') {
        let ins = s.routerModules.npc.instruction;
        if (/their state lives in the State Memo/i.test(ins)) {
            ins = ins.replace(/\s*[\u2014\u2013-]\s*their state lives in the State Memo\.?\s*/gi, '. ');
            ins = ins.replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim();
            s.routerModules.npc.instruction = ins;
        }
    }

    return extensionSettings[MODULE_NAME];
}

// ── Router activation mode ─────────────────────────────────────────────────────

/**
 * Resolves the router's lorebook-activation mode: 'managed' | 'native'.
 * @param {Record<string, any>} [s] - settings object (defaults to getSettings())
 * @returns {'managed'|'native'}
 */
export function getActivationMode(s = getSettings()) {
    return s.routerActivationMode === 'native' ? 'native' : 'managed';
}

// ── Lorebook entry markers ─────────────────────────────────────────────────────
//
// In 'managed' mode every scoped entry carries disable:true so ST's native
// scanner stays out of the way (see router.js disableManagedEntries), which means
// `disable` cannot be used to mark an entry as "never surface this". These two
// flags, stored under entry.extensions, carry that intent instead.

/** Marks an entry as a recoverable backup: never scanned, indexed, or injected. */
export const LORE_INERT_FLAG = 'fatbodyInert';

/** Marks an entry as engine-written canon: always active, never budget-evicted. */
export const LORE_PINNED_FLAG = 'fatbodyPinned';

/**
 * True when a lorebook entry is an inert backup. Inert entries exist only so a
 * committed profile can be recovered from disk — they must never reach a prompt.
 * @param {any} entry
 */
export function isInertLoreEntry(entry) {
    return !!entry?.extensions?.[LORE_INERT_FLAG];
}

/**
 * True when a lorebook entry is pinned engine canon. Pinned entries are exempt
 * from the router's activation budget and cannot be deactivated by the agent.
 * @param {any} entry
 */
export function isPinnedLoreEntry(entry) {
    return !!entry?.extensions?.[LORE_PINNED_FLAG];
}

// ── Bar color resolver ─────────────────────────────────────────────────────────

/**
 * Returns the CSS background string for a bar element, respecting any
 * user-configured color overrides stored in settings.barColors.
 * @param {string} barId
 * @param {string} defaultBackground
 * @param {number|null} pct
 */
export function getBarBackground(barId, defaultBackground, pct = null) {
    if (!barId) return defaultBackground;
    const s = getSettings();
    const cfg = s.barColors?.[barId];
    if (!cfg) {
        const isHP = barId.endsWith(':HP') || barId.includes(':HPBAR');
        if (isHP && pct !== null) {
            return pct > 60 ? '#00ffaa' : pct > 30 ? '#ffaa00' : '#ff5555';
        }
        return defaultBackground;
    }

    if (typeof cfg === 'string') return cfg; // Legacy support

    switch (cfg.mode) {
        case 'gradient':
            return `linear-gradient(90deg, ${cfg.color}, ${cfg.color2 || cfg.color})`;
        case 'dynamic': {
            const p = pct !== null ? pct : 100;
            return p > 60 ? '#00ffaa' : p > 30 ? '#ffaa00' : '#ff5555';
        }
        case 'solid':
        default:
            return cfg.color;
    }
}

/**
 * Sanitizes a string into a lorebook-safe campaign prefix (same rules as chat-id derive).
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeCampaignPrefixString(raw) {
    if (!raw) return '';
    return String(raw).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Prefix used for world activation and router: optional user override, else from chat id.
 * @param {string} chatId
 * @returns {string}
 */
export function getEffectiveRouterCampaignPrefix(chatId) {
    const s = getSettings();
    const ov = (s.routerCampaignPrefixOverride || '').trim();
    if (ov) return sanitizeCampaignPrefixString(ov);
    return sanitizeCampaignPrefixString(chatId || '');
}

// ── One-time data migrations ───────────────────────────────────────────────────

/**
 * Migrates custom fields from legacy formats to the current template-based format.
 * Safe to call repeatedly — idempotent.
 */
/**
 * One-time, idempotent upgrade of the State Extractor prompt. Because existing
 * installs persist `systemPromptTemplate`, changing its default alone reaches no
 * one — getSettings() backfills undefined keys only. This force-upgrades installs
 * still on a known prior default, but never clobbers a user-customized prompt
 * (instead it flags `systemPromptUpdateAvailable` so the UI can offer a reset).
 * Safe to call repeatedly.
 */
export function migrateSystemPrompt(s) {
    if ((s.systemPromptVersion || 0) >= STATE_PROMPT_VERSION) return;

    const cur = s.systemPromptTemplate;
    const latest = DEFAULTS_TEMPLATE.systemPromptTemplate;

    if (cur === latest) {
        // Fresh install or already migrated — nothing to change.
    } else if (LEGACY_STATE_PROMPT_FINGERPRINTS.has(promptFingerprint(cur))) {
        s.systemPromptTemplate = latest; // untouched prior default → auto-upgrade
        if (s.debugMode) console.log(`[RPG Tracker] State Extractor prompt auto-upgraded to v${STATE_PROMPT_VERSION}.`);
    } else {
        s.systemPromptUpdateAvailable = true; // customized → preserve, surface notice
        if (s.debugMode) console.log('[RPG Tracker] State Extractor prompt is customized; upgrade available (not applied).');
    }

    s.systemPromptVersion = STATE_PROMPT_VERSION;
}

/**
 * One-time, idempotent upgrade of the four World Progression per-layer prompt
 * templates. Same contract as migrateSystemPrompt, but loops over each
 * template key independently so a user who customized only one layer's
 * prompt keeps their edit while the other three still auto-upgrade.
 * Safe to call repeatedly.
 * @param {Record<string, any>} s
 */
export function migrateWorldProgPrompts(s) {
    if ((s.worldProgPromptVersion || 0) >= WORLDPROG_PROMPT_VERSION) return;
    if (!s.worldProgPromptUpdateAvailable || typeof s.worldProgPromptUpdateAvailable !== 'object') {
        s.worldProgPromptUpdateAvailable = { worldArc: false, characterArc: false, regionalState: false, pacing: false };
    }

    const LAYER_BY_KEY = {
        worldArcSystemPromptTemplate: 'worldArc',
        characterArcSystemPromptTemplate: 'characterArc',
        regionalStateSystemPromptTemplate: 'regionalState',
        pacingSystemPromptTemplate: 'pacing',
    };

    for (const key of WORLDPROG_PROMPT_KEYS) {
        const cur = s[key];
        const latest = DEFAULTS_TEMPLATE[key];
        const layer = LAYER_BY_KEY[key];

        if (cur === latest) {
            // Fresh install or already migrated — nothing to change.
        } else if (LEGACY_WORLDPROG_PROMPT_FINGERPRINTS.has(promptFingerprint(cur))) {
            s[key] = latest; // untouched prior default → auto-upgrade
            if (s.debugMode) console.log(`[RPG Tracker] World Progression ${layer} prompt auto-upgraded to v${WORLDPROG_PROMPT_VERSION}.`);
        } else {
            s.worldProgPromptUpdateAvailable[layer] = true; // customized → preserve, surface notice
            if (s.debugMode) console.log(`[RPG Tracker] World Progression ${layer} prompt is customized; upgrade available (not applied).`);
        }
    }

    s.worldProgPromptVersion = WORLDPROG_PROMPT_VERSION;
}

export function migrateCustomFields() {
    const s = getSettings();

    migrateSystemPrompt(s);
    migrateWorldProgPrompts(s);

    // v2→v3: every pre-existing chat IS a D&D-mode campaign. Stamp the mode so
    // 3.0 code can branch on it without guessing; everything else is untouched.
    for (const state of Object.values(s.chatStates || {})) {
        if (state && typeof state === 'object' && state.campaignMode === undefined) {
            state.campaignMode = 'dnd';
        }
    }

    // Strip placeholder NEW_TAG entries persisted from previous sessions (one-time cleanup at init)
    if (Array.isArray(s.routerCustomTags)) {
        s.routerCustomTags = s.routerCustomTags.filter(t => t.tag && t.tag !== 'NEW_TAG');
    }

    (s.customFields || []).forEach(field => {
        // Migration 1: Convert single renderType to empty rows (old)
        if (field.renderType !== undefined && !field.rows && !field.template) {
            field.rows = [];
            delete field.renderType;
        }
        // Migration 2: Convert rows to template (New)
        if (field.rows && !field.template) {
            const UI_TO_MARKER = {
                'pills': 'PILLS', 'badge': 'BADGE', 'highlight': 'HIGHLIGHT',
                'hp_bar': 'BAR', 'xp_bar': 'XPBAR', 'text': 'TEXT', 'kv': 'TEXT'
            };
            field.template = field.rows.map(row => {
                const marker = UI_TO_MARKER[row.renderType] || 'TEXT';
                const content = row.label || '';
                return `((${marker})) ${content}`;
            }).join('\n').trim();
            delete field.rows;
            delete field.renderType;
        }
    });
}

// ── Chat-linked state persistence ─────────────────────────────────────────────

/**
 * Snapshots the current live settings into chatStates[chatId].
 * Pure write — no shared mutable state, no DOM.
 * @param {string} chatId
 */
export function saveChatState(chatId) {
    if (!chatId) return;
    const s = getSettings();
    if (!s.chatStates) s.chatStates = {};
    // Preserve fields that are written outside the normal save cycle (e.g. campaignBooks)
    const existing = s.chatStates[chatId] || {};
    s.chatStates[chatId] = {
        currentMemo:  s.currentMemo,
        memoHistory:  JSON.parse(JSON.stringify(s.memoHistory)),
        lastDelta:    s.lastDelta || '',
        modules:      JSON.parse(JSON.stringify(s.modules)),
        blockOrder:   JSON.parse(JSON.stringify(s.blockOrder  || BLOCK_ORDER)),
        stockPrompts: JSON.parse(JSON.stringify(s.stockPrompts || DEFAULT_STOCK_PROMPTS)),
        customFields: JSON.parse(JSON.stringify(s.customFields || [])),
        quests:       [],  // quests are derived from currentMemo on load — not persisted separately
        historyIndex: s.historyIndex ?? -1,
        activeRouterKeys: JSON.parse(JSON.stringify(s.activeRouterKeys || [])),
        keywordActivatedKeys: JSON.parse(JSON.stringify(s.keywordActivatedKeys || [])),
        pinnedRouterKeys: JSON.parse(JSON.stringify(s.pinnedRouterKeys || [])),
        routerLog:    JSON.parse(JSON.stringify(s.routerLog || [])),
        routerCampaignPrefix: s.routerCampaignPrefix || '',
        routerLookback: s.routerLookback || 4,
        routerDirectPrompt: s.routerDirectPrompt || '',
        // Preserve lorebook stack link — written by Link button and router, not by normal state saves
        campaignBooks: existing.campaignBooks || [],
        // v3.0 campaign fields — written at campaign creation / by the progression
        // engine, never by the normal save cycle. Mode is locked at creation.
        campaignMode: existing.campaignMode || 'dnd',
        foundation: existing.foundation,
        progression: existing.progression,
        // Onboarding flow flag (mode picked on the empty-state HUD) — written by
        // the onboarding UI, must survive the save cycle until a memo exists.
        onboarding: existing.onboarding,
        // World Progression session-local state — written by world-progression.js
        // directly, never by the normal save cycle (same class as foundation/progression above).
        worldProg: existing.worldProg,
        // v4.0 Origins state ({draft, committed, nsfw}) — written by the Origins
        // wizard directly, never by the normal save cycle. Must be preserved
        // here or the next saveChatState would silently wipe it.
        origin: existing.origin,
    };
    SillyTavern.getContext().saveSettingsDebounced();
}

/**
 * The locked campaign mode for a chat: 'dnd' (classic) or 'modern' (v3.0).
 * Chats never seen before default to 'dnd' — Modern is opt-in at creation.
 * @param {string} chatId
 * @returns {'dnd'|'modern'}
 */
export function getCampaignMode(chatId) {
    const s = getSettings();
    const mode = s.chatStates?.[chatId]?.campaignMode;
    return mode === 'modern' ? 'modern' : 'dnd';
}

/**
 * Whether the active chat is ready to start a World Arc: a Modern campaign
 * with its class locked, or a D&D campaign (no class-lock concept exists for
 * D&D in this codebase — classes are fluid/multiclass, so onboarding is
 * considered complete once the ruleset itself is picked). An Origins commit
 * (v4.0) deletes the onboarding flag, so a committed origin also counts as
 * D&D-ready.
 * @param {object|null|undefined} chatState - settings.chatStates[chatId]
 * @param {string} chatId
 * @returns {boolean}
 */
export function isOnboardingArcReady(chatState, chatId) {
    const modernReady = getCampaignMode(chatId) === 'modern' && !!chatState?.progression?.classId;
    const dndReady = chatState?.onboarding?.mode === 'dnd' || !!chatState?.origin?.committed;
    return modernReady || dndReady;
}

/**
 * Whether the Main HUD should show the "start your World Arc" onboarding gate
 * instead of the normal character-state card view. All inputs are passed in
 * (no RT/DOM/settings access here) so this stays a pure, unit-testable check —
 * the caller is responsible for resolving chatState, arcExists, and whether
 * the gate was skipped this session.
 * @param {object|null|undefined} chatState - settings.chatStates[chatId]
 * @param {string} chatId
 * @param {boolean} arcExists - true once a milestone chain has been compiled
 * @param {boolean} skippedThisSession - true if the user dismissed the gate this session
 * @returns {boolean}
 */
export function shouldShowWorldArcGate(chatState, chatId, arcExists, skippedThisSession) {
    if (skippedThisSession || arcExists) return false;
    return isOnboardingArcReady(chatState, chatId);
}

// ── Profile I/O ───────────────────────────────────────────────────────────────

/**
 * Saves the current tracker state into a named profile slot.
 * @param {string} name
 */
export function saveProfile(name) {
    const s = getSettings();
    if (!name) return;
    if (!s.profiles) s.profiles = {};
    s.profiles[name] = {
        currentMemo: s.currentMemo,
        memoHistory: JSON.parse(JSON.stringify(s.memoHistory)),
        modules: JSON.parse(JSON.stringify(s.modules)),
        blockOrder: JSON.parse(JSON.stringify(s.blockOrder || BLOCK_ORDER)),
        stockPrompts: JSON.parse(JSON.stringify(s.stockPrompts || DEFAULT_STOCK_PROMPTS)),
        customFields: JSON.parse(JSON.stringify(s.customFields || [])),
        // quests are derived from currentMemo on load — not persisted separately
        lastDelta: s.lastDelta || '',
        historyIndex: s.historyIndex ?? -1,
        activeRouterKeys: JSON.parse(JSON.stringify(s.activeRouterKeys || [])),
        routerLog:    JSON.parse(JSON.stringify(s.routerLog || [])),
        routerCampaignPrefix: s.routerCampaignPrefix || '',
        routerLookback: s.routerLookback || 4,
        routerDirectPrompt: s.routerDirectPrompt || '',
    };
    s.activeProfile = name;
    SillyTavern.getContext().saveSettingsDebounced();
}

/**
 * Deletes a named profile slot.
 * @param {string} name
 */
export function deleteProfile(name) {
    const s = getSettings();
    if (!s.profiles?.[name]) return;
    delete s.profiles[name];
    if (s.activeProfile === name) s.activeProfile = '';
    SillyTavern.getContext().saveSettingsDebounced();
}
