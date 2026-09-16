/**
 * A weekly-volume progression may not also add an independent quality session
 * on top of a race-to-next-day-long weekend.
 *
 * Research/00a §"Practical load rules": "Either add mileage OR add intensity
 * in a given week, not both." The designed race weekend remains one explicitly
 * authored stimulus. When the week is also a new volume high beyond the
 * runner's sustained load, the additional non-race quality day becomes easy
 * mileage. Weekly volume, race role and long-run distance are unchanged.
 *
 * This is a plan-generator rule. It reads no goal pace and calculates no
 * capacity. The only athlete input is the canonical sustained-volume reading
 * already supplied to plan authoring by the load progression contract.
 */

import { MIN_VOLUME_STEP } from './combined-stress';

export interface VolumePrimaryDay {
  dow: number;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  notes: string;
  workShape?: unknown;
  progressionDose?: unknown;
  progressionLever?: unknown;
  challengeZone?: unknown;
  effortCued?: boolean;
}

export interface VolumePrimaryWeek {
  startISO: string;
  weeklyMi: number;
  days: VolumePrimaryDay[];
  isCutback?: boolean;
}

export interface VolumePrimarySafeguardDecision {
  week_start_iso: string;
  quality_dow: number;
  quality_type_before: string;
  quality_distance_mi: number;
  weekly_mi: number;
  prior_high_mi: number;
  sustained_mi: number;
  reason: 'volume_is_primary_stressor';
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dateOf = (week: VolumePrimaryWeek, dow: number): string => {
  const startDow = new Date(`${week.startISO}T12:00:00Z`).getUTCDay();
  return addDays(week.startISO, ((dow - startDow) % 7 + 7) % 7);
};

/**
 * Mutates only the independent quality day's classification and prescription.
 * Its distance remains easy mileage, so this pass never becomes a second
 * weekly-volume owner.
 */
export function protectVolumePrimaryWeeks(args: {
  weeks: VolumePrimaryWeek[];
  demonstratedSustainedMi: number | null;
}): VolumePrimarySafeguardDecision[] {
  const sustained = args.demonstratedSustainedMi;
  if (sustained == null || !(sustained > 0)) return [];

  const decisions: VolumePrimarySafeguardDecision[] = [];
  let priorHigh = 0;

  for (const week of args.weeks) {
    const baseline = priorHigh;
    priorHigh = Math.max(priorHigh, week.weeklyMi);
    if (!(baseline > 0) || week.isCutback) continue;

    const volumeStep = (week.weeklyMi - baseline) / baseline;
    if (!(volumeStep > MIN_VOLUME_STEP) || !(week.weeklyMi > sustained)) continue;

    const race = week.days.find((d) => d.type === 'race');
    const long = week.days.find((d) => d.type === 'long' && d.isLong && d.distanceMi > 0);
    if (!race || !long) continue;
    const raceISO = dateOf(week, race.dow);
    const longISO = dateOf(week, long.dow);
    const gapDays = Math.round(
      (Date.parse(`${longISO}T12:00:00Z`) - Date.parse(`${raceISO}T12:00:00Z`)) / 86_400_000,
    );
    if (gapDays !== 1) continue;

    const quality = week.days
      .filter((d) => d.isQuality && d.type !== 'race' && !d.isLong && d.distanceMi > 0)
      .sort((a, b) => b.distanceMi - a.distanceMi)[0];
    if (!quality) continue;

    decisions.push({
      week_start_iso: week.startISO,
      quality_dow: quality.dow,
      quality_type_before: quality.type,
      quality_distance_mi: quality.distanceMi,
      weekly_mi: week.weeklyMi,
      prior_high_mi: baseline,
      sustained_mi: sustained,
      reason: 'volume_is_primary_stressor',
    });

    quality.type = 'easy';
    quality.isQuality = false;
    quality.isLong = false;
    quality.subLabel = 'EASY';
    quality.notes = 'Easy mileage. This week progresses volume through the race and long-run weekend.';
    quality.workShape = null;
    quality.progressionDose = null;
    quality.progressionLever = null;
    quality.challengeZone = null;
    quality.effortCued = false;
  }

  return decisions;
}
