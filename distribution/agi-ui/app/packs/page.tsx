// SPDX-License-Identifier: Apache-2.0
/**
 * /packs — pack list (FR-PACK-01).
 *
 * Admins see every pack; operators see only their scoped packs (runtime
 * enforces; the UI just renders what comes back).
 */

import Link from 'next/link';
import { runtimeFetch, RuntimeError } from '../components/runtime-fetch';
import type { Pack } from '@/lib/api/types';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Card } from '../components/ui/card';

async function loadPacks(): Promise<{ packs: Pack[] | null; error: RuntimeError | null }> {
  try {
    const packs = await runtimeFetch<Pack[]>('/admin/packs');
    return { packs, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { packs: null, error: err };
    throw err;
  }
}

function ThemeSwatch({ hex }: { hex: string }) {
  // hex is data, not a literal — CSS variable injected via inline style.
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 rounded border border-border align-middle"
      style={{ background: hex }}
    />
  );
}

export default async function PacksPage() {
  const { packs, error } = await loadPacks();

  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Packs</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }

  if (!packs || packs.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Packs</h1>
        <EmptyState
          title="No packs deployed"
          description="Drop a folder under packs/ and reload — see the getting-started docs."
          action={
            <a
              className="text-sm text-accent underline"
              href="https://github.com/comviva/project-agi/blob/main/docs/getting-started.md"
            >
              docs ↗
            </a>
          }
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Packs</h1>
        <span className="text-xs text-muted">{packs.length} pack{packs.length === 1 ? '' : 's'}</span>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <li key={pack.slug}>
            <Link
              href={`/packs/${pack.slug}/overview`}
              className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Card className="hover:bg-foreground/5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-semibold">{pack.display_name}</h2>
                  <span className="text-xs text-muted">{pack.vertical}</span>
                </div>
                <p className="font-mono text-xs text-muted">{pack.slug}</p>
                <p className="text-xs text-muted">sha {pack.sha.slice(0, 12)}</p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
                  <dt className="text-muted">Tools</dt>
                  <dd className="text-foreground">{pack.tool_count}</dd>
                  <dt className="text-muted">KB articles</dt>
                  <dd className="text-foreground">{pack.kb_article_count}</dd>
                </dl>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
