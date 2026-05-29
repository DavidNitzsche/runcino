'use client';

/**
 * Sibling · the dark dashboard card next to the Poster.
 * Spec: design/components/Sibling.md
 *
 * Composes title + (CoachVoice OR prose, never both) + MiniTileGrid +
 * optional bodyFlags slot (entry chips for niggle/sick logging, deck
 * docs/2026-05-28-niggle-sick-logging.html §SECTION 01).
 *
 * The Sibling is state-keyed — the resolver's `SiblingPayload` is a
 * tagged union over `state`, and per-state shape determines what's
 * present (e.g. `bail_trigger` on `niggle`, `recommendation` on
 * `missed`, `completion_pct` on `new_user`, etc.).
 */

import type { ReactNode } from 'react';
import type { SiblingPayload } from '@/lib/faff/types';
import { MiniTileGrid } from './MiniTileGrid';
import { CoachVoice, type CoachVoicePayload } from './CoachVoice';
import styles from './Sibling.module.css';

export interface SiblingProps {
  payload: SiblingPayload;
  /**
   * Optional · coach voice paragraph payload. Per CoachVoice.md the
   * paragraph renders on today/plan/race-detail/health surfaces ONLY,
   * and never on the `new_user` state (no signal to interpret yet).
   * The page is responsible for omitting `voice` on surfaces that
   * don't carry the slot.
   */
  voice?: CoachVoicePayload;
  /**
   * Optional · niggle/sick entry chips rendered directly under the
   * MiniTileGrid. The page wires the chip pair through here. Keeps
   * the Sibling generic — it just renders the slot if present.
   *
   * Per deck §SECTION 01 the entry pair (LOG A NIGGLE · FEELING SICK)
   * lives below the tile grid where the runner is already reading the
   * body signal. When a niggle/sick is active the chip label flips to
   * UPDATE per state.
   */
  bodyFlags?: ReactNode;
}

function siblingProse(payload: SiblingPayload): string | undefined {
  // Unsigned access by state — TypeScript narrows per branch of the tagged
  // union. Sibling.md is explicit that `voice` and `prose` are mutually
  // exclusive · the page logic decides which one to surface.
  switch (payload.state) {
    case 'rest':
      return undefined; // prose is in the Poster for rest
    case 'easy':
    case 'quality':
    case 'long':
    case 'done_nailed':
      return payload.prose;
    case 'done_ease_off':
    case 'niggle':
    case 'sick':
    case 'missed':
    case 'race_week':
    case 'new_user':
    // P-SKIP 2026-05-28 · skipped sibling carries its own prose
    // ("you called it. plan picks back up tomorrow…") per glance-adapter.ts.
    case 'skipped':
      return payload.prose;
  }
}

function siblingActionTileIndex(payload: SiblingPayload): number | undefined {
  if (payload.state === 'done_ease_off') return payload.action_tile_index;
  return undefined;
}

export function Sibling({ payload, voice, bodyFlags }: SiblingProps) {
  const prose = siblingProse(payload);
  const actionTileIndex = siblingActionTileIndex(payload);

  return (
    <section className={styles.sibling} aria-labelledby="sibling-title">
      {/* Two-piece title per Sibling.md §Render spec:
            - `main` renders with the display recipe (Oswald 700 · -0.015em
              tracking · 0.86 line-height) at 24px
            - `suffix` (optional) renders as Inter 700wt 9px UPPERCASE caps-tracked
          Backend's coach engine emits both pieces separately so the client
          renders the typography without parsing string delimiters. */}
      <h2 id="sibling-title" className={styles.title}>
        <span className={styles.titleMain}>{payload.title.main}</span>
        {payload.title.suffix ? (
          <span className={styles.titleSuffix}>{payload.title.suffix}</span>
        ) : null}
      </h2>

      {/* Per spec · at most ONE of voice or prose. Voice takes precedence
          when the surface and state carry it; otherwise prose. */}
      {voice ? (
        <CoachVoice payload={voice} />
      ) : prose ? (
        <p className={styles.prose}>{prose}</p>
      ) : null}

      <MiniTileGrid tiles={payload.tiles} actionTileIndex={actionTileIndex} />

      {/* Optional · niggle/sick entry chip pair (or recovery row) lives
          directly under the tile grid per deck §SECTION 01. */}
      {bodyFlags}
    </section>
  );
}
