// SPDX-License-Identifier: Apache-2.0
/**
 * /admin/settings — operator-level read-only configuration (FR-ADM-03).
 */

import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import type { AdminSettings } from '@/lib/api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { ErrorState, ForbiddenState } from '../../components/ui/empty-state';

async function loadSettings(): Promise<{ settings: AdminSettings | null; error: RuntimeError | null }> {
  try {
    const settings = await runtimeFetch<AdminSettings>('/admin/settings');
    return { settings, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { settings: null, error: err };
    throw err;
  }
}

export default async function SettingsPage() {
  const { settings, error } = await loadSettings();
  if (error?.status === 403) return <ForbiddenState />;
  if (error || !settings) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <ErrorState problem={error?.problem ?? { title: 'Could not load settings' }} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-xs text-muted">
          Read-only. Edit <code>operator.yaml</code> and restart the runtime to change.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">OIDC issuer</dt>
              <dd className="font-mono">{settings.oidc_issuer}</dd>
              <dt className="text-muted">Env</dt>
              <dd className="font-mono">{settings.env}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Observability</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Langfuse</dt>
              <dd className="font-mono">{settings.langfuse_url ?? '—'}</dd>
              <dt className="text-muted">Telemetry sampling</dt>
              <dd className="font-mono">{settings.telemetry_sampling}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vector store</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">URL</dt>
              <dd className="font-mono">{settings.vector_store_url ?? '—'}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
