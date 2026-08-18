import { buildSeed } from '@/components/faff-app/seed';
import { daysToRace as computeDaysToRace } from '@/lib/faff/race-countdown';
import { loadRaceWeekCourse } from '@/lib/faff/race-week-course';
import { RaceWeekClient } from '@/components/redesign/race-week/RaceWeekClient';
import { EmptyState } from '@/components/redesign/feedback/EmptyState';
import { BackToTodayButton } from '@/components/redesign/race-week/BackToTodayButton';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/race-week/page.tsx
 *
 * The redesigned Race Week screen. Same server-side seed load as every
 * other redesign route (components/faff-app/seed.ts buildSeed()) — no new
 * data path for anything already on the seed. buildSeed() itself redirects
 * to /login when unauthenticated (seed.ts:2299), same as every other
 * /redesign route — this page adds no separate auth check.
 *
 * RACE-WEEK DETECTION · reuses the SAME threshold this codebase already
 * uses everywhere else (confirmed by grep against lib/coach/health-
 * actions.ts:343, lib/coach/readiness-brief.ts:519, lib/coach/morning-
 * brief.ts:147 — all three read `daysToRace != null && daysToRace >= 0 &&
 * daysToRace <= 7`). The days-to-race NUMBER itself comes from
 * lib/faff/race-countdown.ts#daysToRace — the module's own header calls it
 * "THE one way to answer how far away is the race", locked 2026-08-17 after
 * a bug where a plan-geometry-derived countdown drifted from the race's
 * real calendar date. It computes the identical fact `GoalRace.daysAway`
 * carries, just as a pure, testable function every surface can agree on —
 * so this route calls the canonical module rather than reading
 * `goalRace.daysAway` (which is also correct, but pre-clamped at 0 and
 * computed inline in seed.ts's adaptGoalRace rather than through the one
 * shared resolver).
 *
 * This view only makes sense to show when the account is ACTUALLY within
 * 7 days of its goal race. When it isn't, this route renders an honest
 * "not race week right now" EmptyState instead of a fabricated race-week
 * mock — the same "wrong state to view this page" posture BlockClient.tsx
 * already established for its RaceBoundBlock / BetweenBlocksBlock branch
 * (state-driven composition per CLAUDE.md, not a template rendered
 * regardless of whether the underlying state applies). There is no
 * query-param preview bypass — see RaceWeekClient.tsx's header comment for
 * why, and for how this branch was verified without live race-week data to
 * render against.
 */
export default async function RedesignRaceWeekPage() {
  const seed = await buildSeed();
  const goal = seed.goalRace;
  const daysToRace = computeDaysToRace(goal?.date ?? null, seed.todayISO);
  const isRaceWeek = daysToRace != null && daysToRace >= 0 && daysToRace <= 7;

  if (!goal || !isRaceWeek) {
    // Honest per-state copy rather than one echo of a possibly-negative or
    // possibly-null day count: a finished goal race or one with no date
    // set yet both fail `isRaceWeek`, and "X is -3 days out" or "X is ·
    // days out" would read as broken rather than as the true state.
    const dayLine = !goal
      ? 'This view only appears in the final 7 days before a goal race, and no goal race is set right now.'
      : daysToRace == null
        ? `This view only appears in the final 7 days before a goal race, and ${goal.name}'s date isn't set yet.`
        : daysToRace < 0
          ? `This view only appears in the final 7 days before a goal race. ${goal.name} has already happened.`
          : `This view only appears in the final 7 days before a goal race. ${goal.name} is ${daysToRace} days out.`;
    return (
      <div className="redesign-root" data-theme="light">
        <div style={{ maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
          <EmptyState headline="Not race week yet" action={<BackToTodayButton />}>
            {dayLine}
          </EmptyState>
        </div>
      </div>
    );
  }

  const course = goal.slug ? await loadRaceWeekCourse(goal.slug, goal.distanceMi ?? null) : null;

  return (
    <div className="redesign-root" data-theme="light">
      <RaceWeekClient seed={seed} daysToRace={daysToRace} course={course} />
    </div>
  );
}
