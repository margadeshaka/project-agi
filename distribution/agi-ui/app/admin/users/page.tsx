// SPDX-License-Identifier: Apache-2.0
'use client';

import {
  Card,
  FilterChip,
  Icon,
  M3List,
  M3ListItem,
  Pill,
  ScreenHead,
} from '../../components/m3';
import { DATA } from '../../mock/data';

export default function AdminUsersScreen() {
  const d = DATA;
  return (
    <div className="stack">
      <ScreenHead
        title="Users"
        lede="Identities currently active in the deployment. User and scope provisioning lives in the configured OIDC issuer — this view is read-only."
        meta="source: oidc realms · refreshed every 60s"
        right={
          <a className="btn text" href="#">
            <Icon name="external" size={13} /> Open OIDC issuer
          </a>
        }
      />

      <div className="grid-4">
        <div className="kpi">
          <div className="label">Active sessions</div>
          <div className="value">{d.users.length}</div>
          <div className="delta">+2 this hour</div>
        </div>
        <div className="kpi">
          <div className="label">Admins</div>
          <div className="value">2</div>
        </div>
        <div className="kpi">
          <div className="label">Operators</div>
          <div className="value">2</div>
        </div>
        <div className="kpi">
          <div className="label">Devs / viewers</div>
          <div className="value">3</div>
        </div>
      </div>

      <Card
        title={`${d.users.length} active identities`}
        right={
          <button type="button" className="btn outlined sm">
            <Icon name="refresh" size={14} /> Refresh
          </button>
        }
      >
        <div className="assist-row" style={{ marginBottom: 14 }}>
          <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>
            Filter
          </span>
          <FilterChip label="all" selected />
          <FilterChip label="agi:admin" />
          <FilterChip label="agi:operator:*" />
          <FilterChip label="agi:dev" />
          <FilterChip label="agi:viewer" />
        </div>
        <M3List>
          {d.users.map((u) => {
            const primary = u.scopes[0];
            const kind = primary.startsWith('agi:admin')
              ? 'error'
              : primary.startsWith('agi:operator')
                ? 'warning'
                : primary === 'agi:dev'
                  ? 'primary'
                  : 'tertiary';
            return (
              <M3ListItem
                key={u.id}
                lead={u.initials}
                leadKind={kind as 'error' | 'warning' | 'primary' | 'tertiary'}
                headline={u.id}
                supporting={
                  <span className="assist-row" style={{ gap: 6 }}>
                    {u.scopes.map((s) => (
                      <Pill key={s}>{s}</Pill>
                    ))}
                    <span className="mono" style={{ fontSize: 11 }}>
                      · {u.source}
                    </span>
                  </span>
                }
                trailing={
                  <>
                    <div>{u.lastSeen}</div>
                    <span className="meta">last seen</span>
                  </>
                }
              />
            );
          })}
        </M3List>
      </Card>
    </div>
  );
}
