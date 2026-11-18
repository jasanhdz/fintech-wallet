// ORD-01 (docs/web-ux-polish/SPEC.md §4): deterministic client order of own accounts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderAccounts, primaryAccount } from '../src/account-order.js';

const acc = (id: string, kind: string, name: string) => ({ id, kind, name }) as { id: string; kind: 'checking' | 'savings'; name: string };

test('ORD-01 checking before savings regardless of the API order', () => {
  const api = [acc('b', 'savings', 'Ahorro'), acc('a', 'checking', 'Cuenta principal')];
  assert.deepEqual(orderAccounts(api).map((item) => item.id), ['a', 'b']);
  assert.equal(primaryAccount(api)?.name, 'Cuenta principal');
});

test('ORD-01 unknown kinds go last; ties by es-MX name (accent/case-insensitive), then by id', () => {
  const items = [acc('z', 'other', 'Zeta'), acc('3', 'savings', 'ánfora'), acc('2', 'savings', 'Ahorro'), acc('1', 'savings', 'ahorro'), acc('0', 'checking', 'Nómina')];
  assert.deepEqual(orderAccounts(items).map((item) => item.id), ['0', '1', '2', '3', 'z']);
});

test('ORD-01 stable result and the input is not mutated', () => {
  const items = Object.freeze([acc('b', 'savings', 'Ahorro'), acc('a', 'checking', 'Principal')]);
  const first = orderAccounts(items);
  assert.deepEqual(items.map((item) => item.id), ['b', 'a']);
  assert.deepEqual(orderAccounts(first), first);
  assert.notEqual(first, items);
  assert.equal(primaryAccount([]), undefined);
  assert.equal(primaryAccount(undefined), undefined);
});
