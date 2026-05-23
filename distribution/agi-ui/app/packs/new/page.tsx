// SPDX-License-Identifier: Apache-2.0
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Card,
  FilterChip,
  Icon,
  ScreenHead,
  SideEffectPill,
  useSnackbar,
} from '../../components/m3';
import { DATA } from '../../mock/data';
import paletteData from '../../mock/palette.json';

const PALETTE = paletteData as { primary: string[]; foreground: string; radius: string };

const TEMPLATES = [
  {
    id: 'starter',
    title: 'Starter',
    body: "Empty pack, kb.search only, OpenAI default. Best when you'll write everything from scratch.",
  },
  {
    id: 'support',
    title: 'Support agent template',
    body: 'Tickets + CRM + billing tools, refund policy KB, escalate_to_human handoff.',
  },
  {
    id: 'research',
    title: 'Research / RAG',
    body: 'Large KB, kb.search + kb.cite, optimized for citation accuracy.',
  },
  {
    id: 'automation',
    title: 'Workflow automation',
    body: 'Inventory + dispatch + tracking tools, dry-run defaults on all writes.',
  },
];

const MODEL_ROLES = [
  { role: 'reasoning', options: ['openai/gpt-4o', 'bedrock/claude-3-7-sonnet', 'ollama/llama3.2'] },
  { role: 'fast', options: ['openai/gpt-4o-mini', 'bedrock/claude-3-5-haiku', 'ollama/llama3.2'] },
  { role: 'extractor', options: ['openai/gpt-4o-mini', 'bedrock/claude-3-5-haiku'] },
];

