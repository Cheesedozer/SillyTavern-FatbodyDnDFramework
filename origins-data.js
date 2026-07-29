/**
 * origins-data.js — Origins RPG Framework (Origins character creation)
 *
 * Pure data module: the entire Origins content catalog from
 * docs/origins-spec-v2.md encoded as frozen data — setting identity, the 12
 * race reference blocks, culture vibes (with the AI-internal descriptions),
 * government/environment option lists, the shared Pursuer Block field lists,
 * the Silkborn Severance Block, and the eight origin schemas (blanks,
 * modifiers, incompatibility rules, levers, quest seeds).
 *
 * No logic beyond data (mirrors constants.js: "All static, hardcoded data.
 * No logic, no side effects."). No DOM, no SillyTavern context, no settings
 * reads — runs unchanged under `node --test`.
 *
 * Modifier options marked `nsfw: true` (and vibes marked the same) are only
 * offered when the campaign's master NSFW toggle is on — enforcement lives in
 * origins-engine.js, the flags live here.
 *
 * Imports: none (leaf module).
 * Imported by: origins-engine.js, origins-wizard.js.
 */

// ── Setting identity (spec §2) ────────────────────────────────────────────────

export const ORIGINS_SETTING = Object.freeze({
    name: 'Vaelmarch',
    blurb: 'A post-imperial high-fantasy continent. Three centuries ago the continent-spanning Argent Concord collapsed in a single generation; what remains is a land of successor states where new nations rise and fall constantly and no map is ever complete. Invented kingdoms are canon-safe by design.',
    tonePillars: Object.freeze([
        'Post-imperial fracture: power is local, contested, and personal. Every throne is arguably stolen; every border is an argument.',
        'The gods are near but not tame: divinity acts through champions, curses, oaths, and relics — never tidy, reliable miracles.',
        'The dead do not always stay put: liches, revenants, and vampire courts are established (if feared) parts of the world.',
        'Wonder is salvage: the Concord chained great artifacts and great entities; both are still being dug up.',
    ]),
    // `raceLocked` marks an anchor whose content is a race-exclusive mechanic.
    // Those are filtered out of the generation prompt unless the character
    // actually touches them — otherwise the model treats the most vivid fixture
    // in its context as a menu and attaches it to whoever is being generated.
    anchors: Object.freeze([
        Object.freeze({ id: 'argent_concord', name: 'The Argent Concord', description: 'The fallen empire. Source of ruins, relics, royal bloodline claims, and the legal fictions every successor state leans on.' }),
        Object.freeze({ id: 'sealed_lamp', name: 'The Order of the Sealed Lamp', description: 'A cross-border order of hunters, inquisitors, and archivists that tracks escaped relics, unlicensed necromancy, and broken oaths. Default institutional pursuer when none is specified.' }),
        Object.freeze({ id: 'six_houses', name: 'The Six Houses', description: 'The pantheon sketch: the Lantern (light, guidance), the Forge-Mother (craft, endurance), the Veiled Judge (death, oaths), the Tidecaller (sea, change), the Thorned Lady (wild, harvest), and the Hollow King (ruin, forbidden knowledge). Gods beyond the Six exist and may be invented per campaign.' }),
        Object.freeze({ id: 'chorus_weave', name: 'The Chorus-Weave', description: 'The Silkborn hivemind network; its great hive-cities ("looms") sit along the continent\'s southern silk-roads.', raceLocked: 'silkborn' }),
    ]),
});

// ── Races (spec §3) ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} RaceDef
 * @property {string}  id
 * @property {string}  name
 * @property {string}  emoji
 * @property {string}  summary        One-line player-facing pitch.
 * @property {boolean} living         False only for Vampire (drives the origin matrix).
 * @property {string}  habitat        Default nation environment.
 * @property {string}  lifespan
 * @property {string}  naming         Naming conventions (used for AI blank proposals).
 * @property {string}  cultureDefaults Typical vibe leanings — never auto-selected.
 * @property {string}  appearance     Appearance range guidance for the descriptor fields.
 * @property {string}  [mechanics]    Always-on race mechanics text (Vampire, Silkborn).
 * @property {string}  [environmentId] Default ENVIRONMENTS id for the Core Nation Block.
 */

