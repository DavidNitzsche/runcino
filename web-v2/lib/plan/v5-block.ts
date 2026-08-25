/**
 * lib/plan/v5-block.ts — the iPhone v5 Block screen, `GET /api/v5/block`.
 *
 * Composes from the same loader `/api/training/state` uses
 * (`loadTrainingState`, `lib/coach/training-state.ts`): phase arc, all
 * sixteen weeks (not sampled), the panel's stats plate, and "so far in this
 * block". Two things training-state.ts did not carry that this screen needs
 * — a real `plan_weeks.id` per week (for `V5BlockWeek.id`, so a week row has
 * a server identity rather than a synthesised index) and
 * `is_quality`/`is_long`/`is_race_week`/`is_cutback` off the DB rather than a
 * type-string guess — were added there as plain additive SELECT columns
 * (2026-08-19), not duplicated here.
 *
 * Two things this module adds on top of that loader:
 *
 *   library    Gap B1. `lib/plan/workout-library.ts` `loadAllWorkouts()` is
 *              the workout catalogue that fed plan generation and had no
 *              HTTP door (`grep -rl "workout-library" app` was empty).
 *              Filtered to this runner's race distance + current phase, and
 *              to rows that carry a citation — a session with no citation
 *              does not go in the library (per the design contract).
 *
 *   scenarios  The change-the-plan sheet's five options, each with whether
 *              it is reachable RIGHT NOW, before the runner has picked
 *              scenario-specific parameters (which week, which day, which
 *              date range, which race). Reuses `proposeChange` and the
 *              `anotherRaceBlockGate` export from `lib/plan/replan-scenarios.ts`
 *              for the actual availability decision — this module picks
 *              reasonable representative arguments (the plan's own next
 *              future week, the runner's own rest day, a real
 *              rest-day-next-to-a-running-day pair) and asks the real
 *              function, rather than re-deriving any of its refusal rules.
 *              Travel is the one exception the design calls out explicitly:
 *              it is a date-range picker the runner has not touched yet, so
 *              its `available` here means only "is there a plan to change" —
 *              the real satisfiability check happens once the runner picks
 *              dates and `POST /api/plan/change` prices them.
 *
 * READ-ONLY. Every call into replan-scenarios.ts here is `proposeChange` or a
 * plain read (`loadPlanShape`, `anotherRaceBlockGate`) — never `applyChange`.
 * Nothing in this module writes a row.
 */
import { loadTrainingState, type TrainingState, type PlanWeek } from '@/lib/coach/training-state';
import { loadSettings } from '@/lib/coach/settings';
import { pool } from '@/lib/db/pool';
import { loadAllWorkouts, type PlanPhase as LibraryPhase } from '@/lib/plan/workout-library';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { distanceMiFromLabel } from '@/lib/race/distance';
// RACE-PREP-OPENS-1 · the Block screen asks the mode machine itself when the
// build opens, rather than re-deriving it from BUILD_WINDOW_WEEKS.
import { pickPlanMode } from '@/lib/plan/goal-tiers';
import {
  proposeChange,
  loadPlanShape,
  anotherRaceBlockGate,
  CHANGE_SCENARIOS,
  type ChangeScenario,
  type ChangeOutcome,
  type PlanShape,
} from '@/lib/plan/replan-scenarios';
// Reused rather than re-derived: the iPhone v5 Today calendar sheet (2026-08-20)
// needs the same title-case type word /today already computes per day
// ("Threshold" from sub_label "THRESHOLD", "Easy" from a bare type column).
// One authoring path for "what does this day's type read as", not two.
import { displayTypeFor } from '@/lib/faff/v5-today';

// ── small local formatters — presentation only, no doctrine here ───────────

const DOW_NUM: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function dateWords(iso: string): string {
  const parts = iso.split('-').map(Number);
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return `${d} ${MONTHS[m - 1]}`;
}

