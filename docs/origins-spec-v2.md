# Origins System Specification — v2 (AI Operating Document)

**Audience:** This document is written for Claude (or another AI model) running an origin-based character creation and roleplay system inside the Origins RPG Framework (SillyTavern extension). It defines the fields the AI must populate, the modifiers a player selects, the rules governing consistency, and how origin choices feed into ongoing quest generation. Follow it as an authoritative schema, not as suggested flavor text.

**Status:** Narrative/design spec for player review. No implementation is authorized by this document alone; the implementation plan is a separate pass.

---

## 0. Changes from v1 (summary for the reviewer)

**Locked scope decisions:**

1. **D&D mode only.** Origins runs exclusively in the framework's D&D campaign mode. Modern mode keeps its existing Foundation Builder flow untouched. (Modern-mode origin archetypes are a possible future pass, out of scope here.)
2. **Original setting.** The campaign setting is an original world (Section 2), Faerûn-*inspired* in tone but original IP. This resolves both the Wizards of the Coast product-identity problem ("Faerûn"/"Forgotten Realms" are not CC-BY content) and the internal contradiction between a fixed canonical map and the spec's dynamically generated nations.
3. **Integration, not duplication.** The quest system, world threat, and consistency ledger map onto the framework's *existing* Quests module, Central Tension / World Progression system, and Lorebook Agent (Section 11). No parallel systems are built.
4. **Master NSFW toggle.** One switch at creation start gates all NSFW content — the Intimate Physical Details section, breeding-farm modifiers, and the Pleasure/Promiscuity culture vibe — with the individual per-field opt-ins appearing only when it is enabled (Section 9).

**Structural fixes applied in this revision:**

- "Blank" and "modifier" are now defined terms (Section 0.1); duplicate fields (Decay State, Current-Era Vampire Treatment) are deduplicated.
- The Artifact-Bound Nobody's Pursuer Block contradiction is resolved: Pursuer is **default-on** with an explicit "no known claimants" opt-out.
- Status enums no longer mix exclusive states with orthogonal facts: "believed dead" is its own boolean field, separate from kingdom/party structural status.
- New incompatibility rules: Matriarchal × Patriarchal (hard block), pursuer "actively closing in" × "player believed dead" (soft — requires stated explanation), and a carve-out reconciling the Vampire Lord farms rule with the don't-track-minor-races rule.
- New global **Lever Guarantee Rule** (Section 0.2).
- Every origin now states what its Core Nation Block represents.
- Silkborn severance is promoted from an Exiled Royal special case to a shared block (Section 4.6) usable by any origin.
- The Vampire race's origin restrictions are now explicit in the compatibility matrix.
- Personal quests generate **lazily** (on narrative trigger), never as an upfront spoiler list.
- Family fate supports a "divided" (per-member) option.
- The multi-player-character clause from v1 §5 is removed — SillyTavern campaigns are single-persona.

**New content in this revision:** setting identity (Section 2), full Race Reference Blocks for all 12 races including complete Silkborn and Vampire write-ups (Section 3), full culture-vibe descriptions plus Government and Environment option lists (Section 4), the unified creation flow (Section 7), first-message generation (Section 8), NSFW gating (Section 9), and the integration mapping (Section 11).

### 0.1 Terminology

- **Modifier** — an enumerated choice the **player** selects from a fixed option list (dropdown/buttons in the UI). Modifiers are hard inputs: the AI never overrides them.
- **Blank** — a free-text field. The **AI proposes** a value (consistent with all selected modifiers) and the **player may edit or replace it** before committing. After commit, blanks are canon.
- **Derived field** — a value the AI synthesizes from modifiers and blanks. Never shown as an editable field; recorded in the consistency ledger on first use and reused verbatim thereafter.
- Every modifier group and every blank also offers **"🎲 Random"** and **"🤖 AI decides"** affordances (Section 7.4), so a player can commit a full origin with as few or as many decisions as they want.

### 0.2 Core principle and the Lever Guarantee Rule

Every origin has two mechanical levers that must actively influence play, not just backstory prose:

- **Social Lever** — something that lets NPCs recognize, react to, or treat the character differently.
- **Personal Lever** — an internal clock, cost, curse, dependency, or pressure that creates decisions over time.

Any generated content for an origin must produce output consistent with both levers. Backstory without mechanical consequence is not sufficient.

**Lever Guarantee Rule (new in v2):** a character may not finish creation without **at least one active Personal Lever and one active Social Lever**. Where an origin allows its default lever to be softened or disabled (e.g., Vampire Lord with intact power, Artifact-Bound Nobody with "no known claimants"), the creation flow must require a substitute lever before commit. Per-origin substitutions are listed in each origin's section. The UI enforces this at the review step; the AI enforces it when populating blanks.

---

## 1. Scope and Mode

- Origins is available **only** when the player selects **D&D mode** at onboarding. Selecting Modern mode routes to the existing Foundation Builder flow, unchanged.
- Within D&D mode, Origins is **optional**: the classic quick-roll path (Magic / Melee / Rogue / Persona archetype buttons) remains available as "Quick Start" (Section 12.1).
- Existing campaigns and chats are untouched. Origins applies only to newly created campaigns that opt into it.

---

## 2. Setting Identity — the world of **Vaelmarch**

An original high-fantasy continent, built specifically so that dynamically generated nations are a *feature of the fiction*, not a contradiction of it.

> **Naming note for the reviewer:** "Vaelmarch" is the working default. Alternates considered: **Therenfall**, **Ondrassa**. Swap freely — the name appears only in this section, the setting card, and generated prose.

### 2.1 Premise

Three centuries ago the continent-spanning **Argent Concord** — an empire of roads, treaties, and chained wonders — collapsed in a single generation. What remains is a continent of successor states: crowns claimed and lost, free cities, god-sworn orders, cult remnants, and frontiers where no census has been taken in living memory. **New nations rise and fall constantly**; no map of Vaelmarch is ever complete or current. This is the in-fiction justification for the Core Nation Block: whenever an origin invents a kingdom, it is one of the Concord's countless successor states, and its existence contradicts nothing.

### 2.2 Tone pillars

1. **Post-imperial fracture.** Power is local, contested, and personal. Every throne is arguably stolen; every border is an argument.
2. **The gods are near but not tame.** Divinity acts through champions, curses, oaths, and relics — never through tidy, reliable miracles. Abandonment by a god is a fact of life, not a theological scandal.
3. **The dead do not always stay put.** Liches, revenants, and vampire courts are established (if feared) parts of the world, which is why undead-facing origins work here natively.
4. **Wonder is salvage.** The Concord chained great artifacts and great entities; both are still being dug up. Artifact-bound nobodies are a known phenomenon with a name in most languages.

### 2.3 Fixed anchors (canon; everything else is dynamic-generation territory)

- **The Argent Concord** (fallen empire) — source of ruins, relics, royal bloodline claims, and the legal fictions every successor state leans on.
- **The Order of the Sealed Lamp** — a cross-border order of hunters, inquisitors, and archivists that tracks escaped relics, unlicensed necromancy, and broken oaths. Default institutional source for Pursuer Blocks when a player wants pursuit but doesn't care who pursues.
- **The Six Houses** (pantheon sketch; rename freely): the **Lantern** (light, guidance — patron of many Aasimar), the **Forge-Mother** (craft, endurance), the **Veiled Judge** (death, oaths), the **Tidecaller** (sea, change), the **Thorned Lady** (wild, harvest), and the **Hollow King** (ruin, forbidden knowledge — worshipped mostly by cults). Deities beyond the Six exist (dead gods, foreign gods, things worshipped as gods) and may be invented per campaign.
- **The Chorus-Weave** — the Silkborn hivemind network (Section 3.12). Its great hives sit at the continent's southern silk-roads.
- Everything not listed here — nations, cities, dynasties, cults, organizations — is generated per campaign via the shared blocks and stored in the consistency ledger.

