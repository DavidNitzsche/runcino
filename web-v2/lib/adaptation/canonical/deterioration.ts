/**
 * lib/adaptation/canonical/deterioration.ts · MEANINGFUL LATE-SESSION
 * DETERIORATION, and the difference between one bad session and a pattern.
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q13.
 *
 * ── THE TWO THINGS Q13 IS MOST INSISTENT ABOUT ─────────────────────────────
 *
 * 1 · "Apply only to comparable work." A workout with different prescribed
 *     phases has no meaningful thirds, and Q13 says so directly: "Do not infer
 *     deterioration from whole-run thirds when the workout contains different
 *     prescribed phases." `ComparableThirds.comparable` carries that judgement
 *     from the evidence layer, and this file refuses rather than guesses when
 *     it is false.
 *
 * 2 · "'Repeated' means ≥2 relevant SESSIONS in the window, not two segments in
 *     one run." Two collapsing reps inside one workout is one deteriorated
 *     session. The distinction matters because the lever contracts gate on
 *     REPEATED deterioration, and counting segments would let a single ragged
 *     session block a progression Q13 explicitly says it must not:
 *
 *         "One deteriorated session reduces confidence; it must not
 *          independently block progression unless the deterioration is extreme
 *          or that session was the direct prerequisite."
 *
 * ── Q29 · TRUNCATION AND THE ABSENCE OF EVIDENCE ───────────────────────────
 *
 *     "not usable for late-session deterioration · absence of a captured late
 *      decline is not evidence of durability"
 *
 * A truncated activity therefore returns UNKNOWN here, never CLEAN. Returning
 * CLEAN would let a watch dying at mile 18 read as a strong finish, which is
 * Rule 11's collapse in its most expensive form: the missing data would become
 * positive evidence for a longer long run.
 *
 * ── DETERIORATION-SEVERITY-1 (2026-09-05) · THE WORD "EXTREME", MEASURED ───
 *
 * Q13's sentence above has two escapes and named neither: one deteriorated
 * session may block "if the deterioration is EXTREME or that session was the
 * direct prerequisite". Until this change nothing in the engine could measure
 * either, so `deteriorationPattern` said one session "reduces confidence
 * without blocking progression" while `volume-evidence/admit.ts` refused the
 * whole week on `deterioratedCount > 0`. The two sentences contradicted each
 * other, and the contradiction was not academic: it was the ONLY reason the
 * one week on the reference account with a real admissible surplus
 * (2026-06-15, 47.3 mi against 45.5 prescribed) contributed nothing.
 *
 * This file now measures HOW BADLY. `severityFrac` is `Research/03` §12's
 * Pa:HR decoupling, the same quantity Q13's own third signal thresholds, and
 * §12 carries a four-row band table over it. The 8% row reads "Endurance gap;
 * build base before progressing", which is doctrine saying in its own words
 * that a progression is not licensed there — so that is what EXTREME means,
 * and `DETERIORATION_SEVERITY_EXTREME_FRAC` is its lower edge rather than a
 * number anybody picked.
 *
 * WHAT THIS FILE STILL DOES NOT MEASURE, said plainly rather than left to be
 * discovered: Q13's OTHER escape. Nothing here knows whether a session was the
 * "direct prerequisite" for the progression being considered, because that is
 * a property of the QUESTION being asked and not of the session. A caller that
 * needs it has to supply it; no caller does today, so that escape is unused
 * and a prerequisite session currently blocks only on severity or repetition
 * like any other.
 *
 * ── PAHR-QUANTITY-1 (2026-09-05) · DOES §12 MEASURE WHAT THIS FILE MEASURES ─
 *
 * Ordered overnight, verbatim: "First establish whether Research/03 §12
 * measures the SAME QUANTITY as the app." It does not, on two of four axes,
 * and the file already said so honestly before this change — the verdict here
 * is what to DO about that, not a discovery that it was wrong.
 *
 *   FORMULA        SAME, exactly, not to first order. `paHrDecouplingFrac`
 *                  below is `(paceFin/paceMid)*(hrFin/hrMid) - 1`, and
 *                  substituting `speed = 1/pace` into §12's own
 *                  `(EF1/EF2 - 1)` with `EF = speed/HR` reduces to that exact
 *                  product. `_deterioration_severity.test.ts` §1 asserts this
 *                  independently from the doc's own units. No divergence.
 *
 *   WINDOW         DIFFERENT. §12: "Compare first vs. second half of a steady
 *                  aerobic run (60–90 min)." This file, per Q13's own text:
 *                  middle third against final third, excluding the first
 *                  (warm-up). Halving a run WITH a warm-up folds the slow
 *                  opening miles into the "before" side; thirding it removes
 *                  them from the comparison entirely. Neither is wrong for
 *                  its own purpose — Q13's purpose is "did this session fall
 *                  apart at the end", §12's is "is this runner's aerobic
 *                  engine holding at a fixed effort" — but they are not
 *                  interchangeable, and nothing in this repo can derive one
 *                  from the other after the fact.
 *
 *   DURATION FLOOR DIFFERENT, and this is the one this file did NOT already
 *                  say. §12 requires the compared run to BE 60-90 minutes.
 *                  `lib/training/aerobic-decoupling.ts` — the app's OTHER,
 *                  pre-existing Pa:HR implementation, built independently for
 *                  the durability/decoupling-trend surfaces — enforces
 *                  exactly this floor via `DECOUPLING_PROTOCOL_MIN_MINUTES`
 *                  (imported below, not re-typed: Rule 16). Until this change
 *                  nothing in the canonical engine's thirds path enforced any
 *                  duration floor at all — `buildThirds` only requires 6
 *                  splits, which is 6 minutes for a 1:00/mi runner. A fade
 *                  measured on a 25-minute tempo run was being compared
 *                  against a band table §12 states for a 60-90 minute steady
 *                  effort, silently.
 *
 *   STEADY-EFFORT  DIFFERENT, same discovery. §12's protocol is implicitly a
 *   PRECONDITION    FIXED-PACE run (a drift TEST). `computeAerobicDecoupling`
 *                  enforces this too — it refuses when its two windows differ
 *                  by more than 20 s/mi, because a progression, fartlek or
 *                  race is a DELIBERATE pace change, not drift, and comparing
 *                  the two would price effort as fatigue. The thirds path has
 *                  no equivalent: a fast-finish long run (a normal,
 *                  Daniels-doctrine prescription — see `Research/00a`) will
 *                  show a large third-to-third "decoupling" that is the
 *                  runner executing the workout as written.
 *
 *   TERRAIN/HEAT   NEITHER implementation corrects for either before
 *                  computing decoupling. §12 itself: "Heat adds 2-5%
 *                  artefactually — control conditions." A hilly final third
 *                  reads as fatigue for the same reason a fast-finish reads
 *                  as fatigue: the metric cannot tell a harder EFFORT from a
 *                  harder session.
 *
 * ── THE CALL, ARGUED RATHER THAN DECLARED ─────────────────────────────────
 *
 * Per the owner's decision 4: keep citing §12's 8% exactly (already true —
 * `DETERIORATION_SEVERITY_EXTREME_FRAC` still reads it verbatim, unmoved) and
 * do not make it a binary refusal (already true, `deteriorationConfidenceWeight`
 * ramps). Per decision 5, this file now determines the transfer rather than
 * assuming it, and picks (a)+(b) from the three options rather than (c):
 *
 *   · The FORMULA needs no correction — it is the same quantity, proven, not
 *     asserted.
 *   · The WINDOW is NOT reconciled to half-vs-half, because Q13 does not ask
 *     §12's question. Q13 asks "did this specific session fall apart late",
 *     which is inherently a THIRDS question — collapsing it to halves would
 *     average the fade into the front half and could hide it. The 5%/8%
 *     NUMBERS transfer (the formula is identical and the physiology a given
 *     ratio represents does not depend on which two windows produced it); the
 *     VALIDITY PRECONDITIONS §12 states for trusting that ratio at all do not
 *     transfer automatically and are what were missing.
 *   · So the fix is (a): close the precondition gap. Every reading this file
 *     now returns for `severityFrac` carries a continuous
 *     `readabilityFrac` alongside it — `decouplingReadabilityFrac` below —
 *     built from exactly §12's own stated preconditions (duration,
 *     ATTEMPTED via `analyzedDurationMin`; steady effort NOT attempted, see
 *     the open item at the bottom of this section; heat and terrain, both
 *     ATTEMPTED). It is POLICY_ASSUMPTION where the ramp shape or an edge is
 *     chosen (the 30-minute floor, the 20 s/mi terrain ceiling, the 60°F
 *     comfort floor) and CALCULATED_PHYSIOLOGY where a doctrine number is
 *     reused verbatim (the 60-minute ceiling, the 77°F/25°C heat trigger, the
 *     4 s/mi terrain materiality floor) — see `decouplingReadabilityFrac`'s
 *     own doc for the ledger. `weight.ts`'s `deteriorationConfidenceWeight`
 *     folds readability in MULTIPLICATIVELY against the existing severity
 *     ramp, so a session this file cannot vouch for costs LESS, continuously,
 *     never more, and never categorically nothing-or-everything.
 *   · Bands are NOT re-derived from scratch (rejecting option (c)): a
 *     from-scratch derivation would need exactly the athlete-specific
 *     baseline data (his own decoupling distribution, at his own paces, in
 *     his own conditions) that does not exist yet, and inventing bands to
 *     replace a cited one is the tuning CLAUDE.md Rule 21 forbids in a new
 *     costume.
 *
 * ── STEADYEFFORT-1 (2026-09-06) · THE GAP ABOVE, CLOSED ────────────────────
 *
 * David's own instruction: "Build the missing steady-effort precondition
 * from the prescribed phase structure." `ComparableThirds.comparable` is
 * still the coarse split-count proxy `canonical-shadow/live-input.ts`'s own
 * header names, and closing THAT properly still needs the evidence layer to
 * carry per-third pace intent, which remains a bigger change than this file
 * owns. What closed instead, and what was actually asked for: a SEPARATE,
 * continuous readability factor — `steadyEffortReadabilityFrac` below — built
 * from the workout's own `sub_label` prescription string (already parsed
 * elsewhere by `lib/plan/spec-builder.ts#extractLongSegments` for exactly
 * this shape: "3mi @ M + 2mi @ T") rather than from anything observed in the
 * run. It answers the question this file's header names directly: does the
 * middle-third/final-third comparison span a segment PRESCRIBED at a
 * different pace, and if so, how much of the mismatch is real. A fast-finish
 * long run executed exactly as written now discounts to zero readability
 * (`5A2`'s "THE CANONICAL CASE" test), composed multiplicatively alongside
 * heat and terrain exactly like every other factor here (Rule 9 — no cliff:
 * a tail that only partly overlaps the final third gets a PARTIAL discount,
 * proven in the same test file). See the function's own doc for what it
 * still does not handle (SEGLONG-1's mid-run separated segments) — an
 * honest, lesser remaining gap, not the one this change closes.
 */
