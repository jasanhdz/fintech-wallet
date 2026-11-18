import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import { dataSource } from './data-source.js';
import { assertSafeTestDatabase, assertSafeTestMigrator } from './test-database-guard.js';
import { Client } from 'pg';
import { ensureManualDemoProfile } from './manual-demo-seed.js';

const action = process.argv[2];
if (action !== 'migrate' && action !== 'migrate:test' && action !== 'seed') throw new Error('Expected migrate, migrate:test or seed');
if (action === 'seed') {
  if (process.env.APP_ENV !== 'development') throw new Error('Manual demo profile requires APP_ENV=development');
  if (process.env.DEMO_FIXTURE_ENABLED !== 'true') throw new Error('Manual demo profile requires DEMO_FIXTURE_ENABLED=true');
  const seedUrl = process.env.MIGRATOR_DATABASE_URL;
  if (!seedUrl) throw new Error('MIGRATOR_DATABASE_URL is required');
  const target = new URL(seedUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) || target.pathname !== '/wallet_dev' || target.username !== 'wallet_migrator_dev' || !['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Demo seed requires the local wallet_dev migrator database');
  const client = new Client({ connectionString: seedUrl });
  await client.connect();
  try { await client.query('BEGIN'); await ensureManualDemoProfile((sql, parameters) => client.query(sql, parameters) as Promise<unknown>); await client.query('COMMIT'); console.log('Local manual demo profile ensured in wallet_dev.'); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
  process.exit(0);
}
const migrationUrl = action === 'migrate:test' ? process.env.TEST_MIGRATOR_DATABASE_URL : process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) throw new Error('MIGRATOR_DATABASE_URL is required');
if (action === 'migrate:test') {
  const testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  assertSafeTestMigrator(migrationUrl, testUrl);
} else if (new URL(migrationUrl).username.startsWith('wallet_runtime_')) throw new Error('Migrations require a migrator database role');
const source = dataSource(migrationUrl);
await source.initialize();
try {
  await source.runMigrations();
  console.log('Database migrations applied.');
} finally {
  await source.destroy();
}
