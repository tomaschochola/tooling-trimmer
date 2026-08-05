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
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const executeFile = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const runCli = async (arguments_) => {
  try {
    const result = await executeFile(process.execPath, [cli, ...arguments_], {
      encoding: 'utf8',
    });

    return {
      exitCode: 0,
      ...result,
    };
  } catch (error) {
    return {
      exitCode: error.code,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
};

const runFix = (directory) => runCli(['fix', directory]);
const runCheck = (directory) => runCli(['check', directory]);

const createRepository = async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tooling-trimmer-'));

  context.after(() => rm(directory, {
    force: true,
    recursive: true,
  }));
  await executeFile('git', ['init', '--quiet', directory]);

  return directory;
};

const put = async (repository, file, content) => {
  const destination = join(repository, file);

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
};

const add = async (repository, files) => {
  await executeFile('git', ['-C', repository, 'add', '--', ...files]);
};

test('requires exactly one directory argument', async () => {
  const missing = await runCli([]);
  const extra = await runCli(['fix', '.', '.']);
  const unknown = await runCli(['unknown', '.']);

  assert.equal(missing.exitCode, 2);
  assert.equal(missing.stderr, 'Usage: trimmer <fix|check> DIRECTORY\n');
  assert.equal(extra.exitCode, 2);
  assert.equal(extra.stderr, 'Usage: trimmer <fix|check> DIRECTORY\n');
  assert.equal(unknown.exitCode, 2);
  assert.equal(unknown.stderr, 'Usage: trimmer <fix|check> DIRECTORY\n');
});

test('rejects a directory outside a Git worktree', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tooling-trimmer-non-git-'));

  context.after(() => rm(directory, {
    force: true,
    recursive: true,
  }));

  const result = await runFix(directory);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /git failed/u);
});

test('check reports line diagnostics, exits with one, and does not write', async (context) => {
  const repository = await createRepository(context);
  const original = 'first  \r\n\r\n';

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, 'file.txt', original);
  await add(repository, ['.editorconfig', 'file.txt']);

  const result = await runCheck(repository);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, '');
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), original);
  assert.match(result.stdout, /"file\.txt":1: trailing whitespace/u);
  assert.match(result.stdout, /"file\.txt":1: expected LF line ending/u);
  assert.match(result.stdout, /"file\.txt":2: expected LF line ending/u);
  assert.match(result.stdout, /"file\.txt":EOF: extra final newlines/u);
  assert.match(result.stdout, /1 file requires changes/u);
});

test('normalizes tracked and untracked text while skipping ignored and binary files', async (context) => {
  const repository = await createRepository(context);
  const binary = Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0x20]);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, '.gitattributes', '* text=auto eol=lf\n');
  await put(repository, '.gitignore', 'ignored.txt\n');
  await put(repository, 'tracked.txt', 'alpha  \r\nbeta\t\r\n\r\n');
  await put(repository, 'untracked.txt', 'gamma \r\n\r\n');
  await put(repository, 'ignored.txt', 'ignored  \r\n\r\n');
  await put(repository, 'binary.dat', binary);
  await add(repository, [
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    'binary.dat',
    'tracked.txt',
  ]);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'tracked.txt'), 'utf8'), 'alpha\nbeta\n');
  assert.equal(await readFile(join(repository, 'untracked.txt'), 'utf8'), 'gamma\n');
  assert.equal(await readFile(join(repository, 'ignored.txt'), 'utf8'), 'ignored  \r\n\r\n');
  assert.deepEqual(await readFile(join(repository, 'binary.dat')), binary);
  assert.match(result.stdout, /skipped 1 binary/u);

  const repeated = await runCheck(repository);

  assert.equal(repeated.exitCode, 0, repeated.stderr);
  assert.match(repeated.stdout, /0 files require changes/u);
});

test('honors EditorConfig sections and collapses final newlines when requested', async (context) => {
  const repository = await createRepository(context);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n[*.md]\ntrim_trailing_whitespace = false\n',
  );
  await put(repository, '.gitattributes', '* text=auto eol=lf\n');
  await put(repository, 'document.md', 'value  \n\n\n');
  await put(repository, 'without-newline.md', 'other  ');
  await add(repository, [
    '.editorconfig',
    '.gitattributes',
    'document.md',
    'without-newline.md',
  ]);

  const checked = await runCheck(repository);

  assert.equal(checked.exitCode, 1);
  assert.match(checked.stdout, /"document\.md":EOF: extra final newlines/u);
  assert.match(checked.stdout, /"without-newline\.md":EOF: missing final newline/u);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'document.md'), 'utf8'), 'value  \n');
  assert.equal(await readFile(join(repository, 'without-newline.md'), 'utf8'), 'other  \n');
});

