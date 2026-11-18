import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F-10: auditable terminal states for OTP-pending transfers.
 *
 * - `expired`: the OTP challenge of an `awaiting_confirmation` attempt passed its `expires_at`.
 * - `cancelled`: the owner explicitly abandoned an `awaiting_confirmation` attempt.
 *
 * Rows are never deleted. `closed_at` records when the attempt reached one of these states and is
 * required exactly for them. A trigger forbids leaving any terminal state, so an expired/cancelled
 * attempt can never become `completed` (and therefore can never post ledger entries), even if
 * application code regressed.
 */
export class TransferTerminalStates1763000008000 implements MigrationInterface {
  name = 'TransferTerminalStates1763000008000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transfers DROP CONSTRAINT transfers_status_check`);
    await q.query(`ALTER TABLE transfers ADD CONSTRAINT transfers_status_check CHECK (status IN ('awaiting_confirmation','processing','completed','rejected','expired','cancelled'))`);
    await q.query(`ALTER TABLE transfers ADD COLUMN closed_at timestamptz`);
    await q.query(`ALTER TABLE transfers ADD CONSTRAINT transfers_closed_at_check CHECK ((status IN ('expired','cancelled')) = (closed_at IS NOT NULL))`);
    await q.query(`CREATE INDEX transfers_owner_pending_idx ON transfers(owner_id,id) WHERE status='awaiting_confirmation'`);
    await q.query(`CREATE FUNCTION prevent_transfer_terminal_exit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status IN ('completed','rejected','expired','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
          RAISE EXCEPTION 'transfer % is in terminal state %', OLD.id, OLD.status;
        END IF;
        IF NEW.status IN ('expired','cancelled') AND OLD.status <> 'awaiting_confirmation' AND NEW.status IS DISTINCT FROM OLD.status THEN
          RAISE EXCEPTION 'only awaiting_confirmation transfers can become %', NEW.status;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER transfers_terminal_state_guard BEFORE UPDATE OF status ON transfers FOR EACH ROW EXECUTE FUNCTION prevent_transfer_terminal_exit()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER transfers_terminal_state_guard ON transfers`);
    await q.query(`DROP FUNCTION prevent_transfer_terminal_exit()`);
    await q.query(`DROP INDEX transfers_owner_pending_idx`);
    await q.query(`ALTER TABLE transfers DROP CONSTRAINT transfers_closed_at_check`);
    await q.query(`ALTER TABLE transfers DROP COLUMN closed_at`);
    await q.query(`ALTER TABLE transfers DROP CONSTRAINT transfers_status_check`);
    await q.query(`ALTER TABLE transfers ADD CONSTRAINT transfers_status_check CHECK (status IN ('awaiting_confirmation','processing','completed','rejected'))`);
  }
}
