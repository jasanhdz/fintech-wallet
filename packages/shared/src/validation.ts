import { z } from 'zod';
import type { components as ProductComponents } from './generated/product-design.js';
import { parseMxnToMinor } from './money.js';

export function isValidClabe(value: string): boolean {
  if (!/^\d{18}$/.test(value)) return false;
  const weights = [3, 7, 1] as const;
  const sum = [...value.slice(0, 17)].reduce(
    (total, digit, index) => total + (Number(digit) * weights[index % 3]!) % 10,
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(value[17]);
}

const clabeSchema = z.string().regex(/^\d{18}$/).refine(isValidClabe, 'CLABE inválida.');

export const registerRequestSchema: z.ZodType<ProductComponents['schemas']['RegisterRequest']> = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12),
}).strict();

export const loginRequestSchema: z.ZodType<ProductComponents['schemas']['LoginRequest']> = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  client: z.enum(['web', 'mobile']),
}).strict();

export const beneficiaryInputSchema: z.ZodType<ProductComponents['schemas']['BeneficiaryInput']> = z.object({
  name: z.string().trim().min(1).max(120),
  alias: z.string().trim().min(1).max(80),
  clabe: clabeSchema,
}).strict();

const beneficiaryTransferSchema = z.object({
  sourceAccountId: z.string().uuid(),
  destinationType: z.literal('beneficiary'),
  beneficiaryId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9][0-9]*$/),
  concept: z.string().trim().min(1).max(40),
  reference: z.string().regex(/^[0-9]{1,7}$/),
}).strict();

const ownAccountTransferSchema = z.object({
  sourceAccountId: z.string().uuid(),
  destinationType: z.literal('own_account'),
  destinationAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9][0-9]*$/),
  concept: z.string().trim().min(1).max(40),
  reference: z.string().regex(/^[0-9]{1,7}$/),
}).strict();

export const transferCreateRequestSchema: z.ZodType<ProductComponents['schemas']['TransferCreateRequest']> = z.union([
  beneficiaryTransferSchema,
  ownAccountTransferSchema,
]);

export const transferConfirmRequestSchema: z.ZodType<ProductComponents['schemas']['TransferConfirmRequest']> = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
}).strict();

export const mxnInputSchema = z.string().trim().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/).refine((value) => {
  try {
    parseMxnToMinor(value);
    return true;
  } catch {
    return false;
  }
}, 'Importe MXN inválido.');
