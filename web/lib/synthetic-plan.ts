/**
 * Plan week-grid helpers + shared plan types.
 *
 * The synthetic/template plan generator that used to live here was removed —
 * the app renders only the real coach-generated plan (getCurrentPlan →
 * buildPlan, grounded in /Research). See lib/plan-weeks.ts (getRealPlanWeeks),
 * which is the single entry point every surface uses.
 *
 * What remains here is pure formatting/shaping: realPlanToWeeks() (turns the
 * persisted plan artifact into week rows), date helpers (todayISO, daysBetween,
 * isoAdd, fmtShortDate), timezone resolution, and findCurrentWeek/
 * findTodayWorkout. No fabricated plan data.
 *
 * NOTE: filename is legacy ("synthetic-plan") — there is nothing synthetic
 * left in it. Rename to plan-format.ts when convenient (touches many imports).
 */

export type PlanPhase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK';

export interface PlanWeekDay {
  dow: string;            // 'Mon' | 'Tue' | …
  date: string;           // YYYY-MM-DD
  /** Workout type. 'recovery' was rolled into 'easy' in 2026-05;
   *  the legacy literal stays in the union only so older saved
   *  payloads still type-check. Render code should treat it as easy. */
  type: 'easy' | 'long' | 'quality' | 'race' | 'rest' | 'recovery';
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

function isoAdd(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's date in the given timezone (YYYY-MM-DD).
 *
 * Without a timezone, the server defaults to UTC — which means at 6 PM
 * Sunday in LA, the page shows Monday because UTC is already 1 AM.
 * Pages should pass the user's tz (derived from their location) so
 * "today" matches what's on their wall clock.
 *
 * Default: America/Los_Angeles since that's the legacy owner's tz.
 * Will switch to a per-user `timezone` column once Edit Profile lands.
 */
export function todayISO(timezone = 'America/Los_Angeles'): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/** Infer a timezone from a user's location string. Best-effort. */
export function userTimezone(location?: string | null): string {
  if (!location) return 'America/Los_Angeles';
  const loc = location.toLowerCase();
  // US west
  if (/(los angeles|san francisco|seattle|portland|san diego|oakland|sacramento|las vegas)/.test(loc)) return 'America/Los_Angeles';
  // US mountain
  if (/(denver|phoenix|salt lake|albuquerque)/.test(loc)) return 'America/Denver';
  // US central
  if (/(chicago|austin|dallas|houston|minneapolis)/.test(loc)) return 'America/Chicago';
  // US east
  if (/(new york|boston|miami|atlanta|washington|philadelphia)/.test(loc)) return 'America/New_York';
  // UK / EU
  if (/(london|dublin|edinburgh)/.test(loc)) return 'Europe/London';
  if (/(paris|berlin|madrid|amsterdam)/.test(loc)) return 'Europe/Paris';
  return 'America/Los_Angeles';
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

// ─────────────────────────────────────────────────────────────────────
// Real-plan adapter
//
// Maps the persisted plan artifact (coach/plan-types `Plan`) into the
// PlanWeek[] shape the /overview page already renders, so the page can
// run off the runner's REAL plan instead of buildSyntheticPlan(). The
// day label is resolved the same way /api/overview does (describeKey
// FromPlan), keeping the web and the iPhone app in lockstep.
// ─────────────────────────────────────────────────────────────────────

/** Map the plan artifact's WorkoutType onto the PlanWeekDay union the
 *  page's render code understands. Quality variants collapse to
 *  'quality'; easy variants to 'easy'. */
function mapWorkoutType(t: string): PlanWeekDay['type'] {
  switch (t) {
    case 'long':              return 'long';
    case 'race':              return 'race';
    case 'rest':              return 'rest';
    case 'threshold':
    case 'interval':
    case 'mp':
    case 'race_week_tuneup':  return 'quality';
    default:                  return 'easy'; // easy / recovery / shakeout
  }
}

function mapPhaseLabel(label: string): PlanPhase {
  switch (label) {
    case 'BUILD':     return 'BUILD';
    case 'PEAK':      return 'PEAK';
    case 'TAPER':     return 'TAPER';
    case 'RACE_WEEK': return 'RACE_WEEK';
    default:          return 'BASE'; // BASE / MAINTENANCE / unknown
  }
}

/** Convert the persisted plan into the page's PlanWeek[] view model.
 *  `describeKey` is injected (the page passes describeKeyFromPlan) to
 *  avoid a static import cycle through workout-descriptions. */
export function realPlanToWeeks(
  plan: {
    phases: Array<{ id: string; label: string }>;
    weeks: Array<{
      weekStartISO: string;
      phaseId: string;
      workouts: Array<{ dateISO: string; type: string; distanceMi: number; subLabel?: string | null; hasStrength?: boolean }>;
    }>;
  },
  describeKey: (type: string, subLabel: string | null) => string,
): PlanWeek[] {
  const phaseById = new Map(plan.phases.map((p) => [p.id, p.label]));
  return plan.weeks.map((wk, i) => {
    const phase = mapPhaseLabel(phaseById.get(wk.phaseId) ?? 'BASE');
    const byDate = new Map(wk.workouts.map((w) => [w.dateISO, w]));
    const days: PlanWeekDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = isoAdd(wk.weekStartISO, d);
      const dow = DOW[d];
      const w = byDate.get(date);
      if (!w || w.type === 'rest' || w.distanceMi <= 0) {
        days.push({ dow, date, type: 'rest', label: 'Rest', distanceMi: 0, isRest: true });
      } else {
        days.push({
          dow,
          date,
          type: mapWorkoutType(w.type),
          label: describeKey(w.type, w.subLabel ?? null),
          distanceMi: w.distanceMi,
          hasStrength: !!w.hasStrength,
        });
      }
    }
    const plannedMi = Math.round(days.reduce((s, x) => s + (x.distanceMi || 0), 0) * 10) / 10;
    return {
      weekNum: i + 1,
      phase,
      startDate: wk.weekStartISO,
      endDate: isoAdd(wk.weekStartISO, 6),
      plannedMi,
      days,
    };
  });
}
