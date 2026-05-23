// SPDX-License-Identifier: Apache-2.0
/**
 * /audit/:correlation_id — event tree for one agent run (FR-TRAIL-02).
 *
 * FR-TRAIL-03: "Open same run in Langfuse" link, disabled when the runtime
 *              has no langfuse_url configured.
 */

import Link from 'next/link';
import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import type { TrailRun } from '@/lib/api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { CodeBlock } from '../../components/ui/code-block';
import { ErrorState, ForbiddenState } from '../../components/ui/empty-state';

interface PageProps {
  params: { correlation_id: string };
}

async function loadRun(cid: string): Promise<{ run: TrailRun | null; error: RuntimeError | null }> {
  try {
    const run = await runtimeFetch<TrailRun>(`/trail/${encodeURIComponent(cid)}`);
    return { run, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { run: null, error: err };
    throw err;
  }
}

export default async function AuditDetailPage({ params }: PageProps) {
  const cid = decodeURIComponent(params.correlation_id);
  const { run, error } = await loadRun(cid);

  if (error?.status === 403) return <ForbiddenState />;
  if (error || !run) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Audit run</h1>
        <ErrorState problem={error?.problem ?? { title: 'Run not found' }} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold font-mono">{run.correlation_id}</h1>
        <p className="text-xs text-muted">
          pack <span className="font-mono">{run.pack}</span> · session{' '}
          <span className="font-mono">{run.session_id}</span> · started {run.started_iso}
          {run.duration_ms ? ` · ${run.duration_ms}ms` : ''} · {run.event_count} events
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {run.langfuse_url ? (
            <a
              href={run.langfuse_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-accent px-3 py-1 text-xs text-background hover:opacity-90"
            >
              Open in Langfuse ↗
            </a>
          ) : (
            <button
              disabled
              title="Langfuse URL not configured in operator settings"
              className="rounded-md border border-border bg-foreground/5 px-3 py-1 text-xs text-muted"
            >
              Open in Langfuse ↗
            </button>
          )}
        </div>
      </header>

      <ol className="space-y-3" role="list">
        {run.events.map((event, idx) => (
          <li key={`${event.timestamp_iso}-${idx}`}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-baseline gap-2">
                  {event.side_effect && (
                    <span
                      aria-label="side-effect"
                      className="inline-block h-2 w-2 rounded-full bg-danger"
                    />
                  )}
                  <CardTitle className="text-sm">
                    {event.event_type}
                    {event.tool_name && (
                      <>
                        {' '}
                        <Link
                          href={`/tools/${encodeURIComponent(event.tool_name)}`}
                          className="font-mono text-xs text-accent underline"
                        >
                          {event.tool_name}
                        </Link>
                      </>
                    )}
                  </CardTitle>
                  <time className="font-mono text-xs text-muted">{event.timestamp_iso}</time>
                  {event.model_id && <Badge tone="info">{event.model_id}</Badge>}
                  {event.tokens_in != null && (
                    <span className="text-xs text-muted">
                      {event.tokens_in}↓ / {event.tokens_out ?? 0}↑ tokens
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <CodeBlock language="json">{JSON.stringify(event.payload, null, 2)}</CodeBlock>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
