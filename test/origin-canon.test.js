/**
 * Tests for the origin-canon / recorded-lore separation.
 *
 * Regression target: the committed origin profile used to be written as ONE
 * lorebook entry holding both the prose backstory and a JSON.stringify dump,
 * flagged `disable: true` as a "backup". Managed mode ignores `disable` when
 * scanning and injecting, so that entry activated on the PC's name and put the
 * raw serialization into every prompt beside the prose it duplicated — leaving
 * the narrator to reconcile two phrasings of the same facts against whatever
 * the Lorebook Agent had since recorded on its own.
 */
import './_bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyringText, buildLoreIndex, grepLore } from '../router.js';
import { buildActiveLorebookContext, budgetInjections } from '../memo-processor.js';
import { buildOriginCanonSection } from '../origins-engine.js';
import { LORE_INERT_FLAG, LORE_PINNED_FLAG, isInertLoreEntry, isPinnedLoreEntry } from '../state-manager.js';

const CANON = {
    comment: 'Origin Canon: Serevaine',
    key: ['Serevaine'],
    content: 'Serevaine was pulled from the vault by Tessavyn Morregate, a mortal archivist-factor.',
    extensions: { [LORE_PINNED_FLAG]: true },
};
const BACKUP = {
    comment: 'Origin Profile Backup: Serevaine',
    key: [],
    disable: true,
    content: '```json\n{"name":"Serevaine"}\n```',
    extensions: { [LORE_INERT_FLAG]: true },
};
const BOOKS = { Camp_Origin: { entries: { 0: CANON, 1: BACKUP } } };

// ── markers ───────────────────────────────────────────────────────────────────

test('inert and pinned markers are read off entry.extensions and default false', () => {
    assert.equal(isInertLoreEntry(BACKUP), true);
    assert.equal(isInertLoreEntry(CANON), false);
    assert.equal(isPinnedLoreEntry(CANON), true);
    assert.equal(isPinnedLoreEntry(BACKUP), false);
    // `disable` alone must never be mistaken for the inert marker: managed mode
    // sets it on every scoped entry.
    assert.equal(isInertLoreEntry({ disable: true }), false);
    assert.equal(isInertLoreEntry(null), false);
    assert.equal(isInertLoreEntry(undefined), false);
});

// ── the backup is unreachable from every retrieval path ───────────────────────

test('buildKeyringText hides the inert backup from the agent', () => {
    const out = buildKeyringText(BOOKS, []);
    assert.equal(out, '[ARCHIVE] Label: Origin Canon: Serevaine | Keys: [Serevaine]');
});

test('buildLoreIndex omits the inert backup, so grep_lore cannot surface it', () => {
    const idx = buildLoreIndex(BOOKS);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].uid, '0');
    assert.match(grepLore(idx, 'serevaine'), /Origin Canon/);
    assert.doesNotMatch(grepLore(idx, 'json'), /Backup/);
});

