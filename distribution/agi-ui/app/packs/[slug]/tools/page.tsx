// SPDX-License-Identifier: Apache-2.0
/**
 * /packs/:slug/tools — pack-scoped tool catalogue (FR-TOOL-01 second variant).
 * Same UI as /tools but the runtime returns only the pack's allow-list.
 */

import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import type { ToolSummary } from '@/lib/api/types';
import { EmptyState, ErrorState, ForbiddenState } from '../../../components/ui/empty-state';
import { ToolCatalogue } from '../../../tools/tool-catalogue';

interface PageProps {
  params: { slug: string };
}

async function loadTools(slug: string): Promise<{ tools: ToolSummary[] | null; error: RuntimeError | null }> {
  try {
    const tools = await runtimeFetch<ToolSummary[]>(`/tools?pack=${encodeURIComponent(slug)}`, {
      pack: slug,
    });
    return { tools, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { tools: null, error: err };
    throw err;
  }
}

export default async function PackToolsPage({ params }: PageProps) {
  const { tools, error } = await loadTools(params.slug);

  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{params.slug} · tools</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!tools || tools.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{params.slug} · tools</h1>
        <EmptyState
          title="No tools allow-listed for this pack"
          description="Edit packs/{slug}/pack.yaml → tools.allow to add."
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{params.slug} · tools</h1>
        <span className="text-xs text-muted">{tools.length} allow-listed</span>
      </header>
      <ToolCatalogue tools={tools} />
    </section>
  );
}
