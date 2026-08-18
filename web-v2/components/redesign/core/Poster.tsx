import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/core/Poster.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/Poster.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same gradient-per-state scheme.
 * NOTE the source lives under the handoff's components/graphics/ directory,
 * not components/core/ — moved here per the task's target layout
 * (web-v2/components/redesign/core/Poster.tsx) since Today's own hero use
 * is a "core" concern for this app, not a chart/graphic.
 */

export type PosterState =
  | 'easy' | 'quality' | 'long' | 'rest' | 'done' | 'race' | 'phase'
  | 'missed' | 'ease' | 'sick' | 'niggle' | 'new' | 'skip';

const STATES: PosterState[] = [
  'easy', 'quality', 'long', 'rest', 'done', 'race', 'phase',
  'missed', 'ease', 'sick', 'niggle', 'new', 'skip',
];
const norm = (s: string | undefined): PosterState =>
  (STATES as string[]).includes(s ?? '') ? (s as PosterState) : 'easy';

export type PosterRadius = 'm' | 'l' | 'xl' | '2xl';

export interface PosterStat {
  v: ReactNode;
  l: string;
  /** dims a stat that is context rather than target. */
  tone?: 'soft';
}

export interface PosterProps {
  /** The day state, which picks the gradient. race is reserved for race week. */
  state?: PosterState;
  /** Small uppercase context line, e.g. "Today · Thursday 17 Sep". */
  tag?: ReactNode | null;
  /** The one-word instruction, set in the display register. */
  verb: ReactNode;
  /** The dose, e.g. "6 mi" or "2 × 3 mi @ 6:52". */
  dose?: ReactNode | null;
  /** The prescription in the coach's own words. */
  rx?: ReactNode | null;
  /** Phase and block context, quiet, under the prescription. */
  phase?: string | null;
  /** Up to three stats on the baseline. tone "soft" dims one that is context rather than target. */
  stats?: PosterStat[] | null;
  radius?: PosterRadius;
  minHeight?: number;
  children?: ReactNode;
  style?: CSSProperties;
}

const RADIUS: Record<PosterRadius, string> = {
  m: 'var(--radius-m)', l: 'var(--radius-l)', xl: 'var(--radius-xl)', '2xl': 'var(--radius-2xl)',
};

/**
 * The poster: today's prescription rendered as a full-bleed gradient card, one per screen.
 * The day state picks the gradient; nothing else on the screen may wear it. White type over a
 * scrim, the verb in the display register, and up to three stats sitting on the baseline.
 * A poster is never a banner across the top: it holds a column and a sibling card sits beside it.
 */
export function Poster({
  state = 'easy', tag = null, verb, dose = null, rx = null, phase = null, stats = null,
  radius = 'l', minHeight = 480, children, style,
}: PosterProps) {
  const g = `var(--g-${norm(state)})`;
  const r = RADIUS[radius];
  return (
    <div
      style={{
        position: 'relative', borderRadius: r, overflow: 'hidden', backgroundImage: g,
        minHeight, display: 'flex', flexDirection: 'column', color: '#fff', ...style,
      }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'var(--poster-scrim)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, padding: 'var(--sp-10) var(--sp-10) var(--sp-9)' }}>
        {tag && (
          <div style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-kicker)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-kicker)', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)',
          }}>{tag}</div>
        )}
        <div className="faff-display" style={{ fontSize: 'var(--type-display-1)', lineHeight: 'var(--lh-display-1)', marginTop: 'var(--sp-4)' }}>
          {verb}
        </div>
        {dose && (
          <div className="faff-value" style={{ fontSize: 'var(--type-value-2)', marginTop: 'var(--sp-5)' }}>{dose}</div>
        )}
        {rx && (
          <div style={{
            fontSize: 'var(--type-say-2)', fontWeight: 'var(--weight-medium)', lineHeight: 1.45,
            color: 'rgba(255,255,255,.94)', marginTop: 'var(--sp-7)', maxWidth: '34ch', textWrap: 'pretty',
          }}>{rx}</div>
        )}
        {phase && (
          <div style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)',
            marginTop: 'var(--sp-7)',
          }}>{phase}</div>
        )}
        {children}
        {stats && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-8)', marginTop: 'auto', paddingTop: 'var(--sp-9)' }}>
            {stats.map((s, i) => (
              <div key={i}>
                <div className="faff-value" style={{ fontSize: 'var(--type-value-2)', color: s.tone === 'soft' ? 'rgba(255,255,255,.78)' : '#fff' }}>{s.v}</div>
                <div style={{
                  fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                  letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'rgba(255,255,255,.74)',
                  marginTop: 'var(--sp-3)',
                }}>{s.l}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
