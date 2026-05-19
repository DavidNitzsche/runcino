/**
 * Aggregate VDOT compute — cycle-aware variant (c) with C3 + C1 fallback.
 *
 * Single-race VDOT (vdot.ts → vdotFromRace) is brittle: a bad day or
 * a hot race spikes it the wrong way. The aggregate weights multiple
 * race performances by recency, distance, and goal-distance match, so
 * a single off-day can't drive prescription paces.
 *
 * Weighting formula (locked with David in UNIT B spec):
 *
 *   weight = recencyFactor × lengthFactor × tierFactor
 *
 *   recencyFactor:
 *     - if race is goal-tier AND race.date ≥ cycleStart → 1.0 (exempt)
 *     - else                                            → exp(−days / 90)
 *
 *   lengthFactor = sqrt(distanceKm / 10)        [5K→0.71, 10K→1.0, HM→1.45, M→2.05]
 *   tierFactor   = 3.0 exact / 1.0 adjacent / 0.4 distant
 *
 * Tier classification:
 *   - SPRINT     ≤ 3 km (1.864 mi)        — true sprints, mostly track
 *   - TEN_K_ISH    3–15 km (1.864–9.32 mi) — 5K and 10K together
 *   - HM_ISH    15–25 km (9.32–15.53 mi)   — HM
 *   - M_ISH       > 25 km (15.53+ mi)      — marathon
 *
 *   Goal tier comes from races table (next upcoming race; falls back
 *   to most recently saved when no future race exists). Race tier is
 *   computed from the canonical distance.
 *
 * Cycle start (cycleStart) determination — C3 with C1 fallback:
 *   1. Most recently archived training plan's earliest week_start_iso
 *   2. Active training plan's earliest week_start_iso (when no archive)
 *   3. today − 16 weeks (C1 fallback when no plans exist)
 *
 *   Goal-tier races within the cycle window keep full recency weight
 *   so a goal-distance race from earlier in the cycle stays salient
 *   even as standard recency would decay it.
 *
 * Option-B source-of-truth: when a Strava activity is linked to a
 * curated `races` row via stravaActivityId, the curated
 * actual_result.finishS supersedes Strava's canonicalFinishS /
 * movingTimeS. Chip time wins over watch time when present.
 *
 * Returns null when there's nothing usable (no races logged, no
 * canonical-distance bests yet).
 */

import { query } from './db';
import { vdotFromRace } from './vdot';

// ── Public shape (backward-compat with previous consumers) ────────

export interface AggregateVdot {
  /** The aggregate VDOT estimate (rounded to 0.1) */
  value: number;
  /** How many distinct distance bests fed into the aggregate */
  sourceCount: number;
  /** Contributing sources, sorted by weight descending */
  sources: Array<{
    canonicalLabel: string;
    distanceMi: number;
    finishS: number;
    date: string;
    activityId: string;
    vdot: number;
    /** Resolved source for finishS — 'races' means curated chip time;
     *  'strava' means raw Strava canonicalFinishS / movingTimeS. */
    source: 'races' | 'strava';
    /** Total weight applied to this contributor. */
    weight: number;
    /** Components of weight for transparency. */
    weightBreakdown: { recency: number; length: number; tier: number; effort: number };
    /** True when this race matched the goal tier. */
    isGoalTier: boolean;
    /** True when this race fell inside the cycle window (so goal-tier
     *  races skip the recency decay). */
    isInCycle: boolean;
    /** Race priority from meta.priority — A=full weight, B=0.6×,
     *  C=0.3×. Defaults to 'A' when unset. */
    priority: RaceEffortLevel;
  }>;
  /** Human-readable description of the aggregation window. */
  windowLabel: string;
  /** Goal-tier used for tier-factor scoring. Null when no race exists
   *  in the races table. */
  goalTier: RaceTier | null;
  /** Start of the cycle window (ISO date) — for debugging / UI. */
  cycleStartIso: string;
}

// ── Tier classification ──────────────────────────────────────────

