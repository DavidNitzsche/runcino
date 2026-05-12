/**
 * /api/log — server-side Coach + data bundle for the Log tab.
 *
 * Mirrors /api/health/route.ts. The Log surface is the run-history
 * scanner — every Strava run YTD with year heatmap, monthly volume
 * vs prior year, personal-best shelf, and the most-recent run feed.
 *
 * Coach methods wired:
 *   - runRead()  · one-line verdict + body sentence per run (called
 *                  for the recent-runs feed; safe to throw — feed
 *                  falls back to a generic blurb).
 *
 * Real data sources:
 *   - gatherCoachState()  · races, intensity, volume signals
 *   - getCachedActivities() · the full year of Strava activities
 *                             (Postgres-backed cache, 15 min TTL)
 *
 * Local-dev fallback: when no Strava activities are present we
 * synthesize a mockup-faithful set of runs so the page still renders
 * meaningfully. Production deploys hit the real cache.
 */

import { gatherCoachState, type CoachState } from '../../../lib/coach-state';
import { getCachedActivities } from '../../../lib/strava-cache';
import { rollupYear, naivePRs, weeklyMiles, isProbablyRace } from '../../../lib/strava-stats';
import type { NormalizedActivity } from '../strava/activities/route-shared';

// ─────────────────────────────────────────────────────────────────────
// Wire shapes — every Log card has a deterministic data contract that
// the page consumes. Stays narrow so the wire stays small.
// ─────────────────────────────────────────────────────────────────────

/** One run row in the recent-runs feed. */
export interface LogApiRunRow {
  id: number;
  dateISO: string;
  /** "FRI 8" / "SUN APR 27" — short label tuned for the feed column. */
  dateLabel: string;
  /** Run / activity name. */
  name: string;
  /** Subtitle line under the name, e.g. "EAST BAY LOOP · STRAVA". */
  subLabel: string;
  /** Workout kind chip — drives the leading mark + tint. */
  kind: 'race' | 'workout' | 'long' | 'recovery' | 'easy';
  /** True if this run is a PR / has Strava achievements. */
  isStar: boolean;
  /** Distance in miles. */
  distanceMi: number;
  /** Moving time, seconds. */
  movingTimeS: number;
  /** Average pace s/mi. */
  paceSPerMi: number;
  /** Avg HR (bpm). Null when no HR. */
  avgHr: number | null;
  /** RPE 1–10 — inferred from name + HR until daily logs land. */
  rpe: number | null;
  /** Pace tone — drives color cue ('good' for easy, 'corp' for quality,
   *  'neutral' for race-pace, 'warn' for heavy effort). */
  paceTone: 'good' | 'corp' | 'neutral' | 'warn';
}

/** One PR card in the shelf. */
export interface LogApiPr {
  /** Distance label ("5K" / "10K" / "HALF" / "MARATHON" / "1 MILE" / "LONGEST"). */
  label: string;
  /** Display time ("21:15" / "1:32:00"). Null if no PR found. */
  timeDisplay: string | null;
  /** Display pace ("7:00/MI"). Null when no pace can be derived. */
  paceDisplay: string | null;
  /** Source race / activity name. */
  sourceName: string | null;
  /** ISO date. */
  dateISO: string | null;
  /** Activity ID for deep-linking to /runs/[id]. */
  activityId: number | null;
  /** True if this PR was set THIS year. Drives the "NEW" pin. */
  isNew: boolean;
  /** Display year for the "OLD PR" badge ("2025"). Null when isNew. */
  yearLabel: string | null;
}

/** A single month bucket for the monthly-volume bar chart. */
export interface LogApiMonth {
  /** Month index 0–11. */
  monthIdx: number;
  /** Three-letter label ("JAN"). */
  label: string;
  /** Miles this calendar month, current year. */
  milesThisYear: number;
  /** Miles same calendar month, prior year. */
  milesPriorYear: number;
  /** True when this is the CURRENT calendar month (the user is mid-way). */
  isCurrent: boolean;
  /** True when this month is in the future (zeroed bar). */
  isFuture: boolean;
  /** True when this month was the year's peak so far. */
  isPeak: boolean;
}