import {
  DETERIORATION_PACE_SLOWDOWN_FRAC,
  DETERIORATION_PACE_STABLE_FRAC,
  DETERIORATION_HR_RISE_BPM,
  DETERIORATION_DECOUPLING_FRAC,
  DETERIORATION_REPEATED_MIN_SESSIONS,
  DETERIORATION_SEVERITY_EXTREME_FRAC,
} from './contract-constants';
import { measured, absent, type ComparableThirds, type Truncation, type Measured } from './input';
import { DECOUPLING_PROTOCOL_MIN_MINUTES } from '@/lib/training/aerobic-decoupling';
import { MATERIAL_ADJUSTMENT_S_PER_MI } from '@/lib/terrain/grade-adjust';

/**
 * DETERIORATION-SEVERITY-1 · HOW BADLY, not only whether.
 *
 * `Research/03-heart-rate-zones.md` §12 "Cardiac Drift and Aerobic Decoupling
 * (Pa:HR)" states the formula, verbatim:
 *
 *     EF = speed / HR    (use speed, not min/km)
 *     Pa:HR Decoupling = ((EF_1st_half / EF_2nd_half) - 1) × 100%
 *
 * This file compares the MIDDLE third against the FINAL third rather than
 * half against half, which is Q13's window and not §12's. The transfer is
 * declared here rather than hidden: §12 measures a steady 60-90 minute run in
 * halves, Q13 measures a session in thirds and excludes the opening third
 * precisely because a warm-up is not the comparison anybody wants. The BAND
 * TABLE is what is borrowed, and the bands are about the size of an efficiency
 * drop, not about which two windows produced it.
 *
 * Written in PACE because that is what `ComparableThirds` carries. With
 * `speed = 1 / pace`,
 *
 *     EF_mid / EF_fin = (paceFin / paceMid) × (hrFin / hrMid)
 *
 * so the returned fraction is exactly §12's quantity with no linearisation.
 * The engine's `PACE_TO_HR_DECOUPLING` signal used the first-order sum
 * (`slowdown + hrRiseFrac`) and now calls this instead, so ONE definition of
 * decoupling exists in this file rather than two that agree to second order
 * (Rule 16). The two differ by `slowdown × hrRiseFrac`, which is under a tenth
 * of a percentage point at any realistic pair.
 *
 * Positive means efficiency FELL: the runner gave more heart rate for less
 * speed. Negative means it rose. Not clamped, because a strongly negative
 * value is a real fact about a session that got more efficient, and clamping
 * it would collapse "improved" into "held" (Rule 11).
 */
