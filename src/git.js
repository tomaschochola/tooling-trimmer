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

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

import { TrimmerError } from './errors.js';

function decodeUtf8(value, description) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch (error) {
    throw new TrimmerError(`${description} is not valid UTF-8`, 1, { cause: error });
  }
}

export function withoutFinalLineBreak(value) {
  if (value.at(-1) !== 0x0a) {
    return value;
  }

  return value.subarray(0, value.at(-2) === 0x0d ? -2 : -1);
}

export function repositoryScope(repository, requestedDirectory) {
  const scope = relative(repository, requestedDirectory);

  if (scope === '..' || scope.startsWith(`..${sep}`)) {
    throw new TrimmerError('The requested directory is outside the Git worktree');
  }

  return scope;
}

export function runProcess(command, arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const standardOutput = [];
    const standardError = [];

    child.stdout.on('data', (chunk) => standardOutput.push(chunk));
    child.stderr.on('data', (chunk) => standardError.push(chunk));
    child.on('error', rejectPromise);
    child.on('close', (exitCode, signal) => {
      const output = Buffer.concat(standardOutput);

      if (exitCode === 0) {
        resolvePromise(output);

        return;
      }

      const errorOutput = Buffer.concat(standardError).toString('utf8').trim();
      const status = signal === null ? `exit code ${String(exitCode)}` : `signal ${signal}`;
      const detail = errorOutput === '' ? '' : `: ${JSON.stringify(errorOutput)}`;

      rejectPromise(new TrimmerError(`${command} failed with ${status}${detail}`));
    });
  });
}

function runGit(directory, arguments_) {
  return runProcess('git', ['-C', directory, ...arguments_]);
}

export async function findRepository(directory) {
  let requestedDirectory;

  try {
    requestedDirectory = await realpath(resolve(directory));
  } catch (error) {
    throw new TrimmerError(`Cannot access directory ${JSON.stringify(directory)}: ${error.message}`, 1, { cause: error });
  }

  const status = await lstat(requestedDirectory);

  if (!status.isDirectory()) {
    throw new TrimmerError(`${JSON.stringify(directory)} is not a directory`);
  }

  const output = await runGit(requestedDirectory, ['rev-parse', '--show-toplevel']);
  const repository = await realpath(decodeUtf8(withoutFinalLineBreak(output), 'Git repository path'));
  const scope = repositoryScope(repository, requestedDirectory);

  return { repository, scope };
}

export function parseGitEntries(output) {
  const entries = [];

  let offset = 0;

  while (offset < output.length) {
    const terminator = output.indexOf(0, offset);

    if (terminator === -1) {
      throw new TrimmerError('Git returned an invalid unterminated file list');
    }

    const record = output.subarray(offset, terminator);

    offset = terminator + 1;

    if (record.length === 0) {
      continue;
    }

    const delimiter = record.indexOf(0x09);

    if (delimiter === -1) {
      throw new TrimmerError('Git returned an invalid file-list record');
    }

    const metadata = record.subarray(0, delimiter).toString('ascii').trim();
    const file = decodeUtf8(record.subarray(delimiter + 1), 'A Git file name');
    const attributeMarker = metadata.indexOf('attr/');

    if (attributeMarker === -1) {
      throw new TrimmerError('Git returned a file-list record without attributes');
    }

    const attributes = metadata
      .slice(attributeMarker + 'attr/'.length)
      .split(/\s+/u)
      .filter(Boolean);
    const endOfLine = attributes.find((attribute) => attribute === 'eol=lf' || attribute === 'eol=crlf')?.slice(4);
    const explicitlyBinary = attributes.includes('-text');
    const explicitlyText = attributes.includes('text');
    const detectedBinary = /(?:^|\s)w\/-text(?:\s|$)/u.test(metadata);

    entries.push({
      binary: explicitlyBinary || (!explicitlyText && detectedBinary),
      endOfLine,
      file,
    });
  }

  return entries;
}

export async function listGitEntries({ repository, scope }) {
  const arguments_ = ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '--eol', '--deduplicate', '-z'];

  if (scope !== '') {
    arguments_.push('--', `:(literal)${scope}`);
  }

  return parseGitEntries(await runGit(repository, arguments_));
}
