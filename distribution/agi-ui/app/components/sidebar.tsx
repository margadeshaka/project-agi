// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * M3 navigation drawer.
 *
 * Per Material Design 3 spec: each item is a 44px full-pill row with a
 * state-layer background that lifts to `--md-secondary-container` when
 * active. The leading icon is purely affordance; the label carries
 * semantic weight.
 *
 * Role-aware filtering (FR-IA-01) — items the user lacks scope for are
 * HIDDEN, not greyed (ADMIN_CONSOLE §5). Server-side enforcement still
 * happens at the runtime; UI hiding is for clean affordance, never the
 * security boundary (FR-AUTH-02).
 *
 * Scope rules — see ADMIN_CONSOLE §5 RBAC matrix:
 *
 *   Item       | Visible to scopes (any one matches)
 *   -----------+------------------------------------------------------
 *   Health     | every signed-in user
 *   Packs      | agi:admin | agi:viewer | agi:operator:<any-slug>
 *   Tools      | agi:admin | agi:viewer
 *   Use cases  | agi:admin | agi:viewer | agi:dev | agi:operator:<any>
 *   Audit      | agi:admin | agi:viewer
 *   LLM        | agi:admin | agi:viewer
 *   Admin      | agi:admin only (sub-routes: Log, Users, Settings)
 *
 * The operator role intentionally has access to Packs + Use cases for
 * its own slug; the runtime authorises the per-pack data anyway, so a
 * stray click hits a 403 we render via ForbiddenState rather than
 * leaking content.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useScopes } from './auth-provider';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  /** Leading icon glyph (single character — emoji- or geometric-style). */
  icon?: string;
  /** Scopes required (any one matches). Empty/undefined = visible to all signed-in users. */
  scopes?: string[];
  /** When set, any `agi:operator:<slug>` scope also grants visibility. */
  allowOperator?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Health', icon: '◉' /* visible to all signed-in users */ },
  {
    href: '/packs',
    label: 'Packs',
    icon: '▦',
    scopes: ['agi:admin', 'agi:viewer'],
    allowOperator: true,
  },
  { href: '/tools', label: 'Tools', icon: '◇', scopes: ['agi:admin', 'agi:viewer'] },
  {
    href: '/use-cases',
    label: 'Use cases',
    icon: '◍',
    scopes: ['agi:admin', 'agi:viewer', 'agi:dev'],
    allowOperator: true,
  },
  { href: '/audit', label: 'Audit', icon: '≣', scopes: ['agi:admin', 'agi:viewer'] },
  { href: '/llm', label: 'LLM', icon: '◐', scopes: ['agi:admin', 'agi:viewer'] },
];

const ADMIN_SUB: NavItem[] = [
  { href: '/admin/log', label: 'Log', icon: '☰', scopes: ['agi:admin'] },
  { href: '/admin/users', label: 'Users', icon: '◯', scopes: ['agi:admin'] },
  { href: '/admin/settings', label: 'Settings', icon: '⚙', scopes: ['agi:admin'] },
];

/** Returns true if the user's scope set should see this nav item. */
export function isVisible(item: NavItem, scopes: readonly string[]): boolean {
  if (!item.scopes || item.scopes.length === 0) {
    // Items without an explicit scope list are visible to every signed-in user.
    if (!item.allowOperator) return true;
  }
  if (item.scopes?.some((s) => scopes.includes(s))) return true;
  if (item.allowOperator && scopes.some((s) => s.startsWith('agi:operator:'))) return true;
  return false;
}

/** Active when the current path matches the item exactly, or is a sub-route. */
function isActiveFor(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const scopes = useScopes();
  const showAdmin = scopes.includes('agi:admin');

  const renderItem = (item: NavItem) => {
    const active = isActiveFor(item.href, pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        data-testid={`nav-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          'group flex h-11 items-center gap-3 rounded-full px-4 text-[13.5px] font-medium tracking-wide transition-colors',
          active
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

  const visibleTop = NAV.filter((n) => isVisible(n, scopes));
  const visibleAdmin = showAdmin ? ADMIN_SUB.filter((n) => isVisible(n, scopes)) : [];

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

      {visibleTop.map(renderItem)}

      {showAdmin && visibleAdmin.length > 0 && (
        <>
          <div
            className="mb-1.5 mt-5 px-4 text-[11px] font-medium tracking-wide"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            Admin
          </div>
          {visibleAdmin.map(renderItem)}
        </>
      )}
    </nav>
  );
}
