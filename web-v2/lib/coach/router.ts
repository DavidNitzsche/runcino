/**
 * Surface router — picks the voice mode for a (surface, state) pair.
 *
 * Encodes the doctrine table from the deck:
 *   - TODAY: post-run | pre-run | rest-day | race-day
 *   - TRAINING: BASE | BUILD | PEAK | TAPER | RACE WEEK
 *   - RACE DETAIL: building (>60d) | sharpening (30-60d) | race-week (≤7d) | post-race
 *   - HEALTH: steady | watch-amber | watch-red | green
 *
 * Returns the mode label + the candidate topic kinds eligible for that mode.
 * Final filter (prereq enforcement) lives in lib/coach/engine.ts.
 */
import type { CoachState, TopicKind } from '@/lib/topics/types';

export type Surface = 'today' | 'training' | 'races' | 'race-detail' | 'health' | 'profile';

export interface ResolvedMode {
  surface: Surface;
  mode: string;
  candidateTopics: TopicKind[];
}

export function resolveMode(surface: Surface, state: CoachState, raceSlug?: string): ResolvedMode {
  switch (surface) {
    case 'today':    return resolveToday(state);
    case 'training': return resolveTraining(state);
    case 'races':    return resolveRaces(state);
    case 'race-detail': return resolveRaceDetail(state, raceSlug);
    case 'health':   return resolveHealth(state);
    case 'profile':  return resolveProfile(state);
  }
}

function resolveToday(state: CoachState): ResolvedMode {
  // Trigger logic per the §0 doctrine table.
  const todayPlanWO = state.currentWeekDays.find((d) => d.date === state.today);
  const isRestDay  = todayPlanWO?.type === 'rest';
  const isRaceDay  = state.nextARace?.date === state.today;
  const ranToday   = state.latest_activity?.date === state.today;

  let mode: string;
  if (isRaceDay)   mode = 'race-day';
  else if (ranToday) mode = 'post-run';
  else if (isRestDay) mode = 'rest-day';
  else mode = 'pre-run';

  // Candidate topics per mode. Prereqs will filter further.
  // 2026-05-27 P-RIGHT-RAIL-TOPICS — added niggle, load_ramp,
  // weekly_volume, long_run_horizon to /today so the right rail can
  // surface a card for each major beat the coach talks about.
  const todayCommon: TopicKind[] = ['niggle', 'load_ramp', 'weekly_volume', 'long_run_horizon'];
  const candidates: Record<string, TopicKind[]> = {
    'post-run':  ['run_recap', 'sleep_deficit', 'next_workout', 'race_horizon', 'cadence_experiment', 'profile_gap', ...todayCommon],
    'pre-run':   ['next_workout', 'sleep_deficit', 'watch_list', 'race_horizon', 'profile_gap', ...todayCommon],
    'rest-day':  ['next_workout', 'fun_fact', 'race_horizon', ...todayCommon],
    'race-day':  ['race_horizon'],
  };

  return { surface: 'today', mode, candidateTopics: candidates[mode] ?? [] };
}

function resolveTraining(state: CoachState): ResolvedMode {
  const mode = state.phaseLabel?.toLowerCase() ?? 'unknown';
  return {
    surface: 'training',
    mode,
    candidateTopics: ['next_workout', 'race_horizon', 'sleep_deficit', 'watch_list'],
  };
}

function resolveRaces(state: CoachState): ResolvedMode {
  const days = state.nextARace?.days_to_race ?? Infinity;
  let mode: string;
  if (days <= 7)        mode = 'race-week';
  else if (days <= 60)  mode = 'sharpening';
  else if (days < Infinity) mode = 'building';
  else                  mode = 'off-season';
  return { surface: 'races', mode, candidateTopics: ['race_horizon'] };
}

function resolveRaceDetail(state: CoachState, raceSlug?: string): ResolvedMode {
  // Same proximity buckets, scoped to the specific race.
  const days = state.nextARace?.days_to_race ?? Infinity;
  let mode: string;
  if (days < 0)         mode = 'post-race';
  else if (days <= 7)   mode = 'race-week';
  else if (days <= 60)  mode = 'sharpening';
  else                  mode = 'building';
  return { surface: 'race-detail', mode, candidateTopics: ['race_horizon'] };
}

function resolveHealth(state: CoachState): ResolvedMode {
  const rhrElevated = state.rhrCurrent != null && state.rhrBaseline != null
    && state.rhrCurrent - state.rhrBaseline >= 5;
  const rhrSustainedRed = state.rhrCurrent != null && state.rhrBaseline != null
    && state.rhrCurrent - state.rhrBaseline >= 8;
  const sleepCrash = state.sleep7Deficit >= 5;

  let mode: string;
  if (rhrSustainedRed && sleepCrash) mode = 'watch-red';
  else if (rhrElevated || state.sleep7Deficit >= 3) mode = 'watch-amber';
  else mode = 'steady';

  return {
    surface: 'health', mode,
    candidateTopics: ['sleep_deficit', 'watch_list', 'fun_fact'],
  };
}

function resolveProfile(state: CoachState): ResolvedMode {
  return {
    surface: 'profile', mode: 'identity',
    candidateTopics: ['profile_gap'],
  };
}
