#!/usr/bin/env node

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

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

import { parse } from 'editorconfig';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const USAGE = 'Usage: trimmer <fix|check> DIRECTORY';

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const run = (command, arguments_) => new Promise((resolvePromise, rejectPromise) => {
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
    const errorOutput = Buffer.concat(standardError);

    if (exitCode === 0) {
      resolvePromise(output);

      return;
    }

    const reason = errorOutput.toString('utf8').trim();
    const status = signal === null ? `exit code ${exitCode}` : `signal ${signal}`;
    const detail = reason === '' ? '' : `: ${JSON.stringify(reason)}`;

    rejectPromise(
      new CliError(`${command} failed with ${status}${detail}`),
    );
  });
});

const runGit = (directory, arguments_) => run('git', ['-C', directory, ...arguments_]);

const decodeUtf8 = (value, description) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new CliError(`${description} is not valid UTF-8`);
  }
};

const trimFinalLineBreak = (value) => {
  if (value.at(-1) !== 0x0a) {
    return value;
  }

  const end = value.at(-2) === 0x0d ? -2 : -1;

  return value.subarray(0, end);
};

const findRepository = async (directory) => {
  let canonicalDirectory;

  try {
    canonicalDirectory = await realpath(resolve(directory));
  } catch (error) {
    throw new CliError(
      `Cannot access directory ${JSON.stringify(directory)}: ${error.message}`,
    );
  }

  let directoryStatus;

  try {
    directoryStatus = await lstat(canonicalDirectory);
  } catch (error) {
    throw new CliError(
      `Cannot inspect directory ${JSON.stringify(directory)}: ${error.message}`,
    );
  }

  if (!directoryStatus.isDirectory()) {
    throw new CliError(`${JSON.stringify(directory)} is not a directory`);
  }

  const repositoryOutput = await runGit(canonicalDirectory, [
    'rev-parse',
    '--show-toplevel',
  ]);

  const repository = await realpath(
    decodeUtf8(trimFinalLineBreak(repositoryOutput), 'Git repository path'),
  );

  const scope = relative(repository, canonicalDirectory);

  if (scope === '..' || scope.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new CliError('The requested directory is outside the Git worktree');
  }

  return {
    repository,
    scope,
  };
};

const parseGitEntries = (output) => {
  const entries = [];

  let offset = 0;

  while (offset < output.length) {
    const terminator = output.indexOf(0, offset);

    if (terminator === -1) {
      throw new CliError('Git returned an invalid unterminated file list');
    }

    const record = output.subarray(offset, terminator);

    offset = terminator + 1;

    if (record.length === 0) {
      continue;
    }

    const delimiter = record.indexOf(0x09);

    if (delimiter === -1) {
      throw new CliError('Git returned an invalid file-list record');
    }

    const metadata = record.subarray(0, delimiter).toString('ascii').trim();
    const file = decodeUtf8(record.subarray(delimiter + 1), 'A Git file name');
    const attributeMarker = metadata.indexOf('attr/');

    if (attributeMarker === -1) {
      throw new CliError('Git returned a file-list record without attributes');
    }

    const attributes = metadata
      .slice(attributeMarker + 'attr/'.length)
      .split(/\s+/u)
      .filter((attribute) => attribute !== '');

    const attributeEndOfLine = attributes
      .find((attribute) => attribute === 'eol=lf' || attribute === 'eol=crlf')
      ?.slice('eol='.length);

    const explicitlyBinary = attributes.includes('-text');
    const explicitlyText = attributes.includes('text');
    const detectedBinary = (/(?:^|\s)w\/-text(?:\s|$)/u).test(metadata);

    entries.push({
      attributeEndOfLine,
      binary: explicitlyBinary || (!explicitlyText && detectedBinary),
      file,
    });
  }

  return entries;
};

const listGitEntries = async ({ repository, scope }) => {
  const arguments_ = [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--full-name',
    '--eol',
    '-z',
  ];

  if (scope !== '') {
    arguments_.push('--', `:(literal)${scope}`);
  }

  return parseGitEntries(await runGit(repository, arguments_));
};

