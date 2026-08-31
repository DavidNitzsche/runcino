/**
 * loadVdotInputs — single shared DB-access layer for bestRecentVdot inputs.
 *
 * All surfaces that compute VDOT (profile-state, snapshot-projections,
 * generate.ts, race-header, drift-monitor) call this function instead of
 * assembling their own SQL. A fix to the race/run query propagates to every
 * caller automatically — this was the B2 failure class (Audit C C1 broke
 * only generate.ts's inputs; the other three sites diverged silently).
 *
 * Throws on DB error — no silent swallow. The caller decides what a failure
 * means: propagate up and refuse to generate a plan, refuse to project,
 * log-and-skip in a cron, or degrade gracefully in a display path.
 *
 * Race query: reads meta/actual_result jsonb per the C1 fix (2026-06-06).
 * Run query:  COALESCE(durationSec|movingTimeS|movingSec|elapsedTimeS)
 *             + Strava workoutType numeric→string mapping (C1-1b)
 *             + race-day exclusion (C1-1e).
 *
 * Cite: docs/OVERNIGHT-REPORT.md §B2.
 */

import { pool } from '@/lib/db/pool';
import {
  parseRaceTime, zoneFromType, vdotRunFloorMi, goalDistanceMiFromCode,
  FADE_TAIL_DAYS,
  VDOT_FULL_VALUE_DAYS,
} from '@/lib/training/vdot';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { excludeDistanceReviewSql } from '@/lib/runs/distance-guard';
import {
  runDaySql,
  runDistanceMiSql,
  runFinishSecSql,
  runAvgHrSql,
  runElevGainFtSql,
  runSplitsSql,
  runPhasesSql,
  runWorkoutTypeSql,
  runSourceSql,
  runIndoorSql,
  runNotMergedSql,
} from '@/lib/runs/run-shape';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';
import { isProvisionalResult } from '@/lib/coach/races-state';
import type { AuthorityTier } from '@/lib/race/effort-authority';
import { coherentElapsedSec, coherentMovingSec } from '@/lib/runs/coherence';

/** The three names `POST /api/v5/race-authority` accepts and stores. Anything
 *  else in the column is a value this engine did not write; ignore it rather
 *  than coercing it into a grading. */
const RUNNER_AUTHORITY_TIERS: readonly AuthorityTier[] =
  ['representative', 'compromised', 'unrepresentative'];

function runnerAuthorityTier(ar: Record<string, unknown>): AuthorityTier | null {
  // `authority_source` guards against reading a tier some future automatic
  // re-grade wrote: this field is the RUNNER's report, and only the runner's
  // report is allowed to override doctrine's grading of their own race.
  if (ar.authority_source !== 'runner') return null;
  const t = ar.authority_tier;
  return typeof t === 'string' && (RUNNER_AUTHORITY_TIERS as readonly string[]).includes(t)
    ? (t as AuthorityTier)
    : null;
}

// ── Input shapes — match exactly what bestRecentVdot() accepts ──────────────

export interface RaceVdotInput {
  slug: string;
  name: string;
  date: string;
  /**
   * Raw `races.meta->>'priority'`. `string | null`, not the A/B/C union: the
   * SQL no longer filters on it, and `lib/faff/types.ts` allows `training_run`
   * and `hilly_excluded` too. `selectionAuthority` grades every value, so an
   * unrecognised one is priced rather than silently read as an A race.
   */
  priority: string | null;
  distance_mi: number | null;
  finish_seconds: number | null;
  /**
   * 2026-08-18 · doctrine sweep · true when `finish_seconds` is NOT a
   * confirmed result. `races-state.ts` flags the same thing as
   * `finishProvisional`; this loader's copy of the pattern didn't expose an
   * equivalent, so nothing downstream could tell "this candidate's time is
   * an unconfirmed watch/GPS match" apart from a curated chip time.
   *
   * TWO ways a candidate is provisional, and the loader must catch both:
   *   · rung 3 — `finish_seconds` came from the Strava date+distance match
   *     fallback below (no `actual_result.finishS`, no `meta.finishTime`).
   *   · rung 1 carrying an AUTO-LOGGED watch time — `actual_result.finishS`
   *     written by `lib/race/auto-result.ts` with `provisional:true` /
   *     `source:'watch_provisional'`. 2026-08-21 · this arm was missing.
   *
   * Additive to SELECTION only — `bestRecentVdot`'s structural race-candidate
   * type doesn't read this field, so it does NOT change selection weighting;
   * `effort-authority.ts` documents that choice deliberately (a race's
   * authority is graded, not discounted, at selection time). This makes the
   * provenance visible to consumers that must label it (the v5 evidence list)
   * or act on it (`/api/v5/goal-answer` action:'confirm').
   */
  provisional: boolean;
  /**
   * Which rung the provisional flag came from, so a surface can print the
   * right caption instead of guessing. `null` when `provisional` is false.
   * `'watch'` → `WATCH_PROVISIONAL_FINISH_LABEL` ("Watch time · chip time to
   * lock in"); `'run_match'` → `PROVISIONAL_FINISH_LABEL` ("Training effort ·
   * race to lock in"). Both labels live in `lib/coach/races-state.ts` so
   * every surface renders one of exactly two strings verbatim.
   */
  provisionalSource: 'watch' | 'run_match' | null;
  /**
   * 2026-08-21 · race-data re-audit · the runner's OWN answer to "did this
   * race count?", stored by `POST /api/v5/race-authority` as
   * `races.actual_result.authority_tier` (with `authority_source:'runner'`).
   *
   * It was write-only. The route re-anchored the plan once, then the nightly
   * `snapshot-projections` cron re-ran `loadVdotInputs` + `bestRecentVdot`
   * over the same unfiltered pool and the flagged race won selection again —
   * so the runner's report of their own race survived until morning and no
   * longer. `bestRecentVdot` now caps `authority` with it, downward only.
   */
  runner_authority_tier: AuthorityTier | null;
}

