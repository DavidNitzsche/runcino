import type { CSSProperties } from 'react';

/**
 * components/redesign/nav/SegmentBar.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/nav/SegmentBar.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same active/inactive states.
 */

export interface SegmentBarOption {
  value: string;
  label: string;
}

export interface SegmentBarProps {
  value?: string;
  options?: Array<SegmentBarOption | string>;
  onChange?: (value: string) => void;
  full?: boolean;
  style?: CSSProperties;
}

/** Two to four mutually exclusive views of the same data. Not navigation. */
export function SegmentBar({ value, options = [], onChange, full = false, style }: SegmentBarProps) {
  return (
    <div style={{
      display: 'inline-flex', gap: 'var(--sp-1)', padding: 'var(--sp-1)',
      background: 'var(--material-track)', boxShadow: 'var(--elevation-recess)',
      borderRadius: 'var(--radius-pill)', width: full ? '100%' : undefined, ...style,
    }}>
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const on = value === id;
        return (
          <button
            key={id}
            onClick={() => onChange && onChange(id)}
            style={{
              flex: full ? 1 : undefined, minHeight: 40, padding: '0 var(--sp-7)', border: 0, cursor: 'pointer',
              borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-core)', fontSize: 'var(--type-label)',
              fontWeight: 'var(--weight-medium)',
              background: on ? 'var(--material-control)' : 'transparent',
              boxShadow: on ? 'var(--elevation-control)' : 'none',
              color: on ? 'var(--text-primary)' : 'var(--text-quiet)',
              transition: 'background var(--dur-2) var(--ease-out)',
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}
