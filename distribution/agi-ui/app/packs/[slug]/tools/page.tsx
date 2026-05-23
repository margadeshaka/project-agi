// SPDX-License-Identifier: Apache-2.0
/**
 * Pack-scoped tool catalogue.
 *
 * Server-fetches from the agi-runtime endpoint ``GET /packs/{slug}/tools``
 * (not ``/tools?pack={slug}`` — that route shape never landed). The runtime
 * returns ``{pack, tools: [...]}``; we unwrap the envelope and hand the bare
 * list to ``ToolsTable``.
 *
 * Fallback: when the runtime fetch fails (e.g. local dev with no runtime
 * spun up), we degrade to the mock catalogue filtered by ``packs.includes``.
 * Once 4b-A's tool-catalogue rewrite lands, the mock fallback can drop.
 */
import { ToolsTable } from '../../../components/tools-table';
import { runtimeFetch } from '../../../components/runtime-fetch';
import { DATA, type ToolDef } from '../../../mock/data';

interface RuntimeTool {
  name: string;
  domain?: string;
  description?: string;
  side_effecting?: boolean;
  rate_limit_class?: string;
  bundle_version?: string;
  consuming_pack_count?: number;
  dry_run_supported?: boolean;
  method?: string;
  path_template?: string;
}

interface PackToolsResponse {
  pack: string;
  tools: RuntimeTool[];
}

function toToolDef(t: RuntimeTool, slug: string): ToolDef {
  const rate = t.rate_limit_class ?? 'low';
  return {
    name: t.name,
    domain: t.domain ?? '',
    method: t.method ?? '',
    path: t.path_template ?? '',
    side: t.side_effecting ? 'write' : 'read',
    rate: rate === 'write_high' ? 'high' : rate === 'read' ? 'low' : rate,
    desc: t.description ?? '',
    packs: [slug],
    bundle: t.bundle_version ?? '',
    dryRun: !!t.dry_run_supported,
  };
}

export default async function PackToolsScreen({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let tools: ToolDef[];
  try {
    const resp = await runtimeFetch<PackToolsResponse>(
      `/packs/${encodeURIComponent(slug)}/tools`,
      { pack: slug },
    );
    tools = resp.tools.map((t) => toToolDef(t, slug));
  } catch {
    // Runtime unavailable in dev/preview — fall back to the mock catalogue.
    tools = DATA.tools.filter((t) => t.packs.includes(slug));
  }
  return <ToolsTable tools={tools} scopedToPack={slug} />;
}
