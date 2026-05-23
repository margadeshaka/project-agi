// SPDX-License-Identifier: Apache-2.0
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FilterChip,
  Icon,
  InputChip,
  Pill,
  SearchInput,
  SegmentedButton,
  SideEffectPill,
} from './m3';
import type { ToolDef } from '../mock/data';

interface Props {
  tools: ToolDef[];
  scopedToPack?: string;
}

export function ToolsTable({ tools, scopedToPack }: Props) {
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('any');
  const [side, setSide] = useState('any');

  const filtered = useMemo(
    () =>
      tools.filter(
        (t) =>
          (!q ||
            t.name.toLowerCase().includes(q.toLowerCase()) ||
            t.desc.toLowerCase().includes(q.toLowerCase())) &&
          (domain === 'any' || t.domain === domain) &&
          (side === 'any' || t.side === side),
      ),
    [tools, q, domain, side],
  );

  const domains = useMemo(() => ['any', ...Array.from(new Set(tools.map((t) => t.domain)))], [tools]);

  return (
    <div className="tbl-wrap">
      <div
        className="filterbar"
        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}
      >
        <div className="row between" style={{ width: '100%' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search by name or description"
            width={320}
          />
          <SegmentedButton
            value={side}
            options={[
              { value: 'any', label: 'all' },
              { value: 'read', label: 'read' },
              { value: 'write', label: 'write' },
            ]}
            onChange={setSide}
          />
        </div>
        <div className="assist-row">
          {domains.map((d) => (
            <FilterChip
              key={d}
              label={d}
              selected={domain === d}
              onClick={() => setDomain(d)}
            />
          ))}
          {scopedToPack && (
            <InputChip lead={scopedToPack[0].toUpperCase()} label={scopedToPack} />
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              color: 'var(--md-on-surface-variant)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {filtered.length} of {tools.length}
          </span>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>HTTP</th>
            <th>Path</th>
            <th>Side</th>
            <th>Rate</th>
            <th>Packs</th>
            <th>Bundle</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.name}>
              <td>
                <Link
                  href={`/tools/${encodeURIComponent(t.name)}`}
                  style={{ color: 'inherit' }}
                >
                  <div className="mono" style={{ color: 'var(--md-primary)', fontWeight: 500 }}>
                    {t.name}
                  </div>
                  <div
                    className="sub"
                    style={{
                      marginTop: 2,
                      color: 'var(--md-on-surface-variant)',
                      fontSize: 11.5,
                    }}
                  >
                    {t.desc}
                  </div>
                </Link>
              </td>
              <td>
                <Pill>{t.method}</Pill>
              </td>
              <td
                className="mono"
                style={{ fontSize: 11.5, color: 'var(--md-on-surface-variant)' }}
              >
                {t.path}
              </td>
              <td>
                <SideEffectPill side={t.side} />
              </td>
              <td>
                <Pill kind={t.rate === 'high' ? 'warn' : ''}>{t.rate}</Pill>
              </td>
              <td>
                <span className="mono muted">{t.packs.length}</span>
              </td>
              <td
                className="mono"
                style={{ fontSize: 11, color: 'var(--md-on-surface-variant)' }}
              >
                {t.bundle}
              </td>
              <td>
                <Icon name="chev" size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
