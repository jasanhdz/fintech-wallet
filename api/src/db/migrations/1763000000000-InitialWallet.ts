import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialWallet1763000000000 implements MigrationInterface {
  name = 'InitialWallet1763000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(254) NOT NULL UNIQUE, full_name varchar(120) NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES users(id), name varchar(120) NOT NULL, kind varchar(16) NOT NULL CHECK (kind IN ('checking','savings','clearing')), currency char(3) NOT NULL DEFAULT 'MXN' CHECK (currency='MXN'), balance_minor bigint NOT NULL DEFAULT 0, clabe_ciphertext text, clabe_lookup_hash char(64) UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), CHECK (kind='clearing' OR balance_minor >= 0), CHECK ((kind='clearing' AND owner_id IS NULL) OR (kind <> 'clearing' AND owner_id IS NOT NULL)));
      CREATE INDEX accounts_owner_created_idx ON accounts(owner_id, created_at);
      CREATE TABLE ledger_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_type varchar(32) NOT NULL, reference_id uuid, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE ledger_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id), account_id uuid NOT NULL REFERENCES accounts(id), signed_amount_minor bigint NOT NULL CHECK(signed_amount_minor <> 0), currency char(3) NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'), entry_type varchar(32) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX ledger_entries_account_created_idx ON ledger_entries(account_id, created_at DESC, id DESC);
      CREATE FUNCTION assert_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target_id uuid; entry_total numeric; BEGIN target_id := COALESCE(NEW.ledger_transaction_id, OLD.ledger_transaction_id); SELECT COALESCE(sum(signed_amount_minor),0) INTO entry_total FROM ledger_entries WHERE ledger_transaction_id=target_id; IF entry_total <> 0 THEN RAISE EXCEPTION 'ledger transaction must balance'; END IF; RETURN NULL; END $$;
      CREATE CONSTRAINT TRIGGER ledger_entries_balance AFTER INSERT OR UPDATE OR DELETE ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();
      CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger is append-only'; END $$;
      CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
      CREATE TABLE refresh_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash char(64) NOT NULL UNIQUE, client varchar(8) NOT NULL CHECK(client IN ('web','mobile')), expires_at timestamptz NOT NULL, rotated_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX refresh_sessions_user_idx ON refresh_sessions(user_id);
      CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action varchar(80) NOT NULL, resource_type varchar(80) NOT NULL, resource_id uuid, request_id varchar(128), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
      CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit is append-only'; END $$;
      CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
      DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE ON users, accounts, refresh_sessions TO %I',role_name); EXECUTE format('GRANT SELECT, INSERT ON ledger_transactions, ledger_entries, audit_events TO %I',role_name); EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',role_name); EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries, audit_events FROM %I',role_name); END IF; END LOOP; END $$;`);
  }

  async down(q: QueryRunner): Promise<void> {
    void q;
    throw new Error('The initial wallet schema migration is irreversible.');
  }
}
