export function assertSafeTestDatabase(value: string | undefined, developmentUrl?: string): URL {
  if (!value) throw new Error('TEST_DATABASE_URL is required');
  const parsed = new URL(value);
  const name = parsed.pathname.replace(/^\//, '');
  const dev = developmentUrl ? new URL(developmentUrl) : undefined;
  const devName = dev?.pathname.replace(/^\//, '') ?? 'wallet_dev';
  const sameTarget = dev && parsed.origin === dev.origin && name === devName;
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:' || sameTarget || name !== 'wallet_test' || parsed.username !== 'wallet_runtime_test' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Refusing test database: expected isolated local wallet_test, never development database');
  }
  return parsed;
}
