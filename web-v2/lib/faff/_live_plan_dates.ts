/**
 * lib/faff/_live_plan_dates.ts · resolve a live audit's dates by ROLE, not by
 * calendar.
 *
 * LIVEDATES-1 (2026-09-04). `_today_thesis.audit.test.ts` and
 * `_voice_live.audit.test.ts` both hard-coded a week of the owner's block:
 *
 *     const DATES = ['2026-09-03', '2026-09-06', '2026-09-08'];
 *     // 09-06 is the week's LONG RUN, the session the resolver names as
 *     // addressing the owner's DURABILITY limiter
 *
 * That was true on 2026-09-02, when both files were written. On 2026-09-03 the
 * plan changed: the owner moved his week by hand in the backend, around travel,
 * because the in-app move-a-run feature is not built yet. The long run went to
 * 09-04 and 09-06 became a plain 7.5 mi easy day. Both tests then failed —
 * against CORRECT engine behaviour, because the thesis opener is deliberately
 * silent on an ordinary easy day — and they failed only where
 * `DATABASE_URL_RO` is set, which is nowhere in CI. So the repository reported
 * green while two live audits were red on every machine that could run them.
 *
 * That the change was deliberate and human is the point, not a mitigation. A
 * runner rescheduling his own week is the product working, and it is scope the
 * doctrine explicitly keeps ("explicit runner-requested rescheduling remains
 * allowed"). A live audit whose subject is a MUTABLE plan may not pin a
 * calendar date. These tests never cared about 2026-09-06 — they cared about
 * "the long run", "a quality day", "a rest day", and said so in their own
 * comments. This resolves those roles from the live plan instead.
 *
 * Rule 15's shape, one level up: a corpus that cannot express the thing it
 * grades is untested. A date is not a role, and only the role was ever the
 * subject.
 */
import { pool } from '@/lib/db/pool';

export interface LivePlanDay {
  readonly dateIso: string;
  readonly type: string;
  readonly isQuality: boolean;
  readonly isLong: boolean;
}

/** Days of the runner's ACTIVE plan in a window (Rule 14 · the scope is named). */
export async function livePlanDays(
  userUuid: string, fromIso: string, toIso: string,
): Promise<LivePlanDay[]> {
  const { rows } = await pool.query<{
    date_iso: string; type: string; is_quality: boolean; is_long: boolean;
  }>(
    `SELECT pw.date_iso, pw.type, pw.is_quality, pw.is_long
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id AND tp.archived_iso IS NULL
      WHERE pw.user_uuid = $1::uuid
        AND pw.date_iso >= $2 AND pw.date_iso <= $3
      ORDER BY pw.date_iso`,
    [userUuid, fromIso, toIso],
  );
  return rows.map((r) => ({
    dateIso: String(r.date_iso).slice(0, 10),
    type: String(r.type ?? '').toLowerCase(),
    isQuality: r.is_quality === true,
    isLong: r.is_long === true,
  }));
}

/** The quality types the coaching thesis speaks on, same set the route uses. */
const QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals']);

/**
 * The two quality days and the long run — the three roles
 * `_today_thesis.audit.test.ts` names in its own title. Returns fewer than
 * three only when the window genuinely has fewer, which the caller asserts on
 * rather than papering over (Rule 11: "the window has no long run" is a fact,
 * not an empty list to iterate quietly).
 */
export function thesisRoleDates(days: readonly LivePlanDay[]): {
  quality: string[]; long: string | null;
} {
  const quality = days.filter((d) => QUALITY_TYPES.has(d.type)).map((d) => d.dateIso).slice(0, 2);
  const long = days.find((d) => d.isLong && d.type === 'long')?.dateIso ?? null;
  return { quality, long };
}

/**
 * One day of each state the account actually has — what
 * `_voice_live.audit.test.ts` means by "chosen to span the day states". Ordered
 * by date so the log reads as a week.
 */
export function spanningStateDates(days: readonly LivePlanDay[], max = 7): string[] {
  const seen = new Set<string>();
  const picked: LivePlanDay[] = [];
  for (const d of days) {
    if (seen.has(d.type)) continue;
    seen.add(d.type);
    picked.push(d);
    if (picked.length >= max) break;
  }
  return picked.map((d) => d.dateIso).sort();
}
