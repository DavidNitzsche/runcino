import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/feedback/EmptyState.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/EmptyState.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same display-headline + one
 * sentence + action(s) shape.
 *
 * Distinct from Silence (same directory): EmptyState is a full designed
 * screen state for "nothing exists here yet, and there is something to do
 * about it" — day one, no shoes logged, no plan yet — headline in the
 * display face plus a concrete CTA. Silence is a single reserved-height
 * quiet line for "the coach has nothing honest to say about this specific
 * thing right now" — no headline, no action, just one sentence at body
 * size. Confirmed against real call sites: WebDayOne.jsx wraps its whole
 * left panel in EmptyState with a "Write my block" action, while the same
 * file's "coached" onboarding mode and its Fitness tile use Silence for a
 * single missing-data line with no CTA.
 */

export interface EmptyStateProps {
  /** Short, in the editorial display face. Never "Nothing here yet". */
  headline: string;
  children?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  height?: number | string;
  style?: CSSProperties;
}

/**
 * Day one. A real screen a real new user sees, designed as product rather than as an absence.
 * States what will exist here and offers the one action that makes it exist.
 */
export function EmptyState({ headline, children, action = null, secondary = null, height, style }: EmptyStateProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-7)', alignContent: 'center', minHeight: height, padding: 'var(--sp-11) 0', ...style }}>
      <div className="faff-display" style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-display)', fontStretch: 'var(--display-stretch)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-display)',
        fontSize: 'var(--type-display-3)', lineHeight: 'var(--lh-display-3)',
      }}>
        {headline}
      </div>
      <p style={{
        margin: 0, fontSize: 'var(--type-say-3)', lineHeight: 'var(--lh-say-3)', color: 'var(--text-secondary)',
        maxWidth: 'var(--measure-say)', textWrap: 'pretty',
      }}>
        {children}
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', marginTop: 'var(--sp-4)' }}>
        {action}
        {secondary}
      </div>
    </div>
  );
}
