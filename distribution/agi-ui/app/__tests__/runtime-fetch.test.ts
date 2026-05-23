// SPDX-License-Identifier: Apache-2.0
/**
 * runtime-fetch contract tests (FR-AUTH-03, FR-INT-02).
 *
 * - injects Authorization + X-Pack from cookies / explicit overrides
 * - surfaces RFC 9457 problem-details as RuntimeError(problem)
 * - never throws non-RuntimeError for HTTP errors
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeFetch, RuntimeError, COOKIES } from '../components/runtime-fetch';

const origFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  method: string;
}

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    return handler(req);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('runtime-fetch', () => {
  beforeEach(() => {
    // jsdom document cookie
    document.cookie = `${COOKIES.session}=; path=/; max-age=0`;
    document.cookie = `${COOKIES.pack}=; path=/; max-age=0`;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns parsed JSON on 200', async () => {
    mockFetch(() => jsonResponse({ ok: true }));
    const out = await runtimeFetch<{ ok: boolean }>('/anything');
    expect(out.ok).toBe(true);
  });

  it('injects X-Pack from cookie', async () => {
    document.cookie = `${COOKIES.pack}=care-demo; path=/`;
    let captured: CapturedRequest | null = null;
    mockFetch((req) => {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => (headers[k] = v));
      captured = { url: req.url, headers, method: req.method };
      return jsonResponse({});
    });
    await runtimeFetch('/admin/packs');
    expect(captured!.headers['x-pack']).toBe('care-demo');
  });

  it('honours explicit pack override over cookie', async () => {
    document.cookie = `${COOKIES.pack}=care-demo; path=/`;
    let captured: CapturedRequest | null = null;
    mockFetch((req) => {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => (headers[k] = v));
      captured = { url: req.url, headers, method: req.method };
      return jsonResponse({});
    });
    await runtimeFetch('/admin/packs', { pack: 'acme' });
    expect(captured!.headers['x-pack']).toBe('acme');
  });

  it('injects Authorization: Bearer from explicit override', async () => {
    let captured: CapturedRequest | null = null;
    mockFetch((req) => {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => (headers[k] = v));
      captured = { url: req.url, headers, method: req.method };
      return jsonResponse({});
    });
    await runtimeFetch('/admin/whoami', { bearer: 'tok-123' });
    expect(captured!.headers['authorization']).toBe('Bearer tok-123');
  });

  it('throws RuntimeError with problem-details on non-2xx', async () => {
    mockFetch(() =>
      jsonResponse(
        {
          type: 'https://example.com/errors/bad-pack',
          title: 'Pack not found',
          detail: 'care-demo is not deployed',
          status: 404,
        },
        404,
        { 'Content-Type': 'application/problem+json' },
      ),
    );
    await expect(runtimeFetch('/admin/packs/care-demo')).rejects.toMatchObject({
      name: 'RuntimeError',
      status: 404,
      problem: {
        title: 'Pack not found',
        detail: 'care-demo is not deployed',
      },
    });
  });

  it('synthesises a problem when error body is not JSON', async () => {
    mockFetch(
      () =>
        new Response('502 Bad Gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
    );
    await expect(runtimeFetch('/anywhere')).rejects.toBeInstanceOf(RuntimeError);
  });

  it('serialises JSON body and sets Content-Type', async () => {
    let bodyText = '';
    let ct = '';
    mockFetch(async (req) => {
      bodyText = await req.text();
      ct = req.headers.get('content-type') ?? '';
      return jsonResponse({ ok: true });
    });
    await runtimeFetch('/tools/billing.adjust', {
      method: 'POST',
      json: { amount: -12.5, reason: 'goodwill' },
    });
    expect(bodyText).toBe(JSON.stringify({ amount: -12.5, reason: 'goodwill' }));
    expect(ct).toContain('application/json');
  });

  it('wraps network failure as RuntimeError(status=0)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await expect(runtimeFetch('/admin/status')).rejects.toMatchObject({
      name: 'RuntimeError',
      status: 0,
    });
  });
});
