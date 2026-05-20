/**
 * POST /api/watch/workouts/complete
 *
 * Workout completion writeback · the companion endpoint every
 * GET /api/watch/today payload advertises as its `completionEndpoint`
 * (lib/watch-workout.ts).
 *
 * The watch executes the prescribed phases array; at the end the
 * iPhone bridge (which holds the auth token) POSTs the structured
 * result here — what the runner actually ran vs. what was prescribed.
 * This is the simpler companion path to /api/health/ingest, which
 * carries biometric time-series separately.
 *
 * Request shape (see lib/watch-completion.ts for full validation):
 *   {
 *     workoutId: "2026-05-20-threshold",
 *     startedAt:   "2026-05-20T06:02:11Z",
 *     completedAt: "2026-05-20T06:54:38Z",
 *     status: "completed" | "partial" | "abandoned",
 *     totalDistanceMi?: 7.3,
 *     totalDurationSec: 3147,
 *     avgHr?: 158,
 *     maxHr?: 181,
 *     phases: [
 *       { index: 0, type: "warmup", label: "Warmup",
 *         targetPaceSPerMi: null, actualPaceSPerMi: 478,
 *         actualDurationSec: 600, avgHr: 132, completed: true },
 *       ...
 *     ]
 *   }
 *
 * Response:
 *   { ok: true, completionId, workoutId, phaseCount }
 *
 * Auth: Bearer access token.  Cookie also accepted for curl testing.
 *
 * IDEMPOTENCY: re-POSTing the same workoutId overwrites the prior
 * record (the iPhone HealthKit observer can fire more than once).
 *
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storeCompletion, type WatchCompletionInput } from '@/lib/watch-completion';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });
  }

  let body: WatchCompletionInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await storeCompletion(user.id, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
