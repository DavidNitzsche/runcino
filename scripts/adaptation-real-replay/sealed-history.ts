/**
 * scripts/adaptation-real-replay/sealed-history.ts · THE EXTRACT, BEHIND THE
 * FENCE.
 *
 * `snapshot.ts` reads the file and returns plain arrays, which is right for
 * what it is: an extract-integrity surface. `real-replay.test.ts` asserts "156
 * runs, 11 races, the AFC half finished in 6113 s", and those assertions are
 * not decisions — they check that the export is the export, and they must be
 * able to see every row at once.
 *
 * This module is the other consumer, and it is the one that matters. Everything
 * that feeds a DECISION comes through here, sealed per `asof.ts`, so the
 * no-lookahead property of the replay becomes a fact about the types rather
 * than a fact about how carefully `buildInputAt` was written.
 *
 * ── WHY EACH COLLECTION IS SEALED THE WAY IT IS ────────────────────────────
 *
 * · `runs` · `sealEvidence`, dated by the run. A run has no forward reading. It
 *   cannot be known before it is run, so the forward door is absent rather than
 *   narrowed.
 *
 * · `plans` · `sealEvidence`, dated by `authoredISO`. A plan authored AFTER the
 *   decision point may not supply anything to it — not even for a week in the
 *   past. That is the leak that would let the CIM block authored on 31 Aug
 *   silently reprice every June week.
 *
 *   Note the boundary this moves, deliberately and to the safe side.
 *   `planInForceAt` used `authoredISO <= '<asOf>T00:00:00Z'`; the fence uses
 *   `day(authoredISO) < asOf`. On this extract the two are identical — none of
 *   the nine plans was authored at exactly midnight UTC; the authored
 *   timestamps run 17:33, 18:25, 16:58, 23:41, 19:23, 20:19, 09:29, 09:34,
 *   03:40 — and where they could differ, the fence is the stricter.
 *
 * · `planWorkouts` and `planWeeks` · `sealAuthored`, gated by their PLAN and
 *   not by their own date. This is the axis the first draft of this file got
 *   wrong and it is worth stating why. A prescription for next Tuesday is not
 *   lookahead: it is the thing the engine is being asked whether to change. A
 *   prescription for last Tuesday written by a plan authored tomorrow IS
 *   lookahead, and a date-based fence waves it straight through. What gates an
 *   artifact is when it was WRITTEN, so rows come out only against a
 *   `VisiblePlan` token, and a token is only mintable from a plan the fence
 *   already admitted as evidence at the same moment.
 *
 *   Both row types are outcome-free, which is the invariant that makes reading
 *   them in both time directions safe, and it is checkable rather than
 *   asserted: `SnapWorkout` is `{planId, workoutId, dateISO, type, distanceMi,
 *   paceTargetSPerMi, durationMin, isQuality, isLong, subLabel, spec}` and
 *   `SnapWeek` is `{planId, weekIdx, weekStartISO, phaseId, isCutback, isPeak,
 *   isRaceWeek}`. Every field is authored; none records what happened.
 *   `_asof_fence.test.ts` pins that against the shipped types so a result field
 *   added to either one fails rather than quietly becoming forward-readable.
 *
 * · `races` · `sealCalendar`, projecting the forward side to
 *   `{slug, name, dateISO, distanceMi, priority}`. A race date is published
 *   months ahead and the engine needs the next race boundary; a race RESULT is
 *   a fact about a day that has happened. The projection is where that line is
 *   drawn, and it is drawn in the type: `finishS`, `paceSPerMi`, `avgHr`,
 *   `provisional`, `source` and `totalGainFt` have no representation on the
 *   forward side. `build-input.ts` reads a race result at exactly one place —
 *   `buildSession`, pricing a race that already happened — and that read is on
 *   the evidence side.
 *
 * · `profile` · not sealed, because it is not dated. `lthr`, `hrmax` and
 *   `weeklyFrequency` are current values with no history in the extract, and
 *   sealing an undated value would be theatre. Stated rather than quietly
 *   excluded: this is a genuine hole, and it is CLAUDE.md Rule 10's kind of
 *   hole (a live anchor read at a historical moment) rather than this fence's.
 *   `build-input.ts` uses `lthr` only to price an HR ceiling.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * Everything `asof.ts`'s own header lists, plus one specific to this module: it
 * cannot fail on a collection added to `RealHistorySnapshot` and not added
 * here. A new array would simply be absent from `SealedHistory` and unreachable
 * — the safe failure — but if a future author reaches around to `realHistory()`
 * for it instead of sealing it, no type objects. `_asof_fence.test.ts` covers
 * that with a source scan over the decision path.
 */
