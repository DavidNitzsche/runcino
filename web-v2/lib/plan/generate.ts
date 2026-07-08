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
 *   Cite: Research/04-workout-vocabulary.md §5-Threshold §6-VO2max  // was §quality-types · headings: ## 5. Threshold workouts · ## 6. VO2max workouts
 *   Cite: Research/08-pacing-and-race-week.md §taper
 */
import { pool } from '@/lib/db/pool';
import type { PoolClient } from 'pg';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { randomBytes } from 'crypto';
import { loadSettings } from '@/lib/coach/settings';
import { pickWorkout, type WorkoutFamily } from './workout-library';
import { buildWorkoutSpec, conservativeVdotFromMileage, tPaceFromGoal, totalDistanceMiFromSpec, capSpecToDistance } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { parseRaceTime, tPaceFromVdot, vdotFromTpace, iPaceFromVdot, vdotFromRace, predictRaceTime, bestRecentVdot as computeBestRecentVdot, DANIELS_MAX_VALID_DISTANCE_MI } from '@/lib/training/vdot';
// 2026-06-03 · Rule 16 · canonical max-HR reader · resolves
// users.max_hr_override → hybrid 12-mo observed → users.max_hr → null.
// profile.max_hr is NOT the source of truth per task #141.
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { loadVdotInputs, goalRunFloorMiForUser } from '@/lib/training/vdot-inputs';
import { bestVdotFromRaceHistory } from '@/lib/training/race-history';
import { lookupTierTarget, type TierTarget, type GoalTier, pickPlanMode, MAINTENANCE_BY_TIER, POST_RACE_RECOVERY_WEEKS, BUILD_WINDOW_WEEKS, type PlanMode, distanceCategoryOf as distanceCategoryOfTier, type DistCategory } from './goal-tiers';
import { isBaseBuildingPlan } from './plan-templates';
import { distanceMiFromLabel } from '@/lib/race/distance'; // 2026-07-07 · ultra-honesty audit · shared label→mi parser (handles 50K/50M/100K/100M)
import { snapshotSealedDays, logSealSkip, type SealedPrescription } from './seal';
import { validateComposedPlan } from './validate';

export type DOW = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0..Sat=6
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const dayKeyToDow = (k: DayKey): DOW => DAY_KEYS.indexOf(k) as DOW;

/**
 * 2026-06-23 · A1/A2 (SCHED-01/02) · derive quality days from a runner's
 * available_days, spaced off the long run. Drops any available day within 1 of the
 * long (a hard session must never sit back-to-back with the long), then greedily
 * orders the rest to maximize spacing from {long + already-chosen} so the downstream
 * frequency slice takes a well-separated 1 or 2. A 2-adjacent-available-day runner
 * (e.g. Sat/Sun) yields ZERO quality → the week folds to long + easy (the only
 * doctrinally-safe option · Research/00a:754, 48h between hard sessions). Replaces the
 * old proximity-to-Wednesday sort, which was blind to the long and put quality
 * back-to-back with it for weekend-only runners.
 */
export function spacedQualityDowsFromAvailable(avail: number[], longRunDow: number): DOW[] {
  const cd = (d: number, ref: number) => Math.min((d - ref + 7) % 7, (ref - d + 7) % 7);
  const cands = avail.filter((d) => d !== longRunDow && cd(d, longRunDow) >= 2);
  const out: number[] = [];
  while (out.length < cands.length) {
    let best = -1;
    let bestMin = -1;
    for (const c of cands) {
      if (out.includes(c)) continue;
      let m = 7;
      for (const a of [longRunDow, ...out]) m = Math.min(m, cd(c, a));
      if (m > bestMin) { bestMin = m; best = c; }
    }
    if (best < 0) break;
    out.push(best);
  }
  return out as DOW[];
}

/**
 * 2026-06-23 · B3 (SCHED-03) · stimulus-gap-aware quality scheduling. Research/00b:55-60: a
 * VO2max/intervals session needs 2 EASY days after; threshold/tempo and a plain long need 1.
 * Two steps:
 *   1. ORDER the week's quality types so intervals (gap 2) lands LAST — nearest the long's own
 *      2-day buffer — and lighter threshold/tempo (gap 1) come first. With the default Tue/Thu +
 *      Sun-long this makes the common configs gap-correct by construction (Tu threshold → Th
 *      intervals → Fri/Sat easy → Sun long).
 *   2. RE-PLACE the days only when the ordered assignment STILL violates a gap (over-constrained,
 *      or a non-Sunday long), choosing the placement with the largest tightest-slack. Currently
 *      legal weeks — including David's Su:long Tu/Th — keep their days byte-identical. Falls back
 *      to best-achievable when unsatisfiable (e.g. two VO2max days in a ≤6-day week).
 * qualityDows is returned ascending; types align by index (types[i] → i-th-earliest quality day).
 */
