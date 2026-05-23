// SPDX-License-Identifier: Apache-2.0
/**
 * /packs/:slug/prompts — read-only syntax-highlighted prompts viewer
 * (FR-PACK-03). NO form controls. The data source is the pack filesystem;
 * the runtime exposes prompts via GET /admin/packs/:slug/prompts and there
 * is NO POST / PATCH counterpart.
 */

import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { CodeBlock } from '../../../components/ui/code-block';
import { EmptyState, ErrorState, ForbiddenState } from '../../../components/ui/empty-state';

interface PageProps {
  params: { slug: string };
}

interface PromptDoc {
  name: string;
  path: string;
  body: string;
  language?: 'md' | 'plain';
}

async function loadPrompts(slug: string): Promise<{ docs: PromptDoc[] | null; error: RuntimeError | null }> {
  try {
    const docs = await runtimeFetch<PromptDoc[]>(`/admin/packs/${encodeURIComponent(slug)}/prompts`, {
      pack: slug,
    });
    return { docs, error: null };
  } catch (err) {
    if (err instanceof RuntimeError) return { docs: null, error: err };
    throw err;
  }
}

export default async function PromptsPage({ params }: PageProps) {
  const { docs, error } = await loadPrompts(params.slug);

  if (error?.status === 403) return <ForbiddenState />;
  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{params.slug} · prompts</h1>
        <ErrorState problem={error.problem} />
      </section>
    );
  }
  if (!docs || docs.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{params.slug} · prompts</h1>
        <EmptyState
          title="No prompts in this pack"
          description="Prompts live under packs/{slug}/prompts/. Add files there and reload the pack."
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{params.slug} · prompts</h1>
        <p className="text-xs text-muted">
          Read-only. Edit prompts in the pack repo; the runtime has no mutation endpoint by design (EX-01).
        </p>
      </header>
      <div className="space-y-3">
        {docs.map((doc) => (
          <Card key={doc.path}>
            <CardHeader>
              <CardTitle>{doc.name}</CardTitle>
              <p className="font-mono text-xs text-muted">{doc.path}</p>
            </CardHeader>
            <CardContent>
              <CodeBlock language={doc.language ?? 'md'}>{doc.body}</CodeBlock>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
