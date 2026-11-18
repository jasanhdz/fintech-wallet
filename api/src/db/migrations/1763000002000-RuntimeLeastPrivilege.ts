import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RuntimeLeastPrivilege1763000002000 implements MigrationInterface {
  name = 'RuntimeLeastPrivilege1763000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('GRANT SELECT, INSERT, UPDATE ON users, accounts, refresh_sessions TO %I', role_name);
          EXECUTE format('GRANT SELECT, INSERT ON ledger_transactions, ledger_entries, audit_events TO %I', role_name);
          EXECUTE format('REVOKE DELETE, TRUNCATE ON users, accounts, refresh_sessions FROM %I', role_name);
          EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ledger_transactions, ledger_entries, audit_events FROM %I', role_name);
          EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    throw new Error('Runtime privilege hardening migration is irreversible.');
  }
}
