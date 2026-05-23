// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * CsvExportButton — client-only download button that serialises the
 * currently-visible audit rows to a CSV file (FR-TRAIL-03 AC: "Export
 * CSV"). The serialiser is exported separately as `toCsv` so the test
 * suite can exercise it without round-tripping through the DOM.
 *
 * Why hand-rolled (no papaparse / csv-parse):
 *  - The dataset for an in-memory export is bounded by what's on screen
 *    after filtering — at most low thousands of rows. RFC 4180 quoting
 *    is ~30 LOC; a dependency would be larger than the function it
 *    replaces and the bundle cost lands on every operator.
 *  - Avoiding the dep keeps the runtime supply chain identical to the
 *    band-1 SDK's "no parallel abstractions" rule (see CLAUDE.md
 *    "MCP-only tool plane" — same instinct applies to the UI).
 *
 * Quoting rules implemented (RFC 4180 §2):
 *  1. Each row terminated by CRLF.
 *  2. Fields containing comma, quote or CR/LF are wrapped in double
 *     quotes.
 *  3. A literal double-quote inside a quoted field is escaped by
 *     doubling it (`"` → `""`).
 *  4. Empty / undefined cells emit an empty field (no quoting).
 */

import { useCallback } from 'react';
import { Button } from '../components/ui/button';
import { Icon } from '../components/m3';

/** Minimal row shape consumed by the exporter. */
export interface TrailRowForExport {
  timestamp_iso: string;
  event_type: string;
  correlation_id: string;
  pack: string;
  session_id?: string | null;
  payload?: unknown;
}

interface Props {
  rows: TrailRowForExport[];
  filename?: string;
  className?: string;
}

/** Columns are emitted in this fixed order — matches the audit list spec. */
export const CSV_COLUMNS = [
  'ts',
  'event_type',
  'correlation_id',
  'pack_slug',
  'session_id',
  'payload_json',
] as const;

/**
 * Escape one cell per RFC 4180. Exported for the unit test — keeps the
 * predicate honest (a regression in escaping breaks regulator-facing
 * downloads).
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (s === '') return '';
  // Quote when the value contains structural characters.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Pure CSV serialiser — `[header, ...rows]` joined with CRLF as per RFC
 * 4180. Payloads are JSON-stringified before quoting; null payloads emit
 * an empty cell. Exported so the test suite can assert the wire format
 * directly.
 */
export function toCsv(rows: TrailRowForExport[]): string {
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.join(','));
  for (const r of rows) {
    const payloadJson =
      r.payload == null ? '' : JSON.stringify(r.payload);
    const cells = [
      r.timestamp_iso,
      r.event_type,
      r.correlation_id,
      r.pack,
      r.session_id ?? '',
      payloadJson,
    ].map(escapeCsvCell);
    lines.push(cells.join(','));
  }
  // Trailing CRLF terminates the final record (RFC 4180 §2.1 - optional
  // but most spreadsheets prefer it).
  return lines.join('\r\n') + '\r\n';
}

function defaultFilename(): string {
  // ISO with `:` flattened for filename safety on Windows.
  return `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
}

export function CsvExportButton({ rows, filename, className }: Props) {
  const disabled = rows.length === 0;

  const handleClick = useCallback(() => {
    if (disabled) return;
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? defaultFilename();
    // Some browsers (Safari) require the anchor to be in the document
    // for the download attribute to take effect.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, filename, disabled]);

  return (
    <Button
      type="button"
      variant="outlined"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      data-testid="csv-export-button"
      aria-label="Export CSV"
      className={className}
    >
      <Icon name="download" size={14} /> Export CSV
    </Button>
  );
}
