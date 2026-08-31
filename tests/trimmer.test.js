/**
 * @file
 * @author Tomáš Chochola <tomaschochola@tomaschochola.cz>
 * @copyright © 2026 Tomáš Chochola <tomaschochola@tomaschochola.cz>
 *
 * @license CC-BY-ND-4.0
 *
 * @see {@link https://creativecommons.org/licenses/by-nd/4.0/} License
 * @see {@link https://github.com/tomaschochola} GitHub Profile
 * @see {@link https://github.com/sponsors/tomaschochola} GitHub Sponsors
 */

import assert from 'node:assert/strict';
import { readFile, stat, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { trimDirectory } from '../src/trimmer.js';
import { add, createRepository, output, put, runCli, temporaryDirectory } from './helpers.js';

test('checks without writing and fixes tracked and untracked text idempotently', async (context) => {
    const repository = await createRepository(context);
    const binary = Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0x20]);

    await put(repository, '.editorconfig', 'root = true\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n');
    await put(repository, '.gitattributes', '* text=auto eol=lf\n');
    await put(repository, '.gitignore', 'ignored.txt\n');
    await put(repository, 'tracked.txt', 'alpha  \r\nbeta\t\r\n\r\n');
    await put(repository, 'untracked.txt', 'gamma \r\n\r\n');
    await put(repository, 'ignored.txt', 'ignored  \r\n\r\n');
    await put(repository, 'binary.dat', binary);
    await add(repository, ['.editorconfig', '.gitattributes', '.gitignore', 'binary.dat', 'tracked.txt']);

    const checked = await runCli(['check', repository]);

    assert.equal(checked.exitCode, 1);
    assert.equal(checked.stderr, '');
    assert.equal(await readFile(join(repository, 'tracked.txt'), 'utf8'), 'alpha  \r\nbeta\t\r\n\r\n');
    assert.match(checked.stdout, /"tracked\.txt":1: trailing whitespace/u);
    assert.match(checked.stdout, /2 files require changes/u);

    const fixed = await runCli(['fix', repository]);

    assert.equal(fixed.exitCode, 0, fixed.stderr);
    assert.equal(await readFile(join(repository, 'tracked.txt'), 'utf8'), 'alpha\nbeta\n');
    assert.equal(await readFile(join(repository, 'untracked.txt'), 'utf8'), 'gamma\n');
    assert.equal(await readFile(join(repository, 'ignored.txt'), 'utf8'), 'ignored  \r\n\r\n');
    assert.deepEqual(await readFile(join(repository, 'binary.dat')), binary);
    assert.match(fixed.stdout, /skipped 1 binary/u);

    const repeated = await runCli(['check', repository]);

    assert.equal(repeated.exitCode, 0, repeated.stderr);
    assert.match(repeated.stdout, /0 files require changes/u);
});

test('honors sections, scoped execution, strange names, and Git EOL fallback', async (context) => {
    const repository = await createRepository(context);
    const strange = 'nested/odd\tname\n.md';

    await put(repository, '.editorconfig', 'root = true\n[*]\ntrim_trailing_whitespace = true\n[*.md]\ntrim_trailing_whitespace = false\n');
    await put(repository, '.gitattributes', '* text eol=crlf\n');
    await put(repository, 'root.txt', 'root  \n');
    await put(repository, strange, 'nested  \n');
    await add(repository, ['.editorconfig', '.gitattributes', 'root.txt', strange]);

    const result = await runCli(['fix', join(repository, 'nested')]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(join(repository, 'root.txt'), 'utf8'), 'root  \n');
    assert.equal(await readFile(join(repository, strange), 'utf8'), 'nested  \r\n');
    assert.match(result.stdout, /odd\\tname\\n\.md/u);
});

test('preserves CRLF when only a final newline is requested', async (context) => {
    const repository = await createRepository(context);

    await put(repository, '.editorconfig', 'root = true\n[*]\ninsert_final_newline = true\n');
    await put(repository, 'file.txt', 'first\r\nsecond');
    await add(repository, ['.editorconfig', 'file.txt']);

    const result = await runCli(['fix', repository]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'first\r\nsecond\r\n');
});

test('fails closed on ambiguous text encodings', async (context) => {
    const repository = await createRepository(context);
    const input = Buffer.from('value  \n', 'utf16le');

    await put(repository, '.editorconfig', 'root = true\n[*]\ntrim_trailing_whitespace = true\n');
    await put(repository, '.gitattributes', '*.txt text\n');
    await put(repository, 'file.txt', input);
    await add(repository, ['.editorconfig', '.gitattributes', 'file.txt']);

    const result = await runCli(['fix', repository]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /NUL bytes.*charset/u);
    assert.deepEqual(await readFile(join(repository, 'file.txt')), input);
});

test('fails before writing on conflicting settings and reports normalization-only changes', async (context) => {
    const repository = await createRepository(context);
    const original = 'value  \n';

    await put(repository, '.editorconfig', 'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n[*.bom]\ncharset = utf-8-bom\n');
    await put(repository, '.gitattributes', '*.txt text eol=crlf\n');
    await put(repository, 'file.txt', original);
    await put(repository, 'file.bom', 'value\n');
    await add(repository, ['.editorconfig', '.gitattributes', 'file.bom', 'file.txt']);

    const failed = await runCli(['fix', repository]);

    assert.equal(failed.exitCode, 1);
    assert.match(failed.stderr, /Conflicting end-of-line settings/u);
    assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), original);
    assert.equal(await readFile(join(repository, 'file.bom'), 'utf8'), 'value\n');

    await unlink(join(repository, 'file.txt'));

    const checked = await runCli(['check', repository]);

    assert.equal(checked.exitCode, 1);
    assert.match(checked.stdout, /"file\.bom":BOM: missing UTF-8 BOM/u);
    assert.match(checked.stdout, /1 missing/u);
});

test('skips symlinks without touching their targets', async (context) => {
    const repository = await createRepository(context);
    const external = await temporaryDirectory(context, 'tooling-trimmer-external-');
    const externalFile = await put(external, 'target.txt', 'external  \r\n');

    await put(repository, '.editorconfig', 'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n');
    await symlink(externalFile, join(repository, 'link.txt'));
    await add(repository, ['.editorconfig', 'link.txt']);

    const result = await runCli(['fix', repository]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(externalFile, 'utf8'), 'external  \r\n');
    assert.match(result.stdout, /1 non-regular/u);
    assert.equal((await stat(externalFile)).isFile(), true);
});

test('emits singular check summaries through the library orchestration', async (context) => {
    const repository = await createRepository(context);
    const standardOutput = output();

    await put(repository, '.editorconfig', 'root = true\n[*]\ntrim_trailing_whitespace = true\n');
    await put(repository, '.git/info/exclude', '.editorconfig\n');
    await put(repository, 'file', 'value ');
    await add(repository, ['file']);

    assert.equal(await trimDirectory('check', repository, standardOutput.stream), 1);
    assert.equal(standardOutput.text(), '"file":1: trailing whitespace\nchecked 1 text file; 1 file requires changes; skipped 0 binary, 0 non-regular, 0 missing\n');
});
