/**
 * Pure rollups + comparisons over the year's Strava activities.
 *
 * No fetching, no React — just derivations. Pages get the activities
 * array from useActivities() and pass it in here for the headline
 * numbers: YTD miles, weekly mileage, longest run, race totals, plus
 * the "fun stat" comparisons that make the numbers tangible.
 */

import type { NormalizedActivity } from './strava-activities';

export interface YearRollup {
  totalRuns: number;
  totalMiles: number;
  totalMovingS: number;
  totalElevFt: number;
  longestRunMi: number;
  raceCount: number;       // runs with workout_type === 1
  raceMiles: number;
  avgPaceSPerMi: number | null;
  avgHr: number | null;
  daysRun: number;         // unique calendar days with at least one run
}

export function rollupYear(activities: NormalizedActivity[]): YearRollup {
  if (activities.length === 0) {
    return { totalRuns: 0, totalMiles: 0, totalMovingS: 0, totalElevFt: 0, longestRunMi: 0, raceCount: 0, raceMiles: 0, avgPaceSPerMi: null, avgHr: null, daysRun: 0 };
  }
  const totalMiles = activities.reduce((s, a) => s + a.distanceMi, 0);
  const totalMovingS = activities.reduce((s, a) => s + a.movingTimeS, 0);
  const totalElevFt = activities.reduce((s, a) => s + a.elevGainFt, 0);
  const longestRunMi = Math.max(...activities.map(a => a.distanceMi));
  const races = activities.filter(a => a.workoutType === 1);
  const hrSamples = activities.filter(a => a.avgHr != null && a.distanceMi > 0);
  const weightedHr = hrSamples.reduce((s, a) => s + (a.avgHr as number) * a.distanceMi, 0);
  const hrMiles = hrSamples.reduce((s, a) => s + a.distanceMi, 0);
  const days = new Set(activities.map(a => a.date));
  return {
    totalRuns: activities.length,
    totalMiles: Math.round(totalMiles * 10) / 10,
    totalMovingS,
    totalElevFt,
    longestRunMi: Math.round(longestRunMi * 10) / 10,
    raceCount: races.length,
    raceMiles: Math.round(races.reduce((s, r) => s + r.distanceMi, 0) * 10) / 10,
    avgPaceSPerMi: totalMiles > 0 ? Math.round(totalMovingS / totalMiles) : null,
    avgHr: hrMiles > 0 ? Math.round(weightedHr / hrMiles) : null,
    daysRun: days.size,
  };
}

/** Sum miles per ISO week (Mon–Sun) for the last `weeks` weeks. */
export function weeklyMiles(activities: NormalizedActivity[], weeks = 12): Array<{ weekStart: string; miles: number; runs: number }> {
  const out: Array<{ weekStart: string; miles: number; runs: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = (() => {
    const d = new Date(today);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  })();
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(monday); start.setDate(monday.getDate() - 7 * w);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = end.toISOString().slice(0, 10);
    const inWeek = activities.filter(a => a.date >= startISO && a.date < endISO);
    out.push({
      weekStart: startISO,
      miles: Math.round(inWeek.reduce((s, a) => s + a.distanceMi, 0) * 10) / 10,
      runs: inWeek.length,
    });
  }
  return out;
}

/** Last N days as { date, miles, runs }. Includes zero-day entries so
 *  charts can render a continuous strip. Today is the last bucket. */
export function dailyMiles(activities: NormalizedActivity[], days = 7): Array<{ date: string; miles: number; runs: number }> {
  const out: Array<{ date: string; miles: number; runs: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const matches = activities.filter(a => a.date === iso);
    out.push({
      date: iso,
      miles: Math.round(matches.reduce((s, a) => s + a.distanceMi, 0) * 10) / 10,
      runs: matches.length,
    });
  }
  return out;
}

/** Avg HR per week (mile-weighted) for the last `weeks` weeks. */
export function weeklyAvgHr(activities: NormalizedActivity[], weeks = 12): Array<{ weekStart: string; avgHr: number | null }> {
  const buckets = weeklyMiles(activities, weeks).map(b => ({ ...b, avgHr: null as number | null }));
  for (const b of buckets) {
    const start = b.weekStart;
    const endDate = new Date(start); endDate.setDate(endDate.getDate() + 7);
    const end = endDate.toISOString().slice(0, 10);
    const samples = activities.filter(a => a.date >= start && a.date < end && a.avgHr != null && a.distanceMi > 0);
    if (samples.length === 0) continue;
    const num = samples.reduce((s, a) => s + (a.avgHr as number) * a.distanceMi, 0);
    const den = samples.reduce((s, a) => s + a.distanceMi, 0);
    b.avgHr = den > 0 ? Math.round(num / den) : null;
  }
  return buckets;
}

