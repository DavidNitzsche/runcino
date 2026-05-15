/**
 * v4 segments table — warmup / main / cooldown breakdown for the hero
 * card. The "main" row gets a green-wash background per the doctrine
 * that the main block is the part of the workout that matters most.
 *
 * Layout (per overview-v4 .segment-row):
 *   ┌──────────┬─────┬──────┬──────────┐
 *   │ WARMUP   │ 10m │ 1.0mi│ 10:00/mi │
 *   │ MAIN     │ 32m │ 3.5mi│ 9:09/mi  │   ← green wash, green text
 *   │ COOLDOWN │ 10m │ 1.0mi│ 10:00/mi │
 *   └──────────┴─────┴──────┴──────────┘
 */

import type { ReactNode } from 'react';

export interface SegmentRow {
  /** Block name — WARMUP / MAIN / COOLDOWN / STRIDES / etc. Uppercased
   *  on render via CSS. */
  label: string;
  /** Duration in plain text, e.g. "10 min" or "32 min". */
  duration: string;
  /** Distance, e.g. "1.0 mi" or "3.5 mi". */
  distance: string;
  /** Pace, e.g. "10:00/mi" or "9:09/mi avg". */
  pace: string;
  /** True for the main block — gets the green wash + green text. */
  isMain?: boolean;
}

export interface SegmentsTableProps {
  rows: SegmentRow[];
  /** Optional override for the outer wrapper. */
  style?: React.CSSProperties;
}

export function SegmentsTable({ rows, style }: SegmentsTableProps) {
  if (rows.length === 0) return null;

  return (
    <div
      style={{
        border: '1px solid rgba(13,15,18,.08)',
        borderRadius: '12px',
        overflow: 'hidden',
        marginTop: '24px',
        ...style,
      }}
    >
      {rows.map((row, idx) => (
        <Row key={`${row.label}-${idx}`} row={row} />
      ))}
    </div>
  );
}

function Row({ row }: { row: SegmentRow }) {
  const isMain = !!row.isMain;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 60px 70px 90px',
        alignItems: 'center',
        padding: '14px 20px',
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        background: isMain ? 'rgba(44,168,47,.06)' : 'transparent',
      }}
    >
      <Cell type="label" main={isMain}>{row.label}</Cell>
      <Cell type="dim">{row.duration}</Cell>
      <Cell type="data">{row.distance}</Cell>
      <Cell type="pace" main={isMain}>{row.pace}</Cell>
    </div>
  );
}

function Cell({
  type,
  main,
  children,
}: {
  type: 'label' | 'dim' | 'data' | 'pace';
  main?: boolean;
  children: ReactNode;
}) {
  if (type === 'label') {
    return (
      <span
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 600,
          fontSize: '13px',
          letterSpacing: '1px',
          color: main ? 'var(--recovery, #2CA82F)' : 'rgba(13,15,18,.55)',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </span>
    );
  }
  if (type === 'dim') {
    return <span style={{ color: 'rgba(13,15,18,.35)' }}>{children}</span>;
  }
  if (type === 'pace') {
    return (
      <span
        style={{
          color: main ? 'var(--recovery, #2CA82F)' : 'rgba(13,15,18,.55)',
          fontWeight: main ? 600 : 400,
        }}
      >
        {children}
      </span>
    );
  }
  return <span style={{ color: 'rgba(13,15,18,.55)' }}>{children}</span>;
}
