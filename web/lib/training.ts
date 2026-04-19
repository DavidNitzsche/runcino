/**
 * Training-plan generator (rule-based).
 *
 * Generates a periodized marathon build (base → build → peak → taper)
 * given a goal race, a baseline fitness marker, and a target peak
 * weekly mileage. Produces daily workouts that can be rendered in the
 * UI today and compiled to WorkoutKit CustomWorkouts tomorrow.
 *
 * Deterministic by design — swappable for Claude-authored plans later.
 * The schema (TrainingBlock, WeekPlan, DayWorkout) is the contract;
 * the engine behind `generateBlock` is the pluggable part.
 *
 * Coaching philosophy: loosely Pfitzinger — mid-week quality, long
 * Saturday, Sunday as the recovery or supporting easy run. Customize
 * by changing WEEKLY_STRUCTURE or PHASE_RATIOS.
 */

export type WorkoutKind =
  | 'easy'
  | 'recovery'
  | 'tempo'
  | 'intervals'
  | 'long'
  | 'long_hilly'
  | 'strides'
  | 'rest';

export type PhaseLabel = 'base' | 'build' | 'peak' | 'taper';

export interface DayWorkout {
  /** ISO date string, YYYY-MM-DD */
  date: string;
  dow: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  kind: WorkoutKind;
  /** User-readable title */
  label: string;
  /** Short descriptive line, one line */
  summary: string;
  distanceMi: number;
  /** Target pace in seconds per mile (null for rest) */
  targetPaceSPerMi: number | null;
  /** Target HR zone label (Z1..Z5 or null) */
  targetHrZone: string | null;
  /** Human-readable rationale — 1-2 sentences */
  rationale: string;
}

export interface WeekPlan {
  weekNumber: number;
  phase: PhaseLabel;
  startDate: string;           // ISO
  totalDistanceMi: number;
  days: DayWorkout[];
  /** One-line narrative summary */
  narrative: string;
}

export interface TrainingBlock {
  goalRace: string;
  goalDate: string;              // ISO
  weeksTotal: number;
  basePaceSPerMi: number;        // derived from baseline race
  peakMpw: number;
  philosophy: 'pfitz' | 'daniels' | 'hanson' | 'custom';
  weeks: WeekPlan[];
  /** Phase boundaries by week number (inclusive start) */
  phaseStarts: Record<PhaseLabel, number>;
}

export interface GenerateInput {
  goalRaceName: string;
  goalRaceDate: string;          // ISO YYYY-MM-DD
  weeksTotal?: number;           // default 18
  peakMpw?: number;              // default 50
  basePaceSPerMi: number;        // e.g. 480 (8:00/mi flat baseline)
  philosophy?: TrainingBlock['philosophy'];
  /** Is the goal race hilly? Adds hill emphasis in build/peak. */
  hilly?: boolean;
}

// —————————————————————————— Phase ratios ————————————————————————————

// How much of the total build each phase takes.
// Overridable per philosophy later.
const PHASE_RATIOS: Record<PhaseLabel, number> = {
  base: 0.33,
  build: 0.33,
  peak: 0.22,
  taper: 0.12,
};

// Mileage curve: multiplier of peakMpw for each week, normalized to a
// typical 18-week shape. Regenerated for any total weeks count.
function mileageCurve(weeksTotal: number): number[] {
  // Shape: starts at 0.60, climbs linearly to 1.00 at peak (just before
  // taper), drops to 0.60 through taper, finishes at 0.40 on race week.
  const curve: number[] = [];
  const taperWeeks = Math.round(weeksTotal * PHASE_RATIOS.taper);
  const buildWeeks = weeksTotal - taperWeeks;
  for (let w = 0; w < buildWeeks; w++) {
    curve.push(0.60 + 0.40 * (w / Math.max(buildWeeks - 1, 1)));
  }
  for (let w = 0; w < taperWeeks; w++) {
    // Taper: 0.80 → 0.40
    curve.push(0.80 - 0.40 * (w / Math.max(taperWeeks - 1, 1)));
  }
  return curve;
}

// ——————————————————— Weekly structure by phase —————————————————————

