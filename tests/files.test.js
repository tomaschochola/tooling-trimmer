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
import { chmod, link, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { assertSameFile, inspectFile, replaceFile, resolveRepositoryFile, sameFile } from '../src/files.js';
import { temporaryDirectory } from './helpers.js';

function entry(file, endOfLine) {
    return { binary: false, endOfLine, file };
}

test('accepts contained paths and rejects repository escapes', () => {
    assert.equal(resolveRepositoryFile('/repository', 'nested/file'), '/repository/nested/file');
    assert.throws(() => resolveRepositoryFile('/repository', '../file'), /unsafe file name/u);
    assert.throws(() => resolveRepositoryFile('/repository', '/file'), /unsafe file name/u);
});

test('compares every identity and mutation field in file snapshots', () => {
    const snapshot = {
        ctimeNs: 1n,
        dev: 2n,
        ino: 3n,
        mode: 4n,
        mtimeNs: 5n,
        nlink: 1n,
        size: 6n,
    };

    assert.equal(sameFile(snapshot, { ...snapshot }), true);

    for (const property of Object.keys(snapshot)) {
        assert.equal(sameFile(snapshot, { ...snapshot, [property]: snapshot[property] + 1n }), false, property);
    }

    assert.doesNotThrow(() => assertSameFile(snapshot, { ...snapshot }, 'changed'));
    assert.throws(() => assertSameFile(snapshot, { ...snapshot, size: 7n }, 'changed'), /changed/u);
});

test('inspects text, resolves EditorConfig, and encodes a deterministic plan', async (context) => {
    const repository = await temporaryDirectory(context);
    const file = join(repository, 'file.txt');

    await writeFile(join(repository, '.editorconfig'), 'root = true\n[*]\ncharset = utf-8-bom\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n');
    await writeFile(file, 'value  \r\n\r\n');
    await chmod(file, 0o755);

    const plan = await inspectFile(repository, entry('file.txt', 'lf'), new Map());

    assert.equal(plan.changed, true);
    assert.equal(plan.mode, 0o755);
    assert.equal(plan.file, 'file.txt');
    assert.deepEqual(plan.output, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('value\n')]));
    assert.deepEqual(
        plan.diagnostics.map(({ message }) => message),
        ['missing UTF-8 BOM', 'trailing whitespace', 'expected LF line ending', 'expected LF line ending', 'extra final newlines'],
    );

    await replaceFile(plan);

    assert.deepEqual(await readFile(file), plan.output);
    assert.equal((await lstat(file)).mode & 0o777, 0o755);
});

test('skips missing and non-regular files', async (context) => {
    const repository = await temporaryDirectory(context);

    await mkdir(join(repository, 'directory'));
    await symlink('missing-target', join(repository, 'link'));

    assert.deepEqual(await inspectFile(repository, entry('missing', undefined), new Map()), { skipped: 'missing' });
    assert.deepEqual(await inspectFile(repository, entry('directory', undefined), new Map()), { skipped: 'non-regular' });
    assert.deepEqual(await inspectFile(repository, entry('link', undefined), new Map()), { skipped: 'non-regular' });
});

test('rejects special modes and hard links before reading content', async (context) => {
    const repository = await temporaryDirectory(context);
    const special = join(repository, 'special');
    const original = join(repository, 'original');

    await writeFile(special, 'value');
    await chmod(special, 0o4755);
    await writeFile(original, 'value');
    await link(original, join(repository, 'linked'));

    await assert.rejects(async () => await inspectFile(repository, entry('special'), new Map()), /special permission bits/u);
    await assert.rejects(async () => await inspectFile(repository, entry('original'), new Map()), /multiple hard links/u);
});

test('refuses a stale plan and cleans temporary files after write failures', async (context) => {
    const repository = await temporaryDirectory(context);
    const file = join(repository, 'file');

    await writeFile(file, 'original');

    const status = await lstat(file, { bigint: true });
    const plan = {
        absoluteFile: file,
        file: 'file',
        mode: 0o644,
        output: Buffer.from('replacement'),
        status,
    };

    await writeFile(file, 'changed');
    await assert.rejects(async () => await replaceFile(plan), /changed before/u);

    plan.status = await lstat(file, { bigint: true });
    plan.mode = -1;
    await assert.rejects(async () => await replaceFile(plan), /mode|argument|range/iu);

    plan.mode = 0o644;
    plan.output = Symbol('invalid');
    await assert.rejects(async () => await replaceFile(plan), /data|buffer|string|typedarray|dataview/iu);
    assert.deepEqual(
        (await readdir(repository)).filter((name) => name.startsWith('.tooling-trimmer-')),
        [],
    );
});
