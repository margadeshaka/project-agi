// SPDX-License-Identifier: Apache-2.0
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BarChart, HBarChart, LineChart } from '../components/charts';
import {
  Card,
  FilterChip,
  Icon,
  M3List,
  M3ListItem,
  ScreenHead,
  SegmentedButton,
} from '../components/m3';
import { DATA } from '../mock/data';

export default function MetricsScreen() {
  const d = DATA;
  const router = useRouter();
  const [range, setRange] = useState('24h');
  const [pack, setPack] = useState('all');

  const totalInput = d.metricsTokens.reduce((a, b) => a + b.input, 0);
  const totalOutput = d.metricsTokens.reduce((a, b) => a + b.output, 0);
  const totalCost = d.costByPack.reduce((a, b) => a + b.total, 0);

  return (
    <div className="stack">
      <ScreenHead
        title="Metrics & cost"
        lede="Usage, latency, errors, and cost across packs and providers. Deep-links to Langfuse for raw trace inspection."
        meta={`Last 24h · ${((totalInput + totalOutput) / 1000).toFixed(1)}K tokens · $${totalCost.toFixed(2)}`}
        right={
          <>
            <a className="btn text" href="#">
              <Icon name="external" size={18} /> Langfuse
            </a>
            <button type="button" className="btn">
              <Icon name="download" size={18} /> Export
            </button>
          </>
        }
      />

      <div className="assist-row" style={{ marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12, marginRight: 4 }}>
          Range
        </span>
        <SegmentedButton value={range} options={['24h', '7d', '30d', '90d']} onChange={setRange} />
        <span className="muted" style={{ fontSize: 12, marginLeft: 16, marginRight: 4 }}>
          Pack
        </span>
        {['all', 'support-demo', 'research-demo', 'fleet-demo', 'starter'].map((p) => (
          <FilterChip key={p} label={p} selected={pack === p} onClick={() => setPack(p)} />
        ))}
      </div>

      <div className="grid-4">
        <div className="kpi">
          <div className="label">Total tokens</div>
          <div className="value">
            {((totalInput + totalOutput) / 1000).toFixed(1)}
            <span className="unit">K</span>
          </div>
          <div className="delta">+12% vs prev 24h</div>
        </div>
        <div className="kpi">
          <div className="label">Cost (USD)</div>
          <div className="value">${totalCost.toFixed(2)}</div>
          <div className="delta">+4% vs prev 24h</div>
        </div>
        <div className="kpi">
          <div className="label">Agent runs</div>
          <div className="value">3,217</div>
          <div className="delta">+8%</div>
        </div>
        <div className="kpi">
          <div className="label">Error rate</div>
          <div className="value">
            0.7<span className="unit">%</span>
          </div>
          <div className="delta bad">+0.2pp · investigate</div>
        </div>
      </div>

      <div className="grid-2">
        <Card
          title="Tokens · last 24h"
          right={`${totalInput.toLocaleString()} in · ${totalOutput.toLocaleString()} out`}
        >
          <BarChart data={d.metricsTokens} />
        </Card>
        <Card title="Latency p50 / p95" right="ms">
          <LineChart data={d.metricsLatency} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Top tools by call count" right="last 24h">
          <HBarChart
            data={d.topToolsByCalls.map((t) => ({ label: t.name, value: t.calls }))}
            onClick={(name) => router.push(`/tools/${encodeURIComponent(name)}`)}
            format={(v) => v.toLocaleString()}
          />
        </Card>
        <Card title="Cost by pack" right={`$${totalCost.toFixed(2)} total`}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pack</th>
                <th className="right">Input</th>
                <th className="right">Output</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.costByPack.map((c) => (
                <tr
                  key={c.pack}
                  onClick={() => router.push(`/packs/${c.pack}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{c.pack}</td>
                  <td className="num">${c.inputUsd.toFixed(2)}</td>
                  <td className="num">${c.outputUsd.toFixed(2)}</td>
                  <td
                    className="num"
                    style={{ color: 'var(--md-on-surface)', fontWeight: 500 }}
                  >
                    ${c.total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Top errors · last 24h" right="grouped by signature">
        <M3List>
          {d.topErrors.map((e) => (
            <M3ListItem
              key={e.signature}
              lead={<Icon name="error" size={20} />}
              leadKind="error"
              headline={e.signature}
              supporting={`${e.count} occurrences · last ${e.last}`}
              trailing={
                <>
                  <div>{e.count}</div>
                  <span className="meta">events</span>
                </>
              }
            />
          ))}
        </M3List>
      </Card>
    </div>
  );
}
