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
  /**
   * True when this result was READ BACK from a session that was already
   * complete · nothing was written on this call. Callers report what
   * happened, and "fired" for a read is the same class of drift as the
   * duplicate sessions this field exists because of.
   */
  alreadyCompleted: boolean;
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

/**
 * The auto-fire haircut. A calibration the runner never asked for is worth
 * less than one they tapped Start on, so it costs confidence and widens the
 * band. Named constants because the completion writes them and the read-back
 * below has to undo them; two hand-written 0.10s would drift.
 */
const UNTAPPED_CONFIDENCE_HAIRCUT = 0.10;
const UNTAPPED_BAND_WIDENING = 5;

/* ────────────────────────── Session state ────────────────────────── */

/** Everything the completion path needs to decide, in one row. */
interface SessionRow {
  id: string;
  was_start_tapped: boolean;
  completed_at: string | null;
  skipped_at: string | null;
  calibrated_easy_pace_s_per_mi: number | null;
  confidence: string | null;
  pillars: unknown;
}

const SESSION_COLS = `id::text,
            was_start_tapped,
            completed_at::text,
            skipped_at::text,
            calibrated_easy_pace_s_per_mi,
            confidence::text,
            pillars`;

/**
 * The runner's most recent stated position on calibration, WHATEVER it is.
 *
 * Deliberately unfiltered. The old lookup asked only for rows that were
 * neither completed nor skipped, so a completed session and a skipped session
 * both read as "nothing here" and the caller minted a fresh one. Ordering by
 * `started_at DESC` and reading the state off the row makes an explicit
 * re-start still win, because a re-start is a NEWER row.
 */
async function latestSession(userUuid: string): Promise<SessionRow | undefined> {
  return (await pool.query<SessionRow>(
    `SELECT ${SESSION_COLS}
       FROM calibration_sessions
      WHERE user_uuid = $1::uuid
      ORDER BY started_at DESC LIMIT 1`,
    [userUuid],
  )).rows[0];
}

/** Confidence + band for a fresh completion. One place, so the read-back can
 *  invert it exactly. */
function gradeFor(qualified: boolean, wasStartTapped: boolean): {
  confidence: number;
  bandSPerMi: number;
} {
  let confidence = qualified ? CONFIDENCE_QUALIFIED : CONFIDENCE_WIDE_BAND;
  let bandSPerMi = qualified ? BAND_QUALIFIED : BAND_WIDE;
  if (!wasStartTapped) {
    confidence = Math.max(0, confidence - UNTAPPED_CONFIDENCE_HAIRCUT);
    bandSPerMi = bandSPerMi + UNTAPPED_BAND_WIDENING;
  }
  return { confidence, bandSPerMi };
}

function parsePillars(raw: unknown, paceSPerMi: number): CalibrationPillars {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const p = v as Partial<CalibrationPillars> | null;
  if (p && typeof p.miles2to3AvgPaceSPerMi === 'number') return p as CalibrationPillars;
  // A completed session whose pillars did not survive still has a pace and a
  // confidence, which is what every consumer reads. Say what is missing rather
  // than inventing a distance and a variance that were never measured.
  return {
    miles2to3AvgPaceSPerMi: paceSPerMi,
    paceVarianceSPerMi: 0,
    hrDriftBpmPerMi: null,
    runDistanceMi: 0,
    qualifiedReasons: ['pillars not stored on this session'],
  };
}

/**
 * Read a COMPLETED session back as the result it produced. No writes.
 *
 * `qualified` is not a column, so it is recovered by undoing the auto-fire
 * haircut: a tapped session scores 0.70/0.45, an untapped one 0.60/0.35.
 */
