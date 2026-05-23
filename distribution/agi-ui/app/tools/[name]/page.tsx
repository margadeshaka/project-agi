// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Card,
  Dialog,
  Empty,
  ExtendedFab,
  Icon,
  InputChip,
  Menu,
  Pill,
  ScreenHead,
  SideEffectPill,
  Switch,
  useSnackbar,
} from '../../components/m3';
import { DATA } from '../../mock/data';

const INPUT_SCHEMA = `{
  "type": "object",
  "required": ["account_id", "amount", "reason"],
  "properties": {
    "account_id": { "type": "string", "pattern": "^C-\\\\d{4,6}$" },
    "amount":     { "type": "number", "minimum": -500, "maximum": 500 },
    "reason":     { "type": "string", "minLength": 4, "maxLength": 200 },
    "reference":  { "type": "string", "format": "uuid" }
  }
}`;

const RESULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "adjustment_id":   { "type": "string" },
    "applied":         { "type": "boolean" },
    "dry_run":         { "type": "boolean" },
    "balance_after":   { "type": "number" }
  }
}`;

interface InvokeResult {
  status: number;
  cid: string;
  body: Record<string, unknown>;
}

export default function ToolDetailScreen() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const snackbar = useSnackbar();
  const name = params?.name ? decodeURIComponent(params.name) : '';
  const t = DATA.tools.find((x) => x.name === name);

  const [dryRun, setDryRun] = useState(t?.dryRun ?? true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [accountId, setAccountId] = useState('C-91823');
  const [amount, setAmount] = useState('-12.50');
  const [reason, setReason] = useState('Goodwill credit for service interruption');

  if (!t) {
    return (
      <Empty
        title="Tool not found"
        body={`No tool "${name}" in current hub bundle.`}
      />
    );
  }

  const doInvoke = () => {
    const cid = 'run-' + Math.random().toString(16).slice(2, 8);
    setResult({
      status: 200,
      cid,
      body: {
        adjustment_id: 'ADJ-77381',
        applied: !dryRun,
        dry_run: dryRun,
        account_id: accountId,
        delta: parseFloat(amount),
        balance_after: 144.1 + parseFloat(amount),
        ts: '2026-05-22T13:11:08Z',
      },
    });
    setConfirmOpen(false);
    snackbar.show({
      msg: dryRun ? 'Dry-run · 200 OK' : 'Invoked · 200 OK',
      actionLabel: 'VIEW',
      action: () => router.push(`/audit/${cid}`),
    });
  };

  const attemptInvoke = () => {
    if (t.side === 'write' && !dryRun) {
      setConfirmOpen(true);
      return;
    }
    doInvoke();
  };

  return (
    <div className="stack">
      <ScreenHead
        title={<span className="mono" style={{ color: 'var(--md-primary)' }}>{t.name}</span>}
        lede={t.desc}
        meta={`${t.method} ${t.path} · bundle ${t.bundle} · used by ${t.packs.length} pack${
          t.packs.length === 1 ? '' : 's'
        }`}
        right={
          <Menu
            trigger={
              <button type="button" className="icon-btn">
                <Icon name="settings" size={20} />
              </button>
            }
            items={[
              {
                icon: 'copy',
                label: 'Copy as MCP call',
                onClick: () => snackbar.show({ msg: 'Copied curl-shaped request' }),
              },
              { icon: 'download', label: 'Download JSON Schema' },
              { icon: 'external', label: 'View OpenAPI source' },
              { divider: true },
              { icon: 'x', label: 'Disable in pack' },
            ]}
          />
        }
      />

      <div className="grid-side">
        <div className="stack">
          <Card title="Schema · input">
            <pre className="code">{INPUT_SCHEMA}</pre>
          </Card>
          <Card title="Schema · result">
            <pre className="code">{RESULT_SCHEMA}</pre>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Test invoke"
            right={
              t.side === 'write' ? (
                <Pill kind="warn">⚠ side-effect</Pill>
              ) : (
                <Pill kind="good">read-only</Pill>
              )
            }
          >
            {t.side === 'write' && (
              <div
                className="row between"
                style={{
                  marginBottom: 16,
                  padding: '12px 14px',
                  background: 'var(--md-warning-container)',
                  color: 'var(--md-on-warning-container)',
                  borderRadius: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>Dry-run</div>
                  <div className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
                    Sends <code>X-Dry-Run: 1</code>
                  </div>
                </div>
                <Switch checked={dryRun} onChange={setDryRun} />
              </div>
            )}

            <div className="stack" style={{ gap: 14 }}>
              <div>
                <label className="muted mono" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  account_id <span style={{ color: 'var(--md-error)' }}>*</span>
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                />
              </div>
              <div>
                <label className="muted mono" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  amount <span style={{ color: 'var(--md-error)' }}>*</span>
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  style={{ width: '100%' }}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="muted mono" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  reason <span style={{ color: 'var(--md-error)' }}>*</span>
                </label>
                <textarea
                  className="input"
                  rows={2}
                  style={{ width: '100%', height: 'auto', paddingTop: 10, resize: 'vertical' }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <button type="button" className="btn primary" onClick={attemptInvoke}>
                <Icon name="play" size={16} /> {dryRun ? 'Dry-run invoke' : 'Invoke'}
              </button>
            </div>

            {result && (
              <div style={{ marginTop: 18 }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <Pill kind="good">{result.status} OK</Pill>
                  <a
                    className="mono"
                    style={{ fontSize: 12 }}
                    onClick={() => router.push(`/audit/${result.cid}`)}
                  >
                    {result.cid} →
                  </a>
                </div>
                <pre className="code">{JSON.stringify(result.body, null, 2)}</pre>
              </div>
            )}
          </Card>

          <Card title="Source" tight>
            <div className="stack" style={{ gap: 10, fontSize: 12.5 }}>
              <div>
                <span className="muted mono" style={{ fontSize: 11 }}>OPENAPI</span>
                <div className="mono">openapi/{t.domain}.yaml</div>
              </div>
              <div>
                <span className="muted mono" style={{ fontSize: 11 }}>OPERATION_ID</span>
                <div className="mono">{t.name.replace(/\./g, '')}</div>
              </div>
              <div>
                <span className="muted mono" style={{ fontSize: 11 }}>RATE-LIMIT CLASS</span>
                <div className="mono">{t.rate}</div>
              </div>
              <div>
                <span className="muted mono" style={{ fontSize: 11 }}>USED BY</span>
                <div className="assist-row">
                  {t.packs.map((p) => (
                    <InputChip key={p} lead={p[0].toUpperCase()} label={p} />
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        icon="info"
        title="Invoke for real?"
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <button type="button" className="btn text" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={doInvoke}>
              Yes, apply
            </button>
          </>
        }
      >
        This tool has <strong>side-effects</strong> and dry-run is OFF. Calling it will apply an
        adjustment of <strong>{amount}</strong> to account <strong>{accountId}</strong>. The action
        will be recorded in the AI-Trail.
      </Dialog>

      <ExtendedFab icon="play" label={dryRun ? 'Dry-run' : 'Invoke'} onClick={attemptInvoke} />
    </div>
  );
}
