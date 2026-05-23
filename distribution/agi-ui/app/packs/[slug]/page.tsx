// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, Icon, Pill, SideEffectPill } from '../../components/m3';
import { DATA } from '../../mock/data';
import palette from '../../mock/palette.json';

const EVENT_COLOR: Record<string, string> = {
  primary: 'var(--md-primary)',
  tertiary: 'var(--md-tertiary)',
  warning: 'var(--md-warning)',
  error: 'var(--md-error)',
};

export default function PackOverviewScreen() {
  const params = useParams<{ slug: string }>();
  const p = DATA.packs.find((x) => x.slug === params?.slug);
  if (!p) return null;
  const totalEvents = p.events24h.tool + p.events24h.llm + p.events24h.error + p.events24h.handoff;
  const bar = (n: number, kind: string) => (
    <div className="row" style={{ gap: 8 }}>
      <div className="bar" style={{ width: 120 }}>
        <div
          style={{
            width: `${(n / Math.max(totalEvents, 1)) * 100}%`,
            height: '100%',
            background: EVENT_COLOR[kind] ?? 'var(--md-primary)',
            borderRadius: 4,
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          minWidth: 40,
          textAlign: 'right',
          color: 'var(--md-on-surface-variant)',
        }}
      >
        {n}
      </span>
    </div>
  );

  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Theme preview" right="from pack.yaml">
          <div className="theme-tile">
            <div className="preview" style={{ background: p.primary }} />
            <div className="meta">
              <div>
                <strong>theme.primary</strong> &nbsp;
                <span style={{ color: 'var(--md-on-surface)' }}>{p.primary}</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>theme.foreground</strong> &nbsp;
                <span className="mono">{palette.foreground}</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>theme.radius</strong> &nbsp;
                <span className="mono">{palette.radius}</span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  color: 'var(--md-on-surface-variant)',
                  fontSize: 11,
                }}
              >
                Console chrome stays neutral. This is preview-only.
              </div>
            </div>
          </div>
        </Card>

        <Card title="Model role bindings" right={<Link href="/llm">Manage →</Link>}>
          {Object.entries(p.roles).map(([role, model]) => (
            <div
              key={role}
              className="row between"
              style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--md-outline-variant)',
              }}
            >
              <div className="row" style={{ gap: 10 }}>
                <span
                  className="mono"
                  style={{ minWidth: 78, color: 'var(--md-on-surface-variant)' }}
                >
                  {role}
                </span>
                <span className="mono">{model}</span>
              </div>
              <Pill kind="good">healthy</Pill>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid-side">
        <Card
          title="Allow-listed tools"
          right={<Link href={`/packs/${p.slug}/tools`}>{p.tools} tools →</Link>}
        >
          {DATA.tools
            .filter((t) => t.packs.includes(p.slug))
            .slice(0, 5)
            .map((t) => (
              <div
                key={t.name}
                className="row between"
                style={{
                  padding: '9px 0',
                  borderBottom: '1px solid var(--md-outline-variant)',
                }}
              >
                <div className="row" style={{ gap: 10 }}>
                  <span
                    className="mono"
                    style={{ color: 'var(--md-primary)', fontWeight: 500 }}
                  >
                    {t.name}
                  </span>
                  <SideEffectPill side={t.side} />
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {t.method} {t.path.length > 32 ? t.path.slice(0, 32) + '…' : t.path}
                </span>
              </div>
            ))}
        </Card>

        <Card title="Events · last 24h">
          <div className="stack" style={{ gap: 10 }}>
            <div className="row between">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--md-on-surface-variant)' }}
              >
                tool
              </span>
              {bar(p.events24h.tool, 'primary')}
            </div>
            <div className="row between">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--md-on-surface-variant)' }}
              >
                llm
              </span>
              {bar(p.events24h.llm, 'tertiary')}
            </div>
            <div className="row between">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--md-on-surface-variant)' }}
              >
                handoff
              </span>
              {bar(p.events24h.handoff, 'warning')}
            </div>
            <div className="row between">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--md-on-surface-variant)' }}
              >
                error
              </span>
              {bar(p.events24h.error, 'error')}
            </div>
            <div className="hr" />
            <Link
              className="row between"
              href={`/packs/${p.slug}/audit`}
              style={{ fontSize: 12.5 }}
            >
              <span>View AI-Trail</span>
              <Icon name="chev" size={13} />
            </Link>
          </div>
        </Card>
      </div>

      <Card title="Hotfix lane" right="GET /admin/packs/:slug/hotfix-status">
        <table className="tbl">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Author</th>
              <th>Merged</th>
              <th>Deployed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">pack-hotfix/refund-cap-50</td>
              <td>alex@example.org</td>
              <td className="mono">2026-05-22 11:02</td>
              <td className="mono">2026-05-22 11:14</td>
              <td>
                <Pill kind="good">live</Pill>
              </td>
            </tr>
            <tr>
              <td className="mono">pack-hotfix/roaming-kb-update</td>
              <td>ops@partner.example</td>
              <td className="mono">2026-05-20 09:18</td>
              <td className="mono">2026-05-20 09:32</td>
              <td>
                <Pill kind="good">live</Pill>
              </td>
            </tr>
            <tr>
              <td className="mono">pack-hotfix/escalation-matrix</td>
              <td>rachel.kim@example.org</td>
              <td className="mono">2026-05-15 14:04</td>
              <td className="mono">2026-05-15 14:18</td>
              <td>
                <Pill kind="good">live</Pill>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
