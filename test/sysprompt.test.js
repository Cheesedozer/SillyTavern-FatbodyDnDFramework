/**
 * Characterization tests for buildSysprompt (extracted into sysprompt.js).
 * Locks the XML-block stripping + {{modulesText}} injection behaviour.
 */
import './_bootstrap.js';
import { setSettings, setChatId, rawStore, extensionPrompts, resetExtensionPrompts } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSysprompt, ADDITIVE_TAGS, ADDITIVE_HEADER, ADDITIVE_PROMPT_KEY, applySysprompt, getAdditiveSyspromptCache } from '../sysprompt.js';
import { RT_PROMPTS } from '../constants.js';

const SYSPROMPT_TXT = readFileSync(fileURLToPath(new URL('../sysprompt.txt', import.meta.url)), 'utf8');
const SYSPROMPT_LEGACY_TXT = readFileSync(fileURLToPath(new URL('../sysprompt_legacy.txt', import.meta.url)), 'utf8');
const SYSPROMPT_MODERN_TXT = readFileSync(fileURLToPath(new URL('../sysprompt_modern.txt', import.meta.url)), 'utf8');

/** Persona-adjacent tags deliberately excluded from the additive (rules-only) variant. */
const ADDITIVE_EXCLUDED = ['role', 'narrative', 'party_join_leave'];

test('buildSysprompt returns empty string for empty input', () => {
    setSettings({});
    assert.equal(buildSysprompt(''), '');
});

test('buildSysprompt strips XML blocks for disabled syspromptModules and injects modulesText', () => {
    setSettings({ syspromptModules: { foo: false } });
    const out = buildSysprompt('<foo>SECRET</foo>\n<bar>KEEP</bar>\n{{modulesText}}');
    assert.ok(!out.includes('SECRET'), 'disabled <foo> block removed');
    assert.ok(out.includes('KEEP'), 'unlisted <bar> block kept');
    assert.ok(!out.includes('{{modulesText}}'), '{{modulesText}} placeholder replaced');
    assert.ok(out.includes('CORE MODULES'), 'module instruction text injected');
});

// ── Additive (rules-only) variant ──────────────────────────────────────────────

test('standalone variant of the real sysprompt keeps the persona sections', () => {
    setSettings({});
    const out = buildSysprompt(SYSPROMPT_TXT);
    assert.ok(out.includes('<role>'), 'standalone keeps <role>');
    assert.ok(out.includes('<narrative>'), 'standalone keeps <narrative>');
    assert.ok(out.includes('<rng_system>'), 'standalone keeps <rng_system>');
    assert.ok(!out.includes(ADDITIVE_HEADER), 'standalone has no additive header');
});

test('default variant is standalone (explicit opts and no opts are identical)', () => {
    setSettings({});
    assert.equal(buildSysprompt(SYSPROMPT_TXT), buildSysprompt(SYSPROMPT_TXT, { variant: 'standalone' }));
});

test('additive variant drops persona sections, keeps mechanics, prepends header', () => {
    setSettings({});
    const out = buildSysprompt(SYSPROMPT_TXT, { variant: 'additive' });
    assert.ok(out.startsWith(ADDITIVE_HEADER), 'additive header prepended');
    for (const tag of ADDITIVE_EXCLUDED) {
        assert.ok(!out.includes(`<${tag}>`), `additive drops <${tag}>`);
    }
    for (const tag of ['rng_system', 'combat', 'xp_system', 'level_up_protocol', 'end_of_output_footer', 'constraints']) {
        assert.ok(out.includes(`<${tag}>`), `additive keeps <${tag}>`);
    }
});

test('additive variant still honors syspromptModules toggles', () => {
    setSettings({ syspromptModules: { loot: false } });
    const out = buildSysprompt(SYSPROMPT_TXT, { variant: 'additive' });
    assert.ok(!out.includes('<loot>'), 'disabled <loot> stripped in additive too');
    assert.ok(out.includes('<combat>'), '<combat> still present');
});

test('modern sysprompt: contains the v3.0 sections and foundation placeholders', () => {
    for (const tag of ['power_system', 'skills', 'lethality', 'level_up_protocol', 'rng_system']) {
        assert.ok(SYSPROMPT_MODERN_TXT.includes(`<${tag}>`), `<${tag}> present`);
    }
    for (const ph of ['foundation_setting', 'foundation_power_system', 'foundation_dice', 'foundation_currency', 'foundation_award_guidance', 'foundation_downed_window', 'foundation_naming']) {
        assert.ok(SYSPROMPT_MODERN_TXT.includes(`{{${ph}}}`), `{{${ph}}} placeholder present`);
    }
    assert.ok(SYSPROMPT_MODERN_TXT.includes('[FALLBACK]'), 'no-tool-call fallback present');
    assert.ok(SYSPROMPT_MODERN_TXT.includes('SYSTEM DIRECTIVE: LEVEL UP'), 'directive-driven level-up protocol');
    assert.ok(SYSPROMPT_MODERN_TXT.includes('DOWNED'), 'standard lethality template specced');
});

