import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { refreshSession, setAccessToken, setSessionExpiredHandler, type User } from './api.js';
import { activateTransferUser, clearAllTransferDrafts, forgetTransferUser } from './transfer-attempt.js';

type Session = { accessToken: string; user: User };
type SessionContextValue = { session: Session | null; hydrated: boolean; start: (accessToken: string, user: User) => void; end: () => void };
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    setSessionExpiredHandler(() => { if (active) { setAccessToken(undefined); setSession(null); } });
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
    start: (token: string, user: User) => { activateTransferUser(user.id); setAccessToken(token); setSession({ accessToken: token, user }); },
    end: () => { clearAllTransferDrafts(); forgetTransferUser(); setAccessToken(undefined); setSession(null); },
  }), [session, hydrated]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}
