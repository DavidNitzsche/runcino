import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Switch.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Switch.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same track/thumb construction.
 */

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  /** One quiet line saying what changes. */
  sub?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/** A setting that takes effect immediately. Never used for something that needs saving. */
export function Switch({ checked = false, onChange, label, sub, disabled = false, style }: SwitchProps) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-6)', minHeight: 'var(--hit-min)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, ...style,
    }}>
      <span
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{
          width: 52, height: 32, borderRadius: 'var(--radius-pill)', flex: '0 0 auto', marginTop: 2,
          background: checked ? 'var(--signal)' : 'var(--surface-4)', position: 'relative',
          transition: 'background var(--dur-2) var(--ease-out)',
        }}
      >
        <span style={{
          position: 'absolute', top: 4, left: checked ? 24 : 4, width: 24, height: 24, borderRadius: '50%',
          background: checked ? '#000' : 'var(--ink-1)', transition: 'left var(--dur-2) var(--ease-out)',
        }} />
      </span>
      <span style={{ display: 'grid', gap: 2, paddingTop: 4 }}>
        <span style={{ fontSize: 'var(--type-body-s)' }}>{label}</span>
        {sub && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{sub}</span>}
      </span>
    </label>
  );
}
