/**
 * lib/coach/voice-band.ts · adaptive coach voice scoring.
 *
 * Computes the coach voice band for a runner from objective signals.
 * Drives copy across surfaces:
 *   · Morning brief headline (ReadinessBrief.headline)
 *   · Pre-run cue on the workout poster
 *   · Post-run recap framing
 *
 * Three bands · per `designs/briefs/onboarding-master.md` decision #2:
 *   · calibration · "Let's figure this out together. I'll adjust as
 *                    I learn." · soft, hedged paces, ±15s bands.
 *   · guided      · "Here's the plan. Tell me if a pace feels wrong."
 *                    · concrete prescriptions with a soft override.
 *   · challenge   · "Hit the prescription. The plan is honest."
 *                    · direct, no hedging.
 *
 * Triggers (combined · the FIRST matching band wins; explicit override
 * checks fire last):
 *   · 0 race history OR vdotConfidence < 0.4 OR active calibration  → calibration
 *   · 1 recent race OR vdotConfidence 0.4-0.7                       → guided
 *   · 2+ recent races AND vdotConfidence > 0.7                       → challenge
 *
 * Soft adjustments:
 *   · Goal-time >10% off projected for 14+ days     → step DOWN one band
 *   · Subjective check-in disagrees with objective 5+ days  → soft-cap at guided
 *   · Active niggle / injury / sick episode         → soft-cap at guided
 *
 * Hard overrides:
 *   · `calibration_sessions` row with completed_at set + confidence ≥ 0.45
 *     → can step calibration → guided immediately
 *
 * The result is cacheable for ~6h · race results land at most once a
 * day, calibration runs are a one-time event. Recompute on:
 *   · New race result written to `races`
 *   · `calibration_completed` coach intent
 *   · Goal change / race change (which would already replan)
 */

import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { runnerToday, runnerTimezone } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import type { CoachState } from '@/lib/topics/types';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { parseRaceTime } from '@/lib/training/vdot';

/* ────────────────────────── Public types ────────────────────────── */

export type VoiceBand = 'calibration' | 'guided' | 'challenge';

export interface VoiceBandReason {
  band: VoiceBand;
  /** 0-1 · self-reported confidence in this band. Drives the
   *  `confidenceLabel` rendered on debug/voice-band endpoints. */
  confidence: number;
  /** Plain-English reasons the band landed where it did. Surfaced in
   *  the iPhone debug overlay + the Settings voice-tuning screen. */
  reasons: string[];
  /** Mechanical signals · for the engine + tests, not user-facing. */
  signals: {
    raceCount: number;
    daysSinceMostRecentRace: number | null;
    vdotConfidence: number;            // 0-1 derived from candidate spread
    hasCalibrationCompleted: boolean;
    activeNiggleOrSick: boolean;
    /** `null` when the read FAILED — not zero. Zero is a measurement. */
    subjectiveObjectiveMismatchDays: number | null;
    goalOffProjectedFor14d: boolean;
  };
}

/* ────────────────────────── Doctrine constants ────────────────────────── */

const RACE_RECENT_DAYS = 365;
const VDOT_CONF_CAL_FLOOR = 0.4;
const VDOT_CONF_CHALLENGE_FLOOR = 0.7;
const CALIBRATION_PROMOTION_CONF = 0.45;
const SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP = 5;
const GOAL_OFF_PCT = 0.10;
const GOAL_OFF_DAYS = 14;

/* ────────────────────────── Composer ────────────────────────── */

/**
 * Compute the voice band for a runner.
 *
 * Best-effort · every read catches and returns a safe default so the
 * morning brief never blocks on this signal. A cold-start runner with
 * no data lands in `calibration` with high confidence in the band
 * itself (we KNOW we don't know them).
 */
