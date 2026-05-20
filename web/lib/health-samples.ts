/**
 * S6/native-bridge · HealthKit ingest helpers.
 *
 * Phase 1 item 3 of the iPhone-bridge work.  The iPhone app reads
 * samples from Apple HealthKit (resting HR, sleep, VO2max, workout
 * HR averages) and POSTs them to /api/health/ingest.  This module
 * is the storage + validation layer underneath that route.
 *
 * TWO STORAGE PATHS:
 *
 *   1. health_samples table · time-series storage · always written
 *      to (idempotent on user_id + sample_type + sample_date)
 *
 *   2. Dedicated "latest value" cache columns:
 *        users.resting_hr           ← resting_hr samples
 *        users.max_hr               ← max_hr samples (rare; HealthKit
 *                                     can sometimes emit higher peaks
 *                                     from running activities)
 *        profile.vo2max_apple       ← vo2_max samples
 *        profile.vo2max_apple_updated_at
 *
 *      Updated when the incoming sample is newer than the stored
 *      value's timestamp.  Resolvers (fitness-resolver, profile reads)
 *      read these dedicated columns; the time-series table is for
 *      future aggregation surfaces.
 *
 * VALIDATION RULES (plausibility + sanity):
 *
 *   resting_hr      · 25-100 bpm
 *   max_hr          · 100-230 bpm  (matches users.max_hr check)
 *   vo2_max         · 20-90 ml/kg/min
 *   sleep_hours     · 0-16 hours
 *   workout_hr_avg  · 60-220 bpm
 *
 *   dateISO must parse, must not be in the future (allow 12h slack
 *   for timezone-edge weirdness), must not be > 365 days old (anything
 *   older isn't useful for current-fitness computation).
 */

import { query } from './db';

// ── Sample type taxonomy ─────────────────────────────────────────

export type HealthSampleType =
  | 'resting_hr'
  | 'max_hr'
  | 'vo2_max'
  | 'sleep_hours'
  | 'workout_hr_avg'
  | 'hrv';

export const SAMPLE_TYPES: readonly HealthSampleType[] = [
  'resting_hr',
  'max_hr',
  'vo2_max',
  'sleep_hours',
  'workout_hr_avg',
  'hrv',
] as const;

interface ValidationRange {
  min: number;
  max: number;
}

const RANGES: Record<HealthSampleType, ValidationRange> = {
  resting_hr:     { min: 25,  max: 100 },
  max_hr:         { min: 100, max: 230 },
  vo2_max:        { min: 20,  max: 90 },
  sleep_hours:    { min: 0,   max: 16 },
  workout_hr_avg: { min: 60,  max: 220 },
  // HRV as SDNN in milliseconds. Plausible adult range spans single
  // digits (high stress / poor recovery) to ~200 ms (very fit, rested).
  hrv:            { min: 5,   max: 250 },
};

// ── Input shape · what /api/health/ingest accepts ────────────────

export interface HealthSampleInput {
  type: string;          // validated against SAMPLE_TYPES
  value: number;         // validated against RANGES per type
  dateISO: string;       // 'YYYY-MM-DD' · validated as plausible date
  source?: string;       // defaults to 'apple_health'
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  ingested: number;
  skipped: number;
  errors: Array<{ index: number; reason: string }>;
  byType: Partial<Record<HealthSampleType, number>>;
}

// ── Validation ───────────────────────────────────────────────────

export interface ValidationError {
  reason: string;
}

/**
 * Validate a single sample.  Returns null when valid, otherwise the
 * specific reason it failed.  Caller maps to errors[] with the
 * original index.
 */
export function validateSample(s: HealthSampleInput): ValidationError | null {
  if (!s.type || typeof s.type !== 'string') {
    return { reason: 'type missing' };
  }
  if (!SAMPLE_TYPES.includes(s.type as HealthSampleType)) {
    return { reason: `unknown sample type "${s.type}"` };
  }
  if (typeof s.value !== 'number' || !Number.isFinite(s.value)) {
    return { reason: 'value must be a finite number' };
  }
  const range = RANGES[s.type as HealthSampleType];
  if (s.value < range.min || s.value > range.max) {
    return { reason: `value ${s.value} outside plausible range [${range.min}, ${range.max}]` };
  }
  if (!s.dateISO || typeof s.dateISO !== 'string') {
    return { reason: 'dateISO missing' };
  }
  // Strict YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dateISO)) {
    return { reason: `dateISO must be YYYY-MM-DD, got "${s.dateISO}"` };
  }
  const parsed = Date.parse(s.dateISO + 'T12:00:00Z');
  if (!Number.isFinite(parsed)) {
    return { reason: `dateISO unparseable: "${s.dateISO}"` };
  }
  const now = Date.now();
  if (parsed > now + 12 * 60 * 60 * 1000) {
    return { reason: 'dateISO is in the future' };
  }
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  if (parsed < oneYearAgo) {
    return { reason: 'dateISO is > 365 days old' };
  }
  if (s.source && typeof s.source !== 'string') {
    return { reason: 'source must be a string' };
  }
  return null;
}

// ── Storage ──────────────────────────────────────────────────────

