// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * ReloadPackButton — POST /admin/packs/:slug/reload (FR-PACK-02).
 * Logged in admin log within 1s (runtime contract); UI shows toast on result.
 */

import { useState } from 'react';
import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import { useSession } from '../../../components/auth-provider';
import { canManagePack } from '@/lib/api/types';
import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toast';

interface Props {
  slug: string;
}

export function ReloadPackButton({ slug }: Props) {
  const { user } = useSession();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  if (!canManagePack(user, slug)) return null;

  const click = async () => {
    setBusy(true);
    try {
      await runtimeFetch(`/admin/packs/${encodeURIComponent(slug)}/reload`, {
        method: 'POST',
        pack: slug,
      });
      push(`Pack ${slug} reloaded`, 'success');
    } catch (err) {
      if (err instanceof RuntimeError) {
        push(err.problem.title + (err.problem.detail ? `: ${err.problem.detail}` : ''), 'error');
      } else {
        push('Unknown error', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={click} disabled={busy} variant="primary" size="sm">
      {busy ? 'Reloading…' : 'Reload pack'}
    </Button>
  );
}