export async function computeVoiceBand(
  userUuid: string,
  state: CoachState,
): Promise<VoiceBandReason> {
  // 1. Race history · count + recency · TWO sources:
  //    (a) `races` table · the app's own race lifecycle (upcoming +
  //        completed finish times the runner logged through the app)
  //    (b) `profile.race_history` JSONB · self-reported PRs captured
  //        at onboarding (B4 · TASK B4 from onboarding-master)
  // Union the two and dedupe by (distance, timeSec ±30s) so a runner
  // who reports a 5K PR at onboarding AND later logs the same race
  // through the app's race lifecycle isn't double-counted.
  // 2026-06-03 · runner TZ anchors the recency cutoff.
  const today = await runnerToday(userUuid);
  // 2026-08-21 · backend audit · THIS QUERY NAMED COLUMNS THE TABLE DOES NOT HAVE.
  //
  // It selected `date_iso`, `distance_mi` and `finish_seconds` from `races`.
  // `races` is the jsonb-shaped table — slug, meta, actual_result, plan,
  // course_geometry — and has never had any of the three. Postgres answered
  // 42703 `column "date_iso" does not exist`, the `.catch` below turned that
  // into `rows: []`, and the band read the empty array as "this runner has
  // never raced".
  //
  // Nothing surfaced it because the failure is indistinguishable from the
  // cold-start case the function is explicitly designed to handle: a runner
  // with no races SHOULD land in `calibration`, and that is what a schema
  // error produced too. The reason string even said so — "no recent race
  // history" — which is the loudest form of this bug class, an outage wearing
  // the clothes of a finding about the runner.
  //
  // Live cost, measured against production (faff_readonly, 2026-08-21):
  // the one runner with data has ELEVEN races on file, SIX of them inside the
  // window with a real `actual_result.finishS` — two marathons and four halves,
  // including the 2026-08-16 half at 6113 s. His `profile.race_history` is `[]`,
  // so with the table read failing there was no second source: raceCount 0,
  // vdotConfidence 0, band `calibration`. A competitive marathoner was being
  // coached in the register reserved for a runner the app has never met.
  //
  // Rewritten against the real shape, using the source-of-truth ladder from
  // CLAUDE.md §Race-data: `actual_result.finishS` (curated chip time) first,
  // `meta.finishTime` (legacy display string) second. Distance comes from
  // `meta.distanceMi`, falling back to the label through the same
  // `distanceMiFromLabel` every other race reader uses — no third copy of the
  // rules. Rows that resolve to neither a time nor a distance are dropped in
  // the loop below, exactly as before.
  type RaceTableRow = {
    date_iso: string | null;
    distance_mi: string | null;
    distance_label: string | null;
    finish_seconds: string | null;
    finish_time: string | null;
  };
  const raceTableRows = (await pool.query<RaceTableRow>(
    `SELECT (meta->>'date')          AS date_iso,
            (meta->>'distanceMi')    AS distance_mi,
            (meta->>'distanceLabel') AS distance_label,
            (actual_result->>'finishS') AS finish_seconds,
            (meta->>'finishTime')       AS finish_time
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'date' IS NOT NULL
        AND (meta->>'date')::date >= $3::date - $2::int
        AND (
          (actual_result->>'finishS') IS NOT NULL
          OR (meta->>'finishTime') IS NOT NULL
        )
      ORDER BY (meta->>'date') DESC`,
    [userUuid, RACE_RECENT_DAYS, today],
  ).catch((e: unknown) => {
    // Loud, because silence is what let the broken column names live here.
    // The empty fallback is still the right POSTURE on failure — an unknown
    // runner gets the most hedged register — but it must never again be the
    // only trace that the read did not happen.
    console.error('[voice-band] race history read FAILED (not an absence of races):', e);
    return { rows: [] as RaceTableRow[] };
  })).rows;

  const profileRow = (await pool.query<{ race_history: any }>(
    `SELECT race_history FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ race_history: any }> }))).rows[0];

  type RaceSig = { distanceMi: number; timeSec: number; dateMs: number };
  const raceSigs: RaceSig[] = [];

  for (const r of raceTableRows) {
    // Distance: the stored number, else the label through the shared parser.
    const distMi = r.distance_mi != null && r.distance_mi !== ''
      ? Number(r.distance_mi)
      : distanceMiFromLabel(r.distance_label);
    // Time: curated chip seconds first, legacy display string second.
    const timeSec = r.finish_seconds != null && r.finish_seconds !== ''
      ? Number(r.finish_seconds)
      : parseRaceTime(r.finish_time);
    if (distMi == null || !Number.isFinite(distMi) || distMi <= 0) continue;
    if (timeSec == null || !Number.isFinite(timeSec) || timeSec <= 0) continue;
    const dateMs = Date.parse(String(r.date_iso) + 'T12:00:00Z');
    if (!Number.isFinite(dateMs)) continue;
    raceSigs.push({ distanceMi: distMi, timeSec, dateMs });
  }

  if (Array.isArray(profileRow?.race_history)) {
    for (const entry of profileRow!.race_history as Array<{
      distance?: string; otherDistanceMi?: number; timeSec?: number; whenRaced?: string;
    }>) {
      const distMi = distanceMiOfBucket(entry.distance, entry.otherDistanceMi);
      const timeSec = Number(entry.timeSec);
      if (distMi == null || !Number.isFinite(timeSec) || timeSec <= 0) continue;
      // Bucket dateMs from whenRaced · we don't get a real date here, so
      // map the bucket to a midpoint days-ago that drives the "recent"
      // gate (< 365 days) consistently.
      const daysAgo = whenRacedDaysAgo(entry.whenRaced);
      if (daysAgo == null || daysAgo > RACE_RECENT_DAYS) continue;
      raceSigs.push({
        distanceMi: distMi,
        timeSec,
        dateMs: Date.now() - daysAgo * 86400000,
      });
    }
  }

  // Dedupe · same distance ±0.05mi AND time within ±30s → same race.
  const deduped: RaceSig[] = [];
  for (const sig of raceSigs.sort((a, b) => b.dateMs - a.dateMs)) {
    const isDupe = deduped.some((d) =>
      Math.abs(d.distanceMi - sig.distanceMi) < 0.05
      && Math.abs(d.timeSec - sig.timeSec) < 30
    );
    if (!isDupe) deduped.push(sig);
  }

  const raceCount = deduped.length;
  const daysSinceMostRecentRace = deduped[0]
    ? Math.max(0, Math.round((Date.now() - deduped[0].dateMs) / 86400000))
    : null;

  // 2. VDOT confidence · derive from candidate spread + count
  const vdotConfidence = await computeVdotConfidence(userUuid);

  // 3. Calibration session · the hard-override path
  const calRow = (await pool.query<{ confidence: string | null }>(
    `SELECT confidence::text
       FROM calibration_sessions
      WHERE user_uuid = $1::uuid AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ confidence: string | null }> }))).rows[0];
  const calConfidence = calRow?.confidence != null ? Number(calRow.confidence) : null;
  const hasCalibrationCompleted = calConfidence != null && calConfidence >= CALIBRATION_PROMOTION_CONF;

  // 4. Soft adjustments
  const activeNiggleOrSick = !!state.activeNiggle || state.recentCheckIns.some(
    (c) => c.rating === 'wrecked'
  );

  const subjectiveObjectiveMismatchDays = await countSubjectiveObjectiveMismatchDays(
    userUuid,
    SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP,
  );

  const goalOffProjectedFor14d = await goalOffProjectedForWindow(
    userUuid,
    GOAL_OFF_PCT,
    GOAL_OFF_DAYS,
  );

  // 5. Primary band selection
  const reasons: string[] = [];
  let band: VoiceBand;
  let confidence: number;

  if (raceCount >= 2 && vdotConfidence >= VDOT_CONF_CHALLENGE_FLOOR) {
    band = 'challenge';
    confidence = 0.85;
    reasons.push(`${raceCount} recent races · VDOT confidence ${vdotConfidence.toFixed(2)}`);
  } else if (raceCount >= 1 || vdotConfidence >= VDOT_CONF_CAL_FLOOR) {
    band = 'guided';
    confidence = 0.70;
    if (raceCount >= 1) reasons.push(`1+ recent race`);
    if (vdotConfidence >= VDOT_CONF_CAL_FLOOR) {
      reasons.push(`VDOT confidence ${vdotConfidence.toFixed(2)}`);
    }
  } else {
    band = 'calibration';
    confidence = 0.85; // we're confident we DON'T know the runner
    reasons.push('no recent race history');
    if (vdotConfidence < VDOT_CONF_CAL_FLOOR) {
      reasons.push(`VDOT confidence ${vdotConfidence.toFixed(2)} (low)`);
    }
  }

  // 6. Hard override · completed calibration session can step up
  if (band === 'calibration' && hasCalibrationCompleted) {
    band = 'guided';
    confidence = Math.min(0.75, 0.5 + (calConfidence ?? 0) * 0.4);
    reasons.push(`calibration completed at ${(calConfidence ?? 0).toFixed(2)} confidence`);
  }

  // 7. Soft adjustments · step DOWN
  if (goalOffProjectedFor14d) {
    band = stepDown(band);
    confidence -= 0.10;
    reasons.push('goal-time off projection 14+ days');
  }
  if (activeNiggleOrSick && band === 'challenge') {
    band = 'guided';
    confidence -= 0.05;
    reasons.push('active niggle / sick / wrecked check-in');
  }
  // `null` means the mismatch read failed. The softcap does not fire on
  // evidence that was never gathered — and, equally, the absence of the softcap
  // must not be read as "no disagreement". The null is carried into `signals`.
  if (subjectiveObjectiveMismatchDays != null
      && subjectiveObjectiveMismatchDays >= SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP
      && band === 'challenge') {
    band = 'guided';
    confidence -= 0.05;
    reasons.push(`subjective vs objective disagreement ${subjectiveObjectiveMismatchDays}+ days`);
  }

  return {
    band,
    confidence: Math.max(0, Math.min(1, +confidence.toFixed(2))),
    reasons,
    signals: {
      raceCount,
      daysSinceMostRecentRace,
      vdotConfidence,
      hasCalibrationCompleted,
      activeNiggleOrSick,
      subjectiveObjectiveMismatchDays,
      goalOffProjectedFor14d,
    },
  };
}

