import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { assertProductionConfiguration, idempotencyRetentionDays } from '../src/config.js';

const validProduction = {
  APP_ENV: 'production',
  DAILY_TRANSFER_LIMIT_MINOR: '2000000',
  BUSINESS_TIME_ZONE: 'America/Mexico_City',
  OTP_THRESHOLD_MINOR: '500000',
  OTP_EXPIRY_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '5',
  IDEMPOTENCY_RECORD_RETENTION_DAYS: '30',
};

test('production configuration accepts explicit operational values without imposing example policy', () => {
  assert.doesNotThrow(() => assertProductionConfiguration(validProduction));
  assert.doesNotThrow(() => assertProductionConfiguration({ ...validProduction, DAILY_TRANSFER_LIMIT_MINOR: '1' }));
});

test('production requires every operational setting and rejects malformed, fractional, zero, and out-of-range values', () => {
  for (const name of ['DAILY_TRANSFER_LIMIT_MINOR', 'BUSINESS_TIME_ZONE', 'OTP_THRESHOLD_MINOR', 'OTP_EXPIRY_SECONDS', 'OTP_MAX_ATTEMPTS', 'IDEMPOTENCY_RECORD_RETENTION_DAYS']) {
    const missing = { ...validProduction };
    delete missing[name as keyof typeof missing];
    assert.throws(() => assertProductionConfiguration(missing), new RegExp(name));
  }
  for (const [name, value] of [
    ['DAILY_TRANSFER_LIMIT_MINOR', '1.5'],
    ['DAILY_TRANSFER_LIMIT_MINOR', '9223372036854775808'],
    ['OTP_THRESHOLD_MINOR', '0'],
    ['OTP_THRESHOLD_MINOR', '9007199254740993.0'],
    ['OTP_EXPIRY_SECONDS', '1.2'],
    ['OTP_EXPIRY_SECONDS', '2147483648'],
    ['OTP_MAX_ATTEMPTS', '0'],
    ['OTP_MAX_ATTEMPTS', '-1'],
    ['IDEMPOTENCY_RECORD_RETENTION_DAYS', '0'],
    ['IDEMPOTENCY_RECORD_RETENTION_DAYS', '-2'],
    ['IDEMPOTENCY_RECORD_RETENTION_DAYS', '2.5'],
    ['IDEMPOTENCY_RECORD_RETENTION_DAYS', '30 days'],
    ['IDEMPOTENCY_RECORD_RETENTION_DAYS', '1000001'],
  ] as const) {
    assert.throws(() => assertProductionConfiguration({ ...validProduction, [name]: value }), new RegExp(name));
  }
});

test('production requires a valid IANA time zone and disallows the development fixture', () => {
  assert.throws(() => assertProductionConfiguration({ ...validProduction, BUSINESS_TIME_ZONE: 'Not/A_Zone' }), /BUSINESS_TIME_ZONE/);
  assert.throws(() => assertProductionConfiguration({ ...validProduction, DEMO_FIXTURE_ENABLED: 'true' }), /DEMO_FIXTURE_ENABLED/);
});

test('test and development environments retain existing harness configuration behavior', () => {
  assert.doesNotThrow(() => assertProductionConfiguration({ APP_ENV: 'test' }));
  assert.doesNotThrow(() => assertProductionConfiguration({ APP_ENV: 'development', DEMO_FIXTURE_ENABLED: 'true' }));
});

test('R8-12: idempotency retention days come only from IDEMPOTENCY_RECORD_RETENTION_DAYS (no default, positive integer)', () => {
  assert.equal(idempotencyRetentionDays({ IDEMPOTENCY_RECORD_RETENTION_DAYS: '2' }), 2);
  assert.equal(idempotencyRetentionDays({ IDEMPOTENCY_RECORD_RETENTION_DAYS: '30' }), 30);
  for (const env of [{}, { IDEMPOTENCY_RECORD_RETENTION_DAYS: '' }, { IDEMPOTENCY_RECORD_RETENTION_DAYS: ' ' }]) {
    assert.throws(() => idempotencyRetentionDays(env), /IDEMPOTENCY_RECORD_RETENTION_DAYS is required/);
  }
  for (const value of ['0', '-1', '1.5', 'x', '0030', '1000001']) {
    assert.throws(() => idempotencyRetentionDays({ IDEMPOTENCY_RECORD_RETENTION_DAYS: value }), /IDEMPOTENCY_RECORD_RETENTION_DAYS/);
  }
  assert.throws(() => assertProductionConfiguration({ ...validProduction, IDEMPOTENCY_RECORD_RETENTION_DAYS: undefined }), /IDEMPOTENCY_RECORD_RETENTION_DAYS is required in production/);
});

test('R8-12: the transfer module has no hard-coded idempotency retention interval', () => {
  const directory = new URL('../src/transfers/', import.meta.url);
  const offenders = readdirSync(directory).filter((file) => /interval\s*'30 days'/.test(readFileSync(new URL(file, directory), 'utf8')));
  assert.deepEqual(offenders, []);
});
