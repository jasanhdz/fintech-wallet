import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TransferRuntimePrivileges1763000006000 implements MigrationInterface {
  name='TransferRuntimePrivileges1763000006000';
  async up(q:QueryRunner):Promise<void>{await q.query("GRANT SELECT,INSERT,UPDATE ON TABLE public.transfers,public.daily_limit_usage,public.otp_challenges,public.idempotency_records TO wallet_runtime_test,wallet_runtime_dev");}
  async down(q:QueryRunner):Promise<void>{await q.query("REVOKE ALL ON TABLE public.transfers,public.daily_limit_usage,public.otp_challenges,public.idempotency_records FROM wallet_runtime_test,wallet_runtime_dev");}
}
