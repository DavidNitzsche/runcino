/**
 * run-state.ts — load a single run by id for the drill-down view.
 *
 * Runs come from multiple sources (watch via HealthKit, manual entry,
 * Strava webhook). All share the `strava_activities` table (legacy name;
 * holds every run regardless of source). We read the canonical fields
 * the iOS sync + Strava webhook both write.
 */
import { pool } from '@/lib/db/pool';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, ALL_TIME } from '@/lib/runs/volume';
import { computeZones, judgeEasyRunHr, zoneIdxForBpm, type EasyHrVerdict } from '@/lib/training/zones';
import { resolveThresholdHr, type ThresholdHrMethod } from '@/lib/training/lthr';
import { baselineTempF } from '@/lib/weather/lookup';
import { weatherContext } from '@/lib/weather/heat-adjustment';
import { enrichOneActivity, WEATHER_VERSION_CURRENT } from '@/lib/weather/openmeteo';
import { computeAerobicDecoupling } from '@/lib/training/aerobic-decoupling';
import { computeCadenceFatigue } from '@/lib/training/cadence-fatigue';
import { deriveReadingScopes, type ReadingScopes } from './reading-scope';
import {
  classifySession,
  type WirePhaseVerdict,
  type PaceShape,
  type SessionClass,
} from '@/lib/training/execution-semantics';
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { computeShoeMileage } from '@/lib/shoe/mileage';
import { coerceShoeType, resolveShoeCapMi, type ShoeType } from '@/lib/shoe/lifespan';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';
import { adjustmentLabel as terrainAdjustmentLabel } from '@/lib/terrain/grade-adjust';
import {
  coalesceRunName,
  matchRaceForRun,
  normalizeDataWorkoutType,
  runStimulusType,
  type MergedTwin,
  type RaceForMatch,
} from '@/lib/runs/log-enrich';
import { runFacts } from '@/lib/runs/run-facts';
import { resolveActiveEnergy, watchActiveEnergyKcal } from '@/lib/runs/energy';
import { loadRunTwins, resolveElevationGain, resolveSplits } from '@/lib/runs/twins';
import { hrToNum } from '@/lib/runs/run-shape';
import { distanceMiFromLabel } from '@/lib/race/distance';
import {
  reconcileRun, reconcileSplitsTotal, reconcileHrZones,
  coherentPace, coherentMovingSec, coherentElapsedSec, runCadenceSpm,
} from '@/lib/runs/coherence';
import { runAvgHr, runMaxHr, type RunData } from '@/lib/runs/run-shape';
import { resolveCanonicalRunRowId } from '@/lib/runs/canonical-ref';
import { workAveragesFromPhases } from '@/lib/runs/work-averages';
import { resolveHrZoneShares } from './hr-zone-bucket';
import { zoneTargetsForWorkout } from '@/lib/coach/zone-target';
import { fmtPace as fmtPaceNoUnit, fmtClock } from '@/lib/format/run';
// THE one enum-to-word table. Imported, never restated — see `type_display`.
import { displayTypeFor } from '@/lib/faff/v5-today';

export interface RunSplit {
  mile: number;
  pace: string | null;            // "9:18"
  hr: number | null;
  cadence: number | null;
  elev_change_ft: number | null;
  /**
   * How much of a mile this split actually covers. 1 for a whole mile; a
   * fraction for the trailing piece.
   *
   * THE STORED SPLIT HAS ALWAYS CARRIED THIS AND THE NORMALIZER DROPPED IT.
   * A 4.11 mi run stores five splits and the fifth reads
   * `distanceMi: 0.111`; the wire flattened that to "mile 5" and every
   * surface downstream then had to guess the tail from the run total, or
   * silently draw a tenth of a mile with a whole mile's weight.
   *
   * Null when the source did not say, which is not the same as 1 — a
   * consumer must be able to tell "this is a whole mile" from "we were not
   * told", because only one of those licenses printing a distance.
   */
  distanceMi: number | null;
  /**
   * Phase classification for this mile · derived from the run's
   * structured phaseBreakdown when present. Null for runs without
   * phase data (free-form easy runs, manual entries, Strava-only
   * imports). When set, the UI can color-code MP-finish miles
   * distinctly from the warmup build.
   */
  phase: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | null;
}

/**
 * P44 — single phase of a structured workout, plan vs actual.
 * Populated from WatchCompletionPhase entries in coach_intents.
 */
export interface PhaseBreakdown {
  index: number;
  label: string;            // "Warmup" | "Rep 1/4" | "Recovery" | "Cooldown"
  type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown';
  // Plan
  target_pace: string | null;       // "6:48" formatted
  target_pace_sec: number | null;   // raw seconds/mi for bar math
  tolerance_pace_sec: number | null; // ±band in seconds/mi
  /**
   * PACE-SHAPE-1 (2026-09-01) · what `target_pace_sec` MEANS on this phase.
   * `'window'` — hold it, both sides. `'ceiling'` — do not go faster than it;
   * slower is never a miss. `'none'` / `'effort'` — not pace-graded at all.
   * Owned by `lib/training/execution-semantics.ts`; never re-derived by a
   * renderer.
   */
  pace_shape: PaceShape;
  /**
   * The word the runner reads for `status`, already correct for the shape.
   * A ceiling phase reads "Under the ceiling", never "Slower than target" and
   * never "missed" — that copy defect is half of what made a flawless
   * 2026-09-01 threshold session read as a failure. Null when nothing was
   * graded (Rule 11: absence is not a verdict).
   */
  status_label: string | null;
  target_distance_mi: number | null;
  target_duration_sec: number | null;
  // Actual
  actual_pace: string | null;
  actual_distance_mi: number | null;
  actual_duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  completed: boolean;
  // Derived: did the rep hit target? "on" / "fast" / "slow" / null
  status: 'on' | 'fast' | 'slow' | null;
  /**
   * THE WATCH'S OWN GRADE, passed through untouched.
   *
   * `status` above is the SERVER's read — heat-adjusted, recomputed here from
   * the two paces. `verdict` is what the device decided on the wrist against
   * the tolerance the server sent it, using the 5-second sample stream that
   * never leaves the watch (`WorkoutEngine.buildCompletion`):
   *
   *   hit        · the completed segment AVERAGE was in the window, or under
   *                the ceiling
   *   fast       · quicker than the fast edge, or past the ceiling
   *   slow       · slower than the slow edge. Never returned on a ceiling
   *                phase — slower than a ceiling is correct running
   *   incomplete · the phase ended before reaching its target
   *   drifted / missed · LEGACY, pre-2026-09-01 builds only. See
   *                `WirePhaseVerdict` in `lib/training/execution-semantics.ts`
   *
   * The two can still disagree, and both travel; neither overwrites the other.
   * They now disagree far less often, because both grade the segment average
   * and both route through the same owner — before 2026-09-01 `status` used a
   * ±10 s/mi band while this row shipped `tolerance_pace_sec: 8`, so the
   * colour and the number beside it were answering different questions.
   *
   * Null on every treadmill phase and on any phase with no target — absence
   * of recording, never a judgement.
   */
  verdict: WirePhaseVerdict | null;
  /** Seconds inside the pace band, as the device counted them. */
  time_in_tolerance_sec: number | null;
  /** Seconds outside it. `in + out` is the graded time, which is shorter than
   *  `actual_duration_sec` — the device grades only while it has a pace. */
  time_out_of_tolerance_sec: number | null;
}

/** Shoe entry surfaced inline on the run detail so the picker doesn't
 *  need a second round-trip on modal open. Shape mirrors GET /api/shoe. */
export interface RunDetailShoe {
  id: number;
  brand: string;
  model: string;
  color: string | null;
  color2: string | null;
  run_types: string[];
  mileage: number | null;
  mileage_cap: number | null;
  /** Category (lib/shoe/lifespan.ts ShoeType), always resolved. */
  shoe_type: ShoeType;
  /** THE retirement mileage this shoe is drawn against · runner's own cap when
   *  set, else doctrine's band for the category (Research/17-footwear.md). */
  retire_at_mi: number;
  retired: boolean;
  preferred: boolean;
  notes: string | null;
}

export interface RunForm {
  // Apple Watch form-metric set, cross-referenced from health_samples for
  // the run's date. Cadence here can override the activity's stale value.
  cadence_spm: number | null;
  ground_contact_ms: number | null;
  stride_length_m: number | null;
  vertical_oscillation_cm: number | null;
  vertical_ratio_pct: number | null;
  run_power_w: number | null;
  respiratory_rate: number | null;
  spo2_pct: number | null;
}

export interface RunDetail {
  id: string;
  date: string;
  start_local: string | null;
  name: string | null;
  source: 'watch' | 'apple_health' | 'manual' | 'strava' | string;
  type: string | null;            // 'easy', 'long', 'tempo', etc.
  /**
   * The runner-facing name for `type`, from `lib/faff/v5-today.ts`'s
   * `displayTypeFor` — the ONE table that maps a workout enum to a word.
   *
   * AN ENUM WAS REACHING THE GLASS. `type` is a column value, and the phone's
   * run detail title-cased it and drew it in the display register, so a
   * race-week tune-up headlined "RACE_WEEK_TUNEUP". Every other surface got
   * the right word because every other surface reads `/api/v5/today`, which
   * has been calling `displayTypeFor` all along; this payload never carried
   * it, so run detail had nothing to draw but the enum.
   *
   * The phone does NOT get its own copy of the switch. This file's own
   * zone-target note is the precedent: a copy of a table is a table that will
   * disagree with the original, and that one had already drifted.
   *
   * `planned_sub_label` wins when it is a NAME ("THRESHOLD", "FIELD TEST")
   * rather than a description, which is `displayTypeFor`'s own rule.
   */
  type_display: string | null;

