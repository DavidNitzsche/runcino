/**
 * combined-stress.ts · THE PLAN'S ONE ANSWER TO "IS THIS WEEKEND TOO MUCH".
 *
 * Brief §5.4 / §3.2.C. Before this file the engine asked "is the race valid?"
 * and "is the long run valid?" separately, and both answered yes for the
 * owner's 2026-09-26 10K followed by a 2026-09-27 15.5-mile long — 21.7 miles
 * with a race effort in them inside 24 hours, which nothing anywhere computed.
 *
 * WHAT THIS OWNS (Constitution: one question, one owner)
 *
 *   · how long a race of a given distance and EFFORT owes before the runner's
 *     next long run   → `returnToLongDays`
 *   · how much long run a day inside that window may carry
 *                     → `longRunFactorAfterRace`
 *   · whether a race is graded as a RACE or as a HARD WORKOUT
 *                     → `raceConsumesLongRunSlot`
 *   · the typed contradictions a finished block is checked against
 *                     → `combinedStressFindings`
 *   · the typed compromise a placement pass records when it resolves one
 *                     → `PlacementCompromise`
 *
 * WHAT IT DOES NOT OWN. It does not place anything and it does not size
 * anything. `embedMidBlockRaces` places; `layoutWeek` sizes. This file states
 * the constraint they must both satisfy and `validateComposedPlan` asserts it
 * on the FINAL shipped week, after embedding and after every post-finalisation
 * adjustment — which is the transaction-level check brief §5.1 asks for and
 * the reason a per-pass check would not have caught the owner's weekend.
 *
 * RULE 9 · CONTINUITY. Every quantity here is continuous in the DAY axis: a
 * race one day earlier moves the allowed long run by one linear step, never
 * flips the plan in kind. The one categorical input is the race's EFFORT
 * GRADE, and that is a genuine kind-difference in the input (`Research/00b`
 * §"Recovery by Effort" gives the C row its own sentence — "treat like a hard
 * workout"), not a threshold on a continuous quantity.
 *
 * Cite: Research/00b-recovery-protocols.md §"Recovery by Distance"
 *       — the "Return to long runs" and "Total recovery days (no quality)" columns
 * Cite: Research/00b-recovery-protocols.md §"Recovery by Effort (A vs. B vs. C Race)"
 * Cite: Research/00b-recovery-protocols.md §"Hard/Easy Alternation"
 * Cite: Research/22-plan-templates.md §"Multi-Race Year Planning"
 */
import type { DistCategory } from './goal-tiers';
import { POST_RACE_RECOVERY_WEEKS } from './goal-tiers';
import { ROLE_POST_QUALITY_FREE_DAYS } from '@/lib/race/race-role';
import { distanceCategoryOrNull, UNKNOWN_DISTANCE_REASON } from '@/lib/race/distance-category';

/* ─────────────────────────────────────────────────────────── effort grading */

/**
 * How much of an A race's recovery a race of each priority owes.
 *
 * `Research/00b` §"Recovery by Effort": A "Full table above", B "60–70% of
 * A-race recovery duration", C "25–50% of A-race recovery duration; treat like
 * a hard workout". The engine takes the TOP of each band — the least
 * conservative reading doctrine licenses — because a recovery window is a
 * floor on rest, and reading the bottom of the band would have the engine
 * prescribe less rest than the citation's own worked example ("For a B-race
 * half marathon, expect 7–10 days of recovery rather than 14").
 *
 * Moved here from `generate.ts` 2026-09-02: it is read by the placement pass,
 * by the no-quality window and by the validator, and a constant three passes
 * share does not belong inside the monolith one of them happens to live in.
 * Bound by `RECOVERY.priority-scale` in lib/doctrine/registry.ts.
 */
export const POST_RACE_PRIORITY_SCALE: Record<'A' | 'B' | 'C', number> = {
  A: 1.0,
  B: 0.70,
  C: 0.50,
};

/**
 * Days of no quality owed after a mid-block tune-up of this distance and
 * priority. Reads the A-race window off `POST_RACE_RECOVERY_WEEKS` (the
 * by-distance table, "Total recovery days (no quality)") and scales it per
 * §"Recovery by Effort".
 *
 * Moved here from `generate.ts` 2026-09-02 alongside the scale it reads, so
 * `validateComposedPlan` can ask the same question the placement pass answers
 * without importing the monolith — which would make the module graph circular,
 * since `generate.ts` imports the validator. One implementation, two callers.
 */
