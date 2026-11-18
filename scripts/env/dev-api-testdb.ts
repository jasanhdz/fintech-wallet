import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertSafeTestDatabase, assertSafeTestMigrator } from '../../api/src/db/test-database-guard.js';

dotenv.config({ path: resolve(process.cwd(), '.env') });
const testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
assertSafeTestMigrator(process.env.TEST_MIGRATOR_DATABASE_URL, testUrl);

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['--workspace', '@fintech-wallet/api', 'run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ENV: 'development',
    DATABASE_URL: testUrl.toString(),
    DEMO_FIXTURE_ENABLED: 'true',
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => { console.error('Unable to start the test-database API process:', error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
