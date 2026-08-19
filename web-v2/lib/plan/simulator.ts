/**
 * lib/plan/simulator.ts · plan → projected trajectory (Phase 2.1).
 *
 * Takes a TrainingPlan (week-by-week structure) + RunnerCalibration
 * (per-runner state) and returns a simulation result:
 *
 *   · Per-week projected VDOT
 *   · Per-week projected race time at goal distance
 *   · Final-week confidence band (p25 / median / p75)
 *   · Risk flags (volume ramp too steep, quality density too high, etc.)
 *
 * The output is a GAP REPORT, never a ship/reject binary. The
 * architecture doctrine §1 ("honest projection over heroic prescription")
 * means the simulator's job is to TELL the runner what to expect, not
 * to gate-keep the plan.
 *
 * Model · OURS, not a published one. Every bullet below is a modelling
 * choice; see the DOCTRINE-BOOK-14 note further down for what happened the
 * last time this block read as though the numbers came out of a book.
 *
 *   VDOT progression:
 *     · Threshold + interval volume drives VDOT up · magnitude is
 *       COLD_START_CALIBRATION.vdotPerQuality, a convention
 *     · Marginal returns once quality density reaches the ceiling any tier
 *       runs · threshold from Research/00a §"Workout dose by race distance",
 *       magnitude (DENSITY_PENALTY) a convention
 *     · Recovery response scales with `recoveryMult`, a per-runner
 *       calibration rather than a doctrine figure
 *
 *   Endurance:
 *     · The long run contributes in proportion to its share of the week,
 *       weighted by `longRunWeight` · a modelled contribution term, not a
 *       progression protocol
 *
 *   Plateau detection:
 *     · Gains saturate toward `plateauVdot` from PLATEAU_FLOOR_VDOT. The
 *       saturating SHAPE is Research/00a §"Aerobic Base Development"; both
 *       endpoints are conventions
 *
 * There is no validation bench. This block used to promise one ("sim should
 * match published progressions within ±10%, test bench in Phase 3"); no such
 * bench was ever written, and a promised falsifier that does not exist is
 * worse than none, because it reads as though the model has been checked.
 *
 * ── DOCTRINE-BOOK-14 (2026-08-17) ──────────────────────────────────────────
 * THE FITNESS-RESPONSE MODEL IN THIS FILE IS A CONVENTION, NOT A RESEARCH
 * FINDING. It used to cite a "VDOT response curves" section of Daniels' Running
 * Formula, and a "long-run progression" section of Pfitzinger's Advanced
 * Marathoning. (Spelled out rather than quoted verbatim: the registry claim
 * greps this file for the exact old strings so they cannot come back, and a
 * comment reproducing them would trip its own tripwire.) Neither checks out,
 * and this is the
 * same failure as the cold-start pace anchor (CONVENTION.cold-start-mileage-
 * anchor): a product model wearing a research finding's clothes, invisible to
 * the gate because the citation named a book instead of a file it could open.
 *
 *   · Daniels publishes a VDOT TABLE — a performance-to-paces mapping. He
 *     publishes no response CURVE, nothing that says a quality session is
 *     worth 0.10 VDOT points or that runners plateau at 75. A search of
 *     Research/ for any VDOT-gain-per-week figure returns nothing, because
 *     no doc carries one.
 *   · The long-run section it named is not a section of Advanced Marathoning, and
 *     what this file does with the long run is not a progression protocol —
 *     it is a modelled contribution term, longRunRatio × weight × baseGain.
 *
 * So `vdotPerQuality`, `baseGain`, `longRunWeight`, `plateauVdot` and the
 * plateau penalty are OURS. What research does ground is the model's SHAPE:
 * that gains are non-linear and diminish as a runner approaches their ceiling,
 * and that quality density has a point past which more stops helping. That is
 * why the shape survives and only the labelling changed.
 *
 * This matters more than a comment usually does, because everything here is
 * PROJECTED. Nothing in this file measures a runner. Surfacing its output as
 * though it were observed fitness is the one thing this model must never be
 * used for. Bound by CONVENTION.fitness-response-model.
 *
 * ── RULE 7 (2026-08-19) · THE NUMBERS THE MODEL ACTUALLY RUNS ON ───────────
 * CONVENTION.fitness-response-model bound `COLD_START_CALIBRATION` and
 * `baseGain`, and stopped there. Everything else doing work in this file is
 * FUNCTION-LOCAL, which made it invisible to the doctrine lint's name-based
 * scan — the same evasion, in a different shape, as the wrapper generics that
 * hid eight per-distance tables in `lib/race/distance-doctrine.ts`. The rest
 * are now labelled and bound:
 *
 *   · `densityPenalty` (0.7) and the plateau floor (VDOT 50) —
 *     CONVENTION.simulator-response-parameters. The SHAPE is doctrine (a
 *     quality-density ceiling exists; gains saturate near a ceiling); the two
 *     magnitudes are ours and appear in no Research/ doc.
 *
 *   · `sigmaSecPerMile`, the ±1.5σ p25/p75 band, and the per-week
 *     `confidence` decay — CONVENTION.simulator-projection-band. THIS IS THE
 *     ONE THAT REACHES A RUNNER: `lib/plan/gap-report.ts` turns p25 / median /
 *     p75 straight into the A-goal / B-goal / C-goal a runner is shown. The
 *     band is therefore a runner-facing precision claim, and it was resting on
 *     four unlabelled numbers. Research/02 §13.7 is the only table in the
 *     corpus that says how wide a reported prediction interval should be, and
 *     the claim compares this band against it. It does not currently pass —
 *     see the exemption on that claim.
 *
 * Neither set is being changed here. Labelling a convention is not the same as
 * endorsing its value, and widening a runner-facing goal band is a product
 * decision, not a gate fix.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.1 — the model's own spec
 * Cite: Research/00a-distance-running-training.md §"Aerobic Base Development"
 *       — the time courses that justify a non-linear, saturating shape
 * Cite: Research/00a-distance-running-training.md §"Workout dose by race distance"
 *       — the quality-density ceiling behind the >2-sessions penalty
 * Cite: Research/00a-distance-running-training.md §"Long-run rules of thumb"
 *       — the long-run share the contribution term reads, 25-30% of the week
 */

