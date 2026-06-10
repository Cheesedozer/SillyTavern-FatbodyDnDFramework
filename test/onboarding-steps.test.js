/**
 * Tests for the empty-memo onboarding step machine: deriveOnboardingStep()
 * drives which screen the HUD shows (mode picker → D&D / Modern flows), and
 * renderMemoAsCards('') must render the derived step.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnboardingStep, renderMemoAsCards } from '../renderer.js';

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