const parseBoolean = (value, property, file) => {
  if (value === undefined || value === 'unset') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new CliError(
    `Invalid ${property} value for ${JSON.stringify(file)}: ${JSON.stringify(value)}`,
  );
};

const parseEndOfLine = (value, file) => {
  if (value === undefined || value === 'unset') {
    return undefined;
  }

  if (value === 'lf' || value === 'crlf' || value === 'cr') {
    return value;
  }

  throw new CliError(
    `Invalid end_of_line value for ${JSON.stringify(file)}: ${JSON.stringify(value)}`,
  );
};

const parseCharset = (value, file) => {
  if (value === undefined || value === 'unset') {
    return undefined;
  }

  if (
    value === 'latin1'
    || value === 'utf-8'
    || value === 'utf-8-bom'
    || value === 'utf-16be'
    || value === 'utf-16le'
  ) {
    return value;
  }

  throw new CliError(
    `Unsupported charset for ${JSON.stringify(file)}: ${JSON.stringify(value)}`,
  );
};

const startsWith = (value, prefix) => value.length >= prefix.length && value.subarray(0, prefix.length).equals(prefix);

const detectBom = (value) => {
  if (startsWith(value, UTF8_BOM)) {
    return {
      bom: UTF8_BOM,
      charset: 'utf-8',
    };
  }

  if (startsWith(value, UTF16_LE_BOM)) {
    return {
      bom: UTF16_LE_BOM,
      charset: 'utf-16le',
    };
  }

  if (startsWith(value, UTF16_BE_BOM)) {
    return {
      bom: UTF16_BE_BOM,
      charset: 'utf-16be',
    };
  }

  return undefined;
};

const matchesBom = (configuredCharset, bomCharset) => configuredCharset === bomCharset
  || (configuredCharset === 'utf-8-bom' && bomCharset === 'utf-8');

const extractBom = (value, configuredCharset, file) => {
  const detectedBom = detectBom(value);

  if (detectedBom === undefined) {
    return {
      bom: Buffer.alloc(0),
      charset: configuredCharset,
      content: value,
    };
  }

  if (configuredCharset !== undefined && !matchesBom(configuredCharset, detectedBom.charset)) {
    throw new CliError(
      `${JSON.stringify(file)} has a ${detectedBom.charset} BOM that conflicts with charset ${configuredCharset}`,
    );
  }

  return {
    bom: detectedBom.bom,
    charset: configuredCharset ?? detectedBom.charset,
    content: value.subarray(detectedBom.bom.length),
  };
};

const decodeText = (value, configuredCharset, file) => {
  const decoded = extractBom(value, configuredCharset, file);

  let { bom } = decoded;

  const { charset, content } = decoded;

  if (configuredCharset === 'utf-8-bom') {
    bom = UTF8_BOM;
  } else if (configuredCharset === 'utf-8') {
    bom = Buffer.alloc(0);
  }

  if (charset === 'latin1') {
    return {
      bom,
      charset,
      text: content.toString('latin1'),
    };
  }

  if (charset === 'utf-16le' || charset === 'utf-16be') {
    if (content.length % 2 !== 0) {
      throw new CliError(`${JSON.stringify(file)} has an invalid ${charset} byte length`);
    }

    try {
      return {
        bom,
        charset,
        text: new TextDecoder(charset, { fatal: true }).decode(content),
      };
    } catch {
      throw new CliError(`${JSON.stringify(file)} is not valid ${charset}`);
    }
  }

  if (charset === 'utf-8' || charset === 'utf-8-bom') {
    try {
      return {
        bom,
        charset,
        text: new TextDecoder('utf-8', { fatal: true }).decode(content),
      };
    } catch {
      throw new CliError(`${JSON.stringify(file)} is not valid UTF-8`);
    }
  }

  try {
    return {
      bom,
      charset: 'utf-8',
      text: new TextDecoder('utf-8', { fatal: true }).decode(content),
    };
  } catch {
    return {
      bom,
      charset: 'latin1',
      text: content.toString('latin1'),
    };
  }
};