  distance_mi: number;
  pace: string | null;            // formatted "9:18"
  pace_s_per_mi: number | null;   // raw seconds for derived calcs
  time_moving: string | null;     // formatted "54:29" or "1:54:29"
  time_elapsed: string | null;
  avg_speed_mph: number | null;

  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  elev_gain_ft: number | null;
  /**
   * Whether a real instrument measured that climb. False when the surviving
   * figure came from GPS altitude arithmetic or from our own recomputation.
   * Rule one: a consumer drawing `elev_gain_ft` with this false must carry
   * the modelled mark. Mirrors `elevGainMeasured` on the poster's wire.
   */
  elev_gain_measured: boolean;
  /** The instrument that won — `raw`, `treadmill_incline`, `gps_derived`. */
  elev_gain_source: string | null;
  /**
   * 2026-08-17 · terrain, from `lib/terrain/run-terrain.ts`.
   *
   * `pace_s_per_mi` above is and stays the REAL pace — distance over time,
   * what the runner ran, the only value any surface may render as "pace".
   * These fields are the separate, labelled effort read: what that pace was
   * worth on flat ground. A consumer that shows `grade_adjusted_pace_s_per_mi`
   * must show it beside the real pace and carry `terrain_label` with it.
   *
   * On a flat road run — the overwhelming majority — the adjusted pace equals
   * the real pace exactly, `terrain_label` is null, and nothing renders.
   */
  grade_adjusted_pace_s_per_mi: number | null;
  /** 'hill-adjusted' | 'descent-adjusted' | 'incline-adjusted', or null when
   *  the terrain did not move the read far enough to be worth showing. */
  terrain_label: string | null;
  /** Where the terrain numbers came from · see `TerrainBasis`. */
  terrain_basis: string;
  /** 'outdoor' | 'treadmill'. A treadmill is neither a hill nor a flat road. */
  terrain_surface: 'outdoor' | 'treadmill';
  temp_f: number | null;
  /**
   * Thermal arc for the run · the chip wants to show "65°F → 77°F" when
   * a long run rolled through real climb. Populated from data.weather
   * by the span-aware enrichment (lib/weather/openmeteo.ts). Null on
   * runs that landed before span enrichment shipped (legacy single-point
   * fetch) or runs without GPS · the chip falls back to temp_f.
   */
  temp_range_f: {
    start: number | null;
    end: number | null;
    peak: number | null;
    mean: number | null;
  } | null;
  /**
   * ACTIVE energy for the run, in kilocalories. The cost of the running, not
   * the cost of the hour.
   *
   * One quantity on every surface as of 2026-08-24. Strava's total-energy key
   * is TOTAL energy and is deliberately NOT a source here — see the header of
   * `lib/runs/energy.ts` for why it is refused rather than converted.
   *
   * Null when no tier can answer. A refusal is a correct answer.
   */
  calories_kcal: number | null;
  /** Which instrument produced `calories_kcal`. Null when it is null. */
  calories_source: 'watch' | 'healthkit' | 'estimate' | null;
  /**
   * False when `calories_kcal` came from the estimator. The surface must mark
   * it — a modelled number must never look measured.
   */
  calories_measured: boolean | null;
  /**
   * Post-run weather context. When the run was meaningfully hotter or
   * cooler than the runner's recent baseline, surfaces a one-line
   * explainer ("Temp 78°F vs your typical 60°F. HR ~8 bpm elevated
   * is expected.") + the estimated HR bump in bpm. Null when delta
   * isn't material (< 8°F) or temps aren't known.
   *
   * Cite: Research/06-weather-adjustments.md §1 Heat Adjustment.
   */
  weather_context: { message: string; hr_bump_bpm: number } | null;
  /** 2026-06-04 · duration-scaled Maughan heat slowdown % · no longer widens
   *  any pace-comparison band (that visual + the KEPT-IT-EASY heat-adjusted
   *  share were removed 2026-08-27 per David). Kept only because
   *  `heatAwareDrift` still uses it client-side to relabel a back-half HR
   *  rise as HEAT DRIFT instead of decoupling — an HR-confounder read, not
   *  a pace grade. 0 when conditions weren't material. */
  heat_slowdown_pct: number;
  /** A5 — GPS splits were flagged unreliable at ingest (splits-sum
   *  exceeded run duration by >5s due to HK pause-event gap). When
   *  true, MILE SPLITS should not be displayed and split-based
   *  heuristics (drift, fade) should not fire. */
  splits_unreliable?: boolean;
  /**
   * Whether the split rows below sum to THIS run's distance — the distance
   * verdict, beside `splits_unreliable`'s time verdict. They are different
   * questions and a run can fail either alone.
   *
   * Null when no split carries a distance to check. False on 26 production
   * rows, all of them carrying a trailing split whose `distanceMi` was a
   * duration in disguise (see `reconcileSplitsTotal`, and the note in
   * `HealthKitImporter.perMileSplits`).
   *
   * A surface that prints a per-mile table must print `splits_note` with it
   * when this is false. The rows are still worth showing — their paces and
   * heart rates were measured — but the table is not a decomposition of the
   * run, and saying nothing lets it read as one.
   */
  splits_cover_run?: boolean | null;
  /** One sentence for the runner when `splits_cover_run` is false. Null
   *  otherwise. Coach voice: states the discrepancy, does not scold. */
  splits_note?: string | null;
  suffer_score: number | null;
  kudos: number | null;
  // P2 #10 (2026-05-30): average running power from HealthKit for the
  // day this run lives on. health_samples.sample_type='run_power' is
  // already ingested. Watts; null when the user doesn't ship a power
  // signal (no Stryd, no Apple Watch running power, etc.).
  power_avg_w: number | null;
  /**
   * "How was today's HR vs your usual?" · the headline signal for the
   * "how it went" verdict. Compares today's avg HR against the runner's
   * last 4 same-effort runs at a similar pace (±10s/mi bucket). Positive
   * = HR ran hotter than typical (heat, dehydration, fatigue, illness).
   * Negative = HR ran cooler than typical (well-rested, cool day).
   * Null when we don't have enough comparable runs to draw a baseline.
   *
   * Rules:
   *   · Need this run to carry both pace + HR.
   *   · Comparison pool: last 4 canonical runs with same `type` AND pace
   *     within ±10 s/mi of today's pace (the "pace bucket").
   *   · Threshold: returns the bpm delta as an integer; consumers decide
   *     when to surface (e.g. |delta| ≥ 5 bpm is meaningful for steady
   *     efforts; intervals are too variable).
   */
  hr_on_pace_delta_bpm: number | null;

  // P32 — shoe assignment surfaced for the modal picker.
  shoe_id: number | null;
  // Audit 2026-05-27: shoe inventory embedded inline so RunDetailModal
  // can render the picker without a second round-trip to /api/shoe.
  // Filtered to non-retired entries (the picker rule) but the modal can
  // still display the assigned shoe by id regardless.
  shoes: RunDetailShoe[];
  // P42 — work-only averages excluding planned recovery/rest phases.
  // Returns null when no matching planned workout structure is available;
  // otherwise these are the "real" effort numbers minus the jog-in-between
  // dilution. Upgraded P44: when phase data exists in coach_intents,
  // computes weighted averages over WORK phases only (best signal). Falls
  // back to the "skip first + last split" heuristic when phase data is
  // missing but the planned workout type is a quality session.
  pace_work: string | null;
  pace_work_s_per_mi: number | null;
  hr_avg_work: number | null;
  cadence_avg_work: number | null;
  /**
   * 2026-08-24 · the scope every whole-run average on this run is allowed to
   * claim. Additive: a client that has never heard of it renders exactly as
   * before, which is why it ships alongside the raw fields rather than
   * replacing them.
   *
   * `readings.hr.scope === 'none'` is a REFUSAL, not a missing value. It means
   * this session has no interval over which an average heart rate would be
   * true (`Research/03` §14 · reps under two minutes), and a renderer must
   * draw no HR row rather than fall back to `hr_avg`.
   */
  readings: ReadingScopes;
  work_seconds: number | null;

  // P44 — phase-by-phase breakdown when the watch did the workout.
  // Populated from coach_intents.value.phases (WatchCompletion payload)
  // for Faff-watch runs. Empty for runs from other sources (Apple Watch
  // Workouts, Strava, manual) where we only have mile splits.
  phase_breakdown: PhaseBreakdown[];

  has_route: boolean;
  route_polyline: string | null;  // Strava-encoded polyline if available
  splits: RunSplit[];
  /**
   * ZONES-SUM-1 (2026-08-24) · NULLABLE. Null means this run has no zone
   * distribution we can stand behind — either nothing measured it, or the
   * stored one contradicts the row's own average heart rate and
   * `reconcileHrZones` refused it. Renderers must hide the chart, not draw
   * five empty bars: five zeros is a claim about where the runner's heart
   * spent an hour, and it is false. When non-null the five sum to 100.
   */
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  /** LTHR-anchored zone ranges. 2026-07-06 · P1-43 · `lthr` now resolves via
   *  resolveThresholdHr (stored profile.lthr → effective-maxHr crosswalk) so
   *  maxHr-only runners get personalized zones instead of nothing. `method`
   *  is additive — 'maxhr-crosswalk' means ESTIMATED · surfaces must label
   *  it, never present it as a tested threshold. */
  hr_zones_from_lthr: {
    lthr: number | null;
    method?: ThresholdHrMethod;
    /** ZONE-BANDS-1 · `lower` is null on the open-below zone 1 and `upper` is
     *  null on the open-above top zone. Consumers must render those as "< x"
     *  and "x +", and must not use a null bound as a chart axis. The web run
     *  detail's HR scale did exactly that with the old 0 and drew its axis
     *  from 0 bpm; a null makes its `??` fallback fire as intended. */
    ranges: { label: string; lower: number | null; upper: number | null }[];
  } | null;
  /** 2026-07-06 · P1-43 fix · server-computed easy-run HR read. The phone's
   *  AEROBIC STAMP panel was judging every runner's easy-run avg HR against
   *  a hardcoded LTHR of 162; this field carries the judgment against the
   *  runner's OWN threshold so every surface renders the same number.
   *  Non-null ONLY when (a) the run is an easy/recovery day, (b) avg HR
   *  exists, and (c) a real threshold resolved — when it's null the HR
   *  judgment is SKIPPED entirely (bare avg HR, no delta, no verdict).
   *  Never fabricated. Bands: judgeEasyRunHr (Friel · Research/03 §6),
   *  heat-shifted per Research/06 §1. */
  easy_hr_read: {
    avg_hr: number;
    threshold_bpm: number;
    threshold_method: ThresholdHrMethod;
    delta_bpm: number;          // avg_hr − threshold_bpm · negative = under
    easy_ceiling_bpm: number;   // Friel Z2 upper (0.89 × LTHR) + heat bump
    heat_bump_bpm: number;
    verdict: EasyHrVerdict;
  } | null;
  form: RunForm;                  // Apple Watch form metrics for that day
  /** Migration 120 · structured spec for the plan_workouts row matching
   *  this run's date (if any). Drives the WorkoutBreakdown component on
   *  /runs/[id]. null when no plan exists, no plan_workout matches the
   *  date, or the plan-builder authored this workout without a VDOT. */
  planned_spec: import('@/lib/faff/types').WorkoutSpec | null;
  /** The plan_workouts row's sub_label, mirrored so the page can compose
   *  the WorkoutBreakdown header (e.g. "WORKOUT · CRUISE INTERVALS"). */
  planned_sub_label: string | null;
  /** plan_workouts.distance_mi for the matching row; used as the "planned
   *  distance" axis when the spec ships rep-only structures. */
  planned_distance_mi: number | null;
  /**
   * The ACSM zone(s) the PLANNED session asked for, ascending. `[]` when
   * nothing was planned for the day, or when the planned type is one
   * doctrine does not assign a zone to.
   *
   * IT COMES FROM THE PRESCRIPTION, NEVER FROM WHERE THE TIME LANDED —
   * `plan_workouts.type` and `.distance_mi`, not this run's own `type` or
   * `distance_mi`. The zone bar exists to answer "did it sit where it was
   * asked to", and a target read off the outcome makes that question
   * unanswerable: the bar would agree with itself on every run.
   *
   * A set, not a number, because a race is not one zone — a half straddles
   * the 90% %HRmax edge and asks for Z4 AND Z5. See `lib/coach/zone-target.ts`
   * and the `ZONETARGET.race-zone-comes-from-the-race-hr-band` claim, which
   * re-derives the whole mapping out of Research/08 §6.1 × Research/03 §4 at
   * run time. This module is a CONSUMER of that table and must never restate
   * it — the phone used to carry its own copy of the switch and had already
   * drifted (it mapped `mp` and knew nothing of `race_week_tuneup`).
   */
  zoneTargets: number[];
  /** 8b · the decisions the runner took on the wrist mid-run, passed
   *  through from `runs.data` exactly as the watch recorded them.
   *
   *  Passed through, not interpreted. The phone owns the copy — the wire
   *  carries QUANTITIES so a wording change never touches the payload, and
   *  every record carries its own reason because a decision without one
   *  reads as a lapse. Absent (not null, not []) when there was no such
   *  decision, which is Rule 6: a re-POST that omits one must not clobber
   *  a sibling. */
  ceiling_lift: Record<string, unknown> | null;
  rep_skips: Array<Record<string, unknown>>;
  recovery_extensions: Array<Record<string, unknown>>;
  /** 2026-06-01 · Aerobic decoupling on long, steady-state runs. The
   *  pace-to-HR drift signal · Research/15 §cardiac decoupling. Joel  // TODO: no matching heading in Research/15 — content exists but heading not anchored
   *  Friel bands: <5% race-ready, 5-7% building, >7% poor. Null when
   *  the run is too short (<6mi) or wasn't steady-state (intervals,
   *  progression, race effort). Renderer shows a chip on the long-run
   *  detail card. */
  aerobic_decoupling: {
    drift_pct: number;
    verdict: 'race-ready' | 'building' | 'poor';
    h1_hr: number;
    h1_pace_sec: number;
    h2_hr: number;
    h2_pace_sec: number;
  } | null;
  /** 2026-06-01 · Cadence under fatigue · neuromuscular durability
   *  signal on long, steady-state runs. H2 vs H1 cadence delta.
   *  Research/16 §1-Running-Gait-Cycle. Null when run isn't long enough, splits  // was §form · heading: ## 1. The Running Gait Cycle
   *  missing cadence, or pace wasn't steady. */
  cadence_fatigue: {
    delta_spm: number;
    verdict: 'sustained' | 'fading' | 'breaking';
    h1_spm: number;
    h2_spm: number;
  } | null;
}

/**
 * What a split array actually adds up to, in miles, for `splits_note`.
 *
 * Reads the same distance-bearing keys as `reconcileSplitsTotal` so the
 * sentence quotes the number the verdict was reached on. Two spellings of
 * this sum would let the note disagree with the refusal that produced it.
 */
function fmtSplitSum(rows: unknown[]): string {
  let total = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const mi = Number(s.distanceMi ?? s.mi)
      || (Number(s.distance) ? Number(s.distance) / 1609.344 : 0);
    if (Number.isFinite(mi) && mi > 0) total += mi;
  }
  return `${total.toFixed(2)} mi`;
}

/**
 * MIGRATED 2026-08-24 · run detail's own pace and clock copies, both with
 * the split-before-round carry (`6:60`). They now name the shared module.
 * See `lib/format/run.ts`.
 */
