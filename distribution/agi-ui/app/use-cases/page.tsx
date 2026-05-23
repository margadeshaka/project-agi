// SPDX-License-Identifier: Apache-2.0
/**
 * /use-cases — registry of use-case services (FR-INT / ADMIN-§3.7).
 */

import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { UseCaseService } from '@/lib/api/types';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { EmptyState, ErrorState, ForbiddenState } from '../components/ui/empty-state';

async function loadUseCases(): Promise<{ items: UseCaseService[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<UseCaseService[]>('/admin/use-cases');
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function UseCasesPage() {
  const { items, error } = await loadUseCases();
  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Use-case services</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!items || items.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Use-case services</h1>
        <EmptyState title="No use-case services registered" />
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Use-case services</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Packs</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Tools</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((svc) => (
            <TableRow key={svc.name}>
              <TableCell className="font-mono text-xs">{svc.name}</TableCell>
              <TableCell className="text-xs">{svc.version}</TableCell>
              <TableCell className="text-xs">{svc.packs.join(', ')}</TableCell>
              <TableCell>
                <Badge
                  tone={svc.health === 'ok' ? 'success' : svc.health === 'slow' ? 'warning' : 'danger'}
                >
                  {svc.health}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{svc.tool_count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
