/**
 * lib/coach/convergence-loader.ts · assembling real evidence for the
 * convergence rule.
 *
 * The RULE lives in `convergence.ts` and is pure — no database, no clock, no
 * randomness — so it can be tested exhaustively. This module is the impure
 * half: it reads the runner's own history and context out of the database and
 * hands the rule a plain data structure.
 *
 * Keeping the split sharp is deliberate. Every threshold argument, every
 * per-domain filter and every piece of coach copy is decided in the pure
 * module where a test can pin it; nothing here decides anything.
 *
 * ── Series are DATE-ALIGNED, and gaps are gaps ───────────────────────────
 *
 * Each series is built on a continuous date axis ending on the runner's own
 * today. A day with no reading is `null`, never a carried-forward value and
 * never a zero. `trailingStreak` in the rule breaks on null, so a missing
 * night can extend nothing — which is the honest behaviour: we did not observe
 * that the condition held.
 *
 * ── What is NOT yet instrumented ─────────────────────────────────────────
 *
 * `ConvergenceContext` supports alcohol and travel suppressors because
 * Research/15 §"Confounders that elevate RHR independent of training stress"
 * names both, and the rule should be written against the doctrine rather than
 * against today's schema. THE APP DOES NOT MEASURE EITHER. There is no alcohol
 * log and no timezone-change history, so both are passed as "not known" —
 * which means NO suppression, not silent suppression.
 *
 * Be clear about the direction of that gap: it makes the detector MORE likely
 * to fire, not less. A business trip that wrecks three nights of sleep and
 * lifts nocturnal heart rate is the case it would miss. Race-related travel is
 * largely covered anyway — race week suppresses load and the post-race window
 * suppresses the autonomic, cardiac and subjective domains — so the exposure
 * is non-race travel. Fabricating a travel signal from run locations would be
 * worse than naming the gap, so it is named here and in the handover.
 */

import { pool } from '@/lib/db/pool';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import {
  coverageDaysFrom,
  firstRunISO,
  isoDaysBefore,
} from '@/lib/runs/volume';
import {
  ACWR_CHRONIC_DAYS,
  acwrFromDailyMileage,
} from './acwr';
import { loadReadinessHistory, type PillarPoint } from './readiness-history';
import { POST_RACE_RECOVERY_WEEKS } from '@/lib/plan/goal-tiers';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { CONVERGENCE, type ConvergenceContext, type ConvergenceSeries } from './convergence';

/**
 * Days of evidence handed to the rule. Comfortably past every threshold, and
 * long enough that the PRIOR window below still has real history in it after
 * the days under test are excluded.
 */
const WINDOW_DAYS = 60;

/**
 * Days excluded from the tail when computing a baseline.
 *
 * Research/15 defines the SWC against the SD of the rolling average "over the
 * PRIOR 60 days", and the word does real work. A baseline that includes the
 * days it is being compared against moves toward them, so a sustained drop
 * partly cancels its own signal: three days at 10% below baseline inside a
 * 30-day mean drag that mean down by a tenth of the drop, eroding the margin
 * over the SWC by roughly a third. The runner's "normal" has to be measured
 * from a window that does not contain the deviation under test.
 *
 * Seven days, because that is the width of the rolling average itself — every
 * value inside the last 7 days is partly built from readings the rule is
 * currently judging.
 */
export const PRIOR_EXCLUDES_DAYS = 7;

/** Values with the trailing window removed · the runner's "prior" normal. */
function priorOnly<T>(xs: T[]): T[] {
  return xs.slice(0, Math.max(0, xs.length - PRIOR_EXCLUDES_DAYS));
}

/* ────────────────────────── Date-axis helpers ────────────────────────── */

/** The last `n` ISO dates ending on `todayISO`, oldest → newest. */
export function dateAxis(todayISO: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoDaysBefore(todayISO, i));
  return out;
}

/** Project per-date points onto the axis · missing days become null. */
function onAxis(points: PillarPoint[], axis: string[]): Array<number | null> {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (p?.date && Number.isFinite(p.value)) byDate.set(p.date.slice(0, 10), p.value);
  }
  return axis.map((d) => byDate.get(d) ?? null);
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/* ────────────────────────── HRV · into log space ─────────────────────── */

/**
 * The Plews series, built the way Research/15 §"Plews approach" specifies:
 * step 1 daily readings, step 2 the 7-day rolling average OF LnRMSSD, step 3
 * the SD of that rolling average over the prior 60 days.
 *
 * The rolling average is computed over the PRESENT readings inside each 7-day
 * window rather than requiring all seven, because doctrine's own step is
 * explicit that "3 valid readings per week is sufficient for trend assessment
 * if paired with a 7-day rolling average". A window with fewer than three
 * readings yields null, and null cannot extend a streak.
 */
