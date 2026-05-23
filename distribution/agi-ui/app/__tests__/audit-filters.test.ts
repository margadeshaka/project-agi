// SPDX-License-Identifier: Apache-2.0
/**
 * Audit filters round-trip — URL ↔ AuditFilters (FR-TRAIL-01 AC).
 */

import { describe, expect, it } from 'vitest';
import {
  applyDefaults,
  filtersToQuery,
  parseAuditFilters,
  serialiseAuditFilters,
  type AuditFilters,
} from '../audit/filters';

describe('audit filters', () => {
  it('parses pack and event from URLSearchParams', () => {
    const sp = new URLSearchParams('pack=care-demo&event=tool_call');
    const f = parseAuditFilters(sp);
    expect(f.pack).toBe('care-demo');
    expect(f.eventType).toBe('tool_call');
  });

  it('parses pack from a plain object', () => {
    const f = parseAuditFilters({ pack: 'acme' });
    expect(f.pack).toBe('acme');
    expect(f.eventType).toBeNull();
  });

  it('treats empty string as null', () => {
    const f = parseAuditFilters({ pack: '' });
    expect(f.pack).toBeNull();
  });

  it('applies sensible defaults (24h window)', () => {
    const f = applyDefaults({ pack: null, eventType: null, from: null, to: null });
    expect(f.from).not.toBeNull();
    expect(f.to).not.toBeNull();
    const fromMs = Date.parse(f.from!);
    const toMs = Date.parse(f.to!);
    expect(toMs - fromMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(toMs - fromMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('round-trips through serialiseAuditFilters → parseAuditFilters', () => {
    const original: AuditFilters = {
      pack: 'care-demo',
      eventType: 'llm_response',
      from: '2026-05-22T00:00:00.000Z',
      to: '2026-05-22T23:59:59.000Z',
    };
    const sp = serialiseAuditFilters(original);
    const parsed = parseAuditFilters(sp);
    expect(parsed).toEqual(original);
  });

  it('filtersToQuery omits the leading ? when filters are empty', () => {
    const q = filtersToQuery({ pack: null, eventType: null, from: null, to: null });
    expect(q).toBe('');
  });

  it('filtersToQuery prefixes ? when filters are present', () => {
    const q = filtersToQuery({
      pack: 'acme',
      eventType: null,
      from: null,
      to: null,
    });
    expect(q).toBe('?pack=acme');
  });
});
