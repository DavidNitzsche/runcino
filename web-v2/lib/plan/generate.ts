/**
 * plan/generate.ts — algorithmic plan generation (v1).
 *
 * Why algorithmic (not LLM-driven): plan STRUCTURE is deterministic
 * doctrine — block periodization is rules. We reserve the LLM for
 * voice/rationale around the structure, never for the structure itself.
 *
 * Every structural rule below cites the canonical research file at
 * `/Research/`. If a rule is added without a citation, that's a bug —
 * see CLAUDE.md "Engine must match research".
 *
 * Block model (Daniels-style, simplified for v1):
 *   - Race week:    deep taper, race day
 *   - Sharpen:      1-2 wks @ 70-80% peak, strides, short tune-up
 *   - Race-specific:2-3 wks @ peak vol, marathon-pace + threshold
 *   - Quality:      4-6 wks ramping, intervals + threshold
 *   - Base:         everything before, easy aerobic + long
 *
 *   Cite: Research/00a-distance-running-training.md §periodization
 *   Cite: Research/04-workout-vocabulary.md §quality-types
 *   Cite: Research/08-pacing-and-race-week.md §taper
 */
import { pool } from '@/lib/db/pool';
import { randomBytes } from 'crypto';
import { loadSettings } from '@/lib/coach/settings';
import { pickWorkout, type WorkoutFamily } from './workout-library';
import { buildWorkoutSpec, tPaceFromGoal, totalDistanceMiFromSpec } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { parseRaceTime, tPaceFromVdot, bestRecentVdot as computeBestRecentVdot } from '@/lib/training/vdot';
// 2026-06-03 · Rule 16 · canonical max-HR reader · resolves
// users.max_hr_override → hybrid 12-mo observed → users.max_hr → null.
// profile.max_hr is NOT the source of truth per task #141.
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { lookupTierTarget, type TierTarget, type GoalTier, pickPlanMode, MAINTENANCE_BY_TIER, POST_RACE_RECOVERY_WEEKS, type PlanMode } from './goal-tiers';
import { snapshotSealedDays, logSealSkip, type SealedPrescription } from './seal';

export type DOW = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0..Sat=6
type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayKeyToDow = (k: DayKey): DOW => DAY_KEYS.indexOf(k) as DOW;

export interface GenerateInput {
  userId: string;
  raceSlug: string;
}