test('uses Git attributes as an end-of-line fallback', async (context) => {
  const repository = await createRepository(context);

  await put(repository, '.gitattributes', '* text eol=crlf\n');
  await put(repository, 'file.txt', 'first\nsecond\n');
  await add(repository, ['.gitattributes', 'file.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'first\r\nsecond\r\n');
});

test('preserves mixed line endings when neither configuration source selects one', async (context) => {
  const repository = await createRepository(context);

  await put(repository, 'file.txt', 'first\r\nsecond\n\n');
  await add(repository, ['file.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'first\r\nsecond\n\n');
});

test('preserves final newlines when insert_final_newline is unset', async (context) => {
  const repository = await createRepository(context);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, 'file.txt', 'value  \r\n\r\n');
  await add(repository, ['.editorconfig', 'file.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'value\n\n');
});

test('honors an explicit Git text attribute for UTF-16 text', async (context) => {
  const repository = await createRepository(context);
  const bom = Buffer.from([0xff, 0xfe]);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*.txt]\ncharset = utf-16le\nend_of_line = crlf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, '.gitattributes', '*.txt text eol=crlf\n');
  await put(
    repository,
    'file.txt',
    Buffer.concat([bom, Buffer.from('value  \r\n\r\n', 'utf16le')]),
  );
  await add(repository, ['.editorconfig', '.gitattributes', 'file.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    await readFile(join(repository, 'file.txt')),
    Buffer.concat([bom, Buffer.from('value\r\n', 'utf16le')]),
  );
});

test('enforces supported text encodings while normalizing their content', async (context) => {
  const repository = await createRepository(context);
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n[*.latin1]\ncharset = latin1\n[*.utf8]\ncharset = utf-8\n[*.utf8bom]\ncharset = utf-8-bom\n[*.utf16be]\ncharset = utf-16be\n',
  );
  await put(repository, '.gitattributes', '* text eol=lf\n');
  await put(
    repository,
    'file.latin1',
    Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x20, 0x0d, 0x0a]),
  );
  await put(
    repository,
    'file.utf8',
    Buffer.concat([utf8Bom, Buffer.from('value  \r\n\r\n')]),
  );
  await put(
    repository,
    'file.utf8bom',
    Buffer.from('value  \r\n\r\n'),
  );
  await put(
    repository,
    'file.utf16be',
    Buffer.from('feff00760061006c0075006500200020000d000a000d000a', 'hex'),
  );
  await add(repository, [
    '.editorconfig',
    '.gitattributes',
    'file.latin1',
    'file.utf8',
    'file.utf8bom',
    'file.utf16be',
  ]);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    await readFile(join(repository, 'file.latin1')),
    Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
  );
  assert.deepEqual(
    await readFile(join(repository, 'file.utf8')),
    Buffer.from('value\n'),
  );
  assert.deepEqual(
    await readFile(join(repository, 'file.utf8bom')),
    Buffer.concat([utf8Bom, Buffer.from('value\n')]),
  );
  assert.deepEqual(
    await readFile(join(repository, 'file.utf16be')),
    Buffer.from('feff00760061006c00750065000a', 'hex'),
  );
});

test('handles Git file names containing tabs and line breaks', async (context) => {
  const repository = await createRepository(context);
  const file = 'odd\tname\n.txt';

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, file, 'value  \r\n');
  await add(repository, ['.editorconfig', file]);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, file), 'utf8'), 'value\n');
  assert.match(result.stdout, /odd\\tname\\n\.txt/u);
});

test('fails before writing when EditorConfig and Git attributes conflict', async (context) => {
  const repository = await createRepository(context);
  const original = 'value  \n\n';

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, '.gitattributes', '* text eol=crlf\n');
  await put(repository, 'file.txt', original);
  await add(repository, ['.editorconfig', '.gitattributes', 'file.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Conflicting end-of-line settings/u);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), original);
});

test('removes terminal line breaks when insert_final_newline is false', async (context) => {
  const repository = await createRepository(context);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\ninsert_final_newline = false\n',
  );
  await put(repository, 'file.txt', 'value\n\n\n');
  await put(repository, 'empty.txt', '');
  await add(repository, ['.editorconfig', 'empty.txt', 'file.txt']);

  const checked = await runCheck(repository);

  assert.equal(checked.exitCode, 1);
  assert.match(checked.stdout, /"file\.txt":EOF: unexpected final newline/u);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'value\n\n\n');

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'value');
  assert.equal((await stat(join(repository, 'empty.txt'))).size, 0);
});

test('limits processing to the requested subdirectory', async (context) => {
  const repository = await createRepository(context);

  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, 'root.txt', 'root  \r\n');
  await put(repository, 'nested/file.txt', 'nested  \r\n');
  await add(repository, ['.editorconfig', 'nested/file.txt', 'root.txt']);

  const result = await runFix(join(repository, 'nested'));

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(join(repository, 'root.txt'), 'utf8'), 'root  \r\n');
  assert.equal(await readFile(join(repository, 'nested/file.txt'), 'utf8'), 'nested\n');
});

test('skips symbolic links and preserves executable permissions', async (context) => {
  const repository = await createRepository(context);
  const external = await mkdtemp(join(tmpdir(), 'tooling-trimmer-external-'));

  context.after(() => rm(external, {
    force: true,
    recursive: true,
  }));
  const externalFile = join(external, 'target.txt');

  await writeFile(externalFile, 'external  \r\n');
  await put(
    repository,
    '.editorconfig',
    'root = true\n[*]\nend_of_line = lf\ntrim_trailing_whitespace = true\n',
  );
  await put(repository, 'executable', 'command  \r\n');
  await chmod(join(repository, 'executable'), 0o755);
  await symlink(externalFile, join(repository, 'link.txt'));
  await add(repository, ['.editorconfig', 'executable', 'link.txt']);

  const result = await runFix(repository);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(externalFile, 'utf8'), 'external  \r\n');
  assert.equal(await readFile(join(repository, 'executable'), 'utf8'), 'command\n');
  assert.equal((await stat(join(repository, 'executable'))).mode & 0o777, 0o755);
  assert.match(result.stdout, /1 non-regular/u);
});
