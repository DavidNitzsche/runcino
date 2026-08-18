import type { CSSProperties } from 'react';

/**
 * components/redesign/feedback/Skeleton.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/Skeleton.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same fixed (non-shimmering,
 * non-pulsing) placeholder bars, last line of a multi-line block short.
 */

export type SkeletonRadius = 's' | 'm' | 'pill';

export interface SkeletonProps {
  height?: number;
  width?: number | string;
  radius?: SkeletonRadius;
  /** Multiple lines for a prose block; the last line renders short. */
  lines?: number;
  gap?: string;
  style?: CSSProperties;
}

const RADIUS: Record<SkeletonRadius, string> = {
  s: 'var(--radius-s)',
  m: 'var(--radius-m)',
  pill: 'var(--radius-pill)',
};

/**
 * Reserved space for data that has not arrived. If a thing is sometimes there,
 * its space is always there. Nothing above the fold may appear conditionally.
 */
export function Skeleton({ height = 20, width = '100%', radius = 's', lines = 1, gap = 'var(--sp-5)', style }: SkeletonProps) {
  const r = RADIUS[radius];
  return (
    <div style={{ display: 'grid', gap, ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          style={{
            height,
            width: lines > 1 && i === lines - 1 ? '62%' : width,
            background: 'var(--surface-2)',
            borderRadius: r,
          }}
        />
      ))}
    </div>
  );
}
