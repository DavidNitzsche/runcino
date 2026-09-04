/**
 * POST /api/watch/workouts/complete
 *
 * The watch hands the phone a WatchCompletion payload via transferUserInfo;
 * the phone POSTs here. Idempotent on (workoutId) — re-POSTing the same
 * workoutId overwrites, so the watch's durable retry queue is safe.
 *
 * Three callers share this one endpoint + wire shape (see `source` below):
 *   · watch      — Apple Watch app, via the iPhone relay above
 *   · treadmill  — TreadmillView.swift, iPhone POSTs directly (2026-06-01)
 *   · phone      — PhoneRunTracker.swift, iPhone POSTs directly, for
 *                  runners with no paired/reachable Apple Watch
 *                  (wave3b/phone-gps-recording, 2026-07-07)
 * All three route through WatchSync.saveCompletionDurably's durable queue
 * on the iPhone side, so a failed POST here is "retries later," not "lost."
 *
 * Persists into two tables (P21):
 *   1. coach_intents (reason='watch_completion', value=raw payload) —
 *      preserves the full per-phase breakdown for the coach's
 *      getWorkoutCompletion tool.
 *   2. strava_activities (data jsonb, source='watch') — gives all the
 *      OTHER readers (mode resolver, getRuns, run detail, log view)
 *      the same "the runner ran today" truth that Strava ingest gives.
 *      Without this, the watch could finish a run but pre-run mode
 *      would still fire on /today.
 *
 * Contract: docs/coach/WATCH_CONTRACT.md
 * Payload spec: docs/WATCH_COMPLETION_PAYLOAD.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import { sanitizeSplits } from '@/lib/runs/split-sanity';
import { splitTimesReliable, splitsSumSeconds } from '@/lib/runs/split-coverage';
import { requireUserId } from '@/lib/auth/session';
import { isSubThresholdRun, MIN_DISTANCE_MI, MIN_DURATION_SEC } from '@/lib/runs/length-guard';
import { deriveSplitsFromPaceSamples } from '@/lib/runs/derive-splits';
import { bucketHrSamplesByZone } from '@/lib/coach/hr-zone-bucket';
import { computeZones } from '@/lib/training/zones';

/** Seconds of slack between a run's wall clock and the time it accounts for.
 *  Covers the End-confirm tap, the final partial tick, and the POST itself. */
const CLOCK_DRIFT_TOLERANCE_SEC = 45;
import { classifyRunDistance, DISTANCE_REVIEW_FLAG, SOFT_DISTANCE_CEILING_MI, HARD_DISTANCE_CEILING_MI } from '@/lib/runs/distance-guard';
import { runnerTimezone, runnerToday } from '@/lib/runtime/runner-tz';
import { toUtcIso, toLocalWallIso } from '@/lib/runs/normalize-time';

// ── WatchCompletionBody · canonical typed contract ───────────────────────
// Matches the watch-app WatchCompletion + WatchCompletionPhase in
// legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift (the
// sender). iPhone relay passes raw bytes through; treadmill builds its own
// dict. Both land here — all fields are optional so older payloads decode.
//
// Tier-1 telemetry (2026-06-02): paceSamples / hrSamples / tolerance /
// verdict per phase. Stored raw in coach_intents.value for downstream reads.
// Tier-2 (2026-06-02, UI rescinded): repRpe / repRpeTag always nil on wire.
interface WatchCompletionPhaseSample { tSec: number; paceSPerMi?: number | null; distMi?: number; bpm?: number | null; }
interface WatchCompletionPhaseBody {
  index?: number;
  type?: string;
  label?: string;
  targetPaceSPerMi?: number | null;
  actualPaceSPerMi?: number | null;
  actualDurationSec?: number;
  actualDistanceMi?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  // 2026-08-27 · treadmill watch bridge, phase-scoped. Same watch
  // HKWorkoutSession that already streams HR (TreadmillHRStreamer.swift)
  // also samples these at the same fast cadence. Names match `RunData`
  // (lib/runs/run-shape.ts) exactly — the same fields the HealthKit-import
  // path (`/api/ingest/workout`) already writes for outdoor runs, so a
  // treadmill-bridge value and an imported value land in the same slot.
  // `kcal` is a SUM of active-energy samples across the phase; the other
  // four are the phase mean. Absent, not zero, when no watch answered the
  // bridge ask.
  avgPowerW?: number | null;
  avgGctMs?: number | null;
  avgVertOscCm?: number | null;
  avgStrideLengthM?: number | null;
  kcal?: number | null;
  completed?: boolean;
  paceSamples?: WatchCompletionPhaseSample[] | null;
  hrSamples?: WatchCompletionPhaseSample[] | null;
  timeInToleranceSec?: number | null;
  timeOutOfToleranceSec?: number | null;
  verdict?: string | null;
  // PACE-PURPOSE-1 (2026-09-05) · echoed back from `WatchPhase.paceShape` /
  // `.purpose` (`lib/watch/build-workout.ts`) when the wrist has them, so
  // `gradeStoredPhases` (`lib/execution/verdict.ts`) can read the AUTHORED
  // shape/purpose directly instead of falling back to the marathon-pace
  // label regex. Declared here even though undeclared keys already survive
  // to `runs.data.phases` verbatim (Rule 20 — a field worth reading deserves
  // a type, not just a comment saying it's there).
  paceShape?: string | null;
  purpose?: string | null;
  repRpe?: number | null;
  repRpeTag?: string | null;
  // Treadmill-only extras (TreadmillView.buildPayload)
  actualSpeedMph?: number;
  actualInclinePct?: number;
  // 2026-08-21 · seconds inside this phase the console did not witness
  // (screen locked / app backgrounded), and the distance credited across
  // them at the last known belt speed. Absent on a clean phase. A treadmill
  // has no sensor of its own, so an unwitnessed second is the one place its
  // distance stops being a reading and becomes an estimate — recorded here
  // rather than left for a reader to infer.
  unmeasuredSec?: number;
  unmeasuredDistanceMi?: number;
}
interface WatchCompletionBody {
  workoutId: string;
  startedAt?: string;
  completedAt?: string;
  status?: string;            // 'completed' | 'partial' | 'abandoned'
  totalDistanceMi?: number | null;
  totalDurationSec?: number;
  /// Seconds the runner was actually MOVING. Optional — the watch and the
  /// treadmill console do not send it, and older phone builds did not either.
  movingSec?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  kcal?: number | null;
  // 2026-08-27 · treadmill watch bridge, session-level — same fields as
  // WatchCompletionPhaseBody above, whole-run rollup. See that interface's
  // comment for the naming rationale (matches RunData / the HealthKit
  // import path) and the sum-vs-mean split.
  avgPowerW?: number | null;
  avgGctMs?: number | null;
  avgVertOscCm?: number | null;
  avgStrideLengthM?: number | null;
  source?: string;            // 'watch' | 'treadmill' | 'phone' — backend whitelists
  indoor?: boolean;           // spliced in by treadmill path
  timezone?: string;          // spliced in by iPhone relay (WatchSync)
  phases?: WatchCompletionPhaseBody[];
  // 2026-06-09 Phase 2 (3.2) · contingency-rule outcomes. Optional ·
  // camelCase per the wire contract (the watch's Encodable emits camel;
  // the route_polyline snake-case lesson). Each entry records a breach
  // the watch detected + what the runner CHOSE — taking the bail is a
  // decision, not a failure, and the recap reasons about it that way.
  // Shape: {kind: 'pass'|'bail'|'abort', label, breached: bool,
  //         actionTaken: bool, atMi?: number}.
  ruleOutcomes?: Array<{
    kind?: string; label?: string; breached?: boolean;
    actionTaken?: boolean; atMi?: number | null;
  }> | null;
  // ── 0821 watch design · the other three wrist decisions ─────────────────
  //
  // The bail already rides `ruleOutcomes` above. These are the three the
  // watch could take and had nowhere to put. All optional, all camelCase
  // (the watch's WatchCompletion is Encodable with NO CodingKeys, so the
  // wire IS the Swift property names — a snake_case read once dropped every
  // GPS track, `6616d766`).
  //
  // TWO CONTRACTS THESE SHAPES MUST HOLD, and the reasons they exist:
  //
  //  1 · A DECISION IS NOT A LAPSE, AND THE DATA SAYS SO. A phase's
  //      `completed: false` means "this rep did not happen" and says nothing
  //      about why: a rep the runner chose to skip and a rep that fell over
  //      when the watch died are the same value. The phone's run-detail
  //      screen draws "Five of six · you chose it, we did not lose it", so
  //      if it had to infer which one it was it would eventually infer wrong
  //      and call a choice a failure on the one screen whose job is not to.
  //      `repSkips` is therefore an explicit record, never a flag derived
  //      from the phase array. "Was this chosen?" is answered by a field.
  //
  //  2 · EVERY DECISION CARRIES ITS OWN QUANTITIES. Those rows render with
  //      no colour, no chevron and nothing tappable, so the reason is the
  //      only thing that separates a decision from a bare fact. The phone
  //      owns the sentences; what has to arrive here is every NUMBER those
  //      sentences need — the reading AND the limit (never a delta: "ran to
  //      174, the ceiling was 165", not "+9 over"), which rep and out of how
  //      many, how many extensions and between which reps.
  //
  // On temperature: the ceiling row's "and it was 27 degrees" clause is NOT
  // carried here. Nothing in this product has a thermometer — a run's
  // temperature is a weather model for a grid square and an hour bucket —
  // and the watch measures it least of all. It reaches the phone from the
  // run row's own `tempF`, written by the weather enrichment, which is
  // absent often enough that the phone must already be able to drop the
  // clause. Putting a number the watch cannot read on the watch's own wire
  // would launder a model into a reading.