export type RaceTier = 'SPRINT' | 'TEN_K_ISH' | 'HM_ISH' | 'M_ISH';
const TIER_ORDER: RaceTier[] = ['SPRINT', 'TEN_K_ISH', 'HM_ISH', 'M_ISH'];

/** Race tier from distance in km. Boundaries chosen per UNIT B spec:
 *  5K is structurally similar to 10K for fitness purposes, so they
 *  share a tier; true sprints (≤3K) get their own band. */
export function tierForKm(km: number): RaceTier {
  if (km <= 3) return 'SPRINT';
  if (km <= 15) return 'TEN_K_ISH';
  if (km <= 25) return 'HM_ISH';
  return 'M_ISH';
}

/** Tier-match factor: 3.0 exact, 1.0 one tier off, 0.4 two-plus off. */
export function tierFactor(raceTier: RaceTier, goalTier: RaceTier): number {
  if (raceTier === goalTier) return 3.0;
  const a = TIER_ORDER.indexOf(raceTier);
  const b = TIER_ORDER.indexOf(goalTier);
  return Math.abs(a - b) === 1 ? 1.0 : 0.4;
}

// ── Recency + length factors ─────────────────────────────────────

/** Days between two ISO dates (positive when `date` precedes `today`). */
function daysBetween(date: Date, today: Date): number {
  return Math.max(0, (today.getTime() - date.getTime()) / 86_400_000);
}

/** Recency factor with goal-tier-in-cycle exemption.
 *  Goal-tier races within the cycle window keep weight 1.0; all
 *  others decay via exp(−days/90). */
export function recencyFactor(
  raceDate: Date,
  today: Date,
  isGoalTier: boolean,
  cycleStart: Date,
): number {
  if (isGoalTier && raceDate.getTime() >= cycleStart.getTime()) return 1.0;
  return Math.exp(-daysBetween(raceDate, today) / 90);
}

/** Length factor — sqrt to keep race-length spread mild. */
export function lengthFactor(km: number): number {
  return Math.sqrt(km / 10);
}

// ── Cycle start determination (C3 + C1 fallback) ─────────────────

const MILES_PER_KM = 0.621371;
const SIXTEEN_WEEKS_MS = 16 * 7 * 86_400_000;

/** Resolve the cycle window start for a user. C3: most recently
 *  archived plan's earliest week start; falls through to active
 *  plan's earliest week, then to 16-week fallback (C1) when no
 *  plans exist. */
export async function resolveCycleStart(userId: string, today: Date): Promise<Date> {
  // C3: most recently archived plan (covers current + previous cycle)
  const archived = await query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_id = $1 AND archived_iso IS NOT NULL
      ORDER BY archived_iso DESC
      LIMIT 1`,
    [userId],
  );
  if (archived.length > 0) {
    const start = await query<{ start: string | null }>(
      `SELECT MIN(week_start_iso) AS start FROM plan_weeks WHERE plan_id = $1`,
      [archived[0].id],
    );
    if (start[0]?.start) return new Date(start[0].start + 'T00:00:00Z');
  }
  // Active plan if no archive yet
  const active = await query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_id = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC
      LIMIT 1`,
    [userId],
  );
  if (active.length > 0) {
    const start = await query<{ start: string | null }>(
      `SELECT MIN(week_start_iso) AS start FROM plan_weeks WHERE plan_id = $1`,
      [active[0].id],
    );
    if (start[0]?.start) return new Date(start[0].start + 'T00:00:00Z');
  }
  // C1 fallback: rolling 16-week window
  return new Date(today.getTime() - SIXTEEN_WEEKS_MS);
}

// ── Goal race determination ──────────────────────────────────────

interface GoalRaceInfo { distanceKm: number; tier: RaceTier; name: string; dateIso: string }

/** Resolve the goal race. Per UNIT B spec: nearest upcoming race
 *  from the user's races table; falls back to most recently saved
 *  race regardless of date when no future race exists. Returns null
 *  only when the races table is empty. */
