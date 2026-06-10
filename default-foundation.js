/**
 * default-foundation.js — Fatbody Framework (Modern RPG mode, v3.1)
 *
 * The built-in "Quick Start" foundation: a complete, schema-valid Modern
 * campaign contract that works with ANY character card. Committing it skips
 * the Foundation Builder interview entirely — the user lands straight on
 * class selection and the Skill Forge grows the tree per-chat as usual.
 *
 * The setting is deliberately setting-agnostic ("The Awakened World"): it
 * describes how power works, not where the story happens, so it layers onto
 * fantasy, modern, sci-fi, or slice-of-life cards without contradiction.
 *
 * Pure data module (node-testable). No ST access, no DOM.
 *
 * Imports: foundation.js (schema version only)
 * Imported by: foundation-wizard.js (Quick Start button, class crests)
 */

import { FOUNDATION_SCHEMA_VERSION } from './foundation.js';

/** Canonical ids of the six Quick Start classes, in display order. */
export const DEFAULT_CLASS_IDS = ['fighter', 'monk', 'bard', 'rogue', 'ranger', 'wizard'];

/**
 * Builds a fresh default foundation document. Factory (not a shared constant)
 * because commitFoundation() stamps version metadata onto the object and the
 * progression engine mutates downstream copies — a module-level singleton
 * would leak state between campaigns.
 *
 * @returns {object} schema-valid foundation (validateFoundation → ok, no errors)
 */
export function defaultFoundation() {
    return {
        schemaVersion: FOUNDATION_SCHEMA_VERSION,
        mode: 'modern',
        SETTING: {
            name: 'The Awakened World',
            synopsis: 'The world is exactly as the story already shows it — except that latent potential, called the Awakening, sleeps in everyone. Those who awaken channel it through one of six time-honored disciplines, growing from ordinary capability into legend one hard-won skill at a time.',
            themes: ['growth', 'discipline', 'adventure', 'mastery'],
            toneNotes: 'Adapts to the host story: keep the existing tone and genre, layer progression mechanics on top without rewriting the world.',
        },
        POWER_SYSTEM: {
            name: 'The Awakening',
            description: 'Awakened potential expresses through three pools: Stamina drives feats of muscle and endurance, Mana fuels channeled arcane or anomalous power, and Focus sharpens precision, perception, and inner discipline. Skills draw on the pool their discipline favors.',
            resources: [
                { id: 'stamina', name: 'Stamina', description: 'Physical exertion pool for feats of strength, endurance, and martial technique.', regenRule: 'Recovers fully on a long rest; a short breather restores half.' },
                { id: 'mana', name: 'Mana', description: 'Channeled arcane potential fueling spells, songs of power, and supernatural effects.', regenRule: 'Recovers fully on a long rest; meditation or quiet study restores a quarter.' },
                { id: 'focus', name: 'Focus', description: 'Concentration and inner discipline spent on precision strikes, stealth, and heightened awareness.', regenRule: 'Recovers fully on a short rest; breaks under sustained chaos.' },
            ],
            diceProfile: {
                primary: 'd20',
                subdice: ['d4', 'd6', 'd8', 'd10', 'd12'],
                queueLen: 12,
                dcScale: [
                    { label: 'Trivial', value: 5 },
                    { label: 'Easy', value: 10 },
                    { label: 'Moderate', value: 15 },
                    { label: 'Hard', value: 20 },
                    { label: 'Near-impossible', value: 30 },
                ],
            },
        },
        PROGRESSION_RULES: {
            maxLevel: 100,
            xpCurveId: 'modern_v1',
            skillPointsPerLevel: 2,
            milestoneEvery: 10,
            milestoneBonus: 4,
            respec: { freeUntilLevel: 10, currencyName: 'gold', costMultiplier: 1.0 },
        },
        CLASS_ROSTER: [
            {
                id: 'fighter',
                name: 'Fighter',
                fantasy: 'Master of weapons and armor who dominates the front line through training and sheer durability.',
                role: 'tank',
                primaryResource: 'stamina',
                treeThemes: ['weapon mastery', 'defense', 'battlefield control', 'endurance'],
            },
            {
                id: 'monk',
                name: 'Monk',
                fantasy: 'Disciplined martial artist whose inner focus turns body and breath into the only weapon needed.',
                role: 'hybrid',
                primaryResource: 'focus',
                treeThemes: ['martial arts', 'speed', 'inner discipline', 'deflection'],
            },
            {
                id: 'bard',
                name: 'Bard',
                fantasy: 'Performer whose music and silver tongue inspire allies, sway hearts, and unravel enemies.',
                role: 'support',
                primaryResource: 'mana',
                treeThemes: ['inspiration', 'enchantment', 'lore', 'social influence'],
            },
            {
                id: 'rogue',
                name: 'Rogue',
                fantasy: 'Swift and cunning operator who strikes from shadow with precision, deception, and perfect timing.',
                role: 'damage',
                primaryResource: 'focus',
                treeThemes: ['stealth', 'precision strikes', 'deception', 'agility'],
            },
            {
                id: 'ranger',
                name: 'Ranger',
                fantasy: 'Expert tracker and marksman, deadly at range and unmatched in wild or hostile territory.',
                role: 'damage',
                primaryResource: 'stamina',
                treeThemes: ['ranged combat', 'tracking', 'survival', 'beast lore'],
            },
            {
                id: 'wizard',
                name: 'Wizard',
                fantasy: 'Scholar of raw arcane power who bends the battlefield through study, intellect, and devastating spellwork.',
                role: 'control',
                primaryResource: 'mana',
                treeThemes: ['elemental magic', 'battlefield control', 'arcane knowledge', 'wards'],
            },
        ],
        JOB_RULES: {
            enabled: true,
            maxJobs: 2,
            unlockNarrative: 'Jobs unlock through in-story commitment: apprenticing to a mentor, joining an organization, or proving mastery of a craft.',
            jobSeeds: [
                { id: 'artisan', name: 'Artisan', description: 'Crafter of equipment, tools, and consumables that support the party.', unlockHint: 'Study under a master craftsman or complete a signature work.' },
                { id: 'mercenary', name: 'Mercenary', description: 'Professional soldier-for-hire with contacts, contracts, and dirty tricks.', unlockHint: 'Take and complete a paid contract from a guild or patron.' },
            ],
        },
        SKILL_TAXONOMY: {
            damageTypes: ['slashing', 'piercing', 'bludgeoning', 'fire', 'frost', 'lightning', 'radiant', 'shadow'],
            namingConvention: 'Short evocative names in plain language (two to three words), e.g. "Riposte", "Shadow Step", "Arcane Lattice".',
            rarityTiers: [
                { id: 'common', name: 'Common', color: '#aaaaaa' },
                { id: 'uncommon', name: 'Uncommon', color: '#4caf50' },
                { id: 'rare', name: 'Rare', color: '#5588ff' },
                { id: 'epic', name: 'Epic', color: '#aa55ff' },
                { id: 'legendary', name: 'Legendary', color: '#ff8800' },
            ],
            tierCount: 10,
            levelGatePerTier: 10,
        },
        LETHALITY: {
            template: 'standard',
            downedWindow: 3,
            injuryTable: [
                'Deep gash (-2 to physical checks until treated)',
                'Cracked ribs (-10 max Stamina)',
                'Concussion (-2 to Focus-based checks)',
                'Mangled hand (-2 to fine manipulation and weapon checks)',
                'Burned arm (-10 max Mana, channeling is painful)',
                'Torn leg muscle (movement halved until healed)',
                'Lost eye (-2 to ranged and perception checks, permanent unless restored)',
            ],
            deathRule: 'A third permanent injury, or an unsurvivable narrative event, means true death.',
        },
    };
}

