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
 *   library    Gap B1. `lib/plan/workout-library-static.ts` `loadAllWorkouts()`
 *              is the workout catalogue that fed plan generation and had no
 *              HTTP door (`grep -rl "workout-library" app` was empty).
 *              (In-code since 2026-08-28 — the workout_library DB table it
 *              read is retired, migration 158.)
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
import { weekContainsRace } from './race-week';
import { resolveRaceWeekRole, type RaceWeekRole } from './race-week-role';
import { dateWords as usDateWords } from '@/lib/format/date';
import { loadTrainingState, type TrainingState, type PlanWeek } from '@/lib/coach/training-state';
import { loadSettings } from '@/lib/coach/settings';
import { pool } from '@/lib/db/pool';
import { loadAllWorkouts, type PlanPhase as LibraryPhase } from '@/lib/plan/workout-library-static';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { distanceMiFromLabel } from '@/lib/race/distance';
// RACE-PREP-OPENS-1 · the Block screen asks the mode machine itself when the
// build opens, rather than re-deriving it from BUILD_WINDOW_WEEKS.
import { buildOpensISO } from '@/lib/plan/goal-tiers';
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
import {
  resolveCoachingThesis, wireThesis, composeCoachLine,
  type ThesisWire, type CoachingThesis,
} from '@/lib/training/coaching-thesis';

// ── small local formatters — presentation only, no doctrine here ───────────

const DOW_NUM: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * "August 25" — month, then day.
 *
 * US order, per David 2026-08-25, and no longer a local `MONTHS` array: this
 * was the sixth hand-rolled date formatter in the codebase, and the reason
 * they keep appearing is that each one is three lines. `lib/format/date.ts`
 * owns the question now.
 *
 * No weekday and no year, which is what this register wants: it sits at 26pt
 * on the Block panel above a phase name, next to "15 weeks to California
 * International Marathon", and both of those already place it in time.
 */
