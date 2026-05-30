import type { EffortKey, PlannedDay, CompletedRun, ViewKey } from './constants';

export type DriverRow = { name: string; why: string; pct: number; pts: number; dir: 'pos'|'neg' };
export type Readiness = {
  score: number;
  label: string;        // PRIMED / TUNED / EASY ONLY etc.
  baseline: number;
  trend: number[];      // last 7 values 0..100
  trendDays: string[];  // ['THU',...,'WED']
  drivers: DriverRow[];
  coach: string;        // coach line
};

export type FaffSeed = {
  // top bar
  todayISO: string;
  topDate: string;          // "Wednesday, May 28"
  weekOf: string;           // "Week 14 of 26 · Build phase"
  // sidebar profile chip
  user: { name: string; city: string; initial: string; pro: boolean };

  // today's view
  week: PlannedDay[];              // 7 days, mon..sun
  todayIdx: number;                // index of "today" in week
  results: Record<number, CompletedRun | undefined>; // by week idx
  readiness: Readiness;
  goalRace: GoalRace | null;
  volumeBars: VolumeBar[];         // 8-week strip
  thisWeekMiles: number;
  weeklyAvg: number;
  form: { fitness: number; fatigue: number; delta: number; label: string };

  // train view (26-week plan)
  season: {
    nowIdx: number;
    raceIdx: number;
    miles: number[];   // length = raceIdx (e.g. 26 weeks of mileage)
    maxMi: number;
  };

  // health view
  health: HealthSnapshot;

  // targets view
  prs: PR[];
  races: RaceLite[];

  // activity ranges
  activity: ActivityData;

  // profile
  shoes: ShoeRec[];
  connections: ConnectionRow[];
};

export type GoalRace = {
  slug: string; name: string; date: string;     // ISO
  daysAway: number;
  goal: string;        // e.g. "1:30:00"
  projected: string;   // e.g. "1:29:45"
  onTrack: boolean;
  delta: string;       // e.g. "15 sec ahead"
  phaseLabel: string;  // "Build phase · wk 14 / 26"
  goalPct: number;     // 0..100 for progress bar
  location: string | null;  // e.g. "San Diego, CA"  — null if not on record
};
export type VolumeBar = { mi: number; label: string; current: boolean };
export type PR = { k: string; v: string; date: string };
export type RaceLite = { slug: string; name: string; meta: string; tag: 'GOAL'|'TUNE-UP'|'PAST'; days: string };

export type HealthSnapshot = {
  readiness: Readiness;
  body: HealthMetric[];
  form: HealthMetric[];
};
export type HealthMetric = {
  k: string;            // 'hrv', 'rhr', 'sleep', etc.
  label: string;        // 'HRV', 'RESTING HR'
  unit: string;
  current: number;
  target?: number;
  band?: [number, number];
  dom: [number, number];
  series: number[];     // 30 points
  status: 'good'|'warn'|'neutral';
  special?: 'balance';
  decimals?: number;
  clock?: boolean;
};

export type ActivityData = {
  ranges: Record<'month'|'year'|'all', ActivityRange>;
  recent: RecentRun[];
};
export type HeatCell = {
  lv: 0 | 1 | 2 | 3 | 4;          // bin: 0=rest, 1=<4mi, 2=<8mi, 3=<14mi, 4=14mi+
  date: string;                    // ISO YYYY-MM-DD
  mi: number;                      // total miles that day (0 = rest)
  label: string;                   // friendly label e.g. "12.0 mi · Tempo Run" or "Rest"
  runId?: string;                  // first run on that day (for click → modal)
};
export type ActivityRange = {
  eyebrow: string; big: string; sub: string;
  totals: [string,string][];
  volT: string; volS: string;
  vol: { l: string; v: number }[];
  mix: [string, string, number][];   // ['easy','Easy',48]
  recs: { k: string; v: string; c: string; t: string }[];
  heat: HeatCell[][];                // 18 cols × 7 rows
  heatLabels: string[];              // ['JAN','FEB','MAR','APR','MAY']
  facts: { i: string; v: string; c: string }[];
};
export type RecentRun = {
  date: string; effort: string; color: string;
  name: string; meta: string; badge?: 'NAILED IT'|'SOLID'|'LONGEST'|'PR';
  slug?: string;
};

export type ShoeRec = { id?: number; brand?: string; model?: string; nm: string; role: string; mi: number; max: number };
export type ConnectionRow = { id: string; nm: string; sub: string; bg: string; gl: string; on: boolean };
export type { ViewKey, EffortKey, PlannedDay, CompletedRun };