import { pool } from '@/lib/db/pool';
import { predictRaceTime } from '@/lib/training/vdot';

export interface SimulatorInput {
  /** plan_workouts rows in chronological order. */
  weeks: SimulatorWeek[];
  /** Current VDOT at plan start. */
  startVdot: number;
  /** Race distance the projection is for. */
  raceDistanceMi: number;
  /** Runner calibration · per-runner learned response curves.
   *  Pass cold-start defaults when calibration is unavailable. */
  calibration: RunnerCalibrationLike;
}

export interface SimulatorWeek {
  weekIdx: number;
  startISO: string;
  phase: string;
  weeklyMi: number;
  qualitySessions: number;
  longRunMi: number;
}

export interface RunnerCalibrationLike {
  /** VDOT gain per quality session (calibrated; default 0.10 pts). */
  vdotPerQuality: number;
  /** Long-run endurance gain factor (0..1; marathon=0.6, 5K=0.1). */
  longRunWeight: number;
  /** Recovery rate multiplier (1.0 = baseline · sleep-debt-prone < 1.0). */
  recoveryMult: number;
  /** Plateau VDOT · above this the marginal gain falls to 0.05/wk. */
  plateauVdot: number;
}

export interface SimulatorResult {
  /** Per-week trajectory (VDOT + projected race time). */
  weeklyTrajectory: Array<{
    weekIdx: number;
    startISO: string;
    projectedVdot: number;
    projectedRaceSec: number | null;
    weeklyGainVdot: number;
    confidence: number;
  }>;
  /** Final-week confidence band (uses ±1.5σ around median model). */
  finalProjection: {
    medianSec: number | null;
    p25Sec: number | null;
    p75Sec: number | null;
    finalVdot: number;
  };
  /** Risk flags surfaced for the brief + drift cron. */
  riskFlags: string[];
  citation: string;
}

