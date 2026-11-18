#!/usr/bin/env node
// Fails closed before any suite: forbidden database targets, missing private container,
// or occupied round ports (SPEC §5.10). Prints PASS/FAIL lines without secrets.
// This file is the only place that names the forbidden targets (deny list, ENV-02).
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { API_PORTS, CONTAINER, DB_PORT, WEB_PORTS, parseEnvFile } from './env-lib.mjs';

/** Deny list: shared demo/test container, Lucem host port, the user's review database and the development database. */
export const FORBIDDEN_DB_PATTERNS = [':55432', ':5432/', ':55434', 'wallet_dev'];
/**
 * UX-T0 (docs/web-ux-polish/SPEC.md §5.9): the user's manual-review stack. Only a no-use check: this round never
 * binds, probes, stops or inspects these ports or that container.
 */
export const FORBIDDEN_PORTS = [3200, 5174, 8083, 3411, 5411];
export const FORBIDDEN_CONTAINERS = ['fintech-wallet-postgres-1', 'lucem-retail-db-1', 'fintech-wallet-review-pg'];
/** Text deny list for ENV-02 scans (shared demo/test container, Lucem, demo ports, the user's review stack). */
export const FORBIDDEN_TEXT = /fintech-wallet-postgres-1|lucem-retail-db-1|fintech-wallet-review-pg|55432|55434|\b5432\b|\b3200\b|\b5174\b|\b8083\b|\b3411\b|\b5411\b/;
/** PostgreSQL listens on its default port inside the private container (mapped to 127.0.0.1:55433). */
export const CONTAINER_INTERNAL_PG_PORT = '5432';

export function databaseUrlViolations(env) {
  return Object.entries(env)
    .filter(([key]) => key.includes('DATABASE_URL'))
    .filter(([, value]) => typeof value === 'string' && FORBIDDEN_DB_PATTERNS.some((pattern) => value.includes(pattern)))
    .map(([key]) => key);
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

export async function runPreflight({ allowListening = false, log = console.log } = {}) {
  const failures = [];
  const pass = (message) => log(`preflight PASS ${message}`);
  const fail = (message) => { failures.push(message); log(`preflight FAIL ${message}`); };

  let fileEnv = {};
  try { fileEnv = parseEnvFile(); pass('.env.web-final present'); } catch (error) { fail(String(error.message)); }

  const violations = [...databaseUrlViolations(fileEnv), ...databaseUrlViolations(process.env).map((key) => `process.${key}`)];
  if (violations.length) fail(`forbidden database target in ${violations.join(', ')}`);
  else pass('no *DATABASE_URL* targets a forbidden host port or the development database');
  for (const key of ['TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL', 'DATABASE_URL']) {
    const value = fileEnv[key];
    if (!value) { fail(`${key} missing`); continue; }
    const url = new URL(value);
    if (url.hostname !== '127.0.0.1' || url.port !== String(DB_PORT) || url.pathname !== '/wallet_test') fail(`${key} must target 127.0.0.1:${DB_PORT}/wallet_test`);
    else pass(`${key} -> 127.0.0.1:${DB_PORT}/wallet_test`);
  }

  try {
    const raw = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{.State.Running}} {{json .HostConfig.PortBindings}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const running = raw.slice(0, raw.indexOf(' '));
    const binding = JSON.parse(raw.slice(raw.indexOf(' ') + 1))[`${CONTAINER_INTERNAL_PG_PORT}/tcp`]?.[0];
    if (running !== 'true') fail(`${CONTAINER} is not running`);
    else if (binding?.HostIp !== '127.0.0.1' || binding?.HostPort !== String(DB_PORT)) fail(`${CONTAINER} must bind 127.0.0.1:${DB_PORT}`);
    else pass(`${CONTAINER} running on 127.0.0.1:${DB_PORT}`);
  } catch { fail(`${CONTAINER} does not exist`); }

  const roundPorts = [...API_PORTS, ...WEB_PORTS, DB_PORT];
  const clash = roundPorts.filter((port) => FORBIDDEN_PORTS.includes(port));
  const envText = Object.values(fileEnv).join(' ');
  const named = FORBIDDEN_CONTAINERS.filter((name) => envText.includes(name) || CONTAINER === name);
  if (clash.length || named.length) fail(`round configuration uses a forbidden port/container: ${[...clash, ...named].join(', ')}`);
  else pass(`deny list not used by this round: ports ${FORBIDDEN_PORTS.join(',')}; containers ${FORBIDDEN_CONTAINERS.join(', ')}`);

  const busy = [];
  for (const port of [...API_PORTS, ...WEB_PORTS]) if (await listening(port)) busy.push(port);
  if (busy.length && !allowListening) fail(`ports already in use: ${busy.join(', ')}`);
  else pass(`ports ${API_PORTS.join(',')} / ${WEB_PORTS.join(',')} ${busy.length ? `listening (allowed): ${busy.join(',')}` : 'free'}`);

  log(failures.length ? `preflight RESULT FAIL (${failures.length})` : 'preflight RESULT PASS');
  return failures.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await runPreflight({ allowListening: process.argv.includes('--allow-listening') });
  process.exit(ok ? 0 : 1);
}
