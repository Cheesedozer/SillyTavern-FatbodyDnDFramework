/**
 * Characterization tests for buildSysprompt (extracted into sysprompt.js).
 * Locks the XML-block stripping + {{modulesText}} injection behaviour.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSysprompt } from '../sysprompt.js';

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