export default function NewPackScreen() {
  const router = useRouter();
  const snackbar = useSnackbar();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [vertical, setVertical] = useState('blank template');
  const [primary, setPrimary] = useState(PALETTE.primary[0]);
  const [template, setTemplate] = useState('starter');
  const [tools, setTools] = useState<Set<string>>(new Set(['kb.search']));
  const [model, setModel] = useState('openai/gpt-4o');

  const next = () => setStep((s) => Math.min(s + 1, 4));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const create = () => {
    snackbar.show({
      msg: `Pack ${slug || 'new-pack'} scaffolded`,
      actionLabel: 'OPEN',
      action: () => router.push(`/packs/${slug || 'new-pack'}`),
    });
    router.push('/packs');
  };

  const steps = [
    {
      label: 'Pack identity',
      sublabel: name ? `${name} · ${slug || 'unnamed'}` : 'Choose a name and slug',
    },
    { label: 'Template', sublabel: `Start from ${template}` },
    { label: 'Theme', sublabel: `Primary ${primary}` },
    { label: 'Tool allow-list', sublabel: `${tools.size} tools` },
    { label: 'Models', sublabel: `Reasoning · ${model}` },
  ];

  const toggleTool = (n: string) => {
    const s = new Set(tools);
    if (s.has(n)) {
      s.delete(n);
    } else {
      s.add(n);
    }
    setTools(s);
  };

  return (
    <div className="stack">
      <ScreenHead
        title="New pack"
        lede="Scaffold a new brand-pack. The wizard creates a packs/<slug>/ directory with pack.yaml, an empty KB, and a default tool allow-list — ready to commit and ship."
        meta="Step-by-step · changes commit to your local repo"
        right={
          <button type="button" className="btn text" onClick={() => router.push('/packs')}>
            <Icon name="x" size={18} /> Cancel
          </button>
        }
      />

      <div className="grid-side">
        <Card className="filled">
          <div className="stepper">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`step ${i === step ? 'active' : i < step ? 'complete' : 'inactive'}`}
              >
                <div className="indicator">{i < step ? <Icon name="check" size={18} /> : i + 1}</div>
                <div>
                  <div className="label">{s.label}</div>
                  {i !== step && <div className="sublabel">{s.sublabel}</div>}
                  {i === step && (
                    <div className="body">
                      {i === 0 && (
                        <div className="stack" style={{ gap: 14 }}>
                          <div className="tf">
                            <label>Pack name</label>
                            <input
                              value={name}
                              onChange={(e) => {
                                setName(e.target.value);
                                setSlug(
                                  e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                );
                              }}
                              placeholder="My Support Bot"
                            />
                          </div>
                          <div className="tf">
                            <label>Slug · directory name</label>
                            <input
                              value={slug}
                              onChange={(e) => setSlug(e.target.value)}
                              placeholder="my-support-bot"
                            />
                          </div>
                          <div>
                            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                              Vertical
                            </div>
                            <div className="assist-row">
                              {[
                                'blank template',
                                'customer support',
                                'logistics',
                                'RAG / knowledge',
                                'ecommerce',
                                'internal ops',
                              ].map((v) => (
                                <FilterChip
                                  key={v}
                                  label={v}
                                  selected={vertical === v}
                                  onClick={() => setVertical(v)}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {i === 1 && (
                        <div className="stack" style={{ gap: 10 }}>
                          {TEMPLATES.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => setTemplate(t.id)}
                              style={{
                                padding: 14,
                                borderRadius: 12,
                                cursor: 'pointer',
                                background:
                                  template === t.id
                                    ? 'var(--md-primary-container)'
                                    : 'var(--md-surface-container)',
                                color:
                                  template === t.id
                                    ? 'var(--md-on-primary-container)'
                                    : 'var(--md-on-surface)',
                                border:
                                  template === t.id
                                    ? '1px solid transparent'
                                    : '1px solid var(--md-outline-variant)',
                              }}
                            >
                              <div className="row between">
                                <div style={{ fontWeight: 500, fontSize: 14 }}>{t.title}</div>
                                {template === t.id && <Icon name="check" size={20} />}
                              </div>
                              <div style={{ fontSize: 13, marginTop: 4, opacity: 0.85 }}>
                                {t.body}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {i === 2 && (
                        <div className="stack" style={{ gap: 14 }}>
                          <div>
                            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                              Primary color
                            </div>
                            <div className="row" style={{ gap: 10 }}>
                              {PALETTE.primary.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setPrimary(c)}
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 12,
                                    border:
                                      primary === c
                                        ? '3px solid var(--md-on-surface)'
                                        : '1px solid var(--md-outline-variant)',
                                    background: c,
                                    cursor: 'pointer',
                                    padding: 0,
                                  }}
                                  aria-label={c}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="theme-tile">
                            <div className="preview" style={{ background: primary }} />
                            <div className="meta">
                              <div>
                                <strong>theme.primary</strong> · {primary}
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <strong>theme.foreground</strong> ·{' '}
                                <span className="mono">{PALETTE.foreground}</span>
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <strong>theme.radius</strong> ·{' '}
                                <span className="mono">{PALETTE.radius}</span>
                              </div>
                              <div style={{ marginTop: 8, fontSize: 11 }}>
                                Preview only — console chrome stays neutral.
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {i === 3 && (
                        <div className="stack" style={{ gap: 8 }}>
                          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                            Pick tools your agent can call. You can change this later.
                          </div>
                          {DATA.tools.slice(0, 10).map((t) => (
                            <div
                              key={t.name}
                              onClick={() => toggleTool(t.name)}
                              className="row between"
                              style={{
                                padding: '10px 14px',
                                background: tools.has(t.name)
                                  ? 'var(--md-secondary-container)'
                                  : 'var(--md-surface-container-low)',
                                color: tools.has(t.name)
                                  ? 'var(--md-on-secondary-container)'
                                  : 'var(--md-on-surface)',
                                borderRadius: 8,
                                cursor: 'pointer',
                              }}
                            >
                              <div className="row" style={{ gap: 12 }}>
                                {tools.has(t.name) ? (
                                  <Icon name="check" size={20} />
                                ) : (
                                  <Icon name="plus" size={20} />
                                )}
                                <span className="mono" style={{ fontSize: 13 }}>
                                  {t.name}
                                </span>
                                <SideEffectPill side={t.side} />
                              </div>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: tools.has(t.name)
                                    ? 'var(--md-on-secondary-container)'
                                    : 'var(--md-on-surface-variant)',
                                  opacity: 0.85,
                                }}
                              >
                                {t.desc}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {i === 4 && (
                        <div className="stack" style={{ gap: 12 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Choose default models. Operators can override per role at runtime.
                          </div>
                          {MODEL_ROLES.map((r) => (
                            <div key={r.role}>
                              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                {r.role}
                              </div>
                              <div className="assist-row">
                                {r.options.map((o) => (
                                  <FilterChip
                                    key={o}
                                    label={o}
                                    selected={r.role === 'reasoning' ? model === o : false}
                                    onClick={() => r.role === 'reasoning' && setModel(o)}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="actions">
                        {i > 0 && (
                          <button type="button" className="btn outlined" onClick={back}>
                            Back
                          </button>
                        )}
                        {i < steps.length - 1 ? (
                          <button type="button" className="btn primary" onClick={next}>
                            Continue
                          </button>
                        ) : (
                          <button type="button" className="btn primary" onClick={create}>
                            <Icon name="check" size={18} /> Create pack
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title="Preview" tight>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <span className="swatch" style={{ background: primary }} />
                <div>
                  <div style={{ fontWeight: 500 }}>{name || 'Untitled pack'}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--md-on-surface-variant)' }}>
                    {slug || '—'} · {vertical}
                  </div>
                </div>
              </div>
              <div className="hr" />
              <div className="muted mono" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
                <div>template: {template}</div>
                <div>tools: {tools.size}</div>
                <div>reasoning: {model}</div>
              </div>
              <div className="hr" />
              <div className="muted" style={{ fontSize: 11 }}>
                Will create <span className="mono">packs/{slug || '&lt;slug&gt;'}/</span> with{' '}
                <span className="mono">pack.yaml</span>, <span className="mono">kb/</span>, and{' '}
                <span className="mono">prompts/</span>.
              </div>
            </div>
          </Card>

          <Card title="Files this will create" tight>
            <pre className="code">{`packs/${slug || '<slug>'}/
├── pack.yaml
├── prompts/
│   └── system.reasoner.md
├── kb/
│   └── .gitkeep
└── scenarios/
    └── example.yaml`}</pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
