// WF-T5 unit tests for the W10/W11/W12 pure helpers (confirm mapping, countdown, copy per real action).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VERIFY_COPY, classifyConfirmFailure, countdownLabel, countdownUrgent, folioOf, incompleteLabel, sanitizeCode, secondsLeft, signedChip,
} from '../src/transfer-outcome.js';

const p = (status: number, detail: string, title = 'Unprocessable Entity') => ({ status, title, detail, type: 'about:blank' });

test('W10-F1: confirm failures map by status + literal detail; W13 keeps priority', () => {
  assert.equal(classifyConfirmFailure(null), 'unconfirmed');
  assert.equal(classifyConfirmFailure(p(422, 'Código incorrecto.')), 'wrong_code');
  assert.equal(classifyConfirmFailure(p(422, 'El código expiró.')), 'expired');
  assert.equal(classifyConfirmFailure(p(429, 'Se agotaron los intentos.', 'Too Many Requests')), 'attempts_exhausted');
  assert.equal(classifyConfirmFailure(p(422, 'Saldo insuficiente.')), 'insufficient_balance');
  assert.equal(classifyConfirmFailure(p(429, 'Se excedió el límite diario.', 'Too Many Requests')), 'daily_limit');
  assert.equal(classifyConfirmFailure(p(409, 'La transferencia ya no puede confirmarse.', 'Conflict')), 'conflict');
  assert.equal(classifyConfirmFailure(p(503, 'Servicio no disponible.', 'Service Unavailable')), 'unconfirmed');
  // Same detail with another status is not guessed.
  assert.equal(classifyConfirmFailure(p(400, 'Código incorrecto.', 'Bad Request')), 'unconfirmed');
  assert.equal(classifyConfirmFailure(p(422, 'Se agotaron los intentos.')), 'unconfirmed');
});

test('W10-V1/F2: countdown from expiresAt, mm:ss, urgent under one minute, never negative', () => {
  const now = Date.parse('2026-11-17T16:00:00.000Z');
  assert.equal(secondsLeft(null, now), null);
  assert.equal(secondsLeft(undefined, now), null);
  assert.equal(secondsLeft('no-date', now), null);
  assert.equal(secondsLeft('2026-11-17T16:04:09.000Z', now), 249);
  assert.equal(secondsLeft('2026-11-17T16:00:00.400Z', now), 1);
  assert.equal(secondsLeft('2026-11-17T15:59:00.000Z', now), 0);
  assert.equal(countdownLabel(249), '04:09');
  assert.equal(countdownLabel(0), '00:00');
  assert.equal(countdownUrgent(60), false);
  assert.equal(countdownUrgent(59), true);
});

test('A11Y-11 / W10-V3: single input keeps six digits; incomplete copy', () => {
  assert.equal(sanitizeCode(' 12-34 56 78'), '123456');
  assert.equal(sanitizeCode('abc'), '');
  assert.equal(incompleteLabel(3), 'Código incompleto (3 de 6 dígitos ingresados)');
});

test('D-13 / W12-V5: folio and signed chips', () => {
  assert.equal(folioOf({ id: 'id-1', receiptReference: 'RCPT-1' }), 'RCPT-1');
  assert.equal(folioOf({ id: 'id-1', receiptReference: null }), 'id-1');
  assert.equal(signedChip('−', '150000'), '− $1,500.00');
  assert.equal(signedChip('+', '5'), '+ $0.05');
});

test('W11-F1: copy follows the real action and never promises «no se reenvía» when it resends', () => {
  assert.equal(VERIFY_COPY.query.button, 'Consultar estado');
  assert.match(VERIFY_COPY.query.note, /^No reenviamos tu transferencia\./);
  assert.equal(VERIFY_COPY.resend.button, 'Reintentar el mismo envío');
  for (const text of [VERIFY_COPY.resend.note, VERIFY_COPY.resend.busyNote, VERIFY_COPY.resend.busy]) assert.doesNotMatch(text, /No reenviamos|no se enviar|no hubo cargo/i);
  for (const copy of Object.values(VERIFY_COPY)) for (const text of Object.values(copy)) assert.doesNotMatch(text, /no se enviará de nuevo|no hubo cargo/i);
});
