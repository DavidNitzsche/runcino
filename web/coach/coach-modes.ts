/**
 * Coach modes resolver. Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md §7.
 *
 * Eight modes; one active at a time. Resolved per-request from CoachState
 * + injury/illness/race-day context. Surfaces dispatch on mode first,
 * then run the per-job reads under the mode's overrides.
 *
 * Priority order (first match wins):
 *   1. RACE_DAY     (any race today)
 *   2. ILLNESS      (active illness logged)
 *   3. INJURY       (active injury logged)
 *   4. POST_RACE    (within 30d of last race finish)
 *   5. RACE_WEEK    (≤7d from next A-race)
 *   6. ONBOARDING   (any onboarding sub-stage active)
 *   7. MULTI_RACE   (2+ A-races in overlapping build windows)
 *   8. MAINTENANCE  (no A-race set, has data)
 *   9. ACTIVE       (default)
 */

import type { CoachState } from '@/lib/coach-state';
import { getActiveInjury, type RunnerInjury } from '@/lib/injury-store';
import { getActiveIllness, type RunnerIllness } from '@/lib/illness-store';

export type CoachMode =
  | 'race_day'
  | 'illness'
  | 'injury'
  | 'post_race'
  | 'race_week'
  | 'onboarding'
  | 'multi_race'
  | 'maintenance'
  | 'active';

export type OnboardingStage =
  | 'cold_start'           // no profile, no data, no race
  | 'connected_no_data'    // source linked, no activities
  | 'data_no_goal'         // ≥2 weeks data, no race
  | 'data_with_goal_no_plan' // race set, no plan
  | null;                  // out of onboarding

export interface ModeOverrides {
  /** PROJECTION reads return null. */
  suppressProjection: boolean;
  /** FORM reads return null (no runs to read, or unrelated streams). */
  suppressForm: boolean;
  /** CHALLENGE reads soften or suppress. */
  softChallenge: boolean;
  /** PRESCRIPTION sourced from a doctrine override, not coachDaily. */
  prescriptionSource: 'normal' | 'injury_protocol' | 'illness_rest' | 'race_morning' | null;
}

