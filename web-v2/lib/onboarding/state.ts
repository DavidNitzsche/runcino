/**
 * Onboarding state · URL-driven temp storage.
 *
 * Per spec (PROJECT.md · onboarding-lilian 2026-05-28):
 *   - Per-step ephemeral answers live in `searchParams` so refresh +
 *     back-button work cleanly without sessionStorage/cookies.
 *   - The "Start training" tap on step 3 POSTs to /api/onboarding/complete
 *     which writes to profile.* (see migration 115 + 118).
 *
 * The codec stays tiny. Most fields are simple chip values, written verbatim
 * into the URL. Anything richer (full Daniels VDOT seed, baseline pace
 * samples, etc.) is derived server-side after onboarding completes, not
 * collected here.
 *
 * Phase 16.5 extension (migration 118): when the runner picks "No specific
 * race" we route them to `step=goal-details` (Step 1b) for a richer
 * non-race intake — see Step1bGoalDetails for the chip ladders.
 */

export type RaceDistance = '5k' | '10k' | 'half' | 'marathon' | 'none';

/** Time-trial distance chip values (no-race path only). */
export type TTDistance = '1mi' | '5k' | '10k';

/** Weekly mileage chip values (no-race path only). */
export type WeeklyMileage = 15 | 25 | 35 | 45 | 55;

/** Frequency chip values (no-race path only). */
export type WeeklyFrequency = 3 | 4 | 5 | 6;

/** Avg-weekly-mi history chip values. Strings because the chip *is* a range. */
export type HistAvg = '0-5' | '5-15' | '15-25' | '25-35' | '35+';

/** Longest-recent-run history chip values. */
export type HistLong = '0-3' | '3-6' | '6-10' | '10+';

/** Years-running history chip values. */
export type HistYears = '<1' | '1-3' | '3-7' | '7+';

export interface OnboardingState {
  /** Which screen the runner is on. `landing` = no `step` param. */
  step: 'landing' | 'goal' | 'goal-details' | 'signals' | 'confirm' | 'done';
  /** Step 1 picks. */
  distance: RaceDistance | null;
  date: string | null;        // YYYY-MM-DD (HTML date input format)
  time: string | null;        // HH:MM:SS, runner-typed (race-anchored path only)

  /** Step 1b · no-race detail picks. */
  ttDistance: TTDistance | null;
  /** Bucketed time range string from the chip ladder, e.g. "22-25". */
  ttTime: string | null;
  weeklyMi: WeeklyMileage | null;
  weeklyFreq: WeeklyFrequency | null;
  histAvg: HistAvg | null;
  histLong: HistLong | null;
  histYears: HistYears | null;

  /** Step 2 signal-state hints. */
  stravaConnected: boolean;   // true after returning from OAuth with ?strava=connected
  /** Step 3 confirm fields. */
  name: string | null;
  timezone: string | null;    // IANA tz like 'America/Los_Angeles'
  /** Step 2 explicit-skip flag (persisted via /api/onboarding/complete). */
  connectionsSkipped: boolean;
}

const DEFAULT: OnboardingState = {
  step: 'landing',
  distance: null,
  date: null,
  time: null,
  ttDistance: null,
  ttTime: null,
  weeklyMi: null,
  weeklyFreq: null,
  histAvg: null,
  histLong: null,
  histYears: null,
  stravaConnected: false,
  name: null,
  timezone: null,
  connectionsSkipped: false,
};

const VALID_STEPS = new Set([
  'goal', 'goal-details', 'signals', 'confirm', 'done',
]);
const VALID_DISTANCES = new Set<RaceDistance>(['5k', '10k', 'half', 'marathon', 'none']);
const VALID_TT_DISTANCES = new Set<TTDistance>(['1mi', '5k', '10k']);
const VALID_WEEKLY_MI = new Set<WeeklyMileage>([15, 25, 35, 45, 55]);
const VALID_FREQ = new Set<WeeklyFrequency>([3, 4, 5, 6]);
const VALID_HIST_AVG = new Set<HistAvg>(['0-5', '5-15', '15-25', '25-35', '35+']);
const VALID_HIST_LONG = new Set<HistLong>(['0-3', '3-6', '6-10', '10+']);
const VALID_HIST_YEARS = new Set<HistYears>(['<1', '1-3', '3-7', '7+']);

/**
 * Parse Next.js `searchParams` (or `URLSearchParams`) into a state object.
 * Defensive — unknown values reset to defaults rather than throwing.
 */
