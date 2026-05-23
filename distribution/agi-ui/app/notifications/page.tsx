// SPDX-License-Identifier: Apache-2.0
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterChip, Icon, Menu, ScreenHead, useSnackbar } from '../components/m3';
import { DATA } from '../mock/data';

const KIND_CLASS: Record<string, 'tertiary' | 'warning' | 'error' | 'success' | 'secondary'> = {
  warn: 'warning',
  error: 'error',
  success: 'success',
  info: 'tertiary',
};

export default function NotificationsScreen() {
  const d = DATA;
  const router = useRouter();
  const snackbar = useSnackbar();
  const [filter, setFilter] = useState('all');
  const [unread, setUnread] = useState<Set<string>>(
    new Set(d.notifications.filter((n) => n.unread).map((n) => n.id)),
  );

  const filtered = d.notifications.filter(
    (n) =>
      filter === 'all' ||
      (filter === 'unread' && unread.has(n.id)) ||
      filter === n.kind,
  );
  const unreadCount = unread.size;

  return (
    <div className="stack">
      <ScreenHead
        title="Notifications"
        lede="Alerts from the deployment — provider health, error rates, deploys, identity changes. Read receipts are local to this browser."
        meta={`${unreadCount} unread · ${d.notifications.length} total`}
        right={
          <>
            <button type="button" className="btn outlined" onClick={() => setUnread(new Set())}>
              <Icon name="check" size={18} /> Mark all read
            </button>
            <button type="button" className="btn text" onClick={() => router.push('/profile')}>
              <Icon name="settings" size={18} /> Preferences
            </button>
          </>
        }
      />

      <div className="assist-row">
        <FilterChip
          label={`all · ${d.notifications.length}`}
          selected={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          label={`unread · ${unreadCount}`}
          selected={filter === 'unread'}
          onClick={() => setFilter('unread')}
        />
        <FilterChip
          label="errors"
          selected={filter === 'error'}
          onClick={() => setFilter('error')}
        />
        <FilterChip
          label="warnings"
          selected={filter === 'warn'}
          onClick={() => setFilter('warn')}
        />
        <FilterChip label="info" selected={filter === 'info'} onClick={() => setFilter('info')} />
        <FilterChip
          label="success"
          selected={filter === 'success'}
          onClick={() => setFilter('success')}
        />
      </div>

      <div className="m3-list">
        {filtered.map((n) => {
          const isUnread = unread.has(n.id);
          return (
            <div
              key={n.id}
              className="m3-list-item"
              style={{
                alignItems: 'flex-start',
                paddingTop: 16,
                paddingBottom: 16,
                background: isUnread ? 'var(--md-surface-container-low)' : 'transparent',
              }}
              onClick={() => {
                const s = new Set(unread);
                s.delete(n.id);
                setUnread(s);
              }}
            >
              <div className={`lead ${KIND_CLASS[n.kind] ?? 'secondary'}`} style={{ marginTop: 2 }}>
                <Icon name={n.icon} size={20} fill={n.kind === 'error' || n.kind === 'warn'} />
              </div>
              <div>
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <span className="head" style={{ fontWeight: isUnread ? 600 : 500 }}>
                    {n.title}
                  </span>
                  {isUnread && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--md-primary)',
                      }}
                    />
                  )}
                </div>
                <div className="supp" style={{ marginTop: 4 }}>
                  {n.body}
                </div>
              </div>
              <div className="tail">
                <div>{n.ts}</div>
                <Menu
                  trigger={
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 32, height: 32 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name="more" size={18} />
                    </button>
                  }
                  items={[
                    {
                      icon: 'check',
                      label: isUnread ? 'Mark read' : 'Mark unread',
                      onClick: () => {
                        const s = new Set(unread);
                        if (isUnread) {
                          s.delete(n.id);
                        } else {
                          s.add(n.id);
                        }
                        setUnread(s);
                      },
                    },
                    {
                      icon: 'x',
                      label: 'Dismiss',
                      onClick: () => snackbar.show({ msg: 'Notification dismissed' }),
                    },
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
