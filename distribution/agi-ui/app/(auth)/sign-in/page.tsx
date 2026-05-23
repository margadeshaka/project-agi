// SPDX-License-Identifier: Apache-2.0
'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '../../components/m3';

export default function SignInScreen() {
  const router = useRouter();
  return (
    <div className="signin-shell">
      <div className="signin-card">
        <div className="row" style={{ gap: 14, marginBottom: 24 }}>
          <div className="rail-logo" style={{ width: 44, height: 44 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>project-agi</div>
            <div className="mono muted" style={{ fontSize: 12 }}>
              open-source · agent intelligence stack
            </div>
          </div>
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 400 }}>Sign in</h2>
        <p className="muted" style={{ margin: '0 0 26px', fontSize: 14 }}>
          You&rsquo;ll be redirected to the configured OIDC issuer.
        </p>

        <button
          type="button"
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', height: 48, fontSize: 14 }}
          onClick={() => router.push('/')}
        >
          Continue with OIDC
          <Icon name="chev" size={16} />
        </button>

        <div className="row" style={{ margin: '22px 0', gap: 12, fontSize: 11.5 }}>
          <div style={{ height: 1, background: 'var(--md-outline-variant)', flex: 1 }} />
          <span className="mono muted">OR</span>
          <div style={{ height: 1, background: 'var(--md-outline-variant)', flex: 1 }} />
        </div>

        <div>
          <label className="mono muted" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
            STATIC TOKEN · DEV ONLY
          </label>
          <input className="input" style={{ width: '100%' }} placeholder="agi_token_…" />
        </div>
        <button
          type="button"
          className="btn outlined"
          style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
          onClick={() => router.push('/')}
        >
          Use token
        </button>

        <div className="hr" style={{ margin: '22px 0' }} />
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.85 }}>
          <div>
            <strong style={{ color: 'var(--md-on-surface)' }}>Issuer</strong> ·{' '}
            <span className="mono">https://auth.example.org/realms/agi</span>
          </div>
          <div>
            <strong style={{ color: 'var(--md-on-surface)' }}>Mode</strong> · oidc
          </div>
          <div>
            <strong style={{ color: 'var(--md-on-surface)' }}>Env</strong> · production
          </div>
        </div>

        <div className="muted" style={{ marginTop: 22, textAlign: 'center', fontSize: 12 }}>
          Trouble signing in? <a href="#">Contact your platform admin</a>
        </div>
      </div>
    </div>
  );
}
