import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { request } from './api.js';
import { useSession } from './session.js';

export function Brand() { return <Link className="brand" to="/login" aria-label="Billetera, inicio"><span className="brand-mark">b</span><span>Billetera<span className="brand-dot">.</span></span></Link>; }

export function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return <main className="auth-page"><section className="auth-side"><Brand /><div className="auth-message"><span className="eyebrow">TU DINERO, MÁS CERCA</span><h1>Todo lo que necesitas para sentirte en control.</h1><p>Una forma simple de consultar tus cuentas y administrar tu dinero.</p><div className="decorative-orbit" aria-hidden="true"><div className="orbit-card"><span className="tiny-label">TU CUENTA</span><strong>MXN</strong><span className="orbit-line" /></div></div></div><span className="side-foot">Simple, claro y a tu ritmo.</span></section><section className="auth-main"><div className="auth-card"><div className="mobile-brand"><Brand /></div><span className="eyebrow">BIENVENIDO A BILLETERA</span><h2>{title}</h2><p className="auth-subtitle">{subtitle}</p>{children}</div><p className="auth-legal">Al continuar, aceptas nuestros términos y aviso de privacidad.</p></section></main>;
}

export function Field({ id, label, type = 'text', autoComplete, error, ...props }: { id: string; label: string; type?: string; autoComplete?: string; error?: string; [key: string]: unknown }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} name={id} type={type} autoComplete={autoComplete} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />{error && <span className="field-error" id={`${id}-error`}>{error}</span>}</div>;
}

export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) { return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>; }

export function AppShell({ children, active = 'accounts' }: { children: ReactNode; active?: string }) {
  const { session, end } = useSession();
  const navigate = useNavigate();
  async function logout() {
    try { await request<void>('/auth/logout', { method: 'POST' }); } catch { /* Local session is cleared even when the network is unavailable. */ } finally { end(); navigate('/login'); }
  }
  return <div className="app-shell"><header className="topbar"><Brand /><nav aria-label="Navegación principal"><Link className={active === 'accounts' ? 'nav-active' : ''} to="/accounts">Mis cuentas</Link></nav><div className="profile"><span className="avatar" aria-hidden="true">{session?.user.fullName.slice(0, 1).toUpperCase()}</span><span className="profile-name">{session?.user.fullName}</span><button className="text-button" onClick={() => void logout()}>Salir</button></div></header><main className="page-content">{children}</main><footer className="app-footer">Billetera <span>·</span> Tus cuentas, en un solo lugar</footer></div>;
}

export function StatePanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="state-panel"><div className="state-icon" aria-hidden="true">!</div><h2>{title}</h2><p>{children}</p>{action}</section>;
}
