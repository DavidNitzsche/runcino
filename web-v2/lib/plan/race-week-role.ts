/**
 * lib/plan/race-week-role.ts · RACEWEEK-2 (2026-09-03) · A RACE WEEK IS ONE OF
 * FOUR THINGS, NOT ONE BOOLEAN.
 *
 * RACEWEEK-1 (`lib/plan/race-week.ts`) fixed the LABEL — `weekContainsRace`
 * answers "does the runner race this week, of any priority" so the Block
 * screen stops calling a 10K week "QUALITY". Its own header said what it
 * deliberately did NOT do: change any COACHING behaviour. `libraryPhaseKey`
 * still switched on the goal race alone; the adaptation guards in `adapt.ts`
 * still read `is_race_week` directly; nothing counted a raced effort as the
 * week's quality session. That is `docs/MASTER_CORE_PRODUCT_PROGRAM.md`'s open
 * decision "does a tune-up race week behave like a race week?", and the
 * owner's ruling — verbatim below — is what this file encodes.
 *
 * ── THE RULING (2026-09-03) ──────────────────────────────────────────────
 *
 * "Do not use one boolean called 'race week' to answer several different
 * coaching questions. Create explicit typed distinctions":
 *
 *   · GOAL   — the runner's stated goal race. Exactly what `is_race_week`
 *     already means (`isGoalRaceWeek` in race-week.ts). Full taper behaviour,
 *     unchanged. Excluded from ordinary volume/quality evaluation.
 *   · TUNEUP — a B-priority race, run as a fitness/pace calibration. Replaces
 *     one major quality stimulus (and the long run too, when it lands there).
 *     NOT a goal-race taper. NOT an automatic whole-week easing. Counts as
 *     quality AND as maximal race evidence — both, not either.
 *   · CONTROLLED — a C-priority race, run as an authored training stressor,
 *     not for time. Shown as a race week; never treated as a taper week. Does
 *     NOT count as maximal race-performance evidence (that distinction is
 *     already owned by `lib/race/effort-authority.ts`'s `selectionAuthority` —
 *     B grades `representative`, C grades `compromised` — and this file does
 *     not re-decide it, only carries the same priority forward).
 *   · NONE   — no race this week at all.
 *
 * `containsRace` is the fifth, orthogonal fact — true for GOAL, TUNEUP and
 * CONTROLLED alike, false only for NONE. It is `weekContainsRace` from
 * `race-week.ts`, called once and reused here (Rule 16): this file must never
 * grow a second answer to "does this week contain a race" that could drift
 * from the label's.
 *
 * ── WHAT THIS FILE DOES NOT OWN ──────────────────────────────────────────
 *
 * It does not decide whether a race's evidence is representative (that is
 * `lib/race/effort-authority.ts` / `lib/training/vdot.ts`'s `bestRecentVdot`,
 * already differentiated by priority and reused, not rebuilt, here). It does
 * not model the Dodgers-10K-plus-long-run transaction — that is
 * `lib/plan/designed-race-weekend.ts`'s `DesignedWeekendGrant`, and a
 * CONTROLLED role is exactly the signal a caller uses to go look for that
 * grant rather than build a second mechanism for the same weekend. It does
 * not decide whether a specific metric is representative for a TUNEUP or
 * CONTROLLED week — that stays a per-caller, per-metric judgement (the
 * ruling's own words: "a volume reader touching this week must be able to
 * say WHY it's non-representative rather than just dropping it"), because a
 * single blanket exclusion here would recreate exactly the defect this file
 * exists to close.
 *
 * ── WHY PRIORITY IS AN INPUT, NOT A RE-DERIVED FACT ──────────────────────
 *
 * `RaceWeekReadable` (race-week.ts) deliberately carries no more than
 * `isRaceWeek` and each day's `type`, so `weekContainsRace` works unchanged
 * on a plan authored before this file existed. Priority is not on that shape
 * — it lives on `races.meta.priority`, joined by date — so a caller that can
 * read it passes it in; a caller that cannot still gets a correct `role`
 * (GOAL or NONE) and a safe, honest fallback for the rest (see below).
 *
 * ── THE UNGRADED / UNKNOWN-PRIORITY FALLBACK ─────────────────────────────
 *
 * `lib/race/effort-authority.ts#selectionAuthority` already ruled on this
 * exact fork for a sibling question ("how much does this race's result
 * prove") and its answer is reused rather than re-decided: an ungraded race
 * is graded at the LOWEST row doctrine has, never the highest, because
 * over-crediting a race as a full taper-worthy goal is the unsafe error and
 * under-crediting it to "treat like a hard workout" is the safe one. This
 * file takes the same side of the same fork: a race the caller cannot grade
 * resolves to `controlled`, never `tuneup` — Rule 11, "I could not tell"
 * must not read as the more license-giving answer.
 */
