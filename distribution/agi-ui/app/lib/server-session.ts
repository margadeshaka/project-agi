// SPDX-License-Identifier: Apache-2.0
/**
 * Server-side session helpers.
 *
 * v5-idiomatic: ask `auth()` from /auth.ts; never parse cookies ourselves.
 * The session shape is the AuthSession contract (./auth-types.ts), but for
 * back-compat with existing consumers we also surface the legacy
 * `SessionUser` shape used across the UI components.
 *
 * `loadVisiblePacks()` contract is preserved verbatim — Agent 4a-D depends
 * on the existing `{ slug, display_name }[]` return shape.
 */

import { auth } from '@/auth';
import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { AuthSession } from './auth-types';
import type { Pack, SessionUser } from '@/lib/api/types';

/**
 * Return the projected AuthSession or null if signed out.
 *
 * The cast through `unknown` is needed because module-augmented `Session`
 * doesn't structurally narrow to AuthSession; auth.ts guarantees the
 * runtime shape via its session callback.
 */
export async function getServerSession(): Promise<AuthSession | null> {
  const session = (await auth()) as unknown as AuthSession | null;
  return session ?? null;
}

/** Convenience: just the scope list, empty when unauthenticated. */
export async function getServerScopes(): Promise<string[]> {
  const session = await getServerSession();
  return session?.user.scopes ?? [];
}

/**
 * Active tenant id from the session. Used by the BFF for the X-Pack
 * consistency check against the user's claims.
 */
export async function getServerActiveTenant(): Promise<string | null> {
  const session = await getServerSession();
  return session?.user.tenantId ?? null;
}

/**
 * Legacy helper kept for the root layout: project AuthSession down to the
 * SessionUser shape consumed by AuthProvider's `initialUser` prop.
 */
export async function loadInitialSession(): Promise<SessionUser | null> {
  const session = await getServerSession();
  if (!session) return null;
  return {
    subject: session.user.id,
    email: session.user.email,
    name: session.user.name,
    scopes: session.user.scopes,
  };
}

/**
 * Visible packs for the topbar pack-switcher. Contract is locked: returns
 * `{ slug, display_name }[]` so Agent 4a-D's existing topbar code keeps
 * working unchanged.
 */
export async function loadVisiblePacks(): Promise<{ slug: string; display_name: string }[]> {
  const session = await getServerSession();
  if (!session?.accessToken) return [];
  try {
    const packs = await runtimeFetch<Pack[]>('/admin/packs', { bearer: session.accessToken });
    return packs.map((p) => ({ slug: p.slug, display_name: p.display_name }));
  } catch (err) {
    if (err instanceof RuntimeError) return [];
    return [];
  }
}