// ── Additive-rules cache + delivery gating (backs the [[ORIGINS]] preset marker) ──

test('additive cache stays empty when the framework is disabled', async () => {
    setSettings({ enabled: false, suiteMode: true, syspromptDelivery: 'additive' });
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '');
});

test('additive cache stays empty under Custom Sysprompt Mode', async () => {
    setSettings({ customSysprompt: true, suiteMode: true, syspromptDelivery: 'additive' });
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '');
});

test('additive cache populates for standalone delivery when the preset marker is enabled', async () => {
    // Neither autoApplySysprompt() nor applyAdditiveSysprompt() computes this content
    // for standalone delivery, so without the presetMarkerEnabled term in the gate the
    // marker would resolve to an empty string on every turn.
    setSettings({ suiteMode: true, syspromptDelivery: 'standalone', presetMarkerEnabled: true });
    await applySysprompt();
    const cached = getAdditiveSyspromptCache();
    assert.ok(cached.startsWith(ADDITIVE_HEADER), 'additive header prepended');
    assert.ok(cached.includes('<rng_system>'), 'mechanics tag present');
    assert.ok(!cached.includes('<role>'), 'persona tag excluded');
});

test('additive cache stays empty for standalone delivery when the preset marker is off', async () => {
    setSettings({ suiteMode: true, syspromptDelivery: 'standalone', presetMarkerEnabled: false });
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '', 'plain Suite Mode must not compute this content');
});

test('applyAdditiveSysprompt suppresses its own extension prompt when the preset marker is on', async () => {
    resetExtensionPrompts();
    setSettings({ syspromptDelivery: 'additive', presetMarkerEnabled: true });
    await applySysprompt();
    assert.equal(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'suppressed — the marker delivers the same content');
    assert.notEqual(getAdditiveSyspromptCache(), '', 'the cache itself must stay populated for the marker to read');
});

test('applyAdditiveSysprompt publishes normally when the preset marker is off', async () => {
    resetExtensionPrompts();
    setSettings({ syspromptDelivery: 'additive', presetMarkerEnabled: false });
    await applySysprompt();
    assert.notEqual(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'nothing to suppress for');
});

test('Suite Mode alone no longer suppresses additive delivery', async () => {
    // The old [[FATBODY]] handshake keyed suppression off Megumin's own settings; that
    // block no longer exists upstream, so suppression is now driven solely by our own
    // presetMarkerEnabled setting and Suite Mode must not affect it.
    resetExtensionPrompts();
    setSettings({ suiteMode: true, syspromptDelivery: 'additive', presetMarkerEnabled: false });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    assert.notEqual(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'Suite Mode is not a suppression signal');
});

// ── Legendary NPC tier + quest-difficulty enemy scaling guidance ───────────────

test('all three sysprompt files define the Legendary tier', () => {
    assert.match(SYSPROMPT_TXT, /Legendary—World-threat \| HP 150–500\+ \| AC 19–22 \| ATK \+11 to \+15/);
    assert.match(SYSPROMPT_LEGACY_TXT, /Legendary—World-threat \| HP 150–500\+ \| AC 19–22 \| ATK \+11 to \+15/);
    assert.match(SYSPROMPT_MODERN_TXT, /Legendary—world-threatening/);
});

test('classic-mode files extend the saving-throw table with a Legendary row', () => {
    for (const txt of [SYSPROMPT_TXT, SYSPROMPT_LEGACY_TXT]) {
        assert.match(txt, /Legendary — \+8 to \+12; overwhelming across the board, no weak saves/);
    }
});

test('drift guard: constants.js RT_PROMPTS fallbacks stay byte-identical to the .txt files', () => {
    assert.equal(RT_PROMPTS['sysprompt.txt'], SYSPROMPT_TXT, 'sysprompt.txt fallback must mirror the live file exactly');
    assert.equal(RT_PROMPTS['sysprompt_legacy.txt'], SYSPROMPT_LEGACY_TXT, 'sysprompt_legacy.txt fallback must mirror the live file exactly');
});

