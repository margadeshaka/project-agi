// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * M3 navigation drawer.
 *
 * Per Material Design 3 spec: each item is a 44px full-pill row with a
 * state-layer background that lifts to `--md-secondary-container` when
 * active. The leading icon is purely affordance; the label carries semantic
 * weight.
 *
 * Role-aware filtering (FR-IA-01) — items the user lacks scope for are
 * HIDDEN, not greyed. Server-side enforcement still happens at the runtime;
 * UI hiding is for clean affordance, never the security boundary
 * (FR-AUTH-02).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useScopes } from './auth-provider';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  /** Leading icon glyph (emoji or single-character SVG-less placeholder). */
  icon?: string;
  /** scopes required (any one matches). Empty = visible to all signed-in users. */
  scopes?: string[];
  /** Optional regex match for operator-scoped slugs (matches any agi:operator:*). */
  needsOperator?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Health', icon: '◉', scopes: ['agi:admin', 'agi:dev', 'agi:viewer'] },
  { href: '/packs', label: 'Packs', icon: '▦', scopes: ['agi:admin'], needsOperator: true },
  { href: '/tools', label: 'Tools', icon: '◇', scopes: ['agi:dev', 'agi:admin'] },
  { href: '/use-cases', label: 'Use cases', icon: '◍', scopes: ['agi:admin'] },
  { href: '/audit', label: 'Audit', icon: '≣', scopes: ['agi:viewer', 'agi:dev', 'agi:admin'] },
  { href: '/llm', label: 'LLM', icon: '◐', scopes: ['agi:admin'] },
];

const ADMIN_SUB: NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: '◯', scopes: ['agi:admin'] },
  { href: '/admin/log', label: 'Log', icon: '☰', scopes: ['agi:admin'] },
  { href: '/admin/settings', label: 'Settings', icon: '⚙', scopes: ['agi:admin'] },
];

function visible(item: NavItem, scopes: string[]): boolean {
  if (!item.scopes || item.scopes.length === 0) return true;
  if (item.scopes.some((s) => scopes.includes(s))) return true;
  if (item.needsOperator && scopes.some((s) => s.startsWith('agi:operator:'))) {
    return true;
  }
  return false;
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const scopes = useScopes();
  const showAdmin = scopes.includes('agi:admin');

  const renderItem = (item: NavItem) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group flex h-11 items-center gap-3 rounded-full px-4 text-[13.5px] font-medium tracking-wide transition-colors',
          isActive
            ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
            : 'text-[var(--md-on-surface-variant)] hover:bg-[var(--md-on-surface)]/8 hover:text-[var(--md-on-surface)]',
        )}
      >
        {item.icon && (
          <span aria-hidden className="text-base leading-none">
            {item.icon}
          </span>
        )}
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto p-3"
      style={{ background: 'var(--md-surface-container-low)' }}
    >
      <div className="flex items-center gap-3 px-2 pb-3 pt-4">
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-xl"
          style={{
            background:
              'radial-gradient(circle at 32% 30%, var(--md-tertiary), transparent 55%), linear-gradient(135deg, var(--md-primary), var(--md-primary-container))',
            color: 'var(--md-on-primary)',
          }}
        >
          <span
            className="h-3.5 w-3.5 rounded-full"
            style={{ background: 'var(--md-on-primary)', opacity: 0.92 }}
          />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-medium tracking-tight">project-agi</span>
          <span
            className="font-mono text-[11.5px]"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            admin console
          </span>
        </span>
      </div>

      {NAV.filter((n) => visible(n, scopes)).map(renderItem)}

      {showAdmin && (
        <>
          <div
            className="mb-1.5 mt-5 px-4 text-[11px] font-medium tracking-wide"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            Admin
          </div>
          {ADMIN_SUB.filter((n) => visible(n, scopes)).map(renderItem)}
        </>
      )}
    </nav>
  );
}
