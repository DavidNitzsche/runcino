import '../redesign/styles.css';
import { buildSeed } from '@/components/faff-app/seed';
import { daysToRace as computeDaysToRace } from '@/lib/faff/race-countdown';
import { loadRaceWeekCourse } from '@/lib/faff/race-week-course';
import { RaceWeekClient } from '@/components/redesign/race-week/RaceWeekClient';
import { EmptyState } from '@/components/redesign/feedback/EmptyState';
import { BackToTodayButton } from '@/components/redesign/race-week/BackToTodayButton';

export const dynamic = 'force-dynamic';

/**
 * app/race-week/page.tsx
 *
 * 2026-08-18 · Live cutover — canonical route for Race Week, top-level
 * (not nested under /goal) since it's triggered by real date proximity to
 * the goal race, not by navigating from Season. Chrome-free, no Rail —
 * matches app/redesign/race-week/layout.tsx's existing posture. Mirrors
 * app/redesign/race-week/page.tsx exactly: same daysToRace gate (the
 * canonical lib/faff/race-countdown.ts resolver, daysToRace >= 0 && <= 7),
 * same honest "Not race week yet" EmptyState when the account isn't
 * actually within 7 days of a goal race, same course-elevation load.
 */
export default async function RaceWeekPage() {
  const seed = await buildSeed();
  const goal = seed.goalRace;
  const daysToRace = computeDaysToRace(goal?.date ?? null, seed.todayISO);
  const isRaceWeek = daysToRace != null && daysToRace >= 0 && daysToRace <= 7;

  if (!goal || !isRaceWeek) {
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
