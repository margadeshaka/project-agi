// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * AuthProvider — minimal session context (FR-AUTH-01..04).
 *
 * Real implementation will use Auth.js (NextAuth) v5 with the OIDC issuer
 * from NEXT_PUBLIC_AGI_OIDC_ISSUER. For v1 of the console, we expose the
 * same React surface so screens can be built and tested while the OIDC
 * adapter lands:
 *   - <AuthProvider> reads the session from /api/auth/session (httpOnly
 *     cookie path) on mount. In dev-noop mode the runtime returns a static
 *     admin identity; in static-token mode it returns the token's claims.
 *   - useSession() returns { user, status }.
 *   - useScopes() returns the cached scope list (drives sidebar filtering).
 *
 * No access token ever lives in JS — bearer auth is added by a same-origin
 * proxy (/api/runtime/*) reading the httpOnly cookie. See runtime-fetch.ts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUser } from '@/lib/api/types';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: SessionUser | null;
  status: Status;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Server-rendered initial session so first paint is correct. */
  initialUser?: SessionUser | null;
}

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [status, setStatus] = useState<Status>(
    initialUser ? 'authenticated' : 'loading',
  );

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      const body = (await res.json()) as { user: SessionUser | null };
      setUser(body.user);
      setStatus(body.user ? 'authenticated' : 'unauthenticated');
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      if (typeof window !== 'undefined') window.location.href = '/sign-in';
    }
  }, []);

  useEffect(() => {
    if (initialUser) return;
    void refresh();
  }, [initialUser, refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, status, refresh, signOut }),
    [user, status, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fail open in tests / Storybook — return an unauthenticated shape.
    return {
      user: null,
      status: 'unauthenticated',
      refresh: async () => {},
      signOut: async () => {},
    };
  }
  return ctx;
}

export function useScopes(): string[] {
  return useSession().user?.scopes ?? [];
}