/**
 * Convenience · load just the band for copy composers whose routes don't
 * carry a full CoachState (the run-recap endpoint in particular). Loads
 * the two partial-state signals computeVoiceBand reads (activeNiggle +
 * recentCheckIns) with the same queries state-loader uses, then
 * delegates. Best-effort · null on any failure, and null renders as
 * 'guided' (the default band) in every consumer.
 */
export async function loadVoiceBandLite(userUuid: string): Promise<VoiceBand | null> {
  try {
    const checkIns = await pool.query(
      `SELECT ts, rating, extras FROM check_ins
        WHERE COALESCE(user_uuid, user_id) = $1 AND ts >= NOW() - interval '7 days'
        ORDER BY ts DESC LIMIT 10`,
      [userUuid],
    ).catch(() => ({ rows: [] as any[] }));

    // Mirror state-loader's activeNiggle derivation: most recent
    // unresolved body-issue mention in the last 7 days.
    let activeNiggle: CoachState['activeNiggle'] = null;
    for (const row of checkIns.rows as any[]) {
      const n = row.extras?.extracted?.niggle;
      if (!n || !n.body_part || n.resolved) continue;
      activeNiggle = {
        body_part: String(n.body_part),
        severity: (n.severity ?? null),
        description: String(n.description ?? ''),
        first_logged_ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
        days_ago: 0,
      };
      break;
    }

    const partial = {
      activeNiggle,
      recentCheckIns: (checkIns.rows as any[]).map((r) => ({ ts: r.ts, rating: r.rating })),
    };
    const reason = await computeVoiceBand(userUuid, partial as CoachState);
    return reason.band;
  } catch {
    return null;
  }
}

