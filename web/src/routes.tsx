import { useState, type FormEvent } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { formatMxnFromMinor } from '@fintech-wallet/shared';
import { getCsrf, request, type AuthResponse } from './api.js';
import { AccessUnavailable, AuthAlert, AuthField, AuthLayout, StatusLayout } from './components.js';
import { Icon } from './icons.js';
import { useSession } from './session.js';
import { readActiveTransferSummary } from './transfer-attempt.js';
import { loginFailure, registerFailure, serverFieldErrors, validateLogin, validateRegister, type FieldErrors, type FormFailure, type LoginValues, type RegisterValues } from './auth-forms.js';

export { AccountsPage, recentMovementsPath, sumAvailableBalanceMinor } from './home.js';

function completeSession(result: AuthResponse, start: (token: string, user: AuthResponse['user']) => void) {
  start(result.accessToken, result.user);
}

function focusFirstInvalid(form: HTMLFormElement | null, errors: FieldErrors, order: string[]) {
  const first = order.find((name) => errors[name]);
  if (first) form?.querySelector<HTMLInputElement>(`#${first}`)?.focus();
}

/** Keeps every other field's message and replaces (or clears) the edited field's one. */
function revalidated(current: FieldErrors, name: string, fresh: FieldErrors): FieldErrors {
  const next = { ...current };
  if (fresh[name]) next[name] = fresh[name]; else delete next[name];
  return next;
}

/** Hydration placeholder for /login and /register while the refresh cookie is checked. */
function AuthLoading() {
  return <StatusLayout><span className="status-icon"><Icon name="spinner" size={28} className="spin" /></span><h1 className="status-title">Cargando tu sesión…</h1><p className="status-text" role="status">Estamos verificando tu acceso.</p></StatusLayout>;
}

function BusyLabel({ children }: { children: string }) {
  return <><Icon name="spinner" size={18} className="spin" /><span>{children}</span></>;
}

const requestDetail = (failure: FormFailure) => failure.requestId ? `Referencia de la solicitud: ${failure.requestId}` : undefined;

/** W01 · reference `w01_login_demostraci_n`. */
export function LoginPage() {
  const [values, setValues] = useState<LoginValues>({ email: '', password: '' });
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<FormFailure | null>(null); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const navigate = useNavigate(); const location = useLocation(); const { session, start, hydrated } = useSession();
  const resumeTransfer = (location.state as { resumeTransfer?: boolean } | null)?.resumeTransfer === true;
  if (!hydrated) return <AuthLoading />;
  if (session) return <Navigate to={resumeTransfer ? '/transfers/new' : '/accounts'} replace />;
  // SPEC §5.5: after a submit with errors a field's message follows its value (no new errors on untouched fields).
  const set = (name: keyof LoginValues) => (value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (fieldErrors[name]) setFieldErrors((current) => revalidated(current, name, validateLogin(next).errors));
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFailure(null);
    const form = event.currentTarget;
    const { errors, body } = validateLogin(values);
    setFieldErrors(errors);
    if (!body) { focusFirstInvalid(form, errors, ['email', 'password']); return; }
    setBusy(true);
    try { await getCsrf(); const result = await request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }); completeSession(result, start); navigate(resumeTransfer ? '/transfers/new' : '/accounts'); }
    catch (cause) { setFailure(loginFailure(cause)); setFieldErrors(serverFieldErrors(cause)); }
    finally { setBusy(false); }
  }
  return <AuthLayout variant="login">
    <div className="auth-heading"><h1>Iniciar sesión</h1><p>Ingresa tus credenciales para acceder a tus cuentas</p></div>
    {failure && <AuthAlert detail={requestDetail(failure)}>{failure.message}</AuthAlert>}
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
      <AuthField id="email" label="Correo electrónico" type="email" icon="mailOutlined" autoComplete="email" placeholder="nombre@correo.com" value={values.email} onChange={set('email')} error={fieldErrors.email} />
      <AuthField id="password" label="Contraseña" type="password" icon="lockOutlined" autoComplete="current-password" placeholder="Ingresa tu contraseña" value={values.password} onChange={set('password')} error={fieldErrors.password} revealLabel="contraseña" />
      <button className="auth-submit" type="submit" disabled={busy} aria-describedby="login-status">{busy ? <BusyLabel>Iniciando sesión…</BusyLabel> : <><span>Iniciar sesión</span><Icon name="arrowForward" size={19} /></>}</button>
      <p className="sr-only" id="login-status" role="status">{busy ? 'Iniciando sesión…' : ''}</p>
    </form>
    <div className="auth-footer"><p>¿No tienes una cuenta? <Link to="/register">Regístrate aquí</Link></p></div>
  </AuthLayout>;
}

