/**
 * lib/coach/strength-load.ts · strength session load.
 *
 * STRENGTH-2 (2026-08-17) · the run-mile equivalence is gone.
 *
 * This file used to convert strength minutes into running-mile
 * equivalents at a fixed 0.07 mi/min and fold the result into ACWR.
 * Research/09-cross-training.md:350 prohibits exactly that, in one line:
 *
 *   "Quantify session load via sRPE; do not equate to run minutes."
 *
 * The constant cited "Research/07 §1.1-1.3" for its anchor. §1.1-1.3 is
 * the glossary and the running-economy evidence table (:9-41); it
 * contains no minute-to-mile factor, no 60%-of-easy-running figure, and
 * nothing that would produce 0.07. The number was invented and then
 * carried a citation that made it look sourced.
 *
 * Two ACWR sites folded it in (lib/coach/glance-state.ts,
 * lib/coach/state-loader.ts), so a fabricated coefficient was moving the
 * ratio that gates the readiness pull-back and the strength cap. A
 * 60-minute session added 4.2 "miles" to both the acute and chronic
 * sums. Those folds are removed; ACWR is running-only again, which is
 * the behaviour every caller already had a fallback path for.
 *
 * What replaces it, and what a follow-up needs:
 *
 *   · sessionRpeAu() below is the doctrine-correct unit — Foster's
 *     session-RPE, RPE (0-10) × duration (min), in arbitrary units.
 *     It is here and tested so the arithmetic is settled.
 *   · It cannot be USED yet: `strength_sessions` has no rpe column
 *     (see app/api/strength/route.ts — the insert is date, session_type,
 *     duration_min, notes, source, hk_uuid), and nothing in the iPhone
 *     or web logging UI captures one.
 *   · Folding strength back into ACWR needs BOTH sides in the same unit.
 *     Running load would have to move from miles to sRPE too, which
 *     means every ACWR reader changes together, not just this file.
 *
 * So the follow-up is, in order:
 *   1. Additive migration: strength_sessions.rpe smallint NULL.
 *      (DDL · needs David's explicit per-statement go.)
 *   2. Capture RPE in the strength log sheet + the iPhone sheet; leave
 *      it optional, and treat missing RPE as no reading, never as a
 *      default value.
 *   3. Convert the RUNNING side of ACWR to sRPE (Research/09:350,
 *      Research/15 §ACWR) and switch both fold sites over in one
 *      change so a ratio is never half in miles and half in AU.
 * Until step 3 lands, strength stress is genuinely absent from ACWR.
 * That is a known gap, and it is the honest state: an invented
 * coefficient is not a better estimate than no estimate.
 */

import { pool } from '@/lib/db/pool';

/**
 * Foster session-RPE · Research/09:350 · "Quantify session load via
 * sRPE". Load in arbitrary units = RPE (0-10 category-ratio) × session
 * duration in minutes.
 *
 * Returns null when either input is missing — no reading beats a
 * defaulted one, same posture as the RHR-trend and heat-gate nulls.
 */
export function sessionRpeAu(
  rpe: number | null | undefined,
  durationMin: number | null | undefined,
): number | null {
  if (rpe == null || !Number.isFinite(rpe) || rpe <= 0 || rpe > 10) return null;
  if (durationMin == null || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  return Math.round(rpe * durationMin);
}

/**
 * Logged strength MINUTES per day in [fromISO, toISO] inclusive, for one
 * user. Dates with no logged strength don't appear in the map.
 *
 * Minutes, not a converted load: this is the raw fact the table holds.
 * Consumers that want a load number need sRPE, which needs an RPE we do
 * not capture yet (see the file header).
 *
 * Empty map on any error.
 */
export async function strengthMinutesByDay(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = (await pool.query<{ d: string; dur: string }>(
    `SELECT date::text AS d, SUM(COALESCE(duration_min, 0))::text AS dur
       FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= $2::date
        AND date <= $3::date
      GROUP BY date`,
    [userUuid, fromISO, toISO],
  ).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) {
    const minutes = Number(r.dur ?? 0);
    if (minutes <= 0) continue;
    out.set(r.d, minutes);
  }
  return out;
}

/** Total logged strength minutes across a date range. */
export async function strengthMinutesSum(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<number> {
  const byDay = await strengthMinutesByDay(userUuid, fromISO, toISO);
  let total = 0;
  for (const m of byDay.values()) total += m;
  return total;
}
