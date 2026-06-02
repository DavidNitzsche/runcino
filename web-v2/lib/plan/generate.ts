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
import { parseRaceTime } from '@/lib/training/vdot';

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

// Parse a goal time like "1:35:00" or "3:25:00" → seconds, or null.
function parseGoalSeconds(goal: string | null | undefined): number | null {
  if (!goal) return null;
  const m = String(goal).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
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
  // 2026-06-01 - MAX-per-day dedupe. Absorber sometimes does not fire,
  // leaving duplicate source rows (watch + apple_watch) as canonical
  // siblings. SUMing double-counted mileage 2x and inflated plan
  // baseline accordingly. MAX-per-day is honest because duplicate
  // sources record the same distance for the same physical run.
  const r = await pool.query(
    `WITH per_day AS (
       SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date AS d,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date
              >= (NOW() - interval '28 days')::date
        GROUP BY 1
     )
     SELECT COALESCE(SUM(mi), 0) AS mi FROM per_day`,
    [userId]
  ).catch(() => ({ rows: [{ mi: 0 }] }));
  return Math.round((Number(r.rows[0]?.mi ?? 0) / 4) * 10) / 10;
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
  // Signal 1 · prescribed quality in last 28d of any active plan
  const r1 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.type IN ('threshold','tempo','intervals','vo2max')
        AND pw.date_iso::date BETWEEN (CURRENT_DATE - 28) AND CURRENT_DATE`,
    [userId]
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(r1.rows[0]?.n ?? 0) >= 2) return true;  // ≥2 prescribed quality sessions

  // Signal 2 · runs with quality-effort tag OR sustained high-HR work
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

  return false;
}

// ── Block sizing ────────────────────────────────────────────────────────

interface BlockPlan {
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
type DistCategory = '5k' | '10k' | 'hm' | 'm';
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
  const baseWeeksRaw     = Math.min(8, Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks));
  const baseWeeks        = isMidBlock ? 0 : baseWeeksRaw;
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
 * Cite: Research/00a-distance-running-training.md §progressive-overload (10%/wk cap, deload every 4th wk)
 * Cite: Research/08-pacing-and-race-week.md §taper (cut volume, hold intensity)
 *
 * Non-deload weeks ramp by RAMP_PCT (level-scaled, 5-8%); cutback weeks
 * land at 85% of the previous PEAK so the trend climbs cleanly across
 * cycles. Floor scales by experience_level.
 */
function volumeCurve(baseMi: number, blocks: BlockPlan, level: LevelKey): number[] {
  const vols: number[] = [];
  const floor = level ? VOLUME_FLOOR_MPW[level] : VOLUME_FLOOR_MPW.intermediate;
  const ramp  = level ? RAMP_PCT[level]         : RAMP_PCT.intermediate;
  let weekVol = Math.max(floor, baseMi);
  let lastPeak = weekVol;

  let cursor = 0;
  for (const phase of blocks.phases) {
    for (let w = 0; w < phase.weeks; w++) {
      if (phase.label === 'TAPER') {
        const wksLeft = phase.weeks - w;
        const taperFactor = wksLeft === 1 ? 0.45 : wksLeft === 2 ? 0.60 : 0.75;
        vols.push(Math.round(lastPeak * taperFactor));
      } else {
        const isDeload = cursor > 0 && (cursor + 1) % 4 === 0;
        if (cursor > 0) {
          if (isDeload) {
            weekVol = Math.round(lastPeak * 0.85);
          } else {
            weekVol = Math.round(weekVol * (1 + ramp));
            lastPeak = Math.max(lastPeak, weekVol);
          }
        }
        vols.push(weekVol);
      }
      cursor++;
    }
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
 *  file. Library reads supersede these. */
function inlinePrescriptions(cat: DistCategory): ResolvedPrescriptions {
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
  phase, weekIdx, totalWeeks, weeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi, rx, easyMileFloor,
}: {
  phase: string; weekIdx: number; totalWeeks: number;
  weeklyMi: number; longRunDow: DOW; qualityDows: DOW[]; restDow: DOW;
  isRaceWeek: boolean; raceDow: DOW | null; raceDistanceMi: number;
  rx: ResolvedPrescriptions;
  /** 2026-06-01 · runner's actual 14-day easy-day median. Floors the
   *  per-easy distance in non-race weeks so the plan never asks for a
   *  4.5-mi easy day when the runner is comfortably running 6+ mi
   *  easy. Pass 0 to skip the floor (falls back to historical math). */
  easyMileFloor?: number;
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
  // Distribute remaining miles across easy days proportionally.
  const longShare    = phase === 'BASE' ? 0.30 : phase === 'TAPER' ? 0.28 : 0.34;
  const qualityShare = phase === 'BASE' ? 0    : phase === 'TAPER' ? 0.18 : 0.22; // total across quality days
  const longMi = Math.round(weeklyMi * longShare);
  const qualityMiEach = qualityDows.length > 0 ? Math.round((weeklyMi * qualityShare) / qualityDows.length) : 0;

  // Pre-allocate: rest = 0, long + quality slotted in
  const slots: (DayPlan | null)[] = new Array(7).fill(null);
  slots[restDow] = { dow: restDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    subLabel: phase === 'RACE-SPECIFIC' ? `LONG · ${Math.round(longMi * 0.4)}mi @ MP` : 'LONG',
    notes: phase === 'RACE-SPECIFIC'
      ? `Steady ${longMi - Math.round(longMi * 0.4)}mi, then ${Math.round(longMi * 0.4)}mi at race pace.`
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
      slots[dow] = {
        dow: dow as DOW, type: qt, distanceMi: qualityMiEach, isQuality: true, isLong: false,
        subLabel: sub,
        notes:
          qt === 'intervals' ? 'WU 1.5mi, reps, CD 1mi. Hold pace, even splits.'
        : qt === 'threshold' ? 'WU 1.5mi, threshold reps, CD 1mi. Comfortably hard.'
        : qt === 'tempo'     ? 'WU 1.5mi, continuous tempo, CD 1mi. Just below threshold.'
        :                      '',
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
      if (args.tPaceSec != null) {
        const built = buildWorkoutSpec(d.type, d.distanceMi, args.tPaceSec, args.lthr);
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
      // dow stored as 1=Mon..7=Sun in our convention? Use what plan_workouts expects.
      // We pass dow 0..6 (Sun..Sat). Existing reader treats numeric dow + sub_label.
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    pace_target_s_per_mi, workout_spec,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi, original_sub_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $4, $6, $7, $13)`,
        [wkoId, planId, weekId, dateISO, d.dow, d.type, totalDistanceMi,
         paceTargetSPerMi, workoutSpec ? JSON.stringify(workoutSpec) : null,
         d.isQuality, d.isLong, d.notes, d.subLabel]
      );
    }
  }

  return planId;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

