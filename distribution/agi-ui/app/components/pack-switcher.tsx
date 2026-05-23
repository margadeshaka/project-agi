// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * PackSwitcher — top-bar control to set the active pack (cookie-backed).
 * Setting the pack writes COOKIES.pack and reloads so that server-rendered
 * pages pick up the new X-Pack on their next runtimeFetch call.
 *
 * Pack-scoped operators see a fixed label (their pack); admins see a select.
 */

import { useEffect, useState } from 'react';
import { setActivePack, readActivePack } from './runtime-fetch';
import { useSession } from './auth-provider';
import { isAdmin, operatorSlugs } from '@/lib/api/types';
import { Select } from './ui/select';

interface PackSwitcherProps {
  /** Packs the runtime says the user can see (already scope-filtered). */
  available: { slug: string; display_name: string }[];
}

export function PackSwitcher({ available }: PackSwitcherProps) {
  const { user } = useSession();
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    setActive(readActivePack() ?? '');
  }, []);

  const admin = isAdmin(user);
  const ownSlugs = operatorSlugs(user);

  // Operator with exactly one pack: fixed label.
  if (!admin && ownSlugs.length === 1) {
    return (
      <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">
        pack: <strong className="text-foreground">{ownSlugs[0]}</strong>
      </span>
    );
  }

  if (available.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="sr-only">Active pack</span>
      pack
      <Select
        value={active}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setActivePack(next || null);
          setActive(next);
          if (typeof window !== 'undefined') window.location.reload();
        }}
        className="h-8 w-44"
        aria-label="Active pack"
      >
        <option value="">— none —</option>
        {available.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.display_name}
          </option>
        ))}
      </Select>
    </label>
  );
}