const fmtPace = fmtPaceNoUnit;
const fmtDuration = fmtClock;

export async function loadRunDetail(userId: string, activityId: string): Promise<RunDetail | null> {
  // The id passed in is whatever the briefing surfaced — could be a real
  // run id, or a synthesized "YYYY-MM-DD-mi.mi" id (state-loader fallback
  // when the activity has no first-party id, e.g. watch-synced runs).
  //
  // 2026-06-02 · also pulling `id` (the runs PK) and `weather_enriched_at`
  // so we can lazy-enrich weather on first read of a freshly-synced run
  // instead of waiting on the nightly cron at 00:30 PT. Without this,
  // David's morning interval workout (synced same-day, before the cron
  // pass) rendered WEATHER as "·" all day.
  // 2026-09-02 · `id::text = $2` ADDED. The sibling route
  // `/api/runs/[id]/recap` has always matched the row primary key as well as
  // the two `data` spellings, and this one did not — so the SAME id string
  // returned a recap and a 404 for the detail beside it, and any caller
  // holding a PK (which is what `/api/v5/today` hands the phone as `runId`)
  // could open one and not the other. Two routes about one run disagreeing on
  // what names that run is Rule 16 at the identity layer, and the brief's
  // "make run-id the canonical identity" is the same ask.
  //
  // Verified against production 2026-09-02: 15 of this runner's 155 canonical
  // rows carry NEITHER `data.id` NOR `data.activityId`, and were reachable
  // only through the synthetic `YYYY-MM-DD-mi` fallback below.
  //
  // ── 2026-09-02 · CANONICAL-RUN SELECTION (Rule 14) ──────────────────────
  //
  // This lookup named the runner and never named the ROWS. 43% of the
  // reference runner's `runs` are merge losers and no loser id collides with
  // a canonical one, so every absorbed id resolved HERE, to the discarded
  // half of the merge — 0 splits and no HR on a long run whose canonical row
  // carries 13 splits and 159 bpm. The measurement, the five rungs and the
  // reason a bare canonical predicate would be the wrong fix all live
  // in `lib/runs/canonical-ref.ts`, which is now the ONE place that answers
  // "which row does this id mean" (Rule 14: one definition, not one per call
  // site — `/api/runs/[id]/recap` and the shoe PATCH had the same defect).
  //
  // 2026-09-03 · THE SYNTHETIC-ID FALLBACK THAT USED TO SIT BELOW IS GONE, into
  // the resolver as its rung 4. It was the second half of the same Rule 16
  // defect: this function knew the "YYYY-MM-DD-mi" spelling, the shoe PATCH
  // knew that one AND the trailing-date one, and the recap route knew neither,
  // so `<uuid>-2026-09-02` assigned a shoe successfully and 404'd here. One id,
  // three answers, chosen by which route you happened to call.
  const ref = await resolveCanonicalRunRowId(userId, activityId);
  const row = ref.ok ? (await pool.query(
    `SELECT id, data, shoe_id, weather_enriched_at FROM runs
      WHERE user_uuid = $1 AND id::text = $2
      LIMIT 1`,
    [userId, ref.rowId]
  )).rows[0] : undefined;

  if (!row) return null;
  const r = row.data;

  // 2026-06-02 · lazy weather enrichment. Two cases:
  //
  //   (a) MISSING · no data.weather and no weather_enriched_at · fresh
  //       run that hasn't been touched by the nightly cron yet.
  //
  //   (b) STALE-VERSION · data.weather present but version < CURRENT.
  //       The enrichment pipeline changed in a way that should invalidate
  //       the stored value · either lat/lng pick, time-zone normalization,
  //       or host selection moved. Stored data is from an older logic
  //       version, so clear + re-enrich. The version constant
  //       (WEATHER_VERSION_CURRENT in lib/weather/openmeteo.ts) is the
  //       single switch · bump it any time the pipeline changes.
  //
  // Guards on both paths:
  //   · row.id must be numeric · accepts NEGATIVE bigints from watch-
  //     direct + watch-ingest (-stableBigintFromString).
  //   · enrichOneActivity is idempotent on its own (short-circuits if
  //     data.weather already exists) so (a) is safe even on warm rows.
  // Failures swallowed silently; chip falls through to '·'.
  const isNumericId = row.id != null && /^-?\d+$/.test(String(row.id));
  const storedVersion = typeof r?.weather?.version === 'number' ? r.weather.version : 0;
  const isStaleVersion = Boolean(r?.weather) && storedVersion < WEATHER_VERSION_CURRENT;

  if (isNumericId && (
    (!r?.weather && !row.weather_enriched_at) ||
    isStaleVersion
  )) {
    try {
      if (isStaleVersion) {
        // Clear the stale row so enrichOneActivity doesn't short-circuit
        // on the existing data.weather. The fresh fetch will write back
        // with the current version stamp · the condition stops firing
        // for this row immediately after.
        await pool.query(
          `UPDATE runs
              SET data = (data - 'weather' - 'tempF'),
                  weather_enriched_at = NULL
            WHERE id = $1::BIGINT`,
          [String(row.id)],
        );
        delete (r as any).weather;
        delete (r as any).tempF;
      }
      const w = await enrichOneActivity(String(row.id));
      if (w) {
        // mutate in-memory so the rest of this function picks up the
        // freshly-fetched weather without another SELECT round-trip
        r.weather = w;
        if (w.temp_f != null && r.tempF == null) r.tempF = w.temp_f;
      }
    } catch {
      // surfaces in the cron's daily diagnostic; UI gracefully degrades
    }
  }
  // Coerce: bigint columns can come back as strings (see shoes mapping).
  const shoeId: number | null = row.shoe_id == null ? null : Number(row.shoe_id);

  // 2026-08-17 · RUNDETAIL-NAME-1 · the run log learned the run's real name and
  // the detail page never did.
  //
  // `loadRunDetail` passed `data.name` straight through from the canonical row.
  // After dedup that row is usually the WATCH's, whose name is 'Run'; the
  // Strava twin carrying "AFC Half" was merged away, and the absorb path only
  // copies fields the canonical LACKS — a canonical always has a name, so the
  // good one never lands. Tapping into a race therefore showed a 46pt "Run".
  //
  // `log-state.ts` already solved this for the log at read time. The rules live
  // in `lib/runs/log-enrich.ts` as pure functions precisely so a second surface
  // can apply them rather than re-derive them, so this reads the same two
  // inputs (merged twins, races) and calls the same two helpers. Nothing is
  // reimplemented here — a second copy of the name rules would be exactly the
  // fork class the sweep in this same pass went looking for.
  //
  // Both loads are best-effort: a failure returns the row's own name, which is
  // what this function did before.
  const runDisplayName = await (async (): Promise<string | null> => {
    const canonicalRowId = row.id != null ? String(row.id) : null;
    const runDate = String(r.date || (r.startLocal ?? '').slice(0, 10) || '').slice(0, 10);
    const distanceMi = Number(r.distanceMi) || 0;
    try {
      const [twinRows, raceRows] = await Promise.all([
        canonicalRowId == null ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> }) : pool.query(
          `SELECT data->>'name'        AS name,
                  data->>'source'      AS source,
                  data->>'workoutType' AS workout_type
             FROM runs
            WHERE user_uuid = $1
              AND data->>'mergedIntoId' = $2`,
          [userId, canonicalRowId],
        ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
        !runDate ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> }) : pool.query(
          `SELECT slug, meta FROM races
            WHERE user_uuid = $1 AND meta->>'date' LIKE $2 || '%'`,
          [userId, runDate],
        ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
      ]);

      const twins: MergedTwin[] = twinRows.rows.map((t) => ({
        name: (t.name as string | null) ?? null,
        source: (t.source as string | null) ?? null,
        workoutType: (t.workout_type as string | null) ?? null,
      }));

      // The same hint order log-state uses: the canonical row's own flag, then
      // any twin's (the Strava twin is the one that carries '1' = race).
      const workoutTypeHint = normalizeDataWorkoutType(r.workoutType)
        ?? twins.map((t) => normalizeDataWorkoutType(t.workoutType)).find((v) => v != null)
        ?? null;

      const racesForMatch: RaceForMatch[] = raceRows.rows.map((raw) => {
        const meta = (raw.meta ?? {}) as Record<string, unknown>;
        const explicit = meta.distanceMi != null ? Number(meta.distanceMi) : null;
        return {
          slug: String(raw.slug),
          name: meta.name != null ? String(meta.name) : null,
          date: meta.date != null ? String(meta.date).slice(0, 10) : null,
          distanceMi: explicit != null && isFinite(explicit) && explicit > 0
            ? explicit
            : distanceMiFromLabel((meta.distanceLabel as string | null) ?? null),
        };
      });

      const raceMatch = runDate
        ? matchRaceForRun({ date: runDate, distanceMi, workoutTypeHint }, racesForMatch)
        : null;
      // Race name > canonical non-generic > best twin non-generic. Identical
      // precedence to log-state.ts, because it is the same two calls.
      return raceMatch?.name ?? coalesceRunName(r.name ?? null, twins);
    } catch {
      return r.name ?? null;
    }
  })();

  // ── Pace and the clocks · reconciled, 2026-08-24 ────────────────────────
  //
  // TWO BUGS LIVED IN THE FIVE LINES THIS REPLACES, and together they are why
  // run detail printed `39:49` for David's 2026-08-23 run while the poster for
  // the same run printed `1:28:18`.
  //
  // 1 · `Number(r.duration_sec)` — THERE IS NO SUCH KEY. `r` is the run's own
  //     `data` blob, which spells it `durationSec`; `duration_sec` is a column
  //     on the unrelated plan-phase rows further down this file. Both rungs
  //     evaluated to NaN on every row ever, so the ladders were really
  //     `movingTimeS || null` and `elapsedTimeS || null`, and the watch's own
  //     total clock was never consulted. That is the run-shape.ts bug class: a
  //     literal nobody checks, resolving to a null indistinguishable from "not
  //     measured".
  //
  // 2 · Even with the key fixed, `movingTimeS` was 2389s against a 5298s
  //     clock — 54.9% of an eleven-mile run "paused" — because the merge
  //     absorbed Strava's moving time onto the watch's row without its
  //     matching clock. `elapsedTimeS` is no help: on all 29 watch rows and
  //     all 32 strava rows in production it is a byte copy of `movingTimeS`.
  //
  // The reconciler answers both. `movingSec` is null when the row disproves
  // it — deliberately not backfilled from the wall clock, because presenting
  // elapsed as moving is a different measurement wearing this one's name.
  const paceRead = coherentPace(r);
  const paceSPerMi = paceRead?.secPerMi ?? null;
  // `r.avgPaceMinPerMi` is no longer preferred either: it is the ELAPSED-clock
  // pace on 115 of 115 production rows while `paceSPerMi` is the MOVING one,
  // so preferring the string printed a different number here than the recap
  // printed for the same run.
  const pace = fmtPace(paceSPerMi) || null;

  const movingSec  = coherentMovingSec(r);
  const elapsedSec = coherentElapsedSec(r);

  // THE run distance, through the same reconciler as the clocks above, so
  // the number the splits are checked against is the number in the heading.
  const distanceMi = reconcileRun(r).distanceMi;

  // Splits — normalize various source shapes. Per-split `phase` tag is
  // filled in after phaseBreakdown loads (a few lines down) · null here
  // because we don't know yet, and a later pass walks the splits + phase
  // cumulative-distance map to attach the right tag per mile.
  /* ── THE ABSORBED TWINS ───────────────────────────────────────────────
   *
   * Loaded once, here, because two of the figures below are better on a row
   * this one absorbed than on this one. See `lib/runs/twins.ts` for the
   * argument; the short version is that the dedup picks the best row OVERALL
   * and that is not the best row for every FIELD.
   *
   * `null` means the read FAILED and is not the same as "no twins". The
   * elevation resolver refuses on null rather than letting the canonical
   * row's weaker instrument win by default. */
  const twins = await loadRunTwins(row.id);

  /** The climb, ranked by instrument across this row and every twin. */
  const elevationReading = resolveElevationGain({
    elevGainFt: Number(r.elevGainFt) || null,
    elevGainSource: (r.elevGainSource as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    splits: null,
    distanceMi: null,
  }, twins);

  /* ── WHICH SPLIT ARRAY DECOMPOSES THIS RUN · 2026-08-24 ────────────────
   *
   * `r.splits` stood here, which is the canonical row's array and routinely
   * not the best one. 2026-08-24, a 4.02-mile run:
   *
   *     canonical (watch)        3 splits, 3.00 mi
   *     twin      (apple_watch)  5 splits, 4.11 mi, with cadence and
   *                              per-mile elevation the canonical lacks
   *
   * A quarter of the run had no split and the last mile he ran was missing
   * entirely — the mile at 158 bpm, squarely Z4. True of 26 of the 71 merged
   * runs here. The poster already asked `pickSplits`; run detail did not, so
   * the phone's post-run screen and the run's own detail page drew different
   * breakdowns of the same run.
   *
   * The trailing-stub arithmetic below still runs, on whichever array wins.
   * The two questions are different and both are needed: `pickSplits` asks
   * WHICH INSTRUMENT decomposed the run, `reconcileSplitsTotal` asks whether
   * the array it chose has a fabricated tail on the end. */
  const splitChoice = resolveSplits({
    elevGainFt: null, elevGainSource: null,
    source: (r.source as string | null) ?? null,
    splits: Array.isArray(r.splits) ? (r.splits as any[]) : null,
    distanceMi,
  }, twins);
  const rawSplits: any[] = (splitChoice?.splits as any[]) ?? [];

  /* ── does this array decompose THIS run? ──────────────────────────────
   *
   * `HealthKitImporter` appends a trailing split for the stretch between
   * GPS stopping and the watch timer stopping. Until 2026-08-24 its
   * `distanceMi` was `tailSecs / avgPace` — a duration in a distance field,
   * reverse-engineered to zero out a server time-check that no longer
   * exists. On a run with a long pause the fabricated tail is LARGE: the
   * 2026-08-23 row's is 0.88 mi, and on 2026-06-04 and 2026-07-07 it is
   * over a full mile.
   *
   * The filter that used to stand here kept any trailing split of 0.5 mi or
   * more, on the reasoning that a real stub is "~0.047mi". Every fabricated
   * tail clears that bar, so all of them survived and rendered as an extra
   * mile at the run's average pace. 2026-08-23 drew TWELVE mile rows for an
   * eleven-mile run.
   *
   * A size threshold cannot tell a measured remainder from a manufactured
   * one. Arithmetic can: a decomposition of this run sums to this run.
   * `reconcileSplitsTotal` is the one place that question is answered, and
   * asking it twice — with the trailing split and without — says which of
   * the two arrays is the real decomposition, with no threshold at all. */
  const coversWithTail = reconcileSplitsTotal({ splits: rawSplits }, distanceMi);
  const withoutTail = rawSplits.slice(0, -1);
  const coversWithoutTail = rawSplits.length > 1
    ? reconcileSplitsTotal({ splits: withoutTail }, distanceMi)
    : null;

  // Drop the trailing split only when dropping it is what makes the array
  // add up. Never when the array already adds up, and never as a guess.
  const usableSplits: any[] = (coversWithTail === false && coversWithoutTail === true)
    ? withoutTail
    : rawSplits;

  /**
   * True when what run detail is about to draw sums to the run it sits
   * under. False when it does not, and the surface must say so — see
   * `splits_note`. Null when no split carries a distance to check.
   */
  const splitsCoverRun = reconcileSplitsTotal({ splits: usableSplits }, distanceMi);

  const splitsRaw: RunSplit[] = usableSplits
    .map((s: any, i: number) => {
    // Resolve seconds-per-mile across every source shape we see:
    //   · paceSPerMi    (legacy)
    //   · paceSecPerMi  (watch / iPhone HK numeric)
    //   · pace_s_per_mi (snake-case variant)
    //   · average_speed (Strava splits_standard · m/s → sec/mi)
    //   · elapsed_time + distance (Strava fallback when avgSpeed absent)
    // Without this, Strava-synced runs render `· /mi` on every split
    // (David: "why still no mile splits/times here") because the
    // normalizer only checked the camelCase paceSPerMi key.
    const avgSpeedMps = Number(s.average_speed) || null;
    const elapsedS = Number(s.elapsed_time ?? s.moving_time) || null;
    const distM = Number(s.distance) || null;
    const sPerMiFromSpeed = avgSpeedMps && avgSpeedMps > 0 ? Math.round(1609.34 / avgSpeedMps) : null;
    const sPerMiFromElapsed = (elapsedS && elapsedS > 0 && distM && distM > 0)
      ? Math.round((elapsedS * 1609.34) / distM)
      : null;
    const sPerMi = Number(s.paceSPerMi)
      || Number(s.paceSecPerMi)
      || (s.pace_s_per_mi ?? null)
      || sPerMiFromSpeed
      || sPerMiFromElapsed
      || null;
    // Strava splits use `split` (1-indexed) for the mile number; iPhone
    // HK uses `mile`.  Both fall back to the array index + 1.
    return {
      mile: Number(s.mile ?? s.split ?? s.index ?? i + 1) || (i + 1),
      pace: s.pace ?? s.pace_min_per_mi ?? fmtPace(sPerMi) ?? null,
      hr: Number(s.hr ?? s.avgHr ?? s.average_heartrate) || null,
      cadence: Number(s.cadence ?? s.avgCadence ?? s.average_cadence) || null,
      // 2026-05-31: also accept `elev_ft` · iPhone HK importer + Faff
      // watch app post per-mile splits keyed `elev_ft` (semantically the
      // mile-end minus mile-start altitude delta, NOT an absolute). Without
      // this fallback the read-time elev sanity check below saw all-zero
      // splits and bailed back to the raw 4684 ft on watch-source rows.
      elev_change_ft: Number(s.elev_change_ft ?? s.elevChangeFt ?? s.elev_ft) || null,
      // Carried, not derived. `|| null` would turn a legitimately tiny
      // trailing split into "we were not told", so the guard is an explicit
      // finite-and-positive test.
      distanceMi: (() => {
        const d = Number(s.distanceMi ?? s.distance_mi ?? s.mi);
        return isFinite(d) && d > 0 ? d : null;
      })(),
      phase: null,
    };
  });
  // 2026-06-04 · defensive cleanup for legacy stub splits.  Old watch
  // ingests wrote `splits: [{mi:1, ...whole-run-stats}]` · a single
  // entry that semantically is the whole-run summary, not a per-mile
  // breakdown.  The canonical-merge absorber treats arrays of length 1
  // as "present" and skips overwriting from the HK loser's real splits
  // · so existing legacy rows never get fixed automatically.
  //
  // 2026-06-05 · tightened.  Originally we keyed off `!splits[0].pace`
  // (the watch stub had paceSecPerMi but no formatted pace), but after
  // I taught the normalizer above to translate paceSecPerMi → pace, the
  // stub started rendering as if it were a real per-mile split (mile 1,
  // 8:21/mi for a 6-mile run). The truth is simpler: a SINGLE split on
  // a multi-mile run is ALWAYS a phase-summary stub · per-mile splits
  // would have N entries for N miles.  So drop length===1 splits on
  // any run over 1.5mi regardless of pace shape.  The frontend then
  // shows "No mile splits available" until the absorber rebuilds the
  // canonical with HK's real splits (or a backfill endpoint forces it).
  const totalDistMi = distanceMi ?? 0;
  const splits: RunSplit[] = (
    splitsRaw.length === 1
    && totalDistMi > 1.5
  ) ? [] : splitsRaw;

  // HR zone percentages — stored or computed from splits if missing.
  //
  // 2026-05-31: treat an all-zero hrZonePcts as MISSING data and fall
  // through to deriveHrZones. Strava (and the Watch sync path) often
  // persists a placeholder `{z1:0,...,z5:0}` when the activity has HR
  // but no per-zone breakdown was computed at write-time. Without this
  // check, the post-run hero's Z1-Z5 bar reads empty on completed runs
  // that DO have avg+max+per-mile HR (David's Tue tempo: 156/172 avg/pk).
  //
  // ZONES-SUM-1 (2026-08-24) · THE TWO SURFACES DISAGREED ABOUT WHAT COUNTS.
  //
  // The gate here was `sum > 0`, hand-rolled. `/api/v5/today` asks
  // `reconcileHrZones`, which requires the five to sum to 100 ± 2. So a stored
  // distribution summing to, say, 60 was drawn as a chart on web run detail
  // and refused on the phone — one row, two answers, which is the whole shape
  // `lib/runs/coherence.ts` exists to end. Both ask the reconciler now.
  //
  // A refusal still falls through to re-deriving from the samples, which is
  // the right order: the STORED value is what is disproved, not the run.
  //
  // ANCHOR-STALE-1 (2026-08-30) · THE ORDER IS NOW THE OTHER WAY ROUND, and
  // the anchor is resolved ONCE for both the bar and the ranges beside it.
  //
  // Taking the stored value first made it permanent: `reconcileHrZones` asks
  // whether five numbers are a distribution, never which ANCHOR produced
  // them, so a distribution bucketed at a threshold the runner no longer has
  // passed the guard and won. Re-deriving the anchor therefore could not
  // reach history — the owner's 2026-08-30 long run kept reading 60% Zone 5
  // for an easy day. `resolveHrZoneShares` puts the recompute first and
  // leaves the stored value as the last rung; see its doc comment for the
  // precedence and the one trade it makes.
  //
  // The threshold resolution moved ABOVE this block for the same reason the
  // two are now one call: the bar used to be bucketed against a RAW
  // `profile.lthr` read inside `deriveHrZones`, while the ranges panel drawn
  // next to it used `resolveThresholdHr`. For a runner with no stored LTHR
  // those are different anchors — the crosswalk resolves, the raw read does
  // not — so one screen could draw its bands at one threshold and colour its
  // bar at another, or draw the bands and no bar at all. One anchor now.
  //
  // 2026-07-06 · P1-43 · resolveThresholdHr = stored profile.lthr →
  // effective-maxHr §11 crosswalk. maxHr-only runners get personalized zones;
  // `method` lets surfaces label crosswalk-derived numbers as estimated.
  // Still null at true cold start — never fabricated.
  const thresholdHr = await resolveThresholdHr(userId).catch(() => null);
  const zoneTable = thresholdHr ? computeZones({ lthr: thresholdHr.bpm }) : null;

  const hrPctsRaw = r.hrZonePcts ?? r.hr_zones ?? null;
  const hrZonePcts = resolveHrZoneShares({
    phases: r.phases,
    rawSplits: r.splits,
    splits,
    storedPcts: reconcileHrZones({ ...r, hrZonePcts: hrPctsRaw } as never),
    table: zoneTable,
  });

  // Bring the user's LTHR-anchored zone ranges so the modal can render
  // an actionable "where your HR landed" panel.
  const hr_zones_from_lthr = (zoneTable && thresholdHr) ? {
    lthr: thresholdHr.bpm,
    method: thresholdHr.method,
    ranges: zoneTable.zones.map((z) => ({ label: z.shortLabel, lower: z.lower, upper: z.upper })),
  } : null;

  // Cross-reference health_samples for the day to enrich form metrics.
  // Watch runs ship lean payloads; HealthKit holds cadence, ground contact,
  // vertical oscillation/ratio, stride length, run power, etc.
  const day = r.date || (r.startLocal ?? '').slice(0, 10);
  const form = await loadFormMetrics(userId, day);

  // Active energy. ONE quantity, resolved by the shared ladder in
  // lib/runs/energy.ts — the watch's own measurement, else a marked estimate.
  //
  // Strava's total-energy key used to sit above both, and it is TOTAL energy:
  // on 2026-08-16 this field printed Strava's 2202 beside a measured 1807 for
  // the same effort. The owner ruled active-energy-everywhere on 2026-08-24
  // and the resolver now takes no total argument at all.
  //
  // The HealthKit-window tier that used to sit between them is gone too, and
  // that one was not a product call: `health_samples` can hold one
  // active_energy row per DAY and stamps it with the ingest time, so the tier
  // matched nothing on all 106 rows that reached it and would have credited a
  // whole day's energy to one run if a sync had ever landed mid-run. The
  // argument is at the top of lib/runs/energy.ts.
  const activeEnergy = await resolveActiveEnergy(userId, {
    watchActiveKcal: watchActiveEnergyKcal(r),
    distanceMi: reconcileRun(r).distanceMi ?? 0,
    // RUNSTATE-HR-1 (2026-08-30) · same fix as line 1185's hr_avg: `runAvgHr`
    // rounds to whole bpm and refuses a sensor artefact a raw Number() cast
    // would pass through as a heart rate. `|| null` also silently drops a
    // real 0, which `runAvgHr`/`hrToNum` do not.
    avgHr: runAvgHr(r as unknown as RunData),
  });

  // "How was today's HR vs your usual?" · compare today's avg HR at this
  // pace bucket against the runner's last 4 same-effort runs. The
  // headline signal for the "how it went" verdict, and the one that
  // separates a heat day ("HR up 9, conditions explain it") from a
  // training-load problem.
  const hrOnPaceDelta = await computeHrOnPaceDelta({
    userId,
    runIdToExclude: String(r.id ?? activityId),
    type: (r.type as string | null) ?? null,
    workoutType: (r.workoutType as string | number | null) ?? null,
    // RUNSTATE-HR-1 (2026-08-30) · this used to read `r.paceSPerMi` and
    // `r.avgHr` straight off the row, SHADOWING the already-reconciled
    // `paceSPerMi` local this same function computed forty lines up — the
    // comment right above it (2026-08-23's "the recap said 3:37/mi" incident)
    // is the reason that local exists at all. A run whose stored pace the
    // reconciler REFUSED (paceRead null, ~1/256 rows) still bucketed correctly
    // before this fix, because the SQL candidate pool also matches on raw
    // stored paceSPerMi — so the practical exposure was narrower than "every
    // HR-vs-pace callout is wrong," but it was real on every row where the
    // reconciler's answer differs from the stored one: the "HR vs usual"
    // verdict on THIS run bucketed against a number the rest of run-detail on
    // the same page was not using.
    paceSPerMi,
    avgHr: runAvgHr(r as unknown as RunData),
  });

  // Post-run weather context. When the run's tempF is known and the
  // runner has a 14-day baseline at this lat/lon, surface a one-line
  // "hotter than normal" / "cooler than normal" explainer + HR bump.
  // Cite Research/06-weather-adjustments.md §1.
  const actualTempF = Number(r.tempF) || null;
  const startLat = Number(r.startLat ?? r.start_latitude);
  const startLng = Number(r.startLng ?? r.start_longitude);
  let weatherCtx: { message: string; hr_bump_bpm: number } | null = null;
  if (actualTempF != null && day && isFinite(startLat) && isFinite(startLng)) {
    const baseline = await baselineTempF(startLat, startLng, day).catch(() => null);
    const ctx = weatherContext({ actualTempF, baselineTempF: baseline });
    if (ctx) weatherCtx = { message: ctx.message, hr_bump_bpm: ctx.hrBumpBpm };
  }

  // P44 — phase-by-phase breakdown from watch completion payload, when
  // a Faff-watch run for this date exists in coach_intents. Returns
  // empty array for non-watch runs (Apple Watch Workouts, Strava, manual)
  // where we don't have the planned phase structure.
  //
  // heatSlowdownPct no longer widens the phase-status tolerance band (see
  // heatAdjustedStatus in heat-band.ts) — still computed because
  // heat_slowdown_pct travels to the client for heatAwareDrift's HR-rise
  // relabel, a different, in-scope purpose (explains HR, not pace).
  const heatSlowdownPct = await computeHeatSlowdownForRun(r).catch(() => 0);
  // Heat HR-elevation used ONLY to explain an elevated easy-run HR
  // (easy_hr_read below), never to adjust a displayed pace or effort
  // share. Prefer the baseline-relative bump (weatherCtx) when present,
  // else derive from absolute temp vs a ~60°F thermoneutral reference —
  // the cited Maughan rule (~1 bpm/°F above 60°F, capped 10 ·
  // Research/06-weather-adjustments.md §1). Watch rows are polyline-only
  // (no flat startLat/startLng), so weatherCtx is usually null and the
  // absolute-temp path is what actually carries this.
  const heatBumpRawBpm = (weatherCtx && weatherCtx.hr_bump_bpm > 0)
    ? weatherCtx.hr_bump_bpm
    : (actualTempF != null ? Math.max(0, Math.min(10, Math.round(actualTempF - 60))) : 0);
  const heatBumpBpm = heatSlowdownPct >= 6 ? heatBumpRawBpm : 0;

  const plannedRow = day
    ? (await pool.query(
        `SELECT pw.workout_spec, pw.sub_label, pw.distance_mi, pw.type
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND pw.date_iso = $2
          LIMIT 1`,
        [userId, day],
      ).catch(() => ({ rows: [] as any[] }))).rows[0]
    : null;
  // VERDICT-1 (2026-09-01) · the phase breakdown is graded as THE session the
  // plan row says it was. This call used to pass no class, so on every
  // completion recorded before the wire carried `tolerancePaceSPerMi` a work
  // phase fell through to the unnamed-session width (30 s/mi) and the
  // owner's 419-against-430 fourth rep read "On target" here while every
  // other surface said "Quicker than target". One class, resolved once.
  const phaseBreakdown = await loadPhaseBreakdown(
    userId, day, heatSlowdownPct,
    classifySession(String(plannedRow?.type ?? r.workoutType ?? ''), plannedRow?.workout_spec ?? null),
    // The same plan row the class comes from. See `mapWatchPhases`.
    Number((plannedRow?.workout_spec as Record<string, unknown> | null | undefined)?.strides_reps ?? 0) || 0,
    // SIMROW-1 · this run's own completion, by name.
    (typeof (r as any).watchCompletionRef === 'string' && (r as any).watchCompletionRef)
      || (typeof (r as any).client_workout_id === 'string' && (r as any).client_workout_id)
      || null,
  );

  // Per-split phase tagging · walks the phaseBreakdown's cumulative
  // distance map and assigns each mile's phase. The renderer uses this
  // to color-code MP-finish miles distinctly from the warmup build
  // (e.g. David's long: miles 1-8 = work, mile 9-11 = work@MP, mile 12 =
  // cooldown). When phaseBreakdown is empty (Strava-only / apple_watch
  // runs), every split keeps `phase: null` and the renderer falls back
  // to the run's overall effort color.
  tagSplitsWithPhases(splits, phaseBreakdown);

  // P42 + P45 — work-only averages (excluding planned recovery/rest phases).
  // Tries phase data first (best signal from the WatchCompletion payload),
  // then falls back to the splits-based heuristic. Returns nulls when no
  // structure exists or when the run is a plain easy/long run (nothing to
  // exclude).
  const workAvgs = await computeWorkAverages(userId, day, splits, phaseBreakdown);

  // Migration 120 (2026-05-28) — pull the matching plan_workouts row's
  // structured spec so /runs/[id] can render the proper WorkoutBreakdown
  // (plan-vs-actual surface). Selection: active plan + this run's date.
  // Skipped silently when no plan or no matching workout — page falls
  // back to the placeholder card.
  const planned_spec = plannedRow?.workout_spec ?? null;
  const planned_sub_label = plannedRow?.sub_label ?? null;
  const planned_distance_mi = plannedRow?.distance_mi != null
    ? Number(plannedRow.distance_mi)
    : null;
  // The prescribed zone(s) for the day, from the plan row above — the same
  // `zoneTargetsForWorkout` call `/api/v5/today` makes, off the same two
  // columns, so the two screens cannot disagree about what was asked. The
  // race branch reads the planned distance because doctrine's answer depends
  // on it (5K/10K → Z5, half → Z4+Z5, marathon → Z4).
  const zoneTargets = zoneTargetsForWorkout(plannedRow?.type ?? null, planned_distance_mi);

  // 2026-07-06 · P1-43 fix · server-side easy-run HR read against the
  // runner's OWN threshold (resolveThresholdHr above · stored LTHR or
  // effective-maxHr crosswalk). Replaces the phone panel's hardcoded
  // LTHR 162. Day gate: the run's own type when it carries a coach type;
  // most Strava-source rows carry type 'Run' (verified live 2026-07-06),
  // so those fall back to the PLANNED day's type — a 'Run' on a planned
  // easy day is an easy run. Unplanned generic rows stay null (unknown
  // intent · don't judge a fartlek as a failed easy run). Per-finding
  // context filter: the heat bump resolves on THIS observation (same
  // HOT-run gate `heatBumpBpm` above uses). Null → the judgment is skipped
  // entirely — no verdict beats a wrong constant.
  const easy_hr_read = (() => {
    const runType = String(r.type ?? '').toLowerCase();
    const QUALITY_TYPES = new Set([
      'tempo', 'threshold', 'interval', 'intervals', 'race', 'long',
      'fartlek', 'progression', 'race_week_tuneup', 'workout', 'mp',
    ]);
    let isEasyDay: boolean;
    if (runType === 'easy' || runType === 'recovery') {
      isEasyDay = true;
    } else if (QUALITY_TYPES.has(runType)) {
      isEasyDay = false;
    } else {
      const plannedType = String(plannedRow?.type ?? '').toLowerCase();
      isEasyDay = plannedType === 'easy' || plannedType === 'recovery';
    }
    if (!isEasyDay) return null;
    const avgHr = Number(r.avgHr) || null;
    if (avgHr == null || thresholdHr == null) return null;
    const judged = judgeEasyRunHr({
      avgHrBpm: avgHr,
      thresholdBpm: thresholdHr.bpm,
      heatBumpBpm,
    });
    if (!judged) return null;
    return {
      avg_hr: Math.round(avgHr),
      threshold_bpm: thresholdHr.bpm,
      threshold_method: thresholdHr.method,
      delta_bpm: judged.deltaBpm,
      easy_ceiling_bpm: judged.easyCeilingBpm,
      heat_bump_bpm: heatBumpBpm,
      verdict: judged.verdict,
    };
  })();

  // Inline shoe inventory — same shape as GET /api/shoe but bundled here
  // so the modal opens with no second round-trip. Mileage is computed
  // ON READ from canonical runs (lib/shoe/mileage.ts), not the stale
  // stored column; sort by the live value afterward.
  const [shoesRaw, shoeMiles] = await Promise.all([
    pool.query(
      `SELECT id, brand, model, color, color2, run_types,
              mileage_cap::numeric AS mileage_cap,
              -- shoe_type read via to_jsonb so this query works whether or
              -- not migration 151 has been applied yet (it returns NULL for a
              -- column that does not exist, and NULL reads as the default
              -- category). Migrations here are applied by hand, so a query
              -- naming the column directly would 500 every read between the
              -- code deploy and the ALTER.
              to_jsonb(shoes.*) ->> 'shoe_type' AS shoe_type,
              COALESCE(retired, false) AS retired,
              COALESCE(preferred, false) AS preferred,
              notes
         FROM shoes
        WHERE user_uuid = $1
          AND COALESCE(retired, false) = false`,
      [userId]
    ).then((r) => r.rows).catch(() => [] as any[]),
    computeShoeMileage(userId),
  ]);
  const shoes: RunDetailShoe[] = shoesRaw
    .map((s: any) => ({ s, mi: shoeMiles.get(Number(s.id)) ?? 0 }))
    .sort((a, b) =>
      (b.s.preferred === a.s.preferred ? 0 : b.s.preferred ? 1 : -1) || b.mi - a.mi)
    .map(({ s, mi }) => ({
      // 2026-05-27: coerce id to number. node-postgres returns bigint
      // columns as strings by default, but RunDetailShoe.id is typed
      // as number and the ShoePicker uses strict `value === s.id` to
      // know which row is selected — string vs number broke the
      // post-save selection display ("assigned shoes are not saving").
      id: Number(s.id),
      brand: s.brand,
      model: s.model,
      color: s.color,
      color2: s.color2,
      run_types: s.run_types ?? [],
      mileage: mi,
      mileage_cap: s.mileage_cap == null ? null : Number(s.mileage_cap),
      shoe_type: coerceShoeType(s.shoe_type),
      retire_at_mi: resolveShoeCapMi(s.shoe_type, s.mileage_cap),
      retired: Boolean(s.retired),
      preferred: Boolean(s.preferred),
      notes: s.notes,
    }));

  return {
    id: r.id ?? r.activityId ?? activityId,
    date: day,
    start_local: r.startLocal ?? null,
    // RUNDETAIL-NAME-1 · twin-coalesced, race-matched (see the block above).
    name: runDisplayName,
    source: r.source ?? 'strava',
    type: r.type ?? null,
    // The plan's type where there is a plan row, else the run's own. A run
    // logged off-plan still has a kind, and naming it from the run is the
    // only source there is.
    type_display: displayTypeFor(plannedRow?.type ?? r.type ?? null, planned_sub_label),

    // Same set as `pace` and `time_moving` above, so the three agree.
    distance_mi: reconcileRun(r).distanceMi ?? 0,
    pace, pace_s_per_mi: paceSPerMi,
    // ─────────────────────────────────────────────────────────────────
    // THE SECONDS ARE THE FACT; THE STRING IS SOMEONE ELSE'S FORMATTING
    //
    // `r.timeMoving` is a pre-formatted string stored on the row, and some of
    // them were written by a formatter that never handled hours — a 1h42m
    // half marathon came back as "102:33". Taking the stored string FIRST
    // meant no amount of fixing fmtDuration could help.
    //
    // So the number wins whenever there is one, and the stored string is the
    // fallback for rows that carry no seconds at all.
    time_moving:  fmtDuration(movingSec) || r.timeMoving || null,
    time_elapsed: fmtDuration(elapsedSec) || r.timeElapsed || null,
    avg_speed_mph: Number(r.avgSpeedMph) || null,

    // THE SAME PAIR THE POST-RUN CARD READS. `Number(r.avgHr) || null` is
    // unbounded, so a sensor artefact — a 0, a 4 — passed through as a heart
    // rate, and `||` swallowed a legitimate 0 anyway. `runAvgHr`/`runMaxHr`
    // bound to a physiologically possible range and are what
    // `app/api/v5/today/route.ts` now uses, so run detail and the post-run
    // card cannot print two different heart rates for one run.
    hr_avg: runAvgHr(r as unknown as RunData),
    hr_max: runMaxHr(r as unknown as RunData),
    // Prefer activity-supplied cadence; fall back to the day's HealthKit
    // cadence. Resolved to BOTH FEET first: `avgCadence` is Strava's per-leg
    // count on the 57 pre-May-2026 imports, and run detail printed it as a
    // step rate. `cadence.units-split` in lib/runs/derived-registry.ts.
    cadence_avg: runCadenceSpm(r)?.spm ?? form.cadence_spm,
    // 2026-05-31: barometric-drift sanity check on Strava's rolled-up
    // elev_gain_ft. Barometric watches occasionally report 5-10x the
    // real gain when ambient pressure swings during a run (humidity,
    // weather front, indoor-to-outdoor transition · David's 12.1mi
    // long run came back at 4684 ft / 387 ft/mi · mountain territory
    // on a suburban route). When the raw ratio exceeds 250 ft/mi
    // (Research/12 cap for credible urban / trail runs) AND we have
    // per-mile splits with their own elev deltas, swap the raw value
    // for sum-of-positive-deltas from splits. The splits sum is a
    // lower bound (it misses in-mile climbs that net to zero) but a
    // credible one · always better than a fictional number.
    /* ── THE CLIMB · ONE READER, 2026-08-24 ──────────────────────────────
     *
     * What stood here was a 250 ft/mi drift heuristic that recomputed the
     * climb from the splits' own deltas. It was a reasonable guess and it
     * was this surface's PRIVATE guess — the log read `data.elevGainFt`
     * raw, and the poster asked `pickElevationGain`. One run, three
     * readers, three numbers:
     *
     *     2026-08-23 · 11.01 mi
     *       row          3195 ft  (source `watch`, an untrusted instrument)
     *       log          3195 ft
     *       run detail     57 ft  (the heuristic that used to live here)
     *       poster         57 ft  (pickElevationGain over the twins)
     *
     * and on 2026-08-24 run detail printed 128 ft `gps_derived` while the
     * absorbed twin held 13 ft from the watch's BAROMETER. That is the run
     * the runner said he could promise was not 128 feet.
     *
     * The heuristic is gone rather than kept as a fallback. It answered a
     * different question — "is this figure implausible" — and answering it
     * per-surface is what produced three numbers. `pickElevationGain` ranks
     * by INSTRUMENT, which is the question that actually decides, and it
     * REFUSES when nothing trustworthy survives. A refusal is a correct
     * answer here: an invented 3195 ft is worse than a blank, because the
     * runner cannot tell it is invented. */
    elev_gain_ft: elevationReading?.ft ?? null,
    /* False when the surviving figure is `gps_derived` or `recomputed`.
     * Rule one: a modelled number must never look measured, so a surface
     * drawing this must carry the modelled mark when it is false. */
    elev_gain_measured: elevationReading?.measured ?? false,
    elev_gain_source: elevationReading?.source ?? null,
    // 2026-08-17 · terrain. Resolved from the SAME raw row, not from the
    // normalized fields above: `rawSplits` still carries whichever of the four
    // elevation-delta key names the importer wrote, and summing the negatives
    // is the only way this data model can tell a net-downhill run from a
    // rolling one. `pace_s_per_mi` above is untouched and stays the real pace.
    ...(() => {
      const t = resolveRunTerrain({
        source: r.source as string | null,
        indoor: r.indoor === true,
        distanceMi: Number(r.distanceMi) || null,
        durationSec: movingSec ?? elapsedSec,
        paceSPerMi,
        elevGainFt: Number(r.elevGainFt) || null,
        elevGainSource: r.elevGainSource as string | null,
        startLatLng: r.startLatLng,
        endLatLng: r.endLatLng,
        splits: rawSplits,
        phases: r.phases,
      });
      return {
        grade_adjusted_pace_s_per_mi:
          t.adjustedPaceSPerMi != null ? Math.round(t.adjustedPaceSPerMi) : null,
        terrain_label: terrainAdjustmentLabel(t),
        terrain_basis: t.basis as string,
        terrain_surface: t.surface,
      };
    })(),
    // 2026-06-01 · fall back to data.weather.temp_f when data.tempF
    // is absent. Watch-tier rows store enriched weather as the nested
    // `weather` object (from lib/weather/openmeteo.ts span enrichment) ·
    // the legacy `tempF` top-level key is only set on older ingest
    // paths. Without this fallback the Today card's WEATHER chip
    // renders "·" even when full weather is present in data.weather.
    temp_f: Number(r.tempF) || Number((r.weather as Record<string, unknown> | null | undefined)?.temp_f) || null,
    temp_range_f: (() => {
      const w = (r.weather ?? {}) as Record<string, unknown>;
      const start = typeof w.temp_f_start === 'number' ? w.temp_f_start : null;
      const end = typeof w.temp_f_end === 'number' ? w.temp_f_end : null;
      const peak = typeof w.temp_f_peak === 'number' ? w.temp_f_peak : null;
      const mean = typeof w.temp_f_mean === 'number' ? w.temp_f_mean : null;
      // Only emit the arc when at least one bound has a value · otherwise
      // the chip should fall through to temp_f.
      if (start == null && end == null && peak == null && mean == null) return null;
      return { start, end, peak, mean };
    })(),
    weather_context: weatherCtx,
    // 2026-08-27 · no pace band is drawn from this any more — the client's
    // heatAwareDrift is the only remaining consumer, using it to relabel an
    // HR rise as thermoregulation rather than fitness fade.
    heat_slowdown_pct: heatSlowdownPct,
    suffer_score: Number(r.sufferScore) || null,
    kudos: Number(r.kudosCount) || null,
    // P2 #10 (2026-05-30): surface the day's avg running power (W).
    // Already loaded into form.run_power_w by loadFormMetrics() from
    // health_samples; mirror it at the top level so RunDetailModal
    // doesn't need to dig into the form nest.
    power_avg_w: form.run_power_w,
    calories_kcal: activeEnergy?.kcal ?? null,
    calories_source: activeEnergy?.source ?? null,
    calories_measured: activeEnergy?.measured ?? null,
    hr_on_pace_delta_bpm: hrOnPaceDelta,

    shoe_id: shoeId,
    shoes,
    pace_work: workAvgs.pace,
    pace_work_s_per_mi: workAvgs.paceSPerMi,
    hr_avg_work: workAvgs.hrAvg,
    cadence_avg_work: workAvgs.cadenceAvg,
    work_seconds: workAvgs.workSeconds,

    // 2026-08-24 · WHICH OF THE ABOVE MAY APPEAR, AND OVER WHAT.
    //
    // The three work-only fields have been on this wire since P42 and no
    // renderer read them, so every surface kept printing the whole-run
    // averages beside them. On 2026-08-11 that meant "Heart rate, avg 153"
    // over a session whose four reps ran 164/169/168/160 — a number no part
    // of that run happened at.
    //
    // The decision is made ONCE, here, rather than in each client, because
    // two clients deriving it independently is how they come to disagree.
    // See lib/coach/reading-scope.ts for the rule and the doctrine.
    readings: deriveReadingScopes({
      phases: phaseBreakdown,
      wholeHrBpm: Number(r.avgHr) || null,
      wholeCadenceSpm: runCadenceSpm(r)?.spm ?? form.cadence_spm,
      workHrBpm: workAvgs.hrAvg,
      workCadenceSpm: workAvgs.cadenceAvg,
      wholePaceSPerMi: paceSPerMi,
      workPaceSPerMi: workAvgs.paceSPerMi,
    }),

    has_route: Boolean(r.summaryPolyline || r.routePolyline || r.startLatLng),
    route_polyline: r.summaryPolyline ?? r.routePolyline ?? null,
    splits_unreliable: r.splits_unreliable === true,
    splits_cover_run: splits.length > 0 ? splitsCoverRun : null,
    splits_note: (splits.length > 0 && splitsCoverRun === false)
      // Said plainly, in a line, because a refusal is an answer. The number
      // is deliberately the sum the array actually holds: the runner can see
      // for themselves that it is not the run's distance, which is the whole
      // claim. No scolding, and no invitation to fix something they cannot.
      ? `These splits add up to ${fmtSplitSum(usableSplits)}, not the ${
          distanceMi != null ? distanceMi.toFixed(2) : '—'
        } mi of this run. Mile paces below are what the watch recorded; the run's own distance and time are in the header.`
      : null,
    splits,
    hrZonePcts,
    hr_zones_from_lthr,
    easy_hr_read,
    form,
    phase_breakdown: phaseBreakdown,
    planned_spec,
    planned_sub_label,
    planned_distance_mi,
    zoneTargets,
    ceiling_lift: (r.ceilingLift as Record<string, unknown> | undefined) ?? null,
    rep_skips: Array.isArray(r.repSkips) ? (r.repSkips as Array<Record<string, unknown>>) : [],
    recovery_extensions: Array.isArray(r.recoveryExtensions)
      ? (r.recoveryExtensions as Array<Record<string, unknown>>)
      : [],
    aerobic_decoupling: (() => {
      // Skip interval / tempo / race · those aren't steady-state by
      // design, and the helper would mostly return null but cheaper
      // to short-circuit here.
      const t = String(r.type ?? '').toLowerCase();
      if (t === 'tempo' || t === 'intervals' || t === 'threshold'
          || t === 'race' || t === 'fartlek') return null;
      const result = computeAerobicDecoupling(
        Array.isArray(r.splits) ? r.splits : [],
        Number(r.distanceMi) || 0,
      );
      if (!result) return null;
      return {
        drift_pct: result.driftPct,
        verdict: result.verdict,
        h1_hr: result.h1Hr,
        h1_pace_sec: result.h1PaceSec,
        h2_hr: result.h2Hr,
        h2_pace_sec: result.h2PaceSec,
      };
    })(),
    cadence_fatigue: (() => {
      // Same workout-type filter as aerobic decoupling · cadence
      // variability is by-design in intervals/tempo/race efforts.
      const t = String(r.type ?? '').toLowerCase();
      if (t === 'tempo' || t === 'intervals' || t === 'threshold'
          || t === 'race' || t === 'fartlek') return null;
      const result = computeCadenceFatigue(
        Array.isArray(r.splits) ? r.splits : [],
        Number(r.distanceMi) || 0,
      );
      if (!result) return null;
      return {
        delta_spm: result.deltaSpm,
        verdict: result.verdict,
        h1_spm: result.h1Spm,
        h2_spm: result.h2Spm,
      };
    })(),
  };
}

