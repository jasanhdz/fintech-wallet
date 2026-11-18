import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

test('isolated test database connects as runtime role and never targets development', async () => {
  assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const identity = await client.query<{ current_database: string; current_user: string }>('SELECT current_database(), current_user');
    assert.equal(identity.rows[0]?.current_database, 'wallet_test');
    assert.equal(identity.rows[0]?.current_user, 'wallet_runtime_test');
    const devDatabase = await client.query<{ same_database: boolean }>("SELECT current_database() = 'wallet_dev' AS same_database");
    assert.equal(devDatabase.rows[0]?.same_database, false);
  } finally {
    await client.end();
  }
});
