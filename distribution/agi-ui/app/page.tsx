// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * Health dashboard — `/` route.
 *
 * The reference screen for the M3 design system: 4 KPIs, a service-status
 * card with status dots, and a packs/links split. All chrome lives in the
 * shared globals.css; this file just composes the layout.
 */

import Link from 'next/link';
import { Card, Icon, Pill, ScreenHead, StatusDot } from './components/m3';
import { DATA } from './mock/data';

export default function HealthScreen() {
  const d = DATA;
  return (
    <div className="stack">
      <ScreenHead
        title="Health"
        lede="Live status across runtime, hub bundle, vector store, observability, LLM providers, and persistence. All services poll every 15 seconds."
        meta={`Deployment ${d.env.name} · ${d.env.deploy} · ${d.env.version}`}
        right={
          <>
            <button type="button" className="btn">
              <Icon name="refresh" /> Refresh
            </button>
            <a className="btn text" href="#">
              <Icon name="external" size={13} /> Open Langfuse
            </a>
          </>
        }
      />

      <div className="grid-4">
        <div className="kpi">
          <div className="label">Healthy services</div>
          <div className="value">
            8<span className="dim" style={{ fontSize: 14 }}> / 9</span>
          </div>
          <div className="delta">all critical paths up</div>
        </div>
        <div className="kpi">
          <div className="label">Traces today</div>
          <div className="value">12,481</div>
          <div className="delta">+8% vs yesterday</div>
        </div>
        <div className="kpi">
          <div className="label">p50 latency</div>
          <div className="value">
            142<span className="dim" style={{ fontSize: 14 }}>ms</span>
          </div>
          <div className="delta">−12ms · last hour</div>
        </div>
        <div className="kpi">
          <div className="label">Hub bundle</div>
          <div className="value mono" style={{ fontSize: 14, marginTop: 8 }}>
            v2026-05-21
          </div>
          <div className="delta">3 tools added</div>
        </div>
      </div>

      <Card title="Service status" right="last sweep · 4s ago">
        <div style={{ margin: '-4px -4px' }}>
          {d.health.map((h) => (
            <div className="health-row" key={h.id}>
              <StatusDot status={h.status} pulse={h.status === 'good'} />
              <div className="name">{h.name}</div>
              <div className="status mono">
                {h.status === 'good' ? 'OK' : h.status === 'warn' ? 'WARN' : 'FAIL'}
              </div>
              <div className="detail">{h.detail}</div>
              <div className="check">{h.check}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid-side">
        <Card title="Packs deployed" right={<Link href="/packs">View all →</Link>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pack</th>
                <th>Tools</th>
                <th>KB</th>
                <th>Reindex</th>
                <th>Events 24h</th>
              </tr>
            </thead>
            <tbody>
              {d.packs.map((p) => (
                <tr key={p.slug}>
                  <td>
                    <Link
                      href={`/packs/${p.slug}`}
                      className="row"
                      style={{
                        gap: 10,
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                    >
                      <span className="swatch" style={{ background: p.primary }} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div className="sub mono">
                          {p.slug} · {p.vertical}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="num">{p.tools}</td>
                  <td className="num">{p.kbArticles}</td>
                  <td className="mono">
                    {p.reindexStale ? (
                      <Pill kind="warn">{p.reindex}</Pill>
                    ) : (
                      <span className="dim">{p.reindex}</span>
                    )}
                  </td>
                  <td className="num">{p.events24h.tool + p.events24h.llm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Quick links">
          <div className="stack" style={{ gap: 8 }}>
            <Link
              className="row between"
              style={{ padding: '8px 0' }}
              href="/llm"
            >
              <span>LLM role bindings</span>
              <Icon name="chev" size={14} />
            </Link>
            <div className="hr" />
            <Link className="row between" style={{ padding: '8px 0' }} href="/tools">
              <span>Tool catalogue</span>
              <Icon name="chev" size={14} />
            </Link>
            <div className="hr" />
            <Link className="row between" style={{ padding: '8px 0' }} href="/audit">
              <span>AI-Trail</span>
              <Icon name="chev" size={14} />
            </Link>
            <div className="hr" />
            <a className="row between" style={{ padding: '8px 0' }} href="#">
              <span>
                Open Langfuse <Icon name="external" size={11} />
              </span>
              <span className="mono dim" style={{ fontSize: 11 }}>
                ↗
              </span>
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
