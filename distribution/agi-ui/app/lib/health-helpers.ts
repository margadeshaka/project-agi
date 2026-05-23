// SPDX-License-Identifier: Apache-2.0
/**
 * Pure helpers driving the `/` health dashboard rows (FR-IA-02). Extracted
 * from `app/page.tsx` because Next.js rejects arbitrary named exports on
 * page modules — the test suite (`app/__tests__/health-page.test.tsx`) and
 * any future server-component that needs reachability data import from here.
 *
 * Contracts are stable: changing the return shapes is a breaking change to
 * the admin-console wire surface.
 */

/** Result shape of {@link pingLangfuse}. */
export interface LangfuseHealth {
  configured: boolean;
  ok: boolean;
  host?: string;
  detail?: string;
  checked_iso?: string;
}

/**
 * Returns true when the supplied indexed-at timestamp is missing, unparseable,
 * or older than 7 days relative to `now` (defaulting to wall-clock).
 */
export function isStale(
  timestamp: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (timestamp == null) return true;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return true;
  return now - parsed > 7 * 24 * 60 * 60 * 1000;
}

/**
 * Probe Langfuse reachability. Tries `/api/public/health` (Langfuse v3) and
 * falls back to `/api/health` (v2 / self-hosted forks). 2-second budget per
 * attempt via AbortController. Never throws — returns a structured result so
 * the health card can render `READY` / `UNREACHABLE` chips uniformly.
 */
export async function pingLangfuse(
  host: string | undefined,
): Promise<LangfuseHealth> {
  if (!host) {
    return {
      configured: false,
      ok: false,
      detail: 'LANGFUSE_HOST not set',
    };
  }
  const base = host.replace(/\/$/, '');
  const paths = ['/api/public/health', '/api/health'];
  let lastDetail = '';
  for (const p of paths) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${base}${p}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        return {
          configured: true,
          ok: true,
          host: base,
          checked_iso: new Date().toISOString(),
        };
      }
      lastDetail = `HTTP ${res.status}`;
      if (res.status !== 404) {
        return {
          configured: true,
          ok: false,
          host: base,
          detail: lastDetail,
          checked_iso: new Date().toISOString(),
        };
      }
      // 404 → try the fallback path
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      return {
        configured: true,
        ok: false,
        host: base,
        detail: lastDetail,
        checked_iso: new Date().toISOString(),
      };
    }
  }
  return {
    configured: true,
    ok: false,
    host: base,
    detail: lastDetail || 'No health endpoint responded',
    checked_iso: new Date().toISOString(),
  };
}