### 2.4 Setting card distribution

- The setting ships as a **narrator/setting character card** in a `setting-cards/` folder in the repo (separate downloadable, as the user specified), with an **empty first message** (Section 8).
- **Recommendation carried into the implementation plan:** additionally offer a one-click "Install narrator card" button during onboarding (SillyTavern extensions can import cards), so the manual download is a fallback rather than the required path.
- **IP note:** nine of the twelve race names below appear in the CC-BY-4.0 SRD 5.2 (Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling). **Aasimar is not SRD content**; as free fan-adjacent usage the risk is low, but a rename option is noted in its race block. "Vampire" is generic. "Silkborn" is original to this project.

---

## 3. Race Reference Blocks

Twelve playable races. Each block supplies the data other systems draw from: the Core Nation Block's default environment and culture, the appearance section's sensible ranges, and naming conventions for AI-proposed blanks. These are *defaults*, not straitjackets — any field may be overridden by player choice.

Block format: **Habitat** (default nation environment) · **Lifespan** · **Naming** · **Culture defaults** (typical vibe leanings — never auto-selected) · **Appearance range**.

### 3.1 Human
- **Habitat:** any; heartland plains, river valleys, coasts by default.
- **Lifespan:** ~80 years.
- **Naming:** widest variation; regional flavor follows the origin nation's culture vibes.
- **Culture defaults:** none — humans take on whatever vibes are selected; the majority of Concord successor states are human-led.
- **Appearance range:** full real-world spread of skin tones, builds, hair, and eyes.

### 3.2 Dwarf
- **Habitat:** mountain halls, deep hills, canyon cities.
- **Lifespan:** ~350 years.
- **Naming:** clan-forward — personal name + clan name; clan names reference stone, metal, or deeds.
- **Culture defaults:** leans Strength-, Wealth-, or Collectivist-focused; grudge-ledgers and oath-keeping are cultural bedrock.
- **Appearance range:** 1.2–1.5 m, broad and dense; earth-tone skin; elaborate hair/beard braiding carrying clan meaning.

### 3.3 Elf
- **Habitat:** old-growth forests, river deltas, or ancient pre-Concord cities.
- **Lifespan:** ~750 years.
- **Naming:** flowing polysyllables; adult name chosen at first century.
- **Culture defaults:** leans Magic-prowess-, Intellect-, or Spirituality-focused; long memory makes elven nations slow to forgive and slow to change.
- **Appearance range:** tall and slender; skin from pale silver-toned through deep umber (regional); pointed ears; eyes sometimes metallic.

### 3.4 Gnome
- **Habitat:** hill warrens, forest burrows, workshop quarters of larger cities.
- **Lifespan:** ~425 years.
- **Naming:** long strings of personal names collected over a lifetime; friends pick one.
- **Culture defaults:** leans Intellect- or Technology-focused; institutional curiosity, low reverence for rank.
- **Appearance range:** 0.9–1.2 m; vivid eyes; expressive faces; hair in every natural and a few unnatural colors.

### 3.5 Halfling
- **Habitat:** river shires, terraced farm valleys, canal towns.
- **Lifespan:** ~150 years.
- **Naming:** homely given names + descriptive family names (Greenbottle, Fairbarrel).
- **Culture defaults:** leans Collectivist or Pleasure-adjacent (comfort, hospitality — distinct from the NSFW-gated vibe); famously unbothered neighbors of louder nations.
- **Appearance range:** ~0.9 m; nimble; curly hair common; round, open features.

### 3.6 Orc
- **Habitat:** steppes, badlands, contested marches.
- **Lifespan:** ~65 years.
- **Naming:** short, hard given names + earned epithets that change with deeds.
- **Culture defaults:** leans Strength- or Conquest-focused, but post-Concord orc successor states are as often disciplined frontier republics as warbands; live fast, build faster.
- **Appearance range:** tall, heavy-framed; gray-green to slate skin; prominent lower tusks; scarification as biography.

### 3.7 Goliath
- **Habitat:** high mountains, glacier lines, giant-touched highlands.
- **Lifespan:** ~80 years.
- **Naming:** birth name + honorific earned from a feat + lineage name.
- **Culture defaults:** leans Strength-focused and Collectivist — merit-counted contribution, hospitality codes at altitude, descent-lore tying clans to giantkind.
- **Appearance range:** 2.2–2.5 m; stone-mottled skin patterns unique as fingerprints; sparse hair.

### 3.8 Dragonborn
- **Habitat:** volcanic coasts, ancestral clanholds, mercenary city-states.
- **Lifespan:** ~80 years.
- **Naming:** clan name spoken *first*, personal name second; both resonant and consonant-heavy.
- **Culture defaults:** leans Strength- or Spirituality-focused; honor-debt accounting; draconic ancestry (chromatic/metallic) colors heraldry more than politics.
- **Appearance range:** 1.9–2.1 m; scale colors across the draconic spectrum; no hair; frills/horn ridges vary by lineage; breath-weapon element matches scale ancestry.

### 3.9 Tiefling
- **Habitat:** no homeland — diaspora quarters in other nations' cities; occasionally a founded haven-state.
- **Lifespan:** ~90 years.
- **Naming:** inherited infernal-sounding lineage names, or chosen "virtue names" (Hope, Rigor, Quiet).
- **Culture defaults:** none inherited — tieflings take the culture around them, plus a thick skin from being blamed for it; haven-states lean Collectivist.
- **Appearance range:** human builds; skin in human tones plus reds, violets, blues; horns (many shapes), tails, solid-color eyes.

### 3.10 Aasimar
- **Habitat:** as Tiefling — celestial-touched individuals born across all populations rather than a nation of their own; some gather at Lantern temple-cities.
- **Lifespan:** ~160 years.
- **Naming:** local naming plus a "gift name" bestowed in dreams by their celestial guide.
- **Culture defaults:** none inherited; individual aasimar often accrete Spirituality-focused expectations from others whether they want them or not — a built-in social pressure.
- **Appearance range:** human range plus luminous eyes, metallic freckling or hair-sheen, a faint radiance when emotional.
- **IP note:** "Aasimar" is not in the CC-BY SRD. Low risk for a free extension; if the project ever wants zero-question naming, the setting rename **"Dawnkin"** is reserved as a drop-in.

### 3.11 Vampire *(full write-up — playable undead race)*
- **Habitat:** night courts inside living nations, or (rarely) openly vampire-ruled successor states.
- **Lifespan:** unaging; destroyed, not died.
- **Naming:** the name they died with, often deliberately archaic — a vampire's name is a date stamp.
- **Culture defaults:** leans Wealth-, Death- (reverence sub-option), or Pleasure-focused; obsessed with continuity, custodianship, and etiquette that keeps predators from each other's throats.
- **Appearance range:** as their mortal race (usually human) but pallid, cold, still — no breath or heartbeat unless performed; fangs; eyes that catch light like an animal's at night.
- **Race mechanics (always on — these exist independent of any origin):**
  - **The Thirst (inherent Personal Lever):** a feeding clock. A fed vampire passes for eerie-but-fine; an unfed one visibly predatorizes over days — senses sharpen, restraint frays, and the AI should escalate intrusive hunger cues until the character feeds or loses a control check the fiction demands. Feeding choices (willing donors, bought blood, animals — weaker; the unwilling — stronger and corrosive to reputation) are standing moral decisions, not flavor.
  - **Daylight:** weakening, not instant destruction — direct sun burns slowly, suppresses vampiric strengths, and forces cover-seeking. Built for playability: day travel is possible, costly, and plannable-around.
  - **Recognition:** any character with reason to look closely (no heartbeat, no warmth, no reflection in silvered glass) can discover the truth — a permanent low-grade social exposure risk in living societies.
  - **Turning:** deliberate, slow, and rare — a drained mortal fed vampire blood over three nights. Accidental turning does not happen; every vampire was *chosen* by someone. (Who chose the player, and why, is a strong blank for any vampire character.)
