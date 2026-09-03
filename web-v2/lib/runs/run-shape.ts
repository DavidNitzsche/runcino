/**
 * lib/runs/run-shape.ts · the shape of `runs.data`, in one place.
 *
 * `runs.data` is an untyped jsonb blob. Every key in it is reachable only by
 * string literal — `data->>'distanceMi'` in SQL, `d.avgHr` in TypeScript — and
 * nothing anywhere checks that the literal names a key that exists. A typo, a
 * key that was never written, and a measurement that is legitimately absent all
 * produce exactly the same thing: `null`. They are indistinguishable at the
 * call site, and a null that means "you spelled it wrong" reads as "the runner
 * has no heart-rate data" for as long as nobody looks.
 *
 * Five bugs in one file in one afternoon, all of this class:
 *
 *   1 · `data->'faff'->>'quality_verdict'` — nothing writes `data.faff`. The
 *       key does not exist on any row. The signal was null for every runner,
 *       permanently, and looked exactly like "no verdict recorded yet".
 *   2 · joined on `data->>'start_date_local'` — the real key is `date`, with
 *       `startLocal` as fallback. Nothing matched; completion read zero.
 *   3 · `(data->>'distance')::numeric > 12874` assuming metres — there is no
 *       `distance` key, and the real one (`distanceMi`) is already in miles.
 *   4 · compared `runs.id` (bigint) against a `text[]`. Postgres threw, an
 *       error handler swallowed it, three signals went dark in silence.
 *   5 · assumed one split shape. There are six. See NORMALISED SPLITS below.
 *
 * This module is the one place those literals are allowed to appear.
 * `_run_shape_lint.test.ts` fails the build when they appear anywhere else,
 * with an explicit allowlist for the call sites not yet migrated.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW THIS SHAPE WAS DERIVED
 *
 * Not from the consumers, and not from hope. Every key below was enumerated
 * out of the live database (`jsonb_object_keys` over all of `runs`, with
 * `jsonb_typeof` and row counts per key), and every multiplicity note is a
 * measured count rather than a guess. Where the observed types disagree with
 * what a consumer assumes, the consumer is wrong and the note says so.
 *
 * The census that produced this: 247 rows, 70 distinct keys. Re-run it before
 * trusting any percentage here — they are a snapshot, and the eras below are
 * the durable part.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE THREE ERAS
 *
 * Rows arrive from several ingest paths that were written years apart and
 * never backfilled to a common shape. Almost every "optional" key below is
 * optional because of WHICH PATH wrote the row, not because the measurement
 * was missing:
 *
 *   · STRAVA        (`source` = 'strava' | 'strava_webhook', or null on the
 *                    oldest rows) — carries `elapsedTimeS`, `movingTimeS`,
 *                    `kudosCount`, `achievementCount`, `sportType`,
 *                    `summaryPolyline`, `gear`, and Strava-raw splits.
 *                    `workoutType` here is Strava's NUMERIC enum.
 *   · APPLE HEALTH  (`source` = 'apple_health' | 'apple_watch') — carries
 *                    `durationSec`, `avgCadence`, running-dynamics keys
 *                    (`avgGctMs`, `avgVertOscCm`, `avgStrideLengthM`,
 *                    `avgPowerW`), and faff-normalised splits.
 *   · FAFF WATCH    (`source` = 'watch' | 'treadmill') — carries `phases`,
 *                    `client_workout_id`, `watchCompletionRef`, `indoor`, and
 *                    the richest splits. `workoutType` here is a faff SEMANTIC
 *                    STRING, not Strava's number.
 *
 * So `elapsedTimeS` being absent does not mean the run had no elapsed time; it
 * means a HealthKit row wrote `durationSec` instead. Treat an absent key as
 * "this path does not record it", never as a zero.
 */

import {
  WIRE_PHASE_VERDICTS,
  type WirePhaseVerdict,
} from '@/lib/training/execution-semantics';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE TYPE
 * ═══════════════════════════════════════════════════════════════════════ */

/** Strava's `workout_type` enum, as it lands in `data.workoutType` on rows
 *  ingested from Strava. 0 = default, 1 = race, 2 = long run, 3 = workout. */
export type StravaWorkoutTypeCode = 0 | 1 | 2 | 3;

/** The faff semantic taxonomy, as it lands in `data.workoutType` on rows
 *  written by the faff watch app. Observed values in the live census. */
export type FaffWorkoutType =
  | 'easy' | 'long' | 'tempo' | 'threshold' | 'intervals' | 'race';

/**
 * `runs.data`, as it actually is.
 *
 * EVERY field is optional. That is not defensive typing — it is the measured
 * truth: only six keys (`date`, `name`, `distanceMi`, `startLocal`, and the
 * always-present-but-nullable `avgHr` / `maxHr`) appear on 100% of rows. A
 * consumer that needs any other key must handle its absence.
 */
export interface RunData {
  /* ── identity & time ──────────────────────────────────────────────────── */

  /**
   * THE local calendar day, `YYYY-MM-DD`. Present and well-formed on 100% of
   * rows, and this is the AUTHORITATIVE day for every date join.
   *
   * Do not reach for `startLocal` first. See `startLocal` for why.
   */
  date?: string;

  /**
   * Run start timestamp. AMBIGUOUS BY ERA and the single most dangerous key in
   * this blob — the name says local, and on 58% of rows it is not.
   *
   *   · 143/247 rows · `2026-06-11T08:25:45Z` — Z-suffixed, a UTC instant.
   *   · 104/247 rows · `2026-06-05T08:35:33`  — naive, genuinely local.
   *
   * `LEFT(startLocal, 10)` is therefore the UTC day on the majority of rows,
   * not the local one. For a runner west of Greenwich an evening run rolls
   * over: 7 rows in the census have `date` a full day earlier than
   * `LEFT(startLocal,10)`, all of them Z-suffixed, all of them evening runs.
   *
   * This is why `runDaySql` COALESCEs `date` FIRST and `startLocal` only as a
   * fallback, and why that order must never be flipped for convenience. The
   * same mistake in the other direction is commit c1fb36eb ("watch-completion
   * date lookup fell to UTC-shifted fallback for every modern run").
   */
  startLocal?: string;

  /** IANA zone. Only 17% of rows — mostly null. Cannot be relied on to
   *  disambiguate `startLocal`; use `date`. */
  timezone?: string | null;

  /**
   * The PROVIDER's id for this activity — NOT `runs.id`.
   *
   * Observed as a JSON number on 88 rows (Strava's numeric activity id) and a
   * JSON string on 136 (faff/HealthKit UUID-ish ids). `runs.id` is a bigint
   * column and is a different value entirely. Bug #4 above is what happens
   * when the two are conflated in a comparison.
   */
  id?: number | string;

  /** Provider activity id, string form. Overlaps `id`; 43% of rows. */
  activityId?: string;

  /** Which ingest path wrote the row. Null on 36% (the oldest Strava rows,
   *  written before the key existed) — null means "old Strava", not unknown. */
  source?: 'strava' | 'strava_webhook' | 'apple_health' | 'apple_watch'
         | 'watch' | 'treadmill' | 'phone' | 'manual' | string | null;

  /** Activity title. 100% of rows. */
  name?: string;

  /**
   * MERGE LOSER MARKER. Set by `lib/runs/merge.ts` on the row that lost a
   * dedup, pointing at the winner. Its PRESENCE is the signal — the value is
   * observed as both number and string and should not be compared.
   *
   * Do not hand-roll a filter on this. `CANONICAL_ROW_SQL` in
   * `lib/runs/volume.ts` is the one predicate, and `getCanonicalRunIds` is the
   * stronger identity-clustered reader. See `lib/runs/volume.ts` for why
   * `absorbed_into_canonical_at` is NOT a substitute.
   */
  mergedIntoId?: number | string;

  /* ── distance, time, effort ───────────────────────────────────────────── */

  /**
   * Distance in MILES. Always a JSON number, present on 100% of rows.
   *
   * There is no `distance` key on any row, and nothing in this blob is in
   * metres. Bug #3 above is a metres assumption applied to a miles field: the
   * filter `> 12874` was intended as "longer than 8 miles" and instead matched
   * nothing, because no run is 12,874 miles.
   */
  distanceMi?: number;

  /** Moving time in seconds — Strava-era and watch-era. 74% of rows. */
  movingTimeS?: number;

  /** Elapsed (wall-clock) time in seconds — Strava-era only. 68% of rows. */
  elapsedTimeS?: number;

  /**
   * Total workout duration in seconds — HealthKit/watch-era. 43% of rows.
   *
   * NOT interchangeable with `movingTimeS`. On the 29 rows carrying both, this
   * is LARGER — by 77s on average and by as much as 561s (9¼ minutes) — because
   * it includes paused time that `movingTimeS` excludes. Which one a query
   * COALESCEs first is a real semantic choice, and the codebase currently makes
   * it two different ways. See `runMovingSecSql` vs `runFinishSecSql`.
   */
  durationSec?: number;

  /** Moving time in seconds, a third spelling. Only 4 rows — an early
   *  HealthKit era. Kept in the COALESCE ladders because those 4 rows have no
   *  other duration key. */
  movingSec?: number;

  /** Average pace, seconds per mile. 73% of rows. */
  paceSPerMi?: number;

