// WF-T4 unit tests for the W08/W09/W13 pure helpers (BigInt money, server policy, identity rules).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRANSFER_MESSAGES, amountError, amountMinorOf, barWidth, beneficiaryBlocked, conceptError, createBody, effectiveOwnDestination,
  errorCountLabel, minorToInput, percentOf, projectDebit, referenceError, requiresCode, shortfall, validateTransfer,
} from '../src/transfer-form.js';

const source = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

test('FN-06: amounts are parsed exactly and rejected with the W08-V6 copy', () => {
  for (const raw of ['', '0', '-1', 'abc', '0.00', '1.']) assert.equal(amountError(raw), TRANSFER_MESSAGES.amountInvalid, raw);
  for (const raw of ['10.999', '1,000', '1,000.50']) assert.equal(amountError(raw), TRANSFER_MESSAGES.amountFormat, raw);
  assert.equal(amountMinorOf('10'), 1000n);
  assert.equal(amountMinorOf('10.5'), 1050n);
  assert.equal(amountMinorOf('10.50'), 1050n);
  assert.equal(amountMinorOf('123456789012345.67'), 12345678901234567n);
  for (const raw of ['10', '10.5', '10.50']) assert.equal(amountError(raw), undefined);
});

test('FN-07: concept 1–40 after trim and numeric reference of up to 7 digits', () => {
  assert.equal(conceptError('   '), TRANSFER_MESSAGES.conceptRequired);
  assert.equal(conceptError(' Pago '), undefined);
  assert.equal(conceptError('x'.repeat(41)), TRANSFER_MESSAGES.conceptLength);
  assert.equal(referenceError('REF-99X'), TRANSFER_MESSAGES.reference);
  assert.equal(referenceError('12345678'), TRANSFER_MESSAGES.reference);
  assert.equal(referenceError(''), TRANSFER_MESSAGES.reference);
  assert.equal(referenceError('1234567'), undefined);
  const errors = validateTransfer({ amount: '0', concept: '', reference: 'REF-99X' }, { type: 'beneficiary', id: 'b' });
  assert.deepEqual(Object.keys(errors), ['amount', 'concept', 'reference']);
  assert.equal(errorCountLabel(3), '3 errores detectados');
  assert.equal(errorCountLabel(1), '1 error detectado');
  assert.equal(validateTransfer({ amount: '1', concept: 'a', reference: '1' }, { type: 'own_account', id: '' }).recipient, TRANSFER_MESSAGES.destinationAccount);
});

test('D-7: origin ≠ destination by identity (ownAccountId or destinationAccountId), never by name', () => {
  assert.equal(beneficiaryBlocked({ destinationAccountId: source, ownAccountId: source }, source), true);
  assert.equal(beneficiaryBlocked({ destinationAccountId: source }, source), true);
  assert.equal(beneficiaryBlocked({ destinationAccountId: source, ownAccountId: source }, other), false);
  assert.equal(beneficiaryBlocked({ destinationAccountId: 'third-party' }, source), false);
  const accounts = [{ id: source }, { id: other }];
  assert.equal(effectiveOwnDestination(accounts, source, ''), other);
  assert.equal(effectiveOwnDestination(accounts, source, source), other);
  assert.equal(effectiveOwnDestination([{ id: source }], source, ''), '');
  assert.equal(effectiveOwnDestination([...accounts, { id: 'third' }], source, ''), '');
  assert.equal(effectiveOwnDestination([...accounts, { id: 'third' }], source, 'third'), 'third');
});

test('BigInt projections, percentages, shortfall and the server OTP threshold (>=)', () => {
  assert.equal(percentOf(931799n, 1000000n), '93.1');
  assert.equal(percentOf(0n, 0n), null);
  assert.equal(barWidth(931799n, 1000000n), '93.17%');
  assert.equal(barWidth(5n, 0n), '0%');
  const projection = projectDebit('734500', 85000n);
  assert.ok(projection && !projection.exceeds && projection.projected === 649500n && projection.percent === '88.4');
  assert.deepEqual(projectDebit('100', 101n), { exceeds: true, available: 100n });
  assert.equal(projectDebit(undefined, 1n), null);
  assert.equal(shortfall('800000', '734500'), 65500n);
  assert.equal(shortfall('100', '100'), null);
  assert.equal(shortfall('100', undefined), null);
  assert.equal(requiresCode('700000', { otpThresholdMinor: '700000' }), true);
  assert.equal(requiresCode('699999', { otpThresholdMinor: '700000' }), false);
  assert.equal(requiresCode('99999999999999999999', { otpThresholdMinor: '700000' }), true);
  assert.equal(requiresCode('1', undefined), null);
  assert.equal(minorToInput('12345'), '123.45');
  assert.equal(minorToInput('5'), '0.05');
});

test('REC-02: the create body keeps the f0ed4bc key order and trims only the concept', () => {
  const beneficiary = createBody({ destinationType: 'beneficiary', sourceAccountId: source, beneficiaryId: 'b', destinationAccountId: 'ignored', amountMinor: '12300', concept: '  Prueba de envío ', reference: '4321' });
  assert.equal(JSON.stringify(beneficiary), JSON.stringify({ sourceAccountId: source, destinationType: 'beneficiary', beneficiaryId: 'b', amountMinor: '12300', concept: 'Prueba de envío', reference: '4321' }));
  const own = createBody({ destinationType: 'own_account', sourceAccountId: source, beneficiaryId: 'ignored', destinationAccountId: other, amountMinor: '1', concept: 'x', reference: '1' });
  assert.equal(JSON.stringify(own), JSON.stringify({ sourceAccountId: source, destinationType: 'own_account', destinationAccountId: other, amountMinor: '1', concept: 'x', reference: '1' }));
});
