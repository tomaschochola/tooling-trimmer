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

import { decodeText, encodeText } from '../src/encoding.js';

const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
const utf16LeBom = Buffer.from([0xff, 0xfe]);
const utf16BeBom = Buffer.from([0xfe, 0xff]);

test('round-trips every supported configured encoding and BOM policy', () => {
  const cases = [
    { charset: 'latin1', diagnostics: [], input: Buffer.from([0x63, 0x61, 0x66, 0xe9]), output: Buffer.from([0x63, 0x61, 0x66, 0xe9]), text: 'café' },
    {
      charset: 'utf-8',
      diagnostics: [{ location: 'BOM', message: 'unexpected UTF-8 BOM' }],
      input: Buffer.concat([utf8Bom, Buffer.from('žluťoučký')]),
      output: Buffer.from('žluťoučký'),
      text: 'žluťoučký',
    },
    {
      charset: 'utf-8-bom',
      diagnostics: [{ location: 'BOM', message: 'missing UTF-8 BOM' }],
      input: Buffer.from('value'),
      output: Buffer.concat([utf8Bom, Buffer.from('value')]),
      text: 'value',
    },
    { charset: 'utf-16le', diagnostics: [], input: Buffer.concat([utf16LeBom, Buffer.from('value', 'utf16le')]), output: Buffer.concat([utf16LeBom, Buffer.from('value', 'utf16le')]), text: 'value' },
    {
      charset: 'utf-16be',
      diagnostics: [],
      input: Buffer.concat([utf16BeBom, Buffer.from('00760061006c00750065', 'hex')]),
      output: Buffer.concat([utf16BeBom, Buffer.from('00760061006c00750065', 'hex')]),
      text: 'value',
    },
  ];

  for (const { charset, diagnostics, input, output, text } of cases) {
    const decoded = decodeText(input, charset, 'file');

    assert.equal(decoded.text, text);
    assert.deepEqual(decoded.diagnostics, diagnostics);
    assert.deepEqual(encodeText(decoded), output);
  }
});

test('detects BOM encodings and accepts unconfigured UTF-8', () => {
  const detectedUtf8 = decodeText(Buffer.concat([utf8Bom, Buffer.from('value')]), undefined, 'file');
  const detectedUtf16Le = decodeText(Buffer.concat([utf16LeBom, Buffer.from('value', 'utf16le')]), undefined, 'file');
  const detectedUtf16Be = decodeText(Buffer.from('feff00760061006c00750065', 'hex'), undefined, 'file');
  const plainUtf8 = decodeText(Buffer.from('value'), undefined, 'file');
  const requiredUtf8Bom = decodeText(Buffer.concat([utf8Bom, Buffer.from('value')]), 'utf-8-bom', 'file');
  const configuredUtf8Nul = decodeText(Buffer.from([0x00]), 'utf-8', 'file');
  const configuredUtf16Le = decodeText(Buffer.concat([utf16LeBom, Buffer.from('value', 'utf16le')]), 'utf-16le', 'file');

  assert.equal(detectedUtf8.charset, 'utf-8');
  assert.equal(detectedUtf16Le.charset, 'utf-16le');
  assert.equal(detectedUtf16Be.charset, 'utf-16be');
  assert.equal(plainUtf8.charset, 'utf-8');
  assert.deepEqual(detectedUtf8.diagnostics, []);
  assert.deepEqual(requiredUtf8Bom.byteOrderMark, utf8Bom);
  assert.deepEqual(requiredUtf8Bom.diagnostics, []);
  assert.equal(configuredUtf8Nul.text, '\0');
  assert.deepEqual(configuredUtf16Le.byteOrderMark, utf16LeBom);
});

test('rejects conflicting BOMs, ambiguous bytes, and malformed text', () => {
  assert.throws(() => decodeText(Buffer.concat([utf16LeBom, Buffer.from('x', 'utf16le')]), 'utf-8', 'file'), /BOM.*conflicts/u);
  assert.throws(() => decodeText(Buffer.from([0x76, 0x00, 0x61, 0x00]), undefined, 'file'), /NUL bytes.*charset/u);
  assert.throws(() => decodeText(Buffer.from([0xff]), undefined, 'file'), /not valid UTF-8/u);
  assert.throws(() => decodeText(Buffer.from([0xff]), 'utf-8', 'file'), /not valid UTF-8/u);
  assert.throws(() => decodeText(Buffer.from([0x00]), 'utf-16le', 'file'), /invalid utf-16le byte length/u);
  assert.throws(() => decodeText(Buffer.from([0x00, 0xd8]), 'utf-16le', 'file'), /not valid utf-16le/u);
  assert.throws(() => decodeText(Buffer.from([0xd8, 0x00]), 'utf-16be', 'file'), /not valid utf-16be/u);
});
