// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * Sidebar — Material Design 3 navigation drawer.
 *
 * - 272-px wide rail (matches `.app` grid in globals.css).
 * - Each item is a 56-px full-pill row with state-layer hover; active rows lift to
 *   `--md-secondary-container` and switch icons to FILL=1.
 * - Items the user lacks scope for are hidden (FR-IA-01), never greyed.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './m3';
import { DATA } from '../mock/data';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  scopes?: string[];
  needsOperator?: boolean;
}

const PLATFORM: NavItem[] = [
  { href: '/', label: 'Health', icon: 'health' },
  { href: '/metrics', label: 'Metrics', icon: 'spark', scopes: ['agi:admin', 'agi:dev'] },
  {
    href: '/packs',
    label: 'Packs',
    icon: 'pack',
    badge: 4,
    scopes: ['agi:admin'],
    needsOperator: true,
  },
  { href: '/tools', label: 'Tools', icon: 'tool', badge: 15, scopes: ['agi:admin', 'agi:dev'] },
  { href: '/use-cases', label: 'Use cases', icon: 'usecase', scopes: ['agi:admin'] },
  { href: '/audit', label: 'AI-Trail', icon: 'audit' },
  { href: '/jobs', label: 'Jobs', icon: 'cpu', scopes: ['agi:admin'] },
  { href: '/llm', label: 'LLM', icon: 'llm', scopes: ['agi:admin'] },
];

const ADMIN: NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: 'user', scopes: ['agi:admin'] },
  { href: '/admin/log', label: 'Admin log', icon: 'log' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', scopes: ['agi:admin'] },
];

function visibleFor(item: NavItem, scopes: string[]): boolean {
  if (!item.scopes) return true;
  if (item.scopes.some((s) => scopes.includes(s))) return true;
  if (item.needsOperator && scopes.some((s) => s.startsWith('agi:operator:'))) return true;
  return false;
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const user = DATA.user.admin;
  const scopes = user.scopes;
  const showAdmin = scopes.includes('agi:admin');

  const renderItem = (item: NavItem) => {
    const isActive =
      pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`rail-item ${isActive ? 'active' : ''}`.trim()}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon name={item.icon} />
        {item.label}
        {item.badge != null && <span className="badge">{item.badge}</span>}
      </Link>
    );
  };

  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="rail-logo" />
        <div>
          <div className="rail-title">project-agi</div>
          <div className="rail-subtitle">
            {DATA.env.deploy} · {DATA.env.version}
          </div>
        </div>
      </div>
      <nav className="rail-nav" aria-label="Primary">
        <div className="rail-env">Platform</div>
        {PLATFORM.filter((n) => visibleFor(n, scopes)).map(renderItem)}
        {showAdmin && (
          <>
            <div className="rail-env" style={{ marginTop: 14 }}>
              Admin
            </div>
            {ADMIN.filter((n) => visibleFor(n, scopes)).map(renderItem)}
          </>
        )}
      </nav>
      <div className="rail-footer">
        <div className="avatar">{user.initials}</div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div className="who">{user.id}</div>
          <div className="role">{user.persona}</div>
        </div>
      </div>
    </aside>
  );
}
