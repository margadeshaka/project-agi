// SPDX-License-Identifier: Apache-2.0
/**
 * /api/runtime/* — same-origin reverse proxy to agi-runtime.
 *
 * Why this exists:
 *  - The OIDC access token lives in the NextAuth httpOnly session — the
 *    browser cannot attach `Authorization` on its own. This proxy resolves
 *    the session, attaches the bearer, and forwards the request.
 *  - Keeps connect-src in the CSP header (NFR-SEC-03) limited to 'self'.
 *  - Lets the browser-side runtimeFetch() default to a relative URL.
 *  - Enforces defence-in-depth on the X-Pack header (RESOLVED_STACK
 *    Decision 1): the BFF refuses to forward a pack that the session's
 *    scopes do not authorise. The runtime re-checks claim-vs-header on
 *    receipt, but failing fast at the edge keeps multi-tenant leaks from
 *    even touching the wire.
 *
 * Streaming responses (SSE for /chat/stream, /v1/invoke/stream, KB reindex
 * progress) are pass-through — we never buffer the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIES } from '../../../components/runtime-fetch';
import { getServerSession } from '@/app/lib/server-session';
import type { AuthSession, AuthScope } from '@/app/lib/auth-types';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// RFC 7807 problem-detail helpers
// ---------------------------------------------------------------------------

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  correlation_id: string;
}

/** Base type URI for BFF-originated problems. The runtime emits its own URIs. */
const PROBLEM_BASE = 'https://project-agi.dev/problems';

function problemResponse(
  status: number,
  title: string,
  detail: string,
  correlationId: string,
  typeSlug: string,
): Response {
  const body: ProblemBody = {
    type: `${PROBLEM_BASE}/${typeSlug}`,
    title,
    status,
    detail,
    correlation_id: correlationId,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Correlation-Id': correlationId,
    },
  });
}

// ---------------------------------------------------------------------------
// Correlation id — ULID-shaped (Crockford base32, 26 chars). We don't ship
// the `ulid` npm dep just for this; crypto.randomUUID() reformatted is good
// enough for trace stitching and the runtime accepts any opaque string.
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulidish(): string {
  // 10 chars of base32 time + 16 chars of base32 randomness = 26 chars.
  const now = Date.now();
  let time = '';
  let n = now;
  for (let i = 9; i >= 0; i--) {
    time = CROCKFORD[n % 32] + time;
    n = Math.floor(n / 32);
  }
  // 16 random base32 chars from getRandomValues — same entropy band as ulid.
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD[rand[i] & 0x1f];
  }
  return time + randStr;
}

// ---------------------------------------------------------------------------
// Scope / pack authorisation
// ---------------------------------------------------------------------------

function hasGlobalRead(scopes: readonly AuthScope[]): boolean {
  return scopes.includes('agi:admin') || scopes.includes('agi:viewer');
}

function operatorOwnsPack(scopes: readonly AuthScope[], slug: string): boolean {
  return scopes.includes(`agi:operator:${slug}` as AuthScope);
}

/**
 * Resolve the effective X-Pack for this request:
 *   1. If the inbound request already has an X-Pack header, trust it (the
 *      caller is responsible — same flow agi-runtime uses).
 *   2. Else read the agi.pack cookie set by <PackSwitcher>.
 *   3. Else use the first path segment if it looks pack-shaped (e.g. the
 *      legacy `/api/runtime/<slug>/...` flow some screens still use).
 *
 * Returns null if no pack is implied — many endpoints (`/admin/whoami`,
 * `/admin/status`, `/healthz`) are pack-less, so a missing X-Pack is not
 * inherently an error here. The runtime will reject if it needs one.
 */
function resolveTargetPack(req: NextRequest, segments: string[]): string | null {
  const explicit = req.headers.get('X-Pack');
  if (explicit) return explicit;
  const fromCookie = cookies().get(COOKIES.pack)?.value;
  if (fromCookie) return fromCookie;
  // Last-ditch: legacy first-segment fallback. Only treat as a pack if it
  // looks like one of the well-known pack-prefixed routes — otherwise we'd
  // mis-route `/api/runtime/admin/whoami` to X-Pack=admin.
  const head = segments[0];
  if (head && head !== 'admin' && head !== 'healthz' && head !== 'readyz') {
    // We intentionally do NOT treat this as confirmed; the runtime can
    // disambiguate. Returning the raw segment makes the legacy flow keep
    // working without a behaviour change.
    return null;
  }
  return null;
}

