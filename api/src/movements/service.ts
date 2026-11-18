import type { DataSource } from 'typeorm';
import { decryptClabe } from '../security/crypto.js';

export class MovementFault extends Error {
  constructor(readonly status: number, readonly title: string, message: string) { super(message); }
}

type Cursor = { occurredAt: string; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new MovementFault(400, 'Bad Request', 'Parámetros de historial inválidos.');

function parseDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid();
  return new Date(value).toISOString();
}

function parseCursor(value: unknown): Cursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (Buffer.from(decoded).toString('base64url') !== value || !parsed || typeof parsed !== 'object') throw invalid();
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).length !== 2 || typeof cursor.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.occurredAt) || !Number.isFinite(Date.parse(cursor.occurredAt)) || typeof cursor.id !== 'string' || !uuid.test(cursor.id)) throw invalid();
    return { occurredAt: cursor.occurredAt, id: cursor.id };
  } catch { throw invalid(); }
}

export async function listMovements(db: DataSource, userId: string, accountId: string, query: Record<string, unknown>) {
  if (!uuid.test(accountId)) throw new MovementFault(404, 'Not Found', 'Cuenta no encontrada.');
  const from = parseDate(query.from); const to = parseDate(query.to);
  if (from && to && from > to) throw invalid();
  const type = query.type;
  if (type !== undefined && type !== 'debit' && type !== 'credit') throw invalid();
  let limit = 20;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(query.limit)) throw invalid();
    limit = Number.parseInt(query.limit, 10);
  }
  const cursor = parseCursor(query.cursor);
  const runner = db.createQueryRunner(); await runner.connect();
  try {
    const owned = await runner.query('SELECT 1 FROM accounts WHERE id=$1::uuid AND owner_id=$2::uuid', [accountId, userId]);
    if (!owned[0]) throw new MovementFault(404, 'Not Found', 'Cuenta no encontrada.');
    const rows = await runner.query(`SELECT le.id, lt.reference_id AS transfer_id, le.entry_type AS type,
      abs(le.signed_amount_minor)::text AS amount_minor, t.concept, t.reference, t.status,
      to_char(le.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
      to_char(le.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      t.owner_id AS transfer_owner, t.beneficiary_id,
      sa.id AS source_id, sa.owner_id AS source_owner, sa.name AS source_name, sa.clabe_ciphertext AS source_clabe, su.full_name AS sender_name,
      da.id AS dest_id, da.owner_id AS dest_owner, da.name AS dest_name, da.clabe_ciphertext AS dest_clabe,
      b.name AS beneficiary_name, b.clabe_ciphertext AS beneficiary_clabe
      FROM ledger_entries le
      JOIN ledger_transactions lt ON lt.id=le.ledger_transaction_id AND lt.reference_type='transfer'
      JOIN transfers t ON t.id=lt.reference_id AND t.status='completed'
      JOIN accounts sa ON sa.id=t.source_account_id
      JOIN accounts da ON da.id=t.destination_account_id
      LEFT JOIN users su ON su.id=sa.owner_id
      LEFT JOIN beneficiaries b ON b.id=t.beneficiary_id AND b.owner_id=t.owner_id
      WHERE le.account_id=$1::uuid AND le.entry_type IN ('debit','credit')
        AND t.completed_at IS NOT NULL
        AND ($2::timestamptz IS NULL OR t.completed_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR t.completed_at <= $3::timestamptz)
        AND ($4::text IS NULL OR le.entry_type=$4::text)
        AND ($5::timestamptz IS NULL OR (le.created_at,le.id)<($5::timestamptz,$6::uuid))
      ORDER BY le.created_at DESC, le.id DESC LIMIT $7`,
    [accountId, from ?? null, to ?? null, type ?? null, cursor?.occurredAt ?? null, cursor?.id ?? null, limit + 1]);
    const hasMore = rows.length > limit; const page = rows.slice(0, limit);
    const items = page.map((row: Record<string, unknown>) => ({
      id: row.id, transferId: row.transfer_id, type: row.type, amountMinor: row.amount_minor,
      currency: 'MXN', concept: row.concept, reference: row.reference, status: row.status,
      occurredAt: String(row.occurred_at),
      counterparty: counterparty(row, userId),
    }));
    const last = page.at(-1) as Record<string, unknown> | undefined;
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ occurredAt: last.cursor_at, id: last.id })).toString('base64url') : null;
    return { items, nextCursor };
  } finally { await runner.release(); }
}

const masked = (ciphertext: unknown) => { const clabe = decryptClabe(String(ciphertext)); return `${clabe.slice(0, 3)}•••••••••••${clabe.slice(-4)}`; };

/**
 * The other side of a movement, from the viewpoint of the account owner. Sent (debit): the beneficiary as the
 * sender registered it, or the own destination account. Received (credit): the own source account, or the sending
 * user's name with the source CLABE masked. `ownAccountId` appears only when that side is an account of this user.
 */
function counterparty(row: Record<string, unknown>, userId: string) {
  if (row.type === 'debit') {
    if (row.beneficiary_id && row.beneficiary_name !== null && row.beneficiary_name !== undefined) {
      return { name: String(row.beneficiary_name), clabeMasked: masked(row.beneficiary_clabe), ...(row.dest_owner === userId ? { ownAccountId: String(row.dest_id) } : {}) };
    }
    return { name: String(row.dest_name), clabeMasked: masked(row.dest_clabe), ...(row.dest_owner === userId ? { ownAccountId: String(row.dest_id) } : {}) };
  }
  if (row.source_owner === userId) return { name: String(row.source_name), clabeMasked: masked(row.source_clabe), ownAccountId: String(row.source_id) };
  return { name: String(row.sender_name ?? 'Usuario Billetera'), clabeMasked: masked(row.source_clabe) };
}