function dateWords(iso: string): string {
  return usDateWords(iso, { long: true, noWeekday: true, noYear: true });
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
  // BLOCK-ENDED-1 (2026-08-24) · null means the block does not reach this week
  // at all — it ended, or it has not started. That is not the same fact as
  // "nothing is planned this week", and `?? 0` printed it as the second one:
  // a runner whose plan ran out two days ago (one exists in production on
  // 2026-08-24, whose block's last day was 2026-08-22) reads "0 mi" for the
  // week, which asserts a prescription of zero rather than saying the block is
  // over. Same reasoning the Long run stat already applies below.
  const weekMi = state.weekPlanned ?? 0;
  const weekReaches = state.weekPlanned != null;
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
      { label: "This week's mileage", value: num(weekReaches ? `${fmtMi(weekMi)} mi` : 'None', false), tone: 'neutral' },
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
  return state.phases.map((p, phaseIdx) => {
    // PHASE-ANSWERS-1 (2026-09-01) · the phase's structured answers, by
    // position: `authored_state.phase_answers` is written in the same order
    // `plan_phases` is. ADDITIVE keys on the wire (`developing`, `whyNow`,
    // `evidence`, `hold`, `progress`, `restructure`) — the phone's lenient
    // decoder ignores what it does not read, and a block authored before the
    // key existed carries none, so every key is absent rather than empty.
    const answers = state.phaseAnswers?.[phaseIdx] ?? null;
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
      // Spread, so a block with no answers carries no keys at all rather than
      // six nulls. "This block predates the answers" and "this phase has no
      // answer" are different facts and the wire says so by absence (Rule 11).
      ...(answers
        ? {
            developing: answers.developing,
            whyNow: answers.whyNow,
            evidence: answers.evidence,
            hold: answers.hold,
            progress: answers.progress,
            restructure: answers.restructure,
          }
        : {}),
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
  // COUNTED, NOT `currentWeekIdx + 1` — that printed "2 of 1" on David's
  // phone on 2026-08-25. See `TrainingState.currentWeekOrdinal`.
  const weeksIn = state.currentWeekOrdinal ?? 0;
  const totalWeeks = state.weeks.length;

  return [
    { id: 'weeks-in', label: 'Weeks in', sub: null, value: num(`${weeksIn} of ${totalWeeks}`, false), action: null, tone: 'neutral' },
    { id: 'miles-run', label: 'Miles run', sub: null, value: num(`${fmtMi(milesDone)} mi`, false), action: null, tone: 'neutral' },
    { id: 'quality-done', label: 'Quality sessions', sub: null, value: num(String(qualityDone), false), action: null, tone: 'neutral' },
  ];
}

// ── coach line ───────────────────────────────────────────────────────────

export function buildCoachLine(
  state: TrainingState,
  /** The goal race's distance, for the build-window question. Absent when the
   *  plan has no race row, which is the genuine no-goal case. */
  raceDistanceMi: number | null = null,
): string | null {
  // BLOCK-ENDED-1 (2026-08-24) · the block ran out and is still the active one.
  // The phase line above it keeps naming the last phase it reached and the
  // week list keeps drawing weeks that are all in the past, so a line that
  // narrates the phase is narrating something that is over. One production
  // plan was in this state on 2026-08-24 — last prescribed day 2026-08-22,
  // still `archived_iso IS NULL`. Say what is true; the lifecycle cron writes
  // the next block, and until it does the runner should not be told to hit
  // sessions that no longer exist.
  const lastWeek = state.weeks[state.weeks.length - 1];
  if (lastWeek) {
    const lastDay = new Date(Date.parse(lastWeek.startDate + 'T12:00:00Z') + 6 * 86400000)
      .toISOString().slice(0, 10);
    if (lastDay < state.today) {
      return 'This block has finished. The next one gets written from where you actually got to.';
    }
  }

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

/**
 * BLOCK-THESIS-LINE-1 (2026-09-02) · THE LINE THE RUNNER READS UNDER
 * "WHERE THIS GOES", when the Coaching Thesis has something better to say.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * The thesis is composed correctly, shipped correctly on `thesis`, and
 * RENDERED NOWHERE: `Thesis`, `reviewTrigger` and `limiter` appear zero times
 * in the whole of `native-v2`. So Block's "WHERE THIS GOES" reads the generic
 * phase line — "This is where the fitness gets built" — while the sentence the
 * engine actually composed for this runner ("Your races fade with distance
 * faster than your speed predicts, so durability is where the work goes") is
 * serialised, sent and dropped. Found by looking at the deployed screen, which
 * is the only way it could have been found: every wire was correct.
 *
 * `coachLine` is a STRING in a field the app already renders, so putting the
 * thesis there needs no app release. That is the whole of the fix.
 *
 * ── WHEN THE THESIS WINS, AND WHEN IT DOES NOT ──────────────────────────────
 *
 * The thesis answers "what is this block trying to move". That question is
 * live only while the block is still building something, so it wins in BASE,
 * QUALITY and RACE-SPECIFIC and never elsewhere:
 *
 *   TAPER, race week   the phase line carries a CALENDAR fact the thesis
 *                      cannot ("volume drops, intensity stays sharp"), and
 *                      "durability is where the work goes" during a taper is
 *                      actively wrong — the work is finished.
 *   RECOVERY           "easy running only, no quality" is the instruction.
 *   MAINTENANCE        there is no block to have a thesis about, and that
 *                      branch says when one opens.
 *   block ended        BLOCK-ENDED-1's sentence is about the plan's state,
 *                      not its strategy.
 *
 * `resolveCoachingThesis` does NOT refuse by phase — it answers for any
 * runner on any day — so the gate is here rather than assumed there.
 *
 * ── RULE 11 · three facts ───────────────────────────────────────────────────
 *
 *   thesis === null          the resolver was not reached (no plan). Phase line.
 *   limiter === 'UNKNOWN'    the resolver's OWN refusal, and its coach line
 *                            says so honestly ("not enough direct evidence
 *                            yet"). That is a claim about the MODEL, not an
 *                            answer to "where this goes", so the phase line
 *                            stands and the refusal keeps its own home on the
 *                            `thesis` object. Explicit branch, not a fallthrough.
 *   a named limiter          the thesis line.
 *
 * ── RULE 17 · the week tail belongs to Today, not here ──────────────────────
 *
 * `thesis.coachLine` ends "…and this week's long run is the session that
 * builds it" when the week addresses the limiter — and Today already says
 * that, through `thesisLeadClause`, on the day itself. Two screens, one claim.
 * So Block asks the SAME composer for the block-level half by passing
 * `addressedThisWeek: false`. It is one sentence writer with two registers,
 * not a second sentence (Rule 16): nothing here writes prose.
 */
export function blockCoachLine(
  state: TrainingState,
  raceDistanceMi: number | null,
  thesis: CoachingThesis | null,
): string | null {
  const phaseLine = buildCoachLine(state, raceDistanceMi);
  if (!thesis) return phaseLine;
  if (thesis.primaryLimiter === 'UNKNOWN') return phaseLine;

  const lastWeek = state.weeks[state.weeks.length - 1];
  if (lastWeek) {
    const lastDay = new Date(Date.parse(lastWeek.startDate + 'T12:00:00Z') + 6 * 86400000)
      .toISOString().slice(0, 10);
    if (lastDay < state.today) return phaseLine;
  }
  const current = state.weeks.find((w) => w.isCurrent) ?? null;
  if (current?.isRaceWeek) return phaseLine;
  if (state.currentPhase !== 'BASE' && state.currentPhase !== 'QUALITY'
    && state.currentPhase !== 'RACE-SPECIFIC') return phaseLine;

  return composeCoachLine(thesis.primaryLimiter, thesis.heldConstant, {
    basis: thesis.basis,
    addressedThisWeek: false,
  });
}

/**
 * Punctuation and case removed, spaces collapsed. Comparing RENDERED TEXT is
 * the whole point (Rule 17: "it yields on the rendered text, not on a row id,
 * because that is what the runner actually sees"), and a trailing full stop is
 * not a difference the runner can see.
 */
function normalizeSpokenText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * RULE 17 · THE BLOCK SCREEN PRINTS THE DURABILITY SENTENCE ONCE.
 *
 * `BlockV5.swift` draws two `CoachSay` bubbles inside one "Where this goes"
 * section — `model.coachLine` at :277 and `model.thesis.coachLine` at :302 —
 * and both come out of `composeCoachLine`. It is ONE writer with two
 * registers, which is why the second is a superset of the first rather than a
 * different sentence. Measured on production 2026-09-03, `faff_readonly`,
 * reference runner `0645f40c-951d-4ccc-b86e-9979cd26c795`, active plan
 * `pln_9a57561debb776e5`, phase QUALITY, limiter DURABILITY on
 * CURVE_SHAPE_EVIDENCE:
 *
 *   coachLine         "Your races fade with distance faster than your speed
 *                      predicts, so durability is where the work goes. Your
 *                      threshold holds."
 *   thesis.coachLine   …the same twenty-two words, then ", and this week's
 *                      long run is the session that builds it."
 *
 * Twenty-two words twice, eleven words of new information.
 *
 * THE THESIS LINE YIELDS, not the block line, for two reasons that are already
 * written down elsewhere in this file. `blockCoachLine` is phase-gated —
 * BASE/QUALITY/RACE-SPECIFIC only, never a taper or a race week — and
 * `thesis.coachLine` is not, so keeping the wrong one would put "durability is
 * where the work goes" on a taper screen. And the tail it carries is the week
 * clause that the header above says belongs to Today, where `thesisLeadClause`
 * already says it on the day itself.
 *
 * EMPTY STRING, NOT A DROPPED KEY. `V5Thesis.coachLine` is a non-optional
 * Swift `String` and `BlockV5.swift:302` already guards `!isEmpty`, so this
 * suppresses the bubble on the phone builds already in the field with no
 * release — and `reviewTrigger`, which `BlockV5.swift:296` says "lives HERE
 * and nowhere else", keeps drawing.
 *
 * CONTAINMENT, BOTH DIRECTIONS, ON NORMALISED TEXT. Not equality: the two
 * forms differ only by a suffix today. Not a flag or an id: a flag would go on
 * agreeing with itself while the strings drifted, which is the failure mode
 * Rule 17 names explicitly. Both directions because which of the two is the
 * longer form is a property of `composeCoachLine`'s branches, not an invariant
 * this function should assume.
 */
export function suppressThesisLineIfBlockAlreadySaidIt(
  wire: ThesisWire | null,
  blockLine: string | null,
): ThesisWire | null {
  if (!wire || !blockLine) return wire;
  const a = normalizeSpokenText(wire.coachLine);
  const b = normalizeSpokenText(blockLine);
  if (!a || !b) return wire;
  if (a.includes(b) || b.includes(a)) return { ...wire, coachLine: '' };
  return wire;
}

// ── weeks (all of them) ─────────────────────────────────────────────────

export function weekFlag(w: PlanWeek): string {
  if (w.isCurrent) return 'This week';
  // RACEWEEK-1 · `isRaceWeek` is the GOAL race's week and nothing else, so
  // this line labelled his 10K week "QUALITY" ten days out. A week the runner
  // RACES IN is the question a label is asking, and `weekContainsRace` answers
  // it from the week's own days — which means his live block reads correctly
  // without rewriting a persisted row.
  if (weekContainsRace(w)) return 'Race week';
  // TAPER-NOT-CUTBACK-1 (2026-08-24) · the taper is not a cutback, and the
  // taper is the more important word. `planWeekFlags` stops writing the column
  // that way for blocks authored from here on; this is what the two production
  // plans already carrying it read as in the meantime. Three weeks between
  // them, every one a taper week labelled "Cutback" with "RACE-SPECIFIC" on
  // the week before it — so the block did not say anywhere that the taper had
  // started.
  if (w.phase === 'TAPER') return w.phase;
  if (w.isCutback) return 'Cutback';
  return w.phase;
}

export function buildWeeks(state: TrainingState) {
  return state.weeks.map((w) => {
    const qualityCount = w.days.filter((d) => d.isQuality && d.type !== 'race').length;
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.mi));
    // WEEKANSWERS-1 (2026-09-02) · WHY THIS WEEK LOOKS LIKE THIS, on the week.
    //
    // Matched by START DATE, not by position: a re-anchored block loses weeks
    // off the front and a positional match would slide every explanation one
    // week early with nothing looking wrong.
    //
    // Rule 17: the block-level sentences (how the long runs progress, why the
    // longest run is the distance it is) are NOT repeated here. They are on the
    // block once, in `buildBlockAnswers`.
    const answers = state.weekAnswers?.[w.startDate] ?? null;
    const answerRows = answers
      ? ([
          { id: `${w.id}-why-mileage`, label: 'Why this mileage', text: answers.whyMileage },
          { id: `${w.id}-why-long`, label: 'Why this long run', text: answers.whyLongRun },
          { id: `${w.id}-why-quality`, label: 'Why these sessions', text: answers.whyQuality },
          ...(answers.whyCutback
            ? [{ id: `${w.id}-why-cutback`, label: 'Why the cutback', text: answers.whyCutback }]
            : []),
          { id: `${w.id}-develops`, label: 'How it builds on last week', text: answers.developsPrevious },
          { id: `${w.id}-prepares`, label: 'How it prepares you', text: answers.preparesForRace },
        ])
      : [];

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
      // Additive and absent when the block predates the answers, so a phone
      // decoding an older plan sees no key rather than an empty list (Rule 11).
      ...(answerRows.length > 0 ? { answers: answerRows } : {}),
    };
  });
}