type WeeklyDaySpec = {
  dow: DayWorkout['dow'];
  kind: WorkoutKind;
  /** Proportion of weekly mileage (sums to ~1.0 across non-rest days) */
  share: number;
};

const WEEKLY_STRUCTURE: Record<PhaseLabel, WeeklyDaySpec[]> = {
  base: [
    { dow: 'Mon', kind: 'easy',     share: 0.13 },
    { dow: 'Tue', kind: 'easy',     share: 0.13 },
    { dow: 'Wed', kind: 'recovery', share: 0.08 },
    { dow: 'Thu', kind: 'easy',     share: 0.16 },
    { dow: 'Fri', kind: 'rest',     share: 0.00 },
    { dow: 'Sat', kind: 'long',     share: 0.35 },
    { dow: 'Sun', kind: 'easy',     share: 0.15 },
  ],
  build: [
    { dow: 'Mon', kind: 'easy',      share: 0.13 },
    { dow: 'Tue', kind: 'tempo',     share: 0.18 },
    { dow: 'Wed', kind: 'recovery',  share: 0.08 },
    { dow: 'Thu', kind: 'intervals', share: 0.16 },
    { dow: 'Fri', kind: 'easy',      share: 0.10 },
    { dow: 'Sat', kind: 'long',      share: 0.30 },
    { dow: 'Sun', kind: 'rest',      share: 0.00 },
  ],
  peak: [
    { dow: 'Mon', kind: 'easy',       share: 0.13 },
    { dow: 'Tue', kind: 'tempo',      share: 0.20 },
    { dow: 'Wed', kind: 'recovery',   share: 0.07 },
    { dow: 'Thu', kind: 'intervals',  share: 0.15 },
    { dow: 'Fri', kind: 'easy',       share: 0.10 },
    { dow: 'Sat', kind: 'long_hilly', share: 0.30 },
    { dow: 'Sun', kind: 'rest',       share: 0.00 },
  ],
  taper: [
    { dow: 'Mon', kind: 'easy',      share: 0.20 },
    { dow: 'Tue', kind: 'tempo',     share: 0.22 },
    { dow: 'Wed', kind: 'rest',      share: 0.00 },
    { dow: 'Thu', kind: 'strides',   share: 0.15 },
    { dow: 'Fri', kind: 'easy',      share: 0.10 },
    { dow: 'Sat', kind: 'long',      share: 0.20 },
    { dow: 'Sun', kind: 'rest',      share: 0.00 },
  ],
};

// —————————————————— Pace targets by workout kind ————————————————————

function paceFor(kind: WorkoutKind, basePace: number): number | null {
  // Pace offsets are in seconds per mile relative to baseline marathon
  // pace. Rough Pfitzinger-ish values.
  switch (kind) {
    case 'rest':      return null;
    case 'recovery':  return basePace + 120;  // +2:00/mi
    case 'easy':      return basePace + 75;   // +1:15/mi
    case 'long':      return basePace + 60;   // +1:00/mi
    case 'long_hilly':return basePace + 75;   // easier on hills
    case 'tempo':     return basePace - 15;   // −15 sec/mi (marathon+)
    case 'intervals': return basePace - 60;   // 5k-ish effort average
    case 'strides':   return basePace - 45;   // short fast reps
  }
}

function hrZoneFor(kind: WorkoutKind): string | null {
  switch (kind) {
    case 'rest':       return null;
    case 'recovery':   return 'Z1';
    case 'easy':       return 'Z2';
    case 'long':       return 'Z2-Z3';
    case 'long_hilly': return 'Z2-Z3';
    case 'tempo':      return 'Z3-Z4';
    case 'intervals':  return 'Z4';
    case 'strides':    return 'Z4';
  }
}

function labelFor(kind: WorkoutKind, miles: number): string {
  const m = Math.round(miles);
  switch (kind) {
    case 'rest':       return 'Rest';
    case 'recovery':   return `Recovery ${m}`;
    case 'easy':       return `Easy ${m}`;
    case 'long':       return `Long ${m}`;
    case 'long_hilly': return `Hilly long ${m}`;
    case 'tempo':      return `Tempo ${m}`;
    case 'intervals':  return `Intervals ${m}`;
    case 'strides':    return `Strides ${m}`;
  }
}

