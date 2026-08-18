'use client';

import { useState, type CSSProperties } from 'react';

/**
 * components/redesign/core/Input.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Input.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same reserved-helper-row layout
 * so validation never reflows the field above it.
 */

export interface InputProps {
  label?: string;
  value?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Helper text. Occupies a reserved row whether present or not. */
  helper?: string | null;
  /** Error text replaces the helper and rings the field. States what is wrong, not that something is. */
  error?: string | null;
  /** Unit set quietly inside the field, e.g. "bpm", "mi". */
  unit?: string | null;
  type?: 'text' | 'number' | 'email' | 'password' | 'date' | 'time';
  disabled?: boolean;
  full?: boolean;
  style?: CSSProperties;
}

/** Text field. Helper and error text occupy the same reserved row so nothing reflows. */
export function Input({
  label, value, onChange, placeholder, helper = null, error = null, unit = null,
  type = 'text', disabled = false, full = true, style,
}: InputProps) {
  const [hot, setHot] = useState(false);
  const bad = !!error;
  return (
    <label style={{ display: 'grid', gap: 'var(--sp-4)', width: full ? '100%' : undefined, ...style }}>
      {label && <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{label}</span>}
      <span
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', height: 52, padding: '0 var(--sp-6)',
          borderRadius: 'var(--radius-m)', background: disabled ? 'var(--surface-1)' : 'var(--surface-control)',
          boxShadow: bad ? 'inset 0 0 0 2px var(--fault)' : hot ? 'inset 0 0 0 2px var(--surface-4)' : 'none',
          transition: 'box-shadow var(--dur-2) var(--ease-out)',
        }}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
      >
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={{
            flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
            color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)', fontFamily: 'var(--font-core)',
            fontSize: 'var(--type-body)', fontVariantNumeric: 'tabular-nums',
          }}
        />
        {unit && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{unit}</span>}
      </span>
      <span style={{ minHeight: 18, fontSize: 'var(--type-label-s)', color: bad ? 'var(--fault)' : 'var(--text-quiet)' }}>
        {error || helper || ''}
      </span>
    </label>
  );
}
