/**
 * Greet · GreetId · GreetTile
 *
 * The canonical "greeting band" from the May 2026 mockups. It collapses
 * the page's hero + a row of state KPIs into a single dense strip.
 *
 * Anatomy: <Greet> is a horizontal flex; left side is <GreetId>
 * (eyebrow + uppercase title), right side is one or more <GreetTile>s
 * laid out on a 5-up grid via `.greet-state`.
 *
 * Used by every main page (Overview, Training, Races, Health, Log,
 * Profile) AND by detail views (the run-detail template uses Greet for
 * the page hero — eyebrow + run name on the left, 5 KPI tiles on the
 * right).
 */

import type { ReactNode } from 'react';

export interface GreetProps {
  children: ReactNode;
}
export function Greet({ children }: GreetProps) {
  return <div className="greet">{children}</div>;
}

export interface GreetIdProps {
  /** Eyebrow text shown above the title — uppercase, mono, muted. */
  eyebrow: ReactNode;
  /** Main title — uppercase display font. */
  title: ReactNode;
}
export function GreetId({ eyebrow, title }: GreetIdProps) {
  return (
    <div className="greet-id">
      <div className="hi">{eyebrow}</div>
      <h1>{title}</h1>
    </div>
  );
}

export interface GreetStateProps {
  children: ReactNode;
  /** Override the default 5-tile grid. */
  columns?: number;
}
export function GreetState({ children, columns }: GreetStateProps) {
  return (
    <div
      className="greet-state"
      style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
    >
      {children}
    </div>
  );
}

export type GreetTileVariant = 'default' | 'amber' | 'race' | 'coach' | 'good';

export interface GreetTileProps {
  variant?: GreetTileVariant;
  /** Small uppercase label above the value. */
  eyebrow: ReactNode;
  /** Hero number. */
  value: ReactNode;
  /** Optional small unit, rendered inline next to the value. */
  unit?: ReactNode;
  /** Footnote / delta beneath the value. */
  delta?: ReactNode;
  /** Color for the delta text (e.g. var(--good) for +). */
  deltaColor?: string;
}
export function GreetTile({
  variant = 'default',
  eyebrow,
  value,
  unit,
  delta,
  deltaColor,
}: GreetTileProps) {
  return (
    <div className={`greet-tile${variant !== 'default' ? ` ${variant}` : ''}`}>
      <div className="l">{eyebrow}</div>
      <div className="v">
        {value}
        {unit !== undefined && <small>{unit}</small>}
      </div>
      {delta !== undefined && (
        <div className="d" style={deltaColor ? { color: deltaColor } : undefined}>
          {delta}
        </div>
      )}
    </div>
  );
}