export function postRaceNoQualityDays(distanceMi: number, priority: 'A' | 'B' | 'C'): number {
  const cat = distanceCategoryOrNull(distanceMi);
  if (cat == null) {
    throw new Error(
      `lib/plan/combined-stress.ts: ${UNKNOWN_DISTANCE_REASON} (got ${String(distanceMi)}). ` +
        'Guard the caller with distanceCategoryOrNull and refuse.',
    );
  }
  return Math.round(POST_RACE_RECOVERY_WEEKS[cat] * 7 * POST_RACE_PRIORITY_SCALE[priority]);
}

/**
 * RACEROLE-1 (2026-08-28) · the recovery priority an embedded tune-up's
 * no-quality window is scaled by, once the runner has ANSWERED the race-role
 * card. `Research/00b` §"Recovery by Effort" keys recovery on EFFORT GIVEN,
 * not the calendar letter: an honest ('race') tune-up recovers like an A
 * effort, an MP-workout conversion is a hard session, not a race (C · "treat
 * like a hard workout"), and an unanswered or 'b_effort' tune-up keeps its
 * calendar priority.
 *
 * Moved here from `generate.ts` 2026-09-02: it is now also what decides
 * whether a race consumes the following long-run slot, so it belongs beside
 * `raceConsumesLongRunSlot` rather than three thousand lines from it.
 */
export function effectiveRecoveryPriority(
  e: { priority: 'A' | 'B' | 'C'; plannedRole?: 'b_effort' | 'race' | 'mp_workout' | null },
): 'A' | 'B' | 'C' {
  if (e.plannedRole === 'race') return 'A';
  if (e.plannedRole === 'mp_workout') return 'C';
  return e.priority;
}

/**
 * DAYS OF NO QUALITY OWED AFTER A MID-BLOCK TUNE-UP — the number the placement
 * pass spends and the number the validator checks against.
 *
 * ONE QUANTITY, ONE NAME (Rule 16), and it took a real conflict to find. Two
 * doctrine-bound tables in this engine answer "how long after a race before
 * quality resumes", and they disagree — not about doctrine, about which EDGE
 * of doctrine's band to read:
 *
 *   `ROLE_POST_QUALITY_FREE_DAYS` (lib/race/race-role.ts, pinned by
 *     RACEROLE.recovery-scale) reads the LOWER bound of `Research/00b`
 *     §"Recovery by Distance" · "Total recovery days (no quality)":
 *     half 10, 10K 5, 5K 4 for an A effort.
 *   `POST_RACE_RECOVERY_WEEKS` (lib/plan/goal-tiers.ts, pinned by
 *     RECOVERY.post-race-duration) is WEEK-granular and therefore reads the
 *     UPPER bound: half 14, 10K 7, 5K 0.
 *
 * Both are inside the published band. The same granularity divergence is
 * already recorded in CLAUDE.md for `raceWindowFor`, so this is the third
 * instance of one shape rather than a new defect.
 *
 * The tune-up question takes the DAY-granular table, for two reasons that
 * point the same way. It is the finer instrument — a 10K's window is 5–7 days
 * and a whole-week table cannot express it. And a validator is a backstop
 * (validate.ts §10's own argument): reading the wider window here would refuse
 * plans the composer legitimately authored under the narrower one, which is
 * exactly the failure this function was written to fix — the first cut of §11
 * raised three violations on the owner's block purely because the two tables
 * disagreed.
 *
 * `POST_RACE_RECOVERY_WEEKS` keeps its own consumers: whole-block recovery
 * sizing, and the two long-run-race-pace-finish guards in `generate.ts`, which
 * ask a DIFFERENT question (may this long carry marathon-pace miles) and
 * answer it more conservatively on purpose. Not touched here.
 *
 * A C effort has no column of its own, because `ROLE_POST_QUALITY_FREE_DAYS`
 * exists to carry the two ANSWERED roles. Doctrine gives it one anyway —
 * §"Recovery by Effort": "25–50% of A-race recovery duration" — so it is the
 * A row scaled, un-rounded. Un-rounded because the comparison is `gap <=
 * days`, and rounding 2.5 up to 3 would move a real day for a hair (Rule 9).
 *
 * m/ultra map to the half row: it is the most conservative row the table
 * publishes, and the embedder refuses to place an ultra at all (ULTRA-OUT-1).
 */
export function noQualityDaysAfterRace(distanceMi: number, effectivePriority: 'A' | 'B' | 'C'): number {
  const cat = distanceCategoryOrNull(distanceMi);
  const row = cat === '5k' ? '5k' : cat === '10k' ? '10k' : 'hm';
  const aRace = ROLE_POST_QUALITY_FREE_DAYS[row].race;
  if (effectivePriority === 'A') return aRace;
  if (effectivePriority === 'B') return ROLE_POST_QUALITY_FREE_DAYS[row].b_effort;
  return aRace * POST_RACE_PRIORITY_SCALE.C;
}

