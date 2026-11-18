import type { DataSource, QueryRunner } from 'typeorm';
import { decryptClabe, hashSecret } from '../security/crypto.js';
import { ensureSendGate, expireDue, lockAttemptKey } from './service.js';
import { TransferFault, UUID_PATTERN, badRequest, conflictFault, parseEpoch } from './faults.js';

/**
 * Round 8 (F-26): authoritative listing and closing of the authenticated user's transfer attempts.
 * Everything is scoped to the token's user: another user's attempt behaves exactly like a nonexistent one.
 */

const STATUSES = ['awaiting_confirmation', 'completed', 'expired', 'cancelled', 'rejected', 'voided'] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
type Kind = 'transfer' | 'closure';
type Cursor = { at: string; kind: Kind; id: string };
type Run = (sql: string, parameters: unknown[]) => Promise<unknown>;
const invalid = () => badRequest('Parámetros de intentos inválidos.');

function parseDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}

/** Opaque keyset cursor: canonical base64url of `{at (µs, UTC), kind, id}`; any alteration is a 400. */
export function encodeAttemptCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at, kind: cursor.kind, id: cursor.id })).toString('base64url');
}

export function parseAttemptCursor(value: unknown): Cursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (Buffer.from(decoded).toString('base64url') !== value || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).length !== 3 || typeof cursor.at !== 'string' || !CURSOR_AT.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))
      || (cursor.kind !== 'transfer' && cursor.kind !== 'closure') || typeof cursor.id !== 'string' || !UUID_PATTERN.test(cursor.id)) throw invalid();
    const canonical: Cursor = { at: cursor.at, kind: cursor.kind as Kind, id: cursor.id };
    if (encodeAttemptCursor(canonical) !== value) throw invalid();
    return canonical;
  } catch { throw invalid(); }
}

export type AttemptQuery = { statuses?: string[]; from?: string; to?: string; attemptId?: string; limit: number; cursor?: Cursor };

/** Validates the query string of `GET /transfer-attempts` (every malformed value is a 400). */
export function parseAttemptQuery(query: Record<string, unknown>): AttemptQuery {
  let statuses: string[] | undefined;
  if (query.status !== undefined) {
    if (typeof query.status !== 'string') throw invalid();
    statuses = query.status.split(',');
    if (statuses.some((status) => !(STATUSES as readonly string[]).includes(status))) throw invalid();
  }
  const from = parseDate(query.from); const to = parseDate(query.to);
  if (from && to && Date.parse(from) > Date.parse(to)) throw invalid();
  let attemptId: string | undefined;
  if (query.attemptId !== undefined) {
    if (typeof query.attemptId !== 'string' || !UUID_PATTERN.test(query.attemptId)) throw invalid();
    attemptId = query.attemptId.toLowerCase();
  }
  let limit = 20;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit)) throw invalid();
    limit = Number.parseInt(query.limit, 10);
  }
  return { statuses, from, to, attemptId, limit, cursor: parseAttemptCursor(query.cursor) };
}

type Only = { kind: Kind; id: string };

/**
 * Union of the owner's transfers and closures, total order `createdAt DESC, kind DESC ('transfer' > 'closure'),
 * id DESC`, keyset (no OFFSET). Uses transfers_owner_created_idx and transfer_attempt_closures_owner_closed_idx.
 */
