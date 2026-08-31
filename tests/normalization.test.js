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

import { normalizeText } from '../src/normalization.js';

test('normalizes configured line endings and trailing whitespace', () => {
    for (const [endOfLine, expected] of [
        ['lf', 'first\nsecond\n'],
        ['crlf', 'first\r\nsecond\r\n'],
        ['cr', 'first\rsecond\r'],
    ]) {
        const result = normalizeText('first \r\nsecond\t\r\n', {
            endOfLine,
            insertFinalNewline: true,
            trimTrailingWhitespace: true,
        });

        assert.equal(result.text, expected);
        const lineEndingDiagnostics = endOfLine === 'crlf' ? [] : [`expected ${endOfLine.toUpperCase()} line ending`];

        assert.deepEqual(
            result.diagnostics.map(({ message }) => message),
            ['trailing whitespace', ...lineEndingDiagnostics, 'trailing whitespace', ...lineEndingDiagnostics],
        );
    }
});

test('trims Unicode whitespace required by EditorConfig', () => {
    const result = normalizeText('no-break\u00a0\nem\u2003\nideographic\u3000\n', {
        trimTrailingWhitespace: true,
    });

    assert.equal(result.text, 'no-break\nem\nideographic\n');
    assert.deepEqual(
        result.diagnostics.map(({ message }) => message),
        ['trailing whitespace', 'trailing whitespace', 'trailing whitespace'],
    );
});

test('preserves unconfigured mixed line endings and optional whitespace', () => {
    const input = 'first  \r\nsecond\t\nthird\r';
    const untouched = normalizeText(input, {});
    const trimmed = normalizeText(input, { trimTrailingWhitespace: true });

    assert.equal(untouched.text, input);
    assert.deepEqual(untouched.diagnostics, []);
    assert.equal(trimmed.text, 'first\r\nsecond\nthird\r');
    assert.equal(trimmed.diagnostics.length, 2);
});

test('inserts one final newline using configured, existing, or LF fallback style', () => {
    assert.equal(normalizeText('value', { endOfLine: 'cr', insertFinalNewline: true }).text, 'value\r');
    assert.equal(normalizeText('first\r\nsecond', { insertFinalNewline: true }).text, 'first\r\nsecond\r\n');
    assert.equal(normalizeText('first\nsecond', { insertFinalNewline: true }).text, 'first\nsecond\n');
    assert.equal(normalizeText('value', { insertFinalNewline: true }).text, 'value\n');
});

test('collapses, removes, or preserves terminal line breaks as configured', () => {
    const collapsed = normalizeText('value\n\n\n', { insertFinalNewline: true });
    const removed = normalizeText('value\r\n\r\n', { insertFinalNewline: false });
    const preserved = normalizeText('value\n\n', {});
    const alreadyAbsent = normalizeText('value', { insertFinalNewline: false });

    assert.equal(collapsed.text, 'value\n');
    assert.deepEqual(collapsed.diagnostics, [{ location: 'EOF', message: 'extra final newlines' }]);
    assert.equal(removed.text, 'value');
    assert.deepEqual(removed.diagnostics, [{ location: 'EOF', message: 'unexpected final newline' }]);
    assert.equal(preserved.text, 'value\n\n');
    assert.equal(alreadyAbsent.text, 'value');
    assert.deepEqual(alreadyAbsent.diagnostics, []);
});

test('normalizes empty, newline-only, and whitespace-only inputs consistently', () => {
    assert.deepEqual(normalizeText('', { insertFinalNewline: true }), { diagnostics: [], text: '' });
    assert.deepEqual(normalizeText('\n\n', { insertFinalNewline: true }), {
        diagnostics: [{ location: 'EOF', message: 'extra final newlines' }],
        text: '',
    });
    assert.deepEqual(normalizeText('\n', { insertFinalNewline: false }), {
        diagnostics: [{ location: 'EOF', message: 'unexpected final newline' }],
        text: '',
    });
    assert.equal(normalizeText('  \n', { insertFinalNewline: true, trimTrailingWhitespace: true }).text, '');
});

test('is idempotent after applying every supported normalization', () => {
    const settings = {
        endOfLine: 'crlf',
        insertFinalNewline: true,
        trimTrailingWhitespace: true,
    };
    const first = normalizeText('first  \nsecond\t\n\n', settings);
    const second = normalizeText(first.text, settings);

    assert.equal(first.text, 'first\r\nsecond\r\n');
    assert.deepEqual(second, { diagnostics: [], text: first.text });
});
