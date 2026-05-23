// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { Icon, Pill, ScreenHead, SearchInput } from '../components/m3';
import { DATA } from '../mock/data';

export interface UseCasesViewProps {
  /**
   * Platform-level Langfuse host, sourced from ``/admin/use-cases``.
   * When ``null`` the header link is suppressed (Langfuse not wired).
   */
  langfuseUrl: string | null;
}

export function UseCasesView({ langfuseUrl }: UseCasesViewProps) {
  const d = DATA;
  return (
    <div className="stack">
      <ScreenHead
        title="Use-case services"
        lede="Registered use-case containers. Each is one solution-layer service running on top of agi-runtime, scoped by pack and tool allow-list."
        meta={`${d.useCases.length} services · all reachable`}
        right={
          langfuseUrl ? (
            <a
              className="btn text"
              href={langfuseUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="langfuse-link"
            >
              <Icon name="external" size={13} /> Open in Langfuse
            </a>
          ) : null
        }
      />
      <div className="tbl-wrap">
        <div className="filterbar">
          <SearchInput value="" onChange={() => {}} placeholder="Search by service" width={260} />
          <select className="select">
            <option>Pack: any</option>
            <option>starter</option>
            <option>support-demo</option>
            <option>fleet-demo</option>
            <option>research-demo</option>
          </select>
          <div className="results">{d.useCases.length} services</div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Service</th>
              <th>Version</th>
              <th>Packs</th>
              <th>Tools</th>
              <th>Runs (24h)</th>
              <th>p50 · p95</th>
              <th>Health</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {d.useCases.map((u) => (
              <tr key={u.slug}>
                <td>
                  <Link href={`/use-cases/${u.slug}`} style={{ color: 'inherit' }}>
                    <div style={{ fontWeight: 500 }}>{u.name}</div>
                    <div className="sub mono">{u.slug}</div>
                  </Link>
                </td>
                <td className="mono">{u.version}</td>
                <td>
                  <div className="row">
                    {u.packs.map((p) => (
                      <Pill key={p}>{p}</Pill>
                    ))}
                  </div>
                </td>
                <td className="num">{u.tools}</td>
                <td className="num">{u.runs24h.toLocaleString()}</td>
                <td className="mono">
                  {u.p50}ms · {u.p95}ms
                </td>
                <td>
                  {u.status === 'good' ? (
                    <Pill kind="good">healthy</Pill>
                  ) : (
                    <Pill kind="warn">slow</Pill>
                  )}
                </td>
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