export interface RunVdotInput {
  id: string;
  date: string;
  workout_type: string | null;
  distance_mi: number | null;
  finish_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  /** Prescribed training zone (from the plan day this run matched) for the
   *  zone-aware VDOT read. Only set when the work-phase pace is used (so the
   *  zone applies to the zone pace, not a WU+CD-dragged overall pace). */
  zone: 'threshold' | 'marathon' | 'interval' | 'race' | null;
  /**
   * 2026-08-17 · terrain. `finish_seconds` above is GRADE-ADJUSTED when the
   * run carried a material elevation signal — a fitness estimate is a
   * judgement about effort, and effort is what the grade adjustment recovers.
   * These two fields keep the real numbers alongside it so no display path
   * ever mistakes the adjusted time for what the runner actually ran.
   */
  raw_finish_seconds: number | null;
  /** Seconds the terrain adjustment moved this candidate. 0 on flat runs. */
  terrain_delta_seconds: number;
}

export interface VdotInputs {
  raceCandidates: RaceVdotInput[];
  runCandidates: RunVdotInput[];
  /**
   * FLOOR-1 (2026-08-19) · the goal-relative honest-effort floor this load was
   * gated at (`vdotRunFloorMi`: 3.0 for a 5K goal, 4.0 otherwise).
   *
   * Returned so a caller threads the SAME floor into `bestRecentVdot` that the
   * loader used on the work-block gate, without a second `profile` read and
   * without the chance of using a different one. `app/api/coach/read` used to
   * omit the argument entirely and take the 4.0 default while the cron, the
   * drift monitor, the generator and the targets route all passed the
   * goal-relative value — the exact mismatch this file's own comment warns
   * about ("the cron compute a 5K runner's VDOT while drift sees none → false
   * drift"), in the direction warned about.
   */
  runFloorMi: number;
}

/**
 * 2026-08-30 · THE ROW'S OWN MILE SPLITS ARE A SECOND CLOCK, AND THEY VOTE.
 *
 * `runFinishSecSql` prefers `movingTimeS`, and `survivingMovingSecSql` refuses
 * it only when it implies MORE THAN HALF the run was paused (`MAX_PAUSED_SHARE
 * = 0.5`). That catches the 2026-08-23 absorber row at 54.9% and nothing else.
 * A moving time that is wrong by 10% sails through, and a fitness anchor is
 * exactly the consumer that cannot afford it: a 10% pace error is ~5 VDOT.
 *
 * ── The row that made this necessary ──────────────────────────────────────
 *
 * 2026-08-11, the owner's 4×1km interval session. 5.97 mi.
 *
 *     durationSec  2784     ← 7:46/mi
 *     movingTimeS  2479     ← 6:55/mi   ← what the VDOT path spent
 *     splits[]     8:01, 7:05, 7:34, 7:42, 7:59, 7:23  → 2727 s over 5.96 mi
 *
 * The six mile splits sum to 2727 s. That is 248 s MORE than `movingTimeS`
 * (10.0%) and 57 s LESS than `durationSec` (2.0%). Per-mile splits are a
 * record of running, so they cannot hide five minutes of standing still: if
 * the 305 s gap were genuine pauses the splits would agree with the moving
 * time, and they do not. They agree with the wall clock. No single mile was
 * faster than 7:05, so a 6:55 whole-session average — across a warm-up at avg
 * HR 135, four reps and three jog recoveries — is not a pace the runner ran.
 *
 * Read at 6:55/mi and typed `threshold`, that row derives **VDOT 49.8** — the
 * single highest read in the runner's entire 60-day pool, four points clear of
 * anything else, and eight clear of the median. It sat harmlessly behind the
 * superseded-lead veto until that veto was retired; the moment selection
 * started taking the highest derived VDOT the way doctrine says to, this row
 * became the anchor and would have prescribed T-pace 6:55 off a broken clock.
 * Fixing the selection rule without fixing this would have replaced paces that
 * were too slow with paces the runner cannot hold, which is the worse error.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Pure arithmetic on numbers the same row carries — a ratio between two of its
 * own clocks. No claim about human speed, no physiology, so no doctrine
 * registry entry, for the reason `lib/runs/coherence.ts` states for its own
 * guards: "the guard is equally correct for an elite and for a walker, and it
 * cannot go stale when the research does."
 *
 * Only fires when the splits can actually answer. Partial splits are a
 * "don't know", not a verdict (Rule 11) — hence the coverage gate. When the
 * splits DO disprove the stored clock, the candidate is refused rather than
 * repaired: the honest finish time for that run is unknown, and substituting
 * `durationSec` would be a guess wearing a measurement's clothes. A run that
 * cannot say how long it took is not evidence of fitness.
 *
 * WHAT THIS CANNOT CATCH (Rule 22): a row with no splits, a row whose splits
 * are wrong in the same direction as its clock, and any error under the
 * tolerance. It is a cross-check between two sources, not a truth oracle.
 *
 * ── WHERE THE TOLERANCE COMES FROM ────────────────────────────────────────
 *
 * Not fitted to the data. A 5% pace error is roughly 2.5 VDOT, which is
 * already more than twice the largest move doctrine ever lets TRAINING
 * evidence make off a hard proof — the +1 soft-estimate quantum
 * (`Research/01` §"Triggers to retest"). Past that point the two clocks
 * disagree by more than the whole adjustment the reading could justify, so
 * the reading cannot be spent whichever clock is right.
 *
 * MEASURED against that line, 2026-08-30, over every canonical row in the
 * owner's history that carries per-mile splits (22 clear the coverage gate):
 *
 *     9.2%   2026-08-11   the 4×1km session · REFUSED
 *     6.9%   2026-08-27   3.14 mi treadmill · REFUSED (and it already failed
 *                         the honesty gate, so nothing is lost)
 *     3.6%   2026-08-30   the LT-block long run · admitted
 *     3.0%   2026-05-24   admitted
 *     ≤2.7%  the other 18 rows · admitted
 *
 * The margin either side of the line is real but not luxurious: 1.4 points
 * below and 1.9 above. Re-measure before moving it, and say what moved.
 */
