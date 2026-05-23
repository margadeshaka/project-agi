// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Legacy redirect — overview is now the index route at `/packs/[slug]`.
 */
export default function LegacyOverviewRedirect() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  useEffect(() => {
    if (params?.slug) router.replace(`/packs/${params.slug}`);
  }, [params, router]);
  return null;
}
