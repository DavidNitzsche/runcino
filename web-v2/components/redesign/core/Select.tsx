import type { CSSProperties } from 'react';
import { Icon } from '@/components/redesign/core/Icon';

/**
 * components/redesign/core/Select.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Select.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same native-<select>-plus-chevron
 * construction. Options accept either a bare string or a {value,label} pair
 * — real call sites (WebSettings.jsx units picker) pass bare strings, so
 * both forms of the .d.ts's documented union are exercised, not just typed.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value?: string;
  options?: Array<SelectOption | string>;
  onChange?: (value: string) => void;
  helper?: string | null;
  disabled?: boolean;
  full?: boolean;
  style?: CSSProperties;
}

function optValue(o: SelectOption | string): string {
  return typeof o === 'string' ? o : o.value;
}
function optLabel(o: SelectOption | string): string {
  return typeof o === 'string' ? o : o.label;
}

/** Single choice from a longer list. For two or three options, use SegmentBar instead. */
export function Select({
  label, value, options = [], onChange, helper = null, disabled = false, full = true, style,
}: SelectProps) {
  return (
    <label style={{ display: 'grid', gap: 'var(--sp-4)', width: full ? '100%' : undefined, ...style }}>
      {label && <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{label}</span>}
      <span style={{
        position: 'relative', display: 'flex', alignItems: 'center', height: 52,
        borderRadius: 'var(--radius-m)', background: 'var(--surface-control)', padding: '0 var(--sp-6)',
      }}>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={{
            flex: 1, appearance: 'none', border: 0, outline: 'none', background: 'transparent',
            color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)', fontFamily: 'var(--font-core)',
            fontSize: 'var(--type-body)', cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {options.map((o) => (
            <option key={optValue(o)} value={optValue(o)} style={{ background: '#17191B' }}>
              {optLabel(o)}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} style={{ color: 'var(--text-quiet)' }} />
      </span>
      <span style={{ minHeight: 18, fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{helper || ''}</span>
    </label>
  );
}
