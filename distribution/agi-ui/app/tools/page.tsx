// SPDX-License-Identifier: Apache-2.0
/**
 * /tools — cross-pack tool catalogue (FR-TOOL-01).
 *
 * Server-side fetch + client-side filtering keeps the initial paint fast
 * while letting search/domain/side-effect filters apply without a
 * round-trip. Virtualisation lives in the client component below.
 */

import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { ToolSummary } from '@/lib/api/types';
import { EmptyState, ErrorState, ForbiddenState } from '../components/ui/empty-state';
import { ToolCatalogue } from './tool-catalogue';

async function loadTools(): Promise<{ tools: ToolSummary[] | null; error: RuntimeError | null }> {
  try {
    const tools = await runtimeFetch<ToolSummary[]>('/tools');
    return { tools, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { tools: null, error: err };
    throw err;
  }
}

export default async function ToolsPage() {
  const { tools, error } = await loadTools();

  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Tool catalogue</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!tools || tools.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Tool catalogue</h1>
        <EmptyState
          title="Hub bundle not built yet"
          description="Run agi-core build-tools <openapi.yaml> or wait for the operator to deploy a bundle."
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Tool catalogue</h1>
        <span className="text-xs text-muted">
          {tools.length} tool{tools.length === 1 ? '' : 's'} across{' '}
          {new Set(tools.map((t) => t.domain)).size} domain
          {new Set(tools.map((t) => t.domain)).size === 1 ? '' : 's'}
        </span>
      </header>
      <ToolCatalogue tools={tools} />
    </section>
  );
}
