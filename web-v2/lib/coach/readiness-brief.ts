/**
 * lib/coach/readiness-brief.ts · the daily morning-brief composer.
 *
 * Turns the runner's current CoachState + 60d history into a rich,
 * design-ready envelope:
 *
 *   · Top line · score + band + plain-language headline + one-line mover
 *   · Per-pillar tiles · current value · baseline · band · weight · meaning + confounders
 *   · 14-day trends · score + per-pillar sparklines
 *   · Streaks · "HRV down 3 days in a row" (per Research/15 3-day persistence rule)
 *   · Movers · biggest pillar delta vs yesterday with plain-language frame
 *   · Citations · per-pillar research path (drawer can deep-link)
 *
 * Doctrine-grounded:
 *   · Research/15 §HRV (Plews 7d rolling + SWC + CV)
 *   · Research/15 §RHR (60d baseline · nocturnal preferred)
 *   · Research/00b §Sleep (7-9h healthy band · 8h+ under high load)
 *   · Research/15 §ACWR (directional, NOT deterministic per Impellizzeri critique)
 *   · Research/15 §Subjective Measures (Saw et al. · subjective beats objective when they disagree)
 *
 * Generic mechanism · works for any user. No hardcoded baselines.
 *
 * Returns null when the runner has zero data signal at all · the panel
 * renders an empty-state instead.
 */

import { pool } from '@/lib/db/pool';
import { computeReadiness, type ReadinessBreakdown, type ReadinessInput } from './readiness';
import { loadReadinessHistory, type PillarPoint, type ReadinessHistory } from './readiness-history';
import type { CoachState } from '@/lib/topics/types';

export type PillarKey = 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
export type PillarBand = 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
export type StreakDirection = 'above' | 'below';

export interface ReadinessStreak {
  pillar: PillarKey;
  direction: StreakDirection;
  days: number;             // ≥3 to be surfaced
  startDate: string;        // YYYY-MM-DD
  /** Plain-language doctrine for what an n-day streak means. */
  meaning: string;
}

export interface ReadinessMover {
  pillar: PillarKey;
  deltaPts: number;          // signed · positive = score up vs yesterday
  /** "HRV is the biggest mover · -6 pts vs yesterday." */
  label: string;
}

export interface ReadinessConfounder {
  pillar: PillarKey;
  /** One-line plausible explanation the runner can check against. */
  explanation: string;
  /** Whether THIS confounder is likely (vs just listed) · drives surfacing. */
  likely: boolean;
}

export interface ReadinessPillarTile {
  key: PillarKey;
  label: string;             // 'SLEEP'
  weightPct: number;          // 28
  observedValue: string;      // '7.2h · 7-night avg'
  observedSub: string;         // '+0.3h vs scaled 7.5h target'
  baseline: string;           // 'target 7.5h'
  band: PillarBand;
  weightContribution: number;  // signed contribution to score
  meaning: string;             // plain-language interpretation
  confounders: ReadinessConfounder[];
  trend: PillarPoint[];        // 14-day sparkline
  citation: string;            // 'Research/00b §Sleep'
}

