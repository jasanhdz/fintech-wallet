import assert from 'node:assert/strict';
import type { ProductComponents } from '@fintech-wallet/shared';
import { orderAccounts, selectAccount } from '../src/accounts';

type Account = ProductComponents['schemas']['Account'];
const account = (id: string, name: string, kind: Account['kind']): Account => ({
  id, name, kind, currency: 'MXN', availableBalanceMinor: '10000', clabe: `${id}-clabe`, clabeMasked: `••${id}`,
});

describe('account selection', () => {
  it('uses checking, then name, then id for the default regardless of API order', () => {
    const ordered = orderAccounts([
      account('z', 'Zeta', 'savings'), account('b', 'Principal B', 'checking'), account('a', 'Principal A', 'checking'), account('a2', 'Ahorro', 'savings'),
    ]);
    assert.deepEqual(ordered.map(({ id }) => id), ['a', 'b', 'a2', 'z']);
    assert.equal(selectAccount(ordered, '')?.id, 'a');
  });

  it('keeps the selected account when the API changes order or refreshes', () => {
    const savings = account('savings', 'Ahorro', 'savings');
    const principal = account('principal', 'Principal', 'checking');
    assert.equal(selectAccount(orderAccounts([principal, savings]), 'savings'), savings);
    assert.equal(selectAccount(orderAccounts([savings, principal]), 'savings'), savings);
    assert.equal(selectAccount(orderAccounts([principal]), 'savings'), principal);
  });
});
