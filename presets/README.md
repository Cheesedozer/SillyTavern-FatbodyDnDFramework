# Running Origins inside another preset — the `[[ORIGINS]]` marker

This folder deliberately contains **no preset files**.

Origins doesn't need a forked preset. Turn on **Preset Marker** in the framework's
settings, paste `[[ORIGINS]]` into whatever chat-completion preset you already use,
and the framework substitutes its *live* rules there at generation time — following
your current module toggles and campaign mode. Nothing is frozen, so nothing drifts
out of date, and you never have to re-fork when either project updates.

This works with **any** chat-completion preset. [Megumin Suite](https://github.com/Arif-salah/Megumin-Suite)
is used as the worked example below because it's the most common pairing.

---

## Why no preset file lives here

Shipping a modified copy of someone else's preset just relocates the maintenance
problem — the copy goes stale the moment upstream ships a new version, and now
there are two things to keep in sync instead of one. Megumin Suite already
distributes its own presets in its [`Presets/` folder](https://github.com/Arif-salah/Megumin-Suite);
download them from there, then apply the one-line edit below.

---

## Setup

### 1. Framework settings

| Setting | Value |
|---|---|
| **Preset Marker (`[[ORIGINS]]`)** | **on** |
| **Suite Mode** | **on** (any preset that owns the Main prompt box) |
| **Sysprompt Delivery** | Additive |
| **External Token Reserve** (Advanced) | ~1000–2000 |

While Preset Marker is on, the rules are delivered **only** through the marker —
the framework stops pushing them as a separate extension prompt, so nothing is
injected twice. If the marker turns out to be missing from your preset, the rules
are appended to the first system message instead and you get a warning toast.

### 2. The one-line edit

Open your preset's prompt list and paste `[[ORIGINS]]` where you want the mechanics
to land. For Megumin Suite V9.1, the **Output RULES** prompt is the recommended
home — it sits at injection depth 1 (closest to the current turn, where rules hold
best) and is enabled in both of the preset's prompt orders:

```
## your thinking steps:
[[THINK]]

## FORMATTING RULES:
...

[[ORIGINS]]

## final reminder:
...
```

Prefer it higher up and further from the turn? The **Main 2** prompt works too.
Only the position changes — the content is identical either way.

### 3. Or add it as its own prompt

If you'd rather not edit an existing prompt, add a new one. In the preset JSON,
append this to the `prompts` array and add its identifier to the `prompt_order`
list you actually use:

```json
{
    "identifier": "origins-rpg-framework",
    "name": "Origins RPG Framework (live rules)",
    "role": "system",
    "content": "[[ORIGINS]]",
    "system_prompt": false,
    "marker": false,
    "injection_position": 1,
    "injection_depth": 1,
    "injection_order": 101,
    "injection_trigger": [],
    "forbid_overrides": false
}
```

---

## Turn these off — they fight the framework

This is the part that actually decides whether the pairing feels good. Big
narrative presets ship their own combat, death, and status-tracking rules, and
running them alongside the framework's gives the model two contradictory
rulebooks. For Megumin Suite specifically:

| Megumin toggle | Collides with | Do this |
|---|---|---|
| `[[combat]]` addon | `<combat>` — NPC tiers, AC/HP/attack tables, opportunity attacks | **Disable.** Megumin's "no plot armor, combat follows physical reality" framing overrides the framework's dice math — you'll get narrated outcomes instead of rolled ones. |
| `[[death]]` addon | Lethality — Downed at 0 HP, rescue window, 3 Injuries before true death | **Disable.** Megumin's instant-lethal rule deletes the Downed state entirely. |
| `[[infoblock]]` block | `<end_of_output_footer>` — the `*(Status: …) \| (XP: …) \| (Location: …)*` line | **Pick one.** Both emit a status block every turn; running both doubles the footer and confuses the tracker's parsing. |
| `[[MVU]]`, `[[storytracker]]`, `[[cyoa]]` | `<state_memo>` and tracker parsing | Judgement call — they overlap rather than contradict. Start with them off and add back what you miss. |
| NPC Bank | Lorebook Agent | **Disable.** |
| Memory archiver | The tracker's chat reads | **Disable.** |

Everything the framework tracks at runtime — the RNG queue, state memo, quests,
active lore — travels on a completely separate path (the generate interceptor,
prepended to your last message). It is unaffected by your preset and needs no
configuration.

---

## Checking it worked

Megumin has a built-in **Prompt Preview**. Open it and confirm:

1. No literal `[[ORIGINS]]` anywhere.
2. `The following mechanical subsystems are layered on top of your existing role…`
   appears exactly **once**, at the spot you put the marker.
3. `<rng_system>` and `<combat>` are present; `<role>` and `<narrative>` are **not**
   (the framework deliberately never ships its persona through the marker — your
   preset owns the narrator).

Then toggle any module off in the framework's Narrator Configuration and
regenerate. The preview should change immediately. That's the proof it's a live
pull rather than a snapshot.

### "Marker not found", but the marker is right there

The warning always refers to your **narration** turn. The framework's background
passes (Router, World Progression, the state model) build their own prompts and
never see your preset — they are skipped entirely and can't produce this warning.
So if it fires, check the narration turn's Prompt Preview: the prompt holding the
marker is most likely disabled in the active prompt order, or its content isn't
plain text. Note the match is exact apart from casing — `[[ ORIGINS ]]` with inner
spaces will not be recognized.
