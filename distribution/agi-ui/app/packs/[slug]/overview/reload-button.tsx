// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * ReloadPackButton — POST /admin/packs/:slug/reload (FR-PACK-02).
 *
 * Round-trip:
 *   1. Click → POST /admin/packs/{slug}/reload  (admin-write).
 *   2. Inline status: "Reloading…" while in-flight, then "Reloaded.".
 *   3. Toast success ("Reloaded. View entry in /admin/log") with a link.
 *   4. After 1s, GET /admin/log?subject=pack.reload&pack={slug}&limit=1 to
 *      surface the freshly written log entry's correlation_id — this is the
 *      EXECUTION_PLAN §4.4 acceptance criterion that admin writes appear in
 *      /admin/log within 1s of the action.
 *
 * The 1s delay matches the runtime's audit-flush budget; if the entry
 * isn't there yet we render "(log entry pending)" rather than blocking.
 */

import Link from 'next/link';
import { useState } from 'react';
import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import { useSession } from '../../../components/auth-provider';
import { canManagePack, type AdminLogEntry } from '@/lib/api/types';
import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toast';

interface Props {
  slug: string;
}

/** Status surfaced inline next to the button. */
type InlineStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'success'; correlation_id?: string }
  | { kind: 'error'; message: string };

/** Build the admin-log query URL for the latest reload entry. Exported for tests. */
export function reloadLogPath(slug: string): string {
  return `/admin/log?subject=pack.reload&pack=${encodeURIComponent(slug)}&limit=1`;
}

/** Build the reload POST path for a given pack slug. Exported for tests. */
export function reloadPostPath(slug: string): string {
  return `/admin/packs/${encodeURIComponent(slug)}/reload`;
}

/** Build the user-facing /admin/log href for a correlation id (or fallback list view). */
export function adminLogHrefFor(correlation_id?: string): string {
  if (correlation_id) return `/admin/log?correlation_id=${encodeURIComponent(correlation_id)}`;
  return '/admin/log?subject=pack.reload';
}

/**
 * Look up the latest admin-log entry for this reload action.
 *
 * The runtime should return a list; we read item 0. A 4xx/5xx here is
 * not fatal — the action succeeded, we just can't surface the link.
 */
async function fetchLatestReloadLog(slug: string): Promise<AdminLogEntry | null> {
  try {
    const entries = await runtimeFetch<AdminLogEntry[]>(reloadLogPath(slug));
    return Array.isArray(entries) && entries.length > 0 ? entries[0]! : null;
  } catch {
    return null;
  }
}

/** Pull a correlation id out of an admin log entry without overspecifying the shape. */
export function correlationOf(entry: AdminLogEntry | null): string | undefined {
  if (!entry) return undefined;
  const rec = entry as unknown as Record<string, unknown>;
  const fromTop = typeof rec.correlation_id === 'string' ? rec.correlation_id : undefined;
  if (fromTop) return fromTop;
  // Some admin-log shapes nest the id under `detail` — best-effort parse so
  // we don't depend on 4a-A's exact field placement.
  if (typeof rec.detail === 'string') {
    const m = rec.detail.match(/[0-9a-f-]{8,}/i);
    if (m) return m[0];
  }
  return undefined;
}

export function ReloadPackButton({ slug }: Props) {
  const { user } = useSession();
  const { push } = useToast();
  const [status, setStatus] = useState<InlineStatus>({ kind: 'idle' });

  if (!canManagePack(user, slug)) return null;

  const click = async () => {
    setStatus({ kind: 'busy' });
    try {
      await runtimeFetch(reloadPostPath(slug), {
        method: 'POST',
        pack: slug,
      });
      // Surface success immediately — log lookup happens out-of-band.
      push('Reloaded. View entry in /admin/log', 'success');
      setStatus({ kind: 'success' });

      // EXECUTION_PLAN §4.4 ≤1s window for the audit-log read.
      setTimeout(() => {
        void fetchLatestReloadLog(slug).then((entry) => {
          setStatus({ kind: 'success', correlation_id: correlationOf(entry) ?? undefined });
        });
      }, 1000);
    } catch (err) {
      if (err instanceof RuntimeError) {
        const msg = err.problem.title + (err.problem.detail ? `: ${err.problem.detail}` : '');
        push(msg, 'error');
        setStatus({ kind: 'error', message: msg });
      } else {
        push('Unknown error', 'error');
        setStatus({ kind: 'error', message: 'Unknown error' });
      }
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button onClick={click} disabled={status.kind === 'busy'} variant="filled" size="sm">
        {status.kind === 'busy' ? 'Reloading…' : 'Reload pack'}
      </Button>
      {status.kind === 'success' && (
        <span
          data-testid="reload-status-success"
          className="flex items-center gap-2 text-[12.5px]"
          style={{ color: 'var(--md-on-surface-variant)' }}
        >
          <span>Reloaded.</span>
          <Link
            href={adminLogHrefFor(status.correlation_id)}
            className="underline"
            style={{ color: 'var(--md-primary)' }}
          >
            View entry in /admin/log
          </Link>
          {status.kind === 'success' && !status.correlation_id && (
            <span
              data-testid="reload-status-log-pending"
              className="font-mono text-[11px]"
              style={{ color: 'var(--md-outline)' }}
            >
              (log entry pending)
            </span>
          )}
        </span>
      )}
      {status.kind === 'error' && (
        <span
          data-testid="reload-status-error"
          className="text-[12.5px]"
          style={{ color: 'var(--md-error)' }}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