/** W02 · reference `w02_registro`. */
export function RegisterPage() {
  const [values, setValues] = useState<RegisterValues>({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<FormFailure | null>(null); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const navigate = useNavigate(); const { session, start, hydrated } = useSession();
  if (!hydrated) return <AuthLoading />;
  if (session) return <Navigate to="/accounts" replace />;
  const set = (name: keyof RegisterValues) => (value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (fieldErrors[name]) setFieldErrors((current) => revalidated(current, name, validateRegister(next).errors));
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFailure(null);
    const form = event.currentTarget;
    const { errors, body } = validateRegister(values);
    setFieldErrors(errors);
    if (!body) { focusFirstInvalid(form, errors, ['fullName', 'email', 'password', 'confirmPassword']); return; }
    setBusy(true);
    try { await getCsrf(); const result = await request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }); completeSession(result, start); navigate('/accounts'); }
    catch (cause) {
      setFailure(registerFailure(cause)); setFieldErrors(serverFieldErrors(cause));
      // W02-F2: name and e-mail stay; passwords are never kept after a rejected registration.
      setValues((current) => ({ ...current, password: '', confirmPassword: '' }));
    }
    finally { setBusy(false); }
  }
  return <AuthLayout variant="register">
    <div className="auth-heading auth-heading-centered"><h1>Crea tu cuenta</h1><p>Crea tu cuenta en Billetera MXN</p></div>
    {failure && <AuthAlert detail={requestDetail(failure)}>{failure.message}</AuthAlert>}
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
      <AuthField id="fullName" label="Nombre completo" autoComplete="name" placeholder="Nombre y apellidos" maxLength={120} value={values.fullName} onChange={set('fullName')} error={fieldErrors.fullName} />
      <AuthField id="email" label="Correo electrónico" type="email" autoComplete="email" placeholder="nombre@correo.com" value={values.email} onChange={set('email')} error={fieldErrors.email} />
      <AuthField id="password" label="Contraseña" type="password" autoComplete="new-password" placeholder="Al menos 12 caracteres" value={values.password} onChange={set('password')} error={fieldErrors.password} help="Usa al menos 12 caracteres." revealLabel="contraseña" />
      <AuthField id="confirmPassword" label="Confirmar contraseña" type="password" autoComplete="new-password" placeholder="Repite tu contraseña" value={values.confirmPassword} onChange={set('confirmPassword')} error={fieldErrors.confirmPassword} revealLabel="confirmación" />
      <div className="auth-submit-row"><button className="auth-submit" type="submit" disabled={busy} aria-describedby="register-status">{busy ? <BusyLabel>Creando tu cuenta…</BusyLabel> : <span>Crear cuenta</span>}</button></div>
      <p className="sr-only" id="register-status" role="status">{busy ? 'Creando tu cuenta…' : ''}</p>
    </form>
    <div className="auth-footer auth-footer-plain"><p>¿Ya tienes una cuenta? <Link to="/login">Inicia sesión</Link></p></div>
  </AuthLayout>;
}

/** W14 · reference `w14_sesi_n_vencida`; V3 adds the same-tab attempt summary inside the same card. */
export function SessionExpiredPage() {
  const pending = readActiveTransferSummary();
  const loginState = pending ? { from: '/transfers/new', resumeTransfer: true } : undefined;
  return <StatusLayout>
    <span className="status-icon status-icon-session"><Icon name="lockClockOutlined" size={32} /></span>
    <h1 className="status-title">Tu sesión venció</h1>
    <p className={`status-text${pending ? ' has-pending' : ''}`}>Inicia sesión para continuar operando de forma segura.</p>
    {pending && <div className="status-pending">
      <p>Tienes una transferencia pendiente de verificación por <strong data-amount>{formatMxnFromMinor(pending.amountMinor)}</strong> ({pending.destinationType === 'own_account' ? 'entre mis cuentas' : 'a un beneficiario'}).</p>
      <dl><div><dt>Concepto</dt><dd>{pending.concept}</dd></div><div><dt>Referencia</dt><dd className="tabular">{pending.reference}</dd></div></dl>
    </div>}
    <Link className="status-button" to="/login" state={loginState}><span>{pending ? 'Iniciar sesión y retomar la verificación' : 'Iniciar sesión'}</span><Icon name="arrowForward" size={18} /></Link>
  </StatusLayout>;
}

export function AccessDeniedPage() { return <AccessUnavailable />; }

export function NotFoundPage() { return <AccessUnavailable title="Página no encontrada">La dirección puede haber cambiado o no estar disponible.</AccessUnavailable>; }
