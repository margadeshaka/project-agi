// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Card,
  Icon,
  M3List,
  M3ListItem,
  Pill,
  ScreenHead,
  Switch,
  useSnackbar,
} from '../components/m3';
import { DATA } from '../mock/data';

export default function ProfileScreen() {
  const d = DATA;
  const snackbar = useSnackbar();
  const user = d.user.admin;
  const [emailNotif, setEmailNotif] = useState(true);
  const [browserNotif, setBrowserNotif] = useState(false);
  const [defaultPack, setDefaultPack] = useState('support-demo');

  return (
    <div className="stack">
      <ScreenHead
        title="Profile"
        lede="Your account, API keys, sessions, and notification preferences."
        meta={`Signed in as ${user.id} · ${user.persona}`}
      />

      <div className="grid-side">
        <div className="stack">
          <Card title="Account" className="filled">
            <div className="row" style={{ gap: 18, marginBottom: 18 }}>
              <div className="avatar" style={{ width: 72, height: 72, fontSize: 24 }}>
                {user.initials}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                  {user.id}
                </div>
                <div className="muted mono" style={{ fontSize: 12, marginTop: 2 }}>
                  {user.persona}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  {user.scopes.map((s) => (
                    <Pill key={s} kind="accent">
                      {s}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
            <div className="hr" />
            <div className="stack" style={{ gap: 14, marginTop: 16 }}>
              <div className="row between">
                <div>
                  <div className="t-label-large">Default pack</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Auto-open this pack after sign-in.
                  </div>
                </div>
                <select
                  className="select"
                  value={defaultPack}
                  onChange={(e) => setDefaultPack(e.target.value)}
                >
                  {d.packs.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row between">
                <div>
                  <div className="t-label-large">Email notifications</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Failed jobs, error spikes, deploy events.
                  </div>
                </div>
                <Switch checked={emailNotif} onChange={setEmailNotif} />
              </div>
              <div className="row between">
                <div>
                  <div className="t-label-large">Browser notifications</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Desktop alerts while the console is open.
                  </div>
                </div>
                <Switch checked={browserNotif} onChange={setBrowserNotif} />
              </div>
            </div>
          </Card>

          <Card
            title="API keys"
            right={
              <button type="button" className="btn sm">
                <Icon name="plus" size={16} /> Create key
              </button>
            }
          >
            <M3List>
              {d.apiKeys.map((k) => (
                <M3ListItem
                  key={k.id}
                  lead={<Icon name="settings" size={20} />}
                  leadKind="tertiary"
                  headline={k.name}
                  supporting={
                    <>
                      <span className="mono">{k.prefix}</span> · created {k.created} ·{' '}
                      {k.scopes.join(', ')}
                    </>
                  }
                  trailing={
                    <>
                      <div>last used {k.lastUsed}</div>
                      <span className="meta">
                        <a onClick={() => snackbar.show({ msg: `Revoked ${k.name}` })}>revoke</a>
                      </span>
                    </>
                  }
                />
              ))}
            </M3List>
          </Card>

          <Card title="Active sessions">
            <M3List>
              {d.sessions.map((s) => (
                <M3ListItem
                  key={s.id}
                  lead={<Icon name="cpu" size={20} />}
                  leadKind={s.current ? 'primary' : 'secondary'}
                  headline={s.device}
                  supporting={`${s.location} · last active ${s.lastActive}`}
                  trailing={
                    s.current ? (
                      <Pill kind="good">this session</Pill>
                    ) : (
                      <a
                        onClick={() => snackbar.show({ msg: `Session ${s.id} revoked` })}
                        style={{ color: 'var(--md-error)' }}
                      >
                        revoke
                      </a>
                    )
                  }
                />
              ))}
            </M3List>
          </Card>
        </div>

        <div className="stack">
          <Card title="Recent activity" tight>
            <div className="stack" style={{ gap: 10, fontSize: 13 }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon name="check" size={16} style={{ color: 'var(--md-success)', marginTop: 2 }} />
                <div>
                  <div>
                    Reloaded pack <Link href="/packs/support-demo">support-demo</Link>
                  </div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    13:14 today
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon
                  name="upload"
                  size={16}
                  style={{ color: 'var(--md-on-surface-variant)', marginTop: 2 }}
                />
                <div>
                  <div>
                    Uploaded KB article <em>Refund policy</em>
                  </div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    12:42 today
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon
                  name="play"
                  size={16}
                  style={{ color: 'var(--md-on-surface-variant)', marginTop: 2 }}
                />
                <div>
                  <div>
                    Test-invoked <span className="mono">billing.list_invoices</span>
                  </div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    09:14 today
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon
                  name="settings"
                  size={16}
                  style={{ color: 'var(--md-on-surface-variant)', marginTop: 2 }}
                />
                <div>
                  <div>Set session LLM override</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    yesterday
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Danger zone" tight>
            <div className="stack" style={{ gap: 10 }}>
              <button type="button" className="btn outlined" style={{ width: '100%' }}>
                Sign out
              </button>
              <button type="button" className="btn danger" style={{ width: '100%' }}>
                Revoke all sessions
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
