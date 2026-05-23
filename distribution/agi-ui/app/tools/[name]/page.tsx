// SPDX-License-Identifier: Apache-2.0
/**
 * /tools/:name — tool detail with JSON Schema viewer + test-invoke.
 *
 * FR-TOOL-02: JSON Schema for input + output + side-effect + rate-limit.
 * FR-TOOL-03: schema-driven form, calls POST /tools/:name on submit.
 */

import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import type { ToolDetail } from '@/lib/api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { CodeBlock } from '../../components/ui/code-block';
import { ErrorState, ForbiddenState } from '../../components/ui/empty-state';
import { TestInvokePanel } from './test-invoke';

interface PageProps {
  params: { name: string };
}

async function loadTool(name: string): Promise<{ tool: ToolDetail | null; error: RuntimeError | null }> {
  try {
    const tool = await runtimeFetch<ToolDetail>(`/tools/${encodeURIComponent(name)}`);
    return { tool, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { tool: null, error: err };
    throw err;
  }
}

export default async function ToolDetailPage({ params }: PageProps) {
  const name = decodeURIComponent(params.name);
  const { tool, error } = await loadTool(name);

  if (error?.status === 403) return <ForbiddenState />;
  if (error || !tool) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Tool</h1>
        <ErrorState problem={error?.problem ?? { title: 'Tool not found' }} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold font-mono">{tool.name}</h1>
        <p className="text-sm text-muted">{tool.description}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge tone={tool.side_effect === 'write' ? 'write' : 'read'}>{tool.side_effect}</Badge>
          <Badge tone="info">{tool.rate_limit_class} rate</Badge>
          <Badge tone="neutral">{tool.domain}</Badge>
          <Badge tone="neutral">bundle {tool.bundle_version}</Badge>
          {tool.dry_run_supported && <Badge tone="success">dry-run</Badge>}
        </div>
        <p className="font-mono text-xs text-muted">{tool.source_openapi_op}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Input schema</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock language="json">{JSON.stringify(tool.input_schema, null, 2)}</CodeBlock>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output schema</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock language="json">{JSON.stringify(tool.output_schema, null, 2)}</CodeBlock>
          </CardContent>
        </Card>
      </div>

      <TestInvokePanel tool={tool} />
    </section>
  );
}