function resultFromCompletedRow(row: SessionRow): CalibrationResult | null {
  const pace = row.calibrated_easy_pace_s_per_mi != null
    ? Number(row.calibrated_easy_pace_s_per_mi) : NaN;
  if (!isFinite(pace)) return null;

  const wasStartTapped = !!row.was_start_tapped;
  const stored = row.confidence != null ? Number(row.confidence) : NaN;
  const undone = isFinite(stored)
    ? stored + (wasStartTapped ? 0 : UNTAPPED_CONFIDENCE_HAIRCUT)
    : NaN;
  const qualified = isFinite(undone) && undone >= CONFIDENCE_QUALIFIED - 1e-9;
  const grade = gradeFor(qualified, wasStartTapped);

  return {
    sessionId: Number(row.id),
    calibratedEasyPaceSPerMi: pace,
    bandSPerMi: grade.bandSPerMi,
    confidence: isFinite(stored) ? stored : grade.confidence,
    pillars: parsePillars(row.pillars, pace),
    qualified,
    wasStartTapped,
    alreadyCompleted: true,
  };
}

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
 * existing result. A skipped session is an ANSWER, not an empty slot:
 * it returns null and writes nothing. Only when the runner has no
 * session at all does this create one for this run (the auto-fire path
 * from the run-write pipeline).
 *
 * Returns null when the run isn't usable (no distance, no splits at
 * all, > 14 days old). The session stays in_progress; next qualifying
 * run gets a fresh shot.
 *
 * ── WHY THIS IS WRITTEN THE WAY IT IS ────────────────────────────────
 *
 * The docstring above said "idempotent" from the day it shipped and the
 * code never did it. The session lookup asked for
 * `completed_at IS NULL AND skipped_at IS NULL`, so a runner who had
 * already calibrated, and a runner who had explicitly skipped, both
 * read as "no session" · and the next line INSERTed a fresh one,
 * completed it, and stamped another `coach_intents` row.
 * `post-write-hooks.ts` calls this on EVERY run write.
 *
 * Confirmed in production 2026-08-25: the owner's account held 31
 * calibration sessions, all 31 completed, 0 skipped. There should be
 * one. `lib/coach/voice-band.ts` reads the most recent completed
 * session and HARD-OVERRIDES the coaching voice band when confidence
 * clears its threshold, which the auto-fire path reaches at 0.60. So
 * the runner's coaching voice was being set from evidence they never
 * volunteered, and re-set on every qualifying run.
 *
 * Two rules, both enforced before any work happens:
 *
 *   · COMPLETED IS FINAL. Return what the session already produced.
 *     Whether a very old or fitness-superseded session should ever be
 *     re-run is a POLICY question and is deliberately NOT decided here.
 *
 *   · SKIPPED IS FINAL. A refusal is a correct answer, not an empty
 *     state. The runner can still overrule themselves: tapping Start
 *     again writes a NEWER row, and this reads the newest row.
 */