// ── <origin_levers> (v4.0 Origins narrator rules) ──────────────────────────────

test('both classic-mode files carry the self-gating <origin_levers> section; modern does not', () => {
    for (const [name, txt] of [['sysprompt.txt', SYSPROMPT_TXT], ['sysprompt_legacy.txt', SYSPROMPT_LEGACY_TXT]]) {
        assert.ok(txt.includes('<origin_levers>'), `${name} has the section`);
        assert.ok(txt.includes('applies ONLY if an [ORIGIN] block exists'), `${name} section self-gates on the memo block`);
    }
    assert.ok(!SYSPROMPT_MODERN_TXT.includes('<origin_levers>'), 'Origins is D&D-mode only — modern file untouched');
});

test('origin_levers is additive-eligible (mechanics, not persona) and strippable via its toggle', () => {
    setSettings({});
    assert.ok(ADDITIVE_TAGS.includes('origin_levers'));
    const additive = buildSysprompt(SYSPROMPT_TXT, { variant: 'additive' });
    assert.ok(additive.includes('SOCIAL LEVER'), 'additive variant keeps the lever rules');
    setSettings({ syspromptModules: { origin_levers: false } });
    const stripped = buildSysprompt(SYSPROMPT_TXT);
    assert.ok(!stripped.includes('SOCIAL LEVER'), 'toggle off strips the section');
    assert.ok(!stripped.includes('<origin_levers>'));
});

test('buildSysprompt keeps the full quest-difficulty scaling guidance when the toggle is on', () => {
    setSettings({ syspromptModules: { questsDifficulty: true } });
    const out = buildSysprompt(SYSPROMPT_TXT);
    assert.match(out, /SCALING TO QUEST DIFFICULTY/);
    assert.match(out, /GENERAL \/ NON-QUEST ENCOUNTERS/);
});

test('buildSysprompt collapses the scaling guidance to a short fallback line when the toggle is off', () => {
    setSettings({ syspromptModules: { questsDifficulty: false } });
    const out = buildSysprompt(SYSPROMPT_TXT);
    assert.ok(!out.includes('SCALING TO QUEST DIFFICULTY'), 'detailed guidance removed');
    assert.ok(!out.includes('GENERAL / NON-QUEST ENCOUNTERS'), 'detailed guidance removed');
    assert.ok(out.includes("Scale enemy strength to fit {{user}}'s current level and the narrative stakes of the scene."), 'evergreen fallback sentence present');
    assert.match(out, /Legendary—World-threat/, 'tier list itself is unaffected by the toggle');
});

test('the questsDifficulty gate applies the same way in Modern-mode sysprompt', () => {
    setSettings({ syspromptModules: { questsDifficulty: false } });
    const out = buildSysprompt(SYSPROMPT_MODERN_TXT);
    assert.ok(!out.includes('SCALING TO QUEST DIFFICULTY'));
    assert.ok(out.includes("Scale enemy strength to fit {{user}}'s current level and the narrative stakes of the scene."));
});

test('drift guard: every top-level tag in all sysprompt files is classified', () => {
    for (const txt of [SYSPROMPT_TXT, SYSPROMPT_LEGACY_TXT, SYSPROMPT_MODERN_TXT]) {
        const tags = [...txt.matchAll(/^<(\w[\w_-]*)>$/gm)].map(m => m[1]);
        assert.ok(tags.length >= 10, 'sysprompt file parsed (found top-level tags)');
        for (const tag of tags) {
            assert.ok(
                ADDITIVE_TAGS.includes(tag) || ADDITIVE_EXCLUDED.includes(tag),
                `tag <${tag}> must be listed in ADDITIVE_TAGS or ADDITIVE_EXCLUDED — classify new sysprompt sections explicitly`,
            );
        }
    }
});

// ── Campaign content rating (post-commit NSFW) ────────────────────────────────

/** Seeds a committed origin on an open chat so campaignRatingLine() can see it. */
function withOrigin(nsfw, committed = { name: 'Serane Vell' }) {
    setChatId('chat-rating');
    setSettings({ chatStates: { 'chat-rating': { origin: { committed, nsfw } } } });
}

test('an opted-in mature campaign gets a standing content-rating instruction', () => {
    withOrigin(true);
    const out = buildSysprompt('<combat>KEEP</combat>');
    assert.ok(out.includes('<content_rating>'), 'the NSFW toggle finally means something after commit');
    assert.ok(out.includes('mature content enabled'));
});

