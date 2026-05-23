// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, Empty, Icon, Pill, ScreenHead, useSnackbar } from '../../components/m3';
import { DATA } from '../../mock/data';

const PAYLOADS: Record<string, string> = {
  'tool_call:billing.adjust_charge': `{
  "tool": "billing.adjust_charge",
  "args": {
    "account_id": "C-91823",
    "amount": -12.50,
    "reason": "Goodwill credit for service interruption",
    "reference": "f4c2a8e1-7d3b-4a91-b8e2-1d9c4a5f8e21"
  },
  "X-Dry-Run": false,
  "scope": "agi:operator:support-demo"
}`,
  'tool_result:billing.list_invoices': `{
  "status": 200,
  "elapsed_ms": 184,
  "result": {
    "count": 1,
    "invoices": [
      {
        "invoice_id": "INV-77381",
        "amount_due": 156.60,
        "currency": "USD",
        "due_date": "2026-06-05"
      }
    ]
  }
}`,
  'tool_call:billing.list_invoices': `{
  "tool": "billing.list_invoices",
  "args": { "account_id": "C-91823", "limit": 5 },
  "scope": "agi:operator:support-demo"
}`,
  'llm_request:openai/gpt-4o': `{
  "model": "openai/gpt-4o",
  "messages": [
    { "role": "system", "content": "[SYSTEM PROMPT · packs/support-demo/system.reasoner.md @ build-7c34]" },
    { "role": "user",   "content": "Why was my invoice 12.50 higher this month?" }
  ],
  "temperature": 0.3,
  "max_tokens": 4096
}`,
  'llm_response:openai/gpt-4o': `{
  "model": "openai/gpt-4o",
  "tokens": { "in": 142, "out": 84, "total": 226 },
  "stop_reason": "end_turn",
  "cost_usd": 0.00284,
  "content": "I see an add-on seats charge of 12.50 on invoice INV-77381..."
}`,
};

export default function AuditDetailScreen() {
  const params = useParams<{ correlation_id: string }>();
  const cid = params?.correlation_id;
  const snackbar = useSnackbar();
  const [selected, setSelected] = useState(0);

  const matched = DATA.audit.filter((e) => e.cid === cid);
  const events = matched.length > 0 ? matched : DATA.audit.slice(0, 1);
  const ev = events[selected];
  if (!cid || !ev) {
    return <Empty title="Correlation not found" body="No event with this correlation_id." />;
  }

  const payload =
    PAYLOADS[`${ev.event}:${ev.target}`] ??
    `{
  "event": "${ev.event}",
  "target": "${ev.target}",
  "ts": "${ev.date}T${ev.ts}Z",
  "note": "${ev.note}"
}`;

  return (
    <div className="stack">
      <ScreenHead
        title={<span className="mono">{cid}</span>}
        lede={`Agent run · ${events[0].pack} · ${events.length} events · session sess-XYZ`}
        meta={`Started ${events[events.length - 1]?.ts ?? '—'} · ended ${events[0]?.ts ?? '—'} · ${events[0].date}`}
        right={
          <>
            <a className="btn text" href="#">
              <Icon name="external" size={13} /> Open in Langfuse
            </a>
            <button
              type="button"
              className="btn"
              onClick={() =>
                snackbar.show({ msg: 'Correlation_id copied to clipboard' })
              }
            >
              <Icon name="copy" /> Copy correlation_id
            </button>
          </>
        }
      />

      <div className="grid-side">
        <Card title="Event tree" right={`${events.length} events`}>
          <div className="tree">
            {events.map((e, i) => (
              <div
                key={i}
                className={`tree-row ${i === selected ? 'selected' : ''}`.trim()}
                onClick={() => setSelected(i)}
              >
                <div>
                  {e.side === 'write' ? (
                    <span className="dot bad" />
                  ) : e.event === 'error' ? (
                    <span className="dot bad" />
                  ) : (
                    <span className="dot good" />
                  )}
                </div>
                <div className="ts">{e.ts}</div>
                <div className={`ev ${e.event}`}>{e.event}</div>
                <div className="target">
                  {e.target}
                  <span
                    className="mono"
                    style={{
                      marginLeft: 8,
                      color: 'var(--md-on-surface-variant)',
                      fontSize: 11,
                    }}
                  >
                    {e.note && `· ${e.note}`}
                  </span>
                </div>
                <div className="right mono">{i === 0 ? '↓' : `+${i}s`}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card
            title={`Payload · ${ev.event}`}
            right={
              <button
                type="button"
                className="btn sm"
                onClick={() => snackbar.show({ msg: 'Payload copied to clipboard' })}
              >
                <Icon name="copy" size={11} /> Copy
              </button>
            }
          >
            <pre className="code" style={{ maxHeight: 320 }}>
              {payload}
            </pre>
          </Card>

          <Card title="Run summary" tight>
            <div className="stack" style={{ gap: 8, fontSize: 12.5 }}>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>
                  DURATION
                </span>
                <span className="mono">7.2s</span>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>
                  TOKENS IN/OUT
                </span>
                <span className="mono">142 / 84</span>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>
                  COST (USD)
                </span>
                <span className="mono">$0.0028</span>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>
                  SIDE-EFFECTS
                </span>
                <Pill kind="warn">1 write</Pill>
              </div>
              <div className="row between">
                <span className="dim mono" style={{ fontSize: 11 }}>
                  RESULT
                </span>
                <Pill kind="good">success</Pill>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
