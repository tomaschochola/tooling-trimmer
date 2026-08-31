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

import { inspectFile, replaceFile } from './files.js';
import { findRepository, listGitEntries } from './git.js';

function formatTextFileCount(count) {
    return `${String(count)} ${count === 1 ? 'text file' : 'text files'}`;
}

function writeSummary(standardOutput, operation, plans, changedPlans, skipped) {
    const changedFileLabel = changedPlans.length === 1 ? 'file requires' : 'files require';

    standardOutput.write(
        `${operation} ${formatTextFileCount(plans.length)}; ${String(changedPlans.length)} ${changedFileLabel} changes; skipped ${String(skipped.binary)} binary, ${String(skipped['non-regular'])} non-regular, ${String(skipped.missing)} missing\n`,
    );
}

function checkPlans(plans, changedPlans, skipped, standardOutput) {
    for (const plan of changedPlans) {
        const diagnostics =
            plan.diagnostics.length === 0
                ? [
                      {
                          location: 'EOF',
                          message: 'normalization required',
                      },
                  ]
                : plan.diagnostics;

        for (const diagnostic of diagnostics) {
            standardOutput.write(`${JSON.stringify(plan.file)}:${String(diagnostic.location)}: ${diagnostic.message}\n`);
        }
    }

    writeSummary(standardOutput, 'checked', plans, changedPlans, skipped);

    return changedPlans.length;
}

async function fixPlans(plans, changedPlans, skipped, standardOutput) {
    for (const plan of changedPlans) {
        await replaceFile(plan);
        standardOutput.write(`changed ${JSON.stringify(plan.file)}\n`);
    }

    const changedFileLabel = changedPlans.length === 1 ? 'file' : 'files';

    standardOutput.write(
        `processed ${formatTextFileCount(plans.length)}; changed ${String(changedPlans.length)} ${changedFileLabel}; skipped ${String(skipped.binary)} binary, ${String(skipped['non-regular'])} non-regular, ${String(skipped.missing)} missing\n`,
    );
}

export async function trimDirectory(mode, directory, standardOutput) {
    const repository = await findRepository(directory);
    const entries = await listGitEntries(repository);
    const configurationCache = new Map();
    const plans = [];
    const skipped = {
        binary: 0,
        missing: 0,
        'non-regular': 0,
    };

    for (const entry of entries) {
        if (entry.binary) {
            skipped.binary += 1;

            continue;
        }

        const plan = await inspectFile(repository.repository, entry, configurationCache);

        if (plan.skipped !== undefined) {
            skipped[plan.skipped] += 1;

            continue;
        }

        plans.push(plan);
    }

    const changedPlans = plans.filter(({ changed }) => changed);

    if (mode === 'check') {
        return checkPlans(plans, changedPlans, skipped, standardOutput);
    }

    await fixPlans(plans, changedPlans, skipped, standardOutput);

    return 0;
}
