/**
 * lib/onboarding/strava-history.ts · Step 1b history pre-fill.
 *
 * Reads recent Strava run history for a runner who has Strava
 * connected during onboarding. Powers the auto-fill on the no-race
 * path · "FROM STRAVA · 24 mi/wk · 8 mi long" stat block.
 *
 * Returns null when:
 *   · Strava is NOT connected for this runner (caller's gate),
 *     OR the runs query degrades to empty
 *   · < 5 qualifying runs in the last 8 weeks (light-history threshold ·
 *     UX surfaces the chip groups instead so the runner can edit)
 *
 * Pairs with:
 *   · designs/briefs/onboarding-master.md § Path map · light-history
 *   · designs/briefs/onboarding-master-execution.md § TASK B2
 *   · components/onboarding/Step1bGoalDetails.tsx · stravaHistory prop
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import {
  isPrescribedNonNormal,
  loadPrescribedWindows,
  representativeDayCount,
  MIN_REPRESENTATIVE_DAYS,
  type PrescribedWindow,
} from '@/lib/training/normal-window';

export interface StravaOnboardingHistory {
  avgWeeklyMi: number;
  longestRecentMi: number;
  runCount: number;
  oldestRunDateISO: string;
}

/** Light-history threshold · below this we render chip groups instead. */
const LIGHT_HISTORY_MIN_RUNS = 5;

/** Lookback window for the pre-fill · 8 weeks. */
const LOOKBACK_DAYS = 56;

export async function loadStravaHistoryForOnboarding(
  userUuid: string,
): Promise<StravaOnboardingHistory | null> {
  const todayISO = await runnerToday(userUuid);
  const startISO = new Date(Date.parse(todayISO + 'T12:00:00Z') - LOOKBACK_DAYS * 86400000)
    .toISOString().slice(0, 10);

  // Count distinct run days · dedupe-aware via canonicalMileageByDay.
  let canonicalDays: Map<string, { mi: number }>;
  try {
    canonicalDays = await canonicalMileageByDay(userUuid, startISO, todayISO);
  } catch {
    return null;
  }

  // RULE 8 (2026-08-30) · `avgWeeklyMi` and `longestRecentMi` below prefill
  // the onboarding volume chips, which seed `weeklyAvg4w` and the plan's
  // peak-long floor — the two numbers Rule 8's table names as having opened a
  // marathon block at 31 mi/wk and anchored a long-run ramp to a taper long.
  // A runner onboarding for the first time has no `races` rows and gets an
  // empty window list, so this changes nothing for them; a runner who raced
  // under us and is re-onboarding is exactly the case it exists for.
  let nonNormal: PrescribedWindow[];
  try {
    nonNormal = await loadPrescribedWindows(userUuid, todayISO);
  } catch {
    // Same posture as the read above: without the filter we cannot answer the
    // habit question honestly, and prefilling a chip off a possibly-tapered
    // window is worse than leaving the runner to type his own number.
    return null;
  }

  const runDays = Array.from(canonicalDays.entries())
    .filter(([, v]) => v.mi >= 0.5)
    .filter(([iso]) => !isPrescribedNonNormal(iso, nonNormal));
  if (runDays.length < LIGHT_HISTORY_MIN_RUNS) return null;

  // Weekly avg · sum mi / representative weeks. The denominator is the days
  // that SURVIVED the filter, not the nominal 8 weeks: excluding a third of
  // the window and then dividing by the whole window reports the taper as a
  // volume collapse instead of reporting it as absent (RULE 8, clause 1).
  const totalMi = runDays.reduce((s, [, v]) => s + v.mi, 0);
  const representativeDays = representativeDayCount(startISO, todayISO, nonNormal);
  if (representativeDays < MIN_REPRESENTATIVE_DAYS) return null;
  const weeks = representativeDays / 7;
  const avgWeeklyMi = Math.round((totalMi / weeks) * 10) / 10;

  // Longest single-day mileage in window · drives the peakLongRunMi floor
  // for the plan generator.
  const longestRecentMi = +Math.max(...runDays.map(([, v]) => v.mi)).toFixed(1);

  // Oldest run date · informs "we have 3 weeks of Strava" copy when
  // the window is light.
  const oldestRunDateISO = runDays
    .map(([d]) => d)
    .sort()[0] ?? startISO;

  return {
    avgWeeklyMi,
    longestRecentMi,
    runCount: runDays.length,
    oldestRunDateISO,
  };
}