function fmtMi(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// RULE ONE. `modelled` used to default to `false` here, and not one of the
// eleven call sites below ever passed it — so the entire Block payload shipped
// "this is a hard read" by omission, decided by nobody. The phone's own
// decoder defaults an ABSENT `modelled` key to `true` for exactly that reason
// (over-marking is the safe failure); this helper inverted that at the server.
// The parameter is required now, so every number on this screen names a basis
// out loud. `scripts/check-modelled-mark.sh` guard 7 fails the build on a
// defaulted one.
function num(text: string, modelled: boolean) {
  return { text, modelled };
}

// ── panel ────────────────────────────────────────────────────────────────

export function buildPanel(state: TrainingState) {
  const current = state.weeks.find((w) => w.isCurrent) ?? null;
  const phaseLabel = state.currentPhase ?? current?.phase ?? 'BASE';

  let weekLine: string | null = null;
  if (state.race) {
    const weeksToRace = Math.max(0, Math.ceil(state.race.days_to_race / 7));
    weekLine = `${weeksToRace} week${weeksToRace === 1 ? '' : 's'} to ${state.race.name}`;
  }

  // WEEK-READ-1 (2026-08-24) · all three of the panel's stats are now derived
  // from the SAME seven days: the runner's training week, ending on their
  // long-run day, which is the window the week strip draws and the window
  // `weekDone` is summed over.
  //
  // They were derived from the plan_weeks row today falls inside. On a block
  // authored on the runner's own grid that is the same week; on one that is
  // not, "This week's mileage" was a different week from the strip below it,
  // and the quality share was a ratio of two numbers taken from that other
  // week while the runner read this one.
  const windowDays = state.weekWindowDays;
  const weekMi = state.weekPlanned ?? 0;
  const qualityMi = windowDays
    .filter((d) => d.isQuality && d.type !== 'race')
    .reduce((s, d) => s + d.mi, 0);
  const qualityShare = weekMi > 0 ? Math.round((qualityMi / weekMi) * 100) : 0;
  const longMi = Math.max(0, ...windowDays.filter((d) => d.isLong && d.type !== 'race').map((d) => d.mi));

  return {
    dayState: 'phase',
    quiet: false,
    place: 'Block',
    dateLine: dateWords(state.today),
    weekLine,
    kicker: null,
    type: phaseLabel,
    dose: null,
    stats: [
      { label: 'Quality share', value: num(`${qualityShare}%`, false), tone: 'neutral' },
      // A recovery or down week carries no designated long run. "0 mi" reads
      // as a broken stat — the week has a longest run, it just has no LONG
      // run. Say the true thing instead of printing a zero.
      { label: 'Long run', value: num(longMi > 0 ? `${fmtMi(longMi)} mi` : 'None', false), tone: 'neutral' },
      { label: "This week's mileage", value: num(`${fmtMi(weekMi)} mi`, false), tone: 'neutral' },
    ],
  };
}

// ── phase arc ────────────────────────────────────────────────────────────

function dayFraction(weekStartISO: string, todayISO: string): number {
  const diffDays = Math.round(
    (Date.parse(`${todayISO}T12:00:00Z`) - Date.parse(`${weekStartISO}T12:00:00Z`)) / 86400000,
  );
  return Math.min(1, Math.max(0, diffDays / 7));
}

export function buildPhases(state: TrainingState) {
  return state.phases.map((p) => {
    const weeksCount = Math.max(1, p.endWeekIdx - p.startWeekIdx + 1);
    const isCurrent =
      state.currentWeekIdx != null &&
      state.currentWeekIdx >= p.startWeekIdx &&
      state.currentWeekIdx <= p.endWeekIdx;

    let at: number | null = null;
    if (isCurrent && state.currentWeekIdx != null) {
      const curWeek = state.weeks.find((w) => w.idx === state.currentWeekIdx);
      const weekOffset = state.currentWeekIdx - p.startWeekIdx;
      const frac = curWeek ? dayFraction(curWeek.startDate, state.today) : 0;
      at = Math.min(1, Math.max(0, (weekOffset + frac) / weeksCount));
    }

    return {
      id: p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: p.label,
      weeks: weeksCount,
      current: isCurrent,
      at,
    };
  });
}

// ── so far in this block ────────────────────────────────────────────────

export function buildSoFar(state: TrainingState) {
  let milesDone = 0;
  let qualityDone = 0;
  for (const w of state.weeks) {
    for (const d of w.days) {
      if (d.date > state.today) continue;
      milesDone += d.doneMi;
      if (d.isQuality && d.type !== 'race' && d.doneMi > 0) qualityDone++;
    }
  }
  const weeksIn = state.currentWeekIdx != null ? state.currentWeekIdx + 1 : 0;
  const totalWeeks = state.weeks.length;

  return [
    { id: 'weeks-in', label: 'Weeks in', sub: null, value: num(`${weeksIn} of ${totalWeeks}`, false), action: null, tone: 'neutral' },
    { id: 'miles-run', label: 'Miles run', sub: null, value: num(`${fmtMi(milesDone)} mi`, false), action: null, tone: 'neutral' },
    { id: 'quality-done', label: 'Quality sessions', sub: null, value: num(String(qualityDone), false), action: null, tone: 'neutral' },
  ];
}

// ── coach line ───────────────────────────────────────────────────────────

/**
 * The first day `pickPlanMode` would answer 'race-prep' for this race, asked
 * of the function itself rather than re-derived from `BUILD_WINDOW_WEEKS`.
 *
 * `pickPlanMode` does not open the window at exactly `race − buildWindow`:
 * MAINT-SKIP-1 pulls it forward whenever fewer than one whole maintenance week
 * would remain. A date computed off the constant would be right most of the
 * time and wrong at the seam, which is the one week a runner would be looking
 * at it. Null when the race is already inside the window (so the caller says
 * nothing rather than naming a date in the past) or when it never opens.
 */
export function buildOpensISO(
  todayISO: string,
  raceDateISO: string,
  raceDistanceMi: number,
): string | null {
  if (pickPlanMode(todayISO, raceDateISO, raceDistanceMi, null, null) === 'race-prep') return null;
  const day = (n: number) =>
    new Date(Date.parse(todayISO + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  for (let n = 1; n <= 400; n++) {
    const d = day(n);
    if (d > raceDateISO) return null;
    if (pickPlanMode(d, raceDateISO, raceDistanceMi, null, null) === 'race-prep') return d;
  }
  return null;
}

export function buildCoachLine(
  state: TrainingState,
  /** The goal race's distance, for the build-window question. Absent when the
   *  plan has no race row, which is the genuine no-goal case. */
  raceDistanceMi: number | null = null,
): string | null {
  // MAINTENANCE is the mode a runner is in when their race is real and simply
  // is not near yet, and the line here said the opposite of that: "There is no
  // block to build toward yet." For a runner sixteen weeks out from a half
  // they entered on this app, with the race named in the panel directly above,
  // that is the screen contradicting itself. Say when the build opens instead.
  if (state.currentPhase === 'MAINTENANCE' && state.race && raceDistanceMi != null && raceDistanceMi > 0) {
    const opens = buildOpensISO(state.today, state.race.date, raceDistanceMi);
    if (opens) {
      return `Holding steady. The build for ${state.race.name} opens ${dateWords(opens)}.`;
    }
  }
  switch (state.currentPhase) {
    case 'TAPER':
      return 'The taper is doing its job. Volume drops, intensity stays sharp, the legs come back under you.';
    case 'RACE-SPECIFIC':
      return 'Race-pace work carries these weeks. The taper starts once this phase is in.';
    case 'QUALITY':
      return 'This is where the fitness gets built. Hit the quality sessions, let the easy days stay easy.';
    case 'MAINTENANCE':
      return 'Holding steady here. There is no block to build toward yet.';
    case 'BASE':
      return 'Base volume first. The harder work comes once this phase is in.';
    // generate.ts's post-race composer (RECOVERY-3) authors this phase label
    // on its own, outside sizeBlocks' BASE/QUALITY/RACE-SPECIFIC/TAPER arc —
    // easy running only, no quality, sized off the runner's own recent peak.
    case 'RECOVERY':
      return 'Easy running only. No quality until this phase closes and the next block gets sized.';
    default:
      return null;
  }
}

// ── weeks (all of them) ─────────────────────────────────────────────────

function weekFlag(w: PlanWeek): string {
  if (w.isCurrent) return 'This week';
  if (w.isRaceWeek) return 'Race week';
  if (w.isCutback) return 'Cutback';
  return w.phase;
}

export function buildWeeks(state: TrainingState) {
  return state.weeks.map((w) => {
    const qualityCount = w.days.filter((d) => d.isQuality && d.type !== 'race').length;
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.mi));

    return {
      id: w.id,
      label: `Wk ${w.idx + 1}`,
      flag: weekFlag(w),
      miles: num(`${fmtMi(w.plannedMi)} mi`, false),
      isCurrent: w.isCurrent,
      days: w.days.map((d) => ({
        id: d.id,
        miles: d.mi,
        quality: d.isQuality && d.type !== 'race',
        race: d.type === 'race',
        isToday: d.date === state.today,
        isFuture: d.date > state.today,
        // 2026-08-20 · iPhone v5 Today calendar sheet reads the whole block
        // (not just the current week) from this same payload — see
        // TodayCalendarDay in native-v2. Additive: existing readers
        // (BlockV5's WeekShape sparkline) only ever destructured
        // miles/quality/race/isToday/isFuture and ignore unknown keys.
        dateISO: d.date,
        type: displayTypeFor(d.type, d.label),
        // Same rule /api/v5/today's weekStrip uses for isDone (route.ts:162)
        // — a logged run, or enough distance to count as done. A rest day
        // carries neither, so it reads as not-done (no status chip), which
        // is the honest answer: nothing was asked of it to complete.
        isDone: d.activityId != null || d.doneMi >= 0.5,
      })),
      detail: [
        { id: `${w.id}-long`, label: 'Long run', sub: null, value: num(`${fmtMi(longMi)} mi`, false), action: null, tone: 'neutral' },
        { id: `${w.id}-quality`, label: 'Quality sessions', sub: null, value: num(String(qualityCount), false), action: null, tone: 'neutral' },
        { id: `${w.id}-mileage`, label: 'Mileage', sub: null, value: num(`${fmtMi(w.plannedMi)} mi`, false), action: null, tone: 'neutral' },
      ],
    };
  });
}

// ── workout library (Gap B1) ────────────────────────────────────────────

const FAMILY_LABEL: Record<string, string> = {
  recovery: 'Recovery', easy: 'Easy', medium_long: 'Medium-long', long: 'Long run',
  threshold: 'Threshold', vo2max: 'Interval', speed: 'Speed', hills: 'Hills',
  fartlek: 'Fartlek', combo: 'Combo', marathon_specific: 'Marathon-specific',
  cutdown: 'Cutdown', ladder: 'Ladder', race_specific: 'Race-specific',
  base_building: 'Base building', maintenance: 'Maintenance', walk_run: 'Walk-run',
  race: 'Race', shakeout: 'Shakeout', rest: 'Rest',
};

/** BASE/QUALITY/RACE-SPECIFIC/TAPER/MAINTENANCE (plan_phases.label, this
 *  engine's own phase names) → workout_library.phase_fit's lowercase-snake
 *  vocabulary. Race week overrides the phase label — a race-week session is
 *  tagged 'race_week', not whatever phase the race sits inside.
 *
 *  RECOVERY (generate.ts's post-race composer, outside the BASE/QUALITY/
 *  RACE-SPECIFIC/TAPER arc `sizeBlocks` sizes) has no `phase_fit` value of
 *  its own — the catalogue was never asked to carry recovery-specific
 *  sessions, easy/recovery families already have no phase restriction. Null
 *  here means "do not filter the library by phase", which is the honest
 *  answer rather than a guess at a value that does not exist in the schema. */
export function libraryPhaseKey(phaseLabel: string | null, isRaceWeek: boolean): LibraryPhase | null {
  if (isRaceWeek) return 'race_week';
  switch (phaseLabel) {
    case 'BASE': return 'base';
    case 'QUALITY': return 'quality';
    case 'RACE-SPECIFIC': return 'race_specific';
    case 'TAPER': return 'taper';
    case 'MAINTENANCE': return 'maintenance';
    default: return null;
  }
}

export async function buildLibrary(state: TrainingState, raceDistanceMi: number | null) {
  const all = await loadAllWorkouts();
  const cat = raceDistanceMi != null ? distanceCategoryOrNull(raceDistanceMi) : null;
  const current = state.weeks.find((w) => w.isCurrent) ?? null;
  const phaseKey = libraryPhaseKey(state.currentPhase, current?.isRaceWeek ?? false);

  const relevant = all.filter((t) => {
    // "A session with no citation does not go in the library."
    if (!t.citation || !t.citation.trim()) return false;
    if (cat && !(t.distanceFocus.includes(cat) || t.distanceFocus.includes('all'))) return false;
    if (phaseKey && t.phaseFit.length > 0 && !t.phaseFit.includes(phaseKey)) return false;
    return true;
  });

  return relevant
    .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name))
    .map((t) => ({
      id: String(t.id),
      name: t.name,
      family: FAMILY_LABEL[t.family] ?? t.family,
      prescription: t.prescriptionText,
      structure: t.warmupCooldown,
      citation: t.citation,
      isQuality: t.isQuality,
    }));
}