  /** Average pace as a `m:ss` DISPLAY STRING — not seconds. 43% of rows.
   *  Parse with `paceToSec` rather than `Number()`. */
  avgPaceMinPerMi?: string;

  /** Moving time as a `h:mm` / `m:ss` DISPLAY STRING. 43% of rows. Ambiguous
   *  (`100:41` is observed) — prefer the numeric duration keys. */
  timeMoving?: string;

  /** Average speed, mph. 68% of rows. */
  avgSpeedMph?: number;

  /* ── heart rate ───────────────────────────────────────────────────────── */

  /**
   * Average heart rate, bpm. The KEY is present on 100% of rows, but the VALUE
   * is JSON null on 32 of them. This is the distinction the whole module
   * exists for: `data ? 'avgHr'` is true while `data->>'avgHr'` is NULL. The
   * accessor returns `null` for both and never a zero.
   */
  avgHr?: number | null;

  /** Max heart rate, bpm. Same key-present/value-null split as `avgHr`, and
   *  null on exactly the same 32 rows. */
  maxHr?: number | null;

  /** Unadjusted average HR, before the whole-run/work-phase reconciliation.
   *  23% of rows. */
  avgHrRaw?: number;

  /** What `avgHr` is an average OF — e.g. 'whole_run'. 23% of rows. */
  avgHrKind?: string;

  /** Time-in-zone percentages, z1..z5. 22% of rows, and null on some of
   *  those. */
  hrZonePcts?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;

  /* ── elevation & route ────────────────────────────────────────────────── */

  /** Elevation gain, FEET. 97% of rows, JSON null on 8. */
  elevGainFt?: number | null;

  /** How `elevGainFt` was obtained — 'absent' | 'gps_derived' | provider.
   *  53% of rows. 'absent' is a real recorded value meaning "we looked and
   *  there was nothing", which is NOT the same as the key being missing. */
  elevGainSource?: string;

  /** Encoded polyline from Strava. 68% of rows, and the empty string is
   *  observed — an empty polyline is not a route. */
  summaryPolyline?: string;

  /** Encoded polyline, faff-era. 56% of rows; null and empty both observed. */
  routePolyline?: string | null;

  /** `[lat, lng]`. 68% of rows, null observed. */
  startLatLng?: [number, number] | null;
  endLatLng?: [number, number] | null;

  /* ── classification ───────────────────────────────────────────────────── */

  /**
   * TWO INCOMPATIBLE TAXONOMIES IN ONE KEY, distinguished only by JSON type:
   *
   *   · NUMBER (52 rows) — Strava's enum. 1 = race, 3 = workout.
   *   · STRING (74 rows) — faff's semantic taxonomy: 'easy', 'long', 'tempo',
   *     'threshold', 'intervals', 'race'.
   *   · JSON null (102 rows) / key absent (19).
   *
   * `data->>'workoutType'` flattens both to text, so a Strava race arrives as
   * `'1'` and a faff race as `'race'`. Any consumer comparing that text to a
   * semantic name silently misses every Strava row, and any consumer comparing
   * it to a number silently misses every faff row.
   *
   * Use `runWorkoutType` — it returns both the raw value and a single resolved
   * semantic, so the caller stops having to know which era the row is from.
   */
  workoutType?: StravaWorkoutTypeCode | FaffWorkoutType | number | string | null;

  /** Where `workoutType` came from — e.g. 'plan'. 30% of rows. */
  workoutTypeSource?: string;

  /** The plan's prescribed type for the day, when known. 1 row — effectively
   *  unpopulated; do not build on it. */
  plannedWorkoutType?: string;

  /**
   * Activity type. MIXED SEMANTICS: 'Run' on Strava-era rows (Strava's
   * activity type) and 'easy' on some faff rows (a workout type). Do not use
   * this to decide whether a row is a run; use `sportType`, or the absence of
   * a non-run marker.
   */
  type?: string;

  /** Strava's sport type — 'Run'. 68% of rows. */
  sportType?: string;

  /** Treadmill / indoor flag. 25% of rows. Relevant because an indoor row's
   *  `elevGainFt` is not a real grade signal. */
  indoor?: boolean;

  /* ── the canonical-race triple ────────────────────────────────────────── */

  /**
   * Auto-detected best-effort race labelling. Present as a key on 88 rows and
   * JSON NULL ON EVERY ONE OF THEM — nothing currently populates any of the
   * three.
   *
   * Per CLAUDE.md §Race-data source-of-truth these must never be read as an
   * authoritative race result regardless: a 5K best-effort segment detected
   * inside a long run is not a 5K race, and reading `canonicalLabel` as one is
   * how the phantom-VDOT-33.6 bug landed. Race results come from
   * `races.actual_result`.
   */
  canonicalLabel?: null;
  canonicalDistanceMi?: null;
  canonicalFinishS?: null;

  /* ── splits ───────────────────────────────────────────────────────────── */

  /** Per-mile splits. SIX DISTINCT SHAPES — see `normalizeSplits`. 95% of
   *  rows, and 9 of those carry an empty array. */
  splits?: unknown[];

  /** Per-KILOMETRE splits, always Strava-raw shape. 26% of rows, and every
   *  row that has it also has `splits`. Note the units: `distance` here is
   *  METRES, unlike anything in the mile splits. */
  splits_metric?: unknown[];

  /** Splits are known to disagree with the summary duration. 39% of rows. */
  splits_unreliable?: boolean;

  /** The reconciliation that set `splits_unreliable`. 23% of rows. */
  splits_validation?: {
    deltaS: number; durationS: number; splitsSumS: number; droppedCount: number;
  } | null;

  /** Provenance stamp for a splits backfill. 1 row. */
  splits_source?: string;

  /* ── watch-era structured work ────────────────────────────────────────── */

  /** Structured workout phases from the faff watch app (warmup / work /
   *  recovery / cooldown), with actual-vs-target per phase. 21% of rows. The
   *  richest signal in the blob, and the only place `actualPaceSPerMi` and
   *  per-phase verdicts live. Normalise with `runPhases`. */
  phases?: unknown[];

  /**
   * The watch's own run-level outcome — `completed` | `partial` | `abandoned`.
   *
   * ⚠ ABSENT ON EVERY HISTORICAL ROW. The field arrives on the wire
   * (`WatchCompletionBody.status`) and the completion endpoint stored the whole
   * payload in `coach_intents.value` while never copying this key onto the run,
   * so the only place it exists for runs written before 2026-08-17 is that blob
   * — see `watchCompletionRef`, which is the key it is filed under.
   *
   * ⚠ AND IT DOES NOT MEAN WHAT IT SOUNDS LIKE. `WorkoutEngine.abandon()` in
   * the watch app stamps `abandoned` whenever the runner ends the workout
   * before the LAST PLANNED PHASE has completed. Ending during the cool-down —
   * which is what most runners do — produces `abandoned` on a session that was
   * fully executed. In the live data 13 of 50 completions carry it, including
   * an 18-mile long run and a tempo whose work block finished in full.
   *
   * So this is a signal about workout STRUCTURE, not about effort. Read it
   * together with the per-phase `completed` flags: an unfinished WORK phase is
   * what "cut it short" means. `watchStoppedInsideWork` is that predicate.
   */
  status?: 'completed' | 'partial' | 'abandoned' | string;

  /** Contingency-rule outcomes the watch recorded — `pass` / `bail` / `abort`.
   *  Zero rows carry it in the live census. */
  ruleOutcomes?: unknown[];

  /* ── wrist decisions · 0821 watch design, 2026-08-21 ──────────────────
   *
   * The four things a runner can decide mid-run. The bail is `ruleOutcomes`
   * above; these are the other three. All THREE ARE ABSENT ON EVERY
   * HISTORICAL ROW — nothing before 2026-08-21 could record them, and no
   * watch build emits them yet, so a reader must treat absence as "this run
   * predates the field", never as "no decision was taken".
   *
   * They exist as their own keys because `phase.completed === false` cannot
   * tell a choice from a lapse, and the phone's run-detail rows state that a
   * decision is not a lapse. Written by
   * `app/api/watch/workouts/complete/route.ts`, normalised there.
   */

  /** The heart-rate ceiling was lifted for the day. Reading AND limit are
   *  carried separately and neither is a delta — the row reads "ran to 174,
   *  the ceiling was 165". Either figure may be null. */
  ceilingLift?: {
    ceilingBpm?: number | null;
    readingBpm?: number | null;
    phaseIndex?: number; phaseLabel?: string;
    atMi?: number; atSec?: number;
  };

  /** Reps the runner CHOSE to skip, one entry each. `repIndex` is 1-based
   *  and always present on a stored entry. */
  repSkips?: Array<{
    repIndex: number;
    repCount?: number; repsCompleted?: number;
    phaseIndex?: number; phaseLabel?: string;
    atMi?: number; atSec?: number;
  }>;

  /** Recovery extensions, one entry per +30 s. The COUNT is the array
   *  length; the boundaries are on the entries. */
  recoveryExtensions?: Array<{
    afterRepIndex?: number; beforeRepIndex?: number;
    repCount?: number; addedSec?: number;
    phaseIndex?: number; phaseLabel?: string;
    atSec?: number;
  }>;

  /** The watch's own id for the completion this row came from. 28% / 42%.
   *  Also the `coach_intents.field` value the full payload is filed under. */
  watchCompletionRef?: string;
  client_workout_id?: string;

