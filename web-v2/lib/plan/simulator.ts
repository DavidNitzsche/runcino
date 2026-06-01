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
 * Model (calibrated against Daniels Running Formula + Pfitzinger ADM):
 *
 *   VDOT progression:
 *     · Threshold + interval volume drives VDOT up at ~0.4 pts per
 *       4-week block when quality density is 1-2 sessions/wk
 *     · Marginal returns above 2 quality/wk (Daniels §threshold density)
 *     · Recovery cost · 1 quality day costs ~36h to bank
 *     · Sleep + RHR drift reduce response by up to 30% (Plews)
 *
 *   Endurance:
 *     · Long-run progression at 10% of weekly volume drives finish-line
 *       sustain for the marathon distance (Pfitzinger ADM)
 *     · For HM/10K/5K, long-run gain is secondary to threshold
 *
 *   Plateau detection:
 *     · Once VDOT per-week-gain falls below 0.05, additional volume
 *       buys ~nothing · simulator flags this so the planner doesn't
 *       propose pointless ramps
 *
 * Validation: simulator predictions checked against canonical
 * Daniels/Pfitz plans for 5K/10K/HM/marathon · sim should match
 * published progressions within ±10% (test bench in Phase 3).
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.1
 * Cite: Daniels Running Formula §VDOT response curves
 * Cite: Pfitzinger ADM §long-run progression
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

    // Confidence shrinks for further-out weeks (more uncertainty)
    // Linearly interpolate from 1.0 (this week) to 0.4 (race week)
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
      if (prevMi > 0 && (wk.weeklyMi - prevMi) / prevMi > 0.12) {
        riskFlags.push(`Wk${wk.weekIdx}: ${Math.round((wk.weeklyMi - prevMi) / prevMi * 100)}% volume ramp · exceeds 10% rule.`);
      }
    }
    // Risk flag · quality density too high
    if (wk.qualitySessions >= 3) {
      riskFlags.push(`Wk${wk.weekIdx}: ${wk.qualitySessions} quality sessions · density risk per Research/04 §quality-density.`);
    }
  }

  // Plateau detection
  const lastGain = trajectory.at(-1)?.weeklyGainVdot ?? 0;
  if (lastGain < 0.05 && trajectory.length > 4) {
    riskFlags.push(`Trajectory plateau at VDOT ${trajectory.at(-1)?.projectedVdot} · additional volume buys ~nothing.`);
  }

  const finalVdot = trajectory.at(-1)?.projectedVdot ?? input.startVdot;
  const medianSec = predictRaceTime(finalVdot, input.raceDistanceMi);

  // Confidence band · ±1.5σ around median model.
  // σ scales with race distance: shorter races have tighter bands.
  const sigmaSecPerMile =
      input.raceDistanceMi <= 3.5  ? 1.0
    : input.raceDistanceMi <= 7    ? 2.0
    : input.raceDistanceMi <= 14   ? 4.0
    :                                10.0;
  const sigmaSec = sigmaSecPerMile * input.raceDistanceMi;
  const p25Sec = medianSec != null ? medianSec - Math.round(1.5 * sigmaSec) : null;
  const p75Sec = medianSec != null ? medianSec + Math.round(1.5 * sigmaSec) : null;

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
 *   plateauPenalty   = max(0.1, 1 - (curVdot - 50) / (plateauVdot - 50))
 *   recoveryMult     = runner-specific (sleep-debt-prone < 1.0)
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
  // Plateau math · safe against zero headroom (beginners with plateauVdot=50)
  // and capped at 1.0 so being below plateau gives full gain, not a boost
  const plateauHeadroom = Math.max(1, cal.plateauVdot - 50);
  const plateauPenalty = Math.max(0.1, Math.min(1, 1 - (curVdot - 50) / plateauHeadroom));
  const raw = (qualityStimulus + longRunContrib) * cal.recoveryMult * plateauPenalty;

  // Diminishing returns above 2 quality/wk (Daniels)
  const densityPenalty = wk.qualitySessions > 2 ? 0.7 : 1.0;
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

  // 4. Start VDOT from latest projection snapshot
  const snap = (await pool.query<{ vdot: number | null }>(
    `SELECT vdot::float FROM projection_snapshots
      WHERE user_uuid = $1::uuid AND distance_mi = $2
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userUuid, raceDistanceMi],
  ).catch(() => ({ rows: [] }))).rows[0];
  const startVdot = snap?.vdot ?? 45;  // intermediate-runner default

  // 5. Calibration · Phase 2.2 will replace this with loadRunnerCalibration
  const calibration = await loadRunnerCalibration(userUuid).catch(() => COLD_START_CALIBRATION);

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