/**
 * P44 — load the phase-by-phase breakdown for a Faff-watch run.
 *
 * The watch app posts a WatchCompletion payload at run end that includes
 * a phases[] array with target + actual numbers per phase (warmup, each
 * rep, recoveries, cooldown). We tucked that into coach_intents so the
 * coach voice could reference "rep 3 was 4s slow." This loader surfaces
 * it to the run-detail UI so the runner sees the same breakdown they
 * felt on the watch.
 *
 * Returns []:
 *   - non-Faff-watch runs (Apple Watch Workouts, Strava, manual) where
 *     no WatchCompletion intent exists
 *   - days that did have a Faff-watch run but no phase structure (open
 *     easy runs with no planned phases)
 *
 * Only returns the most-recent watch_completion intent for the date —
 * if the runner did multiple watch sessions on one day (rare), the
 * latest one wins.
 */
/**
 * Compute the duration-scaled heat slowdown % for this run. Heat-widened
 * 2026-06-04 · widening removed 2026-08-27 — `heatAdjustedStatus` now grades
 * the phase band symmetrically regardless of this value (the runner paces
 * off feel, not a heat allowance). The number still travels two places:
 * into `loadPhaseBreakdown` below (kept only for call-site compatibility —
 * see `heatAdjustedStatus`) and out on `heat_slowdown_pct` for the client's
 * `heatAwareDrift`, which relabels a back-half HR rise as HEAT DRIFT instead
 * of decoupling — an HR-confounder read, not a pace grade, and explicitly
 * out of scope for this removal. Returns 0 when conditions weren't material
 * or the data is missing.
 */