/** @type {ReadonlyArray<RaceDef>} */
export const RACES = Object.freeze([
    {
        id: 'human', name: 'Human', emoji: '🧑', living: true,
        summary: 'The most numerous folk of the Concord\'s successor states — endlessly varied.',
        habitat: 'Any; heartland plains, river valleys, and coasts by default.', environmentId: 'heartlands',
        lifespan: '~80 years',
        naming: 'Widest variation; regional flavor follows the origin nation\'s culture vibes.',
        cultureDefaults: 'None — humans take on whatever vibes are selected.',
        appearance: 'Full spread of skin tones, builds, hair, and eyes.',
    },
    {
        id: 'dwarf', name: 'Dwarf', emoji: '⛏️', living: true,
        summary: 'Clan-bound folk of mountain halls; oath-keepers with long ledgers.',
        habitat: 'Mountain halls, deep hills, canyon cities.', environmentId: 'mountains',
        lifespan: '~350 years',
        naming: 'Clan-forward — personal name + clan name referencing stone, metal, or deeds.',
        cultureDefaults: 'Leans Strength-, Wealth-, or Collectivist-focused; grudge-ledgers and oath-keeping are cultural bedrock.',
        appearance: '1.2–1.5 m, broad and dense; earth-tone skin; elaborate hair/beard braiding carrying clan meaning.',
    },
    {
        id: 'elf', name: 'Elf', emoji: '🍃', living: true,
        summary: 'Long-lived folk of old forests and older cities; slow to forgive, slow to change.',
        habitat: 'Old-growth forests, river deltas, or ancient pre-Concord cities.', environmentId: 'forest',
        lifespan: '~750 years',
        naming: 'Flowing polysyllables; adult name chosen at first century.',
        cultureDefaults: 'Leans Magic-prowess-, Intellect-, or Spirituality-focused.',
        appearance: 'Tall and slender; skin from pale silver-toned through deep umber; pointed ears; eyes sometimes metallic.',
    },
    {
        id: 'gnome', name: 'Gnome', emoji: '🔧', living: true,
        summary: 'Small, vivid, institutionally curious — collectors of names and ideas.',
        habitat: 'Hill warrens, forest burrows, workshop quarters of larger cities.', environmentId: 'heartlands',
        lifespan: '~425 years',
        naming: 'Long strings of personal names collected over a lifetime; friends pick one.',
        cultureDefaults: 'Leans Intellect- or Technology-focused; low reverence for rank.',
        appearance: '0.9–1.2 m; vivid eyes; expressive faces; hair in every natural and a few unnatural colors.',
    },
    {
        id: 'halfling', name: 'Halfling', emoji: '🌾', living: true,
        summary: 'Comfort-loving river-shire folk, famously unbothered neighbors of louder nations.',
        habitat: 'River shires, terraced farm valleys, canal towns.', environmentId: 'river_valley',
        lifespan: '~150 years',
        naming: 'Homely given names + descriptive family names (Greenbottle, Fairbarrel).',
        cultureDefaults: 'Leans Collectivist; hospitality and comfort as civic virtues.',
        appearance: '~0.9 m; nimble; curly hair common; round, open features.',
    },
    {
        id: 'orc', name: 'Orc', emoji: '🪓', living: true,
        summary: 'Short-lived and fast-building — as often disciplined frontier republics as warbands.',
        habitat: 'Steppes, badlands, contested marches.', environmentId: 'steppe',
        lifespan: '~65 years',
        naming: 'Short, hard given names + earned epithets that change with deeds.',
        cultureDefaults: 'Leans Strength- or Conquest-focused; live fast, build faster.',
        appearance: 'Tall, heavy-framed; gray-green to slate skin; prominent lower tusks; scarification as biography.',
    },
    {
        id: 'goliath', name: 'Goliath', emoji: '🏔️', living: true,
        summary: 'Giant-descended highlanders; merit counted aloud, hospitality codes at altitude.',
        habitat: 'High mountains, glacier lines, giant-touched highlands.', environmentId: 'mountains',
        lifespan: '~80 years',
        naming: 'Birth name + honorific earned from a feat + lineage name.',
        cultureDefaults: 'Leans Strength-focused and Collectivist; descent-lore ties clans to giantkind.',
        appearance: '2.2–2.5 m; stone-mottled skin patterns unique as fingerprints; sparse hair.',
    },
    {
        id: 'dragonborn', name: 'Dragonborn', emoji: '🐲', living: true,
        summary: 'Draconic clan-folk; honor-debt accounting and breath that matches their scales.',
        habitat: 'Volcanic coasts, ancestral clanholds, mercenary city-states.', environmentId: 'volcanic',
        lifespan: '~80 years',
        naming: 'Clan name spoken first, personal name second; both resonant and consonant-heavy.',
        cultureDefaults: 'Leans Strength- or Spirituality-focused; ancestry colors heraldry more than politics.',
        appearance: '1.9–2.1 m; scale colors across the draconic spectrum; no hair; frills/horn ridges vary by lineage; breath-weapon element matches scale ancestry.',
    },
    {
        id: 'tiefling', name: 'Tiefling', emoji: '😈', living: true,
        summary: 'Infernal-touched diaspora — no homeland, thick skin, chosen names.',
        habitat: 'Diaspora quarters in other nations\' cities; occasionally a founded haven-state.', environmentId: 'heartlands',
        lifespan: '~90 years',
        naming: 'Inherited infernal-sounding lineage names, or chosen "virtue names" (Hope, Rigor, Quiet).',
        cultureDefaults: 'None inherited — tieflings take the culture around them; haven-states lean Collectivist.',
        appearance: 'Human builds; skin in human tones plus reds, violets, blues; horns of many shapes, tails, solid-color eyes.',
    },
    {
        id: 'aasimar', name: 'Aasimar', emoji: '✨', living: true,
        summary: 'Celestial-touched individuals born across all peoples; expectations follow them.',
        habitat: 'Born across all populations; some gather at Lantern temple-cities.', environmentId: 'heartlands',
        lifespan: '~160 years',
        naming: 'Local naming plus a "gift name" bestowed in dreams by their celestial guide.',
        cultureDefaults: 'None inherited; others project Spirituality-focused expectations onto them — a built-in social pressure.',
        appearance: 'Human range plus luminous eyes, metallic freckling or hair-sheen, a faint radiance when emotional.',
    },
    {
        id: 'vampire', name: 'Vampire', emoji: '🦇', living: false,
        summary: 'Unaging undead predator-aristocrats. Playable only via Vampire Lord or the Exiled Royal vampire variant.',
        habitat: 'Night courts inside living nations, or rarely, openly vampire-ruled successor states.', environmentId: 'night_court',
        lifespan: 'Unaging; destroyed, not died.',
        naming: 'The name they died with, often deliberately archaic — a vampire\'s name is a date stamp.',
        cultureDefaults: 'Leans Wealth-, Death- (reverence), or Pleasure-focused; obsessed with continuity, custodianship, and etiquette.',
        appearance: 'As their mortal race but pallid, cold, still — no breath or heartbeat unless performed; fangs; eyes that catch light at night.',
        mechanics: 'THE THIRST (always-on personal lever): a feeding clock — an unfed vampire visibly predatorizes over days; escalate hunger cues until they feed or lose a control check. Feeding choices (donors, bought blood, animals — weaker; the unwilling — stronger, corrosive to reputation) are standing moral decisions. DAYLIGHT: weakening, not instant destruction — sun burns slowly, suppresses vampiric strengths, forces cover-seeking. RECOGNITION: no heartbeat, no warmth, no reflection in silvered glass — a permanent low-grade exposure risk. TURNING: deliberate, slow, rare — a drained mortal fed vampire blood over three nights; every vampire was chosen by someone.',
    },
    {
        id: 'silkborn', name: 'Silkborn', emoji: '🕸️', living: true,
        summary: 'Silk-spinning, collectively-minded folk of the Chorus-Weave. Threads of a living cloth.',
        habitat: 'Terraced silk hive-cities ("looms") along the southern silk-roads; warm climates.', environmentId: 'jungle',
        lifespan: '~120 years for a body; experience persists in the Weave after death.',
        naming: 'Thread-names: hive name + role-tone syllable + personal syllable (e.g. Vessa-loom-Ith, shortened by outsiders to "Ith").',
        cultureDefaults: 'Collectivist by nature (hive consensus); craft- and trade-oriented.',
        appearance: 'Humanoid; smooth skin with a faint chitinous sheen in ivories, jades, duns, and charcoals; hair like fine silk floss; large eyes with layered pupils; slender spinneret channels along the forearms; some bear feathery antennae. Woven, not born — individually sexless or sexed by choice of weaving.',
        mechanics: 'THE CHORUS-WEAVE (hivemind): a continuous empathic-sensory link — an ambient congress, not an overmind. Attenuates with distance: total within a hive, a day-delayed murmur on the road. Far-traveling Silkborn ("reachthreads") are expected to develop provisional individuality, but are never truly private — the Weave eventually feels a summary of everything they felt. HIVE-SENSE: near other linked creatures, passively reads collective mood and coordination. SPEECH: collective framing ("we") is the untrained default; low native fluency in deception, privacy, and subtext — social bluntness, never a stat penalty.',
    },
]);

/** Origins a Vampire-race character may take (spec §3.11 / §4.7). */
export const VAMPIRE_ALLOWED_ORIGINS = Object.freeze(['vampire_lord', 'exiled_royal']);

// ── Silkborn Severance Block (spec §4.6) ─────────────────────────────────────

export const SILKBORN_SEVERANCE = Object.freeze({
    summary: 'Applies whenever a Silkborn character is cut from the Chorus-Weave — by exile, ritual, death and reanimation, artifact fusion, or choice. Non-severed reachthreads do not use this block.',
    rules: Object.freeze([
        'Speech/thought: collective framing ("we") is the default; shifting to singular self-reference is a conscious, gradual, visible effort NPCs may notice and react to (uncanny, pitiable, alien, or intriguing, per their own culture).',
        'Social bluntness: little native concept of deception, privacy, or subtext — played as manner, not stat penalty.',
        'The residual thread (Personal Lever): severance is not perfectly clean by default. A faint, unreliable filament remains — occasional fragmentary sensory input from nearby Weave-linked creatures (an uncommon warning sense) AND a liability: the hive may sense or trace the character through it.',
        'Reactions from linked Silkborn default to grief or hostility, never neutrality — a severed thread is a tragedy or a traitor to the Weave.',
    ]),
});

// ── Race-exclusive mechanic vocabulary ───────────────────────────────────────

/**
 * Distinctive terms that belong to exactly one race's always-on mechanics.
 * Used to reject a generated profile that hangs another race's signature
 * mechanic on a character — the failure mode where a Dragonborn came back with
 * a "Silkborn Severance Block" as its personal lever because the Chorus-Weave
 * was the most mechanically concrete thing in the model's context.
 *
 * Terms must be distinctive enough not to fire on ordinary prose, since a hit
 * costs a generation retry. Deliberately excluded: "loom" (weaving is common
 * fantasy imagery) and bare "the Weave" (standard D&D vocabulary for magic
 * itself — a mage's lever would trip it). "Chorus-Weave" is unambiguous.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const RACE_EXCLUSIVE_TERMS = Object.freeze({
    silkborn: Object.freeze([
        'chorus-weave', 'chorus weave', 'severance block', 'hive-filament',
        'hive filament', 'reachthread', 'hive-sense', 'hive-chorus',
        'hive chorus', 'hive-mind', 'hivemind', 'hive mind',
    ]),
    vampire: Object.freeze([
        'the thirst', 'feeding clock', 'vampiric strengths', 'turning ritual',
    ]),
});

// ── Culture vibes (spec §4.2) ────────────────────────────────────────────────

/**
 * @typedef {Object} VibeDef
 * @property {string} id
 * @property {string} label
 * @property {string} summary   Player-facing one-liner.
 * @property {string} internal  AI-internal 3–5 sentence description (never shown to the player).
 * @property {boolean} [nsfw]   Only offered when the master NSFW toggle is on.
 * @property {Array<{id: string, label: string, internal: string}>} [subOptions] Required sub-pick (Death-focused).
 */