const SPLIT_CLOCK_TOLERANCE = 0.05;
/**
 * Splits must cover between this much and `SPLIT_CLOCK_MAX_COVERAGE` of the run
 * before they may overrule its clock.
 *
 * The upper bound is not symmetry for its own sake. Two rows dated 2026-05-24
 * carry splits summing to MORE than the run: 12.0 miles of splits on a 1.00
 * mile row (coverage 12.0) and 12.0 on an 11.12 mile row (1.079). The first is
 * plainly corrupt, and a corrupt arbiter is worse than no arbiter — it would
 * refuse sound rows with the same confidence it refuses broken ones. Splits
 * that cannot describe this run do not get a vote on it (Rule 11: that is a
 * "don't know", not a verdict).
 */
const SPLIT_CLOCK_MIN_COVERAGE = 0.9;
const SPLIT_CLOCK_MAX_COVERAGE = 1.25;

/**
 * Seconds the row's own per-mile splits say the run took, scaled to its full
 * distance — or null when the splits cannot answer (absent, unparseable, or
 * covering too little of the run to arbitrate).
 */
export function splitImpliedSeconds(splits: unknown, distanceMi: number | null): number | null {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  if (distanceMi == null || !(distanceMi > 0)) return null;
  let sec = 0;
  let miles = 0;
  for (const s of splits) {
    if (!s || typeof s !== 'object') continue;
    const row = s as Record<string, unknown>;
    const paceRaw = row.paceSecPerMi;
    const pace = typeof paceRaw === 'number' ? paceRaw : Number(paceRaw);
    if (!Number.isFinite(pace) || pace <= 0) continue;
    // A split is one mile unless it says otherwise (the last one usually does).
    const dRaw = row.distanceMi;
    const d = dRaw == null ? 1 : Number(dRaw);
    if (!Number.isFinite(d) || d <= 0) continue;
    sec += pace * d;
    miles += d;
  }
  if (miles <= 0) return null;
  const coverage = miles / distanceMi;
  if (coverage < SPLIT_CLOCK_MIN_COVERAGE || coverage > SPLIT_CLOCK_MAX_COVERAGE) return null;
  return (sec / miles) * distanceMi;
}

/**
 * True when the row's per-mile splits disprove the clock the VDOT path is
 * about to spend. See `SPLIT_CLOCK_TOLERANCE` above for the measurement.
 */
export function clockDisprovedBySplits(
  finishSec: number | null, splits: unknown, distanceMi: number | null,
): boolean {
  if (finishSec == null || !(finishSec > 0)) return false;
  const implied = splitImpliedSeconds(splits, distanceMi);
  if (implied == null || !(implied > 0)) return false;
  return Math.abs(finishSec - implied) / implied > SPLIT_CLOCK_TOLERANCE;
}

// Strava's numeric workoutType enum → string taxonomy bestRecentVdot expects.
// 1 = race effort, 3 = workout (tempo/quality). 0/2/null → non-quality;
// the HR gate inside vdotFromRun decides those.
// Cite: docs/OVERNIGHT-REPORT.md §B2 C1-1b.
const STRAVA_WORKOUT_TYPE: Record<string, string> = { '1': 'race', '3': 'tempo' };

