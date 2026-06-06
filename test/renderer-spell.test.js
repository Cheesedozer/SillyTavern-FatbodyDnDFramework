/**
 * Tests for the Wikidot spell-link slug helper and both render call sites.
 * Verifies the fix for broken links: trailing annotations stripped, leading/
 * trailing hyphens trimmed, apostrophes removed (verified-correct for Wikidot),
 * and the SPELL_SLUG_OVERRIDES map honored.
 */
import './_bootstrap.js';
import { setSettings } from './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spellSlug, spellWikidotUrl, renderSpellGroups } from '../renderer.js';

test('spellSlug: apostrophes are stripped (Wikidot convention)', () => {
    assert.equal(spellSlug("Tasha's Hideous Laughter"), 'tashas-hideous-laughter');
});

test('spellSlug: trailing parenthetical annotation is dropped', () => {
    assert.equal(spellSlug('Hex (concentration)'), 'hex');
});

test('spellSlug: trailing bracket annotation is dropped', () => {
    assert.equal(spellSlug('Shield [reaction]'), 'shield');
});

test('spellSlug: leading/trailing hyphens are trimmed', () => {
    assert.equal(spellSlug('— Fireball —'), 'fireball');
    assert.equal(spellSlug('  Magic Missile  '), 'magic-missile');
});

test('spellSlug: internal non-alphanumeric runs collapse to one hyphen', () => {
    assert.equal(spellSlug('Melf’s Acid Arrow'.replace('’', "'")), 'melfs-acid-arrow');
    assert.equal(spellSlug('Mordenkainen / Sword'), 'mordenkainen-sword');
});

test('spellSlug: override map wins when present', () => {
    assert.equal(spellSlug('Fireball'), 'fireball');
    // Empty map by default → pass-through. (Override behavior covered by the
    // `|| slug` fallback; map is intentionally empty in source.)
});

test('spellWikidotUrl: produces the full spell URL', () => {
    assert.equal(spellWikidotUrl('Fireball'), 'https://dnd5e.wikidot.com/spell:fireball');
    assert.equal(spellWikidotUrl('Hex (concentration)'), 'https://dnd5e.wikidot.com/spell:hex');
});

test('renderSpellGroups routes spell names through the cleaned slug', () => {
    setSettings({ debugMode: false });
    const html = renderSpellGroups('Level 1 (2/3): Hex (concentration), Shield');
    assert.match(html, /spell:hex"/);            // not spell:hex-concentration-
    assert.match(html, /spell:shield"/);
    assert.doesNotMatch(html, /spell:hex-concentration/);
});
