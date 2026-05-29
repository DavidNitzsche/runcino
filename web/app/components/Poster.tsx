/**
 * Poster · gradient hero container — used at the top of a FaffPageShell
 * to lead with a single dominant visual statement (race countdown, big
 * verb, milestone moment). Generic shell; the page composes the inner
 * content (verb, headline number, StatTrio, etc.).
 *
 * Mirror: Faff/apps/web/src/components/races/Poster.tsx (re-export).
 *
 * Faff's canonical Poster (`Faff/apps/web/src/components/Poster.tsx`)
 * encodes today-page verb / skip-chip / workout-breakdown semantics —
 * race detail doesn't need any of that, so this is the minimal shared
 * shell: gradient background, rounded corners, generous padding, slot
 * for content. The race page's existing PosterCard sits underneath
 * this for the deep hero (map + elevation + narrative) — Poster here
 * is for the race-day timeline header and other secondary heroes.
 */

import type { ReactNode, CSSProperties } from 'react';

export type PosterGradient =
  /** Default warm race orange. */
  | 'race'
  /** Cool dawn / night-before. */
  | 'night'
  /** Calm green for completed / debrief. */
  | 'done'
  /** Purple rainbow celebration (PRs). */
  | 'pr';

const GRADIENT: Record<PosterGradient, string> = {
  race:  'linear-gradient(135deg, #FF8847 0%, #E85D26 50%, #7A2828 100%)',
  night: 'linear-gradient(135deg, #2A3552 0%, #1A1A3A 60%, #0A0A1A 100%)',
  done:  'linear-gradient(135deg, #3EBD41 0%, #27B4E0 60%, #1A4A8E 100%)',
  pr:    'linear-gradient(135deg, #3EBD41 0%, #F3AD38 35%, #FF8847 70%, #9013FE 100%)',
};

export interface PosterProps {
  gradient?: PosterGradient;
  /** Optional caps-tracked eyebrow at the top of the poster. */
  eyebrow?: string;
  /** Optional headline text rendered in the display recipe. */
  title?: string;
  children?: ReactNode;
  /** Layout density — `standard` (default) or `compact`. */
  density?: 'standard' | 'compact';
  style?: CSSProperties;
}

export function Poster({ gradient = 'race', eyebrow, title, children, density = 'standard', style }: PosterProps) {
  const isCompact = density === 'compact';
  const pad = isCompact ? '20px 22px' : '28px 30px';
  const radius = isCompact ? 14 : 18;
  return (
    <article
      className="v3-poster"
      style={{
        background: GRADIENT[gradient],
        color: '#fff',
        borderRadius: radius,
        padding: pad,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: isCompact ? 12 : 18,
        ...style,
      }}
      data-density={density}
    >
      {eyebrow && (
        <div style={{
          fontFamily: 'var(--font-data, var(--f-data))',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.6px',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.78)',
        }}>{eyebrow}</div>
      )}
      {title && (
        <h2 style={{
          fontFamily: 'var(--font-display, var(--f-display))',
          fontSize: isCompact ? 38 : 56,
          fontWeight: 700,
          letterSpacing: '-.015em',
          lineHeight: 0.92,
          margin: 0,
          color: '#fff',
        }}>{title}</h2>
      )}
      {children}
    </article>
  );
}
