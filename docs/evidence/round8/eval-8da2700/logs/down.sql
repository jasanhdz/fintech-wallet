
      DROP TRIGGER IF EXISTS transfers_closed_attempt_guard ON transfers;
      DROP FUNCTION IF EXISTS guard_transfer_closed_attempt();
      DROP TRIGGER IF EXISTS idempotency_records_closed_key_guard ON idempotency_records;
      DROP FUNCTION IF EXISTS guard_idempotency_closed_key();
      DROP TABLE IF EXISTS transfer_attempt_closures;
      DROP FUNCTION IF EXISTS guard_transfer_attempt_closure_insert();
      DROP FUNCTION IF EXISTS prevent_transfer_attempt_closure_mutation();
      DROP TABLE IF EXISTS transfer_send_gates;
      DROP FUNCTION IF EXISTS guard_transfer_send_gate();
      DROP TRIGGER IF EXISTS transfers_attempt_id_immutable ON transfers;
      DROP FUNCTION IF EXISTS prevent_transfer_attempt_id_change();
      DROP INDEX IF EXISTS transfers_owner_attempt_uidx;
      ALTER TABLE transfers DROP COLUMN IF EXISTS client_attempt_id;
    