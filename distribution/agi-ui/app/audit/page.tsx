// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * /audit — AI-Trail list (FR-TRAIL-01/02/03).
 *
 * What changed in wave 4c-B:
 *  - The page was a thin wrapper around `<AuditList />`, which renders a
 *    naive `.map` over the mock dataset. That doesn't scale to the
 *    multi-tenant fleet runtime — once `/trail` starts returning the
 *    real 24h window we'd be mounting thousands of DOM rows.
 *  - Replaced with a TanStack Table + react-virtual implementation that
 *    matches the wave-4b ToolCatalogue pattern: external filter state is
 *    mirrored into TanStack's column-filter pipeline, the virtualiser
 *    keeps only the visible window in the DOM (overscan 10), and the
 *    header is sticky.
 *  - The pack-scoped audit screen at `/packs/<slug>/audit` still uses
 *    the legacy `<AuditList />` — that surface is a separate redesign
 *    in a later wave and lives outside this file.
 *
 * Column order is fixed to match the §3.5 mock:
 *   timestamp · event_type · correlation_id · pack_slug · payload preview
 *
 * Keyboard nav:
 *  - ArrowDown / ArrowUp move focus to the next / previous row's
 *    correlation_id link.
 *  - Enter on the focused link follows it (browser default — anchors
 *    handle Enter for free).
 *
 * Row height is hard-coded at 48px; the virtualiser needs a deterministic
 * `estimateSize` and we want predictable scroll math for the keyboard
 * focus restore (`scrollToIndex` + rAF focus).
 */

import Link from 'next/link';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon, ScreenHead } from '../components/m3';
import { FilterChip } from '../components/ui/filter-chip';
import { Input } from '../components/ui/input';
import { DATA, type AuditEvent } from '../mock/data';
import { CsvExportButton, type TrailRowForExport } from './csv-export';

/**
 * Row shape used by the table. The mock `AuditEvent` carries `ts`/`date`
 * separately and a `cid` short alias — the runtime's eventual `/trail`
 * payload uses `timestamp_iso` + `correlation_id`. We project to that
 * shape here so the CSV exporter and the table share one row contract.
 */
interface AuditRow extends TrailRowForExport {
  timestamp_iso: string;
  event_type: string;
  correlation_id: string;
  pack: string;
  session_id: string;
  payload: Record<string, unknown> | null;
  note: string;
}

const ROW_HEIGHT = 48;
const OVERSCAN = 10;
const PAYLOAD_PREVIEW_MAX = 80;

const EVENT_TYPES = [
  'tool_call',
  'tool_result',
  'llm_request',
  'llm_response',
  'handoff',
  'error',
  'kb_search',
  'kb_hit',
] as const;

function packsFromData(events: AuditEvent[]): string[] {
  return Array.from(new Set(events.map((e) => e.pack))).sort();
}

/**
 * Project a mock `AuditEvent` to the unified row shape. The runtime
 * eventually returns this directly; for now we synthesise the missing
 * fields from the mock so the same shape is used both on screen and in
 * the CSV download.
 */
function toAuditRow(e: AuditEvent): AuditRow {
  // The mock keeps ts (time) and date separate — combine into ISO.
  const iso = `${e.date}T${e.ts}Z`;
  // The payload preview reflects whatever the runtime would put in the
  // event summary — for the mock we synthesise from target + note.
  const payload: Record<string, unknown> = {
    target: e.target,
    side_effect: e.side || null,
    note: e.note || null,
    actor: e.actor,
  };
  return {
    timestamp_iso: iso,
    event_type: e.event,
    correlation_id: e.cid,
    pack: e.pack,
    session_id: e.actor.startsWith('session/')
      ? e.actor.slice('session/'.length)
      : e.actor,
    payload,
    note: e.note,
  };
}