async function selectAttempts(run: Run, userId: string, query: Partial<AttemptQuery> & { only?: Only }, take: number) {
  const rows = await run(`WITH attempts AS (
      SELECT 'transfer'::text AS kind, t.id, t.created_at AS at, t.client_attempt_id AS attempt_id, t.id AS transfer_id, t.status::text AS status,
        t.amount_minor::text AS amount_minor, t.concept::text AS concept, t.reference::text AS reference, t.source_account_id,
        t.completed_at, t.closed_at, o.expires_at, NULL::smallint AS problem_status, NULL::text AS problem_detail,
        b.id AS b_id, b.name::text AS b_name, b.clabe_ciphertext AS b_clabe,
        da.id AS dest_id, da.owner_id AS dest_owner, da.name::text AS dest_name, da.clabe_ciphertext AS dest_clabe
      FROM transfers t
      JOIN accounts da ON da.id=t.destination_account_id
      LEFT JOIN beneficiaries b ON b.id=t.beneficiary_id AND b.owner_id=t.owner_id
      LEFT JOIN otp_challenges o ON o.transfer_id=t.id
      WHERE t.owner_id=$1::uuid
      UNION ALL
      SELECT 'closure'::text, c.id, c.closed_at, c.client_attempt_id, NULL::uuid, c.status::text,
        c.amount_minor::text, NULL::text, NULL::text, NULL::uuid,
        NULL::timestamptz, c.closed_at, NULL::timestamptz, c.problem_status, c.problem_detail::text,
        NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text
      FROM transfer_attempt_closures c WHERE c.owner_id=$1::uuid)
    SELECT a.*,
      to_char(a.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      to_char(a.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at_text,
      to_char(a.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS completed_at_text,
      to_char(a.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at_text,
      to_char(a.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at_text
    FROM attempts a
    WHERE ($2::text[] IS NULL OR a.status=ANY($2::text[]))
      AND ($3::timestamptz IS NULL OR a.at >= $3::timestamptz)
      AND ($4::timestamptz IS NULL OR a.at <= $4::timestamptz)
      AND ($5::uuid IS NULL OR a.attempt_id=$5::uuid)
      AND ($6::timestamptz IS NULL OR (a.at, a.kind, a.id) < ($6::timestamptz, $7::text, $8::uuid))
      AND ($9::text IS NULL OR (a.kind=$9::text AND a.id=$10::uuid))
    ORDER BY a.at DESC, a.kind DESC, a.id DESC
    LIMIT $11`,
  [userId, query.statuses ?? null, query.from ?? null, query.to ?? null, query.attemptId ?? null,
    query.cursor?.at ?? null, query.cursor?.kind ?? null, query.cursor?.id ?? null,
    query.only?.kind ?? null, query.only?.id ?? null, take]);
  return rows as AttemptRow[];
}

type AttemptRow = Record<string, unknown> & { kind: Kind; id: string; cursor_at: string };
const masked = (ciphertext: unknown) => { const clabe = decryptClabe(String(ciphertext)); return `${clabe.slice(0, 3)}•••••••••••${clabe.slice(-4)}`; };
const nullable = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** `TransferAttemptSummary`: never a full CLABE, demo code, OTP, key, key hash or requestId. */
function summary(row: AttemptRow, userId: string) {
  let destination: { name: string; clabeMasked: string; ownAccountId?: string } | null = null;
  if (row.kind === 'transfer') {
    const own = row.dest_owner === userId ? { ownAccountId: String(row.dest_id) } : {};
    destination = row.b_id ? { name: String(row.b_name), clabeMasked: masked(row.b_clabe), ...own } : { name: String(row.dest_name), clabeMasked: masked(row.dest_clabe), ...own };
  }
  return {
    attemptId: nullable(row.attempt_id), transferId: nullable(row.transfer_id), status: String(row.status),
    amountMinor: nullable(row.amount_minor), currency: 'MXN', concept: nullable(row.concept), reference: nullable(row.reference),
    sourceAccountId: nullable(row.source_account_id), destination,
    createdAt: String(row.created_at_text), completedAt: nullable(row.completed_at_text), closedAt: nullable(row.closed_at_text), expiresAt: nullable(row.expires_at_text),
    problem: row.problem_status === null || row.problem_status === undefined ? null : { status: Number(row.problem_status), detail: String(row.problem_detail) },
  };
}

const readEpoch = async (run: Run, userId: string) => {
  const rows = await run('SELECT epoch::text AS epoch FROM transfer_send_gates WHERE owner_id=$1', [userId]) as Array<{ epoch: string }>;
  return rows[0]?.epoch ?? '0';
};

