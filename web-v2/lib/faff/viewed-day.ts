import type { PlanWeekDay } from '@/lib/plan/week-loader';

/**
 * VIEWED-DAY-1 (2026-08-30) · WHICH DAY IS THE SCREEN ABOUT.
 *
 * The Today surface renders one day, and that day is the one the runner is
 * LOOKING AT, which is not always the day it is. Stepping the week strip
 * forward fetches `GET /api/v5/today?date=YYYY-MM-DD`, and every field on the
 * response has to answer for that date.
 *
 * The route used to pick it with `planWeek.days.find((d) => d.is_today)`, and
 * that was correct for exactly as long as `loadPlanWeek` was called with the
 * viewed date in both of its date arguments. On 2026-08-25, commit `230fbac1`
 * split them apart for a good reason — `is_today` is what `backToToday()`
 * reads to find its way home, so it has to mark the runner's REAL today — and
 * in doing so it silently took the prescription away from the viewed day.
 * Nothing failed; the two fixes simply could not both be true of one flag.
 *
 * What that cost, on the owner's phone on 2026-08-30, the first night of a
 * fourteen-week marathon block. He stepped to Monday 2026-08-31, which has
 * `easy · 4.5 mi · 6x20s strides · HR cap 151` sitting on it in the database.
 * The week window for a Monday is Monday-to-Sunday, so the runner's real
 * today (Sunday the 30th) was not in the loaded week AT ALL, `is_today`
 * matched no row, and the day resolved to null. Downstream:
 *
 *   - `dayStateWordFor(undefined)` returns 'rest', so the hero read **REST**;
 *   - `displayTypeFor(undefined)` returns 'Rest';
 *   - `purposeType` fell to 'unplanned', whose `derivePurpose` branch is
 *     `verdict: 'By feel.'` — so the About card read **"You're in the part of
 *     the block where the hard sessions do the work. By feel."** over a week
 *     carrying `4x1mi @ T pace` with `lthr_bpm: 168` on it.
 *
 * Two separate reported defects, one missing row. His words: "no run data. No
 * specifics. Nothing."
 *
 * Resolving by DATE is the whole fix, and it composes with `230fbac1` rather
 * than undoing it: `is_today` keeps meaning the runner's real today for
 * `backToToday`, and the prescription follows the screen. One function so a
 * third caller cannot fork the question again (Rule 16).
 */
export function resolveViewedPlanDay<T extends Pick<PlanWeekDay, 'date_iso'>>(
  days: readonly T[],
  viewedDateISO: string,
): T | null {
  const wanted = viewedDateISO.slice(0, 10);
  return days.find((d) => d.date_iso === wanted) ?? null;
}

/**
 * RULE 11 · "the plan says rest" and "the plan says nothing" are two facts.
 *
 * They rendered identically — both as a 56pt REST — and the screen asserted
 * the second when it meant the first. A runner planning tomorrow was told he
 * had the day off. That is the more expensive half of the defect above,
 * because the by-date fix only helps where a row EXISTS: step past the last
 * prescribed day of the block, or onto a date the block skipped, and the old
 * code still invents a rest day out of an empty read.
 *
 * So the question is asked explicitly. `true` means the plan is live and has
 * nothing to say about this date — never "it said rest", and never "the read
 * failed", which is a third fact the caller must not reach this function
 * with: pass `planLoaded: false` and the surface stays quiet instead of
 * asserting an absence it did not establish.
 */
export function viewedDayIsUnresolved(args: {
  planLoaded: boolean;
  viewedDay: { plan_workout_id: string | null } | null;
}): boolean {
  if (!args.planLoaded) return false;
  // A day with no row is unresolved, and so is a SYNTHESISED one.
  //
  // `loadPlanWeek` always returns seven days and fills the gaps itself —
  // `type: r?.type ?? 'rest'`, `sub_label: r ? null : 'REST'`. That line is
  // where the two facts are actually collapsed, one layer below this one, and
  // it is why stepping past the end of a block still produced a confident
  // REST: the array is never short, so "absent" never looks absent.
  //
  // `plan_workout_id` is the only field that survives the collapse — null for
  // a manufactured day, always set for a real row. Checked against production
  // 2026-08-30: every active plan writes one row per calendar day it spans,
  // rest days included (105/105, 91/91, 28/28, 21/21). The one shortfall is
  // the owner's own block at 103/105 — precisely the two elapsed days a
  // mid-week rebuild is forbidden to author. So a null id here means "this
  // block does not prescribe this date", never "the generator omits rests".
  return args.viewedDay == null || args.viewedDay.plan_workout_id == null;
}
