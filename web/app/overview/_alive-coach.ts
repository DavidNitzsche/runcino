/**
 * /overview · alive-coach data loader.
 *
 * Wave G surfaces ("Coach is watching" strip, PathToRaceCard, NextPushCard)
 * need a small set of derived signals on top of what `data.ts` already
 * builds. To avoid touching the in-flight `data.ts`, this module lives
 * alongside and exports its own loader:
 *
 *   loadAliveCoachData({ state, today, fetchedAt, checkin? })
 *     → AliveCoachData
 *
 * The loader is pure — it takes inputs the caller already has (CoachState,
 * the cache fetchedAt epoch, the optional checkin aggregate) and produces:
 *
 *   - 4-6 "coach is watching" chips, each grounded in a real signal with
 *     freshness + variant (green / amber / muted)
 *   - the PathToRace decision payload (coach.pathToRace output) for
 *     the next A-race in `state.races.nextA`, or null when no A race
 *     is set / no goal time present
 *   - the NextPushes decision payload (coach.nextPushes output)
 *
 * The page wiring (separate follow-up) will:
 *   import { loadAliveCoachData } from './_alive-coach';
 * and pass the result into the three new components alongside the
 * existing `OverviewData`.
 *
 * No file in this module touches data.ts, page.tsx, TodayCard, or the
 * plan-adapted card — Wave F owns those.
 */

import { coach } from '@/coach/coach';
import type {
  PathToRaceResult,
  NextPushesReport,
} from '@/coach/coach';
import type { CoachDecision } from '@/coach/types';
import type { CoachState } from '@/lib/coach-state';
import type { CheckinAggregate } from '@/lib/checkin-aggregate';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** One chip on the "Coach is watching" strip. The strip implies the
 *  coach is alive by surfacing the most recent moment the engine read
 *  each signal. Variant drives colour:
 *    green  → fresh + healthy
 *    amber  → stale or worth watching (e.g. easy share below 80%)
 *    muted  → not wired yet (e.g. HealthKit)
 *    warn   → actively bad (e.g. no check-in for a week) */
export interface WatchingChip {
  /** Stable id so the page can key/list/animate the chip. */
  id: 'strava' | 'checkin' | 'streak' | 'readiness' | 'easy_share' | 'race_cal';
  /** All-caps title shown above the value. */
  label: string;
  /** The current value the coach is reading (e.g. "2m ago", "47 days"). */
  value: string;
  /** Optional secondary text under the value (e.g. "AFC HALF · 96d"). */
  hint?: string;
  /** Color/variant for the chip. */
  variant: 'green' | 'amber' | 'muted' | 'warn';
  /** True when this signal is the most recent thing the coach acted on
   *  — the strip lights this chip with a subtle accent. */
  isFresh?: boolean;
}

/** Output of `loadAliveCoachData()` — three surfaces in one call. */
export interface AliveCoachData {
  /** 4-6 chips for the "Coach is watching" strip. Ordered by importance:
   *  data freshness first (Strava, check-in), then state (streak,
   *  readiness, easy share), then upcoming race anchor. */
  watching: WatchingChip[];
  /** PATH TO RACE decision for the next A-race. null when:
   *   - no A race set
   *   - A race has no goal time
   *   The card renders an empty-state CTA in that case. */
  pathToRace: CoachDecision<PathToRaceResult> | null;
  /** NEXT PUSH decision. Always present — the report may have zero
   *  pushes, which the card renders as "Plan steady — keep executing". */
  nextPushes: CoachDecision<NextPushesReport>;
}

/** Inputs the loader needs. The caller (page or API route) already
 *  has all of these from existing data wiring. */
export interface LoadAliveCoachInput {
  state: CoachState;
  /** ISO date string anchoring "today". */
  today: string;
  /** Epoch millis when the Strava cache was last refreshed. null when
   *  Strava isn't connected — strip shows a NOT CONNECTED chip. */
  stravaFetchedAtMs: number | null;
  /** Already-aggregated check-in summary if available. null = the
   *  feature isn't wired yet for this user (strip surfaces an honest
   *  NOT WIRED chip). */
  checkin: CheckinAggregate | null;
}

// ─────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────