/**
 * Quality sessions per week at which this projection both flags density risk
 * and applies the diminishing-returns penalty.
 *
 * DOCTRINE, not convention: Research/00a §"Workout dose by race distance" is
 * the table QUALITY.sessions-per-week reads to assert that three quality
 * sessions is the ceiling any tier runs. Sitting the flag exactly at that
 * ceiling is the doc's own number. The PENALTY MAGNITUDE below is not.
 */
export const QUALITY_DENSITY_CEILING = 3;

/**
 * The week-over-week volume step this projection flags as a risk.
 *
 * CONVENTION. Research/00a §"Volume progression rules" reports 5-15% per cycle
 * for trained athletes and +20-25% over 8 weeks for novices; 12% is neither,
 * and this function is not given the runner's experience level so it cannot
 * read GENERAL_RAMP_CEILING. It sits inside doctrine's two bands, which is the
 * only property it can honestly claim.
 *
 * This is advisory output only — the plan's actual ramp is bounded by
 * `GENERAL_RAMP_CEILING` in the generator and by `CONSTRAINTS` in the
 * validator, both of which are bound elsewhere in the registry.
 */
export const RAMP_FLAG_THRESHOLD = 0.12;

/**
 * Multiplier applied to a week's modelled gain once quality density reaches
 * QUALITY_DENSITY_CEILING.
 *
 * CONVENTION. That returns diminish past a quality-density ceiling is
 * doctrine's shape; that the remainder is 70% is ours and appears in no
 * Research/ doc. Was an inline `0.7` with the bare attribution "(Daniels)".
 * Bound by CONVENTION.simulator-response-parameters.
 */
export const DENSITY_PENALTY = 0.7;

/**
 * VDOT below which the plateau term gives full gain.
 *
 * CONVENTION. `plateauPenalty` interpolates from 1.0 at this floor to 0.1 at
 * `plateauVdot`. Research/00a §"Aerobic Base Development" grounds the SHAPE —
 * gains saturate as a runner approaches their ceiling — and nothing in
 * Research/ names a VDOT at which the saturation starts. 50 is ours.
 * Bound by CONVENTION.simulator-response-parameters.
 */
export const PLATEAU_FLOOR_VDOT = 50;

/**
 * Standard deviation of the projected finish, in seconds per mile of race
 * distance, by distance band.
 *
 * CONVENTION, and the one that reaches a runner: `lib/plan/gap-report.ts`
 * turns the ±1.5σ band these produce into the A-goal / B-goal / C-goal.
 * Research/02 §13.7 "Confidence Intervals to Report with Predictions" is the
 * only table in the corpus that says how wide a reported interval should be.
 * Bound by CONVENTION.simulator-projection-band, WHICH CARRIES A RECORDED
 * VIOLATION: at 5K and 10K this band is materially tighter than the tightest
 * interval §13.7 publishes for any prediction span. Read that exemption before
 * touching these numbers.
 */
export const SIGMA_SEC_PER_MILE: ReadonlyArray<{ throughMi: number; sigma: number }> = [
  { throughMi: 3.5, sigma: 1.0 },
  { throughMi: 7, sigma: 2.0 },
  { throughMi: 14, sigma: 4.0 },
  { throughMi: Infinity, sigma: 10.0 },
] as const;

/** Half-width of the reported band, in standard deviations. CONVENTION. */
export const BAND_SIGMAS = 1.5;

/** Cold-start calibration defaults · used when no per-runner data exists. */
export const COLD_START_CALIBRATION: RunnerCalibrationLike = {
  vdotPerQuality: 0.10,    // 0.4 pts / 4 weeks at 1 quality/wk
  longRunWeight: 0.3,       // medium · HM-tuned
  recoveryMult: 1.0,
  plateauVdot: 75,          // most runners plateau around VDOT 70-75
};