const encodeText = ({ bom, charset, text }) => {
  let content;

  if (charset === 'latin1') {
    content = Buffer.from(text, 'latin1');
  } else if (charset === 'utf-16le') {
    content = Buffer.from(text, 'utf16le');
  } else if (charset === 'utf-16be') {
    content = Buffer.from(text, 'utf16le');

    for (let index = 0; index < content.length; index += 2) {
      const byte = content[index];

      content[index] = content[index + 1];
      content[index + 1] = byte;
    }
  } else {
    content = Buffer.from(text, 'utf8');
  }

  return bom.length === 0 ? content : Buffer.concat([bom, content]);
};

const splitLines = (text) => {
  const lines = [];
  const lineBreak = /\r\n|\r|\n/gu;

  let start = 0;
  let match;

  while ((match = lineBreak.exec(text)) !== null) {
    lines.push({
      content: text.slice(start, match.index),
      endOfLine: match[0],
    });
    start = match.index + match[0].length;
  }

  lines.push({
    content: text.slice(start),
    endOfLine: '',
  });

  return lines;
};

const targetLineBreak = (endOfLine) => {
  if (endOfLine === 'crlf') {
    return '\r\n';
  }

  if (endOfLine === 'cr') {
    return '\r';
  }

  return '\n';
};

const trailingWhitespaceStart = (content) => {
  let end = content.length;

  while (end > 0) {
    const character = content.codePointAt(end - 1);

    if (character !== 0x09 && character !== 0x20) {
      break;
    }

    end -= 1;
  }

  return end;
};

const trimLineWhitespace = (lines) => {
  for (const line of lines) {
    line.content = line.content.slice(0, trailingWhitespaceStart(line.content));
  }
};

const normalizeLineBreaks = (lines, lineBreak) => {
  for (const line of lines) {
    if (line.endOfLine !== '') {
      line.endOfLine = lineBreak;
    }
  }
};

const findFinalContent = (lines) => {
  let finalContent = lines.length - 1;

  while (finalContent >= 0 && lines[finalContent].content === '') {
    finalContent -= 1;
  }

  return finalContent;
};

const diagnoseLines = (lines, settings, configuredLineBreak) => {
  const diagnostics = [];
  const expectedLineBreak = settings.endOfLine?.toUpperCase();

  for (const [index, line] of lines.entries()) {
    if (
      settings.trimTrailingWhitespace === true
      && trailingWhitespaceStart(line.content) !== line.content.length
    ) {
      diagnostics.push({
        location: index + 1,
        message: 'trailing whitespace',
      });
    }

    if (
      configuredLineBreak !== undefined
      && line.endOfLine !== ''
      && line.endOfLine !== configuredLineBreak
    ) {
      diagnostics.push({
        location: index + 1,
        message: `expected ${expectedLineBreak} line ending`,
      });
    }
  }

  return diagnostics;
};

const diagnoseFinalNewline = (lines, insertFinalNewline) => {
  if (insertFinalNewline === undefined) {
    return undefined;
  }

  const finalContent = findFinalContent(lines);

  if (finalContent === -1) {
    const hasLineBreak = lines.some((line) => line.endOfLine !== '');

    return hasLineBreak
      ? {
          location: 'EOF',
          message: insertFinalNewline ? 'extra final newlines' : 'unexpected final newline',
        }
      : undefined;
  }

  const hasFinalNewline = lines[finalContent].endOfLine !== '';

  if (!insertFinalNewline) {
    return hasFinalNewline
      ? {
          location: 'EOF',
          message: 'unexpected final newline',
        }
      : undefined;
  }

  if (!hasFinalNewline) {
    return {
      location: 'EOF',
      message: 'missing final newline',
    };
  }

  return lines.length > finalContent + 2
    ? {
        location: 'EOF',
        message: 'extra final newlines',
      }
    : undefined;
};

