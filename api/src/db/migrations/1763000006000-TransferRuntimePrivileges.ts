import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TransferRuntimePrivileges1763000006000 implements MigrationInterface {
  name='TransferRuntimePrivileges1763000006000';
  async up(q:QueryRunner):Promise<void>{await q.query(`DO $$ DECLARE role_name text; BEGIN
    FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE public.transfers,public.daily_limit_usage,public.otp_challenges,public.idempotency_records TO %I',role_name);
      END IF;
    END LOOP;
  END $$;`);}
  async down(q:QueryRunner):Promise<void>{await q.query(`DO $$ DECLARE role_name text; BEGIN
    FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.transfers,public.daily_limit_usage,public.otp_challenges,public.idempotency_records FROM %I',role_name);
      END IF;
    END LOOP;
  END $$;`);}
}