test('buildActiveLorebookContext skips an inert entry even when it is active', async () => {
    globalThis.SillyTavern.getContext = ((base) => () => ({
        ...base(),
        loadWorldInfo: async () => BOOKS.Camp_Origin,
    }))(globalThis.SillyTavern.getContext);

    const out = await buildActiveLorebookContext(['Camp_Origin::0', 'Camp_Origin::1']);
    assert.match(out, /### \[Serevaine\]/);
    assert.match(out, /mortal archivist-factor/);
    assert.doesNotMatch(out, /```json/, 'the serialized profile must never reach a prompt');
});

// ── the canon section handed to the Lorebook Agent ────────────────────────────

const PROFILE = {
    name: 'Serevaine', title: 'the Interred', race: 'Vampire', origin: 'Vault-Sleeper',
    nation: { name: 'Orthalan', government: 'Merchant council', cultureVibes: 'ledger-bound', majorityRace: 'Human' },
    socialLever: { text: 'A vault-brand on the throat', legibleTo: 'Orthalan archivists' },
    personalLever: { text: 'She must feed within the week.' },
    pursuer: { identity: 'The Sealed Hand', affiliation: 'Orthalan council', motive: 'Recover the vault key', awareness: 'Suspects she woke' },
    backstory: 'She was pulled from the vault by Tessavyn Morregate, a mortal archivist-factor of modern Orthalan.',
};

test('buildOriginCanonSection carries the backstory verbatim and the never-contradict rule', () => {
    const out = buildOriginCanonSection(PROFILE);
    assert.match(out, /^## ORIGIN CANON \(IMMUTABLE\)/);
    assert.match(out, /Vault-Sleeper — Serevaine, the Interred \(Vampire\)/);
    assert.match(out, /Origin nation: Orthalan/);
    assert.match(out, /Pursuer: The Sealed Hand/);
    // The backstory is the whole point: NPCs like Tessavyn are first named there,
    // and without it the agent has nothing to check a new NPC record against.
    assert.match(out, /Tessavyn Morregate, a mortal archivist-factor/);
    assert.match(out, /Never record, rewrite or consolidate an entry that contradicts them/);
});

test('buildOriginCanonSection returns empty for a campaign with no committed origin', () => {
    assert.equal(buildOriginCanonSection(null), '');
    assert.equal(buildOriginCanonSection(undefined), '');
    assert.equal(buildOriginCanonSection({}), '');
});

test('buildOriginCanonSection tolerates a partial profile', () => {
    const out = buildOriginCanonSection({ name: 'Ryn' });
    assert.match(out, /Unknown origin — Ryn \(unknown race\)/);
    assert.doesNotMatch(out, /Pursuer:/);
    assert.doesNotMatch(out, /Backstory:/);
});

// ── precedence: canon outranks recorded lore under context pressure ───────────

test('budgetInjections keeps the state memo and drops lore when only one fits', () => {
    // Live tier assignment from narrative-hooks.js: memo 1, quests 2, lore 3-5.
    const items = [
        { name: 'STATE MEMO', tier: 1, text: 'M'.repeat(400), trimmable: true },
        { name: 'keyword lore', tier: 3, text: 'K'.repeat(400) },
        { name: 'persistent lore', tier: 5, text: 'P'.repeat(400) },
    ];
    const r = budgetInjections({ contextSize: 200, chatTokens: 0, items });
    assert.match(r.injections, /M/, 'engine-written canon survives');
    assert.doesNotMatch(r.injections, /K/);
    assert.doesNotMatch(r.injections, /P/);
    assert.deepEqual(r.dropped.sort(), ['keyword lore', 'persistent lore']);
});

// ── migration of campaigns created before the split ───────────────────────────

test('migrateOriginCanonEntries splits a legacy combined Origin Profile entry', async () => {
    const { setSettings } = await import('./_bootstrap.js');
    const { migrateOriginCanonEntries } = await import('../router.js');

    const book = {
        entries: {
            0: { uid: 0, comment: 'Origin Nation: Orthalan', key: ['Orthalan'], content: 'A merchant council.' },
            1: {
                uid: 1,
                comment: 'Origin Profile: Serevaine',
                key: ['Serevaine', 'Vault-Sleeper'],
                disable: true,
                content: 'Vault-Sleeper — Serevaine (Vampire).\n\nTessavyn Morregate, a mortal archivist-factor.\n\n'
                    + '```json\n{"name":"Serevaine","race":"Vampire"}\n```',
            },
        },
    };

    setSettings({ routerEnabled: true, routerCampaignPrefixOverride: 'Camp' });
    const baseGetContext = globalThis.SillyTavern.getContext.bind(globalThis.SillyTavern);
    const prevFetch = globalThis.fetch;
    let written = null;
    globalThis.SillyTavern.getContext = () => ({
        ...baseGetContext(),
        chatId: 'Camp',
        loadWorldInfo: async (n) => (n === 'Camp_Origin' ? book : null),
        saveWorldInfo: async () => {},
    });
    globalThis.fetch = async (_url, opts) => {
        written = JSON.parse(opts.body);
        return { ok: true, status: 200 };
    };

    try {
        assert.equal(await migrateOriginCanonEntries(), true);

        const entries = Object.values(written.data.entries);
        const canon = entries.find(e => e.comment === 'Origin Canon: Serevaine');
        const backup = entries.find(e => e.comment === 'Origin Profile Backup: Serevaine');

        assert.ok(canon, 'the legacy entry is renamed, not duplicated');
        assert.doesNotMatch(canon.content, /```json/, 'the serialization is moved out of the prose entry');
        assert.match(canon.content, /Tessavyn Morregate, a mortal archivist-factor/, 'prose canon is preserved');
        assert.equal(isPinnedLoreEntry(canon), true);
        assert.deepEqual(canon.key, ['Serevaine', 'Vault-Sleeper'], 'activation keys are kept');

        assert.ok(backup, 'the JSON moves to its own entry');
        assert.deepEqual(backup.key, []);
        assert.equal(backup.disable, true);
        assert.equal(isInertLoreEntry(backup), true);
        assert.match(backup.content, /"name":"Serevaine"/);

        // The canon entry is registered active and pinned so it survives the
        // agent's budget pressure and reaches the state model.
        const s = (await import('../state-manager.js')).getSettings();
        assert.ok(s.activeRouterKeys.includes('Camp_Origin::1'));
        assert.ok(s.pinnedRouterKeys.includes('Camp_Origin::1'));

        // Idempotent: a second run finds no legacy entry and writes nothing.
        written = null;
        assert.equal(await migrateOriginCanonEntries(), false);
        assert.equal(written, null);
    } finally {
        globalThis.SillyTavern.getContext = baseGetContext;
        globalThis.fetch = prevFetch;
    }
});

