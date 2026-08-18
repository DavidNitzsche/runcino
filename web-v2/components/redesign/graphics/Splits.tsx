import type { CSSProperties } from 'react';

/**
 * components/redesign/graphics/Splits.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/Splits.jsx + .d.ts),
 * 2026-08-18. Faithful port: same stepped-segment SVG math, same amber-
 * out-of-band coloring, same mmss formatter.
 */

export interface SplitsEntry {
  /** pace in seconds; null for a dropped split. */
  pace: number | null;
  hr?: number;
  elev?: number;
}

export interface SplitsProps {
  /** One entry per mile. */
  splits: SplitsEntry[];
  /** Prescribed single pace, drawn as a white rule. */
  target?: number | null;
  /** Prescribed band, in seconds. Bars outside it turn amber. */
  band?: { low: number; high: number } | null;
  height?: number;
  unit?: 'mi' | 'km';
  style?: CSSProperties;
}

const mmss = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

/**
 * The run as one continuous pace line across the distance, with the prescribed band as a stripe
 * behind it. The line runs fast at the top, slow at the bottom, and any stretch that left the band
 * is drawn in amber. A mile whose data failed its sanity check simply breaks the line.
 */
export function Splits({ splits, target = null, band = null, height = 140, unit = 'mi', style }: SplitsProps) {
  const vals = splits.filter((s) => s.pace != null).map((s) => s.pace as number);
  const refs = [...vals];
  if (band) refs.push(band.low, band.high);
  if (target != null) refs.push(target);
  const pad = refs.length ? Math.max(6, (Math.max(...refs) - Math.min(...refs)) * 0.4) : 6;
  const fast = (refs.length ? Math.min(...refs) : 0) - pad;
  const slow = (refs.length ? Math.max(...refs) : 1) + pad;
  const span = (slow - fast) || 1;
  const y = (p: number) => ((p - fast) / span) * 100;
  const n = splits.length;
  const w = 100 / (n || 1);

  // stepped segments, split at band crossings so colour is per-mile
  const segs: { d: string; out: boolean }[] = [];
  splits.forEach((s, i) => {
    if (s.pace == null) return;
    const out = !!band && (s.pace < band.low || s.pace > band.high);
    const x0 = i * w;
    const x1 = (i + 1) * w;
    const yy = y(s.pace);
    const prev = i > 0 ? splits[i - 1] : null;
    const link = prev && prev.pace != null ? `M${x0} ${y(prev.pace)} L${x0} ${yy}` : '';
    segs.push({ d: `${link} M${x0} ${yy} L${x1} ${yy}`, out });
  });

  return (
    <div style={style}>
      <div style={{ position: 'relative', height }}>
        {band && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: `${y(band.low)}%`,
            height: `${y(band.high) - y(band.low)}%`, background: 'var(--range-band)', opacity: 0.42,
            borderRadius: 'var(--radius-xs)',
          }} />
        )}
        {target != null && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: `${y(target)}%`, height: 2, background: 'var(--range-target)', opacity: 0.8 }} />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          {segs.map((s, i) => (
            <path key={i} d={s.d} fill="none" vectorEffect="non-scaling-stroke"
              stroke={s.out ? 'var(--attention)' : 'var(--plot-ink)'} strokeWidth="2.5" strokeLinecap="butt" />
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', marginTop: 'var(--sp-5)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
        {splits.map((s, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', color: s.pace == null ? 'var(--attention)' : 'var(--text-quiet)' }}>{i + 1}</span>
        ))}
      </div>
      {band && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-4)',
          fontSize: 'var(--type-meta)', color: 'var(--text-quiet)', fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{unit === 'mi' ? 'Miles' : 'Kilometres'}</span>
          <span>{mmss(band.low)} · {mmss(band.high)}</span>
        </div>
      )}
    </div>
  );
}
