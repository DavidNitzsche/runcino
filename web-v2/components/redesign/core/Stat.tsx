import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/core/Stat.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/Stat.jsx + .d.ts), 2026-08-18.
 * Faithful port: same tokens, same size table.
 */

export type StatSize = 'xl' | 'lg' | 'md' | 'sm';
export type StatTone = 'primary' | 'attention' | 'fault' | 'quiet';
export type StatAlign = 'left' | 'right' | 'center';

export interface StatProps {
  label?: string;
  /** Small qualifying sub-label, e.g. "Against your own normal". */
  sub?: string;
  value: ReactNode;
  /** Unit, set small beside the value. Never on its own line. */
  unit?: string;
  size?: StatSize;
  /** attention = the value is outside its range. fault = we could not read it. */
  tone?: StatTone;
  /** Set the value in the editorial display face instead of the numeral face. */
  display?: boolean;
  align?: StatAlign;
  children?: ReactNode;
  style?: CSSProperties;
}

const SIZE: Record<StatSize, string> = {
  xl: 'var(--type-value-1)',
  lg: 'var(--type-value-2)',
  md: 'var(--type-value-3)',
  sm: 'var(--type-value-4)',
};

/** Label, optional qualifying sub-label, one enormous value, unit set small beside it. */
export function Stat({
  label, sub, value, unit, size = 'md', tone = 'primary', display = false, align = 'left', style, children,
}: StatProps) {
  const color: Record<StatTone, string> = {
    primary: 'var(--text-primary)',
    attention: 'var(--attention)',
    fault: 'var(--fault)',
    quiet: 'var(--text-quiet)',
  };
  return (
    <div style={{ textAlign: align, ...style }}>
      {label && (
        <div style={{
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: 'var(--lh-label)',
          color: 'var(--text-secondary)',
        }}>{label}</div>
      )}
      {sub && (
        <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>{sub}</div>
      )}
      {value != null && (
        <div style={{
          marginTop: 'var(--sp-4)', fontSize: SIZE[size], color: color[tone],
          fontFamily: display ? 'var(--font-display)' : 'var(--font-value)',
          fontWeight: 'var(--weight-display)',
          textTransform: display ? 'uppercase' : undefined,
          letterSpacing: display ? 'var(--tracking-display)' : 'var(--tracking-value)',
          lineHeight: 'var(--lh-value)', fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
          {unit && (
            <span style={{
              fontSize: '.32em', fontWeight: 'var(--weight-medium)', color: 'var(--text-quiet)',
              marginLeft: 6, letterSpacing: '-.01em', textTransform: 'none', fontFamily: 'var(--font-core)',
            }}>{unit}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