// 2026-07-07 · ultra-honesty audit · delegate to the shared parser (was a
// local 4-branch fork that already returned null on unmatched — no 13.1
// fallthrough bug here — but silently didn't recognize 50K/50M/100K/100M
// labels at all, so an ultra race candidate's distance never resolved for
// bestRecentVdot's raceCandidates. vdotFromRace's own DANIELS_MAX_VALID_
// DISTANCE_MI gate still refuses to derive a VDOT from a resolved ultra
// distance — this just lets the candidate resolve its real distance
// instead of silently dropping out at the label-parse step.
function distFromLabel(label: string | null | undefined): number | null {
  return distanceMiFromLabel(label);
}

/**
 * Load race + run candidates for bestRecentVdot from one canonical query path.
 *
 * @param userId     - the runner's UUID
 * @param today      - ISO date (caller must pass their runnerToday() result)
 * @param windowDays - full-value race lookback in days (default
 *                     VDOT_FULL_VALUE_DAYS = 56, Research/01 §"Freshness
 *                     window"; must match the lookbackDays the caller passes to
 *                     bestRecentVdot). Race rows are FETCHED over
 *                     windowDays + FADE_TAIL_DAYS — bestRecentVdot owns
 *                     staleness (full value through windowDays, then the F1
 *                     fade); this loader's job is only to deliver every
 *                     candidate the fade can still see. Run candidates
 *                     always use a fixed 60-day window because training-derived
 *                     VDOT estimates go stale faster than race anchors.
 *
 * Throws on DB error — callers must NOT silently catch this into a numeric
 * default (that's the C1 bug class: swallow → undefined → goal-pace plan).
 */