/** @type {ReadonlyArray<VibeDef>} */
export const CULTURE_VIBES = Object.freeze([
    {
        id: 'spirituality', label: 'Spirituality/Religion-focused',
        summary: 'Faith structures daily life, law, and legitimacy.',
        internal: 'Daily life is structured around observance: bells, fasts, festival calendars, and clergy who function as courts and schools. Law and legitimacy flow from the sacred — rulers are anointed, contracts are sworn before altars, and heresy is a civic crime, not just a private one. Architecture reaches upward and inward: temples anchor every district and the grandest building is never the palace. Outsiders find the people generous, watchful, and quietly certain they are being judged.',
    },
    {
        id: 'strength', label: 'Strength-focused',
        summary: 'Status is earned through demonstrated prowess.',
        internal: 'Status is earned through demonstrated prowess — martial, athletic, or the endurance of hardship — and every institution keeps score. Disputes lawfully resolve through sanctioned contest, leadership demands ongoing proof, and weakness is not despised so much as pitied, which can be worse. The economy prizes soldiery, monster-culling, and physical craft; monuments are of victors and the honored fallen. Visitors are tested early — often informally, always deliberately.',
    },
    {
        id: 'wealth', label: 'Wealth-focused',
        summary: 'Value is the universal grammar; rank is denominated.',
        internal: 'Value is the universal grammar: rank is denominated, marriages are mergers, and the ledger is a sacred text in all but name. Law protects contract and property above almost everything, courts are fast and fee-based, and debt is a moral state. Cities gleam where money flows and rot two streets away; patronage of art and science is conspicuous and competitive. Outsiders are welcome exactly as long as they are solvent.',
    },
    {
        id: 'intellect', label: 'Intellect-focused',
        summary: 'Argument, scholarship, and expertise confer rank.',
        internal: 'Argument, scholarship, and demonstrable expertise confer rank; the university, archive, or examination hall is the true seat of power. Policy is debated in public and error carries social cost, making the culture rigorous, proud, and slow to admit mistakes. The economy runs on tutors, scribes, instruments, and the export of expertise. Aesthetics favor precision — geometry, annotation, and buildings that are arguments in stone.',
    },
    {
        id: 'magic', label: 'Magic-prowess-focused',
        summary: 'Arcane aptitude is the axis of status.',
        internal: 'Arcane ability is the axis of status: the gifted are cultivated, ranked, and bound by codes, while the ungifted build lives in the infrastructure around them. Law treats spells like weapons — licensed, dueling-codified, and taxed. Everyday life is casually enchanted (lights, wards, messengers) in ways visitors find miraculous and residents find mundane. The deepest social divide is not wealth but aptitude, and everyone knows precisely where they stand.',
    },
    {
        id: 'collectivist', label: 'Collectivist',
        summary: 'The group is the moral unit; exile is the gravest sentence.',
        internal: 'The group — family, guild, commune, hive — is the moral unit; personal glory is mildly embarrassing and personal failure is everyone\'s business. Decisions take longer and hold firmer; hospitality and mutual obligation are near-absolute. Law punishes harm to the commons hardest, and exile is the gravest sentence on the books. Outsiders are treated kindly and held at arm\'s length until they are OF something.',
    },
    {
        id: 'technology', label: 'Technology-focused',
        summary: 'Ingenuity outranks tradition; build first, ask second.',
        internal: 'Ingenuity outranks tradition: the workshop, foundry, and printing floor set the pace, and last decade\'s marvel is this decade\'s scrap. Guild-patent law is elaborate and fiercely litigated; apprenticeship is the universal ladder. Districts are loud, smoky, modular, and rebuilt constantly. The culture\'s blind spot is consequence — it reliably builds first and asks second.',
    },
    {
        id: 'death', label: 'Death-focused',
        summary: 'Death is central — as reverence for the dead, or as a mastered craft.',
        internal: 'Death is the organizing principle of the culture; the required sub-option determines which face it wears. Apply the chosen sub-option\'s description as the authoritative version.',
        subOptions: Object.freeze([
            {
                id: 'reverence', label: 'Reverence for the dead',
                internal: 'The ancestors are present citizens: consulted, fed, and housed in necropoli finer than the homes of the living. Funerary rites structure the calendar, morticians and mediums hold clerical rank, and desecration is the culture\'s deepest crime. The tone is not grim but continuous — death is a change of address.',
            },
            {
                id: 'bringing_death', label: 'Embrace of bringing death',
                internal: 'Killing is a mastered craft and a sacrament — duelists\' guilds, sanctioned hunts, assassin-orders with public temples. Elaborate codes govern who may be killed, by whom, and how, and violating the code is far worse than the killing itself. Outsiders find the people courteous, precise, and terrifying.',
            },
        ]),
    },
    {
        id: 'matriarchal', label: 'Matriarchal',
        summary: 'Women hold highest status; descent and titles pass through the mother\'s line.',
        internal: 'Women hold highest status: descent, property, and titles pass through the mother\'s line, and the defining institutions — councils, high clergy, officer corps — are female-led by law or unshakeable custom. Men\'s roles vary by nation (honored, restricted, or merely conventional) and make good texture, not caricature. Foreign arrangements are regarded as quaint or unstable.',
    },
    {
        id: 'patriarchal', label: 'Patriarchal',
        summary: 'Men hold highest status; patriline is law.',
        internal: 'Men hold highest status, patriline is law, and the institutions default male — the mirror of the matriarchal vibe, with the same generation guidance: texture and consequence, not caricature. Women\'s roles vary by nation and are worth generating deliberately. Foreign arrangements are regarded as quaint or unstable.',
    },
    {
        id: 'conquest', label: 'Conquest-focused',
        summary: 'Borders are provisional; treaties are intermissions.',
        internal: 'The nation understands itself as an expanding story: borders are provisional, treaties are intermissions, and prestige flows from what was taken and held. The army is the central institution and the surest ladder; veterans\' colonies stud the frontiers. Subjugated peoples are integrated, taxed, or suppressed — WHICH one is a defining choice worth generating deliberately. Neighbors arm accordingly.',
    },
    {
        id: 'pleasure', label: 'Pleasure/Promiscuity-focused', nsfw: true,
        summary: 'Sensual pleasure as a civic good; libertine, not lawless.',
        internal: 'Sensual pleasure is a civic good: courtesanship is a ranked profession, festivals are frequent and frank, and hospitality includes offers that startle foreigners. Consent codes are elaborate and strictly enforced — libertine, not lawless. The economy leans on luxury, artistry, and tourism; jealousy is considered a private failing, possessiveness a public one.',
    },
]);

/** Hard-blocked vibe pairs (spec §4.2 / §13). */
export const VIBE_HARD_BLOCKS = Object.freeze([
    Object.freeze(['matriarchal', 'patriarchal']),
]);

export const VIBE_PAIR_GUIDANCE = 'When two vibes are selected, generate their synthesis, not two parallel flavors — e.g. Collectivist + Conquest reads as a citizen-legion state where service is belonging; Wealth + Conquest as a nation that wages acquisitions and audits its wars; Spirituality + Intellect as a theology of proofs where seminaries are universities. Where a pair genuinely grinds (Technology + Spirituality), generate the friction itself as live internal politics.';

// ── Government & environment option lists (spec §4.3 / §4.4) ─────────────────

export const GOVERNMENT_TYPES = Object.freeze([
    { id: 'hereditary_monarchy', label: 'Hereditary monarchy' },
    { id: 'elective_monarchy', label: 'Elective monarchy' },
    { id: 'theocracy', label: 'Theocracy' },
    { id: 'magocracy', label: 'Magocracy' },
    { id: 'council_republic', label: 'Council republic / oligarchy' },
    { id: 'merchant_plutocracy', label: 'Merchant plutocracy' },
    { id: 'stratocracy', label: 'Military stratocracy' },
    { id: 'clan_confederation', label: 'Tribal / clan confederation' },
    { id: 'city_state_league', label: 'City-state league' },
    { id: 'necrocracy', label: 'Necrocracy (rule by/for the undead)' },
    { id: 'hive_consensus', label: 'Hive consensus (Silkborn looms)' },
    { id: 'other', label: 'Other (specify)' },
]);

