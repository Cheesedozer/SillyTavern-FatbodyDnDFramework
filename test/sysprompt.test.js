/**
 * Characterization tests for buildSysprompt (extracted into sysprompt.js).
 * Locks the XML-block stripping + {{modulesText}} injection behaviour.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSysprompt, ADDITIVE_TAGS, ADDITIVE_HEADER } from '../sysprompt.js';

const SYSPROMPT_TXT = readFileSync(fileURLToPath(new URL('../sysprompt.txt', import.meta.url)), 'utf8');
const SYSPROMPT_LEGACY_TXT = readFileSync(fileURLToPath(new URL('../sysprompt_legacy.txt', import.meta.url)), 'utf8');

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

test('drift guard: every top-level tag in both sysprompt files is classified', () => {
    for (const txt of [SYSPROMPT_TXT, SYSPROMPT_LEGACY_TXT]) {
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
