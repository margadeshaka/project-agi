// SPDX-License-Identifier: Apache-2.0
/**
 * Shared test fixtures for the NextAuth session contract (see
 * app/lib/auth-types.ts). Used by:
 *  - app/api/runtime/[...path]/__tests__/route.test.ts (Agent 4a-C, BFF)
 *  - upcoming FE tests that mock @/app/lib/server-session (Agent 4a-D)
 *
 * Keep this file purely declarative — no Vitest globals — so it can be
 * imported from any test environment (jsdom, node, edge-shim).
 */

import type { AuthScope, AuthSession } from '@/app/lib/auth-types';

export interface MakeSessionOpts {
  /** Auth scopes. Defaults to a viewer-only set so tests are explicit about admin. */
  scopes?: AuthScope[];
  /** Tenant id — single-tenant-per-user for now. */
  tenantId?: string;
  /** OIDC sub claim. */
  userId?: string;
  email?: string;
  name?: string;
  /** Raw access-token (JWT-shaped string) the BFF forwards to agi-runtime. */
  accessToken?: string;
  /** ISO expiry — distant future by default. */
  expires?: string;
}

/**
 * Build an `AuthSession` that satisfies the NextAuth contract Agent 4a-B
 * ships. Callers pick which scopes to include; everything else has a safe
 * default so test bodies stay tight.
 */
export function makeSession(opts: MakeSessionOpts = {}): AuthSession {
  const {
    scopes = ['agi:viewer'],
    tenantId = 'tenant-test',
    userId = 'user-test-1',
    email = 'tester@example.test',
    name = 'Test User',
    accessToken = 'test-access-token',
    expires = '2099-12-31T23:59:59.000Z',
  } = opts;

  return {
    user: {
      id: userId,
      name,
      email,
      scopes,
      tenantId,
    },
    accessToken,
    expires,
  };
}

/** Convenience: an admin session, used by most BFF tests. */
export function makeAdminSession(overrides: MakeSessionOpts = {}): AuthSession {
  return makeSession({ scopes: ['agi:admin'], ...overrides });
}

/** Convenience: an operator session scoped to one pack. */
export function makeOperatorSession(
  slug: string,
  overrides: MakeSessionOpts = {},
): AuthSession {
  return makeSession({
    scopes: [`agi:operator:${slug}` as AuthScope],
    ...overrides,
  });
}
