import type { CSSProperties, ReactNode } from 'react';
import { Button, type ButtonVariant } from '@/components/redesign/core/Button';

/**
 * components/redesign/coach/CoachDecision.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/coach/CoachDecision.jsx + .d.ts),
 * 2026-08-18. Faithful port: same KIND kicker/tone table, same
 * first-primary/last-bails-full-width button layout.
 *
 * A coach asking, not an app interrupting. One grammar for all three
 * flavours: a decision the runner must make, a proposal the coach
 * suggests, or a change already applied with nothing to do. Real usage in
 * designs/design-review-0818/ui_kits/web/WebSeason.jsx — `kind="decision"`
 * with three options (hold the goal / move the goal / decide later) and a
 * `footer` showing the revised target band.
 */

export type CoachDecisionKind = 'decision' | 'proposal' | 'applied';

const KIND: Record<CoachDecisionKind, { kicker: string; tone: string }> = {
  decision: { kicker: 'Needs a decision', tone: 'var(--attention)' },
  proposal: { kicker: 'A proposal', tone: 'var(--signal)' },
  applied: { kicker: 'Already applied', tone: 'var(--text-quiet)' },
};

export interface CoachDecisionOption {
  label: string;
  onClick?: () => void;
}

export interface CoachDecisionProps {
  /** decision = the runner must choose. proposal = the coach suggests. applied = nothing to do. */
  kind?: CoachDecisionKind;
  children?: ReactNode;
  /** Ordered verbs. First is primary, last is the quiet way out ("Decide later"). */
  options?: CoachDecisionOption[];
  /** Supporting graphic, e.g. the revised target band drawn as a RangeScale. */
  footer?: ReactNode;
  style?: CSSProperties;
}

/** Concrete verbs only, never "Accept" and "Dismiss" — see Button's own rule. */
export function CoachDecision({ kind = 'decision', children, options = [], footer = null, style }: CoachDecisionProps) {
  const k = KIND[kind];
  return (
    <div style={{
      background: 'var(--surface-tile-raised)', borderRadius: 'var(--radius-2xl)',
      padding: 'var(--tile-pad-lg)', display: 'grid', gap: 'var(--sp-8)', alignContent: 'start', ...style,
    }}>
      <div style={{
        fontSize: 'var(--type-kicker)', letterSpacing: 'var(--tracking-kicker)',
        textTransform: 'uppercase', color: k.tone,
      }}>
        {k.kicker}
      </div>
      <p style={{
        margin: 0, fontSize: 'var(--type-say-1)', lineHeight: 'var(--lh-say-1)',
        letterSpacing: 'var(--tracking-say)', textWrap: 'pretty',
      }}>
        {children}
      </p>
      {options.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
          {options.map((o, i) => {
            const bail = options.length > 2 && i === options.length - 1;
            const variant: ButtonVariant = i === 0 ? 'primary' : bail ? 'ghost' : 'secondary';
            return (
              <Button key={i} variant={variant} style={bail ? { flex: '1 1 100%' } : undefined} onClick={o.onClick}>
                {o.label}
              </Button>
            );
          })}
        </div>
      )}
      {footer}
    </div>
  );
}
