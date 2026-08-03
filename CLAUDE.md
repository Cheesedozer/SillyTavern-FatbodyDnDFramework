# Origins RPG Framework — notes for agents

A SillyTavern extension (vanilla ES modules, no build step). SillyTavern loads
`index.js` per `manifest.json`; `package.json` exists only for the dev-only test suite.

- **Tests:** `npm test` (`node --test`, files in `test/`). DOM-free — `test/_bootstrap.js`
  stubs the `SillyTavern` context and `setSettings`.
- **Settings** live under the `rpg_tracker` key in `extension_settings`; defaults are
  declared once in `buildDefaultsTemplate()` (`state-manager.js`) and deep-merged on load.
  UI checkboxes live in `settings.html`, wired in `index.js`.
- Each module's header comment lists its imports and importers — keep those accurate.

## Framework-initiated LLM calls

The framework talks to the model on its own behalf (router pass, World Progression
agent turns, state-model passes) through `sendStateRequest()` / `sendAgentTurn()` in
`llm-client.js`. Those go out via ST's `generateRaw({ bypassAll: true })`, which **still
emits `CHAT_COMPLETION_PROMPT_READY`** — so prompt-rewriting handlers see them even
though the user's preset, persona, and chat history are not in them.

Anything reacting to that event must consult `isInternalRequestActive()`
(`shared-state.js`). `handlePresetMarker()` in `preset-marker.js` is the worked example —
note it gates only the *inference* it draws from an absent marker, not the rewriting
itself, because a background pass can still be open when the next real turn is assembled.

## Getting structured data out of the narrator's own turn

Two subsystems do this rather than paying for a follow-up pass — quests (`quests.js`) and
CYOA choices (`cyoa.js`) — and they use **opposite mechanisms**. Prefer one of these to a
second LLM pass when the data is about the scene the narrator just wrote: it costs no
extra request, and the model proposing has the context the proposal is about.

### `LogQuest` — a function tool

`quests.js` registers `LogQuest` and builds its *description* dynamically from
`settings.syspromptModules`, so the schema the model sees tracks the user's toggles.

It has **no** `stealth`, deliberately. ST's ToolManager documents `stealth` as "the tool
call result will not be shown in the chat; no follow-up generation will be performed" —
the `action` runs either way, since `invokeFunctionTool` is awaited *before* the flag is
checked. The model may call `LogQuest` *instead of* narrating, and the follow-up
generation is what supplies the prose. It uses `formatMessage: () => ''`.

**The cost of that follow-up is real**, and it's what drove CYOA off tool calling: the
follow-up re-runs the interceptor (re-injecting lore) and re-fires `GENERATION_ENDED`,
double-running the state pass and World Progression. If you reach for a second tool, be
sure the model genuinely might call it instead of narrating. If it can only fire *after*
the prose, a tool is the wrong shape — see below.

### `<choices>` — a text block in the message body

CYOA was a `stealth: true` tool (`SuggestChoices`) and is not any more. `cyoa.js`'s header
comment carries the full reasoning; the short version is that a tool specified to fire
after the prose has three problems a text block doesn't:

1. It races `<end_of_output_footer>` for the terminal position of the turn. Under
   `stealth` there's no follow-up to write a footer the model skipped, so the HUD's
   footer parse (`index.js`, `#rt-footer-location`) silently loses its input.
2. Any tool-call turn is a live source of a second generation.
3. Large presets crowd out an unprompted every-turn tool call no matter how correctly
   the tool is registered.

So the narrator writes `<choices>\nslot | text | stake\n</choices>` at the bottom of its
message and `parseChoiceBlock()` reads it back. `validateChoices()` stayed exactly as it
was — it is still the single judge for both this path and the `regenerateChoices()`
fallback. The pieces that have to move together:

- The `<cyoa>` sysprompt block lives in **five** places (`sysprompt.txt`,
  `sysprompt_legacy.txt`, `sysprompt_modern.txt`, and two `RT_PROMPTS` fallbacks in
  `constants.js`). It carries a `{{cyoaSlots}}` placeholder that `buildSysprompt()`
  substitutes, because the slot list is a live setting and the files are static — the
  same trick as `{{modulesText}}`. `'cyoa'` must stay in `ADDITIVE_TAGS` or the
  `[[ORIGINS]]` audience never sees it.
- **Anything that feeds message text to another model must call `stripChoiceBlock()`** —
  `getNarrativeBlocks()` in `narrative-hooks.js` and `formatAuditMessage()` in
  `audit-chunker.js` today. Left in, the state pass reads offered options as events.
- `ingestNarratorMessage()` is bound to `MESSAGE_RECEIVED`/`MESSAGE_EDITED`/
  `MESSAGE_SWIPED`, which land *before* `onGenerationEnded`'s `reconcileAfterTurn()` —
  that ordering is what keeps "the narrator stayed silent" from firing on a turn that
  actually delivered.

### Managed regex scripts (`cyoa-regex.js`)

The only place this repo writes into *another* extension's settings
(`extension_settings.regex`). Three entries under fixed ids, rebuilt from settings on
every sync so they can't drift from the prompt; user-owned scripts are preserved by id
filter. They must never be applied without `markdownOnly` or `promptOnly` — `cyoa.js`
reads the block out of `msg.mes`, so the stored message has to survive untouched.

`syncCyoaRegexScripts()` fingerprints its inputs and no-ops on an unchanged fingerprint,
because `refreshRenderedView()` calls it on every render; the fingerprint is assigned only
*after* the write succeeds, so a throw is retried rather than cached as done. Its gate
must stay identical to the one `buildSysprompt()` applies to the `<cyoa>` block — if the
rules ship without the scripts, the narrator writes a block nothing renders. (The same
invariant, for the same reason, as when the gate guarded a tool registration.)

## External projects

- **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** — the host app. Event
  names, `getContext()` surface, and `generateRaw` semantics all come from here.
- **[Megumin Suite](https://github.com/Arif-salah/Megumin-Suite)** — the most common
  pairing, and the worked example throughout `presets/README.md`. Its V9.1 presets are
  where users paste `[[ORIGINS]]` (into the *Output RULES* prompt). It has its own
  `[[TAG]]` registry and injects at `CHAT_COMPLETION_PROMPT_READY`, i.e. after this
  framework's interceptor budget is computed — check its source before answering
  compatibility or prompt-ordering questions.
- **[Summaryception](https://github.com/Lodactio/Extension-Summaryception)** — the
  recommended summarizer companion (see README → Suggested Companions).
- **VectFox** — RAG extension with a "Fatbody D&D Framework" text-cleaning preset;
  compatibility notes in `README.md`.
