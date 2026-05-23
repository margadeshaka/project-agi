// SPDX-License-Identifier: Apache-2.0
'use client';

import { Icon, Pill, ScreenHead, SearchInput } from '../../components/m3';
import { DATA } from '../../mock/data';

export default function AdminLogScreen() {
  const d = DATA;
  return (
    <div className="stack">
      <ScreenHead
        title="Admin action log"
        lede="Every write action initiated through the console is itself written here within 1 second. Append-only at the runtime layer."
        meta={`${d.adminLog.length} entries shown · 99p latency 320ms`}
        right={
          <button type="button" className="btn">
            <Icon name="download" /> Export CSV
          </button>
        }
      />
      <div className="tbl-wrap">
        <div className="filterbar">
          <SearchInput value="" onChange={() => {}} placeholder="Search actor or target" width={280} />
          <select className="select">
            <option>Method: any</option>
            <option>POST</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
          <select className="select">
            <option>Result: any</option>
            <option>2xx</option>
            <option>4xx</option>
            <option>5xx</option>
          </select>
          <select className="select">
            <option>Range: last 24h</option>
            <option>last 7 days</option>
            <option>last 30 days</option>
          </select>
          <div className="results">{d.adminLog.length} entries</div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Method</th>
              <th>Target</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {d.adminLog.map((l, i) => (
              <tr key={i}>
                <td className="mono">2026-05-22 {l.ts}</td>
                <td className="mono">{l.actor}</td>
                <td>
                  <Pill
                    kind={
                      l.action === 'DELETE' ? 'bad' : l.action === 'PATCH' ? 'warn' : 'accent'
                    }
                  >
                    {l.action}
                  </Pill>
                </td>
                <td className="mono">{l.target}</td>
                <td>
                  {l.result.startsWith('2') ? (
                    <Pill kind="good">{l.result}</Pill>
                  ) : l.result.startsWith('5') ? (
                    <Pill kind="bad">{l.result}</Pill>
                  ) : (
                    <Pill kind="warn">{l.result}</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
