// Shared helpers for the isolated web-fidelity-final environment (SPEC §5.10).
// Never prints secret values. Reads only `.env.web-final` at the worktree root.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const ENV_FILE = resolve(ROOT, '.env.web-final');
export const CONTAINER = 'fintech-wallet-web-pg';
export const VOLUME = 'fintech-wallet-web-pg-data';
export const IMAGE = 'postgres:16.10-alpine';
export const DB_PORT = 55433;
export const API_PORTS = [3301, 3302, 3303, 3304];
export const WEB_PORTS = [5301, 5302, 5303, 5304];
export const VITE_CACHE_DIR = 'node_modules/.vite-web-final';

/** Demo-only process settings per profile. They are test configuration, never approved policy. */
export const PROFILES = {
  P1: { api: 3301, web: 5301, overrides: { DEMO_FIXTURE_ENABLED: 'true' } },
  P2: { api: 3302, web: 5302, overrides: { DEMO_FIXTURE_ENABLED: 'false' } },
  P3: { api: 3303, web: 5303, overrides: { DEMO_FIXTURE_ENABLED: 'true', OTP_EXPIRY_SECONDS: '5', OTP_MAX_ATTEMPTS: '2' } },
  P4: { api: 3304, web: 5304, overrides: { DEMO_FIXTURE_ENABLED: 'true', DAILY_TRANSFER_LIMIT_MINOR: '100000' } },
};

/** Defaults copied from `.env.example` (demo-only examples). */
export const DEMO_DEFAULTS = {
  APP_ENV: 'development',
  BUSINESS_TIME_ZONE: 'America/Mexico_City',
  DEMO_PRIMARY_BALANCE_MINOR: '1000000',
  DEMO_SAVINGS_BALANCE_MINOR: '500000',
  DAILY_TRANSFER_LIMIT_MINOR: '2000000',
  OTP_THRESHOLD_MINOR: '500000',
  OTP_EXPIRY_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '5',
};

/** @returns {Record<string, string>} */
export function parseEnvFile(path = ENV_FILE) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run: node web/e2e-final/scripts/make-env.mjs`);
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function profile(name) {
  const value = PROFILES[name];
  if (!value) throw new Error(`Unknown profile ${name}; expected one of ${Object.keys(PROFILES).join(', ')}`);
  return value;
}

/** Environment for one API process: every *DATABASE_URL* explicitly targets 55433. */
export function apiEnv(name, fileEnv = parseEnvFile()) {
  const p = profile(name);
  return {
    ...DEMO_DEFAULTS,
    ...p.overrides,
    DATABASE_URL: fileEnv.TEST_DATABASE_URL,
    TEST_DATABASE_URL: fileEnv.TEST_DATABASE_URL,
    MIGRATOR_DATABASE_URL: fileEnv.MIGRATOR_DATABASE_URL,
    TEST_MIGRATOR_DATABASE_URL: fileEnv.TEST_MIGRATOR_DATABASE_URL,
    JWT_ACCESS_SECRET: fileEnv.JWT_ACCESS_SECRET,
    REFRESH_TOKEN_PEPPER: fileEnv.REFRESH_TOKEN_PEPPER,
    CLABE_ENCRYPTION_KEY: fileEnv.CLABE_ENCRYPTION_KEY,
    CLABE_LOOKUP_KEY: fileEnv.CLABE_LOOKUP_KEY,
    API_PORT: String(p.api),
    WEB_ORIGIN: `http://127.0.0.1:${p.web}`,
  };
}