export async function completeCalibrationSession(
  userUuid: string,
  runId: string,
): Promise<CalibrationResult | null> {
  // 0. What has this runner already said? Asked FIRST, before the run read
  //    and the pillar math, because on a calibrated runner every later step
  //    is work whose result is thrown away.
  const prior = await latestSession(userUuid);
  if (prior?.completed_at) return resultFromCompletedRow(prior);
  if (prior?.skipped_at) return null;

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
  // COERCE-CALIB-1 (2026-08-30) · Rule 11 + Rule 16. Two of the three
  // disqualifiers run unconditionally; the HR-drift one is gated on
  // `hrDriftBpmPerMi != null`, so a run with no heart-rate data CANNOT be
  // disqualified for drift — and then reported `'all thresholds passed'`, a
  // sentence asserting the result of a test that never ran. This run goes on to
  // be the calibrated easy-pace anchor for everything downstream, so the claim
  // is load-bearing rather than cosmetic. Say which thresholds were checked.
  const hrDriftChecked = pillars.hrDriftBpmPerMi != null;
  pillars.qualifiedReasons = qualifiedReasons.length === 0
    ? [hrDriftChecked ? 'all thresholds passed' : 'distance and pace variance passed · no HR on this run, drift not checked']
    : qualifiedReasons;

  // 4. The session to complete. `prior` is in_progress or absent · step 0
  //    already returned for completed and skipped, so there is nothing left
  //    here to overwrite.
  let session = prior;

  if (!session) {
    // Auto-fire path · runner didn't tap "Start calibration" but
    // completed a qualifying run. Create the row with was_start_tapped=false.
    session = (await pool.query<SessionRow>(
      `INSERT INTO calibration_sessions (user_uuid, was_start_tapped)
       VALUES ($1::uuid, false)
       RETURNING ${SESSION_COLS}`,
      [userUuid],
    )).rows[0];
  }

  const wasStartTapped = !!session.was_start_tapped;

  // 5. Confidence + band · wide-band fallback for the auto-fired path.
  const { confidence, bandSPerMi } = gradeFor(qualified, wasStartTapped);

  // 6. Write the completion + coach_intent in a single txn
  const client = await pool.connect();
  let raced = false;
  try {
    await client.query('BEGIN');

    // The WHERE carries the idempotence, so two ingest paths landing runs at
    // the same moment cannot both complete the same session. Step 0's read is
    // the fast path; this is the one that actually holds. rowCount 0 means
    // somebody else answered between the read and the write · their answer
    // stands and this one rolls back rather than stamping a second intent.
    const upd = await client.query(
      `UPDATE calibration_sessions
          SET completed_at = NOW(),
              run_id = $2,
              calibrated_easy_pace_s_per_mi = $3,
              confidence = $4,
              pillars = $5::jsonb
        WHERE id = $1::bigint
          AND completed_at IS NULL
          AND skipped_at IS NULL`,
      [
        session.id,
        runId,
        pillars.miles2to3AvgPaceSPerMi,
        confidence.toFixed(2),
        JSON.stringify(pillars),
      ],
    );

    if ((upd.rowCount ?? 0) === 0) {
      raced = true;
      await client.query('ROLLBACK');
    } else {
      await client.query(
        `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
         VALUES ($1::uuid, $1::uuid, NOW(), 'calibration_completed',
                 'easyPaceSPerMi', $2::text)`,
        [userUuid, String(pillars.miles2to3AvgPaceSPerMi)],
      );
      await client.query('COMMIT');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[calibration/complete] txn failed:', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    client.release();
  }

  if (raced) {
    const settled = await latestSession(userUuid);
    return settled?.completed_at ? resultFromCompletedRow(settled) : null;
  }

  return {
    sessionId: Number(session.id),
    calibratedEasyPaceSPerMi: pillars.miles2to3AvgPaceSPerMi,
    bandSPerMi,
    confidence,
    pillars,
    qualified,
    wasStartTapped,
    alreadyCompleted: false,
  };
}

/**
 * Skip · runner explicitly dismissed calibration. Suppresses the prompt for
 * 7 days (consumer-side gating via status() === 'skipped') and stops the
 * run-write pipeline auto-completing a session they did not ask for.
 *
 * The refusal is always WRITTEN, even when there is no active session to
 * mark. A runner can meet the banner before ever tapping Start, and the
 * UPDATE alone matched nothing for them, so the dismissal left no trace and
 * their next qualifying run auto-calibrated regardless. A refusal that
 * records nothing is indistinguishable from never having been asked.
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
  if ((result.rowCount ?? 0) > 0) return { ok: true };

  const prior = await latestSession(userUuid);
  // Already calibrated · there is no prompt left to suppress, and a skip must
  // not look like it undid a completed session.
  if (prior?.completed_at) return { ok: false };
  // Already refused · idempotent, and re-stamping would restart the 7 days.
  if (prior?.skipped_at) return { ok: true };

  await pool.query(
    `INSERT INTO calibration_sessions (user_uuid, was_start_tapped, skipped_at)
     VALUES ($1::uuid, false, NOW())`,
    [userUuid],
  );
  return { ok: true };
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
