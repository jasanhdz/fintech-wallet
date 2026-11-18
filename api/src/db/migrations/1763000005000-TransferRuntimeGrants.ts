import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TransferRuntimeGrants1763000005000 implements MigrationInterface {
  name = 'TransferRuntimeGrants1763000005000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('GRANT SELECT,INSERT,UPDATE ON transfers,daily_limit_usage,otp_challenges,idempotency_records TO %I',role_name);
        END IF;
      END LOOP;
    END $$;`);
  }

  async down(q:QueryRunner):Promise<void>{await q.query(`DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON transfers,daily_limit_usage,otp_challenges,idempotency_records FROM %I',role_name); END IF; END LOOP; END $$;`);}
}