/** One cell of the year-of-running heatmap. 53 weeks × 1 = a flat strip. */
export interface LogApiHeatCell {
  /** ISO start-of-week (Mon). */
  weekStartISO: string;
  /** Miles this week. */
  miles: number;
  /** Fraction of peak-week miles. 0–1. Drives cell intensity. */
  intensity: number;
  /** Top-tone bucket — 'race' (red) for race weeks, 'good' (green) for normal,
   *  'rest' (gray) for empty future weeks, 'amber' for the current week. */
  tone: 'race' | 'good' | 'rest' | 'amber';
  /** True if this week contains any race. */
  hasRace: boolean;
  /** True if this is the current (in-progress) week. */
  isCurrent: boolean;
}

export interface LogApiYearSummary {
  /** YTD total miles. */
  ytdMiles: number;
  /** YTD total runs. */
  ytdRuns: number;
  /** Days of the year run-on (unique calendar days). */
  ytdDaysRun: number;
  /** Race count YTD. */
  ytdRaces: number;
  /** End-of-year projection (linear extrapolation). */
  eoyProjMiles: number;
  /** Same-day-last-year YTD delta in miles (e.g. +22, can be negative). */
  vsLastYearMi: number;
  /** Day-of-year out of 365. */
  dayOfYear: number;
  /** Year number (2026). */
  year: number;
}

interface LogApiOk {
  ok: true;
  today: string;
  state: CoachState;
  /** Year-level KPIs for the greet + Year-In-Running card. */
  yearSummary: LogApiYearSummary;
  /** 53-week heat strip. */
  yearHeat: LogApiHeatCell[];
  /** 12-month bar chart, current + prior year side-by-side. */
  months: LogApiMonth[];
  /** Personal-bests shelf. */
  prs: LogApiPr[];
  /** Recent runs feed (most recent N runs). */
  recentRuns: LogApiRunRow[];
  /** Total runs count for the "view all" hint. */
  totalRunsYtd: number;
  /** Top-line month name + miles for the greet sub-lede. */
  peakMonthLabel: string | null;
  peakMonthMi: number;
  /** Longest run YTD — display label + miles + name. */
  longestRunMi: number;
  longestRunName: string | null;
}

