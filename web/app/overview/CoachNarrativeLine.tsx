'use client';

/**
 * CoachNarrativeLine — the single-line coach voice that sits at the
 * very top of /overview, just under the page header.
 *
 * This component is intentionally minimal:
 *   • Coach mark on the left (small dot in race-orange, the brand
 *     "coach is here" cue used elsewhere on the page).
 *   • One sentence in readable type (~17px / 1.4).
 *   • Optional small uppercase chip on the right indicating the signal
 *     source ("FROM YOUR CHECK-INS", "FROM YOUR RACE CAL.", etc.).
 *
 * When `line === null` the component renders nothing. There is no
 * placeholder, no "Keep up the great work!" filler — that's the whole
 * point of the narrative contract. If the coach has nothing specific
 * to say today, the slot collapses.
 *
 * Tone subtly tints the coach mark so the runner can read the emotional
 * register at a glance:
 *   pushing      → race orange     (the brand's "do this" cue)
 *   softening    → recovery green
 *   celebrating  → milestone yellow
 *   reminding    → muted ink
 *   reorienting  → active blue
 *
 * Integration is deferred: this file lives alongside /overview but is
 * NOT yet rendered from page.tsx. Waves F+G are currently editing
 * page.tsx and data.ts; a later merger wave drops this component in
 * once those land.
 */

import type { NarrativeLine } from '@/coach/coach-narrative';

interface Props {
  line: NarrativeLine | null;
}

/** Map the source label produced by narrativeLine.basedOn to the
 *  uppercase chip the UI shows on the right. Keeping the mapping here
 *  (instead of inside the narrative module) lets us tune the chip
 *  vocabulary without touching the engine. */
function chipLabelFor(basedOn: string): string | null {
  switch (basedOn) {
    case 'race calendar':        return 'FROM YOUR RACE CAL.';
    case 'coach · live adjustment': return 'COACH ADJUSTED TODAY';
    case 'run streak':           return 'FROM YOUR STREAK';
    case 'check-in log':         return 'FROM YOUR CHECK-INS';
    case 'recent activity':      return 'FROM YOUR ACTIVITY';
    case 'intensity · last 14d': return 'FROM YOUR INTENSITY MIX';
    case 'volume trend · 4w vs prior 4w': return 'FROM YOUR VOLUME TREND';
    default:                     return null;
  }
}

/** Race-orange by default — the brand "the coach is here" colour. */
function dotColorFor(tone: NarrativeLine['tone']): string {
  switch (tone) {
    case 'pushing':     return 'var(--color-race)';
    case 'softening':   return 'var(--color-recovery)';
    case 'celebrating': return 'var(--color-milestone)';
    case 'reorienting': return 'var(--color-active)';
    case 'reminding':   return 'var(--color-mute)';
    default:            return 'var(--color-race)';
  }
}

export function CoachNarrativeLine({ line }: Props): React.ReactElement | null {
  if (!line) return null;

  const chip = chipLabelFor(line.basedOn);
  const dot = dotColorFor(line.tone);

  return (
    <div
      role="status"
      aria-label="Coach narrative"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        margin: '4px 0 16px 0',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        borderRadius: 12,
      }}
    >
      {/* Coach mark — small filled dot tinted to tone. */}
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          boxShadow: `0 0 0 4px color-mix(in srgb, ${dot} 12%, transparent)`,
        }}
      />

      {/* The sentence — readable, single line on desktop, wraps to two
          on narrow screens. */}
      <p
        style={{
          flex: '1 1 auto',
          margin: 0,
          color: 'var(--color-ink)',
          fontSize: 17,
          lineHeight: 1.4,
          fontWeight: 400,
        }}
      >
        {line.sentence}
      </p>

      {/* Source chip — small uppercase label, only shown when we have a
          mapping in chipLabelFor. */}
      {chip && (
        <span
          style={{
            flex: '0 0 auto',
            fontSize: 10,
            letterSpacing: '0.08em',
            fontWeight: 600,
            color: 'var(--color-mute)',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {chip}
        </span>
      )}
    </div>
  );
}

export default CoachNarrativeLine;
