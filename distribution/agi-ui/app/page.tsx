// SPDX-License-Identifier: Apache-2.0
/**
 * Health dashboard — FR-IA-02.
 *
 * Reference screen for the M3 port. Demonstrates the M3 type scale
 * (28px headline + supporting body), filled card surfaces (no hairline
 * borders), pill-shaped status chips, and the surface-container-low
 * page background.
 *
 * In addition to the `/admin/status` roll-up the page surfaces two pieces
 * of operational signal the runtime cannot trivially report itself:
 *   1. Langfuse reachability — server-side pinged here so the browser
 *      never speaks to the trace store directly (FR-AUTH-03 spirit).
 *   2. Per-pack KB freshness — flagged Stale when `kb.indexed_at` is
 *      missing or older than 7 days, surfaced from the per-pack
 *      `/admin/packs/{slug}` overview endpoint (4a-A contract).
 */

import { redirect } from 'next/navigation';
import { runtimeFetch, RuntimeError } from './components/runtime-fetch';
import { loadVisiblePacks } from './lib/server-session';
import type { HealthStatus, ProblemDetails } from '@/lib/api/types';
import { EmptyState, ErrorState } from './components/ui/empty-state';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';

/** 4a-A pack overview shape — only the kb freshness slice we need. */
interface PackOverviewKb {
  kb?: {
    indexed_at?: string | null;
  } | null;
}

/** Langfuse readiness result, surfaced as a row in the health card. */
interface LangfuseStatus {
  configured: boolean;
  ok: boolean;
  host?: string;
  checked_iso: string;
  detail?: string;
}

/** Per-pack KB freshness summary. */
interface PackFreshness {
  slug: string;
  display_name: string;
  indexed_at?: string | null;
  stale: boolean;
  /** Whether we successfully read the per-pack overview at all. */
  ok: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function loadHealth(): Promise<{
  data: HealthStatus | null;
  problem: ProblemDetails | null;
  unauthorized: boolean;
}> {
  try {
    const data = await runtimeFetch<HealthStatus>('/admin/status', {});
    return { data, problem: null, unauthorized: false };
  } catch (err) {
    if (err instanceof RuntimeError) {
      if (err.status === 401) return { data: null, problem: err.problem, unauthorized: true };
      try {
        const data = await runtimeFetch<HealthStatus>('/healthz');
        return { data, problem: null, unauthorized: false };
      } catch (err2) {
        if (err2 instanceof RuntimeError) {
          if (err2.status === 401) return { data: null, problem: err2.problem, unauthorized: true };
          return { data: null, problem: err2.problem, unauthorized: false };
        }
        throw err2;
      }
    }
    throw err;
  }
}

/**
 * Server-component ping to Langfuse. Uses a 2s AbortController timeout to
 * keep the page fast when Langfuse is unreachable. Returns a shape
 * regardless of outcome — never throws — so the row is always renderable.
 *
 * v3 publishes the health endpoint at `/api/public/health` (open without
 * auth); we prefer that and fall back to `/api/health` for older builds.
 */
export async function pingLangfuse(host?: string): Promise<LangfuseStatus> {
  const checked_iso = new Date().toISOString();
  if (!host) {
    return { configured: false, ok: false, checked_iso, detail: 'LANGFUSE_HOST not set' };
  }
  const base = host.replace(/\/+$/, '');
  const paths = ['/api/public/health', '/api/health'];
  for (const path of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return { configured: true, ok: true, host: base, checked_iso };
      }
      // Try the next candidate path on 404 only — other statuses indicate
      // the host answered, just not green, so surface that immediately.
      if (res.status !== 404) {
        return {
          configured: true,
          ok: false,
          host: base,
          checked_iso,
          detail: `HTTP ${res.status}`,
        };
      }
    } catch (err) {
      clearTimeout(timer);
      const detail =
        err instanceof Error && err.name === 'AbortError'
          ? 'timeout after 2s'
          : err instanceof Error
            ? err.message
            : String(err);
      return { configured: true, ok: false, host: base, checked_iso, detail };
    }
  }
  return {
    configured: true,
    ok: false,
    host: base,
    checked_iso,
    detail: 'no health endpoint responded',
  };
}

