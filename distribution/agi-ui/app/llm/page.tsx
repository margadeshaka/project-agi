// SPDX-License-Identifier: Apache-2.0
/**
 * /llm — read-only role-to-model bindings (FR-LLM-01).
 *
 * Pure read surface; operator.yaml is the source of truth. No edit form.
 */

import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { ModelBinding } from '@/lib/api/types';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { EmptyState, ErrorState, ForbiddenState } from '../components/ui/empty-state';

async function loadBindings(): Promise<{ items: ModelBinding[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<ModelBinding[]>('/admin/llm/bindings');
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function LlmPage() {
  const { items, error } = await loadBindings();

  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">LLM bindings</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!items || items.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">LLM bindings</h1>
        <EmptyState
          title="No model bindings configured"
          description="Edit operator.yaml → console.llm.roles to bind roles to model_ids."
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">LLM bindings</h1>
        <span className="text-xs text-muted">Read-only — edit operator.yaml to change.</span>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Model id</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Params</TableHead>
            <TableHead>Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((rb) => (
            <TableRow key={rb.role}>
              <TableCell className="font-mono text-xs">{rb.role}</TableCell>
              <TableCell className="font-mono text-xs">{rb.model_id}</TableCell>
              <TableCell className="text-xs text-muted">{rb.region}</TableCell>
              <TableCell className="font-mono text-xs text-muted">
                {Object.entries(rb.default_params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ')}
              </TableCell>
              <TableCell>
                <Badge
                  tone={rb.health === 'ok' ? 'success' : rb.health === 'warn' ? 'warning' : 'danger'}
                >
                  {rb.health}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
