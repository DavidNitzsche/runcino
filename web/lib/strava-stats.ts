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

  // Distance comparisons — each landmark gets a short personality
  // kicker. The kicker plays in once you cross that threshold.
  const DIST: Array<{ mi: number; name: string; quip: string }> = [
    { mi: 26.22,  name: 'a marathon',                              quip: 'A whole marathon. You did several of those, actually.' },
    { mi: 50,     name: 'a 50-mile ultra',                         quip: 'A 50-mile ultra in steps. Now you\'re showing off.' },
    { mi: 100,    name: 'a 100-miler',                             quip: '100 miles. Western States territory. Bib not included.' },
    { mi: 200,    name: 'a tank of gas',                           quip: 'Further than most cars go on a tank of gas.' },
    { mi: 272,    name: 'LA → Las Vegas',                          quip: 'LA → Vegas, on foot. The drive ride-share would be $200.' },
    { mi: 382,    name: 'LA → San Francisco',                      quip: 'LA → San Francisco. The whole California coast in steps.' },
    { mi: 500,    name: 'LA → Reno',                               quip: 'LA → Reno. Nobody asked you to. You did it anyway.' },
    { mi: 700,    name: 'the length of California',                quip: 'The length of California, basically. North to south.' },
    { mi: 1000,   name: 'LA → Seattle',                            quip: 'LA → Seattle. The Pacific has watched the whole thing.' },
    { mi: 1500,   name: 'LA → Chicago',                            quip: 'LA → Chicago. Two time zones in running shoes.' },
    { mi: 2099,   name: 'the Pacific Crest Trail',                 quip: 'The entire PCT. No bear cans, no permits, no rideshares.' },
    { mi: 2789,   name: 'LA → NYC',                                quip: 'LA → NYC. Coast to coast. Diner pancakes await.' },
    { mi: 3500,   name: 'LA → London (over the pole)',             quip: 'LA → London, polar route. The plane is now optional.' },
  ];
  const distHit = DIST.filter(d => d.mi <= roll.totalMiles).pop();
  const distNext = DIST.find(d => d.mi > roll.totalMiles);
  if (distHit) {
    const gap = distNext ? distNext.mi - roll.totalMiles : null;
    const detail = gap != null
      ? `${distHit.quip} ${Math.round(gap)} more mi unlocks ${distNext!.name}.`
      : `${distHit.quip} You\'ve broken the chart.`;
    out.push({ label: 'Distance covered', value: `${roll.totalMiles.toFixed(1)} mi`, detail });
  } else if (distNext) {
    out.push({
      label: 'Distance covered',
      value: `${roll.totalMiles.toFixed(1)} mi`,
      detail: `${Math.round(distNext.mi - roll.totalMiles)} mi to ${distNext.name}. Keep showing up.`,
    });
  }

  // Vertical — total elevation gain compared to landmarks. Show the
  // remaining gap in ft when it\'s under 1000 (rounding to 0.0K ft is
  // not a personality, that\'s just a bug).
  const VERT: Array<{ ft: number; name: string; quip: string }> = [
    { ft: 1454,   name: 'the Empire State Building',           quip: 'Empire State Building, sidewalk to spire.' },
    { ft: 4421,   name: 'Half Dome',                           quip: 'Half Dome, valley floor to summit.' },
    { ft: 6288,   name: 'Mt. Washington',                      quip: 'Mt. Washington — they sell t-shirts for less.' },
    { ft: 10000,  name: 'a passenger jet at cruise',           quip: 'Roughly cruising altitude on a regional jet.' },
    { ft: 14505,  name: 'Mt. Whitney',                         quip: 'Mt. Whitney — the highest point in the lower 48. No permit needed.' },
    { ft: 19341,  name: 'Kilimanjaro',                         quip: 'Kilimanjaro. Bring oxygen anyway.' },
    { ft: 29029,  name: 'Everest',                             quip: 'A whole Everest. Sherpas would unionize.' },
    { ft: 60000,  name: 'two Everests',                        quip: 'Two Everests. The atmosphere is taking it personally.' },
    { ft: 100000, name: 'three Everests',                      quip: 'Three Everests. At this point, just touch grass.' },
  ];
  const vertHit = VERT.filter(v => v.ft <= roll.totalElevFt).pop();
  const vertNext = VERT.find(v => v.ft > roll.totalElevFt);
  if (vertHit) {
    const factor = roll.totalElevFt / vertHit.ft;
    const factorStr = factor >= 1.5 ? `${factor.toFixed(1)}× ` : '';
    const gapFt = vertNext ? vertNext.ft - roll.totalElevFt : null;
    const gapStr = gapFt == null ? '' : (gapFt < 1000 ? ` Just ${Math.round(gapFt)} ft to ${vertNext!.name} — basically next weekend.` : ` ${Math.round(gapFt / 1000)}K ft to ${vertNext!.name}.`);
    out.push({
      label: 'Vertical climbed',
      value: `${roll.totalElevFt.toLocaleString()} ft`,
      detail: `${factorStr}${vertHit.quip}${gapStr}`,
    });
  } else if (vertNext) {
    out.push({
      label: 'Vertical climbed',
      value: `${roll.totalElevFt.toLocaleString()} ft`,
      detail: `${Math.round((vertNext.ft - roll.totalElevFt) / 100) / 10}K ft to ${vertNext.name}.`,
    });
  }

  // Time on feet.
  const TIME: Array<{ s: number; quip: (n: number) => string }> = [
    { s: 60 * 60,                quip: n => `${n.toFixed(0)} feature films, end to end. No popcorn breaks.` },
    { s: 169 * 60,               quip: n => `${n.toFixed(1)}× the Lord of the Rings theatrical cut.` },
    { s: 11 * 3600 + 22 * 60,    quip: n => `${n.toFixed(1)}× LotR Extended Edition. With every council scene.` },
    { s: 24 * 3600,              quip: n => `${n.toFixed(1)} full days, if days were spent running.` },
    { s: 86 * 3600,              quip: n => `${n.toFixed(1)}× every Friends episode ever made. They weren\'t on a break.` },
    { s: 7 * 24 * 3600,          quip: n => `${n.toFixed(1)} calendar weeks of pure motion.` },
    { s: 30 * 24 * 3600,         quip: n => `${n.toFixed(1)} calendar months. You okay?` },
  ];
  const tHit = TIME.filter(t => t.s <= roll.totalMovingS).pop();
  if (tHit) {
    out.push({
      label: 'Time on feet',
      value: fmtBigDuration(roll.totalMovingS),
      detail: tHit.quip(roll.totalMovingS / tHit.s),
    });
  } else if (roll.totalMovingS > 0) {
    out.push({ label: 'Time on feet', value: fmtBigDuration(roll.totalMovingS), detail: 'Just getting warmed up.' });
  }

  // Race share of total mileage.
  if (roll.raceCount > 0) {
    const sharePct = Math.round((roll.raceMiles / Math.max(roll.totalMiles, 1)) * 100);
    const flavor = sharePct < 10
      ? 'The other 90% was rehearsal.'
      : sharePct < 20
      ? 'Most miles are still rehearsal — but the bibs are adding up.'
      : sharePct < 35
      ? 'Race-heavy season. Recovery thanks you for nothing.'
      : 'You basically race for fun at this point.';
    out.push({
      label: 'Race miles',
      value: `${roll.raceMiles.toFixed(1)} mi`,
      detail: `${roll.raceCount} race${roll.raceCount === 1 ? '' : 's'} this year · ${sharePct}% of total miles. ${flavor}`,
    });
  }

  // Days run vs total days elapsed this year.
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.now() - yearStart.getTime()) / 86_400_000) + 1;
  if (roll.daysRun > 0 && dayOfYear > 0) {
    const pct = Math.round((roll.daysRun / dayOfYear) * 100);
    const flavor = pct >= 80
      ? 'Almost a daily habit. Almost.'
      : pct >= 60
      ? 'Out the door more often than not.'
      : pct >= 40
      ? 'A solid every-other-day rhythm.'
      : pct >= 25
      ? 'Quality over quantity. Allegedly.'
      : 'Strategically conservative.';
    out.push({
      label: 'Days run',
      value: `${roll.daysRun} of ${dayOfYear}`,
      detail: `${pct}% of the year so far. ${flavor}`,
    });
  }

  // Pace × duration headline.
  if (roll.avgPaceSPerMi != null) {
    const m = Math.floor(roll.avgPaceSPerMi / 60);
    const s = roll.avgPaceSPerMi % 60;
    const hrFlavor = roll.avgHr == null ? 'Mile-weighted across every run.'
      : roll.avgHr < 140 ? `Avg HR ${roll.avgHr} bpm — chatty pace, mostly.`
      : roll.avgHr < 155 ? `Avg HR ${roll.avgHr} bpm — comfortable but committed.`
      : roll.avgHr < 170 ? `Avg HR ${roll.avgHr} bpm — you don\'t mess around.`
      : `Avg HR ${roll.avgHr} bpm — sustained suffering, applauded by Garmin.`;
    out.push({
      label: 'Year average pace',
      value: `${m}:${String(s).padStart(2, '0')}/mi`,
      detail: hrFlavor,
    });
  }

  // Longest single run — independent of races, more "what was your
  // outer-edge day" stat. Adds variety to the section.
  if (roll.longestRunMi > 0) {
    const lr = roll.longestRunMi;
    const flavor = lr >= 26.2 ? 'Marathon-plus territory. The legs remember.'
      : lr >= 20 ? 'Long-run season was real. Big breakfast aftermath.'
      : lr >= 13.1 ? 'Half-marathon distance, just because.'
      : lr >= 6.2 ? 'A solid 10K-plus on your hardest day.'
      : 'Short and sharp this year so far.';
    out.push({
      label: 'Longest run',
      value: `${lr.toFixed(1)} mi`,
      detail: flavor,
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