  /** The ceiling was lifted FOR THE DAY. Singular by design: the board asks
   *  once and the answer holds. Carries the reading and the limit as two
   *  separate figures. */
  ceilingLift?: {
    /** The ceiling that was in force, bpm. */
    ceilingBpm?: number | null;
    /** What heart rate actually read when the runner lifted it, bpm. */
    readingBpm?: number | null;
    phaseIndex?: number | null;
    phaseLabel?: string | null;
    atMi?: number | null;
    atSec?: number | null;
  } | null;

  /** Reps the runner CHOSE to skip. One entry per skip. Distinct from a
   *  phase carrying `completed: false`, which is every other way a rep can
   *  fail to happen. */
  repSkips?: Array<{
    /** 1-based · which rep was skipped ("the fourth rep"). */
    repIndex?: number | null;
    /** How many reps the session asked for ("of six"). */
    repCount?: number | null;
    /** How many were actually run ("Five of six"). Filled by the watch at
     *  completion, when it knows; null when it does not, and the phone
     *  drops that half of the line rather than computing it. */
    repsCompleted?: number | null;
    phaseIndex?: number | null;
    phaseLabel?: string | null;
    atMi?: number | null;
    atSec?: number | null;
  }> | null;

  /** Recovery the runner extended. One entry per +30 s, so the count is the
   *  array length ("Twice") and the boundaries are on the entries
   *  ("between reps two and four"). */
  recoveryExtensions?: Array<{
    /** 1-based · the rep just finished. */
    afterRepIndex?: number | null;
    /** 1-based · the rep it delayed. */
    beforeRepIndex?: number | null;
    repCount?: number | null;
    /** Seconds this one extension added. */
    addedSec?: number | null;
    phaseIndex?: number | null;
    phaseLabel?: string | null;
    atSec?: number | null;
  }> | null;
  // GPS polyline shipped directly by the watch app (build 172+). Eliminates
  // the separate iPhone HK import hop that was the sole GPS source.
  // 2026-06-08 · the watch's WatchCompletion (Encodable, no CodingKeys)
  // emits CAMELCASE `routePolyline` on the wire; the original `route_polyline`
  // read silently dropped every watch GPS track (Jun 8 regression). Declare
  // both shapes; the read site prefers camel and falls back to snake.
  routePolyline?: string | null;
  route_polyline?: string | null;
  // 2026-08-21 · run-level totals of the same. `droppedGapSec` is time the
  // console declined to credit at all: a gap longer than its ceiling, which
  // is how a phone left in a locker stops becoming a fourteen-mile run.
  unmeasuredSec?: number;
  unmeasuredDistanceMi?: number;
  droppedGapSec?: number;
  pausedSec?: number;
  // 2026-08-21 · where an INDOOR run's distance came from. A treadmill has
  // no odometer the phone can read, so `totalDistanceMi` is integrated from
  // the belt speed the runner typed in — a stated number, not a measured
  // one, and the 2026-08-20 defect in full: the runner moved the belt and
  // nothing told the app, so the app read low against the machine's own
  // display. `IndoorDistanceMeter` (CoreMotion) now provides a second,
  // genuinely measured reading when the phone was carried.
  //   'belt_stated'       nothing measured it
  //   'belt_corroborated' a carried phone agreed within tolerance
  //   'belt_contested'    a carried phone measured materially differently
  distanceSource?: string;
  pedometerDistanceMi?: number;
  pedometerSteps?: number;
  pedometerAvailable?: boolean;
  // The client's own audit of its clock: wall time minus (running + paused +
  // declined). Non-zero means the tracker dropped ticks.
  clockDriftSec?: number;
  // Device-measured elevation GAIN in feet, from the watch's barometer-fused
  // altitude (build 17x+). camelCase — same wire-contract lesson as
  // routePolyline (the Encodable struct emits camelCase; a snake_case read
  // silently dropped GPS for a day). Preferred over the GPS-polyline estimate.
  elevGainFt?: number | null;
  // Legacy fallback fields — older clients; prefer startedAt for date
  date?: string;
  dateLocal?: string;
}