/** Detect KB staleness from the per-pack overview shape. */
export function isStale(indexed_at: string | null | undefined, now: number = Date.now()): boolean {
  if (!indexed_at) return true;
  const t = Date.parse(indexed_at);
  if (Number.isNaN(t)) return true;
  return now - t > SEVEN_DAYS_MS;
}

async function loadPackFreshness(): Promise<PackFreshness[]> {
  const packs = await loadVisiblePacks();
  if (packs.length === 0) return [];
  const now = Date.now();
  const results = await Promise.all(
    packs.map(async (p): Promise<PackFreshness> => {
      try {
        const overview = await runtimeFetch<PackOverviewKb>(
          `/admin/packs/${encodeURIComponent(p.slug)}`,
          { pack: p.slug },
        );
        const indexed_at = overview.kb?.indexed_at ?? null;
        return {
          slug: p.slug,
          display_name: p.display_name,
          indexed_at,
          stale: isStale(indexed_at, now),
          ok: true,
        };
      } catch {
        // Treat lookup failure as unknown — we still render the row so the
        // operator notices, but we don't claim "stale" definitively.
        return {
          slug: p.slug,
          display_name: p.display_name,
          indexed_at: null,
          stale: false,
          ok: false,
        };
      }
    }),
  );
  return results;
}

function ScreenHead({ title, lede, meta }: { title: string; lede?: string; meta?: string }) {
  return (
    <header className="mb-6 mt-4 flex flex-col gap-1">
      <h1
        className="text-[28px] font-normal leading-tight tracking-normal"
        style={{ color: 'var(--md-on-surface)' }}
      >
        {title}
      </h1>
      {lede && (
        <p
          className="max-w-[75ch] text-sm leading-relaxed"
          style={{ color: 'var(--md-on-surface-variant)' }}
        >
          {lede}
        </p>
      )}
      {meta && (
        <p
          className="mt-1 font-mono text-[11.5px]"
          style={{ color: 'var(--md-outline)' }}
        >
          {meta}
        </p>
      )}
    </header>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: ok ? 'var(--md-success)' : 'var(--md-warning)' }}
    />
  );
}

