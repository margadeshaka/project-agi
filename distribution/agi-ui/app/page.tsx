// SPDX-License-Identifier: Apache-2.0
/**
 * Health dashboard — FR-IA-02.
 *
 * Reference screen for the M3 port. Demonstrates the M3 type scale
 * (28px headline + supporting body), filled card surfaces (no hairline
 * borders), pill-shaped status chips, and the surface-container-low
 * page background.
 */

import { runtimeFetch, RuntimeError } from './components/runtime-fetch';
import type { HealthStatus, ProblemDetails } from '@/lib/api/types';
import { EmptyState, ErrorState } from './components/ui/empty-state';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';

async function loadHealth(): Promise<{ data: HealthStatus | null; problem: ProblemDetails | null }> {
  try {
    const data = await runtimeFetch<HealthStatus>('/admin/status', {});
    return { data, problem: null };
  } catch (err) {
    if (err instanceof RuntimeError) {
      try {
        const data = await runtimeFetch<HealthStatus>('/healthz');
        return { data, problem: null };
      } catch (err2) {
        if (err2 instanceof RuntimeError) return { data: null, problem: err2.problem };
        throw err2;
      }
    }
    throw err;
  }
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
  const { data, problem } = await loadHealth();
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

  if (rows.length === 0) {
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
          <Badge tone={data.status === 'ok' ? 'good' : 'warn'}>{data.status}</Badge>
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
        </ul>
      </Card>
    </section>
  );
}
