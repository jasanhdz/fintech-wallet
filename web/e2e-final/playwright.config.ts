// Playwright configuration for the web-fidelity-final round (SPEC §5.10).
// Run: npx playwright test -c web/e2e-final/playwright.config.ts [--project final|legacy]
// Env: WF_PROFILES=P1[,P2,P3,P4] (servers started), WF_EVIDENCE_SHA (evidence folder), WF_NO_BUILD=1.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { DEMO_DEFAULTS, PROFILES, ROOT, parseEnvFile } from './scripts/env-lib.mjs';

const profileNames = (process.env.WF_PROFILES ?? 'P1').split(',').map((name) => name.trim()).filter(Boolean) as Array<keyof typeof PROFILES>;
for (const name of profileNames) if (!PROFILES[name]) throw new Error(`Unknown profile ${name}`);

// Preflight runs once in the runner process (workers inherit WF_PREFLIGHT_DONE) before any webServer starts.
if (process.env.WF_PREFLIGHT_DONE !== '1') {
  execFileSync('node', [resolve(ROOT, 'web/e2e-final/scripts/preflight.mjs')], { stdio: 'inherit' });
  process.env.WF_PREFLIGHT_DONE = '1';
}

const sha = process.env.WF_EVIDENCE_SHA ?? execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
process.env.WF_EVIDENCE_SHA = sha;
// UX-T0: evidence of the UX polish round lives in docs/evidence/web-ux/<sha>/ (SPEC §5.9).
const evidenceDir = resolve(ROOT, process.env.WF_EVIDENCE_ROOT ?? 'docs/evidence/web-ux', sha);

// Legacy specs (web/e2e) read these from the runner environment; DATABASE_URL is a non-target so
// the wallet_test guard never sees wallet_test as the "development" URL.
const fileEnv = parseEnvFile();
const p1 = PROFILES.P1;
Object.assign(process.env, {
  E2E_DATABASE_URL: fileEnv.TEST_DATABASE_URL,
  TEST_DATABASE_URL: fileEnv.TEST_DATABASE_URL,
  DATABASE_URL: fileEnv.MIGRATOR_DATABASE_URL,
  MIGRATOR_DATABASE_URL: fileEnv.MIGRATOR_DATABASE_URL,
  PLAYWRIGHT_WEB_ORIGIN: `http://127.0.0.1:${p1.web}`,
  PLAYWRIGHT_API_BASE: `http://127.0.0.1:${p1.api}`,
  OTP_THRESHOLD_MINOR: DEMO_DEFAULTS.OTP_THRESHOLD_MINOR,
  DAILY_TRANSFER_LIMIT_MINOR: DEMO_DEFAULTS.DAILY_TRANSFER_LIMIT_MINOR,
  BUSINESS_TIME_ZONE: DEMO_DEFAULTS.BUSINESS_TIME_ZONE,
});

const noBuild = process.env.WF_NO_BUILD === '1' ? ' --no-build' : '';
const webServer = profileNames.flatMap((name) => [
  { command: `node web/e2e-final/scripts/serve.mjs api ${name}`, cwd: ROOT, url: `http://127.0.0.1:${PROFILES[name].api}/health`, reuseExistingServer: false, timeout: 90_000, stdout: 'ignore' as const, stderr: 'pipe' as const },
  { command: `node web/e2e-final/scripts/serve.mjs web ${name}${noBuild}`, cwd: ROOT, url: `http://127.0.0.1:${PROFILES[name].web}`, reuseExistingServer: false, timeout: 120_000, stdout: 'ignore' as const, stderr: 'pipe' as const },
]);

const shared = {
  baseURL: `http://127.0.0.1:${p1.web}`,
  browserName: 'chromium' as const,
  headless: true,
  locale: 'es-MX',
  timezoneId: 'America/Mexico_City',
  trace: 'off' as const,
  screenshot: 'off' as const,
};

export default defineConfig({
  outputDir: resolve(evidenceDir, 'captures/test-results'),
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  webServer,
  projects: [
    // UX-T0: ux-capture.spec.ts (before/after evidence of docs/web-ux-polish/SPEC.md §7.4) runs only in its own project.
    { name: 'final', testDir: '.', testMatch: /.*\.spec\.ts$/, testIgnore: /ux-capture\.spec\.ts$/, use: { ...shared, reducedMotion: 'reduce' } },
    { name: 'ux-capture', testDir: '.', testMatch: /ux-capture\.spec\.ts$/, use: { ...shared, reducedMotion: 'reduce' } },
    { name: 'legacy', testDir: '../e2e', testMatch: /.*\.spec\.ts$/, use: shared },
  ],
});
