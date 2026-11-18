// WF-T5 pure helpers for W10 (código), W11 (envío/verificación) and W12 (comprobante). No requests, no storage:
// they only classify answers the Web already receives and format what it already has.
import { formatMxnFromMinor } from '@fintech-wallet/shared';

/** Problem fields the W10 mapping reads (DEP-2: `status` + literal `detail` of `api/src/transfers/service.ts`). */
export type ProblemLike = { status: number; type?: string; title?: string; detail?: string };

export type ConfirmFailure =
  | 'insufficient_balance' | 'daily_limit' // W13 (unchanged mapping, checked first)
  | 'wrong_code' | 'expired' | 'attempts_exhausted' | 'conflict' // W10-V8 / V9 / V10 / F1 409
  | 'unconfirmed'; // no answer, 5xx or anything else: «No se confirmó la respuesta…»

/**
 * W10-F1: maps a `POST /transfers/{id}/confirm` failure. `problem` is `null` when there was no HTTP answer.
 * The W13 cases keep the pre-existing `definitiveRejection` rule (balance/limit words anywhere in the problem).
 */
export function classifyConfirmFailure(problem: ProblemLike | null): ConfirmFailure {
  if (!problem) return 'unconfirmed';
  const reason = `${problem.type ?? ''} ${problem.title ?? ''} ${problem.detail ?? ''}`;
  if (/insufficient|saldo/i.test(reason)) return 'insufficient_balance';
  if (/limit|l[ií]mite/i.test(reason)) return 'daily_limit';
  const detail = (problem.detail ?? '').trim();
  if (problem.status === 422 && detail === 'Código incorrecto.') return 'wrong_code';
  if (problem.status === 422 && detail === 'El código expiró.') return 'expired';
  if (problem.status === 429 && detail === 'Se agotaron los intentos.') return 'attempts_exhausted';
  if (problem.status === 409) return 'conflict';
  return 'unconfirmed';
}

/** Whole seconds left until `expiresAt` (never negative); `null` when the server sent no expiry. */
export function secondsLeft(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - nowMs) / 1000));
}

/** `mm:ss` for the W10-V1 countdown chip. */
export function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** W10-V1: the chip turns to the error tones under one minute. */
export const countdownUrgent = (seconds: number) => seconds < 60;

/** Only digits, at most six (the single accessible OTP input, A11Y-11). */
export const sanitizeCode = (raw: string) => raw.replace(/\D/g, '').slice(0, 6);

/** W10-V3: «Código incompleto (n de 6 dígitos ingresados)». */
export const incompleteLabel = (length: number) => `Código incompleto (${length} de 6 dígitos ingresados)`;

/** D-13: the receipt's folio is the server receipt reference, or the transfer id when there is none. */
export const folioOf = (transfer: { id: string; receiptReference?: string | null }) => transfer.receiptReference || transfer.id;

/** W12-V5 own accounts: «− $1,500.00» / «+ $1,500.00» chips (sign in text, A11Y-08; single figure, no «MXN»). */
export function signedChip(sign: '−' | '+', minor: string) {
  return `${sign} ${formatMxnFromMinor(minor).replace(/ MXN$/, '')}`;
}

/** W11-F1: truthful copy for the action the button really performs. */
export type VerifyAction = 'query' | 'resend';
export const VERIFY_COPY: Record<VerifyAction, { button: string; busy: string; note: string; busyNote: string }> = {
  query: {
    button: 'Consultar estado',
    busy: 'Consultando…',
    note: 'No reenviamos tu transferencia. Consultamos el estado de este mismo intento.',
    busyNote: 'No reenviamos tu transferencia. Consultamos el estado de este mismo intento.',
  },
  resend: {
    button: 'Reintentar el mismo envío',
    busy: 'Reintentando el mismo envío…',
    note: 'Se repetirá la misma solicitud con su misma clave de operación; no se crea un intento nuevo.',
    busyNote: 'Estamos repitiendo la misma solicitud con su misma clave de operación; no se crea un intento nuevo.',
  },
};
