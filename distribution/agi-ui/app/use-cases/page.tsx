// SPDX-License-Identifier: Apache-2.0
/**
 * Use-case services screen.
 *
 * Server-fetches ``GET /admin/use-cases`` to pull the platform-level
 * ``langfuse_url`` (if Langfuse is wired). Render of the catalogue itself
 * stays mock-driven for v1 — the runtime aggregation only fills in once
 * packs declare ``use_cases:`` in ``pack.yaml`` (P5).
 *
 * Planner decision (4b-C): only one Langfuse link in the page header — no
 * per-row deep links, because Langfuse v3 needs project IDs we don't carry
 * in pack metadata yet.
 */
import { runtimeFetch } from '../components/runtime-fetch';
import { UseCasesView } from './use-cases-view';

interface UseCasesResponse {
  use_cases: Array<{
    name: string;
    version: string;
    packs: Array<{ slug: string }>;
    health: 'ok' | 'degraded' | 'down';
    tool_count: number;
  }>;
  langfuse_url: string | null;
}

export default async function UseCasesScreen() {
  let langfuseUrl: string | null = null;
  try {
    const resp = await runtimeFetch<UseCasesResponse>('/admin/use-cases');
    langfuseUrl = resp.langfuse_url ?? null;
  } catch {
    // Runtime unreachable (dev/preview) — render without the header link.
    langfuseUrl = null;
  }
  return <UseCasesView langfuseUrl={langfuseUrl} />;
}
