// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FilterChip, Icon, SegmentedButton } from './m3';
import { DATA, type AuditEvent } from '../mock/data';

interface Props {
  scopedPack?: string;
}

const PACK_OPTIONS = ['any', 'starter', 'support-demo', 'fleet-demo', 'research-demo'];
const EVENT_OPTIONS = [
  'any',
  'tool_call',
  'tool_result',
  'llm_request',
  'llm_response',
  'handoff',
  'error',
];

export function AuditList({ scopedPack }: Props) {
  const [pack, setPack] = useState(scopedPack ?? 'any');
  const [event, setEvent] = useState('any');
  const [range, setRange] = useState('24h');
  const [side, setSide] = useState('any');

  const events = useMemo(
    () =>
      DATA.audit.filter(
        (e) =>
          (pack === 'any' || e.pack === pack) &&
          (event === 'any' || e.event === event) &&
          (side === 'any' || e.side === side),
      ),
    [pack, event, side],
  );

  return (
    <div className="tbl-wrap">
      <div
        className="filterbar"
        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}
      >
        <div className="assist-row">
          <span className="muted" style={{ fontSize: 12, minWidth: 56 }}>
            Range
          </span>
          <SegmentedButton value={range} options={['24h', '7d', '30d']} onChange={setRange} />
          <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
            Side
          </span>
          <SegmentedButton
            value={side}
            options={[
              { value: 'any', label: 'any' },
              { value: 'read', label: 'read' },
              { value: 'write', label: 'write' },
            ]}
            onChange={setSide}
          />
        </div>
        {!scopedPack && (
          <div className="assist-row">
            <span className="muted" style={{ fontSize: 12, minWidth: 56 }}>
              Pack
            </span>
            {PACK_OPTIONS.map((p) => (
              <FilterChip
                key={p}
                label={p}
                selected={pack === p}
                onClick={() => setPack(p)}
              />
            ))}
          </div>
        )}
        <div className="assist-row">
          <span className="muted" style={{ fontSize: 12, minWidth: 56 }}>
            Event
          </span>
          {EVENT_OPTIONS.map((ev) => (
            <FilterChip
              key={ev}
              label={ev}
              selected={event === ev}
              onClick={() => setEvent(ev)}
            />
          ))}
        </div>
        <div className="row between" style={{ width: '100%' }}>
          <button type="button" className="btn outlined sm">
            <Icon name="download" size={14} /> Export CSV
          </button>
          <span
            className="muted"
            style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
          >
            {events.length.toLocaleString()} of {DATA.audit.length} events
          </span>
        </div>
      </div>

      <div className="tree">
        <div
          className="tree-row"
          style={{
            background: 'var(--md-surface-container)',
            borderBottom: '1px solid var(--md-outline-variant)',
            color: 'var(--md-on-surface-variant)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          <div></div>
          <div>TIME</div>
          <div>EVENT</div>
          <div>TARGET / DETAIL</div>
          <div className="right">CORRELATION</div>
        </div>
        {events.map((e: AuditEvent, i) => (
          <Link key={i} href={`/audit/${e.cid}`} className="tree-row" style={{ color: 'inherit' }}>
            <div>
              {e.side === 'write' ? (
                <span className="dot bad" />
              ) : e.event === 'error' ? (
                <span className="dot bad" />
              ) : e.event === 'handoff' ? (
                <span className="dot warn" />
              ) : (
                <span className="dot good" />
              )}
            </div>
            <div className="ts">{e.ts}</div>
            <div className={`ev ${e.event}`}>{e.event}</div>
            <div className="target">
              <span className="target">{e.target}</span>
              {!scopedPack && (
                <span
                  className="mono"
                  style={{
                    marginLeft: 8,
                    color: 'var(--md-on-surface-variant)',
                    fontSize: 11,
                  }}
                >
                  · {e.pack}
                </span>
              )}
              {e.note && (
                <span
                  className="mono"
                  style={{
                    marginLeft: 8,
                    color: 'var(--md-on-surface-variant)',
                    fontSize: 11,
                  }}
                >
                  · {e.note}
                </span>
              )}
            </div>
            <div className="right mono">{e.cid}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
