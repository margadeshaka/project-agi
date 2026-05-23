// SPDX-License-Identifier: Apache-2.0
/**
 * Auth session contract — consumed by:
 *   - distribution/agi-ui/app/api/runtime/[...path]/route.ts (BFF, Agent 4a-C)
 *   - distribution/agi-ui/app/components/auth-provider.tsx (FE provider)
 *   - distribution/agi-ui/app/lib/server-session.ts (RSC helpers)
 *
 * Keep this file pure types: any code import widens the surface area that
 * downstream agents have to mock. Scope wording matches ADMIN_CONSOLE §5
 * (three-role RBAC + per-pack operator scope) and RESOLVED_STACK "Identity".
 *
 * Scope claim source: Keycloak `realm_access.roles`, filtered to roles whose
 * names start with `agi:`. Documented in detail in ./auth.ts.
 */

/**
 * The full set of scope strings we recognise. Anything else Keycloak emits
 * is dropped on the floor at JWT-callback time so the UI cannot accidentally
 * grant a permission the runtime has never heard of.
 */
export type AuthScope =
  | 'agi:admin'
  | 'agi:viewer'
  | 'agi:dev'
  // Per-pack operator scope. Template-literal so TS keeps the structural
  // guarantee that operator scopes are always namespaced.
  | `agi:operator:${string}`;

/**
 * Session shape we project onto next-auth's Session via module declaration
 * (see ./auth-augment.d.ts). The BFF reads `accessToken` to forward as
 * `Authorization: Bearer …` to agi-runtime; the FE reads `user.scopes` to
 * filter navigation; both must agree on the exact field names below.
 */
export interface AuthSession {
  user: {
    /** OIDC `sub` claim. Stable for the lifetime of the IdP user. */
    id: string;
    name?: string;
    email?: string;
    image?: string;
    /** Parsed from `realm_access.roles`. See ./auth.ts. */
    scopes: AuthScope[];
    /** Single-tenant per user for now (multi-tenant lands in P5 follow-up). */
    tenantId: string;
  };
  /**
   * Raw OIDC access token (JWT). Forwarded verbatim to agi-runtime by the
   * /api/runtime/[...path] proxy — never exposed to client JS.
   */
  accessToken: string;
  /** ISO timestamp of session expiry — matches next-auth's default field. */
  expires: string;
}
