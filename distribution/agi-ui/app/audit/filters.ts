// SPDX-License-Identifier: Apache-2.0
/**
 * Audit filter helpers — pure functions for round-trip between the URL
 * search params and a typed filter shape. Tested in
 * app/__tests__/audit-filters.test.ts (FR-TRAIL-01 AC: URL reflects filters).
 */

export interface AuditFilters {
  pack: string | null;
  eventType: string | null;
  from: string | null; // ISO
  to: string | null;   // ISO
}

const DEFAULT_FROM_OFFSET_MS = 24 * 60 * 60 * 1000;

export function parseAuditFilters(params: URLSearchParams | Record<string, string | undefined>): AuditFilters {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) {
      return params.get(key);
    }
    const v = params[key];
    return v === undefined || v === '' ? null : v;
  };
  return {
    pack: get('pack'),
    eventType: get('event'),
    from: get('from'),
    to: get('to'),
  };
}

export function applyDefaults(f: AuditFilters): AuditFilters {
  const to = f.to ?? new Date().toISOString();
  const from = f.from ?? new Date(Date.now() - DEFAULT_FROM_OFFSET_MS).toISOString();
  return { ...f, from, to };
}

export function serialiseAuditFilters(f: AuditFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.pack) out.set('pack', f.pack);
  if (f.eventType) out.set('event', f.eventType);
  if (f.from) out.set('from', f.from);
  if (f.to) out.set('to', f.to);
  return out;
}

export function filtersToQuery(f: AuditFilters): string {
  const sp = serialiseAuditFilters(f);
  const s = sp.toString();
  return s ? `?${s}` : '';
}
