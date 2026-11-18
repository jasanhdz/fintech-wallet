import { useEffect, useState, type ChangeEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Account } from './api.js';
import { request } from './api.js';
import { useSession } from './session.js';
import { Icon, type IconName } from './icons.js';
import { useTransferPolicy } from './policy.js';
import { orderAccounts } from './account-order.js';

/**
 * W01/W02 (references `w01_login_demostraci_n`, `w02_registro`): brand header above a 440 px card on the
 * auth canvas. No demo chip without a session (E-G2): there is no server data to justify it.
 */
export function AuthLayout({ children, variant }: { children: ReactNode; variant: 'login' | 'register' }) {
  return <>
    <SkipLink />
    <div className="auth-screen">
      <header className="auth-brand"><span className="auth-brand-tile"><Icon name="walletOutlined" size={26} /></span><span className="auth-brand-name">Billetera MXN</span></header>
      <main className="auth-main" id="contenido" tabIndex={-1}><section className={`auth-card auth-card-${variant}`}>{children}</section></main>
    </div>
  </>;
}

export function AuthAlert({ children, detail }: { children: ReactNode; detail?: string }) {
  return <div className="auth-alert" role="alert"><Icon name="error" /><div><p>{children}</p>{detail && <p className="auth-alert-detail">{detail}</p>}</div></div>;
}

type AuthFieldProps = {
  id: string; label: string; value: string; onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password'; icon?: IconName; autoComplete: string; placeholder?: string;
  error?: string; help?: string; revealLabel?: string; maxLength?: number;
};

/** Auth input (44 px, radius 10, 1 px border) with optional leading icon, help text and show/hide toggle. */
export function AuthField({ id, label, value, onChange, type = 'text', icon, autoComplete, placeholder, error, help, revealLabel, maxLength }: AuthFieldProps) {
  const [shown, setShown] = useState(false);
  const revealable = type === 'password' && Boolean(revealLabel);
  const describedBy = [error ? `${id}-error` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ') || undefined;
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    <div className={`auth-input${icon ? ' has-icon' : ''}${revealable ? ' has-reveal' : ''}`}>
      {icon && <Icon name={icon} className="auth-input-icon" />}
      <input id={id} name={id} type={revealable && shown ? 'text' : type} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} autoComplete={autoComplete} placeholder={placeholder} maxLength={maxLength} spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {revealable && <button type="button" className="auth-reveal" aria-controls={id} aria-pressed={shown} aria-label={`${shown ? 'Ocultar' : 'Mostrar'} ${revealLabel}`} onClick={() => setShown((current) => !current)}><Icon name={shown ? 'visibilityOffOutlined' : 'visibilityOutlined'} /></button>}
    </div>
    {help && <p className="auth-help" id={`${id}-help`}>{help}</p>}
    {error && <p className="auth-field-error" id={`${id}-error`}><Icon name="error" size={16} /><span>{error}</span></p>}
  </div>;
}

/** W14 (references `w14_sesi_n_vencida`, `w14_acceso_no_autorizado`): centred brand + single card. */
export function StatusLayout({ children }: { children: ReactNode }) {
  return <>
    <SkipLink />
    <div className="status-screen">
      <main className="status-main" id="contenido" tabIndex={-1}>
        <header className="status-brand"><span className="status-brand-tile"><Icon name="walletOutlined" /></span><span className="status-brand-name">Billetera MXN</span></header>
        <section className="status-card">{children}</section>
      </main>
    </div>
  </>;
}

/**
 * W14 «Acceso no disponible» (D-11). Rendered in place for 403 and for 404 on id routes so the URL, the
 * resource existence and the same-tab transfer record are never touched. Also styles «Página no encontrada».
 */
export function AccessUnavailable({ title = 'Acceso no disponible', children = 'No tienes permisos para consultar esta sección o el enlace no es válido.' }: { title?: string; children?: ReactNode }) {
  const { session, hydrated } = useSession();
  // App sets the per-route title in a layout effect; this passive effect runs after it for in-place renders.
  useEffect(() => { document.title = `${title} · Billetera MXN`; }, [title]);
  return <StatusLayout>
    <span className="status-icon status-icon-access"><Icon name="lockOutlined" size={28} /></span>
    <h1 className="status-title">{title}</h1>
    <p className="status-text">{children}</p>
    <Link className="status-button" to={hydrated && session ? '/accounts' : '/login'}><Icon name="arrowBack" size={18} /><span>Volver al inicio</span></Link>
  </StatusLayout>;
}

