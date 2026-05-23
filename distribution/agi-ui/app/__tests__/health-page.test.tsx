// SPDX-License-Identifier: Apache-2.0
/**
 * Health page — Langfuse reachability + KB-staleness chips (FR-IA-02).
 *
 * The page itself is an async server component, which means we cannot
 * `render()` it from jsdom (React 18 does not yet ship a stable async-RSC
 * test driver). Instead we test the two pure helpers (`isStale`, async
 * `pingLangfuse`) that drive the new rows — both are exported precisely
 * so this kind of contract test is possible without spinning up Next.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Page transitively imports `@/auth` via app/lib/server-session.ts (4a-B rewrite).
// We mock that chain so the helpers we actually want to test can load in
// vitest's jsdom env without booting next-auth.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => null),
}));
vi.mock('next/navigation', () => ({
  redirect: (_path: string) => {
    throw new Error('redirect-called');
  },
}));

// eslint-disable-next-line import/first
import { isStale, pingLangfuse } from '../page';

const ORIG_FETCH = globalThis.fetch;

describe('isStale', () => {
  const NOW = Date.parse('2026-05-23T10:00:00Z');

  it('treats a null/undefined timestamp as stale', () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(isStale('not-an-iso', NOW)).toBe(true);
  });

  it('returns true when the timestamp is older than 7 days', () => {
    // 8 days back
    const old = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(old, NOW)).toBe(true);
  });

  it('returns false when the timestamp is within 7 days', () => {
    // 3 days back
    const fresh = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(fresh, NOW)).toBe(false);
  });

  it('returns false at the boundary just under 7 days', () => {
    const boundary = new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(boundary, NOW)).toBe(false);
  });
});

describe('pingLangfuse', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('returns configured=false when no LANGFUSE_HOST is supplied', async () => {
    const out = await pingLangfuse(undefined);
    expect(out.configured).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.detail).toMatch(/LANGFUSE_HOST/);
  });

  it('returns ok=true when /api/public/health responds 200', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{"status":"ok"}', { status: 200 }),
    );
    const out = await pingLangfuse('http://langfuse:3000');
    expect(out.configured).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.host).toBe('http://langfuse:3000');
    expect(out.checked_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to /api/health when /api/public/health 404s', async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    mock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const out = await pingLangfuse('http://langfuse:3000');
    expect(out.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('returns ok=false with HTTP detail on a non-404 error response', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('upstream down', { status: 503 }),
    );
    const out = await pingLangfuse('http://langfuse:3000');
    expect(out.ok).toBe(false);
    expect(out.detail).toBe('HTTP 503');
  });

  it('returns ok=false when fetch throws', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('econn refused'),
    );
    const out = await pingLangfuse('http://langfuse:3000');
    expect(out.ok).toBe(false);
    expect(out.detail).toContain('econn refused');
  });

  it('strips a trailing slash from the host', async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(new Response('{}', { status: 200 }));
    const out = await pingLangfuse('http://langfuse:3000/');
    expect(out.host).toBe('http://langfuse:3000');
    expect((mock.mock.calls[0]?.[0] as string).startsWith('http://langfuse:3000/api/')).toBe(true);
  });
});