export function parseOnboardingParams(
  params: Record<string, string | string[] | undefined> | URLSearchParams
): OnboardingState {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const v = params[key];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  const rawStep = get('step');
  const step = (rawStep && VALID_STEPS.has(rawStep)
    ? (rawStep as OnboardingState['step'])
    : 'landing');

  const rawDistance = get('distance');
  const distance = (rawDistance && VALID_DISTANCES.has(rawDistance as RaceDistance)
    ? (rawDistance as RaceDistance)
    : null);

  const date = isValidDate(get('date')) ? get('date') : null;
  const time = isValidTime(get('time')) ? get('time') : null;
  const name = get('name');
  const timezone = get('tz');
  const stravaConnected = get('strava') === 'connected';
  const connectionsSkipped = get('skipped') === '1';

  // ── Step 1b chip values ────────────────────────────────────────
  const rawTtDist = get('tt_distance');
  const ttDistance = rawTtDist && VALID_TT_DISTANCES.has(rawTtDist as TTDistance)
    ? (rawTtDist as TTDistance)
    : null;
  // tt_time is a free-form bucket string — but we only accept it when a
  // tt_distance is also set (otherwise it'd dangle). Stripe whitespace and
  // cap length so URL tampering can't blow up the UI.
  const rawTtTime = get('tt_time');
  const ttTime = ttDistance && rawTtTime && rawTtTime.length <= 32
    ? rawTtTime
    : null;

  const rawMi = get('weekly_mi');
  const weeklyMi = rawMi && VALID_WEEKLY_MI.has(Number(rawMi) as WeeklyMileage)
    ? (Number(rawMi) as WeeklyMileage)
    : null;
  const rawFreq = get('weekly_freq');
  const weeklyFreq = rawFreq && VALID_FREQ.has(Number(rawFreq) as WeeklyFrequency)
    ? (Number(rawFreq) as WeeklyFrequency)
    : null;

  const rawHistAvg = get('hist_avg');
  const histAvg = rawHistAvg && VALID_HIST_AVG.has(rawHistAvg as HistAvg)
    ? (rawHistAvg as HistAvg) : null;
  const rawHistLong = get('hist_long');
  const histLong = rawHistLong && VALID_HIST_LONG.has(rawHistLong as HistLong)
    ? (rawHistLong as HistLong) : null;
  const rawHistYears = get('hist_years');
  const histYears = rawHistYears && VALID_HIST_YEARS.has(rawHistYears as HistYears)
    ? (rawHistYears as HistYears) : null;

  return {
    ...DEFAULT,
    step,
    distance,
    date,
    time,
    ttDistance,
    ttTime,
    weeklyMi,
    weeklyFreq,
    histAvg,
    histLong,
    histYears,
    stravaConnected,
    name: name && name.length > 0 ? name : null,
    timezone,
    connectionsSkipped,
  };
}

/**
 * Build a `/onboarding?...` URL for advancing. Pass the next step and
 * any field overrides; everything else is preserved from `current`.
 * `landing` → no step param (clean URL).
 */
export function buildOnboardingHref(
  current: OnboardingState,
  next: Partial<OnboardingState> = {}
): string {
  const merged: OnboardingState = { ...current, ...next };
  const sp = new URLSearchParams();

  if (merged.step !== 'landing') sp.set('step', merged.step);
  if (merged.distance) sp.set('distance', merged.distance);
  if (merged.date) sp.set('date', merged.date);
  if (merged.time) sp.set('time', merged.time);
  // Step 1b chip values.
  if (merged.ttDistance) sp.set('tt_distance', merged.ttDistance);
  if (merged.ttTime) sp.set('tt_time', merged.ttTime);
  if (merged.weeklyMi != null) sp.set('weekly_mi', String(merged.weeklyMi));
  if (merged.weeklyFreq != null) sp.set('weekly_freq', String(merged.weeklyFreq));
  if (merged.histAvg) sp.set('hist_avg', merged.histAvg);
  if (merged.histLong) sp.set('hist_long', merged.histLong);
  if (merged.histYears) sp.set('hist_years', merged.histYears);
  if (merged.stravaConnected) sp.set('strava', 'connected');
  if (merged.name) sp.set('name', merged.name);
  if (merged.timezone) sp.set('tz', merged.timezone);
  if (merged.connectionsSkipped) sp.set('skipped', '1');

  const q = sp.toString();
  return q ? `/onboarding?${q}` : '/onboarding';
}

