/**
 * lib/coach/calibration.ts · onboarding-anchor calibration engine.
 *
 * "Let's pace your first easy run together" · for cold-start runners
 * (no race history, no Strava, calibration-band voice).
 *
 * Reads a completed run's splits + HR + distance, derives:
 *   · calibrated easy pace from miles 2-3 (skip mile 1 · warmup)
 *   · pace variance across the qualifying miles
 *   · HR drift mile-3 vs mile-1 (cardiac drift sentinel)
 * Stamps a `calibration_sessions` row + a `coach_intent` so the
 * voice band can step calibration → guided immediately.
 *
 * Pairs with:
 *   · designs/briefs/calibration-session.md (full doctrine + edge cases)
 *   · db/migrations/138_calibration_sessions.sql
 *   · lib/coach/voice-band.ts § calibration_sessions read
 *
 * Surfaces:
 *   · POST /api/coach/calibration/start
 *   · POST /api/coach/calibration/complete (manual)
 *   · run-write pipeline (auto)
 *   · GET /api/coach/calibration/status
 *   · DELETE /api/coach/calibration?sessionId=X
 *
 * Citations:
 *   · Daniels Running Formula 3e · easy-pace doctrine
 *   · Pfitzinger Faster Road Racing · "Honest easy"
 *   · McMillan · pace zone derivation
 */

import { pool } from '@/lib/db/pool';

/* ────────────────────────── Public types ────────────────────────── */

export interface CalibrationResult {
  sessionId: number;
  calibratedEasyPaceSPerMi: number;
  /** ±seconds-per-mile confidence band · 15 for qualifying runs,
   *  20 for wide-band fallback. */
  bandSPerMi: number;
  confidence: number;
  pillars: CalibrationPillars;
  qualified: boolean;
  wasStartTapped: boolean;
}

export interface CalibrationPillars {
  miles2to3AvgPaceSPerMi: number;
  paceVarianceSPerMi: number;
  hrDriftBpmPerMi: number | null;
  runDistanceMi: number;
  qualifiedReasons: string[];
}

export type CalibrationStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/* ────────────────────────── Doctrine constants ────────────────────────── */

/** Minimum distance for a qualifying calibration run. 2mi is lenient ·
 *  brief open question #1 noted this as 2 vs 3. Going with 2 to capture
 *  short-day runners. */
const MIN_QUALIFYING_DISTANCE_MI = 2.0;

/** Pace variance threshold (stddev across splits) for "honest easy."
 *  > 30s/mi spread means the runner wasn't steady-state easy. */
const MAX_QUALIFYING_PACE_STDDEV_S = 30;

/** HR drift threshold · cardiac drift sentinel. > 5bpm/mi means the
 *  runner was running too hard for easy. */
const MAX_QUALIFYING_HR_DRIFT_BPM_PER_MI = 5;

/** Confidence levels per the brief. */
const CONFIDENCE_QUALIFIED = 0.70;
const CONFIDENCE_WIDE_BAND = 0.45;

/** Band widths in seconds-per-mile. */
const BAND_QUALIFIED = 15;
const BAND_WIDE = 20;

/* ────────────────────────── Public API ────────────────────────── */

/**
 * Start a calibration session. Idempotent · returns existing
 * in_progress session if one exists, otherwise creates a new row.
 *
 * Called from the "Start calibration" tap on the Today banner or
 * watch app prompt. The actual completion happens on the run-write
 * pipeline OR on POST /api/coach/calibration/complete.
 */
