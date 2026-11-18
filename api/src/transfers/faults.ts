/** RFC 7807 `type` values added in contract 0.4.0 (round 8). Every other problem keeps `about:blank`. */
export const ATTEMPT_VOIDED = 'urn:billetera:problem:transfer-attempt-voided';
export const ATTEMPT_REJECTED = 'urn:billetera:problem:transfer-attempt-rejected';
export const ATTEMPT_CONFLICT = 'urn:billetera:problem:transfer-attempt-conflict';

export class TransferFault extends Error {
  constructor(readonly status: number, readonly title: string, message: string, readonly type: string = 'about:blank') { super(message); }
}

const titles: Record<number, string> = { 404: 'Not Found', 422: 'Unprocessable Entity', 429: 'Too Many Requests' };

/** Terminal: the identity/key was voided, or it was sent with an epoch older than the current one. No money moved. */
export const voidedFault = () => new TransferFault(409, 'Conflict', 'Esta transferencia fue anulada; no se realizó ningún cargo por esta operación.', ATTEMPT_VOIDED);
/** Not terminal: the attempt identity is bound to another key (or the key to another identity). */
export const conflictFault = () => new TransferFault(409, 'Conflict', 'El intento ya está ligado a otra operación.', ATTEMPT_CONFLICT);
/** Terminal business rejection (404/422/429) persisted for an identity; replays repeat it. */
export const rejectedFault = (status: number, detail: string) => new TransferFault(status, titles[status] ?? 'Unprocessable Entity', detail, ATTEMPT_REJECTED);
export const badRequest = (detail: string) => new TransferFault(400, 'Bad Request', detail);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EPOCH_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
const MAX_BIGINT = 9223372036854775807n;

/** Parses a send epoch (`Transfer-Send-Epoch` header, `fromEpoch`): decimal string within PostgreSQL bigint. */
export function parseEpoch(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !EPOCH_PATTERN.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > MAX_BIGINT ? undefined : parsed;
}

export type AttemptHeaders = { attemptId: string; epoch: bigint };

/** Step 1 of round-8 createTransfer: both headers or none; UUID identity; epoch `^(0|[1-9][0-9]{0,18})$`. */
export function parseAttemptHeaders(attemptId: string | undefined, epoch: string | undefined): AttemptHeaders | undefined {
  if (attemptId === undefined && epoch === undefined) return undefined;
  if (attemptId === undefined || epoch === undefined) throw badRequest('Transfer-Attempt-Id y Transfer-Send-Epoch deben enviarse juntas.');
  if (!UUID_PATTERN.test(attemptId)) throw badRequest('Transfer-Attempt-Id inválido.');
  const parsed = parseEpoch(epoch);
  if (parsed === undefined) throw badRequest('Transfer-Send-Epoch inválida.');
  return { attemptId: attemptId.toLowerCase(), epoch: parsed };
}