export function plewsSeries(hrv: PillarPoint[], axis: string[]): {
  rolling: Array<number | null>;
  baseline: number | null;
  sd60: number | null;
} {
  const raw = onAxis(hrv, axis);
  const rolling: Array<number | null> = axis.map((_, i) => {
    const window = raw.slice(Math.max(0, i - 6), i + 1)
      .filter((v): v is number => v != null && v > 0);
    if (window.length < 3) return null;
    return mean(window.map((v) => Math.log(v)));
  });

  // The runner's own reference and spread, from the PRIOR window only · see
  // PRIOR_EXCLUDES_DAYS for why the days under test cannot be in it.
  const present = priorOnly(rolling).filter((v): v is number => v != null);
  if (present.length < 7) return { rolling, baseline: null, sd60: null };
  // Doctrine's SD is "over the prior 60 days". With materially less than that
  // the spread is not yet meaningful and the rule falls back to step 4's
  // percentage form, which is doctrine's own alternative rather than ours.
  const enoughForSd = present.length >= 30;
  return {
    rolling,
    baseline: mean(present),
    sd60: enoughForSd ? sd(present) : null,
  };
}

/* ────────────────────────── ACWR · a daily series ────────────────────── */

/**
 * The ratio for each day on the axis, computed the same way `computeAcwr`
 * computes today's — same windows, same coverage guard, one fetch.
 *
 * `coverageDays` is recomputed PER DAY against that day's own position, so a
 * day early in the account's life is null for the same reason today would have
 * been: a fixed-28 denominator counting days the account did not exist is an
 * arithmetic identity, not a measurement (see the docblock in acwr.ts).
 */
async function acwrSeries(userId: string, axis: string[]): Promise<Array<number | null>> {
  const oldest = axis[0];
  const from = isoDaysBefore(oldest, ACWR_CHRONIC_DAYS - 1);
  const today = axis[axis.length - 1];
  const [byDay, firstISO] = await Promise.all([
    canonicalMileageByDay(userId, from, today).catch(
      () => new Map<string, { mi: number; canonicalIds: string[] }>(),
    ),
    firstRunISO(userId).catch(() => null),
  ]);
  const mi = new Map<string, number>();
  for (const [day, info] of byDay) mi.set(day, info.mi);
  return axis.map((d) =>
    acwrFromDailyMileage(mi, d, coverageDaysFrom(firstISO, d, ACWR_CHRONIC_DAYS)).acwr,
  );
}

/* ────────────────────────── Context ──────────────────────────────────── */

function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Everything that might EXPLAIN a domain's reading. Read once, applied
 * per-domain by the rule.
 */
