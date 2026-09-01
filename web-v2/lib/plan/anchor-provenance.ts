/**
 * lib/plan/anchor-provenance.ts · COLD-3 (2026-08-17)
 *
 * Where a persisted VDOT anchor actually came from, and the one predicate that
 * decides whether a reader may treat it as fitness.
 *
 * `conservativeVdotFromMileage` turns a self-reported weekly-mileage bucket into
 * an asserted race performance — a 30 mi/wk answer becomes VDOT 40. That number
 * was persisted as `authored_state.pace_blend.season_anchor_vdot` carrying no
 * mark at all, so once written it was indistinguishable from a race result.
 * Three readers consumed it as demonstrated fitness:
 *
 *   · `adapt.ts` § detectFitnessRegression — compares the anchor to the first
 *     real measurement and reports the difference as fitness LOST
 *   · `recompute-paces.ts` § recomputePacesForPlan — grades measured progress
 *     against the fabricated starting point, and re-derives it when absent
 *   · `generate.ts` § generatePlan — inherits it into every rebuild, forever
 *
 * Deliberately dependency-free (no imports) so the writer (`generate.ts`) and
 * the readers can all reach it without an import cycle — `generate.ts` already
 * imports `recompute-paces.ts`.
 *
 * Doctrine: Design/adaptive-progression-engine.md §A — the fitness model is
 * evidence-only, and "non-evidence leaks" names `conservativeVdotFromMileage`
 * as one by construction. A provisional anchor may still SIZE a plan; it may
 * never be read back as a statement about the runner.
 */

/**
 * Where a VDOT anchor came from.
 *
 * ── SELFREPORT-1 (2026-08-21) · `self_reported_race` ───────────────────────
 *
 * `generate.ts` seeds `bestRecentVdot` from `profile.race_history` when the
 * runner has no measured signal at all (PARITY-1: zero runs, zero races on
 * file, a PR they typed into onboarding). The anchor derived from it was then
 * stamped `measured_vdot`, `season_anchor_provisional: false` — a number the
 * runner typed, presented to every downstream reader as a performance the app
 * observed.
 *
 * It is not the same thing as `provisional_mileage`. That one is FABRICATED:
 * `conservativeVdotFromMileage` turns "30 mi/wk" into VDOT 40, and no
 * performance of any kind stands behind it. A typed race time is a real race
 * the app did not see. So it is its own tier, not a relabelling of either
 * neighbour.
 *
 * Why it still may not be read back as fitness — `Design/engine-doctrine-
 * evidence-and-levers.md` §Rule 3: a race enters as a high-weight observation
 * only after the model estimates HOW REPRESENTATIVE it was, off course profile,
 * heat, pacing quality, taper state, illness, and whether the athlete actually
 * raced all-out. A `race_history` row carries a distance bucket, a time, and a
 * half-year bucket for when it happened. Every one of those factors is
 * unresolvable for it, so the authority the rule would assign cannot be
 * computed, and full authority is the one answer Rule 3 forbids by
 * construction.
 *
 * Bound by `EVIDENCE.self-reported-race-is-not-measured` in the doctrine
 * registry.
 */
export type AnchorSource =
  | 'measured_vdot'
  | 'below_table_anchor'
  | 'self_reported_race'
  | 'provisional_mileage';

/**
 * True when an anchor of this provenance must not be read as fitness.
 * Accepts `unknown` so readers can pass a raw jsonb field straight in.
 *
 * SELFREPORT-1 · this stayed NARROW when `self_reported_race` was added, and
 * the choice is load-bearing. It is the predicate behind the two behaviours
 * that WITHHOLD something from the runner — the calibration intro, which
 * replaces a pace target with an effort cue, and the goal-realism verdict,
 * which declines to say whether the goal is reachable. Both exist because
 * `conservativeVdotFromMileage` invents a performance out of a mileage bucket,
 * and neither is warranted against a race the runner actually ran.
 *
 * The question "may I believe this anchor as fitness" is `isUnverifiedAnchor`
 * below, and that is the one a typed PR fails.
 */
export function isProvisionalAnchor(source: unknown): boolean {
  return source === 'provisional_mileage';
}