export const ENVIRONMENTS = Object.freeze([
    { id: 'heartlands', label: 'Temperate heartlands' },
    { id: 'river_valley', label: 'River valley / delta' },
    { id: 'coast', label: 'Coast / archipelago' },
    { id: 'forest', label: 'Old-growth forest' },
    { id: 'mountains', label: 'Mountains / highlands' },
    { id: 'subterranean', label: 'Subterranean (halls, warrens, deep cities)' },
    { id: 'desert', label: 'Desert / badlands' },
    { id: 'steppe', label: 'Steppe / plains' },
    { id: 'tundra', label: 'Tundra / glacial' },
    { id: 'jungle', label: 'Jungle / tropics' },
    { id: 'swamp', label: 'Swamp / marsh' },
    { id: 'volcanic', label: 'Volcanic / ashlands' },
    { id: 'night_court', label: 'Night-shrouded (vampire court)' },
    { id: 'other', label: 'Other (specify)' },
]);

// ── Pursuer Block field lists (spec §4.5) ────────────────────────────────────

export const PURSUER_BLOCK = Object.freeze({
    affiliations: Object.freeze([
        { id: 'independent', label: 'Independent' },
        { id: 'hired', label: 'Hired by a specific faction' },
        { id: 'origin_body', label: 'Part of the origin nation/order/organization itself' },
        { id: 'mix', label: 'A mix' },
    ]),
    motives: Object.freeze([
        { id: 'capture', label: 'Capture' },
        { id: 'kill', label: 'Kill' },
        { id: 'reclaim', label: 'Reclaim something' },
        { id: 'silence', label: 'Silence' },
        { id: 'recruit_back', label: 'Recruit back' },
        { id: 'replace', label: 'Replace' },
    ]),
    resources: Object.freeze([
        { id: 'outmatched', label: 'Outmatched by the player' },
        { id: 'comparable', label: 'Comparable to the player' },
        { id: 'superior', label: 'Superior to the player' },
        { id: 'overwhelming_distant', label: 'Overwhelming but distant' },
    ]),
    awareness: Object.freeze([
        { id: 'knows_location', label: 'Knows the player\'s location' },
        { id: 'closing_in', label: 'Actively closing in' },
        { id: 'searching_cold', label: 'Searching cold' },
    ]),
});

// ── Appearance descriptor fields (spec §7.1 step 4) ──────────────────────────

export const APPEARANCE_FIELDS = Object.freeze([
    { id: 'skin', label: 'Skin / Body Color', hint: 'Skin tone, fur color, scale color, etc.' },
    { id: 'bodyType', label: 'Body Type', hint: 'Lean, stocky, athletic, soft, curvy, lanky, muscular, etc.' },
    { id: 'height', label: 'Height', hint: 'Specific or relative (tall, short, average, towering, petite).' },
    { id: 'hair', label: 'Hair', hint: 'Color, length, texture, style. Or bald, fur pattern, feathers, etc.' },
    { id: 'eyes', label: 'Eyes', hint: 'Color, shape, pupil type (round, slit, layered), unusual features.' },
    { id: 'face', label: 'Face Shape', hint: 'Round, angular, heart-shaped, long, soft-featured, sharp, etc.' },
    { id: 'marks', label: 'Distinguishing Marks', hint: 'Scars, tattoos, piercings, birthmarks, prosthetics, horns, tail, etc.' },
]);

/** NSFW-gated optional section (spec §9); every field skippable. */
export const INTIMATE_FIELDS = Object.freeze([
    { id: 'chest', label: 'Chest / Breasts', hint: 'Size, shape, details relevant to how the character looks or feels about them.' },
    { id: 'hips', label: 'Ass / Hips', hint: 'Size and shape relative to build.' },
    { id: 'parts', label: 'Intimate Parts', hint: 'Penis, vagina, both, neither, or other. State what exists.' },
    { id: 'size', label: 'Size Details', hint: 'If applicable: length/girth or other relevant proportions.' },
    { id: 'type', label: 'Type Details', hint: 'If applicable: circumcised/uncircumcised, human/animal-type/fantasy, other specifics.' },
    { id: 'other', label: 'Other Physical Notes', hint: 'Body hair, sensitivity, piercings, modifications, anything else the narrator should know.' },
]);

// ── Opening frames (spec §8) ─────────────────────────────────────────────────

export const OPENING_FRAMES = Object.freeze([
    { id: 'in_medias_res', label: 'In medias res', description: 'The origin\'s pressure is already live when the story opens.' },
    { id: 'quiet_start', label: 'Quiet start', description: 'A scene of ordinary life in the current location, levers present but ambient.' },
]);

// ── The eight origins (spec §5) ──────────────────────────────────────────────
//
// Field semantics (definitions in spec §0.1):
//   blanks    — free-text fields the AI proposes and the player edits.
//   modifiers — enumerated player picks. `optional: true` may stay unset.
//               `nsfw: true` renders only under the master NSFW toggle.
//   incompatibilities — `when` matches if EVERY {modifierId: optionId} pair is
//               selected. type 'hard' blocks the combination; type 'soft'
//               requires a non-empty explanation from the player/AI.
//   pursuer   — 'required' | 'default_on' | 'optional' | 'conditional'.

/**
 * @typedef {Object} OriginDef  (see field semantics comment above)
 */

