import { useState, type FormEvent } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { loginRequestSchema, registerRequestSchema, formatMxnFromMinor } from '@fintech-wallet/shared';
import { ApiError, getCsrf, request, type Account, type AuthResponse, type Problem } from './api.js';
import { AppShell, AuthLayout, Brand, Field, Notice, StatePanel } from './components.js';
import { useSession } from './session.js';
import { readActiveTransferSummary } from './transfer-attempt.js';

type RecentMovement = { id: string; type: 'debit' | 'credit'; amountMinor: string; concept: string; occurredAt: string; status: 'processing' | 'completed' | 'rejected' };
type RecentMovementPage = { items: RecentMovement[] };

export function recentMovementsPath(accountId: string) {
  return `/accounts/${encodeURIComponent(accountId)}/movements?limit=3`;
}

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
  const navigate = useNavigate(); const location = useLocation(); const { session, start, hydrated } = useSession();
  const resumeTransfer = (location.state as { resumeTransfer?: boolean } | null)?.resumeTransfer === true;
  if (!hydrated) return <AuthLayout title="Cargando tu sesión…" subtitle="Estamos verificando tu acceso."> </AuthLayout>;
  if (session) return <Navigate to={resumeTransfer ? '/transfers/new' : '/accounts'} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const parsed = loginRequestSchema.safeParse({ email: data.get('email'), password: data.get('password'), client: 'web' });
    if (!parsed.success) { setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]))); return; }
    setBusy(true);
    try { await getCsrf(); const result = await request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) }); completeSession(result, start); navigate(resumeTransfer ? '/transfers/new' : '/accounts'); }
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

export function sumAvailableBalanceMinor(accounts: Account[]) {
  return accounts.reduce((total, account) => total + BigInt(account.availableBalanceMinor), 0n);
}

export function AccountsPage() {
  const { session, end, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts') });
  const firstAccountId = accounts.data?.items[0]?.id;
  const recent = useQuery({ queryKey: ['recent-movements', firstAccountId], queryFn: () => request<RecentMovementPage>(recentMovementsPath(firstAccountId!)), enabled: Boolean(firstAccountId) });
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/accounts' }} />;
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 403) return <AppShell><StatePanel title="Acceso no autorizado">No tienes permiso para consultar estas cuentas.</StatePanel></AppShell>;
  return <AppShell><div className="welcome-row"><div><span className="eyebrow">RESUMEN</span><h1>Hola, {session.user.fullName} <span aria-hidden="true">✦</span></h1><p>Este es el estado de tus cuentas.</p></div><Link className="primary-button button-link" to="/transfers/new">Transferir <span aria-hidden="true">→</span></Link></div>
    {accounts.isPending ? <section className="account-grid" aria-label="Cargando cuentas" aria-busy="true"><div className="account-skeleton" /><div className="account-skeleton" /></section>
      : accounts.error ? <StatePanel title="No pudimos cargar tus cuentas" action={<button className="secondary-button" onClick={() => void accounts.refetch()}>Intentar de nuevo</button>}>{messageFor(accounts.error)}</StatePanel>
      : accounts.data.items.length === 0 ? <StatePanel title="Aún no hay cuentas" >Cuando tengas una cuenta disponible, aparecerá aquí.</StatePanel>
        : <><section className="consolidated-balance" aria-labelledby="consolidated-balance-title"><div><h2 id="consolidated-balance-title">Saldo consolidado</h2><p>Suma del saldo disponible de tus {accounts.data.items.length} {accounts.data.items.length === 1 ? 'cuenta propia' : 'cuentas propias'}</p></div><strong aria-label={`${formatMxnFromMinor(String(sumAvailableBalanceMinor(accounts.data.items)))} pesos mexicanos`}>{formatMxnFromMinor(String(sumAvailableBalanceMinor(accounts.data.items)))} <span>MXN</span></strong></section><div className="section-heading"><div><h2>Tus cuentas</h2><p>{accounts.data.items.length} {accounts.data.items.length === 1 ? 'cuenta' : 'cuentas'} en MXN</p></div></div><section className="account-grid" aria-label="Tus cuentas">{accounts.data.items.map((account, index) => <article className={`account-card ${index === 0 ? 'featured' : ''}`} key={account.id}><div className="account-card-top"><span className="account-icon" aria-hidden="true">{account.kind === 'savings' ? '◌' : '↗'}</span><span className="currency-chip">{account.currency}</span></div><div className="account-name">{account.name}</div><div className="balance-label">Saldo disponible</div><div className="balance-value">{balance(account.availableBalanceMinor)}</div><div className="account-divider" /><div className="account-meta"><span>Cuenta {account.kind === 'savings' ? 'de ahorro' : 'principal'}</span><span className="masked-clabe">{account.clabeMasked}</span></div><Link className="account-history-link" to={`/accounts/${account.id}/movements`}>Ver movimientos de {account.name}<span aria-hidden="true"> →</span></Link></article>)}</section><section className="recent-activity" aria-labelledby="recent-activity-title"><div className="recent-heading"><div><h2 id="recent-activity-title">Actividad reciente</h2><span>Últimos movimientos</span></div><Link to={`/accounts/${firstAccountId}/movements`}>Ver historial completo <span aria-hidden="true">→</span></Link></div>{recent.isPending ? <div className="recent-state" role="status" aria-live="polite">Cargando movimientos…</div> : recent.isError ? <div className="recent-error" role="alert"><p>No pudimos cargar la actividad reciente.</p><button className="secondary-button" onClick={() => void recent.refetch()}>Intentar de nuevo</button></div> : recent.data.items.length === 0 ? <div className="recent-state">Aún no hay movimientos en esta cuenta.</div> : <div className="recent-table-wrap"><table className="recent-table"><caption className="sr-only">Últimos tres movimientos de {accounts.data.items[0]?.name ?? 'la cuenta principal'}</caption><thead><tr><th scope="col">Concepto</th><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Importe</th></tr></thead><tbody>{recent.data.items.slice(0, 3).map((item) => <tr key={item.id}><td><strong>{item.concept || 'Transferencia interna'}</strong></td><td>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.occurredAt))}</td><td>{item.type === 'debit' ? 'Cargo' : 'Abono'}</td><td><span className={`movement-status ${item.status}`}>{({ processing: 'En proceso', completed: 'Completado', rejected: 'Rechazado' })[item.status]}</span></td><td className={item.type === 'debit' ? 'amount-debit' : 'amount-credit'}>{item.type === 'debit' ? '−' : '+'}{formatMxnFromMinor(item.amountMinor)}</td></tr>)}</tbody></table></div>}</section></>}

    <section className="info-banner"><span className="info-icon" aria-hidden="true">i</span><div><strong>Tus cuentas, siempre a la vista</strong><p>Consulta aquí los saldos disponibles de tus cuentas en pesos mexicanos.</p></div></section>
  </AppShell>;
}