export function paHrDecouplingFrac(
  middlePaceSecPerMi: number,
  finalPaceSecPerMi: number,
  middleHrBpm: number,
  finalHrBpm: number,
): number {
  if (!(middlePaceSecPerMi > 0) || !(middleHrBpm > 0)) return 0;
  return (finalPaceSecPerMi / middlePaceSecPerMi) * (finalHrBpm / middleHrBpm) - 1;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PAHR-QUANTITY-1 · READABILITY · does §12's protocol actually apply here
 *
 * Local `clamp01`/`rampAcross`, DELIBERATELY DUPLICATED rather than imported
 * from `volume-evidence/weight.ts`. That file already has the identical pair
 * and importing them would be the tidier move, but it would also point an
 * import arrow from `canonical/` (the lower, shared layer — consumed by the
 * lever files, the shadow live-input loader, and this directory) AT
 * `volume-evidence/` (a consumer of `canonical/`), inverting the layering
 * for two one-line functions. Two lines of duplication is cheaper than a
 * backwards edge in the import graph.
 * ═══════════════════════════════════════════════════════════════════════ */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const rampAcross = (lo: number, hi: number, x: number): number => {
  if (!(hi > lo)) return x >= hi ? 1 : 0;
  return clamp01((x - lo) / (hi - lo));
};

/**
 * What §12's own protocol requires before a decoupling reading means
 * anything, for the ONE session `assessDeterioration` is about to judge.
 * Every field `Measured<>`, per Rule 11: a run with no elevation signal at
 * all must not read as "definitely flat", and a run with no weather must not
 * read as "definitely cool". Absence costs nothing — see
 * `decouplingReadabilityFrac`'s own doc for why that is deliberate.
 */
export interface SessionEnvironmentalContext {
  /**
   * The whole run's duration, minutes. §12: "a steady aerobic run (60-90
   * min)". Measured off the run's own moving time, same as
   * `aerobic-decoupling.ts`'s own duration read — see
   * `DECOUPLING_READABILITY_DURATION_CEIL_MIN`.
   */
  readonly analyzedDurationMin: Measured<number>;
  /**
   * The terrain adjustment `lib/terrain/grade-adjust.ts::runGradeAdjustment`
   * computed for the WHOLE run, seconds per mile, signed (negative = net
   * climb cost, positive = net descent gift). This file does not know which
   * THIRD the hills fell in — that needs per-split grade, which
   * `buildThirds` does not carry today — so a material whole-run terrain
   * adjustment is read as "the thirds comparison cannot be trusted to tell
   * hills from fatigue", not corrected away. See
   * `DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI`.
   */
  readonly terrainDeltaSPerMi: Measured<number>;
  /**
   * Ambient temperature, °F, for the run. §12: "Heat adds 2-5% artefactually
   * — control conditions." See `DECOUPLING_READABILITY_HEAT_LO_F`.
   */
  readonly tempF: Measured<number>;
  /**
   * STEADYEFFORT-1 (2026-09-06) · the precondition the file's own header
   * named as open: was the comparison window itself run at one intended
   * effort, or does it span a PRESCRIBED pace change? Built by
   * `steadyEffortReadabilityFrac` below from the workout's own `sub_label`
   * and total distance — the "prescribed phase structure" a fast-finish or
   * progression long run carries — never from the run's own splits, which
   * cannot distinguish "he sped up because that was the plan" from "he sped
   * up because he was racing the last mile of an unstructured long run" and
   * would answer the second by contaminating the first. Absent when no
   * prescription is available to check against (a supplemental run, a race,
   * a run with no matched plan_workouts row) — Rule 11: no prescription to
   * violate is not evidence the prescription was uniform, but it is also not
   * evidence it was not, so it costs nothing rather than guessing either way.
   */
  readonly steadyEffortFrac: Measured<number>;
}

/**
 * §12's protocol duration floor, imported rather than re-typed (Rule 16):
 * `lib/training/aerobic-decoupling.ts` already carries this exact number,
 * cited to the exact same passage, gating the app's OTHER, half-vs-half
 * Pa:HR reading. One number, one citation, two files that both need it.
 */
export const DECOUPLING_READABILITY_DURATION_CEIL_MIN = DECOUPLING_PROTOCOL_MIN_MINUTES;

/**
 * POLICY_ASSUMPTION · the ramp's lower edge. `Research/03-heart-rate-zones.md`
 * §1's confounder table scopes cardiac drift itself to "Cardiac drift (>30 min
 * steady) ... +5-15% over 60 min" — under thirty minutes there has not been
 * time for genuine drift to develop at all, so a reading from a shorter run is
 * not "a smaller sample of the same thing", it is a different phenomenon
 * (noise, or a warm-up artefact) wearing the same number. THIRTY is the
 * confounder table's own floor; choosing it as the ramp's start (rather than,
 * say, zero) is the chosen part, and the citation is real.
 */
export const DECOUPLING_READABILITY_DURATION_FLOOR_MIN = 30;

/**
 * CALCULATED_PHYSIOLOGY · the terrain floor below which a whole-run terrain
 * adjustment is not worth doubting a decoupling reading over. Imported from
 * `grade-adjust.ts` rather than re-typed: it is that file's own materiality
 * floor for surfacing a terrain adjustment AT ALL ("roughly the width of GPS
 * pace noise on a single mile"), so a run below it carries no more terrain
 * signal than measurement noise already contributes.
 */
export const DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI = MATERIAL_ADJUSTMENT_S_PER_MI;

/**
 * POLICY_ASSUMPTION · the terrain ceiling, at and above which readability
 * from terrain alone is treated as exhausted. Twenty seconds per mile is
 * `lib/training/aerobic-decoupling.ts`'s OWN steady-state sanity bound — the
 * point at which that file's half-vs-half reading refuses outright rather
 * than trust a comparison across two windows that plainly were not run at the
 * same effort. Reused here as a ceiling rather than a refusal point, because
 * a ramp needs two edges and this repo already has one number that means
 * "here the comparison stops being trustworthy" for exactly this shape of
 * question.
 */
export const DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI = 20;

/**
 * POLICY_ASSUMPTION · the heat floor below which ambient temperature is
 * treated as fully comfortable. Chosen, not cited: doctrine states a trigger
 * (below) but not a comfort floor, and 60°F is an ordinary, unremarkable
 * training temperature by any of this repo's own heat-adjustment tables
 * (`lib/weather/heat-adjustment.ts`).
 */
export const DECOUPLING_READABILITY_HEAT_LO_F = 60;

/**
 * CALCULATED_PHYSIOLOGY · the heat ceiling. `Research/03-heart-rate-zones.md`
 * §1's confounder table: "Heat (≥25°C) Rises +5-20 bpm", and §12 itself:
 * "Heat adds 2-5% artefactually — control conditions." 25°C is 77°F. At or
 * above it, heat readability is treated as exhausted.
 */
export const DECOUPLING_READABILITY_HEAT_HI_F = 77;

export interface DecouplingReadability {
  /** In [0, 1]. 1 = nothing found that should reduce trust in this severity
   *  reading. 0 = every checked precondition is fully violated. */
  readonly value: number;
  /** Which preconditions were short, in plain language, or the empty string
   *  when none were. */
  readonly detail: string;
}

/**
 * STEADYEFFORT-1 (2026-09-06) · closes the precondition this file's own
 * header named as open: "nothing yet corrects for a deliberate fast finish
 * specifically." §12's protocol is implicitly a fixed-pace run; Q13 states
 * the rule directly — "Do not infer deterioration from whole-run thirds when
 * the workout contains different prescribed phases" — and until now nothing
 * checked whether it did.
 *
 * DUPLICATED, DELIBERATELY, RATHER THAN IMPORTED. `lib/plan/spec-builder.ts#
 * extractLongSegments` is the real parser and the one place this pattern is
 * defined; this is a byte-for-byte transcription of its regex and its
 * tail-anchored `recoveryMi`-folding rule, not a re-derivation. Importing the
 * real one would draw an edge from `lib/adaptation/canonical/` (the shared,
 * walled lower layer other engine files depend on) into `lib/plan/` (a
 * consumer of `canonical/`), inverting the layering for one regex — the exact
 * trade `clamp01`/`rampAcross` above already made the same call on. If
 * `extractLongSegments`'s pattern ever changes, `_deterioration_severity.test.ts`
 * §"STEADYEFFORT-1" pins both copies against the same fixture strings so a
 * drift fails loudly rather than silently.
 *
 * WHAT THIS DOES NOT HANDLE, named per Rule 20: SEGLONG-1's mid-run separated
 * segments (a session with quality blocks NOT anchored to the finish). The
 * tail-length arithmetic below treats the whole matched distance as one
 * contiguous zone ending at the run's finish, which is exactly right for the
 * common fast-finish/progression shape this precondition exists to catch, and
 * is a real but lesser approximation for the rarer "broken long run with
 * quality in the middle" shape — a session like that would be treated as if
 * its quality zone extended all the way to the finish, which UNDER-detects
 * the confound (reads MORE readable than it should) for a session that in
 * fact still has one. Recorded here as an open gap rather than silently
 * assumed away.
 */
function steadyEffortLongSegments(
  prescription: string | null,
): Array<{ mi: number; recoveryMi?: number }> {
  if (!prescription) return [];
  const out: Array<{ mi: number; recoveryMi?: number }> = [];
  const re = /(\d+(?:\.\d+)?)\s*mi\s*@\s*(HM|MP|M|T|E)\b/gi;
  for (let m = re.exec(prescription); m; m = re.exec(prescription)) {
    const mi = Number(m[1]);
    if (!Number.isFinite(mi) || mi <= 0) continue;
    if (m[2].toUpperCase() === 'E') {
      const prev = out[out.length - 1];
      if (prev) prev.recoveryMi = (prev.recoveryMi ?? 0) + mi;
      continue;
    }
    out.push({ mi });
  }
  return out;
}

/**
 * Does the middle-third/final-third comparison span a PRESCRIBED pace
 * change? Continuous, not a boolean (Rule 9): returns how much of the
 * final-third window overlaps the prescribed quality tail MINUS how much of
 * the middle-third window does. A pure easy run, a race, or any prescription
 * `steadyEffortLongSegments` cannot parse returns 1 (nothing to distrust —
 * Rule 11, absence of a prescription to check is not evidence of a uniform
 * one, but the only two honest options when the check cannot run are "assume
 * uniform" and "refuse", and this factor only ever REDUCES trust, so refusing
 * over silence would cost readings this precondition was never meant to
 * touch). The canonical fast-finish case — an easy bulk then a quality tail —
 * returns close to 0 when the tail lines up with the final third and not the
 * middle third; a session with no differential engagement between the two
 * windows (both fully easy, or both fully inside the tail) returns 1, because
 * a comparison of two equally-loaded windows is not the confound Q13 warns
 * about even when the run also happens to carry a prescribed tail elsewhere.
 */
export function steadyEffortReadabilityFrac(
  subLabel: string | null,
  totalDistanceMi: number,
): Measured<number> {
  if (!(totalDistanceMi > 0)) {
    return absent('no total distance to place the prescribed segments against');
  }
  const segments = steadyEffortLongSegments(subLabel);
  if (segments.length === 0) return measured(1);

  const qualityTailMi = segments.reduce((s, seg) => s + seg.mi + (seg.recoveryMi ?? 0), 0);
  const qualityStartMi = Math.max(0, totalDistanceMi - qualityTailMi);
  const thirdMi = totalDistanceMi / 3;

  const engagementFrac = (winStart: number, winEnd: number): number => {
    const winLen = winEnd - winStart;
    if (!(winLen > 0)) return 0;
    const overlap = Math.max(0, Math.min(winEnd, totalDistanceMi) - Math.max(winStart, qualityStartMi));
    return clamp01(overlap / winLen);
  };

  const middleEngagement = engagementFrac(thirdMi, 2 * thirdMi);
  const finalEngagement = engagementFrac(2 * thirdMi, totalDistanceMi);
  return measured(clamp01(1 - Math.abs(finalEngagement - middleEngagement)));
}

/**
 * How much to trust a `severityFrac` reading against §12's own bands, given
 * what is known about the session it came from.
 *
 * FOUR INDEPENDENT FACTORS, MULTIPLIED — the same composition rule doctrine
 * itself uses for heat-and-grade (`lib/terrain/grade-adjust.ts`'s own
 * `composeEffortFactor`, citing `Research/01` §"Combined conditions": "Add
 * adjustments multiplicatively, not additively"). Each factor ramps smoothly
 * from 1 (fully readable) to 0 (that precondition fully violated), so the
 * product is continuous in every input — Rule 9 — and reaches exactly 0 only
 * when a factor's own violation is complete, never on a hair.
 *
 * RULE 11 · a field this file does not have an answer for costs NOTHING. An
 * absent duration, absent terrain reading or absent temperature is not
 * evidence the session was short, hilly or hot — it is evidence nobody
 * recorded the fact, and the honest response to "we don't know" on a factor
 * that only ever REDUCES trust is to leave that factor at 1, not to guess a
 * discount from silence. This mirrors `hr-trace-credibility.ts`'s own stated
 * rule for sparse samples: "an absence of grounds to refuse is not grounds to
 * refuse."
 */
export function decouplingReadabilityFrac(env: SessionEnvironmentalContext): DecouplingReadability {
  let value = 1;
  const notes: string[] = [];

  if (env.analyzedDurationMin.ok) {
    const d = env.analyzedDurationMin.value;
    const r = rampAcross(DECOUPLING_READABILITY_DURATION_FLOOR_MIN, DECOUPLING_READABILITY_DURATION_CEIL_MIN, d);
    value *= r;
    if (r < 1) {
      notes.push(`${d.toFixed(0)} min is short of Research/03 §12's `
        + `${DECOUPLING_READABILITY_DURATION_CEIL_MIN}-minute steady-run floor`);
    }
  }

  if (env.terrainDeltaSPerMi.ok) {
    const t = Math.abs(env.terrainDeltaSPerMi.value);
    const r = 1 - rampAcross(DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI, DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI, t);
    value *= r;
    if (r < 1) notes.push(`terrain was worth about ${t.toFixed(0)} s/mi over the whole run, which the thirds comparison cannot place`);
  }

  if (env.tempF.ok) {
    const f = env.tempF.value;
    const r = 1 - rampAcross(DECOUPLING_READABILITY_HEAT_LO_F, DECOUPLING_READABILITY_HEAT_HI_F, f);
    value *= r;
    if (r < 1) notes.push(`${f.toFixed(0)}°F is in the range Research/03 §1 and §12 both cite as artefactually inflating decoupling`);
  }

  if (env.steadyEffortFrac.ok) {
    const r = env.steadyEffortFrac.value;
    value *= r;
    if (r < 1) {
      notes.push(`the prescription carries a quality tail that lines up more with one third than the `
        + `other (engagement mismatch ${((1 - r) * 100).toFixed(0)}%), which Q13 names directly: "do not `
        + `infer deterioration from whole-run thirds when the workout contains different prescribed phases"`);
    }
  }

  return { value: clamp01(value), detail: notes.join('; ') };
}

/**
 * Three states, not a boolean. Rule 11: a session that held together and a
 * session nobody could read are opposite facts, and only one of them is
 * evidence.
 */
export type DeteriorationVerdict = 'CLEAN' | 'DETERIORATED' | 'UNKNOWN';

export type DeteriorationSignal =
  | 'FINAL_THIRD_SLOWER_AT_EQUAL_OR_HIGHER_HR'
  | 'HR_ROSE_AT_STABLE_PACE'
  | 'PACE_TO_HR_DECOUPLING';

export interface DeteriorationResult {
  readonly verdict: DeteriorationVerdict;
  readonly signals: readonly DeteriorationSignal[];
  /**
   * HOW BADLY, as `Research/03` §12's Pa:HR decoupling fraction, or `null`
   * when it could not be measured.
   *
   * RULE 11, AND IT IS THE WHOLE REASON THIS IS NULLABLE. A session at
   * severity 0 and a session whose severity nobody could read are opposite
   * facts, and a caller that treats the second as the first has just given
   * full credit to a run it could not see. `null` and `UNKNOWN` always travel
   * together — every branch that returns UNKNOWN returns null here, and every
   * branch that returns CLEAN or DETERIORATED returns a number, because both
   * of those require a readable heart rate to reach. That invariant is
   * asserted in `volume-evidence/_deterioration_severity.test.ts` rather than
   * claimed here (Rule 20).
   */
  readonly severityFrac: number | null;
  /**
   * PAHR-QUANTITY-1 · how much to trust `severityFrac` against §12's own
   * bands, in [0, 1]. OPTIONAL ON THE TYPE ONLY, so the fixtures constructed
   * directly (rather than through `assessDeterioration`) across this repo's
   * existing test suites keep typechecking unchanged. A real reading from
   * `assessDeterioration` always sets it; a caller reading a fixture that
   * omits it should treat the absence as 1 (fully readable — the pre-
   * PAHR-QUANTITY-1 default, since nothing was checking this before). See
   * `decouplingReadabilityFrac` for what it is built from.
   */
  readonly readabilityFrac?: number;
  readonly detail: string;
}

/**
 * One session's late-session behaviour.
 *
 * Note the HR condition on the first signal. Q13 does not flag a slower final
 * third on its own, and that is deliberate: a slower finish at LOWER heart rate
 * is a runner easing down, which is not deterioration. Requiring "HR equal or
 * higher" is what separates fatigue from a cool-down, and dropping it would
 * make every well-executed progression run look like a collapse.
 *
 * PAHR-QUANTITY-1 · `env` is OPTIONAL and additive. Every existing caller
 * (the three lever files under `levers/`, still calling the two-argument
 * form) gets EXACTLY today's behaviour: `readabilityFrac` comes back `1`,
 * which is what `deteriorationConfidenceWeight`'s new default parameter also
 * assumes, so an unmigrated caller's output is bit-for-bit unchanged. Only
 * `lib/plan/volume-evidence-loader.ts::deteriorationOf` supplies it today.
 */
export function assessDeterioration(
  thirds: ComparableThirds,
  truncation: Truncation,
  env?: SessionEnvironmentalContext,
): DeteriorationResult {
  const readability = env == null ? 1 : decouplingReadabilityFrac(env).value;

  if (truncation.truncated) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      readabilityFrac: readability,
      detail:
        'The activity was truncated, so the late portion was not captured. '
        + 'Absence of a recorded decline is not evidence the session held together.',
    };
  }

  if (!thirds.comparable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      readabilityFrac: readability,
      detail:
        'The session does not contain comparable work across its thirds, so a '
        + 'late-session comparison would not mean anything.',
    };
  }

  if (!thirds.middlePaceSecPerMi.ok || !thirds.finalPaceSecPerMi.ok) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      readabilityFrac: readability,
      detail: 'Pace for the middle or final third could not be read.',
    };
  }

  const midPace = thirds.middlePaceSecPerMi.value;
  const finPace = thirds.finalPaceSecPerMi.value;
  // Positive means the final third was SLOWER.
  const slowdown = (finPace - midPace) / midPace;

  const hrReadable = thirds.middleHrBpm.ok && thirds.finalHrBpm.ok;
  const hrRise = hrReadable ? thirds.finalHrBpm.value - thirds.middleHrBpm.value : null;

  /* DETERIORATION-SEVERITY-1 · ONE decoupling number, computed once, used both
   * as Q13's third signal and as the SEVERITY the band table is read against.
   * Null exactly when heart rate is unreadable, which is exactly when every
   * branch below returns UNKNOWN (Rule 11: the two travel together). */
  const severityFrac = hrReadable && thirds.middleHrBpm.ok && thirds.finalHrBpm.ok
    ? paHrDecouplingFrac(midPace, finPace, thirds.middleHrBpm.value, thirds.finalHrBpm.value)
    : null;

  const signals: DeteriorationSignal[] = [];

  // Q13 · final third >~4% slower while HR is equal or higher.
  if (slowdown > DETERIORATION_PACE_SLOWDOWN_FRAC && hrRise !== null && hrRise >= 0) {
    signals.push('FINAL_THIRD_SLOWER_AT_EQUAL_OR_HIGHER_HR');
  }

  // Q13 · pace within ~2% but HR rises >~6 bpm.
  if (Math.abs(slowdown) <= DETERIORATION_PACE_STABLE_FRAC
    && hrRise !== null && hrRise > DETERIORATION_HR_RISE_BPM) {
    signals.push('HR_ROSE_AT_STABLE_PACE');
  }

  // Q13 · pace-to-HR decoupling >~5%. Pace slowed and HR climbed together.
  // The magnitude is `severityFrac`, computed once above, so this predicate and
  // the band table below cannot drift apart (Rule 16).
  if (severityFrac !== null && hrRise !== null
    && slowdown > 0 && hrRise > 0 && severityFrac > DETERIORATION_DECOUPLING_FRAC) {
    signals.push('PACE_TO_HR_DECOUPLING');
  }

  if (signals.length > 0) {
    return {
      verdict: 'DETERIORATED',
      signals,
      severityFrac,
      readabilityFrac: readability,
      detail: `Late-session deterioration · ${signals.join(', ')}`
        + `${severityFrac == null ? '' : ` · Pa:HR decoupling ${(severityFrac * 100).toFixed(1)} per cent`}.`,
    };
  }

  // Pace is readable and shows no decline, but HR is not. That is a partial
  // read, and Q13's signals two and three both need HR. Saying CLEAN here would
  // claim more than the data supports.
  if (!hrReadable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      readabilityFrac: readability,
      detail:
        'Pace held through the final third, but heart rate could not be read, '
        + 'so two of the three deterioration signals could not be evaluated.',
    };
  }

  return {
    verdict: 'CLEAN',
    signals: [],
    severityFrac,
    readabilityFrac: readability,
    detail: 'The session held together to the finish.',
  };
}

