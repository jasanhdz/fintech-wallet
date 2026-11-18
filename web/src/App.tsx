import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './session.js';
import { AccessDeniedPage, AccountsPage, LoginPage, NotFoundPage, RegisterPage, SessionExpiredPage } from './routes.js';
import { BeneficiariesPage, NewBeneficiaryPage } from './beneficiaries.js';
import { NewTransferPage, TransferStatusPage } from './transfers.js';
import { MovementReceiptPage, MovementsPage } from './movements.js';

/** SH-08: document title per route ("<page> · Billetera MXN"). */
export function titleForPath(pathname: string) {
  const page = pathname === '/login' || pathname === '/' ? 'Iniciar sesión'
    : pathname === '/register' ? 'Crear cuenta'
    : pathname === '/accounts' ? 'Inicio'
    : /^\/accounts\/[^/]+\/movements\/?$/.test(pathname) ? 'Movimientos'
    : /^\/transfers\/[^/]+\/(receipt|movement-receipt)\/?$/.test(pathname) ? 'Comprobante'
    : pathname === '/beneficiaries' ? 'Beneficiarios'
    : pathname === '/beneficiaries/new' ? 'Nuevo beneficiario'
    : pathname === '/transfers/new' || /^\/transfers\/[^/]+\/status\/?$/.test(pathname) ? 'Transferir'
    : pathname === '/session-expired' ? 'Sesión vencida'
    : pathname === '/access-denied' ? 'Acceso no disponible'
    : 'Página no encontrada';
  return `${page} · Billetera MXN`;
}

/**
 * SH-11 (docs/web-ux-polish/SPEC.md §5.4): after an in-app route change the view starts at the top and focus moves to
 * its h1 (made programmatically focusable) once it is rendered. The first load keeps the browser's default focus.
 */
export function useRouteFocus(pathname: string) {
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const first = previous.current === null;
    const changed = previous.current !== pathname;
    previous.current = pathname;
    if (first || !changed) return;
    window.scrollTo(0, 0);
    let frame = 0; let tries = 0;
    const attempt = () => {
      const heading = document.querySelector<HTMLElement>('main h1');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
        // A page that already moved focus inside main (e.g. to a field) keeps it.
        const current = document.activeElement;
        if (!current || current === document.body || !document.querySelector('main')?.contains(current)) heading.focus();
        return;
      }
      if (tries++ < 60) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

/** Routes reachable without a session; an expired session never redirects away from them. */
const publicPaths = new Set(['/', '/login', '/register', '/session-expired', '/access-denied']);

export function App() {
  const { pathname } = useLocation();
  const { expired } = useSession();
  // Layout effect: runs before the passive effects of in-place W14 cards, which may override the title.
  useLayoutEffect(() => { document.title = titleForPath(pathname); }, [pathname]);
  useRouteFocus(pathname);
  // W14-F2: a session lost to an unrecoverable 401 shows «Tu sesión venció» (record kept by session.tsx).
  if (expired && !publicPaths.has(pathname)) return <Navigate to="/session-expired" replace />;
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/accounts" element={<AccountsPage />} />
    <Route path="/accounts/:accountId/movements" element={<MovementsPage />} />
    <Route path="/beneficiaries" element={<BeneficiariesPage />} />
    <Route path="/beneficiaries/new" element={<NewBeneficiaryPage />} />
    <Route path="/transfers/new" element={<NewTransferPage />} />
    <Route path="/transfers/:transferId/status" element={<TransferStatusPage />} />
    <Route path="/transfers/:transferId/receipt" element={<TransferStatusPage />} />
    <Route path="/transfers/:transferId/movement-receipt" element={<MovementReceiptPage />} />
    <Route path="/session-expired" element={<SessionExpiredPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
