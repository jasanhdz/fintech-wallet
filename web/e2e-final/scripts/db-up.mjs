#!/usr/bin/env node
// Creates (or starts) the private PostgreSQL container for this round and applies
// migrations to its wallet_test. Refuses to run with < 2.5 GiB free (SPEC §5.10).
// Usage: node web/e2e-final/scripts/db-up.mjs [--evidence <file>]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTAINER, DB_PORT, IMAGE, ROOT, VOLUME, parseEnvFile } from './env-lib.mjs';
import { CONTAINER_INTERNAL_PG_PORT, databaseUrlViolations } from './preflight.mjs';

const evidenceIndex = process.argv.indexOf('--evidence');
const evidence = evidenceIndex > 0 ? resolve(process.argv[evidenceIndex + 1]) : undefined;
const log = (text) => { console.log(text); if (evidence) appendFileSync(evidence, `${text}\n`); };
if (evidence) writeFileSync(evidence, '');

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });
const MIN_FREE_KIB = 2.5 * 1024 * 1024;

const df = run('df', ['-k', '/System/Volumes/Data']).trim().split('\n').at(-1).split(/\s+/);
const freeKiB = Number(df[3]);
log(`# ${new Date().toISOString()} disk before volume`);
log(run('df', ['-h', '/System/Volumes/Data']).trim());
log(run('docker', ['system', 'df']).trim());
if (!(freeKiB >= MIN_FREE_KIB)) { log(`BLOCKED: only ${(freeKiB / 1024 / 1024).toFixed(2)} GiB free (< 2.5 GiB)`); process.exit(2); }
log(`disk OK: ${(freeKiB / 1024 / 1024).toFixed(2)} GiB free (>= 2.5 GiB)`);

const fileEnv = parseEnvFile();
if (databaseUrlViolations(fileEnv).length) { log('BLOCKED: forbidden database target in .env.web-final'); process.exit(2); }

const exists = spawnSync('docker', ['inspect', CONTAINER], { stdio: 'ignore' }).status === 0;
if (!exists) {
  if (spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status !== 0) { log(`BLOCKED: image ${IMAGE} not on disk (not pulling)`); process.exit(2); }
  run('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=postgres',
    '-p', `127.0.0.1:${DB_PORT}:${CONTAINER_INTERNAL_PG_PORT}`,
    '-v', `${VOLUME}:/var/lib/postgresql/data`,
    '-v', `${resolve(ROOT, 'scripts/db/init.sql')}:/docker-entrypoint-initdb.d/001-init.sql:ro`,
    IMAGE,
  ], { env: { ...process.env, POSTGRES_PASSWORD: fileEnv.WEB_PG_SUPERUSER_PASSWORD } });
  log(`created ${CONTAINER} (${IMAGE}) volume ${VOLUME} bound to 127.0.0.1:${DB_PORT}`);
} else {
  run('docker', ['start', CONTAINER]);
  log(`started existing ${CONTAINER}`);
}

let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
  const probe = spawnSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'wallet_test', '-tAc', 'select 1'], { encoding: 'utf8' });
  ready = probe.status === 0 && probe.stdout.trim() === '1';
  if (!ready) await new Promise((done) => setTimeout(done, 1000));
}
if (!ready) { log('FAIL: wallet_test not ready in 60 s'); process.exit(1); }
log('wallet_test ready');

const migrate = spawnSync('npm', ['run', 'db:migrate:test'], {
  cwd: ROOT, encoding: 'utf8',
  // The test guard rejects DATABASE_URL == wallet_test, so DATABASE_URL points to an unusable target here.
  env: { ...process.env, TEST_DATABASE_URL: fileEnv.TEST_DATABASE_URL, TEST_MIGRATOR_DATABASE_URL: fileEnv.TEST_MIGRATOR_DATABASE_URL, DATABASE_URL: fileEnv.MIGRATOR_DATABASE_URL, MIGRATOR_DATABASE_URL: fileEnv.MIGRATOR_DATABASE_URL },
});
log(`db:migrate:test exit ${migrate.status}`);
log((migrate.stdout + migrate.stderr).split('\n').filter((line) => line && !/password|secret/i.test(line)).slice(-15).join('\n'));
if (migrate.status !== 0) process.exit(1);
log(run('docker', ['ps', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}} {{.Image}} {{.Ports}} {{.Status}}']).trim());
