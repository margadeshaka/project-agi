// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  Card,
  ExtendedFab,
  Icon,
  LinearProgress,
  M3List,
  M3ListItem,
  SearchInput,
  useSnackbar,
} from '../../../components/m3';
import { DATA } from '../../../mock/data';

export default function PackKbScreen() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const articles = (slug ? DATA.kb[slug] : undefined) ?? [];
  const snackbar = useSnackbar();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const toggle = (t: string) => {
    const s = new Set(selected);
    if (s.has(t)) {
      s.delete(t);
    } else {
      s.add(t);
    }
    setSelected(s);
  };

  const startReindex = () => {
    setReindexing(true);
    window.setTimeout(() => setReindexing(false), 3000);
    snackbar.show({
      msg: 'Reindex queued · streaming progress…',
      actionLabel: 'VIEW',
      action: () => {},
    });
  };

  return (
    <div className="stack">
      {reindexing && <LinearProgress />}
      <div className="grid-side">
        <Card
          title={`KB · ${slug}`}
          right={`${articles.length} articles · ${articles.reduce(
            (a, b) => a + b.chunks,
            0,
          )} chunks`}
        >
          <div className="row between" style={{ marginBottom: 14 }}>
            <SearchInput
              value=""
              onChange={() => {}}
              placeholder="Hybrid search · vector + keyword"
              width={360}
            />
            <button type="button" className="btn" onClick={startReindex}>
              <Icon name="refresh" size={16} /> Reindex now
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              snackbar.show({
                msg: '1 file accepted · embedding…',
                actionLabel: 'UNDO',
                action: () => {},
              });
            }}
            style={{
              border: `2px dashed ${drag ? 'var(--md-primary)' : 'var(--md-outline-variant)'}`,
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              color: 'var(--md-on-surface-variant)',
              fontSize: 13,
              textAlign: 'center',
              background: drag ? 'var(--md-primary-container)' : 'transparent',
              transition: 'background 0.12s',
            }}
          >
            <Icon name="upload" size={18} /> &nbsp; Drop markdown or JSON here, or use the upload
            button below. Max 10 MB.
          </div>

          <M3List>
            {articles.map((a) => (
              <M3ListItem
                key={a.title}
                lead={<Icon name={a.format === 'md' ? 'book' : 'log'} size={20} />}
                leadKind={selected.has(a.title) ? 'primary' : ''}
                headline={a.title}
                supporting={`${a.format.toUpperCase()} · ${a.size} · ${a.chunks} chunks`}
                trailing={
                  <>
                    <div>{a.lastEmbed}</div>
                    <span className="meta">embedded</span>
                  </>
                }
                onClick={() => toggle(a.title)}
              />
            ))}
          </M3List>

          {selected.size > 0 && (
            <div
              className="row between"
              style={{
                marginTop: 14,
                padding: '10px 16px',
                background: 'var(--md-secondary-container)',
                color: 'var(--md-on-secondary-container)',
                borderRadius: 12,
              }}
            >
              <span style={{ fontSize: 13.5 }}>{selected.size} selected</span>
              <div className="row">
                <button type="button" className="btn sm outlined">
                  Preview
                </button>
                <button type="button" className="btn sm">
                  Re-embed
                </button>
                <button type="button" className="btn sm danger">
                  Delete
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Vector index">
          <div className="stack" style={{ gap: 14, fontSize: 13 }}>
            <div>
              <div className="muted mono" style={{ fontSize: 11 }}>BACKEND</div>
              <div className="mono">qdrant://shared/{slug}</div>
            </div>
            <div>
              <div className="muted mono" style={{ fontSize: 11 }}>VECTORS</div>
              <div className="mono">
                {articles.reduce((a, b) => a + b.chunks, 0).toLocaleString()} chunks
              </div>
            </div>
            <div>
              <div className="muted mono" style={{ fontSize: 11 }}>EMBEDDING</div>
              <div className="mono">openai/text-embedding-3-small</div>
            </div>
            <div>
              <div className="muted mono" style={{ fontSize: 11 }}>LAST REINDEX</div>
              <div className="mono">{articles[0]?.lastEmbed ?? '—'}</div>
            </div>
            <div className="hr" />
            <div>
              <div className="muted mono" style={{ fontSize: 11 }}>RECENT REINDEX</div>
              <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
                <div>12m ago · 184 chunks · 4.2s</div>
                <div>4h ago · 178 chunks · 4.0s</div>
                <div>1d ago · 152 chunks · 3.8s</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <ExtendedFab
        icon="upload"
        label="Upload article"
        onClick={() => snackbar.show({ msg: 'Upload picker opened' })}
      />
    </div>
  );
}
