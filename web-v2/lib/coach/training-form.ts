/**
 * lib/coach/training-form.ts · real Banister training form.
 *
 * Computes Chronic Training Load (CTL · 42-day exponentially weighted
 * moving average), Acute Training Load (ATL · 7-day EWMA), and
 * Training Stress Balance (TSB = CTL − ATL).
 *
 * This replaces the placeholder fitness/fatigue/delta math that lived
 * in seed.ts adaptForm() · which was:
 *   fitness = avg planned weekly miles (plan-derived, never actual)
 *   fatigue = miles done THIS week so far (resets every Monday)
 *   delta   = fitness - fatigue (meaningless · proxies neither)
 *
 * The new model is the canonical sports-science one used by
 * TrainingPeaks, Runalyze, Intervals.icu, etc. Doctrine:
 *
 *   · Banister 1975 · Impulse-Response model
 *   · Coggan 2003 · CTL/ATL/TSB operationalization
 *   · 42d/7d EWMA windows · industry standard
 *
 * Training stress per day · distance-based (no HR-TSS yet):
 *   stress = distance_mi × intensity_factor
 *   · easy/recovery: 0.85
 *   · long:          0.95
 *   · tempo/thresh:  1.15
 *   · intervals:     1.25
 *   · race:          1.40
 *   · rest/zero:     0
 *
 * This is calibrated so a typical easy 5-mile run ≈ 4.25 TSS-like
 * units, a hard 10mi threshold ≈ 11.5, a marathon race ≈ 36.7.
 * Roughly matches Coggan-style TSS at typical effort distributions.
 *
 * TSB interpretation (consumer-facing label):
 *   TSB > +25  · DETRAINING (too fresh too long · fitness eroding)
 *   +10..+25   · RACE-READY (post-taper · primed)
 *   −10..+10   · PRODUCTIVE (productive training, balanced)
 *   −20..−10   · LOADED (high stress · watch fatigue)
 *   < −20      · OVERREACH (sustained negative · injury risk)
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md (Phase 1 closed loop)
 * Cite: Coggan/Banister TSS/CTL/ATL framework · industry standard
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export type TrainingFormLabel =
  | 'DETRAINING'
  | 'RACE-READY'
  | 'PRODUCTIVE'
  | 'LOADED'
  | 'OVERREACH'
  | 'BUILDING';   // legacy fallback for cold-start

export interface TrainingForm {
  /** Chronic Training Load · 42-day EWMA of training stress. */
  ctl: number;
  /** Acute Training Load · 7-day EWMA. */
  atl: number;
  /** Training Stress Balance · CTL − ATL · signed. */
  tsb: number;
  /** Status label tied to TSB band. */
  label: TrainingFormLabel;
  /** TSB delta vs 7 days ago · positive = trending fresher. */
  trend7: number;
  /** ACWR (acute/chronic) · retained for back-compat surfaces. */
  acwr: number | null;
}

/** EWMA decay constants · industry-standard windows. */
const CTL_WINDOW_DAYS = 42;
const ATL_WINDOW_DAYS = 7;
const CTL_DECAY = 1 / CTL_WINDOW_DAYS;
const ATL_DECAY = 1 / ATL_WINDOW_DAYS;

/** Intensity factors per workout type · calibrated to TSS-like scale. */
const INTENSITY_FACTOR: Record<string, number> = {
  rest:        0.00,
  shakeout:    0.70,
  recovery:    0.80,
  easy:        0.85,
  long:        0.95,
  progression: 1.05,
  fartlek:     1.10,
  tempo:       1.15,
  threshold:   1.15,
  intervals:   1.25,
  race:        1.40,
};

/**
 * Compute the training-form envelope for a runner.
 *
 * Bootstrap window · reads 120 days of runs; the first 42 seed the EWMAs
 * analytically (see F7 note below), the rest iterate day-by-day. Today's
 * value is the last in the series.
 *
 * Returns null when there's no recoverable history (true cold start ·
 * caller falls back to STEADY/cold-start defaults).
 */