async function computeHeatSlowdownForRun(r: Record<string, unknown>): Promise<number> {
  const weather = (r.weather && typeof r.weather === 'object') ? r.weather as Record<string, unknown> : null;
  if (!weather) return 0;
  const { judgeWeather } = await import('./weather-adjust');
  const j = judgeWeather({
    tempF: typeof weather.temp_f === 'number' ? weather.temp_f : (typeof r.tempF === 'number' ? r.tempF : null),
    tempF_start: typeof weather.temp_f_start === 'number' ? weather.temp_f_start : null,
    tempF_end: typeof weather.temp_f_end === 'number' ? weather.temp_f_end : null,
    tempF_peak: typeof weather.temp_f_peak === 'number' ? weather.temp_f_peak : null,
    humidityPct: typeof weather.humidity_pct === 'number' ? weather.humidity_pct : null,
    windMph: typeof weather.wind_mph === 'number' ? weather.wind_mph : null,
    conditions: typeof weather.conditions === 'string' ? weather.conditions : null,
    cloudCoverPct: typeof weather.cloud_cover_pct === 'number' ? weather.cloud_cover_pct : null,
    // 2026-08-24 · was `typeof r.durationSec === 'number' ? r.durationSec : null`.
    //
    // `durationS` is how long the runner was in the heat, and `judgeWeather`
    // falls back to the FULL MARATHON-DISTANCE penalty when it is null
    // (Research/06 · the Maughan table is anchored at marathon duration and
    // scaled down for shorter efforts). 133 of 256 canonical rows carry no
    // `durationSec` key at all — their wall clock lives in `elapsedTimeS` —
    // so those runs were charged a marathon's worth of heat. On 2026-05-20,
    // a 47-minute run at 83°F, the recap said heat "cost you about 12% on
    // pace"; for that duration it is 7%. On 91 of the 207 weather-enriched
    // rows the figure was overstated, and on 16 the note appeared at all on
    // a day that did not warrant one — "61°F. Cost you about 3% on pace."
    //
    // The doc comment above promises this mirrors what the recap route
    // passes. It has to keep doing so, so both now read the same reconciler.
    durationS: coherentElapsedSec(r),
  });
  return j.slowdownPct ?? 0;
}