/**
 * GET /api/watch/workouts/complete?workoutId=<the id the watch minted>
 *
 * Resolves the `runs.id` (the same synthetic bigint `stableId` this route's
 * POST derives from `effectiveWorkoutId` via SHA-1) for a completion this
 * endpoint already accepted. Added so the watch's own post-run effort
 * screen can hit `/api/runs/[id]/rpe` — the exact same route and table the
 * iPhone's effort picker writes to (`post_run_rpe`) — without re-deriving
 * that hash client-side. Recomputing a server-derived id on-device is
 * exactly the kind of duplicated-logic drift Rule 16 warns about, and the
 * cross-day fork above means the naive `workoutId` and the row's actual
 * `client_workout_id` can legitimately differ by an `@YYYY-MM-DD` suffix —
 * so this matches on prefix, not on equality alone, and takes the newest
 * match when more than one row was ever forked from the same start.
 *
 * Returns `{ ok: true, id: number | null }` — null when the completion
 * this workoutId names hasn't landed in `runs` yet (still in flight on the
 * durable queue), which is a normal, retryable state, not an error. A
 * genuine read failure is a DIFFERENT fact (Rule 11: "don't know",
 * "measured zero" and "the read failed" are three states, never one) and
 * comes back as a 500 instead of a false `id: null` — collapsing the two
 * would tell the watch's queue "this run does not exist yet" when the
 * honest answer is "the database could not be asked".
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const workoutId = req.nextUrl.searchParams.get('workoutId');
  if (!workoutId) {
    return NextResponse.json({ ok: false, error: 'workoutId required' }, { status: 400 });
  }

  const row = await rowOrNull<{ id: string }>(
    'watch/complete GET · resolve runs.id from workoutId',
    pool.query<{ id: string }>(
      `SELECT id::text AS id
         FROM runs
        WHERE user_uuid = $1
          AND (data->>'client_workout_id' = $2 OR data->>'client_workout_id' LIKE $2 || '@%')
        ORDER BY id DESC
        LIMIT 1`,
      [userId, workoutId],
    ),
  );
  if (row === null) {
    return NextResponse.json({ ok: false, error: 'lookup failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: row?.id ?? null });
}

export async function POST(req: NextRequest) {
  // 2026-05-30 user-isolation fix: identity comes from the Bearer token,
  // not from body.user_id. Accepting body.user_id meant any caller could
  // write watch completions into any runner's training history.
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: WatchCompletionBody;
  try { body = await req.json() as WatchCompletionBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || !body.workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 });
  }

  // ── 0. Length guard · 2026-06-02 ──
  // Drop tap-test workouts before any write so they don't pollute the
  // volume average. Threshold: < 0.25 mi AND < 180 s (both must be tiny).
  // See lib/runs/length-guard.ts for the rule rationale.
  const totalSecGuard = Number(body.totalDurationSec) || 0;
  const totalMiGuard = Number(body.totalDistanceMi) || 0;
  const guard = isSubThresholdRun({ distanceMi: totalMiGuard, durationSec: totalSecGuard });
  if (guard.isSubThreshold) {
    console.log(`[watch/complete] dropped sub-threshold workout ${body.workoutId} · ${guard.distanceMi}mi / ${guard.durationSec}s (min ${MIN_DISTANCE_MI}mi / ${MIN_DURATION_SEC}s)`);
    return NextResponse.json({
      ok: true,
      workoutId: body.workoutId,
      dropped: guard.reason,
      distanceMi: guard.distanceMi,
      durationSec: guard.durationSec,
      // No row written to coach_intents or runs · client treats as
      // "accepted quietly, don't surface."
      api_version: 'watch-complete/p21-guard',
    });
  }

  // ── 0b. Physiological bounds guard (F20) ──────────────────────────────────
  // Clamp impossible HR values to null rather than storing garbage that
  // would poison readiness pillars.
  if (body.maxHr != null && (body.maxHr < 30 || body.maxHr > 230)) {
    console.warn(`[watch/complete] out-of-bounds maxHr=${body.maxHr} clamped to null`);
    body.maxHr = null;
  }
  if (body.avgHr != null && (body.avgHr < 30 || body.avgHr > 230)) {
    console.warn(`[watch/complete] out-of-bounds avgHr=${body.avgHr} clamped to null`);
    body.avgHr = null;
  }
  // 2026-07-06 · audit P1-26 / P2-62 fix · the old flat `> 50 → 400` here
  // permanently destroyed real ultra runs: both durable retry lanes (watch
  // PhoneSync direct-POST queue, iPhone WatchSync relay) dead-letter 4xx,
  // so a 50-miler vanished with the watch stuck on "Uploading…". Now:
  //   50–250 mi  → accept + quarantine (data.qualityFlag='distance_review'
  //                · counts toward volume, excluded from VDOT anchors),
  //   > 250 mi   → sensor garbage · answer the sub-threshold-style
  //                200 + { dropped } shape so the queue drops the payload
  //                INTENTIONALLY instead of silently dead-lettering a 400.
  // Rule rationale + Research citations: lib/runs/distance-guard.ts.
  const distGuard = classifyRunDistance(body.totalDistanceMi);
  if (distGuard.verdict === 'reject') {
    console.warn(`[watch/complete] dropped over-ceiling workout ${body.workoutId} · ${distGuard.distanceMi}mi (hard ceiling ${HARD_DISTANCE_CEILING_MI}mi)`);
    return NextResponse.json({
      ok: true,
      workoutId: body.workoutId,
      dropped: 'distance_ceiling',
      distanceMi: distGuard.distanceMi,
      // No row written to coach_intents or runs · client treats
      // { ok, dropped } as "accepted quietly, don't retry."
      api_version: 'watch-complete/p21-guard',
    });
  }
  if (distGuard.verdict === 'review') {
    console.warn(`[watch/complete] distance ${distGuard.distanceMi}mi exceeds ${SOFT_DISTANCE_CEILING_MI}mi soft bound · storing with qualityFlag='${distGuard.qualityFlag}'`);
  }

  // ── 1. strava_activities-shaped row so non-coach consumers see the run ──
  // Shape mirrors /api/ingest/workout — keeps a single canonical activity
  // shape across watch, Strava, HealthKit, and manual entry sources.

  // 2026-06-01 · treadmill ingest (iPhone build 136).
  // 2026-07-07 · phone-GPS ingest (wave3b/phone-gps-recording · audit P1
  // "no-watch users have no way to record an outdoor run"). PhoneRunTracker
  // POSTs here the exact same way TreadmillView does — this is additive to
  // the whitelist, not a behavior change for 'watch'/'treadmill' callers.
  // Respect body.source · whitelist 'watch' | 'treadmill' | 'phone'. Anything
  // else falls back to 'watch' so a future iPhone bug shows up in the
  // server logs instead of silently mis-sourcing. Resolved BEFORE the
  // date below · toUtcIso reads `source` to interpret no-marker times —
  // 'phone' isn't in that function's local-time whitelist because
  // PhoneRunTracker always sends a Z-suffixed UTC startedAt/completedAt
  // (ISO8601DateFormatter's default), so toUtcIso's hasTzMarker branch
  // trusts it directly without ever consulting `source`.
  const ALLOWED_SOURCES = new Set(['watch', 'treadmill', 'phone']);
  const requestedSource = typeof body.source === 'string' ? body.source : 'watch';
  const source = ALLOWED_SOURCES.has(requestedSource) ? requestedSource : 'watch';
  if (requestedSource !== source) {
    console.warn(`[watch/complete] rejected body.source='${requestedSource}' · falling back to 'watch'. Add to ALLOWED_SOURCES if intentional.`);
  }

  // Derive the runner-LOCAL calendar date + wall-clock start.
  // 2026-06-08 · body.startedAt arrives either UTC-tagged ("…Z", newer
  // watch/iPhone builds) or PDT wall time with no marker (older builds).
  // The prior `(startedAt).slice(0,10)` took the UTC date verbatim, which
  // rolls a day forward for evening-Pacific runs (Sun 17:xx PDT = Mon
  // 00:xx UTC) — stranding the run in the wrong ISO week and off its plan
  // slot (David's 2026-06-07 long run landed on 06-08). Route BOTH wire
  // formats through the canonical TZ helpers so the stored date is always
  // the runner's local calendar day. No-marker payloads are unchanged
  // (toUtcIso treats them as local wall time for watch/treadmill sources).
  // Affects any runner west of UTC who runs after local 17:00.
  const tz = await runnerTimezone(userId);
  const startUtc = toUtcIso(body.startedAt, source, tz);
  const startLocalWall = toLocalWallIso(startUtc, tz);
  const date = (startLocalWall ?? '').slice(0, 10) || await runnerToday(userId);
  // Wall-time ISO with no Z, fractional seconds stripped (Postgres-friendly).
  const startLocal = (startLocalWall ?? '').replace(/\.\d+$/, '');
  const totalSec = Number(body.totalDurationSec) || 0;
  const totalMi = Number(body.totalDistanceMi) || 0;
  // MOVING TIME IS WHAT PACE IS COMPUTED FROM · David's ruling 2026-08-21.
  //
  // Both are recorded. `durationSec` stays elapsed — the honest answer to how
  // long the runner was out, stoplights included. But pace divides by moving
  // time where the recorder measured it, because pace is what VDOT is built
  // on and a junction should not make a runner look slower than they ran.
  //
  // Falls back to elapsed when the sender has no moving figure, which is every
  // watch run, every treadmill run, and every phone build before this one —
  // so nothing changes shape, it just gets more accurate where it can.
  const movingSec = Number(body.movingSec) || 0;
  const paceSec = movingSec > 0 ? movingSec : totalSec;
  const avgPace = paceSec > 0 && totalMi > 0
    ? formatPace(Math.round(paceSec / totalMi))
    : null;
  const indoor = body.indoor === true;

  // ── RK-2 cross-day guard ──
  // workoutId is server-issued as `${userId}-${YYYY-MM-DD}` (per-DAY). A
  // stale cached workout started on a LATER day used to come back carrying
  // the original day's id, and the idempotent overwrite below destroyed
  // that day's real run (Saturday's run replaced by Sunday's race). When
  // the id's planned date disagrees with the run's actual local date,
  // fork the identity with an `@date` suffix: the completion lands as a
  // NEW run on its true date and the original day's row is untouched.
  // Re-POSTs of the same completion still dedup (same startedAt → same
  // date → same suffix). Ids without a date suffix (treadmill trd_*) have
  // no cross-day concept and pass through unchanged.
  //
  // 2026-07-07 · P1-34 fix · watch now appends a per-start `#HHmm` session
  // suffix to every completion's workoutId (WorkoutEngine.buildCompletion /
  // completionFromRecovery — see WatchWorkoutModels.swift wire-contract
  // doc). Without this, a restart/double-run on the SAME day collided on
  // the identical per-day id and the second completion's upsert silently
  // overwrote the first run's distance + phase data (route.ts:517-527
  // below). The date-extraction regex tolerates the optional `#HHmm` tail
  // so the existing cross-day fork keeps matching `plannedDate` exactly as
  // before — it doesn't need `$`-anchoring at the true end of string
  // anymore, just "date immediately before an optional session suffix".
  // A re-POST of the SAME session still dedups (same startedAt-derived
  // suffix baked into the wire payload once, at build time) — only a
  // genuinely NEW run start mints a new suffix.
  const plannedDate = body.workoutId.match(/(\d{4}-\d{2}-\d{2})(?:#\d{4})?$/)?.[1] ?? null;
  const crossDay = plannedDate != null && plannedDate !== date;
  const effectiveWorkoutId = crossDay ? `${body.workoutId}@${date}` : body.workoutId;
  if (crossDay) {
    console.warn(
      `[watch/complete] cross-day completion · workoutId=${body.workoutId} ` +
      `planned=${plannedDate} actual=${date} · forking to ${effectiveWorkoutId} ` +
      `so the ${plannedDate} run is not overwritten.`,
    );
  }

  // ── Full per-phase blob into coach_intents ──
  // The coach reads this via getWorkoutCompletion. Idempotent on
  // (user_id, reason, field) — re-POSTing the same workoutId overwrites.
  // Create-before-delete: the old order (DELETE then INSERT, both with
  // swallowed catches) destroyed the PREVIOUS blob when the INSERT failed
  // — and two prod trd_* completions were acked with no surviving record.
  // Now the new row lands first; older rows for the same key are swept
  // after; a failed insert leaves the prior blob intact and is surfaced
  // in the response instead of swallowed.
  let intentsErr: string | null = null;
  try {
    const ins = await pool.query<{ id: number | string }>(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, briefing_id)
       VALUES ($1, $1, 'watch_completion', $2, $3, NULL)
       RETURNING id`,
      [userId, effectiveWorkoutId, JSON.stringify(body)]
    );
    const newRowId = ins.rows[0]?.id;
    if (newRowId != null) {
      await pool.query(
        `DELETE FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1
            AND reason = 'watch_completion' AND field = $2 AND id <> $3`,
        [userId, effectiveWorkoutId, newRowId]
      ).catch(() => {
        // Duplicate blob rows are tolerable: readers take the newest;
        // the next re-POST sweeps again.
      });
    }
  } catch (e: any) {
    intentsErr = e?.message ?? String(e);
    console.error('[watch/complete] coach_intents write failed:', e);
  }

  // Fix 4b · derive whole-run avgHr once (null when phases carry no HR).
  const wholeRunHr = wholeRunAvgHr(body.phases);

  // ── The run's clock, checked ─────────────────────────────────────────────
  // Every second between the run's start and its finish is running time,
  // paused time, or time the tracker declined to credit. If those do not add
  // up to the wall clock, ticks were dropped — a run silently shorter than it
  // really was, which is exactly the class of defect that used to need a row
  // read out of the database to notice. Checked on the server too, because
  // the client's own arithmetic is the thing under suspicion.
  //
  // Stored only when it FAILS, so a clean run's shape is unchanged and any
  // row carrying `clockAudit` is a row worth looking at.
  const clockAudit = (() => {
    const startMs = Date.parse(startUtc ?? '');
    const endMs = Date.parse(toUtcIso(body.completedAt, source, tz) ?? '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    const wallSec = (endMs - startMs) / 1000;
    if (!(wallSec > 0)) return null;
    const accounted = totalSec + (Number(body.pausedSec) || 0) + (Number(body.droppedGapSec) || 0);
    const driftSec = Math.round(wallSec - accounted);
    // A few seconds is the End-confirm tap and the final partial tick.
    if (Math.abs(driftSec) <= CLOCK_DRIFT_TOLERANCE_SEC) return null;
    console.warn(
      `[watch/complete] clock drift ${driftSec}s on ${body.workoutId} · ` +
      `wall ${Math.round(wallSec)}s vs counted ${totalSec}s + paused ` +
      `${Number(body.pausedSec) || 0}s + declined ${Number(body.droppedGapSec) || 0}s. ` +
      `Distance is integrated from the same clock, so it is short by the same share.`,
    );
    return {
      driftSec,
      wallSec: Math.round(wallSec),
      countedSec: totalSec,
      pausedSec: Number(body.pausedSec) || 0,
      declinedSec: Number(body.droppedGapSec) || 0,
      // What the client thought its own drift was. A disagreement between
      // this and driftSec means the client's clock and the wall clock parted
      // company before the payload was even built.
      clientDriftSec: Number.isFinite(Number(body.clockDriftSec))
        ? Number(body.clockDriftSec) : null,
    };
  })();

  // ── HR zone distribution · 2026-08-21 ────────────────────────────────────
  // `/api/ingest/workout` has done this since 2026-06-04; this endpoint never
  // has, so the PRIMARY source — the watch is tier-5 and wins canonical
  // selection — landed every run with no `hrZonePcts` at all, and the run
  // detail page fell through to the per-split-average derivation that the
  // 06-04 fix existed to replace. A treadmill run was worse off still: it
  // shipped no samples of any kind until BeltTracker started emitting them,
  // so there was nothing to bucket at ingest OR at render.
  //
  // The samples live per PHASE here rather than per split, so hand the
  // bucketer one synthetic split holding all of them — it only ever walks
  // `hrSamples`, and counting time-even samples IS time-weighting.
  //
  // Null (key absent) when LTHR is unset or no phase carries samples, which
  // is the pre-fix state and what the render-time fallback already handles.
  let computedHrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null = null;
  const phaseHrSamples = (body.phases ?? []).flatMap((p) =>
    Array.isArray(p.hrSamples) ? p.hrSamples : [],
  ).filter((h) => Number(h?.bpm) > 0);
  if (phaseHrSamples.length > 0) {
    try {
      const lthrRow = await pool.query<{ lthr: number | null }>(
        `SELECT lthr FROM profile WHERE user_uuid = $1 ORDER BY (user_uuid=$1) DESC LIMIT 1`,
        [userId],
      );
      const lthr = lthrRow.rows[0]?.lthr;
      if (lthr) {
        const table = computeZones({ lthr });
        if (table) {
          const bucketed = bucketHrSamplesByZone(
            [{ hrSamples: phaseHrSamples.map((h) => ({ bpm: Number(h.bpm), tSec: Number(h.tSec) })) }],
            table,
          );
          // ZONES-SUM-1 (2026-08-24) · the bucketer now REFUSES with null
          // rather than returning five zeros, so the hand-rolled `sum > 0`
          // gate this used to carry has moved inside it. Five zeros written
          // here is how five canonical rows came to hold a distribution of
          // nothing beside a measured average heart rate.
          computedHrZonePcts = bucketed;
        }
      }
    } catch (e: unknown) {
      // Non-fatal · the render-time fallback covers us.
      console.warn('[watch/complete] zone bucketing failed:',
        e instanceof Error ? e.message : String(e));
    }
  }

  // 2026-06-09 · regression-audit G5 · stamp workoutType from the matched
  // plan day — the EXACT mirror of /api/ingest/workout's stamp (landed the
  // same day). Without this the field was source-asymmetric: HK-ingested
  // rows carried plan types while watch-completed rows (the PRIMARY source
  // — watch is tier-5 and wins canonical selection) stayed null, so the
  // type-gated readers (vdotFromRun quality gate, decoupling steady-state
  // filter) saw a label on roughly half the canonical rows depending on
  // which sibling won the merge. Same ±30% distance guard: a 2 mi bail on
  // a tempo day, or an unplanned jog on a rest day, must not inherit a
  // quality label. workoutTypeSource records provenance.
  //
  // WORKOUT-EXECUTION-ID-1 (2026-09-03) · this is also now the ONLY place
  // that ever stamps `planWorkoutId` — the durable `plan_workouts.id` link
  // `lib/execution/day-resolver.ts` treats as EXACT evidence a run completed
  // a specific prescription. Found live: a friend's 4.48mi unplanned run
  // rendered as `INTERVALS · done` with rep-grading prose, because nothing
  // this app ever writes could tell "a run exists on this date" apart from
  // "this run IS the day's prescription" — same date, same or only run of
  // the day, were all being read as sufficient. They are not (David's
  // ruling). This block is what makes them unnecessary going forward: a run
  // that actually came through the app's own tracker (watch, phone GPS,
  // treadmill — the three callers of this route) carries the exact id from
  // here on, and the resolver never has to guess again.
  //
  // Was previously LIMIT 1 with no ORDER BY on a query that can return more
  // than one row (a two-a-day) — an arbitrary pick, silently. Now reads every
  // non-rest prescription for the date and picks the one whose distance is
  // the closest ±30%-band fit, so two sessions on one day are told apart by
  // distance rather than by whichever the database happened to return first.
  let plannedWorkoutType: string | null = null;
  let plannedSubLabel: string | null = null;
  let planWorkoutId: string | null = null;
  try {
    const planDays = (await pool.query<{ id: string; type: string; distance_mi: string | null; sub_label: string | null }>(
      `SELECT pw.id, pw.type, pw.distance_mi::text, pw.sub_label
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso = $2
          AND pw.type NOT IN ('rest')
        ORDER BY pw.id`,
      [userId, date],
    )).rows;
    let best: { id: string; type: string; distance_mi: string | null; sub_label: string | null } | null = null;
    let bestDelta = Infinity;
    for (const planDay of planDays) {
      const plannedMi = planDay.distance_mi != null ? Number(planDay.distance_mi) : null;
      const distanceMatches = plannedMi == null || plannedMi <= 0
        ? true
        : totalMi >= plannedMi * 0.7 && totalMi <= plannedMi * 1.3;
      if (!distanceMatches) continue;
      const delta = plannedMi == null ? 0 : Math.abs(totalMi - plannedMi);
      if (delta < bestDelta) { best = planDay; bestDelta = delta; }
    }
    if (best) {
      // 2026-08-28 · field-test LTHR capture reads this below. Carried out of
      // the try so a stamp failure can't silently also kill the capture.
      plannedSubLabel = best.sub_label ?? null;
      // race_week_tuneup is T-pace work · stamp as threshold so the
      // quality-type readers treat it as the T-effort it is.
      plannedWorkoutType = best.type === 'race_week_tuneup' ? 'threshold' : best.type;
      planWorkoutId = best.id;
    }
  } catch (e: unknown) {
    // Non-fatal · an unstamped run is the pre-fix status quo.
    console.warn('[watch/complete] workoutType stamp failed:',
      e instanceof Error ? e.message : String(e));
  }

  // 2026-08-21 · 0821 watch design · normalise the three wrist decisions
  // before the row is built. Normalising rather than storing raw so a
  // garbage reading, a rep index of zero or an empty array never reaches a
  // screen that would have to draw it as a fact. The full unmodified payload
  // still lands in `coach_intents.value` above, so nothing is lost either way.
  const ceilingLift = normalizeCeilingLift(body.ceilingLift);
  const repSkips = normalizeRepSkips(body.repSkips);
  const recoveryExtensions = normalizeRecoveryExtensions(body.recoveryExtensions);

  const data: any = {
    id: effectiveWorkoutId,
    activityId: effectiveWorkoutId,
    client_workout_id: effectiveWorkoutId,
    // Original server-issued id when a cross-day fork renamed this run —
    // keeps the plan-slot linkage auditable.
    plannedWorkoutId: crossDay ? body.workoutId : undefined,
    source,
    // 2026-06-01 · `indoor` distinguishes treadmill/incline-trainer from
    // outdoor-with-no-GPS. Downstream gates (lib/coach/run-recap.ts skips
    // "you climbed N ft" facts when indoor=true · activity feed renders
    // a treadmill glyph). Default false.
    indoor,
    // Treadmill name reads better than "Run" in the activity feed.
    name: source === 'treadmill' ? 'Treadmill' : 'Run',
    date,
    startLocal: startLocal || `${date}T08:00:00`,
    distanceMi: totalMi,
    durationSec: totalSec,
    // `timeMoving` meant elapsed, which is what it is NOT. Named honestly now
    // and null rather than a lie when nothing measured it.
    movingSec: movingSec > 0 ? movingSec : null,
    timeMoving: movingSec > 0 ? formatMmSs(movingSec) : null,
    avgPaceMinPerMi: avgPace,
    // Fix 4b · option (A) + labeling. `avgHr` is the CANONICAL read = WHOLE-RUN
    // (derived from phase samples); `avgHrRaw` preserves the watch's native
    // value, which is WORK-WEIGHTED; `avgHrKind` records which definition
    // `avgHr` holds ('whole_run' when derived, else 'work_weighted' fallback)
    // so a future reader/audit tells the two definitions apart without guessing
    // — they never become a silent chimera.
    avgHr: wholeRunHr ?? body.avgHr ?? null,
    avgHrRaw: body.avgHr ?? null,                       // watch's native value = work-weighted
    avgHrKind: wholeRunHr != null ? 'whole_run' : (body.avgHr != null ? 'work_weighted' : null),
    maxHr: body.maxHr ?? null,
    avgCadence: body.avgCadence ?? null,
    // 2026-08-27 · treadmill watch bridge (TreadmillHRStreamer.swift). Same
    // active HKWorkoutSession that streams HR also samples running power /
    // ground contact time / vertical oscillation / stride length at the
    // same fast cadence — names match the HealthKit-IMPORT path's
    // (`/api/ingest/workout`) RunData fields exactly, so a treadmill-bridge
    // value and an imported outdoor-run value share the same slot. Null
    // (key stripped by the upsert's jsonb_strip_nulls, per Rule 6) rather
    // than a made-up figure when no watch answered the bridge ask.
    avgPowerW: body.avgPowerW ?? null,
    avgGctMs: body.avgGctMs ?? null,
    avgVertOscCm: body.avgVertOscCm ?? null,
    avgStrideLengthM: body.avgStrideLengthM ?? null,
    // Active calories. Two live sources land here: HKLiveWorkoutBuilder
    // (2026-06-01, outdoor watch-paired runs) and, as of 2026-08-27, the
    // treadmill watch bridge's SUMMED active-energy samples — the first
    // measured calorie figure a treadmill run has ever had (previously
    // always null, since TreadmillHRSession collected nothing but HR).
    // resolveCalories() tier 1 reads this and skips the estimator fallback
    // when it's present, for either source. Optional · omitted on very
    // short runs, sensor glitches, older watch builds, or no watch at all.
    // Doctrine: designs/briefs/iphone-calories-and-absorption-brief.md.
    kcal: body.kcal ?? null,
    // 2026-06-09 Phase 2 (3.2) · contingency-rule outcomes, verbatim.
    // "Took the bail" is a recorded DECISION the recap reasons about
    // (bail ≠ fail) · run-recap reads data.ruleOutcomes. Omitted by
    // old builds → key absent → all readers fall through.
    ...(Array.isArray(body.ruleOutcomes) && body.ruleOutcomes.length > 0
      ? { ruleOutcomes: body.ruleOutcomes }
      : {}),
    // 2026-08-21 · 0821 watch design · the other three wrist decisions.
    // The bail rides `ruleOutcomes` immediately above; these are the three
    // that had nowhere to land. Each is a DECISION, recorded so the phone
    // never has to infer one from the phase array — a chosen skip and a
    // dropped rep are the same `completed: false` and must not read the
    // same on a screen whose register says a decision is not a lapse.
    //
    // Keys are ABSENT (not null, not []) when the run carries no such
    // decision, so the merge upsert below cannot clobber a value a richer
    // sibling payload already wrote — the same Rule 6 posture as
    // `qualityFlag`, `status` and `hrZonePcts`. Three separate top-level
    // keys rather than one envelope, for the same reason: each survives a
    // re-POST that omits the others.
    ...(ceilingLift ? { ceilingLift } : {}),
    ...(repSkips.length > 0 ? { repSkips } : {}),
    ...(recoveryExtensions.length > 0 ? { recoveryExtensions } : {}),
    // 2026-06-06 · derive genuine per-mile splits from the watch's
    // paceSamples stream.  Each phase ships ~5s-cadence samples with
    // cumulative distMi + tSec.  Walking those to find mile crossings
    // is identical to iPhone's perMileSplits but runs server-side so
    // no TF build is required and splits land on the canonical row
    // directly (watch is tier-5; it always wins canonical selection).
    //
    // Null result (no paceSamples, or <1 full mile) writes nothing —
    // the iPhone HK path is still the fallback.
    splits: deriveSplitsFromPaceSamples(body.phases ?? []) ?? undefined,
    // 2026-06-09 · G5 · plan-stamped workout type (lookup above). Null when
    // no plan day matched · readers treat null as untyped (pre-fix behavior).
    workoutType: plannedWorkoutType,
    ...(plannedWorkoutType ? { workoutTypeSource: 'plan' } : {}),
    // WORKOUT-EXECUTION-ID-1 (2026-09-03) · the durable exact-match id.
    // Key ABSENT (not null) when no prescription matched, so a re-POST from
    // an older client build can never clobber an id a richer payload wrote.
    ...(planWorkoutId ? { planWorkoutId } : {}),
    // F10: raw per-phase array stored directly on the run row so the
    // coach and VDOT engines can query per-phase actuals without a
    // JOIN to coach_intents. Empty array when old clients omit phases.
    ...(body.phases?.length ? { phases: body.phases } : {}),
    // 2026-08-17 · the run-level outcome the watch already computed
    // ('completed' | 'partial' | 'abandoned'). Declared on the wire since the
    // endpoint was written and copied nowhere: it survived only inside the raw
    // coach_intents blob, so every reader that wanted "did this workout finish"
    // reconstructed it from distance heuristics instead. Same F10 argument as
    // `phases` — put it on the run row so consumers do not need the JOIN.
    // Key ABSENT (not null) when the client omits it, so the merge upsert
    // below cannot clobber a value written by a richer sibling payload.
    ...(typeof body.status === 'string' && body.status !== ''
      ? { status: body.status }
      : {}),
    // 2026-07-06 · P1-26 · distance quarantine. Key is ABSENT (not null)
    // on clean runs so the merge upsert below can never clobber a flag
    // set by a prior over-soft-bound write. See lib/runs/distance-guard.ts.
    ...(distGuard.qualityFlag ? { qualityFlag: distGuard.qualityFlag } : {}),
    ingestedAt: new Date().toISOString(),
    // 2026-06-03 · per-run TZ capture · stored on the run row so the
    // recovery anchor + activity feed read the TZ that was in effect
    // when this workout actually happened (handles travel correctly).
    // Best-effort · null when client omitted it.
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
    // Reference to the full per-phase blob for any downstream consumer
    // that wants the structured detail. Must match the coach_intents
    // field key, which is the effective (cross-day-forked) id.
    watchCompletionRef: effectiveWorkoutId,
    // GPS polyline shipped directly by watch app (build 172+). The watch
    // emits camelCase `routePolyline` (Encodable default, no CodingKeys); the
    // prior snake_case-only read silently dropped a valid 1486-char polyline
    // on Jun 8. Prefer camel, accept snake; older clients omit both → null and
    // the HK import path fills it via the apple_watch sibling row +
    // enhanceCanonicalFromAbsorbed as before.
    routePolyline: body.routePolyline ?? body.route_polyline ?? null,
    // 2026-08-21 · distance provenance for an indoor belt run. A treadmill
    // distance is always ∫(belt speed)·dt — there is no odometer to read —
    // and `distanceSource` says so plainly. `distanceModelled` is the
    // narrower claim: part of that integral ran over seconds the console
    // could not witness, so the number is an estimate and every surface that
    // shows it owes it the amber mark. Keys ABSENT (not null) on a clean run
    // and on every non-treadmill source, so the merge upsert can never
    // clobber a sibling's value and an untouched run's shape is unchanged.
    // Key ABSENT when we could not compute it, so a re-POST from an older
    // client cannot clobber a distribution a richer payload already wrote.
    ...(computedHrZonePcts ? { hrZonePcts: computedHrZonePcts } : {}),
    ...(source === 'treadmill' ? { distanceSource: 'belt_integrated' } : {}),
    ...(Number(body.unmeasuredSec) > 0
      ? {
          unmeasuredSec: Math.round(Number(body.unmeasuredSec)),
          unmeasuredDistanceMi: Number(body.unmeasuredDistanceMi) || 0,
          distanceModelled: true,
        }
      : {}),
    ...(Number(body.droppedGapSec) > 0
      ? { droppedGapSec: Math.round(Number(body.droppedGapSec)) }
      : {}),
    // The second, measured reading and the verdict on the two. Stored
    // whether or not they agree — a contested run keeps both numbers so the
    // question stays answerable later, and `distanceModelled` above already
    // tells every surface whether the headline figure earned the amber mark.
    ...(typeof body.distanceSource === 'string' && body.distanceSource !== ''
      ? { distanceSource: body.distanceSource }
      : {}),
    ...(Number.isFinite(Number(body.pedometerDistanceMi))
      ? { pedometerDistanceMi: Number(body.pedometerDistanceMi) }
      : {}),
    ...(Number.isFinite(Number(body.pedometerSteps))
      ? { pedometerSteps: Math.round(Number(body.pedometerSteps)) }
      : {}),
    ...(body.distanceSource === 'belt_stated' || body.distanceSource === 'belt_contested'
      ? { distanceModelled: true }
      : {}),
    ...(clockAudit ? { clockAudit } : {}),
  };
  // Splits reliability guard — same check as iPhone ingest (finding 1.7).
  // deriveSplitsFromPaceSamples can yield an n-1 array when the final
  // mile has no pace-sample crossing: splits sum < duration by ~1 mile
  // worth of seconds. Flag and drop so consumers don't see truncated data.
  if (Array.isArray(data.splits) && data.splits.length > 0 && totalSec > 0) {
    // 2026-07-09 · reliability check via splitTimesReliable (see
    // lib/runs/split-coverage.ts). The old `|sum − duration| > 5s` test
    // dropped valid splits on every run that ended mid-mile — the split
    // times legitimately fall ~1 cool-down-mile short of the full duration.
    // Now we only drop when the times OVER-claim the run or fall short by
    // more than a whole mile (a genuinely missing mile).
    const splitsSumS = splitsSumSeconds(data.splits as Array<Record<string, unknown>>);
    if (!splitTimesReliable(splitsSumS, totalSec, totalMi)) {
      // 2026-08-21 · backend audit · Rule 6 · DELETE THE KEY, DO NOT WRITE `[]`.
      //
      // This used to assign `data.splits = []`. The upsert below merges with
      // `runs.data || jsonb_strip_nulls(EXCLUDED.data)`, and `jsonb_strip_nulls`
      // removes NULLS — an empty array is not null. So `[]` survived the strip,
      // won the `||`, and replaced whatever the row already held.
      //
      // What it replaced is the point. `lib/runs/canonical.ts` absorbs REAL
      // per-mile splits off the HealthKit/Strava twin onto the canonical row,
      // tier-independently, precisely because the watch's own derivation often
      // has none. The next re-POST of the same workoutId — a durable-queue
      // retry, a re-sync, a cross-day fork re-send — wiped them back to empty
      // and the run went blind again: slowest mile, HR drift, aerobic
      // decoupling and threshold adherence all read per-mile splits.
      //
      // The same fix already exists one directory over: `omitEmpty` in
      // lib/runs/merge-safe.ts, applied at app/api/ingest/workout/route.ts:360.
      // It was never applied to this route — the tier-5 writer that always wins
      // canonical selection — so the guard was asymmetric across the two
      // ingest paths that share the column.
      //
      // Deleting the key means "this payload says nothing about splits", which
      // is the truth: the derivation failed its reliability check. An explicit
      // clear, if one is ever wanted, belongs in a purpose-built `data -
      // 'splits'` statement like the qualityFlag one below.
      delete data.splits;
      data.splits_unreliable = true;
    } else {
      // Reliable whole-run → apply the per-mile physiological guard so a
      // single GPS-spike mile (impossible pace for its HR/cadence) is
      // flagged rather than shown as a real fast split. See split-sanity.ts.
      data.splits = sanitizeSplits(data.splits as Array<Record<string, unknown>>);
    }
  }

  // Elevation gain · device-measured from the watch's barometer-fused altitude
  // (build 17x+). Read camelCase body.elevGainFt (same wire lesson as
  // routePolyline). Route through elev-sanity so an absurd barometric value
  // gets clamped, and stamp provenance 'watch' so the GPS-estimate fallback
  // (post-write-hooks enrichElevIfMissing) defers to the device value — it
  // only fires when elevGainFt is null or elevGainSource is 'absent'.
  if (source === 'treadmill' && typeof body.elevGainFt === 'number' && body.elevGainFt >= 0) {
    // Treadmill elevation is incline-derived (rise = distance × grade) and
    // EXACT — not noisy barometry — so it bypasses the barometric sanity
    // clamp (which would wrongly cap a steep but legitimate incline session).
    // Provenance flags it as incline-derived, not device-measured.
    data.elevGainFt = Math.round(body.elevGainFt);
    data.elevGainSource = 'treadmill_incline';
  } else {
    const elevSane = sanitizeElevGain({
      elevGainFt: body.elevGainFt ?? null,
      distanceMi: totalMi,
      splits: Array.isArray(data.splits) ? data.splits : [],
    });
    if (elevSane.value != null) {
      data.elevGainFt = elevSane.value;
      data.elevGainSource = 'watch';
    }
  }
  // 2026-06-03 · auto-populate profile.timezone from the device's TZ on
  // first sync. Silent · only writes when profile.timezone is currently
  // null, so manual overrides stay sticky. See lib/runtime/runner-tz.ts
  // captureTimezoneFromDevice for the full doctrine.
  try {
    const { captureTimezoneFromDevice } = await import('@/lib/runtime/runner-tz');
    if (typeof body.timezone === 'string') {
      await captureTimezoneFromDevice(userId, body.timezone);
    }
  } catch {
    // Best-effort · TZ capture failure must not block the workout write.
  }
  // strava_activities.id is bigint NOT NULL with no default. The legacy
  // shape uses Strava's numeric activity id; watch-side activities have
  // no Strava id, so we generate a stable bigint deterministically from
  // the workoutId. Negative numbers are reserved for synthetic sources
  // (matches the existing apple_health pattern), keeping our keyspace
  // disjoint from Strava's positive numeric ids. Idempotent: same
  // workoutId → same id, so re-POSTing overwrites.
  const stableId = -stableBigintFromString(effectiveWorkoutId);

  let stravaWriteErr: string | null = null;
  let runsWritePermanent = false;
  try {
    // 2026-06-05 · backend audit P0-4 fix · defense-in-depth · the
    // synthetic bigint derived from a workout UUID is astronomically
    // unlikely to collide across users, but if it ever did (or if an
    // admin restored from another runner's export) silently overwriting
    // is the wrong behavior. Pre-check owner; refuse the write loudly.
    // Cite docs/2026-06-05-backend-audit.html § P0-4.
    const existingOwner = (await pool.query<{ u: string }>(
      `SELECT user_uuid::text AS u FROM runs WHERE id = $1`,
      [stableId],
    ).catch(() => ({ rows: [] as Array<{ u: string }> }))).rows[0];
    if (existingOwner && existingOwner.u !== userId) {
      console.error(
        `[watch/complete] cross-user synthetic-id collision · ` +
        `stableId=${stableId} owned_by=${existingOwner.u.slice(0,8)} ` +
        `attempting=${userId.slice(0,8)} · refusing to write.`,
      );
      runsWritePermanent = true;
      throw new Error(`cross-user collision on synthetic id ${stableId}`);
    }
    // Legacy cleanup: rows carrying this client_workout_id under a
    // DIFFERENT synthetic id (older id schemes). Date-scoped so a stale
    // workoutId can never reach across days (RK-2), and id-excluded so
    // the row we are about to upsert is never deleted — its columns
    // (shoe_id, provenance, weather_enriched_at) must survive.
    await pool.query(
      `DELETE FROM runs
        WHERE user_uuid = $1
          AND data->>'client_workout_id' = $2
          AND id <> $3
          AND data->>'date' = $4`,
      [userId, effectiveWorkoutId, stableId, date]
    );
    // M-16 / Rule 6 · upsert, not DELETE+INSERT. The old shape wiped
    // every column (shoe_id, shoe_auto_assigned_at, provenance,
    // weather_enriched_at) and every data key the watch payload doesn't
    // carry (mergedIntoId, absorbed splits/weather/elev, warmup bonus) on
    // each re-POST — then the auto-assign hook re-filled the shoe with a
    // system pick, silently corrupting shoe mileage. Merge semantics:
    // existing keys survive; incoming non-null keys win; incoming nulls
    // (absent sensors on this payload) cannot erase absorbed values.
    // WHERE backstops the pre-check above against a write landing between
    // the SELECT and this statement: a cross-user conflict makes the DO
    // UPDATE a no-op (rowCount 0) instead of merging into the other
    // runner's row, and the throw keeps the refusal loud.
    const up = await pool.query(
      `INSERT INTO runs (id, user_uuid, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)
       WHERE runs.user_uuid = EXCLUDED.user_uuid`,
      [stableId, userId, data]
    );
    if (up.rowCount === 0) {
      runsWritePermanent = true;
      throw new Error(`cross-user collision on synthetic id ${stableId}`);
    }
    // 2026-07-06 · P1-26 · explicit flag clear on corrected re-POST. The
    // merge upsert PRESERVES an absent key (Rule 6: default preserves,
    // explicit destruction only), so a re-POST of the same workoutId with
    // a corrected in-bounds distance must clear a stale quarantine flag
    // field-level — never by replacing data wholesale.
    if (distGuard.verdict === 'ok') {
      await pool.query(
        `UPDATE runs SET data = data - 'qualityFlag'
          WHERE id = $1 AND user_uuid = $2
            AND data->>'qualityFlag' = '${DISTANCE_REVIEW_FLAG}'`,
        [stableId, userId],
      );
    }
    // 2026-06-03 · post-write hook · calibration auto-complete for
    // cold-start runners on first qualifying easy run. Best-effort.
    void (await import('@/lib/runs/post-write-hooks'))
      .afterRunWrite({ userUuid: userId, runId: String(stableId), source: 'watch' });
  } catch (e: any) {
    stravaWriteErr = e?.message ?? String(e);
    console.error('[watch/complete] strava_activities write failed:', e);
  }

  // P27.3 — auto-merge dupes for the workout's date. Watch-completion
  // often arrives alongside a HKWorkout import for the same run; this
  // ensures only the richer row is visible to the coach + log.
  try {
    // Fix 1 · merge on the run's OWN startLocal-derived date (the `date`
    // written onto the row above) — NOT body.date/body.dateLocal, which the
    // watch payload never sends → UTC-now fallback → evening-PT runs scanned
    // the wrong day and stranded a duplicate.
    await autoMergeForDate(userId, date);
  } catch (e: any) {
    console.error('[watch/complete] autoMerge warn:', e?.message);
  }

  // ── Field-test LTHR capture (2026-08-28) ────────────────────────────────
  // The adapt engine's field_test conversion (lib/plan/adapt.ts) authors the
  // 30-min threshold test and its own comment said "COMPLETION FOLLOW-UP
  // (not built here)" — so a runner could DO the test and nothing would ever
  // read the result: the learn-your-LTHR path dead-ended at the finish line.
  // Friel (Research/03-heart-rate-zones.md, "### Determining LTHR — 30-Minute
  // Time Trial (Friel)"): LTHR = average HR during the final 20 min. The
  // watch already streams per-phase hrSamples; lthrFromFieldTestPhases does
  // the windowed average with coverage + plausibility gates and returns null
  // rather than guessing. Best-effort: a capture failure never fails the
  // completion ack.
  if (plannedSubLabel === 'FIELD TEST' && body.status !== 'abandoned') {
    try {
      const { lthrFromFieldTestPhases } = await import('@/lib/training/lthr');
      const cap = lthrFromFieldTestPhases(body.phases ?? []);
      if (cap != null) {
        await pool.query(
          `UPDATE profile
              SET lthr = $1, lthr_method = 'field_test', lthr_set_at = NOW()
            WHERE user_uuid = $2`,
          [cap.lthr, userId],
        );
        // Same acknowledgment channel the race auto-calibration uses — the
        // coach voice gets to say the number changed and why. attempt: the
        // LTHR write above already landed, so a failed ack is logged, not
        // fatal.
        const { attempt } = await import('@/lib/db/read');
        await attempt('watch/complete · lthr field-test intent', pool.query(
          `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
           VALUES ($1, $1, 'lthr_auto_calibrated', 'lthr', $2)`,
          [userId, `${cap.lthr} (field_test · avg of final ${Math.round(cap.windowSec / 60)} min · ${cap.sampleCount} samples)`],
        ));
        // An LTHR change reshapes zones + HR caps · bust the profile-shaped
        // caches too, not just the run surfaces.
        await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
        console.log(`[watch/complete] field test → LTHR ${cap.lthr} (${cap.sampleCount} samples over ${cap.windowSec}s)`);
      } else {
        console.log('[watch/complete] field test completed but HR stream too sparse/short for LTHR capture · left profile.lthr untouched');
      }
    } catch (e: unknown) {
      console.warn('[watch/complete] field-test LTHR capture failed:',
        e instanceof Error ? e.message : String(e));
    }
  }

  // Event-driven cache: a workout just finished. Bust only the surfaces
  // a run actually changes (today + training); /races + /profile + /health
  // don't need fresh voice for a single run. See lib/coach/cache.ts.
  await bustBriefingCacheForEvent(userId, 'run_ingest');

  // Auto-push to Strava when the runner opted in. Fire-and-forget · the
  // helper checks profile.strava_auto_push internally, pushes in the
  // background, and never blocks this response. Idempotent on run_id ·
  // a re-POST of the same watch completion won't double-upload. Skipped
  // when the runs write failed — there is no row to push.
  if (!stravaWriteErr) {
    const { maybeAutoPush } = await import('@/lib/strava/auto-push');
    // 2026-06-16 · auto-push was silently no-opping for watch runs. It passed
    // String(stableId) — the synthetic runs-table PK — but pushRunToStrava
    // resolves runs by data->>'id' (the canonical `${userId}-${date}` slug the
    // merge writes), so the lookup never matched → "run not found", no upload,
    // no trace. Manual pushes worked because the app sends that slug. Fire with
    // the canonical id (pushRunToStrava's date fallback resolves it to the
    // non-merged row for the day) so auto + manual + the status GET all key off
    // ONE run_id. Runs after autoMergeForDate above, so the canonical is settled.
    maybeAutoPush(userId, `${userId}-${date}`);
  }

  // M-9 · a failed runs write must NOT be acked with 200: both durable
  // queues (watch direct lane + iPhone relay) dequeue on any 2xx, and a
  // completion acked-but-unwritten is gone forever (two prod trd_* rows
  // died exactly this way). Retryable failures → 500 so the queues hold
  // the payload and re-POST. Permanent refusals (cross-user collision)
  // → 200 with the error surfaced, because a retry can never succeed and
  // would loop the queue forever.
  const retryableFailure = stravaWriteErr != null && !runsWritePermanent;
  return NextResponse.json({
    ok: stravaWriteErr == null,
    workoutId: body.workoutId,
    effective_workout_id: effectiveWorkoutId,
    cross_day: crossDay || undefined,
    accepted_at: new Date().toISOString(),
    // Deploy marker. Kept (small + harmless) so future audits can detect
    // when this endpoint's behavior changes without depending on side
    // effects. Bump the suffix on behavioral changes.
    api_version: 'watch-complete/p23-wrist-decisions',
    // Strava-table write outcome surfaced explicitly: harmless on
    // success, and on failure tells the watch agent + audit harnesses
    // exactly what went wrong without log access.
    strava_write: stravaWriteErr ? { ok: false, error: stravaWriteErr } : { ok: true },
    intents_write: intentsErr ? { ok: false, error: intentsErr } : { ok: true },
  }, { status: retryableFailure ? 500 : 200 });
}

// ── helpers ──

/** Finite number or null. Never 0-for-missing: a zero rep index and an
 *  absent one mean different things to a screen that names the rep. */
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Positive 1-based index, or null. */
function idx(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 1 ? Math.round(n) : null;
}

