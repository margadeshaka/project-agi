// SPDX-License-Identifier: Apache-2.0
/**
 * Pack overview — Reload button URL contract (FR-PACK-02, EXECUTION_PLAN §4.4).
 *
 * What this locks down:
 *   1. The POST URL the click sends — must match the 4a-A admin contract
 *      `/admin/packs/{slug}/reload`, with slug URL-encoded.
 *   2. The GET URL the 1s follow-up sends — must hit
 *      `/admin/log?subject=pack.reload&pack={slug}&limit=1`, the
 *      acceptance criterion that admin writes appear in /admin/log within 1s.
 *   3. The href we render on the success line — must include
 *      `correlation_id=…` when the runtime returns one, and fall back to
 *      the list view otherwise.
 *   4. `correlationOf()` — defensive parser tolerates both shapes 4a-A
 *      might ship (`correlation_id` at top-level OR embedded in `detail`).
 *
 * Why not a render() test: @testing-library/dom isn't installed (peer
 * gap), so the existing pack-switcher.test.tsx and any new render-based
 * test can't run in this workspace yet. The Playwright E2E covers the
 * click → toast assertion at the integration layer.
 */

import { describe, expect, it, vi } from 'vitest';

// Module-graph guard: reload-button transitively pulls in auth-provider, etc;
// none touch next-auth so no mocking required, but we stub next/navigation
// just in case future internal additions reach for it.
vi.mock('next/navigation', () => ({}));

import {
  adminLogHrefFor,
  correlationOf,
  reloadLogPath,
  reloadPostPath,
} from '../packs/[slug]/overview/reload-button';
import type { AdminLogEntry } from '@/lib/api/types';

describe('reload-button URL contract', () => {
  describe('reloadPostPath', () => {
    it('returns /admin/packs/<slug>/reload for a normal slug', () => {
      expect(reloadPostPath('telco-demo')).toBe('/admin/packs/telco-demo/reload');
    });

    it('URL-encodes special characters in the slug', () => {
      expect(reloadPostPath('telco demo/v2')).toBe('/admin/packs/telco%20demo%2Fv2/reload');
    });
  });

  describe('reloadLogPath', () => {
    it('hits /admin/log with subject=pack.reload + pack + limit=1', () => {
      expect(reloadLogPath('telco-demo')).toBe(
        '/admin/log?subject=pack.reload&pack=telco-demo&limit=1',
      );
    });

    it('URL-encodes the slug', () => {
      expect(reloadLogPath('a/b')).toContain('pack=a%2Fb');
    });
  });

  describe('adminLogHrefFor', () => {
    it('returns the correlation-keyed deep link when an id is present', () => {
      expect(adminLogHrefFor('corr-xyz-999')).toBe(
        '/admin/log?correlation_id=corr-xyz-999',
      );
    });

    it('URL-encodes the correlation id', () => {
      expect(adminLogHrefFor('corr/x?y')).toBe(
        '/admin/log?correlation_id=corr%2Fx%3Fy',
      );
    });

    it('falls back to the list view when no correlation id is known', () => {
      expect(adminLogHrefFor(undefined)).toBe('/admin/log?subject=pack.reload');
    });
  });
});

describe('correlationOf', () => {
  it('returns undefined for null', () => {
    expect(correlationOf(null)).toBeUndefined();
  });

  it('reads the top-level correlation_id when present', () => {
    const entry = {
      timestamp_iso: '2026-05-23T10:00:00Z',
      actor: 'admin',
      method: 'POST',
      path: '/admin/packs/telco-demo/reload',
      status: 200,
      ok: true,
      correlation_id: 'abc-123-xyz',
    } as unknown as AdminLogEntry;
    expect(correlationOf(entry)).toBe('abc-123-xyz');
  });

  it('falls back to a UUID-shaped match inside the detail string', () => {
    const entry = {
      timestamp_iso: '2026-05-23T10:00:00Z',
      actor: 'admin',
      method: 'POST',
      path: '/x',
      status: 200,
      ok: true,
      detail: 'pack reload accepted, run abcd1234ef56-7890 traced',
    } as unknown as AdminLogEntry;
    expect(correlationOf(entry)).toBe('abcd1234ef56-7890');
  });

  it('returns undefined when neither field carries an id', () => {
    const entry = {
      timestamp_iso: '2026-05-23T10:00:00Z',
      actor: 'admin',
      method: 'POST',
      path: '/x',
      status: 200,
      ok: true,
      detail: 'no id here',
    } as unknown as AdminLogEntry;
    expect(correlationOf(entry)).toBeUndefined();
  });
});
