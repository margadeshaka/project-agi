// SPDX-License-Identifier: Apache-2.0
'use client';

import { useState } from 'react';
import { Card, Icon, Pill, ScreenHead, StatusDot, useSnackbar } from '../components/m3';
import { DATA } from '../mock/data';

export default function LLMScreen() {
  const d = DATA;
  const snackbar = useSnackbar();
  const [override, setOverride] = useState(false);
  return (
    <div className="stack">
      <ScreenHead
        title="Model role bindings"
        lede="The single most-asked operator question: which role uses which model right now? Edits live in operator.yaml — this view is read-only."
        meta="source: operator.yaml · reloaded on /admin/reload"
        right={
          <a className="btn" href="#">
            <Icon name="external" size={13} /> Edit operator.yaml
          </a>
        }
      />

      {override && (
        <div
          className="row between"
          style={{
            padding: '10px 14px',
            background: 'var(--md-warning-container)',
            border: '1px solid var(--md-warning)',
            borderRadius: 8,
          }}
        >
          <div className="row" style={{ gap: 10 }}>
            <Pill kind="warn">session override active</Pill>
            <span className="mono" style={{ fontSize: 12 }}>
              reasoning → bedrock/anthropic.claude-3-5-sonnet
            </span>
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setOverride(false);
              snackbar.show({ msg: 'Override cleared' });
            }}
          >
            Clear override
          </button>
        </div>
      )}

      <Card title="Role bindings">
        <table className="tbl">
          <thead>
            <tr>
              <th>Role</th>
              <th>Model id</th>
              <th>Region</th>
              <th>Defaults</th>
              <th>Health</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {d.roleBindings.map((b) => (
              <tr key={b.role}>
                <td>
                  <span className="mono" style={{ fontWeight: 500 }}>
                    {b.role}
                  </span>
                </td>
                <td className="mono" style={{ color: 'var(--md-primary)' }}>
                  {b.model}
                </td>
                <td className="mono">{b.region}</td>
                <td className="mono dim" style={{ fontSize: 11.5 }}>
                  temperature {b.temp} · max_tokens {b.maxTokens}
                </td>
                <td>
                  {b.health === 'good' ? (
                    <span className="row" style={{ gap: 6 }}>
                      <StatusDot status="good" pulse />
                      <span className="mono dim" style={{ fontSize: 11.5 }}>
                        OK
                      </span>
                    </span>
                  ) : (
                    <span className="row" style={{ gap: 6 }}>
                      <StatusDot status="warn" />
                      <span className="mono dim" style={{ fontSize: 11.5 }}>
                        degraded
                      </span>
                    </span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setOverride(true);
                      snackbar.show({
                        msg: 'Session override set · X-LLM-Override applied',
                      });
                    }}
                  >
                    Rebind for session
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Provider health" right="ping every 30s">
        <table className="tbl">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Region</th>
              <th>Latency</th>
              <th>Error %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.providers.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="mono" style={{ fontWeight: 500 }}>
                    {p.id}
                  </span>
                </td>
                <td className="mono">{p.region}</td>
                <td className="num">{p.latency ? `${p.latency}ms` : '—'}</td>
                <td className="num">{p.error}%</td>
                <td>
                  {p.status === 'good' ? (
                    <Pill kind="good">healthy</Pill>
                  ) : (
                    <Pill kind="warn">unreachable</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