/**
 * DAYS UNTIL A LONG RUN IS UNRESTRICTED AGAIN, for an A-effort race.
 *
 * `Research/00b` §"Recovery by Distance", the "Return to long runs" column,
 * read as [earliest, unrestricted]:
 *
 *   5K            Day 4–5      → [4, 5]
 *   10K           Day 5–7      → [5, 7]
 *   Half marathon Day 7–10     → [7, 10]
 *   Marathon      Week 2–3     → [14, 21]
 *
 * `ultra` takes the 100-mile row (Week 4–5 → [28, 35]), the most conservative
 * of the four ultra rows the table publishes. It is unreachable in the engine
 * today — `ULTRA-OUT-1` refuses to embed an ultra as a tune-up and the target
 * race is never an ultra — so it is here to be correct rather than to fire,
 * and it is stated instead of omitted because an absent row would read as zero.
 *
 * The UPPER bound is what the engine spends: it is the day doctrine says the
 * long run is back, and the lower bound is the day it may first be attempted
 * at all. Interpolating between them is `longRunFactorAfterRace`.
 */
export const RETURN_TO_LONG_DAYS: Record<DistCategory, readonly [number, number]> = {
  '5k': [4, 5],
  '10k': [5, 7],
  'hm': [7, 10],
  'm': [14, 21],
  'ultra': [28, 35],
};

/**
 * Days after a race of this distance and EFFORT before a long run is
 * unrestricted. Continuous in the priority scale and in the doctrine band; a
 * number, not a bucket.
 */
export function returnToLongDays(distanceMi: number, priority: 'A' | 'B' | 'C'): number {
  const cat = distanceCategoryOrNull(distanceMi);
  if (cat == null) return 0;
  return RETURN_TO_LONG_DAYS[cat][1] * POST_RACE_PRIORITY_SCALE[priority];
}

/**
 * WHETHER THIS RACE CONSUMES THE FOLLOWING LONG-RUN SLOT.
 *
 * Decided 2026-09-02 and the arbitration between two citations that both
 * apply to the owner's block:
 *
 *   · `Research/00b` §"Recovery by Distance" gives every raced distance a
 *     "Return to long runs" day, which would push the long off the weekend.
 *   · `Research/22` §"Multi-Race Year Planning" and the Pfitzinger pattern
 *     `embedMidBlockRaces` already cites put a Saturday tune-up in front of a
 *     Sunday long on purpose.
 *
 * `Research/00b` §"Recovery by Effort" settles it, because it is the row that
 * distinguishes the two cases in words: a C race is a "hard workout
 * substitute", to be treated "like a hard workout" with "0–3 days easy". A
 * hard workout does not take a race's return-to-long-run window; it takes the
 * §"Hard/Easy Alternation" gap, which `validateComposedPlan` §9 already
 * enforces and which this file feeds the race day into.
 *
 * So: an A or B EFFORT consumes the slot. A C effort does not — it is graded
 * as the week's quality session, which is exactly what the C branch of
 * `embedMidBlockRaces` already makes it.
 *
 * The grade is the EFFECTIVE one (`effectiveRecoveryPriority`), not the
 * calendar letter, so a B race the runner has answered "convert to an MP
 * workout" for is a C here and a B race answered "race it honestly" is an A.
 */
export function raceConsumesLongRunSlot(effectivePriority: 'A' | 'B' | 'C'): boolean {
  return effectivePriority === 'A' || effectivePriority === 'B';
}

/**
 * The fraction of its planned distance a long run may carry `daysAfter` days
 * after a race whose unrestricted-return day is `returnDays`.
 *
 * Linear and monotone in `daysAfter`, reaching 1 exactly at `returnDays`:
 * there is no day on which one day earlier changes the plan in kind, which is
 * Rule 9's requirement. `returnDays <= 0` (an unrecognised distance) returns 1
 * rather than 0 — a read this function could not make must never silently
 * delete a runner's long run (Rule 11).
 */
export function longRunFactorAfterRace(daysAfter: number, returnDays: number): number {
  if (!(returnDays > 0)) return 1;
  if (!(daysAfter > 0)) return 0;
  if (daysAfter >= returnDays) return 1;
  return daysAfter / returnDays;
}

/* ──────────────────────────────────────────────────── typed contradictions */

