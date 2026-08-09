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
import { TextDecoder } from 'node:util';

import { TrimmerError } from './errors.js';

const byteOrderMarks = Object.freeze([
  { bytes: Buffer.from([0xef, 0xbb, 0xbf]), charset: 'utf-8' },
  { bytes: Buffer.from([0xff, 0xfe]), charset: 'utf-16le' },
  { bytes: Buffer.from([0xfe, 0xff]), charset: 'utf-16be' },
]);
const emptyBuffer = Buffer.alloc(0);
const utf8ByteOrderMark = byteOrderMarks[0].bytes;

function startsWith(value, prefix) {
  return value.length >= prefix.length && value.subarray(0, prefix.length).equals(prefix);
}

function detectByteOrderMark(value) {
  return byteOrderMarks.find(({ bytes }) => startsWith(value, bytes));
}

function compatibleByteOrderMark(configuredCharset, byteOrderMarkCharset) {
  return configuredCharset === byteOrderMarkCharset || (configuredCharset === 'utf-8-bom' && byteOrderMarkCharset === 'utf-8');
}

function outputByteOrderMark(configuredCharset, detected) {
  if (configuredCharset === 'utf-8-bom') {
    return utf8ByteOrderMark;
  }

  if (configuredCharset === 'utf-8') {
    return emptyBuffer;
  }

  return detected?.bytes ?? emptyBuffer;
}

function byteOrderMarkDiagnostics(configuredCharset, detected) {
  if (configuredCharset === 'utf-8-bom' && detected === undefined) {
    return [{ location: 'BOM', message: 'missing UTF-8 BOM' }];
  }

  if (configuredCharset === 'utf-8' && detected?.charset === 'utf-8') {
    return [{ location: 'BOM', message: 'unexpected UTF-8 BOM' }];
  }

  return [];
}

function decode(value, charset, file) {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(value);
  } catch (error) {
    const description = charset === 'utf-8' ? 'UTF-8' : charset;

    throw new TrimmerError(`${JSON.stringify(file)} is not valid ${description}`, 1, { cause: error });
  }
}

function swapByteOrder(value) {
  const output = Buffer.from(value);

  for (let index = 0; index < output.length; index += 2) {
    [output[index], output[index + 1]] = [output[index + 1], output[index]];
  }

  return output;
}

export function decodeText(value, configuredCharset, file) {
  const detected = detectByteOrderMark(value);

  if (detected !== undefined && configuredCharset !== undefined && !compatibleByteOrderMark(configuredCharset, detected.charset)) {
    throw new TrimmerError(`${JSON.stringify(file)} has a ${detected.charset} BOM that conflicts with charset ${configuredCharset}`);
  }

  const content = detected === undefined ? value : value.subarray(detected.bytes.length);
  const charset = configuredCharset ?? detected?.charset;
  const byteOrderMark = outputByteOrderMark(configuredCharset, detected);
  const diagnostics = byteOrderMarkDiagnostics(configuredCharset, detected);

  if (charset === 'latin1') {
    return { byteOrderMark, charset, diagnostics, text: content.toString('latin1') };
  }

  if (charset === 'utf-16le' || charset === 'utf-16be') {
    if (content.length % 2 !== 0) {
      throw new TrimmerError(`${JSON.stringify(file)} has an invalid ${charset} byte length`);
    }

    return { byteOrderMark, charset, diagnostics, text: decode(content, charset, file) };
  }

  if (charset === 'utf-8' || charset === 'utf-8-bom') {
    return { byteOrderMark, charset, diagnostics, text: decode(content, 'utf-8', file) };
  }

  if (content.includes(0)) {
    throw new TrimmerError(`${JSON.stringify(file)} contains NUL bytes without a detectable or configured charset`);
  }

  return { byteOrderMark, charset: 'utf-8', diagnostics, text: decode(content, 'utf-8', file) };
}

export function encodeText({ byteOrderMark, charset, text }) {
  let content;

  if (charset === 'latin1') {
    content = Buffer.from(text, 'latin1');
  } else if (charset === 'utf-16le') {
    content = Buffer.from(text, 'utf16le');
  } else if (charset === 'utf-16be') {
    content = swapByteOrder(Buffer.from(text, 'utf16le'));
  } else {
    content = Buffer.from(text, 'utf8');
  }

  return byteOrderMark.length === 0 ? content : Buffer.concat([byteOrderMark, content]);
}