/**
 * Simulate a plan · returns trajectory + confidence band.
 *
 * Pure function · no DB writes. Caller is responsible for reading
 * plan_workouts + projection_snapshots + runner_calibration first.
 */
export function simulate(input: SimulatorInput): SimulatorResult {
  const trajectory: SimulatorResult['weeklyTrajectory'] = [];
  const riskFlags: string[] = [];
  let curVdot = input.startVdot;

  for (const wk of input.weeks) {
    const gain = computeWeeklyGain(wk, curVdot, input.calibration);
    curVdot = Math.min(85, curVdot + gain);  // VDOT-85 hard cap
    const projectedSec = predictRaceTime(curVdot, input.raceDistanceMi);

    // Confidence shrinks for further-out weeks (more uncertainty).
    // Linearly interpolate from 1.0 (this week) to 0.4 (race week).
    // CONVENTION · no Research/ doc puts projection confidence on a per-week
    // clock. What the claim enforces is the SHAPE (starts at 1, never rises,
    // never reaches 0), not the 0.04 or the 0.4.
    // Bound by CONVENTION.simulator-projection-band.
    const confidence = Math.max(0.4, 1 - wk.weekIdx * 0.04);

    trajectory.push({
      weekIdx: wk.weekIdx,
      startISO: wk.startISO,
      projectedVdot: Math.round(curVdot * 10) / 10,
      projectedRaceSec: projectedSec,
      weeklyGainVdot: Math.round(gain * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    });

    // Risk flag · steep ramp
    if (wk.weeklyMi > 0 && wk.weekIdx > 0) {
      const prevMi = input.weeks[wk.weekIdx - 1]?.weeklyMi ?? wk.weeklyMi;
      // 2026-08-19 · the flag used to read "exceeds 10% rule" while testing
      // 12%, and the rule it named is the one Research/00a §"The 10% rule —
      // reconsidered" DEBUNKS as a general-case ceiling (see DOCTRINE-7 in
      // goal-tiers.ts). A flag that misstates its own threshold and cites a
      // retired rule teaches a runner to ignore it. It now states the
      // threshold it actually tests, and names the row that does bound a
      // general ramp. The threshold itself is unchanged and is a CONVENTION:
      // it sits between doctrine's trained band top (15%) and its novice band
      // top (25%), and this function does not know the runner's level.
      // Bound by CONVENTION.simulator-response-parameters.
      if (prevMi > 0 && (wk.weeklyMi - prevMi) / prevMi > RAMP_FLAG_THRESHOLD) {
        riskFlags.push(
          `Wk${wk.weekIdx}: ${Math.round((wk.weeklyMi - prevMi) / prevMi * 100)}% volume ramp · ` +
          `over the ${Math.round(RAMP_FLAG_THRESHOLD * 100)}% step this projection flags ` +
          `(Research/00a-distance-running-training.md §"Volume progression rules").`,
        );
      }
    }
    // Risk flag · quality density too high. Three quality sessions is the
    // ceiling any tier runs (QUALITY.sessions-per-week reads that out of
    // Research/00a §"Workout dose by race distance"), so the THRESHOLD is
    // doctrine even though the penalty magnitude below is not.
    if (wk.qualitySessions >= QUALITY_DENSITY_CEILING) {
      riskFlags.push(
        `Wk${wk.weekIdx}: ${wk.qualitySessions} quality sessions · density risk ` +
        `(Research/00a-distance-running-training.md §"Workout dose by race distance").`,
      );
    }
  }

  // Plateau detection
  const lastGain = trajectory.at(-1)?.weeklyGainVdot ?? 0;
  if (lastGain < 0.05 && trajectory.length > 4) {
    riskFlags.push(`Trajectory plateau at VDOT ${trajectory.at(-1)?.projectedVdot} · additional volume buys ~nothing.`);
  }

  const finalVdot = trajectory.at(-1)?.projectedVdot ?? input.startVdot;
  const medianSec = predictRaceTime(finalVdot, input.raceDistanceMi);

  // Confidence band · ±BAND_SIGMAS σ around the median model.
  // σ scales with race distance: shorter races get tighter bands.
  // CONVENTION on both counts — see SIGMA_SEC_PER_MILE. This band becomes the
  // runner's A/B/C goals in gap-report.ts, so it is a precision claim made to
  // a person, not an internal number.
  const sigmaSecPerMile =
    SIGMA_SEC_PER_MILE.find((b) => input.raceDistanceMi <= b.throughMi)?.sigma
    ?? SIGMA_SEC_PER_MILE[SIGMA_SEC_PER_MILE.length - 1].sigma;
  const sigmaSec = sigmaSecPerMile * input.raceDistanceMi;
  const p25Sec = medianSec != null ? medianSec - Math.round(BAND_SIGMAS * sigmaSec) : null;
  const p75Sec = medianSec != null ? medianSec + Math.round(BAND_SIGMAS * sigmaSec) : null;

  return {
    weeklyTrajectory: trajectory,
    finalProjection: { medianSec, p25Sec, p75Sec, finalVdot },
    riskFlags,
    citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.1',
  };
}

/**
 * Compute the per-week VDOT gain from training stimulus + calibration.
 *
 * Model · gain = (qualityStimulus + longRunContribution) × recoveryMult ×
 * plateauPenalty.
 *
 *   qualityStimulus  = sessions × vdotPerQuality
 *   longRunContrib   = (longRunMi / weeklyMi) × longRunWeight × baseGain
 *   plateauPenalty   = max(0.1, 1 - (curVdot - PLATEAU_FLOOR_VDOT)
 *                                    / (plateauVdot - PLATEAU_FLOOR_VDOT))
 *   recoveryMult     = runner-specific (sleep-debt-prone < 1.0)
 *
 * `baseGain`, `DENSITY_PENALTY` and `PLATEAU_FLOOR_VDOT` are conventions.
 * Bound by CONVENTION.fitness-response-model and
 * CONVENTION.simulator-response-parameters.
 */
function computeWeeklyGain(
  wk: SimulatorWeek,
  curVdot: number,
  cal: RunnerCalibrationLike,
): number {
  if (wk.weeklyMi === 0) return 0;  // pure rest week
  const baseGain = 0.10;
  const qualityStimulus = wk.qualitySessions * cal.vdotPerQuality;
  const longRunRatio = wk.weeklyMi > 0 ? wk.longRunMi / wk.weeklyMi : 0;
  const longRunContrib = longRunRatio * cal.longRunWeight * baseGain;
  // Plateau math · safe against zero headroom (beginners with plateauVdot at
  // the floor) and capped at 1.0 so being below plateau gives full gain, not
  // a boost. PLATEAU_FLOOR_VDOT is a CONVENTION — see its declaration.
  const plateauHeadroom = Math.max(1, cal.plateauVdot - PLATEAU_FLOOR_VDOT);
  const plateauPenalty = Math.max(0.1, Math.min(1, 1 - (curVdot - PLATEAU_FLOOR_VDOT) / plateauHeadroom));
  const raw = (qualityStimulus + longRunContrib) * cal.recoveryMult * plateauPenalty;

  // Diminishing returns once quality density reaches the ceiling any tier
  // runs. The threshold is doctrine's; DENSITY_PENALTY is ours. The bare
  // attribution this comment used to carry — a naked "(Daniels)" with nothing
  // to open — is exactly the shape the lint's bare-attribution check exists
  // to stop, and it was sitting on a number Daniels never published.
  const densityPenalty = wk.qualitySessions >= QUALITY_DENSITY_CEILING ? DENSITY_PENALTY : 1.0;
  return raw * densityPenalty;
}

/**
 * Load the inputs for a plan simulation from the DB.
 *
 * Convenience wrapper around the pure simulate() function. Reads:
 *   · plan_workouts for the active plan
 *   · latest projection_snapshots for startVdot
 *   · races for raceDistanceMi
 *   · runner_calibration (Phase 2.2) · falls back to COLD_START_CALIBRATION
 */
export async function simulateActivePlan(userUuid: string): Promise<SimulatorResult | null> {
  // 1. Active plan
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!plan?.race_id) return null;

  // 2. Race distance + goal
  const race = (await pool.query<{ meta: any }>(
    `SELECT meta FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
    [userUuid, plan.race_id],
  ).catch(() => ({ rows: [] }))).rows[0];
  const raceDistanceMi = Number(race?.meta?.distanceMi);
  if (!Number.isFinite(raceDistanceMi)) return null;

  // 3. Plan workouts → per-week aggregation
  const wkRows = (await pool.query<{
    week_idx: number; start_iso: string; phase: string;
    weekly_mi: string; quality_sessions: string; long_run_mi: string;
  }>(
    `SELECT
       FLOOR((pw.date_iso - tp.start_date) / 7)::int AS week_idx,
       (tp.start_date + (FLOOR((pw.date_iso - tp.start_date) / 7) * 7))::text AS start_iso,
       COALESCE(pp.label, 'BUILD') AS phase,
       SUM(pw.distance_mi)::text AS weekly_mi,
       SUM(CASE WHEN pw.is_quality THEN 1 ELSE 0 END)::text AS quality_sessions,
       MAX(CASE WHEN pw.is_long THEN pw.distance_mi ELSE 0 END)::text AS long_run_mi
     FROM plan_workouts pw
     JOIN training_plans tp ON tp.id = pw.plan_id
     LEFT JOIN plan_phases pp ON pp.plan_id = pw.plan_id
       AND FLOOR((pw.date_iso - tp.start_date) / 7) BETWEEN pp.start_week_idx AND pp.end_week_idx
     WHERE tp.id = $1
     GROUP BY week_idx, tp.start_date, pp.label
     ORDER BY week_idx`,
    [plan.id],
  ).catch(() => ({ rows: [] }))).rows;
  if (wkRows.length === 0) return null;

  const weeks: SimulatorWeek[] = wkRows.map((w) => ({
    weekIdx: w.week_idx,
    startISO: w.start_iso,
    phase: w.phase,
    weeklyMi: Number(w.weekly_mi),
    qualitySessions: Number(w.quality_sessions),
    longRunMi: Number(w.long_run_mi),
  }));

  // 4. Start VDOT from latest projection snapshot — DB error returns null
  // (refuse to simulate rather than defaulting to VDOT 45 for a 55-VDOT runner).
  const snap = await pool.query<{ vdot: number | null }>(
    `SELECT vdot::float FROM projection_snapshots
      WHERE user_uuid = $1::uuid AND distance_mi = $2
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userUuid, raceDistanceMi],
  ).then(r => r.rows[0]).catch(() => null);
  const startVdot = snap?.vdot ?? null;
  if (startVdot == null) return null;

  // 5. Calibration · Phase 2.2 will replace this with loadRunnerCalibration
  const calibration = await loadRunnerCalibration(userUuid).catch(() => null);
  if (!calibration) return null;

  return simulate({
    weeks,
    startVdot,
    raceDistanceMi,
    calibration,
  });
}

/**
 * Phase 2.2 · runner-calibration loader. Reads runner_calibration
 * table (or cold-start defaults from experience_level).
 */
async function loadRunnerCalibration(userUuid: string): Promise<RunnerCalibrationLike> {
  const { loadRunnerCalibration: loader } = await import('@/lib/coach/runner-calibration');
  const cal = await loader(userUuid);
  return {
    vdotPerQuality: cal.vdotPerQuality,
    longRunWeight: cal.longRunWeight,
    recoveryMult: cal.recoveryMult,
    plateauVdot: cal.plateauVdot,
  };
}
