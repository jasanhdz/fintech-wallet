export const demoClearingAccountId = '00000000-0000-4000-8000-000000000001';

export async function ensureDemoClearingAccount(query: (sql: string, parameters?: unknown[]) => Promise<unknown>) {
  await query("INSERT INTO accounts(id,owner_id,name,kind,balance_minor,clabe_ciphertext,clabe_lookup_hash) VALUES($1,NULL,'Demo clearing','clearing',0,NULL,NULL) ON CONFLICT(id) DO NOTHING", [demoClearingAccountId]);
  const result = await query('SELECT owner_id,kind,balance_minor,clabe_ciphertext,clabe_lookup_hash FROM accounts WHERE id=$1', [demoClearingAccountId]);
  const rows = Array.isArray(result) ? result : (result as { rows?: Array<Record<string, unknown>> } | null)?.rows;
  const account = rows?.[0];
  if (!account || account.owner_id !== null || account.kind !== 'clearing' || account.clabe_ciphertext !== null || account.clabe_lookup_hash !== null) throw new Error('Demo clearing account conflicts with an existing account');
  return demoClearingAccountId;
}