// ── change-the-plan scenarios ───────────────────────────────────────────

export const SCENARIO_META: Record<ChangeScenario, { label: string; sub: string }> = {
  cutback: {
    label: 'Cut back a week',
    sub: 'Take the edge off one week ahead. The long and a quality session shrink; nothing else moves.',
  },
  travel: {
    label: 'Travel',
    sub: 'Days you cannot run, with a ramped return. Pick the dates and the block gets priced against them.',
  },
  extra_day: {
    label: 'Add a day',
    sub: 'Run one more day a week from here. Changes the block, not your saved weekly frequency. A full rebuild reverts it.',
  },
  move_day: {
    label: 'Move a day',
    sub: 'Shift one session to a rest day in the same week.',
  },
  another_race: {
    label: 'Add a race',
    sub: "Fold a tune-up into the block as that week's quality session.",
  },
};

export const NO_PLAN_REASON = 'There is no active plan to change yet.';

export interface V5ScenarioOut {
  id: ChangeScenario;
  label: string;
  sub: string;
  available: boolean;
  refusal: string | null;
}

export function fromOutcome(id: ChangeScenario, outcome: ChangeOutcome): V5ScenarioOut {
  return {
    id,
    label: SCENARIO_META[id].label,
    sub: SCENARIO_META[id].sub,
    available: outcome.ok,
    refusal: outcome.ok ? null : outcome.reason,
  };
}

