import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidClabe } from '@fintech-wallet/shared';
import { clabeFingerprint, decryptClabe, encryptClabe, generateClabe, hashSecret } from '../src/security/crypto.js';

test('generated CLABEs pass checksum and are encrypted with separate lookup fingerprints', () => {
  process.env.CLABE_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64');
  process.env.CLABE_LOOKUP_KEY=Buffer.alloc(32,2).toString('base64');
  process.env.REFRESH_TOKEN_PEPPER=Buffer.alloc(32,3).toString('base64');
  const value=generateClabe(); assert.match(value,/^\d{18}$/); assert.equal(isValidClabe(value),true);
  const encrypted=encryptClabe(value); assert.notEqual(encrypted,value); assert.equal(decryptClabe(encrypted),value);
  assert.match(clabeFingerprint(value),/^[a-f0-9]{64}$/); assert.match(hashSecret('opaque-token'),/^[a-f0-9]{64}$/);
});
