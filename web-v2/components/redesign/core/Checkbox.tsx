import type { CSSProperties } from 'react';
import { Icon } from '@/components/redesign/core/Icon';

/**
 * components/redesign/core/Checkbox.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Checkbox.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same filled-square-plus-check
 * construction. Used for the days-available multi-select.
 */

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  sub?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/** Multi-select. Used for the days the runner is available to run. */
export function Checkbox({ checked = false, onChange, label, sub, disabled = false, style }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-6)', minHeight: 'var(--hit-min)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, ...style,
      }}
      onClick={() => !disabled && onChange && onChange(!checked)}
    >
      <span style={{
        width: 24, height: 24, flex: '0 0 auto', marginTop: 8, borderRadius: 'var(--radius-xs)',
        background: checked ? 'var(--ink-1)' : 'var(--surface-control)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#000', transition: 'background var(--dur-2) var(--ease-out)',
      }}>
        {checked && <Icon name="check" size={16} />}
      </span>
      <span style={{ display: 'grid', gap: 2, paddingTop: 6 }}>
        <span style={{ fontSize: 'var(--type-body-s)' }}>{label}</span>
        {sub && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{sub}</span>}
      </span>
    </label>
  );
}
