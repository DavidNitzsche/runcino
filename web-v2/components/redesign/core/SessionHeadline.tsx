import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/core/SessionHeadline.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/SessionHeadline.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same size table. The .jsx keys a
 * `faff-lede` / `faff-lede-sm` class for the type lede (already defined in
 * app/redesign/styles.css, same as Today's `faff-display` / `faff-kicker`
 * usage), so this keeps the className rather than reproducing the rule inline.
 */

export type SessionHeadlineSize = 'lg' | 'sm';
export type SessionHeadlineTone = 'primary' | 'attention';

export interface SessionHeadlineProps {
  /** One word from the session vocabulary: Easy, Long, Threshold, Intervals, Tempo, Shakeout, Race, Rest. */
  type: string;
  /** The dose and shape, e.g. "6 mi", "2 × 3 mi @ 6:52", "16 mi · last 3 @ MP". */
  dose?: ReactNode;
  /** One quiet line of context, e.g. the workout's library name. */
  note?: string | null;
  /** The as-authored session, struck through, when today was downgraded. */
  was?: string | null;
  size?: SessionHeadlineSize;
  /** attention when the session was changed from what was authored. */
  tone?: SessionHeadlineTone;
  style?: CSSProperties;
}

/**
 * The prescription. The session TYPE is the display lede; the dose and shape sit beneath it
 * in the value register. They are never concatenated, because a dose can be "6 mi" or
 * "2 × 3 mi @ 6:52" or "16 mi · last 3 @ MP" and the lede must stay one confident word.
 */
export function SessionHeadline({ type, dose, note = null, was = null, size = 'lg', tone = 'primary', style }: SessionHeadlineProps) {
  return (
    <div style={style}>
      <div
        className={size === 'sm' ? 'faff-lede faff-lede-sm' : 'faff-lede'}
        style={{ color: tone === 'attention' ? 'var(--attention)' : 'var(--text-primary)' }}
      >{type}</div>
      {dose && (
        <div style={{
          marginTop: 'var(--sp-5)', fontFamily: 'var(--font-value)',
          fontSize: size === 'sm' ? 'var(--type-value-3)' : 'var(--type-value-2)',
          fontWeight: 'var(--weight-display)', letterSpacing: 'var(--tracking-value)', lineHeight: 1,
          fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)',
        }}>{dose}</div>
      )}
      {note && (
        <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{note}</div>
      )}
      {was && (
        <div style={{
          marginTop: 'var(--sp-4)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)',
          textDecoration: 'line-through',
        }}>{was}</div>
      )}
    </div>
  );
}
