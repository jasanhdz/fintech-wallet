import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

function key(name: string): Buffer {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const result = Buffer.from(value, 'base64');
  if (result.length !== 32) throw new Error(`${name} must encode 32 bytes`);
  return result;
}

export function assertCryptoConfiguration(): void {
  key('CLABE_ENCRYPTION_KEY');
  key('CLABE_LOOKUP_KEY');
  key('REFRESH_TOKEN_PEPPER');
}

export const hashSecret = (value: string) => createHmac('sha256', key('REFRESH_TOKEN_PEPPER')).update(value).digest('hex');
export function encryptClabe(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key('CLABE_ENCRYPTION_KEY'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}
export function decryptClabe(value: string): string {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part!, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key('CLABE_ENCRYPTION_KEY'), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString('utf8');
}
export const clabeFingerprint = (value: string) => createHmac('sha256', key('CLABE_LOOKUP_KEY')).update(value).digest('hex');

export function generateClabe(): string {
  const prefix = `646${String(randomBytes(8).readBigUInt64BE() % 100000000000000n).padStart(14, '0')}`;
  const weights = [3, 7, 1] as const;
  const subtotal = [...prefix].reduce((sum, digit, index) => sum + (Number(digit) * weights[index % 3]!) % 10, 0);
  return `${prefix}${(10 - subtotal % 10) % 10}`;
}