/**
 * Ingest a batch of HealthKit samples for a user.
 *
 *  · Validates each sample independently · invalid ones are reported
 *    in errors[] but don't abort the batch
 *  · Idempotent UPSERT on (user_id, sample_type, sample_date) ·
 *    re-sending the same date overwrites the prior value
 *  · For resting_hr / max_hr / vo2_max · also updates the dedicated
 *    "latest value" cache column when this sample is the most recent
 */
export async function ingestSamples(
  userId: string,
  samples: HealthSampleInput[],
): Promise<IngestResult> {
  const result: IngestResult = {
    ingested: 0,
    skipped: 0,
    errors: [],
    byType: {},
  };

  if (!Array.isArray(samples) || samples.length === 0) {
    return result;
  }
  if (samples.length > 1000) {
    // Safety cap · larger batches should paginate
    result.errors.push({ index: -1, reason: 'batch too large (>1000 samples)' });
    return result;
  }

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const validation = validateSample(s);
    if (validation) {
      result.errors.push({ index: i, reason: validation.reason });
      result.skipped++;
      continue;
    }

    const type = s.type as HealthSampleType;
    const source = s.source || 'apple_health';

    try {
      // 1. Write to time-series table (UPSERT)
      await query(
        `INSERT INTO health_samples (user_id, sample_type, value, sample_date, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, sample_type, sample_date)
         DO UPDATE SET value = EXCLUDED.value,
                       source = EXCLUDED.source,
                       metadata = EXCLUDED.metadata,
                       recorded_at = NOW()`,
        [userId, type, s.value, s.dateISO, source, s.metadata ? JSON.stringify(s.metadata) : null],
      );

      // 2. Sync the dedicated "latest value" cache when applicable
      await syncLatestValueCache(userId, type, s.value, s.dateISO);

      result.ingested++;
      result.byType[type] = (result.byType[type] ?? 0) + 1;
    } catch (err) {
      result.errors.push({
        index: i,
        reason: err instanceof Error ? err.message : 'database error',
      });
      result.skipped++;
    }
  }

  return result;
}

/**
 * Sync the dedicated "latest value" cache column for sample types that
 * have one.  Only writes when this sample is at-or-after the most
 * recently stored sample of that type for the user.
 *
 * Resting HR · stored on users.resting_hr · no timestamp column today,
 * so we compare against the latest health_samples row for the same
 * type to decide whether to update.
 *
 * Max HR · stored on users.max_hr · same pattern, plus we stamp
 * users.max_hr_updated_at (which DOES exist, per the S6 migration) so
 * the Z2 sparkline three-case window check sees the recalibration.
 *
 * VO2max · stored on profile.vo2max_apple + .vo2max_apple_updated_at ·
 * uses the timestamp column directly.
 *
 * sleep_hours and workout_hr_avg have no dedicated cache today.
 */
async function syncLatestValueCache(
  userId: string,
  type: HealthSampleType,
  value: number,
  dateISO: string,
): Promise<void> {
  if (type === 'resting_hr') {
    // Update users.resting_hr if this sample is the most recent.
    const rows = await query<{ latest_date: string | null }>(
      `SELECT MAX(sample_date)::TEXT AS latest_date
         FROM health_samples
        WHERE user_id = $1 AND sample_type = 'resting_hr'`,
      [userId],
    );
    if (!rows[0]?.latest_date || dateISO >= rows[0].latest_date) {
      await query(
        `UPDATE users SET resting_hr = $2 WHERE id = $1`,
        [userId, Math.round(value)],
      );
    }
    return;
  }

  if (type === 'max_hr') {
    // Update users.max_hr + stamp max_hr_updated_at for the V7 Z2
    // sparkline three-case window logic.  Only update if this sample
    // is the most recent AND higher than current (max HR ratchets up).
    const rows = await query<{ current_max_hr: number | null; latest_date: string | null }>(
      `SELECT u.max_hr AS current_max_hr,
              (SELECT MAX(sample_date)::TEXT
                 FROM health_samples
                WHERE user_id = u.id AND sample_type = 'max_hr') AS latest_date
         FROM users u
        WHERE u.id = $1
        LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return;
    const isNewest = !row.latest_date || dateISO >= row.latest_date;
    const isHigher = row.current_max_hr == null || value > row.current_max_hr;
    if (isNewest && isHigher) {
      await query(
        `UPDATE users SET max_hr = $2, max_hr_updated_at = NOW() WHERE id = $1`,
        [userId, Math.round(value)],
      );
    }
    return;
  }

  if (type === 'vo2_max') {
    // VO2max storage note: the dedicated cache columns
    // (profile.vo2max_apple + profile.vo2max_apple_updated_at) live
    // on the LEGACY SINGLE-TENANT profile table (user_id TEXT DEFAULT
    // 'me').  Writing there from a multi-tenant native ingest would
    // either bind to 'me' (clobbering legacy data) or fail.
    //
    // For native ingest, vo2_max is stored in health_samples only.
    // Cold-start VDOT fallback (lib/vo2max-apple.ts) currently reads
    // the legacy profile column; updating that resolver to read from
    // health_samples for multi-tenant users is a separate cleanup
    // queued for the tier-2 → tier-1 lift work.
    return;
  }

  // sleep_hours, workout_hr_avg · time-series only, no cache column.
}
