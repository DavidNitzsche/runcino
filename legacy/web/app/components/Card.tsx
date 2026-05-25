/**
 * Card · CardHeader · CardLabel · CardPin · CardFoot
 *
 * The canonical card primitive from the May 2026 mockups.
 * - <Card> is a vertically stacked container with a 14px radius and
 *   `var(--l1)` background.
 * - <CardHeader> places a label/title on the left and pin(s) on the right.
 * - <CardLabel> is the small uppercase tracker text ("WEEKLY MILES").
 * - <CardPin> is the small status badge ("+12% V8W"). Variants tie to
 *   the design-system semantic palette.
 * - <CardFoot> is the bottom-aligned mono caption strip.
 */

import type { ReactNode, HTMLAttributes, CSSProperties } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Grid-span. Renders as the `span-N` class. */
  span?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  /** Override default padding (18px 20px). */
  padding?: number | string;
  /** Optional accent wash from the mockup's Coach Read / Race / Plan-Adapted patterns. */
  wash?: 'coach' | 'race' | 'amber' | 'good' | 'warn' | 'xp';
}

const WASH_STYLES: Record<NonNullable<CardProps['wash']>, CSSProperties> = {
  coach: {
    background: 'linear-gradient(135deg, rgba(39,180,224,.12) 0%, var(--l1) 65%)',
    borderColor: 'rgba(39,180,224,.32)',
  },
  race: {
    background: 'linear-gradient(135deg, rgba(255,87,34,.10) 0%, var(--l1) 60%)',
    borderColor: 'rgba(255,87,34,.28)',
  },
  amber: {
    background: 'linear-gradient(135deg, rgba(243,173,56,.10) 0%, var(--l1) 60%)',
    borderColor: 'rgba(243,173,56,.24)',
  },
  good: {
    background: 'linear-gradient(135deg, rgba(62,189,65,.10) 0%, var(--l1) 60%)',
    borderColor: 'rgba(62,189,65,.28)',
  },
  warn: {
    background: 'linear-gradient(135deg, rgba(252,77,100,.10) 0%, var(--l1) 60%)',
    borderColor: 'rgba(252,77,100,.28)',
  },
  xp: {
    background: 'linear-gradient(135deg, rgba(144,19,254,.10) 0%, var(--l1) 60%)',
    borderColor: 'rgba(144,19,254,.28)',
  },
};

export function Card({ children, span, padding, wash, className, style, ...rest }: CardProps) {
  const merged: CSSProperties = { ...(wash ? WASH_STYLES[wash] : {}), ...style };
  if (padding !== undefined) merged.padding = typeof padding === 'number' ? `${padding}px` : padding;
  const classes = ['card'];
  if (span) classes.push(`span-${span}`);
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')} style={merged} {...rest}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  children: ReactNode;
}
export function CardHeader({ children }: CardHeaderProps) {
  return <div className="card-h">{children}</div>;
}

export interface CardLabelProps {
  children: ReactNode;
  /** Optional accent color (e.g. coach blue when the card is a Coach Read). */
  color?: string;
}
export function CardLabel({ children, color }: CardLabelProps) {
  return (
    <div className="card-l" style={color ? { color } : undefined}>
      {children}
    </div>
  );
}

export type CardPinVariant =
  | 'green'
  | 'amber'
  | 'warn'
  | 'blue'
  | 'purple'
  | 'race'
  | 'coach'
  | 'muted';

export interface CardPinProps {
  variant?: CardPinVariant;
  children: ReactNode;
}
export function CardPin({ variant = 'muted', children }: CardPinProps) {
  return <span className={`card-pin ${variant}`}>{children}</span>;
}

export interface CardFootProps {
  /** Left side (typically a label or stat). */
  left?: ReactNode;
  /** Right side (typically a delta or status). */
  right?: ReactNode;
  children?: ReactNode;
}
export function CardFoot({ left, right, children }: CardFootProps) {
  if (children) {
    return <div className="card-foot">{children}</div>;
  }
  return (
    <div className="card-foot">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
