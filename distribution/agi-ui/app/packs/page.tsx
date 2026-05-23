// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon, Pill, ScreenHead, SearchInput } from '../components/m3';
import { DATA } from '../mock/data';

export default function PacksScreen() {
  const allowed = DATA.packs;
  const [q, setQ] = useState('');
  return (
    <div className="stack">
      <ScreenHead
        title="Packs"
        lede="Brand-packs are the unit of multi-tenant config. Each is loaded from disk and identified by its slug and SHA."
        meta={`${allowed.length} packs deployed · YAML on disk is source of truth`}
        right={
          <>
            <Link href="/packs/new" className="btn primary">
              <Icon name="plus" size={18} /> New pack
            </Link>
            <button type="button" className="btn">
              <Icon name="refresh" size={18} /> Rescan
            </button>
          </>
        }
      />

      <div className="tbl-wrap">
        <div className="filterbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search by slug or name" width={280} />
          <select className="select">
            <option>Vertical: any</option>
            <option>customer support</option>
            <option>logistics</option>
            <option>RAG / knowledge</option>
            <option>blank template</option>
          </select>
          <select className="select">
            <option>Reindex: any</option>
            <option>fresh</option>
            <option>stale (&gt;24h)</option>
          </select>
          <div className="results">
            {allowed.length} of {DATA.packs.length}
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Pack</th>
              <th>Vertical</th>
              <th>Source</th>
              <th>SHA</th>
              <th>Tools</th>
              <th>KB articles</th>
              <th>Last reindex</th>
              <th>Events 24h</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allowed
              .filter(
                (p) =>
                  !q ||
                  p.slug.includes(q.toLowerCase()) ||
                  p.name.toLowerCase().includes(q.toLowerCase()),
              )
              .map((p) => (
                <tr key={p.slug}>
                  <td>
                    <Link
                      href={`/packs/${p.slug}`}
                      className="row"
                      style={{ gap: 10, color: 'inherit' }}
                    >
                      <span className="swatch" style={{ background: p.primary }} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div className="sub mono">{p.slug}</div>
                      </div>
                    </Link>
                  </td>
                  <td>
                    <Pill>{p.vertical}</Pill>
                  </td>
                  <td className="mono">{p.source}</td>
                  <td className="mono">{p.sha}</td>
                  <td className="num">{p.tools}</td>
                  <td className="num">{p.kbArticles}</td>
                  <td className="mono">
                    {p.reindexStale ? (
                      <Pill kind="warn">stale · {p.reindex}</Pill>
                    ) : (
                      <span className="dim">{p.reindex}</span>
                    )}
                  </td>
                  <td className="num">{p.events24h.tool + p.events24h.llm + p.events24h.handoff}</td>
                  <td>
                    <Icon name="chev" size={14} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