function summaryFor(kind: WorkoutKind, miles: number, targetPace: number | null): string {
  const paceStr = targetPace !== null
    ? `${Math.floor(targetPace / 60)}:${String(targetPace % 60).padStart(2, '0')}/mi`
    : '';
  switch (kind) {
    case 'rest':       return 'Complete rest or easy cross-train.';
    case 'recovery':   return `${miles.toFixed(1)} mi · ${paceStr} · keep HR low`;
    case 'easy':       return `${miles.toFixed(1)} mi · ${paceStr} · conversational`;
    case 'long':       return `${miles.toFixed(1)} mi · ${paceStr} · build endurance`;
    case 'long_hilly': return `${miles.toFixed(1)} mi · ${paceStr} · course-specific hills`;
    case 'tempo': {
      const work = Math.max(1, Math.round(miles * 0.6));
      return `${miles.toFixed(1)} mi total · ${work} mi at ${paceStr} tempo`;
    }
    case 'intervals': {
      const reps = Math.max(4, Math.min(8, Math.round(miles * 0.7)));
      return `${miles.toFixed(1)} mi total · ${reps} × 800m at ${paceStr}`;
    }
    case 'strides':    return `${miles.toFixed(1)} mi easy · 6 × 20s strides at ${paceStr}`;
  }
}

function rationaleFor(kind: WorkoutKind, phase: PhaseLabel, weekNum: number, totalWeeks: number): string {
  switch (kind) {
    case 'rest':
      return 'Recovery is training. Legs rebuild here.';
    case 'recovery':
      return 'Mid-week flush — super-easy blood flow, nothing more.';
    case 'easy':
      return phase === 'base'
        ? 'Aerobic volume. Build the mitochondrial base.'
        : 'Easy mileage to support the week\'s quality sessions.';
    case 'long':
      return phase === 'peak'
        ? 'Peak long. This is the one that says "you can do this."'
        : phase === 'taper'
          ? 'Race-simulation long. Shorter than peak — maintains feel.'
          : 'Classic long run. Aerobic capacity and mental durability.';
    case 'long_hilly':
      return 'Course-specific. Match the race profile for hills + descents.';
    case 'tempo':
      return phase === 'build'
        ? 'Lactate threshold work. Teaches the body to clear lactate at pace.'
        : 'Marathon-specific quality. Rehearse race effort.';
    case 'intervals':
      return phase === 'peak'
        ? 'VO2 max work. Sharpens the top end — short, fast, full recovery.'
        : 'Structured speed. Adds a gear above tempo.';
    case 'strides':
      return 'Neuromuscular polish. Keep the legs snappy without fatigue.';
  }
}

// ————————————————— Phase assignment by week number —————————————————

function phaseForWeek(weekNumber: number, weeksTotal: number): PhaseLabel {
  const basePct = PHASE_RATIOS.base;
  const buildPct = basePct + PHASE_RATIOS.build;
  const peakPct = buildPct + PHASE_RATIOS.peak;
  const pct = weekNumber / weeksTotal;
  if (pct < basePct) return 'base';
  if (pct < buildPct) return 'build';
  if (pct < peakPct) return 'peak';
  return 'taper';
}

function phaseStarts(weeksTotal: number): Record<PhaseLabel, number> {
  return {
    base:  1,
    build: Math.ceil(weeksTotal * PHASE_RATIOS.base) + 1,
    peak:  Math.ceil(weeksTotal * (PHASE_RATIOS.base + PHASE_RATIOS.build)) + 1,
    taper: Math.ceil(weeksTotal * (PHASE_RATIOS.base + PHASE_RATIOS.build + PHASE_RATIOS.peak)) + 1,
  };
}

// —————————————————————————— Date helpers ————————————————————————————

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeekBefore(raceDateISO: string, weeksBefore: number): string {
  // Race is assumed Sunday. Monday of the race-week is raceDate - 6.
  // Monday of weeksBefore = raceMonday - (weeksBefore * 7)
  const raceMonday = addDays(raceDateISO, -6);
  return addDays(raceMonday, -weeksBefore * 7);
}

function dowName(offset: number): DayWorkout['dow'] {
  return (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)[offset];
}