/**
 * Q13's "repeated" · counted in SESSIONS, never in segments.
 *
 * UNKNOWN sessions are not counted as clean and not counted as deteriorated.
 * They are reported separately so a caller can tell "two good sessions" from
 * "two sessions I could not read", which the lever contracts need in order to
 * refuse rather than pass.
 */
export interface DeteriorationPattern {
  readonly repeated: boolean;
  readonly deterioratedCount: number;
  readonly unknownCount: number;
  readonly cleanCount: number;
  /**
   * DETERIORATION-SEVERITY-1 · the WORST readable Pa:HR decoupling across the
   * window, or `null` when no session in it was readable.
   *
   * THE MAXIMUM, not the mean, and that is the conservative choice on purpose:
   * the question a caller asks this is "did anything in this week fall apart",
   * and averaging one collapsed session against three clean ones answers a
   * different question. It is also what makes the roll-up monotone — adding a
   * worse session can only ever lower the confidence a caller derives from it,
   * never raise it.
   *
   * READ ACROSS EVERY READABLE SESSION, clean ones included. That is not an
   * oversight and it is what keeps the whole pipeline continuous: a session a
   * hair on either side of a detector line has almost the same decoupling, so
   * a factor derived from the decoupling moves by a hair, while a factor gated
   * on the VERDICT would jump. `_deterioration_severity.test.ts` walks the
   * `HR_ROSE_AT_STABLE_PACE` boundary and measures exactly that.
   *
   * Rule 11 · `null` here means NO SESSION COULD BE READ, never "nothing went
   * wrong". A window with no sessions at all also reports null, and a caller
   * has to decide what an empty window means for its own question rather than
   * being handed a zero that looks like a measurement.
   */
  readonly worstSeverityFrac: number | null;
  /**
   * PAHR-QUANTITY-1 · the `readabilityFrac` PAIRED WITH `worstSeverityFrac` —
   * not the minimum across the window, and not an average. The question this
   * answers is "how much should the worst reading above cost", so it needs
   * the readability of THAT SPECIFIC SESSION, not of some other session in
   * the window that happened to be less trustworthy. Optional on the type for
   * the same fixture-compatibility reason as `DeteriorationResult
   * .readabilityFrac`; absent means 1 (the pre-PAHR-QUANTITY-1 default).
   */
  readonly worstSeverityReadabilityFrac?: number;
  readonly detail: string;
}

