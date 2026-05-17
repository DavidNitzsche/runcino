/**
 * Synthetic 14-week plan generator — deterministic, doctrine-grounded.
 *
 * This is the same plan structure that designs/faff-store.js buildPlan()
 * produces in the v4 mockups, ported to TypeScript so server components
 * can render plan-driven pages (overview, training) from day 1 even
 * before a real DB-backed plan exists.
 *
 * Once a real per-user plan lives in training_plans + plan_workouts,
 * the page should switch to query that instead. This is the fallback
 * + the design-mockup ground truth.
 *
 * Authority: designs/faff-store.js + Research/00a-distance-running-training.md
 * §"Volume Guidelines by Experience and Distance".
 */

export type PlanPhase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK';

export interface PlanWeekDay {
  dow: string;            // 'Mon' | 'Tue' | …
  date: string;           // YYYY-MM-DD
  type: 'easy' | 'recovery' | 'long' | 'quality' | 'race' | 'rest';
  label: string;          // human-readable workout name
  distanceMi: number;
  isRest?: boolean;
  hasStrength?: boolean;
}

export interface PlanWeek {
  weekNum: number;        // 1..14
  startDate: string;
  endDate: string;
  phase: PlanPhase;
  plannedMi: number;
  days: PlanWeekDay[];
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TEMPLATE: ([string, string, number, boolean?] | null)[][] = [
  // BASE — 4 weeks
  [['recovery','Recovery',5.5],['quality','Threshold · Cruise Intervals',7],['easy','Easy + Strides',5.5],['easy','Easy',5.5,true],['easy','Easy',5.5,true],null,['long','Long',10.5]],
  [['recovery','Recovery',5.5],['quality','Threshold · Cruise Intervals',7.5],['easy','Easy + Strides',5.5],['easy','Easy',5.5,true],['easy','Hill Strides',5.5,true],null,['long','Long',11]],
  [['recovery','Recovery',4.5],['quality','Threshold · Cruise Intervals',6],['easy','Easy + Strides',4.5],['easy','Easy',4.5,true],['easy','Easy',4.5,true],null,['long','Long',11.5]],
  [['recovery','Recovery',6],['quality','Threshold · Cruise Intervals',8],['easy','Easy + Strides',6],['easy','Easy',6,true],['easy','Hill Strides',6,true],null,['long','Long',12]],
  // BUILD — 4 weeks
  [['easy','Easy',6.5,true],['quality','Threshold · HM Blocks',7.5],['easy','Easy',6.5],['quality','Intervals',6],['easy','Easy',6.5,true],null,['long','Long Run · HM Finish',12.5]],
  [['easy','Easy',5,true],['quality','Threshold · HM Cruise',6.5],['easy','Easy',5],['quality','Intervals',5],['easy','Easy',5,true],null,['long','Long',11.5]],
  [['easy','Easy',7,true],['quality','Threshold · HM Blocks',8],['easy','Easy',7],['quality','Intervals',6],['easy','Easy',7,true],null,['long','Long Run · HM Finish',13]],
  [['easy','Easy',7,true],['quality','Threshold · HM Cruise',8.5],['easy','Easy',7],['quality','Intervals',6.5],['easy','Easy',7,true],null,['long','Long Run · Progression',13.5]],
  // PEAK — 4 weeks
  [['easy','Easy',6,true],['quality','Threshold · HM Tempo',7],['easy','Easy',6],['quality','Intervals',5.5],['easy','Easy',6,true],null,['long','Long',11.5]],
  [['easy','Easy',7.5,true],['quality','Threshold · HM Tempo',9],['easy','Easy',7.5],['quality','Intervals',7],['easy','Easy',7.5,true],null,['long','Long Run · Progression',14]],
  [['easy','Easy',7.5,true],['quality','Threshold · HM Tempo',9],['easy','Easy',7.5],['quality','Intervals',7],['easy','Easy',7.5,true],null,['long','Long Run · HM Finish',14.5]],
  [['easy','Easy',8,true],['quality','Threshold · HM Tempo',9.5],['easy','Easy',8],['quality','Intervals',7],['easy','Easy',8,true],null,['long','Long Run · Progression',15]],
  // TAPER — 1 week
  [['easy','Easy',5.5],['quality','Threshold Touch',5],['easy','Easy',5.5],['easy','Easy',5.5,true],['easy','Easy',5.5],null,['long','Long Run · Taper',7.5]],
  // RACE WEEK — 1 week
  [['easy','Easy',5],['quality','Threshold · Race Week Tune',4],['easy','Easy',5],null,null,['easy','Shake-out',3],['race','AFC Half',13.1]],
];

function isoAdd(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function phaseFor(weekNum: number): PlanPhase {
  if (weekNum <= 4)  return 'BASE';
  if (weekNum <= 8)  return 'BUILD';
  if (weekNum <= 12) return 'PEAK';
  if (weekNum === 13) return 'TAPER';
  return 'RACE_WEEK';
}

export function buildSyntheticPlan(startDate = '2026-05-11'): PlanWeek[] {
  return TEMPLATE.map((dayTpl, wIdx) => {
    const weekNum = wIdx + 1;
    const wkStart = isoAdd(startDate, wIdx * 7);
    const days: PlanWeekDay[] = dayTpl.map((t, dIdx) => {
      const date = isoAdd(wkStart, dIdx);
      const dow = DOW[dIdx];
      if (!t) return { dow, date, type: 'rest', label: 'Rest', distanceMi: 0, isRest: true };
      const [type, label, distanceMi, hasStrength] = t;
      return { dow, date, type: type as PlanWeekDay['type'], label, distanceMi, hasStrength: !!hasStrength };
    });
    const plannedMi = Math.round(days.reduce((s, d) => s + (d.distanceMi || 0), 0) * 10) / 10;
    return { weekNum, phase: phaseFor(weekNum), startDate: wkStart, endDate: isoAdd(wkStart, 6), plannedMi, days };
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z');
  const b = new Date(toISO + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShortDate(iso: string): string {
  return `${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${parseInt(iso.slice(8, 10), 10)}`;
}

export function findCurrentWeek(weeks: PlanWeek[], today = todayISO()): PlanWeek {
  return weeks.find((w) => w.days.some((d) => d.date === today)) ?? weeks[0];
}

export function findTodayWorkout(weeks: PlanWeek[], today = todayISO()): PlanWeekDay | null {
  for (const w of weeks) {
    const d = w.days.find((d) => d.date === today);
    if (d) return d;
  }
  return null;
}