export function refused(id: ChangeScenario, reason: string): V5ScenarioOut {
  return {
    id,
    label: SCENARIO_META[id].label,
    sub: SCENARIO_META[id].sub,
    available: false,
    refusal: reason,
  };
}

/**
 * A real (from, to) pair for `move_day`: a running day paired with a rest day
 * in the SAME week, both still ahead of the runner — `planMoveDay`'s own
 * constraint that a session moves inside its own week. This does not decide
 * whether the move is legal (stimulus gap, long-primacy); it only picks
 * plausible arguments and hands them to the real function via `proposeChange`.
 * Prefers an easy day over quality or the long, matching the design's own
 * example ("Your easy run moves from Friday to Monday").
 */
export function findMoveDayCandidate(shape: PlanShape, todayISO: string): { from: string; to: string } | null {
  for (const week of shape.weeks) {
    const restSlots = week.days.filter((d) => d.type === 'rest' && d.distanceMi === 0 && d.dateISO > todayISO);
    if (restSlots.length === 0) continue;
    const movable = week.days
      .filter((d) => d.dateISO > todayISO && d.type !== 'rest' && d.type !== 'race')
      .sort((a, b) => (Number(a.isLong) - Number(b.isLong)) || (Number(a.isQuality) - Number(b.isQuality)));
    if (movable.length === 0) continue;
    return { from: movable[0].dateISO, to: restSlots[0].dateISO };
  }
  return null;
}

