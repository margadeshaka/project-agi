// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * TestInvokePanel — schema-driven form for POST /tools/:name (FR-TOOL-03).
 *
 * Implementation note: we render the JSON Schema directly rather than
 * pulling json-schema-to-zod (~30 KB). For v1, the schemas in the auto-MCP
 * bundle are flat primitives + simple objects, so a hand-rolled renderer
 * suffices. When the schemas need deep nesting (oneOf, allOf, recursive
 * refs), swap this for a proper schema-form lib.
 *
 * FR-TOOL-03 AC: required fields validated client-side; side-effecting
 *                tools require an explicit confirm step; correlation_id is
 *                clickable to /audit/:cid; errors shown as problem-details.
 * FR-TOOL-04: dry-run toggle for write tools with dry_run_supported.
 */

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import type { JsonSchema, ProblemDetails, ToolDetail, ToolInvokeResult } from '@/lib/api/types';
import { runtimeFetch, RuntimeError } from '../../components/runtime-fetch';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Dialog } from '../../components/ui/dialog';
import { CodeBlock } from '../../components/ui/code-block';

interface Props {
  tool: ToolDetail;
}

type FieldValue = string | number | boolean | null;

function coerce(value: string, schema: JsonSchema): FieldValue {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === 'integer') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (t === 'number') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  if (t === 'boolean') return value === 'true';
  return value || null;
}

function FieldInput({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `field-${name}`;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (schema.enum && Array.isArray(schema.enum)) {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs font-medium">
          {name}
          {required && <span className="ml-1 text-danger">*</span>}
        </label>
        <Select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)} required={required}>
          <option value="">— select —</option>
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </Select>
        {schema.description && <p className="text-xs text-muted">{schema.description}</p>}
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs font-medium">
          {name}
          {required && <span className="ml-1 text-danger">*</span>}
        </label>
        <Select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)} required={required}>
          <option value="">— select —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
        {schema.description && <p className="text-xs text-muted">{schema.description}</p>}
      </div>
    );
  }

  const inputType =
    type === 'integer' || type === 'number'
      ? 'number'
      : schema.format === 'email'
        ? 'email'
        : schema.format === 'uri'
          ? 'url'
          : 'text';

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {name}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      <Input
        id={id}
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        required={required}
        pattern={schema.pattern}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        min={schema.minimum}
        max={schema.maximum}
        placeholder={schema.default !== undefined ? String(schema.default) : undefined}
      />
      {schema.description && <p className="text-xs text-muted">{schema.description}</p>}
    </div>
  );
}

export function TestInvokePanel({ tool }: Props) {
  const properties = tool.input_schema.properties ?? {};
  const required = new Set(tool.input_schema.required ?? []);
  const fields = Object.entries(properties);

  const initialValues = useMemo(() => {
    const init: Record<string, string> = {};
    for (const [k, sch] of fields) {
      init[k] = sch.default !== undefined ? String(sch.default) : '';
    }
    return init;
  }, [fields]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ToolInvokeResult | null>(null);
  const [error, setError] = useState<ProblemDetails | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Dry-run defaults ON for write tools (FR-TOOL-04 AC).
  const [dryRun, setDryRun] = useState(tool.side_effect === 'write' && tool.dry_run_supported);

  const sideEffecting = tool.side_effect === 'write';

  const submitForReal = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, sch] of fields) {
        const raw = values[k] ?? '';
        if (raw === '' && !required.has(k)) continue;
        body[k] = coerce(raw, sch);
      }
      const headers: Record<string, string> = {};
      if (dryRun && tool.dry_run_supported) headers['X-Dry-Run'] = '1';
      const res = await runtimeFetch<ToolInvokeResult>(`/tools/${encodeURIComponent(tool.name)}`, {
        method: 'POST',
        json: body,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test invoke</CardTitle>
        {sideEffecting && (
          <p className="text-xs text-warning">
            This is a write tool — confirm step required unless dry-run is on.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
          {fields.length === 0 && (
            <p className="text-xs text-muted">This tool takes no arguments.</p>
          )}
          {fields.map(([name, schema]) => (
            <FieldInput
              key={name}
              name={name}
              schema={schema}
              required={required.has(name)}
              value={values[name] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
            />
          ))}

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

          <div className="flex items-center gap-2">
            <Button type="submit" variant={dryRun || !sideEffecting ? 'filled' : 'danger'} disabled={submitting}>
              {submitting ? 'Invoking…' : dryRun ? 'Dry-run invoke' : 'Invoke'}
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
                className="font-mono text-accent underline"
              >
                {result.correlation_id}
              </Link>
            </p>
            <CodeBlock language="json">{JSON.stringify(result.result ?? null, null, 2)}</CodeBlock>
          </div>
        )}

        {error && (
          <div className="mt-4 space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3">
            <h3 className="text-sm font-semibold text-danger">{error.title}</h3>
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
