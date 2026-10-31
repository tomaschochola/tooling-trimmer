#!/usr/bin/env node

import process from 'node:process';

import { runCommandLine } from './command-line.js';

process.exitCode = await runCommandLine(process.argv.slice(2), process.stdout, process.stderr);