// ── [ORIGIN] canon enforcement in the state pass ─────────────────────────────
//
// mergeMemo treats every tag uniformly: a replace clobbers the whole block and
// [ORIGIN]REMOVED[/ORIGIN] deletes it. The "engine owns this block" guarantee in
// the extractor prompt had nothing behind it, so the state model could rewrite
// the character's race or nation, or drop the block entirely. applyOriginCanon
// re-derives it from `committed` after every pass, exactly as the XP line is
// normalized, while preserving the one edit the prompt permits.

function committedProfile() {
    return {
        name: 'Serevaine', title: 'the Interred', race: 'Vampire', origin: 'Vault-Sleeper',
        originId: 'exiled_royal',
        nation: {
            name: 'Orthalan', majorityRace: 'Human', government: 'Merchant council',
            cultureVibes: 'ledger-bound', environment: 'Fog-drowned delta',
            outsiderView: 'Rich and unsentimental.', tone: 'Ink, brass and river damp.',
        },
        socialLever: { text: 'A vault-brand on the throat', legibleTo: 'Orthalan archivists' },
        personalLever: { text: 'She must feed within the week.' },
        pursuer: { identity: 'The Sealed Hand', motive: 'Recover the vault key', awareness: 'Suspects she woke' },
        currentGoal: 'Reach the border archive alive.',
        personalityVoice: 'Clipped, archival.',
    };
}

/** Seeds a chat state with a committed origin and returns { settings, committed }. */
async function withCommittedOrigin() {
    const { setSettings } = await import('./_bootstrap.js');
    const { getSettings } = await import('../state-manager.js');
    setSettings({ chatStates: { chat1: { origin: { committed: committedProfile() } } } });
    const settings = getSettings();
    return { settings, committed: settings.chatStates.chat1.origin.committed };
}

test('applyOriginCanon reverts a rewritten canon line', async () => {
    const { applyOriginCanon } = await import('../origins-engine.js');
    const { settings } = await withCommittedOrigin();

    const tampered = '[ORIGIN]\nOrigin: Vault-Sleeper\nRace: Werewolf\n[/ORIGIN]';
    const out = applyOriginCanon(settings, tampered, 'chat1');

    assert.match(out, /Race: Vampire/, 'engine truth wins over the extractor');
    assert.doesNotMatch(out, /Werewolf/);
    assert.match(out, /Nation: Orthalan/, 'the full block is re-derived, not patched');
});