- **Origin restriction:** see the matrix (Section 4.7). Vampire is playable only via the **Vampire Lord** origin or the **Exiled Royal** vampire variant. All other origins read "any living race," and vampires are not living. This is intentional: the Thirst plus a second personal lever from an arbitrary origin stacks poorly, and undeath rewrites most origins' premises. (A "Freed Undead Minion who was a vampire" is doubly dead and explicitly out of scope.)

### 3.12 Silkborn *(full write-up — original hivemind race)*
- **Concept:** a race of silk-spinning, moth-graceful humanoids who are individually bodied but collectively minded. Silkborn are threads; the **Chorus-Weave** is the cloth.
- **Habitat:** vast terraced hive-cities ("looms") along the southern silk-roads; warm climates; architecture of spun, hardened silk that outlasts stone.
- **Lifespan:** ~120 years for a body; experience persists in the Weave after death, which shapes their strange calm about mortality.
- **Biology & appearance range:** humanoid; smooth skin with a faint chitinous sheen in ivories, jades, duns, and charcoals; hair like fine silk floss, often pale; large eyes with layered pupils; slender spinneret channels along the forearms that produce workable silk (craft-grade, not a weapon by default); some bear feathery antennae. Silkborn emerge fully grown from communal silk cradles, woven — not born — and are individually sexless or sexed by choice of weaving; appearance fields remain fully player-customizable.
- **The Chorus-Weave (hivemind):** a continuous empathic-sensory link among all Silkborn of a hive. Not a single overmind issuing orders — closer to a permanent, ambient *congress*: every thread feels the Weave's mood, contributes to it, and can draw on its consensus memory. Decisions of weight are "sung through the loom" until agreement settles.
- **How a non-severed Silkborn adventures alone:** the link attenuates with distance. Within a hive it is total; on the road it thins to a day-delayed murmur — mood, not words. Far-traveling Silkborn (**reachthreads**) are the hive's traditional scouts, traders, and envoys, and are *expected* to develop provisional individuality, which the hive re-absorbs as precious experience when they return. A reachthread player character is therefore normal in-fiction: increasingly individual the longer and farther they travel, but never private — the Weave will eventually feel a summary of everything they felt. That "never truly private" quality is the standing roleplay texture of a non-severed Silkborn, and NPC reactions to it (fascination, distrust, exploitation) are its social hook.
- **Hive-sense:** near other Weave-linked creatures, a Silkborn passively reads collective mood and notices coordination (ambushes by linked creatures, crowd turns) before unlinked characters do. Weak or absent around individuals.
- **Speech and psychology defaults:** collective framing ("we" for the self is the untrained default); low native fluency in deception, privacy, and subtext — manifesting as social bluntness and difficulty lying, never as a stat penalty.
- **Severance:** being *cut from the Weave* — by exile, catastrophe, or choice — is the defining Silkborn trauma and is specified as a shared block (Section 4.6) so any origin can use it.
- **Naming:** thread-names: a hive name + a role-tone syllable + a personal syllable (e.g., *Vessa-loom-Ith*, shortened by outsiders to "Ith"). Severed Silkborn sometimes discard the hive name — or clutch it.

---

## 4. Shared Blocks

Defined once, referenced by every origin that uses them. When an origin's section says "uses Core Nation Block," populate it with the rules below.

### 4.1 Core Nation Block

Used by: all eight origins (each origin's section states **what the nation represents** for that origin — origin kingdom, current home, the liege's realm, etc.).

**Hard fields (modifiers + one blank):**