  /* ── running dynamics ─────────────────────────────────────────────────── */

  /**
   * All four appeared together on the same 98 rows, all nullable, written
   * ONLY by the HealthKit-import path (HealthKitImporter.swift's post-
   * workout statAvg reads, for outdoor runs with a synced HKWorkout).
   *
   * 2026-08-27 · second writer: the treadmill watch bridge
   * (TreadmillHRStreamer.swift, via `/api/watch/workouts/complete`) reads
   * the SAME four HealthKit quantity types live, off the same active
   * `HKWorkoutSession` that already streams heart rate — the first source
   * these fields have ever had for an INDOOR run, which never gets an
   * HKWorkout to import running-dynamics from. Same fields, same units,
   * two independent writers; a row can now carry either provenance.
   */
  avgCadence?: number | null;
  avgGctMs?: number | null;
  avgVertOscCm?: number | null;
  avgStrideLengthM?: number | null;
  avgPowerW?: number | null;

  /* ── weather ──────────────────────────────────────────────────────────── */

  /** Ambient temperature, °F. 85% of rows. Duplicated inside `weather`. */
  tempF?: number | null;

  /**
   * Enriched weather. FOUR KEY-SET VARIANTS observed, growing over time —
   * the newest adds `hours_sampled`, `temp_f_mean/peak/start/end` and
   * `humidity_pct_peak` for long runs. Every variant carries the base six, so
   * read the base fields freely and the extended ones defensively.
   */
  weather?: {
    source?: string; temp_f?: number; conditions?: string;
    humidity_pct?: number; precip_in?: number;
    wind_mph?: number; wind_gust_mph?: number; cloud_cover_pct?: number;
    fetched_at?: string; version?: number;
    temp_f_start?: number; temp_f_end?: number;
    temp_f_mean?: number; temp_f_peak?: number;
    humidity_pct_peak?: number; hours_sampled?: number;
  };

  /* ── misc ─────────────────────────────────────────────────────────────── */

  /** Strava's gear object and its id. 13% of rows. Shoe attribution proper
   *  lives in the `shoe_id` COLUMN, not here. */
  gear?: { id?: string; name?: string; nickname?: string; retired?: boolean;
           distance?: number; converted_distance?: number; primary?: boolean;
           resource_state?: number };
  gear_id?: string;

  /** Calories. Two spellings from two eras; 26% / 25%. */
  calories?: number;
  kcal?: number | null;

  /** Strava social counters. 68% of rows. */
  kudosCount?: number;
  achievementCount?: number;

  /** Strava's relative-effort score. 55% of rows. */
  sufferScore?: number | null;

  /** When the row was ingested. 42% of rows. */
  ingestedAt?: string;

  /** Manual warm-up attribution, added when a runner logs a warm-up that the
   *  watch did not record. 2 rows. */
  warmupAddedAt?: string;
  warmupAddedManually?: boolean;
  warmupBonusMi?: number;
  warmupBonusSec?: number;
  warmupNote?: string;

  /** The untouched Strava payload, kept for forensics. 2 rows. */
  stravaRaw?: Record<string, unknown>;

  /** Post-run RPE. Present on 1 row and null there — the real RPE store is the
   *  `post_run_rpe` table. Do not read this. */
  perceived_exertion?: null;

  /**
   * Distance quarantine marker, stamped at ingest for implausible (50–250 mi)
   * distances by `lib/runs/distance-guard.ts`. Zero rows carry it today.
   * Volume DELIBERATELY includes quarantined rows; only fitness anchors
   * exclude them. See the note on `CANONICAL_ROW_SQL` in `lib/runs/volume.ts`.
   */
  qualityFlag?: 'distance_review' | string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SQL FRAGMENTS
 *
 * One definition each for the expressions that were being rewritten by hand at
 * every call site. Each takes the table alias used by the caller's query, so
 * `runDaySql('r')` and `runDaySql('sa')` and `runDaySql()` all work.
 * ═══════════════════════════════════════════════════════════════════════ */

/** `r` → `r.data`; `r.data` → `r.data`; nothing → `data`. */
function col(alias = ''): string {
  if (!alias) return 'data';
  return alias.endsWith('.data') ? alias : `${alias.replace(/\.$/, '')}.data`;
}

/**
 * THE local calendar day of a run. The single most-copied expression in the
 * codebase and the one that must not be improvised.
 *
 * `date` first, `startLocal` only as a fallback — because `startLocal` is a
 * Z-suffixed UTC instant on 58% of rows, so `LEFT(startLocal,10)` is the UTC
 * day there and rolls an evening run into tomorrow. Never flip this order.
 */
export function runDaySql(alias = ''): string {
  const d = col(alias);
  return `COALESCE(${d}->>'date', LEFT(${d}->>'startLocal', 10))`;
}

/**
 * The `date` key ALONE, with no `startLocal` fallback.
 *
 * `runDaySql` is almost always what you want. This exists because a handful of
 * queries genuinely read the bare key — usually because they immediately cast
 * to `::date` and a malformed fallback would throw rather than mismatch — and
 * silently widening them to the COALESCE form would change which rows match.
 *
 * If you are writing a new query, use `runDaySql`.
 */
export function runDateKeySql(alias = ''): string {
  return `${col(alias)}->>'date'`;
}

/**
 * EVERY SPELLING OF "THIS RUN'S ID", as one match predicate.
 *
 * A run is referred to by three different identities depending on where the
 * reference came from: the row's own bigint primary key (what `/api/v5/today`
 * hands the phone as `runId`), `data.activityId` (Strava's), and `data.id`
 * (the watch's `<uuid>-<date>#<hhmm>`). Four call sites matched a DIFFERENT
 * subset of those, and on 2026-09-02 that showed up as `/api/runs/[id]`
 * returning 404 for an id `/api/runs/[id]/recap` accepted perfectly — the same
 * run, the same string, two answers (Rule 16 at the identity layer).
 *
 * The parameter is the id, as text. Callers add their own `user_uuid` and
 * canonical-row predicates: this fragment answers "which run", never "whose"
 * (Rule 14 stays the caller's to state).
 *
 * Measured against production the same day: 15 of this runner's 155 canonical
 * rows carry NEITHER `data.id` NOR `data.activityId`, so the primary-key rung
 * is the only one that reaches them.
 */
export function runIdentityMatchSql(param: string, alias = ''): string {
  const d = col(alias);
  const idCol = alias ? `${alias}.id` : 'id';
  return `(${idCol}::text = ${param} OR ${d}->>'activityId' = ${param} OR ${d}->>'id' = ${param})`;
}

/** Distance in miles, as numeric. Already miles — never divide by 1609. */
export function runDistanceMiSql(alias = ''): string {
  return `(${col(alias)}->>'distanceMi')::numeric`;
}

/**
 * MOVING seconds — time the runner was actually moving.
 *
 * `movingTimeS` → `movingSec` → `durationSec`. Prefers the two keys that mean
 * moving time and falls back to `durationSec` only for rows that have no
 * moving-time key at all.
 *
 * This is NOT the same ladder as `runFinishSecSql`, and the difference is
 * real: on the 29 rows carrying both `movingTimeS` and `durationSec`, this
 * returns a value up to 561 seconds SMALLER, because `durationSec` includes
 * paused time. Matches `lib/coach/recovery-brief.ts`,
 * `lib/coach/recovery-phase.ts` and `lib/coach/training-state.ts`.
 */
export function runMovingSecSql(alias = ''): string {
  const d = col(alias);
  return `COALESCE(${survivingMovingSecSql(alias)}, ` +
         `NULLIF(${d}->>'durationSec','')::numeric)`;
}

/**
 * The largest share of a run that may plausibly have been paused before its
 * stored moving time stops being believable.
 *
 * The SQL side of `MAX_PAUSED_SHARE` in `lib/runs/coherence.ts`. Restated here
 * rather than imported because this file emits SQL text and a template literal
 * cannot reach a TypeScript constant at query time — `_ingest_integrity.test.ts`
 * asserts the two never drift, the same arrangement `STAMP_ABSORBED_SQL` and
 * `mayStampAbsorbed` already use.
 */
export const MAX_PAUSED_SHARE_SQL = '0.5';

/**
 * A stored moving time, or NULL when the row's own wall clock disproves it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-08-30 · THE SQL LADDERS DID NOT KNOW WHAT THE RECONCILER KNOWS.
 *
 * `lib/runs/coherence.ts` refuses a `movingTimeS` implying more than half a
 * run was paused, and every TypeScript surface that reads a clock through it
 * gets the honest answer. The SQL ladders in this file did not: they took
 * `movingTimeS` first, unconditionally, and one production row is exactly the
 * shape the reconciler exists to catch.
 *
 * 2026-08-23, 11.01 miles. A Strava webhook fired mid-upload and reported
 * 39:49; the absorber's fill-when-missing branch — tier-blind until the
 * 2026-08-24 `familyGuardedFill` fix, which landed one day too late for this
 * row — copied `movingTimeS` 2389, `elapsedTimeS` 2389, `paceSPerMi` 217 and
 * `avgSpeedMph` 16.591 onto a watch canonical whose own `durationSec` is 5298
 * and whose own `avgPaceMinPerMi` is "8:01".
 *
 * `runFinishSecSql` then handed `bestRecentVdot` 2389 seconds for 11.01 miles.
 * That is 3:37/mi, `vdotFromRace` returns null outside [30, 85], and the row
 * left the evidence pool without a trace. An 11.01-mile run at a genuine
 * 8:02/mi with avg HR 147 — VDOT 42.0, and the longest single piece of
 * evidence in that window — simply was not there. Not a wrong number on a
 * screen: a measurement that spent nothing and that nothing could see.
 *
 * Guarded, so it changes NOTHING on a row whose two clocks agree: the CASE
 * only fires when both are present and the implied pause exceeds half the run.
 * Measured over the owner's 153 canonical rows, that is one row. The five rows
 * whose Strava moving time sits 6-11% under their watch wall clock are
 * untouched, because a runner who stopped at a light is not a defect.
 *
 * A blank where a lie used to be is a fix: the caller now sees `durationSec`
 * 5298 through the ladder's next rung, which is this run's real clock.
 */
export function survivingMovingSecSql(alias = ''): string {
  const d = col(alias);
  const moving = `COALESCE(NULLIF(${d}->>'movingTimeS','')::numeric, ` +
                 `NULLIF(${d}->>'movingSec','')::numeric)`;
  const elapsed = `NULLIF(${d}->>'durationSec','')::numeric`;
  return `(CASE WHEN ${moving} IS NOT NULL AND ${elapsed} > 0 ` +
         `AND ${moving} < ${elapsed} * (1 - ${MAX_PAUSED_SHARE_SQL}) ` +
         `THEN NULL ELSE ${moving} END)`;
}

/**
 * FINISH seconds for the VDOT path — moving time first, `elapsedTimeS` as the
 * last resort.
 *
 * 2026-08-17 · REORDERED. This ladder used to put `durationSec` first, which
 * includes paused time. A fitness estimate derived from a training run is a
 * PACE reading, and pace is distance over the time spent *running* — standing
 * at a light is not running. Preferring the paused clock therefore made every
 * watch-recorded run read slower than the runner ran, and under-read their
 * fitness in exactly the direction that then prescribes them slower work.
 *
 * It was not a rounding error. Across the rows carrying both keys the gap
 * averages 52s and reaches 561s; one 5.97-mile threshold session carried 305
 * seconds of pauses, so it entered the VDOT path as 7:46/mi when it was run at
 * 6:55/mi, and anchored at VDOT 43.6.
 *
 * Races are unaffected: they read `races.actual_result.finishS`, or the Strava
 * match, which already prefers moving time. This ladder only ever fed
 * TRAINING-run candidates.
 *
 * Still distinct from `runMovingSecSql`, which has no `elapsedTimeS` rung — a
 * finish time may fall back to wall-clock when nothing better exists, whereas
 * a moving-time reader should return null rather than answer with elapsed.
 */
export function runFinishSecSql(alias = ''): string {
  const d = col(alias);
  // 2026-08-30 · the moving rungs go through `survivingMovingSecSql`, so a
  // moving time this row's own wall clock disproves falls through to
  // `durationSec` instead of anchoring a VDOT. See that function for the
  // 2026-08-23 row that left the evidence pool entirely.
  return `COALESCE(${survivingMovingSecSql(alias)}, ` +
         `NULLIF(${d}->>'durationSec','')::numeric, ` +
         `NULLIF(${d}->>'elapsedTimeS','')::numeric)`;
}

/** Elapsed (wall-clock) seconds. Strava-era key; null on HealthKit rows. */
export function runElapsedSecSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'elapsedTimeS','')::numeric`;
}

/** Average heart rate, bpm. NULL when unmeasured — never 0. */
export function runAvgHrSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'avgHr','')::numeric`;
}