const collapseFinalLines = (
  lines,
  configuredLineBreak,
  insertFinalNewline,
) => {
  const finalContent = findFinalContent(lines);

  if (finalContent === -1) {
    return false;
  }

  lines.length = finalContent + 1;

  lines[finalContent].endOfLine = insertFinalNewline
    ? (configuredLineBreak ?? (lines[finalContent].endOfLine || '\n'))
    : '';

  return true;
};

const normalizeText = (text, settings) => {
  const lines = splitLines(text);

  const configuredLineBreak
    = settings.endOfLine === undefined ? undefined : targetLineBreak(settings.endOfLine);

  const diagnostics = diagnoseLines(lines, settings, configuredLineBreak);

  if (settings.trimTrailingWhitespace === true) {
    trimLineWhitespace(lines);
  }

  const finalNewlineDiagnostic = diagnoseFinalNewline(
    lines,
    settings.insertFinalNewline,
  );

  if (finalNewlineDiagnostic !== undefined) {
    diagnostics.push(finalNewlineDiagnostic);
  }

  if (configuredLineBreak !== undefined) {
    normalizeLineBreaks(lines, configuredLineBreak);
  }

  if (settings.insertFinalNewline !== undefined) {
    if (
      !collapseFinalLines(
        lines,
        configuredLineBreak,
        settings.insertFinalNewline,
      )
    ) {
      return {
        diagnostics,
        text: '',
      };
    }
  }

  return {
    diagnostics,
    text: lines.map((line) => `${line.content}${line.endOfLine}`).join(''),
  };
};

const sameFile = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const resolveFile = (repository, file) => {
  const absoluteFile = resolve(repository, file);
  const relativeFile = relative(repository, absoluteFile);

  if (
    relativeFile === '..'
    || relativeFile.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(relativeFile)
  ) {
    throw new CliError(`Git returned an unsafe file name: ${JSON.stringify(file)}`);
  }

  return absoluteFile;
};

const inspectFile = async (repository, entry, configurationCache) => {
  const absoluteFile = resolveFile(repository, entry.file);

  let beforeRead;

  try {
    beforeRead = await lstat(absoluteFile, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { skipped: 'missing' };
    }

    throw error;
  }

  if (!beforeRead.isFile()) {
    return { skipped: 'non-regular' };
  }

  if ((beforeRead.mode & 0o7000n) !== 0n) {
    throw new CliError(
      `${JSON.stringify(entry.file)} has unsupported special permission bits`,
    );
  }

  const [input, configuration] = await Promise.all([
    readFile(absoluteFile),
    parse(absoluteFile, {
      cache: configurationCache,
      unset: true,
    }),
  ]);

  const afterRead = await lstat(absoluteFile, { bigint: true });

  if (!sameFile(beforeRead, afterRead)) {
    throw new CliError(`${JSON.stringify(entry.file)} changed while it was being read`);
  }

  const editorConfigEndOfLine = parseEndOfLine(
    configuration.end_of_line,
    entry.file,
  );

  if (
    editorConfigEndOfLine !== undefined
    && entry.attributeEndOfLine !== undefined
    && editorConfigEndOfLine !== entry.attributeEndOfLine
  ) {
    throw new CliError(
      `Conflicting end-of-line settings for ${JSON.stringify(entry.file)}: EditorConfig requires ${editorConfigEndOfLine}, but Git attributes require ${entry.attributeEndOfLine}`,
    );
  }

  const decoded = decodeText(
    input,
    parseCharset(configuration.charset, entry.file),
    entry.file,
  );

  const normalized = normalizeText(decoded.text, {
    endOfLine: editorConfigEndOfLine ?? entry.attributeEndOfLine,
    insertFinalNewline: parseBoolean(
      configuration.insert_final_newline,
      'insert_final_newline',
      entry.file,
    ),
    trimTrailingWhitespace: parseBoolean(
      configuration.trim_trailing_whitespace,
      'trim_trailing_whitespace',
      entry.file,
    ),
  });

  const output = encodeText({
    ...decoded,
    text: normalized.text,
  });

  return {
    absoluteFile,
    changed: !input.equals(output),
    diagnostics: normalized.diagnostics,
    file: entry.file,
    mode: Number(afterRead.mode & 0o777n),
    output,
    status: afterRead,
  };
};

