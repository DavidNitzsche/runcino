import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/coach/CoachSay.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/coach/CoachSay.jsx + .d.ts), 2026-08-18.
 * Faithful port: same tokens, same size table.
 */

export type CoachSaySize = 'lg' | 'md' | 'sm';

export interface CoachSayProps {
  /** 8 to 40 words. No exclamation marks, no emoji, no em dashes. Middot between clauses. */
  children?: ReactNode;
  size?: CoachSaySize;
  /** Kicker above the sentence. Pass null to drop it. */
  attribution?: string | null;
  /** Set in the editorial display face. For a verdict headline only, never for a paragraph. */
  display?: boolean;
  style?: CSSProperties;
}

const SIZE: Record<CoachSaySize, [string, string]> = {
  lg: ['var(--type-say-1)', 'var(--lh-say-1)'],
  md: ['var(--type-say-2)', 'var(--lh-say-2)'],
  sm: ['var(--type-say-3)', 'var(--lh-say-3)'],
};

/**
 * The coach's voice. Uncontained: no tile, no border, no quote marks, its own air.
 * This is content, not decoration, and it is never a caption under a number.
 */
export function CoachSay({ children, size = 'lg', attribution = 'Coach', display = false, style }: CoachSayProps) {
  const [fs, lh] = SIZE[size];
  return (
    <div style={{ padding: 'var(--sp-8) 0 var(--sp-4)', ...style }}>
      {attribution && (
        <div
          style={{
            fontSize: 'var(--type-kicker)',
            letterSpacing: 'var(--tracking-kicker)',
            textTransform: 'uppercase',
            color: 'var(--text-quiet)',
            marginBottom: 'var(--sp-6)',
          }}
        >
          {attribution}
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: fs,
          lineHeight: lh,
          letterSpacing: 'var(--tracking-say)',
          maxWidth: 'var(--measure-say)',
          textWrap: 'pretty',
          color: 'var(--text-primary)',
          fontFamily: display ? 'var(--font-display)' : 'var(--font-core)',
          fontWeight: display ? 'var(--weight-display)' : 'var(--weight-regular)',
          textTransform: display ? 'uppercase' : 'none',
          fontStretch: display ? 'var(--display-stretch)' : 'normal',
        }}
      >
        {children}
      </p>
    </div>
  );
}
