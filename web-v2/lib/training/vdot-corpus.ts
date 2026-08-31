/**
 * THE CORPUS READ · fitness is inferred from the RUNNING, not from one race.
 *
 * The owner's ruling, 2026-08-30, and the reason this file exists:
 *
 *     "Stop anchoring everything into one fucking race when I have so much
 *      data there to pull from. One race is just that, a past race. It's a
 *      good source of info but you know what else is? Every other fucking
 *      run."
 *     "What if another runner doesn't have a past race? We're just gonna fuck
 *      them over? No. We anchor it into the evidence. What's the evidence??
 *      THE FUCKING RUNNING."
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * `bestRecentVdot`'s AUDIT #8 soft cap bounded EVERY training-derived read to
 * `bestRaceRaw + TRAINING_ESTIMATE_SOFT_CAP_VDOT`. `c11abda6` retired the
 * `supersededLead` date veto and moved the owner 44.1 -> 45.1, but 45.1 is
 * literally `44.1 + 1`: the number was still a race's number with a constant
 * added. A ceiling expressed in terms of a race is still rooted in the race,
 * and a runner with no race at all had NO ceiling — two different laws for
 * the same question, decided by whether a `races` row happens to exist.
 *
 * ── What this answers instead ─────────────────────────────────────────────
 *
 * "What fitness level does this runner's TRAINING corroborate?" — a question
 * about the corpus, answerable with zero races, and the same question for
 * every runner. `bestRecentVdot` then bounds an individual training read
 * against THIS rather than against a race.
 *
 * The bound does not go away, and it must not: the 2026-08-11 row in the
 * owner's own history reads VDOT 49.8 off a `movingTimeS` its own mile splits
 * disprove by 9.2% (see `vdot-inputs.ts#clockDisprovedBySplits`). Removing the
 * ceiling outright would have replaced paces that were too slow with paces the
 * runner cannot hold, which is the worse error. What changes is WHAT the
 * ceiling is made of: the runner's own corroborated training, not one race day.
 *
 * ── Corroboration, not cherry-picking ─────────────────────────────────────
 *
 * The read is the Kth-HIGHEST qualifying training VDOT in the window, K =
 * `CORROBORATION_MIN_OBSERVATIONS`. So it is the level at least K independent
 * sessions support, and no single session can set it — which is the property
 * the owner asked for ("many consistent runs outweigh one fast one") and the
 * one the phantom-5K bug (CLAUDE.md §Race-data) is a monument to.
 *
 * Below K observations the answer is a REFUSAL, not a number. A runner three
 * weeks into using the app has a corpus that cannot corroborate anything yet,
 * and `bestRecentVdot` falls back to the race-anchored ceiling for exactly
 * that case. Rule 11: "don't know" and "measured low" are different facts, so
 * the refusal branch of `CorpusRead` carries no `vdot` field at all and
 * `read.vdot` does not compile until the caller has branched — the same
 * type-enforced shape `lib/training/normal-window.ts` uses for Rule 8.
 *
 * ── Rule 8 · why this reader is not filtered for taper and recovery ───────
 *
 * Rule 8 filters readers that answer "what does this runner NORMALLY do".
 * This one answers "what has this runner PROVEN", and its statistic is
 * order-based: the Kth-highest value is a function of the top K observations
 * only, so adding observations BELOW it — which is what a taper day, a
 * recovery jog and a post-race shuffle are — cannot move it by construction.
 * The window's low end is structurally unable to distort this number, so
 * excluding it would change nothing and would add a dependency that could rot.
 *
 * The residual, stated rather than hidden (Rule 22): a taper week's race-pace
 * TUNE-UP is a fast observation inside an excluded window, and it does count
 * here. It is bounded to one vote — it must still find K-1 corroborating
 * sessions before it can move the read at all — and a sharpening session run
 * at race pace is honest evidence of fitness in a way a recovery jog is not.
 * If that ever proves wrong, filter with `excludePrescribedDays` from
 * `normal-window.ts`; do not re-derive a second window here.
 *
 * ── WHAT THIS CANNOT CATCH (Rule 22) ──────────────────────────────────────
 *
 * · A corpus where the SAME error repeats across K sessions — a mis-calibrated
 *   watch, a consistently short-measuring GPS, a treadmill whose belt reads
 *   fast. Corroboration defends against one bad row, not against a bad
 *   instrument. The per-row defences (`clockDisprovedBySplits`,
 *   `lib/runs/coherence.ts`, `passesRunHonestyGate`) are what stand there.
 * · A runner whose training is honest but whose RACING is much weaker.
 *   This number says what the training supports; it does not predict a race.
 * · It is an ORDER statistic, so it is deliberately insensitive to how far
 *   above it the top observation sits. A genuine breakthrough shows up here
 *   only once K sessions confirm it — that is the trade being made, and it is
 *   the direction the owner asked for.
 */

