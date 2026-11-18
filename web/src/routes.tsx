import { useState, type FormEvent } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { loginRequestSchema, registerRequestSchema, formatMxnFromMinor } from '@fintech-wallet/shared';
import { ApiError, getCsrf, request, type Account, type AuthResponse, type Problem } from './api.js';
import { AppShell, AuthLayout, Field, Notice, StatePanel } from './components.js';
import { useSession } from './session.js';

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.problem.detail || error.problem.title} (referencia ${error.problem.requestId})`;
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud.';
}

function fieldsFor(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(((error.problem as Problem).errors || []).map((item) => [item.pointer.split('/').at(-1) || '', item.detail]));
}

function completeSession(result: AuthResponse, start: (token: string, user: AuthResponse['user']) => void) {
  start(result.accessToken, result.user);
}

export function LoginPage() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate(); const { session, start, hydrated } = useSession();
  if (!hydrated) return <AuthLayout title="Cargando tu sesión…" subtitle="Estamos verificando tu acceso."> </AuthLayout>;
  if (session) return <Navigate to="/accounts" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const parsed = loginRequestSchema.safeParse({ email: data.get('email'), password: data.get('password'), client: 'web' });
    if (!parsed.success) { setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]))); return; }
    setBusy(true);
    try { await getCsrf(); const result = await request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) }); completeSession(result, start); navigate('/accounts'); }
    catch (cause) { setError(messageFor(cause)); setFieldErrors(fieldsFor(cause)); }
    finally { setBusy(false); }
  }
  return <AuthLayout title="Qué gusto verte." subtitle="Inicia sesión para continuar a tu cuenta."><form onSubmit={submit} noValidate>{error && <Notice>{error}</Notice>}<Field id="email" label="Correo electrónico" type="email" autoComplete="email" placeholder="nombre@correo.com" error={fieldErrors.email} required /><Field id="password" label="Contraseña" type="password" autoComplete="current-password" placeholder="Tu contraseña" error={fieldErrors.password} required /><button className="primary-button full" disabled={busy}>{busy ? 'Iniciando sesión…' : 'Iniciar sesión'}<span aria-hidden="true">→</span></button></form><p className="form-switch">¿Aún no tienes cuenta? <Link to="/register">Regístrate</Link></p></AuthLayout>;
}

export function RegisterPage() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate(); const { session, start, hydrated } = useSession();
  if (!hydrated) return <AuthLayout title="Cargando tu sesión…" subtitle="Estamos verificando tu acceso."> </AuthLayout>;
  if (session) return <Navigate to="/accounts" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const parsed = registerRequestSchema.safeParse({ fullName: data.get('fullName'), email: data.get('email'), password: data.get('password') });
    if (!parsed.success) { setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]))); return; }
    setBusy(true);
    try { await getCsrf(); const result = await request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(parsed.data) }); completeSession(result, start); navigate('/accounts'); }
    catch (cause) { setError(messageFor(cause)); setFieldErrors(fieldsFor(cause)); }
    finally { setBusy(false); }
  }
  return <AuthLayout title="Empieza por aquí." subtitle="Crea tu cuenta y ten tus finanzas a la mano."><form onSubmit={submit} noValidate>{error && <Notice>{error}</Notice>}<Field id="fullName" label="Nombre completo" autoComplete="name" placeholder="Como te llamas" error={fieldErrors.fullName} required /><Field id="email" label="Correo electrónico" type="email" autoComplete="email" placeholder="nombre@correo.com" error={fieldErrors.email} required /><Field id="password" label="Crea una contraseña" type="password" autoComplete="new-password" placeholder="Al menos 12 caracteres" error={fieldErrors.password} required minLength={12} /><p className="helper-text">Usa al menos 12 caracteres.</p><button className="primary-button full" disabled={busy}>{busy ? 'Creando tu cuenta…' : 'Crear cuenta'}<span aria-hidden="true">→</span></button></form><p className="form-switch">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p></AuthLayout>;
}

function balance(value: string) { return formatMxnFromMinor(value); }

export function AccountsPage() {
  const { session, end, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts') });
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/accounts' }} />;
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 401) { end(); return <Navigate to="/session-expired" replace />; }
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 403) return <AppShell><StatePanel title="Acceso no autorizado">No tienes permiso para consultar estas cuentas.</StatePanel></AppShell>;
  return <AppShell><div className="welcome-row"><div><span className="eyebrow">RESUMEN</span><h1>Hola, {session.user.fullName.split(' ')[0]} <span aria-hidden="true">✦</span></h1><p>Este es el estado de tus cuentas.</p></div><Link className="primary-button button-link" to="/transfers/new">Transferir <span aria-hidden="true">→</span></Link></div>
    {accounts.isPending ? <section className="account-grid" aria-label="Cargando cuentas" aria-busy="true"><div className="account-skeleton" /><div className="account-skeleton" /></section>
      : accounts.error ? <StatePanel title="No pudimos cargar tus cuentas" action={<button className="secondary-button" onClick={() => void accounts.refetch()}>Intentar de nuevo</button>}>{messageFor(accounts.error)}</StatePanel>
      : accounts.data.items.length === 0 ? <StatePanel title="Aún no hay cuentas" >Cuando tengas una cuenta disponible, aparecerá aquí.</StatePanel>
      : <><div className="section-heading"><div><h2>Tus cuentas</h2><p>{accounts.data.items.length} {accounts.data.items.length === 1 ? 'cuenta' : 'cuentas'} en MXN</p></div></div><section className="account-grid" aria-label="Tus cuentas">{accounts.data.items.map((account, index) => <article className={`account-card ${index === 0 ? 'featured' : ''}`} key={account.id}><div className="account-card-top"><span className="account-icon" aria-hidden="true">{account.kind === 'savings' ? '◌' : '↗'}</span><span className="currency-chip">{account.currency}</span></div><div className="account-name">{account.name}</div><div className="balance-label">Saldo disponible</div><div className="balance-value">{balance(account.availableBalanceMinor)}</div><div className="account-divider" /><div className="account-meta"><span>Cuenta {account.kind === 'savings' ? 'de ahorro' : 'principal'}</span><span className="masked-clabe">{account.clabeMasked}</span></div></article>)}</section></>}
    <section className="info-banner"><span className="info-icon" aria-hidden="true">i</span><div><strong>Tus cuentas, siempre a la vista</strong><p>Consulta aquí los saldos disponibles de tus cuentas en pesos mexicanos.</p></div></section>
  </AppShell>;
}

export function SessionExpiredPage() { return <AuthLayout title="Tu sesión terminó." subtitle="Vuelve a iniciar sesión para consultar tus cuentas."><Notice tone="info">Por seguridad, necesitas autenticarte de nuevo.</Notice><Link className="primary-button full button-link" to="/login">Ir a iniciar sesión <span aria-hidden="true">→</span></Link></AuthLayout>; }

export function AccessDeniedPage() { return <AppShell><StatePanel title="Acceso no autorizado" action={<Link className="secondary-button button-link" to="/accounts">Volver a mis cuentas</Link>}>No tienes permiso para ver este contenido.</StatePanel></AppShell>; }

export function NotFoundPage() { return <main className="not-found"><h1>Página no encontrada</h1><p>La dirección puede haber cambiado o no estar disponible.</p><Link to="/accounts">Ir a mis cuentas</Link></main>; }
