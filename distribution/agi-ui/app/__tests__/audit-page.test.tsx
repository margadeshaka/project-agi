// SPDX-License-Identifier: Apache-2.0
/**
 * /audit page — TanStack Table + react-virtual + CSV export.
 *
 * What's covered:
 *  1. `renders_visible_rows_in_table` — the fixture's events all land in
 *     the virtual viewport (stubbed to 800px so the overscan window
 *     keeps everything mounted in jsdom).
 *  2. `filter_by_event_type` — clicking the `tool_call` chip shrinks the
 *     row set to only that event type.
 *  3. `csv_export_disabled_when_empty` — pure-function check: the
 *     `<CsvExportButton>` disables itself when its `rows` prop is
 *     empty.
 *  4. `csv_export_serialises_rows` — the pure `toCsv` helper produces
 *     the documented column order, RFC-4180 quoting and CRLF row
 *     terminators.
 *
 * jsdom + virtualisation: as in `tool-catalogue.test.tsx`, the
 * virtualiser reads layout primitives from the scroll container; we
 * stub `getBoundingClientRect` + `clientHeight` so the overscan window
 * keeps the entire fixture mounted.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AuditScreen from '../audit/page';
import {
  CsvExportButton,
  escapeCsvCell,
  toCsv,
  type TrailRowForExport,
} from '../audit/csv-export';

// next/link in jsdom resolves to a regular anchor — that's fine for
// click-handler assertions. We wrap it to give a stable shape.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// The audit page reads the bundled mock JSON via `mock/data`. We don't
// stub it — the fixture is small enough that the real numbers are
// stable, and assertions reference the live counts via the
// "N of M events" meta text.

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 1200,
  });
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 1200,
      width: 1200,
      height: 1200,
      toJSON: () => ({}),
    } as DOMRect;
  };
  if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
    (window as any).requestAnimationFrame = (cb: (t: number) => void) => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number;
    };
  }
});

afterEach(() => {
  cleanup();
});

describe('AuditScreen', () => {
  it('renders_visible_rows_in_table', () => {
    render(<AuditScreen />);
    // At least one audit row must be visible — fixture is non-empty.
    const rows = screen.getAllByTestId('audit-row');
    expect(rows.length).toBeGreaterThan(0);
    // Each visible row owns a correlation_id link with the canonical
    // /audit/<cid> href shape.
    const firstLink = rows[0].querySelector(
      '[data-testid="audit-row-link"]',
    ) as HTMLAnchorElement;
    expect(firstLink).not.toBeNull();
    expect(firstLink.getAttribute('href')).toMatch(/^\/audit\//);
  });

  it('filter_by_event_type', () => {
    render(<AuditScreen />);
    const before = screen.getAllByTestId('audit-row').length;
    // Click the `tool_call` chip in the event-type chip row.
    const chip = screen.getByRole('checkbox', { name: 'tool_call' });
    fireEvent.click(chip);
    const after = screen.getAllByTestId('audit-row');
    // Every remaining row's event-type cell renders `tool_call`.
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(before);
    for (const r of after) {
      expect(r.textContent).toMatch(/tool_call/);
    }
  });

  it('csv_export_disabled_when_empty', () => {
    render(<CsvExportButton rows={[]} />);
    const btn = screen.getByTestId('csv-export-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('csv_export_serialises_rows', () => {
    const rows: TrailRowForExport[] = [
      {
        timestamp_iso: '2026-05-22T13:11:09Z',
        event_type: 'tool_call',
        correlation_id: 'run-9af3a1',
        pack: 'support-demo',
        session_id: 'sess-XYZ',
        payload: { target: 'billing.adjust_charge', amount: -12.5 },
      },
      {
        timestamp_iso: '2026-05-22T13:11:08Z',
        event_type: 'llm_response',
        correlation_id: 'run-9af3a1',
        pack: 'support-demo',
        session_id: 'sess-XYZ',
        // Payload includes a comma + a literal quote — must be wrapped
        // and the quote doubled per RFC 4180 §2.5.
        payload: { content: 'a,b "c"' },
      },
    ];

    const csv = toCsv(rows);
    const lines = csv.split('\r\n');
    // header + 2 records + trailing empty (CRLF after last record).
    expect(lines.length).toBe(4);
    expect(lines[3]).toBe('');
    // Header is fixed and documented in CSV_COLUMNS.
    expect(lines[0]).toBe(
      'ts,event_type,correlation_id,pack_slug,session_id,payload_json',
    );
    // First record — payload JSON contains a comma so the whole cell is
    // wrapped in quotes; any embedded quote is escaped by doubling it.
    expect(lines[1]).toBe(
      '2026-05-22T13:11:09Z,tool_call,run-9af3a1,support-demo,sess-XYZ,"{""target"":""billing.adjust_charge"",""amount"":-12.5}"',
    );
    // Second record — quoted JSON with literal `"` and `,` doubled +
    // wrapped correctly.
    expect(lines[2]).toBe(
      '2026-05-22T13:11:08Z,llm_response,run-9af3a1,support-demo,sess-XYZ,"{""content"":""a,b \\""c\\""""}"',
    );
  });

  it('csv_escape_handles_quotes_commas_newlines', () => {
    // Sanity-check the cell escaper directly — these are the three
    // structural characters the spec calls out and they each force
    // wrapping.
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell('')).toBe('');
  });
});
