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

import { randomUUID } from 'node:crypto';
import { chmod, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

import { settingsForFile } from './configuration.js';
import { decodeText, encodeText } from './encoding.js';
import { TrimmerError } from './errors.js';
import { normalizeText } from './normalization.js';

export function sameFile(left, right) {
    return (
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.nlink === right.nlink &&
        left.size === right.size &&
        left.mtimeNs === right.mtimeNs &&
        left.ctimeNs === right.ctimeNs
    );
}

export function assertSameFile(expected, actual, message) {
    if (!sameFile(expected, actual)) {
        throw new TrimmerError(message);
    }
}

export function resolveRepositoryFile(repository, file) {
    const absoluteFile = resolve(repository, file);
    const repositoryRelativeFile = relative(repository, absoluteFile);

    if (repositoryRelativeFile === '..' || repositoryRelativeFile.startsWith(`..${sep}`) || isAbsolute(repositoryRelativeFile)) {
        throw new TrimmerError(`Git returned an unsafe file name: ${JSON.stringify(file)}`);
    }

    return absoluteFile;
}

function assertSupportedFile(status, file) {
    if ((status.mode & 0o7000n) !== 0n) {
        throw new TrimmerError(`${JSON.stringify(file)} has unsupported special permission bits`);
    }

    if (status.nlink !== 1n) {
        throw new TrimmerError(`${JSON.stringify(file)} has multiple hard links and cannot be replaced safely`);
    }
}

export async function inspectFile(repository, entry, configurationCache) {
    const absoluteFile = resolveRepositoryFile(repository, entry.file);

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

    assertSupportedFile(beforeRead, entry.file);

    const [input, settings] = await Promise.all([readFile(absoluteFile), settingsForFile(absoluteFile, entry.endOfLine, entry.file, configurationCache)]);
    const afterRead = await lstat(absoluteFile, { bigint: true });

    assertSameFile(beforeRead, afterRead, `${JSON.stringify(entry.file)} changed while it was being read`);

    const decoded = decodeText(input, settings.charset, entry.file);
    const normalized = normalizeText(decoded.text, settings);
    const output = encodeText({
        ...decoded,
        text: normalized.text,
    });

    return {
        absoluteFile,
        changed: !input.equals(output),
        diagnostics: [...decoded.diagnostics, ...normalized.diagnostics],
        file: entry.file,
        mode: Number(afterRead.mode & 0o777n),
        output,
        status: afterRead,
    };
}

export async function replaceFile(plan) {
    const current = await lstat(plan.absoluteFile, { bigint: true });

    assertSameFile(plan.status, current, `${JSON.stringify(plan.file)} changed before it could be written`);

    const temporaryFile = join(dirname(plan.absoluteFile), `.tooling-trimmer-${process.pid}-${randomUUID()}`);

    let temporaryFileCreated = false;
    let temporaryHandle;

    try {
        temporaryHandle = await open(temporaryFile, 'wx', plan.mode);
        temporaryFileCreated = true;
        await temporaryHandle.writeFile(plan.output);
        await temporaryHandle.sync();
        await temporaryHandle.close();
        temporaryHandle = undefined;

        await chmod(temporaryFile, plan.mode);
        await rename(temporaryFile, plan.absoluteFile);
    } catch (error) {
        if (temporaryHandle !== undefined) {
            await Promise.allSettled([temporaryHandle.close()]);
        }

        if (temporaryFileCreated) {
            await Promise.allSettled([unlink(temporaryFile)]);
        }

        throw error;
    }
}
