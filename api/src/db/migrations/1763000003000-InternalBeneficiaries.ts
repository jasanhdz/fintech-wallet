import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InternalBeneficiaries1763000003000 implements MigrationInterface {
  name = 'InternalBeneficiaries1763000003000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE beneficiaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id),
      destination_account_id uuid NOT NULL REFERENCES accounts(id),
      name varchar(120) NOT NULL,
      alias varchar(80) NOT NULL,
      clabe_ciphertext text NOT NULL,
      clabe_lookup_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT beneficiaries_owner_clabe_unique UNIQUE(owner_id, clabe_lookup_hash)
    );
    CREATE INDEX beneficiaries_owner_created_idx ON beneficiaries(owner_id, created_at, id);
    DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['wallet_runtime_dev','wallet_runtime_test'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('GRANT SELECT, INSERT ON beneficiaries TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE beneficiaries');
  }
}
