// SPDX-License-Identifier: Apache-2.0
/**
 * /api/auth/signout — clear the session cookie. The OIDC provider's own
 * logout endpoint is a separate redirect; this just drops local state.
 */

import { NextResponse } from 'next/server';
import { COOKIES } from '../../../components/runtime-fetch';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIES.session, '', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
  });
  return res;
}