export interface ModeBanner {
  kind: 'active_injury' | 'active_illness' | 'race_conflict' | 'race_day' | 'race_week' | 'onboarding';
  severity: 'info' | 'warn' | 'urgent';
  headline: string;
  subline?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface CoachModeContext {
  mode: CoachMode;
  onboardingStage: OnboardingStage;
  activeInjury: RunnerInjury | null;
  activeIllness: RunnerIllness | null;
  overrides: ModeOverrides;
  banner: ModeBanner | null;
  /** Plain-text coach voice line keyed to the mode, suitable for the
   *  COACH-WATCHING strip or the top of the daily card. */
  modeVoice: string | null;
}

const DEFAULT_OVERRIDES: ModeOverrides = {
  suppressProjection: false,
  suppressForm: false,
  softChallenge: false,
  prescriptionSource: 'normal',
};

/** Load DB-backed mode signals (injury, illness) for the runner.
 *  Returns null pair for anonymous / non-authed callers. */
export async function loadModeSignals(userUuid: string | null | undefined): Promise<{
  activeInjury: RunnerInjury | null;
  activeIllness: RunnerIllness | null;
}> {
  if (!userUuid) return { activeInjury: null, activeIllness: null };
  const [activeInjury, activeIllness] = await Promise.all([
    getActiveInjury(userUuid),
    getActiveIllness(userUuid),
  ]);
  return { activeInjury, activeIllness };
}

/** Pure resolver — given state + already-loaded mode signals, decides
 *  which mode is active. No I/O. */
export function resolveActiveMode(
  state: CoachState,
  signals: { activeInjury: RunnerInjury | null; activeIllness: RunnerIllness | null },
  today: string,
): CoachMode {
  // 1. RACE_DAY — race today
  const nextA = state.races.nextA;
  if (nextA && nextA.date === today) return 'race_day';

  // 2. ILLNESS
  if (signals.activeIllness) return 'illness';

  // 3. INJURY
  if (signals.activeInjury) return 'injury';

  // 4. POST_RACE (within 30d of last race finish)
  const recent = state.races.recent?.[0];
  if (recent && recent.daysAgo <= 30) return 'post_race';

  // 5. RACE_WEEK (≤7d from next A-race)
  if (nextA && nextA.daysAway != null && nextA.daysAway <= 7) return 'race_week';

  // 6. ONBOARDING
  const stage = resolveOnboardingStage(state);
  if (stage != null) return 'onboarding';

  // 7. MULTI_RACE — 2+ A-races inside overlapping build windows.
  // state.races.inWindow holds every future race within distance-aware
  // build window; A-priority overlap there is the multi-race trigger.
  const upcomingAs = (state.races.inWindow ?? []).filter((r) => r.priority === 'A');
  if (upcomingAs.length >= 2) {
    const sorted = [...upcomingAs].sort((a, b) => a.daysAway - b.daysAway);
    const first = sorted[0];
    const second = sorted[1];
    if (second.daysAway - first.daysAway < 84) return 'multi_race';
  }

  // 8. MAINTENANCE — no A-race set
  if (!nextA) return 'maintenance';

  // 9. ACTIVE — default
  return 'active';
}

/** Onboarding sub-stage. Null when the runner is past onboarding.
 *  Proxy signals: weeklyAvg8w > 0 means at least some 8-week activity
 *  history; nextA presence means a goal is set. We can't directly
 *  detect "no plan generated" without a state.plan field, so the
 *  data_with_goal_no_plan substage is conservative — if a goal exists
 *  AND data exists, we exit onboarding to ACTIVE. The user can still
 *  generate a plan from there. */
export function resolveOnboardingStage(state: CoachState): OnboardingStage {
  const hasActivities = (state.volume?.weeklyAvg8w ?? 0) > 0 || (state.volume?.last28Mi ?? 0) > 0;
  const hasGoal = !!state.races.nextA;

  if (!hasActivities && !hasGoal) {
    // Truly cold start. The UI nudge points the user at "connect
    // Strava" + "add a race".
    return 'cold_start';
  }
  if (hasActivities && !hasGoal) return 'data_no_goal';
  return null;
}

/** Compute the full mode context — DB-loaded signals + resolved mode +
 *  overrides + banner + voice line. The single entry point surfaces call. */
export async function getCoachModeContext(
  state: CoachState,
  userUuid: string | null | undefined,
  today: string,
): Promise<CoachModeContext> {
  const signals = await loadModeSignals(userUuid);
  const mode = resolveActiveMode(state, signals, today);
  const onboardingStage = mode === 'onboarding' ? resolveOnboardingStage(state) : null;
  const overrides = overridesFor(mode);
  const banner = bannerFor(mode, signals, state);
  const modeVoice = voiceFor(mode, signals, state, onboardingStage);
  return {
    mode,
    onboardingStage,
    activeInjury: signals.activeInjury,
    activeIllness: signals.activeIllness,
    overrides,
    banner,
    modeVoice,
  };
}

function overridesFor(mode: CoachMode): ModeOverrides {
  switch (mode) {
    case 'race_day':
      return { suppressProjection: true, suppressForm: true, softChallenge: true, prescriptionSource: 'race_morning' };
    case 'illness':
      return { suppressProjection: false, suppressForm: true, softChallenge: true, prescriptionSource: 'illness_rest' };
    case 'injury':
      return { suppressProjection: true, suppressForm: true, softChallenge: true, prescriptionSource: 'injury_protocol' };
    case 'race_week':
      return { suppressProjection: false, suppressForm: false, softChallenge: true, prescriptionSource: 'normal' };
    case 'post_race':
      return { suppressProjection: false, suppressForm: false, softChallenge: true, prescriptionSource: 'normal' };
    case 'maintenance':
      return { suppressProjection: true, suppressForm: false, softChallenge: false, prescriptionSource: 'normal' };
    case 'onboarding':
      return { suppressProjection: true, suppressForm: true, softChallenge: true, prescriptionSource: 'normal' };
    case 'multi_race':
    case 'active':
    default:
      return DEFAULT_OVERRIDES;
  }
}

function bannerFor(
  mode: CoachMode,
  signals: { activeInjury: RunnerInjury | null; activeIllness: RunnerIllness | null },
  state: CoachState,
): ModeBanner | null {
  if (mode === 'injury' && signals.activeInjury) {
    const inj = signals.activeInjury;
    return {
      kind: 'active_injury',
      severity: inj.severity === 'major' ? 'urgent' : inj.severity === 'moderate' ? 'warn' : 'info',
      headline: `${cap(inj.site)} — ${inj.severity} injury`,
      subline: inj.expectedReturnDate
        ? `Expected back ${inj.expectedReturnDate}. Race goal on hold while the body recovers.`
        : 'Following the return protocol. Race goal on hold while the body recovers.',
      ctaLabel: 'View protocol',
      ctaHref: '/health',
    };
  }
  if (mode === 'illness' && signals.activeIllness) {
    const ill = signals.activeIllness;
    const restRule = ill.aboveNeck && ill.kind !== 'fever'
      ? 'Above the neck, no fever — easy run if it feels right, full rest if not.'
      : 'Below the neck or fever. Rest, real rest. Fitness will hold.';
    return {
      kind: 'active_illness',
      severity: ill.severity === 'severe' ? 'urgent' : 'warn',
      headline: `Sick — ${ill.kind}, ${ill.severity}`,
      subline: restRule,
      ctaLabel: 'Update',
      ctaHref: '/health',
    };
  }
  if (mode === 'race_day' && state.races.nextA) {
    return {
      kind: 'race_day',
      severity: 'info',
      headline: 'Race day',
      subline: `${state.races.nextA.name}. The training is done. Today is execution.`,
    };
  }
  if (mode === 'race_week' && state.races.nextA?.daysAway != null) {
    return {
      kind: 'race_week',
      severity: 'info',
      headline: `Race week — ${state.races.nextA.daysAway} days out`,
      subline: `${state.races.nextA.name}. Volume drops, intensity holds. Don't try to find another hard session.`,
    };
  }
  return null;
}

function voiceFor(
  mode: CoachMode,
  signals: { activeInjury: RunnerInjury | null; activeIllness: RunnerIllness | null },
  state: CoachState,
  onboardingStage: OnboardingStage,
): string | null {
  if (mode === 'injury' && signals.activeInjury) {
    const inj = signals.activeInjury;
    return `${cap(inj.site)} is the priority right now. Coming back early is how the next 8 weeks evaporate. Follow the return protocol; we'll re-plan the build when you're cleared.`;
  }
  if (mode === 'illness' && signals.activeIllness) {
    const ill = signals.activeIllness;
    if (ill.aboveNeck && ill.kind !== 'fever') {
      return `Head cold, above the neck, no fever — you can move, just not what's on the calendar. Cut the run in half, ease the pace, walk home if it gets worse.`;
    }
    return `Below-the-neck or fever — don't run. Sleep, fluids, real food. The fitness will hold; the immune system gets priority.`;
  }
  if (mode === 'race_day' && state.races.nextA) {
    return `Race day. The training is done; the legs know what to do. First three miles slower than you want, settle the middle, commit the last 5K. Fuel on schedule, drink to thirst.`;
  }
  if (mode === 'race_week' && state.races.nextA?.daysAway != null) {
    return `${state.races.nextA.daysAway} days out. The work is done, you can feel it because you have nothing to do. The legs are supposed to feel weird this week — that's freshness.`;
  }
  if (mode === 'post_race' && state.races.recent?.[0]) {
    const r = state.races.recent[0];
    if (r.daysAgo <= 3) return `${r.daysAgo} day${r.daysAgo === 1 ? '' : 's'} since ${r.name}. Recovery is the work. The fitness from that race is being converted into capacity right now, while you rest.`;
    if (r.daysAgo <= 10) return `${r.daysAgo} days post-${r.name}. Easing back in. Quality returns once the body is in rhythm again.`;
    return `${r.daysAgo} days out from ${r.name}. Back toward normal. Time to point at the next horizon.`;
  }
  if (mode === 'maintenance') {
    return `No A-race on the calendar. The body's holding fitness fine, but training without a target is maintenance, not progress. Set one when you're ready — the rest of the system wakes up the moment you do.`;
  }
  if (mode === 'onboarding') {
    switch (onboardingStage) {
      case 'cold_start':
        return 'Welcome. The coach gets sharper with every run, race, and check-in you give it. Start with a recent race if you have one, or connect Strava — that\'s the fastest way to wake the system up.';
      case 'connected_no_data':
        return 'Strava is connected. Once your first run lands here, fitness signals start lighting up. Go log a mile if you haven\'t yet today.';
      case 'data_no_goal':
        return 'You\'ve got a base building. Set an A-race in the Races tab and the path-to-race appears. Without a goal, this is just a logbook.';
      case 'data_with_goal_no_plan':
        return 'Race is locked. Generate a plan and the daily card starts speaking — until then I don\'t know what to prescribe.';
      case null:
      default:
        return null;
    }
  }
  if (mode === 'multi_race') {
    return `Two A-races inside an overlapping window. Hard to peak twice that close. Pick a primary in /races and the plan shape locks around it; the other becomes a fitness-check effort.`;
  }
  return null;
}

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
