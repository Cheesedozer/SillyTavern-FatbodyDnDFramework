/**
 * Tests for FOLDER_NAME resolution.
 *
 * env.js resolves the extension's install directory so every template, sysprompt and
 * asset fetch can be addressed. It used to match the loaded <script> URL against a
 * hardcoded list of legacy folder names and fall back to the pre-rebrand name, which
 * meant a fresh install under the current repo name resolved to a directory that does
 * not exist — and the entire settings UI 404'd. The module URL is now the primary
 * source, so any folder name resolves correctly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const FOLDER_RE = /third-party\/([^\/]+)\//;

/** Mirrors the parsing env.js performs on import.meta.url / script src. */
function folderFromUrl(url) {
    const match = FOLDER_RE.exec(url || '');
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

test('a module URL under the current repo name resolves to that folder', () => {
    assert.equal(
        folderFromUrl('http://127.0.0.1:8000/scripts/extensions/third-party/SillyTavern-OriginsRPGFramework/env.js'),
        'SillyTavern-OriginsRPGFramework',
    );
});

test('a legacy install folder still resolves to itself', () => {
    assert.equal(
        folderFromUrl('http://127.0.0.1:8000/scripts/extensions/third-party/SillyTavern-FatbodyDnDFramework/env.js'),
        'SillyTavern-FatbodyDnDFramework',
    );
});

test('an arbitrary user rename resolves without needing a name list', () => {
    assert.equal(
        folderFromUrl('http://127.0.0.1:8000/scripts/extensions/third-party/my-cool-rpg/env.js'),
        'my-cool-rpg',
    );
});

test('a percent-encoded folder name is decoded', () => {
    assert.equal(
        folderFromUrl('http://127.0.0.1:8000/scripts/extensions/third-party/My%20RPG%20Folder/env.js'),
        'My RPG Folder',
    );
});

test('a URL with no third-party segment yields no match, so the fallback applies', () => {
    assert.equal(folderFromUrl('blob:http://127.0.0.1:8000/1234-5678'), null);
    assert.equal(folderFromUrl(''), null);
});

test('env.js exports a non-empty FOLDER_NAME even with no DOM and a file: module URL', async () => {
    // Under Node there is no document and import.meta.url is a file: URL with no
    // third-party segment, so this exercises the final hardcoded fallback.
    const { FOLDER_NAME } = await import('../env.js');
    assert.equal(typeof FOLDER_NAME, 'string');
    assert.ok(FOLDER_NAME.length > 0);
    assert.equal(FOLDER_NAME, 'SillyTavern-OriginsRPGFramework', 'fallback is the current repo name');
});
