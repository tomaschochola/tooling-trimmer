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

import { TrimmerError } from './errors.js';
import { trimDirectory } from './trimmer.js';

export const help = `Usage:
  tooling-trimmer fix DIRECTORY
  tooling-trimmer check DIRECTORY

Normalize tracked and untracked, non-ignored text files in a Git worktree using EditorConfig and Git attributes.
Files without an explicit or detectable charset must be valid UTF-8.

Commands:
  fix    Write required normalizations
  check  Report required normalizations without writing

Options:
  -h, --help  Show this help

Exit status:
  0  Successful fix or clean check
  1  Required changes or operational failure
  2  Invalid command line
`;

function isHelpRequest(arguments_) {
    if (arguments_.length === 1) {
        return arguments_[0] === '--help' || arguments_[0] === '-h';
    }

    return arguments_.length === 2 && (arguments_[0] === 'fix' || arguments_[0] === 'check') && (arguments_[1] === '--help' || arguments_[1] === '-h');
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

export async function runCommandLine(arguments_, standardOutput, standardError, operation = trimDirectory) {
    try {
        if (isHelpRequest(arguments_)) {
            standardOutput.write(help);

            return 0;
        }

        if (arguments_.length !== 2 || (arguments_[0] !== 'fix' && arguments_[0] !== 'check')) {
            throw new TrimmerError('Expected fix or check followed by exactly one directory.', 2);
        }

        if (arguments_[1] === '') {
            throw new TrimmerError('DIRECTORY must not be empty.', 2);
        }

        const changes = await operation(arguments_[0], arguments_[1], standardOutput);

        return arguments_[0] === 'check' && changes > 0 ? 1 : 0;
    } catch (error) {
        standardError.write(`tooling-trimmer: ${errorMessage(error)}\n`);

        if (error instanceof TrimmerError && error.exitCode === 2) {
            standardError.write(help);
        }

        return error instanceof TrimmerError ? error.exitCode : 1;
    }
}
