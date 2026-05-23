// SPDX-License-Identifier: Apache-2.0
/**
 * Sidebar — role-aware navigation visibility (FR-IA-01, ADMIN_CONSOLE §5).
 *
 * RBAC matrix (must stay in sync with sidebar.tsx):
 *
 *   Item       | Visible to scopes (any one matches)
 *   -----------+------------------------------------------------------
 *   Health     | every signed-in user
 *   Packs      | agi:admin | agi:viewer | agi:operator:<any>
 *   Tools      | agi:admin | agi:viewer
 *   Use cases  | agi:admin | agi:viewer | agi:dev | agi:operator:<any>
 *   Audit      | agi:admin | agi:viewer
 *   LLM        | agi:admin | agi:viewer
 *   Admin      | agi:admin only (sub-routes: Log, Users, Settings)
 *
 * We exercise the pure `isVisible(item, scopes)` predicate exported from
 * sidebar.tsx. Render-time integration is covered by the Playwright spec
 * (see ../e2e/) — that's the right layer for "what does the operator
 * actually see in the browser?".
 *
 * Why a unit test rather than @testing-library/react: the workspace ships
 * @testing-library/react 16 without its `@testing-library/dom` peer
 * installed, so `render()` cannot load in this band. Pure-function
 * coverage is what gives us the RBAC guarantee anyway.
 */

import { describe, expect, it } from 'vitest';
import { isVisible } from '../components/sidebar';

interface Item {
  href: string;
  label: string;
  scopes?: string[];
  allowOperator?: boolean;
}

// Mirror sidebar.tsx's NAV/ADMIN_SUB to make the assertion table-driven.
const ITEMS: Record<string, Item> = {
  Health: { href: '/', label: 'Health' },
  Packs: {
    href: '/packs',
    label: 'Packs',
    scopes: ['agi:admin', 'agi:viewer'],
    allowOperator: true,
  },
  Tools: { href: '/tools', label: 'Tools', scopes: ['agi:admin', 'agi:viewer'] },
  UseCases: {
    href: '/use-cases',
    label: 'Use cases',
    scopes: ['agi:admin', 'agi:viewer', 'agi:dev'],
    allowOperator: true,
  },
  Audit: { href: '/audit', label: 'Audit', scopes: ['agi:admin', 'agi:viewer'] },
  LLM: { href: '/llm', label: 'LLM', scopes: ['agi:admin', 'agi:viewer'] },
  Log: { href: '/admin/log', label: 'Log', scopes: ['agi:admin'] },
  Users: { href: '/admin/users', label: 'Users', scopes: ['agi:admin'] },
  Settings: { href: '/admin/settings', label: 'Settings', scopes: ['agi:admin'] },
};

function visibleSet(scopes: string[]): string[] {
  return Object.entries(ITEMS)
    .filter(([, item]) => isVisible(item, scopes))
    .map(([k]) => k);
}

describe('Sidebar / isVisible', () => {
  it('admin sees every top-level + admin sub-section item', () => {
    const set = visibleSet(['agi:admin']);
    expect(set).toEqual(
      expect.arrayContaining([
        'Health',
        'Packs',
        'Tools',
        'UseCases',
        'Audit',
        'LLM',
        'Log',
        'Users',
        'Settings',
      ]),
    );
  });

  it('viewer sees Health/Packs/Tools/UseCases/Audit/LLM and nothing admin', () => {
    const set = visibleSet(['agi:viewer']);
    expect(set.sort()).toEqual(
      ['Audit', 'Health', 'LLM', 'Packs', 'Tools', 'UseCases'].sort(),
    );
  });

  it('dev sees Health + UseCases only (no Packs/Tools/Audit/LLM/Admin)', () => {
    const set = visibleSet(['agi:dev']);
    expect(set.sort()).toEqual(['Health', 'UseCases'].sort());
  });

  it('operator:<slug> sees Health + Packs + UseCases and nothing else', () => {
    const set = visibleSet(['agi:operator:care-demo']);
    expect(set.sort()).toEqual(['Health', 'Packs', 'UseCases'].sort());
  });

  it('a user with no scopes still sees Health', () => {
    const set = visibleSet([]);
    expect(set).toEqual(['Health']);
  });

  it('combined operator + viewer scopes union visibility', () => {
    const set = visibleSet(['agi:operator:care-demo', 'agi:viewer']);
    expect(set.sort()).toEqual(
      ['Audit', 'Health', 'LLM', 'Packs', 'Tools', 'UseCases'].sort(),
    );
  });

  it('hides admin sub-items from anyone without agi:admin', () => {
    for (const role of ['agi:viewer', 'agi:dev', 'agi:operator:care-demo']) {
      const set = visibleSet([role]);
      expect(set).not.toContain('Log');
      expect(set).not.toContain('Users');
      expect(set).not.toContain('Settings');
    }
  });
});