/**
 * THE RUN'S OWN COMPLETION, BY NAME (SIMROW-1 · 2026-09-02).
 *
 * `loadPhaseBreakdown` matches `coach_intents` on the runner and the DAY, and a
 * day is not a run. A field with no `-YYYY-MM-DD` suffix falls through to a
 * timestamp comparison that every payload posted that day satisfies equally,
 * and `ORDER BY ts DESC LIMIT 1` then takes whichever landed last. On
 * 2026-09-02 that was `sim-recovery-live#1038` — a 3-phase, 0.27 mi simulator
 * run — ahead of the owner's real 13-phase easy-plus-strides session. Rule 14:
 * filtering on the runner is not filtering on the right rows.
 *
 * `watchCompletionRef` is the completion's own `workoutId`, stamped on the run
 * row by the same POST that wrote the intent, so it names ONE payload.
 *
 * NO `.catch()`, deliberately (Rule 11). A swallow here would not degrade to
 * nothing — the caller's next step is the date match, so it would degrade to
 * SOMEBODY ELSE'S RUN, quietly, on the one screen that must be about this one.
 *
 * THE RESULT IS A UNION, AND ITS REFUSAL BRANCH CARRIES NO `phases` FIELD.
 *
 * "There is no ref, or no intent under it" and "the ref matched and the payload
 * held no phases" are two different facts, and collapsing them to `null` would
 * be Rule 11 broken inside the fix for a Rule 14 defect. They lead to OPPOSITE
 * outcomes: the first is the caller's cue to try the day, and the second must
 * NOT be — falling through on a matched-but-empty payload is how the date query
 * gets a second chance to return somebody's simulator run, which is the whole
 * thing this function exists to stop.
 *
 * The union shape is `normal-window.ts`'s `NormalReading<T>` pattern: the
 * caller cannot read `.phases` until it has branched on `found`.
 */
