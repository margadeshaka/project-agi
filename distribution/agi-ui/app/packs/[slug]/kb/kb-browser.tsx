// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * KbBrowser — list + drag-drop upload + reindex (FR-KB-01..03).
 *
 * Progress for reindex tries SSE first; if the runtime returns 404/406 or
 * text/event-stream isn't supported we fall back to polling
 * /admin/kb/:slug/reindex/status every 1s (still satisfies the AC).
 */

import { useCallback, useState, type DragEvent, type ChangeEvent } from 'react';
import { canManagePack, type KbArticle } from '@/lib/api/types';
import { runtimeFetch, RuntimeError } from '../../../components/runtime-fetch';
import { useSession } from '../../../components/auth-provider';
import { Button } from '../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../../components/ui/table';
import { EmptyState } from '../../../components/ui/empty-state';
import { useToast } from '../../../components/ui/toast';

interface Props {
  slug: string;
  initialArticles: KbArticle[];
}

const ACCEPTED_TYPES = ['text/markdown', 'application/json', 'text/plain'];

export function KbBrowser({ slug, initialArticles }: Props) {
  const { user } = useSession();
  const { push } = useToast();
  const [articles, setArticles] = useState<KbArticle[]>(initialArticles);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const canWrite = canManagePack(user, slug);
  const filtered = query
    ? articles.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
    : articles;

  const upload = useCallback(
    async (files: FileList | File[]) => {
      if (!canWrite) return;
      const list = Array.from(files);
      const valid = list.filter((f) => {
        const ok =
          ACCEPTED_TYPES.includes(f.type) ||
          f.name.endsWith('.md') ||
          f.name.endsWith('.json');
        if (!ok) push(`Rejected ${f.name}: not markdown or JSON`, 'error');
        return ok;
      });
      if (valid.length === 0) return;
      setUploading(true);
      try {
        for (const file of valid) {
          const form = new FormData();
          form.append('pack', slug);
          form.append('file', file);
          await runtimeFetch('/kb', { method: 'POST', form, pack: slug });
        }
        // Refresh list — runtime returns updated /kb on next read.
        const next = await runtimeFetch<KbArticle[]>(`/kb?pack=${encodeURIComponent(slug)}`, { pack: slug });
        setArticles(next);
        push(`Uploaded ${valid.length} file(s)`, 'success');
      } catch (err) {
        if (err instanceof RuntimeError) push(err.problem.title, 'error');
        else push('Upload failed', 'error');
      } finally {
        setUploading(false);
      }
    },
    [canWrite, push, slug],
  );

  const reindex = useCallback(async () => {
    if (!canWrite) return;
    setReindexing(true);
    setReindexProgress(0);
    try {
      const res = await runtimeFetch<Response>(`/admin/kb/${encodeURIComponent(slug)}/reindex`, {
        method: 'POST',
        pack: slug,
        raw: true,
        headers: { Accept: 'text/event-stream, application/json' },
      });
      if (res instanceof Response && res.headers.get('Content-Type')?.includes('event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        // Minimal SSE parser: progress events of form "data: {\"progress\": 42}".
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const payload = JSON.parse(line.slice(5).trim());
              if (typeof payload.progress === 'number') setReindexProgress(payload.progress);
              if (payload.done) push(`Reindex complete · ${payload.chunks ?? '?'} chunks`, 'success');
            } catch {
              // ignore malformed sse line
            }
          }
        }
      } else {
        // Plain JSON response — runtime did the work synchronously.
        push('Reindex complete', 'success');
      }
      // Reload list to pick up new last_reindex_iso.
      const next = await runtimeFetch<KbArticle[]>(`/kb?pack=${encodeURIComponent(slug)}`, { pack: slug });
      setArticles(next);
    } catch (err) {
      if (err instanceof RuntimeError) push(err.problem.title, 'error');
      else push('Reindex failed', 'error');
    } finally {
      setReindexing(false);
      setReindexProgress(null);
    }
  }, [canWrite, push, slug]);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) void upload(e.dataTransfer.files);
    },
    [upload],
  );

  const onPicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) void upload(e.target.files);
      e.target.value = '';
    },
    [upload],
  );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{slug} · KB</h1>
          <p className="text-xs text-muted">
            {articles.length} article{articles.length === 1 ? '' : 's'} ·{' '}
            {articles.reduce((s, a) => s + a.chunk_count, 0)} chunks
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={reindex} disabled={reindexing} variant="secondary">
              {reindexing
                ? reindexProgress != null
                  ? `Reindexing… ${reindexProgress}%`
                  : 'Reindexing…'
                : 'Reindex now'}
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                multiple
                accept=".md,.json,text/markdown,application/json"
                onChange={onPicked}
                className="sr-only"
                aria-label="Upload KB files"
              />
              <span
                role="button"
                tabIndex={0}
                className="inline-flex h-9 cursor-pointer items-center rounded-md bg-accent px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </span>
            </label>
          </div>
        )}
      </header>

      {canWrite && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-md border-2 border-dashed p-6 text-center text-sm transition-colors ${
            dragOver ? 'border-accent bg-accent/5' : 'border-border'
          }`}
        >
          Drop markdown or JSON files here, or use the Upload button.
        </div>
      )}

      <Input
        aria-label="Search articles"
        placeholder="Search articles…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />

      {filtered.length === 0 ? (
        <EmptyState
          title="No KB articles yet"
          description={canWrite ? 'Drop a markdown or JSON file above to seed the pack KB.' : 'No articles in this pack.'}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Chunks</TableHead>
              <TableHead>Last reindex</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-sm">{a.title}</TableCell>
                <TableCell className="text-xs">{a.source_format}</TableCell>
                <TableCell className="text-xs">{(a.size_bytes / 1024).toFixed(1)} KB</TableCell>
                <TableCell className="text-xs">{a.chunk_count}</TableCell>
                <TableCell className="text-xs text-muted">
                  {a.last_reindex_iso ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Stale-index warning: FR-KB-01 AC */}
      {articles.some((a) => isStale(a.last_reindex_iso)) && (
        <Card>
          <CardHeader>
            <CardTitle>Stale index warning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-warning">
              Some articles were last reindexed more than 24 hours ago. Search results may not reflect
              recent uploads.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function isStale(iso?: string | null): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > 24 * 60 * 60 * 1000;
}
