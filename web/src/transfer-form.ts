// W08/W09/W13 presentation logic (SPEC §7.2, D-5…D-8). Pure functions: money stays string/BigInt end to end
// (never converted to floating point), the OTP threshold and limits come only from GET /v1/transfer-policy, and nothing here
// sends requests or touches the same-tab transfer record.
import { mxnInputSchema, parseMxnToMinor, type ProductComponents } from '@fintech-wallet/shared';

export type Account = ProductComponents['schemas']['Account'];
export type Beneficiary = ProductComponents['schemas']['Beneficiary'];
export type TransferPolicy = ProductComponents['schemas']['TransferPolicy'];
export type DestinationType = 'beneficiary' | 'own_account';

/** W08-V6 copy (approved variant `w08_errores_en_formulario`, without its interbank-network claims). */
export const TRANSFER_MESSAGES = {
  amountInvalid: 'Ingresa un monto válido mayor a $0.00 MXN',
  amountFormat: 'Usa como máximo dos decimales y sin comas',
  conceptRequired: 'El concepto de transferencia es requerido',
  conceptLength: 'Usa como máximo 40 caracteres',
  reference: 'Ingresa una referencia numérica de hasta 7 dígitos',
  beneficiary: 'Selecciona un beneficiario para continuar',
  destinationAccount: 'Selecciona la cuenta de destino',
  blockedBeneficiary: 'Este beneficiario corresponde a la cuenta de origen',
  sameAccount: 'No es posible transferir a la misma cuenta de origen',
} as const;

export type TransferValues = { amount: string; concept: string; reference: string };
export type TransferField = 'recipient' | 'amount' | 'concept' | 'reference';
export type TransferErrors = Partial<Record<TransferField, string>>;
/** Focus order of the fields that can carry an error (first invalid one receives focus). */
export const TRANSFER_FIELDS: readonly TransferField[] = ['recipient', 'amount', 'concept', 'reference'];

/** Exact minor units of a valid MXN input (`10`, `10.5`, `10.50`), or null. Uses the shared parser (BigInt). */
export function amountMinorOf(raw: string): bigint | null {
  const parsed = mxnInputSchema.safeParse(raw);
  return parsed.success ? BigInt(parseMxnToMinor(parsed.data)) : null;
}

/** FN-06: `''`, `0`, `-1`, `abc` → «monto válido»; `10.999`, `1,000` → «dos decimales y sin comas». */
export function amountError(raw: string): string | undefined {
  if (amountMinorOf(raw) !== null) return undefined;
  const value = raw.trim();
  const looksNumeric = /^[0-9][0-9,]*(\.[0-9]+)?$/.test(value);
  if (looksNumeric && (value.includes(',') || /\.[0-9]{3,}$/.test(value)) && /[1-9]/.test(value)) return TRANSFER_MESSAGES.amountFormat;
  return TRANSFER_MESSAGES.amountInvalid;
}

/** FN-07: concept 1–40 characters after trim. */
export function conceptError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return TRANSFER_MESSAGES.conceptRequired;
  if (value.length > 40) return TRANSFER_MESSAGES.conceptLength;
  return undefined;
}

/** FN-07: numeric reference `^[0-9]{1,7}$`. */
export function referenceError(raw: string): string | undefined {
  return /^[0-9]{1,7}$/.test(raw) ? undefined : TRANSFER_MESSAGES.reference;
}

/** D-7: a beneficiary is not a valid destination when it resolves to the selected source account (identity). */
export function beneficiaryBlocked(item: Pick<Beneficiary, 'destinationAccountId' | 'ownAccountId'>, sourceAccountId: string) {
  return Boolean(sourceAccountId) && (item.ownAccountId === sourceAccountId || item.destinationAccountId === sourceAccountId);
}

