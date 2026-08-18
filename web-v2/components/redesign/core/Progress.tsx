import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Progress.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/Progress.jsx + .d.ts),
 * 2026-08-18. Faithful port: same clamp-to-0-100 math, same track/fill
 * tokens. Placed under core/ per the task's destination path even though
 * the source .jsx lives under the handoff's feedback/ directory — this is
 * determinate progress through a process (onboarding steps, race admin
 * checklist), not a status banner, so it groups with this app's other
 * primitive value-display components (Stat, Badge) rather than Alert/Dialog.
 *
 * Determinate progress for a process, not for a quantity — quantities use
 * RangeScale. Real usage in designs/design-review-0818/ui_kits/web/
 * WebRaceDetail.jsx and WebRaceWeek.jsx: a race-admin checklist,
 * `value={3} max={4} label="Ready to race" tail="3 of 4"`.
 */

export interface ProgressProps {
  value?: number;
  max?: number;
  label?: string | null;
  /** Right-hand counter, e.g. "Step 3 of 5". */
  tail?: string | null;
  style?: CSSProperties;
}

export function Progress({ value = 0, max = 100, label = null, tail = null, style }: ProgressProps) {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={style}>
      {(label || tail) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-label-s)',
          color: 'var(--text-secondary)', marginBottom: 'var(--sp-5)',
        }}>
          <span>{label}</span><span style={{ color: 'var(--text-quiet)' }}>{tail}</span>
        </div>
      )}
      <div style={{ height: 'var(--track-height-s)', background: 'var(--range-track)', borderRadius: 'var(--radius-pill)' }}>
        <div style={{
          height: '100%', width: `${p}%`, background: 'var(--signal)', borderRadius: 'var(--radius-pill)',
          transition: 'width var(--dur-3) var(--ease-out)',
        }} />
      </div>
    </div>
  );
}