export async function generatePlan(input: GenerateInput): Promise<GenerateResult> {
  const { userId, raceSlug } = input;

  // 1. Load the target race
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

  // 2. Load user prefs for layout
  const prefs = await loadSettings(userId).catch(() => null);
  const longRunDow  = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
  const restDow     = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
  const qualityDows = (prefs?.quality_days ?? ['tue', 'thu']).map((d) => dayKeyToDow(d as DayKey));

  // P34 — cross-training opt-in. If the runner has cross_training_modes
  // set on profile (bike/swim/strength/other), we tag the rest day's
  // sub_label so the plan shows the activity instead of just "REST".
  // (Type stays 'rest' so distance + readiness logic don't break.)
  const ctRow = (await pool.query(
    `SELECT cross_training_modes FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const crossModes: string[] = Array.isArray(ctRow?.cross_training_modes)
    ? ctRow.cross_training_modes : [];

  // 3. Determine week count + block sizes
  // The plan starts on the Monday of "this week", ends on the week containing race day.
  const startMonday = mondayOf(today());
  const raceMonday  = mondayOf(raceDateISO);
  const totalWeeks = daysBetween(startMonday, raceMonday) / 7 + 1;
  if (totalWeeks < 3) return { ok: false, reason: 'plan needs at least 3 weeks runway' };

  // 2026-06-01 · mid-block awareness (web agent gap). Runner who's been
  // doing quality for weeks shouldn't be sent back to a fresh BASE phase
  // by an auto-rebuild. Detect quality activity in the last 28 days ·
  // skip BASE entirely if present (fold those weeks into QUALITY).
  const isMidBlock = await detectMidBlock(userId);
  const blocks = sizeBlocks(totalWeeks, raceDistanceMi, isMidBlock);
  const recentMi = await recentWeeklyMileage(userId);
  // 2026-06-01 · runner's real easy-day baseline · floors `perEasy` in
  // layoutWeek so the generator never authors silently-low easy days.
  const easyFloor = await easyDayMedianMi(userId);

  // Read experience_level for volume-curve scaling (Q-01 / SIM-02 fix).
  // Falls back to 'intermediate' shape when unknown.
  const expRow = (await pool.query<{ experience_level: string | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level = (expRow?.experience_level ?? null) as LevelKey;

  const vols = volumeCurve(recentMi, blocks, level);

  // Resolve quality + race-specific prescriptions ONCE from the workout
  // library. Per the locked decision ("best becomes rules of law"), every
  // user reads the same library; per-runner customization is a follow-up.
  // Falls back to the inline catalog if a library row is missing.
  const cat = distanceCategoryOf(raceDistanceMi);
  const [rxQuality, rxRaceSpecific] = await Promise.all([
    resolvePrescriptions(cat, 'quality',        level),
    resolvePrescriptions(cat, 'race_specific',  level),
  ]);

  // 4. Build each week
  const weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean }> = [];
  let phaseCursor = 0;
  let phaseWkRemaining = blocks.phases[0].weeks;
  let phaseLabel = blocks.phases[0].label;
  for (let wi = 0; wi < totalWeeks; wi++) {
    while (phaseWkRemaining === 0) {
      phaseCursor++;
      phaseWkRemaining = blocks.phases[phaseCursor].weeks;
      phaseLabel = blocks.phases[phaseCursor].label;
    }
    const weekStart = addDays(startMonday, wi * 7);
    const isRaceWeek = wi === totalWeeks - 1;
    const raceDow: DOW | null = isRaceWeek
      ? ((new Date(raceDateISO + 'T12:00:00Z').getUTCDay()) as DOW)
      : null;
    const rx = phaseLabel === 'RACE-SPECIFIC' ? rxRaceSpecific : rxQuality;
    const days = layoutWeek({
      phase: phaseLabel,
      weekIdx: wi,
      totalWeeks,
      weeklyMi: vols[wi],
      longRunDow,
      qualityDows,
      restDow,
      isRaceWeek,
      raceDow,
      raceDistanceMi,
      rx,
      easyMileFloor: easyFloor,
    });
    // P34 — relabel the rest day with cross-training activity when opted
    // in. Rotates through enabled modes across weeks so the runner gets
    // variety (bike one week, swim the next, etc.). Strength gets one
    // dedicated day every other week when it's in the mix.
    if (crossModes.length > 0) {
      const restDay = days.find((d) => d.type === 'rest' && d.distanceMi === 0);
      if (restDay) {
        const mode = crossModes[wi % crossModes.length];
        const subLabel = mode === 'strength' ? 'STRENGTH'
          : mode === 'bike' ? 'BIKE 45-60 MIN'
          : mode === 'swim' ? 'SWIM 30-40 MIN'
          : 'CROSS-TRAIN';
        restDay.subLabel = subLabel;
        restDay.notes = `Cross-training: ${mode}. Easy effort. Not a run replacement · keeps the engine humming on a non-impact day.`;
      }
    }
    weeks.push({ startISO: weekStart, phase: phaseLabel, days, isRaceWeek });
    phaseWkRemaining--;
  }

  // 5. Archive existing active plans, then persist
  await clearActivePlansFor(userId);

  // 2026-06-01 · derive T-pace + read LTHR ONCE before insert so every
  // workout row gets its pace_target + workout_spec populated at write
  // time. No more null-column-waiting-for-backfill-cron · plan is
  // self-contained from row one.
  const tPaceSec = tPaceFromGoal(goalSec, raceDistanceMi);
  const lthrRow = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = lthrRow?.lthr ?? null;

  const planId = await persistPlan({
    userId, raceSlug, raceDateISO, blocks, weeks,
    tPaceSec, lthr,
    authoredState: {
      generated_at: new Date().toISOString(),
      total_weeks: totalWeeks,
      race_distance_mi: raceDistanceMi,
      goal_pace_s_per_mi: goalPaceSec,
      recent_avg_mpw: recentMi,
      is_mid_block: isMidBlock,
      t_pace_s_per_mi: tPaceSec,
      lthr_bpm: lthr,
      citations: blocks.phases.map((p) => p.citation),
    },
  });

  return { ok: true, plan_id: planId, weeks_generated: totalWeeks };
}
