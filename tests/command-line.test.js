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
import test from 'node:test';

import { help, runCommandLine } from '../src/command-line.js';
import { output, runCli } from './helpers.js';

test('prints global and command help without running an operation', async () => {
  for (const arguments_ of [['--help'], ['-h'], ['fix', '--help'], ['check', '-h']]) {
    const standardOutput = output();
    const standardError = output();
    const exitCode = await runCommandLine(arguments_, standardOutput.stream, standardError.stream, async () => {
      throw new Error('operation must not run');
    });

    assert.equal(exitCode, 0);
    assert.equal(standardOutput.text(), help);
    assert.equal(standardError.text(), '');
  }
});

test('rejects incomplete, excessive, unknown, and empty command lines', async () => {
  for (const arguments_ of [[], ['fix'], ['fix', '.', '.'], ['unknown', '.'], ['fix', '']]) {
    const standardOutput = output();
    const standardError = output();
    const exitCode = await runCommandLine(arguments_, standardOutput.stream, standardError.stream);

    assert.equal(exitCode, 2);
    assert.equal(standardOutput.text(), '');
    assert.match(standardError.text(), /^tooling-trimmer: /u);
    assert.match(standardError.text(), /Usage:\n {2}tooling-trimmer fix DIRECTORY/u);
  }
});

test('maps check results and unexpected failures to stable exit codes', async () => {
  const standardOutput = output();
  const standardError = output();

  assert.equal(await runCommandLine(['check', '.'], standardOutput.stream, standardError.stream, async () => 0), 0);
  assert.equal(await runCommandLine(['check', '.'], standardOutput.stream, standardError.stream, async () => 2), 1);
  assert.equal(await runCommandLine(['fix', '.'], standardOutput.stream, standardError.stream, async () => 2), 0);
  assert.equal(
    await runCommandLine(['fix', '.'], standardOutput.stream, standardError.stream, async () => {
      throw new Error('failed');
    }),
    1,
  );
  assert.equal(
    await runCommandLine(['fix', '.'], standardOutput.stream, standardError.stream, async () => {
      throw 'non-error failure';
    }),
    1,
  );
  assert.equal(standardError.text(), 'tooling-trimmer: failed\ntooling-trimmer: non-error failure\n');
});

test('executable adapter exposes the finalized CLI contract', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, help);
  assert.equal(result.stderr, '');
});
