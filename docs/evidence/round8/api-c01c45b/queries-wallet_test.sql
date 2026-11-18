-- Round 8 G-A evidence queries (read-only) against wallet_test.
-- Usage: docker exec -i fintech-wallet-postgres-1 psql -U postgres -d wallet_test -v since="<UTC ISO>" < queries-wallet_test.sql
-- Never selects key_hash, ciphertexts (CLABE / demo OTP) or code hashes. The only write is a session TEMP table,
-- discarded by the final ROLLBACK (PostgreSQL forbids CREATE TEMP TABLE inside READ ONLY transactions).
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

\echo '== R8-01 migration row'
SELECT id, name FROM migrations WHERE name = 'TransferAttemptRecovery1763000009000';

\echo '== R8-01 column, tables, CHECKs, indexes, triggers'
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
 WHERE (table_name = 'transfers' AND column_name = 'client_attempt_id') OR table_name IN ('transfer_send_gates', 'transfer_attempt_closures')
 ORDER BY table_name, ordinal_position;
SELECT conrelid::regclass AS "table", conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid IN ('transfer_send_gates'::regclass, 'transfer_attempt_closures'::regclass) ORDER BY 1, 2;
SELECT indexname, indexdef FROM pg_indexes
 WHERE indexname IN ('transfers_owner_attempt_uidx', 'transfer_attempt_closures_owner_key_uidx', 'transfer_attempt_closures_owner_attempt_uidx', 'transfer_attempt_closures_owner_closed_idx', 'transfers_owner_created_idx')
 ORDER BY 1;
SELECT tgrelid::regclass AS "table", tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('transfers_attempt_id_immutable', 'transfer_send_gates_monotonic', 'transfer_attempt_closures_append_only', 'transfer_attempt_closures_cross_guard', 'idempotency_records_closed_key_guard', 'transfers_closed_attempt_guard', 'transfers_terminal_state_guard')
 ORDER BY 1, 2;

\echo '== R8-01 runtime privileges (wallet_runtime_test)'
SELECT tbl, priv, has_table_privilege('wallet_runtime_test', tbl, priv) AS granted FROM (VALUES
 ('transfer_send_gates','SELECT'),('transfer_send_gates','INSERT'),('transfer_send_gates','UPDATE'),('transfer_send_gates','DELETE'),('transfer_send_gates','TRUNCATE'),
 ('transfer_attempt_closures','SELECT'),('transfer_attempt_closures','INSERT'),('transfer_attempt_closures','UPDATE'),('transfer_attempt_closures','DELETE'),('transfer_attempt_closures','TRUNCATE'),
 ('transfers','DELETE'),('idempotency_records','DELETE'),('audit_events','UPDATE'),('audit_events','DELETE')) AS p(tbl, priv);

CREATE TEMP TABLE r8_users ON COMMIT DROP AS
 SELECT id, regexp_replace(email, '^r8-(.*)-[0-9a-f]{8}-[0-9a-f]{4}-.*$', '\1') AS label, created_at
 FROM users WHERE email LIKE 'r8-%' AND created_at >= :'since'::timestamptz;

\echo '== Run users (fake emails r8-<section>-<uuid>@example.test, created since the run start)'
SELECT label, id, created_at FROM r8_users ORDER BY created_at;

\echo '== Transfers per user and status (with / without client_attempt_id)'
SELECT u.label, t.status, count(*) AS transfers, count(t.client_attempt_id) AS with_attempt_id
 FROM r8_users u JOIN transfers t ON t.owner_id = u.id GROUP BY u.label, u.created_at, t.status ORDER BY u.created_at, t.status;

\echo '== Closures per user and status (problem_status for rejected)'
SELECT u.label, c.status, c.problem_status, count(*) AS closures, count(c.client_attempt_id) AS with_attempt_id
 FROM r8_users u JOIN transfer_attempt_closures c ON c.owner_id = u.id GROUP BY u.label, u.created_at, c.status, c.problem_status ORDER BY u.created_at, c.status;

\echo '== Send epoch per user'
SELECT u.label, COALESCE(g.epoch::text, '0 (no row)') AS epoch FROM r8_users u LEFT JOIN transfer_send_gates g ON g.owner_id = u.id ORDER BY u.created_at;

\echo '== Invariants (every count must be 0)'
SELECT 'ledger transactions of run transfers whose entries do not sum to 0' AS invariant, count(*) AS violations FROM (
  SELECT lt.id FROM r8_users u JOIN transfers t ON t.owner_id = u.id JOIN ledger_transactions lt ON lt.reference_type = 'transfer' AND lt.reference_id = t.id
  JOIN ledger_entries le ON le.ledger_transaction_id = lt.id GROUP BY lt.id HAVING sum(le.signed_amount_minor) <> 0) x
