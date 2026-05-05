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
  const races = activities.filter(a => isProbablyRace(a));
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

/** Year-of-running heatmap data — one cell per day from Jan 1 to today,
 *  columns = ISO weeks, rows = days of week (Mon top, Sun bottom).
 *  Returned as a flat array of {date, miles, runs} ordered by date so
 *  the renderer can snap each entry into its column/row by week-of-year
 *  + JS day-of-week. */
export function yearOfRunningHeatmap(activities: NormalizedActivity[]): Array<{ date: string; miles: number; runs: number }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const totalDays = Math.floor((today.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const out: Array<{ date: string; miles: number; runs: number }> = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(yearStart); d.setDate(yearStart.getDate() + i);
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

/** Calendar week (Mon → Sun) covering today. Returns one bucket per
 *  day with miles + runs, plus a flag identifying which bucket is
 *  today and which buckets are future (haven't happened yet). Used by
 *  the "this week" tile so the strip matches its own header. */
export function currentWeekDays(activities: NormalizedActivity[]): Array<{ date: string; miles: number; runs: number; isToday: boolean; isFuture: boolean }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const offsetToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offsetToMon);

  const todayIso = today.toISOString().slice(0, 10);
  const out: Array<{ date: string; miles: number; runs: number; isToday: boolean; isFuture: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const matches = activities.filter(a => a.date === iso);
    out.push({
      date: iso,
      miles: Math.round(matches.reduce((s, a) => s + a.distanceMi, 0) * 10) / 10,
      runs: matches.length,
      isToday: iso === todayIso,
      isFuture: iso > todayIso,
    });
  }
  return out;
}

/** Training "pulse" — phase inference + recent vs prior mileage delta +
 *  long-run progression + quality-day count. Drives the Training tile
 *  on the Overview page so the dashboard breathes with state instead of
 *  showing the same blank chips year-round.
 *
 *  Phase rules (priority order — first match wins):
 *    A race within 7 days   → TAPER
 *    A race within 8-21     → PEAK
 *    A race within 22-56    → RACE MONTH
 *    Race finished ≤14 days → POST-RACE (recovery, intentional volume drop)
 *    4w/4w mileage Δ > +10% → BUILDING
 *    Else                   → BASE BLOCK ("maintain the base" — the
 *                             default state, not a fallback)
 *
 *  Note: "DETRAINING" is intentionally NOT a phase. Volume drops are
 *  almost always either post-race recovery (already labeled) or a
 *  break/injury (which the user knows about and doesn't need a chip
 *  about). Calling normal recovery "detraining" was alarming and
 *  wrong.
 */
export interface TrainingPulse {
  phase: 'TAPER' | 'PEAK' | 'RACE MONTH' | 'POST-RACE' | 'BUILDING' | 'BASE BLOCK';
  recent4wkMi: number;          // sum of last 4 weeks
  prior4wkMi: number;           // sum of weeks 4–7 ago
  deltaPct: number | null;      // recent vs prior (null if prior is 0)
  weeklyAvg: number;            // last 4 weeks avg
  longRunAvgMi: number | null;  // avg of last 4 longest weekly runs
  longestRecentMi: number;      // longest run last 28 days
  qualityDaysThisWeek: number;  // workout_type === 3 in current calendar week
  daysToRace: number | null;
  raceName: string | null;
}