/**
 * The contradiction codes a finished block is checked against. Typed, per
 * brief §5: "Use typed contradiction codes. Do not silently repair an unsafe
 * week without recording the change."
 */
export type StressContradictionCode =
  /** A race and a long run inside 24 hours, on a grade that consumes the slot. */
  | 'RACE_LONG_24H'
  /** A long run inside the race's return-to-long-run window, carrying more
   *  than `longRunFactorAfterRace` allows. */
  | 'LONG_INSIDE_RETURN_WINDOW'
  /** A quality session inside the race's no-quality window. */
  | 'QUALITY_INSIDE_RECOVERY_WINDOW'
  /** Volume and long-run duration both advance materially in one build week.
   *  Doctrine's one-primary-stressor rule (brief §5.1). */
  | 'COMPOUND_PRIMARY_STRESSORS';

/**
 * The named outcomes a placement pass may record when it resolves a
 * contradiction. Brief §5.5's set, plus the one this file's own arbitration
 * adds.
 */
export type PlacementCompromise =
  | 'MOVE_WITHIN_WEEK'
  | 'REDUCE_DOSE'
  | 'REPLACE_STIMULUS'
  | 'DROP_LOWEST_PRIORITY'
  | 'REFUSE_UNSAFE_WEEK'
  /** The race is graded as a hard workout, so the following long run stands.
   *  Not a compromise the engine made under duress — a doctrine reading it
   *  can defend (`Research/00b` §"Recovery by Effort", C row). */
  | 'ACCEPT_AS_HARD_WORKOUT';

/**
 * One recorded placement decision. Written to
 * `authoredState.placement_compromises` so the block carries its own answer to
 * "why is this weekend shaped like this", including the decisions where
 * nothing changed. Brief §5.5's typed outcome, plus its citation.
 */
export interface PlacementRecord {
  code: PlacementCompromise;
  raceSlug: string;
  raceName: string;
  raceDateISO: string;
  /** The day the decision landed on. */
  dateISO: string;
  detail: string;
  citation: string;
}

export interface StressFinding {
  code: StressContradictionCode;
  /** The week this belongs to, for the validator's message. */
  weekStartISO: string;
  /** The day the contradiction lands on. */
  dateISO: string;
  /** Coach-register statement of what is wrong, with the number. */
  message: string;
  /** True when the block MAY NOT ship carrying this. Advisory findings are
   *  reported and do not throw — the same split `planDosingFindings` uses. */
  enforced: boolean;
}

/** A race as the stress check sees it: when, how far, and how hard it counts. */
export interface StressRace {
  dateISO: string;
  distanceMi: number;
  name: string;
  effectivePriority: 'A' | 'B' | 'C';
}

/** A prescribed day as the stress check sees it. */
export interface StressDay {
  dateISO: string;
  weekStartISO: string;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
}

function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);
}

/**
 * THE FINAL-PLAN COMBINED-STRESS CHECK.
 *
 * Walks every embedded race against every prescribed day after it and reports
 * what doctrine says may not stand. Pure: no clock, no database, no plan
 * mutation. `validateComposedPlan` adapts a `ComposePlanResult` into these
 * shapes and raises the enforced findings.
 *
 * `postRaceNoQualityDays` is passed in rather than imported so this file stays
 * a leaf — `generate.ts` owns that function today and importing it here would
 * make the module graph circular. That is a wiring compromise, not a second
 * owner: there is exactly one implementation and this file never writes one.
 */
