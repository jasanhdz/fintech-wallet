// Deterministic client order of own accounts (docs/web-ux-polish/SPEC.md §4, D-UX-6, A-2). GET /v1/accounts orders by
// created_at,id, and the registration fixture creates both accounts in one transaction, so the API order depends on random
// UUIDs. The UI never relies on it: checking → savings → other, then name (es-MX, accent/case-insensitive), then id.
import type { Account } from './api.js';

const KIND_RANK: Record<string, number> = { checking: 0, savings: 1 };
const collator = new Intl.Collator('es-MX', { sensitivity: 'base' });

/** Sorted copy (the input is never mutated). */
export function orderAccounts<T extends Pick<Account, 'id' | 'kind' | 'name'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (KIND_RANK[a.kind] ?? 2) - (KIND_RANK[b.kind] ?? 2)
    || collator.compare(a.name, b.name)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** «Cuenta principal» = first account in `orderAccounts` order (A-2). */
export function primaryAccount<T extends Pick<Account, 'id' | 'kind' | 'name'>>(items: readonly T[] | undefined): T | undefined {
  return items && items.length ? orderAccounts(items)[0] : undefined;
}
