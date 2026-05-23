// SPDX-License-Identifier: Apache-2.0
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from './components/auth-provider';
import { AppShell } from './components/app-shell';
import { loadInitialSession, loadVisiblePacks } from './lib/server-session';

export const metadata: Metadata = {
  title: 'project-agi · admin console',
  description: 'Reference admin console for the project-agi runtime',
};

/**
 * Root layout — Material Design 3 chrome.
 *
 * - `<html data-theme="dark" data-density="regular">` is the default; client
 *   code can flip these attributes to swap the M3 tonal palette without
 *   touching any component.
 * - Pack tokens NEVER override the chrome (ADMIN_CONSOLE §6); they only
 *   render in the pack-overview Theme Preview card.
 * - Initial session is server-rendered so the sidebar paints with the right
 *   role filter without flicker.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [initialUser, packs] = await Promise.all([
    loadInitialSession(),
    loadVisiblePacks(),
  ]);

  return (
    <html lang="en" data-theme="dark" data-density="regular" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,300..700&family=Roboto+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:px-3 focus:py-2"
          style={{
            background: 'var(--md-primary)',
            color: 'var(--md-on-primary)',
          }}
        >
          Skip to main content
        </a>
        <AuthProvider initialUser={initialUser}>
          {initialUser ? (
            <AppShell packs={packs}>{children}</AppShell>
          ) : (
            <main id="main" className="min-h-screen px-6 py-6">
              {children}
            </main>
          )}
        </AuthProvider>
      </body>
    </html>
  );
}