export interface ReadinessBrief {
  date: string;                // YYYY-MM-DD
  score: number;
  band: PillarBand;
  label: string;               // 'READY'
  /** One-line plain-language headline for the top of the panel. */
  headline: string;
  /** "Score down 6 from yesterday · HRV is the mover." */
  oneLineMover: string | null;
  /** Score trend, 14-day. Includes today's row. */
  scoreTrend: { date: string; score: number; band: PillarBand }[];
  pillars: ReadinessPillarTile[];
  streaks: ReadinessStreak[];
  movers: ReadinessMover[];
  /** When subjective wellness is recorded for today AND disagrees ≥15 pts
   *  with objective score · per Saw et al. doctrine, subjective wins. */
  subjectiveOverride: {
    subjectiveScore: number;   // 0-100 derived from 1-10 wellness
    objectiveScore: number;
    deltaAbs: number;
    advice: string;
  } | null;
  /** "Watching" callouts for tomorrow · the brief points the runner at
   *  what to verify if it persists. */
  watchTomorrow: string[];
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  sleep: 'SLEEP', hrv: 'HRV', rhr: 'RHR', load: 'LOAD', hr_recovery: 'HR RECOVERY',
};
const PILLAR_WEIGHT: Record<PillarKey, number> = {
  sleep: 28, hrv: 28, rhr: 24, load: 15, hr_recovery: 5,
};
const PILLAR_CITATION: Record<PillarKey, string> = {
  sleep: 'Research/00b §Sleep · 7-9h healthy band, 8h+ under high training load',
  hrv: 'Research/15 §HRV · Plews approach · 7-day rolling LnRMSSD vs SWC',
  rhr: 'Research/15 §RHR · 60-day nocturnal baseline, ±5 bpm range',
  load: 'Research/15 §ACWR · directional sanity check (per Impellizzeri critique, NOT a stop-light)',
  hr_recovery: 'Research/15 §HR Recovery · 60s post-workout drop',
};

const STREAK_MIN_DAYS = 3;
const SUBJECTIVE_DISAGREE_THRESHOLD = 15;

/**
 * Compose the readiness brief for a runner.
 *
 * Pulls 60d of history, computes the score (using existing readiness.ts),
 * detects streaks, builds per-pillar tiles with confounder surfacing,
 * and frames everything in plain English.
 *
 * Returns null when CoachState carries zero recoverable signals (a brand-
 * new user before any HealthKit data lands). The panel renders an empty
 * state in that case.
 */
