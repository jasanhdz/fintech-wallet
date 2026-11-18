import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TransferOtpAndLedgerHardening1763000007000 implements MigrationInterface {
  name='TransferOtpAndLedgerHardening1763000007000';
  async up(q:QueryRunner):Promise<void>{
    await q.query('ALTER TABLE otp_challenges ADD COLUMN demo_code_ciphertext text');
    await q.query('CREATE INDEX ledger_entries_ledger_transaction_id_idx ON ledger_entries(ledger_transaction_id)');
  }
  async down(q:QueryRunner):Promise<void>{
    await q.query('DROP INDEX ledger_entries_ledger_transaction_id_idx');
    await q.query('ALTER TABLE otp_challenges DROP COLUMN demo_code_ciphertext');
  }
}
