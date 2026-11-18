import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const envPath = resolve('.env');
try {
  await access(envPath);
  console.log('Local .env already exists; left unchanged (values not read or printed).');
  process.exit(0);
} catch {
  // Create a new local-only file below.
}

const template = await readFile('.env.example', 'utf8');
const replacements = {
  JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
  REFRESH_TOKEN_PEPPER: randomBytes(32).toString('base64url'),
  CLABE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CLABE_LOOKUP_KEY: randomBytes(32).toString('base64url'),
};
const contents = template.replace(/^(JWT_ACCESS_SECRET|REFRESH_TOKEN_PEPPER|CLABE_ENCRYPTION_KEY|CLABE_LOOKUP_KEY)=__GENERATE_LOCAL_KEY__$/gm,
  (_line, key) => `${key}=${replacements[key]}`);
await writeFile(envPath, contents, { flag: 'wx', mode: 0o600 });
console.log('Created local .env with fresh development keys; values were not printed.');
