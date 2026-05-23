// SPDX-License-Identifier: Apache-2.0
'use client';

interface TokenPoint {
  h: string;
  input: number;
  output: number;
}
interface LatencyPoint {
  h: string;
  p50: number;
  p95: number;
}
interface HBarRow {
  label: string;
  value: number;
}

export function BarChart({ data }: { data: TokenPoint[] }) {
  const W = 100;
  const H = 50;
  const maxV = Math.max(...data.map((d) => d.input + d.output));
  const barW = W / data.length - 1.2;
  return (
    <div style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 200, overflow: 'visible' }}
        preserveAspectRatio="none"
      >
        {data.map((d, i) => {
          const x = i * (W / data.length) + 0.6;
          const inputH = (d.input / maxV) * H;
          const outputH = (d.output / maxV) * H;
          return (
            <g key={i}>
              <rect
                x={x}
                y={H - inputH - outputH}
                width={barW}
                height={outputH}
                fill="var(--md-tertiary)"
                rx="0.5"
              />
              <rect
                x={x}
                y={H - inputH}
                width={barW}
                height={inputH}
                fill="var(--md-primary)"
                rx="0.5"
              />
            </g>
          );
        })}
      </svg>
      <div
        className="row"
        style={{
          marginTop: 14,
          gap: 18,
          fontSize: 12,
          color: 'var(--md-on-surface-variant)',
        }}
      >
        <div className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--md-primary)' }} />{' '}
          input
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--md-tertiary)' }} />{' '}
          output
        </div>
        <span style={{ marginLeft: 'auto' }} className="mono">
          00 · 04 · 08 · 12 · 16 · 20 (h)
        </span>
      </div>
    </div>
  );
}

export function LineChart({ data }: { data: LatencyPoint[] }) {
  const W = 100;
  const H = 50;
  const maxV = Math.max(...data.flatMap((d) => [d.p50, d.p95]));
  const xs = data.map((_, i) => (i / (data.length - 1)) * W);
  const yP50 = data.map((d) => H - (d.p50 / maxV) * H);
  const yP95 = data.map((d) => H - (d.p95 / maxV) * H);
  const path50 = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${yP50[i]}`).join(' ');
  const path95 = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${yP95[i]}`).join(' ');
  const area95 = `${xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${yP95[i]}`).join(' ')} L ${W} ${H} L 0 ${H} Z`;
  return (
    <div style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 200, overflow: 'visible' }}
        preserveAspectRatio="none"
      >
        <path d={area95} fill="var(--md-tertiary-container)" opacity="0.45" />
        <path
          d={path95}
          stroke="var(--md-tertiary)"
          strokeWidth="0.6"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path50}
          stroke="var(--md-primary)"
          strokeWidth="0.8"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        className="row"
        style={{
          marginTop: 14,
          gap: 18,
          fontSize: 12,
          color: 'var(--md-on-surface-variant)',
        }}
      >
        <div className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--md-primary)' }} /> p50
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--md-tertiary)' }} /> p95
        </div>
        <span style={{ marginLeft: 'auto' }} className="mono">
          range {Math.min(...data.map((d) => d.p50))} – {Math.max(...data.map((d) => d.p95))} ms
        </span>
      </div>
    </div>
  );
}

export function HBarChart({
  data,
  onClick,
  format = (v: number) => String(v),
}: {
  data: HBarRow[];
  onClick?: (label: string) => void;
  format?: (v: number) => string;
}) {
  const maxV = Math.max(...data.map((d) => d.value));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {data.map((d) => (
        <div
          key={d.label}
          onClick={() => onClick?.(d.label)}
          style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
          <div className="row between" style={{ marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--md-primary)' }}>
              {d.label}
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--md-on-surface-variant)' }}>
              {format(d.value)}
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--md-surface-container-high)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(d.value / maxV) * 100}%`,
                background: 'var(--md-primary)',
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
