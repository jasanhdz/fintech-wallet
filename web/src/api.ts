import type { ProductComponents } from '@fintech-wallet/shared';
import { API_URL } from './config.js';

export type User = ProductComponents['schemas']['User'];
export type Account = ProductComponents['schemas']['Account'];
export type AuthResponse = ProductComponents['schemas']['AuthResponse'];
export type Problem = ProductComponents['schemas']['Problem'];

export class ApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
  }
}

let csrfToken: string | undefined;
let accessToken: string | undefined;
let refreshFlight: Promise<AuthResponse> | undefined;
let onSessionExpired: (() => void) | undefined;

export function setCsrfToken(value: string) { csrfToken = value; }
export function setAccessToken(value: string | undefined) { accessToken = value; }
export function setSessionExpiredHandler(handler: (() => void) | undefined) { onSessionExpired = handler; }

async function send(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
  try {
    return await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new Error('No fue posible conectar. Revisa tu conexión e inténtalo de nuevo.');
  }
}

async function errorFor(response: Response): Promise<Error> {
  const problem = await response.json().catch(() => null) as Problem | null;
  if (problem?.title && typeof problem.status === 'number' && problem.requestId) return new ApiError(problem);
  return new Error('Ocurrió un error al procesar la solicitud. Inténtalo de nuevo.');
}

export async function getCsrf(): Promise<string> {
  const response = await send('/auth/csrf', {}, undefined);
  if (!response.ok) throw await errorFor(response);
  const result = await response.json() as { csrfToken: string };
  setCsrfToken(result.csrfToken);
  return result.csrfToken;
}

export async function refreshSession(): Promise<AuthResponse> {
  if (!refreshFlight) {
    refreshFlight = (async () => {
      await getCsrf();
      const response = await send('/auth/refresh', { method: 'POST', body: JSON.stringify({ client: 'web' }) });
      if (!response.ok) throw await errorFor(response);
      return response.json() as Promise<AuthResponse>;
    })().finally(() => { refreshFlight = undefined; });
  }
  return refreshFlight;
}

export async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const usedToken = token ?? accessToken;
  let response = await send(path, options, usedToken);
  if (response.status === 401 && path !== '/auth/refresh') {
    let retryToken: string;
    try {
      // Another request may already have completed rotation while this 401 was in flight.
      retryToken = accessToken && accessToken !== usedToken
        ? accessToken
        : (await refreshSession()).accessToken;
    }
    catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) {
        accessToken = undefined;
        onSessionExpired?.();
      }
      throw error;
    }
    accessToken = retryToken;
    response = await send(path, options, retryToken);
  }
  if (!response.ok) throw await errorFor(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
