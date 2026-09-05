/**
 * lib/faff/v5-proposals.ts · pending adaptations, mapped for the phone.
 *
 * V5PROPOSAL-1 (2026-09-05). The engine writes `plan_workout_proposals` rows
 * and the V5 app never read them. This is the mapping, kept in one file so the
 * phone never learns an engine word and the wording never has to change in two
 * places (Rule 16).
 *
 * ── WHY DIRECTION IS COMPUTED HERE AND NOT ON THE PHONE ────────────────────
 *
 * `action_kind` is not the question the runner asks. `shave` and `downgrade`
 * are both "less"; `mark_upgrade` is "more"; `reschedule` is "the same work on
 * a different day". Mapping on the phone would put a coaching judgement in a
 * view, and a second copy of it in the watch when that lands.
 */
import type { V5ProposalWire } from '@/lib/faff/v5-today';
import { fmtMi } from '@/lib/format/run';
import type { PendingProposal } from '@/lib/plan/workout-proposals';

/** Engine kind to the runner's question. Exhaustive by construction. */
export function directionOf(kind: string): V5ProposalWire['direction'] | null {
  switch (kind) {
    case 'mark_upgrade': return 'more';
    case 'downgrade': case 'shave': return 'less';
    case 'reschedule': return 'move';
    case 'field_test': return 'test';
    // Rule 11: an unrecognised kind is not "move". It is a kind this mapping
    // has not been taught, and showing the runner a card whose direction we
    // guessed is worse than showing nothing.
    default: return null;
  }
}

/**
 * Six to ten words, in the coach's voice.
 *
 * The engine's own `reason` is a sentence about evidence and belongs in `why`.
 * This is the headline, and it says what would CHANGE.
 */
export function headlineFor(p: PendingProposal, direction: V5ProposalWire['direction']): string {
  const day = dayName(p.workoutDateISO);
  switch (direction) {
    case 'more': {
      const mi = numberOrNull(p.actionPayload?.newDistanceMi);
      // `fmtMi` carries its own unit, which is the point of having one
      // formatter: my first cut appended " mi" and produced "9 mi mi".
      const shown = mi == null ? null : fmtMi(mi);
      return shown == null ? `Add to ${day}` : `${day} goes to ${shown}`;
    }
    case 'less': {
      const frac = numberOrNull(p.actionPayload?.shaveFraction);
      return frac == null ? `Ease ${day}` : `Take ${Math.round(frac * 100)}% off ${day}`;
    }
    case 'move': {
      const to = typeof p.actionPayload?.newDate === 'string' ? p.actionPayload.newDate : null;
      return to == null ? `Move ${day}` : `Move ${day} to ${dayName(to)}`;
    }
    case 'test':
      return `Make ${day} a field test`;
  }
}

export function toWire(p: PendingProposal): V5ProposalWire | null {
  const direction = directionOf(p.actionKind);
  if (direction == null) return null;
  const why = (p.reason ?? '').trim();
  // A card with no reason is the thing the objective forbids: a change the
  // runner is asked to accept with nothing said about why. Withheld, not
  // guessed at.
  if (why === '') return null;
  return {
    id: String(p.id),
    dateISO: p.workoutDateISO,
    direction,
    headline: headlineFor(p, direction),
    why,
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayName(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'that day' : DAYS[d.getUTCDay()];
}