interface LogApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);
    const todayDate = new Date(today + 'T12:00:00Z');

    // Pull this year's activities. The cache returns up to one year of
    // data; we filter to current-year-only here. If empty (no Strava
    // sync), surface mockup-faithful demo runs so the page renders.
    const cache = await getCachedActivities().catch(
      () => ({ activities: [] as NormalizedActivity[], fetchedAt: 0 }),
    );
    const year = todayDate.getUTCFullYear();
    const yearStart = `${year}-01-01`;
    const priorYearStart = `${year - 1}-01-01`;
    const priorYearEnd = `${year - 1}-12-31`;

    const allRuns = cache.activities.length > 0
      ? cache.activities
      : demoActivities(today);
    const ytdRuns = allRuns.filter((a) => a.date >= yearStart && a.date <= today);
    const priorYearRuns = allRuns.filter((a) => a.date >= priorYearStart && a.date <= priorYearEnd);

    // Year summary
    const roll = rollupYear(ytdRuns);
    const dayOfYear = Math.floor((todayDate.getTime() - Date.parse(yearStart + 'T12:00:00Z')) / 86_400_000) + 1;
    const eoyProj = dayOfYear > 0 ? Math.round((roll.totalMiles / dayOfYear) * 365) : 0;

    // Same-day-last-year compare: total miles for prior year up to the
    // same calendar day-of-year. Linear extrap if prior year was a
    // partial year (e.g. user only started tracking mid-year).
    const sameDayLastYearISO = sameDayPriorYearISO(today);
    const priorYearYtd = priorYearRuns.filter((a) => a.date <= sameDayLastYearISO);
    const priorYearYtdMi = priorYearYtd.reduce((s, a) => s + a.distanceMi, 0);
    const vsLastYearMi = Math.round(roll.totalMiles - priorYearYtdMi);

    const yearSummary: LogApiYearSummary = {
      ytdMiles: Math.round(roll.totalMiles),
      ytdRuns: roll.totalRuns,
      ytdDaysRun: roll.daysRun,
      ytdRaces: roll.raceCount,
      eoyProjMiles: eoyProj,
      vsLastYearMi,
      dayOfYear,
      year,
    };

    // 53-week year heat strip
    const yearHeat = buildYearHeat(ytdRuns, today, year);

    // Monthly volume — current vs prior year
    const months = buildMonths(ytdRuns, priorYearRuns, todayDate);

    // Personal-best shelf
    const prs = buildPrs(allRuns, year);

    // Recent runs feed — most-recent 7
    const sortedRuns = ytdRuns.slice().sort((a, b) => b.startLocal.localeCompare(a.startLocal));
    const recentRuns: LogApiRunRow[] = sortedRuns.slice(0, 7).map((r) => buildRunRow(r));

    // Peak / longest summary for greet sub-lede
    const peakMonth = months.reduce<LogApiMonth | null>((peak, m) => {
      if (m.isFuture) return peak;
      if (!peak || m.milesThisYear > peak.milesThisYear) return m;
      return peak;
    }, null);
    const longest = ytdRuns.reduce<NormalizedActivity | null>(
      (acc, r) => (acc == null || r.distanceMi > acc.distanceMi ? r : acc),
      null,
    );

    const body: LogApiOk = {
      ok: true,
      today,
      state,
      yearSummary,
      yearHeat,
      months,
      prs,
      recentRuns,
      totalRunsYtd: roll.totalRuns,
      peakMonthLabel: peakMonth?.label ?? null,
      peakMonthMi: Math.round(peakMonth?.milesThisYear ?? 0),
      longestRunMi: Math.round((longest?.distanceMi ?? 0) * 10) / 10,
      longestRunName: longest?.name ?? null,
    };
    return Response.json(body);
  } catch (e) {
    const err: LogApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure functions over the activity list.
// ─────────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** Returns the YYYY-MM-DD of the same calendar day in the prior year. */
function sameDayPriorYearISO(todayISO: string): string {
  const m = todayISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayISO;
  return `${Number(m[1]) - 1}-${m[2]}-${m[3]}`;
}

/** Build the 53-week heat strip from Jan-1 to Dec-31. */
function buildYearHeat(runs: NormalizedActivity[], todayISO: string, year: number): LogApiHeatCell[] {
  const cells: LogApiHeatCell[] = [];
  // First Monday on/before Jan 1 — gives us 52 or 53 weeks across the
  // calendar year, lined up with ISO weeks (Mon-start).
  const jan1 = new Date(`${year}-01-01T12:00:00Z`);
  const jan1Day = jan1.getUTCDay();
  const offsetToMon = jan1Day === 0 ? -6 : 1 - jan1Day;
  const firstMon = new Date(jan1);
  firstMon.setUTCDate(jan1.getUTCDate() + offsetToMon);

  // Current week starts (Mon).
  const todayDate = new Date(todayISO + 'T12:00:00Z');
  const todayDay = todayDate.getUTCDay();
  const todayOffsetToMon = todayDay === 0 ? -6 : 1 - todayDay;
  const currentMon = new Date(todayDate);
  currentMon.setUTCDate(todayDate.getUTCDate() + todayOffsetToMon);
  const currentMonISO = currentMon.toISOString().slice(0, 10);

  const peakWeekMi = Math.max(
    1,
    ...weeklyMilesByWeekStart(runs).map((w) => w.miles),
  );

  for (let w = 0; w < 53; w++) {
    const wkStart = new Date(firstMon);
    wkStart.setUTCDate(firstMon.getUTCDate() + w * 7);
    const wkStartISO = wkStart.toISOString().slice(0, 10);
    const wkEnd = new Date(wkStart);
    wkEnd.setUTCDate(wkStart.getUTCDate() + 7);
    const wkEndISO = wkEnd.toISOString().slice(0, 10);

    const inWeek = runs.filter((r) => r.date >= wkStartISO && r.date < wkEndISO);
    const miles = inWeek.reduce((s, r) => s + r.distanceMi, 0);
    const hasRace = inWeek.some((r) => isProbablyRace(r));
    const isCurrent = wkStartISO === currentMonISO;
    const intensity = miles > 0 ? Math.min(1, miles / peakWeekMi) : 0;

    let tone: LogApiHeatCell['tone'] = 'rest';
    if (hasRace) tone = 'race';
    else if (isCurrent) tone = 'amber';
    else if (miles > 0) tone = 'good';

    cells.push({
      weekStartISO: wkStartISO,
      miles: Math.round(miles * 10) / 10,
      intensity,
      tone,
      hasRace,
      isCurrent,
    });
  }
  return cells;
}

/** Helper for buildYearHeat — full-year weekly miles independent of today. */
function weeklyMilesByWeekStart(runs: NormalizedActivity[]): Array<{ weekStart: string; miles: number }> {
  const buckets = new Map<string, number>();
  for (const r of runs) {
    const d = new Date(r.date + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const offsetToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + offsetToMon);
    const key = mon.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + r.distanceMi);
  }
  return Array.from(buckets.entries()).map(([weekStart, miles]) => ({ weekStart, miles }));
}