/** @type {ReadonlyArray<OriginDef>} */
export const ORIGINS = Object.freeze([
    {
        id: 'exiled_royal', name: 'Exiled Royal', emoji: '👑',
        pitch: 'Heir to a Concord successor throne, cast out and hunted. Your face is on the heraldry; your name is a death warrant.',
        nationMeaning: 'The origin kingdom the character was exiled from.',
        pursuer: 'required',
        pursuerNote: 'The rival/usurper. Leverage is MANDATORY for non-Silkborn characters — it is this origin\'s guaranteed personal lever.',
        leverSocial: 'The mark of royalty — recognizable to those familiar with the kingdom, or with Concord-era heraldry generally.',
        // Race-conditional. Kept split so the Silkborn branch is never shown to
        // (or generated for) another race — see personalLeverFor().
        leverPersonal: 'The pursuer\'s Leverage (mandatory) — a hostage, blackmail, someone you still care about, or a secret that would ruin you.',
        leverPersonalByRace: Object.freeze({
            silkborn: 'The residual hive-thread left by severance from the Chorus-Weave — a faint filament the hive may sense or trace you through.',
        }),
        classLeaning: 'Any; Fighter, Paladin, Bard, or Sorcerer fit the archetype well.',
        blanks: Object.freeze([
            { id: 'title', label: 'Player title', hint: 'Prince, Princess, Duke, Regent — consistent with the government type.' },
            { id: 'succession', label: 'Succession logic', hint: 'Why this character specifically was heir (birth order, magical aptitude, council choice, last surviving line…).' },
            { id: 'rival_claim', label: 'Rival\'s claim to the throne', hint: 'Blood, conquest, council appointment, forged legitimacy.' },
            { id: 'mark', label: 'Mark of royalty', hint: 'A specific heirloom, tattoo, bloodline trait, or magical signature recognizable on sight or inspection.' },
            { id: 'family', label: 'Fate of family', hint: 'Dead, imprisoned, hunting you, quietly aiding you — or divided (per-member notes).' },
            { id: 'residence', label: 'Nation currently residing in', hint: 'Distinct from the origin kingdom; a name and one-line character is enough.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'kingdom_status', label: 'Current status of the kingdom',
                options: Object.freeze([
                    { id: 'standing_under_rival', label: 'Still standing under the rival' },
                    { id: 'civil_war', label: 'In civil war' },
                    { id: 'destroyed', label: 'Destroyed' },
                ]),
            },
            {
                id: 'believed_dead', label: 'Believed dead?',
                options: Object.freeze([
                    { id: 'no', label: 'No — the kingdom knows you live' },
                    { id: 'yes', label: 'Yes — the kingdom believes you died in the exile' },
                ]),
            },
            {
                id: 'exile_reason', label: 'Reason for exile',
                options: Object.freeze([
                    { id: 'betrayal_ally', label: 'Betrayal by a trusted ally' },
                    { id: 'forbidden_pact', label: 'Forbidden pact (demon, unholy entity, forbidden magic)' },
                    { id: 'failed_overthrow', label: 'Failed overthrow attempt' },
                    { id: 'framed', label: 'Framed by a rival' },
                    { id: 'scandal', label: 'Scandal (affair with a commoner, any gender)' },
                    { id: 'corruption', label: 'Corruption/contamination by an evil force' },
                    { id: 'betrayed_rulers', label: 'Direct betrayal of the ruling body' },
                ]),
            },
            {
                id: 'slavery', label: 'Slavery in the origin nation', optional: true,
                options: Object.freeze([
                    { id: 'yes', label: 'Yes — the nation is built on slavery' },
                    { id: 'no', label: 'No' },
                ]),
                note: 'If unset, the AI may still introduce it later as a discovered nation trait without contradicting player choice.',
            },
            {
                id: 'vampire_farms', label: 'Vampire Nation: blood farms', optional: true, nsfw: true,
                requiresRace: 'vampire',
                options: Object.freeze([
                    { id: 'enabled', label: 'Enabled (explicit opt-in)' },
                ]),
                note: 'Vampire variant only. Off by default; requires race = Vampire and majority population = Vampire.',
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'destroyed_vs_ruling', type: 'hard',
                when: Object.freeze({ kingdom_status: 'destroyed' }),
                conflictsWithPursuer: Object.freeze({ affiliation: 'origin_body' }),
                message: 'A destroyed kingdom has no sitting usurper ruling it — use "civil war" or "still standing", or make the pursuer an independent remnant.',
            },
            {
                id: 'closing_in_vs_believed_dead', type: 'soft',
                when: Object.freeze({ believed_dead: 'yes' }),
                conflictsWithPursuer: Object.freeze({ awareness: 'closing_in' }),
                message: 'The kingdom believes you dead, yet the pursuer is closing in — allowed, but state the explanation explicitly (e.g. "the court believes you dead; the spymaster never did").',
            },
        ]),
        questSeeds: Object.freeze([
            'Reclaiming the throne — allies, legitimacy, and the cost of a crown.',
            'Avenging what was taken — the rival, the betrayer, or the force behind both.',
            'Permanently renouncing the throne — and discovering what that renunciation costs.',
            'The mark of royalty recognized at the worst possible moment.',
            'A family member resurfaces — as ally, hostage, or enemy.',
        ]),
        worldThreatHint: 'The origin kingdom\'s fate entangles with a larger regional collapse or the rival\'s wider ambitions.',
    },
    {
        id: 'vampire_lord', name: 'Vampire Lord', emoji: '🦇',
        pitch: 'You ruled, you slept for centuries, and the world went on without you. What your legacy became is waiting.',
        nationMeaning: 'The origin kingdom the character ruled before slumber — and what it has become.',
        pursuer: 'conditional',
        pursuerNote: 'Only if "hiding from a rival/hunting group" is the slumber reason.',
        leverSocial: 'Legacy reputation layered with the current-era treatment of vampires as a category. A cult worshipping an inaccurate version of you is a premium hook.',
        leverPersonal: 'Weakened power recovering over play, and/or fragmented memory requiring relearning — at least one must be active, or the sharpened Thirst substitutes.',
        classLeaning: 'Sorcerer, Warlock, or Fighter — ancient power, whatever its shape.',
        requiredRace: 'vampire',
        blanks: Object.freeze([
            { id: 'cult', label: 'Cult name and psychology', hint: 'Only if awakened-by-cult is chosen.' },
            { id: 'memory', label: 'Memory integrity (prose)', hint: 'What survives cleanly, what is fog, what is gone.' },
            { id: 'maker', label: 'Who turned you', hint: 'And whether your maker still exists. May be "unknown".' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'power_state', label: 'Current physical/power state',
                options: Object.freeze([
                    { id: 'weakened', label: 'Weakened — recovering strength over play' },
                    { id: 'intact', label: 'Largely intact' },
                ]),
            },
            {
                id: 'memory_state', label: 'Memory state',
                options: Object.freeze([
                    { id: 'fragmented', label: 'Fragmented — the world must be relearned' },
                    { id: 'intact', label: 'Largely intact' },
                ]),
            },
            {
                id: 'slumber_reason', label: 'Reason for slumber',
                options: Object.freeze([
                    { id: 'boredom', label: 'Boredom — weary of an unchanging life' },
                    { id: 'prophecy', label: 'Prophecy' },
                    { id: 'catastrophe', label: 'Avoiding a catastrophe' },
                    { id: 'hiding', label: 'Hiding from a rival or hunting group' },
                ]),
            },
            {
                id: 'kingdom_at_slumber', label: 'Kingdom\'s state at time of slumber',
                options: Object.freeze([
                    { id: 'peace', label: 'Peace' },
                    { id: 'mid_war', label: 'Mid-war' },
                    { id: 'mid_overthrow', label: 'Mid-overthrow' },
                ]),
            },
            {
                id: 'legacy', label: 'Legacy left behind',
                options: Object.freeze([
                    { id: 'tyranny', label: 'Tyranny' },
                    { id: 'bloodshed', label: 'Bloodshed' },
                    { id: 'abstainment', label: 'Abstainment (refused to drink from sentient creatures)' },
                    { id: 'knowledge', label: 'Knowledge-seeking' },
                    { id: 'wealth', label: 'Wealth-hoarding' },
                    { id: 'indulgence', label: 'Indulgence/pleasure' },
                    { id: 'culture', label: 'Art/culture preservation' },
                    { id: 'myth', label: 'Reduced to unreliable myth' },
                ]),
            },
            {
                id: 'vampire_treatment', label: 'Current-era treatment of vampires generally',
                options: Object.freeze([
                    { id: 'hunted', label: 'Widely feared and hunted' },
                    { id: 'mythical', label: 'Unknown / mythical' },
                    { id: 'tolerated', label: 'Cautiously tolerated' },
                    { id: 'integrated', label: 'Integrated / accepted' },
                ]),
            },
            {
                id: 'awakened_by', label: 'What awakened you',
                options: Object.freeze([
                    { id: 'adventurers', label: 'Adventurers, by accident' },
                    { id: 'cult', label: 'A cult that worships you' },
                    { id: 'desperate', label: 'Someone desperate to stop a threat (possibly born of your own legacy)' },
                ]),
            },
            {
                id: 'farms', label: 'Breeding farms in the current-day kingdom', optional: true, nsfw: true,
                options: Object.freeze([
                    { id: 'enabled', label: 'Enabled (explicit opt-in)' },
                ]),
                note: 'Most natural with legacy = tyranny/bloodshed or an empire grown oppressive during the slumber. Selecting it sets a stored population flag: the nation retains a substantial mortal minority.',
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'abstainment_vs_farms', type: 'soft',
                when: Object.freeze({ legacy: 'abstainment', farms: 'enabled' }),
                message: 'Farms built AFTER your departure by successors who abandoned your legacy — an intentional narrative twist. Surface it explicitly ("the empire built this in defiance of everything you stood for"); never silently resolve it.',
            },
            {
                id: 'no_lever', type: 'hard', leverGuard: true,
                when: Object.freeze({ power_state: 'intact', memory_state: 'intact' }),
                message: 'Intact power AND intact memory leaves no personal lever. Accept the substitute: the Thirst, sharpened — a lord\'s appetite grown imperious with age.',
                substituteLever: 'sharpened_thirst',
            },
        ]),
        questSeeds: Object.freeze([
            'Reclaiming standing in a world that mythologized, demonized, or forgot you.',
            'Confronting what the legacy became — the empire, the cult, the successors.',
            'Correcting, exploiting, or being trapped by the cult\'s inaccurate myth of you.',
            'Choosing to build something different this time.',
            'The maker question — who chose you, and are they still out there.',
        ]),
        worldThreatHint: 'A threat born from the character\'s own legacy — an empire grown monstrous, a cult acting in their name — is the strongest default.',
    },
    {
        id: 'freed_undead', name: 'Freed Undead Minion', emoji: '💀',
        pitch: 'The lich\'s grip broke and your memories flooded back. You are dead, free, and owed a life you never finished.',
        nationMeaning: 'The nation/community of the character\'s living life, populated via the before-death race.',
        pursuer: 'required',
        pursuerNote: 'The rival former-minion — with one added field: do they know you are free yet, or is that a pending reveal?',
        leverSocial: 'Visible undead traits — fear, hostility, or violence on sight from most societies; passing as living is an active concern.',
        leverPersonal: 'Worsening decay clock and/or lich-knowledge corruption and/or the rival\'s standing threat — at least one active.',
        classLeaning: 'Shaped by the role served: soldier → Fighter, guard → Fighter/Barbarian, errand-servant → Rogue.',
        blanks: Object.freeze([
            { id: 'lich', label: 'The lich', hint: 'Name of the lich who controlled you, and why they were feared.' },
            { id: 'location', label: 'Current location', hint: 'Where you find yourself after breaking free.' },
            { id: 'role', label: 'Role served under the lich', hint: 'Soldier, guard, errand-servant — shapes retained skills and muscle memory.' },
            { id: 'decay_description', label: 'Decay description', hint: 'The prose picture of your undead state (the static/worsening clock is the modifier below).' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'archetype', label: 'Who you were before death',
                options: Object.freeze([
                    { id: 'fallen_soldier', label: 'Fallen soldier — died in a battle that decided your homeland\'s fate; you don\'t yet know whether the sacrifice mattered' },
                    { id: 'dying_commoner', label: 'Dying commoner — died of disease while laboring to lift your family from poverty; you don\'t know what became of them' },
                    { id: 'assassinated_royal', label: 'Assassinated royal — killed by conspirators; you seek reckoning with the killers or their descendants' },
                    { id: 'fallen_tyrant', label: 'Fallen tyrant — even your own physician refused to save you; closure is atonement or its refusal, never vindication' },
                ]),
            },
            {
                id: 'memory_reliability', label: 'Memory reliability',
                options: Object.freeze([
                    { id: 'accurate', label: 'Accurate (default)' },
                    { id: 'seeded', label: 'One or more memories subtly inaccurate — must pay off with a concrete future beat' },
                ]),
            },
            {
                id: 'decay', label: 'Decay state',
                options: Object.freeze([
                    { id: 'static', label: 'Static — does not worsen' },
                    { id: 'worsening', label: 'Worsening — a soft clock before passing-as-living becomes impossible' },
                ]),
            },
            {
                id: 'lich_knowledge', label: 'Retained lich-knowledge',
                options: Object.freeze([
                    { id: 'none', label: 'None' },
                    { id: 'fragments', label: 'Fragments of the lich\'s memories or magic — useful, with a mandatory soft corruption risk' },
                ]),
            },
            {
                id: 'rival_knows', label: 'Does the rival know you are free?',
                options: Object.freeze([
                    { id: 'knows', label: 'Yes — they know' },
                    { id: 'pending', label: 'Not yet — a pending reveal' },
                ]),
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'tyrant_vindication', type: 'hard',
                when: Object.freeze({ archetype: 'fallen_tyrant' }),
                narrativeRule: true,
                message: 'Fallen tyrant closure arcs must build on atonement, confrontation by the wronged, or villainous refusal — never "prove it wasn\'t in vain".',
            },
            {
                id: 'static_urgency', type: 'hard',
                when: Object.freeze({ decay: 'static' }),
                narrativeRule: true,
                message: 'Static decay: urgency-to-pass-as-living quest hooks require the worsening clock; do not surface them.',
            },
        ]),
        questSeeds: Object.freeze([
            'Closure per archetype: confirm the sacrifice mattered / find what became of the family / confront the killers or their line / face the people you wronged.',
            'The rival former-minion — outpace, expose, or destroy them before they become the next lich.',
            'Passing as living: a relationship or position that depends on the mask holding.',
            'The lich\'s fragments — use them, purge them, or be changed by them.',
        ]),
        worldThreatHint: 'The rival former-minion attempting to become the next lich is the default throughline; the world threat need not resolve when personal closure does.',
    },
    {
        id: 'oathbreaker', name: 'The Oathbreaker Knight', emoji: '⛓️',
        pitch: 'You swore, you broke it, and the curse keeps the receipt. Whether breaking it made you better or worse is the story.',
        nationMeaning: 'The realm of the order/faith/liege the oath was sworn to — the character\'s homeland only if those coincide.',
        pursuer: 'required',
        pursuerNote: 'The order, faith, or liege\'s agents.',
        leverSocial: 'The visible curse mark — recognizable to those familiar with the order/faith, unsettling to everyone else.',
        leverPersonal: 'The curse itself, especially compulsion or personality-split variants.',
        classLeaning: 'Paladin (fallen), Fighter, or Warlock.',
        blanks: Object.freeze([
            { id: 'sworn_to', label: 'Sworn to', hint: 'Name of the god, order, or dead liege the oath was sworn to.' },
            { id: 'how_broken', label: 'How the oath was broken', hint: 'The specific act.' },
            { id: 'why_broken', label: 'Why the oath was broken', hint: 'The narrative reason behind the act — distinct from HOW.' },
            { id: 'curse_nature', label: 'Nature of the curse', hint: 'Prose specifics of the selected curse type.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'oath_represented', label: 'What the oath represented',
                options: Object.freeze([
                    { id: 'tyranny', label: 'Tyranny' },
                    { id: 'love', label: 'Love' },
                    { id: 'bloodshed', label: 'Bloodshed (→ pacifism is the strong "broke it by becoming better" arc)' },
                    { id: 'justice', label: 'Justice' },
                    { id: 'peace', label: 'Peace' },
                ]),
            },
            {
                id: 'party_status', label: 'Status of the sworn-to party',
                options: Object.freeze([
                    { id: 'standing', label: 'Still standing' },
                    { id: 'usurped', label: 'Under a usurper' },
                    { id: 'destroyed', label: 'Destroyed' },
                    { id: 'civil_war', label: 'In civil war' },
                ]),
            },
            {
                id: 'believed_dead', label: 'Believed dead?',
                options: Object.freeze([
                    { id: 'no', label: 'No — the order knows you live' },
                    { id: 'yes', label: 'Yes — the order believes you died' },
                ]),
            },
            {
                id: 'curse_type', label: 'Curse type',
                options: Object.freeze([
                    { id: 'monster_transformation', label: 'Slow transformation into a monster' },
                    { id: 'armor_lock', label: 'Inability to remove your armor' },
                    { id: 'animal_transformation', label: 'Periodic involuntary animal transformation' },
                    { id: 'self_harm', label: 'Compulsion to self-harm' },
                    { id: 'split_personality', label: 'A split personality that can seize control and act without your later knowledge' },
                ]),
            },
            {
                id: 'curse_visibility', label: 'Curse visibility',
                options: Object.freeze([
                    { id: 'visible', label: 'Visible (default) — mark, chains, changing features, or overt symptom' },
                    { id: 'hidden', label: 'Hidden (optional modifier)' },
                ]),
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'split_hidden', type: 'hard',
                when: Object.freeze({ curse_type: 'split_personality', curse_visibility: 'hidden' }),
                message: 'A hidden curse pairs with subtler curses (armor-lock, slow transformation) — the alternate personality causes visible public incidents.',
            },
            {
                id: 'animal_hidden', type: 'hard',
                when: Object.freeze({ curse_type: 'animal_transformation', curse_visibility: 'hidden' }),
                message: 'A hidden curse pairs with subtler curses (armor-lock, slow transformation) — involuntary transformation is inherently public.',
            },
            {
                id: 'destroyed_pursuer', type: 'soft',
                when: Object.freeze({ party_status: 'destroyed' }),
                message: 'Pursuit from a destroyed order must be explicitly framed as a splinter/remnant group, not the intact original body.',
            },
            {
                id: 'closing_in_vs_believed_dead', type: 'soft',
                when: Object.freeze({ believed_dead: 'yes' }),
                conflictsWithPursuer: Object.freeze({ awareness: 'closing_in' }),
                message: 'The order believes you dead, yet pursuit is closing in — allowed, but state the explanation explicitly.',
            },
            {
                id: 'hidden_needs_recognition', type: 'soft',
                when: Object.freeze({ curse_visibility: 'hidden' }),
                message: 'A hidden curse weakens the social lever — the sworn-to order (or loyalist remnants who know the signs) must remain an active recognition threat.',
            },
        ]),
        questSeeds: Object.freeze([
            'Lift the curse — and learn what lifting it costs.',
            'Embrace what the curse is turning you into.',
            'Find a version of the oath you can live with.',
            'The order\'s loyalists — reconciliation, evasion, or reckoning.',
            'What the broken oath was protecting against, now unprotected.',
        ]),
        worldThreatHint: 'The order\'s remaining loyalists, or the consequences of whatever the broken oath was protecting against.',
    },
    {
        id: 'willing_cultist', name: 'The Willing Cultist', emoji: '🕯️',
        pitch: 'You believed. You left — or say you did. The entity\'s pull never left you.',
        nationMeaning: 'The nation the character currently resides in; a second, smaller nation block for their home nation if an outsider.',
        pursuer: 'required',
        pursuerNote: 'Government, bounty hunters, remaining cult members, an opposed religious order, or a mix.',
        leverSocial: 'The cult\'s symbol/mark — recognized by those familiar with the cult, rival orders, or government watch-lists per legal status.',
        leverPersonal: 'Magical dependency (non-disableable) — leaving does not remove the pull: cravings, visions, weakening without contact.',
        classLeaning: 'Warlock, Cleric (dark), or Sorcerer.',
        blanks: Object.freeze([
            { id: 'cult_name', label: 'Cult name', hint: '' },
            { id: 'symbol', label: 'Cult symbol/mark', hint: 'The specific recognition trigger.' },
            { id: 'home_nation', label: 'Nation of origin', hint: 'Outsiders only — a name and one-line character; a smaller secondary nation block.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'origin_status', label: 'Origin status',
                options: Object.freeze([
                    { id: 'native', label: 'Native to the current nation' },
                    { id: 'outsider', label: 'Outsider (populate the secondary home-nation block)' },
                ]),
            },
            {
                id: 'role', label: 'Role in the cult',
                options: Object.freeze([
                    { id: 'leader', label: 'Leader' },
                    { id: 'follower', label: 'Follower' },
                ]),
            },
            {
                id: 'worshipped', label: 'What the cult worshipped',
                options: Object.freeze([
                    { id: 'death', label: 'An entity/force of death' },
                    { id: 'knowledge', label: 'Knowledge' },
                    { id: 'bloodshed', label: 'Indiscriminate bloodshed' },
                    { id: 'sacrifice', label: 'Sacrifice' },
                    { id: 'magic', label: 'Magic prowess' },
                    { id: 'souls', label: 'Soul-consumption' },
                ]),
            },
            {
                id: 'why_left', label: 'Why you left',
                options: Object.freeze([
                    { id: 'disillusionment', label: 'Disillusionment' },
                    { id: 'prophecy', label: 'A prophecy/vision from the entity itself' },
                ]),
            },
            {
                id: 'secret_worship', label: 'Still secretly worshipping?', optional: true,
                options: Object.freeze([
                    { id: 'burden', label: 'Yes — with an active burden/task (consuming magic, sacrifice, killing, forbidden knowledge-gathering)' },
                ]),
            },
            {
                id: 'legal_status', label: 'Legal status of the cult (general tendency)',
                options: Object.freeze([
                    { id: 'mostly_illegal', label: 'Mostly illegal' },
                    { id: 'mixed', label: 'Mixed (legal in some nations, illegal in others)' },
                    { id: 'mostly_legal', label: 'Mostly legal' },
                ]),
                note: 'A baseline tendency the AI applies when generating a new nation\'s stance — individual nations may deviate when the story is served.',
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'leader_recruit_back', type: 'soft',
                when: Object.freeze({ role: 'leader' }),
                conflictsWithPursuer: Object.freeze({ motive: 'recruit_back' }),
                message: 'A "recruit back" motive for a former LEADER only works if the cult explicitly wants their leadership back — otherwise leaders suit power-struggle motives; state which.',
            },
            {
                id: 'legal_vs_government', type: 'soft',
                when: Object.freeze({ legal_status: 'mostly_legal' }),
                message: 'A mostly-legal cult with a government pursuer: reframe the government\'s motive as targeting the character SPECIFICALLY (a particular law or oath broken), not general illegality.',
            },
        ]),
        questSeeds: Object.freeze([
            'Resisting or succumbing to the dependency.',
            'Settling accounts with former cult-siblings.',
            'Reckoning with what you did as a believer.',
            'The entity speaks again — and it wants something specific.',
            'The secret burden (if still worshipping) coming due in public.',
        ]),
        worldThreatHint: 'The entity\'s larger goal proceeding with or without the character.',
    },
    {
        id: 'artifact_nobody', name: 'The Artifact-Bound Nobody', emoji: '🏮',
        pitch: 'You were nobody. Then you picked it up, and it spoke. Now everyone who can feel it knows exactly where you are.',
        nationMeaning: 'The character\'s home nation, where they found the artifact.',
        pursuer: 'default_on',
        pursuerNote: 'The artifact\'s original faction wants it back — default-on. Opt out only via "no known claimants" (ancient/masterless), which requires the artifact\'s own agenda as substitute pressure.',
        leverSocial: 'Detectability — those who can sense the artifact (its original faction, attuned mages, other bonded individuals) recognize and react to you independent of your own reputation.',
        leverPersonal: 'The cost of use, weighed at every invocation, compounded by the artifact\'s own agenda.',
        classLeaning: 'Any — the artifact supplies the power; Fighter or Rogue for the person underneath.',
        blanks: Object.freeze([
            { id: 'artifact_name', label: 'Artifact\'s name', hint: 'And the name it gives ITSELF (may differ).' },
            { id: 'artifact_description', label: 'Physical description of the artifact', hint: '' },
            { id: 'found_how', label: 'How you found it', hint: '' },
            { id: 'artifact_agenda', label: 'The artifact\'s agenda', hint: 'What the entity inside wants and pushes for. MANDATORY if "no known claimants" is selected.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'occupation', label: 'Prior occupation',
                options: Object.freeze([
                    { id: 'blacksmith', label: 'Blacksmith' },
                    { id: 'farmer', label: 'Farmer' },
                    { id: 'thief', label: 'Thief' },
                    { id: 'tradesman', label: 'Tradesman' },
                    { id: 'clothes_maker', label: 'Clothes-maker' },
                    { id: 'other', label: 'Other (specify)' },
                ]),
            },
            {
                id: 'form', label: 'Artifact form',
                options: Object.freeze([
                    { id: 'blade', label: 'Bladed weapon' },
                    { id: 'blunt', label: 'Blunt weapon' },
                    { id: 'armor', label: 'Armor' },
                    { id: 'wearable', label: 'Wearable item (necklace/jewelry)' },
                    { id: 'held', label: 'Held object (e.g., a lantern)' },
                    { id: 'fused', label: 'Fuses into the body' },
                ]),
            },
            {
                id: 'entity', label: 'Resident entity',
                options: Object.freeze([
                    { id: 'god', label: 'A god' },
                    { id: 'demon', label: 'A demon' },
                    { id: 'person', label: 'A person' },
                    { id: 'other', label: 'Other entity' },
                ]),
            },
            {
                id: 'personality', label: 'Artifact personality',
                options: Object.freeze([
                    { id: 'imperious', label: 'Self-important / expects deference' },
                    { id: 'bloodthirsty', label: 'Bloodthirsty / impatient without combat' },
                    { id: 'mentor', label: 'Wise mentor' },
                    { id: 'sassy', label: 'Sassy / critical of improper use' },
                    { id: 'mix', label: 'A mix' },
                ]),
            },
            {
                id: 'power', label: 'Known power',
                options: Object.freeze([
                    { id: 'magic_knowledge', label: 'Grants magical knowledge' },
                    { id: 'magic_power', label: 'Grants raw magical power' },
                    { id: 'combat_mastery', label: 'Physical strength / instant combat mastery' },
                    { id: 'necromancy', label: 'Raises dead / summons extradimensional entities (specify controllability)' },
                    { id: 'transformation', label: 'Transformation (self or others)' },
                ]),
            },
            {
                id: 'cost', label: 'Cost of use',
                options: Object.freeze([
                    { id: 'memories', label: 'Consumes memories' },
                    { id: 'blood', label: 'Consumes blood (own or others\')' },
                    { id: 'magic_fuel', label: 'Requires magic as fuel' },
                    { id: 'soul', label: 'Consumes soul-energy (own or others\')' },
                    { id: 'food', label: 'Consumes large quantities of food' },
                ]),
            },
            {
                id: 'claimants', label: 'Claimants',
                options: Object.freeze([
                    { id: 'active_faction', label: 'Original faction is defined and still active (default — pursuer instantiated)' },
                    { id: 'none', label: 'No known claimants (ancient/masterless artifact)' },
                ]),
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'memories_casual', type: 'hard',
                when: Object.freeze({ cost: 'memories' }),
                narrativeRule: true,
                message: 'The memory cost escalates and is narratively consequential each invocation — never a flat toll, never framed as harmless casual use.',
            },
            {
                id: 'none_needs_agenda', type: 'hard', leverGuard: true,
                when: Object.freeze({ claimants: 'none' }),
                message: 'With no known claimants, the artifact\'s agenda (blank) must be concrete and active — the entity wants something and pushes for it.',
                requiresBlank: 'artifact_agenda',
            },
        ]),
        questSeeds: Object.freeze([
            'Trust, control, rebellion, or deeper merging with the entity inside.',
            'The original faction closes in — surrender it, fight, or run.',
            'The cost comes due somewhere it cannot be paid quietly.',
            'What the entity actually wants, revealed in stages.',
            'Another bonded individual finds you.',
        ]),
        worldThreatHint: 'The original faction\'s plans for the artifact, or what the entity inside wants long-term.',
    },
    {
        id: 'abandoned_champion', name: 'The Abandoned Champion', emoji: '🏆',
        pitch: 'You fulfilled the destiny. The god left anyway. The power is fading, and everyone still knows your name.',
        nationMeaning: 'The nation that celebrated the champion — where the destiny was fulfilled and the reputation is loudest.',
        pursuer: 'optional',
        pursuerNote: 'The replacement champion, if enabled — motive reframed as rivalry/succession unless the player wants open antagonism.',
        leverSocial: 'Public reputation as THE champion — reverence, resentment, or both, recognizable by name and deed without any physical mark.',
        leverPersonal: 'The fading power clock — deciding who you are without what was granted.',
        classLeaning: 'Paladin, Cleric, or Fighter — the shape the blessing took.',
        blanks: Object.freeze([
            { id: 'deity', label: 'The god/deity who chose you', hint: '' },
            { id: 'destiny', label: 'What the destiny was', hint: 'In specifics: slew a great monster/demon/evil god, ended a long conflict…' },
            { id: 'abandonment', label: 'The moment of abandonment', hint: 'When and how you REALIZED the god was gone — this origin\'s defining scene.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'why_abandoned', label: 'Why abandoned',
                options: Object.freeze([
                    { id: 'discarded', label: 'Discarded by the god after use' },
                    { id: 'god_gone', label: 'The god died or vanished' },
                ]),
            },
            {
                id: 'allies', label: 'Allies',
                options: Object.freeze([
                    { id: 'has_allies', label: 'Still has them' },
                    { id: 'abandoned_too', label: 'Abandoned by companions as well' },
                ]),
            },
            {
                id: 'hunted_by_wronged', label: 'Hunted by people wronged in the course of the destiny?',
                options: Object.freeze([
                    { id: 'yes', label: 'Yes' },
                    { id: 'no', label: 'No' },
                ]),
            },
            {
                id: 'resented', label: 'Resented by those you helped too late?',
                options: Object.freeze([
                    { id: 'yes', label: 'Yes' },
                    { id: 'no', label: 'No' },
                ]),
            },
            {
                id: 'fading_power', label: 'Fading power',
                options: Object.freeze([
                    { id: 'fading', label: 'Fading (default) — the blessing is finite and diminishing over play' },
                    { id: 'stable', label: 'Stable — requires a substitute lever' },
                ]),
            },
            {
                id: 'replacement', label: 'Replacement champion', optional: true,
                options: Object.freeze([
                    { id: 'same_faith', label: 'Chosen by the same faith' },
                    { id: 'rival_faith', label: 'Chosen by a rival faith' },
                ]),
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'god_gone_orders', type: 'hard',
                when: Object.freeze({ why_abandoned: 'god_gone' }),
                conflictsWithPursuer: Object.freeze({ affiliation: 'origin_body' }),
                narrativeRule: true,
                message: 'A gone god gives no orders — any replacement champion or pursuit must be independently motivated (the faith\'s institution, not the deity itself).',
            },
            {
                id: 'stable_needs_substitute', type: 'hard', leverGuard: true,
                when: Object.freeze({ fading_power: 'stable', hunted_by_wronged: 'no' }),
                requiresModifier: Object.freeze({ id: 'replacement', anyOf: ['same_faith', 'rival_faith'] }),
                message: 'Stable power removes the default personal lever — enable the replacement champion (succession pressure) or "hunted by the wronged".',
            },
        ]),
        questSeeds: Object.freeze([
            'Identity after purpose — who are you without the blessing.',
            'Reconciling with those who revere you, and those who resent you.',
            'The replacement champion — rivalry, mentorship, or war.',
            'What the destiny suppressed, resurging.',
            'The god\'s absence explained — silence, death, or something worse.',
        ]),
        worldThreatHint: 'Whatever the original destiny suppressed may be resurging, or the replacement champion\'s actions create new consequences.',
    },
    {
        id: 'defector_spy', name: 'The Defector Spy', emoji: '🗝️',
        pitch: 'You were the knife in the dark until a job broke you. The organization still holds what you love.',
        nationMeaning: 'The nation the organization served or operated from — the theater of the character\'s former work.',
        pursuer: 'required',
        pursuerNote: 'The organization. Leverage is MANDATORY: blackmail, a hostage, or someone still cared about inside.',
        leverSocial: 'The trained-observer tell — visible only to other agents, handlers, and the similarly trained; invisible to ordinary people.',
        leverPersonal: 'The organization\'s leverage — an active comply-or-risk-it decision pressure.',
        classLeaning: 'Rogue, Ranger, or Bard (the social infiltrator).',
        blanks: Object.freeze([
            { id: 'organization', label: 'The organization', hint: 'Its name.' },
            { id: 'cover_name', label: 'False/cover name', hint: 'The name you operated under.' },
            { id: 'tell', label: 'The trained-observer tell', hint: 'A posture habit, reflex, or signature technique legible to people trained in the same tradition — your recognition mark.' },
        ]),
        modifiers: Object.freeze([
            {
                id: 'specialty', label: 'Specialty',
                options: Object.freeze([
                    { id: 'espionage', label: 'Espionage' },
                    { id: 'assassination', label: 'Assassination' },
                    { id: 'mixed', label: 'A mix of both' },
                ]),
            },
            {
                id: 'affiliation', label: 'Affiliation',
                options: Object.freeze([
                    { id: 'government', label: 'Worked for a government' },
                    { id: 'independent', label: 'An outside/independent organization' },
                ]),
            },
            {
                id: 'defection_reason', label: 'Reason for defecting or doubting',
                options: Object.freeze([
                    { id: 'killed_loved', label: 'Forced to kill people you cared about' },
                    { id: 'saw_person', label: 'Came to see a target as a person and declined to kill (failed the mission)' },
                    { id: 'target_good', label: 'A target so evidently good it broke the job\'s logic' },
                    { id: 'harmful_ends', label: 'Discovered the organization served harmful ends rather than any legitimate cause' },
                ]),
            },
            {
                id: 'leverage_type', label: 'What the organization holds over you',
                options: Object.freeze([
                    { id: 'blackmail', label: 'Blackmail material' },
                    { id: 'hostage', label: 'A hostage' },
                    { id: 'insider', label: 'Someone you still care about, inside the organization' },
                ]),
            },
        ]),
        incompatibilities: Object.freeze([
            {
                id: 'harmful_government', type: 'soft',
                when: Object.freeze({ defection_reason: 'harmful_ends', affiliation: 'government' }),
                message: 'State whether the WHOLE government is corrupt or a rogue faction within it — the two carry very different worldbuilding weight.',
            },
            {
                id: 'insider_vs_no_ties', type: 'hard',
                when: Object.freeze({ leverage_type: 'insider' }),
                narrativeRule: true,
                message: '"Someone you love inside the organization" is incompatible with a fully-abandoned, no-remaining-ties framing — the profile must preserve that tie.',
            },
        ]),
        questSeeds: Object.freeze([
            'Severing or resolving the leverage.',
            'Confronting former handlers — or former targets.',
            'Deciding what loyalty, if any, survives defection.',
            'Another agent reads your tell in a crowded room.',
            'The operation you have inside knowledge of, moving without you.',
        ]),
        worldThreatHint: 'The organization\'s larger operation — which the character has inside knowledge of — continuing regardless.',
    },
]);

/** Fast lookup tables. */
export const ORIGINS_BY_ID = Object.freeze(Object.fromEntries(ORIGINS.map(o => [o.id, o])));
export const RACES_BY_ID = Object.freeze(Object.fromEntries(RACES.map(r => [r.id, r])));
export const VIBES_BY_ID = Object.freeze(Object.fromEntries(CULTURE_VIBES.map(v => [v.id, v])));
