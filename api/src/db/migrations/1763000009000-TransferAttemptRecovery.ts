import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Round 8 (F-26): authoritative recovery of transfer attempts.
 *
 * - `transfers.client_attempt_id`: identity chosen by the client (`Transfer-Attempt-Id`), unique per owner and immutable.
 * - `transfer_send_gates`: one row per user with a monotonic send epoch. Every transfer creation holds it FOR SHARE;
 *   `void`/`void-all` hold it FOR UPDATE, so they wait for in-flight sends of that user.
 * - `transfer_attempt_closures`: append-only terminal closures (`voided`/`rejected`) of attempts that never created a
 *   transfer. Cross guards forbid a closure and an executed attempt for the same key/identity (defence in depth; the
 *   real serialization is the gate + per-key advisory lock in the service).
 *
 * Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS) and backward compatible: it only adds;
 * no existing row changes. Never applied to wallet_dev by this round.
 */
export const transferAttemptRecoveryUpSql = `
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS client_attempt_id uuid NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transfers_owner_attempt_uidx ON transfers(owner_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL;
CREATE OR REPLACE FUNCTION prevent_transfer_attempt_id_change() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.client_attempt_id IS DISTINCT FROM NEW.client_attempt_id THEN
      RAISE EXCEPTION 'transfer client_attempt_id is immutable';
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS transfers_attempt_id_immutable ON transfers;
CREATE TRIGGER transfers_attempt_id_immutable BEFORE UPDATE OF client_attempt_id ON transfers FOR EACH ROW EXECUTE FUNCTION prevent_transfer_attempt_id_change();

CREATE TABLE IF NOT EXISTS transfer_send_gates (
  owner_id uuid PRIMARY KEY REFERENCES users(id),
  epoch bigint NOT NULL DEFAULT 0 CONSTRAINT transfer_send_gates_epoch_check CHECK (epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION guard_transfer_send_gate() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'transfer send gates cannot be deleted';
    END IF;
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NOT (NEW.epoch = OLD.epoch OR NEW.epoch = OLD.epoch + 1) THEN
      RAISE EXCEPTION 'transfer send epoch can only stay or advance by one';
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS transfer_send_gates_monotonic ON transfer_send_gates;
CREATE TRIGGER transfer_send_gates_monotonic BEFORE UPDATE OR DELETE ON transfer_send_gates FOR EACH ROW EXECUTE FUNCTION guard_transfer_send_gate();

CREATE TABLE IF NOT EXISTS transfer_attempt_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  key_hash char(64) NOT NULL,
  client_attempt_id uuid NULL,
  status varchar(16) NOT NULL CONSTRAINT transfer_attempt_closures_status_check CHECK (status IN ('voided','rejected')),
  payload_hash char(64) NULL,
  amount_minor bigint NULL CONSTRAINT transfer_attempt_closures_amount_check CHECK (amount_minor IS NULL OR amount_minor > 0),
  problem_status smallint NULL CONSTRAINT transfer_attempt_closures_problem_status_check CHECK (problem_status IS NULL OR problem_status IN (404,422,429)),
  problem_detail varchar(200) NULL,
  request_id varchar(128),
  closed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_attempt_closures_rejected_check CHECK ((status = 'rejected') = (problem_status IS NOT NULL AND payload_hash IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_attempt_closures_owner_key_uidx ON transfer_attempt_closures(owner_id, key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_attempt_closures_owner_attempt_uidx ON transfer_attempt_closures(owner_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfer_attempt_closures_owner_closed_idx ON transfer_attempt_closures(owner_id, closed_at DESC, id DESC);
CREATE OR REPLACE FUNCTION prevent_transfer_attempt_closure_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'transfer attempt closures are append-only';
  END $$;
DROP TRIGGER IF EXISTS transfer_attempt_closures_append_only ON transfer_attempt_closures;
CREATE TRIGGER transfer_attempt_closures_append_only BEFORE UPDATE OR DELETE ON transfer_attempt_closures FOR EACH ROW EXECUTE FUNCTION prevent_transfer_attempt_closure_mutation();

CREATE OR REPLACE FUNCTION guard_transfer_attempt_closure_insert() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM idempotency_records WHERE user_id = NEW.owner_id AND operation = 'create-transfer' AND key_hash = NEW.key_hash) THEN
      RAISE EXCEPTION 'cannot close an attempt whose key already executed' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.client_attempt_id IS NOT NULL AND EXISTS (SELECT 1 FROM transfers WHERE owner_id = NEW.owner_id AND client_attempt_id = NEW.client_attempt_id) THEN
      RAISE EXCEPTION 'cannot close an attempt identity that already has a transfer' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS transfer_attempt_closures_cross_guard ON transfer_attempt_closures;
CREATE TRIGGER transfer_attempt_closures_cross_guard BEFORE INSERT ON transfer_attempt_closures FOR EACH ROW EXECUTE FUNCTION guard_transfer_attempt_closure_insert();

CREATE OR REPLACE FUNCTION guard_idempotency_closed_key() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM transfer_attempt_closures WHERE owner_id = NEW.user_id AND key_hash = NEW.key_hash) THEN
      RAISE EXCEPTION 'cannot execute an attempt whose key is closed' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS idempotency_records_closed_key_guard ON idempotency_records;
CREATE TRIGGER idempotency_records_closed_key_guard BEFORE INSERT ON idempotency_records FOR EACH ROW WHEN (NEW.operation = 'create-transfer') EXECUTE FUNCTION guard_idempotency_closed_key();

CREATE OR REPLACE FUNCTION guard_transfer_closed_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM transfer_attempt_closures WHERE owner_id = NEW.owner_id AND client_attempt_id = NEW.client_attempt_id) THEN
      RAISE EXCEPTION 'cannot execute an attempt identity that is closed' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS transfers_closed_attempt_guard ON transfers;
CREATE TRIGGER transfers_closed_attempt_guard BEFORE INSERT ON transfers FOR EACH ROW WHEN (NEW.client_attempt_id IS NOT NULL) EXECUTE FUNCTION guard_transfer_closed_attempt();

DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON transfer_send_gates TO %I', role_name);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON transfer_send_gates FROM %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT ON transfer_attempt_closures TO %I', role_name);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON transfer_attempt_closures FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
`;

export class TransferAttemptRecovery1763000009000 implements MigrationInterface {
  name = 'TransferAttemptRecovery1763000009000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(transferAttemptRecoveryUpSql);
  }

  /** Reverse order, IF EXISTS everywhere. Intended only for wallet_test. */
  async down(q: QueryRunner): Promise<void> {
    await q.query(`
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
    `);
  }
}