export function combinedStressFindings(args: {
  races: readonly StressRace[];
  days: readonly StressDay[];
  /** Days of no quality owed after this race. Injected — see the note above. */
  noQualityDays: (distanceMi: number, priority: 'A' | 'B' | 'C') => number;
  /** Weeks fully in the past are sealed and are not re-graded. */
  todayISO: string;
}): StressFinding[] {
  const findings: StressFinding[] = [];
  const byDate = [...args.days].sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  for (const race of args.races) {
    const consumes = raceConsumesLongRunSlot(race.effectivePriority);
    const returnDays = returnToLongDays(race.distanceMi, race.effectivePriority);
    const noQuality = args.noQualityDays(race.distanceMi, race.effectivePriority);

    for (const d of byDate) {
      if (d.dateISO <= race.dateISO) continue;
      if (d.dateISO < args.todayISO) continue;              // sealed
      if (d.type === 'race') continue;                      // another race owns its own row
      const gap = daysBetweenISO(race.dateISO, d.dateISO);
      if (gap > Math.max(returnDays, noQuality)) break;      // dates ascend; nothing further can bind

      if (d.isLong && d.distanceMi > 0 && consumes) {
        const allowed = longRunFactorAfterRace(gap, returnDays) * d.distanceMi;
        // The finding is about the SHIPPED distance against what the window
        // allows for it, so it fires on the day's own number rather than on a
        // remembered "planned" one the validator cannot see.
        if (gap < returnDays) {
          findings.push({
            code: gap <= 1 ? 'RACE_LONG_24H' : 'LONG_INSIDE_RETURN_WINDOW',
            weekStartISO: d.weekStartISO,
            dateISO: d.dateISO,
            message:
              `${d.distanceMi}mi long run ${gap} day(s) after ${race.name} ` +
              `(${race.distanceMi}mi, ${race.effectivePriority} effort) · ` +
              `Research/00b "Return to long runs" puts the long back at day ` +
              `${returnDays.toFixed(1)} for this effort, which allows ` +
              `${allowed.toFixed(1)}mi here`,
            enforced: true,
          });
        }
      }

      if (d.isQuality && !d.isLong && d.type !== 'shakeout' && gap <= noQuality) {
        findings.push({
          code: 'QUALITY_INSIDE_RECOVERY_WINDOW',
          weekStartISO: d.weekStartISO,
          dateISO: d.dateISO,
          message:
            `${d.type} on day ${gap} after ${race.name} · Research/00b ` +
            `"Total recovery days (no quality)" owes ${noQuality} day(s) at this effort`,
          enforced: true,
        });
      }
    }
  }
  return findings;
}

