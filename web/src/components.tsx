import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Account } from './api.js';
import { request } from './api.js';
import { useSession } from './session.js';

export function Brand() { return <Link className="brand" to="/login" aria-label="Billetera, inicio"><span className="brand-mark">b</span><span>Billetera<span className="brand-dot">.</span></span></Link>; }

export function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return <main className="auth-page auth-page-centered"><section className="auth-main"><div className="auth-card"><Brand /><span className="eyebrow">BIENVENIDO A BILLETERA</span><h2>{title}</h2><p className="auth-subtitle">{subtitle}</p>{children}</div><p className="auth-legal">Al continuar, aceptas nuestros términos y aviso de privacidad.</p></section></main>;
}

export function Field({ id, label, type = 'text', autoComplete, error, ...props }: { id: string; label: string; type?: string; autoComplete?: string; error?: string; [key: string]: unknown }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} name={id} type={type} autoComplete={autoComplete} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />{error && <span className="field-error" id={`${id}-error`}>{error}</span>}</div>;
}

export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) { return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>; }

export function AppShell({ children, active = 'accounts' }: { children: ReactNode; active?: string }) {
  const { session, end } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const cachedAccounts = useQueryClient().getQueryData<{ items: Account[] }>(['accounts']);
  async function logout() {
    try { await request<void>('/auth/logout', { method: 'POST' }); } catch { /* Local session is cleared even when the network is unavailable. */ } finally { end(); navigate('/login'); }
  }
  const navItems = [
    { key: 'accounts', label: 'Inicio', href: '/accounts' },
    { key: 'movements', label: 'Movimientos', href: location.pathname.match(/^\/accounts\/([^/]+)\/movements/)?.[0] ?? (cachedAccounts?.items[0] ? `/accounts/${cachedAccounts.items[0].id}/movements` : '/accounts') },
    { key: 'beneficiaries', label: 'Beneficiarios', href: '/beneficiaries' },
    { key: 'transfers', label: 'Transferir', href: '/transfers/new' },
  ];
  const selected = active === 'accounts' && location.pathname.includes('/movements') ? 'movements' : active;
  return <div className="app-shell"><header className="topbar"><Brand /><span className="topbar-title">Billetera MXN</span><div className="profile"><span className="avatar" aria-hidden="true">{session?.user.fullName.slice(0, 1).toUpperCase()}</span><span className="profile-name">{session?.user.fullName}</span></div></header><aside className="app-rail"><Brand /><nav aria-label="Navegación principal">{navItems.map((item) => <Link key={item.key} className={selected === item.key ? 'nav-active' : ''} aria-current={selected === item.key ? 'page' : undefined} to={item.href}>{item.label}</Link>)}</nav><div className="rail-account"><span className="avatar" aria-hidden="true">{session?.user.fullName.slice(0, 1).toUpperCase()}</span><span>{session?.user.fullName}</span></div><button className="text-button rail-logout" onClick={() => void logout()}>Salir</button></aside><main className="page-content">{children}</main><footer className="app-footer">Billetera <span>·</span> Tus cuentas, en un solo lugar</footer><nav className="mobile-nav" aria-label="Navegación principal">{navItems.map((item) => <Link key={item.key} className={selected === item.key ? 'nav-active' : ''} aria-current={selected === item.key ? 'page' : undefined} to={item.href}>{item.label}</Link>)}<button className="text-button" onClick={() => void logout()}>Salir</button></nav></div>;
}

export function StatePanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="state-panel"><div className="state-icon" aria-hidden="true">!</div><h2>{title}</h2><p>{children}</p>{action}</section>;
}
