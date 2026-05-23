// SPDX-License-Identifier: Apache-2.0
/**
 * Next.js middleware — gate the protected admin-console routes behind a
 * valid NextAuth session.
 *
 * Why a custom matcher (and not `export { auth as middleware } from "@/auth"`):
 *  - Edge-runtime middleware cannot reach into the full Auth.js callbacks
 *    chain without an edge-compatible adapter. The `auth()` helper still
 *    requires next-auth's bundled middleware to be configured with
 *    edge-safe providers. Until Agent 4a-B's wiring is final, we keep this
 *    layer self-contained: presence of the NextAuth session cookie is the
 *    gate; the BFF (app/api/runtime/[...path]/route.ts) is the
 *    *authoritative* check — it calls getServerSession() server-side and
 *    rejects on missing token. The middleware's job is to skip the
 *    server-render cost on unauthenticated browsers.
 *
 * Route policy (per ADMIN_CONSOLE §1 personas + §2 IA):
 *   PUBLIC          /sign-in, /api/auth/*, /_next/*, /favicon.ico
 *   PROTECTED       /, /packs/*, /tools/*, /use-cases*, /audit/*, /llm/*,
 *                   /admin/*
 *
 * The landing `/` page renders the deployment-health dashboard (§3.1)
 * which pulls /admin/status — that endpoint requires auth, so the page
 * itself must be auth-gated. ADMIN_CONSOLE does not name `/` as a public
 * marketing surface; it's a signed-in operator dashboard.
 */

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cookie names NextAuth v5 sets for the session JWT. We check both because
 * the prefix changes based on the `useSecureCookies` flag (true in production
 * over HTTPS, false in local HTTP dev).
 *
 * Source: https://authjs.dev/reference/nextjs#cookies — kept in sync with
 * Agent 4a-B's auth.ts when that lands.
 */
const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // Legacy next-auth v4 names — harmless to also accept during migration.
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.has(name)) return true;
  }
  return false;
}

export function middleware(req: NextRequest): NextResponse {
  // The matcher below already excludes static assets and auth routes, so
  // anything that reaches here is a route we want to protect.
  if (hasSessionCookie(req)) {
    return NextResponse.next();
  }

  const from = req.nextUrl.pathname + req.nextUrl.search;
  const signInUrl = new URL('/sign-in', req.nextUrl);
  signInUrl.searchParams.set('from', from);
  return NextResponse.redirect(signInUrl);
}

/**
 * Matcher: protect everything *except* the public surfaces. We use a
 * negative-lookahead style regex so we don't have to enumerate every
 * protected subtree.
 *
 *  - /sign-in            : the login page itself must be public
 *  - /api/auth/*         : NextAuth handlers (callbacks, providers, csrf)
 *  - /_next/*            : Next.js internals (HMR, image-opt, static chunks)
 *  - /favicon.ico, /robots.txt, /sitemap.xml : conventional public assets
 *  - files with an extension (.svg, .png, .css, .js, ...) : public assets
 *
 * Everything else (/, /packs/*, /tools/*, /use-cases, /audit/*, /llm/*,
 * /admin/*) flows through the middleware function above.
 */
export const config = {
  matcher: [
    '/((?!sign-in|api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)',
  ],
};
