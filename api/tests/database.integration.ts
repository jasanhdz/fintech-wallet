import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import { assertSafeTestDatabase, assertSafeTestMigrator } from '../src/db/test-database-guard.js';
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
    const grants = await client.query<{ role_name: string; users_select: boolean; users_insert: boolean; users_update: boolean; users_delete: boolean; accounts_select: boolean; accounts_insert: boolean; accounts_update: boolean; accounts_delete: boolean; sessions_select: boolean; sessions_insert: boolean; sessions_update: boolean; sessions_delete: boolean; ledger_insert: boolean; ledger_update: boolean; ledger_delete: boolean; entries_insert: boolean; entries_update: boolean; entries_delete: boolean; audit_insert: boolean; audit_update: boolean; audit_delete: boolean }>(`SELECT role_name,
      has_table_privilege(role_name,'users','SELECT') AS users_select,
      has_table_privilege(role_name,'users','INSERT') AS users_insert,
      has_table_privilege(role_name,'users','UPDATE') AS users_update,
      has_table_privilege(role_name,'users','DELETE') AS users_delete,
      has_table_privilege(role_name,'accounts','SELECT') AS accounts_select,
      has_table_privilege(role_name,'accounts','INSERT') AS accounts_insert,
      has_table_privilege(role_name,'accounts','UPDATE') AS accounts_update,
      has_table_privilege(role_name,'accounts','DELETE') AS accounts_delete,
      has_table_privilege(role_name,'refresh_sessions','SELECT') AS sessions_select,
      has_table_privilege(role_name,'refresh_sessions','INSERT') AS sessions_insert,
      has_table_privilege(role_name,'refresh_sessions','UPDATE') AS sessions_update,
      has_table_privilege(role_name,'refresh_sessions','DELETE') AS sessions_delete,
      has_table_privilege(role_name,'ledger_transactions','INSERT') AS ledger_insert,
      has_table_privilege(role_name,'ledger_transactions','UPDATE') AS ledger_update,
      has_table_privilege(role_name,'ledger_transactions','DELETE') AS ledger_delete,
      has_table_privilege(role_name,'ledger_entries','INSERT') AS entries_insert,
      has_table_privilege(role_name,'ledger_entries','UPDATE') AS entries_update,
      has_table_privilege(role_name,'ledger_entries','DELETE') AS entries_delete,
      has_table_privilege(role_name,'audit_events','INSERT') AS audit_insert,
      has_table_privilege(role_name,'audit_events','UPDATE') AS audit_update,
      has_table_privilege(role_name,'audit_events','DELETE') AS audit_delete
      FROM unnest(ARRAY['wallet_runtime_dev','wallet_runtime_test']) AS role_name`);
    assert.equal(grants.rows.length, 2);
    for (const role of grants.rows) {
      assert.equal(role.users_select, true, `${role.role_name} users SELECT`);
      assert.equal(role.users_insert, true, `${role.role_name} users INSERT`);
      assert.equal(role.users_update, true, `${role.role_name} users UPDATE`);
      assert.equal(role.users_delete, false, `${role.role_name} users DELETE`);
      assert.equal(role.accounts_select, true, `${role.role_name} accounts SELECT`);
      assert.equal(role.accounts_insert, true, `${role.role_name} accounts INSERT`);
      assert.equal(role.accounts_update, true, `${role.role_name} accounts UPDATE`);
      assert.equal(role.accounts_delete, false, `${role.role_name} accounts DELETE`);
      assert.equal(role.sessions_select, true, `${role.role_name} refresh_sessions SELECT`);
      assert.equal(role.sessions_insert, true, `${role.role_name} refresh_sessions INSERT`);
      assert.equal(role.sessions_update, true, `${role.role_name} refresh_sessions UPDATE`);
      assert.equal(role.sessions_delete, false, `${role.role_name} refresh_sessions DELETE`);
      assert.equal(role.ledger_insert, true, `${role.role_name} ledger INSERT`);
      assert.equal(role.ledger_update, false, `${role.role_name} ledger UPDATE`);
      assert.equal(role.ledger_delete, false, `${role.role_name} ledger DELETE`);
      assert.equal(role.entries_insert, true, `${role.role_name} ledger_entries INSERT`);
      assert.equal(role.entries_update, false, `${role.role_name} ledger_entries UPDATE`);
      assert.equal(role.entries_delete, false, `${role.role_name} ledger_entries DELETE`);
      assert.equal(role.audit_insert, true, `${role.role_name} audit INSERT`);
      assert.equal(role.audit_update, false, `${role.role_name} audit UPDATE`);
      assert.equal(role.audit_delete, false, `${role.role_name} audit DELETE`);
    }
  } finally {
    await client.end();
  }
});

test('test migrator must match the local wallet_test target and exact role', () => {
  const runtime = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  assertSafeTestMigrator(process.env.TEST_MIGRATOR_DATABASE_URL, runtime);
  for (const unsafe of [
    'postgres://wallet_migrator_test@remote.invalid:5432/wallet_test',
    'postgres://wallet_migrator_test@localhost:5433/wallet_test',
    'postgres://wallet_migrator_test@localhost:5432/wallet_dev',
    'postgres://wallet_migrator_extra@localhost:5432/wallet_test',
  ]) {
    assert.throws(() => assertSafeTestMigrator(unsafe, runtime));
  }
});