export async function resolveGoalRace(userId: string, today: Date): Promise<GoalRaceInfo | null> {
  const todayIso = today.toISOString().slice(0, 10);
  // Nearest upcoming
  const upcoming = await query<{ meta: { name?: string; date?: string; distanceMi?: number; distance_mi?: number } }>(
    `SELECT meta FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND meta->>'date' >= $2
      ORDER BY meta->>'date' ASC
      LIMIT 1`,
    [userId, todayIso],
  );
  const pick = upcoming[0] ?? (await query<{ meta: { name?: string; date?: string; distanceMi?: number; distance_mi?: number } }>(
    // Fallback: most recently saved race
    `SELECT meta FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
      ORDER BY meta->>'date' DESC
      LIMIT 1`,
    [userId],
  ))[0];
  if (!pick) return null;
  // Support both meta.distanceMi (TS field) and meta.distance_mi (snake_case fallback)
  const distMi = Number(pick.meta?.distanceMi ?? pick.meta?.distance_mi ?? 0);
  if (!distMi) return null;
  const km = distMi / MILES_PER_KM;
  return {
    distanceKm: km,
    tier: tierForKm(km),
    name: pick.meta?.name ?? 'Race',
    dateIso: pick.meta?.date ?? '',
  };
}

// ── Activity row + Option-B preference ───────────────────────────

interface ActivityRow {
  id: string;
  data: {
    name?: string;
    date?: string;
    canonicalLabel?: string;
    canonicalFinishS?: number;
    distanceMi?: number;
    movingTimeS?: number;
    workoutType?: number | null;
  };
  race_actual_result: { finishS?: number; source?: string; stravaActivityId?: number } | null;
  race_slug: string | null;
}

/** Map a Strava activity distance to a canonical race distance
 *  (within 5% tolerance). */
function inferCanonical(distanceMi: number): { label: string; canonicalMi: number } | null {
  if (Math.abs(distanceMi - 3.107) < 0.155) return { label: '5K', canonicalMi: 3.107 };
  if (Math.abs(distanceMi - 6.214) < 0.31)  return { label: '10K', canonicalMi: 6.214 };
  if (Math.abs(distanceMi - 9.32)  < 0.47)  return { label: '15K', canonicalMi: 9.32 };
  if (Math.abs(distanceMi - 13.109) < 0.55) return { label: 'Half', canonicalMi: 13.109 };
  if (Math.abs(distanceMi - 26.219) < 1.05) return { label: 'Marathon', canonicalMi: 26.219 };
  return null;
}

// ── Pure aggregation function (testable without DB) ──────────────

export interface RaceBest {
  label: string;
  canonicalMi: number;
  finishS: number;
  date: string;
  activityId: string;
  source: 'races' | 'strava';
  /** Race priority from meta.priority — drives the effort-level
   *  weight multiplier in the aggregate (A=1.0, B=0.6, C=0.3).
   *  Defaults to 'A' when unset (full weight, prior behavior). */
  priority?: RaceEffortLevel;
}

export interface AggregateInputs {
  bests: RaceBest[];
  cycleStart: Date;
  goalTier: RaceTier | null;
  today: Date;
}

/** Aggregate VDOT from already-resolved best efforts. Pure function,
 *  no DB. Use this directly for testing the math. */
