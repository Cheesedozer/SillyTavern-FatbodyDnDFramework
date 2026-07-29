# Changelog

All notable changes to the **Origins RPG Framework** (formerly the Fatbody D&D Framework) will be documented in this file.

## [Unreleased]

**Origin creation keeps its promises.** Playtesting found the wizard blocking completion on three fields it explicitly labelled as AI-proposed, and the generator hanging Silkborn hivemind canon on a Dragonborn.

### Fixed
- **"Empty → AI proposes" now actually works.** `validateDraft` rejected an empty **Nation name** and **Pursuer identity** before generation ever ran, and `checkLeverGuarantee` did the same for **Leverage** on Exiled Royal / Defector Spy — all three sitting directly under UI labels promising the AI would fill them. The draft gate now checks only the structured selects (government, environment, majority race, pursuer affiliation/motive/capability/awareness) that the model cannot infer. The Lever Guarantee moved to where it belongs: `validateOriginProfile` rejects a *generated* profile with a blank leverage, and the repair loop retries — so the guarantee holds without the player having to type it.
- **"⚒️ Forge me a character" was completely broken.** `randomizeSelections` deliberately leaves those same three fields empty, so the one-click path always died on `Fix first: Nation name is empty.` The test suite masked it by hand-injecting placeholder values before asserting; that fixture is gone and a regression test now runs a randomized draft through `validateDraft` untouched.
- **Silkborn canon leaked onto other races.** Three independent routes, all closed: the Chorus-Weave setting anchor was injected into *every* generation prompt regardless of race (`anchorsForDraft` now withholds `raceLocked` anchors unless the character is that race or their nation runs hive consensus); Exiled Royal's own `leverPersonal` string named the Silkborn branch to every race taking that origin (split into `leverPersonalByRace`, resolved by `personalLeverFor`); and nothing validated the result (`checkRaceExclusivity` now rejects a profile carrying another race's signature mechanic, feeding the term back through the existing repair loop).
- **Levers were written in system vocabulary.** The `[ORIGIN]` block is both the narrator's context and the player's HUD card, so a lever described as "the Silkborn Severance Block … acting as her personal lever" was rendered straight to the player. The schema spec now marks `socialLever.text`, `personalLever.text`, `currentGoal`, and `personalityVoice` as player-facing and requires in-fiction phrasing; mechanical framing belongs in the narrator-private `questSeeds`.
- **Physical description never reached the narrator.** The appearance descriptors were used once at generation and then dropped from the memo, the lorebook, and the HUD — so in play the narrator had only whatever the model folded into the backstory. A compact `Appearance:` line now rides in `[ORIGIN]` (fixing the HUD gap and the context gap together), with the full field-by-field detail in a keyword-triggered `_Origin` lorebook entry.
- **The NSFW intimate section collected data that went nowhere.** `INTIMATE_FIELDS` was imported by the engine and never referenced — six fields written to the draft and read by nothing. They now feed the generation prompt (NSFW-gated, so an SFW draft can never carry them into a call whose system message asserts SFW) and a lorebook entry, and are deliberately kept out of the always-on memo the HUD renders. Turning NSFW off now clears them unconditionally rather than only when a selections object exists.
- The HUD header read **Fatbody D&D Framework**; it now matches the v4.0 rebrand.

### Added
- **Anti-generic directive in every generation prompt** (`ANTI_GENERIC_DIRECTIVE` / `antiGenericBlock`): a self-check against reasoning from genre convention, or from the most vivid fixture already in context, instead of from the player's actual selections — with a per-prompt tail for origin profiles, opening narration, stat sheets, and the World Arc compiler. The Dragonborn/Chorus-Weave bug was this failure mode; the prompt guard pairs with the hard anchor gate and the validator above.

### Changed
- **The world-threat tie-in is a private seed until a World Arc exists.** It was rendered in the HUD as locked canon the moment an origin committed, promising a campaign-scale thread nothing had committed to. `buildOriginMemoBlock` now withholds it; the review-step field is relabelled "Arc hook — seeds your World Arc, not yet canon"; and `commitCentralTension` publishes the compiled `epicConflict` back into `[ORIGIN]` as the real tie-in. The existing "🧬 From my origin" compiler mode is unchanged and still reads the seed — World Arc categories and blurbs needed no changes.

## [4.0.1] - 2026-07-28

**The HUD can be reopened from settings.** Closing the HUD with the header ✕ left no way back from either settings surface — the only reopen path was a wand-menu item that was easy to miss, and easy to lose entirely.

### Added
- **"Show HUD" button in the extensions drawer** (`settings-stub.html`) and a **"Show HUD panel" checkbox** in the settings overlay's General tab (`settings.html`). Both toggle the HUD, stay in sync with each other, with the wand-menu item, and with the header ✕. Re-showing a HUD whose element has gone missing rebuilds it via `createPanel()` instead of doing nothing.
- **`/hud` slash command** (`show` / `hide` / `toggle` / `reset`) — the last-resort way back, since it needs no extension UI to be reachable.
- **"Reset HUD position" button** on both settings surfaces, and `resetPanelGeometry()` in `panel-geometry.js`. Rebuilds the panel, un-hides it, un-collapses it, and discards saved position/size so it returns to its default corner.
- `globalThis._rpgSetHudVisible(visible)` and `globalThis._rpgResetHud()` as console escape hatches, mirroring the existing `_rpgSetWorldProgHudVisible`.

### Changed
- **HUD visibility now persists** as `settings.hudHidden`. Previously the ✕ set an inline `display: none` that nothing recorded, so a closed HUD silently reappeared on every reload; now the choice is respected across sessions, and the new settings controls are the way back.
- The wand-menu item is labelled **"Origins RPG Framework"** (was the pre-rebrand "Fatbody D&D Framework", which no longer matched the extensions drawer).

### Fixed
- **A fresh install of this repo was completely broken.** `env.js` resolved the install folder by matching the script URL against a hardcoded list of *legacy* names (`SillyTavern-FatbodyDnDFramework`, `SillyTavern-RPGStateTracker`) and fell back to the pre-rebrand name. Installing under the current repo name — which is what cloning or SillyTavern's "install from URL" produces — matched nothing, so `FOLDER_NAME` pointed at a directory that does not exist and every template, sysprompt, setting-card and asset fetch 404'd, taking the whole settings UI with it. Resolution now comes from `import.meta.url`, which is correct for any folder name including user renames; the DOM probe remains as a secondary fallback and the final fallback is the current name.
- **Hiding the HUD corrupted its saved geometry.** A hidden element measures as all-zeros, and the `ResizeObserver` fires on hide — so closing the HUD wrote `{0,0,0,0}` over good geometry. `savePanelGeometry()` now refuses to persist a hidden or degenerate measurement.
- **Non-finite saved coordinates could strand the panel with no anchor.** `Math.max(0, Math.min(w, NaN))` is `NaN`, which invalidated the `left`/`top` declarations *after* `right`/`bottom` had been set to `auto`, leaving the fixed-position panel with nothing to position against. Such values are now dropped rather than clamped, and off-screen positions keep a visible margin on screen.
- `setHudVisible(true)` now verifies the panel actually landed on screen and resets its geometry if not — showing the HUD always produces a *visible* HUD.
- The wand-menu item is no longer lost for the whole session when SillyTavern's `#extensionsMenu` isn't built yet at init — `addWandButton()` retries instead of returning permanently, and replaces a stale button left by a previous init.
- The wand item toggles the persisted state rather than the raw inline style, so it no longer *hides* a HUD that is visible but merely unnoticed, and no longer dead-clicks when the panel element is absent.
- Settings templates are fetched with real cache-busting. `renderExtensionTemplateAsync`'s third argument is Handlebars *template data*, not a cache-buster, so `{ v: Date.now() }` never forced a refetch and an updated settings pane could be served stale after an update.

## [4.0.0] - 2026-07-28

**The Origins update — BG3-style character creation, an original setting, and the rebrand to Origins RPG Framework.** D&D-mode onboarding gains a full character-creation system inspired by Baldur's Gate 3's origins: pick a race and appearance, choose one of eight origins with real mechanical hooks (a *social lever* NPCs react to and a *personal lever* that pressures you over time), and commit into a campaign where the narrator, tracker, quests, Central Tension, and Lorebook Agent all know who you are. The full design lives in `docs/origins-spec-v2.md`; everything integrates with existing systems rather than duplicating them.

