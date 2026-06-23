/**
 * Plan-simulator shared constants + input type · 2026-06-22
 *
 * CLIENT-SAFE. No server imports (no generate.ts / pg), so the /sim/plan client
 * page imports this directly without bundling the DB pool.
 *
 * Every value set here mirrors the NATIVE iPhone onboarding + goal-setup flow
 * (the canonical onboarding per David), not the web flow:
 *   - OnboardingView.swift  · the "Running" step (experience / days / mileage /
 *     longest run / race history / long-run day) + race-entry time wheel
 *   - F_Sheets.swift SetGoalSheet · the Goal path: per-distance recommended
 *     PLAN-WEEKS options (8/12/16…) each seeding a VDOT-predicted goal time
 *   - TargetsView.swift AddRaceSheet · the Race path: calendar date
 */

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export type SimGoalMode = 'goal' | 'race' | 'justRun';
export type SimDistance = '5k' | '10k' | 'half' | 'marathon' | '50k' | '100k';
export type SimRaceDistance = '5k' | '10k' | 'half' | 'marathon';
export type SimExperience = 'beginner' | 'intermediate' | 'advanced';
export type SimWhen = '<6mo' | '6-12mo' | '1-2yr' | '2+yr';
export type SimWeeklyMi = 0 | 5 | 15 | 25 | 35 | 45;
export type SimLongBucket = '0-3' | '3-6' | '6-10' | '10+';

export interface SimRaceHistoryEntry {
  distance: SimRaceDistance;
  timeSec: number;
  whenRaced: SimWhen;
}

/** The native onboarding + goal-setup answers, in onboarding language. */
export interface SimInputs {
  /** Which native goal-setup outcome: Goal (weeks) / Race (date) / Just run. */
  goalMode: SimGoalMode;
  /** Goal/race distance. */
  distance: SimDistance;
  /** Plan week-0 anchor (YYYY-MM-DD). */
  startDateISO: string;

  // ── Goal path (SetGoalSheet) ──
  /** Selected recommended plan length (from PLAN_OPTIONS). Race date = start + weeks·7. */
  planWeeks: number;
  /** Goal finish time (sec) from the wheels. null = by feel. */
  goalTimeSec: number | null;

  // ── Race path (AddRaceSheet) ──
  /** Calendar race date (YYYY-MM-DD). */
  raceDateISO: string;
  /** Recovery scenario: a race finished this many days before start (>0 → recovery). */
  lastRaceFinishedDaysAgo?: number | null;
  lastRaceDistance?: SimRaceDistance | null;

  // ── Runner profile (onboarding "Running" step) ──
  experienceLevel: SimExperience;
  /** Days per week · 0-6. 0 → couch-to-X floor of 3. */
  weeklyFrequency: number;
  /** Weekly mileage bucket (lower bound, native row value). */
  weeklyMileageBucket: SimWeeklyMi;
  /** Longest recent run bucket. */
  longestRunBucket: SimLongBucket;
  /** Self-reported PRs (up to 3) → seeds current-fitness VDOT. */
  raceHistory: SimRaceHistoryEntry[];
  longRunDay: DayKey;
  availableDays?: DayKey[] | null;

  // ── Advanced overrides (normally derived from Strava/runs) ──
  bestRecentVdotOverride?: number | null;
  easyDayMedianMi?: number | null;
  isMidBlock?: boolean;
  restDay?: DayKey | null;
  lthr?: number | null;
  maxHr?: number | null;
}

/** Standard distances in miles. 5k/10k/half/marathon match the native
 *  predictSeconds map; ultras match SetGoalSheet (F_Sheets.swift:757-758). */
export const SIM_DISTANCE_MI: Record<SimDistance, number> = {
  '5k': 3.10686,
  '10k': 6.21371,
  'half': 13.1094,
  'marathon': 26.2188,
  '50k': 31.0686,
  '100k': 62.1371,
};

export const DISTANCE_LABEL: Record<SimDistance, string> = {
  '5k': '5K', '10k': '10K', half: 'Half Marathon', marathon: 'Marathon', '50k': '50K', '100k': '100K',
};

/** Whether the goal-time wheel shows an hours column (native: half+ shows hours). */
export const SHOWS_HOURS: Record<SimDistance, boolean> = {
  '5k': false, '10k': false, half: true, marathon: true, '50k': true, '100k': true,
};

export interface PlanOption { weeks: number; rationale: string; vdotGain: number; }

/** Per-distance recommended plan lengths — verbatim from the native SetGoalSheet
 *  planOptions(for:) (F_Sheets.swift:711-745). The runner PICKS one of these;
 *  there is no free weeks entry. Each option's vdotGain seeds the goal time. */
