// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * AppShell — M3 navigation drawer + top app bar composition.
 *
 * Layout grid:
 *
 *   ┌─────────┬─────────────────────────────────────────────┐
 *   │  rail   │  topbar     (64px)                          │
 *   │ (256px) ├─────────────────────────────────────────────┤
 *   │         │  main       (scrolls)                       │
 *   │         │                                             │
 *   └─────────┴─────────────────────────────────────────────┘
 *
 * The rail uses `--md-surface-container-low`, the topbar + main both use
 * the plain `--md-surface`. No hairline borders between regions; tonal
 * lift does the separation (ADMIN_CONSOLE §6 / NFR-THM-01).
 */

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { PackSwitcher } from './pack-switcher';
import { ToastProvider } from './ui/toast';
import { useSession } from './auth-provider';

interface AppShellProps {
  children: ReactNode;
  packs: { slug: string; display_name: string }[];
}

export function AppShell({ children, packs }: AppShellProps) {
  const { user, status, signOut } = useSession();

  return (
    <ToastProvider>
      <div
        className="grid h-screen overflow-hidden"
        style={{
          gridTemplateColumns: '256px 1fr',
          gridTemplateRows: '64px 1fr',
          gridTemplateAreas: '"rail topbar" "rail main"',
          background: 'var(--md-surface)',
        }}
      >
        <div style={{ gridArea: 'rail' }}>
          <Sidebar />
        </div>

        <header
          role="toolbar"
          aria-label="Account and pack"
          className="flex items-center gap-4 px-6"
          style={{ gridArea: 'topbar', background: 'var(--md-surface)' }}
        >
          <div className="flex flex-1 items-center gap-3">
            <PackSwitcher available={packs} />
          </div>
          <span className="text-[12.5px]" style={{ color: 'var(--md-on-surface-variant)' }}>
            {status === 'authenticated' ? (user?.email ?? user?.subject ?? 'user') : 'signed out'}
          </span>
          {status === 'authenticated' && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-[var(--md-on-surface)]/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]"
              style={{ color: 'var(--md-on-surface-variant)' }}
              aria-label="Sign out"
              title="Sign out"
            >
              ⏻
            </button>
          )}
        </header>

        <main
          id="main"
          className="overflow-y-auto px-6 pb-16 pt-2"
          style={{ gridArea: 'main', background: 'var(--md-surface)' }}
        >
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
