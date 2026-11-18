import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-32: the real API entry point (`src/server.ts`) must refuse to start without a valid
 * IDEMPOTENCY_RECORD_RETENTION_DAYS, in development and production alike, before it opens a database
 * connection or listens. The child gets a minimal synthetic environment (throw-away keys, an unreachable
 * database on port 1) and a working directory whose parent has no `.env`, so nothing local is loaded.
 */
const serverEntry = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const throwaway = {
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
  CLABE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CLABE_LOOKUP_KEY: randomBytes(32).toString('base64'),
  REFRESH_TOKEN_PEPPER: randomBytes(32).toString('base64'),
};
const unreachableDatabase = 'postgresql://startup_probe:startup_probe@127.0.0.1:1/startup_probe';
const validProductionSettings = {
  DAILY_TRANSFER_LIMIT_MINOR: '2000000',
  BUSINESS_TIME_ZONE: 'America/Mexico_City',
  OTP_THRESHOLD_MINOR: '500000',
  OTP_EXPIRY_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '5',
};

type Outcome = { code: number | null; stdout: string; stderr: string };

function startServer(extra: Record<string, string | undefined>, port: number): Promise<Outcome> {
  const root = mkdtempSync(join(tmpdir(), 'wallet-startup-'));
  const cwd = join(root, 'api');
  mkdirSync(cwd);
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', API_PORT: String(port), DATABASE_URL: unreachableDatabase, ...throwaway };
  for (const [name, value] of Object.entries(extra)) if (value !== undefined) env[name] = value;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      rmSync(root, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

function assertRefusedOnRetention(outcome: Outcome, rejectedValue?: string) {
  assert.notEqual(outcome.code, 0, 'the API process must exit with a failure code');
  assert.equal(outcome.code === null, false, 'the API process must exit on its own, not hang until killed');
  assert.match(outcome.stderr, /"event":"api\.config_invalid"/);
  assert.match(outcome.stderr, /IDEMPOTENCY_RECORD_RETENTION_DAYS/);
  assert.doesNotMatch(outcome.stdout, /api\.listening/);
  assert.doesNotMatch(outcome.stderr, /ECONNREFUSED/, 'validation must happen before the database connection is attempted');
  for (const secret of [...Object.values(throwaway), unreachableDatabase]) assert.ok(!(outcome.stdout + outcome.stderr).includes(secret), 'no other configured value may be printed');
  if (rejectedValue) assert.ok(!(outcome.stdout + outcome.stderr).includes(rejectedValue), 'the rejected value must not be printed');
}

const cases: Array<[string, Record<string, string | undefined>, string | undefined]> = [
  ['development, variable unset', { APP_ENV: 'development' }, undefined],
  ['no APP_ENV, variable unset', {}, undefined],
  ['development, empty', { APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: '' }, undefined],
  ['development, zero', { APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: '0' }, undefined],
  ['development, negative', { APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: '-45' }, '-45'],
  ['development, non-numeric', { APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: 'treinta' }, 'treinta'],
  ['development, too large', { APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: '987654321987' }, '987654321987'],
  ['production, variable unset', { APP_ENV: 'production', ...validProductionSettings }, undefined],
];

test('F-32: server.ts refuses to start without a valid IDEMPOTENCY_RECORD_RETENTION_DAYS (no listener, no database connection)', async () => {
  const outcomes = await Promise.all(cases.map(([, env], index) => startServer(env, 3971 + index)));
  outcomes.forEach((outcome, index) => {
    const [label, , rejected] = cases[index]!;
    try { assertRefusedOnRetention(outcome, rejected); } catch (error) { throw new Error(`${label}: ${(error as Error).message}`); }
  });
});

test('F-32 control: with a valid value the same entry point passes configuration and only then reaches the database', async () => {
  const outcome = await startServer({ APP_ENV: 'development', IDEMPOTENCY_RECORD_RETENTION_DAYS: '30' }, 3979);
  assert.notEqual(outcome.code, 0);
  assert.doesNotMatch(outcome.stderr, /api\.config_invalid/);
  assert.doesNotMatch(outcome.stderr, /IDEMPOTENCY_RECORD_RETENTION_DAYS/);
  assert.match(outcome.stderr, /ECONNREFUSED/);
});
