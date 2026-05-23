// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * AuthProvider — thin compatibility wrapper over next-auth/react v5.
 *
 * Why a wrapper instead of just re-exporting `SessionProvider`:
 *  - Existing consumers (sidebar.tsx, app-shell.tsx, pack-switcher.tsx,
 *    pack-switcher.test.tsx) destructure { user, status, signOut, refresh }
 *    from `useSession()`. next-auth/react's `useSession()` returns
 *    { data, status, update }. We adapt the shape here so we don't have to
 *    touch every consumer or test.
 *  - The pack-switcher unit test feeds in `initialUser` (a SessionUser with
 *    scopes) directly, with no IdP wired up. We synthesise a Session shape
 *    from it for the SessionProvider's `session` prop.
 *
 * Exports kept stable for downstream agents (4a-C BFF, 4a-D screens):
 *   AuthProvider, SessionProvider, useSession, useScopes, signIn, signOut.
 */

import {
  SessionProvider as NextAuthSessionProvider,
  signOut as nextAuthSignOut,
  signIn as nextAuthSignIn,
  useSession as useNextAuthSession,
} from 'next-auth/react';
import { useCallback, useMemo, type ReactNode } from 'react';
import type { Session } from 'next-auth';
import type { SessionUser } from '@/lib/api/types';
import type { AuthScope } from '@/app/lib/auth-types';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface LegacySessionShape {
  user: SessionUser | null;
  status: Status;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Project the legacy SessionUser test fixture (subject/email/scopes) into a
 * next-auth Session so that <SessionProvider session={…}> stays happy.
 */
function legacyUserToSession(user: SessionUser | null | undefined): Session | null {
  if (!user) return null;
  return {
    user: {
      id: user.subject,
      name: user.name ?? null,
      email: user.email ?? null,
      image: null,
      scopes: user.scopes as AuthScope[],
      tenantId: 'default',
    },
    accessToken: '',
    // 24h synthetic expiry — irrelevant for tests; SessionProvider's
    // refetch interval is disabled below.
    expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  };
}

interface AuthProviderProps {
  children: ReactNode;
  /** Server-rendered initial session, prefetched in the root layout. */
  session?: Session | null;
  /** Legacy: SessionUser-shaped initial state (kept for unit tests). */
  initialUser?: SessionUser | null;
}

/**
 * Drop-in for the old AuthProvider. Either pass `session` (the v5-idiomatic
 * way) OR `initialUser` (the v0 shim's prop name, kept for the unit test).
 */
export function AuthProvider({ children, session, initialUser }: AuthProviderProps) {
  const resolved = session ?? legacyUserToSession(initialUser ?? null);
  return (
    <NextAuthSessionProvider session={resolved} refetchInterval={0} refetchOnWindowFocus={false}>
      {children}
    </NextAuthSessionProvider>
  );
}

/** Direct re-export so callers who already speak v5 can use it verbatim. */
export const SessionProvider = NextAuthSessionProvider;

/**
 * useSession — legacy-shape adapter over next-auth/react's `useSession`.
 *
 * Returns { user, status, refresh, signOut } so the existing call sites in
 * sidebar.tsx / app-shell.tsx / pack-switcher.tsx don't have to change.
 */
export function useSession(): LegacySessionShape {
  const { data, status, update } = useNextAuthSession();

  const user: SessionUser | null = useMemo(() => {
    if (!data?.user) return null;
    return {
      subject: data.user.id,
      email: data.user.email ?? undefined,
      name: data.user.name ?? undefined,
      scopes: data.user.scopes ?? [],
    };
  }, [data]);

  const refresh = useCallback(async () => {
    await update();
  }, [update]);

  const doSignOut = useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: '/sign-in' });
  }, []);

  return {
    user,
    status: status as Status,
    refresh,
    signOut: doSignOut,
  };
}

/**
 * useScopes — returns the active session's scopes (or [] when signed out).
 * Drives sidebar role filtering (FR-IA-01).
 */
export function useScopes(): string[] {
  const { data } = useNextAuthSession();
  return data?.user?.scopes ?? [];
}

/** Re-export for screens that want to fire sign-in/out without indirection. */
export { nextAuthSignIn as signIn, nextAuthSignOut as signOut };
