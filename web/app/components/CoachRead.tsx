/**
 * CoachRead — coach-blue tinted lead card from the locked run-detail
 * template (and reusable on Overview / Training / Races for any "Coach
 * has decided X" surface).
 *
 * Anatomy (matches the locked detail-template card exactly):
 *   1. Card header: ▸ COACH READ label · optional pin
 *      ("+12% BASELINE UNLOCKED" etc.)
 *   2. Section-size title: the verdict ("Recovery run, but you absorbed more.")
 *   3. Body paragraph: the explanation, with bolded numbers
 *   4. Two-column decision-delta strip: each delta shows label · old · → · new
 *
 * The card uses the canonical coach wash (`<Card wash="coach">`).
 *
 * Deltas are an array; if provided, the strip renders at the bottom.
 */

import type { ReactNode } from 'react';
import { Card, CardHeader, CardLabel, CardPin, type CardPinVariant } from './Card';

export interface CoachReadDelta {
  /** Eyebrow label for the delta (e.g. "VOL / WK"). */
  label: ReactNode;
  /** The "was" value. Rendered struck-through, muted. */
  before: ReactNode;
  /** The "now" value. Rendered bold, coach-blue. */
  after: ReactNode;
  /** Optional unit suffix on the "now" value (e.g. "mi"). */
  unit?: ReactNode;
}

export interface CoachReadProps {
  /** Override the label. Default: "▸ COACH READ". */
  eyebrow?: ReactNode;
  /** Optional badge in the top-right (e.g. "+12% BASELINE UNLOCKED"). */
  pin?: ReactNode;
  pinVariant?: CardPinVariant;
  /** The verdict sentence — large, section-size, leading. */
  title: ReactNode;
  /** Body copy children — typically a <p> with <b> highlights. */
  children?: ReactNode;
  /** Optional decision deltas. */
  deltas?: CoachReadDelta[];
  /** Grid-span. Default: 7 (matches the locked template). */
  span?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

export function CoachRead({
  eyebrow = '▸ COACH READ',
  pin,
  pinVariant = 'coach',
  title,
  children,
  deltas,
  span = 7,
}: CoachReadProps) {
  return (
    <Card wash="coach" span={span} padding="18px 22px">
      <CardHeader>
        <CardLabel color="var(--coach)">{eyebrow}</CardLabel>
        {pin !== undefined && <CardPin variant={pinVariant}>{pin}</CardPin>}
      </CardHeader>
      <div className="t-section" style={{ fontSize: 20, lineHeight: 1.2, marginTop: 4 }}>
        {title}
      </div>
      {children !== undefined && (
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 6 }}>
          {children}
        </div>
      )}
      {deltas && deltas.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${deltas.length}, 1fr)`,
            gap: 10,
            marginTop: 'auto',
            paddingTop: 14,
          }}
        >
          {deltas.map((d, i) => (
            <div
              key={i}
              style={{
                padding: '8px 12px',
                background: 'var(--l2)',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                className="mono-sm"
                style={{ color: 'var(--t3)', fontSize: 9 }}
              >
                {d.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: 11,
                    color: 'var(--t3)',
                    textDecoration: 'line-through',
                  }}
                >
                  {d.before}
                </span>
                <span style={{ color: 'var(--coach)', fontWeight: 700 }}>→</span>
                <span
                  style={{
                    fontFamily: 'var(--f-display)',
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--coach)',
                    lineHeight: 1,
                  }}
                >
                  {d.after}
                  {d.unit !== undefined && (
                    <small style={{ fontSize: '.55em', opacity: 0.7, marginLeft: 2 }}>
                      {d.unit}
                    </small>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
