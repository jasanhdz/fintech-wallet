import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionConfiguration } from '../src/config.js';

const validProduction = {
  APP_ENV: 'production',
  DAILY_TRANSFER_LIMIT_MINOR: '2000000',
  BUSINESS_TIME_ZONE: 'America/Mexico_City',
  OTP_THRESHOLD_MINOR: '500000',
  OTP_EXPIRY_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '5',
};

test('production configuration accepts explicit operational values without imposing example policy', () => {
  assert.doesNotThrow(() => assertProductionConfiguration(validProduction));
  assert.doesNotThrow(() => assertProductionConfiguration({ ...validProduction, DAILY_TRANSFER_LIMIT_MINOR: '1' }));
});

test('production requires every operational setting and rejects malformed, fractional, zero, and out-of-range values', () => {
  for (const name of ['DAILY_TRANSFER_LIMIT_MINOR', 'BUSINESS_TIME_ZONE', 'OTP_THRESHOLD_MINOR', 'OTP_EXPIRY_SECONDS', 'OTP_MAX_ATTEMPTS']) {
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
