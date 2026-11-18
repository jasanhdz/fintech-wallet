import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Transfers1763000004000 implements MigrationInterface {
  name = 'Transfers1763000004000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
      source_account_id uuid NOT NULL REFERENCES accounts(id), destination_account_id uuid NOT NULL REFERENCES accounts(id),
      beneficiary_id uuid REFERENCES beneficiaries(id), amount_minor bigint NOT NULL CHECK(amount_minor>0),
      currency char(3) NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'), concept varchar(40) NOT NULL,
      reference varchar(7) NOT NULL CHECK(reference ~ '^[0-9]{1,7}$'), status varchar(32) NOT NULL CHECK(status IN ('awaiting_confirmation','processing','completed','rejected')),
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, receipt_reference varchar(64), request_id varchar(128),
      CHECK(source_account_id<>destination_account_id)
    );
    CREATE INDEX transfers_owner_created_idx ON transfers(owner_id,created_at DESC,id DESC);
    CREATE TABLE daily_limit_usage(owner_id uuid NOT NULL REFERENCES users(id),business_date date NOT NULL,currency char(3) NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'),outgoing_minor bigint NOT NULL DEFAULT 0 CHECK(outgoing_minor>=0),PRIMARY KEY(owner_id,business_date,currency));
    CREATE TABLE idempotency_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),operation varchar(40) NOT NULL,key_hash char(64) NOT NULL,payload_hash char(64) NOT NULL,transfer_id uuid NOT NULL REFERENCES transfers(id),response_status smallint NOT NULL,response_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,UNIQUE(user_id,operation,key_hash));
    CREATE TABLE otp_challenges(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transfer_id uuid NOT NULL UNIQUE REFERENCES transfers(id),code_hash char(64) NOT NULL,expires_at timestamptz NOT NULL,attempt_count integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL CHECK(max_attempts>0),consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION prevent_transfer_ledger_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.reference_type='transfer' THEN RAISE EXCEPTION 'transfer ledger transaction is immutable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER transfer_ledger_immutable BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION prevent_transfer_ledger_update();
    DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON transfers,daily_limit_usage,otp_challenges TO %I',role_name); EXECUTE format('GRANT SELECT,INSERT ON idempotency_records TO %I',role_name); END IF; END LOOP; END $$;`);
  }

  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE otp_challenges,idempotency_records,daily_limit_usage,transfers CASCADE; DROP FUNCTION prevent_transfer_ledger_update() CASCADE'); }
}