/**
 * What ONE deteriorated session means, in `Research/03` §12's own vocabulary.
 *
 * DETERIORATION-SEVERITY-1 · this sentence used to be unconditional: "which
 * reduces confidence without blocking progression", printed over every single
 * fade whatever its size. It was wrong in both directions. It was wrong about
 * an extreme fade, which §12 says should stop a progression, and it went on
 * being wrong even while `admit.ts` refused the week -- the report printed a
 * sentence saying a fade does not block, as the reason a fade had blocked.
 * CLAUDE.md Rule 16: a sentence asserting a fact about a measurement must be
 * gated on that measurement or not said.
 *
 * This describes the MEASUREMENT and never a lever's decision. Whether a
 * particular lever refuses is that lever's question; what the decoupling means
 * is this file's.
 */
function oneSessionMeans(severityFrac: number | null): string {
  if (severityFrac == null) {
    return 'How far it fell could not be measured, so how much confidence it costs cannot '
      + 'be said either.';
  }
  if (severityFrac >= DETERIORATION_SEVERITY_EXTREME_FRAC) {
    return 'That is past the point doctrine calls an endurance gap, where the instruction is '
      + 'to build base before progressing.';
  }
  if (severityFrac > DETERIORATION_DECOUPLING_FRAC) {
    return 'That reduces confidence in proportion to how far it fell rather than blocking '
      + 'progression.';
  }
  return 'That is inside the range doctrine calls sustainable, so it does not reduce '
    + 'confidence on its own.';
}

