/**
 * GET /api/watch/readiness
 *
 * The watch's slice of the phone read (watch-app.html §G). A body-state
 * glance that answers "am I recovered?" without opening the full app, and
 * the data source for the face complication. Works on ANY day, rest, race,
 * or workout, unlike /api/watch/today which returns null on rest/race days.
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
 * card read from, single source of truth for the readiness voice.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { gatherCoachState } from '@/lib/coach-state';
import { computeReadinessScore, readinessLabelFor } from '@/lib/readiness-score';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Prefer the device-reported IANA timezone (users.timezone); fall back to
  // the free-text location guess only when the app hasn't reported one yet.
  const tz = user.timezone || userTimezone(user.location);
  const today = todayISO(tz);

  try {
    const state = await gatherCoachState({ userId: user.id, tz });
    // Parity with /api/overview + the web/iPhone readiness: pass the runner's
    // real max HR (so HR-based "hard effort" detection works) and the Z2
    // finding, passing null here reintroduced the inflated-score divergence.
    const maxHr = state.recovery?.maxHrBpm ?? null;
    const rhr = state.recovery?.rhrBpm ?? null;
    const vdot = state.aggregateVdotValue;
    const z2 = (maxHr && rhr && vdot)
      ? await computeZ2CoverageFinding(user.id, today, maxHr, rhr, vdot).catch(() => null)
      : null;
    const finding = await computeReadinessScore(user.id, today, maxHr, rhr, z2);

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
