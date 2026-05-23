// SPDX-License-Identifier: Apache-2.0
/**
 * /admin/log — admin action audit log (FR-ADM-01).
 */

import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import type { AdminLogEntry } from '@/lib/api/types';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { EmptyState, ErrorState, ForbiddenState } from '../../components/ui/empty-state';

async function loadLog(): Promise<{ items: AdminLogEntry[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<AdminLogEntry[]>('/admin/log');
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function LogPage() {
  const { items, error } = await loadLog();
  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Admin log</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!items || items.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Admin log</h1>
        <EmptyState
          title="No write actions yet"
          description="Pack reloads, KB uploads, and reindexes will appear here."
        />
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin log</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry, idx) => (
            <TableRow key={`${entry.timestamp_iso}-${idx}`}>
              <TableCell className="font-mono text-xs">{entry.timestamp_iso}</TableCell>
              <TableCell className="text-xs">{entry.actor}</TableCell>
              <TableCell className="font-mono text-xs">
                {entry.method} {entry.path}
              </TableCell>
              <TableCell>
                <Badge tone={entry.ok ? 'success' : 'danger'}>
                  {entry.status} {entry.ok ? 'ok' : 'err'}
                </Badge>
                {entry.detail && <span className="ml-2 text-xs text-muted">{entry.detail}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
