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

## Narrator function tools

Two subsystems get their structured data from the *narrator's own turn* rather than a
follow-up pass: quests (`LogQuest`, `quests.js`) and CYOA choices (`SuggestChoices`,
`cyoa.js`). Both build their tool *description* dynamically from
`settings.syspromptModules`, so the schema the model sees tracks the user's toggles.

**They differ on `stealth`, and the difference is load-bearing.** ST's ToolManager
documents `stealth` as "the tool call result will not be shown in the chat; no follow-up
generation will be performed" — the tool's `action` runs either way, since
`invokeFunctionTool` is awaited *before* the flag is checked. So the question is only
ever "should the model get another generation after this call?":

- `LogQuest` — **no** `stealth`. The model may call it *instead of* narrating, and the
  follow-up generation is what supplies the prose. It uses `formatMessage: () => ''`.
- `SuggestChoices` — **`stealth: true`**. It is specified to fire only after the prose is
  finished, so a follow-up has nothing to write and the narrator just continues a scene
  it already ended. That follow-up also re-ran the interceptor (re-injecting lore) and
  re-fired `GENERATION_ENDED`, double-running the state pass and World Progression.

Before adding a third tool, decide which of those two it is. The cost of `stealth` is
that a tool-call-only turn lands as an empty message with no follow-up to fill it, so a
stealth tool's description must tell the model never to call it alone.

Prefer a narrator tool over a second LLM pass when the data is about the scene the
narrator just wrote: it costs no extra request, and the model proposing has the context
the proposal is about. `cyoa.js#registerSuggestChoicesTool` fingerprints its inputs and
no-ops on an unchanged fingerprint, because `refreshRenderedView()` calls it on every
render; the fingerprint is assigned only *after* the registry call succeeds, so a throw
is retried rather than cached as done.

Its registration gate must stay identical to the one `buildSysprompt()` applies to the
`<cyoa>` block. If the rules can ship while the tool cannot, the narrator is left ordered
to call something absent from the request — that desync caused a real bug report.

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
