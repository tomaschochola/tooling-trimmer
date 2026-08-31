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

import { parse } from 'editorconfig';

import { TrimmerError } from './errors.js';

function optionalValue(value) {
    return value === undefined || value === 'unset' ? undefined : value;
}

export function booleanSetting(value, property, file) {
    const configured = optionalValue(value);

    if (configured === undefined) {
        return undefined;
    }

    if (configured === true || configured === 'true') {
        return true;
    }

    if (configured === false || configured === 'false') {
        return false;
    }

    throw new TrimmerError(`Invalid ${property} value for ${JSON.stringify(file)}: ${JSON.stringify(value)}`);
}

export function endOfLineSetting(value, file) {
    const configured = optionalValue(value);

    if (configured === undefined) {
        return undefined;
    }

    if (configured === 'lf' || configured === 'crlf' || configured === 'cr') {
        return configured;
    }

    throw new TrimmerError(`Invalid end_of_line value for ${JSON.stringify(file)}: ${JSON.stringify(value)}`);
}

export function charsetSetting(value, file) {
    const configured = optionalValue(value);

    if (configured === undefined) {
        return undefined;
    }

    if (configured === 'latin1' || configured === 'utf-8' || configured === 'utf-8-bom' || configured === 'utf-16be' || configured === 'utf-16le') {
        return configured;
    }

    throw new TrimmerError(`Unsupported charset for ${JSON.stringify(file)}: ${JSON.stringify(value)}`);
}

export function resolveSettings(configuration, gitEndOfLine, file) {
    const editorConfigEndOfLine = endOfLineSetting(configuration.end_of_line, file);

    if (editorConfigEndOfLine !== undefined && gitEndOfLine !== undefined && editorConfigEndOfLine !== gitEndOfLine) {
        throw new TrimmerError(`Conflicting end-of-line settings for ${JSON.stringify(file)}: EditorConfig requires ${editorConfigEndOfLine}, but Git attributes require ${gitEndOfLine}`);
    }

    return {
        charset: charsetSetting(configuration.charset, file),
        endOfLine: editorConfigEndOfLine ?? gitEndOfLine,
        insertFinalNewline: booleanSetting(configuration.insert_final_newline, 'insert_final_newline', file),
        trimTrailingWhitespace: booleanSetting(configuration.trim_trailing_whitespace, 'trim_trailing_whitespace', file),
    };
}

export async function settingsForFile(absoluteFile, gitEndOfLine, file, cache) {
    const configuration = await parse(absoluteFile, {
        cache,
        unset: true,
    });

    return resolveSettings(configuration, gitEndOfLine, file);
}
