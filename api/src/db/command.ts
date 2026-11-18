import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import { dataSource } from './data-source.js';
import { assertSafeTestDatabase } from './test-database-guard.js';

const action = process.argv[2];
if (action !== 'migrate' && action !== 'migrate:test' && action !== 'seed') throw new Error('Expected migrate, migrate:test or seed');
if (action === 'seed') {
  if (process.env.APP_ENV !== 'development' || process.env.DEMO_FIXTURE_ENABLED !== 'true') throw new Error('Demo fixture requires APP_ENV=development and DEMO_FIXTURE_ENABLED=true');
  console.log('El fixture se crea de forma idempotente durante el registro de usuario.');
  process.exit(0);
}
const migrationUrl = action === 'migrate:test' ? process.env.TEST_MIGRATOR_DATABASE_URL : process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) throw new Error('MIGRATOR_DATABASE_URL is required');
if (action === 'migrate:test') {
  const testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  if (new URL(migrationUrl).pathname !== testUrl.pathname || !new URL(migrationUrl).username.startsWith('wallet_migrator')) throw new Error('Test migrations require wallet_test migrator credentials');
} else if (new URL(migrationUrl).username.startsWith('wallet_runtime_')) throw new Error('Migrations require a migrator database role');
const source = dataSource(migrationUrl);
await source.initialize();
try {
  await source.runMigrations();
  console.log('Database migrations applied.');
} finally {
  await source.destroy();
}
