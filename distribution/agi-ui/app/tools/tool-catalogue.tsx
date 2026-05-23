// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * ToolCatalogue — client filters + lightweight windowing for the tool list.
 *
 * Why not TanStack Table here: at v1 we have <500 tools per bundle so a
 * plain filter + flex render keeps the bundle smaller. When that goes
 * over 1k rows, swap this for @tanstack/react-virtual. The component
 * API stays the same.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ToolSummary } from '@/lib/api/types';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../components/ui/table';

interface Props {
  tools: ToolSummary[];
}

export function ToolCatalogue({ tools }: Props) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [side, setSide] = useState('');

  const domains = useMemo(() => Array.from(new Set(tools.map((t) => t.domain))).sort(), [tools]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (domain && t.domain !== domain) return false;
      if (side && t.side_effect !== side) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.domain.toLowerCase().includes(q)
      );
    });
  }, [tools, query, domain, side]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          aria-label="Search tools"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Select aria-label="Domain filter" value={domain} onChange={(e) => setDomain(e.currentTarget.value)}>
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select aria-label="Side-effect filter" value={side} onChange={(e) => setSide(e.currentTarget.value)}>
          <option value="">Any side-effect</option>
          <option value="read">read</option>
          <option value="write">write</option>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Side effect</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Bundle</TableHead>
            <TableHead>Used by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((t) => (
            <TableRow key={t.name}>
              <TableCell>
                <Link
                  href={`/tools/${encodeURIComponent(t.name)}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {t.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">{t.description}</p>
              </TableCell>
              <TableCell className="text-xs">{t.domain}</TableCell>
              <TableCell>
                <Badge tone={t.side_effect === 'write' ? 'write' : 'read'}>{t.side_effect}</Badge>
              </TableCell>
              <TableCell className="text-xs">{t.rate_limit_class}</TableCell>
              <TableCell className="font-mono text-xs text-muted">{t.bundle_version}</TableCell>
              <TableCell className="text-xs text-muted">{t.consuming_pack_count} pack(s)</TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted">
                No tools match the current filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