const replaceFile = async (plan) => {
  const current = await lstat(plan.absoluteFile, { bigint: true });

  if (!sameFile(plan.status, current)) {
    throw new CliError(`${JSON.stringify(plan.file)} changed before it could be written`);
  }

  const temporaryFile = join(
    dirname(plan.absoluteFile),
    `.trimmer-${process.pid}-${randomUUID()}`,
  );

  let temporaryHandle;

  try {
    temporaryHandle = await open(temporaryFile, 'wx', plan.mode);
    await temporaryHandle.writeFile(plan.output);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await chmod(temporaryFile, plan.mode);
    await rename(temporaryFile, plan.absoluteFile);
  } catch (error) {
    if (temporaryHandle !== undefined) {
      await temporaryHandle.close().catch(() => undefined);
    }

    await unlink(temporaryFile).catch(() => undefined);

    throw error;
  }
};

const printSummary = (operation, plans, changedPlans, skipped) => {
  const changedFileLabel = changedPlans.length === 1 ? 'file requires' : 'files require';

  process.stdout.write(
    `${operation} ${plans.length} text files; ${changedPlans.length} ${changedFileLabel} changes; skipped ${skipped.binary} binary, ${skipped['non-regular']} non-regular, ${skipped.missing} missing\n`,
  );
};

const checkPlans = (plans, changedPlans, skipped) => {
  for (const plan of changedPlans) {
    const diagnostics = plan.diagnostics.length === 0
      ? [
          {
            location: 'EOF',
            message: 'normalization required',
          },
        ]
      : plan.diagnostics;

    for (const diagnostic of diagnostics) {
      process.stdout.write(
        `${JSON.stringify(plan.file)}:${diagnostic.location}: ${diagnostic.message}\n`,
      );
    }
  }

  printSummary('checked', plans, changedPlans, skipped);

  return changedPlans.length;
};

const fixPlans = async (plans, changedPlans, skipped) => {
  for (const plan of changedPlans) {
    await replaceFile(plan);
    process.stdout.write(`changed ${JSON.stringify(plan.file)}\n`);
  }

  process.stdout.write(
    `processed ${plans.length} text files; changed ${changedPlans.length}; skipped ${skipped.binary} binary, ${skipped['non-regular']} non-regular, ${skipped.missing} missing\n`,
  );
};

const trimDirectory = async (mode, directory) => {
  const repository = await findRepository(directory);
  const entries = await listGitEntries(repository);
  const configurationCache = new Map();
  const plans = [];

  const skipped = {
    'binary': 0,
    'missing': 0,
    'non-regular': 0,
  };

  for (const entry of entries) {
    if (entry.binary) {
      skipped.binary += 1;

      continue;
    }

    const plan = await inspectFile(
      repository.repository,
      entry,
      configurationCache,
    );

    if (plan.skipped !== undefined) {
      skipped[plan.skipped] += 1;

      continue;
    }

    plans.push(plan);
  }

  const changedPlans = plans.filter((plan) => plan.changed);

  if (mode === 'check') {
    return checkPlans(plans, changedPlans, skipped);
  }

  await fixPlans(plans, changedPlans, skipped);

  return 0;
};

const main = async () => {
  const arguments_ = process.argv.slice(2);

  if (
    arguments_.length !== 2
    || (arguments_[0] !== 'fix' && arguments_[0] !== 'check')
  ) {
    throw new CliError(USAGE, 2);
  }

  const changes = await trimDirectory(arguments_[0], arguments_[1]);

  if (arguments_[0] === 'check' && changes > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
