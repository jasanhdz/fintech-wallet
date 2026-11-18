import type { ProductComponents } from '@fintech-wallet/shared';

export type Account = ProductComponents['schemas']['Account'];

/** Stable account order: checking is the default, then the visible name and id. */
export function orderAccounts(items: Account[]): Account[] {
  return [...items].sort((left, right) => {
    const kindOrder = Number(left.kind !== 'checking') - Number(right.kind !== 'checking');
    if (kindOrder !== 0) return kindOrder;
    const nameOrder = left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
    return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
  });
}

/** Keep a user's choice when it is still present; otherwise use the stable default. */
export function selectAccount(accounts: Account[], selectedId: string): Account | undefined {
  return accounts.find((account) => account.id === selectedId) ?? orderAccounts(accounts)[0];
}