export async function loadConvergenceContext(
  userId: string,
  todayISO: string,
): Promise<ConvergenceContext> {
  const [races, sick, phase] = await Promise.all([
    pool.query<{ date: string; distance_mi: string | null }>(
      `SELECT meta->>'date' AS date, meta->>'distanceMi' AS distance_mi
         FROM races
        WHERE user_uuid = $1::uuid AND meta->>'date' IS NOT NULL
        ORDER BY meta->>'date'`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ date: string; distance_mi: string | null }> })),
    pool.query<{ id: string }>(
      `SELECT id FROM sick_episodes
        WHERE user_uuid = $1::uuid AND cleared_at IS NULL
        LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ id: string }> })),
    pool.query<{ mode: string | null; phase_label: string | null }>(
      `SELECT tp.mode,
              (SELECT ph.label FROM plan_phases ph
                 JOIN plan_weeks w ON w.phase_id = ph.id
                WHERE w.plan_id = tp.id
                  AND w.week_start_iso::date <= $2::date
                  AND (w.week_start_iso::date + interval '6 days') >= $2::date
                LIMIT 1) AS phase_label
         FROM training_plans tp
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        ORDER BY tp.authored_iso DESC LIMIT 1`,
      [userId, todayISO],
    ).catch(() => ({ rows: [] as Array<{ mode: string | null; phase_label: string | null }> })),
  ]);

  const dated = races.rows
    .map((r) => ({ date: String(r.date).slice(0, 10), mi: r.distance_mi != null ? Number(r.distance_mi) : null }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));

  const past = dated.filter((r) => r.date <= todayISO);
  const future = dated.filter((r) => r.date > todayISO);
  const lastRace = past.length > 0 ? past[past.length - 1] : null;
  const nextRace = future.length > 0 ? future[0] : null;

  // How long the disturbance a race causes is EXPECTED to last · doctrine's
  // own per-distance recovery window (registry claim RECOVERY.post-race-
  // duration), not a number invented here.
  const postRaceWindowDays = (() => {
    const cat = distanceCategoryOrNull(lastRace?.mi ?? null);
    // No recognisable distance · take the half-marathon row rather than
    // guessing a category. It is the middle of doctrine's table, so an
    // unknown race neither over- nor under-suppresses by much.
    return POST_RACE_RECOVERY_WEEKS[cat ?? 'hm'] * 7;
  })();

  const label = (phase.rows[0]?.phase_label ?? '').toUpperCase();
  const mode = phase.rows[0]?.mode ?? null;

  return {
    daysToNextRace: nextRace ? daysBetween(todayISO, nextRace.date) : null,
    daysSinceLastRace: lastRace ? daysBetween(lastRace.date, todayISO) : null,
    postRaceWindowDays,
    // A taper or a recovery-mode plan drops the load ratio BY DESIGN. This is
    // the V5 Z2 filter: the number is describing the plan, not the runner.
    inPlannedCutback: mode === 'recovery' || label.includes('TAPER') || label.includes('RECOVERY'),
    illnessActive: sick.rows.length > 0,
    // Not instrumented · see the module docblock. Unknown means no
    // suppression, never silent suppression.
    daysSinceTravel: null,
    alcoholLastNight: false,
    heatFlaggedDaysRecent: await countHeatFlaggedDays(userId, todayISO),
  };
}

/**
 * Days in the trailing window whose conditions reached a named heat band.
 *
 * Research/15 lists "hot bedroom (+3 to +5 bpm)" as a confounder of exactly
 * the same magnitude as the +5 bpm threshold the cardiac domain fires on, so a
 * heat block can manufacture that domain outright. The gate itself is
 * `lib/coach/heat-gate.ts` (Research/06 §11), reused rather than re-derived.
 *
 * Best-effort: when the forecast is unavailable the count is 0, which means no
 * suppression. Named in the docblock as a gap in the same honest direction as
 * travel and alcohol.
 */
async function countHeatFlaggedDays(userId: string, todayISO: string): Promise<number> {
  try {
    const { resolveHomeLatLng, fetchDayForecast } = await import('@/lib/weather/openmeteo');
    const { heatBandForConditions } = await import('./heat-gate');
    const home = await resolveHomeLatLng(userId);
    if (!home) return 0;

    const days = dateAxis(todayISO, CONVERGENCE.heatConfoundDays);
    const forecasts = await Promise.all(
      days.map((d) => fetchDayForecast(home.lat, home.lng, d).catch(() => null)),
    );
    let flagged = 0;
    for (const f of forecasts) {
      if (!f) continue;
      const band = heatBandForConditions({
        tairF: f.temp_max_f ?? f.temp_start_f,
        humidityPct: f.humidity_pct,
        cloudCoverPct: f.cloud_cover_pct,
      });
      if (band != null) flagged++;
    }
    return flagged;
  } catch {
    return 0;
  }
}

/* ────────────────────────── The series ───────────────────────────────── */

export async function loadConvergenceSeries(
  userId: string,
  todayISO: string,
  opts: { subjectiveWreckedOnEasy: boolean },
): Promise<ConvergenceSeries> {
  const axis = dateAxis(todayISO, WINDOW_DAYS);
  const [history, acwrDaily] = await Promise.all([
    loadReadinessHistory(userId),
    acwrSeries(userId, axis).catch(() => axis.map(() => null)),
  ]);

  const hrv = plewsSeries(history.hrv ?? [], axis);
  const rhrDaily = onAxis(history.rhr ?? [], axis);
  const sleepNightly = onAxis(history.sleep ?? [], axis);

  // The runner's own RHR reference · Research/15 §"Establishing a baseline"
  // wants a rolling average recomputed monthly, from the PRIOR window for the
  // same reason the HRV baseline does: a two-day elevation must not raise the
  // bar it is measured against.
  const rhrPresent = priorOnly(rhrDaily).filter((v): v is number => v != null);
  const rhrBaseline = rhrPresent.length >= 7 ? mean(rhrPresent) : null;

  // "Minimum 14 days of data before drawing conclusions" · days on which we
  // observed ANY biometric. Counting days, not readings, is what doctrine
  // says, and it is why a runner who syncs three metrics on one morning does
  // not clear the gate three times faster.
  const baselineDays = axis.reduce((n, _d, i) => {
    const any = hrv.rolling[i] != null || rhrDaily[i] != null || sleepNightly[i] != null;
    return n + (any ? 1 : 0);
  }, 0);

  // Habitual weekly mileage sets the doctrine sleep floor · chronic, not
  // acute, for the reason given in readiness.ts:weeklyMpwFor.
  return {
    hrvLnRolling: hrv.rolling,
    hrvLnBaseline: hrv.baseline,
    hrvLnSd60d: hrv.sd60,
    rhrDaily,
    rhrBaseline,
    sleepNightly,
    acwrDaily,
    subjectiveWreckedOnEasy: opts.subjectiveWreckedOnEasy,
    baselineDays,
    weeklyMpw: await habitualWeeklyMpw(userId, todayISO),
  };
}

/** The runner's habitual weekly mileage · chronic leg × 7. */
async function habitualWeeklyMpw(userId: string, todayISO: string): Promise<number | null> {
  const { computeAcwr } = await import('./acwr');
  const load = await computeAcwr(userId, todayISO).catch(() => null);
  return load?.chronic28 != null ? load.chronic28 * 7 : null;
}
