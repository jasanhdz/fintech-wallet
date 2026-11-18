import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LedgerTransactionAppendOnly1763000001000 implements MigrationInterface {
  name = 'LedgerTransactionAppendOnly1763000001000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE FUNCTION prevent_ledger_transaction_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger transactions are append-only'; END $$;
      CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION prevent_ledger_transaction_mutation();
      DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ledger_transactions FROM %I',role_name); END IF; END LOOP; END $$;`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    throw new Error('Ledger append-only migration is irreversible.');
  }
}