/* ────────────────────────── Helpers ────────────────────────── */

/** Map a race_history distance bucket to mileage. */
function distanceMiOfBucket(d: string | undefined, otherMi: number | undefined): number | null {
  switch (d) {
    case '5k':       return 3.107;
    case '10k':      return 6.214;
    case 'half':     return 13.109;
    case 'marathon': return 26.219;
    case 'other':
      return Number.isFinite(otherMi) && (otherMi ?? 0) > 0 ? Number(otherMi) : null;
    default: return null;
  }
}

/** Map a whenRaced bucket to a midpoint days-ago. */
function whenRacedDaysAgo(w: string | undefined): number | null {
  switch (w) {
    case '<6mo':   return 90;     // midpoint of 0-180
    case '6-12mo': return 270;    // midpoint of 180-365
    case '1-2yr':  return 547;    // midpoint of 365-730
    case '2+yr':   return 1095;   // representative 3yr · drops out of recent gate
    default:       return null;
  }
}

function stepDown(band: VoiceBand): VoiceBand {
  if (band === 'challenge') return 'guided';
  if (band === 'guided') return 'calibration';
  return 'calibration';
}

/**
 * VDOT confidence · 0-1 from the spread + count of recent candidates.
 *
 *   · 0 candidates → 0.0
 *   · 1 race in last 180d → 0.65 base
 *   · 2-3 races in 180d, tight spread (≤2 VDOT points) → 0.80
 *   · 4+ races in 180d, tight spread → 0.90
 *   · Run-only candidates · max 0.45 (no race anchor)
 *   · Wide spread (>4 VDOT) → cap at 0.50 regardless of count
 *
 * The confidence is a coach-trust signal · not a statistical confidence
 * interval. Don't over-engineer it.
 */
