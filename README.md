**⚠️ IF THE 2.0.0+ UPDATE FAILS SOMEHOW, TRY CTRL + SHIFT + R. IF THAT FAILS, REINSTALL. YOU WILL NOT LOSE YOUR PROGRESS.**

**"Fatbody D&D gives you the Private Pyle experience."** —Gny. Sgt. Hartman

*A D&D-lite simulation engine for SillyTavern.*

What this framework does is essentially turn SillyTavern into something like AI Dungeon, but with actual mechanics/consequences. Losing or dying is actually a thing. In Big Rigs, you're always WINNER. Not in Fatbody D&D! 

I wasn't satisfied with any of the commercial offerings available (AI Realm, AI Dungeon, Friends & Fables, etc.,) so I made my own D&D platform inside SillyTavern. 

**Crucially, the system is input-output, not just some glorified stats collector. Your state info feeds back into the narrative AI.**

### The Fatbody D&D Framework involves three core components:

1. 🖥️ **RPG State Tracker** — Extracts and maintains HP, inventory, party, buffs, XP, spells, and more via a dedicated second-pass model. Injects a rolling State Memo back into each prompt to keep the AI (and you) on track.
2. 🎲 **Hybrid RNG System** — A dual-engine approach to tabletop physics. 
   - **RNG Queue (Combat)**: Pre-seeded deterministic dice injected into every turn for high-speed, zero-latency combat resolution, neatly within a single output. Sidesteps the unreliability and massive input token costs of tool chains.
   - **Tool Call RNG (Narrative)**: A proactive AI-driven rolling system for non-combat skill checks. Features a "Waterproof" commitment logic where the AI must declare a DC before seeing the result, preventing narrative sycophancy and cheating.
3. 🤖 **The Lorebook Agent** — This is a fully autonomous lorebook manager that creates, updates, activates and deactivates, deactivates lorebooks for you in the background. Handles the macroscopic consistency of your adventure. Also includes cleanup tools (consolidation, rewriting entries) that can be set to automatically run periodically.
4. 🌍 **World Progression System** (opt-in) — A four-layer engine (World Arc, Character Arcs, Regional State, Pacing) that tracks faction moves, NPC arc beats, regional conditions, and narrative tempo between turns, so the world keeps moving even when the player isn't looking at it. Start a campaign's Central Tension from category presets, your own words, or straight from the character card; a togglable HUD shows the tracked state without ever surfacing it to the narrator.

Together they solve the four core problems of LLM tabletop RP: the AI forgeting your inventory/spells, the AI forgetting long-term context, you always winning (aka. plot armor), and a world that only ever reacts instead of living on its own.  I have high confidence in the system's reliability—you can just play and not worry about tinkering with much of anything.

---

⚠️ **Updating?** To stay up to date after updating the extension, especially after updating to 2.0.0+, click on the "Update Main Sysprompt" button in the extension settings.

<img width="396" height="73" alt="image" src="https://github.com/user-attachments/assets/1bd13ed4-0afb-4ed4-84bc-d9bdfebc17d3" />

---

## Highlights

- **Dual-Engine Physics**: Deterministic queue for instant combat, and interactive tool calls for narrative skill checks.
- **Draggable HUD** with HP bars, spell pips, etc.
- **Automatic spell slot tracking** via 🔵 pips in the UI; never worry about remembering how many you have left.
- **Buff/debuff temporal decay** via [TIME] delta tracking; statuses expire automatically over time based on time elapsed.
- **Snapshot history + delta log** - easy rollback, and see at a glance what was changed in the state.
- **Auto model-switching** so that you can use a different model for tracking the state.
- **Full-context audit mode** in case you lose your state.
- **Custom fields, themes, reorderable sections**; track whatever you want beyond the stock fields and customize the visuals to your liking.
- **Automatic D&D wikidot spell links** - look up spells by clicking on them without awkward googling.
- **Mobile support** (open from the wand menu).
- **Talk to the tracker model directly via (💬)**, making editing or adding things easy.
- **Onboarding system** - roll up a random character or describe one to the model.
- **Profile saving** - switch between multiple campaigns without losing your state.
- **Homebrew-friendly** and flexible in general, relying on AI to do a lot of the lifting.
- **Automatic Long-Context Tracking** via the Lorebook Agent.

