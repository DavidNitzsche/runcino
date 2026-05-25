/**
 * POST /api/health/ingest
 *
 * Batch ingest endpoint for HealthKit samples from the iPhone bridge.
 * Closes the data loop · reads from HealthKit on the iPhone, writes
 * into Faff.run's database so coaching surfaces (readiness, V5,
 * Signal 2) can consume the data.
 *
 * Phase 1 item 3 of the iPhone-bridge work.
 *
 * Request shape:
 *   {
 *     samples: [
 *       { type: 'resting_hr',     value: 48,  dateISO: '2026-05-19', source?: 'apple_health' },
 *       { type: 'sleep_hours',    value: 7.2, dateISO: '2026-05-18' },
 *       { type: 'vo2_max',        value: 52,  dateISO: '2026-05-15' },
 *       { type: 'workout_hr_avg', value: 165, dateISO: '2026-05-19', metadata: { workoutId: '...' } },
 *       { type: 'max_hr',         value: 183, dateISO: '2026-05-19' },
 *     ]
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     ingested: 5,
 *     skipped: 0,
 *     errors: [],
 *     byType: { resting_hr: 1, sleep_hours: 1, vo2_max: 1, workout_hr_avg: 1, max_hr: 1 }
 *   }
 *
 * Auth: Bearer access token.  Cookie also accepted for testing via
 * curl-from-desktop.
 *
 * IDEMPOTENCY: re-sending the same (type, dateISO) overwrites the
 * prior value.  Apple Health can re-emit samples on reconnect; the
 * UPSERT in ingestSamples handles it cleanly.
 *
 * VALIDATION: invalid samples are reported per-index in errors[] but
 * don't abort the batch.  Caller gets partial success when some
 * samples in the batch are bad.
 *
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ingestSamples, type HealthSampleInput } from '@/lib/health-samples';
import { query } from '@/lib/db';

interface IngestBody {
  samples?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });
  }

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.samples || !Array.isArray(body.samples)) {
    return NextResponse.json(
      { error: 'samples must be an array' },
      { status: 400 },
    );
  }

  const result = await ingestSamples(user.id, body.samples as HealthSampleInput[]);

  // Mark Apple Health as a connected source so every surface (the
  // /profile connectors card, /api/overview connectors, the iPhone More
  // tab) reflects that the phone is syncing. apple_health is device-
  // driven, not OAuth, the access_token is a placeholder. Non-fatal.
  if (result.ingested > 0) {
    try {
      await query(
        `INSERT INTO connector_tokens
           (user_id, provider, access_token, last_sync_at, last_sync_status, activities_count, connected_at, updated_at, disconnected_at)
         VALUES ($1, 'apple_health', 'healthkit-device', NOW(), 'success', $2, NOW(), NOW(), NULL)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           last_sync_at = NOW(),
           last_sync_status = 'success',
           activities_count = EXCLUDED.activities_count,
           disconnected_at = NULL,
           updated_at = NOW()`,
        [user.id, result.ingested],
      );
    } catch { /* connector marker is best-effort */ }
  }

  return NextResponse.json({ ok: true, ...result });
}
