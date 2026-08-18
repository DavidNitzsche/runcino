import type { CSSProperties } from 'react';

/**
 * components/redesign/graphics/ElevationProfile.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/ElevationProfile.jsx + .d.ts),
 * 2026-08-18. Faithful port: same filled-area SVG path math.
 */

export interface ElevationProfileProps {
  /** Elevation samples in order. */
  points: number[];
  height?: number;
  /** Notable miles, positioned 0 to 1 along the course. */
  marks?: Array<{ at: number; label: string }>;
  tone?: 'quiet' | 'signal';
  footnotes?: string[] | null;
  style?: CSSProperties;
}

/** A course or run profile as one filled area. Notable miles are marked, not annotated. */
export function ElevationProfile({ points, height = 110, marks = [], tone = 'quiet', footnotes = null, style }: ElevationProfileProps) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = (max - min) || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 100 - ((p - min) / span) * 100;
    return (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }).join(' ') + ' L100 100 L0 100 Z';
  return (
    <div style={style}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        <path d={d} fill={tone === 'signal' ? 'var(--signal)' : 'var(--surface-4)'} opacity={tone === 'signal' ? 0.9 : 1} />
      </svg>
      <div style={{ position: 'relative', height: 18 }}>
        {marks.map((m, i) => (
          <span key={i} style={{
            position: 'absolute', left: `${m.at * 100}%`, transform: 'translateX(-50%)',
            fontSize: 'var(--type-meta)', color: 'var(--text-quiet)', whiteSpace: 'nowrap',
          }}>{m.label}</span>
        ))}
      </div>
      {footnotes && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
          {footnotes.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
    </div>
  );
}