/** Average cadence per week, similarly mile-weighted. */
export function weeklyAvgCadence(activities: NormalizedActivity[], weeks = 12): Array<{ weekStart: string; avgCadence: number | null }> {
  const buckets = weeklyMiles(activities, weeks).map(b => ({ ...b, avgCadence: null as number | null }));
  for (const b of buckets) {
    const start = b.weekStart;
    const endDate = new Date(start); endDate.setDate(endDate.getDate() + 7);
    const end = endDate.toISOString().slice(0, 10);
    const samples = activities.filter(a => a.date >= start && a.date < end && a.avgCadence != null && a.distanceMi > 0);
    if (samples.length === 0) continue;
    const num = samples.reduce((s, a) => s + (a.avgCadence as number) * a.distanceMi, 0);
    const den = samples.reduce((s, a) => s + a.distanceMi, 0);
    // Strava reports cadence as one-leg-per-step (so half of total
    // strides per minute). Double to get the more familiar SPM value.
    b.avgCadence = den > 0 ? Math.round((num / den) * 2) : null;
  }
  return buckets;
}

/** Fun comparisons that make raw mileage / time totals tangible. Each
 *  returns a unit + the closest "would-be" thing of that magnitude. */
export interface FunStat {
  label: string;
  value: string;
  detail: string;
}

