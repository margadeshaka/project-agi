// SPDX-License-Identifier: Apache-2.0
/**
 * /api/auth/session — return the resolved session for the current cookie.
 *
 * Reads agi.session (httpOnly), passes it to /admin/whoami on the runtime,
 * returns the SessionUser claims (or null). The access token never reaches
 * the browser JS context.
 *
 * NOTE: Production Auth.js wiring lands in P5 (full PKCE + refresh-token
 * rotation). This shim is enough for FR-AUTH-01 contract conformance and
 * lets every screen ship.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { runtimeFetch, RuntimeError, COOKIES } from '../../../components/runtime-fetch';
import type { SessionUser } from '@/lib/api/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = cookies().get(COOKIES.session)?.value;
  if (!token) {
    return NextResponse.json({ user: null });
  }
  try {
    const user = await runtimeFetch<SessionUser>('/admin/whoami', {
      bearer: token,
    });
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof RuntimeError && err.status === 401) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user: null });
  }
}