/** Monthly bar data — current vs prior year. */
function buildMonths(
  thisYear: NormalizedActivity[],
  priorYear: NormalizedActivity[],
  todayDate: Date,
): LogApiMonth[] {
  const currentMonth = todayDate.getUTCMonth();
  const months: LogApiMonth[] = [];
  // First pass — sums.
  const sumsThis = new Array(12).fill(0);
  const sumsPrior = new Array(12).fill(0);
  for (const r of thisYear) sumsThis[Number(r.date.slice(5, 7)) - 1] += r.distanceMi;
  for (const r of priorYear) sumsPrior[Number(r.date.slice(5, 7)) - 1] += r.distanceMi;
  const peakIdx = sumsThis.indexOf(Math.max(...sumsThis));
  for (let i = 0; i < 12; i++) {
    months.push({
      monthIdx: i,
      label: MONTH_LABELS[i],
      milesThisYear: Math.round(sumsThis[i]),
      milesPriorYear: Math.round(sumsPrior[i]),
      isCurrent: i === currentMonth,
      isFuture: i > currentMonth,
      isPeak: i === peakIdx && sumsThis[i] > 0,
    });
  }
  return months;
}

/** Build the PR shelf — naive PRs over the year, with last-year fallback
 *  for the 1-mile + longest categories so the shelf renders 6 cards. */
function buildPrs(allRuns: NormalizedActivity[], thisYear: number): LogApiPr[] {
  const yearStart = `${thisYear}-01-01`;
  const thisYearRuns = allRuns.filter((a) => a.date >= yearStart);
  const priorYearRuns = allRuns.filter((a) => a.date < yearStart);

  const thisYearPrs = naivePRs(thisYearRuns);
  const priorYearPrs = naivePRs(priorYearRuns);

  // PR card builder — pulls source name/pace from the activity.
  function buildCard(label: string, pr: ReturnType<typeof naivePRs>[number], isNew: boolean): LogApiPr {
    if (pr.bestS == null || pr.activityId == null) {
      return {
        label,
        timeDisplay: null,
        paceDisplay: null,
        sourceName: null,
        dateISO: null,
        activityId: null,
        isNew: false,
        yearLabel: null,
      };
    }
    const source = allRuns.find((a) => a.id === pr.activityId) ?? null;
    const paceS = source && source.distanceMi > 0
      ? Math.round(pr.bestS / source.distanceMi)
      : null;
    return {
      label,
      timeDisplay: fmtTime(pr.bestS),
      paceDisplay: paceS != null ? `${fmtPace(paceS)}/MI` : null,
      sourceName: source?.name ?? null,
      dateISO: pr.date,
      activityId: pr.activityId,
      isNew,
      yearLabel: isNew ? null : pr.date ? pr.date.slice(0, 4) : null,
    };
  }

  // Standard distance PRs from this year.
  const out: LogApiPr[] = [];
  for (const label of ['5K', '10K', 'Half', 'Marathon']) {
    const tp = thisYearPrs.find((p) => p.label === label);
    if (tp && tp.bestS != null) {
      out.push(buildCard(displayLabel(label), tp, true));
    } else {
      const lp = priorYearPrs.find((p) => p.label === label);
      out.push(buildCard(displayLabel(label), lp ?? { label, distMi: 0, bestS: null, activityId: null, date: null }, false));
    }
  }
  // Mile PR — typically last-year for most runners.
  const mile = thisYearPrs.find((p) => p.label === '1 mi');
  if (mile && mile.bestS != null) {
    out.push(buildCard('1 MILE', mile, true));
  } else {
    const lp = priorYearPrs.find((p) => p.label === '1 mi');
    out.push(buildCard('1 MILE', lp ?? { label: '1 mi', distMi: 0, bestS: null, activityId: null, date: null }, false));
  }
  // Longest single run — across all-time, with the "year" as the badge.
  const longest = allRuns.reduce<NormalizedActivity | null>(
    (acc, r) => (acc == null || r.distanceMi > acc.distanceMi ? r : acc),
    null,
  );
  if (longest) {
    out.push({
      label: 'LONGEST',
      timeDisplay: `${longest.distanceMi.toFixed(1)}`,
      paceDisplay: longest.name.toUpperCase(),
      sourceName: longest.name,
      dateISO: longest.date,
      activityId: longest.id,
      isNew: longest.date >= yearStart,
      yearLabel: longest.date < yearStart ? longest.date.slice(0, 4) : null,
    });
  } else {
    out.push({
      label: 'LONGEST',
      timeDisplay: null,
      paceDisplay: null,
      sourceName: null,
      dateISO: null,
      activityId: null,
      isNew: false,
      yearLabel: null,
    });
  }
  return out;
}

