/**
 * lib/race/onboarding-recent-race.ts · F074 fix #1.
 *
 * The PURE half of `POST /api/onboarding/complete`'s "recent race" write —
 * extracted for the same reason `lib/onboarding/complete-inputs.ts` was
 * pulled out of that route (2026-08-24): so the computation can be walked
 * with no database, no session and no HTTP, and every branch is falsifiable
 * (Rule 18). The route calls `buildRecentRaceWrite` and then executes the
 * one SQL statement this file hands it — the SQL itself (the Rule 6
 * field-level merge, and the guard against downgrading a since-confirmed
 * result) lives in the route because it is the one impure line.
 *
 * DOCTRINE. The 2026-09-14-017 coach-consult ruling: a recent race is
 * doctrine's own rung-1 evidence (`docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md`'s
 * fallback ladder puts "recent race" first, ahead of self-reported ability)
 * and belongs in `races.actual_result` through the EXISTING race-evidence
 * pathway `/api/race/result` uses — not a bespoke onboarding-only field or a
 * parallel write path. See CLAUDE.md's "Race-data source-of-truth" section.
 *
 * WHY A RESERVED SLUG, NOT A FULL RACE-CREATION FLOW. This is not the
 * runner's goal race (that gets its own row, created elsewhere in the same
 * route) and it does not run `lib/race/result-chain.ts`'s
 * `runPostResultChain` (no plan exists yet to re-project, no coach_intent to
 * stamp, no "next race" to build toward) — its only job is to make the race
 * a candidate `lib/training/vdot-inputs.ts#loadVdotInputs` can see, which
 * reads directly off `races.actual_result` and needs nothing else.
 */
import {
  distanceMiOfBucket,
  whenRacedDaysAgo,
  type RaceHistoryEntry,
} from '@/lib/training/race-history';
import { fmtFinish } from '@/lib/race/result-chain';

/** `raceDistanceLabel`'s own labels, restated here so this file has no
 *  dependency on the route module (which would be the wrong direction —
 *  routes import pure logic, not the reverse). Kept byte-identical to the
 *  route's copy; `_onboarding_recent_race.test.ts` pins the four values. */
function distanceLabelFor(distance: string | undefined): string {
  switch (distance) {
    case '5k':       return '5K';
    case '10k':      return '10K';
    case 'half':     return 'Half Marathon';
    case 'marathon': return 'Marathon';
    default:         return (distance ?? '').toUpperCase();
  }
}

export interface RecentRaceWrite {
  slug: string;
  meta: {
    name: string;
    date: string;
    distanceLabel: string;
    distanceMi: number;
    priority: 'B';
    source: 'onboarding_self_report';
  };
  actualResult: {
    finishS: number;
    finishDisplay: string;
    source: 'onboarding_self_report';
    provisional: true;
    confirmedAt: string;
  };
}

export type RecentRaceWriteResult =
  | { ok: true; write: RecentRaceWrite }
  | { ok: false; error: 'unresolvable_recent_race_entry' };

/**
 * Everything `writeOnboardingRecentRace` needs to write, computed PURELY.
 *
 * `now` is injectable so `confirmedAt` and the date-anchor arithmetic are
 * falsifiable against a fixed clock (Rule 18) — defaults to the wall clock,
 * same posture as `deriveOnboardingComplete`'s `now` parameter.
 *
 * `date` is approximate by construction: the onboarding screen collects a
 * RECENCY BUCKET (`whenRaced`), not an exact date, so this anchors on the
 * bucket's own midpoint (`whenRacedDaysAgo` — the SAME map
 * `self-reported-pr.ts` uses for typed PRs, Rule 16) rather than inventing a
 * precision the runner never gave.
 */
export function buildRecentRaceWrite(
  userId: string,
  entry: RaceHistoryEntry,
  now: Date = new Date(),
): RecentRaceWriteResult {
  const distanceMi = distanceMiOfBucket(entry.distance, entry.otherDistanceMi);
  const daysAgo = whenRacedDaysAgo(entry.whenRaced);
  const timeSec = Number(entry.timeSec);
  if (distanceMi == null || daysAgo == null || !Number.isFinite(timeSec) || timeSec <= 0) {
    return { ok: false, error: 'unresolvable_recent_race_entry' };
  }
  const dateBase = new Date(now.getTime());
  dateBase.setUTCDate(dateBase.getUTCDate() - daysAgo);
  const dateISO = dateBase.toISOString().slice(0, 10);
  const distanceLabel = entry.distance === 'other'
    ? `${entry.otherDistanceMi} mi`
    : distanceLabelFor(entry.distance);
  // Reserved, deterministic slug (per user) — distinct from any race the
  // runner adds through the normal /api/race flow, so a genuine future race
  // can never collide with it, and re-onboarding stays idempotent (same
  // shape as the goal-race upsert elsewhere in the route).
  const slug = `onboarding-recent-race-${userId.slice(0, 8)}`;
  return {
    ok: true,
    write: {
      slug,
      meta: {
        name: `Recent ${distanceLabel} (self-reported)`,
        date: dateISO,
        distanceLabel,
        distanceMi,
        // Doctrine's middle tier (Research/00b "Recovery by Effort (A vs. B
        // vs. C Race)"): a real race the runner explicitly identified as a
        // race they ran, but with no taper/effort context to verify. Not
        // 'A' (would overstate authority for a race this app knows nothing
        // about beyond distance+time) and not 'C' ("barely counts", wrong
        // for something the runner distinguished from a training run) — 'B'
        // is `REPRESENTATIVE_FLOOR` (effort-authority.ts), the documented
        // middle ground. A genuine judgment call, made and stated rather
        // than defaulted silently.
        priority: 'B',
        source: 'onboarding_self_report',
      },
      actualResult: {
        finishS: Math.round(timeSec),
        finishDisplay: fmtFinish(timeSec),
        source: 'onboarding_self_report',
        // Unconfirmed in the same sense a watch-logged time is — nobody
        // corroborated it. `isProvisionalResult` (races-state.ts) already
        // treats this flag as "caption it, don't hide it" everywhere; per
        // its own doc comment it is additive to SELECTION only
        // (vdot-inputs.ts), never a discount on the evidence's weight in
        // the resolver's own race-candidate ranking.
        provisional: true,
        confirmedAt: now.toISOString(),
      },
    },
  };
}
