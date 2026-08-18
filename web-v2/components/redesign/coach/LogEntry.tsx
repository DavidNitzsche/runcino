import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/coach/LogEntry.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/coach/LogEntry.jsx + .d.ts),
 * 2026-08-18. Faithful port: same KIND label table, same tokens.
 *
 * One entry in the coach's log. The log is the closest thing the product
 * has to a relationship. `graphic` is an optional supporting visual — a
 * WeekShape for a week close, a DualPoint for a first-ever (see real usage
 * in designs/design-review-0818/ui_kits/web/WebWeekDetail.jsx).
 */

export type LogEntryKind = 'week-close' | 'phase' | 'first' | 'fitness' | 'discipline';

const KIND: Record<LogEntryKind, string> = {
  'week-close': 'Week close',
  phase: 'Phase boundary',
  first: 'First ever',
  fitness: 'Fitness shift',
  discipline: 'Easy day discipline',
};

export interface LogEntryProps {
  kind?: LogEntryKind;
  date: string;
  children?: ReactNode;
  /** Optional graphic: a WeekShape for a week close, a DualPoint for a first-ever. */
  graphic?: ReactNode;
  style?: CSSProperties;
}

export function LogEntry({ kind = 'week-close', date, children, graphic = null, style }: LogEntryProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-5)', padding: 'var(--sp-8) 0', ...style }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-meta)',
        letterSpacing: 'var(--tracking-kicker)', textTransform: 'uppercase', color: 'var(--text-quiet)',
      }}>
        <span>{KIND[kind] || kind}</span><span>{date}</span>
      </div>
      <p style={{
        margin: 0, fontSize: 'var(--type-say-2)', lineHeight: 'var(--lh-say-2)',
        letterSpacing: 'var(--tracking-say)', textWrap: 'pretty', maxWidth: 'var(--measure-say)',
      }}>
        {children}
      </p>
      {graphic}
    </div>
  );
}