UNION ALL SELECT 'transfers with more than one debit', count(*) FROM (
  SELECT t.id FROM r8_users u JOIN transfers t ON t.owner_id = u.id JOIN ledger_transactions lt ON lt.reference_type = 'transfer' AND lt.reference_id = t.id
  JOIN ledger_entries le ON le.ledger_transaction_id = lt.id AND le.entry_type = 'debit' GROUP BY t.id HAVING count(*) > 1) x
UNION ALL SELECT 'non-completed transfers with ledger entries', count(*) FROM r8_users u JOIN transfers t ON t.owner_id = u.id
  JOIN ledger_transactions lt ON lt.reference_type = 'transfer' AND lt.reference_id = t.id WHERE t.status <> 'completed'
UNION ALL SELECT 'identities with both a transfer and a closure', count(*) FROM r8_users u JOIN transfers t ON t.owner_id = u.id
  JOIN transfer_attempt_closures c ON c.owner_id = u.id AND c.client_attempt_id = t.client_attempt_id
UNION ALL SELECT 'keys with both an executed idempotency record and a closure', count(*) FROM r8_users u JOIN idempotency_records i ON i.user_id = u.id AND i.operation = 'create-transfer'
  JOIN transfer_attempt_closures c ON c.owner_id = u.id AND c.key_hash = i.key_hash
UNION ALL SELECT 'duplicated (owner, client_attempt_id) in transfers', count(*) FROM (
  SELECT t.owner_id, t.client_attempt_id FROM r8_users u JOIN transfers t ON t.owner_id = u.id WHERE t.client_attempt_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x
UNION ALL SELECT 'customer accounts whose balance differs from their ledger', count(*) FROM (
  SELECT a.id FROM r8_users u JOIN accounts a ON a.owner_id = u.id LEFT JOIN ledger_entries le ON le.account_id = a.id
  GROUP BY a.id, a.balance_minor HAVING a.balance_minor <> COALESCE(sum(le.signed_amount_minor), 0)) x
UNION ALL SELECT 'negative customer balances', count(*) FROM r8_users u JOIN accounts a ON a.owner_id = u.id WHERE a.balance_minor < 0;

\echo '== Balances, debits and net per user (minor units; fixture amounts are demo/test only)'
SELECT u.label,
  (SELECT string_agg(a.kind || '=' || a.balance_minor, ' ' ORDER BY a.kind) FROM accounts a WHERE a.owner_id = u.id) AS balances,
  (SELECT count(*) FROM transfers t JOIN ledger_transactions lt ON lt.reference_type = 'transfer' AND lt.reference_id = t.id JOIN ledger_entries le ON le.ledger_transaction_id = lt.id AND le.entry_type = 'debit' WHERE t.owner_id = u.id) AS debits,
  (SELECT COALESCE(sum(le.signed_amount_minor), 0) FROM transfers t JOIN ledger_transactions lt ON lt.reference_type = 'transfer' AND lt.reference_id = t.id JOIN ledger_entries le ON le.ledger_transaction_id = lt.id WHERE t.owner_id = u.id) AS transfer_entries_net
 FROM r8_users u ORDER BY u.created_at;

\echo '== Daily usage per user'
SELECT u.label, d.business_date, d.outgoing_minor FROM r8_users u JOIN daily_limit_usage d ON d.owner_id = u.id ORDER BY u.created_at, d.business_date;

\echo '== Idempotency retention dates (expires_at - created_at) per user and operation'
SELECT u.label, i.operation, (i.expires_at - i.created_at) AS retention, count(*) FROM r8_users u JOIN idempotency_records i ON i.user_id = u.id
 GROUP BY u.label, u.created_at, i.operation, 3 ORDER BY u.created_at, i.operation, 3;

\echo '== Round-8 audit events (metadata only; no key, key hash, OTP or CLABE)'
SELECT u.label, e.action, e.resource_type, e.metadata, count(*) AS events FROM r8_users u JOIN audit_events e ON e.actor_id = u.id
 WHERE e.action IN ('transfer.attempt_voided', 'transfer.attempt_rejected', 'transfer.cancelled', 'transfer.expired', 'transfer.send_epoch_advanced')
 GROUP BY u.label, u.created_at, e.action, e.resource_type, e.metadata ORDER BY u.created_at, e.action, e.metadata::text;

\echo '== Privacy scan of all audit metadata of the run (every count must be 0)'
SELECT count(*) FILTER (WHERE e.metadata::text ~ '(^|[^0-9])[0-9]{18}([^0-9]|$)') AS eighteen_digit_values,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(e.metadata) k WHERE k ~* '(key|code|otp|clabe|hash)')) AS secret_like_fields,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM idempotency_records i WHERE i.user_id = u.id AND position(i.key_hash IN e.metadata::text) > 0)
                         OR EXISTS (SELECT 1 FROM transfer_attempt_closures c WHERE c.owner_id = u.id AND position(c.key_hash IN e.metadata::text) > 0)) AS key_hashes_in_metadata,
       count(*) AS audit_events_scanned
 FROM r8_users u JOIN audit_events e ON e.actor_id = u.id;

ROLLBACK;
