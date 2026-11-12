import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, setUnauthorizedHandler } from './api.ts';
import type { Organization, Role, User } from '../../shared/types.ts';

export interface Session {
  authenticated: boolean;
  user: User | null;
  org: Organization | null;
  unread: number;
  cartCount: number;
  serverTime: string;
  ledgerBalanced: boolean;
}

interface SessionValue {
  session: Session | null;
  /** Other accounts the signed-in user may act as. Admins only; empty otherwise. */
  users: User[];
  loading: boolean;
  error: string | null;
  authError: string | null;
  signingIn: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  lang: 'en' | 'am';
  toggleLang: () => void;
}

const SessionCtx = createContext<SessionValue | null>(null);

export const ROLE_HOME: Record<Role, string> = {
  buyer: '/',
  business_buyer: '/b2b',
  seller: '/seller',
  agent: '/agent',
  admin: '/admin',
};

/**
 * Dictionary keys for role names. These are English strings so `t()` can find
 * them; the dictionary owns the Amharic.
 */
export const ROLE_LABEL_KEY: Record<Role, string> = {
  buyer: 'Buyer',
  business_buyer: 'Business buyer',
  seller: 'Seller',
  agent: 'Delivery agent',
  admin: 'Platform admin',
};

function storedTheme(): 'light' | 'dark' {
  const v = localStorage.getItem('hm.theme');
  if (v === 'light' || v === 'dark') return v;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedLang(): 'en' | 'am' {
  return localStorage.getItem('hm.lang') === 'am' ? 'am' : 'en';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(storedTheme);
  const [lang, setLang] = useState<'en' | 'am'>(storedLang);

  // The 401 handler must not depend on `session` or it would be re-registered on
  // every render and could fire from inside another state update.
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  // `documentElement.lang` is set by <I18nBridge> so it stays in lockstep with
  // the module-level active locale that `t()` and `format.ts` read.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('hm.theme', theme);
    localStorage.setItem('hm.lang', lang);
  }, [theme, lang]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (sessionRef.current?.authenticated) {
        sessionRef.current = null;
        setSession(null);
        setUsers([]);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      // A signed-out session is a 200, not an error — this is the cold-start path.
      const s = await api.get<Session>('/session');
      sessionRef.current = s;
      setSession(s);

      if (!s.authenticated || !s.user) {
        setUsers([]);
        return;
      }
      // The user directory is PII, so only an admin can load it.
      if (s.user.role === 'admin') {
        const u = await api.get<{ items: User[] }>('/users');
        setUsers(u.items ?? []);
      } else {
        setUsers([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your session.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const s = await api.post<Session>('/session/login', { email, password });
      sessionRef.current = s;
      setSession(s);
      if (s.user?.role === 'admin') {
        const u = await api.get<{ items: User[] }>('/users');
        setUsers(u.items ?? []);
      }
    } catch (e) {
      // A 401 here is a rejected password, not an expired session — the api
      // layer's global handler would otherwise wipe a session we never had.
      setAuthError(e instanceof ApiError ? e.message : 'Could not reach HaniMarket. Try again.');
      throw e;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/session/logout');
    } finally {
      // Clear locally even if the request failed — the user asked to be gone.
      sessionRef.current = null;
      setSession(null);
      setUsers([]);
      setAuthError(null);
    }
  }, []);

  const switchUser = useCallback(async (userId: string) => {
    setAuthError(null);
    try {
      const s = await api.post<Session>('/session/switch', { userId });
      sessionRef.current = s;
      setSession(s);
      setUsers(s.user?.role === 'admin' ? users : []);
    } catch (e) {
      setAuthError(e instanceof ApiError ? e.message : 'Could not switch account.');
      throw e;
    }
  }, [users]);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      users,
      loading,
      error,
      authError,
      signingIn,
      refresh,
      login,
      logout,
      switchUser,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      lang,
      toggleLang: () => setLang((l) => (l === 'am' ? 'en' : 'am')),
    }),
    [session, users, loading, error, authError, signingIn, refresh, login, logout, switchUser, theme, lang],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/**
 * The signed-in user. `App` renders the shell and the pages only once there is
 * one, so inside a page this is never null — which is what lets a page ask
 * "is this an admin?" without a null check at every use.
 */
export function useUser(): User {
  const user = useSession().session?.user;
  if (!user) throw new Error('useUser called outside an authenticated session');
  return user;
}

/** The signed-in user's org, with a type-safe failure the pages can render. */
export function useOrg(): Organization | null {
  return useSession().session?.org ?? null;
}