function payloadPreview(row: AuditRow): string {
  // One-line preview — target plus the most useful descriptor. Capped
  // to PAYLOAD_PREVIEW_MAX with a trailing ellipsis so the row height
  // stays at 48px regardless of payload size.
  const target = row.payload?.target as string | undefined;
  const note = row.note;
  const segments = [target, note].filter(Boolean).join(' · ');
  if (segments.length <= PAYLOAD_PREVIEW_MAX) return segments;
  return segments.slice(0, PAYLOAD_PREVIEW_MAX - 1) + '…';
}

/**
 * `datetime-local` inputs give the local clock; the filter compares ISO
 * strings (lexicographically sortable for ISO 8601, so we keep things in
 * that domain). Empty string ⇒ no constraint.
 */
function inLocalRange(
  isoTimestamp: string,
  fromLocal: string,
  toLocal: string,
): boolean {
  if (fromLocal) {
    const fromIso = new Date(fromLocal).toISOString();
    if (isoTimestamp < fromIso) return false;
  }
  if (toLocal) {
    const toIso = new Date(toLocal).toISOString();
    if (isoTimestamp > toIso) return false;
  }
  return true;
}

export default function AuditScreen() {
  const allRows = useMemo(() => DATA.audit.map(toAuditRow), []);
  const packs = useMemo(() => packsFromData(DATA.audit), []);

  // External filter state — mirrored into TanStack's columnFilters below
  // so `getFilteredRowModel()` is the single source of truth for what
  // renders.
  const [pack, setPack] = useState('');
  const [eventType, setEventType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timestamp_iso', desc: true },
  ]);

  // The date range is a custom filter on the timestamp column. We feed
  // the controlled inputs into a single filter value `{ from, to }`.
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = [];
    if (eventType) f.push({ id: 'event_type', value: eventType });
    if (pack) f.push({ id: 'pack', value: pack });
    if (from || to) {
      f.push({ id: 'timestamp_iso', value: { from, to } });
    }
    return f;
  }, [eventType, pack, from, to]);

  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        id: 'timestamp_iso',
        accessorKey: 'timestamp_iso',
        header: 'Timestamp',
        enableSorting: true,
        sortingFn: 'basic',
        filterFn: (row, _id, value: { from: string; to: string }) => {
          return inLocalRange(row.original.timestamp_iso, value.from, value.to);
        },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--md-on-surface-variant)]">
            {row.original.timestamp_iso}
          </span>
        ),
      },
      {
        id: 'event_type',
        accessorKey: 'event_type',
        header: 'Event',
        enableSorting: true,
        filterFn: (row, _id, value) => {
          if (!value) return true;
          return row.original.event_type === value;
        },
        cell: ({ row }) => (
          <span className={`ev ${row.original.event_type}`}>
            {row.original.event_type}
          </span>
        ),
      },
      {
        id: 'correlation_id',
        accessorKey: 'correlation_id',
        header: 'Correlation',
        enableSorting: true,
        cell: ({ row }) => (
          <Link
            href={`/audit/${encodeURIComponent(row.original.correlation_id)}`}
            data-testid="audit-row-link"
            data-correlation-id={row.original.correlation_id}
            className="font-mono text-xs text-[var(--md-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]"
            tabIndex={0}
          >
            {row.original.correlation_id}
          </Link>
        ),
      },
      {
        id: 'pack',
        accessorKey: 'pack',
        header: 'Pack',
        enableSorting: true,
        filterFn: (row, _id, value) => {
          if (!value) return true;
          return row.original.pack === value;
        },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--md-on-surface-variant)]">
            {row.original.pack}
          </span>
        ),
      },
      {
        id: 'payload',
        accessorKey: 'payload',
        header: 'Payload',
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block truncate font-mono text-xs text-[var(--md-on-surface-variant)]"
            title={payloadPreview(row.original)}
          >
            {payloadPreview(row.original)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: allRows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const exportRows = useMemo(
    () => rows.map((r) => r.original as TrailRowForExport),
    [rows],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const onRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = Math.min(rows.length - 1, Math.max(0, rowIndex + delta));
      const root = scrollRef.current;
      if (!root) return;
      virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
      requestAnimationFrame(() => {
        const next = root.querySelector<HTMLAnchorElement>(
          `[data-row-index="${nextIdx}"] [data-testid="audit-row-link"]`,
        );
        next?.focus();
      });
    },
    [rows.length, virtualizer],
  );

  const onSubmitFilters = useCallback((e: FormEvent) => {
    // The form is purely controlled — submit is a no-op but we keep the
    // handler so Enter inside the date inputs doesn't trigger a page
    // navigation in a wrapping form (defensive against future shell
    // changes).
    e.preventDefault();
  }, []);

  const clearFilters = useCallback(() => {
    setPack('');
    setEventType('');
    setFrom('');
    setTo('');
  }, []);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="stack">
      <ScreenHead
        title="AI-Trail"
        lede="Tamper-evident, append-only audit log. Separate from engineering traces (those live in Langfuse). Designed to be read by regulators."
        meta={`${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()} events · stream lag <1s`}
        right={
          <>
            <CsvExportButton rows={exportRows} />
            <a className="btn text" href="#">
              <Icon name="external" size={13} /> Open Langfuse
            </a>
          </>
        }
      />

      <form
        onSubmit={onSubmitFilters}
        aria-label="Audit filters"
        className="flex flex-col gap-3 rounded-md border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--md-on-surface-variant)]">From</span>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.currentTarget.value)}
              className="w-52"
              aria-label="From timestamp"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--md-on-surface-variant)]">To</span>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.currentTarget.value)}
              className="w-52"
              aria-label="To timestamp"
            />
          </label>
          <button
            type="button"
            onClick={clearFilters}
            className="btn text"
            aria-label="Clear filters"
          >
            Clear
          </button>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Event type filter"
        >
          <span className="text-xs text-[var(--md-on-surface-variant)]">
            Event
          </span>
          <FilterChip
            label="any"
            selected={eventType === ''}
            onClick={() => setEventType('')}
          />
          {EVENT_TYPES.map((t) => (
            <FilterChip
              key={t}
              label={t}
              selected={eventType === t}
              onClick={() => setEventType(eventType === t ? '' : t)}
            />
          ))}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Pack filter"
        >
          <span className="text-xs text-[var(--md-on-surface-variant)]">
            Pack
          </span>
          <FilterChip
            label="any"
            selected={pack === ''}
            onClick={() => setPack('')}
          />
          {packs.map((p) => (
            <FilterChip
              key={p}
              label={p}
              selected={pack === p}
              onClick={() => setPack(pack === p ? '' : p)}
            />
          ))}
        </div>
      </form>

      <div
        ref={scrollRef}
        data-testid="audit-scroll"
        className="w-full overflow-auto rounded-md border border-[var(--md-outline-variant)]"
        style={{ maxHeight: `${ROW_HEIGHT * 12}px` }}
      >
        <table
          className="w-full caption-bottom text-sm"
          aria-label="Audit events"
        >
          <thead className="sticky top-0 z-10 bg-[var(--md-surface-container)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                      className="h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-[var(--md-on-surface)] focus:outline-none focus-visible:underline"
                          aria-label={`Sort by ${String(
                            header.column.columnDef.header ?? header.id,
                          )}`}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden className="text-[10px]">
                            {sorted === 'asc'
                              ? '▲'
                              : sorted === 'desc'
                                ? '▼'
                                : ''}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: `${paddingTop}px` }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {virtualRows.map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              return (
                <tr
                  key={row.id}
                  data-row-index={vRow.index}
                  data-testid="audit-row"
                  onKeyDown={(e) => onRowKeyDown(e, vRow.index)}
                  className="border-b border-[var(--md-outline-variant)] last:border-0 hover:bg-[var(--md-surface-container-high)]"
                  style={{ height: `${ROW_HEIGHT}px` }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="overflow-hidden px-3 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: `${paddingBottom}px` }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-[var(--md-on-surface-variant)]"
                >
                  No events match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
