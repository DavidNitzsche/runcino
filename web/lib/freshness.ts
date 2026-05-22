/**
 * gatherFreshness, single source of truth for how stale every Coach
 * signal is.
 *
 * The "Coach is watching" UI strip surfaces a per-signal chip with the
 * label "STRAVA · synced 2m ago" / "CHECK-IN · 18h ago" / etc. Without
 * this aggregator each route was inventing its own staleness logic. Now
 * every route calls gatherFreshness() and returns the same FreshnessMap
 * sibling to its data.
 *
 * Freshness budgets (per Research doctrine):
 *   - Strava           · 2 hours    (cache TTL is 15m, anything past
 *                                    2h means the sync pipeline broke)
 *   - Check-in         · 36 hours   (daily cadence with overnight
 *                                    grace, see Research/15 §subjective
 *                                    capture cadence)
 *   - VDOT anchor      · 60 days    (Research/01-pace-zones-vdot.md
 *                                    §Freshness window, fitness signal
 *                                    expires past 60 days)
 *   - Profile          · 6 months   (180 days, runner's body changes)
 *   - Race calendar    · 14 days    (signal is "engagement", A-race
 *                                    edited in last 14d = active runner)
 *   - HealthKit        · n/a       (always unavailable until M2)
 *
 * Dependency injection: every DB read is exposed as an optional override
 * so the tests can substitute fakes without spinning up Postgres. In
 * production every override is omitted and the real readers run.
 */

import { query } from './db';
import { getCacheFetchedAt } from './strava-cache';
import { vdotSnapshot } from './vdot';
import type { CoachState } from './coach-state';
import type {
  FreshnessMap,
  SignalFreshness,
  FreshnessStaleness,
} from './freshness-types';

// ─────────────────────────────────────────────────────────────────────
// Freshness budgets, in milliseconds.
// ─────────────────────────────────────────────────────────────────────