export function aggregateVdotFromInputs(inputs: AggregateInputs): AggregateVdot | null {
  const { bests, cycleStart, goalTier, today } = inputs;
  if (bests.length === 0) return null;

  const contributions = bests
    .map((b) => {
      const vdot = vdotFromRace(b.canonicalMi, b.finishS);
      if (vdot == null) return null;
      const km = b.canonicalMi / MILES_PER_KM;
      const raceTier = tierForKm(km);
      const isGoalTier = goalTier != null && raceTier === goalTier;
      const raceDate = new Date(b.date + 'T12:00:00Z');
      const isInCycle = raceDate.getTime() >= cycleStart.getTime();

      const rFactor = recencyFactor(raceDate, today, isGoalTier, cycleStart);
      const lFactor = lengthFactor(km);
      const tFactor = goalTier ? tierFactor(raceTier, goalTier) : 1.0;
      // Race-effort multiplier from meta.priority. Default 'A' (full
      // weight) when unset so legacy contributors keep their prior
      // weight; explicit 'C' marks a tune-up that gets ~30% weight.
      const eFactor = PRIORITY_WEIGHT[b.priority ?? 'A'];
      const weight = rFactor * lFactor * tFactor * eFactor;

      return {
        canonicalLabel: b.label,
        distanceMi: b.canonicalMi,
        finishS: b.finishS,
        date: b.date,
        activityId: b.activityId,
        vdot: Math.round(vdot * 10) / 10,
        source: b.source,
        weight,
        weightBreakdown: { recency: rFactor, length: lFactor, tier: tFactor, effort: eFactor },
        isGoalTier,
        isInCycle,
        priority: b.priority ?? 'A',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (contributions.length === 0) return null;
  const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return null;
  const value = contributions.reduce((s, c) => s + c.vdot * c.weight, 0) / totalWeight;

  // Sort sources by weight descending so the biggest contributor surfaces first.
  contributions.sort((a, b) => b.weight - a.weight);

  return {
    value: Math.round(value * 10) / 10,
    sourceCount: contributions.length,
    sources: contributions,
    windowLabel: goalTier
      ? `cycle-aware, ${goalTier.toLowerCase()} goal-tier`
      : 'cycle-aware (no goal race set)',
    goalTier,
    cycleStartIso: cycleStart.toISOString().slice(0, 10),
  };
}

// ── Public API: fetch + aggregate ────────────────────────────────

interface RaceRow {
  slug: string;
  date: string;
  distance_mi: number | null;
  finish_s: number | null;
  activity_id: string | null;
  result_source: string | null;
  name: string | null;
  priority: string | null;
}

/** Priority → weight multiplier. Race-effort-level expressed via the
 *  existing meta.priority field (no new schema). The aggregate uses
 *  these multipliers to honor user intent.
 *
 *  Six levels locked with David on 2026-05-19 (round 2 spec):
 *    A              full weight (1.0×) — primary goal effort
 *    B              0.7× — secondary checkpoint
 *    C              0.4× — minor race, partial effort
 *    tune-up        0.4× — explicit pre-race tune-up (same as C
 *                          but expressed semantically)
 *    training-run   0.2× — race used as workout
 *    hilly-excluded 0.0× — course profile distorts time→VDOT
 *                          mapping; remove from aggregate */
export type RaceEffortLevel = 'A' | 'B' | 'C' | 'tune-up' | 'training-run' | 'hilly-excluded';

const PRIORITY_WEIGHT: Record<RaceEffortLevel, number> = {
  A: 1.0,
  B: 0.7,
  C: 0.4,
  'tune-up': 0.4,
  'training-run': 0.2,
  'hilly-excluded': 0.0,
};

/** Check whether the user has an active manual VDOT override (from
 *  L7 adaptive-vdot Apply). The override stays active until a new
 *  race result post-dates the override timestamp — race-first
 *  source-of-truth still wins long term. Returns null when no
 *  override or when override is stale (newer race exists). */
async function checkVdotManualOverride(userId: string): Promise<number | null> {
  try {
    const rows = await query<{ value: string | null; at: Date | null }>(
      `SELECT vdot_manual_override::TEXT AS value, vdot_manual_override_at AS at
         FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const value = rows[0]?.value;
    const at = rows[0]?.at;
    if (value == null || at == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    // Stale check: any race result with date > override date wipes the override.
    const overrideDate = new Date(at).toISOString().slice(0, 10);
    const newer = await query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND actual_result IS NOT NULL
          AND (meta->>'date') > $2`,
      [userId, overrideDate],
    );
    if (Number(newer[0]?.count ?? '0') > 0) {
      // Race-first wins. Override is stale.
      return null;
    }
    return num;
  } catch {
    return null;
  }
}

export async function computeAggregateVdot(userId: string): Promise<AggregateVdot | null> {
  const today = new Date();
  const yearAgoIso = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);

  // STRICT OPTION-B: aggregate reads ONLY from the curated races table.
  // Strava activities not linked to a races entry never enter the
  // aggregate — this prevents auto-detected best-effort segments
  // (e.g. a 5K split inside a long run) from being mistreated as
  // race performances. Per David's review of the Coach Reads card on
  // 2026-05-19: a phantom 5K at VDOT 33.6 was pulled from raw Strava
  // data and dragged the aggregate down ~0.4 points. Strict Option-B
  // fixes the noise floor.
  //
  // Also: no dedup by canonical distance. Multiple HMs (e.g. Disney
  // HM + Sombrero) and multiple marathons (LA + Big Sur) each
  // contribute as independent signals. The cycle-aware weighting
  // handles ordering — fastest doesn't have to be the only one.
  const rows = await query<RaceRow>(
    `SELECT
        slug,
        meta->>'date' AS date,
        COALESCE((meta->>'distanceMi')::NUMERIC, (meta->>'distance_mi')::NUMERIC) AS distance_mi,
        (actual_result->>'finishS')::NUMERIC AS finish_s,
        actual_result->>'stravaActivityId' AS activity_id,
        actual_result->>'source' AS result_source,
        meta->>'name' AS name,
        meta->>'priority' AS priority
       FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND actual_result IS NOT NULL
        AND (actual_result->>'finishS')::NUMERIC > 0
        AND (meta->>'date') >= $2
      ORDER BY (meta->>'date') DESC
      LIMIT 50`,
    [userId, yearAgoIso],
  );
  if (rows.length === 0) return null;

  const bests: RaceBest[] = [];
  for (const r of rows) {
    const distMi = Number(r.distance_mi ?? 0);
    const finishS = Number(r.finish_s ?? 0);
    if (distMi <= 0 || finishS <= 0) continue;

    const matched = inferCanonical(distMi);
    // If the race distance doesn't match any canonical bucket within
    // 5%, skip it — vdotFromRace can't map non-canonical distances
    // to VDOT. Common case: trail / ultra / unusual-length races.
    if (!matched) continue;

    // Normalize priority — default to 'A' when unset (legacy rows
    // without an explicit priority get full weight, prior behavior).
    const validLevels: ReadonlySet<string> = new Set(['A', 'B', 'C', 'tune-up', 'training-run', 'hilly-excluded']);
    const pri = (r.priority && validLevels.has(r.priority)) ? r.priority as RaceEffortLevel : 'A';

    // Skip hilly-excluded races entirely — 0× weight means they'd
    // contribute nothing anyway, but filtering early keeps the
    // sources[] list honest (excluded races don't render as "0%
    // contributor" in the UI; they're not contributors at all).
    if (pri === 'hilly-excluded') continue;

    bests.push({
      label: matched.label,
      canonicalMi: matched.canonicalMi,
      finishS,
      date: r.date ?? '',
      activityId: r.activity_id ?? r.slug,
      source: 'races' as const,
      priority: pri,
    });
  }
  if (bests.length === 0) return null;

  // Resolve cycle window + goal race
  const [cycleStart, goalRace] = await Promise.all([
    resolveCycleStart(userId, today),
    resolveGoalRace(userId, today),
  ]);

  const raceDerived = aggregateVdotFromInputs({
    bests,
    cycleStart,
    goalTier: goalRace?.tier ?? null,
    today,
  });

  // L7 manual override: if the user has Applied an adaptive-vdot bump
  // banner and no fresh race has landed since, override the displayed
  // aggregate. The sources/weights/breakdown still reflect race
  // contributors — the displayed VDOT just shifts to the user-applied
  // value. Race-first source-of-truth: any new race result post-
  // dating the override automatically clears it (next call returns
  // pure race-derived).
  const override = await checkVdotManualOverride(userId);
  if (raceDerived && override != null && override > 0) {
    return {
      ...raceDerived,
      value: Math.round(override * 10) / 10,
      windowLabel: `${raceDerived.windowLabel} · adaptive override (race-derived: ${raceDerived.value.toFixed(1)})`,
    };
  }

  return raceDerived;
}
