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

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const executeFile = promisify(execFile);
export const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

export async function temporaryDirectory(context, prefix = 'tooling-trimmer-') {
    const directory = await mkdtemp(join(tmpdir(), prefix));

    context.after(async () => await rm(directory, { force: true, recursive: true }));

    return directory;
}

export async function createRepository(context) {
    const repository = await temporaryDirectory(context);

    await executeFile('git', ['init', '--quiet', repository]);

    return repository;
}

export async function put(repository, file, content) {
    const destination = join(repository, file);

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);

    return destination;
}

export async function add(repository, files) {
    await executeFile('git', ['-C', repository, 'add', '--', ...files]);
}

export function output() {
    const chunks = [];

    return {
        stream: {
            write: (chunk) => chunks.push(chunk),
        },
        text: () => chunks.join(''),
    };
}

export async function runCli(arguments_) {
    try {
        const result = await executeFile(process.execPath, [cli, ...arguments_], { encoding: 'utf8' });

        return { exitCode: 0, ...result };
    } catch (error) {
        return {
            exitCode: error.code,
            stderr: error.stderr,
            stdout: error.stdout,
        };
    }
}
