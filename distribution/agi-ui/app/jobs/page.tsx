// SPDX-License-Identifier: Apache-2.0
'use client';

import { useState } from 'react';
import {
  FilterChip,
  Icon,
  LinearProgress,
  Menu,
  Pill,
  ScreenHead,
  useSnackbar,
} from '../components/m3';
import { DATA } from '../mock/data';

const KIND_ICON: Record<string, string> = {
  kb_reindex: 'refresh',
  pack_reload: 'pack',
  hub_build: 'tool',
  scenario_run: 'play',
};
const KIND_LABEL: Record<string, string> = {
  kb_reindex: 'KB reindex',
  pack_reload: 'Pack reload',
  hub_build: 'Hub build',
  scenario_run: 'Scenario run',
};

export default function JobsScreen() {
  const d = DATA;
  const snackbar = useSnackbar();
  const [filter, setFilter] = useState('all');
  const filtered = d.jobs.filter((j) => filter === 'all' || j.status === filter);

  return (
    <div className="stack">
      <ScreenHead
        title="Jobs"
        lede="Background tasks initiated through the runtime — KB reindexes, pack reloads, hub builds, scenario runs. Progress is streamed via server-sent events."
        meta={`${d.jobs.filter((j) => j.status === 'running').length} running · ${
          d.jobs.filter((j) => j.status === 'succeeded').length
        } succeeded · ${d.jobs.filter((j) => j.status === 'failed').length} failed`}
        right={
          <button type="button" className="btn">
            <Icon name="refresh" size={18} /> Refresh
          </button>
        }
      />

      <div className="assist-row">
        {['all', 'running', 'succeeded', 'failed'].map((k) => (
          <FilterChip key={k} label={k} selected={filter === k} onClick={() => setFilter(k)} />
        ))}
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--md-on-surface-variant)',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {filtered.length} jobs
        </span>
      </div>

      <div className="m3-list">
        {filtered.map((j) => {
          const isRunning = j.status === 'running';
          const statusKind: 'primary' | 'success' | 'error' | 'secondary' =
            j.status === 'running'
              ? 'primary'
              : j.status === 'succeeded'
                ? 'success'
                : j.status === 'failed'
                  ? 'error'
                  : 'secondary';
          return (
            <div
              key={j.id}
              className="m3-list-item"
              style={{ alignItems: 'flex-start', paddingTop: 16, paddingBottom: 16 }}
            >
              <div className={`lead ${statusKind}`} style={{ marginTop: 2 }}>
                <Icon name={KIND_ICON[j.kind] ?? 'tool'} size={20} />
              </div>
              <div>
                <div className="head row" style={{ gap: 10 }}>
                  <span>
                    {KIND_LABEL[j.kind] ?? j.kind}{' '}
                    <span
                      className="mono"
                      style={{ color: 'var(--md-on-surface-variant)', fontWeight: 400 }}
                    >
                      · {j.pack}
                    </span>
                  </span>
                  {j.status === 'running' && <Pill kind="info">● running</Pill>}
                  {j.status === 'succeeded' && <Pill kind="good">✓ succeeded</Pill>}
                  {j.status === 'failed' && <Pill kind="bad">✕ failed</Pill>}
                  <span
                    className="mono"
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: 'var(--md-on-surface-variant)',
                    }}
                  >
                    {j.id}
                  </span>
                </div>
                <div className="supp" style={{ marginTop: 6 }}>
                  <div style={{ marginBottom: 6 }}>{j.logs}</div>
                  {isRunning && <LinearProgress value={j.progress} />}
                  <div
                    className="mono"
                    style={{ marginTop: 6, fontSize: 11, color: 'var(--md-outline)' }}
                  >
                    started {j.started}
                    {j.finished
                      ? ` · finished ${j.finished}`
                      : j.eta
                        ? ` · ETA ${j.eta}`
                        : ''}
                  </div>
                </div>
              </div>
              <div className="tail">
                <Menu
                  trigger={
                    <button type="button" className="icon-btn">
                      <Icon name="more" size={20} />
                    </button>
                  }
                  items={[
                    { icon: 'external', label: 'Open in Langfuse' },
                    {
                      icon: 'copy',
                      label: 'Copy job id',
                      onClick: () => snackbar.show({ msg: `Copied ${j.id}` }),
                    },
                    ...(isRunning ? [{ icon: 'x', label: 'Cancel job' }] : []),
                    ...(j.status === 'failed'
                      ? [
                          {
                            icon: 'refresh',
                            label: 'Retry',
                            onClick: () => snackbar.show({ msg: 'Retry queued' }),
                          },
                        ]
                      : []),
                    { divider: true },
                    { icon: 'log', label: 'View raw logs' },
                  ]}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
