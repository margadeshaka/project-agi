// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * TestInvokePanel — schema-driven form for POST /tools/:name (FR-TOOL-03).
 *
 * The form rendering itself lives in `<FormFromSchema>` so it can be reused
 * by the pack tool-allow editor and any future "try-it-out" surfaces. This
 * file owns only the orchestration: dry-run toggle, side-effect confirmation,
 * submission, error/response rendering, and the "Copy as MCP call" affordance
 * (FR-TOOL-02 AC).
 *
 * FR-TOOL-03 AC: required fields validated client-side; side-effecting
 *                tools require an explicit confirm step; correlation_id is
 *                clickable to /audit/:cid; errors shown as problem-details.
 * FR-TOOL-04: dry-run toggle for write tools with dry_run_supported.
 * FR-TOOL-02: operators can copy the equivalent MCP JSON-RPC envelope to
 *             paste into mcp-cli / curl for off-console reproduction.
 */

import Link from 'next/link';
import { useCallback, useState, type FormEvent } from 'react';
import type { ProblemDetails, ToolDetail, ToolInvokeResult } from '@/lib/api/types';
import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import { FormFromSchema } from '../../components/form-from-schema';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Dialog } from '../../components/ui/dialog';
import { CodeBlock } from '../../components/ui/code-block';

interface Props {
  tool: ToolDetail;
}

/**
 * Strip empty / undefined values before sending. Required-field validation
 * is handled by the browser via the `required` attributes the schema renderer
 * already emits.
 */
function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const cleaned = value.map(pruneEmpty).filter((v) => v !== undefined);
    return cleaned;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = pruneEmpty(v);
      if (cleaned !== undefined && cleaned !== '') out[k] = cleaned;
    }
    return out;
  }
  if (value === '') return undefined;
  return value;
}

export function TestInvokePanel({ tool }: Props) {
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ToolInvokeResult | null>(null);
  const [error, setError] = useState<ProblemDetails | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Dry-run defaults ON for write tools (FR-TOOL-04 AC).
  const [dryRun, setDryRun] = useState(tool.side_effect === 'write' && tool.dry_run_supported);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const sideEffecting = tool.side_effect === 'write';

  const buildArgs = useCallback((): Record<string, unknown> => {
    const cleaned = pruneEmpty(formValue);
    return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
      ? (cleaned as Record<string, unknown>)
      : {};
  }, [formValue]);

  const submitForReal = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const headers: Record<string, string> = {};
      if (dryRun && tool.dry_run_supported) headers['X-Dry-Run'] = '1';
      const res = await runtimeFetch<ToolInvokeResult>(`/tools/${encodeURIComponent(tool.name)}`, {
        method: 'POST',
        json: buildArgs(),
        headers,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof RuntimeError) {
        setError(err.problem);
      } else {
        setError({ title: 'Unknown error', detail: String(err) });
      }
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sideEffecting && !dryRun) {
      setConfirmOpen(true);
      return;
    }
    void submitForReal();
  };

  const copyAsMcpCall = useCallback(async () => {
    const envelope = {
      tool: tool.name,
      arguments: buildArgs(),
      dry_run: dryRun && tool.dry_run_supported ? true : false,
    };
    const payload = JSON.stringify(envelope, null, 2);
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  }, [tool.name, tool.dry_run_supported, buildArgs, dryRun]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test invoke</CardTitle>
        {sideEffecting && (
          <p className="text-xs text-[var(--md-warning)]">
            This is a write tool — confirm step required unless dry-run is on.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
          <FormFromSchema
            schema={tool.input_schema}
            value={formValue}
            onChange={setFormValue}
            disabled={submitting}
          />

          {tool.dry_run_supported && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.currentTarget.checked)}
              />
              Dry-run (send X-Dry-Run: 1)
              {dryRun && <Badge tone="success">dry-run on</Badge>}
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant={dryRun || !sideEffecting ? 'filled' : 'danger'}
              disabled={submitting}
            >
              {submitting ? 'Invoking…' : dryRun ? 'Dry-run invoke' : 'Invoke'}
            </Button>
            <Button
              type="button"
              variant="outlined"
              onClick={() => void copyAsMcpCall()}
              aria-label="Copy as MCP call"
            >
              {copyState === 'copied'
                ? 'Copied'
                : copyState === 'error'
                  ? 'Copy failed'
                  : 'Copy as MCP call'}
            </Button>
          </div>
        </form>

        {result && (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold">Response</h3>
            <p className="text-xs">
              correlation_id:{' '}
              <Link
                href={`/audit/${encodeURIComponent(result.correlation_id)}`}
                className="font-mono text-[var(--md-primary)] underline"
              >
                {result.correlation_id}
              </Link>
            </p>
            <CodeBlock language="json">{JSON.stringify(result.result ?? null, null, 2)}</CodeBlock>
          </div>
        )}

        {error && (
          <div className="mt-4 space-y-2 rounded-md border border-[var(--md-error)]/30 bg-[var(--md-error-container)]/20 p-3">
            <h3 className="text-sm font-semibold text-[var(--md-error)]">{error.title}</h3>
            {error.detail && <p className="text-xs">{error.detail}</p>}
            <CodeBlock language="json">{JSON.stringify(error, null, 2)}</CodeBlock>
          </div>
        )}
      </CardContent>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm side-effecting invoke"
        footer={
          <>
            <Button variant="text" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void submitForReal()}>
              Run for real
            </Button>
          </>
        }
      >
        <p>
          You are about to invoke <code className="font-mono">{tool.name}</code> against the live runtime
          without dry-run. This will persist a side effect.
        </p>
      </Dialog>
    </Card>
  );
}
