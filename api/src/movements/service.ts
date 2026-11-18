import type { DataSource } from 'typeorm';

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
      to_char(le.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
      FROM ledger_entries le
      JOIN ledger_transactions lt ON lt.id=le.ledger_transaction_id AND lt.reference_type='transfer'
      JOIN transfers t ON t.id=lt.reference_id AND t.status='completed'
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
    }));
    const last = page.at(-1) as Record<string, unknown> | undefined;
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ occurredAt: last.occurred_at, id: last.id })).toString('base64url') : null;
    return { items, nextCursor };
  } finally { await runner.release(); }
}
