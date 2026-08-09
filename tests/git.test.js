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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { findRepository, listGitEntries, parseGitEntries, repositoryScope, runProcess, withoutFinalLineBreak } from '../src/git.js';
import { createRepository, temporaryDirectory } from './helpers.js';

function records(...values) {
  return Buffer.from(`${values.join('\0')}\0`);
}

test('parses Git text attributes, binary detection, and arbitrary UTF-8 names', () => {
  const entries = parseGitEntries(
    records(
      'i/lf    w/lf    attr/text eol=lf\ttext.txt',
      'i/-text w/-text attr/-text\tbinary.dat',
      'i/lf    w/-text  attr/\tdetected.bin',
      'i/lf    w/-text  attr/text\tforced.txt',
      'i/lf    w/lf    attr/\todd\tname\n.txt',
      '',
    ),
  );

  assert.deepEqual(entries, [
    { binary: false, endOfLine: 'lf', file: 'text.txt' },
    { binary: true, endOfLine: undefined, file: 'binary.dat' },
    { binary: true, endOfLine: undefined, file: 'detected.bin' },
    { binary: false, endOfLine: undefined, file: 'forced.txt' },
    { binary: false, endOfLine: undefined, file: 'odd\tname\n.txt' },
  ]);
});

test('normalizes Git command framing and rejects scopes outside the worktree', () => {
  assert.deepEqual(withoutFinalLineBreak(Buffer.from('path')), Buffer.from('path'));
  assert.deepEqual(withoutFinalLineBreak(Buffer.from('path\n')), Buffer.from('path'));
  assert.deepEqual(withoutFinalLineBreak(Buffer.from('path\r\n')), Buffer.from('path'));
  assert.equal(repositoryScope('/repository', '/repository'), '');
  assert.equal(repositoryScope('/repository', '/repository/nested'), 'nested');
  assert.throws(() => repositoryScope('/repository', '/outside'), /outside the Git worktree/u);
});

test('rejects malformed Git file-list output', () => {
  assert.throws(() => parseGitEntries(Buffer.from('unterminated')), /unterminated/u);
  assert.throws(() => parseGitEntries(records('missing delimiter')), /invalid file-list record/u);
  assert.throws(() => parseGitEntries(records('i/lf w/lf\tfile')), /without attributes/u);
  assert.throws(() => parseGitEntries(Buffer.concat([Buffer.from('i/lf w/lf attr/\t'), Buffer.from([0xff, 0])])), /not valid UTF-8/u);
});

test('runs successful processes and reports exits, signals, stderr, and spawn failures', async () => {
  assert.equal((await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")'])).toString(), 'ok');
  await assert.rejects(async () => await runProcess(process.execPath, ['-e', 'process.exitCode = 7']), /exit code 7$/u);
  await assert.rejects(async () => await runProcess(process.execPath, ['-e', 'process.stderr.write("detail"); process.exitCode = 3']), /exit code 3: "detail"/u);
  await assert.rejects(async () => await runProcess(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']), /signal SIGTERM/u);
  await assert.rejects(async () => await runProcess('tooling-trimmer-command-that-does-not-exist', []), { code: 'ENOENT' });
});

test('discovers repository roots and limits Git listings to a literal scope', async (context) => {
  const repository = await createRepository(context);
  const nested = join(repository, 'nested');

  await writeFile(join(repository, 'root.txt'), 'root');
  await writeFile(join(repository, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(repository, 'ignored.txt'), 'ignored');
  await writeFile(join(repository, 'binary.dat'), Buffer.from([0]));
  await writeFile(join(repository, '.gitattributes'), '*.dat -text\n');
  await mkdir(nested);
  await writeFile(join(nested, 'file.txt'), 'nested');
  await runProcess('git', ['-C', repository, 'add', '--', '.gitattributes', '.gitignore', 'binary.dat', 'nested/file.txt', 'root.txt']);

  const discovered = await findRepository(nested);
  const entries = await listGitEntries(discovered);

  assert.equal(discovered.repository, repository);
  assert.equal(discovered.scope, 'nested');
  assert.deepEqual(
    entries.map(({ file }) => file),
    ['nested/file.txt'],
  );
});

test('lists an unresolved merge path exactly once', async (context) => {
  const repository = await createRepository(context);

  await runProcess('git', ['-C', repository, 'config', 'user.name', 'Test']);
  await runProcess('git', ['-C', repository, 'config', 'user.email', 'test@example.com']);
  await writeFile(join(repository, 'file.txt'), 'base\n');
  await runProcess('git', ['-C', repository, 'add', '--', 'file.txt']);
  await runProcess('git', ['-C', repository, 'commit', '--quiet', '-m', 'base']);
  await runProcess('git', ['-C', repository, 'switch', '--quiet', '-c', 'side']);
  await writeFile(join(repository, 'file.txt'), 'side\n');
  await runProcess('git', ['-C', repository, 'commit', '--quiet', '-am', 'side']);
  await runProcess('git', ['-C', repository, 'switch', '--quiet', '-']);
  await writeFile(join(repository, 'file.txt'), 'main\n');
  await runProcess('git', ['-C', repository, 'commit', '--quiet', '-am', 'main']);
  await assert.rejects(async () => await runProcess('git', ['-C', repository, 'merge', 'side']), /git failed with exit code 1/u);

  const entries = await listGitEntries(await findRepository(repository));

  assert.deepEqual(
    entries.map(({ file }) => file),
    ['file.txt'],
  );
});

test('rejects missing, non-directory, and non-repository scopes', async (context) => {
  const directory = await temporaryDirectory(context);
  const file = join(directory, 'file');

  await writeFile(file, 'value');

  await assert.rejects(async () => await findRepository(join(directory, 'missing')), /Cannot access directory/u);
  await assert.rejects(async () => await findRepository(file), /is not a directory/u);
  await assert.rejects(async () => await findRepository(directory), /git failed/u);
});
