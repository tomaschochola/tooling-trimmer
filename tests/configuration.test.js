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

import { booleanSetting, charsetSetting, endOfLineSetting, resolveSettings } from '../src/configuration.js';

test('accepts supported booleans, line endings, charsets, and unset values', () => {
  for (const value of [undefined, 'unset']) {
    assert.equal(booleanSetting(value, 'property', 'file'), undefined);
    assert.equal(endOfLineSetting(value, 'file'), undefined);
    assert.equal(charsetSetting(value, 'file'), undefined);
  }

  for (const value of [true, 'true']) {
    assert.equal(booleanSetting(value, 'property', 'file'), true);
  }

  for (const value of [false, 'false']) {
    assert.equal(booleanSetting(value, 'property', 'file'), false);
  }

  for (const value of ['lf', 'crlf', 'cr']) {
    assert.equal(endOfLineSetting(value, 'file'), value);
  }

  for (const value of ['latin1', 'utf-8', 'utf-8-bom', 'utf-16be', 'utf-16le']) {
    assert.equal(charsetSetting(value, 'file'), value);
  }
});

test('rejects unsupported EditorConfig values with file context', () => {
  assert.throws(() => booleanSetting('yes', 'insert_final_newline', 'file.txt'), /Invalid insert_final_newline.*file\.txt/u);
  assert.throws(() => endOfLineSetting('native', 'file.txt'), /Invalid end_of_line.*file\.txt/u);
  assert.throws(() => charsetSetting('utf-32', 'file.txt'), /Unsupported charset.*file\.txt/u);
});

test('combines EditorConfig and Git settings without hiding conflicts', () => {
  assert.deepEqual(
    resolveSettings(
      {
        charset: 'utf-8',
        end_of_line: 'lf',
        insert_final_newline: true,
        trim_trailing_whitespace: 'false',
      },
      'lf',
      'file.txt',
    ),
    {
      charset: 'utf-8',
      endOfLine: 'lf',
      insertFinalNewline: true,
      trimTrailingWhitespace: false,
    },
  );
  assert.equal(resolveSettings({}, 'crlf', 'file.txt').endOfLine, 'crlf');
  assert.throws(() => resolveSettings({ end_of_line: 'lf' }, 'crlf', 'file.txt'), /Conflicting end-of-line settings/u);
});