const MS = 1;
const SEC = 1000 * MS;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FRESHNESS_BUDGETS = {
  strava: 2 * HOUR,
  checkin: 36 * HOUR,
  vdotAnchor: 60 * DAY,
  profile: 180 * DAY,
  raceCal: 14 * DAY,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Dependency injection, all the readers gatherFreshness needs. Defaults
// to the real DB-backed readers; tests override these.
// ─────────────────────────────────────────────────────────────────────

export interface FreshnessDeps {
  /** Coach state, we only read `state.now` and (optionally)
   *  vdotSnapshot(state). When omitted, the caller is responsible for
   *  passing one; this never gathers state itself to avoid a circular
   *  dependency with /api/overview. */
  state: CoachState;
  /** "Now" override for testing, defaults to Date.now(). */
  nowMs?: number;

  // Source readers, each returns the last refresh time as a Date or null.
  /** Most recent Strava sync timestamp. */
  readStravaSyncAt?: () => Promise<Date | null>;
  /** Most recent daily_checkin.logged_at. */
  readCheckinAt?: () => Promise<Date | null>;
  /** profile.updated_at. */
  readProfileUpdatedAt?: () => Promise<Date | null>;
  /** Most recent race row's saved_at (proxy for "engagement"). */
  readRaceCalUpdatedAt?: () => Promise<Date | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Default DB readers, used in production paths.
// ─────────────────────────────────────────────────────────────────────

async function defaultStravaSyncAt(): Promise<Date | null> {
  try {
    const ms = await getCacheFetchedAt();
    if (ms != null) return new Date(ms);
    // Fallback: most recent strava_activities.fetched_at (when the
    // sync-state row hasn't been written yet).
    const rows = await query<{ fetched_at: Date }>(
      `SELECT fetched_at FROM strava_activities ORDER BY fetched_at DESC LIMIT 1`,
    );
    return rows[0]?.fetched_at ?? null;
  } catch {
    return null;
  }
}

async function defaultCheckinAt(): Promise<Date | null> {
  try {
    const rows = await query<{ logged_at: Date }>(
      `SELECT logged_at FROM daily_checkin WHERE user_id = 'me' ORDER BY logged_at DESC LIMIT 1`,
    );
    return rows[0]?.logged_at ?? null;
  } catch {
    return null;
  }
}

async function defaultProfileUpdatedAt(): Promise<Date | null> {
  try {
    const rows = await query<{ updated_at: Date }>(
      `SELECT updated_at FROM profile WHERE user_id = 'me' LIMIT 1`,
    );
    return rows[0]?.updated_at ?? null;
  } catch {
    return null;
  }
}

async function defaultRaceCalUpdatedAt(): Promise<Date | null> {
  try {
    const rows = await query<{ saved_at: Date }>(
      `SELECT saved_at FROM races ORDER BY saved_at DESC LIMIT 1`,
    );
    return rows[0]?.saved_at ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// gatherFreshness, the public API.
// ─────────────────────────────────────────────────────────────────────

export async function gatherFreshness(deps: FreshnessDeps): Promise<FreshnessMap> {
  const nowMs = deps.nowMs ?? Date.now();
  const readStravaSyncAt = deps.readStravaSyncAt ?? defaultStravaSyncAt;
  const readCheckinAt = deps.readCheckinAt ?? defaultCheckinAt;
  const readProfileUpdatedAt = deps.readProfileUpdatedAt ?? defaultProfileUpdatedAt;
  const readRaceCalUpdatedAt = deps.readRaceCalUpdatedAt ?? defaultRaceCalUpdatedAt;

  const [stravaAt, checkinAt, profileAt, raceCalAt] = await Promise.all([
    readStravaSyncAt(),
    readCheckinAt(),
    readProfileUpdatedAt(),
    readRaceCalUpdatedAt(),
  ]);

  return {
    strava: buildStrava(stravaAt, nowMs),
    checkin: buildCheckin(checkinAt, nowMs),
    vdotAnchor: buildVdotAnchor(deps.state, nowMs),
    profile: buildProfile(profileAt, nowMs),
    raceCal: buildRaceCal(raceCalAt, nowMs),
    healthkit: buildHealthkit(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-signal builders. Each returns a SignalFreshness, pure functions
// of (lastRefreshAt, nowMs).
// ─────────────────────────────────────────────────────────────────────

function buildStrava(at: Date | null, nowMs: number): SignalFreshness {
  if (!at) {
    return {
      source: 'strava',
      label: 'STRAVA · never synced',
      isAvailable: false,
      isStale: true,
      staleness: 'stale-bad',
      lastRefreshISO: null,
      daysSince: null,
      reason: 'No Strava activities synced yet, connect to refresh.',
    };
  }
  const ageMs = nowMs - at.getTime();
  const isStale = ageMs > FRESHNESS_BUDGETS.strava;
  const staleness: FreshnessStaleness = isStale
    ? ageMs > 24 * HOUR
      ? 'stale-bad'
      : 'stale-ok'
    : 'fresh';
  const ageLabel = formatAgeShort(ageMs);
  const label = isStale
    ? `STRAVA · last synced ${ageLabel}, connect to refresh`
    : `STRAVA · synced ${ageLabel}`;
  return {
    source: 'strava',
    label,
    isAvailable: true,
    isStale,
    staleness,
    lastRefreshISO: at.toISOString(),
    daysSince: Math.floor(ageMs / DAY),
    reason: isStale
      ? `Strava cache is ${ageLabel} old (budget: 2 hours).`
      : `Strava cache fresh, last sync ${ageLabel} ago.`,
  };
}

function buildCheckin(at: Date | null, nowMs: number): SignalFreshness {
  if (!at) {
    return {
      source: 'checkin',
      label: 'CHECK-IN · awaiting today',
      isAvailable: false,
      isStale: true,
      staleness: 'stale-bad',
      lastRefreshISO: null,
      daysSince: null,
      reason: 'No check-in logged yet, log energy/soreness/stress to feed the readiness signal.',
    };
  }
  const ageMs = nowMs - at.getTime();
  const isStale = ageMs > FRESHNESS_BUDGETS.checkin;
  // Past 72h, the Coach treats the subjective signal as effectively
  // missing (Saw 2016 cadence). Mark stale-bad past that line.
  const staleness: FreshnessStaleness = isStale
    ? ageMs > 72 * HOUR
      ? 'stale-bad'
      : 'stale-ok'
    : 'fresh';
  const ageLabel = formatAgeShort(ageMs);
  const label = `CHECK-IN · ${ageLabel} ago`;
  return {
    source: 'checkin',
    label,
    isAvailable: true,
    isStale,
    staleness,
    lastRefreshISO: at.toISOString(),
    daysSince: Math.floor(ageMs / DAY),
    reason: isStale
      ? `Last check-in was ${ageLabel} ago (budget: 36 hours).`
      : `Check-in fresh, logged ${ageLabel} ago.`,
  };
}

function buildVdotAnchor(state: CoachState, nowMs: number): SignalFreshness {
  const snap = vdotSnapshot(state);
  if (!snap) {
    return {
      source: 'vdot-anchor',
      label: 'VDOT · awaiting race result',
      isAvailable: false,
      isStale: true,
      staleness: 'stale-bad',
      lastRefreshISO: null,
      daysSince: null,
      reason: 'No race result available to anchor a VDOT, log a 5K–half result to unlock pace zones.',
    };
  }
  const raceDate = snap.source.date; // YYYY-MM-DD
  const raceMs = Date.parse(raceDate + 'T12:00:00Z');
  const ageMs = isFinite(raceMs) ? nowMs - raceMs : 0;
  const isStale = ageMs > FRESHNESS_BUDGETS.vdotAnchor;
  const staleness: FreshnessStaleness = isStale ? 'stale-bad' : 'fresh';
  const daysSince = Math.max(0, Math.floor(ageMs / DAY));
  const ageLabel = formatDaysAgo(daysSince);
  const distLabel = distanceLabel(snap.source.distanceMi);
  const label = isStale
    ? `VDOT · ${distLabel} ${ageLabel}, stale per doctrine`
    : `VDOT · ${distLabel} ${ageLabel}`;
  return {
    source: 'vdot-anchor',
    label,
    isAvailable: true,
    isStale,
    staleness,
    lastRefreshISO: new Date(raceMs).toISOString(),
    daysSince,
    reason: isStale
      ? `Your fitness estimate is ${daysSince} days old. It goes stale after about 60 days, log a recent race or hard effort to refresh it.`
      : `VDOT anchored on ${snap.source.name} (${ageLabel}).`,
  };
}

function buildProfile(at: Date | null, nowMs: number): SignalFreshness {
  if (!at) {
    return {
      source: 'profile',
      label: 'PROFILE · not set',
      isAvailable: false,
      isStale: true,
      staleness: 'stale-bad',
      lastRefreshISO: null,
      daysSince: null,
      reason: 'No profile yet, set age/sex/etc. in /profile to unlock body-aware advice.',
    };
  }
  const ageMs = nowMs - at.getTime();
  const isStale = ageMs > FRESHNESS_BUDGETS.profile;
  const staleness: FreshnessStaleness = isStale ? 'stale-ok' : 'fresh';
  const daysSince = Math.floor(ageMs / DAY);
  const ageLabel = formatDaysAgo(daysSince);
  const label = isStale
    ? `PROFILE · updated ${ageLabel}, please refresh`
    : `PROFILE · updated ${ageLabel}`;
  return {
    source: 'profile',
    label,
    isAvailable: true,
    isStale,
    staleness,
    lastRefreshISO: at.toISOString(),
    daysSince,
    reason: isStale
      ? `Profile last updated ${ageLabel}. Body changes over months, refresh when convenient.`
      : `Profile fresh, last edited ${ageLabel}.`,
  };
}

function buildRaceCal(at: Date | null, nowMs: number): SignalFreshness {
  if (!at) {
    return {
      source: 'race-cal',
      label: 'RACE CAL · no races yet',
      isAvailable: false,
      isStale: true,
      staleness: 'stale-ok',
      lastRefreshISO: null,
      daysSince: null,
      reason: 'No races on the calendar, add one to anchor your build.',
    };
  }
  const ageMs = nowMs - at.getTime();
  const isStale = ageMs > FRESHNESS_BUDGETS.raceCal;
  // A 6-month-out race not edited in a while isn't BAD, just not active.
  const staleness: FreshnessStaleness = isStale ? 'stale-ok' : 'fresh';
  const daysSince = Math.floor(ageMs / DAY);
  const ageLabel = formatDaysAgo(daysSince);
  const label = isStale
    ? `RACE CAL · last touched ${ageLabel}`
    : `RACE CAL · updated ${ageLabel}`;
  return {
    source: 'race-cal',
    label,
    isAvailable: true,
    isStale,
    staleness,
    lastRefreshISO: at.toISOString(),
    daysSince,
    reason: isStale
      ? `Last race edit was ${ageLabel}. Not stale-bad, calendar is just dormant.`
      : `Race calendar active, last edit ${ageLabel}.`,
  };
}

function buildHealthkit(): SignalFreshness {
  // HealthKit doesn't exist until M2. Always unavailable.
  return {
    source: 'healthkit',
    label: 'HRV · awaiting HealthKit',
    isAvailable: false,
    isStale: false,
    staleness: 'unavailable',
    lastRefreshISO: null,
    daysSince: null,
    reason: 'Awaiting HealthKit integration (M2). HRV, RHR, sleep, body temp all flow once it ships.',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Formatters, keep labels under one short phrase.
// ─────────────────────────────────────────────────────────────────────

function formatAgeShort(ms: number): string {
  if (ms < MIN) return `${Math.max(0, Math.round(ms / SEC))}s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

function formatDaysAgo(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months === 1) return '1 mo ago';
  if (months < 12) return `${months} mo ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 yr ago' : `${years} yr ago`;
}

function distanceLabel(distMi: number): string {
  if (Math.abs(distMi - 3.107) / 3.107 < 0.05) return '5K';
  if (Math.abs(distMi - 6.214) / 6.214 < 0.05) return '10K';
  if (Math.abs(distMi - 9.321) / 9.321 < 0.05) return '15K';
  if (Math.abs(distMi - 13.109) / 13.109 < 0.05) return 'HALF';
  if (Math.abs(distMi - 26.219) / 26.219 < 0.05) return 'MARATHON';
  return `${distMi.toFixed(1)} MI`;
}