export async function buildScenarios(userId: string, todayISO: string): Promise<V5ScenarioOut[]> {
  // cutback needs no scenario-specific argument — proposeChange defaults
  // weekIdx to the next future week on its own. Also doubles as the shared
  // "is there a plan at all" check every other scenario below relies on.
  const cutbackOutcome = await proposeChange(userId, todayISO, { scenario: 'cutback' });
  if (!cutbackOutcome.ok && cutbackOutcome.code === 'no_plan') {
    return CHANGE_SCENARIOS.map((id) => refused(id, cutbackOutcome.reason));
  }

  const byId = new Map<ChangeScenario, V5ScenarioOut>();
  byId.set('cutback', fromOutcome('cutback', cutbackOutcome));

  // extra_day — the runner's OWN rest day, not a guessed weekday, so this
  // asks the real question rather than a made-up one.
  const settings = await loadSettings(userId);
  const restDow = DOW_NUM[settings.rest_day] ?? 6;
  const extraOutcome = await proposeChange(userId, todayISO, { scenario: 'extra_day', dow: restDow });
  byId.set('extra_day', fromOutcome('extra_day', extraOutcome));

  const shape = await loadPlanShape(userId);

  // move_day — a real candidate pair if one exists in the block; otherwise
  // there is nothing honest to test against planMoveDay's own rule.
  const candidate = shape ? findMoveDayCandidate(shape, todayISO) : null;
  if (candidate) {
    const moveOutcome = await proposeChange(userId, todayISO, {
      scenario: 'move_day', dateISO: candidate.from, toDateISO: candidate.to,
    });
    byId.set('move_day', fromOutcome('move_day', moveOutcome));
  } else {
    byId.set('move_day', refused('move_day', shape
      ? 'There is no rest day next to a running day anywhere in this block to move one into.'
      : NO_PLAN_REASON));
  }

  // travel — the design's own carve-out: no date range yet, so `available`
  // here means only "is there a plan to change". POST /api/plan/change
  // prices the actual window once the runner picks one.
  byId.set('travel', shape
    ? { id: 'travel', label: SCENARIO_META.travel.label, sub: SCENARIO_META.travel.sub, available: true, refusal: null }
    : refused('travel', NO_PLAN_REASON));

  // another_race — the three gates that hold regardless of WHICH race gets
  // picked, via the exact function proposeChange('another_race') runs first.
  if (shape) {
    const gate = anotherRaceBlockGate(shape, todayISO);
    byId.set('another_race', 'unavailable' in gate
      ? refused('another_race', gate.unavailable)
      : { id: 'another_race', label: SCENARIO_META.another_race.label, sub: SCENARIO_META.another_race.sub, available: true, refusal: null });
  } else {
    byId.set('another_race', refused('another_race', NO_PLAN_REASON));
  }

  return CHANGE_SCENARIOS.map((id) => byId.get(id)!);
}

