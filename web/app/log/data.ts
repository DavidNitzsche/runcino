/**
 * /log · data wiring layer.
 *
 * Mirrors /health/data.ts. Every value rendered on the Log page resolves
 * to one of the helpers in this module. Real sources are wired where they
 * exist (Strava cache via /api/log); local-dev demo runs surface from the
 * route when Strava isn't synced.
 *
 * Shape is stable — when Coach.runRead() lands in Stage 7 only the bodies
 * of the helpers change. The page already renders against the wire shape.
 */

import type { CoachState } from '@/lib/coach-state';
import type {
  LogApiHeatCell,
  LogApiMonth,
  LogApiPr,
  LogApiRunRow,
  LogApiYearSummary,
} from '../api/log/route';

// Re-export wire shapes so /log/page.tsx imports from one module.
export type {
  LogApiHeatCell as HeatCell,
  LogApiMonth as MonthBar,
  LogApiPr as PrCard,
  LogApiRunRow as RunRow,
  LogApiYearSummary as YearSummary,
} from '../api/log/route';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface LogData {
  today: string;
  state: CoachState;
  yearSummary: LogApiYearSummary;
  yearHeat: LogApiHeatCell[];
  months: LogApiMonth[];
  prs: LogApiPr[];
  recentRuns: LogApiRunRow[];
  totalRunsYtd: number;
  peakMonthLabel: string | null;
  peakMonthMi: number;
  longestRunMi: number;
  longestRunName: string | null;
  /** Greet eyebrow string (top of page). */
  greetEyebrow: string;
  /** Greet sub-lede. */
  greetSub: string;
  /** Number of new PRs set this year (drives the shelf header pin). */
  newPrCount: number;
}

// ─────────────────────────────────────────────────────────────────────
// API payload
// ─────────────────────────────────────────────────────────────────────

interface LogApiOk {
  ok: true;
  today: string;
  state: CoachState;
  yearSummary: LogApiYearSummary;
  yearHeat: LogApiHeatCell[];
  months: LogApiMonth[];
  prs: LogApiPr[];
  recentRuns: LogApiRunRow[];
  totalRunsYtd: number;
  peakMonthLabel: string | null;
  peakMonthMi: number;
  longestRunMi: number;
  longestRunName: string | null;
}

interface LogApiErr {
  ok: false;
  error: string;
}

type LogApiPayload = LogApiOk | LogApiErr;

// ─────────────────────────────────────────────────────────────────────
// Single load entry point
// ─────────────────────────────────────────────────────────────────────

export async function loadLogData(): Promise<LogData> {
  const api = await fetchLogApi();
  if (!api.ok) throw new Error(api.error || 'log api not ok');

  const newPrCount = api.prs.filter((p) => p.isNew && p.timeDisplay != null).length;
  const { greetEyebrow, greetSub } = synthesizeGreetCopy(api);

  return {
    today: api.today,
    state: api.state,
    yearSummary: api.yearSummary,
    yearHeat: api.yearHeat,
    months: api.months,
    prs: api.prs,
    recentRuns: api.recentRuns,
    totalRunsYtd: api.totalRunsYtd,
    peakMonthLabel: api.peakMonthLabel,
    peakMonthMi: api.peakMonthMi,
    longestRunMi: api.longestRunMi,
    longestRunName: api.longestRunName,
    greetEyebrow,
    greetSub,
    newPrCount,
  };
}

async function fetchLogApi(): Promise<LogApiPayload> {
  try {
    const res = await fetch('/api/log', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/log ${res.status}`);
    return (await res.json()) as LogApiPayload;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Greet copy synthesis. Pulls from the year summary so the H1 / sub-lede
// always reflect the data on the page.
// ─────────────────────────────────────────────────────────────────────

function synthesizeGreetCopy(api: LogApiOk): { greetEyebrow: string; greetSub: string } {
  const y = api.yearSummary;
  const parts: string[] = [
    `${y.year}`,
    `${y.ytdMiles} MI`,
    `${y.ytdRuns} RUNS`,
    `${y.ytdDaysRun} DAYS`,
  ];
  if (y.ytdRaces > 0) parts.push(`${y.ytdRaces} RACES`);
  const greetEyebrow = parts.join(' · ');

  // Sub-lede: vs-last-year hook + peak month + longest run.
  const vsParts: string[] = [];
  if (y.vsLastYearMi !== 0) {
    vsParts.push(`${y.vsLastYearMi > 0 ? '+' : ''}${y.vsLastYearMi} mi vs same day ${y.year - 1}.`);
  }
  if (api.peakMonthLabel && api.peakMonthMi > 0) {
    const mo = api.peakMonthLabel.charAt(0) + api.peakMonthLabel.slice(1).toLowerCase();
    vsParts.push(`${mo} was a peak month at ${api.peakMonthMi} mi`);
  }
  if (api.longestRunMi > 0 && api.longestRunName) {
    vsParts.push(`longest run a ${api.longestRunName} at ${api.longestRunMi.toFixed(1)} mi.`);
  }
  const greetSub = vsParts.length > 0 ? vsParts.join(' · ') : 'Every run, recorded.';

  return { greetEyebrow, greetSub };
}

// ─────────────────────────────────────────────────────────────────────
// Formatters — shared between page + cards
// ─────────────────────────────────────────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "May 9" / "Apr 27" (short month name + day, no leading zeros). */
export function formatShortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** "1:32:00" / "8:42" — hh:mm:ss for >= 1h, m:ss otherwise. */
export function formatTime(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** "8:42/mi" — pace formatter, expects s/mi. */
export function formatPace(s: number): string {
  if (s <= 0) return '—';
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Topbar clock formatter — DOW · MON D · H:MM AM/PM. */
export function formatTopbarClock(d: Date): string {
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const hh = d.getHours();
  const mm = d.getMinutes();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${dows[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}