export default async function HealthPage() {
  const { data, problem, unauthorized } = await loadHealth();

  // FR-AUTH-02: never paint privileged content after a 401 — push the user
  // through the sign-in flow so cookies + redirect-back work.
  if (unauthorized) {
    redirect('/sign-in');
  }

  const ts = new Date().toISOString();

  if (!data) {
    return (
      <section>
        <ScreenHead title="Health" />
        <ErrorState
          problem={problem ?? { title: 'Runtime unreachable', detail: 'Could not load health.' }}
        />
      </section>
    );
  }

  const rows = Object.entries(data.checks).map(([name, ok]) => ({
    name,
    ok,
    detail: data.details?.[name],
  }));

  // Side-channel checks: Langfuse + per-pack KB freshness. Run in parallel
  // so the page is no slower than the slowest probe.
  const [langfuse, packFreshness] = await Promise.all([
    pingLangfuse(process.env.LANGFUSE_HOST),
    loadPackFreshness(),
  ]);

  if (rows.length === 0 && !langfuse.configured && packFreshness.length === 0) {
    return (
      <section>
        <ScreenHead title="Health" />
        <EmptyState
          title="No health checks reported"
          description="The runtime has no dependencies configured. This is unusual for a real deployment."
        />
      </section>
    );
  }

  return (
    <section>
      <ScreenHead
        title="Health"
        lede="Every dependency the runtime knows about, with last-checked timestamp and colour-coded status. Day-to-day trace analysis lives in Langfuse."
        meta={`last checked ${ts}`}
      />

      <Card variant="filled" className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2
            className="text-sm font-medium tracking-normal"
            style={{ color: 'var(--md-on-surface)' }}
          >
            Components
          </h2>
          <Badge tone={data.status === 'ready' ? 'good' : 'warn'}>{data.status}</Badge>
        </div>
        <ul role="list" className="divide-y" style={{ borderColor: 'var(--md-outline-variant)' }}>
          {rows.map((row) => (
            <li
              key={row.name}
              className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-[var(--md-on-surface)]/[0.04]"
            >
              <StatusDot ok={row.ok} />
              <div className="flex-1">
                <div
                  className="text-[13.5px] font-medium"
                  style={{ color: 'var(--md-on-surface)' }}
                >
                  {row.name}
                </div>
                <div
                  className="font-mono text-[11.5px]"
                  style={{ color: 'var(--md-on-surface-variant)' }}
                >
                  {row.detail?.message ??
                    (row.detail?.latency_ms ? `${row.detail.latency_ms}ms` : '—')}
                </div>
              </div>
              <Badge tone={row.ok ? 'good' : 'warn'}>{row.ok ? 'ok' : 'degraded'}</Badge>
            </li>
          ))}

          {langfuse.configured && (
            <li
              data-testid="health-row-langfuse"
              className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-[var(--md-on-surface)]/[0.04]"
            >
              <StatusDot ok={langfuse.ok} />
              <div className="flex-1">
                <div
                  className="text-[13.5px] font-medium"
                  style={{ color: 'var(--md-on-surface)' }}
                >
                  Langfuse
                </div>
                <div
                  className="font-mono text-[11.5px]"
                  style={{ color: 'var(--md-on-surface-variant)' }}
                >
                  {langfuse.host}
                  {langfuse.detail ? ` · ${langfuse.detail}` : ''} · checked {langfuse.checked_iso}
                </div>
              </div>
              <Badge tone={langfuse.ok ? 'good' : 'warn'}>
                {langfuse.ok ? 'READY' : 'UNREACHABLE'}
              </Badge>
            </li>
          )}
        </ul>
      </Card>

      {packFreshness.length > 0 && (
        <Card variant="filled" className="mt-6 overflow-hidden p-0">
          <div className="flex items-center justify-between px-6 pb-3 pt-5">
            <h2
              className="text-sm font-medium tracking-normal"
              style={{ color: 'var(--md-on-surface)' }}
            >
              KB freshness
            </h2>
            <span
              className="font-mono text-[11.5px]"
              style={{ color: 'var(--md-on-surface-variant)' }}
            >
              stale = no reindex in the last 7 days
            </span>
          </div>
          <ul
            role="list"
            data-testid="kb-freshness-list"
            className="divide-y"
            style={{ borderColor: 'var(--md-outline-variant)' }}
          >
            {packFreshness.map((p) => (
              <li
                key={p.slug}
                data-testid={`kb-freshness-row-${p.slug}`}
                className="flex items-center gap-4 px-6 py-3"
              >
                <StatusDot ok={p.ok && !p.stale} />
                <div className="flex-1">
                  <div
                    className="text-[13.5px] font-medium"
                    style={{ color: 'var(--md-on-surface)' }}
                  >
                    {p.display_name}
                  </div>
                  <div
                    className="font-mono text-[11.5px]"
                    style={{ color: 'var(--md-on-surface-variant)' }}
                  >
                    {p.slug} · {p.indexed_at ? `indexed ${p.indexed_at}` : 'never indexed'}
                  </div>
                </div>
                {!p.ok && <Badge tone="warn">Unknown</Badge>}
                {p.ok && p.stale && (
                  <Badge tone="warn" data-testid={`kb-stale-${p.slug}`}>
                    Stale
                  </Badge>
                )}
                {p.ok && !p.stale && <Badge tone="good">Fresh</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