test('the rating rides the additive variant too — it is a rule, not persona', () => {
    withOrigin(true);
    const out = buildSysprompt('<combat>KEEP</combat>', { variant: 'additive' });
    assert.ok(out.includes('<content_rating>'));
    assert.ok(out.startsWith(ADDITIVE_HEADER), 'the additive header still leads');
});

test('SFW origins, uncommitted drafts and non-Origins chats add nothing', () => {
    withOrigin(false);
    assert.ok(!buildSysprompt('<combat>KEEP</combat>').includes('content_rating'), 'SFW campaign unchanged');

    // NSFW flagged but never committed — the wizard was abandoned mid-flow.
    setChatId('chat-rating');
    setSettings({ chatStates: { 'chat-rating': { origin: { nsfw: true } } } });
    assert.ok(!buildSysprompt('<combat>KEEP</combat>').includes('content_rating'), 'no committed profile, no rating');

    setChatId('');
    setSettings({});
    assert.ok(!buildSysprompt('<combat>KEEP</combat>').includes('content_rating'), 'non-Origins campaigns unchanged');
});

// ── CYOA slot injection ───────────────────────────────────────────────────────
// The slot list is a live setting (2–4 options) but the sysprompt files are
// static, so the <cyoa> block carries a {{cyoaSlots}} placeholder. A placeholder
// that survives into the request is a literal `{{cyoaSlots}}` in the narrator's
// rules — worse than shipping the wrong count.

test('buildSysprompt substitutes {{cyoaSlots}} with the active slot rules', () => {
    setSettings({ syspromptModules: { cyoa: true }, cyoaChoiceCount: 3 });
    const out = buildSysprompt(SYSPROMPT_TXT);
    assert.ok(!out.includes('{{cyoaSlots}}'), 'the placeholder must never reach the model');
    assert.ok(out.includes('exactly 3 lines'), 'the live choice count is injected');
    assert.ok(out.includes('`advance`') && out.includes('`cost`'));
    assert.ok(!out.includes('`character`'), 'the 4th slot is absent at count 3');
});

test('buildSysprompt widens the CYOA slot list with the setting', () => {
    setSettings({ syspromptModules: { cyoa: true }, cyoaChoiceCount: 4 });
    assert.ok(buildSysprompt(SYSPROMPT_TXT).includes('`character`'));
});

// cyoa defaults to false (opt-in), so this is also the shape most installs see.
test('the CYOA placeholder is gone along with the block when the module is off', () => {
    setSettings({ syspromptModules: { cyoa: true } });
    assert.ok(buildSysprompt(SYSPROMPT_TXT).includes('<choices>'), 'on: the example ships');

    setSettings({ syspromptModules: { cyoa: false } });
    const out = buildSysprompt(SYSPROMPT_TXT);
    assert.ok(!out.includes('{{cyoaSlots}}'));
    assert.ok(!out.includes('<choices>'), 'off: no orphaned output-format example');
});

// Every delivery path has to carry it: the [[ORIGINS]] / Suite-Mode audience
// only ever sees the additive variant, and a narrator told to write a block the
// framework can't render is the desync this design exists to avoid.
test('the CYOA block and its slot rules survive additive delivery', () => {
    setSettings({ syspromptModules: { cyoa: true }, cyoaChoiceCount: 3 });
    for (const txt of [SYSPROMPT_TXT, SYSPROMPT_LEGACY_TXT, SYSPROMPT_MODERN_TXT, RT_PROMPTS['sysprompt.txt']]) {
        const out = buildSysprompt(txt, { variant: 'additive' });
        assert.ok(out.includes('<cyoa>'), 'cyoa must be in ADDITIVE_TAGS');
        assert.ok(!out.includes('{{cyoaSlots}}'));
        assert.ok(out.includes('exactly 3 lines'));
    }
});

// The block collides with <end_of_output_footer> unless the order is spelled
// out — that ambiguity is what cost the HUD its status line under the old tool.
test('every sysprompt source orders the choices block after the status footer', () => {
    for (const txt of [SYSPROMPT_TXT, SYSPROMPT_LEGACY_TXT, SYSPROMPT_MODERN_TXT, RT_PROMPTS['sysprompt.txt'], RT_PROMPTS['sysprompt_legacy.txt']]) {
        const block = txt.match(/<cyoa>[\s\S]*?<\/cyoa>/)[0];
        assert.match(block, /AFTER the status footer/);
        assert.match(block, /\{\{cyoaSlots\}\}/, 'each copy needs the placeholder or its slot rules go missing');
    }
});