export function deteriorationPattern(
  results: readonly DeteriorationResult[],
): DeteriorationPattern {
  const deterioratedCount = results.filter((r) => r.verdict === 'DETERIORATED').length;
  const unknownCount = results.filter((r) => r.verdict === 'UNKNOWN').length;
  const cleanCount = results.filter((r) => r.verdict === 'CLEAN').length;
  const repeated = deterioratedCount >= DETERIORATION_REPEATED_MIN_SESSIONS;

  const readable = results
    .filter((r): r is DeteriorationResult & { severityFrac: number } => r.severityFrac != null);
  // PAHR-QUANTITY-1 · pick the (severity, readability) PAIR by severity, not
  // the two fields independently — see the field's own doc for why a min or
  // an average would answer a different question.
  const worst = readable.length === 0
    ? null
    : readable.reduce((a, b) => (b.severityFrac > a.severityFrac ? b : a));
  const worstSeverityFrac = worst == null ? null : worst.severityFrac;
  const worstSeverityReadabilityFrac = worst == null ? 1 : (worst.readabilityFrac ?? 1);

  const worstPct = worstSeverityFrac == null
    ? null
    : `${(worstSeverityFrac * 100).toFixed(1)} per cent`;

  return {
    repeated,
    deterioratedCount,
    unknownCount,
    cleanCount,
    worstSeverityFrac,
    worstSeverityReadabilityFrac,
    detail: repeated
      ? `${deterioratedCount} sessions in the window showed late deterioration`
        + `${worstPct == null ? '' : `, the worst at ${worstPct} Pa:HR decoupling`}.`
      : deterioratedCount === 1
        ? `One session showed late deterioration${worstPct == null ? '' : ` at ${worstPct} `
          + 'Pa:HR decoupling'}. ${oneSessionMeans(worstSeverityFrac)}`
        : `No repeated late deterioration across ${cleanCount} readable sessions.`
          + `${worstPct == null ? '' : ` The worst finished at ${worstPct} Pa:HR decoupling.`}`,
  };
}