test('applyOriginCanon keeps a changed Current Goal and persists it to committed', async () => {
    const { applyOriginCanon } = await import('../origins-engine.js');
    const { settings, committed } = await withCommittedOrigin();

    const updated = '[ORIGIN]\nRace: Vampire\nCurrent Goal: Find who sealed the vault.\n[/ORIGIN]';
    const out = applyOriginCanon(settings, updated, 'chat1');

    assert.match(out, /Current Goal: Find who sealed the vault\./);
    // Persisting matters: publishOriginArcTieIn rebuilds this block from
    // `committed`, and would otherwise restore the creation-time goal.
    assert.equal(committed.currentGoal, 'Find who sealed the vault.');
});

test('applyOriginCanon makes [ORIGIN]REMOVED[/ORIGIN] a no-op', async () => {
    const { mergeMemo } = await import('../memo-processor.js');
    const { applyOriginCanon } = await import('../origins-engine.js');
    const { settings } = await withCommittedOrigin();

    const base = '[TIME]\n08:00 AM, Day 1\n[/TIME]\n\n[ORIGIN]\nRace: Vampire\n[/ORIGIN]';
    const merged = mergeMemo(base, '[ORIGIN]REMOVED[/ORIGIN]');
    assert.doesNotMatch(merged, /Race: Vampire/, 'sanity: mergeMemo really does delete it');

    const out = applyOriginCanon(settings, merged, 'chat1');
    assert.match(out, /\[ORIGIN\][\s\S]*Race: Vampire[\s\S]*\[\/ORIGIN\]/);
    assert.match(out, /\[TIME\]/, 'other blocks are untouched');
});

test('applyOriginCanon is a no-op for a campaign with no committed origin', async () => {
    const { setSettings } = await import('./_bootstrap.js');
    const { getSettings } = await import('../state-manager.js');
    const { applyOriginCanon } = await import('../origins-engine.js');

    setSettings({ chatStates: { chat1: {} } });
    const memo = '[TIME]\n08:00 AM, Day 1\n[/TIME]';
    assert.equal(applyOriginCanon(getSettings(), memo, 'chat1'), memo);
    assert.equal(applyOriginCanon(getSettings(), memo, 'unknown-chat'), memo);
});

// ── cross-book entry identity ────────────────────────────────────────────────

test('buildEntryLookup indexes comments AND keywords, and skips inert entries', async () => {
    const { buildEntryLookup, normalizeEntryName } = await import('../router.js');

    const books = {
        Camp_Origin: {
            entries: {
                // The shape writeOriginCanonBook produces: the label carries a
                // "Pursuer: " prefix the agent never uses, but the key is the
                // bare identity it does use.
                0: { comment: 'Pursuer: The Sealed Hand', key: ['The Sealed Hand'], content: 'Motive: recover the key.' },
                1: BACKUP,
            },
        },
        Camp_NPCs: { entries: { 0: { comment: 'Barnaby', key: ['Barnaby', 'blacksmith'], content: 'A smith.' } } },
    };

    const idx = buildEntryLookup(books);
    assert.equal(idx.get('pursuer: the sealed hand'), 'Camp_Origin::0', 'matches on comment');
    assert.equal(idx.get('the sealed hand'), 'Camp_Origin::0', 'matches on keyword — the pursuer case');
    assert.equal(idx.get('blacksmith'), 'Camp_NPCs::0');
    assert.equal(idx.get('origin profile backup: serevaine'), undefined, 'inert backups are unaddressable');

    assert.equal(normalizeEntryName('[Day 3] Ruined Bridge'), 'ruined bridge', 'strips a timestamp stamp');
    assert.equal(normalizeEntryName(null), '');
});

test('buildEntryLookup is first-writer-wins on a duplicate name', async () => {
    const { buildEntryLookup } = await import('../router.js');
    const idx = buildEntryLookup({
        A: { entries: { 0: { comment: 'Ash', key: [] } } },
        B: { entries: { 0: { comment: 'Ash', key: [] } } },
    });
    assert.equal(idx.get('ash'), 'A::0');
});
