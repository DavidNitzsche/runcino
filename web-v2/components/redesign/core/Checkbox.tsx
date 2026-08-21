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
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        position: 'relative', ...style,
      }}
    >
      {/*
        Same gap as `Switch`: a `<label>` with an `onClick` and no `<input>`
        inside it. Not focusable, no role, no `aria-checked` — so the
        days-available multi-select in onboarding could not be completed with
        a keyboard or read by a screen reader.

        A real checkbox, visually hidden but still focusable, wrapped by the
        label that already names it. The drawn square below is unchanged and
        marked decorative so the state is announced once, from the control,
        rather than twice.
      */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.currentTarget.checked)}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
      <span aria-hidden="true" style={{
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
