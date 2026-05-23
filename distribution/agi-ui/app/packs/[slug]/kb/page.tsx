// SPDX-License-Identifier: Apache-2.0
/**
 * /packs/:slug/kb — knowledge-base browser (FR-KB-01..04).
 */

import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import type { KbArticle } from '@/lib/api/types';
import { ErrorState, ForbiddenState } from '../../../components/ui/empty-state';
import { KbBrowser } from './kb-browser';

interface PageProps {
  params: { slug: string };
}

async function loadArticles(slug: string): Promise<{ items: KbArticle[] | null; error: RuntimeError | null }> {
  try {
    const items = await runtimeFetch<KbArticle[]>(`/kb?pack=${encodeURIComponent(slug)}`, {
      pack: slug,
    });
    return { items, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { items: null, error: err };
    throw err;
  }
}

export default async function KbPage({ params }: PageProps) {
  const { items, error } = await loadArticles(params.slug);
  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{params.slug} · KB</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  return <KbBrowser slug={params.slug} initialArticles={items ?? []} />;
}
