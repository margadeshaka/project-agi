// SPDX-License-Identifier: Apache-2.0
/**
 * BFF proxy contract tests (Agent 4a-C scope).
 *
 * Covers:
 *  - bearer is forwarded from session.accessToken
 *  - logged-out requests are rejected before proxying
 *  - pack-scope mismatch is rejected before proxying
 *  - X-Correlation-Id is stamped when missing, preserved when present
 *  - upstream 5xx becomes a 502 with an RFC 7807 problem-detail body
 *
 * `getServerSession` and `next/headers` are mocked so the route handler can
 * be exercised under jsdom without Next's full server runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@/app/lib/auth-types';
import {
  makeAdminSession,
  makeOperatorSession,
  makeSession,
} from '@/app/__tests__/__fixtures__/session';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the route module is imported.
// ---------------------------------------------------------------------------

const mockSession = vi.hoisted(() => ({ value: null as AuthSession | null }));
const mockCookieStore = vi.hoisted(() => ({
  value: new Map<string, string>(),
}));

vi.mock('@/app/lib/server-session', () => ({
  getServerSession: vi.fn(async () => mockSession.value),
  // 4a-B also exports loadVisiblePacks; not used by the BFF but keep the
  // module shape valid so other consumers don't trip during test collection.
  loadVisiblePacks: vi.fn(async () => []),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = mockCookieStore.value.get(name);
      return v ? { name, value: v } : undefined;
    },
  }),
}));

// next/server: provide the minimum NextRequest/NextResponse surface the
// route uses. NextRequest just wraps Request; we synthesise one from a URL.
vi.mock('next/server', async () => {
  class NextRequest extends Request {
    nextUrl: URL;
    cookies: { has: (name: string) => boolean; get: (name: string) => { value: string } | undefined };
    constructor(input: string | URL, init?: RequestInit & { cookies?: Map<string, string> }) {
      super(input as string, init);
      this.nextUrl = new URL(input.toString());
      const jar = init?.cookies ?? new Map<string, string>();
      this.cookies = {
        has: (name: string) => jar.has(name),
        get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
      };
    }
  }
  const NextResponse = {
    next: () => new Response(null, { status: 200 }),
    redirect: (url: URL) => new Response(null, { status: 307, headers: { Location: url.toString() } }),
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      }),
  };
  return { NextRequest, NextResponse };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteModule = typeof import('../route');

async function loadRoute(): Promise<RouteModule> {
  return (await import('../route')) as RouteModule;
}

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  method: string;
}

function captureFetch(handler: (req: Request) => Response | Promise<Response>): {
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    captured.push({ url: req.url, headers, method: req.method });
    return handler(req);
  }) as typeof fetch;
  return { captured };
}

function makeRequest(
  path: string[],
  init: {
    method?: string;
    headers?: Record<string, string>;
    search?: string;
  } = {},
): { req: any; segments: string[] } {
  const search = init.search ?? '';
  const url = `http://localhost:8080/api/runtime/${path.join('/')}${search}`;
  // Resolve the mocked NextRequest from next/server. Synchronous require is
  // intentional — vi.mock hoists above this and the route module also
  // synchronously imports next/server.
  // eslint-disable-next-line @next/next/no-assign-module-variable, no-undef
  const { NextRequest } = require('next/server') as { NextRequest: any };
  const req = new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
  });
  return { req, segments: path };
}

const origFetch = globalThis.fetch;

beforeEach(() => {
  mockSession.value = null;
  mockCookieStore.value = new Map();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BFF /api/runtime/* — bearer forwarding', () => {
  it('proxies with Bearer from session.accessToken', async () => {
    mockSession.value = makeAdminSession({ accessToken: 'tok-abc' });
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'whoami']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].headers['authorization']).toBe('Bearer tok-abc');
  });
});

describe('BFF /api/runtime/* — unauthenticated rejection', () => {
  it('returns 401 RFC 7807 when getServerSession() returns null', async () => {
    mockSession.value = null;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'whoami']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toMatchObject({
      type: expect.stringContaining('unauthenticated'),
      title: 'Not authenticated',
      status: 401,
    });
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
  });
});

describe('BFF /api/runtime/* — pack scope enforcement', () => {
  it('admin can use any pack via the agi.pack cookie', async () => {
    mockSession.value = makeAdminSession({ accessToken: 'admin-tok' });
    mockCookieStore.value.set('agi.pack', 'care-demo');
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['tools']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    expect(captured[0].headers['x-pack']).toBe('care-demo');
  });

  it('rejects pack cookie that does not match the operator scope', async () => {
    mockSession.value = makeOperatorSession('acme', { accessToken: 'op-tok' });
    mockCookieStore.value.set('agi.pack', 'care-demo');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['tools']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.title).toBe('Pack not in scope');
    expect(body.status).toBe(403);
    expect(body.detail).toContain('care-demo');
  });

  it('viewer can read any pack', async () => {
    mockSession.value = makeSession({
      scopes: ['agi:viewer'],
      accessToken: 'viewer-tok',
    });
    mockCookieStore.value.set('agi.pack', 'fleet-demo');
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['audit']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    expect(captured[0].headers['x-pack']).toBe('fleet-demo');
  });

  it('operator with matching slug is allowed', async () => {
    mockSession.value = makeOperatorSession('care-demo', { accessToken: 'op-tok' });
    mockCookieStore.value.set('agi.pack', 'care-demo');
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['kb']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    expect(captured[0].headers['x-pack']).toBe('care-demo');
  });
});

describe('BFF /api/runtime/* — correlation id', () => {
  it('stamps an X-Correlation-Id when missing', async () => {
    mockSession.value = makeAdminSession();
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'status']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    const stamped = captured[0].headers['x-correlation-id'];
    expect(stamped).toBeDefined();
    expect(stamped.length).toBeGreaterThan(0);
    expect(res.headers.get('X-Correlation-Id')).toBe(stamped);
  });

  it('passes through an existing X-Correlation-Id header', async () => {
    mockSession.value = makeAdminSession();
    const { captured } = captureFetch(() => new Response('{}', { status: 200 }));
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'status'], {
      headers: { 'X-Correlation-Id': 'caller-supplied-cid-01HV' },
    });
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(200);
    expect(captured[0].headers['x-correlation-id']).toBe('caller-supplied-cid-01HV');
    expect(res.headers.get('X-Correlation-Id')).toBe('caller-supplied-cid-01HV');
  });
});

describe('BFF /api/runtime/* — upstream error mapping', () => {
  it('maps a 503 to a 502 RFC 7807 problem body', async () => {
    mockSession.value = makeAdminSession();
    captureFetch(() =>
      new Response('{"title":"backend down"}', {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'status']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(502);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      type: expect.stringContaining('upstream-5xx'),
      title: 'Upstream runtime error',
      status: 502,
    });
    expect(body.detail).toBeDefined();
    expect(typeof body.correlation_id).toBe('string');
  });

  it('forwards a 4xx body unchanged (e.g. runtime-emitted 404)', async () => {
    mockSession.value = makeAdminSession();
    captureFetch(
      () =>
        new Response('{"title":"Pack not found","status":404,"detail":"unknown slug"}', {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    );
    const { GET } = await loadRoute();

    const { req, segments } = makeRequest(['admin', 'packs', 'nope']);
    const res = await GET(req, { params: { path: segments } });

    expect(res.status).toBe(404);
    const body = await res.json();
    // Body is forwarded verbatim — not wrapped in our 502 envelope.
    expect(body.title).toBe('Pack not found');
    expect(body.detail).toBe('unknown slug');
  });
});