/**
 * Inline SVG crest per Quick Start class (24px, fill follows text color).
 * Class-selection buttons show these; AI-generated rosters with other ids
 * simply render without a crest.
 */
export const CLASS_CRESTS = {
    fighter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 2l7 3v6c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V5l7-3zm0 2.2L7 6.3v4.7c0 3.6 2.2 6.6 5 8 2.8-1.4 5-4.4 5-8V6.3l-5-2.1zM9 8l3 3 3-3 1 1-3 3 3 3-1 1-3-3-3 3-1-1 3-3-3-3 1-1z"/></svg>',
    monk: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 3a2 2 0 012 2v5.5l1-.3V6a1.5 1.5 0 013 0v7.2c0 1.8-.7 3.5-2 4.8l-2.3 2.3a3 3 0 01-2.1.9h-1.4a3 3 0 01-2.2-1l-3.2-3.6a1.4 1.4 0 012-2l1.2 1.2V5a2 2 0 012-2zm0 2a.4.4 0 00-.4.4v8.1l-2.9-2.9v.1l3.1 3.5h1.4l.2-.1 2.3-2.3a4.8 4.8 0 001.3-3.3V6.4l-1 .3v4.1l-2 .7V5.4A.4.4 0 0012 5z"/></svg>',
    bard: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M19 3a2 2 0 012 2c0 .9-.6 1.7-1.4 1.9l-5.2 5.2a5.5 5.5 0 01-1.3 5.7 5.5 5.5 0 11-7.8-7.8 5.5 5.5 0 015.7-1.3l5.2-5.2C16.3 2.6 17.1 2 18 2l1 1zm-9.7 8.1a3.5 3.5 0 102.6 2.6l-1.2 1.2a1.5 1.5 0 11-2.6-2.6l1.2-1.2z"/></svg>',
    rogue: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M19.5 3c.4 2.8-.3 5.6-2.1 7.9l-5 6.2-1.4-1.4 6.2-5c2.3-1.8 5.1-2.5 7.9-2.1L19.5 3zM9.9 14.7l-.7.9-2.1.5-2.5 2.5a1.4 1.4 0 002 2L9.1 18l.5-2.1.9-.7-1.4-1.4-.2.9z" transform="translate(-2.6 -0.3)"/></svg>',
    ranger: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M20 4l-9.3 9.3 1.4 1.4L20 4zM4.9 4.2A11 11 0 0119.8 19a11 11 0 01-1.6 1.3l-1.1-1.7c.4-.3.8-.6 1.2-1A9 9 0 006 5.5c-.4.4-.7.8-1 1.2L3.3 5.6c.4-.6.9-1 1.6-1.4zM4 16.6L7.4 20l-1 1L3 17.6l1-1z"/></svg>',
    wizard: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.2 2.8L16 6l-2.8 1.2L12 10l-1.2-2.8L8 6l2.8-1.2L12 2zm-5.5 8.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9L3.8 13l1.9-.8.8-1.7zM14 11l6 6-3 3-6-6 1.5-1.5L17 17l-4.5-4.5L14 11z"/></svg>',
};