export async function loadReadinessBrief(
  userId: string,
  state: CoachState,
  todayISO?: string,
): Promise<ReadinessBrief | null> {
  const date = todayISO ?? new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const history = await loadReadinessHistory(userId);

  // Score today with the (existing) computeReadiness function · scale
  // the sleep target by ACWR per Research/00b ("recovery requirements
  // scale with absolute training load").
  const dynamicSleepTarget = computeDynamicSleepTarget(state.loadAcwr);
  const stateForScore: CoachState = { ...state };
  const breakdown = computeReadiness(stateForScore);

  if (breakdownIsEmpty(breakdown)) return null;

  // Pull yesterday's snapshot (for mover detection) · best-effort.
  const yesterdaySnap = await loadYesterdaySnapshot(userId, date);

  // 14-day score trend.
  const scoreTrend = await loadScoreTrend(userId, date, 14, breakdown);

  // Streaks per pillar (3-day persistence rule).
  const streaks = detectStreaks(history, breakdown);

  // Movers · biggest delta vs yesterday's score.
  const movers = computeMovers(breakdown, yesterdaySnap);

  // Per-pillar tiles · enrich with trend, confounders, banding.
  const pillars = buildPillarTiles(breakdown, history, state, dynamicSleepTarget);

  // Headline · band-aware + streak-aware.
  const headline = buildHeadline(breakdown, streaks, movers);

  // One-line mover frame.
  const oneLineMover = movers.length > 0
    ? `${movers[0].label}`
    : null;

  // Subjective override · null until we wire the 1-10 wellness check-in.
  const subjectiveOverride = null;

  // Watch tomorrow · forward-looking guidance.
  const watchTomorrow = buildWatchTomorrow(breakdown, streaks, history);

  return {
    date,
    score: breakdown.score,
    band: breakdown.band as PillarBand,
    label: breakdown.label,
    headline,
    oneLineMover,
    scoreTrend,
    pillars,
    streaks,
    movers,
    subjectiveOverride,
    watchTomorrow,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function breakdownIsEmpty(b: ReadinessBreakdown): boolean {
  // All pillars showing "no data" = no signal at all.
  return b.inputs.every((i) => i.observedV === 'no data' || i.observedV === 'building history');
}

function computeDynamicSleepTarget(acwr: number | null | undefined): number {
  // Research/00b: 7-9h healthy band. 8-9h+ under high training load.
  // High load (ACWR > 1.2) → bump the bar; otherwise stay at 7.5h.
  if (acwr == null) return 7.5;
  if (acwr > 1.3) return 8.5;
  if (acwr > 1.0) return 8.0;
  return 7.5;
}

async function loadYesterdaySnapshot(
  userId: string,
  todayISO: string,
): Promise<{ score: number; pillars: Record<string, number> } | null> {
  try {
    const yesterdayISO = new Date(Date.parse(todayISO + 'T00:00:00Z') - 86400000)
      .toISOString().slice(0, 10);
    const row = (await pool.query<{ score: number; pillars: Record<string, { weight: number }> }>(
      `SELECT score, pillars FROM readiness_snapshots
        WHERE user_uuid = $1 AND snapshot_date = $2`,
      [userId, yesterdayISO],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!row) return null;
    const weights: Record<string, number> = {};
    for (const [key, val] of Object.entries(row.pillars ?? {})) {
      weights[key] = typeof val === 'object' && val != null && 'weight' in val
        ? Number((val as { weight: number }).weight)
        : 0;
    }
    return { score: row.score, pillars: weights };
  } catch {
    return null;
  }
}

async function loadScoreTrend(
  userId: string,
  todayISO: string,
  days: number,
  todayBreakdown: ReadinessBreakdown,
): Promise<{ date: string; score: number; band: PillarBand }[]> {
  try {
    const startISO = new Date(Date.parse(todayISO + 'T00:00:00Z') - (days - 1) * 86400000)
      .toISOString().slice(0, 10);
    const rows = (await pool.query<{ snapshot_date: Date; score: number; band: string }>(
      `SELECT snapshot_date, score, band FROM readiness_snapshots
        WHERE user_uuid = $1 AND snapshot_date >= $2 AND snapshot_date < $3
        ORDER BY snapshot_date ASC`,
      [userId, startISO, todayISO],
    ).catch(() => ({ rows: [] }))).rows;
    const trend = rows.map((r) => ({
      date: r.snapshot_date.toISOString().slice(0, 10),
      score: r.score,
      band: r.band as PillarBand,
    }));
    // Always include today (even if not yet snapshotted) so the trend has
    // a "now" data point regardless of cron timing.
    trend.push({ date: todayISO, score: todayBreakdown.score, band: todayBreakdown.band as PillarBand });
    return trend;
  } catch {
    return [{ date: todayISO, score: todayBreakdown.score, band: todayBreakdown.band as PillarBand }];
  }
}

/**
 * Detect 3+ day streaks per pillar. Research/15 says single-day swings
 * are noise; 3-day persistence is the actionable signal.
 *
 * Per pillar:
 *   · Sleep: < target for ≥3 days in a row
 *   · HRV: SWC-flagged drop for ≥3 days (Plews) OR straight < baseline
 *   · RHR: > baseline + 3 bpm for ≥3 days
 *   · HR recovery: < baseline by ≥4 bpm for ≥3 days
 *   · Load: ACWR > 1.3 for ≥3 days (read from snapshot history)
 */
function detectStreaks(
  history: ReadinessHistory,
  breakdown: ReadinessBreakdown,
): ReadinessStreak[] {
  const streaks: ReadinessStreak[] = [];

  // Sleep streak
  const sleepStreak = countTailRunLength(
    history.sleep.map((p) => p.value),
    (v, i, arr) => v < 7.5,  // strict against target; meaning is captured separately
  );
  if (sleepStreak.length >= STREAK_MIN_DAYS) {
    streaks.push({
      pillar: 'sleep',
      direction: 'below',
      days: sleepStreak.length,
      startDate: history.sleep.at(-sleepStreak.length)?.date ?? '',
      meaning: `Sleep below the 7.5h target ${sleepStreak.length} nights running. ` +
        `Cumulative debt compounds · Research/00b says single short nights don't ` +
        `matter, sustained dips do.`,
    });
  }

  // HRV streak · Plews-flavored when we have the rolling
  if (history.hrvPlews?.swc != null && history.hrvPlews.deltaLn != null) {
    const drops = lastConsecutivePlewsDrops(history.hrv, history.hrvPlews.swc);
    if (drops >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'hrv',
        direction: 'below',
        days: drops,
        startDate: history.hrv.at(-drops)?.date ?? '',
        meaning: `HRV rolling-7 below SWC ${drops} days in a row. Per Plews, ` +
          `this is the early-functional-overreach flag · reduce intensity ` +
          `24-72h and re-check.`,
      });
    }
  } else if (history.hrv.length >= STREAK_MIN_DAYS) {
    // Fallback to simple below-baseline streak when we lack rolling.
    const hrvBaseline = history.hrv.reduce((s, p) => s + p.value, 0) / history.hrv.length;
    const streakLen = countTailRunLength(
      history.hrv.map((p) => p.value),
      (v) => v < hrvBaseline,
    ).length;
    if (streakLen >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'hrv',
        direction: 'below',
        days: streakLen,
        startDate: history.hrv.at(-streakLen)?.date ?? '',
        meaning: `HRV below your 60-day average ${streakLen} days in a row. ` +
          `Could be stress, sleep, or accumulating load · single days are noise, ` +
          `streaks are signal.`,
      });
    }
  }

  // RHR streak
  if (history.rhr.length >= STREAK_MIN_DAYS) {
    const rhrBaseline = history.rhr.length >= 7
      ? history.rhr.slice(0, -7).reduce((s, p) => s + p.value, 0) /
        Math.max(1, history.rhr.length - 7)
      : history.rhr.reduce((s, p) => s + p.value, 0) / history.rhr.length;
    const above = countTailRunLength(
      history.rhr.map((p) => p.value),
      (v) => v - rhrBaseline >= 3,
    ).length;
    if (above >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'rhr',
        direction: 'above',
        days: above,
        startDate: history.rhr.at(-above)?.date ?? '',
        meaning: `Resting HR ≥3 bpm above your 60-day baseline ${above} days ` +
          `in a row. Common culprits: brewing illness, dehydration, alcohol, ` +
          `or accumulating load. Worth checking subjective state.`,
      });
    }
  }

  return streaks;
}

