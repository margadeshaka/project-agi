// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * FormFromSchema — recursive JSON-Schema → React form renderer (FR-TOOL-02).
 *
 * Hand-rolled (no Ajv, no react-jsonschema-form) to keep the UI bundle under
 * the 250 KB gzipped budget and to stay M3-themed. Supports the subset of
 * draft 2020-12 / OpenAPI 3.1 that the auto-MCP bundle actually emits:
 *
 *   - string (with format: uri | email | date-time honoured)
 *   - number / integer  → numeric input, coerced
 *   - boolean           → tri-state select (—/true/false)
 *   - enum              → Select; multi-select for array<enum>
 *   - array<primitive>  → repeating input rows with +/-
 *   - object            → collapsible fieldset, recurses
 *   - oneOf w/ discriminator → segmented-control variant picker + sub-form
 *   - oneOf w/o discriminator → JSON textarea + parse validation (fallback,
 *                               explicitly approved as the v1 escape hatch)
 *
 * Required keys are marked with `*` in the label and a `data-required="true"`
 * attribute on the field wrapper so a11y / lint scripts can assert on them.
 *
 * The component is pure: given `value`, render — never fetches.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { JsonSchema } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { SegmentedButton } from './ui/segmented-button';

export interface FormFromSchemaProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}

/* ---------- helpers ---------- */

function schemaType(s: JsonSchema): string | undefined {
  return Array.isArray(s.type) ? s.type[0] : s.type;
}

function coercePrimitive(raw: string, sch: JsonSchema): unknown {
  const t = schemaType(sch);
  if (raw === '') return undefined;
  if (t === 'integer') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (t === 'number') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (t === 'boolean') return raw === 'true';
  return raw;
}

function inputTypeFor(sch: JsonSchema): string {
  const t = schemaType(sch);
  if (t === 'integer' || t === 'number') return 'number';
  if (sch.format === 'email') return 'email';
  if (sch.format === 'uri') return 'url';
  if (sch.format === 'date-time') return 'datetime-local';
  return 'text';
}

/**
 * For a oneOf-with-discriminator branch, return the constant value that tags
 * this branch. The branch's `properties[propertyName]` is expected to carry
 * either `const: "..."` or `enum: ["..."]` (single value).
 */
function discriminatorValue(branch: JsonSchema, propertyName: string): string | undefined {
  const propSchema = branch.properties?.[propertyName];
  if (!propSchema) return undefined;
  if (propSchema.const !== undefined) return String(propSchema.const);
  if (Array.isArray(propSchema.enum) && propSchema.enum.length === 1) {
    return String(propSchema.enum[0]);
  }
  return undefined;
}

function branchLabel(branch: JsonSchema, fallback: string): string {
  return branch.title ?? fallback;
}

/* ---------- public component ---------- */

export function FormFromSchema({
  schema,
  value,
  onChange,
  disabled,
}: FormFromSchemaProps): JSX.Element {
  // The root schema is expected to be type:object (the tool's input_schema).
  // We render its properties; nested objects recurse via <ObjectField>.
  return (
    <ObjectField
      name=""
      schema={schema}
      value={value}
      onChange={(next) =>
        onChange(
          next && typeof next === 'object' && !Array.isArray(next)
            ? (next as Record<string, unknown>)
            : {},
        )
      }
      disabled={disabled}
      depth={0}
    />
  );
}

/* ---------- internal field renderers ---------- */

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  required?: boolean;
  disabled?: boolean;
  depth: number;
}

function FieldLabel({
  htmlFor,
  name,
  required,
  description,
}: {
  htmlFor?: string;
  name: string;
  required?: boolean;
  description?: string;
}) {
  if (!name) return null;
  return (
    <div className="space-y-0.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--md-on-surface)]">
        {name}
        {required && (
          <span aria-hidden className="ml-1 text-[var(--md-error)]">
            *
          </span>
        )}
      </label>
      {description && (
        <p className="text-xs text-[var(--md-on-surface-variant)]">{description}</p>
      )}
    </div>
  );
}

function FieldWrapper({
  required,
  children,
}: {
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1" data-required={required ? 'true' : undefined}>
      {children}
    </div>
  );
}