/** Heart rate inside the same physiological bounds the run-level guard uses
 *  (F20, 30–230 bpm). A reading outside them is a sensor artefact, and a
 *  ceiling row that prints one is worse than a row that drops the figure. */
function bpm(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 30 && n <= 230 ? Math.round(n) : null;
}

/** 0821 · normalise the ceiling lift. Returns null when neither figure
 *  survived, because "the ceiling was lifted" with no reading and no limit
 *  is a claim the phone cannot state and must not imply. */
function normalizeCeilingLift(raw: WatchCompletionBody['ceilingLift']): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const ceilingBpm = bpm(raw.ceilingBpm);
  const readingBpm = bpm(raw.readingBpm);
  if (ceilingBpm == null && readingBpm == null) return null;
  const out: Record<string, unknown> = { ceilingBpm, readingBpm };
  const phaseIndex = num(raw.phaseIndex);
  if (phaseIndex != null) out.phaseIndex = Math.round(phaseIndex);
  if (typeof raw.phaseLabel === 'string' && raw.phaseLabel !== '') out.phaseLabel = raw.phaseLabel;
  const atMi = num(raw.atMi);
  if (atMi != null && atMi >= 0) out.atMi = Math.round(atMi * 100) / 100;
  const atSec = num(raw.atSec);
  if (atSec != null && atSec >= 0) out.atSec = Math.round(atSec);
  return out;
}