export async function loadVdotInputs(
  userId: string,
  today: string,
  windowDays = VDOT_FULL_VALUE_DAYS,
  /** FLOOR-1 · the goal-relative honest-effort floor. Resolved from the
   *  runner's own goal when omitted, which is what every caller wants and what
   *  none of them can forget once it is resolved here. */
  runFloorMiArg?: number,
): Promise<VdotInputs> {
  const runFloorMi = runFloorMiArg ?? await goalRunFloorMiForUser(userId);

  // ── Race candidates ──────────────────────────────────────────────────────

  // Compute cutoff in TS to keep the SQL parameters simple.
  //
  // 2026-08-17 · F1 regression fix: cutoff = windowDays + FADE_TAIL_DAYS, not
  // windowDays. The stale-anchor fade (bestRecentVdot, race-killer F1) keeps
  // an aging anchor at full value through windowDays and then fades it 0.1
  // VDOT / 14 days for FADE_TAIL_DAYS more — so it needs candidates up to
  // windowDays + FADE_TAIL_DAYS old. This loader's hard windowDays cutoff
  // starved it: fade-window candidates never left the DB, the fade never
  // fired in prod, and the exact cliff F1 was built to prevent happened on
  // schedule (Disney HM exited the SQL window overnight on Aug 1 → 47.9 →
  // 44.1, 15 days before the A-race). The fade's unit tests passed the whole
  // time because they fed candidates in-memory. Staleness judgment lives in
  // bestRecentVdot — including fresh-race precedence over faded anchors
  // (FRESH_RACE_PRECEDENCE_DAYS) — never in this fetch window.
  const raceCutoff = new Date(Date.parse(today + 'T12:00:00Z') - (windowDays + FADE_TAIL_DAYS) * 86400000)
    .toISOString().slice(0, 10);

  // Pull EVERY race within the lookback window.
  //
  // 2026-08-17 · the `AND meta->>'priority' IN ('A','B')` that stood here is
  // gone. It read as data hygiene and was load-bearing safety: it was the only
  // thing standing between the candidate pool and a jogged C race, because
  // selection is max-wins and `assessRaceRepresentativeness` was never on this
  // path. Opening it on its own would have let a C race set every prescribed
  // pace and let it supersede every legitimate training lead behind it.
  //
  // Both are closed first, in `bestRecentVdot`: a race's authority
  // (`lib/race/effort-authority.ts`) now bands it in the ranking, bounds the
  // training soft-cap ceiling, and gates the superseded-lead rule. So every
  // race can count, at the weight `Research/00b`'s effort table gives it,
  // instead of an A/B race counting fully and a C race not at all.
  //
  // No .catch() — throws on error so the caller refuses to generate rather
  // than producing a goal-pace plan (the C1 bug class).
  const raceRows = await pool.query<{
    slug: string;
    meta: Record<string, unknown> | null;
    actual_result: Record<string, unknown> | null;
  }>(
    `SELECT slug, meta, actual_result
       FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date >= $2::date
        AND (meta->>'date')::date <  $3::date`,
    [userId, raceCutoff, today],
  ).then(r => r.rows);

  // Strava match-fallback: for races where neither actual_result.finishS nor
  // meta.finishTime is populated, match by date+distance against the runs table.
  // Only fetch when we have at least one race row (avoids an unnecessary query
  // for cold-start runners with no race history).
  const earliestDate = raceRows.length
    ? raceRows.reduce<string>((min, r) => {
        const d = (r.meta?.date as string) ?? '';
        return !min || (d && d < min) ? d : min;
      }, '')
    : '';
  const matchRuns = earliestDate
    ? await pool.query<{ data: Record<string, unknown> }>(
        `SELECT data
           FROM runs
          WHERE user_uuid = $1
            AND ${runNotMergedSql()}
            AND ${runDistanceMiSql()} > 2.5
            AND ${runDaySql()} >= $2
            AND ${runDaySql()} <= $3`,
        [userId, earliestDate, today],
      ).then(r => r.rows)
    : [];

  const raceCandidates: RaceVdotInput[] = raceRows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const distMi = m.distanceMi
      ? Number(m.distanceMi)
      : distFromLabel(m.distanceLabel as string);

    // Source-of-truth ladder (CLAUDE.md §Race-data, locked 2026-05-19):
    //   1. actual_result.finishS  — curated chip time (canonical)
    //   2. meta.finishTime        — legacy stored time
    //   3. Strava date+dist match — provisional fallback
    let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec) finishSec = parseRaceTime(m.finishTime as string);
    // 2026-08-18 · doctrine sweep · track whether finishSec ends up coming
    // from rung 3 (the Strava match below) rather than rungs 1-2 (curated).
    //
    // 2026-08-21 · race-data re-audit · rung 1 is NOT unconditionally curated.
    // `lib/race/auto-result.ts` writes an auto-logged WATCH time straight into
    // `actual_result.finishS` with `source:'watch_provisional', provisional:
    // true` — it is the result until a chip time replaces it, but it is not a
    // confirmed one. `lib/coach/races-state.ts` has always read that flag
    // (`ar.provisional === true || ar.source === 'watch_provisional'`); this
    // loader did not, so the same `/api/v5/races` response labelled the same
    // race "Counts fully" with `modelled:false` in the EVIDENCE list while the
    // SCHEDULE list carried the amber `~` and "Watch time · chip time to lock
    // in". Worse, `/api/v5/goal-answer` action:'confirm' gates on this exact
    // field, so the chip-lock card the app itself raised answered 400
    // not_provisional. Same two-lists-disagree shape, one rung higher.
    let provisional = ar.finishS != null && Number(ar.finishS) > 0 && isProvisionalResult(ar);
    let provisionalSource: RaceVdotInput['provisionalSource'] = provisional ? 'watch' : null;
    if (!finishSec && distMi && m.date) {
      let best: Record<string, unknown> | null = null;
      let bestScore = Infinity;
      for (const c of matchRuns) {
        const d = c.data;
        const day = (d.date as string) || String(d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs(
          (Date.parse(day + 'T12:00:00Z') - Date.parse((m.date as string) + 'T12:00:00Z')) / 86400000,
        );
        if (dayDelta > 1) continue;
        const miDelta = Math.abs(Number(d.distanceMi) - distMi);
        if (miDelta > 2.0) continue;
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) {
        // 2026-08-24 · reconciled. This is a race finish standing in for a
        // missing curated result, so it wants the wall clock (Research/15:
        // the chip time over the certified course is canonical, and elapsed
        // is the closest a watch holds to it). The old ladder read
        // `movingTimeS` first and never reached `durationSec` at all, so on a
        // watch row it took the moving time — and on a row whose moving time
        // its own clock disproves, it took the disproved one.
        finishSec = coherentElapsedSec(best) ?? coherentMovingSec(best);
        provisional = finishSec != null;
        provisionalSource = finishSec != null ? 'run_match' : null;
      }
    }

    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      date: (m.date as string) ?? '',
      priority: (m.priority as string) ?? null,
      distance_mi: distMi,
      finish_seconds: finishSec,
      provisional,
      provisionalSource,
      runner_authority_tier: runnerAuthorityTier(ar),
    };
  });

  // ── Run candidates ───────────────────────────────────────────────────────

  // Fixed 60-day window: race results above are valid anchors for the full
  // windowDays; training-derived VDOT from quality runs goes stale faster.
  const runCutoff = new Date(Date.parse(today + 'T12:00:00Z') - 60 * 86400000)
    .toISOString().slice(0, 10);

  // 2026-07-06 · audit P1-52 · bucket ci.ts (UTC sync instant) into the
  // RUNNER'S calendar day before joining to the run's local date. Was
  // hardcoded 'America/Los_Angeles' — wrong-day joins dropped the
  // work-phase effort (the honest "virtual race") for any non-Pacific
  // runner. LA fallback for null-tz profiles keeps pre-fix behavior.
  const ciTz = await runnerTimezoneOrPacific(userId);

  const runRows = await pool.query<{
    id: string;
    date: string;
    workout_type: string | null;
    distance_mi: string | null;
    finish_seconds: string | null;
    avg_hr: string | null;
    work_mi: string | null;
    work_seconds: string | null;
    plan_type: string | null;
    src: string | null;
    indoor: boolean | null;
    elev_gain_ft: string | null;
    splits: unknown;
    phases: unknown;
  }>(
    `-- 2026-08-21 perf · WORK-PHASE aggregation, once.
     -- This was two correlated subqueries per run row, each carrying its own
     -- correlated MAX(ci2.id) - so coach_intents was scanned FOUR times for
     -- every candidate run, and the runner's own timezone makes
     -- (ts AT TIME ZONE $4)::date non-indexable, so every one of those was a
     -- full scan. Cost was O(runs x coach_intents): measured on a clone of
     -- prod, 148 ms at today's 263 intents and 13,958 ms at 10,195, with 3.1
     -- MILLION buffer hits. An index does NOT save it - every row belongs to
     -- the same runner with the same reason, so the index scan still walks
     -- them all (measured: 14,204 -> 14,307 ms).
     --
     -- Same answer, computed once per date instead of once per run row.
     -- Byte-identical result sets verified at both 263 and 10,195 intents:
     -- 148 -> 72 ms today, 13,958 -> 55 ms at 10,195.
     --
     -- MATERIALIZED is load bearing. Inlined, the planner re-runs the
     -- aggregate once per run row and the win drops to nothing (490 ms).
     WITH wc AS MATERIALIZED (
       SELECT DISTINCT ON ((ci.ts AT TIME ZONE $4::text)::date)
              (ci.ts AT TIME ZONE $4::text)::date AS d, ci.value
         FROM coach_intents ci
        WHERE COALESCE(ci.user_uuid, ci.user_id) = $1
          AND ci.reason = 'watch_completion'
          -- $2/$3 are TEXT day-keys, compared as text in the outer WHERE.
          -- Cast through ::text first: a bare $2::date makes Postgres infer
          -- the PARAMETER as date, and the outer comparison then fails with
          -- "operator does not exist: text >= date" - which this call site
          -- swallows, returning an empty evidence list instead of an error.
          AND (ci.ts AT TIME ZONE $4::text)::date >= $2::text::date
          -- 2026-08-30 · INCLUSIVE, matching the run window below. These two
          -- bounds have to agree: this CTE supplies the WORK-PHASE effort, so
          -- an exclusive one here would admit today's run and read its whole-run
          -- average — warm-up and cool-down included — instead of the tempo
          -- block inside it. That is the ~3-point understatement the
          -- zone-aware read exists to prevent, applied to the freshest
          -- evidence the runner has.
          AND (ci.ts AT TIME ZONE $4::text)::date <= $3::text::date
        ORDER BY (ci.ts AT TIME ZONE $4::text)::date, ci.id DESC
     ), wc_work AS MATERIALIZED (
       SELECT wc.d,
              SUM(COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric) AS work_mi,
              SUM(COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric
                  * (phase->>'actualPaceSPerMi')::numeric) AS work_seconds
         FROM wc,
              jsonb_array_elements(
                CASE jsonb_typeof(wc.value::jsonb)
                  WHEN 'object' THEN wc.value::jsonb->'phases'
                  ELSE '[]'::jsonb END) AS phase
        WHERE phase->>'type' = 'work'
          AND (phase->>'actualPaceSPerMi')::numeric > 0
          AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi') IS NOT NULL
          AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric > 0
        GROUP BY wc.d
     )
     SELECT sa.id::text AS id,
            ${runDaySql('sa')} AS date,
            ${runWorkoutTypeSql('sa')} AS workout_type,
            ${runDistanceMiSql('sa')} AS distance_mi,
            -- 2026-08-17 · terrain inputs for the grade adjustment. A hilly
            -- training run under-reads as fitness and a net-downhill one
            -- over-reads; both feed the same VDOT estimate. See
            -- lib/terrain/run-terrain.ts for why splits are preferred over
            -- the rolled-up gain (they are the only source of LOSS) and why
            -- a treadmill row's elevGainFt is deliberately not read here.
            ${runSourceSql('sa')} AS src,
            ${runIndoorSql('sa')} AS indoor,
            ${runElevGainFtSql('sa')} AS elev_gain_ft,
            ${runSplitsSql('sa')} AS splits,
            ${runPhasesSql('sa')} AS phases,
            ${runFinishSecSql('sa')} AS finish_seconds,
            ${runAvgHrSql('sa')} AS avg_hr,
            -- 2026-06-09 Phase 2 / regression-audit F10 · WORK-PHASE
            -- effort from the watch completion. A tempo's whole-run pace
            -- (WU + blocks + CD) reads ~VDOT 40 for a 47.9 runner — the
            -- run-VDOT path could never beat a fading race anchor and the
            -- Jul-31 anchor cliff stood. The work block IS the honest
            -- "virtual race": 4mi @ T. Distances are the phase-anchored
            -- prescription values (reps are distance-anchored on the
            -- wire); seconds = Σ(dist × actual pace). Latest completion
            -- per date wins (re-syncs override).
            ww.work_mi AS work_mi,
            ww.work_seconds AS work_seconds,
            -- 2026-06-11 · the prescribed zone for this run's date (if it
            -- matched a plan quality day). Drives the zone-aware VDOT read so a
            -- threshold/marathon-pace effort reads by zone, not as a race.
            (SELECT pw.type
               FROM plan_workouts pw
               JOIN training_plans tp ON tp.id = pw.plan_id
              WHERE tp.user_uuid = sa.user_uuid
                AND tp.archived_iso IS NULL
                AND pw.date_iso = ${runDaySql('sa')}
                AND pw.type IN ('tempo','threshold','intervals','marathon_pace','race','race_week_tuneup')
              ORDER BY pw.type
              LIMIT 1) AS plan_type
       FROM runs sa
       LEFT JOIN wc_work ww ON ww.d = ${runDaySql('sa')}::date
      WHERE sa.user_uuid = $1
        AND ${runNotMergedSql('sa')}
        AND ${runDaySql('sa')} >= $2
        -- 2026-08-30 · TODAY'S RUN COUNTS. This bound was exclusive, which made
        -- the runner's freshest evidence — the session they finished an hour ago —
        -- invisible to every pace the app prescribed until the calendar
        -- rolled. On the day this was found, the owner's 13.5-mile long run
        -- was already ingested, already had its splits, and could not reach
        -- the fitness read; the plan he was looking at was priced off runs up
        -- to 55 days older.
        --
        -- NOTE (no backticks in here: this is inside a JS template literal).
        -- The inclusive bound is safe here in a way it is not for the RACE
        -- window above: a race dated today has not been run yet (races are
        -- scheduled, and the exclusive bound is what stops a future A-race
        -- anchoring a plan), whereas a runs row only exists once the run is
        -- over. There is no such thing as a future run in this table.
        AND ${runDaySql('sa')} <= $3
        -- 2026-06-15 · floor lowered 4 → 3mi so a 5K-goal runner's ~3.1mi
        -- quality efforts leave the DB at all. The GOAL-RELATIVE gate
        -- (vdotRunFloorMi: 3.0 for 5K, 4.0 for longer) is applied downstream
        -- in vdotFromRun/bestRecentVdot — this WHERE is just the cheap row
        -- prefilter, set to the lowest floor any goal can ask for (5K = 3.0).
        AND ${runDistanceMiSql('sa')} >= 3
        -- 2026-07-06 · P1-26 · skip distance-quarantined rows. Runs over the
        -- 50 mi soft bound now ingest with data.qualityFlag='distance_review'
        -- instead of being 400'd + dead-lettered; they count toward volume
        -- (real ultra miles) but must NOT anchor fitness until reviewed — a
        -- forgot-to-End treadmill phantom here would fabricate a VDOT.
        -- See lib/runs/distance-guard.ts.
        AND ${excludeDistanceReviewSql('sa')}
        -- 2026-06-09 state-audit fix: was movingTimeS-only, a Strava field
        -- watch rows don't carry (they carry durationSec; their timeMoving
        -- is a display string, never castable) — which structurally
        -- excluded every watch-source run from VDOT candidacy. The
        -- HR-quality gate inside vdotFromRun was built for exactly those
        -- runs and never received one.
        AND ${runFinishSecSql('sa')} > 60
        -- C1-1e: exclude race-day runs. The curated races row is canonical for
        -- race-day performance; a GPS-over-measured Strava activity on the same
        -- day produces phantom-high VDOT (e.g. Disney 13.38mi vs curated
        -- 13.109mi at the same finish time → VDOT 49.2 vs correct 47.9).
        AND NOT EXISTS (
          SELECT 1 FROM races rr
           WHERE rr.user_uuid = $1
             AND ABS(
               (rr.meta->>'date')::date
               - ${runDaySql('sa')}::date
             ) <= 1
        )`,
    [userId, runCutoff, today, ciTz],
  ).then(r => r.rows);
  // No .catch() — throws on error.

  // Max HR for the HR-quality gate inside vdotFromRun (≥ 80% MaxHR).
  const effMaxHr = await loadEffectiveMaxHr(userId, today);
  const maxHrValue = effMaxHr.bpm;

  const runCandidates: RunVdotInput[] = runRows.map((r) => {
    // F10 · prefer the work-phase effort when the watch captured one big enough
    // to read. The whole-run numbers remain the fallback for Strava/HK-only
    // runs.
    //
    // FLOOR-1 (2026-08-19) · that floor is `runFloorMi`, not a hardcoded 4.
    // The 2026-06-15 fix (`vdotRunFloorMi`) threaded a goal-relative floor of
    // 3.0 mi for a 5K-goal runner and lowered the SQL prefilter above to
    // `>= 3` for it; this line then re-imposed 4 one level up and undid it for
    // exactly the cohort it was written for. A 5K runner's 3.2 mi work block
    // failed the gate, so `distMi`/`rawSec` fell back to the WHOLE run —
    // warm-up and cool-down included — and, worse, `zone` below went null with
    // them, which makes `vdotFromRun` read a warm-up-dragged average pace
    // through `vdotFromRace` as an all-out race. That is the ~3-point
    // understatement the zone-aware read exists to prevent, applied to the one
    // runner the floor fix was for.
    const workMi = r.work_mi != null ? Number(r.work_mi) : null;
    const workSec = r.work_seconds != null ? Math.round(Number(r.work_seconds)) : null;
    const useWork = workMi != null && workSec != null && workMi >= runFloorMi && workSec > 60;
    const distMi = useWork ? workMi : (r.distance_mi != null ? Number(r.distance_mi) : null);
    const wholeRunSec = r.finish_seconds != null ? Number(r.finish_seconds) : null;

    // 2026-08-30 · the row's own mile splits arbitrate its clock. See
    // `clockDisprovedBySplits` for the 2026-08-11 row this exists for.
    //
    // Scoped to the WHOLE-RUN path deliberately. When `useWork` is true the
    // seconds come from the watch's phase actuals in `coach_intents`, a
    // different source with its own per-phase distances and paces — the mile
    // splits do not describe that segment and cannot arbitrate it.
    //
    // Refusal, not repair: `rawSec` goes null and the candidate drops out of
    // the pool at the `finish_seconds > 60` gate downstream. `durationSec` is
    // NOT substituted — this run's honest finish time is unknown, and the whole
    // point is not to spend a number the row itself cannot support.
    const rawSec = useWork
      ? workSec
      : (clockDisprovedBySplits(wholeRunSec, r.splits, distMi) ? null : wholeRunSec);

    // ── Terrain ────────────────────────────────────────────────────────────
    // 2026-08-17 · a VDOT candidate is an effort estimate, so it is judged on
    // grade-adjusted pace. Doctrine: Research/11 §Mechanical Effects of Uphill
    // Running (3.3% per 1% grade) and Research/01 §Hills (descents refund only
    // 60-70%). The elevation is a property of the WHOLE run, so the factor is
    // computed once from the whole run and then applied to whichever segment
    // the candidate uses.
    //
    // Applying a whole-run factor to a work block assumes the climbing was
    // spread evenly through the session. That assumption is not free, and it is
    // stated rather than hidden: there is no per-phase elevation on the wire to
    // do better with. It is bounded by the materiality floor below — a run flat
    // enough for the assumption to be doubtful is also a run whose adjustment
    // is under 4 s/mi and therefore skipped entirely. In David's history every
    // run with a work block sits at 5-30 ft/mi, well inside that floor.
    const terrain = resolveRunTerrain({
      source: r.src,
      indoor: r.indoor,
      distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      durationSec: r.finish_seconds != null ? Number(r.finish_seconds) : null,
      elevGainFt: r.elev_gain_ft != null ? Number(r.elev_gain_ft) : null,
      splits: r.splits,
      phases: r.phases,
    });
    // Only act when the terrain moved the judgement by more than pace noise,
    // and never on a treadmill whose incline nobody recorded — an unknown
    // belt angle is not evidence of a flat one.
    const applyTerrain =
      terrain.material &&
      terrain.basis !== 'treadmill-incline-unknown' &&
      terrain.factor > 0 &&
      rawSec != null;
    const finishSec = applyTerrain ? rawSec! / terrain.factor : rawSec;

    return {
      id: String(r.id),
      date: r.date,
      // C1-1b: Strava's numeric workoutType → string taxonomy.
      // 0/2/null pass through to the HR gate.
      workout_type: r.workout_type != null
        ? (STRAVA_WORKOUT_TYPE[r.workout_type] ?? r.workout_type)
        : null,
      distance_mi: distMi,
      finish_seconds: finishSec != null ? Math.round(finishSec) : null,
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      max_hr: maxHrValue,
      // Zone-read ONLY the work-phase pace · applying a zone inversion to a
      // WU+CD-dragged overall pace would badly understate. Without work-phase
      // data the run keeps the conservative race interpretation (zone null).
      zone: useWork ? zoneFromType(r.plan_type) : null,
      raw_finish_seconds: rawSec != null ? Math.round(rawSec) : null,
      terrain_delta_seconds:
        applyTerrain && finishSec != null && rawSec != null ? Math.round(finishSec - rawSec) : 0,
    };
  });

  return { raceCandidates, runCandidates, runFloorMi };
}

/**
 * Resolve the runner's goal-relative training-VDOT floor (vdotRunFloorMi) from
 * their stored goal — race goal preferred, else time-trial goal (goal-mode
 * runners have no race). A 5K-goal runner gets 3.0mi so their ~3.1mi quality
 * efforts qualify as fitness candidates; every longer/unknown goal keeps the
 * 4mi default. Pass the result as bestRecentVdot's minRunDistanceMi so the
 * projection cron, drift monitor, and plan generator all gate identically (a
 * mismatch would have the cron compute a 5K runner's VDOT while drift sees
 * none → false drift). Best-effort — returns 4 on any read failure.
 *
 * Cite: Research/01-pace-zones-vdot.md §field-test (a solo 5K IS a VDOT input).
 */
export async function goalRunFloorMiForUser(userId: string): Promise<number> {
  const row = (await pool.query<{ grd: string | null; ttd: string | null }>(
    `SELECT goal_race_distance AS grd, tt_goal_distance AS ttd
       FROM profile WHERE user_uuid = $1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ grd: string | null; ttd: string | null }> }))).rows[0];
  const code = (row?.grd && row.grd !== 'none') ? row.grd : row?.ttd;
  return vdotRunFloorMi(goalDistanceMiFromCode(code));
}
