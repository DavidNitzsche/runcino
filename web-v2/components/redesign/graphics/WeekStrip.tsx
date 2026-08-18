'use client';

import type { CSSProperties } from 'react';

/**
 * components/redesign/graphics/WeekStrip.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/WeekStrip.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same accent-by-session-type rule,
 * same today-outline / done-check treatment. 'use client' because onSelect
 * wires click/keyboard handlers.
 */

export type WeekStripState =
  | 'easy' | 'quality' | 'long' | 'rest' | 'race' | 'missed' | 'ease' | 'sick' | 'niggle' | 'skip';

const STATES: WeekStripState[] = ['easy', 'quality', 'long', 'rest', 'race', 'missed', 'ease', 'sick', 'niggle', 'skip'];
const norm = (s: string | undefined): WeekStripState =>
  (STATES as string[]).includes(s ?? '') ? (s as WeekStripState) : 'easy';

const ACCENT_KEY: Record<WeekStripState, string> = {
  easy: 'easy', quality: 'quality', missed: 'quality', long: 'long', rest: 'rest',
  race: 'race', ease: 'quality', sick: 'quality', niggle: 'quality', skip: 'quality',
};

/** One day of the week strip. */
export interface WeekStripDay {
  /** Three-letter day, e.g. "Mon". */
  dow: string;
  /** Date, kept the smallest thing in the cell. */
  date?: string;
  /** Miles. null renders as an em-rule for a rest day rather than "0". */
  mi?: number | string | null;
  /** The SESSION TYPE, which is the only thing the accent bar and status colour may encode. */
  state?: WeekStripState;
  /** Short status word, e.g. "Done", "Long", "Rest". */
  status?: string;
  /** Present when the day has a completed run to open. Without it the cell is not clickable. */
  runId?: string | number | null;
  today?: boolean;
  /** Completed. Draws a check. Never changes the hue. */
  done?: boolean;
  missed?: boolean;
}

export interface WeekStripProps {
  days: WeekStripDay[];
  /** Called with the day when a cell carrying a runId is activated. Opens run detail. */
  onSelect?: ((day: WeekStripDay) => void) | null;
  /** Inside a widget: cells step down from the container fill and today's cell lifts instead of being outlined. */
  inset?: boolean;
  style?: CSSProperties;
}

/**
 * The week as seven cards. On the page each cell is its own panel; inset inside a widget the
 * cells carry no fill at all - the accent bar and the space between them do the separating, and
 * today is the one cell drawn with an outline. A widget never repeats the page's paper as a fill.
 * The bar of colour is the SESSION TYPE and nothing else - easy green, quality amber, long blue,
 * race ember, rest grey. Completion is never a hue: a completed day carries a check; an upcoming
 * day is drawn at full strength too, because it is still real work. Load is the biggest character
 * in the cell; the date is the smallest, because the date is what the runner knows.
 */
export function WeekStrip({ days, onSelect = null, inset = false, style }: WeekStripProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 'var(--sp-5)', ...style }}>
      {days.map((d, i) => {
        const st = norm(d.state);
        const accent = st === 'rest' ? 'var(--text-disabled)' : `var(--state-${ACCENT_KEY[st]}-ink)`;
        const open = !!(onSelect && d.runId != null);
        return (
          <div
            key={i}
            role={open ? 'button' : undefined}
            tabIndex={open ? 0 : undefined}
            onClick={open ? () => onSelect?.(d) : undefined}
            onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(d); } } : undefined}
            style={{
              background: inset ? 'transparent' : 'var(--material-tile)', borderRadius: 'var(--radius-s)',
              overflow: 'hidden', position: 'relative', cursor: open ? 'pointer' : 'default',
              transition: 'box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out)',
              boxShadow: d.today ? 'inset 0 0 0 1.5px var(--text-primary)' : inset ? 'none' : 'var(--elevation-flat)',
            }}
          >
            <div style={{ height: 4, background: accent }} />
            {d.done && (
              <div aria-label="completed" style={{
                position: 'absolute', top: 12, right: 10, width: 15, height: 15, borderRadius: '50%',
                background: 'var(--text-primary)', color: 'var(--surface-tile)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, lineHeight: 1,
              }}>✓</div>
            )}
            <div style={{ padding: 'var(--sp-6) var(--sp-4) var(--sp-7)', textAlign: 'center' }}>
              <div style={{
                fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
                color: d.today ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}>{d.dow}</div>
              <div style={{ fontSize: 'var(--type-meta)', color: 'var(--text-quiet)', marginTop: 1 }}>{d.date}</div>
              <div className="faff-value" style={{
                fontSize: d.mi == null ? 'var(--type-value-4)' : 'var(--type-value-3)',
                marginTop: 'var(--sp-5)', color: d.mi == null ? 'var(--text-disabled)' : 'var(--text-primary)',
                textDecoration: d.missed ? 'line-through' : undefined,
              }}>{d.mi == null ? '--' : d.mi}</div>
              <div style={{
                fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginTop: 'var(--sp-4)',
                color: d.state === 'rest' ? 'var(--text-quiet)' : accent,
              }}>{d.status}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
