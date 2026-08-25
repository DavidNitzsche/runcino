/**
 * lib/faff/personal-goal-copy.ts — the words a standing goal is shown in.
 *
 * Split out of `lib/coach/personal-goals.ts` for one reason: that module opens
 * the database, and both callers here are places a pool must never reach — the
 * fact-reciter, whose whole contract is that every reciter is pure, and
 * TargetsView, which is a client component. Types cross that line because
 * TypeScript erases them. A `Pool` does not.
 *
 * One home for the words, so the ME surface and Targets never call the same
 * row two different things.
 */
import type { PersonalGoal, PersonalGoalType } from '@/lib/coach/personal-goals';

/** Display word for a goal type. 'strength' is legacy-readable (STRENGTH-3
 *  stopped accepting new ones and kept existing rows renderable). */
export function personalGoalTypeLabel(t: PersonalGoalType | string): string {
  switch (t) {
    case 'volume':   return 'VOLUME';
    case 'speed':    return 'SPEED';
    case 'distance': return 'DISTANCE';
    case 'habit':    return 'HABIT';
    case 'health':   return 'HEALTH';
    case 'strength': return 'STRENGTH';
    default:         return String(t).toUpperCase();
  }
}

/**
 * "Aug 31 · 12 days" / "no deadline" — the one line under a goal's target.
 * Reads `days_to_deadline`, which the loader already resolved against the
 * RUNNER's day; nothing here consults a clock, so this renders the same on the
 * server and after hydration.
 */
export function personalGoalHorizon(
  goal: Pick<PersonalGoal, 'deadline' | 'days_to_deadline'>,
): string {
  if (!goal.deadline) return 'no deadline';
  const parsed = Date.parse(`${goal.deadline}T12:00:00Z`);
  const when = isFinite(parsed)
    ? new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : goal.deadline;
  const days = goal.days_to_deadline;
  if (days == null) return when;
  if (days < 0)   return `${when} · past`;
  if (days === 0) return `${when} · today`;
  return `${when} · ${days} day${days === 1 ? '' : 's'}`;
}