export interface GenerateResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function today(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Monday of the week containing `iso`
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

// 2026-06-03 · delegate to lib/training/vdot.parseRaceTime (single
// canonical parser, imported at the top of this file). Re-exported so
// the generator-bench keeps its existing test surface. Was a local
// fork that mis-parsed "1:30" as null instead of 5400.
export function parseGoalSeconds(goal: string | null | undefined): number | null {
  return parseRaceTime(goal);
}

// Race distance in miles. Prefers numeric meta.distanceMi (most reliable),
// falls back to label parsing.
function distanceMiOf(meta: any): number {
  const numeric = Number(meta?.distanceMi);
  if (isFinite(numeric) && numeric > 0) return numeric;

  const label: string = String(meta?.distanceLabel ?? meta?.distance_label ?? meta?.name ?? '').toLowerCase();
  if (!label) return 13.1;
  if (label.includes('marathon') && !label.includes('half')) return 26.2;
  if (label.includes('half') || label.includes('21k')) return 13.1;
  if (label.includes('10k')) return 6.2;
  if (label.includes('5k')) return 3.1;
  const m = label.match(/([\d.]+)\s*mi/);
  if (m) return parseFloat(m[1]);
  return 13.1;
}

// Recent 4-week avg weekly volume → starting point for the ramp.
async function recentWeeklyMileage(userId: string): Promise<number> {
  // 2026-06-02 · delegated to lib/runs/volume.ts § recentWeeklyMileageMi
  // which uses smart-dedup (bucket by date + 0.1-mi distance). Old
  // MAX-per-day was undercounting legit same-day doubles (AM/PM,
  // separate lunch runs) · David's 35.7 mi/wk was reading as 32.6.
  const { recentWeeklyMileageMi } = await import('@/lib/runs/volume');
  return (await recentWeeklyMileageMi(userId)) ?? 0;
}

/**
 * 2026-06-01 · runner's actual easy-day median over the last 14 days.
 *
 * Drives the easy-day distance floor in layoutWeek · prevents the
 * generator from authoring 4.5 mi easy days when the runner has been
 * comfortably running 6+ mi easy. The volume_drift cron only fires at
 * >40% deviation · this floor catches the silent 20-30% gap that the
 * runner notices ("my easy runs are usually 5-6 miles · why is the
 * plan asking for 4.5?") well before drift trips.
 *
 * "Easy" = any run that:
 *   - is between 3 and 9 mi (excludes warmups, race-pace work, long runs)
 *   - is NOT a duplicate (mergedIntoId not set)
 *
 * Returns the median (more robust than mean to one big outlier) ·
 * rounds to the nearest 0.5 mi to match the rest of the generator's
 * distance rounding doctrine.
 *
 * Returns 0 when there's no recoverable easy-day data · caller falls
 * back to the existing math floor of 3 mi.
 */
/**
 * 2026-06-03 · runner's recent peak long-run distance · used as a floor
 * for the generator's long-run sizing so the plan never authors a long
 * that's shorter than what the runner has actually been doing.
 *
 * Reads the longest run in last 28 days (typically the Sunday long).
 * Returns 0 when no data · caller treats as no floor.
 */
async function recentPeakLongMi(userId: string): Promise<number> {
  const r = (await pool.query<{ mi: string | null }>(
    `SELECT MAX((data->>'distanceMi')::numeric)::text AS mi
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date
            >= CURRENT_DATE - 28
        AND (data->>'distanceMi')::numeric >= 8`,  // long-ish only
    [userId]
  ).catch(() => ({ rows: [{ mi: null }] }))).rows[0];
  return Math.round((Number(r?.mi ?? 0)) * 10) / 10;
}

/**
 * 2026-06-03 · runner's recent quality-day median distance (last 28d).
 * Rule 2 floor source. "Quality day" = a run that landed on a plan
 * workout of type tempo/threshold/intervals, OR (cold-fallback) a run
 * with avgHr ≥ 85% of effective max. Returns 0 when no signal.
 */
async function recentQualityDistanceMi(userId: string): Promise<number> {
  // 2026-06-03 fix · plan_workouts has NO matched_run_id column.
  // Matching is date-based: JOIN runs ON (data->>'date')::date = pw.date_iso
  // (mirrors runner-calibration.ts and drift-monitor.ts patterns).
  // The previous query silently returned 0 (caught error) · Rule 2
  // floor never fired since it shipped.
  const r = (await pool.query<{ med: string | null }>(
    `WITH q AS (
       SELECT (r.data->>'distanceMi')::numeric AS mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN runs r
           ON r.user_uuid = tp.user_uuid::uuid
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
          AND NOT (r.data ? 'mergedIntoId')
        WHERE tp.user_uuid = $1
          AND pw.type IN ('tempo','threshold','intervals')
          AND pw.date_iso::date >= CURRENT_DATE - 28
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med FROM q`,
    [userId],
  ).catch((e: unknown) => {
    console.error('[recentQualityDistanceMi]', e instanceof Error ? e.message : String(e));
    return { rows: [{ med: null }] };
  })).rows[0];
  const m = Number(r?.med ?? 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round(m * 2) / 2;
}

/**
 * 2026-06-03 · runner's median quality sessions per week (last 28d).
 * Rule 5 density-ramp source. Returns 0 when no signal.
 */
async function recentQualityPerWeek(userId: string): Promise<number> {
  // 2026-06-03 fix · same bug as recentQualityDistanceMi. plan_workouts
  // has no user_uuid column AND no matched_run_id column. Matching is
  // date-based via JOIN on training_plans + runs.
  const r = (await pool.query<{ avg: string | null }>(
    `WITH wk_q AS (
       SELECT date_trunc('week', pw.date_iso::timestamp) AS wk, COUNT(DISTINCT pw.id)::numeric AS n
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN runs r
           ON r.user_uuid = tp.user_uuid::uuid
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
          AND NOT (r.data ? 'mergedIntoId')
        WHERE tp.user_uuid = $1
          AND pw.type IN ('tempo','threshold','intervals')
          AND pw.date_iso::date >= CURRENT_DATE - 28
        GROUP BY 1
     )
     SELECT AVG(n)::text AS avg FROM wk_q`,
    [userId],
  ).catch((e: unknown) => {
    console.error('[recentQualityPerWeek]', e instanceof Error ? e.message : String(e));
    return { rows: [{ avg: null }] };
  })).rows[0];
  const n = Number(r?.avg ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

async function easyDayMedianMi(userId: string): Promise<number> {
  const r = await pool.query<{ med: string | null }>(
    `WITH easy_runs AS (
       SELECT (data->>'distanceMi')::numeric AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric BETWEEN 3 AND 9
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
              >= (NOW() - interval '14 days')::date::text
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med
       FROM easy_runs`,
    [userId],
  ).catch(() => ({ rows: [{ med: null }] }));
  const m = Number(r.rows[0]?.med);
  if (!Number.isFinite(m) || m <= 0) return 0;
  // Round to nearest 0.5 mi per the distance-rounding doctrine.
  return Math.round(m * 2) / 2;
}

/**
 * 2026-06-01 · detect whether the runner is mid-block · has been doing
 * quality work in the last 28 days. Two signals (either is enough):
 *
 *   1. The active plan_workouts has a completed quality workout
 *      (threshold / intervals / tempo) in the last 28 days · checks
 *      both the prescribed type AND the matched actual run.
 *   2. The runs feed has runs with high HR (≥85% HRmax estimate ·
 *      threshold-effort) in the last 28 days even without an explicit
 *      type tag · catches Strava-imported quality work that wasn't
 *      labeled.
 *
 * Returns true if either fires. When true, sizeBlocks skips BASE so a
 * mid-block runner doesn't get dropped back into a fresh aerobic phase
 * by an auto-rebuild.
 *
 * False-positive risk · a one-off hard run won't trigger #1 (it
 * checks PRESCRIBED type, not just one-off effort). #2 needs sustained
 * HR signal · single-day spike doesn't count.
 */
async function detectMidBlock(userId: string): Promise<boolean> {
  // 2026-06-03 · David flagged · was only checking ACTIVE plan for
  // prescribed quality · rebuilds ARCHIVE the active plan, so a runner
  // who's been doing quality for weeks gets dropped back to BASE because
  // the new active plan has no completed quality yet. Expand to include
  // recently-archived plans + HR-based effort detection on runs.
  //
  // Signal 1 · prescribed quality in last 28d across all NON-ANCIENT
  // plans (active OR archived within last 30 days · the plan that
  // just got archived by today's rebuild still counts).
  const r1 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND (tp.archived_iso IS NULL OR tp.archived_iso > NOW() - interval '30 days')
        AND pw.type IN ('threshold','tempo','intervals','vo2max')
        AND pw.date_iso::date BETWEEN (CURRENT_DATE - 28) AND CURRENT_DATE`,
    [userId]
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(r1.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 2 · runs with quality-effort tag.
  const r2 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM runs r
      WHERE r.user_uuid = $1
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
            >= CURRENT_DATE - 28
        AND (
              LOWER(COALESCE(r.data->>'type', '')) IN ('tempo','threshold','intervals','vo2max','race')
              OR LOWER(COALESCE(r.data->>'workoutType', '')) ~ '(tempo|threshold|interval|vo2|race)'
            )`,
    [userId]
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(r2.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 3 · HR-based effort detection · ≥2 runs in last 28d with
  // avgHr ≥ 85% of effective max HR (Strava/Watch imports rarely tag
  // type · this catches the runner who's been doing real quality work
  // without the import tagging it). Threshold: 85% maxHR ≈ Z3+ effort.
  const profileRow = await pool.query<{ max_hr: number | null; lthr: number | null }>(
    `SELECT max_hr, lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId]
  ).then((r) => r.rows[0]).catch(() => undefined);
  // Effective max from profile if available · else fall back to a
  // generous default. Without one we can't compute the ratio.
  const effectiveMax = profileRow?.max_hr
    ?? (profileRow?.lthr ? Math.round(profileRow.lthr / 0.92) : null);
  if (effectiveMax && effectiveMax > 100) {
    const hrThreshold = Math.round(effectiveMax * 0.85);
    const r3 = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM runs r
        WHERE r.user_uuid = $1
          AND NOT (r.data ? 'mergedIntoId')
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
              >= CURRENT_DATE - 28
          AND COALESCE(
                (r.data->>'avgHr')::numeric,
                (r.data->>'avg_hr')::numeric,
                0
              ) >= $2`,
      [userId, hrThreshold]
    ).catch(() => ({ rows: [{ n: '0' }] }));
    if (Number(r3.rows[0]?.n ?? 0) >= 2) return true;
  }

  return false;
}

// ── Block sizing ────────────────────────────────────────────────────────

export interface BlockPlan {
  totalWeeks: number;
  phases: Array<{ label: string; weeks: number; rationale: string; citation: string }>;
}

/**
 * Race-distance category (Q-02 · SIM-02 fix). The plan generator now
 * differentiates 5K / 10K / HM / M instead of only marathon-vs-not.
 * Each category drives a distinct taper length, race-specific block
 * size, and quality-mix (see qualityMixFor below).
 *
 * Cite: Research/22-plan-templates.md (per-distance template tables);
 *       Research/00a §race-specific-prep (taper length by distance).
 */
export type DistCategory = '5k' | '10k' | 'hm' | 'm';
export function distanceCategoryOfPublic(raceDistanceMi: number): DistCategory {
  return distanceCategoryOf(raceDistanceMi);
}
function distanceCategoryOf(raceDistanceMi: number): DistCategory {
  if (raceDistanceMi >= 20) return 'm';
  if (raceDistanceMi >= 11) return 'hm';
  if (raceDistanceMi >= 5)  return '10k';
  return '5k';
}

/** Per-category structural numbers per Research/22 + canonical Daniels. */
const BLOCK_SHAPE: Record<DistCategory, { taperWeeks: number; raceSpecificCap: number }> = {
  '5k':  { taperWeeks: 1, raceSpecificCap: 2 }, // short, fast races · minimal taper
  '10k': { taperWeeks: 2, raceSpecificCap: 3 },
  'hm':  { taperWeeks: 2, raceSpecificCap: 3 },
  'm':   { taperWeeks: 3, raceSpecificCap: 4 },
};

function sizeBlocks(totalWeeks: number, raceDistanceMi: number, isMidBlock: boolean = false): BlockPlan {
  const cat = distanceCategoryOf(raceDistanceMi);
  const shape = BLOCK_SHAPE[cat];
  const taperWeeks       = shape.taperWeeks;
  // Race-specific = the closest-to-race quality block. Sized by race distance,
  // squeezed only if total runway is too short.
  const raceSpecificWks  = Math.min(shape.raceSpecificCap, Math.max(0, totalWeeks - taperWeeks - 4));
  // Quality block: bigger when there's more runway, capped at 8.
  const remainingAfterTaperAndRS = totalWeeks - taperWeeks - raceSpecificWks;
  const qualityWeeks     = Math.min(8, Math.max(3, Math.floor(remainingAfterTaperAndRS * 0.6)));
  // Base: everything left, but capped at 8 weeks so we don't stall in aerobic
  // forever when the race is far out. If race is >6 months out, the user is
  // effectively in maintenance · the surplus weeks fold into base anyway.
  //
  // 2026-06-01 · mid-block awareness: when the runner has been doing
  // threshold/intervals in the last 28 days, an auto-rebuild that drops
  // them back into a fresh BASE phase is a regression. Skip BASE entirely
  // (baseWeeks = 0) · the freed weeks fold into expandedQuality below.
  // 2026-06-03 · mid-block doctrine RULE 6 (phase compression).
  // Two triggers for skipping BASE:
  //   1. isMidBlock=true · runner has been doing quality recently
  //   2. totalWeeks < 10 · not enough runway to justify a base block
  // either case, BASE folds into QUALITY via the extraWeeks redistribute.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 6
  const baseWeeksRaw     = Math.min(8, Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks));
  const baseWeeks        = (isMidBlock || totalWeeks < 10) ? 0 : baseWeeksRaw;
  // If base was capped, redistribute the extras into quality so we don't end
  // up with fewer total weeks than the runway.
  const extraWeeks       = Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks - baseWeeks);
  const expandedQuality  = qualityWeeks + extraWeeks;

  // Build phase list in chronological order (oldest → race day).
  const phases: BlockPlan['phases'] = [];
  if (baseWeeks > 0) phases.push({
    label: 'BASE',
    weeks: baseWeeks,
    rationale: 'Aerobic foundation · easy volume + long progressions, no quality yet.',
    citation: 'Research/00a-distance-running-training.md §periodization',
  });
  if (expandedQuality > 0) phases.push({
    label: 'QUALITY',
    weeks: expandedQuality,
    rationale: 'Intervals + threshold sessions to lift aerobic ceiling.',
    citation: 'Research/04-workout-vocabulary.md §intervals-and-threshold',
  });
  if (raceSpecificWks > 0) phases.push({
    label: 'RACE-SPECIFIC',
    weeks: raceSpecificWks,
    rationale: 'Pace + long-run integration at race-specific demands.',
    citation: 'Research/00a-distance-running-training.md §race-specific',
  });
  phases.push({
    label: 'TAPER',
    weeks: taperWeeks,
    rationale: 'Volume drops sharply, intensity preserved. Sharpen, then race.',
    citation: 'Research/08-pacing-and-race-week.md §taper',
  });

  return { totalWeeks, phases };
}

// ── Volume curve ────────────────────────────────────────────────────────

/** Experience-level volume floor + ramp tuning (Q-01 / SIM-02).
 *
 * Without these, a true beginner running 5 mpw who picks a goal race got
 * an immediate jump to 15 mpw (3× their actual base) in week 1 — way
 * over the 10% rule. With these, each level has a sensible floor that
 * matches research-grounded base mileage by experience.
 *
 * Cite: Research/00a-distance-running-training.md §volume-by-experience
 * Cite: Research/22-plan-templates.md §minimum-base-by-level
 */
type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
const VOLUME_FLOOR_MPW: Record<Exclude<LevelKey, null>, number> = {
  beginner: 10,
  intermediate: 15,
  advanced: 20,
  advanced_plus: 25,
};
const RAMP_PCT: Record<Exclude<LevelKey, null>, number> = {
  beginner: 0.05,         // conservative 5%/wk for new runners
  intermediate: 0.07,
  advanced: 0.07,
  advanced_plus: 0.08,    // capable of slightly more aggressive ramp
};

/** Returns target mileage for each week 0..N-1 (chronological).
 *
 * 2026-06-02 rewrite (David's fail-proof generator ask):
 *   · ramp geometrically from baseMi to tier.peakWeeklyMileageBand[0]
 *     (the tier's LOWER bound · ambitious but doctrine-safe)
 *   · cutback every 4th non-taper week to 85% of last peak
 *   · taper math unchanged
 *
 * The geometric ramp respects Research/00a §progressive-overload's
 * 10%/wk cap: when (peak/base)^(1/buildWeeks) > 1.10, we cap the
 * per-week growth at 10% and accept that the peak target won't be
 * fully reached. Honest about what's achievable in the runway.
 *
 * Cite: Research/00a-distance-running-training.md §progressive-overload
 * Cite: Research/22-plan-templates.md (tier targets via TIER_TARGETS)
 * Cite: Research/08-pacing-and-race-week.md §taper
 */
function volumeCurve(
  baseMi: number,
  blocks: BlockPlan,
  level: LevelKey,
  tierTarget: TierTarget,
  /** 2026-06-03 · Rule 8 · Banister TSB at generate-time. When < -10
   *  (high cumulative stress), shift cutback frequency from every 4th
   *  week to every 3rd week. null = cold-start, falls back to mod-4. */
  tsbAtStart?: number,
): number[] {
  const vols: number[] = [];
  const floor = level ? VOLUME_FLOOR_MPW[level] : VOLUME_FLOOR_MPW.intermediate;
  // 2026-06-03 · mid-block doctrine RULE 4 (monotonic volume floor) ·
  // enforced after vols are built (see end of function). `start` is
  // already max(VOLUME_FLOOR, baseMi); the post-build sweep guarantees
  // non-cutback non-taper weeks stay ≥ baseMi - 1.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 4
  const start = Math.max(floor, baseMi);
  // Peak target · LOWER band of the tier so it's achievable from a
  // realistic base. If the runner already exceeds the lower band,
  // aim 10% above their current base (still respects tier doctrine).
  const peakTarget = Math.max(
    tierTarget.peakWeeklyMileageBand[0],
    Math.round(start * 1.10),
  );

  // Build phases · everything before TAPER. Each is a ramp week or a
  // deload (every 4th non-taper week). We pre-mark deload positions
  // along the build span so the ramp targets the right week.
  const buildPhases = blocks.phases.filter((p) => p.label !== 'TAPER');
  const buildWeeks = buildPhases.reduce((s, p) => s + p.weeks, 0);
  // 2026-06-03 · mid-block doctrine RULE 8 (cutback frequency).
  // When tsbAtStart < -10, runner has high cumulative load · shift
  // cutbacks from every 4th week to every 3rd week. Otherwise mod-4.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 8
  // Cite: Pfitzinger Faster Road Racing §"recovery weeks under load"
  const cutbackEveryN = (typeof tsbAtStart === 'number' && tsbAtStart < -10) ? 3 : 4;
  const deloadMask: boolean[] = [];
  for (let i = 0; i < buildWeeks; i++) {
    deloadMask.push(i > 0 && (i + 1) % cutbackEveryN === 0);
  }
  const climbWeeks = deloadMask.filter((d) => !d).length;

  // Geometric ramp factor across climb weeks (skipping deloads).
  // Capped at 10%/week per progressive-overload doctrine.
  const idealFactor = climbWeeks > 1 && peakTarget > start
    ? Math.pow(peakTarget / start, 1 / (climbWeeks - 1))
    : 1.0;
  const climbFactor = Math.min(1.10, idealFactor);

  // Walk climb weeks · target = start * climbFactor^N where N is
  // the climbing-week index (skips deloads). Deload weeks = previous
  // climb week × 0.85.
  let climbIdx = 0;
  let lastClimb = start;
  let lastPeak = start;
  for (let i = 0; i < buildWeeks; i++) {
    if (deloadMask[i]) {
      const deload = Math.round(lastClimb * 0.85);
      vols.push(deload);
    } else {
      const target = start * Math.pow(climbFactor, climbIdx);
      const rounded = Math.round(Math.min(target, peakTarget));
      vols.push(rounded);
      lastClimb = rounded;
      lastPeak = Math.max(lastPeak, rounded);
      climbIdx++;
    }
  }

  // Taper phase · scale from lastPeak.
  const taperPhase = blocks.phases.find((p) => p.label === 'TAPER');
  if (taperPhase) {
    for (let w = 0; w < taperPhase.weeks; w++) {
      const wksLeft = taperPhase.weeks - w;
      const taperFactor = wksLeft === 1 ? 0.45 : wksLeft === 2 ? 0.60 : 0.75;
      vols.push(Math.round(lastPeak * taperFactor));
    }
  }

  // 2026-06-03 · mid-block doctrine RULE 4 (monotonic volume floor).
  // Sweep over non-deload non-taper weeks · ensure none dip below
  // baseMi - 1. This catches the edge case where rounding compresses
  // a climbing week below the runner's actual base (e.g. start = 35,
  // climbFactor = 1.04, climbIdx 0 = round(35) = 35 ✓ but a flat ramp
  // could land week 1 at round(35 × 1.04 × 0.85 cutback) = 31, which
  // is below baseMi). Deloads + taper allowed to step below.
  const monotonicFloor = Math.max(0, baseMi - 1);
  for (let i = 0; i < buildWeeks; i++) {
    if (deloadMask[i]) continue;
    if (vols[i] < monotonicFloor) vols[i] = monotonicFloor;
  }
  return vols;
}

// ── Weekly layout ───────────────────────────────────────────────────────

interface DayPlan {
  dow: DOW;
  type: 'easy' | 'long' | 'threshold' | 'intervals' | 'tempo' | 'race' | 'rest' | 'shakeout';
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  notes: string;
}

/**
 * Resolved prescription strings for a (distance × phase × level) combo.
 *
 * Sourced from workout_library (Research/04 + 22), with the previous
 * hardcoded strings as a safety-net fallback. Building this map once per
 * plan generation keeps layoutWeek sync.
 */
export interface ResolvedPrescriptions {
  intervals: string;
  threshold: string;
  tempo: string;   // formula-based; library row is optional
  citationInterval: string;
  citationThreshold: string;
}

/** Inline last-resort prescriptions — match the historical doctrine in this
 *  file. Library reads supersede these.
 *
 *  Exported 2026-06-02 so the generator-bench test can call composePlan
 *  without going through the DB workout_library query. */
export function inlinePrescriptions(cat: DistCategory): ResolvedPrescriptions {
  return {
    intervals:
        cat === '5k'  ? '5×800m @ I pace · 90s jog'
      : cat === '10k' ? '4×1km @ I pace · 2:00 jog'
      : cat === 'hm'  ? '6×800m @ I pace · 90s jog'
      :                 '5×1mi @ I-T transition · 2:00 jog',
    threshold:
        cat === '5k'  ? '3×1mi @ T pace · 60s jog'
      : cat === '10k' ? '4×1km @ T pace · 60s jog'
      : cat === 'hm'  ? '3×1mi @ T pace · 2:00 jog'
      :                 '4×1mi @ T pace · 90s jog',
    tempo:        'continuous tempo',
    citationInterval:  'Research/04-workout-vocabulary.md §6',
    citationThreshold: 'Research/04-workout-vocabulary.md §5',
  };
}

/**
 * Resolve prescription strings for one plan, preferring the workout_library
 * table. Falls back to the inline catalog on any miss so plan generation
 * never blocks.
 */
async function resolvePrescriptions(
  cat: DistCategory,
  phase: 'quality' | 'race_specific',
  level: LevelKey,
): Promise<ResolvedPrescriptions> {
  const fallback = inlinePrescriptions(cat);
  const lvl = level ?? undefined;

  const phaseFit = phase === 'race_specific' ? 'race_specific' : 'quality';

  const [intervalsT, thresholdT] = await Promise.all([
    pickWorkout({ family: 'vo2max' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl }),
    pickWorkout({ family: 'threshold' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl }),
  ]);

  return {
    intervals:        intervalsT?.prescriptionText  ?? fallback.intervals,
    threshold:        thresholdT?.prescriptionText  ?? fallback.threshold,
    tempo:            fallback.tempo,
    citationInterval: intervalsT?.citation          ?? fallback.citationInterval,
    citationThreshold: thresholdT?.citation         ?? fallback.citationThreshold,
  };
}

function layoutWeek({
  phase, weekIdx, totalWeeks, weeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi, rx, easyMileFloor, recentLongMi, recentQualityDistanceMi, tierTarget,
}: {
  phase: string; weekIdx: number; totalWeeks: number;
  weeklyMi: number; longRunDow: DOW; qualityDows: DOW[]; restDow: DOW;
  isRaceWeek: boolean; raceDow: DOW | null; raceDistanceMi: number;
  rx: ResolvedPrescriptions;
  /** 2026-06-03 · runner's recent peak long · floors longMi so plan
   *  never asks for a long shorter than what the runner just did. */
  recentLongMi?: number;
  /** 2026-06-03 · Rule 2 · runner's typical quality-day distance ·
   *  floors qualityMiEach so plan never asks for a shorter tempo/
   *  threshold than the runner is already running. */
  recentQualityDistanceMi?: number;
  /** 2026-06-01 · runner's actual 14-day easy-day median. Floors the
   *  per-easy distance in non-race weeks so the plan never asks for a
   *  4.5-mi easy day when the runner is comfortably running 6+ mi
   *  easy. Pass 0 to skip the floor (falls back to historical math). */
  easyMileFloor?: number;
  /** 2026-06-02 · tier targets from Research/22 (via lookupTierTarget).
   *  Drives longShare + caps the long-run upper bound at the tier
   *  band. Without it, the generator was producing goal-blind plans. */
  tierTarget: TierTarget;
}): DayPlan[] {
  // Race week: all roads lead to race day.
  if (isRaceWeek && raceDow != null) {
    const days: DayPlan[] = [];
    for (let d = 0; d < 7; d++) {
      const dow = d as DOW;
      if (dow === raceDow) {
        days.push({
          dow, type: 'race', distanceMi: raceDistanceMi, isQuality: true, isLong: true,
          subLabel: 'RACE', notes: 'Execute the plan. Pacing in race-week briefing.',
        });
      } else {
        // Day before race: 2mi shakeout w/ strides. 2 days before: rest.
        const daysBeforeRace = (raceDow - dow + 7) % 7;
        if (daysBeforeRace === 1) {
          days.push({ dow, type: 'shakeout', distanceMi: 2, isQuality: false, isLong: false, subLabel: 'SHAKEOUT', notes: '2 mi + 4×20s strides. Loosen the legs.' });
        } else if (daysBeforeRace === 2) {
          days.push({ dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off feet. Hydrate.' });
        } else if (daysBeforeRace >= 3 && daysBeforeRace <= 5) {
          // Easy 3-4mi w/ light strides midweek
          days.push({ dow, type: 'easy', distanceMi: 3 + (daysBeforeRace === 4 ? 1 : 0), isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational. Strides optional.' });
        } else {
          days.push({ dow, type: daysBeforeRace > 5 ? 'easy' : 'rest', distanceMi: daysBeforeRace > 5 ? 4 : 0, isQuality: false, isLong: false, subLabel: daysBeforeRace > 5 ? 'EASY' : 'REST', notes: '' });
        }
      }
    }
    return days;
  }

  // Standard week: 1 long, 1-2 quality, rest = easy, 1 rest day.
  // 2026-06-02 · longShare is tier-driven (from Research/22). BASE
  // phase keeps a lower share since the long is the only quality.
  // TAPER pulls back to a recovery long. QUALITY + RACE-SPECIFIC use
  // the full tier share.
  const longShare = phase === 'BASE' ? Math.max(0.28, tierTarget.longRunShare - 0.04)
                  : phase === 'TAPER' ? 0.28
                  : tierTarget.longRunShare;
  const qualityShare = phase === 'BASE' ? 0
                     : phase === 'TAPER' ? 0.18
                     : 0.22;  // total across quality days
  // Cap long at the tier's peakLong upper bound · no overdistance
  // beyond what doctrine prescribes. Use the higher of two sizes:
  //   · weeklyMi × longShare (the volume-curve derived target)
  //   · runner's recent peak long (don't author a shorter long than
  //     they just did · 2026-06-03 fix · David's plan was sizing
  //     Sun 6/7 at 9mi when his 5/31 long was 12.36mi).
  // Allow cutback weeks to step slightly below the recentLong floor.
  const isCutback = weekIdx > 0 && (weekIdx + 1) % 4 === 0;
  const longMiRaw = Math.round(weeklyMi * longShare);
  const longCap = tierTarget.peakLongMiBand[1];
  const longFloor = recentLongMi && recentLongMi >= 8
    ? Math.round(recentLongMi - (isCutback ? 2 : 0))
    : 0;
  const longMi = Math.min(
    Math.max(longMiRaw, longFloor),
    longCap,
  );
  // 2026-06-03 · mid-block doctrine RULE 2 (quality distance floor).
  // Floor qualityMiEach at the runner's recent quality-day distance ·
  // 1mi (the −1mi tolerance lets rep-shape work fit). Cap at the
  // weeklyMi share so we don't blow weekly budget on quality.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 2
  const qualityRaw = qualityDows.length > 0 ? Math.round((weeklyMi * qualityShare) / qualityDows.length) : 0;
  const qualityFloor = (recentQualityDistanceMi && recentQualityDistanceMi >= 5)
    ? Math.max(0, recentQualityDistanceMi - 1)
    : 0;
  const qualityMiEach = Math.max(qualityRaw, qualityFloor);

  // Pre-allocate: rest = 0, long + quality slotted in
  const slots: (DayPlan | null)[] = new Array(7).fill(null);
  slots[restDow] = { dow: restDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  // 2026-06-02 · race-pace label varies by race distance · "MP" only
  // makes sense for a marathon target. HM target → HM pace. 5K/10K
  // target → no MP insert at all (those distances train via reps, not
  // long-run pace inserts).
  const racePaceTag = raceDistanceMi >= 25 ? 'MP'
                    : raceDistanceMi >= 12 ? 'HM'
                    : null;
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    subLabel: phase === 'RACE-SPECIFIC' && racePaceTag
      ? `LONG · ${Math.round(longMi * 0.4)}mi @ ${racePaceTag}`
      : 'LONG',
    notes: phase === 'RACE-SPECIFIC' && racePaceTag
      ? `Steady ${longMi - Math.round(longMi * 0.4)}mi, then ${Math.round(longMi * 0.4)}mi at ${racePaceTag === 'MP' ? 'marathon pace' : 'half-marathon pace'}.`
      : phase === 'TAPER' ? 'Easy long, hold pace. Quality lives in the race itself.'
      : 'Conversational throughout. Build the engine.',
  };
  if (phase !== 'BASE') {
    // Q-02 fix: quality mix now varies by race distance per Research/22.
    // 5K leans VO2max heavy (intervals); 10K balanced threshold + intervals;
    // HM threshold-dominant + race-specific MP; M long-run + threshold +
    // marathon-pace integration. Race-specific phase still steers harder
    // toward race-specific quality regardless of distance.
    const cat = distanceCategoryOf(raceDistanceMi);
    const qualityTypes: Array<DayPlan['type']> =
        phase === 'TAPER'         ? ['threshold']                                     // tune-up · same for all distances
      : phase === 'RACE-SPECIFIC'
          ? (cat === '5k'   ? ['intervals', 'intervals']
           : cat === '10k'  ? ['threshold', 'intervals']
           : cat === 'hm'   ? ['threshold', 'tempo']
           : /* m */          ['tempo', 'threshold'])
      : phase === 'QUALITY'
          ? (cat === '5k'   ? (weekIdx % 2 === 0 ? ['intervals', 'intervals'] : ['intervals', 'threshold'])
           : cat === '10k'  ? (weekIdx % 2 === 0 ? ['intervals', 'threshold'] : ['threshold', 'tempo'])
           : cat === 'hm'   ? (weekIdx % 2 === 0 ? ['intervals', 'threshold'] : ['threshold', 'tempo'])
           : /* m */          (weekIdx % 2 === 0 ? ['threshold', 'tempo']     : ['threshold', 'intervals']))
      : [];
    // Prescription strings are resolved up-front from workout_library
    // (Research/04 + 22) via resolvePrescriptions() — falls back to the
    // historical inline catalog if the library has no matching row.
    qualityDows.forEach((dow, i) => {
      if (slots[dow] != null) return; // conflict · skip
      const qt = qualityTypes[i % qualityTypes.length];
      const sub =
        qt === 'intervals'  ? rx.intervals
      : qt === 'threshold'  ? rx.threshold
      : qt === 'tempo'      ? `${Math.max(3, Math.round(qualityMiEach * 0.6))}mi ${rx.tempo}`
      :                       'QUALITY';
      // 2026-06-02 · the workout_library uses family='threshold' for
      // BOTH rep-based cruise intervals AND continuous tempos (both
      // are T-pace work in Daniels' taxonomy). When the picked library
      // row's prescription describes a continuous tempo
      // ("N mi WU · M mi @ T · N mi CD"), the row's TYPE should be
      // 'tempo' so spec-builder produces a tempo spec (not a rep spec).
      // Without this remap, the runner sees a sub_label promising
      // continuous tempo over a workout_spec that's actually 4×1mi reps.
      let effectiveType = qt;
      if (qt === 'threshold' && /\d+\s*(?:mi)?\s*WU\s*[·•].*@\s*T[^·•]*[·•]\s*\d+\s*(?:mi)?\s*CD/i.test(sub)) {
        effectiveType = 'tempo';
      }
      slots[dow] = {
        dow: dow as DOW, type: effectiveType, distanceMi: qualityMiEach, isQuality: true, isLong: false,
        subLabel: sub,
        notes:
          effectiveType === 'intervals' ? 'WU 1.5mi, reps, CD 1mi. Hold pace, even splits.'
        : effectiveType === 'threshold' ? 'WU 1.5mi, threshold reps, CD 1mi. Comfortably hard.'
        : effectiveType === 'tempo'     ? 'WU, continuous tempo block, CD. Just below threshold.'
        :                                  '',
      };
    });
  }

  // Fill remaining slots with easy.
  //
  // 2026-06-01 · `perEasy` is now floored by the runner's actual 14-day
  // easy-day median when available (`easyMileFloor`). This closes a
  // generator gap: the volume_drift cron fires at >40% deviation, but
  // a runner whose real easy-day baseline is 6+ mi will silently be
  // asked for 4.5 mi easy days when week budget math comes in low ·
  // a 25-30% gap that's invisible to drift detection but obvious to
  // the runner ("my easy runs are usually 5-6 miles · why is the
  // plan asking for 4.5?"). The floor catches this case.
  //
  // Race-week distances stay template-controlled · taper math overrides
  // the floor (handled by the early return for isRaceWeek above).
  const allocated = slots.filter(Boolean).reduce((s, d) => s + (d!.distanceMi || 0), 0);
  const remainingMi = Math.max(0, weeklyMi - allocated);
  const easySlots = slots
    .map((s, i) => ({ slot: s, dow: i as DOW }))
    .filter((x) => x.slot == null);
  const mathFloor = 3;
  const baselineFloor = easyMileFloor && easyMileFloor > 0 ? easyMileFloor : 0;
  // BASE and CUTBACK weeks may legitimately step down · don't over-floor
  // a deliberate deload. CUTBACK = 4th week per volumeCurve.
  // Otherwise floor to the runner's real baseline rounded to .5.
  const isDeloadOrBase = phase === 'BASE';
  const effectiveFloor = isDeloadOrBase
    ? mathFloor
    : Math.max(mathFloor, baselineFloor);
  const perEasyRaw = easySlots.length > 0 ? Math.round(remainingMi / easySlots.length) : 0;
  const perEasy = Math.max(effectiveFloor, perEasyRaw);
  for (const { dow } of easySlots) {
    slots[dow] = {
      dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false,
      subLabel: 'EASY', notes: 'Conversational. Z2 HR cap.',
    };
  }

  return slots as DayPlan[];
}

// ── Pure compose layer (2026-06-02) ─────────────────────────────────────
// Extracted from generatePlan() so the plan-engine bench can test the
// actual plan output against persona doctrine targets without a database.
// generatePlan() is the I/O wrapper · loadGeneratorInputs() gathers all
// the DB-sourced facts and bundles them into a ComposePlanInput · then
// composePlan() does the pure work and returns the plan shape ·
// persistPlan() writes it.
//
// All branching that depends on user data lives in loadGeneratorInputs,
// the test bench, or persona fixtures. composePlan is mechanically
// deterministic against a fixed input.

export interface ComposePlanInput {
  raceDistanceMi: number;
  goalSec: number | null;
  goalPaceSec: number | null;
  /** Race day ISO date (YYYY-MM-DD). */
  raceDateISO: string;
  /** Monday of the plan start week (YYYY-MM-DD). Caller computes from
   *  today() · keeps composePlan pure (no Date.now()). */
  startMondayISO: string;
  level: LevelKey;
  recentWeeklyMi: number;
  easyDayMedianMi: number;
  /** 2026-06-03 · runner's recent peak long-run distance · floors the
   *  long-run sizing so the plan can't ask for a shorter long than the
   *  runner just did. 0 = no floor (cold start). */
  recentLongMi: number;
  /** 2026-06-03 · mid-block runner doctrine carriers. Optional · all
   *  default to 0/undefined for cold-start runners. Bench persona
   *  "david-mid-block" exercises each as a gap-rule assertion. See
   *  docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md for the full ruleset. */
  /** Runner's typical quality-day distance (mi) over last 28d · floors
   *  per-quality distance (Rule 2 · GAP). */
  recentQualityDistanceMi?: number;
  /** Median quality sessions per week over last 28d · density-ramp anchor
   *  (Rule 5 · GAP). */
  recentQualityPerWeek?: number;
  /** Best recent VDOT from races or quality runs in last 60d · pace-
   *  anchor blend source (Rule 3). When < tier-implied VDOT, early
   *  weeks anchor to this and ramp toward the goal tier. */
  bestRecentVdot?: number;
  /** Banister TSB at generate-time · shifts cutback frequency to every
   *  3rd week when TSB < -10 (Rule 8). Optional · falls back to mod-4. */
  tsbAtStart?: number;
  /** 2026-06-03 · Rule 11 · horizon races · A/B-priority races within 24
   *  weeks of raceDateISO. When any has a LARGER tier band than the
   *  current race's tier, long-run dials (cap + share) extend toward
   *  that larger band. Weekly cap + quality density stay current-race.
   *  Empty/undefined = no horizon. Cite: §Rule 11 + Pfitz Advanced
   *  Marathoning §"Bridging from half to full." */
  horizonRaces?: Array<{
    slug: string;
    name: string;
    date: string;
    distanceMi: number;
    goalPaceSec: number | null;
    priority: 'A' | 'B';
  }>;
  isMidBlock: boolean;
  longRunDow: DOW;
  restDow: DOW;
  qualityDows: DOW[];
  /** Profile cross-training modes · drives rest-day relabeling. */
  crossModes: string[];
  rxQuality: ResolvedPrescriptions;
  rxRaceSpecific: ResolvedPrescriptions;
  tPaceSec: number | null;
  lthr: number | null;
  /** 2026-06-03 · Rule 16 · maxHr for the easy/long HR cap doctrine.
   *  Optional · null falls back to LTHR-only cap. */
  maxHr: number | null;
}

export interface ComposedWeek {
  startISO: string;
  phase: string;
  weeklyMi: number;
  days: DayPlan[];
  isRaceWeek: boolean;
  /** 2026-06-03 · Rule 3 · per-week T-pace from the bestRecentVdot →
   *  goalT blend. persistPlan writes this into each quality row's
   *  pace_target_s_per_mi instead of the plan-wide tPaceSec. */
  tPaceSec?: number | null;
}

export interface ComposePlanResult {
  weeks: ComposedWeek[];
  blocks: BlockPlan;
  totalWeeks: number;
  vols: number[];
  /** Bundle that persistPlan writes verbatim to training_plans.authored_state. */
  authoredState: Record<string, unknown>;
}

/**
 * Pure plan composition · no DB, no clock. Given a ComposePlanInput,
 * returns the full plan shape ready for persistence + the authored_state
 * blob.
 *
 * Tests assert this function against persona doctrine targets ·
 * `expectedPlan.peakWeeklyMileageBand`, `longRunShare`, etc.
 */
export function composePlan(input: ComposePlanInput): ComposePlanResult {
  // 2026-06-02 · totalWeeks MUST be an integer · was fractional for
  // non-Monday races (race day Sun = 6 days span, 7×N-1 days = N
  // weeks - 1/7). Fractional weeks made phaseWkRemaining never hit
  // exactly 0, so phase advancement broke and plans stayed in BASE
  // for the entire runway. Caught by the generator bench.
  const totalWeeks = Math.max(3,
    Math.floor(daysBetween(input.startMondayISO, input.raceDateISO) / 7) + 1
  );
  const blocks = sizeBlocks(totalWeeks, input.raceDistanceMi, input.isMidBlock);
  // 2026-06-02 · tier targets drive volume + long-run sizing.
  // Sourced from Research/22 via lookupTierTarget. Classification
  // uses goalPaceSec; falls back to intermediate tier when no goal.
  const { tier, target: baseTierTarget } = lookupTierTarget(
    input.goalPaceSec,
    input.raceDistanceMi,
  );

  // 2026-06-03 · Rule 11 · horizon-aware long-run dials.
  // Find the most demanding A/B race within 24 weeks. If its tier's
  // long-run band exceeds the current race's, override the long dials
  // (cap + share) so the current plan sets up the future block's long
  // progression. Weekly + quality stay at current-race tier. Cite §11.
  const horizonRaise = (() => {
    const horizon = input.horizonRaces ?? [];
    if (horizon.length === 0) return null;
    // For each horizon race, compute its tier target.
    let bestCap = baseTierTarget.peakLongMiBand[1];
    let bestShare = baseTierTarget.longRunShare;
    let bestRace: { slug: string; name: string; date: string; distanceMi: number } | null = null;
    for (const h of horizon) {
      const { target: ht } = lookupTierTarget(h.goalPaceSec, h.distanceMi);
      // Only LARGER bands count · we extend up, never contract down.
      if (ht.peakLongMiBand[1] > bestCap || ht.longRunShare > bestShare) {
        if (ht.peakLongMiBand[1] > bestCap) bestCap = ht.peakLongMiBand[1];
        if (ht.longRunShare > bestShare) bestShare = ht.longRunShare;
        bestRace = { slug: h.slug, name: h.name, date: h.date, distanceMi: h.distanceMi };
      }
    }
    if (!bestRace) return null;
    return {
      fromLongCapMi: baseTierTarget.peakLongMiBand[1],
      toLongCapMi: bestCap,
      fromLongShare: baseTierTarget.longRunShare,
      toLongShare: bestShare,
      race: bestRace,
    };
  })();

  // Tier target used by the layout · when horizon raise is active:
  //   · long cap extends to horizon race's cap
  //   · long share extends to horizon race's share
  //   · weekly peakTarget shifts from lower-band toward mid-band so the
  //     plan has enough weekly volume to support the bigger long runs
  //   · weekly UPPER band stays current-race (don't blow up HM training
  //     intensity for marathon-prep ambition)
  //   · qualityPerWeek stays current-race (we're still sharpening for
  //     the immediate goal, not the horizon goal)
  const tierTarget: TierTarget = horizonRaise ? {
    ...baseTierTarget,
    peakLongMiBand: [baseTierTarget.peakLongMiBand[0], horizonRaise.toLongCapMi],
    longRunShare: horizonRaise.toLongShare,
    peakWeeklyMileageBand: [
      Math.round((baseTierTarget.peakWeeklyMileageBand[0] + baseTierTarget.peakWeeklyMileageBand[1]) / 2),
      baseTierTarget.peakWeeklyMileageBand[1],
    ],
  } : baseTierTarget;

  const vols = volumeCurve(input.recentWeeklyMi, blocks, input.level, tierTarget, input.tsbAtStart);

  // 2026-06-03 · mid-block doctrine RULE 5 (quality density ramp).
  // When the runner's recent quality habit is below their prefs/tier
  // target density, ramp UP by ≤1 session per 4 weeks. NEVER slice
  // below the runner's prefs · the slicing was producing extra easy
  // slots on cold-start personas (ultra · qualityDows=[2,4], tierQ=1
  // → sliced to [2] → 5 easies instead of 4 → 113mi weekly vs 100mi
  // tier cap). The desired-density anchor is the runner's prefs
  // (qualityDows.length), not the tier table. Tier informs ramp
  // CEILING, not floor. Cite: §Rule 5 (refined 2026-06-03).
  const tierQ = tierTarget.qualityPerWeek;
  const desiredDensity = input.qualityDows.length;
  const recentQ = (typeof input.recentQualityPerWeek === 'number' && input.recentQualityPerWeek >= 0)
    ? input.recentQualityPerWeek
    : desiredDensity; // cold-start defaults to prefs
  function densityForWeek(weekIdx: number, phase: string): number {
    if (phase === 'BASE' || phase === 'TAPER') return desiredDensity;
    // Habit ≥ tier OR habit ≥ prefs · no slicing, use prefs.
    if (recentQ >= tierQ || recentQ >= desiredDensity) return desiredDensity;
    // Habit genuinely below target · ramp habit → desired over 4wk.
    const stepsUp = Math.min(4, weekIdx);
    return Math.min(desiredDensity, Math.round(recentQ + (desiredDensity - recentQ) * (stepsUp / 4)));
  }

  // 2026-06-03 · mid-block doctrine RULE 3 (pace anchor blend).
  // When bestRecentVdot implies a T-pace slower than goal-T, anchor
  // early-week paces to currentT and blend toward goalT by mid-build.
  // Returns null when no recent VDOT signal or runner already at goal.
  // Cite: §Rule 3.
  const goalT = tPaceFromGoal(input.goalSec, input.raceDistanceMi) ?? input.tPaceSec;
  const currentT = tPaceFromVdot(input.bestRecentVdot);
  function tPaceForWeek(weekIdx: number, phase: string): number | null {
    if (goalT == null) return null;
    if (currentT == null || currentT <= goalT) return goalT; // at/above goal
    if (phase === 'BASE' || phase === 'TAPER') return goalT; // late blend complete
    // Blend over first 60% of the build · weekIdx ramps in [0, 1].
    const buildWeeks = blocks.phases.filter((p) => p.label !== 'TAPER')
      .reduce((s, p) => s + p.weeks, 0);
    const denom = Math.max(1, Math.round(buildWeeks * 0.6));
    const blend = Math.min(1, weekIdx / denom);
    return Math.round(currentT + (goalT - currentT) * blend);
  }

  const weeks: ComposedWeek[] = [];
  let phaseCursor = 0;
  let phaseWkRemaining = blocks.phases[0].weeks;
  let phaseLabel = blocks.phases[0].label;
  for (let wi = 0; wi < totalWeeks; wi++) {
    while (phaseWkRemaining === 0) {
      phaseCursor++;
      phaseWkRemaining = blocks.phases[phaseCursor].weeks;
      phaseLabel = blocks.phases[phaseCursor].label;
    }
    const weekStart = addDays(input.startMondayISO, wi * 7);
    const isRaceWeek = wi === totalWeeks - 1;
    const raceDow: DOW | null = isRaceWeek
      ? ((new Date(input.raceDateISO + 'T12:00:00Z').getUTCDay()) as DOW)
      : null;
    const rx = phaseLabel === 'RACE-SPECIFIC' ? input.rxRaceSpecific : input.rxQuality;
    // 2026-06-03 · Rule 5 · slice qualityDows to per-week density.
    // The runner's preferences list ≤2 quality days; if density says 1,
    // we pick the first entry; if 2, all; if 0 (BASE), already handled
    // inside layoutWeek's `phase === 'BASE'` branch via empty quality.
    const weekDensity = densityForWeek(wi, phaseLabel);
    const weekQualityDows = input.qualityDows.slice(0, weekDensity);
    // 2026-06-03 · Rule 3 · per-week T-pace.
    const weekT = tPaceForWeek(wi, phaseLabel);
    const days = layoutWeek({
      phase: phaseLabel,
      weekIdx: wi,
      totalWeeks,
      weeklyMi: vols[wi],
      longRunDow: input.longRunDow,
      qualityDows: weekQualityDows,
      restDow: input.restDow,
      isRaceWeek,
      raceDow,
      raceDistanceMi: input.raceDistanceMi,
      rx,
      easyMileFloor: input.easyDayMedianMi,
      recentLongMi: input.recentLongMi,
      recentQualityDistanceMi: input.recentQualityDistanceMi,
      tierTarget,
    });
    // P34 · cross-training opt-in · rotate enabled modes across the
    // rest day. Same logic that used to live in generatePlan's loop.
    if (input.crossModes.length > 0) {
      const restDay = days.find((d) => d.type === 'rest' && d.distanceMi === 0);
      if (restDay) {
        const mode = input.crossModes[wi % input.crossModes.length];
        const subLabel = mode === 'strength' ? 'STRENGTH'
          : mode === 'bike' ? 'BIKE 45-60 MIN'
          : mode === 'swim' ? 'SWIM 30-40 MIN'
          : 'CROSS-TRAIN';
        restDay.subLabel = subLabel;
        restDay.notes = `Cross-training: ${mode}. Easy effort. Not a run replacement · keeps the engine humming on a non-impact day.`;
      }
    }
    weeks.push({ startISO: weekStart, phase: phaseLabel, weeklyMi: vols[wi], days, isRaceWeek, tPaceSec: weekT });
    phaseWkRemaining--;
  }

  return {
    weeks,
    blocks,
    totalWeeks,
    vols,
    authoredState: {
      total_weeks: totalWeeks,
      race_distance_mi: input.raceDistanceMi,
      goal_pace_s_per_mi: input.goalPaceSec,
      recent_avg_mpw: input.recentWeeklyMi,
      weeklyAvg4w: input.recentWeeklyMi,
      is_mid_block: input.isMidBlock,
      t_pace_s_per_mi: input.tPaceSec,
      lthr_bpm: input.lthr,
      // 2026-06-02 · tier classification for downstream consumers
      // (gap-report, projection snapshots, brief).
      goal_tier: tier,
      tier_peak_weekly_band: tierTarget.peakWeeklyMileageBand,
      tier_peak_long_band: tierTarget.peakLongMiBand,
      // 2026-06-03 · Rule 11 · horizon raise. Null when no future race
      // raises the long-run cap above the current tier's. Drives the
      // chip on the plan UI ("LONG-RUN CAP · 22mi · setting up CIM").
      horizon_raise: horizonRaise,
      // 2026-06-03 · Rule 10 · transparency envelope so the runner can
      // audit which signals drove their plan. Surfaces in /plan brief
      // as "plan built from your last 28 days." Cite: §Rule 10.
      derived_from: {
        recentWeeklyMi: input.recentWeeklyMi,
        recentLongMi: input.recentLongMi,
        recentQualityPerWeek: input.recentQualityPerWeek ?? null,
        recentQualityDistanceMi: input.recentQualityDistanceMi ?? null,
        bestRecentVdot: input.bestRecentVdot ?? null,
        easyDayMedianMi: input.easyDayMedianMi,
        tsbAtStart: input.tsbAtStart ?? null,
      },
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

// ── Maintenance + Recovery composers ────────────────────────────────────
//
// 2026-06-03 · Rule 12 + 13 · pickPlanMode returns 'race-prep' for the
// existing composePlan path. These two functions handle the other modes.
//
// MAINTENANCE · runner has no race within build window. Hold aerobic
// fitness + leg turnover; volume + long drop to ~70-80% of peak; 1
// quality per week (threshold OR fartlek per tier); NO vo2/intervals.
// 4-week looping plan that regenerates monthly via the graduate cron.
//
// RECOVERY · 1-2 weeks immediately after a race. Very low volume,
// all easy + rest. Auto-transitions to maintenance OR race-prep.
//
// Cite: Pfitzinger Faster Road Racing §"Recovery & Off-Season Training"
// Cite: Daniels Running Formula 3rd ed §"Off-Season Training"

export interface ComposeNonRaceInput {
  startMondayISO: string;
  level: LevelKey;
  /** Recent 4-week avg weekly mileage · the maintenance anchor. */
  recentWeeklyMi: number;
  /** Runner's recent peak long · 28d max. Drops to longPctOfPeak in
   *  maintenance / recovery. */
  recentLongMi: number;
  /** Runner's recent peak weekly · last race-prep peak. When unknown,
   *  recentWeeklyMi serves as the proxy. */
  recentPeakWeeklyMi: number;
  easyDayMedianMi: number;
  longRunDow: DOW;
  restDow: DOW;
  qualityDows: DOW[];
  crossModes: string[];
  /** For maintenance: tier of the next race (so the maintenance shape
   *  matches the runner's level). For recovery: tier of the race that
   *  just finished. */
  tier: GoalTier;
  /** Next race (for context · maintenance plans show "X weeks until
   *  CIM build starts"). Null when no future race scheduled. */
  nextRace: { slug: string; name: string; date: string; distanceMi: number; goalPaceSec: number | null } | null;
  /** Last race finished (recovery mode only). */
  lastRaceFinished: { slug: string; name: string; date: string; distanceMi: number } | null;
  rxQuality: ResolvedPrescriptions;
  tPaceSec: number | null;
  lthr: number | null;
}

/**
 * Compose a 4-week maintenance plan. Single phase 'MAINTENANCE'. The
 * graduate cron regenerates this every 4 weeks until the next race
 * enters its build window, at which point it auto-transitions to
 * race-prep. Volume + long held at maintenance percentages of the
 * runner's recent peak; quality drops to 1/week; intervals removed.
 */
export function composeMaintenancePlan(input: ComposeNonRaceInput): ComposePlanResult {
  const shape = MAINTENANCE_BY_TIER[input.tier];
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);
  const targetWeekly = Math.round(peakAnchor * shape.weeklyPctOfPeak);
  const targetLong = Math.max(8, Math.round(input.recentLongMi * shape.longPctOfPeak));

  // 4-week rolling template. Days = tier's daysPerWeek. Rest = 7 -
  // daysPerWeek (so days held even though volume dropped).
  const TOTAL_WEEKS = 4;
  const weeks: ComposedWeek[] = [];
  const blocks: BlockPlan = {
    totalWeeks: TOTAL_WEEKS,
    phases: [{
      label: 'MAINTENANCE',
      weeks: TOTAL_WEEKS,
      rationale: 'Holding aerobic fitness · no race in build window. 1 quality, 1 long, easies otherwise.',
      citation: 'Research/00a-distance-running-training.md §off-season + Pfitzinger Faster Road Racing §Recovery & Off-Season',
    }],
  };

  // Layout one canonical week, then clone it for all 4. Cutback is just
  // a recovery-week step-down at week 3 (final week of cycle).
  function maintenanceWeek(weekIdx: number): DayPlan[] {
    const isCutback = weekIdx === 3; // week 4 (zero-indexed) = recovery
    const wkWeekly = isCutback ? Math.round(targetWeekly * 0.80) : targetWeekly;
    const wkLong = isCutback ? Math.max(8, Math.round(targetLong * 0.80)) : targetLong;

    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    // Rest day
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
    // Long run · simpler than race-prep (no race-pace inserts)
    slots[input.longRunDow] = {
      dow: input.longRunDow, type: 'long', distanceMi: wkLong, isQuality: false, isLong: true,
      subLabel: 'LONG',
      notes: 'Conversational. Maintenance long · holding aerobic base.',
    };
    // Quality day (skip when tier shape has qualityPerWeek=0)
    if (shape.qualityPerWeek > 0 && input.qualityDows.length > 0) {
      const qDow = input.qualityDows[0]; // single quality, first picked day
      if (slots[qDow] == null) {
        const qDist = Math.max(5, Math.round(wkWeekly * 0.16));
        if (shape.qualityType === 'threshold') {
          slots[qDow] = {
            dow: qDow, type: 'threshold', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${Math.max(3, Math.round(qDist * 0.5))}mi @ T pace · cruise`,
            notes: 'WU 1.5mi · steady at threshold · CD 1mi. Aerobic engine maintenance.',
          };
        } else if (shape.qualityType === 'fartlek') {
          slots[qDow] = {
            dow: qDow, type: 'tempo', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${qDist}mi w/ 6×1min surges`,
            notes: 'Easy with 1-minute pickups every 5 min. Leg turnover · not race-pace.',
          };
        }
      }
    }
    // Fill easies up to daysPerWeek
    const easyFloor = Math.max(3, input.easyDayMedianMi || 5);
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const easySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    const targetEasyCount = Math.min(easySlots.length, Math.max(0, shape.daysPerWeek - (slots.filter(Boolean).filter((d) => d?.distanceMi! > 0).length)));
    const perEasy = targetEasyCount > 0 ? Math.max(easyFloor, Math.round(easyMiBudget / targetEasyCount)) : 0;
    for (let i = 0; i < easySlots.length; i++) {
      const { dow } = easySlots[i];
      if (i < targetEasyCount) {
        slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational throughout.' };
      } else {
        // Extra slot · rest day (we're holding daysPerWeek, not adding)
        slots[dow] = { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
      }
    }
    return slots.filter(Boolean) as DayPlan[];
  }

  for (let wi = 0; wi < TOTAL_WEEKS; wi++) {
    const startISO = addDays(input.startMondayISO, wi * 7);
    weeks.push({
      startISO,
      phase: 'MAINTENANCE',
      weeklyMi: weeks[wi]?.weeklyMi ?? (wi === 3 ? Math.round(targetWeekly * 0.80) : targetWeekly),
      days: maintenanceWeek(wi),
      isRaceWeek: false,
      tPaceSec: input.tPaceSec,
    });
  }

  return {
    weeks,
    blocks,
    totalWeeks: TOTAL_WEEKS,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: {
      mode: 'maintenance',
      total_weeks: TOTAL_WEEKS,
      recent_avg_mpw: input.recentWeeklyMi,
      tier: input.tier,
      maintenance_shape: shape,
      target_weekly_mi: targetWeekly,
      target_long_mi: targetLong,
      next_race: input.nextRace,
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

/**
 * Compose a 1-2 week recovery plan. Very low volume; all easy + rest;
 * no quality. Transitions automatically to maintenance or race-prep
 * via the graduate cron when the recovery window closes.
 */
export function composeRecoveryPlan(input: ComposeNonRaceInput): ComposePlanResult {
  if (!input.lastRaceFinished) {
    // Shouldn't happen · recovery requires a finished race. Bail to a
    // single-week placeholder.
    return composeMaintenancePlan(input);
  }
  const lastCat = (input.lastRaceFinished.distanceMi <= 4) ? '5k'
    : input.lastRaceFinished.distanceMi <= 8 ? '10k'
    : input.lastRaceFinished.distanceMi <= 17 ? 'hm'
    : input.lastRaceFinished.distanceMi <= 30 ? 'm'
    : 'ultra';
  const recoveryWeeks = POST_RACE_RECOVERY_WEEKS[lastCat];
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);

  // Pfitz: week 1 = 25-40% of peak (5K/10K) or 30% (M). Week 2 (M only) = 50-60%.
  const wkPctSeq = lastCat === 'm' ? [0.30, 0.55] : lastCat === 'ultra' ? [0.25, 0.40, 0.55] : [0.40];
  const weeks: ComposedWeek[] = [];
  const blocks: BlockPlan = {
    totalWeeks: recoveryWeeks || 1,
    phases: [{
      label: 'RECOVERY',
      weeks: recoveryWeeks || 1,
      rationale: `Post-race recovery · ${input.lastRaceFinished.name}. Easy running only · no quality.`,
      citation: 'Research/00a-distance-running-training.md §recovery + Pfitzinger Advanced Marathoning §Post-race recovery',
    }],
  };

  for (let wi = 0; wi < (recoveryWeeks || 1); wi++) {
    const wkPct = wkPctSeq[wi] ?? wkPctSeq[wkPctSeq.length - 1];
    const wkWeekly = Math.round(peakAnchor * wkPct);
    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Recover.' };
    // 1 extra rest day adjacent · 2 rest in recovery weeks
    const extraRestDow = ((input.restDow + 3) % 7) as DOW;
    slots[extraRestDow] = { dow: extraRestDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Extra rest · still recovering.' };
    // 1 medium easy mid-week (optional · only if Pfitz says >40% of peak)
    let mediumEasy: DayPlan | null = null;
    if (wkPct >= 0.50) {
      const mediumDow = input.longRunDow; // use long-run slot for medium
      mediumEasy = { dow: mediumDow, type: 'easy', distanceMi: Math.max(6, Math.round(wkWeekly * 0.20)), isQuality: false, isLong: false, subLabel: 'EASY (MEDIUM)', notes: 'Building back · easy effort.' };
      slots[mediumDow] = mediumEasy;
    }
    // Fill rest with easies
    const easyFloor = Math.max(3, Math.round((input.easyDayMedianMi || 5) * 0.7)); // shorter easies in recovery
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const easySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    const perEasy = easySlots.length > 0 ? Math.max(easyFloor, Math.round(easyMiBudget / easySlots.length)) : 0;
    for (const { dow } of easySlots) {
      slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Recovery easy · conversational, no surges.' };
    }
    weeks.push({
      startISO: addDays(input.startMondayISO, wi * 7),
      phase: 'RECOVERY',
      weeklyMi: wkWeekly,
      days: slots.filter(Boolean) as DayPlan[],
      isRaceWeek: false,
      tPaceSec: null,
    });
  }

  return {
    weeks,
    blocks,
    totalWeeks: weeks.length,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: {
      mode: 'recovery',
      total_weeks: weeks.length,
      tier: input.tier,
      last_race_finished: input.lastRaceFinished,
      next_race: input.nextRace,
      target_weekly_mi: weeks[0]?.weeklyMi ?? 0,
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────

async function clearActivePlansFor(userId: string): Promise<void> {
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId]
  );
  // Plan mutation → invalidate memoized lookup so the next /today render
  // sees the new active plan.
  (await import('./lookup')).bustPlanLookupCache(userId);
}

/**
 * 2026-06-03 · Rule 15 · Seal completed days against retroactive
 * mutation. Snapshotted BEFORE clearActivePlansFor archives the prior
 * plan; applied during INSERT so the new plan's row for a completed
 * date inherits the prior prescription.
 *
 * Captured at module scope so persistPlan + its caller share the same
 * snapshot · the wrapper sets it on each invocation.
 */
let sealedSnapshot: Map<string, SealedPrescription> = new Map();

async function persistPlan(args: {
  userId: string; raceSlug: string; raceDateISO: string;
  blocks: BlockPlan; weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean }>;
  authoredState: Record<string, unknown>;
  /** Runner's T-pace (s/mi) at generate-time. Used to populate every
   *  quality workout's pace_target_s_per_mi + workout_spec at insert ·
   *  no more null columns waiting for a backfill cron. 2026-06-01. */
  tPaceSec: number | null;
  /** Runner's LTHR for spec HR caps. Optional · spec falls back to
   *  pace-only when missing. */
  lthr: number | null;
  /** 2026-06-03 · Rule 16 · maxHR for the easy/long HR cap doctrine
   *  (max of 89% LTHR + 78% maxHR). Optional · null falls back to
   *  LTHR-only. Plumbed from profile.hrmax_observed at the entry
   *  point so every plan_workouts row gets a Daniels-grade cap. */
  maxHr: number | null;
}): Promise<string> {
  const planId = id('pln');
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'race-prep', $3, $4, $5)`,
    [planId, args.userId, args.raceSlug, args.raceDateISO, args.authoredState]
  );

  // Phases (need ids upfront so weeks can reference)
  const phaseIds: string[] = [];
  let cursor = 0;
  for (const ph of args.blocks.phases) {
    const phaseId = id('phs');
    phaseIds.push(phaseId);
    await pool.query(
      `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [phaseId, planId, ph.label, cursor, cursor + ph.weeks - 1, ph.rationale, ph.citation]
    );
    cursor += ph.weeks;
  }

  // Map weekIdx → phaseId
  const phaseForWeek = (idx: number): string => {
    let c = 0;
    for (let i = 0; i < args.blocks.phases.length; i++) {
      const ph = args.blocks.phases[i];
      if (idx >= c && idx < c + ph.weeks) return phaseIds[i];
      c += ph.weeks;
    }
    return phaseIds[phaseIds.length - 1];
  };

  for (let wi = 0; wi < args.weeks.length; wi++) {
    const w = args.weeks[wi];
    const weekId = id('wk');
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [weekId, planId, wi, w.startISO, phaseForWeek(wi), w.isRaceWeek, `${w.phase} · week ${wi + 1}`]
    );

    for (const d of w.days) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const wkoId = id('wko');
      const dateISO = addDays(w.startISO, ((d.dow - 1 + 7) % 7));
      // 2026-06-01 · derive pace_target + workout_spec at insert time
      // (web agent gap brief). Was leaving both NULL waiting on the
      // backfill cron · now every freshly-generated quality row
      // carries its target pace + structured spec from day one.
      // Reuses lib/plan/spec-builder.ts (single source of truth ·
      // backfill cron uses the same helper).
      let paceTargetSPerMi: number | null = null;
      let workoutSpec: ReturnType<typeof buildWorkoutSpec>['spec'] = null;
      // 2026-06-03 · Rule 3 · use the week's blended T-pace if set
      // (composePlan computes per-week tPaceSec from bestRecentVdot ramp);
      // fall back to plan-wide goal-T. Plain assignment from week's own
      // tPaceSec (set on every ComposedWeek by composePlan).
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? args.tPaceSec;
      if (weekT != null) {
        // 2026-06-02 · pass the prescription string (sub_label) into
        // spec-builder so the spec's rep_count / rep_distance_mi /
        // rep_rest_s match what the label promises. Was hardcoded ·
        // produced 5×1km specs under "4×1 mi @ I" labels.
        // 2026-06-03 · Rule 16 · pass maxHr alongside LTHR so easy/long
        // HR caps use max(89% LTHR, 78% maxHR) instead of LTHR-only.
        const built = buildWorkoutSpec(d.type, d.distanceMi, weekT, args.lthr, d.subLabel, args.maxHr ?? null);
        paceTargetSPerMi = built.paceTargetSPerMi;
        workoutSpec = built.spec;
      }
      // 2026-06-02 · distance_mi now reflects the TOTAL run · WU + core +
      // floats + CD · so the headline number matches the breakdown.
      // Was: stored just the core (e.g. "4×1 mi @ T" → 4.0) while the
      // sub_label said "2 mi WU · 4 mi @ T · 2 mi CD" (= 8 mi). The
      // runner's math didn't tie. See spec-builder.totalDistanceMiFromSpec
      // for the inclusion rules.
      const totalDistanceMi = totalDistanceMiFromSpec(workoutSpec, d.distanceMi);
      // 2026-06-03 · iPhone agent Tier 2.d brief · sub_label derived
      // from spec instead of the rx template string. The spec is the
      // authored truth · deriving sub_label from it means the chip
      // title and the spec can never drift. Falls back to d.subLabel
      // when spec is null (rest/cross/strength).
      const derivedSubLabel = subLabelFromSpec(workoutSpec) ?? d.subLabel;
      // 2026-06-03 · Rule 15 · seal completed days. If the prior
      // active plan had a row for this date AND a completed run
      // exists, OVERRIDE the freshly-composed prescription with the
      // prior's. The runner trained against the prior prescription ·
      // changing it after-the-fact would make every retro lie.
      const sealed = sealedSnapshot.get(dateISO);
      const finalType = sealed?.type ?? d.type;
      const finalDistanceMi = sealed?.distance_mi ?? totalDistanceMi;
      const finalPaceSec = sealed?.pace_target_s_per_mi ?? paceTargetSPerMi;
      const finalSpec = sealed?.workout_spec ?? workoutSpec;
      const finalSubLabel = sealed?.sub_label ?? derivedSubLabel;
      const finalIsQuality = sealed?.is_quality ?? d.isQuality;
      const finalIsLong = sealed?.is_long ?? d.isLong;
      const finalNotes = sealed?.notes ?? d.notes;
      if (sealed) {
        logSealSkip('persistPlan/rebuild', args.userId, dateISO);
      }
      // dow stored as 1=Mon..7=Sun in our convention? Use what plan_workouts expects.
      // We pass dow 0..6 (Sun..Sat). Existing reader treats numeric dow + sub_label.
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    pace_target_s_per_mi, workout_spec,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi, original_sub_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $4, $6, $7, $13)`,
        [wkoId, planId, weekId, dateISO, d.dow, finalType, finalDistanceMi,
         finalPaceSec, finalSpec ? JSON.stringify(finalSpec) : null,
         finalIsQuality, finalIsLong, finalNotes, finalSubLabel]
      );
    }
  }

  return planId;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

export async function generatePlan(input: GenerateInput): Promise<GenerateResult> {
  const { userId, raceSlug } = input;

  // 1. Load all DB-sourced inputs into a pure-data bundle.
  const inputs = await loadGeneratorInputs(userId, raceSlug);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };

  // 2026-06-03 · Rules 12 + 13 · pick plan mode based on temporal context.
  // race-prep: race is within build window
  // maintenance: race is too far out · hold aerobic base
  // recovery: another race finished recently · 1-2 week light-running
  const todayISO = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const { lastRaceFinished, lastRaceDistanceMi } = await loadLastRaceFinished(userId, todayISO);
  const mode: PlanMode = pickPlanMode(
    todayISO,
    inputs.compose.raceDateISO,
    inputs.compose.raceDistanceMi,
    lastRaceFinished?.date ?? null,
    lastRaceDistanceMi ?? null,
  );

  // 2. Compose · branch by mode.
  let composed: ComposePlanResult;
  if (mode === 'race-prep') {
    composed = composePlan(inputs.compose);
  } else {
    const tier = lookupTierTarget(inputs.compose.goalPaceSec, inputs.compose.raceDistanceMi).tier;
    const nonRaceInput: ComposeNonRaceInput = {
      startMondayISO: inputs.compose.startMondayISO,
      level: inputs.compose.level,
      recentWeeklyMi: inputs.compose.recentWeeklyMi,
      recentLongMi: inputs.compose.recentLongMi,
      recentPeakWeeklyMi: inputs.compose.recentWeeklyMi, // proxy when peak unknown
      easyDayMedianMi: inputs.compose.easyDayMedianMi,
      longRunDow: inputs.compose.longRunDow,
      restDow: inputs.compose.restDow,
      qualityDows: inputs.compose.qualityDows,
      crossModes: inputs.compose.crossModes,
      tier,
      nextRace: {
        slug: raceSlug,
        name: raceSlug,
        date: inputs.compose.raceDateISO,
        distanceMi: inputs.compose.raceDistanceMi,
        goalPaceSec: inputs.compose.goalPaceSec,
      },
      lastRaceFinished: lastRaceFinished ?? null,
      rxQuality: inputs.compose.rxQuality,
      tPaceSec: inputs.compose.tPaceSec,
      lthr: inputs.compose.lthr,
    };
    composed = mode === 'recovery'
      ? composeRecoveryPlan(nonRaceInput)
      : composeMaintenancePlan(nonRaceInput);
  }

  // 3. Archive existing + persist.
  // 2026-06-03 · Rule 15 · snapshot the prior plan's completed-day
  // prescriptions BEFORE archiving so persistPlan can overlay them
  // onto the new plan's rows. Without this, a rebuild would change
  // what the runner was prescribed for days they already ran ·
  // every retro surface (badge, recap, VDOT, adapt-text) would lie.
  sealedSnapshot = await snapshotSealedDays(userId);
  await clearActivePlansFor(userId);
  const planId = await persistPlan({
    userId,
    raceSlug,
    raceDateISO: inputs.compose.raceDateISO,
    blocks: composed.blocks,
    weeks: composed.weeks.map((w) => ({
      startISO: w.startISO, phase: w.phase, days: w.days, isRaceWeek: w.isRaceWeek,
    })),
    tPaceSec: inputs.compose.tPaceSec,
    lthr: inputs.compose.lthr,
    // 2026-06-03 · Rule 16 · plumb maxHr through to spec-builder so
    // easy/long HR caps land at max(89% LTHR, 78% maxHR) instead of
    // LTHR-only. profile.max_hr already loaded in inputs.compose.maxHr
    // via the planInputs reader.
    maxHr: inputs.compose.maxHr,
    authoredState: {
      ...composed.authoredState,
      mode,
      generated_at: new Date().toISOString(),
    },
  });

  // Write the mode column for fast filtering by graduate/transition crons.
  await pool.query(
    `UPDATE training_plans SET mode = $1 WHERE id = $2`,
    [mode, planId],
  );

  return { ok: true, plan_id: planId, weeks_generated: composed.totalWeeks };
}

/**
 * 2026-06-03 · helper · read the runner's last finished A/B race so
 * pickPlanMode can decide if we're inside the recovery window.
 */
async function loadLastRaceFinished(
  userId: string,
  todayISO: string,
): Promise<{ lastRaceFinished: { slug: string; name: string; date: string; distanceMi: number } | null; lastRaceDistanceMi: number | null }> {
  const r = (await pool.query<{ slug: string; meta: any }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'date')::date < $2::date
      ORDER BY (meta->>'date')::date DESC LIMIT 1`,
    [userId, todayISO],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return { lastRaceFinished: null, lastRaceDistanceMi: null };
  const m = r.meta || {};
  const dMi = Number(m.distanceMi);
  return {
    lastRaceFinished: {
      slug: r.slug,
      name: String(m.name || r.slug),
      date: String(m.date),
      distanceMi: dMi,
    },
    lastRaceDistanceMi: dMi || null,
  };
}

/**
 * Gather all DB-sourced facts a plan needs · race, user prefs, recent
 * volume, easy median, experience level, prescriptions, T-pace, LTHR.
 * Returns a ComposePlanInput ready for composePlan() · OR a failure
 * reason that generatePlan converts to a result.
 *
 * Split from generatePlan() 2026-06-02 so the plan-engine bench can
 * test composePlan() without needing the database.
 */
async function loadGeneratorInputs(
  userId: string,
  raceSlug: string,
): Promise<
  | { ok: true; compose: ComposePlanInput }
  | { ok: false; reason: string }
> {
  // 1. Race
  const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [raceSlug])).rows[0];
  if (!raceRow) return { ok: false, reason: 'race not found' };
  const meta = raceRow.meta ?? {};
  const raceDateISO: string | undefined = meta.date;
  if (!raceDateISO) return { ok: false, reason: 'race missing date' };

  const totalDays = daysBetween(today(), raceDateISO);
  if (totalDays < 14) return { ok: false, reason: 'race < 2 weeks away; use race-week briefing only' };
  if (totalDays > 365) return { ok: false, reason: 'race > 1 year out; plan only when within a year' };

  const raceDistanceMi = distanceMiOf(meta);
  const goalSec = parseGoalSeconds(meta.goalDisplay);
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;

  // 2. User prefs · layout
  const prefs = await loadSettings(userId).catch(() => null);
  const longRunDow  = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
  const restDow     = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
  // qualityDows comes from runner prefs · composePlan slices it per-
  // week via densityForWeek() to honor Rule 5 (density ramp).
  const qualityDows = (prefs?.quality_days ?? ['tue', 'thu']).map((d) => dayKeyToDow(d as DayKey));

  // 3. Cross-training opt-in (P34)
  const ctRow = (await pool.query(
    `SELECT cross_training_modes FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const crossModes: string[] = Array.isArray(ctRow?.cross_training_modes)
    ? ctRow.cross_training_modes : [];

  // 4. Plan-shape inputs
  const startMondayISO = mondayOf(today());
  const totalWeeks = daysBetween(startMondayISO, mondayOf(raceDateISO)) / 7 + 1;
  if (totalWeeks < 3) return { ok: false, reason: 'plan needs at least 3 weeks runway' };

  const isMidBlock = await detectMidBlock(userId);
  const recentMi = await recentWeeklyMileage(userId);
  const easyFloor = await easyDayMedianMi(userId);
  const recentLong = await recentPeakLongMi(userId);
  // 2026-06-03 · mid-block doctrine carriers (Rules 2, 3, 5, 8).
  const recentQualityDist = await recentQualityDistanceMi(userId);
  const recentQualityPW = await recentQualityPerWeek(userId);
  // bestRecentVdot · use the canonical reader from lib/training/vdot.
  // Assembles races + recent quality runs into candidates; returns the
  // highest VDOT in the 180-day window. Undefined when no signal.
  const todayISO = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const raceRows = (await pool.query<{ date: string; distance_mi: string; finish_seconds: string }>(
    `SELECT date_iso::text AS date, distance_mi::text, finish_seconds::text
       FROM races
      WHERE user_uuid = $1 AND finish_seconds IS NOT NULL AND finish_seconds > 0
      ORDER BY date_iso DESC LIMIT 30`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows;
  const runRows = (await pool.query<{
    id: string; date: string; workout_type: string | null; distance_mi: string | null; finish_seconds: string | null; avg_hr: string | null;
  }>(
    `SELECT id::text,
            COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS date,
            data->>'workoutType' AS workout_type,
            (data->>'distanceMi')::text AS distance_mi,
            (data->>'movingTimeSec')::text AS finish_seconds,
            (data->>'avgHr')::text AS avg_hr
       FROM runs
      WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric >= 3
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 180
      ORDER BY date DESC LIMIT 200`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows;
  const raceCandidates = raceRows.map((r) => ({
    slug: r.date,
    name: r.date,
    date: r.date,
    priority: null as 'A'|'B'|'C'|null,
    distance_mi: Number(r.distance_mi) || null,
    finish_seconds: Number(r.finish_seconds) || null,
  }));
  const runCandidates = runRows.map((r) => ({
    id: r.id, date: r.date, workout_type: r.workout_type,
    distance_mi: r.distance_mi != null ? Number(r.distance_mi) : null,
    finish_seconds: r.finish_seconds != null ? Number(r.finish_seconds) : null,
    avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
    max_hr: null as number | null,
  }));
  const { best: bestVdotPick } = computeBestRecentVdot(raceCandidates, todayISO, 180, runCandidates);
  const bestRecentVdot = bestVdotPick?.vdot ?? undefined;
  // Banister TSB · drives Rule 8 cutback frequency. Pull from training
  // form helper which already EWMAs CTL/ATL from runs.
  const tsbAtStart = await (async () => {
    try {
      const { computeTrainingForm } = await import('@/lib/coach/training-form');
      const f = await computeTrainingForm(userId);
      return f?.tsb;
    } catch { return undefined; }
  })();
  // 2026-06-03 · Rule 11 · horizon races · A/B-priority races within 24
  // weeks of the current race day. Filtered to "longer distance than
  // current race" — sharpening races (5K/10K after a HM) don't raise
  // the long-run cap.
  const horizonRacesRows = (await pool.query<{ slug: string; meta: any }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date > $2::date
        AND (meta->>'date')::date <= ($2::date + interval '168 days')
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'distanceMi')::numeric > $3::numeric`,
    [userId, raceDateISO, raceDistanceMi],
  ).catch(() => ({ rows: [] }))).rows;
  const horizonRaces: ComposePlanInput['horizonRaces'] = horizonRacesRows.map((r) => {
    const m = r.meta || {};
    const dMi = Number(m.distanceMi);
    const goalSec = parseRaceTime(m.goalDisplay ?? m.goalTime);
    return {
      slug: r.slug,
      name: String(m.name || r.slug),
      date: String(m.date),
      distanceMi: dMi,
      goalPaceSec: goalSec && dMi > 0 ? Math.round(goalSec / dMi) : null,
      priority: (m.priority === 'A' ? 'A' : 'B') as 'A' | 'B',
    };
  });
  // 2026-06-02 · ensure totalWeeks is an integer here too · matches
  // the same fix in composePlan. Was producing fractional totalWeeks
  // that broke phase advancement.
  const integerTotalWeeks = Math.max(3,
    Math.floor(daysBetween(startMondayISO, mondayOf(raceDateISO)) / 7) + 1
  );
  void integerTotalWeeks;  // computed for the early-return check below

  // 5. Experience level
  const expRow = (await pool.query<{ experience_level: string | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level = (expRow?.experience_level ?? null) as LevelKey;

  // 6. Prescriptions (workout_library)
  const cat = distanceCategoryOf(raceDistanceMi);
  const [rxQuality, rxRaceSpecific] = await Promise.all([
    resolvePrescriptions(cat, 'quality',        level),
    resolvePrescriptions(cat, 'race_specific',  level),
  ]);

  // 7. T-pace + LTHR + maxHR · plan-wide goal-T (composePlan computes
  //    per-week blend in tPaceForWeek when bestRecentVdot is set, Rule 3).
  //    2026-06-03 · Rule 16 · maxHR drives easy/long HR cap via
  //    spec-builder's max(89% LTHR, 78% maxHR) doctrine.
  //
  //    LTHR · profile.lthr (manual entry, stable per-runner).
  //    maxHR · loadEffectiveMaxHr (canonical · resolves user override
  //            → hybrid 12-mo observed → users.max_hr → null). Reading
  //            profile.max_hr directly would miss the observed peak ·
  //            per task #141 the profile column is not source of truth.
  const tPaceSec = tPaceFromGoal(goalSec, raceDistanceMi);
  const lthrRow = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = lthrRow?.lthr ?? null;
  const maxHr = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);

  return {
    ok: true,
    compose: {
      raceDistanceMi,
      goalSec,
      goalPaceSec,
      raceDateISO,
      startMondayISO,
      level,
      recentWeeklyMi: recentMi,
      easyDayMedianMi: easyFloor,
      recentLongMi: recentLong,
      recentQualityDistanceMi: recentQualityDist > 0 ? recentQualityDist : undefined,
      recentQualityPerWeek: recentQualityPW > 0 ? recentQualityPW : undefined,
      bestRecentVdot,
      tsbAtStart,
      horizonRaces: horizonRaces.length > 0 ? horizonRaces : undefined,
      isMidBlock,
      longRunDow,
      restDow,
      qualityDows,
      crossModes,
      rxQuality,
      rxRaceSpecific,
      tPaceSec,
      lthr,
      // 2026-06-03 · Rule 16 · plumbed to persistPlan + buildWorkoutSpec.
      maxHr,
    },
  };
}
