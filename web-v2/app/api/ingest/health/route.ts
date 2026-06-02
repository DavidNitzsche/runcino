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
      // Dedup on (user_id, sample_type, sample_date, recorded_at) — won't
      // double-count if iOS replays. Tries ON CONFLICT first; if no unique
      // index exists, falls back to a check-then-insert.
      const r = await pool.query(
        `INSERT INTO health_samples (user_id, user_uuid, sample_type, value, sample_date, recorded_at)
         SELECT $1, $1, $2, $3, $4::date, $5
          WHERE NOT EXISTS (
            SELECT 1 FROM health_samples
             WHERE COALESCE(user_uuid, user_id) = $1
               AND sample_type = $2
               AND sample_date = $4::date
               AND recorded_at = $5
          )
         RETURNING id`,
        [userId, s.sample_type, s.value, sampleDate, recordedAt]
      );
      if ((r.rowCount ?? 0) > 0) {
        inserted++;
        if (READINESS_SIGNAL_TYPES.has(s.sample_type)) insertedSignal++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      // Postgres unique-constraint violation = the row exists from a
      // prior sync. That's idempotent dedup, not an error.
      if (err?.code === '23505' || /duplicate key/i.test(err?.message ?? '')) {
        skipped++;
      } else {
        console.error('[ingest/health] sample failed:', s, err.message);
        errors++;
      }
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
