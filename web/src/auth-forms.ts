// Pure validation and error mapping for W01 (login) and W02 (register). Field rules follow the contract
// schemas in @fintech-wallet/shared (password ≥ 12 on register); messages are the product's Spanish copy.
import { loginRequestSchema, registerRequestSchema } from '@fintech-wallet/shared';
import { ApiError, type Problem } from './api.js';

export type FieldErrors = Partial<Record<string, string>>;
export type LoginValues = { email: string; password: string };
export type RegisterValues = { fullName: string; email: string; password: string; confirmPassword: string };
export type FormFailure = { message: string; requestId?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailError(value: string) {
  const email = value.trim();
  if (!email) return 'Ingresa tu correo electrónico.';
  if (!EMAIL_RE.test(email)) return 'Ingresa un correo electrónico válido.';
  return undefined;
}

/** Client validation for W01; returns the exact contract body when valid. */
export function validateLogin(values: LoginValues): { errors: FieldErrors; body?: { email: string; password: string; client: 'web' } } {
  const errors: FieldErrors = {};
  const email = emailError(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = 'Ingresa tu contraseña.';
  if (Object.keys(errors).length) return { errors };
  const parsed = loginRequestSchema.safeParse({ email: values.email, password: values.password, client: 'web' });
  if (!parsed.success) return { errors: { email: 'Ingresa un correo electrónico válido.' } };
  return { errors, body: parsed.data as { email: string; password: string; client: 'web' } };
}

/** Client validation for W02; the confirmation never leaves the browser (body = fullName, email, password). */
export function validateRegister(values: RegisterValues): { errors: FieldErrors; body?: { fullName: string; email: string; password: string } } {
  const errors: FieldErrors = {};
  const fullName = values.fullName.trim();
  if (!fullName) errors.fullName = 'Ingresa tu nombre completo.';
  else if (fullName.length > 120) errors.fullName = 'Usa como máximo 120 caracteres.';
  const email = emailError(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = 'Crea una contraseña.';
  else if (values.password.length < 12) errors.password = 'La contraseña debe tener al menos 12 caracteres.';
  if (!values.confirmPassword) errors.confirmPassword = 'Confirma tu contraseña.';
  else if (values.confirmPassword !== values.password) errors.confirmPassword = 'Las contraseñas no coinciden.';
  if (Object.keys(errors).length) return { errors };
  const parsed = registerRequestSchema.safeParse({ fullName: values.fullName, email: values.email, password: values.password });
  if (!parsed.success) return { errors: { email: 'Revisa los datos capturados.' } };
  return { errors, body: parsed.data as { fullName: string; email: string; password: string } };
}

export const NETWORK_MESSAGE = 'No fue posible conectar. Revisa tu conexión e inténtalo de nuevo.';
export const RATE_LIMITED_MESSAGE = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
export const BAD_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.';
const GENERIC_MESSAGE = 'No fue posible completar la solicitud. Inténtalo de nuevo.';

const isNetworkError = (error: unknown) => error instanceof Error && !(error instanceof ApiError) && error.message.startsWith('No fue posible conectar');
// api.ts answers a 401 on any path with a refresh attempt; with no session to refresh it throws this plain
// Error. On the login form that 401 can only mean rejected credentials (see DEPENDENCIES.md, DEP-W1).
const isUnrefreshable401 = (error: unknown) => error instanceof Error && !(error instanceof ApiError) && error.message.startsWith('La sesión ya no está disponible');

/** W01-F3: credentials, rate limit and connectivity are distinct; the server never reveals account existence. */
export function loginFailure(error: unknown): FormFailure {
  if (error instanceof ApiError) {
    const { status, requestId } = error.problem;
    if (status === 401) return { message: BAD_CREDENTIALS_MESSAGE, requestId };
    if (status === 429) return { message: RATE_LIMITED_MESSAGE, requestId };
    return { message: error.problem.detail || GENERIC_MESSAGE, requestId };
  }
  if (isNetworkError(error)) return { message: NETWORK_MESSAGE };
  if (isUnrefreshable401(error)) return { message: BAD_CREDENTIALS_MESSAGE };
  return { message: GENERIC_MESSAGE };
}

/** W02-F2: 409 shows the server detail verbatim (it never confirms whether the e-mail exists). */
export function registerFailure(error: unknown): FormFailure {
  if (error instanceof ApiError) {
    const { status, requestId } = error.problem;
    if (status === 429) return { message: RATE_LIMITED_MESSAGE, requestId };
    return { message: error.problem.detail || GENERIC_MESSAGE, requestId };
  }
  if (isNetworkError(error)) return { message: NETWORK_MESSAGE };
  return { message: GENERIC_MESSAGE };
}

/** Field-level problems returned by the API (`errors[].pointer`), keyed by the last pointer segment. */
export function serverFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(((error.problem as Problem).errors || []).map((item) => [item.pointer.split('/').at(-1) || '', item.detail]));
}