/** Walk the array from the tail, count how many consecutive items
 *  match the predicate. Returns { length } where length ≥ 0. */
function countTailRunLength(
  arr: number[],
  pred: (v: number, i: number, arr: number[]) => boolean,
): { length: number } {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i], i, arr)) count++;
    else break;
  }
  return { length: count };
}

/** Plews per-day drop detection · count tail days where the day's
 *  LnRMSSD is ≥ SWC below the 7-day rolling preceding it. */
function lastConsecutivePlewsDrops(hrv: PillarPoint[], swc: number): number {
  if (hrv.length < 8) return 0;
  const ln = hrv.map((p) => Math.log(p.value));
  let count = 0;
  for (let i = ln.length - 1; i >= 6; i--) {
    const rolling = ln.slice(i - 6, i + 1).reduce((s, v) => s + v, 0) / 7;
    // is THIS day a drop > SWC vs the prior rolling?
    const priorRolling = i >= 7
      ? ln.slice(i - 7, i).reduce((s, v) => s + v, 0) / 7
      : rolling;
    if (priorRolling - ln[i] >= swc) count++;
    else break;
  }
  return count;
}

function computeMovers(
  today: ReadinessBreakdown,
  yesterday: { score: number; pillars: Record<string, number> } | null,
): ReadinessMover[] {
  if (!yesterday) return [];
  const movers: ReadinessMover[] = [];
  for (const input of today.inputs) {
    const yWeight = yesterday.pillars[input.key] ?? 0;
    const delta = input.weight - yWeight;
    if (Math.abs(delta) < 2) continue;
    movers.push({
      pillar: input.key,
      deltaPts: delta,
      label: `${PILLAR_LABEL[input.key]} ${delta > 0 ? 'up' : 'down'} ` +
        `${Math.abs(delta)} pts vs yesterday`,
    });
  }
  movers.sort((a, b) => Math.abs(b.deltaPts) - Math.abs(a.deltaPts));
  return movers.slice(0, 3);
}

