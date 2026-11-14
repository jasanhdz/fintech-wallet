import 'dotenv/config';
import { dataSource } from './data-source.js';

const action = process.argv[2];
if (action !== 'migrate' && action !== 'seed') throw new Error('Expected migrate or seed');
if (action === 'seed') {
  console.log('Sin migraciones/seed de negocio.');
  process.exit(0);
}
const migrationUrl = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) throw new Error('MIGRATOR_DATABASE_URL is required');
if (new URL(migrationUrl).username.startsWith('wallet_runtime_')) throw new Error('Migrations require a migrator database role');
const source = dataSource(migrationUrl);
await source.initialize();
try {
  await source.runMigrations();
  console.log('Migraciones de BOOT-00 aplicadas (sin migraciones/seed de negocio).');
} finally {
  await source.destroy();
}