/**
 * True when the app never OBSERVED the performance behind this anchor.
 *
 * SELFREPORT-1 · the wider of the two questions, and the one that decides
 * whether a PERSISTED anchor may be believed. `isProvisionalAnchor` above asks
 * the narrower one — is this number fabricated — and it stays narrow on
 * purpose, because the two questions have different right answers:
 *
 *   · USING a typed PR now is fine, and is what a coach would do. It prices
 *     paces and it assesses a goal, both off a real race the runner ran. So the
 *     calibration intro and the goal-realism verdict keep reading
 *     `isProvisionalAnchor`, and neither changes for a self-reported anchor.
 *   · INHERITING it, or GRADING against it, is not fine, and that is where a
 *     wrong baseline compounds silently rather than being corrected by the next
 *     real read. Those readers ask this question instead.
 *
 * The three readers named in this file's header are all of the second kind:
 * `adapt.ts` would report the gap between a typed PR and the first real
 * measurement as fitness LOST; `recompute-paces.ts` would grade measured
 * progress against a starting point nobody measured; `generate.ts` would
 * inherit it into every rebuild forever.
 */
export function isUnverifiedAnchor(source: unknown): boolean {
  return source === 'provisional_mileage' || source === 'self_reported_race';
}

/**
 * The single check a reader runs against a persisted `pace_blend` before
 * believing its `season_anchor_vdot`. Reads BOTH the source string and the
 * explicit boolean so either alone is sufficient, and treats a `pace_blend`
 * with neither (every plan authored before this commit) as non-provisional —
 * those all predate the mileage fallback reaching this column.
 */
export function paceBlendAnchorIsProvisional(paceBlend: unknown): boolean {
  if (paceBlend == null || typeof paceBlend !== 'object') return false;
  const pb = paceBlend as Record<string, unknown>;
  // SELFREPORT-1 · widened from `isProvisionalAnchor` to `isUnverifiedAnchor`.
  // Every caller of this function is asking "may I believe this persisted
  // anchor as the runner's fitness" — inheritance, progress grading, the
  // re-anchor trigger — and a PR the runner typed is not an answer to that
  // question. The narrow predicate is still the right one for the two readers
  // that only USE the anchor; see the note on `isUnverifiedAnchor`.
  return isUnverifiedAnchor(pb.season_anchor_source) || pb.season_anchor_provisional === true;
}

/**
 * How many opening weeks of a provisionally-anchored plan run their quality
 * sessions by EFFORT instead of at a fabricated pace.
 *
 * ── THIS IS A DATA-SUFFICIENCY CONVENTION, NOT A PHYSIOLOGICAL CLAIM ────────
 *
 * No passage in `Research/` states how long a runner should train by feel
 * before a pace is trustworthy, and inventing a citation for this number would
 * repeat exactly the defect `conservativeVdotFromMileage` was caught with — a
 * product convention laundered into a research finding, on the same cold-start
 * code path. So it is labelled as what it is, and `CONVENTION.calibration-
 * intro-window` in the doctrine registry enforces the labelling rather than the
 * value.
 *
 * What the value is chosen against: a threshold session is the one workout that
 * yields a clean VDOT read, and every plan this applies to carries at least one
 * per week. Two weeks is therefore the shortest window that gives the runner two
 * independent chances to produce the evidence that ENDS the window — one, plus
 * one for the week life gets in the way — while costing a runner who never
 * produces it only two sessions of an honest effort cue.
 *
 * The window is a ceiling, not a sentence: `reanchorActivePlan` ends it the day
 * a measured read lands, whether that is day three or day thirteen. If no read
 * lands, the plan returns to its provisional pace — which is the honest outcome,
 * because at that point nothing has changed about what we know.
 *
 * Lifted here from `seed-from-onboarding.ts` (2026-08-17) when the race-prep
 * path adopted the same intro, so both seeders read one number.
 *
 * ── SELFREPORT-1 · why a typed PR does NOT arm this ────────────────────────
 *
 * The intro withholds a pace because the pace was invented. A runner who typed
 * a half-marathon time gave the engine a real performance, and Daniels' whole
 * apparatus is built to price paces off exactly that; running them by feel
 * instead would be withholding something we have rather than something we made
 * up. So the intro stays on `isProvisionalAnchor` (fabricated only) and a
 * self-reported anchor is paced normally.
 *
 * What DOES change for it is inheritance and grading — see `isUnverifiedAnchor`
 * — because those are the readers where an unverified baseline compounds
 * instead of being corrected by the next real read. Flipping this call site to
 * `isUnverifiedAnchor` is the whole of the opposite decision, if the owner
 * prefers it.
 */