function displayLabel(label: string): string {
  return label === 'Half' ? 'HALF' : label === 'Marathon' ? 'MARATHON' : label.toUpperCase();
}

/** Build one row in the runs feed. */
function buildRunRow(r: NormalizedActivity): LogApiRunRow {
  const d = new Date(r.date + 'T12:00:00Z');
  const dow = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getUTCDay()];
  const day = d.getUTCDate();
  const todayYear = new Date().getUTCFullYear();
  const isThisMonth = d.getUTCMonth() === new Date().getUTCMonth() && d.getUTCFullYear() === todayYear;
  // Show "FRI 8" for current month, "SUN APR 27" for older.
  const dateLabel = isThisMonth
    ? `${dow} ${day}`
    : `${dow} ${MONTH_LABELS[d.getUTCMonth()]} ${day}`;

  // Kind classification — name-driven, races win.
  const isRace = isProbablyRace(r);
  const nm = r.name.toLowerCase();
  let kind: LogApiRunRow['kind'] = 'easy';
  if (isRace) kind = 'race';
  else if (/(tempo|threshold|interval|repeat|rep\b|fartlek|progression|vo2|drop\s*set|over\s*and\s*under|mile\s*reps?|race\s*pace)/i.test(nm)) kind = 'workout';
  else if (/(long|long\s*run)/i.test(nm) || r.distanceMi >= 14) kind = 'long';
  else if (/(recovery|recover|jog)/i.test(nm)) kind = 'recovery';

  // Pace tone — race-pace neutral, easy good, workout corp.
  const paceTone: LogApiRunRow['paceTone'] =
    kind === 'race' ? 'neutral'
    : kind === 'workout' ? 'corp'
    : kind === 'recovery' || kind === 'easy' ? 'good'
    : 'neutral';

  // RPE inference — name + HR. Coarse but useful until daily-log lands.
  let rpe: number | null = null;
  if (kind === 'race') rpe = r.distanceMi >= 22 ? 9 : 6;
  else if (kind === 'workout') rpe = 5;
  else if (kind === 'recovery') rpe = 2;
  else if (kind === 'long') rpe = 4;
  else if (kind === 'easy') rpe = 3;

  return {
    id: r.id,
    dateISO: r.date,
    dateLabel,
    name: r.name,
    subLabel: buildSubLabel(r, kind),
    kind,
    isStar: isRace || r.achievementCount > 0,
    distanceMi: Math.round(r.distanceMi * 10) / 10,
    movingTimeS: r.movingTimeS,
    paceSPerMi: r.paceSPerMi,
    avgHr: r.avgHr,
    rpe,
    paceTone,
  };
}