/** Step 1 valid → can advance.
 *  Race path needs a date; no-race path always advances (to step 1b). */
export function canAdvanceFromGoal(s: OnboardingState): boolean {
  if (!s.distance) return false;
  if (s.distance === 'none') return true;
  return Boolean(s.date);  // race anchor needs a date
}

/** Step 1b valid → can advance to signals.
 *  Sections B (weekly target) + C (history) are required, A (time-trial)
 *  is optional. History section is satisfied when Strava is connected
 *  (numbers come from Strava live) OR all three chip groups are picked. */
export function canAdvanceFromGoalDetails(s: OnboardingState): boolean {
  if (s.distance !== 'none') return false;  // wrong path
  if (s.weeklyMi == null || s.weeklyFreq == null) return false;
  const historySatisfied = s.stravaConnected
    || (s.histAvg && s.histLong && s.histYears);
  return Boolean(historySatisfied);
}

/** Step 2 always allows continue (skip is an explicit secondary). */
export function canAdvanceFromSignals(_s: OnboardingState): boolean {
  return true;
}

/** Step 3 valid → can submit. */
export function canSubmit(s: OnboardingState): boolean {
  return Boolean(s.name && s.name.trim().length > 0 && s.timezone);
}

function isValidDate(v: string | null): boolean {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isValidTime(v: string | null): boolean {
  if (!v) return false;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
}

/**
 * Friendly label for a chosen distance · used on confirm screen + completion.
 * 'half' → 'Half marathon', etc.
 */
export function distanceLabel(d: RaceDistance | null): string {
  switch (d) {
    case '5k':       return '5K';
    case '10k':      return '10K';
    case 'half':     return 'Half marathon';
    case 'marathon': return 'Marathon';
    case 'none':     return 'No specific race';
    default:         return '—';
  }
}

/** TT distance chip label (caps). */
export function ttDistanceLabel(d: TTDistance | null): string {
  switch (d) {
    case '1mi': return '1 MI';
    case '5k':  return '5K';
    case '10k': return '10K';
    default:    return '—';
  }
}

/**
 * Convert IANA tz to a short display label like "LOS ANGELES · PT".
 * Pure cosmetic. Falls back to the raw tz on anything we don't know.
 */
export function timezoneShortLabel(tz: string | null): string {
  if (!tz) return '—';
  const city = tz.split('/').slice(-1)[0]?.replace(/_/g, ' ').toUpperCase() ?? tz;
  // Hand-mapped abbreviations for the common North American + EU zones.
  // Anything else just shows the city.
  const ABBR: Record<string, string> = {
    'America/Los_Angeles': 'PT',
    'America/Denver':      'MT',
    'America/Chicago':     'CT',
    'America/New_York':    'ET',
    'America/Phoenix':     'MST',
    'Europe/London':       'GMT',
    'Europe/Paris':        'CET',
    'Europe/Berlin':       'CET',
    'Europe/Madrid':       'CET',
    'Asia/Tokyo':          'JST',
    'Australia/Sydney':    'AET',
  };
  const abbr = ABBR[tz];
  return abbr ? `${city} · ${abbr}` : city;
}

/** Time-bucket chip ladders by TT distance — single source of truth for
 *  both the picker UI and the URL parser's allowlist (kept lenient so the
 *  bucket strings can evolve without bumping the parser). */
export const TT_TIME_LADDERS: Record<TTDistance, string[]> = {
  '1mi': ['Under 5:00', '5:00-6:00', '6:00-7:00', '7:00-8:00', '8:00+'],
  '5k':  ['Under 20:00', '20-22', '22-25', '25-28', '28-32', '32+'],
  '10k': ['Under 40', '40-45', '45-50', '50-60', '60+'],
};

/** Midpoint mileage values for the history-avg chip — used when piping
 *  the runner-reported number into the plan-builder as a baseline. */
export const HIST_AVG_MIDPOINTS: Record<HistAvg, number> = {
  '0-5': 3,
  '5-15': 10,
  '15-25': 20,
  '25-35': 30,
  '35+': 40,
};

/** Midpoint mileage values for the longest-recent-run chip. */
export const HIST_LONG_MIDPOINTS: Record<HistLong, number> = {
  '0-3': 2,
  '3-6': 5,
  '6-10': 8,
  '10+': 12,
};