/**
 * How many independent training sessions must agree before the corpus may
 * bound anything.
 *
 * THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING. `Research/` grounds the
 * SHAPE — `Research/01` §"Triggers to retest" prices a single good tempo at
 * "+1 VDOT estimated; field-test within 2 weeks", i.e. one session is a lead
 * and not a fitness number, and §"Field-test protocols" offers "3K + 5K
 * combined ... two time trials on separate days" when the runner "wants higher
 * confidence", which is doctrine saying corroboration in the only place it
 * says it. Neither passage names a count for training runs, because doctrine
 * does not model a training CORPUS at all.
 *
 * Three is ours. It is the smallest number that makes the statistic robust to
 * one bad row and to one lucky day at once — two would fall to a pair of runs
 * on the same flattering course in the same cool week — while staying
 * reachable inside a 60-day window for a runner training three or more days
 * a week, which is every runner this engine composes a plan for.
 *
 * Bound by `CONVENTION.corpus-corroboration-count` in lib/doctrine/registry.ts,
 * which asserts it stays inside the shape above and never advertises itself as
 * measured.
 */
export const CORROBORATION_MIN_OBSERVATIONS = 3;

/**
 * One training-derived observation, as the corpus sees it. Deliberately the
 * smallest shape that lets a caller explain the answer — the corpus read is
 * spent on prescriptions the runner reads, so "which runs said this" has to be
 * answerable without re-deriving anything.
 */
export interface CorpusObservation {
  /** `runs.id` of the row this read came from. */
  id: string;
  /** Run day, ISO. */
  date: string;
  /** The UNCAPPED VDOT this observation derives. */
  vdot: number;
}

/**
 * The corpus's answer. The refusal branch carries no `vdot`, so a caller
 * cannot read one without branching (Rule 11, enforced by the type).
 */
export type CorpusRead =
  | {
      ok: true;
      /** The corroborated level — the Kth-highest observation. */
      vdot: number;
      /** How many qualifying observations the window held. */
      observations: number;
      /** The top K, highest first — the ones that actually set the level. */
      supporting: CorpusObservation[];
    }
  | {
      ok: false;
      /**
       * `no_observations` — the window held no qualifying training read at
       * all. `insufficient_corroboration` — it held some, but fewer than K, so
       * there is evidence and it cannot yet corroborate itself. Three facts,
       * never one (Rule 11): a caller that wants to say "keep running and
       * we'll learn your paces" needs to tell those apart from a failure.
       */
      reason: 'no_observations' | 'insufficient_corroboration';
      observations: number;
    };

/**
 * The corroborated corpus level from a set of uncapped training-derived VDOTs.
 *
 * Pure — no database, no clock, no doctrine lookup. Every judgement about
 * which runs QUALIFY has already happened upstream in `vdotFromRun` /
 * `passesRunHonestyGate` / `clockDisprovedBySplits`; this function's only job
 * is the order statistic, which is why it is testable without a fixture.
 */
export function corroboratedCorpusVdot(
  observations: readonly CorpusObservation[],
  minObservations: number = CORROBORATION_MIN_OBSERVATIONS,
): CorpusRead {
  const usable = observations.filter((o) => Number.isFinite(o.vdot) && o.vdot > 0);
  if (usable.length === 0) return { ok: false, reason: 'no_observations', observations: 0 };
  if (usable.length < minObservations) {
    return { ok: false, reason: 'insufficient_corroboration', observations: usable.length };
  }
  const sorted = [...usable].sort((a, b) => b.vdot - a.vdot);
  return {
    ok: true,
    vdot: sorted[minObservations - 1].vdot,
    observations: usable.length,
    supporting: sorted.slice(0, minObservations),
  };
}