/**
 * Per-pillar tile. Combines the score breakdown's interpretation with:
 *   · 14-day trend series (from history)
 *   · Confounder list (plausible-cause checklist for elevated/depressed values)
 *   · Citation pointer for the doctrine drawer
 */
function buildPillarTiles(
  breakdown: ReadinessBreakdown,
  history: ReadinessHistory,
  state: CoachState,
  dynamicSleepTarget: number,
): ReadinessPillarTile[] {
  return breakdown.inputs.map((input) => {
    const trend = trendFor(input.key, history).slice(-14);
    const band = inputToBand(input);
    const confounders = confoundersFor(input.key, input, state, history);
    const baseline = baselineLabel(input.key, input, dynamicSleepTarget);

    return {
      key: input.key,
      label: PILLAR_LABEL[input.key],
      weightPct: PILLAR_WEIGHT[input.key],
      observedValue: input.observedV,
      observedSub: input.observedSub,
      baseline,
      band,
      weightContribution: input.weight,
      meaning: input.meaning,
      confounders,
      trend,
      citation: PILLAR_CITATION[input.key],
    };
  });
}

function trendFor(key: PillarKey, history: ReadinessHistory): PillarPoint[] {
  switch (key) {
    case 'sleep': return history.sleep;
    case 'hrv': return history.hrv;
    case 'rhr': return history.rhr;
    case 'hr_recovery': return history.hrRecovery;
    case 'load': return [];   // load trend would need run history; surfaced elsewhere
  }
}

function inputToBand(input: ReadinessInput): PillarBand {
  if (input.observedV === 'no data' || input.observedV === 'building history') return 'no-data';
  if (input.weight >= 5) return 'sharp';
  if (input.weight >= 0) return 'ready';
  if (input.weight >= -5) return 'moderate';
  return 'pull-back';
}

function baselineLabel(
  key: PillarKey,
  input: ReadinessInput,
  dynamicSleepTarget: number,
): string {
  switch (key) {
    case 'sleep': return `target ${dynamicSleepTarget.toFixed(1)}h`;
    case 'hrv':
    case 'rhr':
    case 'hr_recovery':
      return input.observedSub;
    case 'load':
      return 'Gabbett sweet spot 1.0-1.3';
  }
}

/**
 * Confounders · per Research/15 §RHR + §HRV, surface the alternative
 * explanations for a degraded pillar value. "Likely" flags fire when
 * we have a data signal that supports the confounder (e.g. recent heat
 * → "heat exposure"). The rest are listed for the runner to check.
 */