/** Max heart rate, bpm. NULL when unmeasured — never 0. */
export function runMaxHrSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'maxHr','')::numeric`;
}

/**
 * Human running stride, metres per step, both feet — the band a whole-run
 * average has to land in for the cadence that produced it to be a step count.
 *
 * Measured on this database, 2026-08-24, over every row with a cadence and a
 * coherent clock: 1.118 to 1.391 m across the 106 Apple Watch rows, against a
 * REPORTED `avgStrideLengthM` of 1.12 to 1.38 m on the same rows. The band is
 * wide enough to hold a walk break and a finishing kick either side of that,
 * and less than half as wide as the factor of two it has to separate — which
 * is what makes the test decisive rather than a judgement.
 *
 * Not a doctrine constant: it asserts no training rule and prescribes nothing.
 * It is a shape check on a unit, the same kind of claim as "a run cannot move
 * for longer than it lasted".
 */
export const MIN_RUNNING_STRIDE_M = 0.80;
export const MAX_RUNNING_STRIDE_M = 2.05;

/**
 * The band a both-feet running cadence falls in, used ONLY for rows with no
 * clock or distance to derive a stride from. Coarser than the stride test on
 * purpose: 90 spm both feet is a slow shuffle and also a plausible per-leg
 * figure, and nothing but the stride can tell those two apart.
 */
export const MIN_RUNNING_CADENCE_SPM = 120;
export const MAX_RUNNING_CADENCE_SPM = 250;

/**
 * Cadence in steps per minute across BOTH FEET, whichever unit the row stored.
 *
 * `data.avgCadence` holds two quantities. Apple Watch writes a step rate;
 * Strava's `average_cadence` for a run is a PER-LEG count, half of it. 57 rows
 * here carry the per-leg figure (median 78 spm) and 179 carry the step rate
 * (median 161 spm), and nothing in the row says which — so a query that reads
 * the key raw makes the runner's cadence halve in May 2026, when what changed
 * was the importer.
 *
 * The test is the row's own arithmetic, not a band on the value: distance
 * divided by (cadence x minutes) is a stride length, and whichever of `cad`
 * and `cad x 2` puts it inside a human running stride is the step count.
 * Neither, and this returns NULL — a cadence whose unit cannot be established
 * is not a cadence. The full argument, including the 114 spm row a value-band
 * rule gets wrong, is in `lib/runs/coherence.ts` section 8.
 *
 * The bounds are IMPORTED from the reconciler rather than retyped, so the SQL
 * and the TypeScript cannot drift; `_cadence_units.test.ts` asserts the
 * literals in the emitted string are those constants.
 *
 * The clock is the SAME reconciliation `runFinishSec` performs and
 * `reconcileRun` performs: moving time when the row's own elapsed clock
 * supports it, elapsed when the implied pause exceeds `MAX_PAUSED_SHARE`.
 * That is not a nicety. On the pre-May-2026 Strava rows `elapsedTimeS` is a
 * genuine wall clock and runs up to 40% longer than the moving time, which is
 * enough to pull a per-leg cadence's implied stride down into the human band
 * and have this fragment leave it halved. An elapsed-first draft of this
 * function did exactly that to 5 of the 56 affected rows.
 */
export function runCadenceSpmSql(alias = ''): string {
  const d = col(alias);
  const cad = `NULLIF(${d}->>'avgCadence','')::numeric`;
  const mi = `NULLIF(${d}->>'distanceMi','')::numeric`;
  const moving = `COALESCE(NULLIF(${d}->>'movingTimeS','')::numeric, NULLIF(${d}->>'movingSec','')::numeric)`;
  const elapsed = `COALESCE(NULLIF(${d}->>'durationSec','')::numeric, NULLIF(${d}->>'elapsedTimeS','')::numeric)`;
  const sec = `CASE
      WHEN ${moving} IS NOT NULL AND ${elapsed} IS NOT NULL
           AND (1 - ${moving} / NULLIF(${elapsed}, 0)) BETWEEN 0 AND ${MAX_PAUSED_SHARE}
        THEN ${moving}
      WHEN ${moving} IS NOT NULL AND ${elapsed} IS NULL THEN ${moving}
      ELSE ${elapsed}
    END`;
  // metres per step at cadence x. NULL-safe: any missing input yields NULL and
  // both CASE arms fall through to the value-band fallback below.
  const stride = (mult: string) =>
    `(${mi} * 1609.34) / NULLIF((${cad}) * ${mult} * (${sec} / 60.0), 0)`;
  const lo = MIN_RUNNING_STRIDE_M;
  const hi = MAX_RUNNING_STRIDE_M;
  return `CASE
    WHEN ${cad} IS NULL OR ${cad} <= 0 THEN NULL
    WHEN ${stride('1')} BETWEEN ${lo} AND ${hi} THEN ${cad}
    WHEN ${stride('2')} BETWEEN ${lo} AND ${hi} THEN ${cad} * 2
    WHEN ${stride('1')} IS NOT NULL THEN NULL
    WHEN ${cad} BETWEEN ${MIN_RUNNING_CADENCE_SPM} AND ${MAX_RUNNING_CADENCE_SPM} THEN ${cad}
    WHEN ${cad} * 2 BETWEEN ${MIN_RUNNING_CADENCE_SPM} AND ${MAX_RUNNING_CADENCE_SPM} THEN ${cad} * 2
    ELSE NULL
  END`;
}

/**
 * Air temperature in FAHRENHEIT at the time of the run. NULL when the row was
 * never weather-enriched.
 *
 * ⚠ This is the TOP-LEVEL `tempF`, which is the key the enrichment writes.
 * Several call sites also reach for `tempF_peak`, `dewpointF`, `humidityPct`,
 * `conditions` and `cloudCoverPct` at the top level — NONE of those exist on
 * any row; they live inside `data->'weather'` under snake_case names. See the
 * migration report. Do not add fragments for them here without first checking
 * the live shape.
 */
export function runTempFSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'tempF','')::numeric`;
}