export const PLAN_OPTIONS: Record<SimDistance, PlanOption[]> = {
  '5k': [
    { weeks: 8, rationale: "A focused speed block. Works if you're already running regularly.", vdotGain: 1.5 },
    { weeks: 12, rationale: 'Builds your base first, then sharpens speed. Better results for most runners.', vdotGain: 2.5 },
  ],
  '10k': [
    { weeks: 10, rationale: 'A steady build with a speed focus in the final weeks.', vdotGain: 1.75 },
    { weeks: 14, rationale: 'A complete build from base to race-ready. More time, better results.', vdotGain: 2.75 },
  ],
  'half': [
    { weeks: 12, rationale: 'Solid prep if you already have a strong base. Jump straight into quality work.', vdotGain: 2.0 },
    { weeks: 16, rationale: 'The standard choice. Time to build fitness and sharpen race pace.', vdotGain: 3.0 },
    { weeks: 20, rationale: 'More base before race training. Best if you’re coming off a down period.', vdotGain: 4.0 },
  ],
  'marathon': [
    { weeks: 16, rationale: "The minimum for a serious marathon. Assumes you're already running consistently.", vdotGain: 2.5 },
    { weeks: 20, rationale: 'The most popular choice. Enough time to build and peak properly.', vdotGain: 4.0 },
    { weeks: 24, rationale: 'Six months of work. Gives your body the most time to adapt to marathon training.', vdotGain: 5.5 },
  ],
  '50k': [
    { weeks: 18, rationale: 'A solid intro to ultra distance. Builds on marathon-level fitness.', vdotGain: 3.0 },
    { weeks: 24, rationale: 'More time on your feet, more confidence on race day.', vdotGain: 4.5 },
  ],
  '100k': [
    { weeks: 24, rationale: 'High mileage across six months. The foundation a 100K demands.', vdotGain: 4.0 },
    { weeks: 32, rationale: 'Eight months to fully prepare. Builds volume and time-on-feet gradually.', vdotGain: 6.0 },
  ],
};

// ── onboarding "Running" step value sets (OnboardingView.swift) ──
export const EXPERIENCE_OPTIONS: { value: SimExperience; title: string; desc: string }[] = [
  { value: 'beginner', title: 'Just getting started', desc: 'New to running, or returning after a long break.' },
  { value: 'intermediate', title: 'Building consistency', desc: "Running regularly for a year or more. You've done a race or two." },
  { value: 'advanced', title: 'Structured training', desc: 'You follow a plan, race often, and think in phases and paces.' },
];

export const FREQ_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Not running right now' },
  { value: 1, label: '1 day a week' },
  { value: 2, label: '2 days a week' },
  { value: 3, label: '3 days a week' },
  { value: 4, label: '4 days a week' },
  { value: 5, label: '5 days a week' },
  { value: 6, label: '6 days a week' },
];

export const WEEKLY_MI_OPTIONS: { value: SimWeeklyMi; label: string }[] = [
  { value: 0, label: 'Under 5 miles' },
  { value: 5, label: '5 to 15 miles' },
  { value: 15, label: '15 to 25 miles' },
  { value: 25, label: '25 to 35 miles' },
  { value: 35, label: '35 to 45 miles' },
  { value: 45, label: '45+ miles' },
];

export const LONG_BUCKET_OPTIONS: { value: SimLongBucket; label: string }[] = [
  { value: '0-3', label: 'Up to 3 miles' },
  { value: '3-6', label: '3 to 6 miles' },
  { value: '6-10', label: '6 to 10 miles' },
  { value: '10+', label: '10+ miles' },
];

export const WHEN_OPTIONS: { value: SimWhen; label: string }[] = [
  { value: '<6mo', label: '< 6 mo' },
  { value: '6-12mo', label: '6-12 mo' },
  { value: '1-2yr', label: '1-2 yr' },
  { value: '2+yr', label: '2+ yr' },
];

export const RACE_HISTORY_DISTANCES: { value: SimRaceDistance; label: string }[] = [
  { value: '5k', label: '5K' }, { value: '10k', label: '10K' }, { value: 'half', label: 'HALF' }, { value: 'marathon', label: 'FULL' },
];

export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** weeklyMi bucket → recentWeeklyMi. Native maps the bucket to a histAvg range
 *  (OnboardingView.swift:112-120: <5→"0-5", <15→"5-15", <25→"15-25", <35→
 *  "25-35", else→"35+"), then the backend maps that range to a midpoint
 *  (state.ts HIST_AVG_MIDPOINTS: 3/10/20/30/40/50). This is the exact (lossy) value
 *  a new no-Strava signup's plan is seeded from. VAR-06pt2 · 45+ no longer collapses to 40. */
export function recentWeeklyMiFromBucket(b: SimWeeklyMi): number {
  if (b < 5) return 3;
  if (b < 15) return 10;
  if (b < 25) return 20;
  if (b < 35) return 30;
  if (b < 45) return 40; // VAR-06pt2 · 35-45 bucket stays 40
  return 50;             // VAR-06pt2 · 45+ runners start/peak higher (Research/00a:194-206)
}

/** longest-run bucket → recentLongMi (state.ts HIST_LONG_MIDPOINTS: 2/5/8/12). */
export function recentLongMiFromBucket(b: SimLongBucket): number {
  return b === '0-3' ? 2 : b === '3-6' ? 5 : b === '6-10' ? 8 : 12;
}
