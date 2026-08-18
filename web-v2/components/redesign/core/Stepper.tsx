import type { CSSProperties } from 'react';
import { Icon } from '@/components/redesign/core/Icon';

/**
 * components/redesign/core/Stepper.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Stepper.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same min/max-clamped
 * plus/minus buttons that disable themselves at the bound.
 */

export interface StepperProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string | null;
  label?: string | null;
  /** Say what changes in the plan when this moves. */
  helper?: string | null;
  onChange?: (value: number) => void;
  style?: CSSProperties;
}

/** A bounded numeric setting the runner nudges: days per week, quality days, mileage target. */
export function Stepper({
  value = 0, min = 0, max = 99, step = 1, unit = null, label = null, helper = null, onChange, style,
}: StepperProps) {
  const set = (v: number) => onChange && onChange(Math.max(min, Math.min(max, v)));
  const btn = (name: string, to: number, off: boolean) => (
    <button
      onClick={() => set(to)}
      disabled={off}
      aria-label={name}
      style={{
        width: 44, height: 44, border: 0, borderRadius: 'var(--radius-pill)', background: 'var(--surface-control)',
        color: off ? 'var(--text-disabled)' : 'var(--text-primary)', cursor: off ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name={name} size={18} />
    </button>
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', ...style }}>
      {label && <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{label}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)' }}>
        {btn('minus', value - step, value <= min)}
        <span style={{
          minWidth: 96, textAlign: 'center', fontSize: 'var(--type-value-3)',
          fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-value)', lineHeight: 1,
        }}>
          {value}
          {unit && (
            <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)', marginLeft: 5, fontWeight: 'var(--weight-medium)' }}>
              {unit}
            </span>
          )}
        </span>
        {btn('plus', value + step, value >= max)}
      </div>
      <span style={{ minHeight: 18, fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{helper || ''}</span>
    </div>
  );
}