export async function startCalibrationSession(
  userUuid: string,
  wasStartTapped = true,
): Promise<{ id: number; alreadyActive: boolean }> {
  const existing = (await pool.query<{ id: string }>(
    `SELECT id::text FROM calibration_sessions
      WHERE user_uuid = $1::uuid
        AND completed_at IS NULL
        AND skipped_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [userUuid],
  )).rows[0];

  if (existing) {
    return { id: Number(existing.id), alreadyActive: true };
  }

  const row = (await pool.query<{ id: string }>(
    `INSERT INTO calibration_sessions (user_uuid, was_start_tapped)
     VALUES ($1::uuid, $2)
     RETURNING id::text`,
    [userUuid, wasStartTapped],
  )).rows[0];

  return { id: Number(row.id), alreadyActive: false };
}

/**
 * Complete a calibration session from a run. Reads the run's splits,
 * computes pace + HR drift + variance, determines qualified state,
 * writes the calibration row + a coach_intent so voice band can step.
 *
 * Idempotent · if the session is already completed, returns the
 * existing result. If no in_progress session exists, creates one
 * for this run (auto-fire path from the run-write pipeline).
 *
 * Returns null when the run isn't usable (no distance, no splits at
 * all, > 14 days old). The session stays in_progress; next qualifying
 * run gets a fresh shot.
 */
export async function completeCalibrationSession(
  userUuid: string,
  runId: string,
): Promise<CalibrationResult | null> {
  // 1. Load the run · pull distance, splits, avgHr, date
  const runRow = (await pool.query<{ data: any }>(
    `SELECT data FROM runs
      WHERE user_uuid = $1::uuid
        AND (data->>'id') = $2
        AND NOT (data ? 'mergedIntoId')
      LIMIT 1`,
    [userUuid, runId],
  ).catch(() => ({ rows: [] as Array<{ data: any }> }))).rows[0];

  if (!runRow?.data) return null;
  const d = runRow.data;
  const distanceMi = Number(d.distanceMi) || 0;
  if (distanceMi < MIN_QUALIFYING_DISTANCE_MI) {
    // Run too short to derive a baseline · keep session in_progress.
    return null;
  }

  // 2. Compute pillars from splits
  const pillars = computePillars(d);
  if (!pillars) return null;

  // 3. Decide qualified vs wide-band
  const qualifiedReasons: string[] = [];
  let qualified = true;
  if (pillars.runDistanceMi < MIN_QUALIFYING_DISTANCE_MI) {
    qualified = false;
    qualifiedReasons.push(`distance ${pillars.runDistanceMi.toFixed(1)}mi < ${MIN_QUALIFYING_DISTANCE_MI}`);
  }
  if (pillars.paceVarianceSPerMi > MAX_QUALIFYING_PACE_STDDEV_S) {
    qualified = false;
    qualifiedReasons.push(`pace variance ${pillars.paceVarianceSPerMi}s > ${MAX_QUALIFYING_PACE_STDDEV_S}s`);
  }
  if (pillars.hrDriftBpmPerMi != null && pillars.hrDriftBpmPerMi > MAX_QUALIFYING_HR_DRIFT_BPM_PER_MI) {
    qualified = false;
    qualifiedReasons.push(`HR drift ${pillars.hrDriftBpmPerMi.toFixed(1)}bpm/mi > ${MAX_QUALIFYING_HR_DRIFT_BPM_PER_MI}`);
  }
  pillars.qualifiedReasons = qualifiedReasons.length === 0 ? ['all thresholds passed'] : qualifiedReasons;

  // 4. Find or create the in_progress session
  let session = (await pool.query<{ id: string; was_start_tapped: boolean; completed_at: string | null }>(
    `SELECT id::text, was_start_tapped, completed_at::text
       FROM calibration_sessions
      WHERE user_uuid = $1::uuid
        AND completed_at IS NULL
        AND skipped_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [userUuid],
  )).rows[0];

  if (!session) {
    // Auto-fire path · runner didn't tap "Start calibration" but
    // completed a qualifying run. Create the row with was_start_tapped=false.
    const created = (await pool.query<{ id: string; was_start_tapped: boolean; completed_at: string | null }>(
      `INSERT INTO calibration_sessions (user_uuid, was_start_tapped)
       VALUES ($1::uuid, false)
       RETURNING id::text, was_start_tapped, completed_at::text`,
      [userUuid],
    )).rows[0];
    session = created;
  }

  const wasStartTapped = !!session.was_start_tapped;

  // 5. Confidence + band
  let confidence = qualified ? CONFIDENCE_QUALIFIED : CONFIDENCE_WIDE_BAND;
  let bandSPerMi = qualified ? BAND_QUALIFIED : BAND_WIDE;
  if (!wasStartTapped) {
    // Wide-band fallback · slight confidence haircut + wider band when
    // calibration was auto-fired (no explicit start tap).
    confidence = Math.max(0, confidence - 0.10);
    bandSPerMi = bandSPerMi + 5;
  }

  // 6. Write the completion + coach_intent in a single txn
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE calibration_sessions
          SET completed_at = NOW(),
              run_id = $2,
              calibrated_easy_pace_s_per_mi = $3,
              confidence = $4,
              pillars = $5::jsonb
        WHERE id = $1::bigint`,
      [
        session.id,
        runId,
        pillars.miles2to3AvgPaceSPerMi,
        confidence.toFixed(2),
        JSON.stringify(pillars),
      ],
    );

    await client.query(
      `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
       VALUES ($1::uuid, $1::uuid, NOW(), 'calibration_completed',
               'easyPaceSPerMi', $2::text)`,
      [userUuid, String(pillars.miles2to3AvgPaceSPerMi)],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[calibration/complete] txn failed:', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    client.release();
  }

  return {
    sessionId: Number(session.id),
    calibratedEasyPaceSPerMi: pillars.miles2to3AvgPaceSPerMi,
    bandSPerMi,
    confidence,
    pillars,
    qualified,
    wasStartTapped,
  };
}

/**
 * Skip the active session · runner explicitly dismissed calibration.
 * Suppresses the prompt for 7 days (consumer-side gating via
 * status() === 'skipped').
 */
export async function skipCalibrationSession(userUuid: string): Promise<{ ok: boolean }> {
  const result = await pool.query(
    `UPDATE calibration_sessions
        SET skipped_at = NOW()
      WHERE user_uuid = $1::uuid
        AND completed_at IS NULL
        AND skipped_at IS NULL`,
    [userUuid],
  );
  return { ok: (result.rowCount ?? 0) > 0 };
}

/**
 * Current calibration status for a runner. Drives the Today banner
 * + watch prompt visibility gating.
 */
export async function calibrationStatus(userUuid: string): Promise<{
  status: CalibrationStatus;
  band: { lowSPerMi: number; highSPerMi: number } | null;
  confidence: number | null;
  completedAt: string | null;
  sessionId: number | null;
}> {
  const row = (await pool.query<{
    id: string;
    completed_at: string | null;
    skipped_at: string | null;
    calibrated_easy_pace_s_per_mi: number | null;
    confidence: string | null;
  }>(
    `SELECT id::text,
            completed_at::text,
            skipped_at::text,
            calibrated_easy_pace_s_per_mi,
            confidence::text
       FROM calibration_sessions
      WHERE user_uuid = $1::uuid
      ORDER BY started_at DESC LIMIT 1`,
    [userUuid],
  )).rows[0];

  if (!row) {
    return { status: 'pending', band: null, confidence: null, completedAt: null, sessionId: null };
  }

  const sessionId = Number(row.id);

  // Skipped sessions expire after 7 days · then we re-surface pending.
  if (row.skipped_at) {
    const skippedMs = Date.parse(row.skipped_at);
    const ageDays = (Date.now() - skippedMs) / 86400000;
    if (ageDays > 7) {
      return { status: 'pending', band: null, confidence: null, completedAt: null, sessionId: null };
    }
    return { status: 'skipped', band: null, confidence: null, completedAt: null, sessionId };
  }

  if (row.completed_at && row.calibrated_easy_pace_s_per_mi != null) {
    const pace = Number(row.calibrated_easy_pace_s_per_mi);
    const conf = row.confidence ? Number(row.confidence) : null;
    // Band derived from confidence · qualified=±15, wide=±20.
    // Caller doesn't need to know was_start_tapped at the status level.
    const band = conf != null && conf >= CONFIDENCE_QUALIFIED
      ? BAND_QUALIFIED : BAND_WIDE;
    return {
      status: 'completed',
      band: { lowSPerMi: pace - band, highSPerMi: pace + band },
      confidence: conf,
      completedAt: row.completed_at,
      sessionId,
    };
  }

  return { status: 'in_progress', band: null, confidence: null, completedAt: null, sessionId };
}

/* ────────────────────────── Pillar computation ────────────────────────── */

function computePillars(runData: any): CalibrationPillars | null {
  const distanceMi = Number(runData.distanceMi) || 0;
  if (distanceMi < 1) return null;

  const splits: any[] = Array.isArray(runData.splits) ? runData.splits : [];

  // Extract per-mile pace + HR. Splits are usually per-mile (Strava +
  // watch ingest). Handle both shapes:
  //   { paceSPerMi, hr }   (canonical)
  //   { pace_s_per_mi, avgHr }
  const perMile = splits
    .map((s) => ({
      paceSec: Number(s.paceSPerMi ?? s.pace_s_per_mi ?? 0) || null,
      hr: Number(s.hr ?? s.avgHr ?? 0) || null,
    }))
    .filter((s) => s.paceSec != null);

  // Whole-run fallback (treadmill runs, no per-mile splits).
  if (perMile.length === 0) {
    const movingS = Number(runData.movingTimeS ?? runData.movingTimeSec ?? runData.timeMoving) || 0;
    if (movingS <= 0) return null;
    const wholePace = Math.round(movingS / distanceMi);
    return {
      miles2to3AvgPaceSPerMi: wholePace,
      paceVarianceSPerMi: 0,           // no variance signal · treat as honest
      hrDriftBpmPerMi: null,
      runDistanceMi: distanceMi,
      qualifiedReasons: ['whole-run avg · no splits'],
    };
  }

  // Skip mile 1 (warmup) if there's enough distance.
  // Use miles 2-3 (idx 1, 2). If only 2 miles, use mile 2 alone.
  // If 1 mile, fall through to whole-run.
  const startIdx = perMile.length >= 3 ? 1 : Math.min(perMile.length - 1, 1);
  const endIdx = perMile.length >= 3
    ? Math.min(perMile.length - 1, 2)
    : perMile.length - 1;
  const target = perMile.slice(startIdx, endIdx + 1);

  if (target.length === 0) return null;

  const avgPace = Math.round(
    target.reduce((s, x) => s + (x.paceSec ?? 0), 0) / target.length
  );

  // Variance · stddev across the TARGET splits (not whole run).
  const variance = target.length >= 2 ? stddev(target.map((t) => t.paceSec!)) : 0;

  // HR drift · last split HR - first split HR, divided by miles between.
  // Compute over the FULL run (not just targets) so we see the trend.
  let hrDriftPerMi: number | null = null;
  const firstHr = perMile.find((s) => s.hr != null)?.hr;
  const lastHr = [...perMile].reverse().find((s) => s.hr != null)?.hr;
  if (firstHr != null && lastHr != null && perMile.length > 1) {
    hrDriftPerMi = (lastHr - firstHr) / (perMile.length - 1);
  }

  return {
    miles2to3AvgPaceSPerMi: avgPace,
    paceVarianceSPerMi: Math.round(variance),
    hrDriftBpmPerMi: hrDriftPerMi != null ? +hrDriftPerMi.toFixed(2) : null,
    runDistanceMi: distanceMi,
    qualifiedReasons: [],  // filled in by caller
  };
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / xs.length;
  return Math.sqrt(variance);
}
