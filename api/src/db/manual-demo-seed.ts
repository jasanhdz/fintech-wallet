import { randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { clabeFingerprint, encryptClabe, generateClabe } from '../security/crypto.js';
import { ensureDemoClearingAccount } from './clearing-account.js';

const DEMO_EMAIL = 'demo@wallet.local';
const DEMO_PASSWORD = 'Billetera-MXN-Demo-2026!';
const DEMO_NAME = 'Demo local';
const MAX_BIGINT = 9_223_372_036_854_775_807n;

type Query = (sql: string, parameters?: unknown[]) => Promise<unknown>;
type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  return Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] } | null)?.rows ?? []);
}

function demoBalance(name: string): bigint {
  const value = process.env[name];
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be a non-negative integer in minor units`);
  const balance = BigInt(value);
  if (balance > MAX_BIGINT) throw new Error(`${name} exceeds PostgreSQL bigint range`);
  return balance;
}

/** Seed only the reserved, local manual-testing profile. Existing user activity is never reset. */
export async function ensureManualDemoProfile(query: Query): Promise<void> {
  if (process.env.APP_ENV !== 'development') throw new Error('Manual demo profile requires APP_ENV=development');
  const primaryBalance = demoBalance('DEMO_PRIMARY_BALANCE_MINOR');
  const savingsBalance = demoBalance('DEMO_SAVINGS_BALANCE_MINOR');
  const clearingId = await ensureDemoClearingAccount(query);

  const existingUsers = rows(await query('SELECT id,password_hash,full_name FROM users WHERE email=$1 FOR UPDATE', [DEMO_EMAIL]));
  let userId: string;
  if (existingUsers[0]) {
    if (existingUsers[0].full_name !== DEMO_NAME || !await compare(DEMO_PASSWORD, String(existingUsers[0].password_hash))) {
      throw new Error('Reserved local demo identity conflicts with existing data');
    }
    userId = String(existingUsers[0].id);
  } else {
    const userHash = await hash(DEMO_PASSWORD, 12);
    const inserted = rows(await query('INSERT INTO users(email,full_name,password_hash) VALUES($1,$2,$3) RETURNING id', [DEMO_EMAIL, DEMO_NAME, userHash]));
    userId = String(inserted[0]?.id);
    if (!userId) throw new Error('Unable to create local demo identity');
  }

  let accounts = rows(await query("SELECT id,name,kind,balance_minor::text AS balance,clabe_ciphertext,clabe_lookup_hash FROM accounts WHERE owner_id=$1 ORDER BY CASE name WHEN 'Cuenta principal' THEN 0 WHEN 'Ahorro' THEN 1 ELSE 2 END,id FOR UPDATE", [userId]));
  if (accounts.length === 0) {
    const definitions = [
      { name: 'Cuenta principal', kind: 'checking', balance: primaryBalance },
      { name: 'Ahorro', kind: 'savings', balance: savingsBalance },
    ];
    for (const account of definitions) {
      const accountId = randomUUID();
      const clabe = generateClabe();
      await query('INSERT INTO accounts(id,owner_id,name,kind,balance_minor,clabe_ciphertext,clabe_lookup_hash) VALUES($1,$2,$3,$4,$5,$6,$7)', [accountId, userId, account.name, account.kind, account.balance.toString(), encryptClabe(clabe), clabeFingerprint(clabe)]);
      if (account.balance > 0n) {
        const ledger = rows(await query("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('opening',$1) RETURNING id", [accountId]));
        await query("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,$3,'opening'),($1,$4,$5,'opening')", [ledger[0]?.id, accountId, account.balance.toString(), clearingId, (-account.balance).toString()]);
        await query('UPDATE accounts SET balance_minor=balance_minor-$1 WHERE id=$2', [account.balance.toString(), clearingId]);
      }
    }
    accounts = rows(await query("SELECT id,name,kind,balance_minor::text AS balance,clabe_ciphertext,clabe_lookup_hash FROM accounts WHERE owner_id=$1 ORDER BY CASE name WHEN 'Cuenta principal' THEN 0 WHEN 'Ahorro' THEN 1 ELSE 2 END,id FOR UPDATE", [userId]));
  }

  if (accounts.length !== 2 || accounts[0]?.name !== 'Cuenta principal' || accounts[1]?.name !== 'Ahorro' || accounts[0]?.kind !== 'checking' || accounts[1]?.kind !== 'savings') {
    throw new Error('Reserved local demo account set conflicts with existing data; no account changes were made');
  }
  const savings = accounts[1]!;
  const duplicate = rows(await query('SELECT id,destination_account_id FROM beneficiaries WHERE owner_id=$1 AND clabe_lookup_hash=$2', [userId, savings.clabe_lookup_hash]));
  if (duplicate[0]) {
    if (duplicate[0].destination_account_id !== savings.id) throw new Error('Local demo beneficiary fingerprint conflicts with existing data');
    return;
  }
  const beneficiary = rows(await query('INSERT INTO beneficiaries(owner_id,destination_account_id,name,alias,clabe_ciphertext,clabe_lookup_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [userId, savings.id, 'Cuenta de ahorro demo', 'Ahorro demo', savings.clabe_ciphertext, savings.clabe_lookup_hash]));
  await query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'demo.beneficiary.seeded','beneficiary',$2,'local-demo-seed','{}')", [userId, beneficiary[0]?.id]);
}
