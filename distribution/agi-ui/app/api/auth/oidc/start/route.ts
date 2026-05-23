// SPDX-License-Identifier: Apache-2.0
/**
 * /api/auth/oidc/start — kick off the OIDC code flow.
 *
 * Real PKCE + state + code exchange is implemented by Auth.js (NextAuth) in
 * P5. For v1 this is a redirect to the runtime's auth endpoint, which the
 * runtime handles or proxies onward to the configured issuer.
 *
 * Static-token + dev-noop modes: the runtime sets a session cookie at its
 * /auth/dev-login endpoint; the browser is then bounced back here.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const issuer = req.nextUrl.searchParams.get('issuer');
  const runtime = process.env.AGI_RUNTIME_URL ?? 'http://localhost:9000';
  const back = req.nextUrl.origin + '/';
  const target = new URL('/auth/start', runtime);
  if (issuer) target.searchParams.set('issuer', issuer);
  target.searchParams.set('redirect_uri', back);
  return NextResponse.redirect(target.toString());
}
