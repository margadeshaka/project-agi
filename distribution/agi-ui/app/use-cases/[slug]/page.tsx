// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams, useRouter } from 'next/navigation';
import { Card, Empty, Icon, Pill, ScreenHead, SideEffectPill } from '../../components/m3';
import { DATA } from '../../mock/data';

export default function UseCaseDetailScreen() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const u = DATA.useCases.find((x) => x.slug === params?.slug);
  if (!u) {
    return <Empty title="Use-case not found" body={`No registered service "${params?.slug}".`} />;
  }
  const usedTools = DATA.tools.slice(0, u.tools);
  return (
    <div className="stack">
      <ScreenHead
        title={u.name}
        lede={`Use-case service · version ${u.version}`}
        meta={`${u.runs24h.toLocaleString()} runs in last 24h · scoped to ${u.packs.join(', ')}`}
        right={
          <>
            <a className="btn text" href="#">
              <Icon name="external" size={13} /> Open in Langfuse
            </a>
            <button type="button" className="btn">
              <Icon name="refresh" /> Re-roll image
            </button>
          </>
        }
      />
      <div className="grid-4">
        <div className="kpi">
          <div className="label">p50</div>
          <div className="value">
            {u.p50}
            <span className="dim" style={{ fontSize: 14 }}>ms</span>
          </div>
        </div>
        <div className="kpi">
          <div className="label">p95</div>
          <div className="value">
            {u.p95}
            <span className="dim" style={{ fontSize: 14 }}>ms</span>
          </div>
        </div>
        <div className="kpi">
          <div className="label">Runs 24h</div>
          <div className="value">{u.runs24h.toLocaleString()}</div>
        </div>
        <div className="kpi">
          <div className="label">Errors 24h</div>
          <div className="value">{u.status === 'warn' ? '12' : '0'}</div>
          <div className={`delta ${u.status === 'warn' ? 'bad' : ''}`.trim()}>
            {u.status === 'warn' ? 'stale upstream' : 'all clean'}
          </div>
        </div>
      </div>

      <div className="grid-side">
        <Card title="Tool dependencies" right={`${u.tools} tools required`}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Side</th>
                <th>Last invoke</th>
              </tr>
            </thead>
            <tbody>
              {usedTools.map((t) => (
                <tr
                  key={t.name}
                  onClick={() => router.push(`/tools/${encodeURIComponent(t.name)}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono" style={{ color: 'var(--md-primary)' }}>
                    {t.name}
                  </td>
                  <td>
                    <SideEffectPill side={t.side} />
                  </td>
                  <td className="mono dim">12s ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Required model roles">
          <div className="stack" style={{ gap: 8, fontSize: 12.5 }}>
            <div className="row between">
              <span className="mono">reasoning</span>
              <Pill kind="good">healthy</Pill>
            </div>
            <div className="row between">
              <span className="mono">extractor</span>
              <Pill kind="good">healthy</Pill>
            </div>
            <div className="hr" />
            <div>
              <span className="dim mono" style={{ fontSize: 11 }}>IMAGE</span>
              <div className="mono" style={{ fontSize: 11.5 }}>
                ghcr.io/project-agi/{u.slug}:{u.version}
              </div>
            </div>
            <div>
              <span className="dim mono" style={{ fontSize: 11 }}>REPLICAS</span>
              <div className="mono">2 / 2</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