/* ── weather · the enrichment block ─────────────────────────────────────────
 *
 * `data->'weather'` is written by the weather enrichment and uses SNAKE_CASE
 * keys. Several call sites reach for camelCase equivalents at the TOP level
 * (`tempF_peak`, `dewpointF`, `humidityPct`, `conditions`, `cloudCoverPct`) —
 * a live census found those on ZERO rows out of 247. Only bare top-level
 * `tempF` exists (209 rows), written separately from the enrichment block.
 *
 * The consequence, found 2026-08-17: the quality-drift heat normalisation was
 * receiving temperature and nothing else, so the humidity surcharge and the
 * solar correction never applied. Its own header describes a fix that added
 * those inputs; the keys it added do not exist.
 *
 * DEWPOINT IS NOT STORED AT ALL. `humidity_pct` is, and `lib/training/
 * heat-model.ts` estimates dewpoint from temperature + humidity via
 * Magnus-Tetens. Ask for humidity and let the model do it.
 */

/** Peak air temperature (F) from the enrichment block, falling back to the
 *  mean and then to the top-level `tempF`. Peak is the right read for a heat
 *  cost: a run is paced by the worst of its conditions, not their average. */
export function runWeatherTempFSql(alias = ''): string {
  const d = col(alias);
  return `COALESCE(NULLIF(${d}->'weather'->>'temp_f_peak','')::numeric, ` +
         `NULLIF(${d}->'weather'->>'temp_f','')::numeric, ` +
         `NULLIF(${d}->>'tempF','')::numeric)`;
}

/** Relative humidity (%) from the enrichment block. Feeds the Magnus-Tetens
 *  dewpoint estimate — there is no stored dewpoint. */
export function runWeatherHumidityPctSql(alias = ''): string {
  const d = col(alias);
  return `COALESCE(NULLIF(${d}->'weather'->>'humidity_pct_peak','')::numeric, ` +
         `NULLIF(${d}->'weather'->>'humidity_pct','')::numeric)`;
}

/** Sky conditions text ('clear', 'cloudy', ...). Drives the solar correction. */
export function runWeatherConditionsSql(alias = ''): string {
  return `NULLIF(${col(alias)}->'weather'->>'conditions','')`;
}

/** Cloud cover (%). The numeric half of the solar correction. */
export function runWeatherCloudCoverPctSql(alias = ''): string {
  return `NULLIF(${col(alias)}->'weather'->>'cloud_cover_pct','')::numeric`;
}

/** Elevation gain in FEET. NULL when unmeasured. */
export function runElevGainFtSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'elevGainFt','')::numeric`;
}

/** The raw splits array, as jsonb. Normalise with `normalizeSplits` in TS —
 *  there are six element shapes and SQL is the wrong place to reconcile them. */
export function runSplitsSql(alias = ''): string {
  return `${col(alias)}->'splits'`;
}

/** The raw watch phases array, as jsonb. */
export function runPhasesSql(alias = ''): string {
  return `${col(alias)}->'phases'`;
}

/** The watch's run-level outcome. NULL on every row written before
 *  2026-08-17 — see the `status` field note for where it lives instead. */
export function runWatchStatusSql(alias = ''): string {
  return `${col(alias)}->>'status'`;
}

/** The `coach_intents.field` key the full watch payload is filed under. */
export function runWatchCompletionRefSql(alias = ''): string {
  return `${col(alias)}->>'watchCompletionRef'`;
}

/**
 * `workoutType` AS TEXT — which flattens BOTH taxonomies into one column.
 *
 * A Strava row arrives as `'1'` and a faff row as `'race'`. Comparing this to
 * a semantic name silently misses every Strava row; comparing it to a number
 * silently misses every faff row. Resolve it in TypeScript with
 * `runWorkoutType`, which returns a single semantic across both eras.
 */
export function runWorkoutTypeSql(alias = ''): string {
  return `${col(alias)}->>'workoutType'`;
}

/**
 * `plannedWorkoutType` AS TEXT — the family the PLAN asked for, which is a
 * different question from `workoutType`, the family the row turned out to be.
 * Written by the watch completion path only, so it is NULL on every Strava
 * row and on every manually-entered one. Null means "this row never came from
 * a prescription", not "the prescription was easy".
 *
 * Unlike `workoutType` this carries ONE taxonomy — faff semantics — because
 * nothing but faff ever wrote it. It is safe to compare against a semantic
 * name directly.
 */
export function runPlannedWorkoutTypeSql(alias = ''): string {
  return `${col(alias)}->>'plannedWorkoutType'`;
}

/** Which ingest path wrote the row. NULL on the oldest Strava rows — null
 *  means "old Strava", not "unknown". */
export function runSourceSql(alias = ''): string {
  return `${col(alias)}->>'source'`;
}

/**
 * The `type` key. MIXED SEMANTICS — 'Run' (Strava's activity type) on
 * Strava-era rows and 'easy' (a workout type) on some faff rows. Do not use it
 * to decide whether a row is a run.
 */
export function runTypeSql(alias = ''): string {
  return `${col(alias)}->>'type'`;
}

/** Treadmill / indoor flag, as boolean. NULL on the 75% of rows that predate
 *  the key — which is NOT the same as `false`. */
export function runIndoorSql(alias = ''): string {
  return `(${col(alias)}->>'indoor')::boolean`;
}

/** Elapsed-vs-moving display string, average pace as `m:ss`. Note this is a
 *  STRING, not seconds — `paceToSec` parses it. */
export function runAvgPaceDisplaySql(alias = ''): string {
  return `${col(alias)}->>'avgPaceMinPerMi'`;
}

/**
 * The merge-loser predicate, re-exported from its home in `lib/runs/volume.ts`
 * so a query that already imports the shape module does not have to reach for
 * a second import — and, more importantly, so nobody writes a third copy.
 *
 * This is the WEAK filter: it only excludes rows already MARKED as dedup
 * losers. For counting, summing or listing runs, prefer `getCanonicalRunIds`,
 * which clusters by physical-run identity and catches unmarked duplicates too.
 */
export { CANONICAL_ROW_SQL } from '@/lib/runs/volume';

/**
 * The aliased form of `CANONICAL_ROW_SQL`, for queries that alias the table.
 *
 * ⚠ Note the shape carefully: `NOT (data ? 'mergedIntoId')` tests KEY PRESENCE.
 * The tempting-looking `data->'mergedIntoId' IS NULL` is NOT the same
 * expression — for a row where the key exists with a JSON `null` value,
 * `data->'mergedIntoId'` yields JSON null rather than SQL NULL and the row is
 * classified the opposite way. No row in the live table carries that shape
 * today (145 rows satisfy both predicates, 0 carry a JSON-null marker), so the
 * two agree by luck rather than by construction. Use this one.
 */
/**
 * WHICH INSTRUMENT MEASURED THE CLIMB.
 *
 * `raw` is the watch's barometer; `gps_derived` is arithmetic over GPS
 * altitude and runs 2.3x the barometer on real data. A climb figure without
 * its source is unrankable, so the two are always read together. See
 * `lib/runs/elevation.ts` for the trust order.
 */
export function runElevGainSourceSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'elevGainSource','')`;
}

/** The canonical row this one was absorbed into, or NULL when it IS canonical. */
export function runMergedIntoIdSql(alias = ''): string {
  return `NULLIF(${col(alias)}->>'mergedIntoId','')`;
}

export function runNotMergedSql(alias = ''): string {
  return `NOT (${col(alias)} ? 'mergedIntoId')`;
}

/**
 * Rule 6 for the dedup pointer · a full-replace of `runs.data` that cannot
 * erase a `mergedIntoId` written after the payload was computed.
 *
 * ── WHY IT HAS TO EXIST ───────────────────────────────────────────────────
 *
 * Two writers build a whole new `data` object from a snapshot read earlier in
 * the same function — `enhanceCanonicalFromAbsorbed` (lib/runs/canonical.ts)
 * and pullSync's ENHANCE branch (lib/strava/pullSync.ts, whose snapshot is
 * separated from its write by an HTTP round-trip to Strava). Both wrote it
 * back with a bare `SET data = $1::jsonb`.
 *
 * `autoMergeForDate` fires from four ingest paths and the nightly cron. When
 * one of them flagged the same row inside that window, the full replace put
 * the pre-flag snapshot back — erasing `mergedIntoId`, a KEY, while
 * `absorbed_into_canonical_at`, a COLUMN, sat untouched. A row holding the
 * stamp and no pointer reads as canonical, is invisible to every repair, and
 * on seven of the owner's days it was the ONLY canonical row: 63.0 miles,
 * including a peak 18.00 mi long run, gone from the numbers that size a
 * marathon block.
 *
 * Neither writer has an opinion about the pointer — it is in both their
 * NEVER_COPY sets — so the correct answer is always the live row's. The CASE
 * takes it in both directions: keep a pointer that arrived after the snapshot,
 * and never resurrect one that left after it.
 *
 * `param` is the placeholder carrying the replacement object, e.g. `'$1'`.
 * Emits the right-hand side of `SET data = …`, so the caller writes
 * `SET data = ${preserveMergedIntoIdSql('$1')}`.
 */