import { isGoalRaceWeek, weekContainsRace, type RaceWeekReadable } from './race-week';

export type RaceWeekRole = 'goal' | 'tuneup' | 'controlled' | 'none';

/** `races.meta.priority`, already upper-cased and narrowed to the three rows
 *  `Research/00b`'s effort table has (`GRADED_RACE_PRIORITIES` in
 *  effort-authority.ts). `null` means the caller could not read it, or the
 *  row carries an ungraded label (`training_run`, `hilly_excluded`, …). */
export type GradedRacePriority = 'A' | 'B' | 'C';

export interface RaceWeekRoleReadable extends RaceWeekReadable {
  /**
   * This week's own race day(s), by priority. The caller scopes this to
   * races landing inside the week being asked about — this function does not
   * hold a clock or a date range and never re-derives one; it trusts what
   * it is handed, the same contract `weekContainsRace` already keeps.
   *
   * Absent or empty is NOT the same as "no race" — `containsRace` already
   * answers that from `days` — it means "a race is present but its priority
   * could not be read", which resolves to `controlled` per the fallback
   * above rather than refusing outright: `role` must always be answerable,
   * because every caller of `weekFlag`-adjacent code needs SOME answer to
   * render a screen, and `controlled` is the side of the fork that under-
   * claims rather than over-claims.
   */
  raceDayPriorities?: ReadonlyArray<GradedRacePriority | null> | null;
}

export interface RaceWeekRoleResult {
  role: RaceWeekRole;
  /** `weekContainsRace(w)`, verbatim — never re-derived (Rule 16). */
  containsRace: boolean;
  /**
   * The priority the role was resolved from. `'A'` for goal (the column
   * already means this), `'B'`/`'C'` when the caller supplied a graded
   * priority, `null` for `none` and for a race the caller could not grade
   * (Rule 11 — a `controlled` role with a null priority is "I don't know
   * which non-goal race this is", not "it is definitely C").
   */
  priority: GradedRacePriority | null;
}

/**
 * THE resolver. Pure, structural, no database — every input arrives as an
 * argument so it is reproducible from a fixture and falsifiable without a
 * connection.
 */
export function resolveRaceWeekRole(w: RaceWeekRoleReadable): RaceWeekRoleResult {
  if (isGoalRaceWeek(w)) return { role: 'goal', containsRace: true, priority: 'A' };

  const containsRace = weekContainsRace(w);
  if (!containsRace) return { role: 'none', containsRace: false, priority: null };

  const priorities = (w.raceDayPriorities ?? []).filter(
    (p): p is GradedRacePriority => p === 'A' || p === 'B' || p === 'C',
  );
  // A tune-up is graded, never guessed. Only an explicit 'B' earns `tuneup`;
  // everything else that still contains a race — a graded C, an ungraded
  // label, or a priority the caller could not read at all — is `controlled`.
  if (priorities.includes('B')) return { role: 'tuneup', containsRace: true, priority: 'B' };
  return { role: 'controlled', containsRace: true, priority: priorities.includes('C') ? 'C' : null };
}

/** Convenience for a caller that only has the goal-race boolean and the
 *  week's days — the common case, since `raceDayPriorities` requires a join
 *  most readers do not already have loaded. Resolves `goal` / `none` exactly;
 *  resolves any other race to `controlled` (the safe fallback above) rather
 *  than guessing `tuneup`. */
export function resolveRaceWeekRoleWithoutPriority(
  w: RaceWeekReadable,
): RaceWeekRoleResult {
  return resolveRaceWeekRole(w);
}
