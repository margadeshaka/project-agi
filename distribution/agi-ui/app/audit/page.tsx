// SPDX-License-Identifier: Apache-2.0
/**
 * /audit — AI-Trail viewer list (FR-TRAIL-01).
 *
 * Server-side fetch with filters from the URL; client component renders
 * the list with virtualised rows.
 */

import Link from 'next/link';
import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { TrailEvent } from '@/lib/api/types';
import { ErrorState, ForbiddenState, EmptyState } from '../components/ui/empty-state';
import { AuditFiltersForm } from './filters-form';
import { applyDefaults, filtersToQuery, parseAuditFilters } from './filters';
import { Badge } from '../components/ui/badge';

interface PageProps {
  searchParams: Record<string, string | undefined>;
}

async function loadEvents(query: string): Promise<{ items: TrailEvent[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<TrailEvent[]>(`/trail${query}`);
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function AuditPage({ searchParams }: PageProps) {
  const filters = applyDefaults(parseAuditFilters(searchParams));
  const query = filtersToQuery(filters);
  const { items, error } = await loadEvents(query);

  if (error?.status === 403) return <ForbiddenState />;

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">AI-Trail</h1>
        <span className="text-xs text-muted">
          {items?.length ?? 0} event{items?.length === 1 ? '' : 's'}
        </span>
      </header>
      <AuditFiltersForm initial={filters} />

      {error && <ErrorState problem={error.problem} />}

      {!error && (!items || items.length === 0) && (
        <EmptyState
          title="No events in the current window"
          description="Widen the time range or change the pack filter."
        />
      )}

      {!error && items && items.length > 0 && (
        <ol className="divide-y divide-border overflow-hidden rounded-md border border-border" role="list">
          {items.map((ev, i) => (
            <li key={`${ev.correlation_id}-${ev.timestamp_iso}-${i}`} className="flex flex-wrap items-baseline gap-3 px-3 py-2 text-sm">
              {ev.side_effect && (
                <span
                  aria-label="side-effect"
                  className="inline-block h-2 w-2 rounded-full bg-danger"
                />
              )}
              <time className="font-mono text-xs text-muted">{ev.timestamp_iso}</time>
              <span className="font-mono text-xs">{ev.pack}</span>
              <Link
                href={`/audit/${encodeURIComponent(ev.correlation_id)}`}
                className="font-mono text-xs text-accent hover:underline"
              >
                {ev.correlation_id}
              </Link>
              <Badge tone="info">{ev.event_type}</Badge>
              {ev.summary && <span className="text-xs text-muted">{ev.summary}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