/* ════════════════════════════════════════════════════════════════════════════
 * ONE PRIMARY STRESSOR PER WEEK · BINDING (STRESSOR-1, 2026-09-02)
 *
 * David's ruling, verbatim:
 *
 *   "Make one primary stressor per day binding by default. Exceptions must be
 *    explicitly typed, intentionally authored, and covered by an invariant.
 *    Accidental combinations must fail plan generation rather than ship as
 *    warnings."
 *
 * ── WHERE THE TWO HALVES OF THAT RULING LIVE ────────────────────────────────
 *
 * The PER-DAY half was already binding before this change and is not here:
 * `validateComposedPlan` §9 (SP-7, stimulus-gap adjacency, `Research/00b`
 * §"Hard/Easy Alternation") pushes onto `violations`, which throws, so two
 * hard stimuli landing on one day or on adjacent days already refuses a plan.
 * Verified 2026-09-02 rather than assumed.
 *
 * This function is the PER-WEEK half — the one that was advisory, and the one
 * `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` states in those words: "progress
 * one primary stressor at a time whenever possible ... that makes it impossible
 * to know what caused success or failure and creates unnecessary load spikes."
 *
 * ── WHY THE OLD TEST WAS THE WRONG TEST ─────────────────────────────────────
 *
 * It fired when weekly volume AND long-run MILES both rose more than 5%. That
 * is not two stressors, it is one stressor counted twice: `layoutWeek` sizes
 * the long as `min(weeklyMi × longShare, peakLongMiBand[1])`, and
 * `Research/00a` §"Practical base-building rules" defines the long run that way
 * — "Long run grows | Up to 25–30% of weekly volume". Hold the share and raise
 * the week, and the long HAS to rise; that is the volume lever expressed on the
 * long day, and calling it a second stressor would refuse every ramping week
 * the engine has ever authored.
 *
 * Measured on the owner's live CIM block the night this landed, the old test
 * fired twice — on weeks whose long-run SHARE moved 2.3% and 2.6%, which is
 * inside the composer's own half-mile rounding grid. Binding it as written
 * would have refused his block for arithmetic.
 *
 * ── WHAT BINDS NOW ──────────────────────────────────────────────────────────
 *
 * A week is a compound progression when weekly volume advances materially AND
 * the LONG-RUN SHARE advances materially. The share is the long run's
 * independent lever: raising it is a decision to make the long harder relative
 * to the week, over and above whatever the week itself did.
 *
 * MATERIALITY IS DOCTRINE'S OWN BAND WIDTH, in PERCENTAGE POINTS of the week.
 * `Research/00a` §"Practical base-building rules" states the long run as "Long
 * run grows | Up to 25–30% of weekly volume" — a band five points wide, and
 * doctrine states no finer resolution on this quantity than that. A share move
 * smaller than the width of doctrine's own latitude is inside it, not a
 * progression past it. This is the same discipline CLAUDE.md records under
 * Rule 9 as "a band has ONE edge": a band may be spent, once.
 *
 * A relative threshold was tried first and is wrong here. Five percent OF the
 * share is 1.5 points on a 30% share and 1.0 point on a 20% one, so the same
 * rule would have been three times stricter on a marathoner than on a 5K
 * runner for no reason doctrine gives.
 *
 * THE SECOND FLOOR IS THE AUTHORING GRID, and it is not this file's invention.
 * `generate.ts`'s `SPIKE_MIN_COHERENT_ANCHOR_MI` already declines to judge a
 * long run below 5 mi, with a written argument: distances are authored on a
 * half-mile grid, and below ~5 mi a single grid step is a larger move than
 * doctrine's own ratio, so a check there is "an anchor-dependent, incoherent
 * guard, not a strict one, which is worse than no guard at that grid
 * resolution because it looks like protection and is not." Exactly the same
 * degeneracy applies to the share, and measured on the corpus it is exactly
 * where the residue landed: with the band applied, 106 archetype weeks still
 * fired and EVERY ONE was a long run stepping 3.5 → 4.5 or 4.0 → 5.0 on a
 * 10-11 mi/wk block. Those weeks are recorded as `BELOW_GRID_RESOLUTION`
 * rather than passed silently — Rule 11: "I cannot tell" is a third answer.
 *
 * The floor is DUPLICATED here rather than imported, and that is a wiring
 * compromise the module graph forces: `generate.ts` imports this file, so this
 * file cannot import it back, and `validate.ts` cannot import `generate.ts`
 * either. It is not a second owner — `_combined_stress.test.ts` asserts the two
 * constants are EQUAL, so a drift fails the build rather than living quietly.
 *
 * ── RULE 9 · WHERE THE REAL PLANS SIT RELATIVE TO THE EDGE ──────────────────
 *
 * A binding threshold on a continuous quantity is a cliff by construction: at
 * 4.9% the plan ships and at 5.1% it is refused. Rule 9's standard is that no
 * real input may sit ON the edge, and that is measured, not asserted —
 * `_combined_stress.test.ts` walks the whole archetype corpus and reports the
 * largest share-rise any material-volume week actually authors, so the margin
 * is a number in the log rather than a hope. If the composer ever authors near
 * 5%, that is a finding about the composer.
 *
 * ── THE TYPED EXCEPTIONS (his second sentence) ──────────────────────────────
 *
 * Every exception is a NAMED CODE with a citation, and every one that fires is
 * RECORDED and returned. "No finding" and "a finding that was excused" are
 * different facts (Rule 11), and an exception nobody can count is a hole.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · INTENSITY. A week that raises volume and quality DENSITY together is
 *     invisible: `ComposedWeek` carries miles and session labels, not a scalar
 *     for how hard a session is. `OverloadTrajectory` logs the rep-shape levers
 *     separately and nothing joins the two.
 *   · A SHARE RISE WITH FLAT VOLUME. That is the long-run lever moving ALONE,
 *     which is exactly one primary stressor and is the correct answer, not an
 *     oversight.
 *   · WHETHER THE ONE STRESSOR IS THE RIGHT ONE. Choosing between volume and
 *     duration is the Adaptation Engine's question
 *     (`docs/ADAPTATION_PROGRESSION_DOCTRINE.md`), not this file's.
 *   · A WEEK WITH NO LONG RUN. A share needs a long run to be a share of; those
 *     weeks are skipped rather than counted as zero (Rule 11).
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The typed exceptions. Each is a real doctrine reading, and the enum exists so
 * an intentional combination can be AUTHORED rather than the rule weakened.
 */
export type CompoundStressExemption =
  /** This week or the one before it is a prescribed deload. `Research/00a`
   *  §"Volume progression rules" · "Down weeks | Every 3–4 wk, reduce by
   *  20–30%" — the week either side of a planned reduction is absorbing or
   *  rebounding, and neither is a progression. */
  | 'PLANNED_CUTBACK'
  /** Neither axis exceeds a level already reached earlier in this block. A
   *  return to a load the runner has already run inside this same block is the
   *  other half of the down-week row above: the reduction was the plan's, and
   *  so is the recovery of it. */
  | 'REBOUND_TO_HELD_LEVEL'
  /** The long run grew only as far as the week's own step carried it — the
   *  share held. `Research/00a` §"Practical base-building rules" · "Long run
   *  grows | Up to 25–30% of weekly volume". One stressor, two numbers. */
  | 'LONG_COUPLED_TO_VOLUME'
  /** Explicitly authored, per week, by a caller that states why. Nothing in the
   *  engine authors one today; it exists so a future intentional combination is
   *  a typed decision on the record instead of a threshold somebody widened. */
  | 'AUTHORED_COMBINATION'
  /** The long run is below the authoring grid's coherence floor, so a share
   *  move there cannot be told from rounding. A REFUSAL TO JUDGE, not a pass —
   *  the same posture, the same floor and the same argument as
   *  `generate.ts#SPIKE_MIN_COHERENT_ANCHOR_MI`. */
  | 'BELOW_GRID_RESOLUTION';