type RefCompletion = { found: false } | { found: true; phases: unknown[] };

async function completionPhasesByRef(
  userId: string,
  completionRef: string | null | undefined,
): Promise<RefCompletion> {
  if (!completionRef) return { found: false };
  const res = await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
        AND field = $2
      ORDER BY ts DESC LIMIT 1`,
    [userId, completionRef],
  );
  const raw = res.rows[0]?.value;
  if (raw == null) return { found: false };
  let v: any = raw;
  if (typeof v === 'string') {
    // A payload that will not parse is a payload we cannot read. That is a
    // FAILED read of a row that exists, not an absent row: the caller must not
    // go looking for a different run to draw instead.
    try { v = JSON.parse(v); } catch { return { found: true, phases: [] }; }
  }
  const ph = Array.isArray(v) ? v : v?.phases;
  return { found: true, phases: Array.isArray(ph) ? ph : [] };
}

async function loadPhaseBreakdown(
  userId: string,
  date: string | null,
  heatSlowdownPct: number = 0,
  sessionClass?: SessionClass,
  stridesPrescribed?: number | null,
  /* SIMROW-1 (2026-09-02) · the completion this RUN says it came from.
   * See the query below — without it this function has read a simulator's
   * payload on a day one was posted. */
  completionRef?: string | null,
): Promise<PhaseBreakdown[]> {
  const byRef = await completionPhasesByRef(userId, completionRef);
  // FOUND IS THE BRANCH, NOT EMPTINESS. A completion that matched this run and
  // carried nothing draws nothing; it does not send the day query hunting.
  if (byRef.found) return mapWatchPhases(byRef.phases, heatSlowdownPct, sessionClass, stridesPrescribed);
  if (!date) return [];
  // 2026-08-27 · the #HHmm-suffix branch was the fix P1-34 shipped for this
  // fallback's flaw, but a treadmill completion's field (`trd_<uuid>`)
  // carries no date suffix at all — it always falls through, so the exact
  // failure this comment already named ("bled into the wrong day's card")
  // was still live for every treadmill run. Converting to the runner's own
  // timezone before taking the date is the actual fix; the field-suffix
  // check above only avoided the fallback, it never corrected it.
  // runnerTimezoneOrPacific — this is the exact "coach_intents
  // watch-completion day bucketing" case that helper is named for. A
  // runner with no stored timezone is legacy single-user-era data
  // stamped in Pacific wall time, never UTC.
  const tz = await runnerTimezoneOrPacific(userId).catch(() => 'America/Los_Angeles');
  const row = (await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'watch_completion'
        AND (
          CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
               THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
               ELSE (ts AT TIME ZONE $3::text)::date = $2::date
          END
        )
        -- SIMROW-1 · a simulator payload is never a runner's session. The
        -- ref branch above is the real fix; this stops the legacy fallback
        -- reaching for one when the ref is absent.
        AND field NOT LIKE 'sim-%'
      ORDER BY ts DESC LIMIT 1`,
    [userId, date, tz]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!row?.value) return [];

  let payload: any = row.value;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return []; }
  }
  return mapWatchPhases(payload?.phases, heatSlowdownPct, sessionClass, stridesPrescribed);
}

/**
 * The watch's phase array, as the phone's `phase_breakdown`.
 *
 * SPLIT OUT OF `loadPhaseBreakdown` SO IT CAN BE TESTED. The loader is a
 * query and a `JSON.parse`; this is the whole contract — which fields survive
 * the trip, which the server recomputes, and which are passed through
 * untouched. It had no test because the only way to reach it was a database.
 *
 * `heatSlowdownPct` no longer widens the on-target band — kept only for
 * call-site compatibility; see `heatAdjustedStatus`.
 */
export function mapWatchPhases(
  raw: unknown,
  heatSlowdownPct: number = 0,
  sessionClass?: SessionClass,
  stridesPrescribed?: number | null,
): PhaseBreakdown[] {
  void heatSlowdownPct;
  /* VERDICT-1 (2026-09-01) · ONE resolver. This function used to re-derive the
   * shape, the tolerance and the verdict itself, on a three-rung ladder of its
   * own, and it was the second of four graders the same completion passed
   * through. It is now a MAPPER over `lib/execution/verdict.ts`: the grade is
   * the resolver's, and this only spells it in the phone's field names. A
   * caller that cannot name the session passes nothing and gets the
   * unnamed-session read, which the resolver states rather than guesses. */
  /* STRIDE-ROUNDTRIP-1 (2026-09-02) · the spec's own stride count travels with
   * the session class, because the grader needs both to tell a 20-second
   * acceleration from a rep. Without it the runner's 2026-09-02 easy day sent
   * this phone six strides shaped `ceiling` with `status: 'fast'`, and four of
   * them drew "Quicker than the ceiling" — a grade on a phase doctrine calls
   * "Not a workout" (`Research/04` §7.2). With it they arrive `effort` /
   * `not_graded` / `status: null`, which is what a form drill is. */
  const graded = gradeStoredPhases(raw, sessionClass ?? 'other', { stridesPrescribed });
  return graded.phases.map((g, i): PhaseBreakdown => {
    const type: PhaseBreakdown['type'] = g.type;
    const status: 'on' | 'fast' | 'slow' | null =
      g.verdict === 'hit' ? 'on' : g.verdict === 'fast' ? 'fast' : g.verdict === 'slow' ? 'slow' : null;
    return {
      pace_shape: g.shape,
      status_label: g.statusLabel,
      index: g.index,
      label: g.label ?? defaultLabel(type, i),
      type,
      target_pace: fmtPace(g.targetSecPerMi),
      target_pace_sec: g.targetSecPerMi,
      // THE owner's width, and the width the phase was GRADED at — the row the
      // phone draws and the band it is graded against are one number.
      tolerance_pace_sec: g.toleranceSec,
      target_distance_mi: g.targetDistanceMi,
      target_duration_sec: g.targetDurationSec,
      actual_pace: fmtPace(g.avgSecPerMi),
      actual_distance_mi: g.actualDistanceMi,
      actual_duration_sec: g.actualDurationSec,
      avg_hr: g.avgHr,
      max_hr: g.maxHr,
      avg_cadence: g.avgCadence,
      completed: g.completed,
      status,
      // The DEVICE'S word, passed through as the stored fact it is. Never the
      // verdict a surface prints — `status` / `status_label` are.
      verdict: g.storedVerdict,
      time_in_tolerance_sec: g.timeInToleranceSec,
      time_out_of_tolerance_sec: g.timeOutOfToleranceSec,
    };
  });
}

function defaultLabel(type: PhaseBreakdown['type'], i: number): string {
  switch (type) {
    case 'warmup': return 'Warmup';
    case 'cooldown': return 'Cooldown';
    case 'recovery': return 'Recovery';
    case 'work': return `Rep ${i + 1}`;
    default: return `Phase ${i + 1}`;
  }
}

/**
 * P42 + P45 — compute averages over WORK phases only (exclude warmup,
 * recovery jogs, cooldown).
 *
 * Two signal sources, in order of preference:
 *
 *   (a) PHASE DATA from the WatchCompletion payload — when the Faff watch
 *       app ran the workout, each phase carries actualDurationSec +
 *       actualDistanceMi + avgHr + avgCadence + type. We weight each
 *       average by the phase's actual duration so a 20-min threshold rep
 *       counts more than a 90-sec recovery (which we filter out anyway).
 *       This is the metric-grade path.
 *
 *   (b) SPLITS HEURISTIC fallback — when no phase data exists but the
 *       planned workout type is a quality session (threshold/tempo/intervals
 *       /vo2max/race), drop the first split (warmup) and last split
 *       (cooldown) and average the middle. Decorative, not metric-grade.
 *
 * Returns nulls when neither path applies (easy/long runs, no plan match,
 * etc.) — the UI hides the card so the all-in averages stay the only
 * headline numbers.
 *
 * Phases counted as "work": warmup/cooldown/recovery/rest are filtered
 * out; everything else (work/rep/tempo/threshold/intervals/race) counts.
 */