function PrimitiveField({ name, schema, value, onChange, required, disabled }: FieldProps) {
  const id = `field-${name || 'root'}`;
  const t = schemaType(schema);

  // enum → Select
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return (
      <FieldWrapper required={required}>
        <FieldLabel htmlFor={id} name={name} required={required} description={schema.description} />
        <Select
          id={id}
          value={value === undefined || value === null ? '' : String(value)}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(coercePrimitive(e.currentTarget.value, schema))}
        >
          <option value="">— select —</option>
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </Select>
      </FieldWrapper>
    );
  }

  // boolean → tri-state select
  if (t === 'boolean') {
    const v = value === undefined || value === null ? '' : String(value);
    return (
      <FieldWrapper required={required}>
        <FieldLabel htmlFor={id} name={name} required={required} description={schema.description} />
        <Select
          id={id}
          value={v}
          required={required}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            onChange(raw === '' ? undefined : raw === 'true');
          }}
        >
          <option value="">— select —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      </FieldWrapper>
    );
  }

  // string / number / integer → Input
  return (
    <FieldWrapper required={required}>
      <FieldLabel htmlFor={id} name={name} required={required} description={schema.description} />
      <Input
        id={id}
        type={inputTypeFor(schema)}
        value={value === undefined || value === null ? '' : String(value)}
        required={required}
        disabled={disabled}
        pattern={typeof schema.pattern === 'string' ? schema.pattern : undefined}
        minLength={typeof schema.minLength === 'number' ? schema.minLength : undefined}
        maxLength={typeof schema.maxLength === 'number' ? schema.maxLength : undefined}
        min={typeof schema.minimum === 'number' ? schema.minimum : undefined}
        max={typeof schema.maximum === 'number' ? schema.maximum : undefined}
        placeholder={schema.default !== undefined ? String(schema.default) : undefined}
        onChange={(e) => onChange(coercePrimitive(e.currentTarget.value, schema))}
      />
    </FieldWrapper>
  );
}

