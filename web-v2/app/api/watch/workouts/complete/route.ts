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
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import { sanitizeSplits } from '@/lib/runs/split-sanity';
import { requireUserId } from '@/lib/auth/session';
import { isSubThresholdRun, MIN_DISTANCE_MI, MIN_DURATION_SEC } from '@/lib/runs/length-guard';
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
  completed?: boolean;
  paceSamples?: WatchCompletionPhaseSample[] | null;
  hrSamples?: WatchCompletionPhaseSample[] | null;
  timeInToleranceSec?: number | null;
  timeOutOfToleranceSec?: number | null;
  verdict?: string | null;
  repRpe?: number | null;
  repRpeTag?: string | null;
  // Treadmill-only extras (TreadmillView.buildPayload)
  actualSpeedMph?: number;
  actualInclinePct?: number;
}
interface WatchCompletionBody {
  workoutId: string;
  startedAt?: string;
  completedAt?: string;
  status?: string;            // 'completed' | 'partial' | 'abandoned'
  totalDistanceMi?: number | null;
  totalDurationSec?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  kcal?: number | null;
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
  // GPS polyline shipped directly by the watch app (build 172+). Eliminates
  // the separate iPhone HK import hop that was the sole GPS source.
  // 2026-06-08 · the watch's WatchCompletion (Encodable, no CodingKeys)
  // emits CAMELCASE `routePolyline` on the wire; the original `route_polyline`
  // read silently dropped every watch GPS track (Jun 8 regression). Declare
  // both shapes; the read site prefers camel and falls back to snake.
  routePolyline?: string | null;
  route_polyline?: string | null;
  // Device-measured elevation GAIN in feet, from the watch's barometer-fused
  // altitude (build 17x+). camelCase — same wire-contract lesson as
  // routePolyline (the Encodable struct emits camelCase; a snake_case read
  // silently dropped GPS for a day). Preferred over the GPS-polyline estimate.
  elevGainFt?: number | null;
  // Legacy fallback fields — older clients; prefer startedAt for date
  date?: string;
  dateLocal?: string;
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
  const avgPace = totalSec > 0 && totalMi > 0
    ? formatPace(Math.round(totalSec / totalMi))
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
  let plannedWorkoutType: string | null = null;
  try {
    const planDay = (await pool.query<{ type: string; distance_mi: string | null }>(
      `SELECT pw.type, pw.distance_mi::text
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso = $2
          AND pw.type NOT IN ('rest')
        LIMIT 1`,
      [userId, date],
    )).rows[0];
    if (planDay) {
      const plannedMi = planDay.distance_mi != null ? Number(planDay.distance_mi) : null;
      const distanceMatches = plannedMi == null || plannedMi <= 0
        ? true
        : totalMi >= plannedMi * 0.7 && totalMi <= plannedMi * 1.3;
      if (distanceMatches) {
        // race_week_tuneup is T-pace work · stamp as threshold so the
        // quality-type readers treat it as the T-effort it is.
        plannedWorkoutType = planDay.type === 'race_week_tuneup' ? 'threshold' : planDay.type;
      }
    }
  } catch (e: unknown) {
    // Non-fatal · an unstamped run is the pre-fix status quo.
    console.warn('[watch/complete] workoutType stamp failed:',
      e instanceof Error ? e.message : String(e));
  }

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
    timeMoving: totalSec > 0 ? formatMmSs(totalSec) : null,
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
    // Active calories from HKLiveWorkoutBuilder (2026-06-01) ·
    // resolveCalories() tier 1 reads this and skips the estimator
    // fallback when it's present. Optional · the watch may omit it
    // on very short runs or sensor glitches, and the field is also
    // omitted by older watch builds. Doctrine:
    // designs/briefs/iphone-calories-and-absorption-brief.md.
    kcal: body.kcal ?? null,
    // 2026-06-09 Phase 2 (3.2) · contingency-rule outcomes, verbatim.
    // "Took the bail" is a recorded DECISION the recap reasons about
    // (bail ≠ fail) · run-recap reads data.ruleOutcomes. Omitted by
    // old builds → key absent → all readers fall through.
    ...(Array.isArray(body.ruleOutcomes) && body.ruleOutcomes.length > 0
      ? { ruleOutcomes: body.ruleOutcomes }
      : {}),
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
    // F10: raw per-phase array stored directly on the run row so the
    // coach and VDOT engines can query per-phase actuals without a
    // JOIN to coach_intents. Empty array when old clients omit phases.
    ...(body.phases?.length ? { phases: body.phases } : {}),
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
  };
  // Splits reliability guard — same check as iPhone ingest (finding 1.7).
  // deriveSplitsFromPaceSamples can yield an n-1 array when the final
  // mile has no pace-sample crossing: splits sum < duration by ~1 mile
  // worth of seconds. Flag and drop so consumers don't see truncated data.
  if (Array.isArray(data.splits) && data.splits.length > 0 && totalSec > 0) {
    const splitsSumS = (data.splits as Array<Record<string, unknown>>).reduce((acc, s) => {
      const distMi = typeof s.distanceMi === 'number' ? s.distanceMi : 1;
      return acc + (typeof s.paceSecPerMi === 'number' ? s.paceSecPerMi * distMi : 0);
    }, 0);
    if (Math.abs(Math.round(splitsSumS) - totalSec) > 5) {
      data.splits = [];
      data.splits_unreliable = true;
    } else {
      // Whole-run split-sum passed → apply the per-mile physiological guard
      // so a single GPS-spike mile (impossible pace for its HR) is flagged
      // rather than shown as a real fast split. See lib/runs/split-sanity.ts.
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

  // Event-driven cache: a workout just finished. Bust only the surfaces
  // a run actually changes (today + training); /races + /profile + /health
  // don't need fresh voice for a single run. See lib/coach/regen-policy.ts.
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
    api_version: 'watch-complete/p22-upsert',
    // Strava-table write outcome surfaced explicitly: harmless on
    // success, and on failure tells the watch agent + audit harnesses
    // exactly what went wrong without log access.
    strava_write: stravaWriteErr ? { ok: false, error: stravaWriteErr } : { ok: true },
    intents_write: intentsErr ? { ok: false, error: intentsErr } : { ok: true },
  }, { status: retryableFailure ? 500 : 200 });
}

