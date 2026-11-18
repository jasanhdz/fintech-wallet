const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MAX_POSTGRES_INTEGER = 2_147_483_647n;

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required in production`);
  return value;
}

function positiveInteger(name: string, value: string, max: bigint): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = BigInt(value);
  if (parsed > max) throw new Error(`${name} is out of range`);
  return parsed;
}

/**
 * Upper bound of the idempotency retention-review interval: a representable-range guard (keeps
 * `now() + make_interval(days => n)` inside PostgreSQL timestamptz), not a retention policy.
 */
const MAX_RETENTION_DAYS = 1_000_000n;

/**
 * Days added to `idempotency_records.created_at` to write `expires_at`. Round 8 (D2): `expires_at` is only a
 * retention-review date; replay stays indefinite and no logic reads it. There is no default in code: the value comes
 * from IDEMPOTENCY_RECORD_RETENTION_DAYS in every environment (`.env.example` carries a demo example).
 */
export function idempotencyRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.IDEMPOTENCY_RECORD_RETENTION_DAYS;
  if (value === undefined || value.trim() === '') throw new Error('IDEMPOTENCY_RECORD_RETENTION_DAYS is required');
  return Number(positiveInteger('IDEMPOTENCY_RECORD_RETENTION_DAYS', value, MAX_RETENTION_DAYS));
}

/** Fail-fast validation of operational settings that are mandatory in production. */
export function assertProductionConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.APP_ENV !== 'production') return;

  positiveInteger('DAILY_TRANSFER_LIMIT_MINOR', required('DAILY_TRANSFER_LIMIT_MINOR', env), MAX_POSTGRES_BIGINT);
  const timeZone = required('BUSINESS_TIME_ZONE', env);
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
  } catch {
    throw new Error('BUSINESS_TIME_ZONE must be a valid IANA time zone');
  }
  positiveInteger('OTP_THRESHOLD_MINOR', required('OTP_THRESHOLD_MINOR', env), MAX_POSTGRES_BIGINT);
  positiveInteger('OTP_EXPIRY_SECONDS', required('OTP_EXPIRY_SECONDS', env), MAX_POSTGRES_INTEGER);
  positiveInteger('OTP_MAX_ATTEMPTS', required('OTP_MAX_ATTEMPTS', env), MAX_POSTGRES_INTEGER);
  positiveInteger('IDEMPOTENCY_RECORD_RETENTION_DAYS', required('IDEMPOTENCY_RECORD_RETENTION_DAYS', env), MAX_RETENTION_DAYS);

  if (env.DEMO_FIXTURE_ENABLED === 'true') {
    throw new Error('DEMO_FIXTURE_ENABLED is not allowed in production');
  }
}
