// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * ToolCatalogue — TanStack Table + react-virtual.
 *
 * Why TanStack + virtual:
 *  - The bundle can exceed 1k rows once multi-pack tenants land; a plain
 *    `.map` chokes the layout. `useVirtualizer` keeps only the visible
 *    window in the DOM (overscan 8 for smooth scrolling).
 *  - `useReactTable` gives us sortable headers, declarative column-filters,
 *    and a single source of truth for the rendered row set — chips below
 *    still drive filter state but feed into TanStack's filter pipeline.
 *  - Row height is a fixed 56px (matches the M3 row-pad tokens in
 *    `app/styles/tokens.css`). The virtualiser needs a deterministic size
 *    estimate so we hard-code it; if the design changes, update both here
 *    and the row className.
 *
 * Accessibility:
 *  - `role="grid"` semantics retained via native `<table>`.
 *  - Each row owns one focusable anchor; ArrowDown/ArrowUp moves focus,
 *    Enter follows the link (browser default — anchors handle Enter for
 *    free; we only intercept arrow keys).
 *  - Filter chips are `role="checkbox"` per the M3 spec (see filter-chip.tsx).
 */

import Link from 'next/link';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
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
import type { ToolSummary } from '@/lib/api/types';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { FilterChip } from '../components/ui/filter-chip';

interface Props {
  tools: ToolSummary[];
}

const ROW_HEIGHT = 56;
const OVERSCAN = 8;

const SIDE_EFFECTS = ['read', 'write'] as const;

export function ToolCatalogue({ tools }: Props) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string>('');
  const [side, setSide] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const domains = useMemo(
    () => Array.from(new Set(tools.map((t) => t.domain))).sort(),
    [tools],
  );

  // External filter state is mirrored into TanStack's column-filter pipeline
  // so `getFilteredRowModel()` is the single source of truth for what renders.
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = [];
    if (query.trim()) f.push({ id: 'name', value: query.trim().toLowerCase() });
    if (domain) f.push({ id: 'domain', value: domain });
    if (side) f.push({ id: 'side_effect', value: side });
    return f;
  }, [query, domain, side]);

  const columns = useMemo<ColumnDef<ToolSummary>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Tool',
        enableSorting: true,
        // Custom filter: matches across name + description + domain (search box).
        filterFn: (row, _id, value) => {
          const q = String(value ?? '').toLowerCase();
          if (!q) return true;
          const t = row.original;
          return (
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.domain.toLowerCase().includes(q)
          );
        },
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="min-w-0">
              <Link
                href={`/tools/${encodeURIComponent(t.name)}`}
                data-testid="tool-row-link"
                data-tool-name={t.name}
                className="block truncate font-mono text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                tabIndex={0}
              >
                {t.name}
              </Link>
              <p className="mt-0.5 truncate text-xs text-muted">{t.description}</p>
            </div>
          );
        },
      },
      {
        id: 'domain',
        accessorKey: 'domain',
        header: 'Domain',
        enableSorting: true,
        // Exact-match filter — driven by the FilterChip row below.
        filterFn: (row, _id, value) => {
          if (!value) return true;
          return row.original.domain === value;
        },
        cell: ({ row }) => <span className="text-xs">{row.original.domain}</span>,
      },
      {
        id: 'side_effect',
        accessorKey: 'side_effect',
        header: 'Side effect',
        enableSorting: true,
        filterFn: (row, _id, value) => {
          if (!value) return true;
          return row.original.side_effect === value;
        },
        cell: ({ row }) => (
          <Badge tone={row.original.side_effect === 'write' ? 'write' : 'read'}>
            {row.original.side_effect}
          </Badge>
        ),
      },
      {
        id: 'rate_limit_class',
        accessorKey: 'rate_limit_class',
        header: 'Rate',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-xs">{row.original.rate_limit_class}</span>
        ),
      },
      {
        id: 'bundle_version',
        accessorKey: 'bundle_version',
        header: 'Bundle',
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.bundle_version;
          if (!v) return <span className="font-mono text-xs text-muted">—</span>;
          return (
            <Link
              href={`/bundles/${encodeURIComponent(v)}`}
              className="font-mono text-xs text-muted hover:text-accent hover:underline"
            >
              {v}
            </Link>
          );
        },
      },
      {
        id: 'consuming_pack_count',
        accessorKey: 'consuming_pack_count',
        header: 'Used by',
        enableSorting: true,
        cell: ({ row }) => {
          const n = row.original.consuming_pack_count;
          return (
            <span className="text-xs text-muted">
              {n == null ? '—' : `${n} pack(s)`}
            </span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: tools,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Keyboard nav: ↑/↓ moves focus to the row anchor. Enter is handled by
  // the browser's default anchor activation; we don't intercept it.
  const onRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = Math.min(rows.length - 1, Math.max(0, rowIndex + delta));
      const root = scrollRef.current;
      if (!root) return;
      virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
      // After the virtualiser realises the next row in the next tick, focus it.
      requestAnimationFrame(() => {
        const next = root.querySelector<HTMLAnchorElement>(
          `[data-row-index="${nextIdx}"] [data-testid="tool-row-link"]`,
        );
        next?.focus();
      });
    },
    [rows.length, virtualizer],
  );

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          aria-label="Search tools"
          placeholder="Search by name, description, or domain…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Side-effect filter">
          <FilterChip
            label="any"
            selected={side === ''}
            onClick={() => setSide('')}
          />
          {SIDE_EFFECTS.map((s) => (
            <FilterChip
              key={s}
              label={s}
              selected={side === s}
              onClick={() => setSide(side === s ? '' : s)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Domain filter">
        <FilterChip
          label="all domains"
          selected={domain === ''}
          onClick={() => setDomain('')}
        />
        {domains.map((d) => (
          <FilterChip
            key={d}
            label={d}
            selected={domain === d}
            onClick={() => setDomain(domain === d ? '' : d)}
          />
        ))}
        <span className="ml-auto font-mono text-xs text-muted">
          {rows.length} of {tools.length}
        </span>
      </div>
      <div
        ref={scrollRef}
        data-testid="tool-catalogue-scroll"
        className="w-full overflow-auto rounded-md border border-border"
        style={{ maxHeight: `${ROW_HEIGHT * 10}px` }}
      >
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-10 bg-foreground/5">
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
                      className="h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground focus:outline-none focus-visible:underline"
                          aria-label={`Sort by ${String(header.column.columnDef.header ?? header.id)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden className="text-[10px]">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
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
                  data-testid="tool-row"
                  onKeyDown={(e) => onRowKeyDown(e, vRow.index)}
                  className="border-b border-border last:border-0 hover:bg-foreground/5"
                  style={{ height: `${ROW_HEIGHT}px` }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3 align-middle">
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
                  className="py-8 text-center text-sm text-muted"
                >
                  No tools match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
