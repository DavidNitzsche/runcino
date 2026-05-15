/**
 * v4 stat pill — one of the four pills in the hero card's stats row.
 *
 *   ┌─────────────┐
 *   │ 5.5 mi      │  ← value + unit (Bebas Neue + Inter)
 *   │ DISTANCE    │  ← label (Inter uppercase)
 *   └─────────────┘
 *
 * The brief specifies this shape: stat-value 32px Bebas Neue, stat-unit
 * 13px Inter aligned to the baseline, stat-label 12px uppercase.
 *
 * Renders an em-dash when value is null so the layout stays put when
 * data is missing — the trust contract is "honest NO DATA YET," not a
 * fake zero.
 */

import type { ReactNode } from 'react';

export interface StatPillProps {
  /** Big number (Bebas Neue). Pass null for "NO DATA YET" → em-dash. */
  value: string | number | null;
  /** Unit after the value (e.g. "mi", "/mi", "min", "bpm"). */
  unit?: string;
  /** Uppercase label below the value. */
  label: string;
  /** Optional override for the full pill — useful for grouping (e.g.
   *  spanning the row). */
  style?: React.CSSProperties;
}

export function StatPill({ value, unit, label, style }: StatPillProps) {
  const display: ReactNode = value == null || value === '' ? '—' : String(value);
  return (
    <div
      style={{
        background: 'rgba(13,15,18,.04)',
        border: '1px solid rgba(13,15,18,.08)',
        borderRadius: '10px',
        padding: '14px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '2px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
        <span
          style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: '32px',
            lineHeight: 1,
            color: 'var(--ink, #0D0F12)',
          }}
        >
          {display}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              color: 'rgba(13,15,18,.55)',
              marginLeft: '1px',
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '12px',
          letterSpacing: '1.5px',
          color: 'rgba(13,15,18,.35)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}