/**
 * WEEKANSWERS-1 · the block's own five answers, once.
 *
 * Absent when the block predates them. Never repeated onto the weeks — Rule 17
 * is the reason this is a separate builder and not six more `detail` rows on
 * fifteen week rows.
 */
export function buildBlockAnswers(state: TrainingState) {
  const a = state.blockAnswers;
  if (!a) return null;
  return [
    { id: 'block-long-progression', label: 'How the long runs progress', text: a.longRunProgression },
    { id: 'block-mp-start', label: 'Where marathon pace starts', text: a.marathonSpecificStart },
    { id: 'block-mp-progression', label: 'How marathon pace builds', text: a.marathonPaceProgression },
    { id: 'block-longest', label: 'Why the longest run is what it is', text: a.longestRunReason },
    { id: 'block-race-effort', label: 'How this prepares race effort', text: a.sustainRaceEffort },
  ];
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
 *  engine's own phase names) → the workout library's `phaseFit` lowercase-snake
 *  vocabulary. Race week overrides the phase label — a race-week session is
 *  tagged 'race_week', not whatever phase the race sits inside.
 *
 *  RECOVERY (generate.ts's post-race composer, outside the BASE/QUALITY/
 *  RACE-SPECIFIC/TAPER arc `sizeBlocks` sizes) has no `phase_fit` value of
 *  its own — the catalogue was never asked to carry recovery-specific
 *  sessions, easy/recovery families already have no phase restriction. Null
 *  here means "do not filter the library by phase", which is the honest
 *  answer rather than a guess at a value that does not exist in the schema.
 *
 *  RACEWEEK-2 (2026-09-03) · takes the typed `RaceWeekRole`
 *  (`lib/plan/race-week-role.ts`), not the old goal-only boolean, and only
 *  `'goal'` pulls the catalogue into `race_week` mode. That is a deliberate,
 *  tested choice, not an oversight: `race_week`'s own `phaseFit` rows are
 *  built for a full A-race taper (mostly shakeout/easy), and pulling a
 *  `tuneup` or `controlled` week into that narrow catalogue would hide the
 *  ordinary phase's quality sessions from a runner who is not tapering — the
 *  owner's ruling, 2026-09-03: "Do NOT apply CIM-style (goal-race) taper mode
 *  to this week... Do NOT make the whole week easier merely because it
 *  contains a tune-up." A tune-up or controlled race still shows as a race
 *  week on the Block screen (`weekFlag`, via `weekContainsRace`) — this
 *  function only decides which workout catalogue backs it. */
export function libraryPhaseKey(phaseLabel: string | null, role: RaceWeekRole): LibraryPhase | null {
  if (role === 'goal') return 'race_week';
  switch (phaseLabel) {
    case 'BASE': return 'base';
    case 'QUALITY': return 'quality';
    case 'RACE-SPECIFIC': return 'race_specific';
    case 'TAPER': return 'taper';
    case 'MAINTENANCE': return 'maintenance';
    default: return null;
  }
}

/** A phase that prescribes no quality at all.
 *
 *  RECOVERY is the one such phase the engine authors (generate.ts's post-race
 *  composer), and `buildCoachLine` states it in as many words directly above
 *  this list: "Easy running only. No quality until this phase closes."
 *
 *  THE CATALOGUE USED TO CONTRADICT THAT SENTENCE. `libraryPhaseKey` returns
 *  null for RECOVERY — correctly, since `phaseFit` has no 'recovery' value to
 *  match — but the filter below reads a null key as "do not filter by phase",
 *  so the one phase that forbids quality was the only phase that advertised
 *  the WHOLE catalogue: Continuous tempo, Cruise intervals, Yasso 800s, Hill
 *  sprints, Canova 2K repeats, all of it, under a coach line saying to run
 *  easy. Seen on the owner's own phone on 2026-08-30, in RECOVERY, 14 weeks
 *  out from CIM.
 *
 *  So the phase-fit key and the no-quality question are now asked separately.
 *  A missing `phaseFit` value means the catalogue was never authored for this
 *  phase; it does not mean the phase will take anything. */
export function phaseIsEasyOnly(phaseLabel: string | null): boolean {
  return phaseLabel === 'RECOVERY';
}

/** Run entirely at easy pace — the only thing an easy-only phase can offer.
 *
 *  Read off `paceZones` rather than `isQuality`, because `isQuality` is a
 *  narrower claim than "easy": the marathon-pace long runs carry
 *  `paceZones: ['E','M']` with `isQuality: false`, and 14 miles at marathon
 *  pace is not easy running by any reading of the sentence above the list.
 *  An empty zone list is a rest day, which belongs. */
function isEasyPaced(paceZones: string[]): boolean {
  return paceZones.every((z) => z === 'E');
}

export async function buildLibrary(state: TrainingState, raceDistanceMi: number | null) {
  const all = loadAllWorkouts();
  const cat = raceDistanceMi != null ? distanceCategoryOrNull(raceDistanceMi) : null;
  const current = state.weeks.find((w) => w.isCurrent) ?? null;
  // RACEWEEK-2 · role, not the raw goal-only column. `race-week-role.ts`'s own
  // fallback resolves any non-goal race to `controlled` when priority is not
  // supplied (as here — this loader has no cheap join onto `races.meta`),
  // which is fine for THIS decision: `libraryPhaseKey` only branches on
  // `'goal'` vs everything else, so `tuneup` and `controlled` both fall to the
  // same, correct, phase-based key either way.
  const role = current ? resolveRaceWeekRole(current).role : 'none';
  const phaseKey = libraryPhaseKey(state.currentPhase, role);
  const easyOnly = phaseIsEasyOnly(state.currentPhase);

  const relevant = all.filter((t) => {
    // "A session with no citation does not go in the library."
    if (!t.citation || !t.citation.trim()) return false;
    if (cat && !(t.distanceFocus.includes(cat) || t.distanceFocus.includes('all'))) return false;
    if (phaseKey && t.phaseFit.length > 0 && !t.phaseFit.includes(phaseKey)) return false;
    if (easyOnly && !isEasyPaced(t.paceZones)) return false;
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
    // A strategy is a statement about a block. There is no block, so there is
    // no strategy, and a thesis composed over a runner with no plan would be a
    // sentence about nothing (Rule 11: absent, not empty).
    thesis: null as ThesisWire | null,
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

  const [library, scenarios, thesis] = await Promise.all([
    buildLibrary(state, raceDistanceMi),
    buildScenarios(userId, state.today),
    // THE COACHING THESIS, ONCE, AT BLOCK LEVEL (Constitution §F).
    //
    // Quoted, never re-written. `buildCoachLine` above narrates WHERE in the
    // block the runner is standing ("this is where the fitness gets built");
    // the thesis says WHAT the block is currently trying to move and what
    // would change that. Different claims, so the two sit together without
    // repeating each other (Rule 17) — and the strategy sentence is byte
    // identical to the one Today composes its "why" from, because both call
    // the same resolver and neither writes its own version (Rule 16).
    //
    // NO `.catch`, for the reason /api/v5/today's own thesis block spells out:
    // a thesis that FAILED and a block with no thesis are different facts
    // (Rule 11), and this resolver reads the same database `loadTrainingState`
    // above already read uncaught — so a throw here means the request was
    // failing regardless, and /api/v5/block's handler turns that into the
    // honest data-outage screen.
    resolveCoachingThesis(userId, state.today),
  ]);

  // BLOCK-THESIS-LINE-1 · the thesis when it has something better to say
  // than the phase, the phase line otherwise. See `blockCoachLine`.
  const coachLine = blockCoachLine(state, raceDistanceMi, thesis);

  return {
    panel: buildPanel(state),
    phases: buildPhases(state),
    coachLine,
    thesis: suppressThesisLineIfBlockAlreadySaidIt(
      thesis ? wireThesis(thesis) : null,
      coachLine,
    ),
    soFar: buildSoFar(state),
    weeks: buildWeeks(state),
    // WEEKANSWERS-1 · the block's five answers. Null when the block predates
    // them, so the phone shows the block without them rather than five blanks.
    blockAnswers: buildBlockAnswers(state),
    library,
    scenarios,
  };
}
