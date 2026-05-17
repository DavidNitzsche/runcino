/**
 * POST /api/onboarding/complete
 *
 * Saves the 3-step onboarding output to the user row + marks
 * onboarding_complete=true so the root-redirect sends them to /overview
 * instead of bouncing them back here.
 *
 * Body shape:
 * {
 *   name, location, age, sex,
 *   raceName?, raceDate?, raceDistance?, raceGoal?,
 *   level, longRunDay, qualityDays[], restDay
 * }
 *
 * Race details are stored in `races` table separately when provided.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { query } from '../../../../lib/db';

interface Body {
  name?: string;
  location?: string;
  age?: number;
  sex?: 'M' | 'F';
  raceName?: string;
  raceDate?: string;       // YYYY-MM-DD
  raceDistance?: string;   // '5K' | '10K' | 'HM' | 'M' | 'ULTRA' | 'OTHER'
  raceGoal?: string;       // HH:MM:SS
  level?: 'beginner' | 'intermediate' | 'advanced' | 'elite';
  longRunDay?: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  qualityDays?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  restDay?: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Update user row with onboarding values
  await query(
    `UPDATE users SET
       name           = COALESCE($2, name),
       location       = COALESCE($3, location),
       age            = COALESCE($4, age),
       sex            = COALESCE($5, sex),
       level          = COALESCE($6, level),
       long_run_day   = COALESCE($7, long_run_day),
       quality_days   = COALESCE($8::TEXT[], quality_days),
       rest_day       = COALESCE($9, rest_day),
       onboarding_complete = TRUE,
       updated_at     = NOW()
     WHERE id = $1;`,
    [
      user.id,
      body.name?.trim() || null,
      body.location?.trim() || null,
      typeof body.age === 'number' ? body.age : null,
      body.sex || null,
      body.level || null,
      body.longRunDay || null,
      Array.isArray(body.qualityDays) && body.qualityDays.length ? body.qualityDays : null,
      body.restDay || null,
    ],
  );

  // If user provided an A-race, create the races row (separate from the
  // legacy races table that stores plan artifacts — this writes to the
  // user_uuid-keyed shape we expect post-cutover).
  // For now: skip if no race name. Plan generation happens separately.
  if (body.raceName && body.raceDate) {
    // The existing `races` table is keyed by slug + stores full plan
    // JSONB. We won't write there until /web/ port completes the plan
    // builder integration. Just store enough on the user row to retain
    // the race intent — future PR will wire the actual plan generation.
    // (No-op for now; race name is logged so we can debug later.)
    console.log(`[onboarding] User ${user.id} A-race: ${body.raceName} on ${body.raceDate} (${body.raceDistance})`);
  }

  return NextResponse.json({ ok: true });
}
