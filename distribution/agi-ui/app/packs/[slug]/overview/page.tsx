// SPDX-License-Identifier: Apache-2.0
/**
 * /packs/:slug/overview — pack detail (FR-PACK-01, FR-PACK-02).
 */

import Link from 'next/link';
import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import type { PackOverview } from '@/lib/api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { ErrorState, ForbiddenState } from '../../../components/ui/empty-state';
import { ReloadPackButton } from './reload-button';

interface PageProps {
  params: { slug: string };
}

async function loadPack(slug: string): Promise<{ pack: PackOverview | null; error: RuntimeError | null }> {
  try {
    const pack = await runtimeFetch<PackOverview>(`/admin/packs/${encodeURIComponent(slug)}`, {
      pack: slug,
    });
    return { pack, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { pack: null, error: err };
    throw err;
  }
}

export default async function PackOverviewPage({ params }: PageProps) {
  const { pack, error } = await loadPack(params.slug);

  if (error?.status === 403) {
    return <ForbiddenState />;
  }
  if (error || !pack) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Pack</h1>
        <ErrorState problem={error?.problem ?? { title: 'Pack not found' }} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pack.display_name}</h1>
          <p className="font-mono text-xs text-muted">
            {pack.slug} · vertical: {pack.vertical} · sha {pack.sha.slice(0, 12)}
          </p>
        </div>
        <ReloadPackButton slug={pack.slug} />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Theme preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <span
                aria-label={`primary colour ${pack.theme.primary}`}
                className="block h-12 w-12 rounded border border-border"
                style={{ background: pack.theme.primary }}
              />
              <div className="space-y-0.5">
                <div className="font-mono text-xs text-muted">primary</div>
                <div className="font-mono text-sm">{pack.theme.primary}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model role bindings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {pack.role_bindings.map((rb) => (
                <li key={rb.role} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{rb.role}</span>
                    <span className="text-xs text-muted">→ {rb.model_id}</span>
                  </div>
                  <Badge
                    tone={rb.health === 'ok' ? 'success' : rb.health === 'warn' ? 'warning' : 'danger'}
                  >
                    {rb.health}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allow-listed tools</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {pack.allowed_tools.map((tool) => (
                <li key={tool.name} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/tools/${encodeURIComponent(tool.name)}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {tool.name}
                  </Link>
                  <Badge tone={tool.side_effect === 'write' ? 'write' : 'read'}>
                    {tool.side_effect}
                  </Badge>
                </li>
              ))}
              {pack.allowed_tools.length === 0 && <li className="text-xs text-muted">No tools allow-listed</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">tool</dt>
              <dd>{pack.recent_events_24h.tool}</dd>
              <dt className="text-muted">llm</dt>
              <dd>{pack.recent_events_24h.llm}</dd>
              <dt className="text-muted">error</dt>
              <dd>{pack.recent_events_24h.error}</dd>
              <dt className="text-muted">handoff</dt>
              <dd>{pack.recent_events_24h.handoff}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link className="text-accent underline" href={`/packs/${pack.slug}/tools`}>View tools</Link>
        <Link className="text-accent underline" href={`/packs/${pack.slug}/kb`}>View KB</Link>
        <Link className="text-accent underline" href={`/packs/${pack.slug}/prompts`}>View prompts</Link>
        <Link className="text-accent underline" href={`/audit?pack=${pack.slug}`}>View audit</Link>
      </nav>

      {pack.hotfix_branches && pack.hotfix_branches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hotfix lane</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {pack.hotfix_branches.slice(0, 5).map((hf) => (
                <li key={hf.name} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{hf.name}</span>
                  <span className="text-muted">
                    {hf.merged ? 'merged' : 'open'}
                    {hf.deployed_at_iso ? ` · deployed ${hf.deployed_at_iso}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
