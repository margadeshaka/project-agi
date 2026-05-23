// SPDX-License-Identifier: Apache-2.0
/**
 * Auth.js v5 + Keycloak — the canonical session entry point for agi-ui.
 *
 * ============================================================================
 *  Scope-claim source-of-truth
 * ============================================================================
 *  We read scopes from `realm_access.roles` on the Keycloak access token,
 *  filtered to roles whose names start with `agi:`. This is the simplest path
 *  for the reference Keycloak realm:
 *
 *    Keycloak Realm role           → AuthScope
 *    -----------------------------   -----------------
 *    agi:admin                     → 'agi:admin'
 *    agi:viewer                    → 'agi:viewer'
 *    agi:dev                       → 'agi:dev'
 *    agi:operator:care-demo       → 'agi:operator:care-demo'
 *
 *  Why realm_access.roles and not a custom claim:
 *   - Stock Keycloak realm export works out-of-the-box; no protocol-mapper
 *     to author or migrate when bumping realm config.
 *   - Operators add a per-pack realm role and assign it to a user group; no
 *     code change in the UI or runtime to onboard a new pack.
 *   - The `agi:` prefix keeps the claim space disjoint from Keycloak's own
 *     built-in roles (offline_access, uma_authorization, …).
 *
 *  Roles that don't start with `agi:` are silently dropped — see the
 *  `parseScopes` helper below.
 *
 * ============================================================================
 *  Token refresh
 * ============================================================================
 *  On every JWT callback we look at `expires_at`. If it is within 60s of
 *  expiry, we call Keycloak's `/protocol/openid-connect/token` with the
 *  refresh grant and overwrite `access_token`, `refresh_token`, and
 *  `expires_at`. The refresh is best-effort: a refused refresh marks the
 *  token with `error: 'RefreshAccessTokenError'` and the next request the
 *  middleware sees triggers a fresh sign-in.
 *
 * ============================================================================
 *  No DB; JWT strategy only
 * ============================================================================
 *  Session strategy: jwt — the BFF (/api/runtime/*) pulls `accessToken`
 *  from `auth()` without a DB roundtrip. No adapter, no users table.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import type { AuthScope, AuthSession } from '@/app/lib/auth-types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REFRESH_LEEWAY_SECONDS = 60;

interface KeycloakAccessTokenClaims {
  sub?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  azp?: string;
  // Keycloak doesn't ship a per-tenant claim by default. We use `azp`
  // (authorized party = client id) as a stand-in until multi-tenant lands.
  // See ADMIN_CONSOLE §5.
}

/**
 * Decode a JWT's payload without verifying the signature. Auth.js verifies
 * the ID token via the OIDC discovery JWKS; here we only need the claims to
 * project them into the session. Signature trust is upstream.
 */
function decodeJwtPayload(token: string): KeycloakAccessTokenClaims | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    // base64url → base64 → JSON
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) as KeycloakAccessTokenClaims;
  } catch {
    return null;
  }
}

/** Keep only `agi:`-prefixed roles; cast to AuthScope[]. */
function parseScopes(roles: string[] | undefined): AuthScope[] {
  if (!roles) return [];
  return roles.filter((r) => r.startsWith('agi:')) as AuthScope[];
}

/** Resolve the tenant id from access-token claims. */
function resolveTenantId(claims: KeycloakAccessTokenClaims | null): string {
  // Phase 0–1 is single-tenant per realm; `azp` is the client id and stable
  // enough for the BFF's consistency check. Multi-tenant lands as a custom
  // claim in P5.
  return claims?.azp ?? 'default';
}

/**
 * Refresh the access token via Keycloak's token endpoint. Returns the new
 * (access_token, refresh_token, expires_at) tuple or throws so the caller
 * can mark the JWT with an error and force a fresh sign-in.
 */
async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const issuer = process.env.AGI_OIDC_ISSUER;
  const clientId = process.env.AGI_OIDC_CLIENT_ID;
  const clientSecret = process.env.AGI_OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('OIDC env not configured');
  }
  const url = `${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`refresh failed: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access_token: payload.access_token,
    // Keycloak rotates the refresh token by default; fall back to the old
    // one if rotation is disabled in the realm.
    refresh_token: payload.refresh_token ?? refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + payload.expires_in,
  };
}

export const authConfig: NextAuthConfig = {
  providers: [
    Keycloak({
      issuer: process.env.AGI_OIDC_ISSUER,
      clientId: process.env.AGI_OIDC_CLIENT_ID,
      clientSecret: process.env.AGI_OIDC_CLIENT_SECRET,
      // PKCE is default in v5 but be explicit so config review is grep-able.
      checks: ['pkce', 'state'],
    }),
  ],
  session: { strategy: 'jwt' },
  // Trust the host header behind the reverse proxy. Set to false in
  // production deployments with explicit AUTH_URL.
  trustHost: true,
  callbacks: {
    /**
     * JWT callback runs on every request that touches the session.
     *  - Initial sign-in: `account` is populated; copy tokens onto the JWT.
     *  - Subsequent calls: `account` is undefined; refresh if expired.
     */
    async jwt({ token, account }) {
      // Initial sign-in.
      if (account?.access_token) {
        const claims = decodeJwtPayload(account.access_token);
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          scopes: parseScopes(claims?.realm_access?.roles),
          tenantId: resolveTenantId(claims),
        };
      }

      // No refresh token? Nothing we can do.
      if (!token.refreshToken) return token;

      const expiresAt = (token.expiresAt as number | undefined) ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt > now + REFRESH_LEEWAY_SECONDS) {
        // Still valid; reuse as-is.
        return token;
      }

      // Try to refresh.
      try {
        const refreshed = await refreshAccessToken(token.refreshToken as string);
        const claims = decodeJwtPayload(refreshed.access_token);
        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: refreshed.expires_at,
          scopes: parseScopes(claims?.realm_access?.roles),
          tenantId: resolveTenantId(claims),
          error: undefined,
        };
      } catch {
        return { ...token, error: 'RefreshAccessTokenError' };
      }
    },

    /**
     * Session callback projects the JWT onto the AuthSession contract
     * (see ./app/lib/auth-types.ts). Field names are load-bearing — the
     * BFF and the FE both grep for them.
     */
    async session({ session, token }) {
      const projected: AuthSession = {
        user: {
          id: (token.sub as string | undefined) ?? session.user?.id ?? '',
          name: session.user?.name ?? undefined,
          email: session.user?.email ?? undefined,
          image: session.user?.image ?? undefined,
          scopes: (token.scopes as AuthScope[] | undefined) ?? [],
          tenantId: (token.tenantId as string | undefined) ?? 'default',
        },
        accessToken: (token.accessToken as string | undefined) ?? '',
        expires: session.expires,
      };
      // Spread onto session so module-augmented `Session` typing holds.
      return { ...session, ...projected } as any;
    },
  },
  pages: {
    signIn: '/sign-in',
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