// ——————————————————————————— Engine ————————————————————————————————

export function generateWeek(
  weekNumber: number,
  block: Pick<TrainingBlock, 'weeksTotal' | 'peakMpw' | 'basePaceSPerMi' | 'goalDate'>,
  opts: { hilly?: boolean } = {}
): WeekPlan {
  const phase = phaseForWeek(weekNumber - 1, block.weeksTotal);
  const curve = mileageCurve(block.weeksTotal);
  const totalMiles = Math.round(block.peakMpw * curve[weekNumber - 1] * 10) / 10;

  const structure = WEEKLY_STRUCTURE[phase].map(spec => ({ ...spec }));
  // If the race is hilly and phase is build/peak, convert Saturday long
  // to long_hilly whenever it isn't already.
  if (opts.hilly && (phase === 'build' || phase === 'peak')) {
    for (const s of structure) {
      if (s.dow === 'Sat' && s.kind === 'long') s.kind = 'long_hilly';
    }
  }

  const weeksFromEnd = block.weeksTotal - weekNumber;
  const startDate = mondayOfWeekBefore(block.goalDate, weeksFromEnd);

  const days: DayWorkout[] = structure.map((spec, i) => {
    const miles = spec.kind === 'rest' ? 0 : Math.round(totalMiles * spec.share * 10) / 10;
    const targetPace = spec.kind === 'rest' ? null : paceFor(spec.kind, block.basePaceSPerMi);
    return {
      date: addDays(startDate, i),
      dow: dowName(i),
      kind: spec.kind,
      label: labelFor(spec.kind, miles),
      summary: summaryFor(spec.kind, miles, targetPace),
      distanceMi: miles,
      targetPaceSPerMi: targetPace,
      targetHrZone: hrZoneFor(spec.kind),
      rationale: rationaleFor(spec.kind, phase, weekNumber, block.weeksTotal),
    };
  });

  const narrative =
    phase === 'base'  ? `Base week ${weekNumber}. Aerobic volume — trust the easy days.` :
    phase === 'build' ? `Build week ${weekNumber}. First real quality work of the cycle.` :
    phase === 'peak'  ? `Peak week ${weekNumber}. Hardest of the cycle. After this, it's all downhill.` :
                        `Taper week ${weekNumber}. Volume drops; intensity stays. Protect the gains.`;

  return {
    weekNumber,
    phase,
    startDate,
    totalDistanceMi: Math.round(days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10,
    days,
    narrative,
  };
}

export function generateBlock(input: GenerateInput): TrainingBlock {
  const weeksTotal = input.weeksTotal ?? 18;
  const peakMpw = input.peakMpw ?? 50;
  const block: TrainingBlock = {
    goalRace: input.goalRaceName,
    goalDate: input.goalRaceDate,
    weeksTotal,
    basePaceSPerMi: input.basePaceSPerMi,
    peakMpw,
    philosophy: input.philosophy ?? 'pfitz',
    weeks: [],
    phaseStarts: phaseStarts(weeksTotal),
  };
  for (let w = 1; w <= weeksTotal; w++) {
    block.weeks.push(generateWeek(w, block, { hilly: input.hilly }));
  }
  return block;
}

/** Current week number given today's date and the block's goal date. */
export function currentWeekNumber(
  todayISO: string,
  block: Pick<TrainingBlock, 'weeksTotal' | 'goalDate'>
): number {
  const msPerDay = 86_400_000;
  const today = new Date(todayISO + 'T12:00:00Z').getTime();
  const goal = new Date(block.goalDate + 'T12:00:00Z').getTime();
  const daysRemaining = Math.round((goal - today) / msPerDay);
  const weeksRemaining = Math.ceil(daysRemaining / 7);
  const weekNumber = block.weeksTotal - weeksRemaining + 1;
  return Math.max(1, Math.min(block.weeksTotal, weekNumber));
}

/** Find the workout for a specific date. */
export function workoutForDate(
  block: TrainingBlock,
  dateISO: string
): { week: WeekPlan; day: DayWorkout } | null {
  for (const week of block.weeks) {
    const day = week.days.find(d => d.date === dateISO);
    if (day) return { week, day };
  }
  return null;
}
