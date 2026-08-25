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
export type SimWeeklyMi = 0 | 5 | 15 | 25 | 35 | 45 | 55 | 70 | 90;
export type SimLongBucket = '0-3' | '3-6' | '6-10' | '10+' | '16-22' | '22+';

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

  /**
   * ANCHORFIT-1 (2026-08-25) · the runner's LOGGED history, most-recent-first,
   * `dailyMiMostRecentFirst[i]` = miles run `i` days before `startDateISO`.
   *
   * Optional and absent by default, so every existing archetype composes
   * byte-identically. Its whole purpose is that `_sweep_allusers.test.ts` and
   * /sim/plan mirror ONBOARDING, where there are no logged runs at all — and
   * two of the three volume anchors (`recentPeakWeeklyMileage` and
   * `rampBaseForBuild`) are DB-only readers that therefore could not be graded
   * by any gate in the repo. `recentPeakWeeklyMi` was pinned to
   * `recentWeeklyMi`, which is the pre-DOCTRINE-4 proxy the reverse-taper
   * defect came from: the sweep was still grading the engine that shipped it.
   *
   * When present, the three anchors are resolved from it by the SAME pure
   * functions production spends (`resolvePeakWeekly`, `resolveRampBase`).
   */
  dailyMiMostRecentFirst?: readonly number[] | null;
  /** ANCHORFIT-1 · last race PRIORITY, which sets how long a mandated
   *  interruption `rampBaseForBuild` may read through. */
  lastRacePriority?: 'A' | 'B' | 'C' | null;

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
  // HIGHVOL-1 (2026-08-19) · the ladder stopped at an open-ended '45+', so the
  // simulator could not represent — and therefore could not audit — any runner
  // in the sub-elite or elite rows of Research/00a §"Volume table".
  // SIM-SEED-1 (2026-08-24) · the top three labels now name the bands the
  // engine is actually seeded from (`histAvgBandForMi`'s cut points), not
  // rounder numbers that spanned two of them. A picker whose label and whose
  // seed disagree is a picker that previews somebody else's plan.
  { value: 45, label: '45 to 55 miles' },
  { value: 55, label: '55 to 65 miles' },
  { value: 70, label: '65 to 85 miles' },
  { value: 90, label: '85+ miles' },
];

export const LONG_BUCKET_OPTIONS: { value: SimLongBucket; label: string }[] = [
  { value: '0-3', label: 'Up to 3 miles' },
  { value: '3-6', label: '3 to 6 miles' },
  { value: '6-10', label: '6 to 10 miles' },
  { value: '10+', label: '10 to 16 miles' },
  { value: '16-22', label: '16 to 22 miles' },
  { value: '22+', label: '22+ miles' },
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

/**
 * weeklyMi bucket → recentWeeklyMi · THE COLD-START SEED, and it must be a
 * number production can actually persist.
 *
 * The real chain has three hops and this function is a model of all three:
 * `OnboardingHostV5.snapWeeklyMi` snaps the runner's typed mileage to a rung,
 * `OnboardingHostV5.histAvgBand` turns that rung into a BAND STRING, and
 * `POST /api/onboarding/complete` persists that band's `HIST_AVG_MIDPOINTS`
 * value. The engine reads the column. So the set of seeds a real signup can
 * produce is exactly the set of midpoints, and nothing between them.
 *
 * SIM-SEED-1 (2026-08-24) · the top three rungs used to answer 62 / 80 / 100,
 * which no runner can be seeded with — HIGHVOL-1 widened the two ladders
 * separately and gave them different midpoints, so /sim/plan and every sweep
 * that walks these buckets were grading three runners production cannot build,
 * and `conservativeVdotFromMileage` (the cold-start pace floor) reads exactly
 * this number. The bands are read off the same cut points the Swift switches
 * on, so the three ladders now move together or not at all.
 *
 * The nine buckets cover every achievable seed. The phone offers eleven rungs
 * (0/5/15/25/35/45/55/65/75/85/95) but 65 and 75 share the "60-80" band and 85
 * and 95 share "80+", so {3, 10, 20, 30, 40, 50, 52, 70, 90} is the whole
 * reachable set and each bucket below lands on one of them.
 */
export function recentWeeklyMiFromBucket(b: SimWeeklyMi): number {
  return HIST_AVG_MIDPOINT_BY_BAND[histAvgBandForMi(b)];
}

/** `OnboardingHostV5.histAvgBand`, in TypeScript. The cut points are the
 *  Swift's `case ..<N` list, unchanged. */
function histAvgBandForMi(mi: number): string {
  if (mi < 5) return '0-5';
  if (mi < 15) return '5-15';
  if (mi < 25) return '15-25';
  if (mi < 35) return '25-35';
  if (mi < 45) return '35+';
  if (mi < 55) return '45+';
  if (mi < 65) return '45-60';
  if (mi < 85) return '60-80';
  return '80+';
}

/** `lib/onboarding/state.ts` `HIST_AVG_MIDPOINTS`, mirrored rather than
 *  imported: this module is CLIENT-SAFE by contract and the onboarding state
 *  module is a separate dependency chain. `_onboarding_e2e.test.ts` LAW O1
 *  drives the real table through the real route, so a divergence between the
 *  two is a test failure and not a silent drift. */
const HIST_AVG_MIDPOINT_BY_BAND: Record<string, number> = {
  '0': 0, '0-5': 3, '5-15': 10, '15-25': 20, '25-35': 30,
  '35+': 40, '45+': 50, '45-60': 52, '60-80': 70, '80+': 90,
};

/** longest-run bucket → recentLongMi (state.ts HIST_LONG_MIDPOINTS: 2/5/8/12). */
export function recentLongMiFromBucket(b: SimLongBucket): number {
  if (b === '0-3') return 2;
  if (b === '3-6') return 5;
  if (b === '6-10') return 8;
  // HIGHVOL-1 · '10+' keeps its 12 (byte-stable); the rungs above it exist
  // because that anchor IS the 110%-of-prior-30d single-session spike guard,
  // and an open-ended top rung held a 20-mile long runner to a 13-mile week 1.
  if (b === '16-22') return 19;
  if (b === '22+') return 22;
  return 12;
}
