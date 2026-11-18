import { Client } from 'pg';
import { assertSafeTestDatabase, assertSafeTestMigrator } from '../../api/src/db/test-database-guard.js';

const databaseUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const migratorUrl = assertSafeTestMigrator(process.env.TEST_MIGRATOR_DATABASE_URL, databaseUrl);
const client = new Client({ connectionString: migratorUrl.toString() });

const userId = '00000000-0000-4000-8000-000000000100';
const sourceId = '00000000-0000-4000-8000-000000000101';
const clearingId = '00000000-0000-4000-8000-000000000102';
const fixtureSize = 100_000;

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO users(id,email,full_name,password_hash) VALUES($1,$2,'QA history fixture','fixture-account-disabled') ON CONFLICT(id) DO NOTHING",
    [userId, 'qa-history-performance@wallet.invalid'],
  );
  const user = await client.query('SELECT id FROM users WHERE email=$1', ['qa-history-performance@wallet.invalid']);
  if (user.rows[0]?.id !== userId) throw new Error('History QA fixture identity conflicts with an existing user');

  await client.query(
    "INSERT INTO accounts(id,owner_id,name,kind,balance_minor) VALUES($1,$2,'QA history source','checking',$3) ON CONFLICT(id) DO NOTHING",
    [sourceId, userId, String(fixtureSize)],
  );
  await client.query(
    "INSERT INTO accounts(id,owner_id,name,kind,balance_minor) VALUES($1,NULL,'QA history clearing','clearing',0) ON CONFLICT(id) DO NOTHING",
    [clearingId],
  );
  const accounts = await client.query('SELECT id,owner_id,kind FROM accounts WHERE id=ANY($1::uuid[])', [[sourceId, clearingId]]);
  const source = accounts.rows.find((row) => row.id === sourceId);
  const clearing = accounts.rows.find((row) => row.id === clearingId);
  if (source?.owner_id !== userId || source?.kind !== 'checking' || clearing?.owner_id !== null || clearing?.kind !== 'clearing') {
    throw new Error('History QA fixture account conflicts with existing data');
  }

  await client.query(
    `INSERT INTO transfers(id,owner_id,source_account_id,destination_account_id,amount_minor,concept,reference,status,created_at,completed_at,receipt_reference,request_id)
     SELECT ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,$3,1,'100k history performance fixture',lpad((n%10000000)::text,7,'0'),'completed',now()-(n::text||' milliseconds')::interval,now()-(n::text||' milliseconds')::interval,('qa-'||n::text),'qa-history-performance'
     FROM generate_series(1,$4::integer) AS n ON CONFLICT(id) DO NOTHING`,
    [userId, sourceId, clearingId, fixtureSize],
  );
  await client.query(
    `INSERT INTO ledger_transactions(id,reference_type,reference_id,created_at)
     SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'transfer',('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-(n::text||' milliseconds')::interval
     FROM generate_series(1,$1::integer) AS n ON CONFLICT(id) DO NOTHING`,
    [fixtureSize],
  );
  await client.query(
    `INSERT INTO ledger_entries(id,ledger_transaction_id,account_id,signed_amount_minor,entry_type,created_at)
     SELECT ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1::uuid,-1,'debit',now()-(n::text||' milliseconds')::interval
     FROM generate_series(1,$3::integer) AS n
     UNION ALL
     SELECT ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$2::uuid,1,'credit',now()-(n::text||' milliseconds')::interval
     FROM generate_series(1,$3::integer) AS n ON CONFLICT(id) DO NOTHING`,
    [sourceId, clearingId, fixtureSize],
  );
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

await client.query('ANALYZE ledger_entries');
await client.query('ANALYZE ledger_transactions');
await client.query('ANALYZE transfers');
const count = await client.query('SELECT count(*)::text AS movement_count FROM ledger_entries WHERE account_id=$1', [sourceId]);
if (count.rows[0]?.movement_count !== String(fixtureSize)) throw new Error('Expected exactly 100000 seeded movements for the isolated QA account');

const firstPage = await client.query(
  `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,id::text AS id
   FROM ledger_entries WHERE account_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 20`,
  [sourceId],
);
const cursor = firstPage.rows.at(-1);
if (!cursor?.occurred_at || !cursor.id) throw new Error('Could not derive the real keyset cursor for the performance query');
const explain = await client.query(
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
   SELECT le.id,lt.reference_id AS transfer_id,le.entry_type AS type,abs(le.signed_amount_minor)::text AS amount_minor,t.concept,t.reference,t.status,le.created_at
   FROM ledger_entries le
   JOIN ledger_transactions lt ON lt.id=le.ledger_transaction_id AND lt.reference_type='transfer'
   JOIN transfers t ON t.id=lt.reference_id AND t.status='completed'
   WHERE le.account_id=$1::uuid AND le.entry_type IN ('debit','credit') AND t.completed_at IS NOT NULL
     AND ($2::timestamptz IS NULL OR t.completed_at >= $2::timestamptz)
     AND ($3::timestamptz IS NULL OR t.completed_at <= $3::timestamptz)
     AND ($4::text IS NULL OR le.entry_type=$4::text)
     AND ($5::timestamptz IS NULL OR (le.created_at,le.id)<($5::timestamptz,$6::uuid))
   ORDER BY le.created_at DESC,le.id DESC LIMIT 20`,
  [sourceId, new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), null, 'debit', cursor.occurred_at, cursor.id],
);
const server = await client.query('SELECT current_database() AS database, current_user AS role, current_setting($1) AS version', ['server_version']);

console.log(`Target: ${server.rows[0].database} via ${server.rows[0].role}; PostgreSQL ${server.rows[0].version}; no development database writes.`);
console.log(`Fixture movements on dedicated QA account: ${count.rows[0].movement_count}`);
console.log('Query: movement history by account, completed status, 100-day date filter, debit type, actual newest-first keyset cursor, LIMIT 20.');
console.log('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT):');
for (const row of explain.rows as Array<{ 'QUERY PLAN': string }>) console.log(row['QUERY PLAN']);

await client.end();
