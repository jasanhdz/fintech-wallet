import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beneficiaryInputSchema, loginRequestSchema, registerRequestSchema, formatMxnFromMinor } from '@fintech-wallet/shared';

test('login and registration use the shared contract validation', () => {
  assert.equal(loginRequestSchema.safeParse({ email: 'person@example.com', password: 'secret', client: 'web' }).success, true);
  assert.equal(loginRequestSchema.safeParse({ email: 'invalid', password: '', client: 'web' }).success, false);
  assert.equal(registerRequestSchema.safeParse({ fullName: 'A Person', email: 'person@example.com', password: 'long-enough-password' }).success, true);
  assert.equal(registerRequestSchema.safeParse({ fullName: '', email: 'person@example.com', password: 'short' }).success, false);
});

test('account balance formatting preserves integer minor units', () => {
  assert.match(formatMxnFromMinor('9223372036854775807'), /92,233,720,368,547,758\.07/);
});

test('beneficiary form uses contract limits and validates CLABE checksum', () => {
  const valid = { name: 'Ana López', alias: 'Renta', clabe: '002010077777777771' };
  assert.equal(beneficiaryInputSchema.safeParse(valid).success, true);
  assert.equal(beneficiaryInputSchema.safeParse({ ...valid, clabe: '002010077777777770' }).success, false);
  assert.equal(beneficiaryInputSchema.safeParse({ ...valid, clabe: '00201007777777777x' }).success, false);
  assert.equal(beneficiaryInputSchema.safeParse({ ...valid, alias: 'a'.repeat(81) }).success, false);
  assert.equal(beneficiaryInputSchema.safeParse({ ...valid, name: '   ' }).success, false);
});
