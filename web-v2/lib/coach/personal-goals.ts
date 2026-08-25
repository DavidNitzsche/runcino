/**
 * lib/coach/personal-goals.ts — the ONE read of `personal_goals`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * `personal_goals` shipped as a write-only loop. A runner could set a non-race
 * goal — volume / speed / distance / habit / health — on Targets, the row
 * landed faithfully (once migration 152 gave it somewhere to land), and then
 * NOTHING in the app ever asked for it again. `GET /api/goals` had no in-app
 * caller. The coach never saw it. The POST handler said in a comment that the
 * state-loader would pick the goal up; the state-loader had never heard of the
 * table.
 *
 * That is the same defect class as an unread `rationale` column, one level up:
 * content the runner AUTHORED, stored correctly, spent by nobody. Asking a
 * runner what they are chasing and then never mentioning it again is worse than
 * not asking.
 *
 * So: one loader, and every consumer goes through it.
 *
 *   · `GET /api/goals`                    — the wire read (web + any client).
 *   · `lib/coach/profile-state.ts`        — puts them on ProfileState, which is
 *                                            what the coach's ME surface is.
 *   · `lib/coach/fact-reciter.ts`         — reciteMe() states them back, so
 *                                            /api/coach/facts?surface=me and
 *                                            /api/briefing both carry them
 *                                            (iPhone ProfileView renders that
 *                                            block; that is the phone's read).
 *   · `components/faff-app/seed.ts`       — FaffSeed.personalGoals.
 *   · `views/TargetsView.tsx`             — STANDING GOALS, next to the pill
 *                                            that creates them.
 *
 * The words those last two render live in `lib/faff/personal-goal-copy.ts`,
 * not here: this module imports the connection pool, and TargetsView is a
 * client component. Types cross that line (erased); pool does not.
 *
 * `lib/coach/_personal_goals_wiring.test.ts` is the standing guard that the
 * write side never again outlives the read side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ACTIVE means deadline in the future, or no deadline at all. A goal with a
 * past deadline is history, not a target, and the runner is not chasing it any
 * more — but the row is kept (DELETE is the only removal) so the record of what
 * they were chasing survives.
 *
 * NULL IS NOT AN EMPTY LIST. `null` means the read failed and we do not know
 * what this runner is chasing; `[]` means we looked and they have set nothing.
 * Every consumer here branches on that, because "you have no goals" stated
 * confidently to someone who has three is precisely the bug lib/db/read.ts
 * exists to stop.
 */
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { runnerToday } from '@/lib/runtime/runner-tz';

/** 'strength' is READ-ONLY legacy · STRENGTH-3 (2026-08-17) stopped accepting
 *  new strength goals and deliberately kept existing rows readable, so the
 *  reader has to know the word even though the writer refuses it. */
export type PersonalGoalType =
  | 'volume' | 'speed' | 'distance' | 'habit' | 'health' | 'strength';

export interface PersonalGoal {
  /** `bigserial` · node-pg hands int8 back as a string, and it stays one all
   *  the way to `DELETE /api/goals/[id]`. Never arithmetic. */
  id: string;
  goal_type: PersonalGoalType;
  /** What the runner is chasing, in their words. "40 mi/wk by Aug 31". */
  target: string;
  /** Where they are now, when they have said. Never derived — nothing in the
   *  app computes progress against a free-text target, and inventing one would
   *  be a modelled number wearing a measured one's clothes. */
  current: string | null;
  /** ISO date, or null for a standing goal with no end. */
  deadline: string | null;
  tolerance: string | null;
  /** Why the goal is set where it is — the runner's own reason. Rendered. */
  rationale: string | null;
  created_at: string;
  updated_at: string;
  /** Days from the runner's today to the deadline; null when there is none.
   *  Computed against the RUNNER's day, same as `nextARace.days_to_race`, so a
   *  goal due tomorrow never reads as due today for anyone east of UTC. */
  days_to_deadline: number | null;
}

/** Row shape as it comes off the wire, before id + day-count are resolved. */
type GoalRow = Omit<PersonalGoal, 'id' | 'days_to_deadline'> & { id: string | number };

/** `$2::date` is the RUNNER's today, never `CURRENT_DATE` — that is server-
 *  clock UTC, and lib/runtime/runner-tz.ts says in as many words to pass the
 *  runner's day as a parameter instead. A goal due today would otherwise stop
 *  being active at 5pm Pacific. */
const ACTIVE_GOALS_SQL = `
  SELECT id, goal_type, target, current, deadline::text AS deadline,
         tolerance, rationale, created_at::text AS created_at,
         updated_at::text AS updated_at
    FROM personal_goals
   WHERE user_uuid = $1
     AND (deadline IS NULL OR deadline >= $2::date)
   ORDER BY deadline ASC NULLS LAST, created_at DESC`;

/**
 * Every active personal goal for this runner, or `null` when the read failed.
 *
 * The caller MUST branch on null. `?? []` here is the whole bug.
 *
 * `today` is the runner's day. Pass it when the caller already has one (every
 * state loader does) so the whole render agrees on what day it is; omit it and
 * this resolves its own, which is a cached read after the first call.
 */
export async function loadPersonalGoals(
  userId: string,
  today?: string,
): Promise<PersonalGoal[] | null> {
  const day = today ?? await runnerToday(userId);
  const rows = await rowsOrNull<GoalRow>(
    'coach/personal-goals · active',
    pool.query<GoalRow>(ACTIVE_GOALS_SQL, [userId, day]),
  );
  if (rows === null) return null;
  return rows.map((r) => ({
    ...r,
    id: String(r.id),
    days_to_deadline: daysBetween(day, r.deadline),
  }));
}

/** Whole days from `today` to `deadline`, null when either is unusable. */
function daysBetween(today: string, deadline: string | null): number | null {
  if (!deadline) return null;
  const a = Date.parse(`${today}T12:00:00Z`);
  const b = Date.parse(`${deadline}T12:00:00Z`);
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}
