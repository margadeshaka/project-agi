// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * Topbar — M3 small top app bar.
 *
 *   [menu] [overline → headline]            [search] [bell] [avatar]
 *
 * The overline + headline are computed from the current route. Routes like
 * /packs/<slug>/<tab> show a clickable parent crumb in the overline; second-
 * level routes always link back via the back chevron.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Badge, Icon } from './m3';
import { DATA } from '../mock/data';

interface Crumb {
  label: string;
  href?: string;
}

function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);

  if (pathname === '/' || parts.length === 0) return [{ label: 'Health' }];
  if (pathname === '/metrics') return [{ label: 'Metrics' }];
  if (pathname === '/jobs') return [{ label: 'Jobs' }];
  if (pathname === '/notifications') return [{ label: 'Notifications' }];
  if (pathname === '/profile') return [{ label: 'Profile' }];

  if (pathname === '/packs/new') {
    return [{ label: 'Packs', href: '/packs' }, { label: 'New pack' }];
  }
  if (pathname === '/packs') return [{ label: 'Packs' }];

  if (parts[0] === 'packs' && parts[1]) {
    const slug = parts[1];
    const tab = parts[2];
    const pack = DATA.packs.find((p) => p.slug === slug);
    const crumbs: Crumb[] = [
      { label: 'Packs', href: '/packs' },
      { label: pack?.name ?? slug, href: `/packs/${slug}` },
    ];
    if (tab) crumbs.push({ label: tab });
    return crumbs;
  }

  if (pathname === '/tools') return [{ label: 'Tools' }];
  if (parts[0] === 'tools' && parts[1]) {
    return [{ label: 'Tools', href: '/tools' }, { label: decodeURIComponent(parts[1]) }];
  }

  if (pathname === '/use-cases') return [{ label: 'Use cases' }];
  if (parts[0] === 'use-cases' && parts[1]) {
    return [{ label: 'Use cases', href: '/use-cases' }, { label: parts[1] }];
  }

  if (pathname === '/audit') return [{ label: 'AI-Trail' }];
  if (parts[0] === 'audit' && parts[1]) {
    return [{ label: 'AI-Trail', href: '/audit' }, { label: parts[1] }];
  }

  if (pathname === '/llm') return [{ label: 'LLM' }];

  if (parts[0] === 'admin') {
    const sub = parts[1] ?? '';
    const label = sub.charAt(0).toUpperCase() + sub.slice(1);
    return [{ label: 'Admin' }, { label }];
  }

  return [{ label: parts[0] ?? 'project-agi' }];
}

export function Topbar() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const user = DATA.user.admin;
  const crumbs = useMemo(() => crumbsFor(pathname), [pathname]);
  const here = crumbs[crumbs.length - 1];
  const back = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;

  return (
    <header className="topbar" role="toolbar" aria-label="Top app bar">
      <button type="button" className="icon-btn" aria-label="Menu">
        <Icon name="menu" size={24} />
      </button>
      <div className="topbar-title">
        {back && (
          <div className="topbar-overline">
            {back.href ? <Link href={back.href}>{back.label}</Link> : back.label}
          </div>
        )}
        <div className="topbar-headline">{here?.label}</div>
      </div>
      <div className="topbar-actions">
        <button type="button" className="icon-btn" aria-label="Search">
          <Icon name="search" size={24} />
        </button>
        <Badge dot>
          <button
            type="button"
            className="icon-btn"
            aria-label="Notifications"
            onClick={() => router.push('/notifications')}
          >
            <Icon name="notification" size={24} />
          </button>
        </Badge>
        <button
          type="button"
          className="icon-btn"
          aria-label="Profile"
          onClick={() => router.push('/profile')}
          style={{ padding: 0 }}
        >
          <div className="avatar" style={{ marginLeft: 4 }}>
            {user.initials}
          </div>
        </button>
      </div>
    </header>
  );
}