/** One excused week, with the reading that excused it. Written alongside the
 *  findings so a block can be asked "how many combinations did you allow, and
 *  on what grounds" — Rule 11, and his "covered by an invariant". */
export interface CompoundExemptionRecord {
  code: CompoundStressExemption;
  weekStartISO: string;
  detail: string;
  citation: string;
}

export interface CompoundProgressionResult {
  /** ENFORCED. `validateComposedPlan` raises these; a block carrying one does
   *  not ship. */
  findings: StressFinding[];
  /** Every week where two axes rose and a typed exception excused it. */
  exemptions: CompoundExemptionRecord[];
}

/**
 * Fraction of the previous week a volume rise must exceed to count as the
 * volume lever moving. Unchanged from the advisory version.
 */
export const MIN_VOLUME_STEP = 0.05;
/**
 * PERCENTAGE POINTS of weekly volume the long-run share must rise by to count
 * as the long-run lever moving independently. 0.05 = five points.
 *
 * This is the width of `Research/00a` §"Practical base-building rules"' own
 * band — "Long run grows | Up to 25–30% of weekly volume" — and doctrine states
 * no finer resolution on the quantity. See the materiality note above.
 */
export const MIN_SHARE_POINTS = 0.05;
/**
 * The smallest long run this check will judge, in miles.
 *
 * MIRRORS `generate.ts#SPIKE_MIN_COHERENT_ANCHOR_MI` and must stay equal to
 * it — `_combined_stress.test.ts` asserts that, because the module graph
 * forbids importing it (see the note above). Same convention, same argument,
 * same authoring grid.
 */
export const SHARE_MIN_COHERENT_LONG_MI = 5;

const CITE_DOWN_WEEKS = 'Research/00a-distance-running-training.md §"Volume progression rules" · "Down weeks"';
const CITE_LONG_SHARE = 'Research/00a-distance-running-training.md §"Practical base-building rules" · "Long run grows"';
const CITE_GRID_FLOOR = 'lib/plan/generate.ts#SPIKE_MIN_COHERENT_ANCHOR_MI · Research/00a §"Practical load rules"';

export interface CompoundWeek {
  startISO: string;
  phase: string;
  weeklyMi: number;
  longMi: number;
  isCutback?: boolean;
}

