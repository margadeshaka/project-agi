// SPDX-License-Identifier: Apache-2.0
/**
 * /api/runtime/* — same-origin reverse proxy to agi-runtime.
 *
 * Why this exists:
 *  - The agi.session cookie is httpOnly; the browser can't attach
 *    Authorization on its own. This proxy reads the cookie, attaches the
 *    Bearer, and forwards the request.
 *  - Keeps connect-src in the CSP header (NFR-SEC-03) limited to 'self'.
 *  - Lets the browser-side runtimeFetch() default to a relative URL.
 *
 * Streaming responses (SSE for KB reindex progress) are pass-through.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIES } from '../../../components/runtime-fetch';

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, segments: string[]): Promise<Response> {
  const base = process.env.AGI_RUNTIME_URL ?? 'http://localhost:9000';
  const url = new URL(`${base}/${segments.join('/')}${req.nextUrl.search}`);

  const headers = new Headers(req.headers);
  // Strip Next-internal headers.
  headers.delete('host');
  headers.delete('connection');
  // Attach Bearer from the httpOnly cookie.
  const token = cookies().get(COOKIES.session)?.value;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // X-Pack from the readable cookie.
  const pack = cookies().get(COOKIES.pack)?.value;
  if (pack && !headers.has('X-Pack')) headers.set('X-Pack', pack);

  const init: RequestInit = {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  };

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (err) {
    return NextResponse.json(
      { title: 'Runtime unreachable', detail: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  // Pass through streaming bodies (SSE) without buffering.
  const respHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

interface Ctx {
  params: { path: string[] };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