/** Multi-select for array<enum>. */
function MultiEnumField({ name, schema, value, onChange, required, disabled }: FieldProps) {
  const id = `field-${name}`;
  const items = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? {};
  const opts = (items.enum ?? []) as unknown[];
  const current = Array.isArray(value) ? value.map(String) : [];
  return (
    <FieldWrapper required={required}>
      <FieldLabel htmlFor={id} name={name} required={required} description={schema.description} />
      <select
        id={id}
        multiple
        disabled={disabled}
        value={current}
        onChange={(e) => {
          const next = Array.from(e.currentTarget.selectedOptions).map((o) => o.value);
          onChange(next);
        }}
        className={cn(
          'flex min-h-[5.5rem] w-full rounded-md border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-3 py-1 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {opts.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

/** array<primitive> with add/remove rows. */
function ArrayPrimitiveField({ name, schema, value, onChange, required, disabled }: FieldProps) {
  const items = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? {};
  const list: unknown[] = Array.isArray(value) ? [...value] : [];

  const setAt = (idx: number, v: unknown) => {
    const next = [...list];
    next[idx] = v;
    onChange(next);
  };
  const removeAt = (idx: number) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(next);
  };
  const append = () => {
    const t = schemaType(items);
    const empty: unknown = t === 'boolean' ? false : t === 'number' || t === 'integer' ? 0 : '';
    onChange([...list, empty]);
  };

  return (
    <FieldWrapper required={required}>
      <FieldLabel name={name} required={required} description={schema.description} />
      <div className="space-y-2 rounded-md border border-[var(--md-outline-variant)] p-2">
        {list.length === 0 && (
          <p className="text-xs text-[var(--md-on-surface-variant)]">No items.</p>
        )}
        {list.map((entry, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2"
            data-testid={`array-row-${name}-${idx}`}
          >
            <div className="flex-1">
              <PrimitiveField
                name={`${name}[${idx}]`}
                schema={{ ...items, description: undefined }}
                value={entry}
                onChange={(v) => setAt(idx, v)}
                required={false}
                disabled={disabled}
                depth={0}
              />
            </div>
            <Button
              type="button"
              variant="text"
              size="sm"
              onClick={() => removeAt(idx)}
              disabled={disabled}
              aria-label={`Remove ${name} row ${idx + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outlined"
          size="sm"
          onClick={append}
          disabled={disabled}
          aria-label={`Add ${name} row`}
        >
          + Add item
        </Button>
      </div>
    </FieldWrapper>
  );
}

/** Nested object → collapsible fieldset; recurses by name. */
function ObjectField({ name, schema, value, onChange, required, disabled, depth }: FieldProps) {
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const entries = Object.entries(properties);
  const isRoot = depth === 0;
  const [open, setOpen] = useState(true);

  const obj = (value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {});

  const setField = (k: string, v: unknown) => {
    const next: Record<string, unknown> = { ...obj };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };

  const body = (
    <div className={cn('space-y-3', !isRoot && 'pl-3 border-l border-[var(--md-outline-variant)]')}>
      {entries.length === 0 && (
        <p className="text-xs text-[var(--md-on-surface-variant)]">No fields.</p>
      )}
      {entries.map(([k, sub]) => (
        <AnyField
          key={k}
          name={k}
          schema={sub}
          value={obj[k]}
          onChange={(v) => setField(k, v)}
          required={requiredSet.has(k)}
          disabled={disabled}
          depth={depth + 1}
        />
      ))}
    </div>
  );

  if (isRoot) return body;

  return (
    <FieldWrapper required={required}>
      <fieldset className="rounded-md border border-[var(--md-outline-variant)] p-3">
        <legend className="px-1 text-xs font-medium text-[var(--md-on-surface)]">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]"
            aria-expanded={open}
            aria-controls={`fs-${name}`}
          >
            <span aria-hidden>{open ? '▾' : '▸'}</span>
            <span>
              {name}
              {required && (
                <span aria-hidden className="ml-1 text-[var(--md-error)]">
                  *
                </span>
              )}
            </span>
          </button>
          {schema.description && (
            <span className="ml-2 text-[var(--md-on-surface-variant)]">— {schema.description}</span>
          )}
        </legend>
        {open && <div id={`fs-${name}`}>{body}</div>}
      </fieldset>
    </FieldWrapper>
  );
}

/** oneOf with a discriminator → segmented control + sub-form for the branch. */
function OneOfDiscriminatedField({
  name,
  schema,
  value,
  onChange,
  required,
  disabled,
  depth,
}: FieldProps) {
  const branches = useMemo(() => schema.oneOf ?? [], [schema.oneOf]);
  const propertyName = schema.discriminator?.propertyName ?? 'kind';

  const tags: string[] = useMemo(
    () =>
      branches.map(
        (b, i) => discriminatorValue(b, propertyName) ?? `variant-${i}`,
      ),
    [branches, propertyName],
  );

  const obj = (value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {});
  const currentTag = (typeof obj[propertyName] === 'string'
    ? (obj[propertyName] as string)
    : tags[0]) ?? '';

  const activeBranch =
    branches.find((b, i) => (discriminatorValue(b, propertyName) ?? `variant-${i}`) === currentTag) ??
    branches[0];

  const switchTo = (next: string) => {
    onChange({ ...obj, [propertyName]: next });
  };

  return (
    <FieldWrapper required={required}>
      <FieldLabel name={name} required={required} description={schema.description} />
      <SegmentedButton
        value={currentTag}
        options={tags.map((tag, i) => ({
          value: tag,
          label: branchLabel(branches[i], tag),
        }))}
        onChange={switchTo}
        ariaLabel={`${name || 'variant'} selector`}
      />
      {activeBranch && (
        <div className="mt-2">
          <ObjectField
            name={name}
            // Strip the discriminator property out — we manage it via the
            // segmented control to avoid the user typing the wrong tag.
            schema={{
              ...activeBranch,
              properties: Object.fromEntries(
                Object.entries(activeBranch.properties ?? {}).filter(
                  ([k]) => k !== propertyName,
                ),
              ),
              required: (activeBranch.required ?? []).filter((k) => k !== propertyName),
            }}
            value={obj}
            onChange={(next) => {
              const merged =
                next && typeof next === 'object' && !Array.isArray(next)
                  ? (next as Record<string, unknown>)
                  : {};
              onChange({ ...merged, [propertyName]: currentTag });
            }}
            required={required}
            disabled={disabled}
            depth={depth}
          />
        </div>
      )}
    </FieldWrapper>
  );
}

/** oneOf w/o discriminator → JSON textarea fallback with parse validation. */
function OneOfFreeformField({ name, schema, value, onChange, required, disabled }: FieldProps) {
  const initial = useMemo(
    () => (value === undefined ? '' : JSON.stringify(value, null, 2)),
    // we deliberately only seed once; the textarea is the source of truth
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [text, setText] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(next);
      setError(null);
      onChange(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const id = `field-${name || 'root'}`;
  return (
    <FieldWrapper required={required}>
      <FieldLabel htmlFor={id} name={name} required={required} description={schema.description} />
      <div className="flex items-center gap-2">
        <Badge tone="warning" aria-label="free-form variant">
          free-form: validate manually
        </Badge>
      </div>
      <textarea
        id={id}
        value={text}
        disabled={disabled}
        rows={6}
        aria-invalid={error ? 'true' : undefined}
        onChange={(e) => handleChange(e.currentTarget.value)}
        className={cn(
          'w-full rounded-md border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-3 py-2 font-mono text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      {error && (
        <p role="alert" className="text-xs text-[var(--md-error)]">
          JSON parse error: {error}
        </p>
      )}
    </FieldWrapper>
  );
}

/** Pick the right renderer for any field schema. */
function AnyField(props: FieldProps): JSX.Element {
  const { schema } = props;
  const t = schemaType(schema);

  // oneOf takes precedence — most expressive.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    if (schema.discriminator && typeof schema.discriminator.propertyName === 'string') {
      return <OneOfDiscriminatedField {...props} />;
    }
    return <OneOfFreeformField {...props} />;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return <PrimitiveField {...props} />;
  }

  if (t === 'array') {
    const items = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? {};
    if (Array.isArray(items.enum) && items.enum.length > 0) {
      return <MultiEnumField {...props} />;
    }
    const it = schemaType(items);
    if (it === 'object' || Array.isArray(items.oneOf)) {
      // array-of-object is out of scope for v1 — fall back to JSON textarea.
      return <OneOfFreeformField {...props} />;
    }
    return <ArrayPrimitiveField {...props} />;
  }

  if (t === 'object' || schema.properties) {
    return <ObjectField {...props} />;
  }

  return <PrimitiveField {...props} />;
}