export function compoundProgressionCheck(args: {
  weeks: readonly CompoundWeek[];
  /** Weeks whose combination is intentionally authored, keyed by `startISO`,
   *  each carrying the reason it was authored. An entry with no reason is
   *  rejected rather than honoured — an untyped exception is the thing his
   *  ruling forbids. */
  authoredCombinations?: Readonly<Record<string, string>>;
  volumeStepPct?: number;
  /** PERCENTAGE POINTS, not a fraction of the share. See `MIN_SHARE_POINTS`. */
  sharePoints?: number;
}): CompoundProgressionResult {
  const volStep = args.volumeStepPct ?? MIN_VOLUME_STEP;
  const sharePoints = args.sharePoints ?? MIN_SHARE_POINTS;
  const findings: StressFinding[] = [];
  const exemptions: CompoundExemptionRecord[] = [];

  // The largest weekly volume and long run already reached BEFORE each week,
  // for `REBOUND_TO_HELD_LEVEL`. Walked forward so a week is only ever compared
  // against load that precedes it in this block.
  let priorMaxWeekly = 0;
  let priorMaxLong = 0;

  for (let i = 1; i < args.weeks.length; i++) {
    const prev = args.weeks[i - 1];
    const cur = args.weeks[i];
    priorMaxWeekly = Math.max(priorMaxWeekly, args.weeks[i - 1].weeklyMi);
    priorMaxLong = Math.max(priorMaxLong, args.weeks[i - 1].longMi);

    // Rule 11 · a week with no long run has no share to compare, which is a
    // different fact from a share that did not move. Skipped, not zeroed.
    if (!(prev.weeklyMi > 0) || !(prev.longMi > 0)) continue;
    if (!(cur.weeklyMi > 0) || !(cur.longMi > 0)) continue;

    const dVol = (cur.weeklyMi - prev.weeklyMi) / prev.weeklyMi;
    const prevShare = prev.longMi / prev.weeklyMi;
    const curShare = cur.longMi / cur.weeklyMi;
    const dShare = curShare - prevShare;            // PERCENTAGE POINTS
    const dLong = (cur.longMi - prev.longMi) / prev.longMi;

    if (!(dVol > volStep)) continue;               // the volume lever did not move

    // The authoring grid's coherence floor, checked BEFORE the band so a week
    // this function cannot honestly judge is recorded as a refusal rather than
    // silently counted as coupled. Gated on the ANCHOR (`prev.longMi`), which
    // is what `enforceSpikeRule` gates on.
    if (prev.longMi < SHARE_MIN_COHERENT_LONG_MI) {
      if (dShare > sharePoints) {
        exemptions.push({
          code: 'BELOW_GRID_RESOLUTION',
          weekStartISO: cur.startISO,
          detail:
            `long ${prev.longMi}→${cur.longMi}mi is under the ${SHARE_MIN_COHERENT_LONG_MI}mi grid-coherence ` +
            `floor · one half-mile step there is ${((0.5 / prev.longMi) * 100).toFixed(0)}% of the long run, ` +
            `so a ${(dShare * 100).toFixed(1)}-point share move cannot be told from rounding`,
          citation: CITE_GRID_FLOOR,
        });
      }
      continue;
    }

    if (!(dShare > sharePoints)) {
      // Both numbers rose, and the reason is one lever. Recorded rather than
      // silently passed, because "we looked and it was coupled" is a fact worth
      // being able to count.
      if (dLong > 0) {
        exemptions.push({
          code: 'LONG_COUPLED_TO_VOLUME',
          weekStartISO: cur.startISO,
          detail:
            `volume +${(dVol * 100).toFixed(1)}%, long +${(dLong * 100).toFixed(1)}%, ` +
            `long-run share ${(prevShare * 100).toFixed(1)}% → ${(curShare * 100).toFixed(1)}% ` +
            `(${dShare >= 0 ? '+' : ''}${(dShare * 100).toFixed(2)} points, under the ${(sharePoints * 100).toFixed(0)}-point band)`,
          citation: CITE_LONG_SHARE,
        });
      }
      continue;
    }

    // Both levers moved. Which typed exception, if any, covers it?
    const authored = args.authoredCombinations?.[cur.startISO];
    if (authored != null && authored.trim().length > 0) {
      exemptions.push({
        code: 'AUTHORED_COMBINATION',
        weekStartISO: cur.startISO,
        detail: `volume +${(dVol * 100).toFixed(1)}%, share +${(dShare * 100).toFixed(1)} points · ${authored}`,
        citation: 'authored by the composer',
      });
      continue;
    }
    if (cur.isCutback || prev.isCutback) {
      exemptions.push({
        code: 'PLANNED_CUTBACK',
        weekStartISO: cur.startISO,
        detail:
          `volume +${(dVol * 100).toFixed(1)}%, share +${(dShare * 100).toFixed(1)} points across a planned ` +
          `deload (${prev.isCutback ? 'the week before' : 'this week'} is a cutback)`,
        citation: CITE_DOWN_WEEKS,
      });
      continue;
    }
    if (cur.weeklyMi <= priorMaxWeekly && cur.longMi <= priorMaxLong) {
      exemptions.push({
        code: 'REBOUND_TO_HELD_LEVEL',
        weekStartISO: cur.startISO,
        detail:
          `volume +${(dVol * 100).toFixed(1)}%, share +${(dShare * 100).toFixed(1)} points, but ` +
          `${cur.weeklyMi}mi ≤ the ${priorMaxWeekly}mi and ${cur.longMi}mi ≤ the ${priorMaxLong}mi ` +
          `already run in this block`,
        citation: CITE_DOWN_WEEKS,
      });
      continue;
    }

    findings.push({
      code: 'COMPOUND_PRIMARY_STRESSORS',
      weekStartISO: cur.startISO,
      dateISO: cur.startISO,
      message:
        `weekly volume +${(dVol * 100).toFixed(1)}% (${prev.weeklyMi}→${cur.weeklyMi}mi) AND the long-run ` +
        `share +${(dShare * 100).toFixed(1)} points (${(prevShare * 100).toFixed(1)}%→${(curShare * 100).toFixed(1)}%, ` +
        `long ${prev.longMi}→${cur.longMi}mi) both advance · doctrine progresses one primary stressor at a ` +
        `time (docs/ADAPTATION_PROGRESSION_DOCTRINE.md) · hold one axis, or author the combination`,
      enforced: true,
    });
  }
  return { findings, exemptions };
}