### Added
- **Origins creation wizard** (`origins-wizard.js`): a full-screen six-step overlay (campaign options → race → appearance → origin → origin details → review & commit) opened from the new 🧬 entry on the D&D onboarding step. Drafts persist per chat (`chatStates[chatId].origin.draft`) and survive reloads with a "Resume — step N" button; per-step 🎲 Random buttons and a one-click **⚒️ Forge me a character** path randomize everything and land on review. The classic archetype quick-roll remains untouched below it.
- **Twelve races and eight origins** (`origins-data.js`): Aasimar, Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling, Vampire, and the original hivemind **Silkborn** — each with reference data (habitat, lifespan, naming, appearance ranges) that seeds nation defaults and AI proposals. Origins: Exiled Royal, Vampire Lord, Freed Undead Minion, Oathbreaker Knight, Willing Cultist, Artifact-Bound Nobody, Abandoned Champion, Defector Spy — each with story blanks, enumerated modifiers, a Core Nation Block (12 culture vibes with AI-internal descriptions, government/environment lists), a Pursuer Block, incompatibility rules, and narrator-private quest directions.
- **Origins engine** (`origins-engine.js`, pure/node-tested): live incompatibility enforcement (hard blocks disable options with the rule's reason; soft tensions require an in-fiction explanation; narrative rules feed generation), the **Lever Guarantee** (no combination of choices can produce a character without an active personal lever — substitutes are offered where a default lever is disabled), the race–origin matrix (Vampire race locks to Vampire Lord / Exiled Royal), and the generate → validate → retry(≤3) profile compiler contract.
- **The world of Vaelmarch**: an original post-imperial setting built so dynamically generated nations are canon-safe — the fallen Argent Concord, the Order of the Sealed Lamp, the Six Houses, and the Silkborn Chorus-Weave are the only fixed anchors. Ships as a Character Card V2 setting-narrator (`setting-cards/vaelmarch.json`) with an **empty first message by design**, installable in one click from the wizard (`/api/characters/import`) or manually from the repo.
- **Generated opening scene**: committing generates the campaign's first message from the finished profile via the narrator connection (state-model fallback), with an in-medias-res / quiet-start frame choice and free regeneration *before* it is inserted as the chat's first assistant message.
- **`[ORIGIN]` memo block** (`module-registry.js`, appended last, opt-in per campaign like `SKILLS`): a compact engine-written canon block the state extractor may only touch on the "Current Goal" line. Full canon (backstory, nation, pursuer, quest directions) lives in a new `${prefix}_Origin` campaign lorebook written at commit.
- **`<origin_levers>` sysprompt section** (classic-mode files + additive delivery): narrator rules for honoring the levers, advancing the pursuer plausibly, surfacing origin quests lazily through the normal quest flow, and never silently resolving intentional tensions. Self-gates on the presence of an `[ORIGIN]` block.
- **Central Tension "🧬 From my origin" mode** (`central-tension-compiler.js`): with a committed origin, the World Arc gate preselects a fourth compiler mode that seeds `intimateConflict` from the personal lever and `epicConflict` from the world-threat tie-in, reusing the origin's named nation/pursuer canon.
- **Origin-tagged quests**: `LogQuest` gains an optional `origin_thread` parameter; tagged quests carry `source: "origin"` and an `[origin: …]` marker in the injected active-quest text (JSON quest mode; the legacy text serializer drops the tag).
- **Origins settings tab**: offer-during-onboarding toggle, the NSFW default for new campaigns, and the `origin_levers` sysprompt toggle.
- **Master NSFW toggle per campaign**: one switch on the wizard's first step gates the Intimate Physical Details appearance section, mature worldbuilding modifiers, and the gated culture vibe — each remaining an individual opt-in, all off by default.

### Changed
- **Rebranded to Origins RPG Framework, v4.0.0**: `manifest.json` display name, onboarding header, settings stub, skill-tree tab title, and toast titles. Internal identifiers are untouched (settings key `rpg_tracker`, `rt-`/`rpg-` CSS prefixes, the `FatbodyRollTheDice` tool name, Megumin's `[[FATBODY]]` block contract), so existing installs, settings, and integrations survive unchanged.
- `saveChatState()` now preserves the new per-chat `origin` slot; `isOnboardingArcReady()` treats a committed origin as D&D-ready (the wizard deletes the onboarding flag at commit, mirroring the foundation commit).
- Tests: 322 passing (49 new across `test/origins-data.test.js`, `test/origins-engine.test.js`, and extensions to the onboarding/state-manager/sysprompt suites), including a property test that randomized selections validate for every origin across 25 seeds.

## [3.6.0] - 2026-07-05

**Universal Inline Markers, Enemy Tier Scaling, and Legendary Tier.** Extends the v1.7.0 "Universal Marker Support" initiative from module *coverage* to marker *placement*, adds four new generic marker types styled after the Quest Log's own widgets, and gives the narrator concrete guidance for scaling enemies to quest difficulty and player level.

### Added
- **Inline marker placement**: `((BAR:50/100))`-style inline arguments let any marker (`((PILLS))`, `((BAR))`, `((BADGE))`, `((HIGHLIGHT))`, etc.) appear anywhere in a line, not just at the start — e.g. `Health: ((BAR:45/100))`. The legacy `((BAR)) rest of line` form is unchanged and fully backward compatible with existing saved memos.
- **Four new generic markers**: `((OBJ))`/`((OBJ:done))`/`((OBJ:failed))` (checklist objectives), `((REWARD))` (gold-style reward chip), `((DIFFICULTY))` (color-coded difficulty badge), `((PROGRESS))` (mini animated progress bar + counter) — usable in any stock or custom field, independent of the dedicated Quest system's own data model. Documented via new entries in the custom-field editor's `EXAMPLES` sandbox text.
- **NPC tier scaling guidance**: the `<combat>` NPC TIERS section now instructs the narrator to scale enemy strength to the active quest's difficulty and the player's level when a scene is quest-tied (Very Easy/Easy below level, Medium at level, Hard/Very Hard above level up to brutal), while explicitly telling it NOT to force level-matching for freeform/non-quest encounters. This guidance is gated behind the existing "Quest Difficulty" toggle (`buildSysprompt()`) and collapses to a short evergreen line when that toggle is off, since there'd be no difficulty value for it to reference.
- **Legendary NPC tier**: a 5th tier (HP 150–500+, AC 19–22, ATK +11 to +15, saves +8 to +12) added above Boss, for world-threat-scale encounters, in both classic and Modern (non-numeric) sysprompts.

### Changed
- Consolidated the two duplicated marker regex/type-map implementations in `renderer.js` (`tryRenderMarker` and `blockToItems`'s COMBAT/PARTY/CHARACTER case) into a single shared `MARKER_NAMES`/`MARKER_TYPE_MAP`/`MARKER_TOKEN_RX` source.

## [3.5.0] - 2026-07-05

**Live Megumin Suite compatibility.** Megumin's `[[FATBODY]]` block previously shipped its own frozen, hand-pasted snapshot of Fatbody's rules text — no live connection to Fatbody at all, so it silently drifted out of sync with Fatbody's actual current tag set and module toggles. Replaced with a real (opt-in, feature-detected) handshake.

### Added
- **`globalThis._rpgGetAdditiveSysprompt()`**: a synchronous, cached read of Fatbody's current additive-mode (rules-only) sysprompt text, published for the Megumin Suite's `[[FATBODY]]` block to pull live instead of using its own bundled static copy. Follows the existing `_rpgGetActivationMode`-style cross-extension global convention. Backed by a new module-level cache in `sysprompt.js`, refreshed on the same triggers as Fatbody's own sysprompt (settings changes, chat switch, boot) plus a new `globalThis._rpgRefreshAdditiveSysprompt()` nudge Megumin can call right after its own block toggle changes.
- **`detectMeguminFatbodyBlock()`** (`world-progression.js`): a read-only detector, sibling to the existing `detectMeguminOverlap()`, reporting whether Megumin's `fatbody` block is enabled for the current profile.
- **Automatic double-injection suppression**: when Suite Mode is on and Megumin's `fatbody` block is detected active, Fatbody now automatically skips its own additive extension-prompt push — Megumin's live pull becomes the single source of mechanics. Previously this was purely advisory (a toast warning telling the user not to combine both); nothing prevented it in code. The suppression requires Suite Mode as an explicit precondition (not just Megumin's flag alone) to avoid silently dropping mechanics if that flag is stale.
- The Suite Mode / Additive Delivery warning toast now checks whether Megumin's block is actually active before firing, and distinguishes the safe case (info: "handled automatically") from the real remaining risk case — additive delivery + Megumin's block active without Suite Mode, which still double-injects.

### Changed
- Settings tooltips (Sysprompt Delivery, Suite Mode) and the README's "Running with Other Extensions → Megumin Suite" section now describe the live-pull setup (both Suite Mode and Additive delivery on) instead of the old "pick exactly one" guidance.
- `commitFoundationAndInit()`'s two call sites (onboarding default-foundation path, Foundation Builder wizard) now call `scheduleAutoApply()` after committing — previously, locking a chat into Modern mode never refreshed Fatbody's own sysprompt or the new additive cache until some unrelated trigger fired.

Note: the live-pulled additive text is prefixed with Fatbody's existing `ADDITIVE_HEADER` preamble, which Megumin's old hardcoded copy didn't include — a minor, expected content-shape change for anyone upgrading into this setup.

## [3.4.1] - 2026-07-02

**World Progression bug-hunt.** A round of end-to-end testing (real browser, live LLM-round-trip driving) on 3.4.0 turned up several bugs severe enough that the Character Arc and Regional State layers were effectively non-functional in normal play. All fixed; the author's unit suite plus new regression coverage (229 tests) and a live E2E roleplay session both pass.

### Fixed
- **World Progression HUD crashed the entire settings UI on load**: `renderWorldProgHud()` referenced an undeclared `ctx`, thrown synchronously from `createPanel()` during `init()` — since the World Progression HUD markup is always in the DOM regardless of `worldProgEnabled`, this aborted the rest of extension init (including the settings-tab/wand-button wiring) for every single user on every load, not just World Progression users.
- **Character Arc beats could only ever fire once per NPC, forever**: nothing cleared `pendingBeat` after it was staged, and `candidateCharacterArcBeats`'s no-double-staging guard permanently excluded any NPC with a pending beat from ever being offered another one. A new deterministic, no-LLM check (`resolveSurfacedBeats`, mirroring the existing engagement-scan convention) clears it once the NPC's name reappears in the narrative.
- **NPCs and regions had no `name` field at all**: `characterArc.beats[]`/`regionalState.regionUpdates[]` never asked the model for one, so engagement scoring (`computeEngagementDeltas`) and region re-entry (`resolveCurrentRegionId`) — both name-substring matches — silently never worked for anything the model itself introduced. `name` is now a required field in both, threaded through into stored state.
- **A second NPC or region could never be tracked**: `validateWorldProgressionCommit` rejected any `npcId`/`regionId` that didn't already exist once at least one did. NPCs and regions are meant to be discovered organically (unlike the fixed milestone/faction set from the compiler), so this check is removed for those two ids specifically; faction/milestone ids remain strictly validated.
- **Regional State could never track a first-ever region in normal play**: `resolveCurrentRegionId` only matches already-known regions, so a brand-new `(Location: ...)` never activated the layer. A location footer that matches no known region now still activates Regional State so the LLM can create one.
- **World Progression HUD and the Settings tab's campaign summary didn't refresh after compiling a Central Tension**: both stayed on "no campaign yet" until manually refreshed or the settings overlay was reopened, since the wizard's commit handler never called their render functions.
- **`MESSAGE_DELETED`/`MESSAGE_SWIPED` listeners stamped a stub `worldProg` record onto every chat**, even for users who never enabled World Progression, because `reconcileWorldProgRollbacks` created chat state unconditionally before its own early-return check. Now gated on `worldProgEnabled`.

## [3.4.0] - 2026-07-01

**World Progression System.** A four-layer engine — World Arc, Character Arcs, Regional State, and Pacing — that gives the narrator pacing awareness and a world that evolves between player turns: faction moves, NPC arc beats, regional condition changes, and tempo (Exploration/Escalation/Crisis/Aftermath) all tracked in the background and reconciled into a single per-cycle commit call. Off by default (`worldProgEnabled`); existing chats/campaigns are unaffected until enabled.

### Added
- **World Progression settings tab**: master toggle, an independent connection-source dispatcher (Main API / Connection Profile / Ollama / OpenAI — OpenRouter via a Connection Profile pointed at it, same as any other profile), four editable per-layer prompt templates with individual reset buttons, and a Debug/Manual Controls section (force tempo, force phase gate, run reconciliation now, fork world state).
- **Central Tension compiler**: a "Start World Arc" wizard that seeds a campaign's central conflict from 3-4 picked categories (10 starter categories spanning apocalyptic and lower-stakes tones), free-text, or purely from the active character card. Whichever input is chosen, it's always expanded by the model into a validated 5-8 item milestone chain, 0-4 faction seeds (written as real FAC lorebook entries), and Chapter 1's 3-5 seeds — the raw input is never used as the working tension itself.
- **Adaptive, throttled cycle**: cheap deterministic checks (no LLM) decide each cycle whether World Arc, Character Arc, or Regional State actually need a commit call; Pacing evaluates every cycle for free via pure pressure-gauge/tempo math and reaches the narrator through `setExtensionPrompt`, with no interceptor changes. The feature has its own throttle, independent of the Lorebook Agent's `routerRunEvery`, with a critical-pressure escape hatch.
- **Chapter/seed/convergence lifecycle**: seeds, developments, and convergences accumulate per chapter; a six-criterion phase-gate check (primary convergence resolved, plus a majority of five supporting conditions) triggers automatic chapter advancement and a full-context reconciliation pass.
- **World Progression HUD**: a togglable, editable panel (raw-JSON edit mode) showing the tracked snapshot — tempo, pressure gauge, milestones, factions, character arcs, regions — for player-side debugging. Pure render of already-tracked state; never triggers an LLM call itself.
- **Swipe/delete rollback**: every applied update is recorded as an invertible micro-patch anchored to the message that triggered it; deleting or swiping that message rolls the change back automatically.
- **Branch/checkpoint forking**: a chat that turns out to be a checkpoint/branch of an existing campaign gets its own independent copy of the world state rather than silently sharing the live one, via a best-effort heuristic plus a manual "Fork World State" fallback.
- **Megumin Suite overlap detection**: a read-only, dismissible warning when Megumin's NPC Bank or Story Planner/Evolving Arc are active alongside World Progression, since both track similar things.
- Cross-chat World Arc/faction/character-arc state is keyed by the same campaign-prefix convention the Lorebook Agent already uses to group lorebooks — no new "World ID" concept to manage.

## [3.3.0] - 2026-06-12

### Removed
- **Semantic (VectFox) entry-activation mode**: Fatbody is now the only extension that handles its campaign books — VectFox 3.5.0 dropped the cross-extension surfacing handshake on its side. Chats with `Entry Activation → Semantic (VectFox)` are migrated back to **Managed** automatically (one-time, on settings load). The Lorebook Agent's semantic-mode writer-only behavior (no activate/deactivate tooling, no budget) is gone with it.

### Changed
- **Entry Activation** is now a two-way choice: **Managed (Fatbody)** or **Native (ST keywords)**. The `_rpgGetActivationMode` global is still published for older VectFox versions, but only ever reports those two values.

## [3.2.4] - 2026-06-10

### Fixed
- **Lorebook Agent lookback & direct prompt now round-trip per chat**: both fields were saved with the chat but never restored on switch, so the previous chat's values silently carried over. They restore with the chat's saved state (lookback defaults to 4, direct prompt clears), and the settings input syncs.
- **Custom foundation resources no longer shadowed by D&D field rules**: a Modern resource named e.g. "Status" or "Skills" rendered via the stock D&D pill/text rule instead of as a pool bar. Foundation resources now take precedence in Modern chats; non-`X/Y` values (e.g. "Status: Poisoned") still use the stock rules.

## [3.2.3] - 2026-06-10

**Re-commit guard & late-pass safety.** The two remaining high-priority findings from the 3.2.2 bug hunt.

### Fixed
- **Foundation re-commits can no longer orphan a live campaign**: committing a v2+ foundation that drops the locked class id or a resource id that forged skills cost is now blocked with a precise list of what must be kept (display names may still change freely). The Foundation Builder surfaces the errors in the conversation log so "Keep refining" can feed them straight back to the architect. Also fixed the wizard's commit-failure status being immediately overwritten by "Ready." — errors were invisible.
- **State passes that finish after a chat switch no longer touch the wrong chat**: the memo merge now runs against the pass-start snapshot (previously the merge base was re-read *after* generation, blending one chat's update into another chat's memo), and the result — memo, history snapshots, delta — is committed into the originating chat's saved state instead of the live view, with an info toast. The work of the LLM call is preserved and restores when you switch back.

## [3.2.2] - 2026-06-10

**Bug hunt.** A systematic sweep of Modern mode and the new onboarding code.

### Fixed
- **Cross-chat state corruption from the Skill Tree tab**: applying or resetting skills in a tab whose chat was no longer the active chat snapshotted the *currently viewed* chat's memo/history into the tab's chat (wholesale overwrite) and wrote the [SKILLS] block into the wrong chat's live memo. Bridge mutations are now active-chat-aware: inactive chats are edited only in their own saved state, and the passive-skill extractor pass is deferred with a hint instead of running against the wrong chat.
- **Onboarding UI duplicated into detached panels**: a detached block panel on an empty chat rendered the full onboarding flow (duplicate element IDs, double-bound action buttons). Detached panels now show a simple placeholder until the campaign starts.
- **Modern settings leaking into other chats**: committing a foundation enables the [SKILLS] module and swaps the [CHARACTER] prompt for the campaign — but those live mutations carried into freshly created chats and into chats saved before the keys existed. Entering a non-Modern chat now resets both.
- **Class choice trapped after a failed forge**: picking a class locks it before the skill forge runs; if the forge failed before producing anything, the dead choice stayed locked. The lock is now released when nothing was forged (partially-forged classes still resume).
- **Level-ups applied to the wrong chat**: a state pass finishing after a chat switch resolved the chat *at completion time*, applying XP/level-ups to whichever chat the user had switched to. The chat is now captured when the pass starts.
- **XP line unparseable at max level**: the `(MAX)` form written at the level cap didn't match the XP parser.
- **Skill Tree tab hardening**: AI-generated rarity colors are escaped before being interpolated into tooltip markup; a global `[hidden] { display: none !important; }` rule prevents any future author-CSS/hidden conflicts; null-safe node lookups.

## [3.2.1] - 2026-06-10

**Skill tree unblocked & Modern HUD stats.** Fixes the invisible click-blocker over the skill tree and makes Level, Stamina, Mana (and any custom foundation resource) visible in the tracker right after Modern character creation.

### Fixed
- **Skill tree "No skills forged yet" overlay**: a CSS `display` rule defeated the `[hidden]` attribute, so the overlay stayed visible over a fully forged constellation and — spanning the whole canvas — swallowed every click, making nodes unselectable. The overlay now hides properly and is click-through even when shown.
- **Stale skill tree tab**: a tab left open during class selection or background tier pre-generation now receives the freshly forged nodes immediately instead of waiting for a reopen.
- **Level missing after Modern character creation**: the direct-prompt path used for initial setup skipped the modern progression step, so the `[XP]` block (level + XP bar) was never written. It now runs the same engine normalization as regular state passes.

### Added
- **Resource pool bars**: `[CHARACTER]` lines matching a foundation resource (Stamina/Mana/Focus by default, any name in custom foundations) render as recolorable bars with distinct default colors, like HP.
- **Foundation-aware character prompt**: committing a foundation swaps the per-chat `[CHARACTER]` module prompt to one built from the foundation's resources, so the state model keeps Level and every pool line alive across turns (D&D chats keep the stock prompt).

## [3.2.0] - 2026-06-10

**Onboarding flow.** New chats now start from a mode picker in the Stat Tracking HUD, and Modern campaign setup lives in the HUD instead of the Foundation Builder modal.

### Added
- **Mode picker**: an empty chat first asks **🐉 D&D** or **🛠️ Modern**. D&D leads to the classic archetype window; Modern offers **⚡ Default** (commits the built-in "Awakened World" foundation immediately) or **🏗️ Custom** (the Foundation Builder interview). Back navigation between pre-commit steps; the flow resumes where you left off after a reload or chat switch.
- **HUD class selection (Modern)**: starting classes are now picked directly in the HUD. Picking a class forges its starting skill tiers **and generates a Level 1 starting character** into the chat (foundation-aware: resource pools instead of spell slots), so the tracker populates immediately. Forge progress and a resumable retry surface are built in.
- **Persona class choice**: both modes now let you pick the class your persona character is built as — a classic-class dropdown next to the D&D 🎭 Persona button ("Let AI decide" remains the default), and the foundation's roster in Modern.

### Changed
- **Class crests → emojis**: Modern classes show emoji crests (⚔️ 🥋 🎶 🗡️ 🏹 🧙); AI-generated custom classes fall back to a role-based emoji.
- **Foundation Builder**: the Quick Start (⚡) button moved out of the wizard — it is now the Modern "Default" path in the HUD. Committing a custom foundation closes the wizard and hands off to the HUD class-selection screen.
- Pre-existing chats with an empty memo now see the mode picker (one extra click); existing campaigns with tracked state are unaffected.

## [3.1.0] - 2026-06-10

**Settings window & Modern Quick Start.** Settings move out of the cramped extensions dropdown into a full-screen window, and Modern mode gets a one-click default foundation so any character can start playing immediately.

### Added
- **Settings overlay (⚙️)**: a full-screen, Path-of-Exile-style settings window with a tabbed layout — General, Narrator & Quests, Visuals, State Model, Lorebook Agent, and Advanced — that uses horizontal screen space instead of stacking everything vertically. The extensions dropdown now holds only the master Enable toggle, the **Open Settings** button, and the 🏗️ Foundation Builder / 🌳 Skill Tree quick buttons. The window follows the tracker's visual theme.
- **Settings background art**: a built-in SVG scene of a modern soldier facing a fire-breathing dragon — D&D mode meets Modern mode. Drop your own image at `assets/settings-bg.png` inside the extension folder and it replaces the built-in art automatically.
- **Quick Start (⚡)**: a button in the Foundation Builder that commits a built-in, schema-valid default foundation ("The Awakened World") without the AI interview — six classic starting classes (**Fighter, Monk, Bard, Rogue, Ranger, Wizard**), Stamina/Mana/Focus resource pools, a d20 dice profile, Jobs, and Standard lethality. Setting-agnostic by design, so it layers onto any character card. Class selection and per-chat AI skill-tree forging work exactly as with a custom foundation. Shown only when the chat has no foundation yet.
- **Class crests**: the class-selection screen now shows a crest icon for each of the six Quick Start classes.

### Changed
- **CLASS_ROSTER** now accepts 3–6 starting classes (was 3–5) to fit the six-class Quick Start roster.

## [3.0.0] - 2026-06-10

**Custom RPG Progression.** Fatbody is no longer D&D-only: campaigns now choose between **D&D mode** (classic behavior, unchanged) and **Modern mode** — a user-defined RPG system with levels 1–100, AI-generated classes/skills constrained by a campaign "foundation", and a Path-of-Exile-style skill tree in its own browser tab. Existing chats migrate automatically as D&D campaigns; nothing changes for them. Modes are locked at campaign creation.

### Added
- **Foundation Builder (🏗️)**: an AI architect interviews you about your world (seeded with the character card, persona, and pasted documents), then generates a schema-validated campaign foundation — setting, power system (resource pools for active skills + dice profile + difficulty scale), progression rules (currency, respec), 3–5 starting classes, FFXIV-style Job rules, skill taxonomy, and lethality. Versioned in a `<prefix>_Foundation` lorebook; revisions never retcon acquired skills.
- **Modern leveling engine** (deterministic, zero per-turn LLM cost): XP curve to level 100 owned by JS — the narrator awards XP inline as before, the engine detects threshold crossings, awards skill points (+2 per level, +4 bonus every 10th), and injects a level-up directive into the next turn. The narrator never sees a level table and can never skip or duplicate a level-up.
- **Skill Forge**: the secondary model generates one skill tier per branch at a time, gated by a deterministic validator — power budget per tier, prereq/DAG checks, active-skill resource economy (no free spam), and a word-capped *canonical descriptor* per skill that the narrator must match forever (the fireball you bought is the fireball you get). Starting tiers forge at class selection; later tiers pre-forge in the background as you level. Jobs graft new branches onto your class tree.
- **Skill Tree tab (🌳)**: a separate browser window (no SillyTavern slowdown) with a constellation layout, pan/zoom, search, staged allocations with Apply/Cancel, respec (free through level 10, currency-priced beyond — steep by level 45+), rarity-colored nodes, and tooltips showing each skill's exact costs and canonical descriptor. The SillyTavern tab keeps sole authority over your data; the tree degrades to read-only if the opener closes.
- **[SKILLS] memo module**: acquired actives are injected with exact costs and descriptors (the consistency contract); the state extractor only tracks uses/cooldowns. Passive skills are baked into [CHARACTER] stats with `(P: Skill Name)` restoration anchors.
- **Modern narrator sysprompt**: assembled from the foundation — generic check resolution with your dice profile, percent-bracket XP guidance, directive-driven level-ups, and the **Standard lethality** template (0 HP → Downed with a rescue window → Dying → up to 3 permanent Injuries → true death). Includes a no-tool-call fallback.
- **Dice profiles**: the RNG queue composition follows the campaign (D&D keeps its exact d20+subdice format; Modern uses the foundation's dice). The waterproof DC-commit tool-call pattern is unchanged.

## [2.5.0] - 2026-06-10

### Added
- **Additive Sysprompt Delivery**: New "Sysprompt Delivery" setting. *Standalone* keeps the classic behavior (Fatbody owns the Main prompt box). *Additive* never touches the Main prompt — a rules-only variant (no `<role>`/`<narrative>`/`<party_join_leave>`) is injected via a persistent extension prompt, so another extension or preset (e.g. Megumin Suite narrative engines) can own the narrator persona while Fatbody layers pure mechanics on top. One-time warning when Suite Mode + Additive could double-inject mechanics via the `[[FATBODY]]` block.
- **Semantic Entry Activation (VectFox handshake)**: The Lorebook Agent's activation control is now a three-way mode — *Managed* (classic keyword scanner + manual injection), *Native* (ST's World Info keyword scanner), and *Semantic* (VectFox 3.4.0+ similarity search surfaces entries naturally as the story involves them — no keywords, no constant-active entries). In Semantic mode the agent becomes a pure archive writer: activate/deactivate tools are removed and the saturation/budget doctrine is replaced with archive-focused guidance. Fatbody publishes `_rpgGetActivationMode` and notifies VectFox (`vectfox_invalidateLorebook`) after every campaign-book write so vector collections stay current.
- **External Token Awareness**: The injection budget now measures other extensions' registered extension prompts (e.g. VectFox memories) and subtracts them from the available context. New "External Token Reserve" setting (Advanced Options) covers injectors invisible at interceptor time (e.g. Megumin Suite); included in the `[RPG|BUDGET]` diagnostics line.
- **README**: New "Running with Other Extensions" compatibility guide (Megumin Suite, VectFox).

### Changed
- Legacy `routerNativeKeywordActivation` setting migrates automatically to the new activation mode (one-time).

## [2.4.2] - 2026-05-18

### Fixed
- **Keyword Scanner Latency**: Eliminated a critical 5-second prompt compilation and message delay by removing the expensive, synchronous `updateWorldInfoList` disk-reindexing call from the scanner's fallback path. The read-only keyword scanner now operates purely in-memory, relying on the already-current registry and an in-memory `routerLog` backup for instant performance.

## [2.4.1] - 2026-05-18

### Fixed
- **Rollback Data Safety**: Patched a critical bug in `rollbackRouterPass` where an empty or missing campaign prefix would fall back to the entire SillyTavern library, deleting or clearing unrelated lorebooks. The deletion step now safely ignores empty scopes when no campaign prefix is active.

## [2.4.0] - 2026-05-17

### Added
- **Lorebook Agent Cleanup Mode**: Implemented a comprehensive cleanup mode pass to consolidate bloated lorebook entries.
  - **Tool-call actions**: Support for `rewrite` (single entry compression) and `consolidate` (many-to-one merge + delete) operations.
  - **Custom directives**: Manual global and per-entry cleanups prompt for custom instructions (e.g. "Preserve history, condense mechanics").
  - **Auto-cleanup settings**: Toggles for automatic background runs every N turns and custom token size thresholds.
  - **Bypassing controls**: Added "Use Token Threshold" checkbox to selectively include or exclude the size barrier.
- **Estimated Token Displays**: Real-time token estimators next to category titles, entry list items, and active keys to monitor budget consumption at a glance.
- **Event Isolation**: Fixed interactive controls getting stuck in draggable panels by selective event propagation filters.

## [2.3.8] - 2026-05-17

### Added
- **Clone Stack**: New "Clone Stack" button in the Lorebook Agent settings. Duplicates every lorebook in the active campaign stack (e.g. `Eldoria_NPCs`, `Eldoria_Locations`) under a new user-specified prefix. Designed to prepare a parallel lorebook set before creating a SillyTavern branch chat — name the branch to match the new prefix and the framework links it automatically.

## [2.3.7] - 2026-05-17

### Added
- **Immersion Mode Collapsibility**: Both the RPG State Tracker and Lorebook Agent panels can now be fully collapsed to their header bars by clicking the header collapse button or double-clicking the header.
- **Auto-Expansion Synergy**: Opening the Lorebook Agent panel automatically expands the main RPG Tracker panel if it is collapsed, preventing child element clipping.

### Changed
- **Mobile UI Spacing Optimization**:
    - Hid the on/off (power) buttons (`⏻`) exclusively on mobile viewports to reclaim precious screen real estate.
    - Vertically enlarged the header bars for a more prominent, premium look on mobile screens.
    - Scaled up the other action buttons and increased icon sizes for highly comfortable touch interactions.

### Fixed
- **Stale Collapsed Heights**: Added min-height guards on startup to prevent restoring a collapsed header height (from stale pre-collapse session geometry) as the default expanded height.
- **High-Specificity CSS Override**: Resolved a CSS clash where a specific ID-based display: block !important rule prevented the Lorebook Agent's content container from collapsing.

## [2.3.6] - 2026-05-16

### Fixed
- **Keyword Persistence**: Corrected an ordering bug in `onChatChanged` where switching chats would wipe the departing chat's keyword-activated lore (yellow pills) before it could be saved.



### Added
- **Atmospheric Time Tracker**: [TIME] block text now dynamically changes color based on the hour of day (Dawn, Midday, Sunset, Night) to match the existing emoji logic.

### Changed
- **UI Modernization & Cleanup**:
    - Removed redundant **Max Tokens** field from all UI sections.
    - Renamed **Max Turns** to **Max Agent Turns** and **Max Active** to **Max Active Keys**.
    - Removed bullet points from [TIME] block card items for a cleaner look.
    - Relocated **Reset Stock Modules** button to the Modules section for better grouping.
    - Renamed reset buttons to **Reset Core Prompt** and **Reset Stock Modules**.
- **Hardened Lorebook Injection**: Implemented a third-pass injection in the narrative interceptor to ensure Agent-owned active entries (grey pills) are correctly included in the AI context.
- **System Prompt Hardening**: Updated the template with a strict "NEVER ignore a module" directive to improve instruction following.
- **Module Optimization**: Removed "Location" from the [TIME] module prompt (now exclusively handled by the status footer).

### Fixed
- **Scenario Profiles**: Restored the missing **Delete** button for scenario profiles.



### Fixed
- **Lorebook deactivation on chat switch**: replaced fragile `_Letters` name-pattern heuristic with an exact lookup against the canonical `campaignBooks` lists stored per chat in `chatStates`. Only books the extension itself recorded as managed are ever deactivated — user-created lorebooks with any name are never touched.

## [2.2.7] - 2026-05-14

### Changed
- **Modular slot bar**: Tuned `+` / `×` controls smaller (~15px, lighter borders) after v2.2.6 overshoot.

## [2.2.6] - 2026-05-14

### Changed
- **Modular slot bar**: Larger, higher-contrast `+` / `×` controls (26px touch targets, bordered pill backgrounds) for add/remove middle slots.

## [2.2.5] - 2026-05-14

### Changed
- **Slot editor: add/remove support** — `+` button adds a new middle slot before Keywords; `×` on any middle slot removes it. Works for both stock modules and custom tags.
- **Custom tags now have a format** — same slot bar UI as stock modules; `format` field added to custom tag objects (migrated on load). The prompt builder and parser both use it.
- **Parser simplified** — FAC and QUEST dedicated branches removed; the generic `first=name, middle=body, last=keywords` branch handles all tags uniformly, including any number of slots.

## [2.2.4] - 2026-05-14

### Changed
- **Modular Repertoire slot editor**: Each stock module row now shows an inline `[[TAG: Name | slot | … | Keywords]]` bar. Middle slot names are editable inputs that steer what the AI writes in each pipe section. Name and Keywords chips are fixed/dimmed. Reset restores both slots and instruction.
- **Generic tag parser**: Middle segments (everything between first and last pipe) are all joined as entry body, so any number of renamed middle slots works automatically for NPC, LOC, EVENT and custom tags.

## [2.2.3] - 2026-05-14

### Changed
- **Basic Mode FAC tag**: Default template is now four fields — `Name | Status | Description | Keywords`. Status is a short current-state line; Description holds the longer narrative. Parser joins both into entry content; old three-field `[[FAC: Name | Description | Keywords]]` tags still work. Existing saves using the previous default `format` string are migrated on load. Module reset now restores both `instruction` and `format`.

## [2.2.2] - 2026-05-14

### Fixed
- **Lorebook Agent panel layout**: Active Lore Keys now use normal document flow on desktop and detached panels (`#rpg-tracker-agent .rpg-tracker-content` block layout + `min-height: 0`), so wrapped pills push the Lorebook Terminal down instead of overlapping it. Removed temporary layout debug instrumentation.

## [2.2.1] - 2026-05-14

### Fixed
- **Keyword scan accumulator**: Keyword-triggered lorebook entries are now accumulated across throttled turns (`routerRunEvery > 1`). Previously entries triggered on skipped turns were silently dropped; now the full set since the last agent run is passed as `NEWLY ACTIVATED THIS TURN` when the agent fires.

## [2.2.0] - 2026-05-14

### Changed
- **Lorebook Agent pipeline**: Managed campaign lorebook entries are stored inactive (`disable: true`) and patched on init/chat switch so SillyTavern’s native keyword activation does not run one turn behind narrator output.
- **Assistant-output keyword scan** (`onGenerationEnded`): Before the State Tracker and Lorebook Agent, the last assistant-side narrative is scanned; inactive entries whose `key[]` match (case-insensitive) are appended to `activeRouterKeys` immediately so the same agent pass sees full bodies.
- **Agent context**: Budget block plus optional overflow instruction; **NEWLY ACTIVATED THIS TURN** for scanner hits; archive index excludes already-active entries; FIFO auto-trim of active keys removed — overflow must be resolved via **deactivate** in **commit**.
- **Prompts**: Built-in agent/basic memory-limit copy and bundled default Lorebook Agent system prompt updated for the new budget and activation model; **Reset Agent Prompt** now restores that canonical default.
- **Defaults / UX**: Lorebook context lookback default **4**; UI labels clarify lookback is **last N chat messages (user/assistant)**; optional visual hint for keyword-triggered active keys for one turn.

## [2.1.6] - 2026-05-13
> ⚠️ **Pre-fucking change that will likely need 2 years of debugging.**
> The lorebook prefix system has been gutted and rebuilt from scratch.
> If something is inexplicably broken, it's probably this.

### Changed
- **Lorebook prefix now derived from the raw chat ID** (`ctx.chatId`) at the moment of use — no more stored setting, no more 800ms timer races, no more stale "Assistant" prefix poisoning everything. The chat ID IS the namespace.
- **Prefix derivation is simple and format-agnostic**: just sanitize the chat ID to alphanumeric+underscores. No regex demanding ST's default `Name - timestamp` format. Renamed chats work. Numeric IDs work. Everything works or at least fails loudly.
- **Strict book matching**: a lorebook belongs to a chat only if its name is exactly `prefix` or `prefix_<SingleAlphaWord>`. No partial prefix matches. "Assistant" no longer reaches across sessions and activates 47 lorebooks.
- **Removed manual Campaign Root UI**: the prefix input, Pick & Activate button, and Link button are gone from the settings panel. Replaced with a read-only display of the auto-derived prefix.
- **`activateCampaignBooks` bails with an empty prefix** instead of activating every lorebook on disk.
- **`loadChatState` no longer restores `routerCampaignPrefix`** from saved state. Stale values from old runs can no longer resurface.
- **Deactivation on chat switch** now happens unconditionally (not only when there are matching books), so switching to a new empty chat correctly clears the previous session's lorebooks.

### Added
- **Apply System Prompt button on the onboarding screen** — same as the one in the settings panel. Previously toggling onboarding options saved settings but never actually applied the prompt.
- **`scheduleAutoApply()` wired into onboarding toggles** so changing RNG mode, quest options, or components on the onboarding screen immediately updates the system prompt.

## [1.10.41] - 2026-05-12
### Added
- **Persona Character Creation**: Added a new `🎭 Persona` archetype option to the startup onboarding screen. This feature resolves the active SillyTavern persona description via macro replacement and feeds it as a direct instruction to generate a custom-tailored D&D character matching the specified persona and starting level.

## [1.8.29] - 2026-05-11
### Added
- **Direct Prompt & Adjustable Lookback**: Added the ability to send direct commands to the Lorebook Agent and adjust the number of recent chat messages (lookback) it analyzes.
- **UI Syncing**: Integrated lookback controls into both the agent panel and the main settings drawer with real-time value synchronization.

### Fixed
- **Lint Fixes**: Resolved HTMLElement property access errors in the agent panel's detachment logic by implementing proper type casting.

## [1.8.28] - 2026-05-10
### Fixed
- **Renderer Stabilization**: Ported the definitive rendering engine from the `main` branch to resolve fragility in character card generation. This introduces "sticky entity" logic where unrecognized lines are gracefully attached to the current card instead of resetting the context, preventing UI disintegration during template modifications.
- **Stock Field Rules**: Ported `STOCK_FIELD_RULES` and specialized renderers for HD Pips and Spell Groups for parity with the stable branch.

## [1.8.27] - 2026-05-10
### Added
- **Lorebook Agent Rebranding**: Rebranded the "Router Agent" to the **Lorebook Agent** to better reflect its role in managing campaign lore and consistency.
- **Detachable Agent Panel**: The Lorebook Agent panel is now detachable. Click the ⧉ icon in the agent header to pop it out into a standalone, draggable window.
- **Resizable Agent UI**: Detached agent panels are now fully resizable. Grab the corner or edges to adjust the workspace to your preference.
- **Geometry Persistence**: The position and dimensions of the detached Lorebook Agent are automatically saved and restored across sessions.
- **Enhanced System Prompt**: Updated the default Lorebook Agent instructions to emphasize location persistence, multi-entry turns, and entity synchronization.
- **Dynamic Variable Support**: Added `{{user}}` as a supported variable in the agent's system prompt, which automatically resolves to the player's name.
- **API Standardization**: Ported the critical `sendStateRequest` fix from `main`, standardizing LLM request construction to prevent API errors on certain SillyTavern builds when using connection profiles.

### Changed
- **Terminal Rebranding**: Renamed the agent's feedback loop to the **Lorebook Terminal**.
- **Internal Event Refactor**: Updated internal event bus to use `rt_lore_agent_*` naming for improved codebase clarity and future-proofing.
- **Agent Icons**: Updated UI icons and tool-tips to match the new Lorebook branding.

## [1.8.26] - 2026-05-10
### Added
- **New Rendering Marker**: Added `((HP))` as a shorthand for creating a character health bar.
- **Sticky Entity Context**: Attribute rows (Attr, Skills, Saves, etc.) now automatically attach to the last rendered character even if separated by narrative text.

### Fixed
- **API Compatibility**: Fixed a silent failure in extension initialization by updating `setExtensionPrompt` calls to support the latest SillyTavern API requirements (4-7 arguments).
- **Rendering Stability**: Resolved syntax errors in `renderer.js` when processing complex character blocks.
- **Sync Fixes**: Synchronized core rendering fixes from `main` into the `feature/quests` branch.

## [1.8.25] - 2026-05-10

**Fix: Renderer Syntax Error**
Resolved a syntax error in the quest renderer introduced in the previous update.

### Fixed
- **Renderer Stability**: Fixed an accidental duplicate closing tag that was causing the script to crash on load.

## [1.8.24] - 2026-05-10

**Optimization: Completed Quest Filtering**
Completed quests are now stripped from the AI context to save tokens, while remaining visible in the UI.

### Added
- **UI Sub-Section**: Completed quests are now visually separated into their own collapsible "✅ COMPLETED" sub-section at the bottom of the quest log.
- **Context Pruning**: The serialization engine now filters out any quest with `STATUS: completed` before injecting the `[QUESTS]` block into the state memo, preventing resolved narrative threads from consuming valuable context window space.
- **State Persistence**: The legacy text block parser was updated to intelligently merge incoming active quests with the locally stored completed quests, ensuring history isn't lost when the AI inevitably echoes back a block missing the completed entries.

## [1.8.23] - 2026-05-10

**Refactor: Mood is Engine-Computed Only**
Reverted AI-MOOD override from 1.8.22. The engine is the exclusive source of truth for NPC mood.

### Changed
- **Source of Truth**: `getQuestMood` is now purely deterministic — MOOD is always calculated from the frustration/deadline engine, never inferred from AI text.
- **Parser Cleanup**: The `MOOD` field is no longer ingested from legacy text blocks. The AI may still write it for human readability, but the engine ignores it.

## [1.8.22] - 2026-05-10

**Fix: Mood Calculation — No-Deadline Quests**
Fixed the root cause of mood desync for deadline-free quests.

### Fixed
- **No-Deadline Baseline**: `computeFrustrationLocal` now returns `-1.0` ("Very Pleased") instead of `0.0` ("Neutral") when a quest has no deadline or `DEADLINE: None`. This ensures that pressure-free quests correctly show a positive NPC emotional state.

## [1.8.21] - 2026-05-10

**Enhancement: RNG Queue Guidance**
Added explicit clarification to the legacy system prompt regarding RNG queue entry consumption.

### Changed
- **Prompt Guidance**: Explicitly stated that the first number in each RNG queue entry represents the d20 result in the legacy system prompt.

## [1.8.20] - 2026-05-10

**Enhancement: Robust Difficulty Parsing**
Improved the difficulty system to allow for non-standard ratings and ensured UI stability.

### Changed
- **Flexible Difficulty**: Removed the strict enum requirement for quest difficulty, allowing the AI to use custom ratings if appropriate.
- **Rendering Fallback**: Added a robust rendering fallback in the quest log. Non-standard difficulty levels now use a neutral theme that remains legible across different visual themes.

## [1.8.19] - 2026-05-10

**Fix: Tool Registration Bug**
Fixed a `ReferenceError` that prevented the `LogQuest` tool from registering correctly when Difficulty was enabled.

### Fixed
- **Initialization Order**: Corrected the order of variable initialization in `quests.js` to ensure the `required` fields array is defined before being modified by the Difficulty logic.

## [1.8.18] - 2026-05-10

**Enhancement: UI Consistency**
Added the "Difficulty" toggle to the main extension settings panel.

### Added
- **Settings Integration**: The Quest Difficulty toggle is now available in both the startup onboarding wizard and the permanent extension settings panel.

## [1.8.17] - 2026-05-10

**Feature: Quest Difficulty Tracking**
Implemented an optional "Difficulty" system for quests, allowing the AI to assign and track challenge levels (Very Easy to Very Hard).

### Added
- **Difficulty Toggle**: New checkbox in the onboarding UI to enable/disable quest difficulty tracking.
- **Legacy Difficulty**: Support for the `DIFFICULTY:` field in legacy text-block quests.
- **Modern Difficulty**: Integrated `difficulty` parameter into the `LogQuest` tool and allowed difficulty updates in the JSON state tracker.
- **Visual Feedback**: Added color-coded difficulty badges to quest cards in the UI (e.g., Green for Easy, Red for Very Hard).

## [1.8.16] - 2026-05-10

**Fix: Hardened "Apply Sysprompt" Logic**
Fixed a bug where clicking "Apply Sysprompt Now" in the onboarding menu could occasionally result in a stale prompt if intermediate toggle events were missed.

### Fixed
- **Atomic Onboarding Apply**: The "Apply" button now performs a full scrape of all UI toggles (Deadlines, Frustration, Quest Mode, RNG Mode) immediately before generating the prompt. This guarantees the resulting sysprompt and module instructions perfectly match the visible UI state.

## [1.8.15] - 2026-05-10

**Enhancement: Legacy Quest Rewards**
Added the `REWARD:` field to the Legacy Quest Mode system instructions, bringing it to feature parity with the Standard (Modern) JSON format.

### Fixed
- **Legacy Quest Rewards**: The `quests_legacy` prompt now explicitly instructs the AI to track promised rewards using the `REWARD:` marker. While the renderer and parser already supported rewards, the instructions were missing, causing the AI to omit them in legacy mode.

## [1.8.14] - 2026-05-10

**Fix: Direct Prompt Consistency**
Fixed a bug where the "Direct Prompt" feature used its own isolated logic for building system instructions, ignoring Quest Legacy mode and other module settings.

### Fixed
- **Centralized Instruction Building**: `sendDirectPrompt` now uses the shared `buildModulesInstructionText` function, ensuring it respects the active Quest format and all other module configurations.

## [1.8.13] - 2026-05-10

**Fix: Legacy Quest Prompt Now Reliably Applied**
Resolved a critical bug where users with Legacy Quest Mode selected would still receive the Modern (JSON delta) quest prompt in the state model.

### Fixed
- **Quest Prompt Selection at Init**: Replaced the fragile runtime swap with a definitive init-time write. The correct quest prompt (Legacy or Modern) is now written directly into `stockPrompts.quests` at startup based on `questLegacyMode`, guaranteeing the state model always receives the right instructions regardless of save state.
- **Missing `stockPrompts` Guard**: Added a null-check to ensure `stockPrompts` is always initialized before the sync block runs, fixing a silent failure for users without saved prompts.

## [1.8.12] - 2026-05-10

**Prompt Routing Diagnostics**
Added internal diagnostics to track quest prompt routing.

### Changed
- **Harden Quest Prompt Routing**: Improved the logic that swaps between Legacy and Modern quest formats to be more robust.
- **Diagnostic Logging**: Added console logs to verify `questLegacyMode` status and prompt type during initialization and runtime.

## [1.8.11] - 2026-05-10

**Lorebook Synchronization & Robust Loading**
This update resolves a race condition where lorebooks would fail to populate in the extension settings.

### Fixed
- **Lorebook Initialization Race Condition**: Implemented a 3-tier fallback for loading world info names. If the in-memory list is empty, the extension now forces a backend refresh and retries, with a final direct API fetch fallback. This ensures lorebooks are always accessible regardless of SillyTavern's initialization timing.

## [1.8.10] - 2026-05-10

**Quest Framework Refinements & Progress Tracking**  
This update overhauls the quest logic to support narrative-driven failures, partial objective progress tracking, and recalibrated NPC emotional modeling.

### Added
- **Objective Progress Tracking**: Added support for quantity-based objectives (e.g., "Collect 6 Mushrooms [4/6]").
    - Visual progress pills in the quest log UI.
    - Automated state merging for partial progress updates.
    - Support for both Modern (JSON) and Legacy (Plain Text) tracking modes.
- **Dynamic Narrator Instructions**: The system prompt now automatically swaps quest instructions based on the active mode (Standard vs. Legacy) and RNG settings.
- **Automatic Prompt Synchronization**: Implemented an "auto-sync" mechanism that updates unmodified stock prompts to the latest version upon extension load.

### Changed
- **Frustration Logic Recalibration**: NPCs now stay in the "Pleased" to "Neutral" range until a deadline is actually missed. Frustration penalties now ramp up exclusively *after* the deadline has passed.
- **Narrative-Driven Failures**: Explicitly authorized the AI to trigger quest failures if an objective becomes narratively impossible (e.g., target death), independent of automated deadline logic.
- **RNG Queue Instructions**: Clarified that the first number in each `[RNG_QUEUE]` entry is the d20 result to eliminate ambiguity during combat.

### Fixed
- **Legacy Prompt Routing**: Fixed a bug where Legacy Mode was stripping instructions from the modern prompt instead of injecting the dedicated legacy prompt.
- **LogQuest Tool Descriptions**: Updated tool documentation to reflect the new post-deadline frustration behavior.

## [1.8.7] - 2026-05-09

### Added
- **Per-Module Pagination Thresholds**: You can now set independent pagination limits for every module (stock and custom).
    - Added "Pagination Threshold" input to the **Custom Module Editor** and **Prompt Editor**.
    - Changes update the UI in real-time as you type, allowing for instant layout fine-tuning.
- **Robust "Linear Stone" History**: 
    - **Dual-State Archiving**: Updates (both narrative and direct) now archive both the *old* and *new* states to history. This ensures that committing to a past state never permanently clobbers your most recent work.
    - **Direct Prompt Persistence**: Fixed a bug where manual tracker updates via direct instructions were lost during history traversal.
    - **Fluid Snapshot Restoration**: Clicking the nav label now restores a past state instantly without a confirmation popup, as the operation is now completely reversible.

### Changed
- **Unified History Depth**: Increased history limit for Direct Prompt updates from 5 to **1000 items** to match the narrative update cycle.
- **UI Responsiveness**: Removed the requirement to save a module configuration to see pagination changes; the tracker now re-renders immediately upon input.

### Fixed
- **Infinite Snapshot Duplicate Bug**: Resolved a logic error where jumping between historical snapshots and the "Live" state would create redundant duplicates of the same state in the history stack.
- **Clear State Pointer Bug**: Fixed a bug where clearing the tracker history didn't reset the internal state pointer, leading to incorrect history slicing on the next update.
- **Empty State Archiving**: Fixed a guard condition that prevented archiving the very first state (empty) into history.
- **Quest Settings Persistence**: Fixed a regression where "Deadlines" and "Frustration Levels" toggles failed to persist across session reloads.


## [1.8.2] - 2026-05-05

**Waterproofing RPG State Persistence**  
This update introduces a deterministic, non-regex JSON cleaner for tool-call metadata and a surgical RNG queue stripper. These optimizations eliminate token bloat caused by redundant tool signatures and metadata, saving approximately 1,500 tokens per dice roll.

### Added
- **Total Tool-Call Bloat Removal**: The State Model now completely excludes mechanics-heavy tool results (signatures, reasoning, parameters) from its context. It relies exclusively on the narrative descriptions that follow a roll, significantly reducing context usage.
- **Surgical RNG Stripping**: Implemented a "waterproof" regex mechanism for stripping `[RNG_QUEUE]` blocks from the user's last action, ensuring AI context remains clean while maintaining 100% stability.
- **Expanded RNG Queue**: Increased the pre-rolled `[RNG_QUEUE]` length from **8** to **12** to provide more headroom for complex combat encounters.

### Changed
- **Unified Versioning**: Synchronized framework version to **1.8.2** across manifest, changelog, and system prompt UI.
- **Context Filtering**: Wired the cleaner into both the automatic `StateModelPass` and the manual `Direct Prompt` pipelines to ensure consistent token savings across all interaction modes.


**Chat-Linked State Persistence**  
This major update introduces per-chat isolation for the RPG State Tracker, allowing for seamless transitions between different campaigns and characters.

### Added
- **Chat-Specific Isolation**: Memos and history are now automatically scoped to the active SillyTavern Chat ID. Switching chats will swap the tracker state instantly.
- **Smart Conflict Resolution**: When linking to a chat that has existing data, a native SillyTavern modal prompts for **RESTORE**, **OVERWRITE**, or **CANCEL**.
- **Automatic History Backup**: Discarded "Global" work is automatically pushed into the chat's history during transitions to prevent data loss.
- **Clean Slate Onboarding**: New chats automatically start with an empty tracker while preserving your custom module configurations.

### Changed
- **Unified Versioning**: Synchronized framework version to **1.8.0** across manifest, changelog, and system prompt UI.
- **Improved Modal Experience**: Replaced generic browser alerts with premium, native SillyTavern popups.

### Fixed
- **State Overwrite Bug**: Resolved an issue where toggling Chat Link could accidentally wipe existing chat data with the current live state.

## [1.7.5] - 2026-05-05

**Waterproof Markers & UI Streamlining**  
This update focuses on "waterproofing" the RPG Marker system and cleaning up the Editor UI for a more professional experience.

### Fixed
- **"Waterproof" Marker System**: Resolved a bug where visual markers like `((PILLS))`, `((BAR))`, and `((XPBAR))` were being stripped from the state data sent to the AI. The system now preserves these markers throughout the entire round-trip, ensuring 100% reliable HUD formatting.
- **ST API Compatibility**: Added support for both `max_tokens` and `max_new_tokens` in the TextCompletionService payload, ensuring stability across different SillyTavern backends.
- **UI Logic Stability**: Fixed a critical `TypeError` in `sendStateRequest` that could occur when switching between connection profiles.
- **General Linting**: Fixed multiple "silent" errors including missing header definitions, incorrect API signatures, and jQuery type-safety issues in both the main extension and the `Summaryception` connection utility.

### Changed
- **Editor UI Refinement**: Removed the "Preview" toggle button from the Custom Field Editor. On supported desktop displays, the **Testing Sandbox** is now permanently visible to provide instant feedback.
- **Version Synchronization**: Incremented framework version to **1.7.5** across the manifest and the internal system prompt footer.

## [1.7.4] - 2026-05-05

**Enhanced Connectivity and UI Refinement**  
A comprehensive upgrade to the external LLM pipeline and settings organization, enabling direct-to-backend connections with robust parameter mapping.

### Added
- **Direct Backend Connectivity**: Introduced the ability to route State Tracking requests directly to **Ollama** or **OpenAI-Compatible** endpoints (like OpenRouter, LM Studio), bypassing SillyTavern's internal profile system for ultra-low-latency background updates.
- **Universal Parameter Mapping**: Implemented a multi-tier fallback system for generation settings. The framework now correctly extracts and maps `temperature`, `top_p`, `frequency_penalty`, and `repetition_penalty` across all SillyTavern preset formats (supporting both TextGen and OpenAI-specific key names).
- **Diagnostic Transparency**: Added high-verbosity browser console logging (Debug Mode) that explicitly outputs the `Applied Preset Data` and final `Parameters` used for each request.

### Changed
- **Settings UI Drawer System**: Refactored the settings panel into an expandable **Drawer** system. 
    - **Connection Settings** and **Advanced Options** now reside in collapsible headers to keep the main menu clean.
    - **Context & Lorebooks** has been promoted to a top-level section for better discoverability.
- **Header Aesthetics**: Updated the extension's main drawer icon and bold styling to match SillyTavern's native visual standards.
- **Layout Optimization**: Optimized button widths (Add Custom Field, Test Connection, Factory Reset) for better responsiveness in narrow sidebars.
- **Combat Tracking**: Updated the default [COMBAT] prompt to include explicit `COMBAT ROUND X` tracking per combatant.

### Fixed
- **Property Name Collision**: Resolved an issue where presets created under OpenAI profiles would fail to apply their temperature settings due to differing property names (e.g., `temp` vs `temp_openai`).
- **Button Alignment**: Fixed vertical squishing and awkward text wrapping on manual action buttons.

## [1.7.1] - 2026-05-04

### Fixed
- **Silent Model/Preset Switching**: Fixed a major regression where background RPG tracker passes would ignore the selected Connection Profile and Generation Settings Preset. The system now correctly routes requests through specific models (like Gemini 3 Flash) with custom sampler overrides (like disabling reasoning) silently and reliably.

## [1.7.0] - 2026-05-04

**Custom Field Overhaul and Universal Markers**  
A major refactor of the Custom Field Editor and rendering engine, giving users total control over AI instructions while enabling high-fidelity markers (pills, bars) in every stock module.

### Added
- **Universal Marker Support**: `((PILLS))`, `((BAR))`, `((XPBAR))`, `((BADGE))`, and `((HIGHLIGHT))` now work in ALL built-in modules (INVENTORY, ABILITIES, SPELLS, XP, TIME).
- **Decoupled AI Instructions**: The Custom Field Editor now separates the visual template from the AI prompt, allowing for raw, unmanipulated instruction sets.
- **CFE Color Guide**: Added a one-click guide button to the Custom Field Editor to help users quickly implement colored text and rarity tags.
- **CFE Help System**: Added tooltips to the Custom Field Editor to clarify the distinction between UI previews and AI instructions.
- **Instruction Hardening**: Added a new `<custom_formatting>` block to core instructions to better guide the AI on when to use graphical markers.

### Changed
- **Decommissioned Sub-Field Rules**: Removed the legacy global label-mapping system. All rendering is now handled via the more powerful and flexible template system.
- **Renamed Dice Tool**: "Dice Roll (Fatbody)" is now **"Dice Roll (with DC)"** for better transparency.
- **Restored Stock Prompts**: Reverted module prompts to their high-performance legacy versions as requested by the community.
- **UI Typography**: Increased subtext and tooltip font sizes for improved readability.

### Fixed
- **Lookback Update Logic**: Fixed a bug where manual "Lookback Update" was ignored in favor of persistent settings. It now correctly overrides the context window for one-time refreshes.
- **Mobile CFE Stability**: Resolved multiple layout bugs in the Custom Field Editor for mobile devices, including top-clipping, z-index layering issues, and redundant UI elements.

## [1.6.0] - 2026-05-04

**Improved Customization and Advanced Options**  
Significant upgrades to editing custom fields. The formatting is now clear, and there's a live preview window, which makes design a breeze.

### Added
- **Advanced Options Update**: Deep customization for the State Model's intelligence.
- **Precision Lookback Control**: You can now specify exactly how many previous messages (User/Assistant) and how many historical tracker states the model sees when making updates.
- **Lorebook Context Support**: You can now select which specific Lorebooks the tracker is aware of during updates, ensuring it stays consistent with your world info.
- **Enhanced Custom Field Editor**:
    - **Live Preview Window**: Real-time rendering of your tracker blocks while you edit prompts.
    - **Color Support**: Full support for `<font color=#...>...</font>` tags and native WoW-style rarity tags like `[Legendary]`, `[Epic]`, etc., which are now automatically colorized.
    - **Contextual Formatting**: Module prompt examples now use stock fields (like CHARACTER and ABILITIES) to guide better formatting.

### Fixed
- **UI Headers**: Fixed a bug where the preview window would show raw tags like `__PREVIEW__` instead of proper field labels.
- **Live Preview Interactivity**: Pagination and list/page views now work correctly within the live preview window.

## [1.5.5] - 2026-04-29

### Fixed
- **Mobile Prompt Access**: Embedded system prompts directly into the code and implemented an HTTP-compatible clipboard fallback. This ensures the SYSPROMPT button works on mobile/Termux environments where local file fetching and modern clipboard APIs are often restricted.

### Added
- **Full-Screen Mobile Support**: The tracker now expands to cover the screen on mobile, optimizing space.
- **Button Alignment Fixes**: Centered all navigation and RNG buttons, ensuring they align vertically and horizontally.
- **Settings Drawer Refinement**: Polished the collapsible footer to keep settings accessible but out of the way.

### Added
- **Mobile UI Optimization**: Implemented responsive CSS for mobile devices (max-width 600px).
- **Adaptive Footer**: The bottom bar now stacks vertically on mobile, hides the character counter, and uses compact labels to prevent button overlapping and ensure reliable touch targets.

### Changed
- **Initiative System**: Shifted pre-combat initiative rolls from the RNG Queue to the Tool Call system for better narrative integration.
- **Resting Rules**: Reduced the Long Rest cooldown to 9 hours and implemented a d20-based interruption check for resting in dangerous locations.
- **RNG Queue Constraint**: Strictly isolated the RNG Queue to active combat actions only.
- **Prompt Synchronization**: Updated the legacy fallback prompt to maintain parity with the latest system rules.

### Fixed
- **Detached UI Scrolling**: Fixed an issue where undocked panels (Combat, Party, etc.) would not allow internal scrolling.
- **Resize Handle Conflict**: Resolved a bug where grabbing the resize handle on detached windows would trigger the scrollbar track.
- **Content Overflow**: Optimized card layout within detached panels to ensure proper scroll-height calculation for large entity lists.

## [1.5.0] - 2026-04-28

### Added
- **Visual Status System**: Status effects are now color-coded. Buffs (marked with `(+)`) are Emerald Green, and Debuffs (marked with `(-)`) are Crimson Red.
- **Resource Capsule Icons**: Replaced the generic information icon with dynamic resource trackers. If an ability or spell has a usage count (e.g., `2/3`), it is displayed directly in the pill icon.
- **XML-Structured Instructions**: Completely refactored the State Model prompt using semantic XML tagging for vastly improved instruction following and clarity.
- **Enhanced Status Labeling**: Standardized status formatting to ensure both mathematical effects and durations are preserved in the HUD.
- **Dynamic Adaptive Icons**: Pill icons now expand into capsules to support multi-digit resource counts (like `10/10`) with improved typography.

## [1.4.4] - 2026-04-28

### Added
- **Lookback Update Option**: Added a third manual update mode that allows users to specify exactly how many past assistant turns to parse. This is useful for summarizing multi-turn dialogue or complex narrative sequences without a full context audit.

## [1.4.3] - 2026-04-27

### Fixed
- **Interceptor Metadata Integrity**: Refactored the RNG/State interceptor to use in-place modification. This ensures that hidden SillyTavern metadata (like Reasoning/Thinking content) is preserved exactly as the engine expects, preventing 400 errors with models like DeepSeek R1.
- **Enhanced Thinking Stripping**: Expanded the State Model pass filter to automatically strip `<thought>`, `<thinking>`, and `<reasoning>` tags to prevent API validation errors.

## [1.4.2] - 2026-04-27

### Fixed
- **Multi-Part Message Tracking**: Fixed a critical bug where the State Model failed to process narrative text generated *before* a tool call within a single AI turn. The tracker now seamlessly aggregates all assistant message chunks since the last user message.

## [1.4.1] - 2026-04-27

### Changed
- **Settings UI Optimization**: Removed redundant "Dice & Tools" toggles from the settings panel, as they are now handled exclusively by the interactive footer buttons.
- **System Prompt Refinement**: Hardened RNG and combat rules and unified terminology around `[RNG_QUEUE v6.0_PROPER]` across all system prompt versions.

## [1.4.0] - 2026-04-27

### Added
- **Hybrid RNG Architecture**: Introduced a dual-system approach to random number generation.
  - **RNG Queue (Combat)**: Pre-rolled dice for speed and anti-sycophancy in structured play.
  - **Tool Call RNG (Narrative)**: Reactive, AI-driven rolling for skill checks to prevent narrative "cheating."
- **"Waterproof" Narrative Logic**: Mandatory `dc` (Difficulty Class) parameter enforced in the `RollTheDice` tool. The AI must now commit to a difficulty *before* seeing the roll result.
- **Enhanced SYSPROMPT Selector**: Added a multi-version popup menu to the `SYSPROMPT` button, allowing users to choose between the **Modern (Hybrid)** and **Legacy (Queue-only)** system prompts.
- **Dynamic Footer UI**: Completely refactored the footer buttons with an "Accordion Squeeze" responsive design that hides labels/text as the UI box is resized, rather than stacking vertically.
- **Slash Commands**: Added `/roll` and `/r` commands for manual dice rolling via the command bar.

### Fixed
- **Core Stability**: Resolved a critical initialization crash in the UI core caused by a missing API provider in the slash command registration.
- **Responsive Stacking**: Fixed a bug where footer buttons would stack vertically and misalign on narrow screens.

## [1.3.5] - 2026-04-27

### Fixed
- **Tool Calling Compatibility**: Resolved a critical issue where the tracker would interrupt and break SillyTavern's internal tool-calling sequences.
  - Refactored the core event listener from `MESSAGE_RECEIVED` to `GENERATION_ENDED` (and `GENERATION_STOPPED`). The State Model will now patiently wait for the entire AI tool chain to finish before triggering an update, rather than firing in the "gaps" between tool execution steps.

## [1.3.4] - 2026-04-27

### Changed
- **Buff/Debuff Logic Overhaul**: Refactored how temporary effects and stat modifications are tracked.
  - Relocated "restoration anchors" to the stat lines themselves (e.g., `AC 18 (base 13)`), allowing for cleaner status displays.
  - Standardized Status line formatting to focus on absolute mathematical effects (e.g., `Shield (+5 AC, 1 turn)`).
  - Improved Narrator and State Model synergy for automatic buff expiration and stat restoration.

## [1.3.3] - 2026-04-27

### Fixed
- **Mobile Profile Management**: Resolved an issue where saving, loading, or deleting profiles would fail on mobile devices (especially iOS PWAs).
  - Replaced native `prompt()` and `confirm()` calls with SillyTavern's built-in async modal system.
  - Implemented an async event-handling pattern for the Profile UI to support non-blocking user input.
- **RNG UI Tweak**: Integrated the RNG Physics Engine toggle directly into the footer navigation bar as a professional, horizontally-centered pill button with responsive mobile scaling.

## [1.3.2] - 2026-04-26

### Fixed
- **UI Boundary Protection**: Implemented safety checks to prevent the UI from becoming inaccessible if moved or saved off-screen.
  - Added coordinate sanitization to `loadPanelGeometry` and `createDetachedPanel` to ensure the panel always spawns within the visible viewport.
  - Implemented movement constraints in the dragging logic to prevent moving the panel header beyond the browser window edges.

## [1.3.1] - 2026-04-26

### Fixed
- **Custom Field Limit**: Resolved a bug that limited the number of custom fields to two. 
  - Implemented unique tag generation for new fields (e.g., `NEW_FIELD`, `NEW_FIELD_1`).
  - Added real-time tag validation to prevent duplicate or reserved tags (like `XP` or `CHARACTER`).
  - Added an auto-sanitization pass to `refreshOrderList` to automatically fix any existing duplicate tags in user settings.

## [1.3.0] - 2026-04-25

### Added
- **Starting Level Selector**: Added a "Starting Level" dropdown (Levels 1–20) to the initial setup screen. 
- **Dynamic Archetype Generation**: The Magic, Melee, and Rogue archetype buttons now dynamically generate characters consistent with your chosen starting level (including appropriate gear and spells).
- **Advanced D&D 5e Rules**: Updated `sysprompt.txt` with specific tracking for Distance & Range, Opportunity Attacks, and disadvantage on Ranged Spells in melee combat.
- **Archetype Overhaul**: Significantly improved the character generation "wizard".
  - All archetypes (Magic, Melee, Rogue) now consistently generate **[INVENTORY]** and **[ABILITIES]** blocks.
  - Numbered prompts ensure more thematic gear (Thieves' Tools, Signature Weapons) and class features (Sneak Attack).
- **Finalized Onboarding**: Completed the new user walkthrough in the empty state with descriptions and a manual creation guide.

### Changed
- **Ability Pill Formatting**: Updated the stock prompts to enforce the `Ability Name (brief description)` format, ensuring all class features render correctly as interactive UI pills.
- **Onboarding Guidance**: Added a reminder to the startup guide to reset extension prompts and re-copy the system prompt after a framework update.

### Fixed
- **Comma Support**: Updated the parser for HP, XP, and Hit Dice to support numbers with commas (e.g., `100,000`), preventing display failures with high-value stats.
- **UI Alignment**: Centered the level selector dropdown to sit correctly above the archetype selection buttons.

## [1.2.9] - 2026-04-24

### Fixed
- **Factory Reset**: Resolved a race condition where the page would reload before the reset request is finalized in storage. Replaced blocking alert with a non-blocking toast and delayed reload.

## [1.2.8] - 2026-04-24

### Fixed
- **Onboarding UX**: Fixed markdown bolding in the onboarding guide and scaled up all font sizes for better readability.
- **Profile Persistence**: The profile dropdown now correctly remembers the "-- No Profile --" selection across page refreshes.

### Added
- **Guided Creation**: Updated the startup guide to suggest using the manual update icon (💬) for character creation via description.

## [1.2.7] - 2026-04-24

### Added
- **Interactive Onboarding**: Added a comprehensive step-by-step startup guide to the empty tracker state.
  - Numbered walkthrough for initial character setup and prompt configuration.
  - Included a highlighted "Update Alert" warning to notify users when they need to re-copy the system prompt.
  - Redesigned archetype buttons for better visual integration.

## [1.2.6] - 2026-04-24

### Fixed
- **Profile Persistence**: Scenario profiles now correctly save and restore the **Module Order** and **Active Modules** status.
- **Settings UI Sync**: Loading a profile now immediately updates the Module Settings list in the UI to reflect the loaded configuration.

### Changed
- **Enhanced Reset**: The "Reset ALL Prompts" button now also resets the module layout order and re-enables all stock modules to factory defaults.

## [1.2.5] - 2026-04-23

### Added
- **Hit Dice Tracking (HD)**: Added a new `HD` field for Characters and Party members.
  - Renders as high-fidelity gold pips (`[ dX ] 🔵🔵⚪`) to differentiate from blue spell slots.
  - Automatically included in default system prompts.
- **Last Rest Time Engine**: The `[TIME]` section now supports a `Last Rest:` field.
  - The UI dynamically calculates and displays the time elapsed (e.g., "10 hours ago") relative to the current game time.
- **Improved Prompt Clarity**: Refined prompt instructions for Time, Inventory, and HP to be more authoritative and direct.

## [1.2.4] - 2026-04-23

### Added
- **Combat-First Layout**: The `[COMBAT]` section now defaults to the top of the UI for quicker access during encounters.
- **Enhanced Entity Detail**: The `Other:` and `Resistances:` fields in Combat, Character, and Party blocks now utilize the interactive **Unit Pill** system.
  - Descriptions in parentheses now appear as glassmorphism tooltips.
  - Consistent styling across all entity-based data fields.

### Changed
- **Refactored Renderer**: Centralized the pill rendering logic to ensure uniform behavior across all framework sections.

## [1.2.3] - 2026-04-23

### Added
- **Native Auto-Updates**: Enabled native SillyTavern auto-update support. The extension will now automatically notify you of new updates in the UI and can be updated with a single click from the Extensions menu.

### Fixed
- **Standardized Spell UI**: Completely refactored the spell display format across the [PARTY] and [SPELLS] blocks.
  - Spells are now displayed using a low-cognition format (one line per spell level).
  - Fixed a grid-overflow bug in the PARTY UI that caused long spell names to stack vertically or clip.
  - Unified the horizontal-flowing pill layout for all spell levels.

### Changed
- **Manifest Update**: Optimized `manifest.json` for better integration with SillyTavern's third-party extension tracking.

## [2026-04-22] - UI & XP Enhancements

### Added
- **Character Level in XP Section**: Added character level display to the [XP] block, showing both level and experience progress in a single unified UI row.
- **Resource Depletion Logic**: The DM now strictly monitors resource usage. If a player attempts to use an ability or spell with 0 uses remaining, the DM will pause the narrative and request a different action.
- **Combat Field Expansion**: Enemies now track "Other" properties (Resistances, Immunities, Special Traits) with dedicated styling in the HUD.

### Changed
- **XP Block Prompting**: Updated the State Model prompts to ensure level tracking is maintained alongside experience points.
- **Support for Hybrid Formatting**: The UI now supports both `XP: current/max` and `Level: X | XP: current/max` formats for backward compatibility.
- **Interactive Unit Pills**: Standardized the **Traits** and **Abilities** sections into interactive "Unit Pills."
- **Tooltip System 2.0**: Descriptions are now revealed in a glassmorphism hover bubble that does not cause layout shifts (fixing the edge-of-screen "flashing" bug).
- **CSS Iconography**: Replaced distorted unicode characters with perfectly circular, CSS-drawn info icons (ⓘ).
- **Smart Parsing**: Implemented a stack-based parser to correctly handle complex traits and abilities that contain internal commas.
- **Global Deselect**: Clicking any empty space on the tracker now automatically closes any open interactive elements.

## [2026-04-21] - Rebranding & Physics Integration
- **Framework Rebranding**: Renamed from RPG Tracker to **Fatbody D&D Framework**.
- **RNG Physics Engine**: Integrated the Prompt Injection RNG system for transparent, physics-based rolling.
- **HUD Controls**: Added "SYSPROMPT" and "RNG" toggle buttons directly to the tracker panel.
- **Optimized Layout**: Reordered sections to prioritize Character and Combat status over meta-stats like XP and Time.
- **Factory Reset**: Added a "Factory Reset" button to the settings panel for easy recovery of default prompts.
