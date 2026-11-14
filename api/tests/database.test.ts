import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

test('isolated test database connects as runtime role and has no business schema', async () => {
  assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const identity = await client.query<{ current_database: string; current_user: string }>('SELECT current_database(), current_user');
    assert.equal(identity.rows[0]?.current_database, 'wallet_test');
    assert.equal(identity.rows[0]?.current_user, 'wallet_runtime_test');
    const tables = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'");
    assert.equal(tables.rows[0]?.count, '0');
  } finally {
    await client.end();
  }
});
