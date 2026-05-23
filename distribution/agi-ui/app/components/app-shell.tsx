// SPDX-License-Identifier: Apache-2.0
'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { SnackbarProvider } from './m3';

/**
 * AppShell — M3 navigation drawer + small top app bar.
 *
 * The 272px rail and 64px topbar are pinned; only `.main` scrolls. Tonal lift
 * is the only separator — no hairline borders between regions
 * (ADMIN_CONSOLE §6 / NFR-THM-01).
 *
 * Routes that take over the viewport (e.g. /sign-in) render without the
 * shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const isFullBleed = pathname.startsWith('/sign-in') || pathname === '/sign-in';

  if (isFullBleed) {
    return <SnackbarProvider>{children}</SnackbarProvider>;
  }

  return (
    <SnackbarProvider>
      <div className="app">
        <Sidebar />
        <Topbar />
        <main className="main">{children}</main>
      </div>
    </SnackbarProvider>
  );
}
