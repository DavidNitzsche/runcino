import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/graphics/DualPoint.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/DualPoint.jsx + .d.ts),
 * 2026-08-18. Faithful port: same solid-mark/hollow-mark track construction,
 * same tone→color and surface→halo mappings.
 *
 * Two values and the distance between them, drawn as one filled track with
 * a solid mark (where you are) and a hollow mark (where you said you wanted
 * to be). Built for the gap: projected finish against the goal.
 */

export type DualPointTone = 'attention' | 'signal';
export type DualPointSurface = 'tile' | 'raised';

export interface DualPointProps {
  leftLabel: string;
  leftValue: ReactNode;
  rightLabel: string;
  rightValue: ReactNode;
  gapLabel: string;
  gapValue: ReactNode;
  /** 0 to 1: how far the current value sits toward the goal. */
  progress?: number;
  /** attention = the gap is widening or unclosable. signal = it is closing. */
  tone?: DualPointTone;
  surface?: DualPointSurface;
  /** Two quiet strings under the track, e.g. status and confidence. */
  note?: string[] | null;
  style?: CSSProperties;
}

export function DualPoint({
  leftLabel, leftValue, rightLabel, rightValue, gapLabel, gapValue,
  progress = 0.62, tone = 'attention', surface = 'tile', note = null, style,
}: DualPointProps) {
  const color = tone === 'attention' ? 'var(--attention)' : 'var(--signal)';
  const halo = surface === 'raised' ? 'var(--surface-tile-raised)' : 'var(--surface-tile)';
  return (
    <div style={style}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: 'var(--sp-7)' }}>
        <div>
          <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginBottom: 'var(--sp-5)' }}>
            {leftLabel}
          </div>
          <div style={{
            fontSize: 'var(--type-value-2)', fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-value)', lineHeight: 'var(--lh-value)',
          }}>
            {leftValue}
          </div>
        </div>
        <div style={{ textAlign: 'center', color }}>
          <div style={{ fontSize: 'var(--type-label-s)', marginBottom: 'var(--sp-5)' }}>{gapLabel}</div>
          <div style={{ fontSize: 'var(--type-value-4)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-value)' }}>
            {gapValue}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginBottom: 'var(--sp-5)' }}>
            {rightLabel}
          </div>
          <div style={{
            fontSize: 'var(--type-value-2)', color: 'var(--text-quiet)', fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-value)', lineHeight: 'var(--lh-value)',
          }}>
            {rightValue}
          </div>
        </div>
      </div>
      <div style={{
        position: 'relative', height: 'var(--track-height)', background: 'var(--range-track)',
        borderRadius: 'var(--radius-pill)', marginTop: 'var(--sp-9)',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`,
          background: color, borderRadius: 'var(--radius-pill)',
        }} />
        <div style={{
          position: 'absolute', top: -7, width: 22, height: 22, borderRadius: '50%', background: color,
          boxShadow: `0 0 0 var(--mark-halo) ${halo}`, left: `calc(${progress * 100}% - 11px)`,
        }} />
        <div style={{
          position: 'absolute', top: -7, width: 22, height: 22, borderRadius: '50%', background: 'transparent',
          boxShadow: `inset 0 0 0 3px var(--text-quiet), 0 0 0 var(--mark-halo) ${halo}`, left: 'calc(100% - 11px)',
        }} />
      </div>
      {note && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-5)',
          fontSize: 'var(--type-meta)', color: 'var(--text-quiet)',
        }}>
          {note.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
    </div>
  );
}