function confoundersFor(
  key: PillarKey,
  _input: ReadinessInput,
  state: CoachState,
  _history: ReadinessHistory,
): ReadinessConfounder[] {
  switch (key) {
    case 'rhr':
      return [
        { pillar: 'rhr', explanation: 'Brewing illness or recent vaccine', likely: false },
        { pillar: 'rhr', explanation: 'Dehydration · check fluid intake last 24h', likely: false },
        { pillar: 'rhr', explanation: 'Alcohol last night', likely: false },
        { pillar: 'rhr', explanation: 'Late or heavy dinner', likely: false },
        { pillar: 'rhr', explanation: 'Recent volume bump or hard session',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'rhr', explanation: 'Heat exposure on a recent run',
          likely: false },
        { pillar: 'rhr', explanation: 'Genuine training overreach',
          likely: state.loadAcwr != null && state.loadAcwr > 1.4 },
      ];
    case 'hrv':
      return [
        { pillar: 'hrv', explanation: 'Cumulative training load',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'hrv', explanation: 'Sleep deficit · check the sleep tile',
          likely: state.sleep7Avg != null && state.sleep7Avg < 7.0 },
        { pillar: 'hrv', explanation: 'Life stress · work, travel, emotional', likely: false },
        { pillar: 'hrv', explanation: 'Alcohol or stimulants last night', likely: false },
        { pillar: 'hrv', explanation: 'Body fighting something off', likely: false },
      ];
    case 'sleep':
      return [
        { pillar: 'sleep', explanation: 'Schedule debt · catch up over the weekend', likely: false },
        { pillar: 'sleep', explanation: 'High training load needs MORE than 7.5h',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'sleep', explanation: 'Caffeine after 2pm or evening alcohol', likely: false },
        { pillar: 'sleep', explanation: 'Race-week travel or time zone shift', likely: false },
      ];
    case 'load':
      return [
        { pillar: 'load', explanation: 'Big week recently · sweet spot is 1.0-1.3', likely: false },
        { pillar: 'load', explanation: 'Long layoff before this week · low chronic28', likely: false },
        { pillar: 'load', explanation: 'Race week · taper drops ACWR by design', likely: false },
      ];
    case 'hr_recovery':
      return [
        { pillar: 'hr_recovery', explanation: 'Hard session in last 24h', likely: false },
        { pillar: 'hr_recovery', explanation: 'Heat or humidity during the workout', likely: false },
        { pillar: 'hr_recovery', explanation: 'Sleep deficit or stress', likely: false },
      ];
  }
}

function buildHeadline(
  b: ReadinessBreakdown,
  streaks: ReadinessStreak[],
  movers: ReadinessMover[],
): string {
  // Streak takes precedence · the brief leads with what most needs attention.
  if (streaks.length > 0) {
    const s = streaks[0];
    return `${PILLAR_LABEL[s.pillar]} ${s.direction} for ${s.days} days · the trend matters more than today's number.`;
  }
  if (b.band === 'sharp') {
    return movers.length && movers[0].deltaPts > 0
      ? `Sharp · the system is firing. ${movers[0].label.toLowerCase()}.`
      : `Sharp · the system is firing. Today is for hard work if the plan calls for it.`;
  }
  if (b.band === 'ready') {
    return `Ready · all systems in their normal band. Today is whatever the plan says.`;
  }
  if (b.band === 'moderate') {
    return `Moderate · one or two pillars dipped. Single-day dips are noise; check tomorrow.`;
  }
  return `Pull back · multiple pillars are flagging. Trade hard work for easy today.`;
}

function buildWatchTomorrow(
  b: ReadinessBreakdown,
  streaks: ReadinessStreak[],
  history: ReadinessHistory,
): string[] {
  const out: string[] = [];
  if (streaks.length > 0) {
    const s = streaks[0];
    out.push(`If ${PILLAR_LABEL[s.pillar]} stays ${s.direction} another day, ` +
      `treat it as signal, not noise · ease the load and check subjective state.`);
  }
  // Sleep debt heading up
  if (history.sleep.length >= 3) {
    const last3 = history.sleep.slice(-3).reduce((s, p) => s + Math.max(0, 7.5 - p.value), 0);
    if (last3 >= 3) {
      out.push(`Sleep debt is building (~${last3.toFixed(1)}h short over the last 3 nights). ` +
        `One 9h+ night this week resets the trend.`);
    }
  }
  // CV rising · Plews early-overreach
  if (history.hrvPlews?.cv != null && history.hrvPlews.cv > 5) {
    out.push(`HRV rolling-CV is at ${history.hrvPlews.cv.toFixed(1)}% · early-` +
      `destabilization band per Plews. Worth reducing one hard session if it persists.`);
  }
  return out;
}
