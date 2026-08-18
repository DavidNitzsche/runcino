import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/graphics/TrendBars.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/TrendBars.jsx + .d.ts),
 * 2026-08-18. Faithful port: same min/max normalization (18% to 100% of
 * height), same highlight-index math.
 *
 * A season of readings with exactly one bar picked out. One deliberate
 * highlight says more than a chart where every bar is coloured.
 */

export interface TrendBarsProps {
  values: number[];
  /** Index of the single highlighted bar. Negative counts from the end; -1 is today. */
  highlight?: number;
  height?: number;
  /** Large qualifying number above the chart. */
  headline?: ReactNode;
  headlineLabel?: string | null;
  /** Quiet row beneath the chart. Two or three strings, never competing with the headline. */
  footnotes?: string[] | null;
  gap?: number;
  style?: CSSProperties;
}

export function TrendBars({
  values, highlight = -1, height = 120, headline = null, headlineLabel = null,
  footnotes = null, gap = 5, style,
}: TrendBarsProps) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const hi = highlight < 0 ? values.length + highlight : highlight;
  return (
    <div style={style}>
      {headline && (
        <div style={{ marginBottom: 'var(--sp-7)' }}>
          <div style={{
            fontSize: 'var(--type-value-2)', fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-value)', lineHeight: 'var(--lh-value)',
          }}>
            {headline}
          </div>
          {headlineLabel && (
            <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 'var(--sp-4)' }}>
              {headlineLabel}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap, height }}>
        {values.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${18 + ((v - min) / span) * 82}%`,
              background: i === hi ? 'var(--plot-highlight)' : 'var(--plot-quiet)',
              borderRadius: '3px 3px 0 0',
            }}
          />
        ))}
      </div>
      {footnotes && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-5)',
          fontSize: 'var(--type-meta)', color: 'var(--text-quiet)',
        }}>
          {footnotes.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
    </div>
  );
}