export function validateTransfer(values: TransferValues, recipient: { type: DestinationType; id: string; blocked?: boolean }): TransferErrors {
  const errors: TransferErrors = {};
  if (!recipient.id) errors.recipient = recipient.type === 'beneficiary' ? TRANSFER_MESSAGES.beneficiary : TRANSFER_MESSAGES.destinationAccount;
  else if (recipient.blocked) errors.recipient = recipient.type === 'beneficiary' ? TRANSFER_MESSAGES.blockedBeneficiary : TRANSFER_MESSAGES.sameAccount;
  const amount = amountError(values.amount);
  if (amount) errors.amount = amount;
  const concept = conceptError(values.concept);
  if (concept) errors.concept = concept;
  const reference = referenceError(values.reference);
  if (reference) errors.reference = reference;
  return errors;
}

export const errorCount = (errors: TransferErrors) => TRANSFER_FIELDS.filter((field) => errors[field]).length;
export const errorCountLabel = (count: number) => `${count} ${count === 1 ? 'error detectado' : 'errores detectados'}`;

/**
 * `part / whole` as a percentage with one decimal, truncated like the approved W08 reference (93.17 % is shown as
 * 93.1). BigInt only; null when `whole` is not positive.
 */
export function percentOf(part: bigint, whole: bigint): string | null {
  if (whole <= 0n || part < 0n) return null;
  const tenths = (part * 1000n) / whole;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** Width for a progress bar (`0%`…`100%`), BigInt with two decimals. */
export function barWidth(part: bigint, whole: bigint): string {
  if (whole <= 0n || part <= 0n) return '0%';
  if (part >= whole) return '100%';
  const hundredths = (part * 10000n) / whole;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
}

/** Projected source balance after a debit; `exceeds` when the amount is greater than the balance (D-5: no blocking). */
export function projectDebit(availableMinor: string | undefined, amount: bigint | null) {
  if (availableMinor === undefined || amount === null || !/^-?[0-9]+$/.test(availableMinor)) return null;
  const available = BigInt(availableMinor);
  if (amount > available) return { exceeds: true as const, available };
  const projected = available - amount;
  return { exceeds: false as const, available, projected, percent: percentOf(projected, available), width: barWidth(projected, available) };
}

/** W13-V2: «Faltante para completar» = requested − available, only when positive. */
export function shortfall(requestedMinor: string, availableMinor: string | undefined): bigint | null {
  if (availableMinor === undefined || !/^[0-9]+$/.test(requestedMinor) || !/^-?[0-9]+$/.test(availableMinor)) return null;
  const missing = BigInt(requestedMinor) - BigInt(availableMinor);
  return missing > 0n ? missing : null;
}

/**
 * D-6: the review predicts the confirmation code only from the server policy (`amountMinor >= otpThresholdMinor`);
 * null when the policy is not available (neutral copy). The create response always prevails.
 */
export function requiresCode(amountMinor: string, policy: Pick<TransferPolicy, 'otpThresholdMinor'> | undefined): boolean | null {
  if (!policy || !/^[0-9]+$/.test(policy.otpThresholdMinor) || !/^[0-9]+$/.test(amountMinor)) return null;
  return BigInt(amountMinor) >= BigInt(policy.otpThresholdMinor);
}

/** `12345` → `123.45` for the W08 amount field when coming back from W13 (BigInt, no float). */
export function minorToInput(minor: string): string {
  if (!/^[0-9]+$/.test(minor)) return '';
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

/** Own-account destination: the selected one when valid, else the only other account (W08-V5 reference). */
export function effectiveOwnDestination(accounts: readonly Pick<Account, 'id'>[], sourceAccountId: string, selected: string) {
  const candidates = accounts.filter((item) => item.id !== sourceAccountId);
  if (selected && candidates.some((item) => item.id === selected)) return selected;
  return candidates.length === 1 ? candidates[0]!.id : '';
}

/** Exact create body (key order and values unchanged from f0ed4bc: REC-02 hashes it). */
export function createBody(input: { destinationType: DestinationType; sourceAccountId: string; beneficiaryId: string; destinationAccountId: string; amountMinor: string; concept: string; reference: string }) {
  const { destinationType, sourceAccountId, amountMinor, reference } = input;
  const concept = input.concept.trim();
  return destinationType === 'beneficiary'
    ? { sourceAccountId, destinationType, beneficiaryId: input.beneficiaryId, amountMinor, concept, reference }
    : { sourceAccountId, destinationType, destinationAccountId: input.destinationAccountId, amountMinor, concept, reference };
}
