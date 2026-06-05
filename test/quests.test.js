/**
 * Characterization tests for quest mood math and plain-text rendering.
 * computeFrustration is the canonical source in memo-processor.js (re-used by
 * quests.js). Golden values mirror the expectations hardcoded in the quest
 * debug tools (quests.js installQuestDebugTools).
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFrustration } from '../memo-processor.js';
import { renderQuestsAsPlainText } from '../quests.js';

// NOTE: parseInWorldTime('Day 1') === 0, and computeFrustration guards with
// `if (!accepted || !current) return 0`, so accepted_time must parse to a
// non-zero minute. Using Day 2 (=1440) as the anchor:
//   accepted Day 2 (=1440), deadline Day 12 (=15840) -> window 14400.
const baseQuest = (coeff) => ({
    status: 'active',
    accepted_time: 'Day 2',
    deadline_time: 'Day 12',
    frustration_coefficient: coeff,
});

test('computeFrustration: coeff 1.0 halfway to deadline => -0.500', () => {
    assert.equal(Number(computeFrustration(baseQuest(1.0), 'Day 7').toFixed(3)), -0.5);
});

test('computeFrustration: at deadline => 0.000', () => {
    assert.equal(Number(computeFrustration(baseQuest(1.0), 'Day 12').toFixed(3)), 0);
});

test('computeFrustration: 50% over deadline, coeff 1.0 => 0.500', () => {
    assert.equal(Number(computeFrustration(baseQuest(1.0), 'Day 17').toFixed(3)), 0.5);
});

test('computeFrustration: coeff 0.4 halfway => -0.823', () => {
    assert.equal(Number(computeFrustration(baseQuest(0.4), 'Day 7').toFixed(3)), -0.823);
});

test('computeFrustration: coeff 3.0 halfway => -0.206', () => {
    assert.equal(Number(computeFrustration(baseQuest(3.0), 'Day 7').toFixed(3)), -0.206);
});

test('computeFrustration: coeff 3.0 50% over => 1.500', () => {
    assert.equal(Number(computeFrustration(baseQuest(3.0), 'Day 17').toFixed(3)), 1.5);
});

test('computeFrustration: just accepted => -1', () => {
    assert.equal(computeFrustration(baseQuest(1.0), 'Day 2'), -1);
});

test('computeFrustration: non-active quest => 0', () => {
    assert.equal(computeFrustration({ ...baseQuest(1.0), status: 'completed' }, 'Day 7'), 0);
});

test('computeFrustration: no deadline => 0 (neutral)', () => {
    assert.equal(computeFrustration({ status: 'active', accepted_time: 'Day 2' }, 'Day 7'), 0);
});

test('renderQuestsAsPlainText: deterministic block for an active quest with no deadline', () => {
    setSettings({ syspromptModules: { questsDeadlines: false, questsFrustration: false } });
    const quests = [{
        title: 'Kill Wolves',
        giver_name: 'Bob',
        giver_location: 'Town',
        status: 'active',
        objectives: [{ text: 'Slay wolves', required: true, status: 'active', progress: 2, total: 6 }],
        rewards: ['100 gold'],
    }];
    const out = renderQuestsAsPlainText(quests, '');
    assert.equal(
        out,
        '### ACTIVE QUESTS\n- **Kill Wolves** (Given by Bob at Town)\n  - [ ] Slay wolves [2/6]\n  Rewards: 100 gold\n\n'
    );
});

test('renderQuestsAsPlainText: empty when no active quests', () => {
    setSettings({ syspromptModules: {} });
    assert.equal(renderQuestsAsPlainText([{ title: 'Done', status: 'completed', objectives: [] }], ''), '');
});