async function computeVdotConfidence(userUuid: string): Promise<number> {
  // 2026-06-03 · runner TZ anchors the 180d window.
  const today = await runnerToday(userUuid);
  // Phase B · one canonical dedup. run_v counts each physical run once.
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(today, 180), today);
  const rows = (await pool.query<{ kind: string; vdot: number | null }>(
    // 2026-08-21 · backend audit · same phantom columns as the history read
    // above (`finish_seconds`, `date_iso`), and worse here: the invalid
    // reference aborts the WHOLE statement, so the perfectly valid `run_v`
    // CTE never returned either. Both counts came back zero for every user,
    // `raceCount === 0 && runCount === 0` returned 0, and because
    // VDOT_CONF_CHALLENGE_FLOOR is 0.7 the `challenge` band was unreachable
    // by anyone, no matter how many races they had logged. Rewritten against
    // the jsonb shape with the same actual_result → meta ladder.
    `WITH race_v AS (
       SELECT 'race' AS kind,
              -- VDOT computed at read · no stored snapshot
              NULL::numeric AS vdot
         FROM races
        WHERE user_uuid = $1::uuid
          AND meta->>'date' IS NOT NULL
          AND (meta->>'date')::date >= $2::date - 180
          AND (
            (actual_result->>'finishS') IS NOT NULL
            OR (meta->>'finishTime') IS NOT NULL
          )
     ),
     run_v AS (
       SELECT 'run' AS kind,
              NULL::numeric AS vdot
         FROM runs
        WHERE user_uuid = $1::uuid
          AND id = ANY($3::bigint[])
          AND (data->>'workoutType') IN ('threshold', 'tempo', 'intervals', 'race')
          AND (data->>'distanceMi')::numeric >= 3
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= $2::date - 180
     )
     SELECT * FROM race_v UNION ALL SELECT * FROM run_v`,
    [userUuid, today, canonicalIds],
  ).catch((e: unknown) => {
    console.error('[voice-band] vdot-confidence candidate read FAILED (not zero candidates):', e);
    return { rows: [] as Array<{ kind: string; vdot: number | null }> };
  })).rows;

  const raceCount = rows.filter((r) => r.kind === 'race').length;
  const runCount = rows.filter((r) => r.kind === 'run').length;

  if (raceCount === 0 && runCount === 0) return 0;

  if (raceCount === 0) {
    // Run-only candidates · capped per doctrine
    return Math.min(0.45, 0.15 + runCount * 0.05);
  }

  if (raceCount === 1) return 0.65;
  if (raceCount === 2) return 0.78;
  if (raceCount === 3) return 0.85;
  return 0.90; // 4+
}

/**
 * Count days where the runner's subjective check-in disagrees with
 * the objective readiness score by ≥15 points (Saw et al. threshold).
 *
 * Capped at the lookback window. Lookback is the days arg.
 */
async function countSubjectiveObjectiveMismatchDays(
  userUuid: string,
  lookbackDays: number,
): Promise<number | null> {
  // 2026-06-03 · runner TZ anchors the readiness-snapshot lookback.
  const today = await runnerToday(userUuid);
  const mismatchTz = await runnerTimezone(userUuid).catch(() => 'UTC');
  // 2026-08-24 · swallowed-failure sweep · the `objective` CTE read
  // `readiness_snapshots.sample_date` and `.value`. That table has neither — the
  // columns are `snapshot_date` and `score`, and there is no `user_id` on it at
  // all. Postgres answered `column "sample_date" does not exist` on every call
  // and the `.catch` handed back `mismatch_days: '0'`, which reads as "the
  // runner's own sense of themselves agrees with the numbers, every day".
  // That is a claim, made without looking, over 85 real snapshots in prod.
  const result = await rowOrNull<{ mismatch_days: string }>(
    'coach/voice-band · subjective-objective mismatch',
    pool.query<{ mismatch_days: string }>(
      `WITH days AS (
       SELECT (ts AT TIME ZONE $4::text)::date AS d, rating
         FROM check_ins
        WHERE COALESCE(user_uuid, user_id) = $1::uuid
          AND ts >= NOW() - ($2::text || ' days')::interval
     ),
     scored AS (
       SELECT d,
              CASE rating
                WHEN 'solid'   THEN 75
                WHEN 'tired'   THEN 50
                WHEN 'wrecked' THEN 30
                ELSE NULL
              END AS subjective_score
         FROM days
     ),
     objective AS (
       SELECT snapshot_date AS d, score::numeric AS objective_score
         FROM readiness_snapshots
        WHERE user_uuid = $1::uuid
          AND snapshot_date >= $3::date - $2::int
     )
     SELECT COUNT(*)::text AS mismatch_days
       FROM scored s JOIN objective o ON o.d = s.d
      WHERE s.subjective_score IS NOT NULL
        AND ABS(s.subjective_score - o.objective_score) >= 15`,
      [userUuid, lookbackDays, today, mismatchTz],
    ),
  );
  // A failed read is not zero mismatched days. Return null and let the caller
  // decide; the band must not soften on evidence it never gathered.
  if (result == null) return null;
  return Number(result.mismatch_days ?? 0);
}

