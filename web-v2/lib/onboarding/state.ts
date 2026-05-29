/**
 * Onboarding state · URL-driven temp storage.
 *
 * Per spec (PROJECT.md · onboarding-lilian 2026-05-28):
 *   - Per-step ephemeral answers live in `searchParams` so refresh +
 *     back-button work cleanly without sessionStorage/cookies.
 *   - The "Start training" tap on step 3 POSTs to /api/onboarding/complete
 *     which writes to profile.* (see migration 115).
 *
 * The codec is intentionally tiny — five fields. Anything richer (full
 * Daniels VDOT seed, baseline pace samples, etc.) is derived server-side
 * after onboarding completes, not collected here.
 */

export type RaceDistance = '5k' | '10k' | 'half' | 'marathon' | 'none';

export interface OnboardingState {
  /** Which screen the runner is on. `landing` = no `step` param. */
  step: 'landing' | 'goal' | 'signals' | 'confirm' | 'done';
  /** Step 1 picks. */
  distance: RaceDistance | null;
  date: string | null;        // YYYY-MM-DD (HTML date input format)
  time: string | null;        // HH:MM:SS, runner-typed
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
  stravaConnected: false,
  name: null,
  timezone: null,
  connectionsSkipped: false,
};

const VALID_STEPS = new Set(['goal', 'signals', 'confirm', 'done']);
const VALID_DISTANCES = new Set<RaceDistance>(['5k', '10k', 'half', 'marathon', 'none']);

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

  return {
    ...DEFAULT,
    step,
    distance,
    date,
    time,
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
  if (merged.stravaConnected) sp.set('strava', 'connected');
  if (merged.name) sp.set('name', merged.name);
  if (merged.timezone) sp.set('tz', merged.timezone);
  if (merged.connectionsSkipped) sp.set('skipped', '1');

  const q = sp.toString();
  return q ? `/onboarding?${q}` : '/onboarding';
}

/** Step 1 valid → can advance to signals. */
export function canAdvanceFromGoal(s: OnboardingState): boolean {
  if (!s.distance) return false;
  if (s.distance === 'none') return true;
  return Boolean(s.date);  // race anchor needs a date
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