export function SessionExpiredPage() {
  const pending = readActiveTransferSummary();
  const loginState = pending ? { from: '/transfers/new', resumeTransfer: true } : undefined;
  if (!pending) return <main className="session-expired-page"><Brand /><section className="session-expired-card"><span className="session-expired-icon" aria-hidden="true">◷</span><h1>Tu sesión venció</h1><p>Inicia sesión para continuar operando de forma segura.</p><Link className="primary-button full button-link" to="/login">Iniciar sesión <span aria-hidden="true">→</span></Link></section></main>;
  return <main className="session-recovery-shell"><aside className="session-recovery-rail"><Brand /><span className="eyebrow">ACCESO</span><nav aria-label="Navegación de sesión"><Link to="/login" state={loginState}>Inicio</Link><Link to="/login" state={loginState}>Movimientos</Link><Link to="/login" state={loginState}>Beneficiarios</Link><Link to="/login" state={loginState}>Transferir</Link></nav><p>La sesión debe renovarse para continuar.</p></aside><header className="session-recovery-topbar"><span>Billetera MXN</span><span className="session-expired-badge">Sesión vencida</span></header><section className="session-recovery-content"><div className="session-recovery-breadcrumb">Billetera MXN <span>/</span> Sesión y recuperación</div><span className="eyebrow">SESIÓN Y RECUPERACIÓN</span><h1>Tu sesión venció</h1><p className="session-recovery-intro">Vuelve a autenticarte para consultar el resultado de la operación pendiente.</p><div className="session-recovery-grid"><section className="session-system-card"><span className="session-expired-icon" aria-hidden="true">◷</span><span className="eyebrow">ESTADO DE SESIÓN</span><h2>Se requiere iniciar sesión</h2><p>El acceso caducó. La operación pendiente se conserva en esta pestaña hasta volver a validar tu sesión.</p><Link className="primary-button button-link" to="/login" state={loginState}>Iniciar sesión y recuperar intento <span aria-hidden="true">→</span></Link></section><section className="session-pending-card" aria-labelledby="session-pending-title"><span className="eyebrow">CONTEXTO DE RECUPERACIÓN</span><h2 id="session-pending-title">Transferencia pendiente</h2><p>Al autenticarte, Billetera consultará el mismo intento para evitar duplicados.</p><dl><div><dt>Tipo de destino</dt><dd>{pending.destinationType === 'own_account' ? 'Entre mis cuentas' : 'Beneficiario Billetera'}</dd></div><div><dt>Importe</dt><dd data-sensitive>{formatMxnFromMinor(pending.amountMinor)} MXN</dd></div><div><dt>Concepto</dt><dd data-sensitive>{pending.concept}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{pending.reference}</dd></div></dl><p className="session-pending-safe">No se muestran datos de autenticación ni identificadores del intento.</p></section></div></section></main>;
}

export function AccessDeniedPage() { return <main className="access-denied-page"><Brand /><section className="access-denied-card"><div className="state-icon" aria-hidden="true">🔒</div><h1>Acceso no disponible</h1><p>No tienes permiso para consultar esta sección o el enlace no es válido.</p><Link className="primary-button button-link" to="/accounts">← Volver al inicio</Link></section></main>; }

export function NotFoundPage() { return <main className="not-found"><h1>Página no encontrada</h1><p>La dirección puede haber cambiado o no estar disponible.</p><Link to="/accounts">Ir a mis cuentas</Link></main>; }