export function scheduleQuality(
  qualityDows: number[],
  qualityTypes: Array<DayPlan['type']>,
  longRunDow: number,
  restDow: number,
  availableDows: Set<number> | null,
  placementTypes?: Array<DayPlan['type']>,
): { dows: DOW[]; types: Array<DayPlan['type']> } {
  const n = qualityDows.length;
  // FARTLEK-GAP-SCHED-1 (2026-06-23): fartlek is type='easy' and reqGap=0 in the validator
  // (easy needs no recovery day). gapRank must match so scheduleQuality doesn't displace
  // fartlek from its requested slot just because it's adjacent to the long run.
  const gapRank = (t: DayPlan['type']): number => (t === 'intervals' ? 2 : t === 'easy' ? 0 : 1);
  // VDEAD-A (2026-06-23) · PAD types to qualityDows.length so gaps[] aligns 1:1 with dows. When qualityTypes
  // is shorter than the dows (base-building emits 1 type for 2 quality slots), the old slice(0,n) left gaps
  // short → score() read gaps[i]=undefined → NaN slack → a stranded quality day (adjacent to the long, 0 easy
  // between) passed as "legal" → §9 stimulus-gap persist-abort. Cycle the types like the slot-assignment loop.
  const typeBase: Array<DayPlan['type']> = qualityTypes.length > 0 ? qualityTypes : ['threshold'];
  const types = Array.from({ length: n }, (_, i) => typeBase[i % typeBase.length]).sort((a, b) => gapRank(a) - gapRank(b));
  if (n === 0) return { dows: qualityDows.slice().sort((a, b) => a - b) as DOW[], types };
  // QUAL-PHASE-STABLE (2026-06-24) · the DOW placement is driven by the GAP requirements of the type
  // mix. When the QUALITY phase toggles its mix every week (weekIdx%2: intervals-in vs intervals-out),
  // a per-week placement moves the runner's hard-training WEEKDAYS every 7 days (Mon+Wed ↔ Tue+Thu).
  // Fix: when the caller passes a weekIdx-INVARIANT `placementTypes` (the most gap-demanding profile the
  // phase emits), decide the DOWs from THAT so they stay fixed across the phase; the returned `types`
  // still reflect THIS week's actual workouts. The intervals-safe placement is gap-legal for the lighter
  // (intervals-free) weeks too (Research/00b:55-58), so only the TYPE rotates, never the day. Both profiles
  // sort intervals to the last index, so a week that DOES carry intervals still lands it on the gap-2 slot.
  const gapBase: Array<DayPlan['type']> = (placementTypes && placementTypes.length > 0) ? placementTypes : typeBase;
  const gapTypes = Array.from({ length: n }, (_, i) => gapBase[i % gapBase.length]).sort((a, b) => gapRank(a) - gapRank(b));
  const gaps = gapTypes.map(gapRank);
  const between = (a: number, b: number): number => ((b - a + 7) % 7) - 1; // circular easy days strictly between hard a and next hard b
  const score = (dows: number[]): { ok: boolean; minSlack: number } => {
    const hard = dows.map((d, i) => ({ d, g: gaps[i] })).concat([{ d: longRunDow, g: 1 }]).sort((p, q) => p.d - q.d);
    let ok = true; let minSlack = 99;
    for (let i = 0; i < hard.length; i++) {
      const cur = hard[i]; const nxt = hard[(i + 1) % hard.length];
      const slack = between(cur.d, nxt.d) - cur.g;
      if (slack < 0) ok = false;
      minSlack = Math.min(minSlack, slack);
    }
    return { ok, minSlack };
  };
  const orig = qualityDows.slice().sort((a, b) => a - b);
  // VDEAD-B (2026-06-23) · also force the re-placement search when a quality day collides with the REST or
  // LONG day — score() alone passed orig, then the slot assignment dropped the colliding quality onto the
  // rest/long day → §5 "no quality sessions" persist-abort. The combo search below already excludes both
  // days, so it re-routes to a free day. Byte-safe: David's Tue/Thu never collide (early return holds).
  if (score(orig).ok && orig.every((d) => d !== restDow && d !== longRunDow)) return { dows: orig as DOW[], types };
  const cand = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== longRunDow && d !== restDow && (!availableDows || availableDows.has(d)));
  // SCHED-VDEAD-B-1 (2026-06-23) · when cand has fewer slots than n quality sessions, returning orig
  // unconditionally re-introduced the collision (orig may contain restDow or longRunDow). Strip the
  // colliding DOWs before returning and align types to the surviving sessions.
  if (cand.length < n) {
    const safe = orig.filter((d) => d !== restDow && d !== longRunDow);
    return { dows: safe as DOW[], types: types.slice(0, safe.length) };
  }
  const combos: number[][] = [];
  const pick = (start: number, acc: number[]): void => {
    if (acc.length === n) { combos.push(acc.slice()); return; }
    for (let i = start; i < cand.length; i++) { acc.push(cand[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  let best = orig; let bestS = score(orig); let bestShift = 0;
  for (const c of combos) {
    const s = score(c);
    const shift = c.reduce((acc, d, i) => acc + Math.abs(d - (orig[i] ?? d)), 0);
    const better = (s.ok && !bestS.ok)
      || (s.ok === bestS.ok && s.minSlack > bestS.minSlack)
      || (s.ok === bestS.ok && s.minSlack === bestS.minSlack && shift < bestShift);
    if (better) { best = c; bestS = s; bestShift = shift; }
  }
  // GAP-mode (GOAL-1) · if even the best placement leaves a gap unsatisfied (over-constrained by too
  // few available days — a tight 2-day pair can't give a VO2max session its 2 easy days), DOWNGRADE the
  // latest intervals to threshold (gap 2→1, which a tight pair CAN satisfy) — a legal recoverable
  // substitute (Research/00b · threshold needs only 1 easy day), far better than a rejected plan. Recurse
  // until satisfiable or no intervals remain.
  if (!bestS.ok && gapTypes.lastIndexOf('intervals') >= 0) {
    // Downgrade against the PLACEMENT profile (gapTypes) — it governs satisfiability — and downgrade
    // this week's matching intervals label too (if any), so the recursion converges on a legal placement
    // while the returned types stay truthful. A week with no intervals label just keeps its types.
    const downGap = gapTypes.slice(); downGap[gapTypes.lastIndexOf('intervals')] = 'threshold';
    const downLabel = types.slice();
    const li = types.lastIndexOf('intervals'); if (li >= 0) downLabel[li] = 'threshold';
    return scheduleQuality(best, downLabel, longRunDow, restDow, availableDows, downGap);
  }
  return { dows: best as DOW[], types };
}

/**
 * 2026-06-23 · COH-1 · clamp a reported longest run to be COHERENT with weekly volume.
 * The long run ANCHORS the week (easy days are held < long, RP-5), so an incoherent long
 * mis-sizes the entire plan: a 50mpw runner reporting a 2mi "longest" collapses to a ~5mpw plan
 * (easy<2 crushes every day, VOL-1 reconciles the week down); a 10mpw runner reporting a 12mi
 * "longest" inflates the week with a long the race never needs. Data-sanity bounds: a single long
 * is ≤80% of the week (other runs exist) and ≥ the average run length (recentWeekly/days — the max
 * of a set is ≥ its mean). Byte-safe for coherent runners (David: ~13mi long on ~50mpw, null freq
 * → upper bound 40, no lower clamp → unchanged).
 */
export function coherentRecentLong(recentLongMi: number, recentWeeklyMi: number, trainingDaysPerWeek: number | null): number {
  if (!recentWeeklyMi || recentWeeklyMi <= 0 || !recentLongMi || recentLongMi <= 0) return recentLongMi;
  let v = Math.min(recentLongMi, Math.round(recentWeeklyMi * 0.8)); // a single long ≤ 80% of the week
  if (trainingDaysPerWeek && trainingDaysPerWeek > 0) {
    // longest ≥ the average run (arithmetic minimum: the max of a set ≥ its mean). When a runner
    // reports longestRunBucket='0-3' (2mi) but weeklyMileageBucket=45 (50mpw) on 3 days, it is
    // MATHEMATICALLY IMPOSSIBLE for their longest run to be 2mi — the mean alone is 17mi. Raising
    // the seed to the mean resolves the contradiction by trusting the weekly mileage over the longest-
    // run self-report (mileage is what runners know; longest-run bucket is often underreported).
    // The rampCeiling in layoutWeek then governs week-1 growth from this seed (max 10% above seed).
    v = Math.max(v, Math.round(recentWeeklyMi / trainingDaysPerWeek));
  }
  return v;
}

export interface GenerateInput {
  userId: string;
  /** Race-anchored plan: the races-row slug (reads distance/date/goal from it).
   *  Mutually exclusive with goalTarget. */
  raceSlug?: string;
  /** 2026-06-15 · GOAL-anchored plan (no race row). The fitness goal IS the
   *  anchor: distance + goal time + a synthetic target date (today + the
   *  runner's chosen plan_weeks). Routes through the SAME canonical periodized
   *  builder (BASE→QUALITY→RACE-SPECIFIC→TAPER, distance-appropriate long-run
   *  progression + race-pace work, incl. ultra) so every distance gets a real
   *  build — persisted with race_id = null. Mutually exclusive with raceSlug. */
  goalTarget?: { distanceMi: number; goalSec: number | null; raceDateISO: string };
  /** 2026-06-10 · where week 0 begins.
   *   · 'monday' (default) — Monday of the current week. Established
   *     runners keep clean Mon-Sun weeks across lifecycle regens.
   *   · 'today' — the join day. Used by onboarding so a runner who
   *     signs up mid-week doesn't get runs scheduled before they
   *     existed (David: "today is their first day, why would we
   *     schedule runs in the past"). First week is a full 7 days from
   *     today; no past-dated prescriptions. */
  startAnchor?: 'today' | 'monday';
  /** 2026-06-10 · explicit week-0 start date (YYYY-MM-DD) the runner
   *  picked at onboarding. Overrides startAnchor. Clamped to ≥ today.
   *  Day-of-week placement (long run etc.) still follows user prefs. */
  startDateISO?: string;
  /** 2026-06-20 · this is a user-initiated NEW target (set a goal / add a
   *  race), not an automatic adaptation regen of the same goal. When true the
   *  corruption check (new peak long < 80% of the active prior plan's peak)
   *  is skipped — the prior plan is a DIFFERENT goal that's about to be
   *  replaced, so a legitimately smaller long (marathon→5K, or a cold-start
   *  beginner) must not be flagged as "bad input data". The check still runs
   *  for same-goal adaptation regens, which is what it's actually for. */
  freshTarget?: boolean;
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

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Monday of the week containing `iso`
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

/**
 * #10 (audit 2026-06-16) · the most-recent training-week start on-or-before
 * `iso`, where the week STARTS on `weekStartDow` (0=Sun..6=Sat). Generalizes
 * mondayOf — `weekStartBoundaryOf(iso, 1)` IS mondayOf.
 *
 * The training week ENDS on the runner's long-run day, so it STARTS the day
 * after: weekStartDow = (longRunDow + 1) % 7. This is the exact convention
 * /api/plan/week/route.ts uses (weekStartDow = (longRunDow + 1) % 7), so a
 * plan_weeks row now spans the SAME 7 days as the WeekStrip window instead of
 * straddling it for non-Sunday-long runners. For David (long=Sun → start=Mon)
 * this returns the most-recent Monday — byte-identical to mondayOf, a no-op.
 */
export function weekStartBoundaryOf(iso: string, weekStartDow: number): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const shift = -(((dow - weekStartDow) % 7 + 7) % 7);   // days back to the boundary
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
// falls back to label parsing via the shared distanceMiFromLabel parser
// (handles 5K/10K/half/marathon AND the ultra labels — 50K/50M/100K/100M —
// the phone Add Race sheet offers).
//
// 2026-07-07 · ultra-honesty audit P1-41 · this used to fall through to
// 13.1 for ANY unrecognized/unparseable label — the exact bug that gave a
// 50K/50M/100K/100M race a silent half-marathon plan (peak long ~12mi,
// half-marathon pace anchors, 13.1mi race-day workout) with no error.
// Returns null on "no distance resolvable" instead; callers MUST treat
// null as "unknown, don't assume a distance" — see loadGeneratorInputs'
// unsupported-ultra gate and the horizonRaces null-filter below.
// Exported for direct unit testing (see generate-ultra.test.ts) — the
// worktree can't spin up the DB pool to exercise loadGeneratorInputs end to
// end, so the label→distance resolution is tested at this boundary instead.
export function distanceMiOf(meta: any): number | null {
  const numeric = Number(meta?.distanceMi);
  if (isFinite(numeric) && numeric > 0) return numeric;
  const label = meta?.distanceLabel ?? meta?.distance_label ?? meta?.name ?? null;
  return distanceMiFromLabel(label);
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
  const today = await runnerToday(userId);
  const r = (await pool.query<{ mi: string | null }>(
    `SELECT MAX((data->>'distanceMi')::numeric)::text AS mi
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date
            >= $2::date - 28
        AND (data->>'distanceMi')::numeric >= 8`,  // long-ish only
    [userId, today]
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
  const today = await runnerToday(userId);
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
          AND pw.date_iso::date >= $2::date - 28
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med FROM q`,
    [userId, today],
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
  const today = await runnerToday(userId);
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
          AND pw.date_iso::date >= $2::date - 28
        GROUP BY 1
     )
     SELECT AVG(n)::text AS avg FROM wk_q`,
    [userId, today],
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
  // 2026-06-03 · runner TZ anchors all "last 28d" windows.
  const today = await runnerToday(userId);
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
        AND pw.date_iso::date BETWEEN ($2::date - 28) AND $2::date`,
    [userId, today]
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(r1.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 2 · runs with quality-effort tag.
  const r2 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM runs r
      WHERE r.user_uuid = $1
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
            >= $2::date - 28
        AND (
              LOWER(COALESCE(r.data->>'type', '')) IN ('tempo','threshold','intervals','vo2max','race')
              OR LOWER(COALESCE(r.data->>'workoutType', '')) ~ '(tempo|threshold|interval|vo2|race)'
            )`,
    [userId, today]
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(r2.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 3 · HR-based effort detection · ≥2 runs in last 28d with
  // avgHr ≥ 85% of effective max HR (Strava/Watch imports rarely tag
  // type · this catches the runner who's been doing real quality work
  // without the import tagging it). Threshold: 85% maxHR ≈ Z3+ effort.
  // Canonical max HR via the resolver (user_override → 12-month observed
  // → manual stored → null). Replaces the old `SELECT max_hr FROM profile`
  // which queried a non-existent column and silently fell through to a
  // LTHR-derived approximation (round(lthr/0.92) ≈ 176), producing a gate
  // threshold ~4 bpm too low for users with real observed data.
  const effectiveMax = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);
  if (effectiveMax && effectiveMax > 100) {
    const hrThreshold = Math.round(effectiveMax * 0.85);
    const r3 = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM runs r
        WHERE r.user_uuid = $1
          AND NOT (r.data ? 'mergedIntoId')
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
              >= $3::date - 28
          AND COALESCE(
                (r.data->>'avgHr')::numeric,
                (r.data->>'avg_hr')::numeric,
                0
              ) >= $2`,
      [userId, hrThreshold, today]
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
 *       Research/00a §7-Race-Specific (taper length by distance).  // was §race-specific-prep · heading: ### 7. Race-specific (inside ## The Seven Workout Categories)
 */
// #12 (audit 2026-06-16) · ONE categorizer across the whole generator.
// generate.ts previously kept its own distanceCategoryOf (everything ≥20mi
// collapsed to 'm', no 'ultra' case) while goal-tiers.ts maps >30mi → 'ultra'.
// The divergence meant a 50K goal got the marathon BLOCK_SHAPE (3-wk taper, MP
// race-pace tag, full-distance race-day row) while its volume/long bands came
// from the ultra tier — internally inconsistent, and an ultra's long-run
// finishes were tagged "MP" though ultra race pace is well below marathon pace.
// Re-export goal-tiers' categorizer (which already includes 'ultra') as the
// single source so block shape, taper length, and the race-pace tag all agree
// with the tier the plan is sized for. DistCategory now carries 'ultra'.
export type { DistCategory };
const distanceCategoryOf = distanceCategoryOfTier;
export function distanceCategoryOfPublic(raceDistanceMi: number): DistCategory {
  return distanceCategoryOf(raceDistanceMi);
}

/** Per-category structural numbers per Research/22 + canonical Daniels. */
const BLOCK_SHAPE: Record<DistCategory, { taperWeeks: number; raceSpecificCap: number }> = {
  '5k':    { taperWeeks: 1, raceSpecificCap: 2 }, // short, fast races · minimal taper
  '10k':   { taperWeeks: 2, raceSpecificCap: 3 },
  'hm':    { taperWeeks: 2, raceSpecificCap: 3 },
  'm':     { taperWeeks: 3, raceSpecificCap: 4 },
  // #12 · ultra mirrors the marathon block shape (3-wk taper, deep race-
  // specific block for time-on-feet + race-pace integration). Research/22
  // §Ultramarathon — taper is a marathon-style 3 weeks; the long run, not a
  // pace insert, is the race-specific stimulus (see racePaceTag below).
  'ultra': { taperWeeks: 3, raceSpecificCap: 4 },
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

/**
 * Cutback (deload) cadence · how many weeks between recovery weeks.
 * 2026-06-03 · mid-block doctrine RULE 8: when Banister TSB at generate-
 * time is < -10 (high cumulative load), deload every 3rd week instead of
 * every 4th. null/cold-start → mod-4. Cite docs/PLAN_ENGINE_MID_BLOCK_
 * DOCTRINE.md §Rule 8; Pfitzinger Faster Road Racing §"recovery weeks
 * under load".
 *
 * #13 (audit 2026-06-16) · ONE definition shared by volumeCurve (which
 * cuts the weekly mileage) and layoutWeek (which relaxes the long-run
 * floor on cut weeks). They previously diverged — volumeCurve cut at
 * this cadence while layoutWeek hardcoded mod-4 — so on a TSB<-10
 * runner's deloaded week (mod-3) the long run was pinned to full peak
 * against a reduced budget and the easy days absorbed the cut, the
 * opposite of a deload.
 */
function cutbackCadence(tsbAtStart?: number): number {
  return (typeof tsbAtStart === 'number' && tsbAtStart < -10) ? 3 : 4;
}

/** Experience-level volume floor + ramp tuning (Q-01 / SIM-02).
 *
 * Without these, a true beginner running 5 mpw who picks a goal race got
 * an immediate jump to 15 mpw (3× their actual base) in week 1 — way
 * over the 10% rule. With these, each level has a sensible floor that
 * matches research-grounded base mileage by experience.
 *
 * Cite: Research/00a-distance-running-training.md §Volume-Guidelines-by-Experience  // was §volume-by-experience · heading: ## Volume Guidelines by Experience and Distance
 * Cite: Research/22-plan-templates.md §minimum-base-by-level  // TODO: no matching heading in Research/22 — content exists but heading not anchored
 */
export type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
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
 * The geometric ramp respects Research/00a §Volume-Progression-Rules  // was §progressive-overload · heading: ### Volume progression rules
 * 10%/wk cap: when (peak/base)^(1/buildWeeks) > 1.10, we cap the
 * per-week growth at 10% and accept that the peak target won't be
 * fully reached. Honest about what's achievable in the runway.
 *
 * Cite: Research/00a-distance-running-training.md §Volume-Progression-Rules  // was §progressive-overload · heading: ### Volume progression rules
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
  // 2026-06-20 · true-beginner volume floor. The research VOLUME_FLOOR (10
  // mpw for 'beginner') is the minimum base for a *trained* beginner; a
  // genuinely sedentary 0-5 mi/week runner shouldn't be floored up to 2-4×
  // their reported base in week 1. For beginners, respect their reported base
  // with a coherence minimum of 6 mpw instead of the 10 floor. Every other
  // level is unchanged — start = max(tier floor, base) — so David /
  // intermediate / advanced plans are byte-for-byte identical.
  // 2026-06-23 · VAR-06 · respect the runner's reported base at EVERY level (generalizing
  // the beginner carve-out below), not just beginners. The old non-beginner `max(floor,
  // base)` jumped a detrained sub-floor runner (e.g. 10mi/wk intermediate) up to the tier
  // floor in week 1 — a big leap that skips the safe ramp and flattened the low
  // weekly-mileage buckets together (David's "weekly mileage doesn't do anything"). A
  // runner already at/above the tier floor (David, any trained runner) is byte-unchanged:
  // max(6, base) == base == max(floor, base) when base >= floor >= 6.
  const TRUE_BEGINNER_MIN_MPW = 6;
  void floor;
  const start = Math.max(TRUE_BEGINNER_MIN_MPW, baseMi);
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
  // #13 · shared cadence so layoutWeek's long-run-floor relaxation lands
  // on the SAME weeks this curve actually deloads. Cite §Rule 8.
  const cutbackEveryN = cutbackCadence(tsbAtStart);
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
  // climb week × 0.80 (RC2-4 · doctrine is 20-30% reduction; prior 0.85 = 15% — too shallow).
  // Cite: Pfitzinger Advanced Marathoning §"Cutback Weeks" (20-25% drop).
  let climbIdx = 0;
  let lastClimb = start;
  let lastPeak = start;
  let lastDeloadVol: number | null = null; // RC2-4 post-deload WoW guard (see below)
  for (let i = 0; i < buildWeeks; i++) {
    if (deloadMask[i]) {
      const deload = Math.round(lastClimb * 0.80);
      lastDeloadVol = deload;
      vols.push(deload);
    } else {
      const geometricTarget = start * Math.pow(climbFactor, climbIdx);
      // RC2-4 post-deload WoW cap · 20% deload can create a >50% jump when the geometric
      // curve climbs aggressively (e.g. 5mpw → 25mi peak in 14 wks). Cap the FIRST climbing
      // week after a deload to deload × 1.45 so the WoW validator's 50% limit never fires.
      // The cap only bites on that one week; subsequent weeks continue the uncapped curve.
      // Cite: Pfitzinger Advanced Marathoning §"Cutback Weeks" + §"Week-over-Week 10% Rule".
      const cappedTarget = lastDeloadVol != null
        ? Math.min(geometricTarget, lastDeloadVol * 1.45)
        : geometricTarget;
      lastDeloadVol = null;
      const rounded = Math.round(Math.min(cappedTarget, peakTarget));
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
      // Research/08 §9.2: marathon 3-week taper targets 80-90% → 60-70% → 40-50% of peak.
      // 0.82 = midpoint of the 80-90% band for week -3; 0.60 and 0.45 are within their bands.
      // HM taper is 2 weeks (taperWeeks=2), so the wksLeft===3 branch never fires for HM.
      const taperFactor = wksLeft === 1 ? 0.45 : wksLeft === 2 ? 0.60 : 0.82;
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

export interface DayPlan {
  dow: DOW;
  type: 'easy' | 'long' | 'threshold' | 'intervals' | 'tempo' | 'race' | 'rest' | 'shakeout' | 'race_week_tuneup';
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
        cat === '5k'    ? '5×800m @ I pace · 90s jog'
      : cat === '10k'   ? '4×1km @ I pace · 2:00 jog'
      : cat === 'hm'    ? '6×800m @ I pace · 90s jog'
      : cat === 'ultra' ? '3×1mi @ I-T transition · 2:00 jog' // ULTRA-IREP-1 (2026-06-23): Research/00a §312 cap = 2-3×1600m "rarely" for 100K; 5× over-counts; 3× stays within doctrine max
      :                   '5×1mi @ I-T transition · 2:00 jog',
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
export async function resolvePrescriptions(
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
    // HM-RSPEC-1 (2026-06-23): HM race-specific threshold should be 5×1mi (Research/00a §309
    // "5–6×1mi at half-marathon pace"), not the quality-phase 3×1mi. The DB row wins when present;
    // fallback distinguishes race-specific from quality for the HM inline prescription.
    threshold:        thresholdT?.prescriptionText
                   ?? (phase === 'race_specific' && cat === 'hm' ? '5×1mi @ T pace · 90s jog' : fallback.threshold),
    tempo:            fallback.tempo,
    citationInterval: intervalsT?.citation          ?? fallback.citationInterval,
    citationThreshold: thresholdT?.citation         ?? fallback.citationThreshold,
  };
}

/**
 * 2026-06-07 · Audit D follow-up · long-run race-pace finish for the late
 * build. Returns {pct, tag} or null (plain easy long). Derived from PHASE
 * POSITION (weeks from the end of the phase), so it holds for any plan
 * length — an 8-week and a 16-week build both get the finish in their last
 * three QUALITY weeks, never by a hardcoded absolute week number.
 *
 * Doctrine · Research/22 §3:
 *   HM "endurance build → LT + LR with HMP segments → race-specific HMP":
 *       marathon-pace warm-in through the last QUALITY weeks, stepping to
 *       HMP at the QUALITY→RACE-SPECIFIC seam, then HMP through race-specific.
 *   M  "long run w/ last N @ M": race pace IS marathon pace → every finish @ MP.
 *
 *   RACE-SPECIFIC (every wk):       40% @ {HM | MP}
 *   QUALITY last wk:                33% @ {HM | MP}   (HMP step for HM)
 *   QUALITY 2nd-from-last:          33% @ {M  | MP}   (M-pace warm-in for HM)
 *   QUALITY 3rd-from-last:          30% @ {M  | MP}
 *   earlier QUALITY / BASE / TAPER: null
 *
 * 5K/10K (racePaceTag null) → null everywhere · they train via reps, not
 * long-run pace inserts.
 */
function longFinishSegment(
  phase: string,
  weeksToPhaseEnd: number,
  racePaceTag: 'HM' | 'MP' | null,
): { pct: number; tag: 'HM' | 'M' | 'MP' } | null {
  if (!racePaceTag) return null;
  // Research/22 §3 Advanced peak week: "16mi LR w/ last 8mi @ HMP" = 50%.
  // §4 Marathon peaks at 64-70%; Research/00a §fast-finish says 10-25% (general principle).
  // 0.50 targets the §22 minimum for the race-specific phase; QUALITY ramp (0.30→0.33→0.33)
  // builds toward it progressively.
  if (phase === 'RACE-SPECIFIC') return { pct: 0.50, tag: racePaceTag };
  if (phase !== 'QUALITY') return null;
  // Last three QUALITY weeks build toward race pace. HM ramps M → M → HMP;
  // M holds MP throughout (race pace == marathon pace).
  const mTag: 'M' | 'MP' = racePaceTag === 'HM' ? 'M' : 'MP';
  switch (weeksToPhaseEnd) {
    case 0:  return { pct: 0.33, tag: racePaceTag };  // last QUALITY wk · HMP step / MP
    case 1:  return { pct: 0.33, tag: mTag };
    case 2:  return { pct: 0.30, tag: mTag };
    default: return null;                             // earlier QUALITY · plain long
  }
}

function layoutWeek({
  phase, weekIdx, weeksToPhaseEnd, totalWeeks, weeklyMi, peakWeeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi, rx, easyMileFloor, recentLongMi, recentQualityDistanceMi, tierTarget, trainingDaysPerWeek, cutbackEveryN = 4, baseBuilding = false, availableDows = null,
}: {
  phase: string; weekIdx: number;
  /** 2026-06-07 · Audit D follow-up · 0-indexed weeks remaining until this
   *  phase ends (0 = last week of the phase). Drives the late-QUALITY
   *  long-run finish window in a plan-length-independent way. */
  weeksToPhaseEnd: number;
  totalWeeks: number;
  weeklyMi: number;
  /** 2026-06-23 · DIST-1 · peak weekly volume of the whole plan (max of the volume
   *  curve). Scales the marathon/ultra long so it REACHES peakLongMiBand[1] when weekly
   *  volume peaks, instead of topping out short via weeklyMi × longShare. */
  peakWeeklyMi: number;
  longRunDow: DOW; qualityDows: DOW[]; restDow: DOW;
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
  /** 2026-06-10 · cap total running days to the runner's stated
   *  frequency (excess easy slots become rest). NULL → fill all slots. */
  trainingDaysPerWeek?: number | null;
  /** #13 (audit 2026-06-16) · deload cadence shared with volumeCurve so the
   *  long-run-floor relaxation lands on the weeks the volume curve actually
   *  cut. 3 under TSB<-10, else 4. Defaults to 4 (legacy mod-4) when omitted. */
  cutbackEveryN?: number;
  /** 2026-06-20 · base-building (beginner) plan: quality days are LIGHT (a
   *  short tempo / fartlek with surges), never structured I/R reps, and only
   *  in the sharpen phase. Gated to level==='beginner' (templateFor), so
   *  intermediate/advanced are unchanged. Research/22 §5K/10K/HM/M Beginner. */
  baseBuilding?: boolean;
  /** 2026-06-20 · days the runner can run. When set, easy days fill only these
   *  and every other day is rest (long/quality already land on available days
   *  via the upstream derivation). null = unrestricted (existing behaviour). */
  availableDows?: Set<number> | null;
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
        } else if (daysBeforeRace === 5) {
          // 2026-06-09 state-audit Tier 2.2 · the race-week tune-up.
          // Research/08 §9.3: the race-prep session sits ~5 days out —
          // HM/M: 4×1km at race pace w/ 90s jog; 5K/10K keep the
          // shorter 2×0.5mi @ T primer. The audit found race week
          // carried ZERO quality (last touch 10 days out) · legs go
          // flat into the gun. This is also the WATCHING test point:
          // hold race pace at honest HR here and the race plan is
          // confirmed.
          // RACEWK-SHARP-1 (2026-06-23) · marathon/ultra race-week sharpener must be 5K pace not race
          // pace. Research/08 §9.3 "3 mi w/ 5×1min @ 5K pace, 4-5 days out" — MP is too slow to be a
          // neuromuscular primer. TAPER-phase already used 5K pace (line 1269); race-week now matches.
          const isUltra = raceDistanceMi >= 31;
          const isMarathonPlus = raceDistanceMi >= 20; // marathon + ultra; isUltra checks first
          const isLongRace = raceDistanceMi >= 12;
          days.push({
            dow, type: 'race_week_tuneup',
            distanceMi: isLongRace ? 5 : 4,
            isQuality: true, isLong: false,
            // ULTRA-TUNE-1 (2026-06-23) · ultra race-week tune-up uses T-pace (threshold primer), NOT I-pace
            // (5K pace). Ultra race pace is 10–14+ min/mi — running 5K-pace reps (30–40% faster than race
            // pace) the week before a 100K is physiologically wrong. Research/00a §taper: "intensity preserved"
            // at the runner's training intensity (threshold, not VO2max) for ultra. 5K-SHARP-1 · 5K/10K now
            // uses 5K-pace reps (Research/00a §taper: "intensity preserved"). Shorter reps to match distance.
            // raceDistanceMi < 7 separates 5K (3.1mi) from 10K (6.2mi).
            subLabel: isUltra ? '5×400m @ T pace · 90s jog'
              : isMarathonPlus ? '5×400m @ 5K pace · 2min jog'
              : isLongRace ? '4×1km @ race pace · 90s jog'
              : raceDistanceMi < 7 ? '5×200m @ 5K pace · 90s jog'
              : '4×400m @ 5K pace · 90s jog',  // 10K
            notes: isUltra
              ? 'Threshold strides, 5 days out. Hold T effort — just under comfortably hard. Brief neuromuscular prime.'
              : isMarathonPlus
              ? 'Five sharp 5K-pace reps, 5 days out. Brief neuromuscular primer. Legs stay fresh.'
              : isLongRace
              ? 'Race-pace primer, 5 days out. Hold goal pace, even reps, stop at 4. Confidence check, not a workout.'
              : 'Short race-pace strides, 5 days out. Quick turnover — finish feeling sharp, not tired.',
          });
        } else if (daysBeforeRace >= 3 && daysBeforeRace <= 4) {
          // TAPER-RW-1 · time-based easy prescription (not distance). 35-45 min at conversational
          // pace; the distance is a planning guide only. Cite: Daniels §Race-week sharpening.
          const minEasy = daysBeforeRace === 4 ? 40 : 35;
          days.push({ dow, type: 'easy', distanceMi: 3 + (daysBeforeRace === 4 ? 1 : 0), isQuality: false, isLong: false, subLabel: `EASY · ${minEasy} MIN`, notes: `${minEasy} min easy. Conversational effort throughout. Strides optional at end.` });
        } else {
          // TAPER-RW-1 · early race-week easy days also time-based (35-45 min)
          const earlyEasy = daysBeforeRace > 5;
          days.push({ dow, type: earlyEasy ? 'easy' : 'rest', distanceMi: earlyEasy ? 4 : 0, isQuality: false, isLong: false, subLabel: earlyEasy ? 'EASY · 40 MIN' : 'REST', notes: earlyEasy ? '40 min easy. Keep it truly easy — save the legs.' : '' });
        }
      }
    }
    // 2026-06-21 · PLACE-A · availability in race week. The offset-based
    // placement above is blind to availableDows — it could put the tune-up or
    // a midweek easy on a day the runner said they can't run (the standard-week
    // easy-fill respects availability; the race-week branch did not). When
    // availableDows is set, relocate the shakeout + tune-up to the nearest
    // available day in their window, and rest any non-race running day that
    // isn't available. The RACE day is the sole exemption — it's fixed by the
    // calendar. null availableDows → untouched (David / legacy).
    const restRow = (dow: number, note: string): DayPlan => ({
      dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: note,
    });
    if (availableDows != null) {
      const isAvail = (dow: number) => availableDows.has(dow) || dow === raceDow;
      for (const role of ['shakeout', 'race_week_tuneup'] as const) {
        const idx = days.findIndex((d) => d.type === role);
        if (idx < 0 || isAvail(idx)) continue;
        const window = role === 'shakeout' ? [1, 2, 3] : [5, 4, 6];
        for (const off of window) {
          const dow: number = ((raceDow - off) % 7 + 7) % 7;
          if (dow !== raceDow && isAvail(dow) && days[dow].distanceMi === 0) {
            days[dow] = { ...days[idx], dow: dow as DOW };
            break;
          }
        }
        days[idx] = restRow(idx, 'Off. Taper week — rest is the work now.');
      }
      for (let d = 0; d < 7; d++) {
        if (d !== raceDow && days[d].distanceMi > 0 && !isAvail(d)) {
          days[d] = restRow(d, 'Off. Not one of your run days this week.');
        }
      }
    }
    // 2026-06-10 · frequency cap also applies to race week. Without it a
    // 3-day runner saw 6 running days in their race week (race + shakeout
    // + tune-up + 3 easies). 2026-06-21 · PLACE-B · trim in priority order.
    // RACEWEEK-TUNEUP-DROP-1 (2026-06-23) · previous order (easy → tune-up → shakeout)
    // made a 2-day runner keep race + shakeout instead of race + tune-up. The tune-up
    // is the week's key quality prime (§9.3); the shakeout is just a loosening jog.
    // Correct order: easy → shakeout → tune-up. freq 1 → race only,
    // freq 2 → race + tune-up. The race day always stays. NULL frequency → untouched.
    if (trainingDaysPerWeek != null) {
      let running = days.filter((d) => d.distanceMi > 0).length;
      for (const role of ['easy', 'shakeout', 'race_week_tuneup'] as const) {
        if (running <= trainingDaysPerWeek) break;
        for (const d of days) {
          if (running <= trainingDaysPerWeek) break;
          if (d.type === role && d.distanceMi > 0) {
            const wasTuneup = d.type === 'race_week_tuneup';
            d.type = 'rest'; d.distanceMi = 0; d.subLabel = 'REST';
            d.notes = wasTuneup
              ? 'Off. Too few run days this week to fit the tune-up — rest is the work now.'
              : 'Off. Taper week — rest is the work now.';
            running--;
          }
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
  // #13 · cadence threaded from volumeCurve (same cutbackCadence(tsb)) so a
  // TSB<-10 runner's mod-3 deload weeks relax the long-run floor on the weeks
  // the volume curve actually cut — not the stale hardcoded mod-4. For
  // non-taper weeks layoutWeek's absolute weekIdx equals volumeCurve's build-
  // week index (build phases precede TAPER), so the masks line up exactly.
  const isCutback = weekIdx > 0 && (weekIdx + 1) % cutbackEveryN === 0;
  const longCat = distanceCategoryOf(raceDistanceMi);
  // ULTRA-LONG-CAP-1 (2026-06-23): elite-tier ultra has peakLongMiBand[1]=32, which exceeds
  // the 50K race distance (31.1mi). Cap at 95% of raceDistanceMi for ultra so training long
  // never exceeds the race; for 100K (62.1mi) the tier cap of 32 already dominates so the
  // min() is a no-op. All non-ultra distances (marathon peak 22-25mi < 26.2mi) are unaffected.
  const longCap = (longCat === 'ultra')
    ? Math.min(tierTarget.peakLongMiBand[1], Math.round(raceDistanceMi * 0.95))
    : tierTarget.peakLongMiBand[1];
  // 2026-06-23 · DIST-1 · long-run SIZE, research-grounded:
  //   5k/10k/hm — share of the week (Research/00a:184, ≤25-30%); weeklyMi × longShare
  //     already lands inside the tier's peakLongMiBand, so keep it.
  //   marathon/ultra — DISTANCE-driven toward the doctrine peak (Research/22:219-275 ·
  //     marathon peak long 20-24mi). The marathon long is 45-67% of the week at peak — the
  //     EXPLICIT exemption from the % cap, bounded by TIME not distance (Research/00a:217
  //     "<3-3.5h for marathoners; ultra athletes go longer"). Scale it to REACH
  //     peakLongMiBand[1] exactly when weekly volume peaks, ramping with the volume curve;
  //     weeklyMi × longShare alone tops out ~5mi short of the doctrine peak.
  // DIST-1 · marathon/ultra are distance-driven to peakLongMiBand[1]. RC2-2 (2026-06-23) · HM-advanced
  // (longShare 0.25, peak ~56) reaches only 14 < band[0]=15 via the share path — so for 5k/10k/hm, when
  // the share would underreach band[0] AT PEAK, use the distance-driven size too. Byte-safe: only lifts
  // when the peak share is short of the band floor (elite/int/dev + David's horizon HM stay in-band).
  const drivenLongRaw = peakWeeklyMi > 0 ? Math.round(weeklyMi * (longCap / peakWeeklyMi)) : 0;
  const shareLongRaw = Math.round(weeklyMi * longShare);
  const longMiRaw = (longCat === 'm' || longCat === 'ultra') && peakWeeklyMi > 0
    ? drivenLongRaw
    : (peakWeeklyMi > 0 && Math.round(peakWeeklyMi * longShare) < tierTarget.peakLongMiBand[0])
      ? Math.max(shareLongRaw, drivenLongRaw)
      : shareLongRaw;
  // 2026-06-21 (David signed off): the recent-long floor (don't author a shorter
  // long than the runner just ran) must NOT apply in TAPER — the taper
  // deliberately reduces the long into the race. Flooring it at recentLongMi
  // pinned the taper long flat (wk14 long 14 instead of ~11), a weak taper.
  // Skipping it in TAPER lets the long reduce; the post-compose WoW re-smoother
  // keeps the descending sequence legal.
  // marathon/ultra · NO recent-long floor (the distance-driven ramp above sizes it; a flat
  // floor at recentLongMi would pin every week at the runner's recent peak instead of
  // ramping UP to it only 2-3 times near race day · Research/22:228). 5k/10k/hm keep it.
  const longFloor = (longCat !== 'm' && longCat !== 'ultra' && phase !== 'TAPER' && recentLongMi && recentLongMi >= 8)
    ? Math.round(recentLongMi - (isCutback ? 2 : 0))
    : 0;
  // 2026-06-23 · VAR-02 + A1 · ANCHOR the long to the runner's recent longest run and ramp it
  // GRADUALLY. The longest-run input drives the early long (without this, week 1 jumped to
  // weeklyMi×longShare — a 3mi-longest runner got an 8mi week-1 long, 4× capacity, and the
  // 0-3/3-6/6-10 buckets were byte-identical). A1 fixes the ramp SHAPE: seed week-0 at ≤110% of
  // the REAL recent long (Research/00a:752 · a single run >110% of prior-30d = 64% injury risk),
  // then climb at ≤10%/step toward the doctrine cap, reaching it ~3-4 weeks before the race
  // (Research/22:228 · the long peaks LATE). The old 1.20^(weekIdx+1) ceiling saturated the cap by
  // BASE week 2 (parked at 19 for the whole build) and front-loaded a 117%-of-recent week-1 long.
  // recentLongMi 0 (no self-report) → no anchor (volume-derived size as before).
  const rampCeiling = (() => {
    // COH-3 · the taper long DESCENDS with volume; the build's climbing ramp ceiling
    // (recentLongMi × 1.10^weekIdx) must NOT govern it — for a low recent-long runner the still-
    // climbing ceiling suppressed the FIRST taper long below its volume size, making the SECOND
    // taper long larger (non-monotonic taper). In TAPER, only the doctrine cap + descending
    // longMiRaw apply. Byte-safe for high recent-long runners (their stepCeil already cleared longCap).
    if (phase === 'TAPER') return longCap;
    if (!recentLongMi || recentLongMi <= 0) return longCap;
    const seed = Math.round(recentLongMi * 1.10);              // week-0 ≤110% of recent
    const stepCeil = recentLongMi * Math.pow(1.10, weekIdx);   // ≤10%/step geometric climb
    const peakWeekIdx = Math.max(1, totalWeeks - 4);           // reach the cap ~3-4 wk before race
    const linearTarget = seed + Math.max(0, longCap - seed) * Math.min(1, weekIdx / peakWeekIdx);
    return Math.max(longFloor, seed, Math.round(Math.min(stepCeil, linearTarget)));
  })();
  let longMi = Math.min(
    Math.max(longMiRaw, longFloor),
    longCap,
    rampCeiling,
  );
  // RP-FREQ-FLOOR (2026-06-24) · race-prep analogue of MAINT-FREQ-FLOOR. A distance-driven long
  // (marathon/ultra DIST-1 above) can over-consume a small week's budget, pinning the easy days at
  // 1mi via perEasyBudgetCap below — the same junk-run class fixed in maintenance. Race-prep can't
  // lift weeklyMi (it is the periodized volume curve), so instead CAP the long to leave ≥2mi for
  // every other running day: longMi ≤ weeklyMi − quality − 2×easyDays. Only when the capped long
  // still stays the longest run (> per-quality, ≥ a 3mi coherence floor, ≥ the recent-long floor);
  // a genuinely volume-constrained week (can't fit a floor-respecting long AND 2mi easies — e.g.
  // 10mpw/6-day) is left as-is. BASE/TAPER/cutback are excluded (deliberate deload shapes already
  // floor or descend). Gated on stated frequency so David's null-frequency profiles stay byte-stable;
  // a no-op for healthy-volume weeks where the long never approaches that ceiling.
  if (trainingDaysPerWeek != null && phase !== 'BASE' && phase !== 'TAPER' && !isCutback) {
    const qDays = qualityDows.length;
    const easyDays = Math.max(0, trainingDaysPerWeek - 1 - qDays);
    const perQEst = qDays > 0 ? Math.max(2, Math.round((weeklyMi * qualityShare) / qDays)) : 0;
    const longRoom = weeklyMi - perQEst * qDays - 2 * easyDays;
    const minLong = Math.max(perQEst + 1, 3, longFloor);
    if (longRoom >= minLong && longRoom < longMi) longMi = longRoom;
  }
  // 2026-06-03 · mid-block doctrine RULE 2 (quality distance floor).
  // Floor qualityMiEach at the runner's recent quality-day distance ·
  // 1mi (the −1mi tolerance lets rep-shape work fit). Cap at the
  // weeklyMi share so we don't blow weekly budget on quality.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 2
  const qualityRaw = qualityDows.length > 0 ? Math.round((weeklyMi * qualityShare) / qualityDows.length) : 0;
  const qualityFloor = (recentQualityDistanceMi && recentQualityDistanceMi >= 5)
    ? Math.max(0, recentQualityDistanceMi - 1)
    : 0;
  // 2026-06-21 · quality never dwarfs the long run or the week (INV3/INV4).
  // Symmetric to the easy-fill clamp (easyCeiling = longMi) that fixed the
  // Lilley inversion — the easy clamp guarded easy days only, so a single
  // collapsed quality day (few running days, high weekly budget, short race
  // with a tier-capped small long) could still author a "tempo" LONGER than
  // the long run (e.g. 55mpw weekends-only 5K → 12mi tempo vs 8mi long).
  // Clamp to longMi (long stays the longest run) and 0.6×week (no dwarf);
  // unplaceable residual lowers the weekly total instead of piling on quality.
  // Only binds in the degenerate case — normal plans keep qualityRaw (David's
  // long ≫ quality → min picks qualityRaw, byte-for-byte unchanged).
  const qualityCeiling = Math.max(1, Math.min(longMi || Infinity, Math.round(weeklyMi * 0.6)));
  // RP-FREQ-FLOOR (quality half) · a placed quality session is a real workout, never a 1mi "intervals"
  // (qualityRaw rounds to 1 at the 10mpw floor with two quality days). Floor it at 2mi for stated-
  // frequency non-deload weeks — the RP-FREQ-FLOOR long cap above already reserved 2mi/quality, so the
  // budget balances. Capped at qualityCeiling so it never exceeds the long. null-freq/BASE/TAPER/cutback
  // and healthy weeks (qualityRaw ≥ 2) are byte-unchanged.
  const qualityFloorFreq = (trainingDaysPerWeek != null && phase !== 'BASE' && phase !== 'TAPER' && !isCutback) ? 2 : 0;
  const qualityMiEach = Math.min(Math.max(qualityRaw, qualityFloor, qualityFloorFreq), qualityCeiling);

  // Pre-allocate: rest = 0, long + quality slotted in
  const slots: (DayPlan | null)[] = new Array(7).fill(null);
  slots[restDow] = { dow: restDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  // 2026-06-02 · race-pace label varies by race distance · "MP" only
  // makes sense for a marathon target. HM target → HM pace. 5K/10K
  // target → no MP insert at all (those distances train via reps, not
  // long-run pace inserts).
  // #12 (audit 2026-06-16) · keyed on the shared category, not a raw mileage
  // threshold, so an ULTRA (>30mi) no longer trips the old `>=25 → 'MP'` arm.
  // Ultra race pace sits well below marathon pace, so tagging a long-run finish
  // (or race day) "MP" is wrong; ultras build via the long run / time-on-feet,
  // so they take the null branch (no race-pace long-run insert), same as 5K/10K.
  const cat = distanceCategoryOf(raceDistanceMi);
  const racePaceTag = cat === 'm'  ? 'MP'
                    : cat === 'hm' ? 'HM'
                    : null;  // 5k / 10k / ultra → no long-run pace insert
  // 2026-06-07 · Audit D follow-up · race-pace finish for late-build longs.
  // RACE-SPECIFIC keeps its 40% finish; the last three QUALITY weeks now
  // also carry the M→HMP warm-in (Research/22 §3). Encoded into the
  // sub_label ("LONG · 4mi @ M") so buildWorkoutSpec's extractFinishSegment
  // picks it up and the watch executes easy-build + finish — closing the
  // generator side of the D1 gap (in-place row patches fixed the active
  // plan; this fixes every future regen + new runner).
  const finishSeg = longFinishSegment(phase, weeksToPhaseEnd, racePaceTag);
  const finishMi = finishSeg ? Math.round(longMi * finishSeg.pct) : 0;
  const hasFinish = finishSeg != null && finishMi > 0 && finishMi < longMi;
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    subLabel: hasFinish ? `LONG · ${finishMi}mi @ ${finishSeg!.tag}` : 'LONG',
    notes: hasFinish
      ? `Steady ${longMi - finishMi}mi, then ${finishMi}mi at ${finishSeg!.tag === 'HM' ? 'half-marathon pace' : 'marathon pace'}.`
      : phase === 'TAPER' ? 'Easy long, hold pace. Quality lives in the race itself.'
      : 'Conversational throughout. Build the engine.',
  };
  if (phase !== 'BASE') {
    // Q-02 fix: quality mix now varies by race distance per Research/22.
    // 5K leans VO2max heavy (intervals); 10K balanced threshold + intervals;
    // HM threshold-dominant + race-specific MP; M long-run + threshold +
    // marathon-pace integration. Race-specific phase still steers harder
    // toward race-specific quality regardless of distance.
    // #12 · `cat` is the shared categorizer hoisted above (includes 'ultra').
    // The `/* m / ultra */` arms are the explicit fall-through: an ultra trains
    // aerobic-dominant with threshold support (Research/22 §Ultramarathon), so
    // the marathon quality mix is the right default — but the long-run finish is
    // NOT tagged MP (racePaceTag is null for ultra above).
    // Quality type mix as a FUNCTION of the week index (only QUALITY alternates by parity), so the
    // QUAL-PHASE-STABLE placement below can inspect both parities and anchor the days to the more
    // gap-demanding one — keeping the runner's training WEEKDAYS fixed while the workout TYPE rotates.
    const qualityTypesFor = (wi: number): Array<DayPlan['type']> => baseBuilding
      // Base-building (beginner): a single LIGHT tempo/fartlek in the sharpen
      // phase only; BASE weeks are pure easy + strides + long. No structured
      // I/R reps — Research/22 §Beginner (Higdon Novice / Mayo). Sized small
      // below (the 3mi tempo floor is lifted for base-building).
      ? ( phase === 'TAPER' ? ['race_week_tuneup']
        : (phase === 'QUALITY' || phase === 'RACE-SPECIFIC') ? ['tempo']
        : [] )
      :
        phase === 'TAPER'         ? ['race_week_tuneup']                               // tune-up · same for all distances
      : phase === 'RACE-SPECIFIC'
          ? (cat === '5k'   ? ['intervals', 'intervals']
           : cat === '10k'  ? ['intervals', 'intervals']   // RACE-SPEC-10K-1 (2026-06-23): 10K race-specific dominates with I-pace reps (Research/00a §308 "3–4×2km at 10K pace"), mirrors 5K; threshold was demoted to QUALITY phase
           : cat === 'hm'   ? ['threshold', 'intervals']
           : /* m / ultra */  ['tempo', 'threshold'])
      : phase === 'QUALITY'
          ? (cat === '5k'   ? (wi % 2 === 0 ? ['intervals', 'intervals'] : ['intervals', 'threshold'])
           : cat === '10k'  ? (wi % 2 === 0 ? ['intervals', 'threshold'] : ['threshold', 'tempo'])
           : cat === 'hm'   ? (wi % 2 === 0 ? ['intervals', 'threshold'] : ['threshold', 'tempo'])
           : cat === 'ultra'
               // ULTRA-QUAL-1 (2026-06-23): ultra training is threshold-dominant; I-pace intervals are
               // "rarely" appropriate (Research/00a §311 "3×1600m at 10K pace (rarely)"). Alternating
               // intervals every other week throughout the QUALITY block means 4-5 interval sessions per
               // cycle — far above research doctrine. Remove intervals from the regular rotation; if a
               // rare interval session is warranted, it's an exceptional week not the default.
               ? ['threshold', 'tempo']
           : /* marathon */  (wi % 2 === 0 ? ['threshold', 'tempo']     : ['threshold', 'intervals']))
      : [];
    const qualityTypes = qualityTypesFor(weekIdx);
    // Prescription strings are resolved up-front from workout_library
    // (Research/04 + 22) via resolvePrescriptions() — falls back to the
    // historical inline catalog if the library has no matching row.
    // B3 · stimulus-gap-aware scheduling: order intervals last (toward the long's buffer) and
    // re-place days only when the default assignment violates a Research/00b:55-60 gap.
    // PP-3 (2026-06-23, David approved) · non-race taper weeks get exactly 1 tune-up, not 2.
    // Pfitzinger §taper: "reduce volume, preserve intensity, one quality session." Two tune-ups
    // in a non-race taper week accumulate fatigue and blunt the taper effect.
    const effectiveQDows = (phase === 'TAPER' && !isRaceWeek) ? qualityDows.slice(0, 1) : qualityDows;
    // QUAL-PHASE-STABLE (2026-06-24) · anchor the quality DOWs to a weekIdx-INVARIANT placement profile
    // so they don't oscillate as the QUALITY mix toggles. The two parities differ only by whether
    // intervals is present; the intervals-bearing parity is the most gap-demanding, so place against it.
    // Non-QUALITY phases don't alternate → use this week's types directly (placement byte-unchanged).
    const placementProfile: Array<DayPlan['type']> = phase === 'QUALITY'
      ? (() => { const a = qualityTypesFor(0), b = qualityTypesFor(1);
          return a.includes('intervals') ? a : b.includes('intervals') ? b : qualityTypes; })()
      : qualityTypes;
    const scheduledQ = scheduleQuality(effectiveQDows, qualityTypes, longRunDow, restDow, availableDows, placementProfile);
    scheduledQ.dows.forEach((dow, i) => {
      if (slots[dow] != null) return; // conflict · skip
      const qt = scheduledQ.types[i % scheduledQ.types.length];
      const sub =
        qt === 'intervals'        ? rx.intervals
      : qt === 'threshold'        ? rx.threshold
      : qt === 'tempo'            ? (baseBuilding
                                      // Beginner sharpen day = a light fartlek: an easy run with a
                                      // few short surges at T effort, sized to the runner (no 3mi
                                      // tempo floor). Research/22 §Beginner ("2.5mi E w/ 4×1 min @ T").
                                      ? `${Math.max(1.5, Math.round(qualityMiEach * 10) / 10)}mi E w/ 5×1 min surges @ T effort`
                                      : `${Math.max(3, Math.round(qualityMiEach * 0.6))}mi ${rx.tempo}`)
      : qt === 'race_week_tuneup' ? (
          raceDistanceMi >= 31 ? '5×400m @ T pace · 90s jog'   // ULTRA-TUNE-1: threshold, not I-pace (see race-week note)
        : raceDistanceMi >= 20 ? '5×400m @ 5K pace · 2min jog' // TAPER-SHARP-1 · marathon: 5K-pace prime
        : raceDistanceMi >= 12 ? '4×1km @ race pace · 90s jog'  // PP-2 · HM: race-pace prime
        : cat === '5k' ? '5×200m @ 5K pace · 90s jog'           // 5K-SHARP-1
        : '4×400m @ 5K pace · 90s jog'                          // 10K-SHARP-1
      )
      :                              'QUALITY';
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
      // CC-1 (2026-06-23, David approved) · a race-week tune-up is a 3-5mi SHARPENING session
      // (Research/08:394-438), NOT a full quality slot. Cap its distance to the band so composed ==
      // persisted — the spec realizer truncates a 10mi tune-up to ~3.6mi at persist, silently dropping
      // taper volume the gate counted (51→44.6mi). The freed surplus flows into the easy-fill below.
      const slotMi = effectiveType === 'race_week_tuneup'
        ? Math.min(qualityMiEach, (cat === '5k' || cat === '10k') ? 4 : 5)
        : qualityMiEach;
      slots[dow] = {
        dow: dow as DOW, type: effectiveType, distanceMi: slotMi, isQuality: true, isLong: false,
        subLabel: sub,
        notes:
          effectiveType === 'intervals'        ? 'WU 1.5mi, reps, CD 1mi. Hold pace, even splits.'
        : effectiveType === 'threshold'        ? 'WU 1.5mi, threshold reps, CD 1mi. Comfortably hard.'
        : effectiveType === 'tempo'            ? 'WU, continuous tempo block, CD. Just below threshold.'
        : effectiveType === 'race_week_tuneup' ? 'Two sharp half-mile reps just above T-pace. Keep it brief. Legs stay fresh.'
        :                                         '',
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
  const emptySlots = slots
    .map((s, i) => ({ slot: s, dow: i as DOW }))
    .filter((x) => x.slot == null);

  // 2026-06-10 · frequency cap. When the runner stated a training
  // frequency, fill only enough easy days to hit it; the rest become
  // rest days. Without this the generator filled EVERY non-rest slot,
  // so a 3-day runner got a 6-day plan (the bug David hit 3 clicks into
  // onboarding). NULL frequency → fill all empties (legacy behavior).
  const runningPlaced = slots.filter(Boolean).filter((d) => d!.distanceMi > 0).length; // long + quality
  // 2026-06-20 · when the runner gave available days, easy runs may only land
  // on those days; every other empty day stays rest. Long/quality already sit
  // on available days (upstream derivation). Unset → all empties are candidates.
  const easyCandidates = availableDows
    ? emptySlots.filter((e) => availableDows.has(e.dow))
    : emptySlots;
  const easyCount = trainingDaysPerWeek != null
    ? Math.max(0, Math.min(easyCandidates.length, trainingDaysPerWeek - runningPlaced))
    : easyCandidates.length;
  // Place the easy days for EVEN distribution across the week (audit RP-1/RP-2):
  // maximize the minimum circular gap between run days, tie-break by MINIMIZING the
  // maximum gap (so the runs don't collapse into one contiguous block with a long
  // rest tail), then avoid the day immediately adjacent to the long, then lowest dow
  // for determinism. `anchors` is the HARD days only (long + quality) — the rest day
  // is deliberately NOT counted as a stressor to flee. The prior (2026-06-22) greedy
  // counted rest in `occupied` and used a first-wins tie-break, so for a 3-day BASE
  // week every midweek candidate tied at gap-1 and it dropped the easy on Monday, the
  // day right after the Sunday long — the back-to-back David reported. Only the
  // stated-frequency branch (easyCount < candidates) runs this; null-frequency fills
  // every slot below, byte-unchanged (David's path).
  const easyDowSet = new Set<number>();
  if (easyCount >= easyCandidates.length) {
    easyCandidates.forEach((e) => easyDowSet.add(e.dow));
  } else if (easyCount > 0) {
    const circDist = (a: number, b: number) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
    const anchors = slots.map((s, i) => (s && s.type !== 'rest' ? i : -1)).filter((i) => i >= 0);
    const maxGapOf = (run: number[]): number => {
      const sorted = [...run].sort((a, b) => a - b);
      let mg = 0;
      for (let j = 0; j < sorted.length; j++) {
        const g = ((sorted[(j + 1) % sorted.length] - sorted[j]) + 7) % 7 || 7;
        if (g > mg) mg = g;
      }
      return mg;
    };
    for (let k = 0; k < easyCount; k++) {
      const placed = [...anchors, ...easyDowSet];
      let best = -1, bestMin = -1, bestMax = 99, bestAdj = 9;
      for (const cand of easyCandidates) {
        if (easyDowSet.has(cand.dow)) continue;
        let minGap = 7;
        for (const o of placed) minGap = Math.min(minGap, circDist(cand.dow, o));
        const maxGap = maxGapOf([...placed, cand.dow]);
        const longAdj = circDist(cand.dow, longRunDow) === 1 ? 1 : 0;
        const better =
          minGap > bestMin
          || (minGap === bestMin && (maxGap < bestMax
          || (maxGap === bestMax && (longAdj < bestAdj
          || (longAdj === bestAdj && (best < 0 || cand.dow < best))))));
        if (better) { best = cand.dow; bestMin = minGap; bestMax = maxGap; bestAdj = longAdj; }
      }
      if (best >= 0) easyDowSet.add(best);
    }
  }

  const mathFloor = 3;
  const baselineFloor = easyMileFloor && easyMileFloor > 0 ? easyMileFloor : 0;
  // BASE, TAPER and CUTBACK weeks may legitimately step down · don't over-floor
  // a deliberate deload/taper. CUTBACK = 4th week per volumeCurve. 2026-06-21 ·
  // TAPER added (David signed off): flooring taper easy days at the runner's
  // baseline kept the REALIZED taper volume above the correctly-tapered weekly
  // field, so the final week dropped only ~5% when doctrine wants ~25%. Now the
  // taper actually lets down into the race (Pfitzinger/Daniels marathon taper).
  const isDeloadOrBase = phase === 'BASE' || phase === 'TAPER';
  const effectiveFloor = isDeloadOrBase
    ? mathFloor
    : Math.max(mathFloor, baselineFloor);
  const perEasyRaw = easyCount > 0 ? Math.round(remainingMi / easyCount) : 0;
  // Invariant: an easy run is NEVER longer than the long run — the long run is
  // the longest run of the week by definition. Without this, a cold-start or
  // mismatched-tier plan whose long is pinned at the tier's small peakLong cap
  // dumps the week's remaining volume onto the single easy day, producing the
  // inverted "9mi EASY vs 3mi LONG" plan (Lilley, 2026-06-20). Clamping easy ≤
  // long lowers the weekly total instead — the correct, gentler outcome for a
  // runner whose long-run capacity is small. For established runners the long
  // dwarfs any easy day, so this clamp never binds (no behaviour change).
  // RP-5 · strict separation: an easy day must be SHORTER than the long, never equal,
  // so the long is visibly the week's longest run (David's "every run is the same
  // distance" complaint — a small-tier 5K long pinned easy == long == 8mi). Cap easy
  // at ~0.8×long (and ≥1 below it); separation overrides the floor when they conflict
  // at large equal distances. For established runners the long dwarfs easy so this never binds.
  //
  // B5-EASY-SEP-1 (2026-06-23) · RP-5's 0.8×long-1 separation collapses beginner volume when
  // the long run is tiny (≤ effectiveFloor=3mi). A 2mi long → easySep=1 → perEasy=1mi →
  // 3-day beginner realizes 4mi of a 10mi target (60% shortfall). The validator's long-primacy
  // rule allows easy ≤ long + 0.15mi, so allowing easy = long for SMALL longs is valid and
  // avoids the collapse. David's complaint was about 8mi equal distances, not 3mi beginners.
  const easySep = longMi > 0
    ? (longMi <= effectiveFloor
        ? longMi  // tiny long (beginner early weeks): easy may equal the long — within validator's 0.15mi tolerance
        : Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))))
    : perEasyRaw;
  // VDEAD-RAMP-1 (2026-06-23) · budget ceiling on the easy-day floor, but ONLY for
  // non-deload non-base weeks where floor inflation can hit the §3 validator ceiling.
  // Two disjoint exemptions:
  //
  // Exemption A (easySep < effectiveFloor): small long run (e.g. 2.5mi → easySep=1.5) means
  //   the final `min(max(floor, raw), easySep)` already caps perEasy at 1.5mi — far below the
  //   3mi floor. No budget cap needed; reducing the floor further exposes a 73% WoW jump.
  //
  // Exemption B (isDeloadOrBase): BASE and cutback weeks INTENTIONALLY keep the floor to
  //   smooth WoW transitions. A 9mi-budget BASE cutback with long=6 + 3 easy × floor=3mi
  //   realizes 15mi. The QUALITY phase starts at 14mi — a -7% drop, not a +56% spike.
  const perEasyBudgetCap = easyCount > 0 ? Math.max(1, Math.floor(remainingMi / easyCount)) : 0;
  const flooredPerEasy = (easySep < effectiveFloor || isDeloadOrBase)
    ? effectiveFloor                              // exempt: easySep or deload/base handles the bound
    : Math.min(effectiveFloor, perEasyBudgetCap); // cap: prevent peak-week ceiling violation
  const perEasy = Math.min(Math.max(flooredPerEasy, perEasyRaw), easySep);
  for (const { dow } of emptySlots) {
    slots[dow] = easyDowSet.has(dow)
      ? { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational. Z2 HR cap.' }
      : { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  }

  // 2026-06-21 · INV13 guard · never author a labeled running day with a non-
  // positive distance. A degenerate budget (tiny taper week, 0-base cold start)
  // can round a quality/tune-up/easy slot to 0mi — a "QUALITY 0mi" row is worse
  // than no row. Demote any non-positive running day to rest. 'race' is exempt
  // (always carries the race distance); 'rest' is already 0.
  for (let d = 0; d < 7; d++) {
    const s = slots[d];
    if (s && s.type !== 'rest' && s.type !== 'race' && s.distanceMi <= 0) {
      slots[d] = { dow: d as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
    }
  }

  return slots as DayPlan[];
}

/** "Get them running on day one." If the week's anchor-day slot is a rest
 *  day, relocate an easy run onto it — stolen from the easy day furthest
 *  out — so a fresh onboarder isn't met with several rest days before
 *  their first run. The long + quality days and the weekly run count stay
 *  put; only an easy day moves. No-op when the anchor already runs or
 *  there's no easy day to relocate (a low-frequency week that's all
 *  long + quality). */
function frontLoadFirstRun(days: DayPlan[], anchorDow: number): void {
  const todaySlot = days.find((d) => d.dow === anchorDow);
  if (!todaySlot || todaySlot.type !== 'rest') return; // already runs today
  const easies = days.filter((d) => d.type === 'easy' && d.distanceMi > 0);
  if (easies.length === 0) return; // only long/quality this week — leave them
  const offset = (dow: number) => (dow - anchorDow + 7) % 7;
  const donor = easies.reduce((a, b) => (offset(b.dow) > offset(a.dow) ? b : a));
  todaySlot.type = 'easy';
  todaySlot.distanceMi = donor.distanceMi;
  todaySlot.isQuality = false;
  todaySlot.isLong = false;
  todaySlot.subLabel = 'EASY';
  todaySlot.notes = 'First run. Ease in at a conversational pace · the week settles into its rhythm from here.';
  donor.type = 'rest';
  donor.distanceMi = 0;
  donor.isQuality = false;
  donor.isLong = false;
  donor.subLabel = 'REST';
  donor.notes = 'Off. Sleep, hydrate, mobilize.';
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
  /** 2026-06-20 · days the runner can run (from available_days). When set,
   *  layoutWeek places easy days only on these and rests the rest. */
  availableDows?: Set<number> | null;
  /** 2026-06-10 · runner's stated training frequency (profile.
   *  weekly_frequency, captured at onboarding). When set, caps total
   *  running days per week so a 3-day runner never gets a 6-day plan.
   *  NULL preserves the historical "fill every non-rest slot" behavior
   *  (David + pre-frequency profiles unaffected). */
  trainingDaysPerWeek: number | null;
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
  /** RC2-4 · planned cutback (deload) week. The validator exempts the
   *  FOLLOWING week from the WoW jump check — returning from a planned
   *  deload to normal training is an EXPECTED jump, not a ramp error.
   *  Cite: Pfitzinger Advanced Marathoning §"Cutback Weeks". */
  isCutback?: boolean;
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
    input.level, // VAR-01 · experience clamps the pace-derived tier
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
      const { target: ht } = lookupTierTarget(h.goalPaceSec, h.distanceMi, input.level); // VAR-01
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
  // DIST-1 · plan-wide peak weekly volume · scales the marathon/ultra long to its doctrine band.
  const peakWeeklyMi = Math.max(1, ...vols);
  // #13 · the cadence volumeCurve used to deload, threaded into layoutWeek so
  // its long-run-floor relaxation lands on the same weeks. Same helper, same
  // input → guaranteed agreement.
  const cutbackEveryN = cutbackCadence(input.tsbAtStart);

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
  // BANDS-ULTRA-Q1 is a KNOWN-OPEN defect (ultra ships 2 quality/wk; Research/22 wants 1) — but the naive
  // clamp here re-introduces the easy-slot inflation this density=prefs design fixed (2026-06-03): the
  // displaced quality slot becomes a FLOORED easy → 5 easies → week 117 > band 110. The correct fix routes
  // the displaced ultra slot to a MEDIUM-LONG (back-to-back-long doctrine), a layout change tracked for a
  // focused follow-up, NOT a one-line density clamp. Keep prefs (tier informs ramp CEILING, not floor).
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

  // Cold-start VDOT floor · conservativeVdotFromMileage lifted to spec-builder.ts
  // 2026-06-10 (shared with the maintenance seeder). Moved ABOVE goalT for VAR-05.
  // Cite: Daniels Running Formula §"VDOT and Training" — mileage-band heuristic.
  const estimatedCurrentVdot = input.bestRecentVdot
    ?? conservativeVdotFromMileage(input.recentWeeklyMi);
  const currentT = tPaceFromVdot(estimatedCurrentVdot);

  // 2026-06-03 · mid-block doctrine RULE 3 (pace anchor blend) · when bestRecentVdot
  // implies a T-pace slower than goal-T, anchor early-week paces to currentT and blend
  // toward goalT by mid-build (Cite: §Rule 3). 2026-06-23 · VAR-05 · a by-feel runner (no
  // goal) now paces off their ACTUAL fitness (currentT), never the flat 480s/mi (8:00/mi)
  // literal — tPaceFromGoal returns null with no goal, and currentT always resolves
  // (conservativeVdotFromMileage ≥30) so the 480 fallback goes dead. PACE-5 · ultra
  // (≥31mi) also makes tPaceFromGoal return null → ultra T anchors to currentT here, not the
  // bogus goalPace−18. Cite: Research/01 §Daniels-T (T-pace is a function of VDOT).
  // GOAL-2 (2026-06-23) · clamp goal-T to an ACHIEVABLE floor so the per-week blend never prescribes
  // paces faster than current fitness + a safe seasonal VDOT gain (Research/01:314-321 · retest deltas
  // ~+2-3; scale with build length, cap ~+6). An in-table but over-ambitious goal (e.g. +8 VDOT in one
  // block) otherwise drives every quality day to an unreachable pace. The aspirational goal stays on
  // the UI; only the prescribed paces are floored. Derived from CURRENT fitness (never goalVdot, which
  // is null off-table). Byte-safe for an at/near-goal runner (achievableFloorT faster ⇒ max keeps goalT).
  const goalTraw = tPaceFromGoal(input.goalSec, input.raceDistanceMi) ?? currentT ?? input.tPaceSec;
  const maxSeasonalVdotGain = Math.min(6, 2 + totalWeeks * 0.22);
  const achievableFloorT = tPaceFromVdot(estimatedCurrentVdot + maxSeasonalVdotGain);
  const goalT = (achievableFloorT != null && goalTraw != null) ? Math.max(goalTraw, achievableFloorT) : goalTraw;

  // Goal-realism guard: flag when the entered goal implies a VDOT >15% above
  // the conservative current estimate. Written to authoredState for the plan
  // UI to surface; does not block generation.
  const goalVdot = input.goalSec != null
    ? vdotFromRace(input.goalSec, input.raceDistanceMi)
    : null;
  // GOAL-3 (2026-06-23) · DIRECTION-AWARE realism flag. goalVdot is null OFF-TABLE (VDOT>85) — i.e. the
  // MOST ambitious goals — so the old `goalVdot != null && >est×1.15` treated those (off-the-top) as
  // NOT flagged (the flag inverted for the most absurd goals). When goalVdot is null, compare the goal
  // TIME to the current-fitness predicted time: faster ⇒ off-the-top ⇒ flag; slower ⇒ off-the-bottom ⇒
  // don't. (GOAL-2 already floors the prescribed paces; this makes the surfaced flag correct too.)
  const currentPredicted = input.goalSec != null ? predictRaceTime(estimatedCurrentVdot, input.raceDistanceMi) : null;
  const realismFlag = goalVdot != null
    ? goalVdot > estimatedCurrentVdot * 1.15
    : (input.goalSec != null && currentPredicted != null && input.goalSec < currentPredicted);
  const goalRealism: { flag: boolean; goalVdot?: number; estimatedCurrentVdot?: number } =
    realismFlag
      ? { flag: true, ...(goalVdot != null ? { goalVdot } : {}), estimatedCurrentVdot }
      : { flag: false };

  function tPaceForWeek(weekIdx: number, phase: string): number | null {
    if (goalT == null) return null;
    if (currentT == null) return goalT;
    // BRK-1 (2026-06-23) · a SOFT goal (currentT <= goalT · runner already fitter than the goal) trains
    // QUALITY at CURRENT fitness — NOT the slower goalT — otherwise easy (PACE-E-1-anchored to currentT)
    // ends up FASTER than the VO2max/MP work (a Daniels-order violation). The soft goal time stays the
    // RACE-DAY target (the race row reads goalPaceSPerMi, not this blend). David is sub-fitness → unaffected.
    if (currentT <= goalT) return currentT;
    if (phase === 'TAPER') return goalT; // VAR-07 · keep TAPER; BASE carries no T-session so its blend is free to track currentT
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
      // 2026-06-07 · Audit D follow-up · 0 = last week of this phase.
      // phaseWkRemaining is decremented after this call, so it currently
      // holds weeks-left-including-this-one → minus 1 = weeks-to-phase-end.
      weeksToPhaseEnd: phaseWkRemaining - 1,
      totalWeeks,
      weeklyMi: vols[wi],
      peakWeeklyMi,
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
      trainingDaysPerWeek: input.trainingDaysPerWeek,
      cutbackEveryN,  // #13 · same cadence as volumeCurve's deload mask
      // 2026-06-20 · beginner = base-building structure (light fartlek, no
      // structured I/R reps). Gated to level==='beginner', so intermediate/
      // advanced (incl. David) are unchanged.
      baseBuilding: isBaseBuildingPlan(distanceCategoryOf(input.raceDistanceMi), input.level),
      availableDows: input.availableDows ?? null,
    });
    // 2026-06-23 · SP-4 · race-week chronology guard. layoutWeek positions
    // shakeout/tune-up/easy by a circular days-before-race offset that WRAPS, so for a
    // race that is NOT the last day of its week the tune-up/easy aliased onto days
    // AFTER the race (a tune-up 2 days post-race · was live on every mid-week race).
    // Force every day whose calendar date is after the race to rest, keyed on the real
    // week window (weekStart + dow offset) so it is correct whether or not the runway
    // is boundary-aligned. Byte-identical when the race is the window's last day
    // (David's Sunday race · nothing falls after it).
    if (isRaceWeek) {
      const weekStartDow = new Date(weekStart + 'T12:00:00Z').getUTCDay();
      for (const d of days) {
        const dayDate = addDays(weekStart, (d.dow - weekStartDow + 7) % 7);
        if (d.type !== 'race' && daysBetween(input.raceDateISO, dayDate) > 0) {
          d.type = 'rest'; d.distanceMi = 0; d.isQuality = false; d.isLong = false;
          d.subLabel = 'REST'; d.notes = 'Off. Post-race recovery.';
        }
      }
    }
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
    weeks.push({ startISO: weekStart, phase: phaseLabel, weeklyMi: vols[wi], days, isRaceWeek, tPaceSec: weekT, isCutback: wi > 0 && (wi + 1) % cutbackEveryN === 0 });
    phaseWkRemaining--;
  }

  // 2026-06-10 · "get them running on day one." A mid-week onboarder
  // (today-anchored · start day is not a Monday) whose preferred run days
  // fall later in the week would otherwise stare at several rest days
  // before their first run (David: "if someone signs up lets get them
  // running and then the schedule can even out · they're going to be
  // ready and excited to run"). When week 0's start day is a rest day,
  // relocate an easy run onto it — stolen from the latest easy day so the
  // weekly count (and the long/quality days) are untouched. Week 1+ keeps
  // the normal day-of-week rhythm. Monday-anchored regens skip this.
  if (weeks.length > 0 && new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay() !== 1) {
    frontLoadFirstRun(weeks[0].days, new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay());
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
      goal_realism: goalRealism,
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
  /** 2026-06-21 · days the runner can run (from available_days). When set,
   *  the maintenance/recovery easy-fill places easy runs ONLY on these days
   *  and rests every other empty slot — parity with composePlan's layoutWeek.
   *  long/quality/rest already land on available days upstream (loadGenerator-
   *  Inputs derives longRunDow/restDow/qualityDows from the same set), so only
   *  the easy-fill needs this filter. NULL → fill every empty slot (David /
   *  pre-available-days profiles unchanged). */
  availableDows?: Set<number> | null;
  /** 2026-06-10 · runner's stated training frequency. When set, overrides
   *  the tier's daysPerWeek so a far-out-race runner's maintenance block
   *  honors the days/week they actually picked. NULL → tier default. */
  trainingDaysPerWeek: number | null;
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
  const tierShape = MAINTENANCE_BY_TIER[input.tier];
  // 2026-06-10 · honor the runner's stated frequency over the tier
  // default so a far-out-race runner who picked 3 days/wk doesn't get
  // the tier's 5-6. NULL → tier default (David / pre-frequency profiles).
  const shape = input.trainingDaysPerWeek != null
    ? { ...tierShape, daysPerWeek: input.trainingDaysPerWeek }
    : tierShape;
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);
  const targetWeekly = Math.round(peakAnchor * shape.weeklyPctOfPeak);
  // SP-6 · maintenance long is PROPORTIONAL to recent fitness, not an absolute 8mi floor.
  // The old `max(8, ...)` gave a 15mpw / 5mi-recent runner an 8mi long = 160% of recent +
  // 35% of the week (over both the 110% injury cap and the ~30% proportion cap). Cap at
  // ≤110% of recent long (Research/00a:752) AND ≤30% of the week (Research/00a:184), with a
  // 4mi coherence floor (a 2mi "long" is incoherent · D2 default). The tier's longPctOfPeak
  // intent still shapes the week via targetWeekly.
  // NS-2 (2026-06-23) · the 4mi coherence floor forced a ~2× jump on a true-beginner maintenance runner
  // (recent long 2-3mi). Cap the floor at their recent long so a maintenance long never exceeds ~110% of
  // what they've actually run; 4mi still applies once they're at/above 4 (or have no recent-long signal).
  const longFloor = (input.recentLongMi > 0 && input.recentLongMi < 4) ? Math.max(2, Math.round(input.recentLongMi)) : 4;
  const targetLong = Math.max(
    longFloor,
    Math.min(Math.round(input.recentLongMi * 1.10), Math.round(targetWeekly * 0.30)),
  );

  // MAINT-HORIZON (2026-06-23) · when a race is scheduled, maintenance runs exactly until the
  // build-window opens, not a fixed 4 weeks. A 20-week-out 5K runner needs 10 weeks of
  // maintenance before the 10-week race-prep window starts — not 4 weeks of maintenance that
  // restarts three more times with no visible horizon. Rolling cutback fires every 4th week.
  // When no race is scheduled (just-run mode), fall back to the 4-week rolling default.
  let TOTAL_WEEKS = 4;
  if (input.nextRace) {
    const weeksToRace = daysBetween(input.startMondayISO, input.nextRace.date) / 7;
    const buildCat = distanceCategoryOfTier(input.nextRace.distanceMi);
    const buildWindow = BUILD_WINDOW_WEEKS[buildCat];
    if (weeksToRace > buildWindow) {
      // MAINT-SKIP-1 (2026-06-24) · floor not round — rounding up would let maintenance
      // eat into the build window. pickPlanMode already routes floor=0 to race-prep,
      // so this is guaranteed ≥ 1 when composeMaintenancePlan is called.
      TOTAL_WEEKS = Math.max(1, Math.floor(weeksToRace - buildWindow));
    }
  }
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

  // Layout one canonical week per slot. Rolling cutback fires every 4th week (weekIdx 3, 7, 11 …).
  function maintenanceWeek(weekIdx: number): DayPlan[] {
    const isCutback = (weekIdx + 1) % 4 === 0; // week 4, 8, 12 … = recovery step-down
    const wkWeeklyBase = isCutback ? Math.round(targetWeekly * 0.80) : targetWeekly;
    // SP-6 · 4mi coherence floor, not 8. NS-2 (2026-06-23, ext) · the cutback floor must ALSO respect the
    // true-beginner cap (recentLong 3 → cutback Math.max(4,2)=4 → smoothed 3.5 = 117% = the plan's LONGEST
    // run, over the 110% injury cap). Cutback is never longer than the base long (targetLong, already ≤110%
    // recent); the 4mi coherence floor only engages once recentLong ≥ 4. Byte-safe for recentLong ≥ 4.
    const cutFloor = (input.recentLongMi > 0 && input.recentLongMi < 4) ? Math.max(2, Math.round(input.recentLongMi)) : 4;
    let wkLong = isCutback ? Math.min(targetLong, Math.max(cutFloor, Math.round(targetLong * 0.80))) : targetLong;

    // MAINT-FREQ-FLOOR (2026-06-24) · a stated-frequency runner must get `freq` REAL runs, not a
    // long + (freq-1) sub-2mi junk easies. The 4mi coherence longFloor can eat ~67% of a tiny
    // maintenance week (e.g. long=4 of a 6mi/3-day week → two 1mi junk easies — David's complaint).
    // Lift the weekly budget so every running day seats at ≥2mi: wkWeekly ≥ wkLong + 2×(freq-1).
    // CAP at the runner's real ceiling (peakAnchor) so a genuinely volume-constrained week
    // (10mpw/6-day = 1.7mi/run) is accepted as-is, not inflated above what they actually run.
    // Gated on stated frequency → null-freq profiles (David) are byte-stable. VOL-1 reconciles
    // the displayed weeklyMi to the realized day-sum.
    let wkWeekly = wkWeeklyBase;
    if (input.trainingDaysPerWeek != null && input.trainingDaysPerWeek >= 2) {
      const everyRunFloor = wkLong + 2 * (input.trainingDaysPerWeek - 1);
      wkWeekly = Math.max(wkWeekly, Math.min(everyRunFloor, peakAnchor));
    }

    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    // Rest day
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
    // Long run · simpler than race-prep (no race-pace inserts)
    slots[input.longRunDow] = {
      dow: input.longRunDow, type: 'long', distanceMi: wkLong, isQuality: false, isLong: true,
      subLabel: 'LONG',
      notes: 'Conversational. Maintenance long · holding aerobic base.',
    };
    // Quality day (skip when tier shape has qualityPerWeek=0).
    // 2026-06-21 · #5 · a 0-1 day/week runner can't fit a quality session on
    // top of the long. When the stated frequency caps running below 2 days,
    // drop quality entirely (the long IS the week's single hard effort). NULL
    // frequency / freq>=2 keep the tier's quality. Uses the already-overridden
    // shape.daysPerWeek so this reads the runner's stated number, not the tier.
    const qualityAllowed = shape.qualityPerWeek > 0 && shape.daysPerWeek >= 2;
    // MAINT-QUAL-COMPRESS (2026-06-24) · when the runner stated a frequency ≥3, reserve budget
    // for at least (freq-2) easy days at 1mi each before placing quality. Without this, a low-base
    // runner (e.g. 10mpw/3-day) gets long(4)+quality(3)=7mi=budget, leaving zero room for the
    // easy fill → only 2 running days instead of the stated 3. Cap quality distance at whatever
    // remains after reserving the easy room; if that cap < 2mi, skip quality for this week.
    // Reserve 2mi (a REAL run), not 1mi (junk), per easy day so quality can't overspend into the
    // easy budget and starve an easy to 1mi (long=4 + fartlek=3 + easy=1 — David's case again).
    const qualFreqRoom = input.trainingDaysPerWeek != null && input.trainingDaysPerWeek > 2
      ? (input.trainingDaysPerWeek - 2) * 2
      : 0;
    const qualBudgetCap = wkWeekly - wkLong - qualFreqRoom;
    // MAINT-QUAL-COMPRESS-THRESH (2026-06-24) · raised from 2 to 3. A 2mi fartlek cap leaves
    // only 1mi for the easy fill — a sub-minimal run that just creates a third consecutive day
    // (Sun long / Mon easy / Tue fartlek). At budget cap < 3, skip quality and give the runner
    // two solid easy days instead (spread by MAINT-SPREAD-1 below).
    if (qualityAllowed && input.qualityDows.length > 0 && qualBudgetCap >= 3) {
      // MAINT-QUAL-ADJACENT (2026-06-23) · route through scheduleQuality so the selected DOW is
      // guaranteed to be at least 1 day away from the long run (§5). The previous direct use of
      // qualityDows[0] had no gap check: sat-quality + sun-long = 0 recovery days between them.
      const qType: DayPlan['type'] = shape.qualityType === 'threshold' ? 'threshold' : 'easy';
      const { dows: scheduledQ } = scheduleQuality(input.qualityDows, [qType], input.longRunDow, input.restDow, input.availableDows ?? null);
      const qDow = scheduledQ.length > 0 ? scheduledQ[0] : input.qualityDows[0];
      if (slots[qDow] == null) {
        // MAINT-QLONG-1 (2026-06-23) · cap at wkLong to preserve long-primacy (§7).
        // qualBudgetCap further limits quality distance when freq headroom is tight.
        const qDist = Math.min(Math.max(3, Math.round(wkWeekly * 0.16)), wkLong, qualBudgetCap);
        if (shape.qualityType === 'threshold') {
          slots[qDow] = {
            dow: qDow, type: 'threshold', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${Math.max(3, Math.round(qDist * 0.5))}mi @ T pace · cruise`,
            notes: 'WU 1.5mi · steady at threshold · CD 1mi. Aerobic engine maintenance.',
          };
        } else if (shape.qualityType === 'fartlek') {
          // MAINT-FARTLEK-SPEC (2026-06-23) · fartlek is AEROBIC with surges, not sustained
          // threshold. The prior type:'tempo' caused buildWorkoutSpec to prescribe tPaceSec
          // and 92% LTHR — full threshold effort — while notes said "Easy with 1-minute pickups."
          // Fix: type:'easy' so the spec targets the aerobic zone; surges communicated via subLabel.
          slots[qDow] = {
            dow: qDow, type: 'easy', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${qDist}mi w/ 6×1min surges`,
            notes: 'Easy with 1-minute pickups every 5 min. Leg turnover · not race-pace.',
          };
        }
      }
    }
    // Fill easies up to daysPerWeek
    // MAINT-EASY-1 (2026-06-23) · the easyFloor=max(3, median||5) inflated easy days for cold-start
    // runners (easyDayMedianMi=0 → floor=5) to well beyond the weekly budget, making a 15mpw
    // maintenance plan realize 19mpw. Use a 2mi sanity floor only (no baseline inflation). VOL-1
    // reconciles weeklyMi to the realized sum, so the UI would have shown the inflated number.
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const emptySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    // 2026-06-21 · #4 · when the runner gave available days, easy runs may only
    // land on those days; every other empty day stays rest. long/quality/rest
    // already sit on available days (loadGeneratorInputs derives them from the
    // same set). NULL → every empty slot is a candidate (legacy behavior). This
    // mirrors composePlan's layoutWeek easy-candidate filter exactly.
    const easySlots = input.availableDows
      ? emptySlots.filter((e) => input.availableDows!.has(e.dow))
      : emptySlots;
    const runningPlaced = slots.filter(Boolean).filter((d) => d?.distanceMi! > 0).length;
    // MAINT-EASY-2 (2026-06-23) · cap easy slots to what the budget can sustain at a minimum
    // 2mi each. Without this, a 3mi easy budget spread over 4 slots floored each to 2mi and
    // realized 8mi instead of 3mi. The fix: max floor(budget/2) easy days — the remainder stay
    // rest. MAINT-EASY-1-REGRESS extended this to the zero-budget case (floor(0/2)=0 easy days).
    // MAINT-MIN-EASY (2026-06-24) · when MAINT-FREQ-FLOOR could seat every running day at ≥2mi
    // (budget ≥ wkLong + 2×(freq-1)), floor easies at 2mi — no 1mi junk. Only when the runner is
    // genuinely volume-constrained (peakAnchor can't afford freq real runs alongside the coherence
    // long, e.g. 10mpw/6-day) do we drop to a 1mi floor, honoring the stated frequency with short
    // runs rather than dropping a day. null-freq (David) keeps the 2mi floor → byte-stable.
    const budgetSeatsAll2 = input.trainingDaysPerWeek != null
      && wkWeekly >= wkLong + 2 * (input.trainingDaysPerWeek - 1);
    const MAINT_MIN_EASY = input.trainingDaysPerWeek == null ? 2 : (budgetSeatsAll2 ? 2 : 1);
    const maxEasyByBudget = Math.floor(easyMiBudget / MAINT_MIN_EASY);
    const targetEasyCount = Math.min(easySlots.length, Math.max(0, shape.daysPerWeek - runningPlaced), maxEasyByBudget);
    const perEasyRaw = targetEasyCount > 0 ? Math.max(MAINT_MIN_EASY, Math.round(easyMiBudget / targetEasyCount)) : 0;
    // 2026-06-21 · N2 · easy never exceeds the long run. A sparse availableDows
    // (few easy slots) + a high peak can spike per-easy above the long (same
    // class as recovery N2); clamp to wkLong, mirroring layoutWeek's easyCeiling.
    // The week runs lighter instead — the correct gentler outcome. null-avail /
    // ample-slot weeks sit well under the long, so this is a no-op for them.
    const perEasy = wkLong > 0 ? Math.min(perEasyRaw, wkLong) : perEasyRaw;
    // MAINT-SPREAD-1 (2026-06-24) · spread easy fills across the week instead of always
    // taking the first N slots in DOW order. The default order places easy on Monday when
    // long=Sun and quality=Tue → Sun/Mon/Tue = 3 consecutive days every week. Fix: prefer
    // slots NOT adjacent to any hard session (long or quality), then pick evenly spaced
    // indices across the candidate list. Fall back to all slots when the filtered set is
    // too small to satisfy targetEasyCount.
    const hardDows = new Set<number>(
      slots.map((s, i) => (s != null && (s as DayPlan).distanceMi > 0 ? i : -1)).filter((i) => i >= 0)
    );
    const adjToHard = new Set<number>();
    for (const hd of hardDows) { adjToHard.add((hd + 1) % 7); adjToHard.add((hd + 6) % 7); }
    const preferredEasySlots = easySlots.filter((e) => !adjToHard.has(e.dow));
    const candidateSlots = preferredEasySlots.length >= targetEasyCount ? preferredEasySlots : easySlots;
    const pickedDows = new Set<number>();
    for (let i = 0; i < targetEasyCount; i++) {
      const idx = targetEasyCount <= 1
        ? Math.floor(candidateSlots.length / 2)
        : Math.round(i * (candidateSlots.length - 1) / (targetEasyCount - 1));
      if (idx < candidateSlots.length) pickedDows.add(candidateSlots[idx].dow);
    }
    for (const { dow } of easySlots) {
      if (pickedDows.has(dow)) {
        slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational throughout.' };
      } else {
        slots[dow] = { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
      }
    }
    // 2026-06-21 · #5 · frequency cap. The long (and a freq>=2 quality) are
    // authored unconditionally above, so a 1-day runner could still end up with
    // long+quality = 2 running days when they asked for 1 — the easy-fill can
    // only ADD days, never trim the long/quality. Mirror the race-prep trim:
    // demote running days in priority order (easy → quality, long always stays)
    // until the running-day count meets the stated frequency. NULL → untouched.
    if (input.trainingDaysPerWeek != null) {
      let running = slots.filter((d) => d != null && d.distanceMi > 0).length;
      const isQ = (d: DayPlan) => d.isQuality;
      const isE = (d: DayPlan) => d.type === 'easy';
      for (const matches of [isE, isQ] as const) {
        if (running <= input.trainingDaysPerWeek) break;
        for (let dow = 0; dow < 7; dow++) {
          if (running <= input.trainingDaysPerWeek) break;
          const d = slots[dow];
          if (d != null && d.distanceMi > 0 && !d.isLong && matches(d)) {
            slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
            running--;
          }
        }
      }
    }
    // 2026-06-21 · #4b · any slot still empty is a NON-available day: when the
    // runner gave available_days, the easy-fill above only touches available
    // empties, so the rest stay null. layoutWeek rests every empty slot and
    // returns a full 7-day week — mirror that here so the persisted week has 7
    // contiguous days. Without this the null slots drop out at filter(Boolean)
    // below → a <7-day week → INV2 gaps in the strip (the live non-race harness
    // caught M·avail at days=4). No-op for null-available runners: the easy-fill
    // already covered every empty slot, so nothing is left to rest (David byte-
    // for-byte unchanged).
    for (let dow = 0; dow < 7; dow++) {
      if (slots[dow] == null) {
        slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
      }
    }
    return slots.filter(Boolean) as DayPlan[];
  }

  for (let wi = 0; wi < TOTAL_WEEKS; wi++) {
    const startISO = addDays(input.startMondayISO, wi * 7);
    // #14 (audit 2026-06-16) · the `weeks[wi]?.weeklyMi ??` self-reference was
    // dead: `weeks[wi]` is read before THIS iteration's push, so it was always
    // undefined and the fallback always ran. The fallback IS the real value and
    // matches maintenanceWeek(wi)'s internal `isCutback = weekIdx === 3 →
    // targetWeekly * 0.80`. (Pattern was copied from the race-prep composer
    // where `weeklyMi: vols[wi]` reads a genuinely pre-computed array.) Drop the
    // dead clause so the cutback factor lives in one place per week.
    weeks.push({
      startISO,
      phase: 'MAINTENANCE',
      weeklyMi: wi === 3 ? Math.round(targetWeekly * 0.80) : targetWeekly,
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
  // RECOVERY-2 (2026-06-23) · a mid-recovery REGEN must not restart at week 1. Offset into the reverse
  // taper by whole weeks elapsed since the race finished, and emit only the weeks that remain.
  const recoveryOff = Math.floor(Math.max(0, daysBetween(input.lastRaceFinished.date, input.startMondayISO)) / 7);
  const remainingWeeks = Math.max(1, recoveryWeeks - recoveryOff);
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);

  // Pfitz: week 1 = 25-40% of peak (5K/10K) or 30% (M). Week 2 (M only) = 50-60%.
  // RECOVERY-1 (2026-06-23) · reverse taper per Research/00b:256-263 (wk1 10-20% → wk2 30-40% →
  // wk3 50-60% → wk4 70-80% of normal). Was [0.30,0.55] for marathon — wk1 ~2× too hot AND 2 weeks
  // too short (research returns to quality at week 3-4, not week 2).
  const wkPctSeq = (lastCat === 'm' || lastCat === 'ultra') ? [0.15, 0.35, 0.55, 0.75]
    : lastCat === 'hm' ? [0.20, 0.40]
    : [0.30];
  const weeks: ComposedWeek[] = [];
  const blocks: BlockPlan = {
    totalWeeks: remainingWeeks,
    phases: [{
      label: 'RECOVERY',
      weeks: remainingWeeks,
      rationale: `Post-race recovery · ${input.lastRaceFinished.name}. Easy running only · no quality.`,
      citation: 'Research/00a-distance-running-training.md §recovery + Pfitzinger Advanced Marathoning §Post-race recovery',
    }],
  };

  for (let wi = 0; wi < (remainingWeeks); wi++) {
    const wkPct = wkPctSeq[wi + recoveryOff] ?? wkPctSeq[wkPctSeq.length - 1]; // RECOVERY-2 · elapsed offset
    const wkWeekly = Math.round(peakAnchor * wkPct);
    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Recover.' };
    // 1 extra rest day adjacent · 2 rest in recovery weeks
    const extraRestDow = ((input.restDow + 3) % 7) as DOW;
    slots[extraRestDow] = { dow: extraRestDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Extra rest · still recovering.' };
    // 1 medium easy mid-week (optional · only if Pfitz says >40% of peak).
    // 2026-06-21 · #7 · the medium-easy used to claim slots[longRunDow]
    // unconditionally. When longRunDow coincides with restDow or the
    // extraRestDow=(restDow+3)%7, it silently overwrote a rest day → only 1
    // rest day → a 6-running-day "recovery" week. Pick a medium day that is
    // NOT either rest day (and, when the runner gave available days, IS one of
    // them). Prefer the long-run slot, then mid-week, then any free day.
    // The recovery week's longest run · the optional mid-week medium AND the
    // ceiling for every easy day below (easy never exceeds the longest run,
    // mirroring layoutWeek's easy≤long clamp). 2026-06-21 · N2.
    // REC-MEDIUM-1 (2026-06-23) · the 6mi floor inflated the "medium" day to 6mi for very
    // low-volume runners (5mpw base → wkWeekly=2mi → mediumMi was max(6,0)=6 = 3× the
    // week budget). Use a 2mi sanity floor (matching RECOVERY_MIN_EASY) and cap at wkWeekly.
    const mediumMi = Math.min(wkWeekly, Math.max(2, Math.round(wkWeekly * 0.20)));
    const isFinalRecoveryWeek = (wi + recoveryOff) === recoveryWeeks - 1;
    const isFree = (d: number) =>
      d !== input.restDow && d !== extraRestDow && slots[d] == null &&
      (input.availableDows ? input.availableDows.has(d) : true);
    // candidate order: long-run day, then mid-week-out (Wed-first), then any
    const longBackDow = [input.longRunDow, 3, 4, 2, 5, 1, 6, 0].find(isFree);
    if (wkPct >= 0.50) {
      if (longBackDow != null) {
        // BRK-3 (2026-06-23) · reintroduce a LONG run on the FINAL recovery week so the runner carries one
        // into maintenance/race-prep (RECOVERY-1's 4-week reverse taper otherwise ended long-less for
        // marathon/ultra). Earlier weeks keep the day as a building-back medium.
        slots[longBackDow] = isFinalRecoveryWeek
          ? { dow: longBackDow as DOW, type: 'long', distanceMi: mediumMi, isQuality: false, isLong: true, subLabel: 'LONG (EASY)', notes: 'Long run back · easy effort.' }
          : { dow: longBackDow as DOW, type: 'easy', distanceMi: mediumMi, isQuality: false, isLong: false, subLabel: 'EASY (MEDIUM)', notes: 'Building back · easy effort.' };
      }
    } else if (isFinalRecoveryWeek && longBackDow != null) {
      // MT-REC-1 (2026-06-23) · HM (wkPct [0.20,0.40]) and 10K (wkPct [0.30]) recovery NEVER reach wkPct≥0.50,
      // so BRK-3 above never fired → a long was never reintroduced (realized long = 0mi all block). Place a
      // GENTLE long on the final recovery week, sized to recent long capped to ~40% of the week's volume.
      // Research/00b:200-201 (long reintroduced day 7-10, ~45-60min easy). Marathon/ultra unaffected (≥0.50).
      const reLongMi = Math.max(3, Math.min(input.recentLongMi || 6, Math.round(wkWeekly * 0.40)));
      slots[longBackDow] = { dow: longBackDow as DOW, type: 'long', distanceMi: reLongMi, isQuality: false, isLong: true, subLabel: 'LONG (EASY)', notes: 'Long run back · easy effort.' };
    }
    // Fill rest with easies.
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const emptySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    // 2026-06-21 · #4 · respect available days — easy runs land only on days
    // the runner can run; every other empty day stays rest. NULL → every empty
    // slot is a candidate (legacy). Parity with composePlan's layoutWeek.
    const easySlots = input.availableDows
      ? emptySlots.filter((e) => input.availableDows!.has(e.dow))
      : emptySlots;
    // 2026-06-21 · #6 · honor stated frequency. The week is 2 rest + every other
    // slot easy = ~5 running days regardless of what the runner picked. When a
    // frequency is set, keep only enough easy days to hit it (running days
    // already placed = long/medium count toward the budget); the rest become
    // rest. NULL → fill every easy candidate (legacy 5-day recovery week).
    const runningPlaced = slots.filter(Boolean).filter((d) => d?.distanceMi! > 0).length;
    // RECWK1-1 (2026-06-23) · early recovery (low wkPct) must be REST-dominated — Research/00b:260 (marathon
    // week 1 ≈ days 0-3 rest, days 4-7 easy jogs every other day = ~2 short jogs). The null-freq branch filled
    // EVERY empty slot (5 running days even the race-finish week). Cap TOTAL running days by wkPct (ceil so
    // the lightest week still gets ~2 short jogs) so the reverse taper actually rebuilds frequency: wk1 ~2 →
    // wk4 ~6. Stated-frequency runners unchanged.
    const recoveryRunCap = Math.ceil(wkPct * 7);
    // RECWK1-FREQ-1 (2026-06-23) · stated frequency is a CEILING for normal training, not a floor that
    // overrides recovery's deliberate frequency rebuild. A stated-freq=5 runner was getting 5 running days
    // in marathon-recovery week 1 (should be ~2). Apply recoveryRunCap to stated-freq runners too:
    // min(trainingDaysPerWeek, recoveryRunCap) so the rebuild rebuilds: wk1 ~2 → wk4 ~6.
    const targetEasyCount = input.trainingDaysPerWeek != null
      ? Math.max(0, Math.min(easySlots.length, Math.min(input.trainingDaysPerWeek, recoveryRunCap) - runningPlaced))
      : Math.max(0, Math.min(easySlots.length, recoveryRunCap - runningPlaced));
    // 2026-06-21 · #8 · the per-slot easyFloor (>= ~4mi each) decoupled the day-
    // sum from wkWeekly: with N easy slots all pinned to the floor, the realized
    // week ran ~2× the intended recovery volume — the opposite of a cutback. A
    // recovery week is deliberately light, so size easy days off the budget
    // (a small 2mi sanity floor only, no baseline floor) and ensure the realized
    // day-sum tracks wkWeekly. Floor never inflates the week above its target.
    const RECOVERY_MIN_EASY = 2;
    const perEasyRaw = targetEasyCount > 0 ? Math.round(easyMiBudget / targetEasyCount) : 0;
    // REC-EASY-CAP-1 (2026-06-23) · the mediumMi ceiling (originally added to prevent "recovery
    // easy" spikes when available_days constrains slots) was applied unconditionally. In early
    // recovery weeks (wkPct < 0.50) no medium/long run is placed, so mediumMi is synthetic
    // (= max(2, wkWeekly*0.20)) — 2mi for a week-1 55mpw runner. Capping perEasy at 2mi when
    // there are 2 easy slots and an 8mi budget produces 4mi realized vs 8mi target (50% gap).
    // Fix: only apply the mediumMi ceiling when a medium or long run was actually placed this week
    // (i.e. the slot is not zero). When the week is all-easy, the natural perEasyRaw from the
    // budget computation is the correct ceiling (no ceiling needed — it's the budget itself).
    const mediumRunPlaced = wkPct >= 0.50 || isFinalRecoveryWeek;
    const perEasyCeiling = mediumRunPlaced ? mediumMi : wkWeekly; // without medium: easy up to full budget
    const perEasy = Math.min(Math.max(RECOVERY_MIN_EASY, perEasyRaw), perEasyCeiling);
    for (let i = 0; i < easySlots.length; i++) {
      const { dow } = easySlots[i];
      if (i < targetEasyCount) {
        slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Recovery easy · conversational, no surges.' };
      } else {
        slots[dow] = { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Still recovering.' };
      }
    }
    // 2026-06-21 · #4b · rest any slot the easy-fill left untouched (non-
    // available days when available_days is set). Mirrors layoutWeek's full
    // 7-day week so the persisted recovery week has 7 contiguous days, not a
    // gap-riddled <7 (the same INV2 hole the maintenance composer had). No-op
    // for null-available runners — the easy-fill covered every empty slot.
    for (let dow = 0; dow < 7; dow++) {
      if (slots[dow] == null) {
        slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Still recovering.' };
      }
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

/** 2026-06-09 · M-19 · runs on the rebuild transaction's client so the
 *  archive UPDATE commits (or rolls back) atomically with the new
 *  plan's inserts. A crash between archive and insert used to leave
 *  the runner with NO active plan — today/watch/adaptation crons went
 *  dark. The lookup-cache bust moved to generatePlan, post-commit
 *  (busting pre-commit let a concurrent render re-cache the OLD plan
 *  mid-rebuild and serve it stale for the TTL). */
async function clearActivePlansFor(client: PoolClient, userId: string, reason = 'regenerated'): Promise<void> {
  await client.query(
    `UPDATE training_plans SET archived_iso = NOW(), archive_reason = $2
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId, reason]
  );
}

async function persistPlan(client: PoolClient, args: {
  userId: string; raceSlug: string | null; raceDateISO: string;
  blocks: BlockPlan; weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean; tPaceSec?: number | null }>;
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
   *  LTHR-only. Resolved via loadEffectiveMaxHr at the entry point. */
  maxHr: number | null;
  /** 2026-06-09 state-audit fix · the runner's GOAL pace (s/mi) for
   *  the race-day row. Race day was inheriting T-pace (goal − 5 for an
   *  HM) · a 66s over-commitment at the gun. Null when the race has no
   *  goal time · spec-builder falls back to an inverse-offset
   *  derivation from T. */
  goalPaceSec: number | null;
  /** 2026-06-23 · PACE-E-1 · current-fitness T-pace anchor for EASY/long/recovery bands. Those are
   *  EFFORT runs and must track CURRENT fitness, not the goal-blended weekT — otherwise a sub-fitness
   *  goal makes "easy" ramp faster every week (cold-start: easy can pass current MP). null → falls
   *  back to weekT (byte-identical; at-goal runners have easyAnchorT == weekT). */
  easyAnchorTSec: number | null;
  /** 2026-06-15 · R3 · use true Daniels I-pace (≈ current 5K race pace, from
   *  iPaceFromVdot) for intervals on a 5K/10K race goal — where VO2 at race
   *  pace IS the point — instead of spec-builder's tPaceSec-18 cruise default
   *  (which lands near threshold for a low-VDOT runner). Half/marathon keep the
   *  conservative cruise default. Per-week I-pace ramps with the week's T. */
  goalIPaceEligible: boolean;
  /** 2026-06-03 · Rule 15 · Seal completed days against retroactive
   *  mutation. Snapshotted BEFORE clearActivePlansFor archives the
   *  prior plan; applied during INSERT so the new plan's row for a
   *  completed date inherits the prior prescription.
   *  2026-06-09 · M-19 · passed as a parameter (was module-scoped
   *  state shared between generatePlan and persistPlan). */
  sealedSnapshot: Map<string, SealedPrescription>;
}): Promise<string> {
  const planId = id('pln');
  await client.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'race-prep', $3, $4, $5)`,
    [planId, args.userId, args.raceSlug, args.raceDateISO, args.authoredState]
  );

  // Phases (need ids upfront so weeks can reference)
  // 2026-06-09 · M-19 · one multi-row INSERT (was one statement per
  // phase) · fewer round-trips inside the rebuild transaction.
  const phaseIds: string[] = [];
  {
    const params: unknown[] = [];
    const tuples: string[] = [];
    let cursor = 0;
    for (const ph of args.blocks.phases) {
      const phaseId = id('phs');
      phaseIds.push(phaseId);
      const b = params.length;
      tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(phaseId, planId, ph.label, cursor, cursor + ph.weeks - 1, ph.rationale, ph.citation);
      cursor += ph.weeks;
    }
    if (tuples.length > 0) {
      await client.query(
        `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
         VALUES ${tuples.join(', ')}`,
        params
      );
    }
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

  // 2026-06-09 · M-19 · collect week + workout rows, then flush as
  // multi-row VALUES inserts (weeks in one statement, workouts in
  // chunks of 50). Was one pool.query per row — ~16 + ~80-100 separate
  // statements inside the rebuild, each a round-trip. Day-level logic
  // below is unchanged; only the write is deferred.
  const weekRows: unknown[][] = [];
  const workoutRows: unknown[][] = [];

  // Pre-compute is_peak and is_cutback for plan_weeks (finding 2.4 — generator
  // never set these; all rows landed as false). is_peak = highest-mileage
  // non-race week (first occurrence wins); is_cutback = ≥15% drop from prior.
  const weeklyMiles = args.weeks.map(w => w.days.reduce((s, d) => s + d.distanceMi, 0));
  const maxMi = Math.max(...weeklyMiles.filter((_, i) => !args.weeks[i].isRaceWeek), 0);
  let peakMarked = false;
  const isPeakByWeek = weeklyMiles.map((mi, i) => {
    if (!args.weeks[i].isRaceWeek && mi === maxMi && !peakMarked) {
      peakMarked = true; return true;
    }
    return false;
  });
  const isCutbackByWeek = weeklyMiles.map((mi, i) =>
    i > 0 && !args.weeks[i].isRaceWeek && mi < weeklyMiles[i - 1] * 0.85
  );

  for (let wi = 0; wi < args.weeks.length; wi++) {
    const w = args.weeks[wi];
    const weekId = id('wk');
    // 2026-06-10 · derive each day's date as an offset from the week's
    // actual start weekday (not a hardcoded Monday). For Monday-anchored
    // plans (default · David + lifecycle regens) this is identical to the
    // old `(dow - 1 + 7) % 7`. For onboarding's today-anchored plans the
    // week can start any weekday, and this keeps a Sunday long run on
    // Sunday instead of scattering it.
    const weekStartDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
    const dateForDow = (dow: number) => addDays(w.startISO, ((dow - weekStartDow + 7) % 7));
    weekRows.push(
      [weekId, planId, wi, w.startISO, phaseForWeek(wi), w.isRaceWeek,
       `${w.phase} · week ${wi + 1}`, isPeakByWeek[wi], isCutbackByWeek[wi]]
    );

    for (const d of w.days) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const wkoId = id('wko');
      const dateISO = dateForDow(d.dow);
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
        // R3 · per-week true I-pace for 5K/10K goals: invert the week's blended
        // T back to a VDOT, then take its 5K-race-pace I. Ramps with the block;
        // null (→ cruise default) for half/marathon and when weekT is unusable.
        // TAPER-SHARP-1 (2026-06-23) · the marathon/ultra race-week sharpener is 5K-pace reps (Research/08
        // §9.3 "5×1min @ 5K pace") — a NEUROMUSCULAR primer FASTER than race pace, not MP. Compute I-pace for
        // the tune-up day even when the goal distance isn't I-eligible for long-run inserts (spec-builder
        // uses it only when the prescription says "5K pace", so the HM tune-up still reads HMP).
        const iPaceSec = (args.goalIPaceEligible || d.type === 'race_week_tuneup')
          ? iPaceFromVdot(vdotFromTpace(weekT))
          : null;
        const built = buildWorkoutSpec(
          d.type, d.distanceMi, weekT, args.lthr, d.subLabel, args.maxHr ?? null,
          // 2026-06-09 · goal pace · only the race branch reads it.
          args.goalPaceSec ?? null,
          iPaceSec,
          args.easyAnchorTSec ?? null,  // PACE-E-1 · easy/long/recovery anchor (current fitness)
        );
        paceTargetSPerMi = built.paceTargetSPerMi;
        workoutSpec = built.spec;
      }
      // 2026-06-02 · distance_mi now reflects the TOTAL run · WU + core +
      // floats + CD · so the headline number matches the breakdown.
      // Was: stored just the core (e.g. "4×1 mi @ T" → 4.0) while the
      // sub_label said "2 mi WU · 4 mi @ T · 2 mi CD" (= 8 mi). The
      // runner's math didn't tie. See spec-builder.totalDistanceMiFromSpec
      // for the inclusion rules.
      // 2026-06-21 · cap the spec's REALIZED distance at the clamped day
      // distance. The post-compose easy/quality≤long sweep clamps
      // d.distanceMi, but the PERSISTED distance is the spec's summed segments
      // — which can exceed it (fixed-shape tempo, float-jog overshoot) and ship
      // a quality run longer than the week's long on short-race plans (round-2
      // CRITICAL). No-op when the spec already fits (David byte-for-byte same).
      workoutSpec = capSpecToDistance(workoutSpec, d.distanceMi);
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
      const sealed = args.sealedSnapshot.get(dateISO);
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
      workoutRows.push(
        [wkoId, planId, weekId, dateISO, d.dow, finalType, finalDistanceMi,
         finalPaceSec, finalSpec ? JSON.stringify(finalSpec) : null,
         // notes coalesce '' · column is NOT NULL (persona-suite catch).
         finalIsQuality, finalIsLong, finalNotes ?? '', finalSubLabel]
      );
    }

    // Strength companion rows (finding 5.5) · Research/07 doctrine.
    // Two sessions on easy days per week, alternating Session A (even
    // weeks, heavy/hip) and Session B (odd weeks, single-leg/core).
    // Skipped on race week and the final 2 taper weeks where fatigue
    // management takes priority over strength stimulus.
    if (!w.isRaceWeek && wi < args.weeks.length - 2) {
      const isHeavy = wi % 2 === 0;
      const strengthSession = isHeavy
        ? { kind: 'strength', title: 'Session A · hips + posterior', durationMin: 20,
            exercises: [
              { name: 'Goblet squat (or rear-foot split squat)', sets: 3, reps: '6-8 heavy' },
              { name: 'Hip thrust (or single-leg bridge)', sets: 3, reps: '8-10' },
              { name: 'Calf raise, straight knee', sets: 2, reps: '12-15' },
            ] }
        : { kind: 'strength', title: 'Session B · single-leg + core', durationMin: 20,
            exercises: [
              { name: 'Walking lunge (or step-up)', sets: 3, reps: '8/leg' },
              { name: 'Side plank + leg lift', sets: 3, reps: '30s/side' },
              { name: 'Soleus raise, bent knee', sets: 2, reps: '12-15' },
            ] };
      const strLabel = isHeavy ? 'SESSION A' : 'SESSION B';
      for (const d of w.days.filter(d2 => d2.type === 'easy').slice(0, 2)) {
        const sId = id('wko');
        const dateISO = dateForDow(d.dow);
        workoutRows.push(
          [sId, planId, weekId, dateISO, d.dow, 'strength', 0,
           null, JSON.stringify(strengthSession),
           // notes '' not null · plan_workouts.notes is NOT NULL (persona-
           // suite catch — every cold-start race plan died here at persist).
           false, false, '', strLabel]
        );
      }
    }
  }

  if (weekRows.length > 0) {
    const params: unknown[] = [];
    const tuples = weekRows.map((row) => {
      const b = params.length;
      params.push(...row);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });
    await client.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale, is_peak, is_cutback)
       VALUES ${tuples.join(', ')}`,
      params
    );
  }

  // 13 bound params per row · the original_* columns reuse the row's own
  // placeholders ($b+4 date, $b+6 type, $b+7 distance, $b+13 sub_label)
  // exactly like the old single-row statement reused $4/$6/$7/$13.
  const WORKOUT_CHUNK = 50;
  for (let i = 0; i < workoutRows.length; i += WORKOUT_CHUNK) {
    const chunk = workoutRows.slice(i, i + WORKOUT_CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const b = params.length;
      params.push(...row);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, ` +
        `$${b + 8}, $${b + 9}::jsonb, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, ` +
        `$${b + 4}, $${b + 6}, $${b + 7}, $${b + 13})`;
    });
    await client.query(
      `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                  pace_target_s_per_mi, workout_spec,
                                  is_quality, is_long, notes, sub_label,
                                  original_date_iso, original_type, original_distance_mi, original_sub_label)
       VALUES ${tuples.join(', ')}`,
      params
    );
  }

  return planId;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

/**
 * Post-composition finalize · pure, mutates `composed` in place. Applies the
 * refinements that sit between composePlan and validateComposedPlan: the
 * long-run WoW smoother, the taper rescale, a second WoW smooth, and the final
 * easy≤long invariant sweep. Extracted (2026-06-22) so generatePlan and the
 * plan simulator (/api/plan/simulate) run the IDENTICAL post-processing and can
 * never drift. No DB, no clock. Behavior-preserving lift of the former inline
 * block — asserted byte-stable by the plan test suite.
 */
export function finalizeComposedPlan(composed: ComposePlanResult, raceDistanceMi: number): void {
  // Long-run WoW smoother · clamp each training long to ≤ prev × 1.30
  // (rounded down to 0.5mi), trimming the week total to match. Defined as a
  // function so it can be RE-APPLIED after the taper rescale below — the
  // rescale shrinks one taper week's long without touching the next, which
  // can re-introduce the very >30% jump this smoother exists to prevent
  // (workflow CRITICAL · marathon got zero plans on a ~17-week runway).
  const smoothLongWoW = () => {
    let prevLong = 0;
    for (const week of composed.weeks) {
      const day = week.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0);
      if (!day) continue;
      if (prevLong > 0) {
        const ceil = Math.floor(prevLong * 1.30 * 2) / 2;
        if (day.distanceMi > ceil) {
          const trim = day.distanceMi - ceil;
          day.distanceMi = ceil;
          week.weeklyMi = Math.max(0, Math.round((week.weeklyMi - trim) * 10) / 10);
        }
      }
      prevLong = day.distanceMi;
    }
  };
  smoothLongWoW();

  // (Progressive taper enforcement moved BELOW the VOL-1 reconcile — it must see each week's
  // REALIZED day-sum, not the volume-curve budget · COH-4.)

  // 2026-06-21 · re-smooth long-run WoW AFTER the taper rescale. The rescale
  // can shrink a taper week's long below its predecessor's-÷1.30 floor while
  // leaving the next taper week untouched, re-creating an illegal jump. The
  // smoother only ever trims DOWN, so it converges and never undoes the
  // taper drop. Belt-and-suspenders with the no-floor-in-taper fix above.
  smoothLongWoW();

  // 2026-06-20 · FINAL easy≤long invariant sweep. The long-smoothing and
  // taper rescale above can trim the long run AFTER layoutWeek already
  // clamped easy days to the (then larger) long — re-introducing the
  // inversion (easy ends up 0.5mi over a trimmed long on cutback / taper
  // weeks · caught by the full audit matrix). Re-cap every easy day at its
  // week's training long so the long is always the longest run, trimming
  // the week total to match. Race-day rows are skipped (not training longs).
  for (const w of composed.weeks) {
    // Longest run of the week INCLUDING the race day — in a short-race
    // (5K/10K) race week the race itself is the longest run, so an easy
    // shakeout must not exceed it either.
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
    if (longMi <= 0) continue;
    for (const d of w.days) {
      // 2026-06-21 · re-cap EASY *and* QUALITY at the (possibly trimmed) long.
      // layoutWeek clamps them at compose time, but the WoW smoother + taper rescale
      // above trim the long afterward, so a session sized to the original long can
      // re-exceed the trimmed long. 2026-06-23 · RP-5 · easy is held STRICTLY below the
      // long (~0.8×) so the long stays visibly the longest run; quality may reach it.
      // Race day exempt (longest by design in a short race).
      const cap = d.type === 'easy' ? Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))) : longMi;
      if ((d.type === 'easy' || (d.isQuality && d.type !== 'race')) && !d.isLong && d.distanceMi > cap) {
        w.weeklyMi = Math.max(0, Math.round((w.weeklyMi - (d.distanceMi - cap)) * 10) / 10);
        d.distanceMi = cap;
      }
    }
  }

  // 2026-06-23 · VOL-1 · reconcile EVERY week's reported weeklyMi to the ACTUAL
  // scheduled day-sum (race day excluded — it is the event, not training mileage).
  // Until now weeklyMi carried the volume-curve BUDGET, but the per-day caps (long cap,
  // easy≤long clamp, frequency cap) silently drop whatever the budget can't place — so
  // a low-frequency plan advertised 40mi while the days summed to 24 (~40% phantom).
  // The validator validated the lie and the UI rendered it. Make weeklyMi == realized
  // so the reported number can never exceed the plan AND the taper-drop check sees the
  // race week's true (small) taper volume, not its phantom budget — otherwise a
  // reconciled peak can fall below the un-reconciled race-week budget and false-fail.
  for (const w of composed.weeks) {
    w.weeklyMi = Math.round(w.days.reduce((s, d) => s + (d.type !== 'race' ? d.distanceMi : 0), 0) * 10) / 10;
  }

  // 2026-06-23 · COH-4 · PROGRESSIVE taper enforcement, AFTER VOL-1 so it sees each week's REALIZED
  // day-sum. The race week's pre-race easy volume often EXCEEDS the volume-curve budget (the layout
  // places easy days the budget didn't account for), so running this on the budget missed it and
  // left the race week ABOVE the preceding taper week (non-monotonic). Research/08 §9.2: the taper
  // descends 80-90% → 60-70% → 40-50% of peak. Cap each taper week at BOTH its doctrine factor AND
  // the prior taper week (strict monotonic descent); scaling all non-race days preserves easy<long.
  const nonTaperPeakR = Math.max(0, ...composed.weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek).map((w) => w.weeklyMi ?? 0));
  if (nonTaperPeakR > 0) {
    const taperWeeks = composed.weeks.filter((w) => w.phase === 'TAPER');
    let priorTaper = Infinity;
    for (let i = 0; i < taperWeeks.length; i++) {
      const tw = taperWeeks[i];
      const wksLeft = taperWeeks.length - i;
      const factor = wksLeft === 1 ? 0.45 : wksLeft === 2 ? 0.60 : 0.82;
      const target = Math.min(tw.weeklyMi, nonTaperPeakR * factor, priorTaper);
      if (tw.weeklyMi > 0 && target < tw.weeklyMi - 0.05) {
        const scale = target / tw.weeklyMi;
        for (const d of tw.days) {
          if (d.type !== 'race' && d.distanceMi > 0) d.distanceMi = Math.floor(d.distanceMi * scale * 2) / 2;
        }
        tw.weeklyMi = Math.round(tw.days.reduce((s, d) => s + (d.type !== 'race' ? d.distanceMi : 0), 0) * 10) / 10;
      }
      priorTaper = tw.weeklyMi;
    }
  }
}

export async function generatePlan(input: GenerateInput): Promise<GenerateResult> {
  const { userId, raceSlug, startAnchor = 'monday', startDateISO, goalTarget, freshTarget } = input;

  // 1. Load all DB-sourced inputs into a pure-data bundle.
  const inputs = await loadGeneratorInputs(userId, raceSlug, startAnchor, startDateISO, goalTarget);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };

  // 2026-06-03 · Rules 12 + 13 · pick plan mode based on temporal context.
  // race-prep: race is within build window
  // maintenance: race is too far out · hold aerobic base
  // recovery: another race finished recently · 1-2 week light-running
  const todayISO = await runnerToday(userId);
  const { lastRaceFinished, lastRaceDistanceMi } = await loadLastRaceFinished(userId, todayISO);
  // Goal-mode is always a BUILD to the goal (the runner chose the length) — it
  // never demotes to maintenance/recovery the way a far-off or just-finished
  // race would.
  const mode: PlanMode = goalTarget ? 'race-prep' : pickPlanMode(
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
    const tier = lookupTierTarget(inputs.compose.goalPaceSec, inputs.compose.raceDistanceMi, inputs.compose.level).tier; // VAR-01
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
      availableDows: inputs.compose.availableDows ?? null,
      trainingDaysPerWeek: inputs.compose.trainingDaysPerWeek,
      crossModes: inputs.compose.crossModes,
      tier,
      nextRace: {
        // This non-race (maintenance/recovery) branch is only reached on the
        // race path (goal-mode forces 'race-prep'), so raceSlug is defined here.
        slug: raceSlug ?? '',
        name: raceSlug ?? '',
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

  // 3. Validate composed plan · gate before any DB mutation.
  // Throws PlanValidationError if doctrine or corruption checks fail.
  // clearActivePlansFor never runs on a bad plan — runner's active plan untouched.
  {
    const priorPeakRow = (await pool.query<{ peak_long: string | null }>(
      `SELECT MAX(pw.distance_mi)::text AS peak_long
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL AND pw.type = 'long'`,
      [userId],
    ).catch(() => ({ rows: [{ peak_long: null }] }))).rows[0];
    // F13: query trailing 28d actual mileage for peak-vs-trailing ramp check.
    const trailingRow = (await pool.query<{ avg_weekly: string | null }>(
      `SELECT (SUM((data->>'distanceMi')::numeric) / 4.0)::text AS avg_weekly
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - INTERVAL '28 days'
          AND (data->>'date')::date < $2::date`,
      [userId, todayISO],
    ).catch(() => ({ rows: [{ avg_weekly: null }] }))).rows[0];
    const trailingAvgWeeklyMi = trailingRow?.avg_weekly != null
      ? Number(trailingRow.avg_weekly)
      : null;
    // 2026-06-10 persona-suite fix · author-time WoW smoothing. The
    // long-run curve steps in whole/half miles; at low cold-start bases
    // a 2mi step IS >30% (6mi → 8mi = 33%) and the validator (rightly,
    // per its cited progression doctrine) rejected every low-base race
    // plan. Enforce the SAME rule at author time: clamp each training
    // long to ≤ prev × 1.30, rounded DOWN to 0.5mi, trimming the week
    // total to match. 30 mirrors validate.ts CONSTRAINTS.longRunWoWMaxPct
    // (30 for all four distance categories — kept literal here because
    // generate→validate would be a runtime import cycle). Race-day rows
    // are not training longs and are skipped, matching the validator.
    finalizeComposedPlan(composed, inputs.compose.raceDistanceMi);
    // MAINT-WEEKLYML-1 (2026-06-23) · re-snapshot vols from the VOL-1-reconciled weeklyMi values so
    // non-race-prep modes (maintenance/recovery) carry realized volumes, not the pre-finalize budgets.
    // composePlan derives vols from volumeCurve (the real source); maintenance/recovery authored weeklyMi
    // from targetWeekly/wkWeekly scalars. VOL-1 in finalizeComposedPlan overwrites weeklyMi with the
    // actual day-sum for ALL modes, so vols[] must track it to stay in sync.
    composed.vols = composed.weeks.map((w) => w.weeklyMi);
    validateComposedPlan(composed, inputs.compose.raceDistanceMi, mode, {
      level: inputs.compose.level,
      // CC2-4 (2026-06-23) · key this to the SAME boundary the builder's horizonRaise extends at — any
      // horizon at marathon category or longer (distanceMi > 17, the hm→m cutoff). At >=20 a (17,20]
      // horizon (e.g. 30K = 18.64mi) made the builder author a ~21mi long while this flag stayed false →
      // HM cap 20 → persist-abort. David's CIM horizon (26.22) is true under both → no-op for him.
      isSteppingStoneToMarathon: (inputs.compose.horizonRaces ?? []).some(r => r.distanceMi > 17),
      // Corruption check compares against the active prior plan. On a fresh
      // user-initiated target (set-goal / add-race) the prior plan is a
      // DIFFERENT goal about to be replaced, so a legitimately smaller long
      // (marathon→5K, cold-start beginner) must not be flagged as data loss —
      // null skips it. Same-goal adaptation regens still get the check.
      priorPlanPeakLongMi: freshTarget ? null : (priorPeakRow?.peak_long != null ? Number(priorPeakRow.peak_long) : null),
      todayISO,
      trailingAvgWeeklyMi,
      trainingDaysPerWeek: inputs.compose.trainingDaysPerWeek,
      // GOAL-1 · available_days stranded quality to empty → composer folds to long+easy (valid)
      qualityStrandedByAvailability: inputs.compose.availableDows != null && (inputs.compose.qualityDows?.length ?? 0) === 0,
      recentWeeklyMi: inputs.compose.recentWeeklyMi, // CC-2 · cold-start ramp base
    });
  }

  // 4. Archive existing + persist · one transaction (M-19, 2026-06-09).
  // Wraps sealed-day snapshot → archive → all plan inserts → mode
  // stamp. Before this each step was its own pool.query: a crash after
  // the archive UPDATE left the runner with NO active plan (today /
  // watch / adaptation crons go dark), a crash mid-insert left a
  // half-written plan, and a transient DB error during the sealed-day
  // snapshot silently returned an empty map — the retry rebuilt with
  // every Rule 15 seal dropped. Now any failure rolls the whole
  // rebuild back and the prior plan stays active.
  let planId: string | undefined;
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query('BEGIN');
    // 2026-06-03 · Rule 15 · snapshot the prior plan's completed-day
    // prescriptions BEFORE archiving so persistPlan can overlay them
    // onto the new plan's rows. Without this, a rebuild would change
    // what the runner was prescribed for days they already ran ·
    // every retro surface (badge, recap, VDOT, adapt-text) would lie.
    // Throws on DB error · the rebuild aborts rather than unsealing.
    const sealedSnapshot = await snapshotSealedDays(client, userId);
    await clearActivePlansFor(client, userId);
    planId = await persistPlan(client, {
      userId,
      raceSlug: raceSlug ?? null,  // null for goal-mode (no race row)
      raceDateISO: inputs.compose.raceDateISO,
      blocks: composed.blocks,
      weeks: composed.weeks.map((w) => ({
        // 2026-06-06 · Audit C C1-1f · pass the per-week blended tPaceSec
        // through to persistPlan. Was stripped here → persistPlan fell back
        // to plan-wide goalT for every week → flat goal-pace plan (the
        // Rule 3 ramp was computed in composePlan then discarded at persist).
        startISO: w.startISO, phase: w.phase, days: w.days, isRaceWeek: w.isRaceWeek, tPaceSec: w.tPaceSec,
      })),
      tPaceSec: inputs.compose.tPaceSec,
      // PACE-E-1 · current-fitness anchor for easy/long/recovery (vs the goal-blended weekT).
      easyAnchorTSec: tPaceFromVdot(inputs.compose.bestRecentVdot ?? conservativeVdotFromMileage(inputs.compose.recentWeeklyMi)),
      lthr: inputs.compose.lthr,
      // 2026-06-03 · Rule 16 · plumb maxHr through to spec-builder so
      // easy/long HR caps land at max(89% LTHR, 78% maxHR) instead of
      // LTHR-only. profile.max_hr already loaded in inputs.compose.maxHr
      // via the planInputs reader.
      maxHr: inputs.compose.maxHr,
      // 2026-06-09 state-audit fix · goal pace for the race-day target.
      goalPaceSec: inputs.compose.goalPaceSec,
      // R3 + PACE-I-1 (2026-06-23) · 5K/10K/HM race goals get true VO2max I-pace intervals. HM was
      // excluded, but its quality day is explicitly labeled "6×800m @ I pace" (inlinePrescriptions) —
      // with iPace null it shipped the cruise T−18 default: a +6..+28 s/mi too-slow "VO2max" rep that
      // contradicts its own label (Research/22:187,194,206,213 · HM I-reps ≈ 5K-10K race pace).
      // Marathon/ultra keep the cruise default (their label is "I-T transition", not "@ I pace").
      goalIPaceEligible: ['5k', '10k', 'hm'].includes(distanceCategoryOf(inputs.compose.raceDistanceMi)),
      sealedSnapshot,
      authoredState: {
        ...composed.authoredState,
        mode,
        // Goal-anchored plan (no race row): record the goal so surfaces can
        // say "working toward your 10K" off the plan + the projection can read
        // the target without a races lookup.
        ...(goalTarget ? {
          goal_mode: true,
          goal_distance_mi: goalTarget.distanceMi,
          goal_sec: goalTarget.goalSec,
        } : {}),
        generated_at: new Date().toISOString(),
        // When runway is < 14 weeks (e.g. AFC → CIM compressed block), flag it
        // so the coach briefing layer can surface the context. Base phase
        // condenses; race-specific and taper are preserved intact.
        // Cite: Research/22-plan-templates.md §11 "Two Marathons (spring + fall)"
        ...(composed.totalWeeks < 14 ? {
          compressed_timeline: true,
          compressed_note: `${composed.totalWeeks}-week build — base phase condensed; race-specific phase and taper preserved intact.`,
        } : {}),
      },
    });

    // Write the mode column for fast filtering by graduate/transition crons.
    await client.query(
      `UPDATE training_plans SET mode = $1 WHERE id = $2`,
      [mode, planId],
    );
    await client.query('COMMIT');
  } catch (e) {
    console.error('[generatePlan]', `rebuild rolled back · prior active plan untouched · user=${userId.slice(0, 8)} ·`, e instanceof Error ? e.message : String(e));
    // Roll back so the prior active plan stays live. If ROLLBACK itself
    // fails the connection is poisoned — hand the error to release() so
    // the pool destroys the socket instead of recycling a connection
    // with an open aborted transaction.
    try { await client.query('ROLLBACK'); }
    catch (rbErr) { releaseErr = rbErr instanceof Error ? rbErr : new Error(String(rbErr)); }
    throw e;
  } finally {
    client.release(releaseErr);
  }

  // Post-commit, best-effort · plan mutation → invalidate memoized lookup
  // so the next /today render sees the new active plan.
  (await import('./lookup')).bustPlanLookupCache(userId);

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
  // 2026-06-21 · meta.distanceMi is rarely populated on race rows (the editor
  // stores a distanceLabel, not a numeric mile count), so reading it directly
  // returned NaN → recovery mode never armed in production. distanceMiOf does
  // the same label fallback loadGeneratorInputs already trusts for the race
  // path (distanceMi → distanceLabel → name). 2026-07-07 · ultra-honesty audit:
  // distanceMiOf no longer falls through to 13.1 for an unparseable label — an
  // unresolvable last-finished-race distance is treated the same as "no last
  // race" (null) so pickPlanMode never arms recovery mode off a fabricated
  // half-marathon distance.
  const dMi = distanceMiOf(m);
  if (dMi == null) return { lastRaceFinished: null, lastRaceDistanceMi: null };
  return {
    lastRaceFinished: {
      slug: r.slug,
      name: String(m.name || r.slug),
      date: String(m.date),
      distanceMi: dMi,
    },
    lastRaceDistanceMi: dMi,
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
  raceSlug: string | undefined,
  startAnchor: 'today' | 'monday' = 'monday',
  startDateISO?: string,
  goalTarget?: { distanceMi: number; goalSec: number | null; raceDateISO: string },
): Promise<
  | { ok: true; compose: ComposePlanInput }
  | { ok: false; reason: string }
> {
  const todayISO = await runnerToday(userId);

  // 1. Target — a races row (race-anchored) OR the runner's fitness goal
  // (goal-anchored, no race row). Both resolve to {raceDistanceMi, raceDateISO,
  // goalSec}; everything downstream is identical.
  let raceDateISO: string;
  let raceDistanceMi: number;
  let goalSec: number | null;
  if (goalTarget) {
    // 2026-07-07 · ultra-honesty audit P1-41 · /api/profile/goal accepts
    // '50K'/'100K' (ALLOWED_DISTANCES) and used to route every distance
    // through the same periodized builder, including ultras — the same
    // fake-support bug as the race path, just entered via the no-race goal
    // flow instead of Add Race. Same gate, same reason string, so the
    // caller's toFriendlyPlanError path is unchanged either way.
    if (goalTarget.distanceMi > DANIELS_MAX_VALID_DISTANCE_MI) {
      return {
        ok: false,
        reason: "Ultra plans aren't built yet. The race is on your calendar; training targets stay anchored to your current fitness.",
      };
    }
    raceDateISO = goalTarget.raceDateISO;
    raceDistanceMi = goalTarget.distanceMi;
    goalSec = goalTarget.goalSec;
  } else {
    // 2026-06-05 · backend audit P0-6 fix · scope race lookup by user.
    // races.slug is per-user · without user_uuid filter, plan generation
    // can latch onto another runner's race row with the same slug.
    // Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1 AND user_uuid = $2`, [raceSlug, userId])).rows[0];
    if (!raceRow) return { ok: false, reason: 'race not found' };
    const meta = raceRow.meta ?? {};
    if (!meta.date) return { ok: false, reason: 'race missing date' };
    raceDateISO = meta.date;
    const dMi = distanceMiOf(meta);
    // 2026-07-07 · ultra-honesty audit P1-41 · distanceMiOf no longer falls
    // through to 13.1 for an unrecognized label — an unresolvable distance
    // means "we don't know", never "assume half marathon". Fail honestly
    // instead of composing a plan for the wrong event.
    if (dMi == null) return { ok: false, reason: 'race distance unrecognized; cannot build a plan for an unknown distance' };
    // GOAL: HONEST UNSUPPORTED (David-approved 2026-07-07) · the Daniels-
    // periodized generator (composePlan/composeMaintenancePlan/
    // composeRecoveryPlan) is built and validated for 5K-through-marathon
    // training doctrine only — Research/00a's periodization tables, taper
    // %s, and long-run caps are all sourced from that range; nothing in
    // Research/ covers 50K/50M/100K/100M periodization. Rather than fake
    // support by quietly capping an ultra at the marathon long-run/pace
    // model (the exact P1-41 bug), the race saves fine (POST /api/race
    // never blocks on this) and generation returns a clear unsupported
    // reason. Callers (race POST, /api/plan/generate) surface it as a
    // friendly message; the runner is left on the no-plan / maintenance
    // machinery (see goal-mode / just-run fallback), never on a wrong plan.
    if (dMi > DANIELS_MAX_VALID_DISTANCE_MI) {
      return {
        ok: false,
        reason: "Ultra plans aren't built yet. The race is on your calendar; training targets stay anchored to your current fitness.",
      };
    }
    raceDistanceMi = dMi;
    goalSec = parseGoalSeconds(meta.goalDisplay);
  }

  const totalDays = daysBetween(todayISO, raceDateISO);
  if (totalDays < 14) return { ok: false, reason: 'target < 2 weeks away; use race-week briefing only' };
  if (totalDays > 365) return { ok: false, reason: 'target > 1 year out; plan only when within a year' };

  // PACE-3 · sanity-guard the implied pace. A wheel/entry error (e.g. an HM time pasted
  // onto a 5K goal) can imply a >15:00/mi "race pace" that threads an absurd 30-min/mi
  // threshold into every workout. Treat an implausibly slow sub-HM goal as absent → it
  // falls to the currentT fitness anchor (VAR-05) instead of the bogus pace.
  // GOAL-4 (2026-06-23) · null a physiologically OFF-TABLE goal so it can't thread impossible paces
  // into the plan — either implausibly SLOW on a sub-HM (a wheel hours-truncation → ~30 min/mi) OR
  // OFF-THE-TOP (a fast wheel truncation: 45:00 entered for a 1:45 HM → 3:21/mi, or a sub-2:00
  // marathon → 4:17/mi). vdotFromRace returns null outside VDOT[30,85]; the predictRaceTime(85,…)
  // compare keeps only the off-the-TOP side (faster than world-class), leaving legit slow goals. A
  // nulled goal falls to the currentT fitness anchor (VAR-05). Cite Research/01:138-145.
  // GOAL-4 (2026-06-23): null out goals that map outside the VDOT[30,85] training table.
  // OFF-THE-TOP: faster than world-class (VDOT >85) → null → fall to currentT anchor (VAR-05).
  // OFF-THE-BOTTOM (GOAL-4-SLOW-1, 2026-06-23): slower than VDOT 30 for HM/M/ultra
  //   → also null. Without this a 6-hour marathon goal threads ~13:26/mi "T-pace" into every
  //   quality workout (slower than most runners' easy pace). Short distances (< 13.1mi) have a
  //   900 s/mi cap already; for HM+ the two-sided vdotFromRace==null check covers both extremes.
  // nulled goal falls to the currentT fitness anchor (VAR-05). Cite Research/01:138-145.
  if (goalSec != null && (
    (raceDistanceMi < 13.1 && goalSec / raceDistanceMi > 900) ||
    (vdotFromRace(goalSec, raceDistanceMi) == null && (
      goalSec < (predictRaceTime(85, raceDistanceMi) ?? 0) ||          // off-the-top (VDOT > 85)
      goalSec > (predictRaceTime(30, raceDistanceMi) ?? Infinity)       // off-the-bottom (VDOT < 30)
    ))
  )) goalSec = null;
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;

  // 2. User prefs · layout
  const prefs = await loadSettings(userId).catch(() => null);
  let longRunDow  = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
  let restDow     = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
  // qualityDows comes from runner prefs · composePlan slices it per-
  // week via densityForWeek() to honor Rule 5 (density ramp).
  // P2-36 (2026-07-06): `?? ['tue','thu']` only catches null/undefined —
  // a runner who deselected every chip in Settings saves quality_days:[]
  // (a real empty array, not absent), so it silently fell through with
  // zero quality days and no quality stimulus ever generated again. An
  // empty selection means "let the coach pick," same as never having set
  // it, so treat length-0 the same as unset.
  let qualityDows = (prefs?.quality_days?.length ? prefs.quality_days : ['tue', 'thu']).map((d) => dayKeyToDow(d as DayKey));

  // 2026-06-20 · available-days placement (goal/race setup asks which days the
  // runner can run). When set (>=2 days), long/quality/easy land ONLY on those
  // days and the rest are rest — Research/22 "shift rest days to user schedule".
  // Unset → keep the prefs above, so existing runners (incl. David) are
  // unchanged. availableDows is threaded to layoutWeek to force the easy days
  // onto available days too.
  let availableDows: Set<number> | null = null;
  const avail = (prefs?.available_days ?? []).map((d) => dayKeyToDow(d as DayKey));
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    // Long run: the runner's chosen long day if available, else the latest
    // weekend day available (Sat > Sun), else the latest available day.
    longRunDow = (aset.has(longRunDow) ? longRunDow
      : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    // Rest: keep the runner's rest day if it's already unavailable; else pick
    // the first day they CAN'T run as the (true) rest day.
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    // Quality: available days other than the long day, midweek-first so hard
    // days sit away from the long run. composePlan slices to weekly density.
    qualityDows = spacedQualityDowsFromAvailable(avail, longRunDow);
  }

  // 2026-06-10 · stated training frequency (profile.weekly_frequency,
  // captured at onboarding). Drives BOTH the quality-day count and the
  // total running-days cap (layoutWeek). NULL (David, pre-frequency
  // profiles, Strava-only signups) preserves legacy behavior — the
  // generator fills every non-rest slot and uses prefs' 2 quality days.
  const freqRow = (await pool.query<{ f: number | null }>(
    `SELECT weekly_frequency AS f FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ f: number | null }> }))).rows[0];
  // 2026-06-20 · weekly_frequency now spans 0-6 (true-beginner support).
  //   3-6  → respected exactly as before (existing users unchanged).
  //   1-2  → respected as a hard cap so a low-frequency runner gets 1-2
  //          running days, not the legacy fill-every-slot. (The old `>= 3`
  //          clamp silently dropped 1/2 to null → cap disabled → 5-6 days,
  //          badly over-prescribed for someone who runs twice a week.)
  //   0    → "not running yet" + a goal → a gentle couch-to-X floor of 3
  //          days (the standard beginner run-training frequency). An empty
  //          week can't train toward a goal.
  //   null → David / Strava-only / pre-frequency profiles: legacy fill-
  //          every-slot + prefs' 2 quality days, byte-for-byte unchanged.
  const rawFreq = freqRow?.f != null ? Number(freqRow.f) : null;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  // Quality-day count scaled to the running-day budget so we never prescribe
  // more hard days than the runner has sessions:
  //   1 day  → 0 quality (the single run is just easy/long)
  //   2-4    → 1 quality (the canonical low-frequency 1 long + 1 quality)
  //   5+     → 2 quality
  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }

  // 3. Cross-training opt-in (P34)
  const ctRow = (await pool.query(
    `SELECT cross_training_modes FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const crossModes: string[] = Array.isArray(ctRow?.cross_training_modes)
    ? ctRow.cross_training_modes : [];

  // 4. Plan-shape inputs
  // 2026-06-10 · onboarding anchors week 0 at the runner's chosen start
  // day (startDateISO, clamped to ≥ today), else TODAY (startAnchor),
  // so a mid-week signup never sees runs dated before they existed.
  // Lifecycle regens anchor each plan_weeks row to the training-week
  // boundary. The race-week math is anchor-agnostic: race day always
  // falls in the final 7-day block regardless of where week 0 starts.
  //
  // #10 (audit 2026-06-16) · the lifecycle-regen anchor is now the runner's
  // training-week-start (day AFTER long_run_day), matching /api/plan/week,
  // instead of a hardcoded Monday. So a plan_weeks row spans the same 7 days
  // as the WeekStrip window for non-Sunday-long runners (was: Monday-anchored
  // rows straddled the strip). For David (long=Sun → start=Mon) the boundary
  // IS Monday, so weekStartBoundaryOf == mondayOf — a provable no-op. The
  // onboarding (startDateISO) and start-today paths stay literal: forcing them
  // to a boundary would date runs before signup / shift the runner's chosen
  // start. Both runway endpoints snap to the SAME boundary so totalWeeks stays
  // an exact multiple of 7 (fractional weeks broke phase advancement, the C1
  // bug class — see composePlan).
  const weekStartDow = (longRunDow + 1) % 7;  // day after the long run, per /api/plan/week
  const startMondayISO = (startDateISO && startDateISO >= todayISO)
    ? startDateISO
    : startAnchor === 'today' ? todayISO : weekStartBoundaryOf(todayISO, weekStartDow);
  // LSP2-1 (2026-06-23) · a goalTarget race date is start+weeks*7 with NO weekday snap, so it lands on
  // day-0 of its week → SP-4 strips every tune-up/shakeout/easy that wraps onto the post-race days and
  // the final week collapses to a bare race day (all 7 start weekdays, prod-only — the sim snaps and
  // hid it). Snap a goalTarget race to the END of its week (weekStartBoundary + 6 = the long-run day) so
  // the pre-race days fit. goalTarget ONLY — a real race honors its chosen date. totalWeeks is unchanged
  // (the snap stays within the same week). David is a real race → no-op.
  if (goalTarget) raceDateISO = addDays(weekStartBoundaryOf(raceDateISO, weekStartDow), 6);
  const totalWeeks = daysBetween(startMondayISO, weekStartBoundaryOf(raceDateISO, weekStartDow)) / 7 + 1;
  if (totalWeeks < 3) return { ok: false, reason: 'plan needs at least 3 weeks runway' };

  const isMidBlock = await detectMidBlock(userId);
  let recentMi = await recentWeeklyMileage(userId);
  const easyFloor = await easyDayMedianMi(userId);
  let recentLong = await recentPeakLongMi(userId);
  // 2026-06-10 persona-suite fix · cold-start race plans. A brand-new
  // runner has NO runs, so recentMi/recentLong read 0 and the ramp from
  // zero to race-prep peaks trips the progression validator (26.2mi
  // long-run peak, 50% weekly jumps — EVERY race-path onboarding
  // failed). Seed the zeros from the runner's SELF-REPORTED onboarding
  // baselines — the documented purpose of profile.history_* (see
  // /api/onboarding/complete § PLAN-GEN HANDOFF). Self-reports only
  // fill zeros; any real run history always wins.
  if (recentMi <= 0 || recentLong <= 0) {
    const selfReport = (await pool.query<{ avg: number | null; target: number | null; long: number | null }>(
      `SELECT history_avg_weekly_mi AS avg, weekly_mileage_target AS target,
              history_longest_recent_mi AS long
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (recentMi <= 0) { recentMi = Number(selfReport?.avg ?? selfReport?.target ?? 0) || 0; if (recentMi > 50) recentMi = 50; } // CC-6 · collapse a 55 self-report target to the sim/gate's 50 cap (50 vs 55 yield identical paces)
    if (recentLong <= 0) recentLong = Number(selfReport?.long ?? 0) || 0;
  }
  // COH-1 · clamp the reported longest run to be coherent with weekly volume (the long anchors
  // the week; an incoherent long mis-sizes the whole plan). Byte-safe for coherent runners.
  recentLong = coherentRecentLong(recentLong, recentMi, trainingDaysPerWeek);
  // 2026-06-03 · mid-block doctrine carriers (Rules 2, 3, 5, 8).
  const recentQualityDist = await recentQualityDistanceMi(userId);
  const recentQualityPW = await recentQualityPerWeek(userId);
  // bestRecentVdot — assembled by the canonical shared loader (B2).
  // A fix to the race/run query now propagates to all call sites automatically.
  // Throws on DB error; generatePlan propagates up (refuses to plan rather than
  // producing a goal-pace plan from undefined VDOT — the C1 bug class).
  const runFloorMi = await goalRunFloorMiForUser(userId);
  const { raceCandidates, runCandidates } = await loadVdotInputs(userId, todayISO);
  const { best: bestVdotPick } = computeBestRecentVdot(raceCandidates, todayISO, 180, runCandidates, runFloorMi);
  // PARITY-1 (2026-06-23) · when there is NO measured signal (empty races+runs → bestVdotPick
  // undefined, the no-Strava cold-start case), seed bestRecentVdot from self-reported onboarding PRs
  // (profile.race_history) — the canonical pace anchor (Research/01:3,115). Prod previously read ONLY
  // races+runs and dropped the reported PR, pacing the runner ~96s/mi too slow; the sim already reads
  // it (sim-inputs.bestVdotFromHistory), so this restores SIM↔PROD parity. Fires only when no measured
  // signal exists — never overrides a real bestVdotPick. Raw vdotFromRace to match the sim exactly.
  let bestRecentVdot = bestVdotPick?.vdot ?? undefined;
  if (bestRecentVdot === undefined) {
    const rhRow = (await pool.query<{ race_history: any }>(
      `SELECT race_history FROM profile WHERE user_uuid = $1 LIMIT 1`, [userId],
    ).catch(() => ({ rows: [] }))).rows[0];
    // LSP2-2 · 180d window (~6mo = '<6mo' bucket midpoint 90d ≤ 180d · '6-12mo' midpoint 270d > 180d).
    // A PR from 8+ months ago does not reflect current fitness; cap to recent races only.
    bestRecentVdot = bestVdotFromRaceHistory(Array.isArray(rhRow?.race_history) ? rhRow.race_history : [], 180);
  }
  // maxHr for Rule 16 (easy/long HR cap). loadVdotInputs resolves it
  // internally for the run-candidate gate; hoist separately for composePlan.
  const maxHr = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);
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
        AND meta->>'priority' IN ('A','B')`,
    [userId, raceDateISO],
  ).catch(() => ({ rows: [] }))).rows;
  // HORIZON-1 (2026-06-23) · derive distance via distanceMiOf (its distanceLabel→name fallback), NOT
  // the raw meta.distanceMi jsonb field — which is NULL for every label-only race (the standard write
  // path writes distanceLabel only). The old SQL `(meta->>'distanceMi')::numeric > $3` excluded every
  // label-only horizon, so the half→full bridge (Rule 11) never fired for those users; the same null
  // leaked into Number(m.distanceMi)=NaN → wrong tier + a dead stepping-stone gate. Filter "longer than
  // the current race" in TS via distanceMiOf. (David's CIM has a numeric distanceMi → identical result.)
  const horizonRaces: ComposePlanInput['horizonRaces'] = horizonRacesRows
    .map((r) => ({ r, m: r.meta || {}, dMi: distanceMiOf(r.meta || {}) }))
    // 2026-07-07 · ultra-honesty audit · distanceMiOf now returns null for an
    // unresolvable label instead of assuming 13.1 — drop those rows from the
    // stepping-stone horizon rather than let a null slip into the `> ` compare
    // (which would exclude it anyway, but silently and confusingly via NaN-like
    // behavior; explicit is safer against future refactors).
    .filter((x): x is { r: typeof x.r; m: any; dMi: number } => x.dMi != null && x.dMi > raceDistanceMi)
    .map(({ r, m, dMi }) => {
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
  // #10 · same training-week boundary as startMondayISO above so the runway
  // count stays an exact multiple of 7 (no-op for David: boundary == Monday).
  const integerTotalWeeks = Math.max(3,
    Math.floor(daysBetween(startMondayISO, weekStartBoundaryOf(raceDateISO, weekStartDow)) / 7) + 1
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
  // 2026-06-06 · Audit C C5 · plan-wide T-pace. 2026-06-23 · VAR-05 · when no goal is set
  // (by-feel) OR an ultra makes tPaceFromGoal return null (PACE-5), anchor to the runner's
  // ACTUAL fitness (currentT from bestRecentVdot, else the conservative mileage estimate),
  // never the flat 480s/mi (8:00/mi) literal — this value feeds authoredState.t_pace_s_per_mi
  // + the per-week blend fallback. conservativeVdotFromMileage is always ≥30 so 480 is now a
  // dead last-ditch. Cite: Research/01 §Daniels-T (T is a function of VDOT, never a constant).
  const currentTLoader = tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(recentMi));
  // NEW-A (2026-06-23) · floor the plan-wide tPaceSec at currentT so the MAINTENANCE/RECOVERY composers
  // (which read input.tPaceSec, not tPaceForWeek) can't inherit a SLOW soft-goal pace → threshold quality
  // ~70s/mi slower than easy. Race-prep is unaffected (its goalT derives from input.goalSec, not tPaceSec).
  const goalTpLoader = tPaceFromGoal(goalSec, raceDistanceMi);
  const tPaceSec = (goalTpLoader != null && currentTLoader != null ? Math.min(goalTpLoader, currentTLoader) : goalTpLoader) ?? currentTLoader ?? 480;
  const lthrRow = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = lthrRow?.lthr ?? null;
  // maxHr resolved above alongside loadVdotInputs; used here for Rule 16.

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
      availableDows,
      trainingDaysPerWeek,
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