/**
 * Walk `splits` and assign each mile's `phase` based on cumulative
 * distance against the `phaseBreakdown` boundaries. Mutates splits in
 * place; safe no-op when phases is empty.
 *
 * Heuristic: build a sorted list of phase boundaries by cumulative
 * distance, then for each split find the phase whose distance range
 * contains the mile's midpoint (mile N covers [N-1, N] miles). When
 * splits span more than one phase (rare · usually only happens on a
 * mid-mile recovery jog), the phase with the most overlap wins.
 *
 * Edge cases:
 *   · phases empty → splits stay phase: null
 *   · phases have no actual_distance_mi → splits stay phase: null
 *   · split mile beyond last phase boundary → tagged as last phase's type
 */
function tagSplitsWithPhases(splits: RunSplit[], phases: PhaseBreakdown[]): void {
  if (splits.length === 0 || phases.length === 0) return;

  // Build cumulative boundary list: [{ endMi, type }] sorted by index.
  const boundaries: Array<{ endMi: number; type: PhaseBreakdown['type'] }> = [];
  let cumMi = 0;
  for (const p of phases.slice().sort((a, b) => a.index - b.index)) {
    const mi = Number(p.actual_distance_mi);
    if (!isFinite(mi) || mi <= 0) continue;
    cumMi += mi;
    boundaries.push({ endMi: cumMi, type: p.type });
  }
  if (boundaries.length === 0) return;

  for (const s of splits) {
    // Midpoint of mile N is at (N - 0.5) miles of cumulative distance.
    const midpoint = Math.max(0, s.mile - 0.5);
    const match = boundaries.find((b) => midpoint <= b.endMi);
    s.phase = match?.type ?? boundaries[boundaries.length - 1].type;
  }
}

async function computeWorkAverages(
  userId: string,
  date: string | null,
  splits: RunSplit[],
  phases: PhaseBreakdown[],
): Promise<{
  pace: string | null;
  paceSPerMi: number | null;
  hrAvg: number | null;
  cadenceAvg: number | null;
  workSeconds: number | null;
}> {
  const empty = { pace: null, paceSPerMi: null, hrAvg: null, cadenceAvg: null, workSeconds: null };

  // (a) Phase-data path — preferred when WatchCompletion phases exist.
  //
  // THE ARITHMETIC MOVED TO `lib/runs/work-averages.ts`, unchanged, so the v5
  // Today route can compute the same numbers from the same code. It held the
  // only work-scoped averages in the app and only run detail could see them;
  // two screens deriving them two ways is the defect class this codebase has
  // spent the day removing.
  if (phases.length > 0) {
    const w = workAveragesFromPhases(phases.map((p) => ({
      type: p.type ?? null,
      sec: Number(p.actual_duration_sec) || null,
      mi: Number(p.actual_distance_mi) || null,
      hr: p.avg_hr ?? null,
      cadence: p.avg_cadence ?? null,
    })));
    // If at least one of the three signals exists, return them. Otherwise
    // fall through to the heuristic path.
    if (w.paceSPerMi != null || w.hrAvg != null || w.cadenceAvg != null) {
      return { pace: fmtPace(w.paceSPerMi), ...w };
    }
  }

  // (b) Splits heuristic fallback — only for quality types with ≥3 splits.
  if (!date || splits.length === 0) return empty;
  const pw = (await pool.query(
    `SELECT pw.notes, pw.distance_mi, pw.type
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      LIMIT 1`,
    [userId, date]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!pw) return empty;

  const isQuality = ['threshold','tempo','intervals','vo2max','race'].includes(pw.type);
  if (!isQuality || splits.length < 3) return empty;

  const work = splits.slice(1, -1);
  const hrs = work.map((s) => s.hr).filter((n): n is number => typeof n === 'number' && n > 0);
  const cads = work.map((s) => s.cadence).filter((n): n is number => typeof n === 'number' && n > 0);

  // For pace from splits we parse the formatted "mm:ss" strings.
  const splitPaces: number[] = [];
  for (const s of work) {
    if (!s.pace) continue;
    const m = s.pace.match(/^(\d+):(\d{2})$/);
    if (!m) continue;
    splitPaces.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  }
  const paceSPerMi = splitPaces.length > 0
    ? Math.round(splitPaces.reduce((a, b) => a + b, 0) / splitPaces.length)
    : null;

  // Estimate work seconds from the splits we kept.
  const workSeconds = paceSPerMi != null
    ? work.length * paceSPerMi
    : work.length * 7 * 60;

  return {
    pace: fmtPace(paceSPerMi),
    paceSPerMi,
    hrAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    cadenceAvg: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    workSeconds,
  };
}

/**
 * Compute "HR on pace delta" · how today's avg HR compares to the
 * runner's last 4 same-effort runs at the same pace.
 *
 * Why this exists (David, 2026-05-31 web-agent punch list #4):
 *   The "how it went" verdict can't honestly say "you worked harder
 *   than usual today" without knowing what "usual" is. This gives
 *   the verdict a calibrated comparison · today's HR minus the median
 *   of recent same-effort, same-pace runs.
 *
 * Comparable run definition:
 *   · Same `type` (easy/long/tempo/intervals/etc.) · matches the
 *     stimulus the runner thinks they're doing.
 *   · Pace within ±10 s/mi of today's pace · "same-effort" by pace
 *     bucket. Cardiac drift across paces is real, so we hold pace
 *     roughly constant before comparing HR.
 *   · Not today's run.
 *   · Has both pace AND avg HR. Filters out manual entries.
 *   · Most recent 4 matching runs. If fewer than 2 match, returns null
 *     (no honest baseline).
 *
 * Doctrine (Research/03 · Heart Rate Zones · cardiac drift across days):
 *   ±5 bpm at the same pace is the meaningful threshold for steady
 *   efforts · noise floor for HR baseline. Consumers gate display
 *   accordingly.
 */
async function computeHrOnPaceDelta(args: {
  userId: string;
  runIdToExclude: string;
  /** `data.type` · an activity kind on 141 rows, a session type on 45. */
  type: string | null;
  /** `data.workoutType` · a semantic label, or Strava's integer enum. */
  workoutType?: string | number | null;
  paceSPerMi: number | null;
  avgHr: number | null;
}): Promise<number | null> {
  if (!args.paceSPerMi || !args.avgHr) return null;
  if (args.paceSPerMi <= 0 || args.avgHr <= 0) return null;
  try {
    const PACE_BUCKET = 10; // ±10 s/mi
    // Phase B · one canonical dedup. A dupe of a same-type+pace run would put
    // two identical avgHr into the 4-sample median baseline. LIMIT 4 windows it.
    //
    // 2026-08-24 · the query below also carried `absorbed_into_canonical_at IS
    // NULL`. Removed, with nothing in its place: `canonicalIds` is already
    // identity-clustered, and the stamp survives a promotion back to canonical
    // — six of this runner's canonical rows carry a stale one. See
    // CANONICAL_ROW_SQL in lib/runs/volume.ts.
    const canonicalIds = await getCanonicalRunIds(args.userId, ...ALL_TIME);

    /* ── 2026-08-24 · THE MATCH USED TO PARTITION BY IMPORTER ──────────────
     *
     * This clause was `AND data->>'type' = $3`, with `$3` the caller's own
     * `r.type`. Self-consistent, and not what the doc comment above claims.
     * `data.type` carries TWO vocabularies: Strava's ACTIVITY KIND ('Run') on
     * 141 rows and the faff WORKOUT TYPE ('easy') on 45. Among this runner's
     * rows that have both a pace and a heart rate, the field takes exactly two
     * values — 'Run' on 101 and 'easy' on 22 — so the "same stimulus" bucket
     * was really "same ingest era".
     *
     * A tempo run stored as 'Run' was compared against a hundred mostly-easy
     * runs, and the sentence built on the result is "you worked harder than
     * usual today". Usual was the wrong usual.
     *
     * `normalizeDataWorkoutType` is the shared reader for both vocabularies
     * (it is what the run's own name resolution above already uses), and it
     * maps Strava's 0 to null rather than to a stimulus called "0". Resolved
     * on BOTH sides here, in TypeScript, so there is no SQL twin of the
     * normalizer to drift from it.
     *
     * MEASURED over prod, both versions run against all 123 of this runner's
     * canonical rows that carry a pace and a heart rate:
     *
     *     a delta was returned      114 runs  ->  38
     *     the value CHANGED                        30
     *     now refused (no stimulus recorded)       77
     *
     * The 30 that changed are the point. Three of them flip sign by 15-20 bpm,
     * and `RunDetailModal` draws a red or green callout at |delta| >= 5 — so
     * 2026-06-08 read "11 bpm easier than usual" in green and is actually
     * 9 bpm HARDER than usual for an easy run. "Usual" had been every
     * Strava-shaped run near that pace, tempo sessions included.
     *
     * The 77 are the price, and they are rule three: not knowing what kind of
     * session a run was is a correct answer. Every one of them had its delta
     * measured against a cohort assembled by importer. If the coverage matters
     * more than the cohort, the honest version of that is a BASIS field on the
     * wire saying "pace-matched only" — not a silent widening. */
    const stimulus = runStimulusType({ workoutType: args.workoutType, type: args.type });
    if (stimulus == null) return null;

    const candidates = (await pool.query<{ avg_hr: string; type: string | null; workout_type: string | null }>(
      `SELECT (data->>'avgHr')::numeric AS avg_hr,
              data->>'type'        AS type,
              data->>'workoutType' AS workout_type
         FROM runs
        WHERE user_uuid = $1
          AND id = ANY($5::bigint[])
          AND id::text <> $2
          AND (data->>'paceSPerMi')::numeric BETWEEN ($3::numeric - $4) AND ($3::numeric + $4)
          AND (data->>'avgHr')::numeric > 0
        ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC
        LIMIT 60`,
      [args.userId, args.runIdToExclude, args.paceSPerMi, PACE_BUCKET, canonicalIds],
    ).catch(() => ({ rows: [] as Array<{ avg_hr: string; type: string | null; workout_type: string | null }> }))).rows;

    // Same stimulus, most recent four. The LIMIT above is the pace-bucket
    // candidate window; this is the "last 4 comparable runs" the doc describes.
    const recent = candidates
      .filter((c) => runStimulusType({ workoutType: c.workout_type, type: c.type }) === stimulus)
      .slice(0, 4);

    if (recent.length < 2) return null;

    // Median is more robust than mean against a single weird-day outlier.
    const hrs = recent.map(r => Number(r.avg_hr)).filter(Number.isFinite).sort((a, b) => a - b);
    if (hrs.length === 0) return null;
    const mid = Math.floor(hrs.length / 2);
    const baseline = hrs.length % 2 === 0 ? (hrs[mid - 1] + hrs[mid]) / 2 : hrs[mid];

    return Math.round(args.avgHr - baseline);
  } catch {
    return null;
  }
}

async function loadFormMetrics(userId: string, date: string | null): Promise<RunForm> {
  const empty: RunForm = {
    cadence_spm: null, ground_contact_ms: null, stride_length_m: null,
    vertical_oscillation_cm: null, vertical_ratio_pct: null,
    run_power_w: null, respiratory_rate: null, spo2_pct: null,
  };
  if (!date) return empty;

  const rows = (await pool.query(
    `SELECT sample_type, AVG(value)::numeric AS avg
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_date = $2::date
        AND sample_type IN (
          'cadence','ground_contact_time','stride_length',
          'vertical_oscillation','vertical_ratio','run_power',
          'respiratory_rate','spo2'
        )
      GROUP BY sample_type`,
    [userId, date]
  ).catch(() => ({ rows: [] }))).rows;

  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.sample_type, Number(r.avg));

  return {
    cadence_spm:             byType.has('cadence')              ? Math.round(byType.get('cadence')!)                 : null,
    ground_contact_ms:       byType.has('ground_contact_time')  ? Math.round(byType.get('ground_contact_time')!)     : null,
    stride_length_m:         byType.has('stride_length')        ? +(byType.get('stride_length')!).toFixed(2)         : null,
    vertical_oscillation_cm: byType.has('vertical_oscillation') ? +(byType.get('vertical_oscillation')!).toFixed(1)  : null,
    vertical_ratio_pct:      byType.has('vertical_ratio')       ? +(byType.get('vertical_ratio')!).toFixed(1)        : null,
    run_power_w:             byType.has('run_power')            ? Math.round(byType.get('run_power')!)               : null,
    respiratory_rate:        byType.has('respiratory_rate')     ? +(byType.get('respiratory_rate')!).toFixed(1)      : null,
    spo2_pct:                byType.has('spo2')                 ? +(byType.get('spo2')!).toFixed(1)                  : null,
  };
}

