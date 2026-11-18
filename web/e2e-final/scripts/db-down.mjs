#!/usr/bin/env node
// Removes ONLY this round's container and volume (exact names). Never touches others.
// Usage: node web/e2e-final/scripts/db-down.mjs [--keep-volume]
import { spawnSync } from 'node:child_process';
import { CONTAINER, VOLUME } from './env-lib.mjs';

const step = (args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  console.log(`docker ${args.join(' ')} -> ${result.status === 0 ? 'ok' : `exit ${result.status} ${result.stderr.trim()}`}`);
};
step(['stop', CONTAINER]);
step(['rm', CONTAINER]);
if (!process.argv.includes('--keep-volume')) step(['volume', 'rm', VOLUME]);