/** `GET /transfer-attempts`. Closes due OTP attempts first (like `GET /transfers/{id}`), then reads. */
export async function listTransferAttempts(db: DataSource, userId: string, rawQuery: Record<string, unknown>, requestId: string) {
  const query = parseAttemptQuery(rawQuery);
  const runner = db.createQueryRunner(); await runner.connect();
  try {
    const run: Run = (sql, parameters) => runner.query(sql, parameters);
    await expireDue(run, userId, null, requestId);
    const rows = await selectAttempts(run, userId, query, query.limit + 1);
    const page = rows.slice(0, query.limit); const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeAttemptCursor({ at: last.cursor_at, kind: last.kind, id: last.id }) : null;
    return { items: page.map((row) => summary(row, userId)), nextCursor, sendEpoch: await readEpoch(run, userId) };
  } finally { await runner.release(); }
}

async function one(runner: QueryRunner, userId: string, only: Only) {
  const rows = await selectAttempts((sql, parameters) => runner.query(sql, parameters), userId, { only }, 1);
  if (!rows[0]) throw new Error('attempt row vanished inside its own transaction');
  return summary(rows[0], userId);
}

/** Closes an own `awaiting_confirmation` transfer (row locked; serialized with confirm) as cancelled, or expired if its OTP is due. */
async function closePending(runner: QueryRunner, userId: string, transferId: string, via: 'void' | 'void_all', requestId: string) {
  const rows = await runner.query("SELECT t.status,(o.expires_at IS NOT NULL AND o.expires_at<=now()) AS otp_expired FROM transfers t LEFT JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1 AND t.owner_id=$2 FOR UPDATE OF t", [transferId, userId]);
  const row = rows[0] as { status: string; otp_expired: boolean } | undefined;
  if (!row || row.status !== 'awaiting_confirmation') return false;
  const next = row.otp_expired ? 'expired' : 'cancelled';
  await runner.query('UPDATE transfers SET status=$2,closed_at=now() WHERE id=$1', [transferId, next]);
  await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,$2,'transfer',$3,$4,jsonb_build_object('via',$5::text))", [userId, `transfer.${next}`, transferId, requestId, via]);
  return true;
}

/**
 * `POST /transfer-attempts/void`. Waits for the user's in-flight sends (gate FOR UPDATE) and the key's lock, then:
 * executed attempt → `transfer_found` (closing it if still pending; money already moved is never reversed);
 * existing closure → its status; nothing → a permanent `voided` closure. Idempotent by state.
 */