export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) { return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>; }

export function initialsOf(fullName: string | undefined) {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[1]![0]}`;
  return letters.toLocaleUpperCase('es-MX');
}

/** Last four digits of a masked CLABE, e.g. `012•••••••••••1234` → `1234` (never the full CLABE). */
export function clabeTail(clabeMasked: string | undefined) {
  const digits = (clabeMasked ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

function focusMain(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('contenido')?.focus();
}

export function SkipLink() {
  return <a className="skip-link" href="#contenido" onFocus={(event) => event.currentTarget.classList.add('is-visible')} onBlur={(event) => event.currentTarget.classList.remove('is-visible')} onClick={focusMain}>Saltar al contenido</a>;
}

/**
 * UX-T1 shell (docs/web-ux-polish/SPEC.md §5.4, D-UX-1): one brand, one demo chip, one user block and ONE logout per
 * viewport. ≥1024: fixed opaque sidebar (brand, navigation, account block, «Cerrar sesión»), no topbar. <1024: static
 * topbar (brand + «Salir») that scrolls away and a fixed bottom navigation with the four destinations.
 */
export function AppShell({ children, active = 'accounts' }: { children: ReactNode; active?: string }) {
  const { session, end } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  const policy = useTransferPolicy();
  const demo = policy.data?.demoOnly === true;
  // ORD (SPEC §4): the «principal» account is the first one in client order, never the API order.
  const orderedAccounts = orderAccounts(accounts.data?.items ?? []);
  const primary = orderedAccounts[0];
  const tail = clabeTail(primary?.clabeMasked);
  const initials = initialsOf(session?.user.fullName);
  async function logout() {
    try { await request<void>('/auth/logout', { method: 'POST' }); } catch { /* Local session is cleared even when the network is unavailable. */ } finally { end(); navigate('/login'); }
  }
  const navItems: Array<{ key: string; label: string; href: string; icon: IconName }> = [
    { key: 'accounts', label: 'Inicio', href: '/accounts', icon: 'bank' },
    { key: 'movements', label: 'Movimientos', href: location.pathname.match(/^\/accounts\/([^/]+)\/movements/)?.[0] ?? (primary ? `/accounts/${primary.id}/movements` : '/accounts'), icon: 'receipt' },
    { key: 'beneficiaries', label: 'Beneficiarios', href: '/beneficiaries', icon: 'contacts' },
    { key: 'transfers', label: 'Transferir', href: '/transfers/new', icon: 'send' },
  ];
  const selected = active === 'accounts' && location.pathname.includes('/movements') ? 'movements' : active;
  const navLink = (item: (typeof navItems)[number], className: string) => <Link key={item.key} className={`${className}${selected === item.key ? ' is-active' : ''}`} aria-current={selected === item.key ? 'page' : undefined} to={item.href}><Icon name={item.icon} /><span>{item.label}</span></Link>;
  return <div className="shell">
    <SkipLink />
    <aside className="shell-sidebar" aria-label="Barra lateral">
      <div className="shell-brand"><span className="brand-tile"><Icon name="wallet" /></span><span className="shell-brand-text"><span className="shell-brand-name">Billetera MXN</span>{demo && <span className="chip chip-demo">Demostración</span>}</span></div>
      <nav className="shell-nav" aria-label="Navegación principal">{navItems.map((item) => navLink(item, 'shell-nav-item'))}</nav>
      <div className="shell-sidebar-bottom">
        <div className="shell-user-card" data-user-block><span className="shell-avatar" aria-hidden="true">{initials}</span><span className="shell-user-text"><span className="shell-user-name" title={session?.user.fullName}>{session?.user.fullName}</span>{tail && <span className="shell-user-account" data-clabe>Cuenta •• {tail}</span>}</span></div>
        <button type="button" className="shell-logout" onClick={() => void logout()}><Icon name="logout" /><span>Cerrar sesión</span></button>
      </div>
    </aside>
    <header className="shell-topbar">
      <div className="shell-topbar-brand"><span className="brand-tile"><Icon name="wallet" /></span><span className="shell-topbar-title">Billetera MXN</span>{demo && <span className="chip chip-demo">Demostración</span>}</div>
      <button type="button" className="shell-topbar-logout" aria-label="Cerrar sesión" onClick={() => void logout()}><Icon name="logout" /><span>Salir</span></button>
    </header>
    <main className="shell-main" id="contenido" tabIndex={-1}>{children}</main>
    <nav className="shell-bottom-nav" aria-label="Navegación principal">{navItems.map((item) => navLink(item, 'shell-bottom-item'))}</nav>
  </div>;
}

/** Page heading block (SPEC §5.1, §5.3): optional eyebrow/breadcrumb, the view's only h1 (focus target) and a subtitle. */
export function PageHeader({ title, eyebrow, subtitle, children, className = '' }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; children?: ReactNode; className?: string }) {
  return <header className={`page-header ${className}`.trim()}>
    {eyebrow}
    <h1 className="t-headline-lg" tabIndex={-1}>{title}</h1>
    {subtitle && <p className="t-body-md page-subtitle">{subtitle}</p>}
    {children}
  </header>;
}

/**
 * D-UX-10: loading panels show a spinner and are a status region; error panels show the error icon and are an alert.
 * `tone="info"` keeps the neutral information icon for empty/blocked states.
 */
export function StatePanel({ title, children, action, tone = 'info' }: { title: string; children: ReactNode; action?: ReactNode; tone?: 'info' | 'loading' | 'error' }) {
  const role = tone === 'loading' ? 'status' : tone === 'error' ? 'alert' : undefined;
  const icon: IconName = tone === 'loading' ? 'spinner' : tone === 'error' ? 'error' : 'info';
  return <section className={`state-panel is-${tone}`} aria-busy={tone === 'loading' || undefined}>
    <div className="state-icon" aria-hidden="true"><Icon name={icon} className={tone === 'loading' ? 'spin' : undefined} /></div>
    <div className="state-text" role={role}><h2>{title}</h2><p>{children}</p></div>
    {action}
  </section>;
}

export type ErrorSummaryItem = { field: string; label: string; message: string };

/**
 * SPEC §5.5 `FormErrorSummary`: lives inside the form immediately before its actions, so the cause of a blocked
 * submit is next to the button. One button per invalid field moves the focus to that field.
 */
export function FormErrorSummary({ id, title, items = [], children, tone = 'error', focusRef }: {
  id: string; title: string; items?: ErrorSummaryItem[]; children?: ReactNode; tone?: 'error' | 'warning' | 'progress';
  focusRef?: Ref<HTMLDivElement>;
}) {
  const role = tone === 'progress' ? 'status' : 'alert';
  const toneClass = { error: 'is-error', warning: 'is-warning', progress: 'is-progress' }[tone];
  return <div ref={focusRef} id={id} className={`form-summary ${toneClass}`} role={role} tabIndex={-1} aria-labelledby={`${id}-title`}>
    <span className="form-summary-icon" aria-hidden="true"><Icon name={tone === 'progress' ? 'spinner' : tone === 'warning' ? 'warning' : 'error'} size={20} className={tone === 'progress' ? 'spin' : undefined} /></span>
    <div className="form-summary-body">
      <p className="t-body-md-medium form-summary-title" id={`${id}-title`}>{title}</p>
      {children && <div className="t-body-sm form-summary-text">{children}</div>}
      {items.length > 0 && <ul className="form-summary-list">
        {items.map((item) => <li key={item.field}><button type="button" className="form-summary-link t-body-sm-medium" onClick={() => {
          // A radio group is reached through its tab stop (the checked option or the first enabled one).
          const element = document.getElementById(item.field);
          const target = element && !element.matches('input,select,textarea,button,a[href],[tabindex]') ? element.querySelector<HTMLElement>('[tabindex="0"],input,button') : element;
          target?.focus();
        }}>{item.label}</button></li>)}
      </ul>}
    </div>
  </div>;
}

/**
 * SPEC §5.5 `ActionBar`: the primary action (and the reason it is disabled) of a long form. Below 1024 px it is
 * sticky above the bottom navigation; from 1024 px (and on short viewports) it sits in the normal flow at the right.
 */
export function ActionBar({ children, reason, reasonId }: { children: ReactNode; reason?: ReactNode; reasonId?: string }) {
  return <div className="action-bar">
    {reason && <p className="action-bar-reason t-body-sm" id={reasonId}><Icon name="infoOutlined" size={16} /><span>{reason}</span></p>}
    <div className="action-bar-primary">{children}</div>
  </div>;
}
