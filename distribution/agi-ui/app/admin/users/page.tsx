// SPDX-License-Identifier: Apache-2.0
/**
 * /admin/users — OIDC identity + scope mapping (FR-ADM-02).
 * Read-only. Provisioning lives in the OIDC issuer (Keycloak).
 */

import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import type { AdminUser } from '@/lib/api/types';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { EmptyState, ErrorState, ForbiddenState } from '../../components/ui/empty-state';

async function loadUsers(): Promise<{ items: AdminUser[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<AdminUser[]>('/admin/users');
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function UsersPage() {
  const { items, error } = await loadUsers();
  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Users</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!items || items.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Users</h1>
        <EmptyState
          title="No active identities"
          description="Identities populate after their first sign-in via the OIDC issuer."
        />
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <span className="text-xs text-muted">Read-only — provisioning lives in Keycloak.</span>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((u) => (
            <TableRow key={u.subject}>
              <TableCell className="font-mono text-xs">{u.subject}</TableCell>
              <TableCell className="text-xs">{u.email ?? '—'}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {u.scopes.map((s) => (
                    <Badge key={s} tone="info">
                      {s}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted">{u.last_seen_iso}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
