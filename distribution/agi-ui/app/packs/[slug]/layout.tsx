// SPDX-License-Identifier: Apache-2.0
'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Empty, Icon, ScreenHead, Tabs, useSnackbar } from '../../components/m3';
import { DATA } from '../../mock/data';

export default function PackLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const slug = params?.slug;
  const snackbar = useSnackbar();
  const p = DATA.packs.find((x) => x.slug === slug);
  if (!p) {
    return <Empty title="Pack not found" body={`No pack with slug "${slug}".`} />;
  }

  const seg = pathname.split('/').filter(Boolean)[2] ?? 'overview';

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'tools', label: 'Tools', count: p.tools },
    { id: 'kb', label: 'Knowledge base', count: p.kbArticles },
    { id: 'prompts', label: 'Prompts' },
    { id: 'scenarios', label: 'Scenarios' },
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div className="stack" style={{ gap: 0 }}>
      <ScreenHead
        title={
          <span className="row" style={{ gap: 10 }}>
            <span className="swatch" style={{ background: p.primary, width: 22, height: 22 }} />
            {p.name}
          </span>
        }
        lede={`Brand-pack · ${p.vertical} · loaded from ${p.source}`}
        meta={`sha ${p.sha} · ${p.tools} tools allow-listed · ${p.kbArticles} KB articles`}
        right={
          <>
            <button
              type="button"
              className="btn"
              onClick={() =>
                snackbar.show({ msg: 'Pack reload triggered · YAML re-read · 200 OK' })
              }
            >
              <Icon name="refresh" /> Reload pack
            </button>
            <Link href="#" className="btn text">
              <Icon name="external" size={13} /> Open in Langfuse
            </Link>
          </>
        }
      />
      <Tabs
        tabs={tabs}
        value={seg}
        onChange={(t) =>
          router.push(`/packs/${slug}${t === 'overview' ? '' : '/' + t}`)
        }
      />
      {children}
    </div>
  );
}