export function funStats(roll: YearRollup): FunStat[] {
  const out: FunStat[] = [];

  // Distance comparisons — pick whichever item the user's miles cross.
  const DIST: Array<{ mi: number; name: string }> = [
    { mi: 26.22,  name: 'a marathon' },
    { mi: 50,     name: 'an ultramarathon (50 mi)' },
    { mi: 100,    name: 'the Western States buckle distance' },
    { mi: 272,    name: 'LA → Las Vegas' },
    { mi: 382,    name: 'LA → San Francisco' },
    { mi: 500,    name: 'LA → Reno' },
    { mi: 1000,   name: 'LA → Seattle' },
    { mi: 1500,   name: 'LA → Chicago' },
    { mi: 2099,   name: 'the Pacific Crest Trail (sea-to-sea)' },
    { mi: 2789,   name: 'LA → New York City' },
    { mi: 3500,   name: 'LA → London (over the pole)' },
  ];
  const distHit = DIST.filter(d => d.mi <= roll.totalMiles).pop();
  const distNext = DIST.find(d => d.mi > roll.totalMiles);
  if (distHit) {
    out.push({
      label: 'Distance covered',
      value: `${roll.totalMiles.toFixed(1)} mi`,
      detail: `Past ${distHit.name}. ${distNext ? `${(distNext.mi - roll.totalMiles).toFixed(0)} mi to ${distNext.name}.` : 'Off the chart.'}`,
    });
  } else if (distNext) {
    out.push({
      label: 'Distance covered',
      value: `${roll.totalMiles.toFixed(1)} mi`,
      detail: `${(distNext.mi - roll.totalMiles).toFixed(0)} mi to ${distNext.name}.`,
    });
  }

  // Vertical — total elevation gain compared to landmarks.
  const VERT: Array<{ ft: number; name: string }> = [
    { ft: 1454,   name: 'the Empire State Building' },
    { ft: 4421,   name: 'Half Dome (rim to base)' },
    { ft: 6288,   name: 'Mt. Washington' },
    { ft: 14505,  name: 'Mt. Whitney (highest in the lower 48)' },
    { ft: 19341,  name: 'Kilimanjaro' },
    { ft: 29029,  name: 'Everest' },
    { ft: 60000,  name: 'twice up Everest' },
    { ft: 100000, name: 'three Everests' },
  ];
  const vertHit = VERT.filter(v => v.ft <= roll.totalElevFt).pop();
  const vertNext = VERT.find(v => v.ft > roll.totalElevFt);
  if (vertHit) {
    const stack = (roll.totalElevFt / vertHit.ft).toFixed(1);
    out.push({
      label: 'Vertical climbed',
      value: `${roll.totalElevFt.toLocaleString()} ft`,
      detail: `${stack}× ${vertHit.name}.${vertNext ? ` ${((vertNext.ft - roll.totalElevFt) / 1000).toFixed(1)}K ft to ${vertNext.name}.` : ''}`,
    });
  } else if (vertNext) {
    out.push({
      label: 'Vertical climbed',
      value: `${roll.totalElevFt.toLocaleString()} ft`,
      detail: `${((vertNext.ft - roll.totalElevFt) / 1000).toFixed(1)}K ft to ${vertNext.name}.`,
    });
  }

  // Time comparisons — total moving time vs cultural reference points.
  const TIME: Array<{ s: number; name: string }> = [
    { s: 169 * 60,                    name: 'a Lord of the Rings movie' },
    { s: 11 * 3600 + 22 * 60,         name: 'the LotR Extended trilogy' },
    { s: 24 * 3600,                   name: 'a full day' },
    { s: 60 * 60 * 22,                name: 'every Friends episode (S1)' },
    { s: 86 * 60 * 60,                name: 'every Friends episode (10 seasons)' },
    { s: 7 * 24 * 3600,               name: 'a calendar week' },
    { s: 30 * 24 * 3600,              name: 'a calendar month' },
  ];
  const timeHit = TIME.filter(t => t.s <= roll.totalMovingS).pop();
  if (timeHit) {
    const factor = (roll.totalMovingS / timeHit.s);
    out.push({
      label: 'Time on feet',
      value: fmtBigDuration(roll.totalMovingS),
      detail: factor >= 2 ? `${factor.toFixed(1)}× ${timeHit.name}.` : `Past ${timeHit.name}.`,
    });
  } else if (roll.totalMovingS > 0) {
    out.push({ label: 'Time on feet', value: fmtBigDuration(roll.totalMovingS), detail: 'Adding up.' });
  }

  // Race share of total mileage.
  if (roll.raceCount > 0) {
    const sharePct = Math.round((roll.raceMiles / Math.max(roll.totalMiles, 1)) * 100);
    out.push({
      label: 'Race miles',
      value: `${roll.raceMiles.toFixed(1)} mi`,
      detail: `${roll.raceCount} race${roll.raceCount === 1 ? '' : 's'} · ${sharePct}% of total miles.`,
    });
  }

  // Days run vs total days elapsed this year.
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.now() - yearStart.getTime()) / 86_400_000) + 1;
  if (roll.daysRun > 0 && dayOfYear > 0) {
    const pct = Math.round((roll.daysRun / dayOfYear) * 100);
    out.push({
      label: 'Days run',
      value: `${roll.daysRun} of ${dayOfYear}`,
      detail: `${pct}% of the year so far.`,
    });
  }

  // Pace × duration headline.
  if (roll.avgPaceSPerMi != null) {
    const m = Math.floor(roll.avgPaceSPerMi / 60);
    const s = roll.avgPaceSPerMi % 60;
    out.push({
      label: 'Year average pace',
      value: `${m}:${String(s).padStart(2, '0')}/mi`,
      detail: roll.avgHr != null ? `Mile-weighted · avg HR ${roll.avgHr} bpm.` : 'Mile-weighted across every run.',
    });
  }

  return out;
}

function fmtBigDuration(s: number): string {
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Given a list of activities, find personal bests across canonical
 *  distances. Operates on per-activity moving time vs distance — not
 *  Strava best_efforts (which require detail fetches). Useful for an
 *  app-wide "PR shelf" without paying N detail-fetch round trips. */
export function naivePRs(activities: NormalizedActivity[]): Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> {
  const buckets = [
    { label: '1 mi',     distMi: 1.00,  tol: 0.05 },
    { label: '5K',       distMi: 3.10,  tol: 0.10 },
    { label: '10K',      distMi: 6.21,  tol: 0.15 },
    { label: 'Half',     distMi: 13.10, tol: 0.30 },
    { label: 'Marathon', distMi: 26.22, tol: 0.40 },
  ];
  return buckets.map(b => {
    const within = activities.filter(a => Math.abs(a.distanceMi - b.distMi) <= b.tol);
    if (within.length === 0) return { label: b.label, distMi: b.distMi, bestS: null, activityId: null, date: null };
    // Lowest moving time wins. Strava's own best_efforts would split
    // mid-run efforts here too — this is a coarser "your best whole run
    // close to that distance" instead.
    const best = within.slice().sort((a, b) => a.movingTimeS - b.movingTimeS)[0];
    return { label: b.label, distMi: b.distMi, bestS: best.movingTimeS, activityId: best.id, date: best.date };
  });
}
