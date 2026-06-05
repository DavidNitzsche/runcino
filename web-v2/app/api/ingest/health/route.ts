/**
 * POST /api/ingest/health
 *
 * Batch ingest of HealthKit samples from the iPhone. Mirrors what an
 * iOS HKObserverQuery + HKSampleQuery would post nightly + on-foreground.
 *
 * Body:
 * {
 *   samples: [
 *     { sample_type: 'sleep_hours', value: 7.2, sample_date: '2026-05-24', recorded_at: '2026-05-25T07:00:00Z' },
 *     { sample_type: 'hrv',         value: 71,  sample_date: '2026-05-25', recorded_at: '2026-05-25T07:00:00Z' },
 *     { sample_type: 'resting_hr',  value: 47,  sample_date: '2026-05-25', recorded_at: '2026-05-25T06:30:00Z' },
 *     { sample_type: 'vo2_max',     value: 61.8, sample_date: '2026-05-20', recorded_at: '2026-05-20T17:00:00Z' },
 *     { sample_type: 'body_mass',   value: 80,  sample_date: '2026-05-25', recorded_at: '2026-05-25T07:00:00Z' }
 *   ]
 * }
 *
 * Dedup on (user_id, sample_type, sample_date, recorded_at). Idempotent —
 * iOS can replay the last 30 days nightly and we'll skip dupes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheDebounced } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

// Only these sample types move the readiness needle day-to-day, so only
// these justify a fresh LLM regen on arrival. Weight / VO2 / body fat
// change too slowly to matter for today's voice — they're stored but
// don't trigger a bust.
const READINESS_SIGNAL_TYPES = new Set([
  'sleep_hours', 'resting_hr', 'hrv', 'hr_recovery',
]);

const ALLOWED_TYPES = new Set([
  'sleep_hours', 'hrv', 'resting_hr', 'vo2_max', 'body_mass',
  'body_fat_pct', 'lean_mass', 'hr', 'max_hr', 'cadence',
  'spo2', 'respiratory_rate', 'wrist_temp', 'active_energy',
  'hr_recovery', 'run_power', 'stride_length',
  'ground_contact_time', 'vertical_oscillation', 'vertical_ratio',
  // 2026-06-01 · per-stage sleep minutes (iPhone build 134+ ships
  // these alongside sleep_hours per the iphone-health-ingest-
  // expansion-brief). Without these on the whitelist the per-stage
  // rows silently skipped at ingest · sleep architecture pillars
  // (deep/rem/light/awake) had zero rows in prod.
  'sleep_deep_minutes', 'sleep_rem_minutes',
  'sleep_light_minutes', 'sleep_awake_minutes',
  // 2026-06-05 · two more sleep buckets · David's QC:
  //   "Apple Health says 7:55, Faff says 6:47."
  // Math: light 280 + REM 119 + deep 10 = 6:49 = sleep_hours. The
  // 66min gap is HKCategoryValueSleepAnalysisAsleepUnspecified · the
  // bucket HK uses when sleep is detected but stages aren't (Sleep
  // Focus + watch off, naps, manual entries, 3rd-party app sleep).
  // Whitelisting now so the iPhone HK reader can ship its update
  // and the data lands without a route change. `sleep_in_bed_minutes`
  // is the optional "time in bed" bucket for runners who want the
  // tighter sleep-efficiency picture.
  'sleep_unspecified_minutes', 'sleep_in_bed_minutes',
  // 2026-06-01 · menstrual cycle ingest (iPhone build 134+, opt-in
  // + gender-gated). Same skip-bug shape: rows arrived but didn't
  // land because the whitelist didn't know them.
  'menstrual_cycle_day', 'menstrual_cycle_phase',
]);

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  const samples: any[] = body?.samples;
  if (!Array.isArray(samples)) {
    return NextResponse.json({ error: 'body.samples must be an array' }, { status: 400 });
  }
  // 2026-06-03 · auto-populate profile.timezone from the iPhone's TZ on
  // sync · silent · only writes when profile.timezone is currently null.
  try {
    const { captureTimezoneFromDevice } = await import('@/lib/runtime/runner-tz');
    if (typeof body?.timezone === 'string') {
      await captureTimezoneFromDevice(userId, body.timezone);
    }
  } catch {
    // Best-effort.
  }
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let insertedSignal = 0;  // count of newly-stored readiness-relevant samples

  for (const s of samples) {
    if (!s?.sample_type || !ALLOWED_TYPES.has(s.sample_type)) { skipped++; continue; }
    if (typeof s.value !== 'number' || !isFinite(s.value)) { skipped++; continue; }
    const sampleDate = s.sample_date ?? (s.recorded_at ?? new Date().toISOString()).slice(0, 10);
    const recordedAt = s.recorded_at ?? new Date().toISOString();

    try {
      // 2026-06-05 round 88 fix · UPSERT semantics for HK re-sync.
      //
      // Was: WHERE NOT EXISTS check followed by INSERT · the underlying
      // UNIQUE INDEX (user_id, sample_type, sample_date) caught any
      // re-sync attempt at the same key and threw 23505, which the
      // catch branch counted as `skipped` and SILENTLY DROPPED the
      // new value. That meant any iPhone-side correction to a nightly
      // aggregate (sleep_hours bucketing fix bb0671c1, stage minute
      // re-derivation, HRV re-aggregation, etc.) NEVER REACHED the DB
      // even after the runner re-synced on a new build · the old
      // (wrong) row stayed forever.
      //
      // David QC 2026-06-05: HK Time Asleep 7:55, Faff sleep_hours
      // 6.8h on this exact pattern · iPhone shipped the bucketing
      // fix on build 162 but the backend's silent-skip on re-sync
      // meant the wrong nightly value persisted.
      //
      // Now: ON CONFLICT DO UPDATE · last write wins for HK-source
      // rows · manual entries (source='manual') are protected via
      // the WHERE clause so a runner's manual override sticks even
      // through HK re-syncs. iPhone, watch, and HK ingest paths all
      // land here for nightly aggregates; manual route at
      // /api/health/manual sets source='manual' explicitly. The
      // partial-update WHERE is the policy gate that keeps both
      // layers honest.
      const r = await pool.query(
        `INSERT INTO health_samples (user_id, user_uuid, sample_type, value, sample_date, recorded_at)
         VALUES ($1, $1, $2, $3, $4::date, $5)
         ON CONFLICT (user_id, sample_type, sample_date) DO UPDATE
            SET value       = EXCLUDED.value,
                recorded_at = EXCLUDED.recorded_at,
                user_uuid   = COALESCE(health_samples.user_uuid, EXCLUDED.user_uuid)
            WHERE health_samples.source IS DISTINCT FROM 'manual'
         RETURNING id, (xmax = 0) AS was_insert`,
        [userId, s.sample_type, s.value, sampleDate, recordedAt]
      );
      const wasInsert = (r.rows[0] as { was_insert?: boolean } | undefined)?.was_insert === true;
      if ((r.rowCount ?? 0) > 0) {
        // RETURNING fires on both INSERT and UPDATE branches. wasInsert
        // separates them so the cron metrics distinguish new nights from
        // re-sync overwrites. Only new INSERTs count toward
        // insertedSignal (the cache-bust gate) · re-sync overwrites
        // are a different kind of event and shouldn't trigger an LLM
        // regen on every nightly aggregate refresh.
        if (wasInsert) {
          inserted++;
          if (READINESS_SIGNAL_TYPES.has(s.sample_type)) insertedSignal++;
        } else {
          // Re-sync updated an existing row · count separately so we
          // can see HK-correction volume in the response metrics.
          skipped++;
        }
      } else {
        // rowCount=0 means ON CONFLICT fired but the partial-update
        // WHERE rejected the update · existing row is source='manual'
        // and is protected. Manual override sticks. Skipped without
        // error.
        skipped++;
      }
    } catch (err: any) {
      // 2026-06-05 · 23505 should no longer fire with the UPSERT
      // shape above (the UNIQUE INDEX is the same one ON CONFLICT
      // targets). Keep the catch for safety · if some other unique
      // constraint we don't know about trips, log it as an error.
      console.error('[ingest/health] sample failed:', s, err?.message ?? String(err));
      errors++;
    }
  }

  // Only bust briefings when a readiness-relevant sample landed.
  // Trailing-edge 5-min debounce so an HK burst (sleep + HRV + RHR
  // arriving within seconds) collapses into at most 2 LLM regens
  // instead of one per sample. Weight / VO2 / body_fat arrivals do
  // NOT bust — they don't move today's voice.
  if (insertedSignal > 0) bustBriefingCacheDebounced(userId);
  return NextResponse.json({ ok: true, inserted, skipped, errors, signalSamples: insertedSignal });
}
