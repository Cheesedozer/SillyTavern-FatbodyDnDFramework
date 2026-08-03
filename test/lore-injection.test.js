/**
 * Guards on the wire format of the lore blocks the chat interceptor prepends to
 * the user message.
 *
 * These are source-text assertions rather than behavioural ones: the headers are
 * built inside the interceptor closure in narrative-hooks.js, which needs a live
 * SillyTavern prompt object to exercise. The properties being locked here are
 * exactly the ones that regressed, and they are cheap to check statically.
 *
 * Background: a user reported lorebook entries appearing verbatim inside the
 * narrator's reply. The injection is string-prepended onto the *user* message,
 * so the model sees it as though the player typed it, and nothing told it not to
 * reproduce the text — the only (DO NOT REPEAT) guard in the codebase was scoped
 * to the State Memo.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = readFileSync(join(ROOT, 'narrative-hooks.js'), 'utf8');

const LORE_ASSIGNMENTS = ['keywordLore =', 'persistentLore =', 'agentLore ='];

test('every lore block header carries the do-not-reproduce guard', () => {
    assert.match(hooks, /const LORE_NO_ECHO = .*DO NOT reproduce/);
    for (const name of LORE_ASSIGNMENTS) {
        const line = hooks.split('\n').find(l => l.includes(name) && l.includes('## '));
        assert.ok(line, `no header assignment found for ${name}`);
        assert.match(line, /\$\{LORE_NO_ECHO\}/, `${name} is missing the no-echo marker`);
        assert.match(line, /\$\{LORE_SUBORDINATION\}/, `${name} lost its precedence marker`);
    }
});

test('lore headers ship no HTML to the model', () => {
    // The <font color="#d4a028"> wrappers existed for HUD colouring but were sent
    // to the model verbatim, reading as content to render. The agent block never
    // had them; all three are now consistent.
    for (const name of LORE_ASSIGNMENTS) {
        const line = hooks.split('\n').find(l => l.includes(name) && l.includes('## '));
        assert.ok(!/<font/i.test(line), `${name} still wraps its header in a <font> tag`);
    }
});

test('the narrator sysprompt forbids reproducing injected reference blocks', () => {
    for (const file of ['sysprompt.txt', 'sysprompt_modern.txt', 'sysprompt_legacy.txt']) {
        const text = readFileSync(join(ROOT, file), 'utf8');
        assert.match(text, /NEVER reproduce injected reference material/, `${file} is missing the rule`);
        // It has to live in <constraints>, next to the RNG-queue secrecy rule —
        // that block is delivered in additive/Suite mode, a plain narrative note
        // would not be.
        const constraints = text.match(/<constraints>[\s\S]*?<\/constraints>/)?.[0] || '';
        assert.match(constraints, /NEVER reproduce injected reference material/, `${file}: rule is outside <constraints>`);
    }
});

test('the embedded RT_PROMPTS fallbacks carry the same rule', async () => {
    const { RT_PROMPTS } = await import('../constants.js');
    for (const [name, text] of Object.entries(RT_PROMPTS)) {
        assert.match(text, /NEVER reproduce injected reference material/, `RT_PROMPTS['${name}'] is out of sync with its .txt file`);
    }
});

test('managed mode delivers lore exactly once', () => {
    // The promptManager path appends ALL of activeRouterKeys to the system
    // message; the chat interceptor injects the overlapping keyword/persistent/
    // agent sets into the user message. Running both shipped every entry twice.
    const index = readFileSync(join(ROOT, 'index.js'), 'utf8');
    const guard = /getActivationMode\(s\) === 'managed'/g;
    const hits = index.match(guard) || [];
    assert.ok(hits.length >= 2, 'both the promptManager and setExtensionPrompt paths must skip managed mode');
});
