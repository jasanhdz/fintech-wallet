import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { refreshSession, setAccessToken, setSessionExpiredHandler, type User } from './api.js';
import { activateTransferUser, clearAllTransferDrafts, forgetTransferUser } from './transfer-attempt.js';

type Session = { accessToken: string; user: User };
/**
 * `expired` (W14-F2) is true when an existing in-memory session was lost to a 401 that could not be
 * refreshed (or `end(true)`); the app then shows «Tu sesión venció» instead of the plain login. It is
 * presentation state only: it never reads, writes or clears the same-tab transfer record.
 */
type SessionContextValue = { session: Session | null; hydrated: boolean; expired: boolean; start: (accessToken: string, user: User) => void; end: (preservePendingTransfer?: boolean) => void };
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [expired, setExpired] = useState(false);
  const hadSession = useRef(false);
  useEffect(() => { hadSession.current = session !== null; }, [session]);
  useEffect(() => {
    let active = true;
    setSessionExpiredHandler(() => { if (active) { if (hadSession.current) setExpired(true); setAccessToken(undefined); setSession(null); } });
    refreshSession().then((result) => {
      if (active) {
        if (result) activateTransferUser(result.user.id);
        setAccessToken(result?.accessToken);
        setSession(result ? { accessToken: result.accessToken, user: result.user } : null);
      }
    }).catch((error: unknown) => {
      // A transport failure is recoverable; leave the cookie untouched and let a later visit retry.
      if (active && error instanceof Error && error.message.startsWith('No fue posible conectar')) return;
      // An invalid/revoked refresh is an unauthenticated browser, not a render-time failure.
    }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; setSessionExpiredHandler(undefined); };
  }, []);
  const value = useMemo(() => ({
    session,
    hydrated,
    expired,
    start: (token: string, user: User) => { activateTransferUser(user.id); setAccessToken(token); setExpired(false); setSession({ accessToken: token, user }); },
    end: (preservePendingTransfer = false) => { if (!preservePendingTransfer) { clearAllTransferDrafts(); forgetTransferUser(); } setAccessToken(undefined); setExpired(preservePendingTransfer); setSession(null); },
  }), [session, hydrated, expired]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}