/**
 * Decide whether the session is allowed to act on `pack`. Admins and viewers
 * pass on every pack (viewers are read-only — write-rejection is the
 * runtime's job, not the BFF's). Operators only pass on the slug embedded in
 * their scope. Returns false → BFF answers 403 before forwarding.
 */
function isPackAuthorised(session: AuthSession, pack: string | null): boolean {
  if (!pack) return true; // pack-less endpoints
  const scopes = session.user.scopes;
  if (hasGlobalRead(scopes)) return true;
  return operatorOwnsPack(scopes, pack);
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

async function proxy(req: NextRequest, segments: string[]): Promise<Response> {
  // ---- correlation id ----------------------------------------------------
  const inboundCorrelationId = req.headers.get('X-Correlation-Id');
  const correlationId = inboundCorrelationId && inboundCorrelationId.length > 0
    ? inboundCorrelationId
    : ulidish();

  // ---- auth --------------------------------------------------------------
  let session: AuthSession | null = null;
  try {
    session = (await getServerSession()) as AuthSession | null;
  } catch (err) {
    // A thrown session helper is a server bug — never silently allow.
    return problemResponse(
      500,
      'Session resolution failed',
      err instanceof Error ? err.message : String(err),
      correlationId,
      'session-error',
    );
  }
  if (!session || !session.accessToken) {
    return problemResponse(
      401,
      'Not authenticated',
      'No active session; sign in before calling agi-runtime.',
      correlationId,
      'unauthenticated',
    );
  }

  // ---- pack scope check (defence in depth vs RESOLVED_STACK D1) ----------
  const targetPack = resolveTargetPack(req, segments);
  if (!isPackAuthorised(session, targetPack)) {
    return problemResponse(
      403,
      'Pack not in scope',
      `Session scopes do not authorise pack '${targetPack}'.`,
      correlationId,
      'pack-forbidden',
    );
  }

  // ---- build upstream request -------------------------------------------
  const base = process.env.AGI_RUNTIME_URL ?? 'http://localhost:9000';
  const url = new URL(`${base}/${segments.join('/')}${req.nextUrl.search}`);

  const headers = new Headers(req.headers);
  // Strip Next-internal / hop-by-hop headers.
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length'); // recomputed by fetch from body

  // Attach Bearer from the session (never read it from a JS-visible place).
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  // Pack header — if we resolved one and the inbound request didn't already
  // carry an explicit X-Pack, set it. We've already authorised this slug.
  if (targetPack && !headers.has('X-Pack')) {
    headers.set('X-Pack', targetPack);
  }

  // Correlation id — propagate or stamp.
  headers.set('X-Correlation-Id', correlationId);

  const init: RequestInit = {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
    // Disable Next's fetch cache for the proxy — every call is dynamic.
    cache: 'no-store',
  };

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (err) {
    return problemResponse(
      502,
      'Runtime unreachable',
      err instanceof Error ? err.message : String(err),
      correlationId,
      'upstream-unreachable',
    );
  }

  // ---- 5xx → opaque 502 with RFC 7807 body ------------------------------
  if (upstream.status >= 500) {
    // Drain the upstream body for logging context but don't leak it to the
    // client — the runtime's internal error detail is not the BFF caller's
    // business. We surface a generic detail keyed to the correlation id so
    // operators can join the trail.
    let upstreamDetail = '';
    try {
      upstreamDetail = (await upstream.text()).slice(0, 512);
    } catch {
      // ignore — best effort
    }
    return problemResponse(
      502,
      'Upstream runtime error',
      upstreamDetail || `agi-runtime returned ${upstream.status}`,
      correlationId,
      'upstream-5xx',
    );
  }

  // ---- 4xx → forward status + body unchanged ----------------------------
  // ---- 2xx / 3xx (incl. SSE streams) → pass-through ---------------------
  const respHeaders = new Headers(upstream.headers);
  // Strip hop-by-hop headers Next might re-add downstream.
  respHeaders.delete('transfer-encoding');
  respHeaders.delete('connection');
  // Always echo correlation id so the browser can pin it to the request.
  respHeaders.set('X-Correlation-Id', correlationId);

  // Detect SSE — keep streaming semantics on the response too.
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream')) {
    respHeaders.set('Content-Type', 'text/event-stream');
    respHeaders.set('Cache-Control', 'no-cache, no-transform');
    respHeaders.set('X-Accel-Buffering', 'no');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

// ---------------------------------------------------------------------------
// Route handlers — one per HTTP method we forward
// ---------------------------------------------------------------------------

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