/** 0821 · normalise the chosen rep skips. An entry with no rep index is
 *  dropped: "skipped a rep" without saying which one gives the phone
 *  nothing it can render, and a decision it cannot name reads as a miss. */
function normalizeRepSkips(raw: WatchCompletionBody['repSkips']): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const repIndex = idx(r.repIndex);
    if (repIndex == null) continue;
    const e: Record<string, unknown> = { repIndex };
    const repCount = idx(r.repCount);
    if (repCount != null) e.repCount = repCount;
    const repsCompleted = num(r.repsCompleted);
    if (repsCompleted != null && repsCompleted >= 0) e.repsCompleted = Math.round(repsCompleted);
    const phaseIndex = num(r.phaseIndex);
    if (phaseIndex != null) e.phaseIndex = Math.round(phaseIndex);
    if (typeof r.phaseLabel === 'string' && r.phaseLabel !== '') e.phaseLabel = r.phaseLabel;
    const atMi = num(r.atMi);
    if (atMi != null && atMi >= 0) e.atMi = Math.round(atMi * 100) / 100;
    const atSec = num(r.atSec);
    if (atSec != null && atSec >= 0) e.atSec = Math.round(atSec);
    out.push(e);
  }
  return out;
}

/** 0821 · normalise the recovery extensions. One entry per extension, so
 *  the phone counts the array rather than trusting a total it would then
 *  have to reconcile against the boundaries. An entry with neither boundary
 *  nor added seconds carries nothing and is dropped. */
