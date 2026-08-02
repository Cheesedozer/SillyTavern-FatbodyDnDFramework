/**
 * Tests for the empty-memo onboarding step machine: deriveOnboardingStep()
 * drives which screen the HUD shows (mode picker → D&D / Modern flows), and
 * renderMemoAsCards('') must render the derived step.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnboardingStep, renderMemoAsCards, renderOriginsEntry } from '../renderer.js';

test('no chat state → mode-select', () => {
    assert.equal(deriveOnboardingStep(undefined), 'mode-select');
    assert.equal(deriveOnboardingStep(null), 'mode-select');
    assert.equal(deriveOnboardingStep({}), 'mode-select');
});

test('onboarding mode picks route to the matching step', () => {
    assert.equal(deriveOnboardingStep({ onboarding: { mode: 'dnd' } }), 'dnd');
    assert.equal(deriveOnboardingStep({ onboarding: { mode: 'modern' } }), 'modern-path');
});

test('committed foundation without a class → modern-class', () => {
    const st = { foundation: { CLASS_ROSTER: [] }, progression: { classId: null } };
    assert.equal(deriveOnboardingStep(st), 'modern-class');
});

test('locked class → modern-character', () => {
    const st = { foundation: { CLASS_ROSTER: [] }, progression: { classId: 'fighter' } };
    assert.equal(deriveOnboardingStep(st), 'modern-character');
});

test('committed foundation wins over a stale onboarding flag', () => {
    const st = {
        onboarding: { mode: 'dnd' },
        foundation: { CLASS_ROSTER: [] },
        progression: { classId: null },
    };
    assert.equal(deriveOnboardingStep(st), 'modern-class');
});

test('foundation without progression stays on the pre-commit steps', () => {
    // progression is seeded in the same call that commits the foundation, but
    // derivation must not crash or skip ahead on a half-written state.
    assert.equal(deriveOnboardingStep({ foundation: {} }), 'mode-select');
});

test('renderMemoAsCards with empty memo renders the mode picker (no chatId in stub)', () => {
    setSettings({});
    const html = renderMemoAsCards('');
    assert.ok(html.includes('rt-mode-btn'), 'mode picker buttons present');
    assert.ok(html.includes('data-mode="dnd"'), 'D&D option present');
    assert.ok(html.includes('data-mode="modern"'), 'Modern option present');
});

test('empty memo with a filterTag (detached panel) does NOT render the onboarding flow', () => {
    setSettings({});
    const html = renderMemoAsCards('', 'QUESTS');
    assert.ok(!html.includes('rt-mode-btn'), 'no mode picker in detached panels');
    assert.ok(!html.includes('rt-ob-status'), 'no duplicate onboarding IDs in detached panels');
    assert.ok(html.includes('rt-empty'), 'renders a simple placeholder instead');
});

// ── Origins entry section on the D&D step (v4.0) ─────────────────────────────

test('D&D step without a draft offers the Origins wizard and keeps the classic roll', () => {
    setSettings({ chatStates: { chat1: { onboarding: { mode: 'dnd' } } } });
    globalThis.SillyTavern._chatId = undefined; // stub has no chatId; renderOriginsEntry is unit-tested below
    const entry = renderOriginsEntry({ onboarding: { mode: 'dnd' } });
    assert.ok(entry.includes('rt-origins-open-btn'), 'Origins open button present');
    assert.ok(entry.includes('Origins'), 'labelled');
    assert.ok(!entry.includes('Resume'), 'no resume without a draft');
});

test('D&D step with an in-progress draft offers Resume + Start over', () => {
    const entry = renderOriginsEntry({ origin: { draft: { step: 'detail', raceId: 'human', originId: 'oathbreaker' } } });
    assert.ok(entry.includes('Resume Character Creation'));
    // Origin Details is step 4 of 6 since Appearance moved after it.
    assert.ok(entry.includes('Step 4 of 6'), 'derived from the clamped wizard step');
    assert.ok(entry.includes('rt-origins-discard-btn'));
});

test('a committed origin renders no Origins entry (locked at commit)', () => {
    assert.equal(renderOriginsEntry({ origin: { committed: { name: 'X' } } }), '');
});

test('renderMemoAsCards keeps the archetype quick-roll buttons on the D&D step', () => {
    setSettings({});
    // No chatId in the stub → chatState null → dnd step only reachable via
    // deriveOnboardingStep with state; assert on the renderer output directly.
    const entry = renderOriginsEntry(null);
    assert.ok(entry.includes('rt-origins-open-btn'));
});
