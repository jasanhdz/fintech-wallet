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

export function assertSafeTestMigrator(value: string | undefined, testDatabase: URL): URL {
  if (!value) throw new Error('TEST_MIGRATOR_DATABASE_URL is required');
  const parsed = new URL(value);
  const port = (url: URL) => url.port || '5432';
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.hostname !== testDatabase.hostname || port(parsed) !== port(testDatabase) || parsed.pathname !== '/wallet_test' || parsed.username !== 'wallet_migrator_test') throw new Error('Test migrations require local wallet_test migrator credentials');
  return parsed;
}
