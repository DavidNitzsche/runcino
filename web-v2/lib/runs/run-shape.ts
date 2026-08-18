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
   *  per-phase verdicts live. */
  phases?: unknown[];

  /** The watch's own id for the completion this row came from. 28% / 42%. */
  watchCompletionRef?: string;
  client_workout_id?: string;

  /* ── running dynamics · HealthKit era only ────────────────────────────── */

  /** All four appear together on the same 98 rows, all nullable. */
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
  return `COALESCE(NULLIF(${d}->>'movingTimeS','')::numeric, ` +
         `NULLIF(${d}->>'movingSec','')::numeric, ` +
         `NULLIF(${d}->>'durationSec','')::numeric)`;
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
  return `COALESCE(NULLIF(${d}->>'movingTimeS','')::numeric, ` +
         `NULLIF(${d}->>'movingSec','')::numeric, ` +
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
export function runNotMergedSql(alias = ''): string {
  return `NOT (${col(alias)} ? 'mergedIntoId')`;
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
 *  measurement (distance, duration, pace). */
function pos(v: unknown): number | null {
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

/** Finish seconds as the VDOT path defines it — `durationSec` first.
 *  Mirrors `runFinishSecSql`, including its known bias toward paused time. */
export function runFinishSec(d: RunData): number | null {
  return pos(d.durationSec) ?? pos(d.movingTimeS) ?? pos(d.movingSec) ?? pos(d.elapsedTimeS);
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

/** Average pace in seconds per mile, from the numeric key or derived from
 *  distance and moving time. Null when neither is available. */
export function runPaceSecPerMi(d: RunData): number | null {
  const direct = pos(d.paceSPerMi);
  if (direct != null) return direct;
  const mi = runDistanceMi(d);
  const sec = runMovingSec(d);
  return mi != null && sec != null ? sec / mi : null;
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
  const n = typeof h === 'number' ? h : Number(h);
  return Number.isFinite(n) && n > 40 && n < 230 ? n : null;
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