function normalizeRecoveryExtensions(
  raw: WatchCompletionBody['recoveryExtensions'],
): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const afterRepIndex = idx(r.afterRepIndex);
    const beforeRepIndex = idx(r.beforeRepIndex);
    const addedSecRaw = num(r.addedSec);
    const addedSec = addedSecRaw != null && addedSecRaw > 0 ? Math.round(addedSecRaw) : null;
    if (afterRepIndex == null && beforeRepIndex == null && addedSec == null) continue;
    const e: Record<string, unknown> = {};
    if (afterRepIndex != null) e.afterRepIndex = afterRepIndex;
    if (beforeRepIndex != null) e.beforeRepIndex = beforeRepIndex;
    if (addedSec != null) e.addedSec = addedSec;
    const repCount = idx(r.repCount);
    if (repCount != null) e.repCount = repCount;
    const phaseIndex = num(r.phaseIndex);
    if (phaseIndex != null) e.phaseIndex = Math.round(phaseIndex);
    if (typeof r.phaseLabel === 'string' && r.phaseLabel !== '') e.phaseLabel = r.phaseLabel;
    const atSec = num(r.atSec);
    if (atSec != null && atSec >= 0) e.atSec = Math.round(atSec);
    out.push(e);
  }
  return out;
}

function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = secPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Fix 4b · whole-run mean HR from the watch's per-phase samples — the
 *  canonical avgHr definition. HK can only produce whole-run; the watch's
 *  top-level avgHr is WORK-weighted (drops recovery jogs → inflates an
 *  interval run by ~12 bpm). Duration-weighting the per-phase means equals
 *  the flat mean of all 5-sec hrSamples (verified on a real interval run:
 *  168 work-weighted → 156 whole-run). Null when phases carry no HR, so the
 *  caller falls back to body.avgHr. */
function wholeRunAvgHr(phases: any[] | undefined): number | null {
  if (!Array.isArray(phases)) return null;
  let sum = 0, dur = 0;
  for (const p of phases) {
    const d = Number(p?.actualDurationSec ?? 0);
    const hr = Number(p?.avgHr ?? NaN);
    if (d > 0 && Number.isFinite(hr)) { sum += hr * d; dur += d; }
  }
  return dur > 0 ? Math.round(sum / dur) : null;
}

/** Stable, positive bigint derived from a string (first 12 hex chars of
 *  SHA-1 → unsigned int, capped well under 2^48 so the negation stays
 *  inside the bigint range). Same input → same number. */
function stableBigintFromString(s: string): number {
  const hex = createHash('sha1').update(s).digest('hex').slice(0, 12);
  return parseInt(hex, 16);
}

