// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, Icon, Pill } from '../../../components/m3';
import { DATA } from '../../../mock/data';

export default function PackPromptsScreen() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const promptList = (slug ? DATA.prompts[slug] : undefined) ?? DATA.prompts['support-demo'] ?? [];
  const [active, setActive] = useState(promptList[0]);
  if (!active) return null;

  return (
    <div className="grid-side">
      <Card
        title={active.name}
        right={
          <>
            <Pill>read-only</Pill> &nbsp;
            <span className="mono dim">
              {active.sha} · {active.updated}
            </span>
          </>
        }
      >
        <div
          className="row"
          style={{
            marginBottom: 10,
            gap: 10,
            color: 'var(--md-on-surface-variant)',
            fontSize: 11.5,
          }}
        >
          <Icon name="info" size={13} />
          Prompts are baked into containers at build time. Edit in{' '}
          <span className="mono">packs/{slug}/prompts/</span> and ship a hotfix branch.
        </div>
        <pre className="code" style={{ maxHeight: 480 }}>
          {active.body}
        </pre>
      </Card>

      <Card title="Prompt files">
        {promptList.map((pr) => (
          <button
            key={pr.name}
            type="button"
            className="rail-item"
            style={{ marginBottom: 2 }}
            onClick={() => setActive(pr)}
          >
            <Icon name="folder" size={14} />
            <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: 'var(--md-on-surface)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {pr.name}
              </div>
              <div className="mono dim" style={{ fontSize: 10.5 }}>
                {pr.lines} lines · {pr.sha}
              </div>
            </div>
          </button>
        ))}
      </Card>
    </div>
  );
}
