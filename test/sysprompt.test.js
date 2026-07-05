/**
 * Characterization tests for buildSysprompt (extracted into sysprompt.js).
 * Locks the XML-block stripping + {{modulesText}} injection behaviour.
 */
import './_bootstrap.js';
import { setSettings, rawStore, extensionPrompts, resetExtensionPrompts } from './_bootstrap.js';
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

// ── Megumin Suite live-pull cache (backs globalThis._rpgGetAdditiveSysprompt) ──

test('additive cache stays empty when Fatbody is disabled', async () => {
    setSettings({ enabled: false, suiteMode: true, syspromptDelivery: 'additive' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '');
});

test('additive cache stays empty under Custom Sysprompt Mode', async () => {
    setSettings({ customSysprompt: true, suiteMode: true, syspromptDelivery: 'additive' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '');
});

test('additive cache populates for standalone delivery when Megumin\'s fatbody block is active (Suite Mode + standalone combo)', async () => {
    // Neither autoApplySysprompt() nor the old applyAdditiveSysprompt() gate ever
    // computed this content for this combination — it's the key new behavior that
    // lets Megumin's [[FATBODY]] block pull something live in the first place.
    setSettings({ suiteMode: true, syspromptDelivery: 'standalone' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    const cached = getAdditiveSyspromptCache();
    assert.ok(cached.startsWith(ADDITIVE_HEADER), 'additive header prepended');
    assert.ok(cached.includes('<rng_system>'), 'mechanics tag present');
    assert.ok(!cached.includes('<role>'), 'persona tag excluded');
});

test('additive cache stays empty for standalone delivery when Megumin\'s fatbody block is not active', async () => {
    setSettings({ suiteMode: true, syspromptDelivery: 'standalone' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: [] } } };
    await applySysprompt();
    assert.equal(getAdditiveSyspromptCache(), '', 'plain Suite Mode with no fatbody block must not compute this content');
});

test('applyAdditiveSysprompt suppresses its own extension prompt when Suite Mode is on and Megumin\'s block is active', async () => {
    resetExtensionPrompts();
    setSettings({ suiteMode: true, syspromptDelivery: 'additive' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    assert.equal(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'suppressed — Megumin is already injecting the same content live');
    assert.notEqual(getAdditiveSyspromptCache(), '', 'the cache itself must stay populated for Megumin to keep pulling');
});

test('applyAdditiveSysprompt does NOT suppress when Suite Mode is off, even if Megumin\'s block is active', async () => {
    // This remains a real double-injection risk by design — suppression requires Suite
    // Mode as an explicit precondition (see sysprompt.js), so this combo is instead
    // flagged by warnSuiteAdditiveOverlap() in index.js rather than silently handled.
    resetExtensionPrompts();
    setSettings({ suiteMode: false, syspromptDelivery: 'additive' });
    rawStore()['Megumin-Suite'] = { profiles: { default: { blocks: ['fatbody'] } } };
    await applySysprompt();
    assert.notEqual(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'not suppressed without suiteMode as an explicit precondition');
});

test('applyAdditiveSysprompt publishes normally when Megumin is not installed at all', async () => {
    resetExtensionPrompts();
    setSettings({ suiteMode: true, syspromptDelivery: 'additive' });
    await applySysprompt();
    assert.notEqual(extensionPrompts()[ADDITIVE_PROMPT_KEY], '', 'no Megumin-Suite key present — nothing to suppress for');
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
