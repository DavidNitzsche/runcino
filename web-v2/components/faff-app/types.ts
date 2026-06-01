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
  user: {
    name: string; city: string; initial: string; pro: boolean;
    // 2026-05-30: real profile fields surfaced for Profile view rows so
    // they don't render hardcoded "Runner" / "renews Dec" strings.
    experienceLevel: string | null;   // 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus'
    subscriptionLabel: string;        // honest single-user-beta default until billing is wired
  };

  // today's view
  week: PlannedDay[];              // 7 days, mon..sun
  todayIdx: number;                // index of "today" in week
  results: Record<number, CompletedRun | undefined>; // by week idx
  readiness: Readiness;
  goalRace: GoalRace | null;
  volumeBars: VolumeBar[];         // 8-week strip
  thisWeekMiles: number;
  weeklyAvg: number;
  form: { fitness: number; fatigue: number; delta: number; label: string; acwr: number | null };

  // train view (26-week plan)
  season: {
    nowIdx: number;
    raceIdx: number;
    miles: number[];   // length = raceIdx (e.g. 26 weeks of mileage)
    maxMi: number;
    /** Real plan_phases rows from training-state. Drives the TrainView's
     *  ramp phase axis + phase-breakdown grid so a 13-week half marathon
     *  plan shows BASE+BUILD (or whatever the plan-builder actually
     *  authored) instead of being shoehorned into BASE/BUILD/PEAK/TAPER. */
    phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>;
    /** Per-week real plan workouts so non-current weeks render the real
     *  plan instead of phase-template fluff. */
    weekDays: Array<Array<{
      /** plan_workouts.id — joins to coach_intents.field for adaptations. */
      id?: string;
      dow: string;          // MON / TUE / ...
      type: import('./constants').EffortKey;
      name: string;
      mi: number;
      paceSec: number | null;
      done: boolean;
      activityId?: string | null;
      /** Actual pace from the matched Strava activity (s/mi). Used by
       *  TrainView's KEY WORKOUTS list to render hit/miss tags. */
      donePaceSec?: number | null;
      doneAvgHr?: number | null;
      /** Per-mile splits — used to extract work-segment pace for quality
       *  workouts (intervals / tempo / threshold) so the influence
       *  comparison isn't burying the rep pace under warmup/recovery miles. */
      doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
    }>>;
    /** Closed-loop plan adaptations from coach_intents (P1 #8 — written by
     *  applyAdaptations whenever a readiness/volume signal forced a plan
     *  mutation). TrainView's KEY WORKOUTS list cross-references these so
     *  the runner can see what each DONE quality day triggered. */
    adaptations: Array<{
      workoutId: string;        // plan_workouts.id that was modified
      weekIdx: number;          // resolved from the workout's date
      kind: 'reschedule' | 'downgrade' | 'shave' | 'mark_dirty' | 'other';
      newType?: string;
      newDate?: string;
      shaveFraction?: number;
      why: string;              // the trigger reason (from value.why)
      ts: string;               // when the adapt was applied (ISO)
    }>;
  };

  // health view
  health: HealthSnapshot;

  // targets view
  prs: PR[];
  races: RaceLite[];
  // 2026-05-31: projection trend for the goal race's distance — daily
  // snapshots from projection_snapshots written by the 00:30 cron. Empty
  // array when no goal race / no snapshots recorded yet. Oldest -> newest.
  projectionTrend: Array<{ date: string; projectionSec: number | null; vdot: number | null }>;

  // activity ranges
  activity: ActivityData;

  // profile
  shoes: ShoeRec[];
  // 2026-05-30: today's per-day shoe assignment from day_actions (action='shoe').
  // Server-persisted via /api/today/shoe. If unset, the ShoePicker falls back
  // to the coach recommendation in shoeRecByType (lib/shoe/recommend.ts).
  todayShoeId: number | null;
  // Coach-system shoe recommendation per effort type, computed from the
  // runner's actual garage via recommendShoe(shoes, runType). Empty string
  // when no shoe is tagged for that type — caller falls back to KIT[type]
  // static placeholder.
  shoeRecByType: Record<string, string>;
  connections: ConnectionRow[];

  // 2026-05-31: pending coach_proposals (injury_adjust / illness_adjust)
  // rendered as accept/decline cards on Today. Empty when no proposals
  // are pending. POST targets are /api/coach/proposal/[id]/{accept,decline}.
  pendingProposals: Array<{
    id: number;
    proposal_type: string;
    reason: string;
    suggested: string;
    evidence: Record<string, unknown>;
    created_at: string;
  }>;
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
  // 2026-05-31: numeric distance for projection-trend lookups against
  // projection_snapshots (which keys by distance_mi). Null when the goal
  // race row hasn't been resolved to a real distance yet.
  distanceMi: number | null;
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
export type ConnectionRow = { id: string; nm: string; sub: string; bg: string; gl: string; on: boolean; lastSyncIso?: string | null };
export type { ViewKey, EffortKey, PlannedDay, CompletedRun };