export async function loadAliveCoachData(input: LoadAliveCoachInput): Promise<AliveCoachData> {
  const { state, today, stravaFetchedAtMs, checkin } = input;

  // ── PATH TO RACE ──────────────────────────────────────────────────
  // Only fires when next A race has a parsed goal time. Otherwise the
  // card renders its CTA empty state.
  const nextA = state.races.nextA;
  const pathToRace: AliveCoachData['pathToRace'] = (nextA && nextA.goalFinishS)
    ? await coach.pathToRace({
        today,
        state,
        raceName: nextA.name,
        raceDateISO: nextA.date,
        raceDistanceMi: nextA.distanceMi,
        goalTimeS: nextA.goalFinishS,
      })
    : null;

  // ── NEXT PUSHES ──────────────────────────────────────────────────
  const nextPushes = await coach.nextPushes({ today, state });

  // ── WATCHING STRIP ───────────────────────────────────────────────
  const watching: WatchingChip[] = [];

  // 1. Strava sync freshness. Stale = >12 hours, very stale = >24 hours.
  if (stravaFetchedAtMs == null) {
    watching.push({
      id: 'strava',
      label: 'STRAVA',
      value: 'NOT CONNECTED',
      variant: 'warn',
    });
  } else {
    const nowMs = Date.now();
    const ageMin = Math.max(0, Math.round((nowMs - stravaFetchedAtMs) / 60_000));
    const veryStale = ageMin > 24 * 60;
    const stale = ageMin > 12 * 60;
    watching.push({
      id: 'strava',
      label: 'STRAVA',
      value: formatAge(ageMin),
      hint: 'last sync',
      variant: veryStale ? 'warn' : stale ? 'amber' : 'green',
      isFresh: !stale,
    });
  }

  // 2. Check-in freshness. Wave G G1 spec calls this out explicitly.
  if (checkin == null) {
    watching.push({
      id: 'checkin',
      label: 'CHECK-IN',
      value: 'NOT WIRED',
      variant: 'muted',
    });
  } else if (checkin.loggedToday) {
    watching.push({
      id: 'checkin',
      label: 'CHECK-IN',
      value: 'TODAY',
      hint: 'logged',
      variant: 'green',
      isFresh: true,
    });
  } else if (checkin.latestDateISO == null) {
    watching.push({
      id: 'checkin',
      label: 'CHECK-IN',
      value: 'NONE YET',
      hint: 'log one',
      variant: 'warn',
    });
  } else {
    const days = daysBetweenISO(checkin.latestDateISO, today);
    watching.push({
      id: 'checkin',
      label: 'CHECK-IN',
      value: `${days}d STALE`,
      hint: `last ${checkin.latestDateISO}`,
      variant: days >= 7 ? 'warn' : days >= 3 ? 'amber' : 'green',
    });
  }

  // 3. Streak (consecutiveRunDays). The user wants the strip to feel
  //    alive — streak is the most concrete "you've shown up" signal.
  const streak = state.recovery.consecutiveRunDays;
  watching.push({
    id: 'streak',
    label: 'STREAK',
    value: streak > 0 ? `${streak} DAY${streak === 1 ? '' : 'S'}` : '—',
    hint: streak === 0 ? 'no run logged' : streak >= 7 ? 'protect it' : undefined,
    variant: streak >= 7 ? 'green' : streak > 0 ? 'amber' : 'muted',
  });

  // 4. Readiness — from coach.assessReadiness output. We call the coach
  //    so the chip reads the same as the readiness card on the page.
  const readiness = await coach.assessReadiness({ today, state });
  const r = readiness.answer;
  watching.push({
    id: 'readiness',
    label: 'READINESS',
    value: r.level.toUpperCase(),
    hint: r.acwr != null ? `ACWR ${r.acwr.toFixed(2)}` : undefined,
    variant: r.level === 'green' ? 'green' : r.level === 'yellow' ? 'amber' : 'warn',
  });

  // 5. Easy share — polarized 80/20 baseline (Research/00a §TID).
  const easy = state.intensity.easyShare14d;
  if (state.intensity.easyMi14d + state.intensity.hardMi14d > 5) {
    const easyPct = Math.round(easy * 100);
    watching.push({
      id: 'easy_share',
      label: 'EASY SHARE',
      value: `${easyPct}%`,
      hint: '14-day',
      variant: easyPct >= 80 ? 'green' : easyPct >= 70 ? 'amber' : 'warn',
    });
  }

  // 6. Next A-race anchor — the chip the strip ends on to keep the
  //    runner's eye pointed at the goal.
  if (nextA) {
    watching.push({
      id: 'race_cal',
      label: 'RACE CAL',
      value: `${nextA.daysAway}d`,
      hint: nextA.name.toUpperCase(),
      variant: nextA.daysAway <= 14 ? 'amber' : 'green',
    });
  } else {
    watching.push({
      id: 'race_cal',
      label: 'RACE CAL',
      value: 'NO A-RACE',
      hint: 'add one',
      variant: 'muted',
    });
  }

  return { watching, pathToRace, nextPushes };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** Format a minute count as a coarse, glanceable freshness string.
 *  <60min → "Nm ago" · <24h → "Nh ago" · ≥24h → "Nd ago". */
function formatAge(ageMin: number): string {
  if (ageMin < 1) return 'JUST NOW';
  if (ageMin < 60) return `${ageMin}m AGO`;
  const ageHr = Math.round(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h AGO`;
  const ageD = Math.round(ageHr / 24);
  return `${ageD}d AGO`;
}

/** Days between two ISO dates, today − fromISO. Negative results
 *  clamp to 0 (future dates read as "today"). */
function daysBetweenISO(fromISO: string, toISO: string): number {
  const f = new Date(fromISO + 'T12:00:00Z').getTime();
  const t = new Date(toISO + 'T12:00:00Z').getTime();
  return Math.max(0, Math.round((t - f) / 86_400_000));
}