// ── no active plan ───────────────────────────────────────────────────────

export function emptyBlock(todayISO: string) {
  return {
    panel: {
      dayState: 'phase', quiet: true, place: 'Block', dateLine: dateWords(todayISO),
      weekLine: null, kicker: null, type: 'NO BLOCK', dose: null, stats: [],
    },
    phases: [],
    coachLine: 'There is no block running right now.',
    soFar: [],
    weeks: [],
    library: [],
    scenarios: CHANGE_SCENARIOS.map((id) => refused(id, NO_PLAN_REASON)),
  };
}

// ── the whole payload ────────────────────────────────────────────────────

export async function loadV5Block(userId: string) {
  const state = await loadTrainingState(userId);

  if (!state.plan_id || state.weeks.length === 0) {
    return emptyBlock(state.today);
  }

  let raceDistanceMi: number | null = null;
  if (state.race) {
    const row = (await pool.query<{ meta: Record<string, unknown> | null }>(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2::uuid`,
      [state.race.slug, userId],
    )).rows[0];
    const meta = row?.meta ?? null;
    const label = meta && typeof meta['distanceLabel'] === 'string'
      ? (meta['distanceLabel'] as string)
      : null;
    raceDistanceMi = distanceMiFromLabel(label);
  }

  const [library, scenarios] = await Promise.all([
    buildLibrary(state, raceDistanceMi),
    buildScenarios(userId, state.today),
  ]);

  return {
    panel: buildPanel(state),
    phases: buildPhases(state),
    coachLine: buildCoachLine(state, raceDistanceMi),
    soFar: buildSoFar(state),
    weeks: buildWeeks(state),
    library,
    scenarios,
  };
}
