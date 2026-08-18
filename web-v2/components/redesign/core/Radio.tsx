import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Radio.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Radio.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same inset-ring selected state.
 */

export interface RadioProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  /** Says what this choice makes the plan do. */
  sub?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/** One of a small set, where the choice reshapes the plan. Used for the five onboarding modes and for experience level. */
export function Radio({ checked = false, onChange, label, sub, disabled = false, style }: RadioProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-6)', minHeight: 'var(--hit-min)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, ...style,
      }}
      onClick={() => !disabled && onChange && onChange(true)}
    >
      <span style={{
        width: 24, height: 24, flex: '0 0 auto', marginTop: 8, borderRadius: '50%',
        background: 'var(--surface-control)', boxShadow: checked ? 'inset 0 0 0 7px var(--signal)' : 'none',
        transition: 'box-shadow var(--dur-2) var(--ease-out)',
      }} />
      <span style={{ display: 'grid', gap: 2, paddingTop: 6 }}>
        <span style={{ fontSize: 'var(--type-body-s)' }}>{label}</span>
        {sub && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', maxWidth: 'var(--measure-say)' }}>{sub}</span>}
      </span>
    </label>
  );
}
