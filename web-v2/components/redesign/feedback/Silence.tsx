import type { CSSProperties } from 'react';

/**
 * components/redesign/feedback/Silence.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/Silence.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same reserved-height single line.
 *
 * Distinct from EmptyState (same directory) — see the note in EmptyState.tsx
 * for the full comparison. Silence is used when the app cannot judge
 * something honestly (a treadmill run with unknown incline gets no pace
 * verdict) rather than when a whole surface has nothing yet. Confirmed
 * against WebOnboarding.jsx's "coached" mode ("No plan inputs needed...")
 * and WebDayOne.jsx's Fitness tile ("No performance on record...") — both
 * a single quiet sentence with no headline and no action.
 */

export interface SilenceProps {
  /** Reserve the height the sentence would have occupied. */
  height?: number;
  /** Optional plain reason. Never an apology, never a placeholder em dash. */
  reason?: string | null;
  style?: CSSProperties;
}

/**
 * The coach has nothing honest to say. A designed state, not a default.
 * Occupies the exact space the sentence would have taken so nothing reflows.
 */
export function Silence({ height = 96, reason = null, style }: SilenceProps) {
  return (
    <div style={{ minHeight: height, display: 'flex', alignItems: 'center', padding: 'var(--sp-8) 0', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)', color: 'var(--text-quiet)' }}>
        <span style={{ width: 28, height: 2, background: 'var(--surface-4)', display: 'block' }} />
        <span style={{ fontSize: 'var(--type-body-s)' }}>{reason || 'Nothing to add today.'}</span>
      </div>
    </div>
  );
}