import {
  admitPlan, sealAuthored, sealCalendar, sealEvidence,
  type AsOf, type Evidence, type SealedAuthored, type SealedCalendar,
  type SealedEvidence, type VisiblePlan,
} from './asof';
import {
  realHistory,
  type RealHistorySnapshot, type SnapPlan, type SnapRace, type SnapRun,
  type SnapWeek, type SnapWorkout,
} from './snapshot';

/**
 * What a race is allowed to be BEFORE it is run. Identity and schedule, no
 * outcome. This type is the drawn line, and it is why there is no expression
 * anywhere downstream that reads a future finish time: the field does not exist
 * on this side.
 */
export interface ScheduledRace {
  readonly slug: string;
  readonly name: string | null;
  readonly dateISO: string | null;
  readonly distanceMi: string | null;
  readonly priority: string | null;
}

export interface SealedHistory {
  readonly extractedAtISO: string;
  readonly athleteId: string;
  readonly runs: SealedEvidence<SnapRun>;
  readonly plans: SealedEvidence<SnapPlan>;
  readonly races: SealedCalendar<SnapRace, ScheduledRace>;
  readonly planWorkouts: SealedAuthored<SnapWorkout>;
  readonly planWeeks: SealedAuthored<SnapWeek>;
  readonly profile: RealHistorySnapshot['profile'];
}

export function sealHistory(raw: RealHistorySnapshot = realHistory()): SealedHistory {
  return {
    extractedAtISO: raw.extractedAtISO,
    athleteId: raw.athleteId,
    profile: raw.profile,
    runs: sealEvidence('runs', raw.runs, (r) => r.date),
    plans: sealEvidence('plans', raw.plans, (p) => p.authoredISO),
    races: sealCalendar('races', raw.races, (r) => r.dateISO, (r) => ({
      slug: r.slug,
      name: r.name,
      dateISO: r.dateISO,
      distanceMi: r.distanceMi,
      priority: r.priority,
    })),
    planWorkouts: sealAuthored('planWorkouts', raw.planWorkouts),
    planWeeks: sealAuthored('planWeeks', raw.planWeeks),
  };
}

let cached: SealedHistory | null = null;

/** The sealed extract. Read once, shared, never mutated. */
export function sealedHistory(): SealedHistory {
  if (!cached) cached = sealHistory();
  return cached;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PLAN IN FORCE  ·  Rule 14, "a query names the population it reads"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The ONE plan whose prescriptions were live on `dayISO`, as known at `a`.
 *
 * This is `snapshot.ts`'s `planInForceAt` with its no-lookahead half moved into
 * the type system. It no longer filters on `authoredISO <= asOfISO` itself,
 * because it can no longer be handed a plan that failed that test: its input is
 * an `Evidence<SnapPlan>`, which only `plans.before(a)` produces. What is left
 * inside is the Rule 14 half — `archivedISO > dayISO`, which of this runner's
 * 48 plan versions picks the one that was actually in force, rather than
 * reading all of them together and counting 59 quality sessions in one week.
 *
 * It returns a `VisiblePlan` token, which is the only key that opens
 * `planWorkouts` and `planWeeks`.
 */
export function planInForce(
  plans: Evidence<SnapPlan>, dayISO: string, a: AsOf,
): { plan: SnapPlan; visible: VisiblePlan } | null {
  const dayEnd = `${dayISO}T23:59:59Z`;
  const dayStart = `${dayISO}T00:00:00Z`;
  const rows = plans as readonly SnapPlan[];

  const live = rows.filter(
    (p) => p.authoredISO <= dayEnd && (p.archivedISO === null || p.archivedISO > dayStart),
  );
  const pick = live.length > 0
    ? live.reduce((x, y) => (x.authoredISO >= y.authoredISO ? x : y))
    // No plan was live on that day as far as this decision point can see. Fall
    // back to the most recent plan authored on or before it — the plan whose
    // prescriptions the runner was actually following — and return null rather
    // than guessing when even that does not exist.
    : (() => {
      const earlier = rows.filter((p) => p.authoredISO <= dayEnd);
      return earlier.length > 0
        ? earlier.reduce((x, y) => (x.authoredISO >= y.authoredISO ? x : y))
        : null;
    })();

  if (!pick) return null;
  return { plan: pick, visible: admitPlan(plans, pick, a) };
}

/** Every plan version this decision point can see, as tokens. */
export function allVisiblePlans(plans: Evidence<SnapPlan>, a: AsOf): VisiblePlan[] {
  return (plans as readonly SnapPlan[]).map((p) => admitPlan(plans, p, a));
}