<div align="center">
  <figure>
    <img width="2800" height="auto" alt="image" src="https://github.com/user-attachments/assets/6eb8b2b6-d4f6-4fc8-9d34-988ad03331ba" />
    <figcaption>Yep, things can go wrong!</figcaption>
  </figure>
</div>

## Installation

**The packaged releases will likely not be up to date. I recommend cloning the repo or taking the steps below.**

1. Go to the SillyTavern extension menu.
2. Click on "Install extension" at the top.
3. Enter this repo's URL.

## Usage Guide

1. **Initial Setup:** Use the archetype buttons on the empty tracker to roll a new character, or paste an existing sheet into the "Raw View" (if your sheet doesn't align with what the UI expects, ask the model via 💬 to fix the formatting). Create a character card for your "narrator," such as Simulation Engine that I use. You can also name it something like Game Master.
2. **Auto-Tracking:** As you roleplay, the extension intelligently parses assistant responses. It detects losses of HP, new loot, or combat triggers, stitching together multi-part tool-call responses and running background passes to update the state.
3. **Prompt Injection & Execution:** The State Memo and RNG Queue are injected seamlessly into your outgoing prompt to act as the "source of truth." For narrative actions, the framework dynamically catches and resolves the AI's `RollTheDice` tool calls.
4. **Validation:** Use the Delta Log (δ) to verify changes. If the AI ever makes a mistake, step backwards using the Snapshot Navigation (←/→) to restore a clean state. Not really needed much in my experience, but the option is there.
5. **Turning Fatbody off:** the enable toggle (Settings checkbox or the panel's ⏻ button) is global, not per-chat — there's no per-campaign opt-in. Leaving it enabled means its system prompt and mechanics apply to *every* chat you open, not just the one running a campaign. If you want to step into an unrelated chat without Fatbody's D&D framing following you there, disable it first; re-enabling restores it.

## Basic Video Walkthrough of the RNG System
https://www.youtube.com/watch?v=1n5x7VBJ0IU

## Suggested Companions

- 🧠 **[Summaryception](https://github.com/Lodactio/Extension-Summaryception):** A brilliant summarizer/context compression extension. Also handy for crunching all the combat mechanics of the context into summarized history.

## Running with Other Extensions

### Megumin Suite

The Suite's narrative engines and Fatbody's default sysprompt both want to own the narrator persona. Two supported setups — **pick exactly one**:

1. **Additive delivery (recommended, v2.5.0+):** set *Sysprompt Delivery → Additive (rules only)* in Fatbody's settings. Fatbody never touches the Main prompt box; a rules-only prompt (dice, combat, XP, constraints — no role claim) is injected alongside the Suite's engine, which keeps the persona.
2. **Suite Mode + `[[FATBODY]]`:** enable *Suite Mode* and let the Suite inject Fatbody mechanics through its `[[FATBODY]]` block.

Do **not** combine both, or the mechanics get injected twice (Fatbody warns if you try).

Also recommended: disable the Suite's **NPC Bank** and **memory archiver** (they duplicate the Lorebook Agent / fight the tracker's chat reads), and set Fatbody's **External Token Reserve** (Advanced Options) to ~1000–2000 since the Suite injects after Fatbody's budget is computed.

### VectFox (RAG)

- **Text cleaning:** enable VectFox's **"Fatbody D&D Framework"** cleaning preset (VectFox 3.4.0+) so dice rolls, RNG queues, state memos, and status footers don't pollute its vector memory — only narrative prose gets vectorized.
- VectFox automatically leaves Fatbody's campaign books alone — Fatbody is the only extension that handles them, no configuration needed. (The *Semantic (VectFox)* entry-activation mode from 2.5.0–3.2.x was removed in 3.3.0; chats that used it are migrated back to *Managed* automatically.)

## Don't Care About D&D? Build Your Own RPG (v3.0)

**Modern mode** turns Fatbody into a custom RPG engine. Click **🏗️ Foundation Builder** in the settings: an AI architect interviews you about your world (it also reads your character card, persona, and any documents you paste), then generates the campaign *foundation* — power system with resource pools, dice profile, 3–6 starting classes, FFXIV-style Jobs, skill taxonomy, currency, and lethality rules. Committing locks the chat to Modern mode:

- **Levels 1–100** with a deterministic XP curve (the engine detects level-ups, not the model — no skipped or duplicated levels, ever).
- **Skill points** (+2 per level, +4 bonus every 10th) spent in a **🌳 Skill Tree** that opens in its own browser tab: constellation layout, search, staged purchases, respec (free through level 10, currency-priced beyond).
- **AI-forged skills, consistently narrated**: every skill carries a canonical descriptor the narrator must match forever — the fist-sized fireball you bought never inflates into a building-leveler. Active skills cost resources or cooldowns; passives bake into your stats. New tiers generate in the background as you level, never during a turn.
- **Standard lethality**: 0 HP means Downed, not dead — but run out the rescue window and you collect permanent Injuries (3 strikes before true death).

Existing chats are untouched (they simply *are* D&D campaigns); the mode is locked per campaign at creation.

Or go fully manual: scrap the entire system prompt and all the default fields and track your own things completely. The D&D setup is just a plug & play system that works by default. 

## What Model to Use?
Your primary narrator model must support **Tool Calling** for the Hybrid RNG system to work properly. 

<img width="920" height="246" alt="image" src="https://github.com/user-attachments/assets/f663cb1e-554a-40a2-a25e-f7af62c1a032" />


I like Deepseek 4 a lot so far, though it's still a new model. Gemini 3 is a good all-rounder; very fast and cheap. Sometimes its pace can be a bit much, though. GLM 5.1 is also a solid choice, but it can tend to reason far too long, bogging things down, especially in combat. Experimentation with different models is recommended.

For the state pass, I use Gemini 3.1 Flash Lite or Flash 3 with low reasoning. Very cheap and very good.

## Context Size & Token Budget

Fatbody's bundled system prompt (RNG system, combat, XP, saving throws, loot, level-up protocol, etc.) is **~4,100–4,500 tokens by itself**, before any chat history, State Memo, RNG queue, or lorebook content is added. SillyTavern's own default **Context Size** (in the API Connection settings) is **4095 tokens** — smaller than the sysprompt alone.

If your Context Size is too small, SillyTavern's own prompt-fitting silently drops content to make room, and it drops chat history first — including the player's most recent message. The narrator still responds, just with no idea what you actually said. This is easy to miss: it can seem to work for the first exchange, then quietly lose the thread from turn 2 onward as history stacks up alongside the sysprompt.

**Fix:** raise **Context Size** in your API Connection settings to comfortably cover the sysprompt plus your expected chat history plus the model's own output — **8192 or higher** is a reasonable floor for Fatbody, more if you're running a verbose narrator or Modern mode.

Once your base Context Size is adequate, Fatbody's own **Message Lookback**, **History Context (States)**, and **External Token Reserve** settings (Advanced Options) manage *its own* injections (State Memo, quests, lore) within whatever budget remains — but none of those help if the base Context Size itself is smaller than the sysprompt.

---

<p align="center">
  <img src="https://github.com/user-attachments/assets/a0e1c88c-092f-488b-b421-48cabe09e6e2" width="100%" alt="Combat in progress" />
  <br>
  <em>Some combat in progress</em>
</p>

---

<p align="center">
  <img src="https://github.com/user-attachments/assets/bd7debe0-b97d-4aa0-a8ec-49cd0fc527f3" width="500" alt="Lorebook Agent" />
  <br>
  <strong>Lorebook Agent</strong>
</p>

---

## License
MIT

***

*AND YES, IT IS FULLY VIBE-CODED IN ANTIGRAVITY AND CURSOR!*