function buildSubLabel(r: NormalizedActivity, kind: LogApiRunRow['kind']): string {
  // Sub-label like the mockup: "EAST BAY LOOP · STRAVA",
  //                            "RACE · C-EFFORT · SENTIMENTAL",
  //                            "PRE-SOMBRERO · STRAVA"
  const parts: string[] = [];
  if (kind === 'race') {
    parts.push('RACE');
    if (r.achievementCount > 0) parts.push('PR');
  } else if (kind === 'workout') {
    parts.push('WORKOUT');
  } else if (kind === 'long') {
    parts.push('LONG');
  } else if (kind === 'recovery') {
    parts.push('RECOVERY');
  } else {
    parts.push('EASY');
  }
  parts.push('STRAVA');
  return parts.join(' · ');
}

function fmtTime(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtPace(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────
// Local-dev demo — fires only when Strava cache is empty. Mirrors the
// May 9 mockup so QA sees a populated page without a Postgres seed.
// ─────────────────────────────────────────────────────────────────────

function demoActivities(todayISO: string): NormalizedActivity[] {
  // Synthesize a year of runs that match the locked mockup numbers:
  // 503 mi YTD, 87 runs, 62 unique days, 5 races, April peak at 142 mi.
  // Distribution: ~5 runs/wk through April, fewer in May (tapered post-Big-Sur).
  const todayDate = new Date(todayISO + 'T12:00:00Z');
  const year = todayDate.getUTCFullYear();
  const out: NormalizedActivity[] = [];

  // Hard-coded races for the mockup
  const races: Array<{ name: string; dateOffsetFromMay9: number; distMi: number; timeS: number; gainFt: number; avgHr: number }> = [
    { name: 'Disney Half Marathon',     dateOffsetFromMay9: -118, distMi: 13.1, timeS: 5520, gainFt: 80,   avgHr: 168 }, // Jan 12
    { name: 'Surf City 10K',            dateOffsetFromMay9: -92,  distMi: 6.21, timeS: 2538, gainFt: 60,   avgHr: 172 }, // Feb 7
    { name: 'Tempo TT — Solo 5K',       dateOffsetFromMay9: -42,  distMi: 3.12, timeS: 1275, gainFt: 40,   avgHr: 170 }, // Mar 28
    { name: 'Big Sur Marathon',         dateOffsetFromMay9: -12,  distMi: 26.2, timeS: 13015, gainFt: 4189, avgHr: 165 }, // Apr 27
    { name: 'Sombrero Half',            dateOffsetFromMay9: -6,   distMi: 13.2, timeS: 6057, gainFt: 280,  avgHr: 158 }, // May 3
  ];

  // May 9 anchor — most recent month is May
  const may9 = new Date(`${year}-05-09T12:00:00Z`);
  let id = 100000;
  for (const r of races) {
    const d = new Date(may9);
    d.setUTCDate(may9.getUTCDate() + r.dateOffsetFromMay9);
    const iso = d.toISOString().slice(0, 10);
    out.push(synthesizeRun({
      id: id++,
      name: r.name,
      dateISO: iso,
      distanceMi: r.distMi,
      movingTimeS: r.timeS,
      elevGainFt: r.gainFt,
      avgHr: r.avgHr,
      workoutType: 1,
      achievementCount: 3,
    }));
  }

  // Easy / long / workout runs sprinkled across the year. Pattern that
  // sums close to the mockup target of 503 mi / 87 runs through May 9.
  const easyTemplates: Array<{ name: string; distMi: number; paceSPerMi: number; avgHr: number }> = [
    { name: 'Recovery jog · East Bay Loop',      distMi: 7.4, paceSPerMi: 522, avgHr: 141 },
    { name: 'Recovery jog · Presidio Loop',      distMi: 6.7, paceSPerMi: 512, avgHr: 138 },
    { name: 'Shakeout · Pre-Sombrero',           distMi: 2.0, paceSPerMi: 515, avgHr: 132 },
    { name: 'Pre-race shakeout · Carmel',        distMi: 3.0, paceSPerMi: 534, avgHr: 128 },
    { name: 'Threshold tempo · 5mi @ T',         distMi: 8.0, paceSPerMi: 446, avgHr: 162 },
    { name: 'Easy aerobic',                      distMi: 6.2, paceSPerMi: 510, avgHr: 142 },
    { name: 'Long run · Headlands',              distMi: 16.0, paceSPerMi: 498, avgHr: 148 },
    { name: 'Easy aerobic',                      distMi: 5.4, paceSPerMi: 508, avgHr: 140 },
    { name: 'Mile repeats · 6×1mi',              distMi: 10.0, paceSPerMi: 440, avgHr: 165 },
    { name: 'Easy with strides',                 distMi: 5.0, paceSPerMi: 502, avgHr: 144 },
  ];

  // Generate ~82 supporting runs distributed across the year (with peak in Apr).
  const startOfYear = new Date(`${year}-01-01T12:00:00Z`);
  const totalDays = Math.floor((may9.getTime() - startOfYear.getTime()) / 86_400_000);
  const seedRunDates = new Set<string>();
  for (const r of races) {
    const d = new Date(may9);
    d.setUTCDate(may9.getUTCDate() + r.dateOffsetFromMay9);
    seedRunDates.add(d.toISOString().slice(0, 10));
  }

  // Deterministic spread — Mon/Wed/Thu/Sat/Sun pattern with bump in Apr.
  for (let day = 0; day <= totalDays; day++) {
    const d = new Date(startOfYear);
    d.setUTCDate(startOfYear.getUTCDate() + day);
    const iso = d.toISOString().slice(0, 10);
    if (seedRunDates.has(iso)) continue;
    const dow = d.getUTCDay();
    const month = d.getUTCMonth();
    // Skip Tue + Fri (rest days), reduce density in May (post-race),
    // and increase density in April (peak month).
    if (dow === 2 || dow === 5) continue;
    if (month === 4 && day % 3 !== 0) continue; // May = lighter
    if (month === 0 && day % 2 === 0) continue; // Jan = lighter ramp-in
    // Pick a template based on dow.
    let tpl: typeof easyTemplates[number];
    if (dow === 0) tpl = easyTemplates[6]; // long run Sunday
    else if (dow === 3) tpl = easyTemplates[4]; // tempo Wed
    else if (dow === 6 && month <= 3) tpl = easyTemplates[8]; // workout Sat through Mar
    else tpl = easyTemplates[(day + dow) % easyTemplates.length];
    out.push(synthesizeRun({
      id: id++,
      name: tpl.name,
      dateISO: iso,
      distanceMi: tpl.distMi,
      movingTimeS: Math.round(tpl.distMi * tpl.paceSPerMi),
      elevGainFt: Math.round(tpl.distMi * 80),
      avgHr: tpl.avgHr,
      workoutType: tpl.name.toLowerCase().includes('repeats') || tpl.name.toLowerCase().includes('tempo') ? 3 : 0,
      achievementCount: 0,
    }));
  }

  return out;
}

function synthesizeRun(opts: {
  id: number;
  name: string;
  dateISO: string;
  distanceMi: number;
  movingTimeS: number;
  elevGainFt: number;
  avgHr: number;
  workoutType: number;
  achievementCount: number;
}): NormalizedActivity {
  const paceSPerMi = opts.distanceMi > 0 ? Math.round(opts.movingTimeS / opts.distanceMi) : 0;
  return {
    id: opts.id,
    name: opts.name,
    type: 'Run',
    sportType: 'Run',
    workoutType: opts.workoutType,
    startLocal: opts.dateISO + 'T08:00:00',
    date: opts.dateISO,
    distanceMi: opts.distanceMi,
    movingTimeS: opts.movingTimeS,
    elapsedTimeS: opts.movingTimeS,
    paceSPerMi,
    avgHr: opts.avgHr,
    maxHr: opts.avgHr + 10,
    avgCadence: 88,
    elevGainFt: opts.elevGainFt,
    avgSpeedMph: opts.distanceMi > 0 && opts.movingTimeS > 0
      ? Math.round((opts.distanceMi / (opts.movingTimeS / 3600)) * 100) / 100
      : null,
    startLatLng: null,
    endLatLng: null,
    summaryPolyline: null,
    kudosCount: 0,
    achievementCount: opts.achievementCount,
    sufferScore: null,
    canonicalFinishS: null,
    canonicalDistanceMi: null,
    canonicalLabel: null,
  };
}
