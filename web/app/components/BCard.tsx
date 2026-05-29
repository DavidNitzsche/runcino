/**
 * BCard · the standard content card used inside FaffPageShell content.
 *
 * Container only · content is composed by the page. Header (label +
 * optional small value) + content area + optional footnote.
 *
 * Mirror: Faff/apps/web/src/components/races/BCard.tsx (re-export).
 * Adapted from Faff/apps/web/src/components/BCard.tsx so this worktree's
 * `web/` app uses the same v3 contract.
 */

import type { ReactNode, CSSProperties } from 'react';

export type BCardValueColor = 'default' | 'amber' | 'green' | 'over' | 'race' | 'dist' | 'learn';
export type BCardWash = 'coach' | 'race' | 'amber' | 'good' | 'warn' | 'xp' | 'learn';

const VALUE_COLOR: Record<BCardValueColor, string> = {
  default: 'var(--ink)',
  amber:   'var(--color-attention, #F3AD38)',
  green:   'var(--color-success, #3EBD41)',
  over:    'var(--color-warning, #FC4D64)',
  race:    'var(--race, #FF5722)',
  dist:    'var(--color-corporate, #27B4E0)',
  learn:   'var(--color-xp, #9013FE)',
};

const WASH_STYLES: Record<BCardWash, CSSProperties> = {
  coach: { background: 'linear-gradient(135deg, rgba(39,180,224,.10) 0%, var(--l1) 65%)', borderColor: 'rgba(39,180,224,.30)' },
  race:  { background: 'linear-gradient(135deg, rgba(255,87,34,.10) 0%, var(--l1) 65%)',  borderColor: 'rgba(255,87,34,.28)' },
  amber: { background: 'linear-gradient(135deg, rgba(243,173,56,.10) 0%, var(--l1) 65%)', borderColor: 'rgba(243,173,56,.24)' },
  good:  { background: 'linear-gradient(135deg, rgba(62,189,65,.10) 0%, var(--l1) 65%)',  borderColor: 'rgba(62,189,65,.28)' },
  warn:  { background: 'linear-gradient(135deg, rgba(252,77,100,.10) 0%, var(--l1) 65%)', borderColor: 'rgba(252,77,100,.28)' },
  xp:    { background: 'linear-gradient(135deg, rgba(144,19,254,.10) 0%, var(--l1) 65%)', borderColor: 'rgba(144,19,254,.28)' },
  learn: { background: 'linear-gradient(135deg, rgba(176,132,255,.10) 0%, var(--l1) 65%)', borderColor: 'rgba(176,132,255,.28)' },
};

export interface BCardProps {
  header: {
    label: string;
    value?: string;
    valueColor?: BCardValueColor;
  };
  children: ReactNode;
  padding?: 'standard' | 'tight';
  footnote?: ReactNode;
  /** Optional accent wash; matches the existing Card component palette. */
  wash?: BCardWash;
  style?: CSSProperties;
}

export function BCard({ header, children, padding = 'standard', footnote, wash, style }: BCardProps) {
  const mergedStyle: CSSProperties = {
    background: 'var(--l1)',
    border: '1px solid var(--l4)',
    borderRadius: 14,
    padding: padding === 'tight' ? '14px 16px' : '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    ...(wash ? WASH_STYLES[wash] : {}),
    ...style,
  };
  return (
    <div className="bcard" style={mergedStyle}>
      <div className="bcard-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{
          fontFamily: 'var(--font-data, var(--f-data))',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '1.6px',
          textTransform: 'uppercase',
          color: 'var(--mute)',
        }}>{header.label}</span>
        {header.value && (
          <span className="tabular" style={{
            fontFamily: 'var(--font-data, var(--f-data))',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: VALUE_COLOR[header.valueColor ?? 'default'],
            fontVariantNumeric: 'tabular-nums',
          }}>{header.value}</span>
        )}
      </div>
      <div className="bcard-content">{children}</div>
      {footnote && (
        <div style={{
          fontFamily: 'var(--font-data, var(--f-data))',
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: 'var(--dim, var(--mute))',
          paddingTop: 10,
          borderTop: '1px solid var(--l4)',
        }}>
          {footnote}
        </div>
      )}
    </div>
  );
}