- Nation/Kingdom Name — **blank** (AI proposes per naming conventions of the majority race; player edits freely)
- Majority Population Race — **modifier** (defaults per the origin's race rule, Section 4.7; player may override, e.g., a human princess of a dwarf-majority nation)
- Government Type — **modifier**, from Section 4.3
- Culture Vibe(s) — **modifier**, 1–2 from Section 4.2 (unless the origin says otherwise)
- Location/Environment — **modifier**, from Section 4.4 (defaults to the majority race's habitat)

**Derived fields (AI-synthesized, never separately selected):**

- How the nation is viewed by outsiders — inferred from Culture Vibe + Government Type + Majority Race. Recorded in the consistency ledger on first generation; never re-rolled.
- Minor-race population makeup — **not stored**. Improvise consistent flavor when a scene calls for it; never blocks generation, never needs player input. *Carve-out:* a modifier elsewhere may set a **population flag** on the nation (e.g., Vampire Lord's farms modifier implies a substantial mortal minority — Section 5.2); flags are stored and honored, but full demographics still are not.
- General tone of daily life, aesthetics, architecture — inferred from the above; kept in the consistency ledger.

### 4.2 Culture Vibe Modifier List

Shared list; origins select 1–2. Internal descriptions below are for the AI's generation consistency and are **not shown to the player** (the player sees only the vibe names and one-line summaries). Treat all vibes neutrally as worldbuilding inputs, without real-world moral judgment.

1. **Spirituality/Religion-focused.** Daily life is structured around observance: bells, fasts, festival calendars, and clergy who function as courts and schools. Law and legitimacy flow from the sacred — rulers are anointed, contracts are sworn before altars, and heresy is a civic crime, not just a private one. Architecture reaches upward and inward: temples anchor every district and the grandest building is never the palace. Outsiders find the people generous, watchful, and quietly certain they are being judged.
2. **Strength-focused.** Status is earned through demonstrated prowess — martial, athletic, or the endurance of hardship — and every institution keeps score. Disputes lawfully resolve through sanctioned contest, leadership demands ongoing proof, and weakness is not despised so much as *pitied*, which can be worse. The economy prizes soldiery, monster-culling, and physical craft; monuments are of victors and the honored fallen. Visitors are tested early — often informally, always deliberately.
3. **Wealth-focused.** Value is the universal grammar: rank is denominated, marriages are mergers, and the ledger is a sacred text in all but name. Law protects contract and property above almost everything, courts are fast and fee-based, and debt is a moral state. Cities gleam where money flows and rot two streets away; patronage of art and science is conspicuous and competitive. Outsiders are welcome exactly as long as they are solvent.
4. **Intellect-focused.** Argument, scholarship, and demonstrable expertise confer rank; the university, archive, or examination hall is the true seat of power. Policy is debated in public and error carries social cost, making the culture rigorous, proud, and slow to admit mistakes. The economy runs on tutors, scribes, instruments, and the export of expertise. Aesthetics favor precision — geometry, annotation, and buildings that are arguments in stone.
5. **Magic-prowess-focused.** Arcane ability is the axis of status: the gifted are cultivated, ranked, and bound by codes, while the ungifted build lives in the infrastructure around them. Law treats spells like weapons — licensed, dueling-codified, and taxed. Everyday life is casually enchanted (lights, wards, messengers) in ways visitors find miraculous and residents find mundane. The deepest social divide is not wealth but *aptitude*, and everyone knows precisely where they stand.
6. **Collectivist.** The group — family, guild, commune, hive — is the moral unit; personal glory is mildly embarrassing and personal failure is everyone's business. Decisions take longer and hold firmer; hospitality and mutual obligation are near-absolute. Law punishes harm to the commons hardest, and exile is the gravest sentence on the books. Outsiders are treated kindly and held at arm's length until they are *of* something.
7. **Technology-focused.** Ingenuity outranks tradition: the workshop, foundry, and printing floor set the pace, and last decade's marvel is this decade's scrap. Guild-patent law is elaborate and fiercely litigated; apprenticeship is the universal ladder. Districts are loud, smoky, modular, and rebuilt constantly. The culture's blind spot is consequence — it reliably builds first and asks second.
8. **Death-focused** *(sub-option required at selection)*:
   - **Reverence for the dead.** The ancestors are present citizens: consulted, fed, and housed in necropoli finer than the homes of the living. Funerary rites structure the calendar, morticians and mediums hold clerical rank, and desecration is the culture's deepest crime. The tone is not grim but *continuous* — death is a change of address.
   - **Bringing death.** Killing is a mastered craft and a sacrament — duelists' guilds, sanctioned hunts, assassin-orders with public temples. Elaborate codes govern who may be killed, by whom, and how, and violating the code is far worse than the killing itself. Outsiders find the people courteous, precise, and terrifying.
9. **Matriarchal.** Women hold highest status: descent, property, and titles pass through the mother's line, and the defining institutions — councils, high clergy, officer corps — are female-led by law or unshakeable custom. Men's roles vary by nation (honored, restricted, or merely conventional) and make good texture, not caricature. Foreign arrangements are regarded as quaint or unstable.
10. **Patriarchal.** As above, mirrored: men hold highest status, patriline is law, and the institutions default male. The same generation guidance applies — texture and consequence, not caricature.
11. **Conquest-focused.** The nation understands itself as an expanding story: borders are provisional, treaties are intermissions, and prestige flows from what was taken and held. The army is the central institution and the surest ladder; veterans' colonies stud the frontiers. Subjugated peoples are integrated, taxed, or suppressed — *which* one is a defining choice worth generating deliberately. Neighbors arm accordingly.
12. **Pleasure/Promiscuity-focused** *(NSFW-gated — only offered when the master NSFW toggle is on; Section 9)*. Sensual pleasure is a civic good: courtesanship is a ranked profession, festivals are frequent and frank, and hospitality includes offers that startle foreigners. Consent codes are elaborate and strictly enforced — libertine, not lawless. The economy leans on luxury, artistry, and tourism; jealousy is considered a private failing, possessiveness a public one.

**Pair-interaction guidance:** when two vibes are selected, generate their *synthesis*, not two parallel flavors — Collectivist + Conquest reads as a citizen-legion state where service is belonging; Wealth + Conquest as a nation that wages acquisitions and audits its wars; Spirituality + Intellect as a theology of proofs where seminaries are universities; Strength + Death(reverence) as a culture whose honored dead are its ranking system. Where a pair genuinely grinds (Technology + Spirituality), the friction itself should be generated as a live internal politics, and noted in the consistency ledger.

**Hard block:** Matriarchal × Patriarchal may not be selected together (see Section 13).

### 4.3 Government Type Modifier List *(new in v2 — v1 had no options)*

Hereditary monarchy · Elective monarchy · Theocracy · Magocracy · Council republic / oligarchy · Merchant plutocracy · Military stratocracy · Tribal / clan confederation · City-state league · Necrocracy (rule by/for the undead) · Hive consensus (Silkborn looms) · Player-specified other.

### 4.4 Location/Environment Modifier List *(new in v2 — v1 had no options)*

Temperate heartlands · River valley / delta · Coast / archipelago · Old-growth forest · Mountains / highlands · Subterranean (halls, warrens, deep cities) · Desert / badlands · Steppe / plains · Tundra / glacial · Jungle / tropics · Swamp / marsh · Volcanic / ashlands · Player-specified other. Defaults to the majority race's habitat (Section 3); climate/terrain details derive from the pick.

### 4.5 Pursuer Block

Used by: Exiled Royal, Vampire Lord (only if "hiding from a rival/group" is the slumber reason), Freed Undead Minion (rival former-minion), Oathbreaker Knight, Willing Cultist, Defector Spy, Abandoned Champion (replacement champion, if enabled), **Artifact-Bound Nobody (default-on; see 5.6)**. *(v1's list omitted the last two entries — fixed.)*

**Fields:**

- Identity — blank (named individual, small group, or organized body)
- Affiliation — modifier (independent · hired by a faction · part of the origin nation/order itself · mix)
- Motive — modifier (capture · kill · reclaim something · silence · recruit back · replace)
- Resources/capability — modifier (rough power level relative to the player at campaign start: outmatched · comparable · superior · overwhelming-but-distant)
- Current awareness — modifier (knows the player's location · actively closing in · searching cold)
- Leverage — blank, *optional but preferred; mandatory for Exiled Royal (5.1) and Defector Spy (5.8)* — something held over the player beyond force: a hostage, blackmail, a person still cared about, a ruinous secret. Leverage turns pursuit into standing decision-pressure rather than a pure combat threat.

Instantiated **once at character creation** and treated as a persistent NPC/faction reference — written to the consistency ledger (as a Lorebook Agent entry; Section 11), never regenerated per scene.

**Soft rule (new in v2):** awareness = "actively closing in" is in tension with the origin nation believing the player dead (Section 5.1/5.4 boolean). It is allowed, but the AI must surface a stated explanation at creation ("the court believes you dead; the spymaster never did") rather than carrying the contradiction silently.

### 4.6 Silkborn Severance Block *(promoted from v1's Exiled Royal special case — now usable by any origin)*

Applies whenever a Silkborn character is **severed** from the Chorus-Weave — by exile (Exiled Royal), by a cult ritual (Willing Cultist), by death and reanimation (Freed Undead Minion, where the race-before-death was Silkborn), by an artifact's fusion (Artifact-Bound Nobody), or by choice. Non-severed Silkborn (reachthreads, Section 3.12) do not use this block.

- **Speech/thought:** collective framing ("we") is the default; shifting to singular self-reference is a conscious, gradual, visible effort. NPCs may notice and react — as uncanny, pitiable, alien, or intriguing, per their own culture.
- **Social bluntness:** little native concept of deception, privacy, or subtext — played as manner, not stat penalty.
- **The residual thread (Personal Lever):** severance is not perfectly clean by default. A faint, unreliable filament remains: occasional fragmentary sensory input from nearby Weave-linked creatures (soft utility — an uncommon warning sense) *and* a liability — the hive may sense or trace the character through it. If an origin's other levers are disabled, the residual thread satisfies the Lever Guarantee Rule; if the player opts for a *clean* severance, another personal lever must be active.
- **Reactions from linked Silkborn:** default to grief or hostility, never neutrality — a severed thread is a tragedy or a traitor to the Weave.

### 4.7 Race–Origin Compatibility Matrix *(clarified in v2)*

| Origin | Race rule |
| :---- | :---- |
| Exiled Royal | Any **living** race, including Silkborn (severed — uses Section 4.6). **Vampire variant** allowed: triggers the Vampire Nation sub-modifiers in 5.1 and the race mechanics in 3.11. Race sets the Core Nation Block's default environment and majority population unless overridden. |
| Vampire Lord | **Must** be Vampire (Section 3.11). Origin nation's majority population is vampire by default. |
| Freed Undead Minion | Player selects any **living** race as who they were **before** death (not Vampire — already-undead is out of scope, per 3.11). That choice drives the origin nation's majority population, appearance basis, and cultural details; current state is *undead layered on top*. A before-death Silkborn is severed by death itself (Section 4.6). |
| Oathbreaker Knight | Any living race. Silkborn permitted (reachthread by default; severed only if the broken oath was *to the hive*). |
| Willing Cultist | Any living race. Silkborn permitted; if the cult ritual severed them, apply Section 4.6. |
| Artifact-Bound Nobody | Any living race. Silkborn permitted; body-fusing artifacts may sever (player choice). |
| Abandoned Champion | Any living race. |
| Defector Spy | Any living race. A non-severed Silkborn spy is a walking contradiction (a creature with no native gift for deception, trained into it) — flagged as a *recommended* dramatic pairing, not a block. |

**Summary of the Vampire restriction:** Vampire race → Vampire Lord or Exiled Royal (vampire variant) only. Everywhere the table says "living race," vampires are excluded — explicitly, not by implication. *(v1 left this ambiguous.)*

---

## 5. Per-Origin Specifications

Each origin lists: what its Core Nation Block represents, unique blanks, unique modifiers, social lever, personal lever (with Lever-Guarantee substitutions), incompatibility rules, and quest-seed notes. All origins also use the Character Profile Template (Section 6).

### 5.1 Exiled Royal

**Uses:** Core Nation Block (**= the origin kingdom** the character was exiled from), Pursuer Block (**Leverage mandatory** — it is this origin's guaranteed personal lever for non-Silkborn characters).

**Unique blanks:**

- Player title (Prince, Princess, Duke, Regent, etc. — consistent with the government type)
- Succession logic — why this character specifically was heir (birth order, magical aptitude, council choice, last surviving line, …)
- Rival/usurper identity — populated via the Pursuer Block, **plus a stated claim** to the throne (blood, conquest, council appointment, forged legitimacy)
- Mark of royalty — a specific heirloom, tattoo, bloodline trait, or magical signature recognizable on sight or inspection
- Fate of family — dead · imprisoned · hunting the player · quietly aiding the player · **divided** (per-member notes: "mother executed; brother leads the hunt; aunt smuggles coin")
- Nation currently residing in (distinct from the origin kingdom; a name and one-line character is enough — full block not required)

**Unique modifiers:**

- Current status of the kingdom: still standing under the rival · in civil war · destroyed *(structural state only — v1's "believes the player dead" removed from this enum)*
- **Believed dead?** — separate yes/no: does the origin kingdom at large believe the player died in the exile?
- Reason for exile: betrayal by a trusted ally · forbidden pact (demon, unholy entity, forbidden magic) · failed overthrow attempt · framed by a rival · scandal (affair with a commoner, any gender) · corruption/contamination by an evil force · direct betrayal of the ruling body
- Slavery in the origin nation (optional; if unset, the AI may still introduce it later as a discovered trait without contradicting player choice)
- **Vampire Nation sub-modifier** (vampire variant only, NSFW-gated): blood "farms" — off by default, explicit opt-in (Section 9)

**Silkborn special case:** severed by exile — apply the Silkborn Severance Block (4.6). The residual thread is the personal lever; Pursuer Leverage becomes optional again for Silkborn.

**Social lever:** the mark of royalty — recognizable to those familiar with the kingdom, or with Concord-era heraldry generally. **Personal lever:** the Pursuer's Leverage (mandatory); Silkborn: the residual hive-thread.

**Incompatibility rules:**

- Kingdom = destroyed is incompatible with a rival "actively ruling" it — destroyed nations have no sitting usurper; use civil war or still-standing instead.
- Family "quietly aiding" and "hunting" are mutually exclusive as *monolithic* picks; use **divided** for both-at-once.
- Vampire Nation farms require race = Vampire and majority population = Vampire.
- Pursuer "actively closing in" + Believed dead = yes → allowed with stated explanation (Section 4.5 soft rule).

**Quest-seed notes:** reclaiming, avenging, or permanently renouncing the throne.

### 5.2 Vampire Lord

**Uses:** Core Nation Block (**= the origin kingdom the character ruled before slumber**, and what it has become), Pursuer Block (only if "hiding from a rival/hunting group" is the slumber reason).

**Unique blanks:**

- Cult name and psychology (only if awakened-by-cult is chosen)
- Memory integrity — how intact centuries-old memories are; how much of "their world" must be relearned versus recalled
- Who turned the character, and whether their maker still exists (new in v2 — follows from 3.11's turning rules; may be left "unknown")

**Unique modifiers:**

- Current physical/power state: weakened, recovering over play · largely intact
- Reason for slumber: boredom/weariness with an unchanging life · prophecy · avoiding a catastrophe · hiding from a rival or hunting group (→ Pursuer Block)
- Kingdom's state at time of slumber: peace · mid-war · mid-overthrow
- Legacy left behind: tyranny · bloodshed · abstainment (refused to drink from sentient creatures — may have seeded a culture of "vegan" vampires) · knowledge-seeking · wealth-hoarding · indulgence/pleasure · art/culture preservation · reduced to unreliable myth (the kingdom mythologized a different version of them)
- Current-era treatment of vampires generally: widely feared and hunted · unknown/mythical · cautiously tolerated · integrated/accepted *(modifier only — v1 listed this in both blanks and modifiers)*
- What awakened them: adventurers by accident · a worshipping cult · someone desperate to stop a threat (possibly born of the character's own legacy)
- Breeding "farms" in the current-day kingdom (NSFW-gated, off by default): most natural with legacy = tyranny/bloodshed or an empire grown oppressive during the slumber. **Selecting it sets a stored population flag: the nation retains a substantial mortal minority** (the Section 4.1 carve-out).

**Social lever:** legacy reputation layered with the current-era treatment of vampires as a category. A cult worshipping an inaccurate version of the character is a premium hook — be ready to let them correct, exploit, or be trapped by the myth. **Personal lever:** weakened power recovering over play, and/or memory integrity requiring active relearning — **at least one must be active** (Lever Guarantee). A player selecting intact power *and* intact memory must accept a substitute lever; default substitute: **the Thirst, sharpened** — a lord's appetite grown imperious with age (3.11's feeding clock at elevated stakes).

**Incompatibility rules:**

- Legacy = abstainment is incompatible with farms existing *at the moment they slept*; farms built **after** their departure by successors is not blocked — it is an intentional narrative twist the AI should surface explicitly ("the empire built this in defiance of everything you stood for"), never silently resolve.
- Slumber reason is one primary pick; boredom and hiding may both be true only if the player explicitly opts into a compound reason — the primary drives tone.
- Farms require a substantial living population (the flag above); incompatible with a fully vampire-populated society.

**Quest-seed notes:** reclaiming standing, confronting what the legacy became, or building something different this time. World-threat tie-in: a threat born from the character's own legacy (an empire grown monstrous, a cult acting in their name) is the strongest default.

### 5.3 Freed Undead Minion

**Uses:** Core Nation Block (**= the nation/community of the character's living life**, populated via the before-death race), Pursuer Block (the rival former-minion).

**Unique blanks:**

- Name of the lich who controlled them, and why the lich was feared
- Current location on breaking free
- Rival former-minion — via Pursuer Block, plus one added field: **do they know the player is free yet**, or is that a pending reveal
- Role served under the lich (soldier, guard, errand-servant — shapes retained skills and muscle memory)
- Decay description — the prose picture of the character's undead state *(the on/off clock lives in the modifier below; v1 double-listed this)*

**Unique modifiers:**

- Who they were before death (one archetype; memories resurface in full by default on breaking free):
  - **Fallen soldier** — died in a battle that decided their homeland's fate; doesn't yet know whether the sacrifice mattered.
  - **Dying commoner** — died of disease while laboring to lift their family from poverty; doesn't know what became of them.
  - **Assassinated royal** — killed by conspirators; seeks reckoning with the killers or their descendants.
  - **Fallen tyrant** — died because even their own physician refused to save them, a direct consequence of their atrocities; closure is atonement or its refusal, never vindication.
- Memory reliability: accurate by default; optionally the AI seeds one or more **subtly inaccurate** memories — only if it can pay off with a concrete future beat, never left dangling.
- Decay state: **static** (does not worsen) · **worsening** (a soft clock pressuring action before passing-as-living becomes impossible)
- Retained lich-knowledge: fragments of the lich's memories or magic — useful, with a mandatory soft corruption risk

**Social lever:** visible undead traits — fear, hostility, or violence on sight from most societies; passing as living (if decay is mild) is an active concern. **Personal lever:** worsening decay clock and/or lich-knowledge corruption and/or the rival's standing threat — at least one active (static decay + no lich-knowledge → the rival former-minion Pursuer becomes mandatory).

**Incompatibility rules:**

- Fallen tyrant × vindication-framed closure arcs — quests must build on atonement, confrontation by the wronged, or villainous refusal.
- Retained lich-knowledge × "no corruption risk" — if the modifier is on, a corruption mechanic exists, even if minor.
- Decay = static × urgency-to-pass-as-living hooks — those hooks require the worsening clock.

**Quest-seed notes:** closure per archetype (confirming the sacrifice mattered, finding the family, confronting killers, facing the wronged). World-threat tie-in: the rival former-minion attempting to become the next lich is the default throughline; the world threat need not resolve when personal closure does.

### 5.4 The Oathbreaker Knight

**Uses:** Core Nation Block (**= the realm of the order/faith/liege the oath was sworn to** — the character's homeland only if those coincide), Pursuer Block.

**Unique blanks:**

- Name of the god, order, or dead liege the oath was sworn to
- How the oath was broken (the specific act)
- Why the oath was broken (the narrative reason behind the act — distinct from *how*)
- Nature of the curse (prose specifics of the selected curse type)

**Unique modifiers:**

- What the oath represented: tyranny · love · bloodshed · justice · peace *(bloodshed→pacifism is the strong "broke it by becoming better" arc; justice/peace→desperation or corruption is the strong "broke it by becoming worse" arc)*
- Status of the sworn-to party: still standing · under a usurper · destroyed · in civil war *(structural only)*
- **Believed dead?** — separate yes/no: does the order/faith believe the player died?
- Curse type: slow transformation into a monster · inability to remove their armor · periodic involuntary animal transformation · compulsion to self-harm · a split personality that can seize control and act without the character's later knowledge
- Curse visibility: visible by default (mark, chains, changing features, overt symptom); hidden as an optional modifier

**Social lever:** the visible curse mark — recognizable to those familiar with the order/faith, unsettling to everyone else. **Personal lever:** the curse itself, especially compulsion or personality-split variants. A *hidden* curse weakens the social lever, so hidden visibility requires the sworn-to order to remain an active recognition threat (Pursuer or loyalist remnants who *know the signs*).

**Incompatibility rules:**

- Split-personality curse × hidden visibility (the alternate personality causes public incidents) — hidden pairs with subtler curses (armor-lock, slow transformation) only.
- Party = destroyed × a Pursuer sourced from that party as an intact body — pursuit from a destroyed order must be explicitly framed as a splinter/remnant group.
- Pursuer "actively closing in" × believed dead — allowed with stated explanation (4.5).

**Quest-seed notes:** lift the curse, embrace what it's becoming, or find a version of the oath they can live with. World-threat tie-in: the order's remaining loyalists, or the consequences of whatever the broken oath was protecting against.

### 5.5 The Willing Cultist

**Uses:** Core Nation Block (**= the nation the character currently resides in**; a second, smaller block for their home nation if an outsider), Pursuer Block.

**Unique blanks:**

- Cult name
- Cult symbol/mark (the specific recognition trigger)
- Nation of origin (outsiders only)

**Unique modifiers:**

- Origin status: native · outsider (→ populate the secondary nation block)
- Role in the cult: leader · follower
- What the cult worshipped: an entity/force of death · knowledge · indiscriminate bloodshed · sacrifice · magic prowess · soul-consumption
- Who pursues (via Pursuer Block): government · bounty hunters/hired muscle · remaining cult members · an opposed religious order · a mix
- Why they left: disillusionment · a prophecy/vision from the entity itself
- Still secretly worshipping? If yes: an active burden/task (consuming others' magic, sacrifice, killing, forbidden knowledge-gathering)
- Legal status of the cult — a general tendency, not a universal law: mostly illegal · mixed · mostly legal. Because nations are generated dynamically, individual nations may deviate when the story is served; the tendency is the AI's baseline when generating a new nation's stance.

**Social lever:** the cult's symbol/mark — recognized by those familiar with the cult, rival orders, or government watch-lists per legal status. **Personal lever:** magical dependency by default — leaving does not remove the pull. Recurring in-fiction pressure (cravings, visions, weakening without contact), not a one-time beat. The dependency is this origin's guaranteed lever and **cannot be disabled** — a cultist without the pull is a different character concept.

**Incompatibility rules:**

- Role = leader × pursuer motive "recruit back," unless the cult explicitly wants their *leadership* back — followers suit recapture/silence motives; leaders suit power-struggle motives.
- Legal status = mostly legal is in tension with a government Pursuer — reframe the government's motive as targeting the character *specifically* (a particular law or oath broken), not general illegality.

**Quest-seed notes:** resisting or succumbing to the dependency, settling accounts with former cult-siblings, reckoning with what they did as a believer. World-threat tie-in: the entity's larger goal proceeding with or without the character.

### 5.6 The Artifact-Bound Nobody

**Uses:** Core Nation Block (**= the character's home nation**, where they found the artifact), **Pursuer Block — default-on** *(v2 resolution of the v1 contradiction)*: the artifact's original faction wants it back. The player may opt out only by explicitly selecting **"no known claimants"** (ancient/masterless artifact), which requires a substitute personal-pressure source (see levers below).

**Unique blanks:**

- Artifact's name, and the name it gives *itself* (may differ)
- Physical description of the artifact
- How the commoner found it

**Unique modifiers:**

- Prior occupation: blacksmith · farmer · thief · tradesman · clothes-maker · player-specified equivalent
- Artifact form: bladed weapon · blunt weapon · armor · wearable (necklace/jewelry) · held object (e.g., a lantern) · fuses into the body
- Resident entity: god · demon · person · other
- Artifact personality: self-important/expects deference · bloodthirsty/impatient without combat · wise mentor · sassy/critical of improper use · a mix
- Known power: grants magical knowledge · raw magical power · physical strength/instant combat mastery · raises dead/summons extradimensional entities (specify controllability) · transformation (self → animal/monstrous/other people, or others → monsters)
- Cost of use: consumes memories · consumes blood (own or others') · requires magic as fuel · consumes soul-energy (own or others') · consumes large quantities of food
- Detectability (fixed default, not a toggle): the artifact can speak/act somewhat independently — including resisting being surrendered or discarded — and can be sensed by mages, its original faction, and other bonded individuals

**Social lever:** detectability — those who can sense the artifact recognize and react to the character independent of the character's own reputation. **Personal lever:** the cost of use, weighed at every invocation, compounded by the artifact's own agenda. With "no known claimants" selected, the artifact's *agenda* must be concrete and active (the entity wants something and pushes for it) so external pursuit's absence doesn't leave the origin pressureless.

**Incompatibility rules:**

- Cost = consumes memories × casual, harmless-framed frequent use — the cost escalates and is narratively consequential each invocation, never a flat toll.
- "No known claimants" × a defined, still-active original faction — mutually exclusive by definition; pick one.

**Quest-seed notes:** the relationship with the entity — trust, control, rebellion, or deeper merging — as much as the power itself. World-threat tie-in: the original faction's plans for the artifact, or what the entity wants long-term.

### 5.7 The Abandoned Champion

**Uses:** Core Nation Block (**= the nation that celebrated them** — where the destiny was fulfilled and the reputation is loudest; their birthplace only if the player says so), Pursuer Block (the replacement champion, if enabled).

**Unique blanks:**

- Name of the god/deity who chose them
- What the destiny was, in specifics (slew a great monster/demon/evil god, ended a long conflict, …) *(moved from modifiers in v1 — it's free-narrative, not an enumerated pick)*
- The moment of abandonment — when and how the character *realized* the god was gone (new in v2; this origin was blank-poor and this is its defining scene)

**Unique modifiers:**

- Why abandoned: discarded by the god after use · the god died/vanished
- Allies: still has them · abandoned by companions as well
- Hunted by people wronged in the course of fulfilling the destiny? (yes/no)
- Resented by those who feel the champion came too late, despite eventual success? (yes/no)
- Fading power (default **on**): the granted blessing is finite and diminishing over play — a clock forcing the character to decide who they are without it
- Replacement champion (optional): chosen by the same faith or a rival faith — via Pursuer Block with motive reframed as rivalry/succession, unless the player wants open antagonism

**Social lever:** public reputation as *the* champion — reverence, resentment, or both, recognizable by name and deed without any physical mark. **Personal lever:** the fading power clock. If the player disables fading power, a substitute is required; defaults offered: the replacement champion becomes mandatory (succession pressure), or "hunted by the wronged" must be yes with an active seeker.

**Incompatibility rules:**

- God died/vanished × a Pursuer motivated by that god's *direct orders* — a gone god gives no orders; pursuit must be independently motivated (the faith's institution, not the deity).
- Fading power × "already fully depleted at creation" — the fade must be in progress, or it isn't a functioning lever.

**Quest-seed notes:** identity after purpose, reconciling with those who revere or resent them, deciding what to do as the power fades. World-threat tie-in: whatever the destiny suppressed resurging, or the replacement champion's actions creating new consequences.

### 5.8 The Defector Spy

**Uses:** Core Nation Block (**= the nation the organization served or operated from** — the theater of the character's former work; note in one line if the character's birthplace differs), Pursuer Block (**Leverage mandatory** — see below).

**Unique blanks:**

- Name of the organization
- False/cover name they operated under
- The trained-observer **"tell"** — a posture habit, reflex, or signature technique legible to people trained in the same tradition (the recognition mark, parallel to the Royal's heirloom)

**Unique modifiers:**

- Specialty: espionage · assassination · a mix
- Affiliation: a government · an outside/independent organization
- Reason for defecting or doubting: forced to kill people they cared about · came to see a target as a person and declined to kill (failed the mission) · a target so evidently good it broke the job's logic · discovered the organization served harmful ends rather than any legitimate cause
- Pursuer Leverage (mandatory): blackmail material · a hostage · someone they still care about inside the organization

**Social lever:** the tell — visible only to other agents, handlers, and the similarly trained; invisible to ordinary people. **Personal lever:** the organization's leverage — an active, ongoing comply-or-risk-it decision pressure. Mandatory; a spy the organization holds *nothing* over would need pursuit on general principle alone, which v1 already identified as weak.

**Incompatibility rules:**

- "Discovered the organization served harmful ends" × affiliation = government, without specification — state whether the *whole* government is corrupt or a rogue faction within it; the two carry very different worldbuilding weight.
- Leverage = "someone they love inside the organization" × allies-framing "fully abandoned, no remaining ties" — pick one.

**Quest-seed notes:** severing or resolving the leverage, confronting former handlers or targets, deciding what loyalty survives defection. World-threat tie-in: the organization's larger operation — which the character has inside knowledge of — continuing regardless.

---

## 6. Character Profile Template

All eight origins populate this same profile. Origin-specific blanks feed the relevant sections; do not invent additional top-level sections per origin.

1. **Identity** — name, title (if any), race, origin type
2. **Nation/Faction Block** — populated Core Nation Block (plus the secondary block for outsider Cultists)
3. **Backstory** — narrative prose synthesized from the origin's blanks and modifiers
4. **Physical Appearance** — populated from the creation flow's descriptor fields (Section 7.2): skin/body color, body type, height, hair, eyes, face shape, distinguishing marks — *plus* origin-relevant traits (decay state, curse marks, artifact fusion). Excludes worn clothing/equipment. If the NSFW toggle is on and the player filled the Intimate Physical Details section, those live in a **separate sub-block** here, injected only per Section 9's rules.
5. **Social Recognition Lever** — the specific mark/tell/symbol/reputation, and *to whom it is legible*
6. **Personal Pressure Lever** — the active clock, cost, curse, dependency, or leverage (Lever Guarantee: never empty)
7. **Pursuer/Rival** — populated Pursuer Block, where applicable
8. **Current Goal/Motivation** — short, player-facing statement of what the character wants right now
9. **Talents/Abilities** — populated **at commit** by the framework's existing D&D stat generation (the same pipeline as the current archetype buttons), flavored by the origin (a Defector Spy leans Rogue-pattern, an Oathbreaker leans Paladin/Fighter-pattern, etc.). *(v1 deferred this to a future mechanical pass; v2 does not — the tracker cannot run without `[CHARACTER]`/`[SPELLS]`/`[ABILITIES]` blocks, so mechanics generation is part of commit, reusing what already exists.)*
10. **Personality/Voice Notes** — how the character speaks and carries themselves, distinct from what happened to them
11. **Quest Seed Log** — tracks fired, active, and resolved personal quests only (Section 10 — lazy generation; no upfront spoiler list)
12. **World-Threat Tie-In** — the thread connecting this origin to the campaign's Central Tension (Section 11)

---

## 7. Unified Creation Flow (onboarding UX)

The v1 spec and the original pitch described two disconnected flows (descriptor form vs. origin schema). This section unifies them. UI conventions follow the framework's existing patterns: a persisted step machine (survives reloads), locked commits, and one-shot AI generation with status labels.

**Surface:** character creation opens as a **dedicated full surface** (own browser tab or full-screen overlay — implementation decision), like the existing Skill Tree, because the field count outgrows the HUD panel. The HUD panel shows compact progress ("Creating character — step 3/6 — Resume") and hosts the entry point.

### 7.1 Step sequence

1. **Mode select** *(existing step, unchanged)* — D&D → offers **Origins (recommended)** and **Quick Start** (classic archetype roll, Section 12.1); Modern → existing Foundation flow, untouched.
2. **Campaign options** — starting level (existing selector), **master NSFW toggle** (Section 9), narrator-card check (offer one-click install of the Vaelmarch setting card if absent).
3. **Race** — pick from the 12 (Section 3), each with a one-line summary; Vampire is visibly tagged "requires Vampire Lord or Exiled Royal origin."
4. **Appearance** — the descriptor fields: Skin/Body Color · Body Type · Height (specific or relative) · Hair · Eyes · Face Shape · Distinguishing Marks. All free-text blanks with race-informed AI proposals. **Intimate Physical Details** appears as a collapsed optional section *only* when the NSFW toggle is on: Chest/Breasts · Ass/Hips · Intimate Parts · Size Details · Type Details · Other Physical Notes — every field skippable.
5. **Origin** — pick one of the eight (race-filtered per the matrix), each with a two-line pitch and its social/personal levers named up front.
6. **Origin detail** — the origin's modifiers and blanks, grouped: origin-specific picks → Core Nation Block → Pursuer Block (where applicable). Incompatibility rules (Section 13) enforce live: blocked pairs are disabled with a one-line reason; soft-tension pairs show the required explanation blank.
7. **Review & commit** — the full Character Profile (Section 6) rendered for reading, every blank editable in place, Lever Guarantee validated. **Commit is final** (matching the Modern-mode class-lock precedent): it runs stat generation (field 9), writes the profile and ledger entries, and generates the first message (Section 8).

### 7.2 Where the data lives

Committed origin data flows into the framework's existing state, not a new store: appearance and identity into the memo's `[CHARACTER]` block; the origin profile (levers, nation, pursuer summary) into a new `[ORIGIN]` memo block; full nation/pursuer canon into Lorebook Agent entries; the world-threat tie-in into the Central Tension compiler (Section 11).

### 7.3 Persona import

A **"🎭 From Persona"** action (existing pattern) pre-fills race, appearance blanks, and personality notes from the active SillyTavern persona; the player continues through origin selection normally.

### 7.4 Randomization ladder

Every step offers three speeds: pick manually · **🎲 Random** (uniform roll over valid options, honoring incompatibilities) · **🤖 AI decides** (the model picks for coherence with everything chosen so far). A single **"Forge me a character"** button at step 3 runs the whole ladder end-to-end and lands the player directly on Review — the smooth-path guarantee: a complete origin character in one click plus one confirm.

---

## 8. First Message Generation

- The shipped setting card's `first_mes` is **empty by design**. The card is a narrator, not a character; a canned greeting cannot know the player's origin.
- On commit (step 7), the framework generates the campaign's **opening narration** from the completed profile — origin, levers, nation, pursuer state, and current goal — via the existing direct-prompt channel, and inserts it as the first assistant message.
- The player chooses an **opening frame** before generation (a small modifier, defaulting to the origin's natural entry):
  - **In medias res** — the origin's pressure is already live (the Vampire Lord's tomb is being opened; the Freed Minion's control severs mid-errand).
  - **Quiet start** — a scene of ordinary life in the current location, with the levers present but ambient.
- A **regenerate** affordance re-rolls the opening without touching the committed profile. This removes v1's "it's limiting, but…" concern: the opening is derived, optioned, and re-rollable rather than canned.

---

## 9. NSFW Gating (master toggle)

- One **master NSFW toggle** at step 2 of creation. Default **off**.
- **Off:** the Intimate Physical Details section does not render; the Pleasure/Promiscuity culture vibe is not offered; breeding-farm sub-modifiers (5.1, 5.2) do not render; the AI is instructed not to introduce equivalent content unprompted.
- **On:** each gated element appears as its own opt-in, all defaulting off — the toggle *reveals* choices, it never *makes* them. Filled intimate-detail fields are stored in the profile's separate sub-block (Section 6, field 4) so the AI states rather than improvises anatomy in NSFW scenes; unfilled fields stay unfilled.
- The toggle is recorded per campaign and respected by all downstream generation (nations, quests, first message).

---

## 10. Quest System

**Structure:** each origin supports **5–10 personal quests** tied to closure of that character's unfinished business (reclaiming a throne, confronting a legacy, settling the rival former-minion, lifting or embracing a curse, resolving cult dependency, negotiating the artifact's agenda, finding identity after abandonment, severing organizational leverage). Finite and fully resolvable — completing them is narrative closure on the personal arc.

**Generation timing (v2 rule): lazy.** Quests are *not* pre-generated at creation. A personal quest is generated at the moment narrative context makes it plausible — a relevant location, NPC, or piece of information surfaces — and is then logged. The Quest Seed Log (Section 6, field 11) records **fired, active, and resolved quests only**; there is no player-visible list of future quests to spoil. The origin's quest-seed notes (Section 5) are the AI's private menu of directions, not a queue.

**Separation from the world threat:** the campaign sustains a persistent world-level threat independent of any personal quest count — in this framework, that is the **Central Tension** (Section 11). The origin's world-threat tie-in is the connective thread between personal history and that larger problem. Personal closure does not resolve the world threat; the world threat does not gate personal closure. Two tracks, intersecting narratively, never gating each other mechanically.

**Pacing rules:**

- Do not front-load personal quests and abandon them; distribute triggers across the campaign's full arc.
- Surface a quest when context makes it plausible, never on a fixed schedule.
- After a quest resolves, do not immediately manufacture a replacement from the same thread unless the resolution logically opens one (resolving "confirm the sacrifice mattered" can open "what do they owe the people who mourned them").
- World-threat beats continue independent of personal pacing; stall neither for the other unless the fiction demands it in-scene (an active siege makes a slow personal errand implausible).
- Consult the Quest Seed Log before pacing decisions rather than re-deriving from scratch.

---

## 11. Integration Mapping (spec concept → existing framework system)

Locked decision 3: Origins extends what the framework already runs. This table is binding for the implementation plan.

| Spec concept | Existing system | Integration |
| :---- | :---- | :---- |
| Personal quests (Section 10) | Quests module (`LogQuest` tool, deadlines, statuses) | Origin quests are LogQuest entries with an origin-source tag; lazy generation via the existing quest-creation path |
| World threat / world-threat tie-in | World Progression: Central Tension compiler, milestone chain, chapter seeds | The committed origin's tie-in becomes a **new input mode for the Central Tension compiler** (alongside preset/custom/from-card): it seeds `intimateConflict` from the personal lever and `epicConflict` from the tie-in |
| Consistency Ledger | Lorebook Agent | Core Nation Blocks, Pursuer Blocks, and derived fields are written as lorebook entries at commit; the agent maintains them thereafter — canon once stated |
| Character Profile (Section 6) | State memo | Identity/appearance → `[CHARACTER]`; origin summary + levers → new `[ORIGIN]` block; the state pass keeps both current |
| Talents/Abilities (field 9) | Existing archetype stat generation + state pass | Runs at commit with origin-flavored prompts; produces the `[CHARACTER]`/`[SPELLS]`/`[INVENTORY]`/`[ABILITIES]` blocks the tracker requires |
| Creation wizard (Section 7) | Onboarding step machine + Foundation Builder patterns | Extends the persisted step-machine; generation follows the Foundation Builder's generate → validate → retry → preview → commit shape |
| First message (Section 8) | Direct-prompt channel | Same channel the archetype buttons use today |
| World Arc gate | Existing post-character gate | For origin characters, the gate pre-fills from the tie-in instead of starting cold |

---

## 12. Escape Hatches & Compatibility

### 12.1 Quick Start (classic path preserved)
The existing archetype buttons (✨ Magic / ⚔️ Melee / 🗡️ Rogue / 🎭 Persona) remain available beside Origins at mode select. No origin, no nation block, no pursuer — exactly today's behavior. Origins is additive, never a replacement.

### 12.2 Blank slate
"Describe your own character via 💬" (the existing manual path) also remains. A player may run any character with zero origin machinery.

### 12.3 Commit lock and edits
Origin choices lock at commit, matching Modern mode's class lock. Blanks-as-canon may still evolve *narratively* (a destroyed kingdom can be rebuilt in play); the ledger updates through the Lorebook Agent as the story moves, but the creation-time selections themselves are not re-editable through the UI.

### 12.4 Existing campaigns
Untouched. Origins appears only for new campaigns. No migration, no changes to current chats, profiles, or memos.

---

## 13. Incompatibility Rules — Cross-Origin Notes

Beyond the per-origin rules in Section 5:

- **Hard blocks** are reserved for combinations that break internal logic: Matriarchal × Patriarchal (4.2); destroyed kingdom × sitting usurper (5.1); destroyed order × intact-body pursuer (5.4); "no known claimants" × active original faction (5.6); god-gone × god-ordered pursuit (5.7); fading power × already-depleted (5.7).
- **Soft tensions** are surfaced, never silently resolved: abstainment legacy × successor-built farms (5.2 — the flagship intentional-irony case); pursuer closing in × believed dead (4.5); mostly-legal cult × government pursuer (5.5); harmful-ends discovery × government affiliation (5.8). Where a contradiction is narratively interesting, prefer making it an explicit story beat.
- Pursuer Blocks are **per-campaign singletons**: instantiated once at creation, persisted via the ledger, never regenerated or merged with anything else. *(v1's multi-player-character clause is removed — the framework runs one player character per campaign.)*

---

## Appendix A — Open items deliberately left to the implementation plan

- Overlay vs. dedicated-tab for the creation surface (Section 7, "surface").
- Exact prompt templates for origin blank-proposal, stat generation flavoring, and first-message generation.
- The one-click narrator-card install mechanics (2.4).
- Final setting name confirmation (2.0: Vaelmarch / Therenfall / Ondrassa) and any pantheon renames.
- Whether "Dawnkin" replaces "Aasimar" (3.10 IP note) — default is keeping Aasimar.