export const CALIBRATION_INTRO_WEEKS = 2;

/**
 * Workout types whose pace the calibration intro replaces with an effort cue.
 *
 * The generic quality families only. Deliberately excluded:
 *
 *   · `easy` / `long` / `recovery` — the owner scoped this to the QUALITY
 *     sessions. Those bands are wide, HR-capped, and cued conversationally
 *     already; the defect being fixed is a rep pace presented as a target.
 *   · `race` and `race_week_tuneup` — both are priced off the runner's stated
 *     GOAL, not off the provisional fitness anchor, so neither carries the
 *     fabrication. They are also the two types `recomputePacesForPlan` exempts,
 *     for the same reason.
 */
export const EFFORT_CUED_TYPES: ReadonlySet<string> = new Set([
  'threshold', 'intervals', 'tempo', 'vo2max',
]);

/**
 * AUTHORING-CANONICAL-1 (2026-09-01) · THE CANONICAL SOURCE MODE, TRANSLATED.
 *
 * Authoring used to derive an `AnchorSource` from which legacy cascade tier
 * happened to answer, plus a `bestRecentVdotSelfReported` boolean the loader
 * had to remember to set (and, before `SELFREPORT-1`, did not — so a typed PR
 * shipped stamped `measured_vdot`). Since authoring prices from
 * `resolvePrescribedPaceAnchors`, the fact is already carried, structurally,
 * as `SourceMode` — and `user_prior` means exactly "the runner told us",
 * which is the distinction that boolean existed to reconstruct.
 *
 * The mapping is the same claim in two vocabularies:
 *
 *   direct / vdot_fallback — the app OBSERVED the performance     → measured_vdot
 *   inferred / race_derived — a demonstrated pace the [30,85]
 *                             table cannot represent               → below_table_anchor
 *   user_prior              — a self-report: a typed PR, or an
 *                             onboarding mileage chip              → self_reported_race
 *   population_prior        — nothing runner-specific at all       → provisional_mileage
 *
 * `user_prior` → `self_reported_race` is the one row worth arguing. It is
 * deliberately NOT `provisional_mileage`: `isProvisionalAnchor` gates the
 * calibration intro and the goal-realism verdict, and both exist because
 * `conservativeVdotFromMileage` invents a performance out of nothing. A runner
 * who typed a real PR gave the engine a real performance, and this file's own
 * `CALIBRATION_INTRO_WEEKS` header already argues that case at length. It IS
 * caught by `isUnverifiedAnchor`, which is the reader that governs inheritance
 * and grading — where an unverified baseline compounds.
 *
 * THE ONE PLACE THIS IS COARSER THAN THE OLD DERIVATION: an onboarding weekly-
 * MILEAGE chip with no typed PR also lands on `self_reported_race` rather than
 * `provisional_mileage`, so such a runner no longer gets the calibration intro.
 * `capacity-resolver.ts` reports the two apart in `reasons`
 * (`ONBOARDING_MILEAGE_USER_PRIOR` vs `ONBOARDING_PR_USER_PRIOR`) and a later
 * pass that wants the intro back for the mileage-only case should read that,
 * not re-derive a tier here.
 */
export function anchorSourceFromCapacityMode(mode: string): AnchorSource {
  switch (mode) {
    case 'direct':
    case 'vdot_fallback':
      return 'measured_vdot';
    case 'inferred':
    case 'race_derived':
      return 'below_table_anchor';
    case 'user_prior':
      return 'self_reported_race';
    default:
      return 'provisional_mileage';
  }
}