export function trainingPulse(
  activities: NormalizedActivity[],
  nextRaceDate: string | null,
  nextRaceName: string | null,
): TrainingPulse {
  const weeks = weeklyMiles(activities, 8);
  const recent4 = weeks.slice(-4);
  const prior4  = weeks.slice(0, 4);
  const recent4wkMi = Math.round(recent4.reduce((s, w) => s + w.miles, 0) * 10) / 10;
  const prior4wkMi  = Math.round(prior4.reduce((s, w) => s + w.miles, 0) * 10) / 10;
  const deltaPct = prior4wkMi > 0 ? (recent4wkMi - prior4wkMi) / prior4wkMi : null;
  const weeklyAvg = Math.round((recent4wkMi / 4) * 10) / 10;

  // Most recent finished race (any priority) — drives the POST-RACE
  // phase since volume drops after a race are recovery, not detraining.
  const todayISO = new Date().toISOString().slice(0, 10);
  const recentRaces = activities
    .filter(a => isProbablyRace(a) && a.date <= todayISO)
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastRace = recentRaces[0] ?? null;
  const daysSinceRace = lastRace
    ? Math.floor((Date.parse(todayISO) - Date.parse(lastRace.date)) / 86_400_000)
    : null;

  // Last 28 days of activities for long-run analysis
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 28);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const last28 = activities.filter(a => a.date >= cutoffISO);
  const longestRecentMi = last28.length > 0 ? Math.round(Math.max(...last28.map(a => a.distanceMi)) * 10) / 10 : 0;

  // Long-run avg: take the longest run from each of the last 4 weeks
  const longestPerWeek = recent4.map(w => {
    const start = w.weekStart;
    const endDate = new Date(start); endDate.setDate(endDate.getDate() + 7);
    const end = endDate.toISOString().slice(0, 10);
    const inWeek = activities.filter(a => a.date >= start && a.date < end);
    return inWeek.length > 0 ? Math.max(...inWeek.map(a => a.distanceMi)) : 0;
  }).filter(mi => mi > 0);
  const longRunAvgMi = longestPerWeek.length > 0
    ? Math.round((longestPerWeek.reduce((s, m) => s + m, 0) / longestPerWeek.length) * 10) / 10
    : null;

  // Current calendar-week quality day count (Strava workout_type === 3)
  const wkStart = (() => {
    const d = new Date(today);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return d.toISOString().slice(0, 10);
  })();
  const qualityDaysThisWeek = activities.filter(a => a.date >= wkStart && a.workoutType === 3).length;

  // Days to next race
  let daysToRace: number | null = null;
  if (nextRaceDate) {
    const target = new Date(nextRaceDate + 'T12:00:00Z');
    daysToRace = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  // Phase inference — race-window first, then post-race recovery, then
  // trend. BASE BLOCK is the default ("maintain the base"), not a
  // fallback — most runners spend most of the year in this phase.
  let phase: TrainingPulse['phase'];
  if (daysToRace != null && daysToRace >= 0 && daysToRace <= 7)       phase = 'TAPER';
  else if (daysToRace != null && daysToRace > 7 && daysToRace <= 21)  phase = 'PEAK';
  else if (daysToRace != null && daysToRace > 21 && daysToRace <= 56) phase = 'RACE MONTH';
  else if (daysSinceRace != null && daysSinceRace <= 14)              phase = 'POST-RACE';
  else if (deltaPct != null && deltaPct > 0.10)                       phase = 'BUILDING';
  else                                                                 phase = 'BASE BLOCK';

  return {
    phase,
    recent4wkMi,
    prior4wkMi,
    deltaPct,
    weeklyAvg,
    longRunAvgMi,
    longestRecentMi,
    qualityDaysThisWeek,
    daysToRace,
    raceName: nextRaceName,
  };
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

  // Time on feet — each quip uses a DIFFERENT reference unit from the
  // headline value (which is already days/hours via fmtBigDuration), so
  // the detail line adds new info instead of restating the value.
  const TIME: Array<{ s: number; quip: (n: number) => string }> = [
    { s: 60 * 60,                quip: n => `${n.toFixed(1)} hours on your feet. Just getting going.` },
    { s: 169 * 60,               quip: n => `${n.toFixed(1)}× Lord of the Rings (theatrical cut). The hobbits are tired.` },
    { s: 11 * 3600 + 22 * 60,    quip: n => `${n.toFixed(1)}× the LotR Extended Edition. With every council scene.` },
    { s: 24 * 3600,              quip: n => `About ${(n * 24 / 49).toFixed(1)}× a full Breaking Bad rewatch (62 episodes).` },
    { s: 49 * 3600,              quip: n => `${n.toFixed(1)}× every episode of Breaking Bad. End to end. Yeah, science.` },
    { s: 86 * 3600,              quip: n => `${n.toFixed(1)}× every Friends episode ever made. They weren\'t on a break.` },
    { s: 200 * 3600,             quip: n => `Comparable to ${(n * 200 / 168).toFixed(1)} full work weeks — except moving the whole time.` },
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
  // Looser tolerances than v1 so a marathon at 26.81 mi (Big Sur — GPS
  // routinely measures long) still counts toward the marathon best, a
  // half at 13.5 (Point Mugu) counts toward the half, etc. Tight enough
  // that a 7-mi training run doesn't accidentally win the 10K bucket.
  const buckets = [
    { label: '1 mi',     distMi: 1.00,  tol: 0.10 },
    { label: '5K',       distMi: 3.10,  tol: 0.30 },
    { label: '10K',      distMi: 6.21,  tol: 0.50 },
    { label: 'Half',     distMi: 13.10, tol: 0.80 },
    { label: 'Marathon', distMi: 26.22, tol: 1.00 },
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

/** Heuristic: is this activity probably a race? Strava's workout_type
 *  flag (=== 1) is the canonical answer, but plenty of races never get
 *  tagged at the time.
 *
 *  Without the tag, we have to disambiguate race names from training
 *  names. Training names include "race" too — "Race Pace Mile Reps",
 *  "20mi Race Practice Long Run", "Race-Pace Tempo." The naive
 *  /race|marathon|half/ regex was misclassifying those.
 *
 *  Approach:
 *    1. Strava workout_type === 1 always wins.
 *    2. Otherwise, name must contain a strong race indicator
 *       ("marathon", "half marathon", "championship", "grand prix")
 *    3. AND must NOT contain training-language exclusions
 *       (tempo, repeats, intervals, easy, recovery, long run,
 *        race pace, race practice, etc).
 *  This catches Big Sur / Sombrero / LA / Rose Bowl / Point Mugu —
 *  it does NOT catch "Race Pace Mile Reps" or "20mi Race Practice
 *  Long Run". Strava-tagged races (Disney "Powered by the Mouse for
 *  a PR", which doesn't match by name) still surface via rule #1. */
const RACE_INDICATOR_RE  = /\b(marathon|half[\s-]?marathon|championship|grand\s*prix)\b/i;
const TRAINING_EXCLUDE_RE = /\b(race\s*pace|race\s*practice|practice\s*run|tempo|repeat|rep\b|interval|long\s*run|easy|recovery|workout|over\s*and\s*under|progression|drop\s*set|stride|shake|warm[-\s]?up|cool[-\s]?down|taper)\b/i;

export function isProbablyRace(a: NormalizedActivity): boolean {
  if (a.workoutType === 1) return true;
  if (TRAINING_EXCLUDE_RE.test(a.name)) return false;
  return RACE_INDICATOR_RE.test(a.name);
}

/** Easy / hard split for the last N days. "Easy" is mile-weighted by
 *  avg HR being below the threshold; "hard" is at or above. Threshold
 *  defaults to 152 bpm — close to a typical aerobic ceiling for an
 *  endurance-focused runner; tunable per athlete once HealthKit data
 *  lands. Returns the easy share as a fraction in [0, 1]. */
export interface EffortBalance {
  easyMi: number;
  hardMi: number;
  easyShare: number;        // 0–1, mile-weighted
  totalMi: number;
  windowDays: number;
  hrThreshold: number;
  samplesWithHr: number;
  totalSamples: number;
}

/** Name-pattern classifier — "is this a hard training run?". The
 *  HR-threshold approach was unreliable: a well-trained runner can
 *  hit tempo/threshold work at 145-150 bpm, which falls below the
 *  152 default and gets misclassified as easy. Name patterns reflect
 *  what the runner actually intended: tempo / repeats / intervals /
 *  fartlek / progression / VO2 / over-and-under = hard. Everything
 *  else (easy, recovery, long, general aerobic) = easy. */
const HARD_NAME_RE = /\b(tempo|threshold|interval|repeats?|reps?\b|fartlek|progression|vo2|over\s*and\s*under|hill\s*repeats?|race\s*pace|mile\s*reps?|k\s*reps?|drop\s*set|over[-\s]?under|strides|pyramid)\b/i;

function isProbablyHard(a: NormalizedActivity): boolean {
  return HARD_NAME_RE.test(a.name);
}

export function effortBalance(activities: NormalizedActivity[], windowDays = 14, hrThreshold = 152): EffortBalance {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  // Exclude races from the intensity calculation — the 80/20 rule
  // applies to TRAINING. A race is a competitive effort, not a
  // training choice.
  const inWindow = activities.filter(a => a.date >= cutoffISO && !isProbablyRace(a));
  let easyMi = 0, hardMi = 0;
  let samplesWithHr = 0;
  for (const a of inWindow) {
    if (a.avgHr != null) samplesWithHr++;
    // Hard if EITHER the name says so OR avgHr is above threshold.
    // This catches tempo workouts at sub-threshold HR (most common
    // miss with the old purely-HR approach).
    const hard = isProbablyHard(a) || (a.avgHr != null && a.avgHr >= hrThreshold);
    if (hard) hardMi += a.distanceMi;
    else easyMi += a.distanceMi;
  }
  const totalMi = Math.round((easyMi + hardMi) * 10) / 10;
  const easyShare = totalMi > 0 ? easyMi / totalMi : 0;
  return {
    easyMi: Math.round(easyMi * 10) / 10,
    hardMi: Math.round(hardMi * 10) / 10,
    easyShare,
    totalMi,
    windowDays,
    hrThreshold,
    samplesWithHr,
    totalSamples: inWindow.length,
  };
}
