// Synthetic, typed fixtures for [F] scenarios (SPEC §4). Generic names, @example.test e-mails and
// CLABEs generated with a valid checksum. Never imported from web/src.
import type { ProductComponents } from '@fintech-wallet/shared';

type Schemas = ProductComponents['schemas'];
export type Account = Schemas['Account'];
export type Beneficiary = Schemas['Beneficiary'];
export type Transfer = Schemas['Transfer'];
export type TransferPolicy = Schemas['TransferPolicy'];
export type Movement = Schemas['Movement'];
export type User = Schemas['User'];
export type AuthResponse = Schemas['AuthResponse'];
export type Problem = Schemas['Problem'];

const WEIGHTS = [3, 7, 1];
/** Builds an 18-digit CLABE with a valid control digit from a 17-digit prefix. */
export function clabeFrom(prefix17: string): string {
  if (!/^[0-9]{17}$/.test(prefix17)) throw new Error('prefix must have 17 digits');
  const sum = [...prefix17].reduce((total, digit, index) => total + ((Number(digit) * WEIGHTS[index % 3]!) % 10), 0);
  return `${prefix17}${(10 - (sum % 10)) % 10}`;
}
export const maskClabe = (clabe: string) => `${clabe.slice(0, 3)}•••••••••••${clabe.slice(-4)}`;

export const ids = {
  user: '6f1d2c3b-0000-4000-8000-000000000001',
  otherUser: '6f1d2c3b-0000-4000-8000-000000000002',
  checking: '7a2e0000-0000-4000-8000-000000000101',
  savings: '7a2e0000-0000-4000-8000-000000000102',
  beneficiary: '8b3f0000-0000-4000-8000-000000000201',
  beneficiaryAccount: '7a2e0000-0000-4000-8000-000000000301',
  transfer1: '9c4a0000-0000-4000-8000-000000000401',
  transfer2: '9c4a0000-0000-4000-8000-000000000402',
};

const checkingClabe = clabeFrom('64618000000000731');
const savingsClabe = clabeFrom('64618000000000642');
const beneficiaryClabe = clabeFrom('64618000000000953');

export const user = { id: ids.user, fullName: 'Persona Prueba Uno', email: 'persona.uno@example.test' } satisfies User;

export function authResponse(target: User = user): AuthResponse {
  return { accessToken: 'synthetic-access-token', tokenType: 'Bearer', expiresIn: 900, user: target } satisfies AuthResponse;
}

export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: ids.checking, name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '734500',
    clabe: checkingClabe, clabeMasked: maskClabe(checkingClabe), ...overrides,
  } satisfies Account;
}

export const accounts = (): Account[] => [
  account(),
  account({ id: ids.savings, name: 'Ahorro', kind: 'savings', availableBalanceMinor: '215075', clabe: savingsClabe, clabeMasked: maskClabe(savingsClabe) }),
];

export function beneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return { id: ids.beneficiary, name: 'Persona Prueba Dos', alias: 'Prueba Dos', clabeMasked: maskClabe(beneficiaryClabe), destinationAccountId: ids.beneficiaryAccount, ...overrides } satisfies Beneficiary;
}

/**
 * DEP-7 (coordinator): `sendEpoch: '0'` keeps the synthetic policy valid for the shared types 0.3.0 (no such field)
 * and 0.4.0 (required). It is spread from a variable (no excess-property check under 0.3.0) and after `overrides`
 * (a `Partial` would widen it to `string | undefined`). The app never reads it (0.4.0 integration is `[P]`).
 */
const sendEpoch04 = { sendEpoch: '0' };
export function policy(overrides: Partial<TransferPolicy> = {}): TransferPolicy {
  return {
    currency: 'MXN', businessDate: '2026-11-17', businessTimeZone: 'America/Mexico_City',
    dailyLimitMinor: '3000000', dailyUsedMinor: '0', dailyRemainingMinor: '3000000',
    otpThresholdMinor: '700000', otpExpirySeconds: 240, otpMaxAttempts: 4, demoOnly: true, ...overrides, ...sendEpoch04,
  } satisfies TransferPolicy;
}

export function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: ids.transfer1, status: 'completed', sourceAccountId: ids.checking, destination: beneficiary(),
    amountMinor: '12300', currency: 'MXN', concept: 'Prueba de envío', reference: '4321',
    createdAt: '2026-11-17T16:00:00.000Z', completedAt: '2026-11-17T16:00:01.000Z', expiresAt: null,
    receiptReference: 'RCPT-SYN-0001', requestId: 'req-synthetic', ...overrides,
  } satisfies Transfer;
}

export function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'mv-synthetic-1', transferId: ids.transfer1, type: 'debit', amountMinor: '12300', currency: 'MXN',
    concept: 'Prueba de envío', reference: '4321', status: 'completed', occurredAt: '2026-11-17T16:00:01.000Z',
    counterparty: { name: 'Persona Prueba Dos', clabeMasked: maskClabe(beneficiaryClabe) }, ...overrides,
  } satisfies Movement;
}

export function problem(status: number, detail: string, title = 'Error'): Problem {
  return { type: 'about:blank', title, status, detail, instance: '/v1/synthetic', requestId: `req-${status}` } satisfies Problem;
}