export async function computeTrainingForm(userUuid: string): Promise<TrainingForm | null> {
  // 2026-06-03 · runner TZ instead of server CURRENT_DATE.
  // CTL / ATL / TSB calculated against the runner's calendar day so
  // the 60-day window doesn't shift at UTC-midnight.
  const today = await runnerToday(userUuid);

  // LTHR for HR-based intensity inference (E8-followup).
  // Friel zone boundaries: Z4 ≥ 0.88×LTHR → tempo; Z3 ≥ 0.78×LTHR → progression.
  // Cite: Friel, The Triathlete's Training Bible, zone table.
  const lthrRow = await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }));
  const lthr: number | null = lthrRow.rows[0]?.lthr ?? null;

  // Pull all runs in the 60-day window with their (date, distance, avgHr, type-hint).
  // Use type from plan_workouts when matched, else infer from HR then distance.
  const rows = (await pool.query<{
    d: string;
    mi: string;
    inferred_type: string | null;
    avg_hr: string | null;
  }>(
    `WITH all_days AS (
       SELECT generate_series(
         ($2::date - INTERVAL '120 days')::date,
         $2::date,
         '1 day'::interval
       )::date AS d
     ),
     -- 2026-06-01 - MAX-per-day dedupe instead of SUM.
     -- The canonical absorber is not firing reliably; most runs land
     -- with both watch AND apple_watch source rows surviving as
     -- non-merged siblings of the same physical run. SUMming
     -- double-counted miles by 2x and inflated TSB by 2x, which
     -- produced false OVERREACH labels (David hit this 2026-06-01:
     -- real 45 mi/wk getting summed to 76 mi/wk, inflating TSB to -39
     -- when reality was closer to PRODUCTIVE territory).
     -- MAX-per-day works because duplicate source rows record the same
     -- distance; taking the max is honest. Real fix is making the
     -- absorber fire reliably at ingest, tracked separately.
     daily_runs AS (
       SELECT (data->>'date')::date AS d,
              MAX((data->>'distanceMi')::numeric)::numeric AS mi,
              MAX((data->>'avgHr')::numeric)::numeric AS avg_hr
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - 120
        GROUP BY 1
     ),
     daily_plan AS (
       -- plan_workouts.date_iso is TEXT in schema · cast explicitly
       SELECT pw.date_iso::date AS d, pw.type
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso::date >= $2::date - 120
     )
     SELECT a.d::text AS d,
            COALESCE(r.mi, 0)::text AS mi,
            r.avg_hr::text AS avg_hr,
            p.type AS inferred_type
       FROM all_days a
       LEFT JOIN daily_runs r ON r.d = a.d
       LEFT JOIN daily_plan p ON p.d = a.d
      ORDER BY a.d ASC`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  if (rows.length === 0) return null;

  // Per-day stress series.
  const stresses = rows.map((r) => {
    const mi = Number(r.mi) || 0;
    const avgHr = r.avg_hr ? Number(r.avg_hr) : null;
    const type = r.inferred_type
      ?? (mi >= 10 ? 'long'
        : avgHr && lthr && avgHr >= lthr * 0.88 ? 'tempo'
        : avgHr && lthr && avgHr >= lthr * 0.78 ? 'progression'
        : 'easy');
    const ifct = INTENSITY_FACTOR[type] ?? 0.85;
    return mi * ifct;
  });

  // 2026-06-09 · race-killer follow-up F7 — seed the EWMAs analytically
  // instead of from zero. A 42-day EWMA seeded at 0 and fed 60 days
  // reaches only 1−e^(−60/42) ≈ 76% of steady state, so CTL ran ~24%
  // low and TSB ~10 display-points too negative (audit reproduction:
  // shipped −25 vs −15 with a converged seed — a full interpretation
  // band of phantom fatigue). Window is now 120 days; the first 42 days
  // seed the chronic mean (ctl₀) and the trailing 7 of those seed the
  // acute mean (atl₀); iteration runs over the remaining ~78 days, far
  // past both time constants, so any seed error decays to noise.
  // Cold start (< 56 days of history): original zero-seed behavior —
  // the CTL<10 BUILDING guard already labels that envelope honestly.
  const SEED_DAYS = CTL_WINDOW_DAYS; // 42
  const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  let ctl: number;
  let atl: number;
  let iterFrom: number;
  if (stresses.length >= SEED_DAYS + 14) {
    ctl = mean(stresses.slice(0, SEED_DAYS));
    atl = mean(stresses.slice(SEED_DAYS - ATL_WINDOW_DAYS, SEED_DAYS));
    iterFrom = SEED_DAYS;
  } else {
    ctl = 0;
    atl = 0;
    iterFrom = 0;
  }
  const tsbSeries: number[] = [];
  for (let i = iterFrom; i < stresses.length; i++) {
    const stress = stresses[i];
    // EWMA update · today = yesterday × (1 - α) + stress × α
    ctl = ctl * (1 - CTL_DECAY) + stress * CTL_DECAY;
    atl = atl * (1 - ATL_DECAY) + stress * ATL_DECAY;
    tsbSeries.push(ctl - atl);
  }

  // Scale CTL/ATL to a runner-friendly range. The raw EWMA is on a small
  // scale (typical CTL ~3-5 for a runner doing 30-50 mi/wk). Multiply by
  // 10 so the displayed numbers fit the same visual band the placeholder
  // produced (typical: CTL 30-70, ATL 25-80, TSB ±20).
  // This is a presentation scaling · doesn't change relative dynamics.
  const SCALE = 10;
  const ctlScaled = Math.round(ctl * SCALE);
  const atlScaled = Math.round(atl * SCALE);
  const tsbScaled = ctlScaled - atlScaled;

  // Trend · today's TSB minus 7-day-ago TSB.
  const trend7 = tsbSeries.length >= 8
    ? Math.round((tsbSeries.at(-1)! - tsbSeries.at(-8)!) * SCALE)
    : 0;

  // ACWR · acute 7d sum / chronic 28d sum-per-day-equivalent.
  const acute7 = rows.slice(-7).reduce((s, r) => s + (Number(r.mi) || 0), 0);
  const chronic28 = rows.slice(-28).reduce((s, r) => s + (Number(r.mi) || 0), 0) / 4;
  const acwr = chronic28 > 0 ? Number((acute7 / chronic28).toFixed(2)) : null;

  return {
    ctl: ctlScaled,
    atl: atlScaled,
    tsb: tsbScaled,
    label: labelForTsb(tsbScaled, ctlScaled),
    trend7,
    acwr,
  };
}

/**
 * Map TSB value to label per the canonical Coggan ranges.
 *
 * 2026-06-01 · recalibrated. Original bands were too tight · TSB -19
 * shouldn't be OVERREACH, it should be LOADED (productive training).
 * Coggan's published interpretation:
 *   > +25  Fresh (race-ready) or detraining at the very high end
 *   -10..+25 Productive · maintaining
 *   -30..-10 Productive overload · most progress happens here
 *   < -30  Risk zone · sustained overreach
 *
 * Special case · CTL < 10 → BUILDING (not enough chronic load to
 * call meaningful overreach vs detraining).
 */
function labelForTsb(tsb: number, ctl: number): TrainingFormLabel {
  if (ctl < 10) return 'BUILDING';
  if (tsb > 25)  return 'DETRAINING';
  if (tsb > 10)  return 'RACE-READY';
  if (tsb > -10) return 'PRODUCTIVE';
  if (tsb > -30) return 'LOADED';
  return 'OVERREACH';
}
