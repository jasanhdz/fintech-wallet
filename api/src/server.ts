import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import { createApp } from './http/app.js';
import { dataSource } from './db/data-source.js';
import { assertCryptoConfiguration } from './security/crypto.js';
import { assertStartupConfiguration } from './config.js';

const port = Number(process.env.API_PORT ?? 3000);
if (!process.env.JWT_ACCESS_SECRET || new TextEncoder().encode(process.env.JWT_ACCESS_SECRET).length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes');
assertCryptoConfiguration();
try {
  assertStartupConfiguration();
} catch (error) {
  // The message names the offending variable only; no configured value is printed.
  console.error(JSON.stringify({ event: 'api.config_invalid', message: error instanceof Error ? error.message : 'invalid configuration' }));
  process.exit(1);
}
const source = dataSource();
await source.initialize();
createApp().listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'api.listening', port })));
