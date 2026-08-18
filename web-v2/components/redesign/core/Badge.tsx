import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/core/Badge.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/Badge.jsx + .d.ts), 2026-08-18.
 * Faithful port: the .jsx's TONES table implements three more tones
 * (easy/long/race) than the .d.ts's documented union — kept all of them
 * since they're real, working styles the wider library draws on, not
 * invented additions.
 */

export type BadgeTone = 'neutral' | 'signal' | 'attention' | 'quiet' | 'fault' | 'easy' | 'long' | 'race';

export interface BadgeProps {
  children?: ReactNode;
  /** attention = provisional or stale. fault = unreadable. Never use tone to praise. */
  tone?: BadgeTone;
  style?: CSSProperties;
}

const TONES: Record<BadgeTone, CSSProperties> = {
  neutral: { background: 'var(--material-control)', color: 'var(--text-secondary)' },
  signal: { backgroundImage: 'var(--g-quality)', color: '#221503' },
  attention: { backgroundImage: 'var(--g-missed)', color: '#221503' },
  quiet: { background: 'transparent', color: 'var(--text-quiet)' },
  fault: { backgroundImage: 'var(--g-race)', color: '#fff' },
  easy: { backgroundImage: 'var(--g-easy)', color: '#fff' },
  long: { backgroundImage: 'var(--g-long)', color: '#fff' },
  race: { backgroundImage: 'var(--g-race)', color: '#fff' },
};

/** Short factual state. A badge states provenance or priority, never a compliment. */
export function Badge({ children, tone = 'neutral', style }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 28,
        padding: '0 12px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--type-meta)',
        letterSpacing: 'var(--tracking-kicker)',
        textTransform: 'uppercase',
        fontWeight: 'var(--weight-semibold)',
        ...TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
