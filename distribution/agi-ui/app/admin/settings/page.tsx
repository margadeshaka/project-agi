// SPDX-License-Identifier: Apache-2.0
'use client';

import { Card, Icon, Pill, ScreenHead } from '../../components/m3';
import { DATA } from '../../mock/data';

export default function AdminSettingsScreen() {
  const s = DATA.settings;
  return (
    <div className="stack">
      <ScreenHead
        title="Operator settings"
        lede="Operator-level configuration. All values come from operator.yaml at boot. The console renders them read-only; edits are PR-driven."
        meta="source: /etc/agi/operator.yaml · checksum sha256:c4f1…"
        right={
          <a className="btn" href="#">
            <Icon name="external" size={13} /> Open operator.yaml in repo
          </a>
        }
      />

      <div className="grid-side">
        <Card title="Resolved configuration" right={<span className="mono dim">read-only</span>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s).map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <span className="mono" style={{ color: 'var(--md-primary)' }}>
                      {k}
                    </span>
                  </td>
                  <td className="mono">{v}</td>
                  <td className="mono dim" style={{ fontSize: 11 }}>
                    operator.yaml § {k.split('_')[1]?.toLowerCase() ?? 'core'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="stack">
          <Card title="Auth mode" tight>
            <div className="stack" style={{ gap: 8, fontSize: 12.5 }}>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>MODE</span>
                <Pill kind="good">{s.AGI_AUTH_MODE}</Pill>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>ENV</span>
                <Pill kind="info">{s.AGI_ENV}</Pill>
              </div>
              <div className="hr" />
              <div className="dim" style={{ fontSize: 11.5 }}>
                <Icon name="info" size={12} /> dev-noop mode is refused when AGI_ENV=production.
              </div>
            </div>
          </Card>

          <Card title="Health pings" tight>
            <div className="stack" style={{ gap: 6, fontSize: 12.5 }}>
              <div className="row between">
                <span>Runtime</span>
                <Pill kind="good">12ms</Pill>
              </div>
              <div className="row between">
                <span>Qdrant</span>
                <Pill kind="good">8ms</Pill>
              </div>
              <div className="row between">
                <span>OIDC issuer</span>
                <Pill kind="good">22ms</Pill>
              </div>
              <div className="row between">
                <span>Langfuse</span>
                <Pill kind="good">31ms</Pill>
              </div>
            </div>
          </Card>

          <Card title="Telemetry" tight>
            <div className="stack" style={{ gap: 6, fontSize: 12.5 }}>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>SAMPLING</span>
                <span className="mono">10%</span>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>EXPORTER</span>
                <span className="mono">otlp/grpc</span>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>RETENTION</span>
                <span className="mono">30d</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
