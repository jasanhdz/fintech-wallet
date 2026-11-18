import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMinorUnits,
  beneficiaryInputSchema,
  formatMxnFromMinor,
  isValidClabe,
  parseMxnToMinor,
  transferCreateRequestSchema,
} from '../src/index.js';

test('CLABE validation checks length, digits and verification digit', () => {
  assert.equal(isValidClabe('002010077777777771'), true);
  assert.equal(isValidClabe('002010077777777770'), false);
  assert.equal(isValidClabe('00201007777777777x'), false);
  assert.equal(isValidClabe('123'), false);
});

test('MXN decimal input converts exactly to bigint minor-unit string', () => {
  assert.equal(parseMxnToMinor('850'), '85000');
  assert.equal(parseMxnToMinor('850.7'), '85070');
  assert.equal(parseMxnToMinor('850.07'), '85007');
  assert.equal(parseMxnToMinor('99999999999999.99'), '9999999999999999');
  assert.throws(() => parseMxnToMinor('0'), /mayor que cero/);
  assert.throws(() => parseMxnToMinor('-1.00'), /Importe MXN inválido/);
  assert.throws(() => parseMxnToMinor('1.234'), /dos decimales/);
  assert.throws(() => parseMxnToMinor('1,000.00'), /Importe MXN inválido/);
});

test('minor-unit formatting and addition do not use binary floating point', () => {
  assert.equal(formatMxnFromMinor('1250000'), '$12,500.00 MXN');
  assert.equal(formatMxnFromMinor('-85007'), '-$850.07 MXN');
  assert.equal(addMinorUnits('9007199254740991', '9'), '9007199254741000');
});

test('shared request schemas reject invalid CLABE and transfer payload', () => {
  assert.equal(beneficiaryInputSchema.safeParse({ name: 'A', alias: 'A', clabe: '002010077777777771' }).success, true);
  assert.equal(beneficiaryInputSchema.safeParse({ name: 'A', alias: 'A', clabe: '002010077777777770' }).success, false);
  assert.equal(transferCreateRequestSchema.safeParse({
    sourceAccountId: '8b43b7b8-0dd0-4fad-a370-ec4462b980c9',
    destinationType: 'own_account',
    destinationAccountId: '34a05b2c-c247-41af-9a8a-8f26c727b6e4',
    amountMinor: '85000',
    concept: 'Comida',
    reference: '131126',
  }).success, true);
});
