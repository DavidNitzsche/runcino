/**
 * GET /api/watch/readiness
 *
 * The watch's slice of the phone read (watch-app.html §G). A body-state
 * glance that answers "am I recovered?" without opening the full app, and
 * the data source for the face complication. Works on ANY day — rest, race,
 * or workout — unlike /api/watch/today which returns null on rest/race days.
 *
 * Auth: Bearer access token (native). Cookie also accepted for desktop curl.
 *
 * Response:
 *   {
 *     score: number | null,         // 0–100; null when suppressed (injured / no data)
 *     state: 'green' | 'yellow' | 'red',
 *     label: string,                // "Primed" / "Hold easy" / "Back off"
 *     recommendation: string,       // plain-language coach line (may be "")
 *     hrvMs: number | null,         // 7-day avg HRV (ms) for the subline
 *     rhrBpm: number | null,        // resting HR (bpm) for the subline
 *     suppressReason?: 'injured' | 'no-data',
 *     nextRace: { name, slug, daysAway } | null   // countdown line
 *   }
 *
 * The same computeReadinessScore() the web /overview ring + iPhone Today
 * card read from — single source of truth for the readiness voice.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { gatherCoachState } from '@/lib/coach-state';
import { computeReadinessScore, readinessLabelFor } from '@/lib/readiness-score';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = userTimezone(user.location);
  const today = todayISO(tz);

  try {
    const state = await gatherCoachState({ userId: user.id });
    const finding = await computeReadinessScore(
      user.id, today, null, state.recovery?.rhrBpm ?? null,
    );

    const next = state.races?.nextA ?? state.races?.nextAny ?? null;

    return NextResponse.json({
      score: finding.score,
      state: finding.state,
      label: readinessLabelFor(finding.state),
      recommendation: finding.recommendation,
      hrvMs: state.recovery?.hrv7dAvgMs ?? null,
      rhrBpm: state.recovery?.rhrBpm ?? null,
      ...(finding.suppressReason ? { suppressReason: finding.suppressReason } : {}),
      nextRace: next ? { name: next.name, slug: next.slug, daysAway: next.daysAway } : null,
    });
  } catch (e) {
    // Non-fatal: a glance that can't compute returns a silent "no-data"
    // state so the watch renders the dashed empty glance, not an error.
    return NextResponse.json({
      score: null,
      state: 'green',
      label: readinessLabelFor('green'),
      recommendation: '',
      hrvMs: null,
      rhrBpm: null,
      suppressReason: 'no-data',
      nextRace: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