// ── helpers ──

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

/**
 * deriveSplitsFromPaceSamples — derive genuine per-mile splits from the
 * watch's 5-second paceSamples stream.
 *
 * 2026-06-06 · This replaces the prior strategy of relying on iPhone HK
 * ingest to produce splits.  The iPhone path was fragile:
 *   · The reconciliation guard (round 71, fixed round 90) was comparing
 *     sumOfFullMileTimes to workout.duration WITHOUT the trailing fractional
 *     mile, silently dropping splits on every run since 2026-05-29.
 *   · Even when fixed, the iPhone HK ingest fires ~30-60s after the watch
 *     endpoint, so the watch canonical row always wins tier-5 and the iPhone
 *     HK row (tier-2 loser) has to be absorbed. With no splits on the apple_
 *     watch row there's nothing to absorb.
 *
 * The watch already sends the FULL GPS-pace sample stream (one sample every
 * ~5 seconds, distMi cumulative, tSec from phase-start).  Walking those
 * samples to find mile-boundary crossings is identical to what iPhone's
 * perMileSplits does from HKWorkoutRoute locations — just run server-side
 * instead of on the phone.
 *
 * Algorithm:
 *   · Flatten all phases into a single distMi + tSec timeline with offsets.
 *   · Walk sample pairs; when distMi crosses a whole-mile boundary, linearly
 *     interpolate the exact tSec at the crossing.
 *   · per-mile elapsed = crossingTime[N] − crossingTime[N-1].
 *   · Average HR from hrSamples in the same time window.
 *   · Guard: 120s ≤ elapsed ≤ 3600s per mile (same sanity range as iPhone).
 *
 * Returns null when:
 *   · no phase has paceSamples with distMi populated
 *   · fewer than 1 full mile completed
 */
function deriveSplitsFromPaceSamples(
  phases: WatchCompletionPhaseBody[]
): Array<{ mile: number; pace: string; hr: number | null; paceSecPerMi: number }> | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;

  // Flatten phases into a single timeline with dist + time offsets
  interface FlatSample { tSec: number; distMi: number; bpm: number | null }
  const flat: FlatSample[] = [];
  let distOffset = 0;
  let tOffset = 0;

  for (const phase of phases) {
    const ps = phase.paceSamples ?? [];
    const hs = phase.hrSamples ?? [];
    if (ps.length === 0) { distOffset += Number(phase.actualDistanceMi ?? 0); tOffset += Number(phase.actualDurationSec ?? 0); continue; }

    // HR lookup for this phase by tSec
    const hrByT = new Map<number, number>();
    for (const h of hs) { if (h.bpm != null && h.bpm > 0) hrByT.set(h.tSec, h.bpm); }

    for (const s of ps) {
      if (s.distMi == null) continue;
      flat.push({
        tSec: s.tSec + tOffset,
        distMi: s.distMi + distOffset,
        bpm: hrByT.get(s.tSec) ?? null,
      });
    }

    // Advance offsets by the phase's actual values (not sample-derived)
    // so rounding in GPS doesn't accumulate across phases
    distOffset += Number(phase.actualDistanceMi ?? (ps[ps.length-1]?.distMi ?? 0));
    tOffset += Number(phase.actualDurationSec ?? (ps[ps.length-1]?.tSec ?? 0));
  }

  if (flat.length < 2) return null;
  flat.sort((a, b) => a.tSec - b.tSec);

  const splits: Array<{ mile: number; pace: string; hr: number | null; paceSecPerMi: number }> = [];
  let mileNo = 1;
  let prevCrossT = 0;

  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1];
    const curr = flat[i];
    const span = curr.distMi - prev.distMi;
    if (span <= 0) continue;

    // One sample pair can cross multiple mile boundaries (e.g. a fast downhill)
    while (curr.distMi >= mileNo && prev.distMi < mileNo) {
      const frac = (mileNo - prev.distMi) / span;
      const crossT = prev.tSec + frac * (curr.tSec - prev.tSec);
      const elapsedSec = Math.round(crossT - prevCrossT);

      if (elapsedSec >= 120 && elapsedSec <= 3600) {
        // Average HR from samples in this mile's window
        const windowSamples = flat.filter(s => s.tSec >= prevCrossT && s.tSec <= crossT && s.bpm != null);
        const avgHr = windowSamples.length > 0
          ? Math.round(windowSamples.reduce((sum, s) => sum + (s.bpm!), 0) / windowSamples.length)
          : null;

        splits.push({
          mile: mileNo,
          pace: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`,
          hr: avgHr,
          paceSecPerMi: elapsedSec,
        });
      }
      prevCrossT = crossT;
      mileNo++;
    }
  }

  return splits.length > 0 ? splits : null;
}
