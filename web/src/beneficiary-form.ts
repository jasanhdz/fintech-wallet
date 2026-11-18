import { beneficiaryInputSchema, isValidClabe, type ProductComponents } from '@fintech-wallet/shared';
import { ApiError } from './api.js';

export type Beneficiary = ProductComponents['schemas']['Beneficiary'];
export type BeneficiaryInput = ProductComponents['schemas']['BeneficiaryInput'];
export type BeneficiaryValues = { name: string; alias: string; clabe: string };
export type BeneficiaryField = keyof BeneficiaryValues;
export type BeneficiaryErrors = Partial<Record<BeneficiaryField, string>>;

/** Focus order of the W07 fields (first invalid field receives focus). */
export const BENEFICIARY_FIELDS: readonly BeneficiaryField[] = ['name', 'alias', 'clabe'];

/** W07-V4/V5 copy (SPEC §7.2 W07). */
export const BENEFICIARY_MESSAGES = {
  name: 'Ingresa el nombre completo o razón social del titular.',
  alias: 'Asigna un alias para identificar al contacto.',
  clabeLength: 'Ingresa los 18 dígitos numéricos de la cuenta.',
  clabeChecksum: 'La CLABE debe contener exactamente 18 dígitos y un dígito verificador válido. Revisa los números ingresados.',
} as const;

/** Keeps only digits (pasted CLABEs may carry spaces or dashes) and at most 18 of them. */
export const clabeDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 18);

export type BeneficiaryValidation =
  | { kind: 'valid'; body: BeneficiaryInput }
  /** Only the CLABE fails and it has 18 digits with a wrong control digit (W07-V5). */
  | { kind: 'clabe-checksum'; errors: BeneficiaryErrors }
  | { kind: 'invalid'; errors: BeneficiaryErrors };

/**
 * Client-side format validation before any request (W07-F1). The control digit uses the shared
 * `isValidClabe` (weights 3-7-1, the same check the API applies); no bank or destination is inferred.
 */
export function validateBeneficiary(values: BeneficiaryValues): BeneficiaryValidation {
  const name = values.name.trim();
  const alias = values.alias.trim();
  const clabe = clabeDigits(values.clabe);
  const errors: BeneficiaryErrors = {};
  if (!name) errors.name = BENEFICIARY_MESSAGES.name;
  if (!alias) errors.alias = BENEFICIARY_MESSAGES.alias;
  const checksumOnly = clabe.length === 18 && !isValidClabe(clabe);
  if (clabe.length !== 18) errors.clabe = BENEFICIARY_MESSAGES.clabeLength;
  else if (checksumOnly) errors.clabe = BENEFICIARY_MESSAGES.clabeChecksum;
  const count = Object.keys(errors).length;
  if (count === 1 && checksumOnly) return { kind: 'clabe-checksum', errors };
  if (count > 0) return { kind: 'invalid', errors };
  const parsed = beneficiaryInputSchema.safeParse({ name, alias, clabe });
  if (!parsed.success) {
    const fromSchema: BeneficiaryErrors = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]) as BeneficiaryField;
      if (field === 'name' || field === 'alias') fromSchema[field] = BENEFICIARY_MESSAGES[field];
      if (field === 'clabe') fromSchema.clabe = BENEFICIARY_MESSAGES.clabeLength;
    }
    return { kind: 'invalid', errors: fromSchema };
  }
  return { kind: 'valid', body: parsed.data };
}

export type BeneficiarySaveFailure =
  | { kind: 'session' }
  | { kind: 'forbidden' }
  /** 409 of `POST /beneficiaries`: the CLABE is already in the user's directory (W07-V6). */
  | { kind: 'duplicate' }
  /** 404 of `POST /beneficiaries`: no Billetera MXN account has that CLABE (W07-V7). */
  | { kind: 'not-found' }
  /** 422 of `POST /beneficiaries`: the API rejected the control digit (W07-V5). */
  | { kind: 'clabe-checksum'; errors: BeneficiaryErrors }
  /** 400 of `POST /beneficiaries`: field pointers when the Problem carries them, otherwise its detail. */
  | { kind: 'invalid'; errors: BeneficiaryErrors; detail?: string }
  /** 5xx, 429, network failure or an unreadable response: the values stay for «Reintentar guardar» (W07-V9). */
  | { kind: 'recoverable' };

/** Maps a failed `POST /v1/beneficiaries` to the W07 state using only the 0.3.0 contract statuses. */
export function beneficiarySaveFailure(error: unknown): BeneficiarySaveFailure {
  if (!(error instanceof ApiError)) return { kind: 'recoverable' };
  const { status } = error.problem;
  if (status === 401) return { kind: 'session' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 409) return { kind: 'duplicate' };
  if (status === 404) return { kind: 'not-found' };
  if (status === 422) return { kind: 'clabe-checksum', errors: { clabe: BENEFICIARY_MESSAGES.clabeChecksum } };
  if (status === 400) {
    const errors: BeneficiaryErrors = {};
    for (const item of error.problem.errors ?? []) {
      const field = item.pointer.split('/').at(-1);
      if (field === 'name' || field === 'alias' || field === 'clabe') errors[field] = item.detail;
    }
    return Object.keys(errors).length ? { kind: 'invalid', errors } : { kind: 'invalid', errors, detail: error.problem.detail || error.problem.title };
  }
  return { kind: 'recoverable' };
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es-MX').trim();

/** Last four digits of a masked CLABE (`646•••••••••••1234` → `1234`); never the full CLABE. */
export const maskedTail = (clabeMasked: string) => clabeMasked.replace(/\D/g, '').slice(-4);

/** W06-F1: local search by name, alias or the last four digits (no request). */
export function filterBeneficiaries<T extends Pick<Beneficiary, 'name' | 'alias' | 'clabeMasked'>>(items: readonly T[], query: string): T[] {
  const needle = fold(query);
  if (!needle) return [...items];
  const digits = /^\d+$/.test(needle);
  return items.filter((item) => fold(item.name).includes(needle) || fold(item.alias).includes(needle) || (digits && maskedTail(item.clabeMasked).includes(needle)));
}