export async function voidTransferAttempt(db: DataSource, userId: string, body: unknown, requestId: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Datos de anulación inválidos.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((name) => name !== 'idempotencyKey' && name !== 'attemptId')) throw badRequest('Datos de anulación inválidos.');
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) throw badRequest('Datos de anulación inválidos.');
  if (input.attemptId !== undefined && (typeof input.attemptId !== 'string' || !UUID_PATTERN.test(input.attemptId))) throw badRequest('Datos de anulación inválidos.');
  const attemptId = typeof input.attemptId === 'string' ? input.attemptId.toLowerCase() : null;
  const keyHash = hashSecret(key);
  await ensureSendGate(db, userId);
  const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try {
    await runner.query('SELECT epoch FROM transfer_send_gates WHERE owner_id=$1 FOR UPDATE', [userId]);
    await lockAttemptKey(runner, userId, keyHash);
    const record = await runner.query("SELECT i.transfer_id,t.client_attempt_id FROM idempotency_records i JOIN transfers t ON t.id=i.transfer_id WHERE i.user_id=$1 AND i.operation='create-transfer' AND i.key_hash=$2", [userId, keyHash]) as Array<{ transfer_id: string; client_attempt_id: string | null }>;
    const byAttempt = attemptId ? await runner.query('SELECT id FROM transfers WHERE owner_id=$1 AND client_attempt_id=$2', [userId, attemptId]) as Array<{ id: string }> : [];
    let resolution: 'transfer_found' | 'rejected' | 'voided';
    let attempt;
    if (record[0]) {
      const found = record[0];
      if (attemptId && ((found.client_attempt_id && found.client_attempt_id !== attemptId) || (byAttempt[0] && byAttempt[0].id !== found.transfer_id))) throw conflictFault();
      await closePending(runner, userId, found.transfer_id, 'void', requestId);
      resolution = 'transfer_found'; attempt = await one(runner, userId, { kind: 'transfer', id: found.transfer_id });
    } else if (byAttempt[0]) {
      throw conflictFault();
    } else {
      const closures = await runner.query('SELECT id,key_hash=$2 AS by_key,client_attempt_id,status FROM transfer_attempt_closures WHERE owner_id=$1 AND (key_hash=$2 OR ($3::uuid IS NOT NULL AND client_attempt_id=$3::uuid))', [userId, keyHash, attemptId]) as Array<{ id: string; by_key: boolean; client_attempt_id: string | null; status: 'voided' | 'rejected' }>;
      const byKey = closures.find((closure) => closure.by_key);
      if (closures.some((closure) => !closure.by_key) || (byKey && attemptId && byKey.client_attempt_id && byKey.client_attempt_id !== attemptId)) throw conflictFault();
      if (byKey) {
        resolution = byKey.status; attempt = await one(runner, userId, { kind: 'closure', id: byKey.id });
      } else {
        const inserted = await runner.query("INSERT INTO transfer_attempt_closures(owner_id,key_hash,client_attempt_id,status,request_id) VALUES($1,$2,$3,'voided',$4) RETURNING id", [userId, keyHash, attemptId, requestId]) as Array<{ id: string }>;
        await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'transfer.attempt_voided','transfer_attempt',$2,$3,'{}')", [userId, inserted[0]!.id, requestId]);
        resolution = 'voided'; attempt = await one(runner, userId, { kind: 'closure', id: inserted[0]!.id });
      }
    }
    await runner.commitTransaction();
    return { resolution, attempt };
  } catch (error) { if (runner.isTransactionActive) await runner.rollbackTransaction(); throw error; } finally { await runner.release(); }
}

/**
 * `POST /transfer-attempts/void-all`. With `fromEpoch` equal to the current epoch: epoch+1 (vetoes every not-yet-arrived
 * send of an older epoch) and every own `awaiting_confirmation` attempt is closed. Older `fromEpoch`: no-op. Newer: 400.
 */
export async function voidAllTransferAttempts(db: DataSource, userId: string, body: unknown, requestId: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((name) => name !== 'fromEpoch')) throw badRequest('Datos de anulación inválidos.');
  const fromEpoch = parseEpoch((body as Record<string, unknown>).fromEpoch);
  if (fromEpoch === undefined) throw badRequest('Datos de anulación inválidos.');
  await ensureSendGate(db, userId);
  const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try {
    const gate = await runner.query('SELECT epoch::text AS epoch FROM transfer_send_gates WHERE owner_id=$1 FOR UPDATE', [userId]) as Array<{ epoch: string }>;
    const current = BigInt(gate[0]!.epoch);
    if (fromEpoch > current) throw new TransferFault(400, 'Bad Request', 'La época indicada no existe.');
    if (fromEpoch < current) { await runner.commitTransaction(); return { sendEpoch: current.toString(), advanced: false, closedTransferIds: [] as string[] }; }
    const next = current + 1n;
    await runner.query('UPDATE transfer_send_gates SET epoch=$2::bigint,updated_at=now() WHERE owner_id=$1', [userId, next.toString()]);
    const pending = await runner.query("SELECT id FROM transfers WHERE owner_id=$1 AND status='awaiting_confirmation' ORDER BY id", [userId]) as Array<{ id: string }>;
    const closedTransferIds: string[] = [];
    for (const row of pending) if (await closePending(runner, userId, row.id, 'void_all', requestId)) closedTransferIds.push(row.id);
    await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'transfer.send_epoch_advanced','user',$1,$2,jsonb_build_object('from',$3::text,'to',$4::text,'closedCount',$5::int))", [userId, requestId, current.toString(), next.toString(), closedTransferIds.length]);
    await runner.commitTransaction();
    return { sendEpoch: next.toString(), advanced: true, closedTransferIds };
  } catch (error) { if (runner.isTransactionActive) await runner.rollbackTransaction(); throw error; } finally { await runner.release(); }
}
