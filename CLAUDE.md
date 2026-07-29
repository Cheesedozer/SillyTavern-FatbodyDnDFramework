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