export function preserveMergedIntoIdSql(param: string, table = 'runs'): string {
  const d = `${table}.data`;
  return `CASE
            WHEN ${d} ? 'mergedIntoId'
            THEN jsonb_set(${param}::jsonb, '{mergedIntoId}', ${d}->'mergedIntoId')
            ELSE ${param}::jsonb - 'mergedIntoId'::text
          END`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · ACCESSORS
 *
 * Every one returns `null` for absent. None of them defaults. A defaulted zero
 * is how "we did not measure this" becomes "this measured zero", and that is
 * the same failure the SQL fragments above exist to prevent.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Narrow an unknown blob to `RunData` without asserting anything about it. */
export function asRunData(v: unknown): RunData {
  return (v && typeof v === 'object' ? v : {}) as RunData;
}

/** A finite number, or null. Rejects NaN, Infinity, '' and non-numeric text. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A finite POSITIVE number, or null. For quantities where zero is not a
 *  measurement (distance, duration, pace).
 *
 *  EXPORTED 2026-09-01 for `lib/execution/verdict.ts`, which parses the same
 *  stored phases and needs the same answer for the same fields. A second copy
 *  there would be a second definition of "is this a measurement" over one
 *  payload (Rule 16) — and it is exactly what the coercion ratchet counted,
 *  correctly, because two of them is one too many. */
export function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

/**
 * THE local calendar day. Mirrors `runDaySql` exactly — `date` first, then the
 * first 10 characters of `startLocal`. Returns null when neither is usable.
 */
export function runDay(d: RunData): string | null {
  if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) return d.date;
  const s = typeof d.startLocal === 'string' ? d.startLocal.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Distance in MILES. Null when absent or non-positive. */
export function runDistanceMi(d: RunData): number | null {
  return pos(d.distanceMi);
}

/** Moving seconds — `movingTimeS` → `movingSec` → `durationSec`.
 *  Mirrors `runMovingSecSql`. */
export function runMovingSec(d: RunData): number | null {
  return pos(d.movingTimeS) ?? pos(d.movingSec) ?? pos(d.durationSec);
}

/**
 * Finish seconds — the clock a fitness estimate should be built on.
 *
 * ⚠ 2026-08-24 · THIS DID NOT MIRROR `runFinishSecSql`, AND SAID IT DID.
 *
 * The SQL fragment was reordered on 2026-08-17 to put `movingTimeS` first
 * (pace is distance over time spent *running*; see its header). This accessor
 * was not, and kept `durationSec` first while its own docstring claimed to
 * mirror the SQL "including its known bias toward paused time" — a sentence
 * describing an order the SQL had already stopped using. On the 28 production
 * rows where the two keys differ the pair returned different numbers, by up to
 * 2909 seconds.
 *
 * Latent rather than live: nothing outside the tests called this. That is the
 * only reason it never shipped a wrong VDOT, and it is not a reason to leave
 * it. A helper that answers a question differently from its own SQL twin is
 * the same contradiction one level up.
 *
 * Now: moving time when the row's own elapsed clock supports it, the elapsed
 * clock when it does not. That agrees with the SQL's intent AND refuses the
 * shape the SQL cannot see — a stored moving time implying more than
 * `MAX_PAUSED_SHARE` of the run was paused. Unlike `runMovingSec` this never
 * returns null when any clock exists: a finish time may fall back to
 * wall-clock, because a race that took an hour took an hour.
 */
export function runFinishSec(d: RunData): number | null {
  const elapsed = pos(d.durationSec) ?? pos(d.elapsedTimeS);
  const moving = pos(d.movingTimeS) ?? pos(d.movingSec);
  if (moving != null) {
    if (elapsed == null) return moving;
    const pausedShare = 1 - moving / elapsed;
    if (pausedShare >= 0 && pausedShare <= MAX_PAUSED_SHARE) return moving;
    return elapsed;
  }
  return elapsed;
}

/** Elapsed (wall-clock) seconds. Strava-era only. */
export function runElapsedSec(d: RunData): number | null {
  return pos(d.elapsedTimeS);
}

/**
 * Average heart rate. Null when unmeasured.
 *
 * Bounded to a physiologically possible range (>40, <230) for the same reason
 * `hrToNum` below is: a 0 or a 4 in this field is a sensor artefact, and
 * passing it through as a measurement is worse than admitting we have none.
 */
export function runAvgHr(d: RunData): number | null {
  return hrToNum(d.avgHr);
}

/** Max heart rate. Null when unmeasured. Same bounds as `runAvgHr`. */
export function runMaxHr(d: RunData): number | null {
  return hrToNum(d.maxHr);
}

/** Elevation gain in FEET. Null when unmeasured. Zero is a real measurement
 *  here (a flat run genuinely gains nothing), so this uses `num`, not `pos`. */
export function runElevGainFt(d: RunData): number | null {
  return num(d.elevGainFt);
}

/**
 * The largest share of a run that may plausibly be paused before its stored
 * moving-time pace stops being believable.
 *
 * Half. A runner waiting at lights, refilling a bottle or stopping to stretch
 * can lose a lot of a run to pauses; losing MORE than half of it and still
 * calling the remainder the same session is not a run this app has to render
 * faithfully. Well past any honest pause pattern, and comfortably tight enough
 * to catch a third party's arithmetic error.
 */
export const MAX_PAUSED_SHARE = 0.5;

/**
 * The reconciliation itself, as a function of three numbers — so every surface
 * that prints a pace beside a clock can hold the same invariant without
 * re-deriving the arithmetic or re-declaring the constant.
 *
 * Extracted 2026-08-24 by the surface sweep. `runPaceSecPerMi` fixed the READ,
 * which repaired every surface reading through it at once — but a composer
 * assembles its context from whatever the call site hands it, and a call site
 * that builds one WITHOUT going through the read had no guard at all. The
 * sweep drove the real 2026-08-23 row (11.01 mi, 5298s elapsed, a stored
 * 217 s/mi) straight into `composeV5Today` and `deriveRecap` and both printed
 * 3:37/mi again — the panel beside a clock that disproves it, the recap in
 * prose. One definition, three call sites, no way to drift.
 *
 * Returns the pace to trust: the stored one when the row's own clock allows
 * it, the elapsed pace when it does not, and null when there is nothing to
 * go on. It never invents a pace the row did not support.
 */
export function reconcilePaceWithClock(
  distanceMi: number | null | undefined,
  elapsedSec: number | null | undefined,
  storedPaceSPerMi: number | null | undefined,
): number | null {
  const mi = pos(distanceMi);
  const elapsed = pos(elapsedSec);
  const stored = pos(storedPaceSPerMi);
  if (stored == null) return mi != null && elapsed != null ? elapsed / mi : null;
  if (mi == null || elapsed == null) return stored;
  const elapsedPace = elapsed / mi;
  const impliedPausedShare = 1 - stored / elapsedPace;
  return impliedPausedShare > MAX_PAUSED_SHARE ? elapsedPace : stored;
}

/**
 * Average pace in seconds per mile.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A ROW CAN CARRY TWO PACES, AND ONE OF THEM CAN BE FICTION.
 *
 * 2026-08-24. David's 11.01 mile run on 2026-08-23 stored `durationSec` 5298
 * and `paceSPerMi` 217. The first is his watch's own clock and works out to
 * 8:01/mi, which is what he ran. The second is 3:37/mi, and its `movingSec` of
 * 2389 implies 16.6 mph for eleven miles.
 *
 * It came from Strava. Faff pushed the run there, Strava returned a moving
 * time that cannot be right, and the merge stamped it onto the canonical row
 * beside the watch's own figures rather than instead of them. This function
 * returned the stored key without question, so every surface that reads a pace
 * read the fiction — including the recap, which told him "Easy 11.0 mi at
 * 3:37/mi. A touch quicker than the 9:22/mi easy target."
 *
 * Six of his canonical rows disagree with themselves by more than 15 s/mi.
 *
 * THE ROW IS CHECKED AGAINST ITSELF. Moving time cannot exceed elapsed time,
 * so a stored pace implies a paused share, and a paused share above
 * `MAX_PAUSED_SHARE` is not a pause — it is a bad number. When that happens
 * the elapsed clock wins, because it is the one measurement the device that
 * ran the session made itself.
 *
 * This is arithmetic, not physiology: no doctrine claim, and no threshold on
 * human speed. A row is only ever judged against its own other facts, so it
 * stays correct for an elite and for a walker alike.
 *
 * Fixed at the READ, deliberately. It repairs every surface and every
 * historical row at once, with no migration and no rewriting of what the
 * sources actually said.
 */
export function runPaceSecPerMi(d: RunData): number | null {
  const mi = runDistanceMi(d);
  const direct = pos(d.paceSPerMi);
  const elapsed = pos(d.durationSec) ?? pos(d.elapsedTimeS);

  // Believe the stored pace unless the row's own clock contradicts it.
  if (direct != null) return reconcilePaceWithClock(mi, elapsed, direct);

  const sec = runMovingSec(d);
  return mi != null && mi > 0 && sec != null ? sec / mi : null;
}

/** True when this row is a dedup loser. Presence of the key is the signal;
 *  the value is not compared. */
export function isMergedAway(d: RunData): boolean {
  return d.mergedIntoId != null;
}

/**
 * Resolve `workoutType` across BOTH taxonomies.
 *
 * Returns the raw value alongside a single `semantic` so callers stop needing
 * to know whether a row came from Strava (numeric enum) or the faff watch
 * (semantic string). `semantic` is null when the row carries no classification
 * — which is the majority of rows, and is not a defect.
 *
 * The Strava mapping matches `STRAVA_WORKOUT_TYPE` in
 * `lib/training/vdot-inputs.ts`: 1 = race, 3 = workout (mapped to 'tempo').
 * 0 (default) and 2 (long run) carry no quality claim and resolve to null
 * there, so they resolve to null here too.
 */
export function runWorkoutType(d: RunData): {
  raw: number | string | null;
  era: 'strava-code' | 'faff-semantic' | 'none';
  semantic: FaffWorkoutType | null;
} {
  const raw = d.workoutType;
  if (typeof raw === 'number') {
    const semantic = raw === 1 ? 'race' : raw === 3 ? 'tempo' : null;
    return { raw, era: 'strava-code', semantic };
  }
  if (typeof raw === 'string' && raw !== '') {
    // A Strava code that has already been flattened to text by `->>`.
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      return { raw, era: 'strava-code', semantic: n === 1 ? 'race' : n === 3 ? 'tempo' : null };
    }
    return { raw, era: 'faff-semantic', semantic: raw as FaffWorkoutType };
  }
  return { raw: null, era: 'none', semantic: null };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · NORMALISED SPLITS
 *
 * `data.splits` holds SIX distinct element shapes. Not two — six. Measured
 * across the live table, by key-set:
 *
 *   838 elems · 100 rows · avgHr, paceSPerMi, mile, elevDeltaFt, gapSPerMi
 *   500 elems ·  56 rows · hr, pace, mile, distanceMi, elev_ft, cadence
 *   282 elems ·  31 rows · split, distance, moving_time, average_speed, …
 *   150 elems ·  20 rows · hr, pace, paceSecPerMi, mile
 *    41 elems ·   6 rows · hr, pace, mile, elev_ft, cadence
 *    27 elems ·   5 rows · … + average_heartrate            (Strava-raw + HR)
 *   + a handful of watch phase-shaped rows carrying avgHr / paceSecPerMi
 *
 * Three different names for heart rate (`hr`, `avgHr`, `average_heartrate`),
 * four for pace (`pace` as `m:ss` STRING, `paceSPerMi`, `paceSecPerMi`, and
 * Strava's `average_speed` in METRES PER SECOND), and two unit systems — the
 * Strava-raw shape's `distance` is METRES while `distanceMi` is miles.
 *
 * Code that assumes one shape gets silently nothing on rows carrying another,
 * which is bug #5. This normaliser is the one place that knowledge lives.
 * ═══════════════════════════════════════════════════════════════════════ */

/** One split, normalised. Every field null when that shape did not carry it. */
export interface NormalizedSplit {
  /** 1-based split index. */
  mile: number | null;
  /** Average heart rate over the split, bpm. */
  hr: number | null;
  /** Pace, seconds per mile. */
  paceSec: number | null;
  /** Distance covered by the split, MILES (converted from metres where the
   *  source shape used them). */
  distanceMi: number | null;
  /** Elevation change over the split, FEET. Signed. */
  elevFt: number | null;
  /** Steps per minute. */
  cadence: number | null;
  /** Which source shape this element came from — useful for diagnostics and
   *  for the deliberate shape restriction in `computeAerobicDecoupling`. */
  shape: SplitShape;
}

export type SplitShape =
  /** `avgHr` + `paceSPerMi` (+ `elevDeltaFt`, `gapSPerMi`) — the dominant
   *  faff shape by element count. */
  | 'faff-avghr'
  /** `hr` + `pace`/`paceSecPerMi` (+ `elev_ft`, `cadence`) — the other faff
   *  shape; `pace` is a `m:ss` display string. */
  | 'faff-hr'
  /** Strava's own per-split object: `split`, `distance` (METRES),
   *  `moving_time`, `average_speed` (m/s), optional `average_heartrate`. */
  | 'strava-raw'
  /** A watch phase object that landed in `splits` — `type`, `label`,
   *  `avgHr`, `paceSecPerMi`, `durationSec`. */
  | 'watch-phase'
  | 'unknown';

const METRES_PER_MILE = 1609.344;

/**
 * Parse a pace value to seconds per mile.
 * Accepts `m:ss` strings, numeric seconds, and numeric strings.
 */
export function paceToSec(p: unknown): number | null {
  if (p == null) return null;
  if (typeof p === 'number') return Number.isFinite(p) && p > 0 ? p : null;
  if (typeof p !== 'string') return null;
  if (/^\d+:\d{1,2}$/.test(p)) {
    const [m, s] = p.split(':').map((x) => parseInt(x, 10));
    return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
  }
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse a heart-rate value, bounded to what a human can produce.
 *
 * The >40 / <230 bounds are lifted verbatim from `aerobic-decoupling.ts`, so
 * that every consumer of this module and that one agree on what counts as a
 * heart rate. A reading outside them is a sensor artefact, and returning null
 * says "we have no HR here", which is true.
 */
export function hrToNum(h: unknown): number | null {
  if (h == null) return null;
  const raw = typeof h === 'number' ? h : Number(h);
  if (!Number.isFinite(raw)) return null;
  /* A HEART RATE IS A COUNT OF BEATS (2026-08-24).
   *
   * Strava stores `average_heartrate` as a float and 68 of the 256 canonical
   * rows carry one — 145.8, 151.4. This reader passed the tenths straight
   * through and the recap printed them: "Long run done · 5.3 mi · avg HR
   * 145.8 · kept it aerobic."
   *
   * Nothing in the app resolves a tenth of a beat. The zone bands are whole
   * bpm, the plan's HR cap is a whole bpm, `judgeEasyRunHr` compares against
   * a whole bpm, and the sensor reports whole beats which something upstream
   * averaged. A decimal place there is precision the measurement does not
   * have, printed as though it did.
   *
   * Rounded BEFORE the bounds, so a 229.6 does not round up out of the range
   * it was admitted under.
   */
  const n = Math.round(raw);
  return n > 40 && n < 230 ? n : null;
}

/** Identify which of the six shapes an element is. */
function shapeOf(s: Record<string, unknown>): SplitShape {
  if ('split' in s || 'average_speed' in s || 'moving_time' in s) return 'strava-raw';
  if ('type' in s && ('label' in s || 'completed' in s)) return 'watch-phase';
  if ('avgHr' in s || 'paceSPerMi' in s) return 'faff-avghr';
  if ('hr' in s || 'pace' in s || 'paceSecPerMi' in s) return 'faff-hr';
  return 'unknown';
}

/**
 * Normalise a raw `data.splits` (or `data.splits_metric`) array into one type,
 * so no consumer has to know which era the row came from.
 *
 * Elements that are not objects are dropped. Elements whose shape carries no
 * usable signal still come back, with every field null — dropping them here
 * would hide the difference between "this run has no splits" and "this run's
 * splits are in a shape we do not understand", which is exactly the confusion
 * the module exists to end.
 *
 * `metric: true` tells the Strava-raw branch that `distance` is in METRES per
 * KILOMETRE split rather than per mile split; it changes nothing about the
 * conversion (metres are metres) but documents the caller's intent.
 */
export function normalizeSplits(
  raw: unknown,
  opts: { shapes?: readonly SplitShape[] } = {},
): NormalizedSplit[] {
  if (!Array.isArray(raw)) return [];
  const allow = opts.shapes;
  const out: NormalizedSplit[] = [];

  for (const el of raw) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
    const s = el as Record<string, unknown>;
    const shape = shapeOf(s);
    if (allow && !allow.includes(shape)) continue;

    // Heart rate · three spellings across the shapes, plus `hrAvgBpm` which
    // no row carries today but which older consumers already accepted.
    const hr = hrToNum(s.hr ?? s.avgHr ?? s.average_heartrate ?? s.hrAvgBpm);

    // Pace · numeric seconds, `m:ss` strings, or Strava's speed in m/s.
    let paceSec = paceToSec(s.pace ?? s.paceSPerMi ?? s.paceSecPerMi ?? s.actualPaceSPerMi);
    if (paceSec == null) {
      const mps = typeof s.average_speed === 'number' ? s.average_speed : null;
      if (mps != null && mps > 0) paceSec = METRES_PER_MILE / mps;
    }
    if (paceSec == null) {
      // Strava-raw also carries the raw ingredients; derive rather than abstain.
      const metres = typeof s.distance === 'number' ? s.distance : null;
      const secs = typeof s.moving_time === 'number' ? s.moving_time
                 : typeof s.elapsed_time === 'number' ? s.elapsed_time : null;
      if (metres != null && metres > 0 && secs != null && secs > 0) {
        paceSec = secs / (metres / METRES_PER_MILE);
      }
    }

    // Distance · miles directly, or metres from the Strava-raw shape.
    let distanceMi = pos(s.distanceMi ?? s.actualDistanceMi ?? s.mi);
    if (distanceMi == null && typeof s.distance === 'number' && s.distance > 0) {
      distanceMi = s.distance / METRES_PER_MILE;
    }

    // Elevation · feet directly, or metres from Strava's signed difference.
    let elevFt = num(s.elevDeltaFt ?? s.elev_ft);
    if (elevFt == null && typeof s.elevation_difference === 'number') {
      elevFt = s.elevation_difference * 3.280839895;
    }

    out.push({
      mile: num(s.mile ?? s.split ?? s.index),
      hr,
      paceSec: paceSec != null && Number.isFinite(paceSec) && paceSec > 0 ? paceSec : null,
      distanceMi,
      elevFt,
      cadence: pos(s.cadence ?? s.avgCadence),
      shape,
    });
  }
  return out;
}

/**
 * The split shapes that `computeAerobicDecoupling` has ALWAYS been able to
 * read, named so the restriction is visible instead of accidental.
 *
 * Its previous local extractor keyed on `hr`/`avgHr`/`hrAvgBpm` and
 * `pace`/`paceSPerMi`/`paceSecPerMi`, which covers the two faff shapes and the
 * watch-phase shape and covers NOTHING of the Strava-raw shape — no `hr`, no
 * `pace`, so every element fell out and the run produced no signal.
 *
 * 36 rows in the census carry Strava-raw elements inside `splits`. Widening
 * this list would light up decoupling on those runs — a behaviour change, and
 * deliberately not made here. It is a one-line change when someone wants it.
 */
export const DECOUPLING_SPLIT_SHAPES: readonly SplitShape[] =
  ['faff-avghr', 'faff-hr', 'watch-phase', 'unknown'];

/**
 * Splits reduced to the (hr, paceSec) pairs both signals are present on.
 *
 * This is `extractValidSplits`, lifted out of `lib/training/aerobic-decoupling.ts`
 * so it stops being a private third opinion about split shape. Pass
 * `DECOUPLING_SPLIT_SHAPES` to reproduce that function's historical reach
 * exactly; pass nothing to read every shape.
 */
export function splitsWithHrAndPace(
  raw: unknown,
  opts: { shapes?: readonly SplitShape[] } = {},
): Array<{ hr: number; paceSec: number }> {
  return normalizeSplits(raw, opts)
    .filter((s): s is NormalizedSplit & { hr: number; paceSec: number } =>
      s.hr != null && s.paceSec != null)
    .map((s) => ({ hr: s.hr, paceSec: s.paceSec }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · WATCH PHASES
 *
 * `data.phases` is the richest thing in the blob and, until now, the only one
 * with no shared reader — five call sites hand-roll `Number(p.actualPaceSPerMi)`
 * against an `unknown[]`, each with its own idea of which phase types count as
 * work (`glance-state` takes `type === 'work'`; `run-win` takes
 * `'work' | 'tempo' | 'threshold'`, two of which no phase has ever carried).
 *
 * The array holds three eras, and they differ in what is POPULATED rather than
 * in key names:
 *
 *   · WATCH     — every field. `index`, `verdict`, `timeInToleranceSec` and
 *                 `targetPaceSPerMi` all present.
 *   · TREADMILL — `TreadmillView.buildPayload` writes its own dict: no
 *                 `index`, no `targetPaceSPerMi`, no `verdict`, no tolerance
 *                 counters. `actualPaceSPerMi` on a treadmill phase is the
 *                 belt speed, so it is exact rather than GPS-estimated.
 *   · PHONE     — `PhoneRunTracker`, same shape as the watch.
 *
 * So a reader that requires `verdict` silently drops every treadmill session,
 * and one that requires `index` mis-orders them. Both are absence-of-recording,
 * never a judgement, and this normaliser keeps them distinguishable.
 * ═══════════════════════════════════════════════════════════════════════ */

/** The watch's own per-phase grade, computed on the device against the
 *  server's tolerance. `WorkoutEngine.buildCompletion`:
 *
 *    incomplete · the runner ended the phase before reaching its target
 *    hit        · the completed segment AVERAGE was inside the window, or
 *                 under the ceiling
 *    fast       · quicker than the window's fast edge, or past the ceiling
 *    slow       · slower than the window's slow edge. A ceiling phase can
 *                 never be `slow` — slower than a ceiling is correct running
 *    drifted    · LEGACY, pre-2026-09-01 builds only
 *    missed     · LEGACY, pre-2026-09-01 builds only
 *
 *  Null when the phase had no target to grade against (recoveries, and every
 *  treadmill phase).
 *
 *  The vocabulary and the two legacy words are owned by
 *  `lib/training/execution-semantics.ts` — see `WirePhaseVerdict` there for
 *  why `missed` had to be split into `fast` and `slow` (it was returned on a
 *  rep the runner ran THREE SECONDS A MILE QUICKER than asked) and why
 *  `drifted` stopped being a verdict. */
export type PhaseVerdict = WirePhaseVerdict;

export type PhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

/** One watch phase, normalised. Null means "this era did not record it". */
export interface NormalizedPhase {
  /** Position in the workout. Falls back to array order when the payload
   *  omits `index` (every treadmill phase does). */
  index: number;
  type: PhaseType | null;
  label: string | null;
  targetPaceSPerMi: number | null;
  actualPaceSPerMi: number | null;
  actualDurationSec: number | null;
  actualDistanceMi: number | null;
  avgHr: number | null;
  /** Whether the phase ran to its target. `false` on the phase the runner was
   *  in when they ended the workout. Null when the payload omitted it. */
  completed: boolean | null;
  verdict: PhaseVerdict | null;
  timeInToleranceSec: number | null;
  timeOutOfToleranceSec: number | null;
}

const PHASE_TYPES: readonly string[] = ['warmup', 'work', 'recovery', 'cooldown'];
const PHASE_VERDICTS: readonly string[] = WIRE_PHASE_VERDICTS;

/** Normalise `data.phases`. Returns [] when the row carries none. */
export function runPhases(d: RunData): NormalizedPhase[] {
  const raw = d.phases;
  if (!Array.isArray(raw)) return [];
  const out: NormalizedPhase[] = [];
  raw.forEach((el, i) => {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return;
    const p = el as Record<string, unknown>;
    const idx = num(p.index);
    const type = typeof p.type === 'string' && PHASE_TYPES.includes(p.type)
      ? (p.type as PhaseType) : null;
    const verdict = typeof p.verdict === 'string' && PHASE_VERDICTS.includes(p.verdict)
      ? (p.verdict as PhaseVerdict) : null;
    out.push({
      index: idx ?? i,
      type,
      label: typeof p.label === 'string' ? p.label : null,
      targetPaceSPerMi: pos(p.targetPaceSPerMi),
      actualPaceSPerMi: pos(p.actualPaceSPerMi),
      actualDurationSec: pos(p.actualDurationSec),
      actualDistanceMi: pos(p.actualDistanceMi),
      avgHr: hrToNum(p.avgHr),
      completed: typeof p.completed === 'boolean' ? p.completed : null,
      verdict,
      timeInToleranceSec: num(p.timeInToleranceSec),
      timeOutOfToleranceSec: num(p.timeOutOfToleranceSec),
    });
  });
  return out;
}

/** The watch's run-level outcome, when the row carries it. See the `status`
 *  field note — `abandoned` means the workout ended before its last phase,
 *  which is NOT the same as the runner giving up. */
export function runWatchStatus(d: RunData): 'completed' | 'partial' | 'abandoned' | null {
  const s = d.status;
  return s === 'completed' || s === 'partial' || s === 'abandoned' ? s : null;
}

/** The `coach_intents.field` key this run's full watch payload is filed
 *  under, for rows written before `status` was persisted onto the run. */
export function runWatchCompletionRef(d: RunData): string | null {
  return typeof d.watchCompletionRef === 'string' && d.watchCompletionRef !== ''
    ? d.watchCompletionRef : null;
}

/**
 * Did the runner stop INSIDE the work?
 *
 * The predicate the run-level `status` is repeatedly mistaken for. A workout
 * whose cool-down was cut short is `abandoned` and was fully executed; a
 * workout whose fourth rep lasted six seconds is `abandoned` and was not.
 * Only the second is evidence about the athlete.
 *
 * Returns null rather than false when the payload records no `completed`
 * flags at all (treadmill rows before the field was written) — "we cannot
 * see" and "they finished" must not be the same answer.
 */
export function watchStoppedInsideWork(phases: NormalizedPhase[]): boolean | null {
  const work = phases.filter((p) => p.type === 'work');
  if (work.length === 0) return null;
  const known = work.filter((p) => p.completed != null);
  if (known.length === 0) return null;
  return known.some((p) => p.completed === false);
}

/**
 * Share of graded time the runner spent inside the pace band, across the work
 * phases. The device computed the two counters against the SERVER's own
 * tolerance, so this is the closest thing to a ground-truth execution read
 * anywhere in the system — and nothing consumed it until now.
 *
 * Null when no work phase carried the counters (every treadmill session, and
 * any phase with no target).
 */
export function workToleranceShare(phases: NormalizedPhase[]): number | null {
  let inSec = 0, outSec = 0;
  for (const p of phases) {
    if (p.type !== 'work') continue;
    if (p.timeInToleranceSec == null || p.timeOutOfToleranceSec == null) continue;
    inSec += p.timeInToleranceSec;
    outSec += p.timeOutOfToleranceSec;
  }
  const total = inSec + outSec;
  return total > 0 ? inSec / total : null;
}