/**
 * Is the runner's current projected race time off the goal by ≥pct
 * for the last `windowDays` days? Reads from `projection_snapshots`.
 */
async function goalOffProjectedForWindow(
  userUuid: string,
  pct: number,
  windowDays: number,
): Promise<boolean> {
  // 2026-06-03 · runner TZ anchors the projection-snapshot window.
  const today = await runnerToday(userUuid);

  // 2026-08-19 · race-shape audit · resolve the goal race in TS, not SQL.
  //
  // The distance used to be read as `(r.meta->>'distanceMi')::numeric` inside
  // the query. That field is NULL on every race row written before 2026-07-06
  // (the write path stored distanceLabel only), so `dist_mi` was NULL, the
  // projection join `ps.distance_mi = g.dist_mi` matched NOTHING — `NULL =
  // anything` is never true — `total_count` came back 0, and the `total >= 7`
  // guard at the bottom turned the whole soft-cap OFF. Silently, and for
  // exactly the runners whose race rows are the oldest.
  //
  // Resolved here through `distanceMiFromLabel`, the ONE parser the race write
  // paths use, rather than a CASE ladder in SQL: the codebase already paid for
  // half a dozen drifting local forks of that mapping once (P1-17), and a
  // seventh living inside a query string is the least reviewable place to put
  // it. Read-time — no migration, and a label-only row lights up immediately.
  const goalRow = (await pool.query<{
    goal_sec: string | null; dist_mi: string | null;
    label: string | null; name: string | null;
  }>(
    `SELECT (r.plan->'goal'->>'finish_time_s')::numeric::text AS goal_sec,
            (r.meta->>'distanceMi')                           AS dist_mi,
            (r.meta->>'distanceLabel')                        AS label,
            (r.meta->>'name')                                 AS name
       FROM training_plans tp
       JOIN races r ON r.slug = tp.race_id AND r.user_uuid = tp.user_uuid
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{
    goal_sec: string | null; dist_mi: string | null; label: string | null; name: string | null;
  }> }))).rows[0];

  const goalSec = goalRow?.goal_sec != null ? Number(goalRow.goal_sec) : NaN;
  const numericMi = goalRow?.dist_mi != null ? Number(goalRow.dist_mi) : NaN;
  const distMi = Number.isFinite(numericMi) && numericMi > 0
    ? numericMi
    : (distanceMiFromLabel(goalRow?.label) ?? distanceMiFromLabel(goalRow?.name));
  // No goal race, no goal time, or a distance nothing can resolve → the
  // soft-cap has nothing to measure. False, as before.
  if (!Number.isFinite(goalSec) || goalSec <= 0 || distMi == null || !(distMi > 0)) return false;

  const result = (await pool.query<{ off_count: string; total_count: string }>(
    `WITH proj AS (
       SELECT ps.snapshot_date, ps.projection_sec
         FROM projection_snapshots ps
        WHERE ps.user_uuid = $1::uuid
          AND ps.distance_mi = $5::numeric
          AND ps.snapshot_date >= $4::date - $3::int
     )
     SELECT COUNT(*) FILTER (
              WHERE proj.projection_sec > $6::numeric * (1 + $2::numeric)
            )::text AS off_count,
            COUNT(*)::text AS total_count
       FROM proj`,
    [userUuid, pct, windowDays, today, distMi, goalSec],
  ).catch(() => ({ rows: [{ off_count: '0', total_count: '0' }] }))).rows[0];

  const off = Number(result?.off_count ?? 0);
  const total = Number(result?.total_count ?? 0);
  // Off for the FULL window (every snapshot · strict).
  // If we only had partial data (cold start) total could be small ·
  // require ≥7 snapshots before the soft-cap fires.
  return total >= 7 && off === total;
}
