/**
 * lib/training/self-reported-pr.ts · THE TYPED-PR RUNG, VALIDATED.
 *
 * A brand-new runner types a personal best into onboarding
 * (`profile.race_history`). Nobody watched them run it. It is not a race
 * result, it is not a training observation, and it is not evidence — but it is
 * a real, runner-specific statement about their own ability, and the app
 * pricing them as a VDOT-30 beginner while holding it is not honesty, it is
 * throwing information away.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `generate.ts`'s legacy cascade already consumed this field — `PARITY-1`,
 * 2026-06-23 — and consumed it RAW, straight into `bestRecentVdot`, where
 * every downstream reader treated it as a measured fitness anchor until
 * `SELFREPORT-1` had to add a boolean to say it was not. The canonical
 * capacity ladder had no rung for it at all, which is the ~101 s/mi residual
 * the 2026-09-01 independent audit measured on `qa-phone-onboard` (appendix A
 * §4.4): a cold-start runner who typed a recent PR was priced 1:40/mi slower
 * by the canonical resolvers than by the path they replace.
 *
 * Neither answer was right. Raw consumption makes a keyboard entry into
 * fitness; total refusal makes the app dumber than the runner. This file is
 * the third answer: a VALIDATED, CONSERVATIVE, LOW-CONFIDENCE prior that is
 * SHRUNK toward the mileage prior and RETIRED continuously as real running
 * arrives.
 *
 * ── THE FOUR PROPERTIES IT OWES (Constitution §17, §G · Rule 9, Rule 11) ────
 *
 *   1 · VALIDATED. An entry whose distance, time or implied pace is
 *       implausible is REJECTED WITH A REASON, never silently dropped and
 *       never clamped into range. `PrRejection` names which test failed.
 *   2 · CONSERVATIVE. `USER_PR_MAX_WEIGHT` caps how far a typed PR may ever
 *       move the prior away from the app's own mileage-based floor. It is a
 *       shrinkage toward the population/mileage prior, not a substitution
 *       for it.
 *   3 · NEVER `direct` / `race_derived`. The caller stamps `user_prior` and
 *       `CAPACITY_CONFIDENCE_BANDS.userPrior`. This file returns no source
 *       mode and no evidence id, so there is nothing here for a caller to
 *       mistake for an observation.
 *   4 · AUTHORITY DECREASES CONTINUOUSLY. `prPriorWeight` multiplies a
 *       staleness factor by the caller's own evidence-coverage complement,
 *       and both are continuous. There is no step anywhere on the path from
 *       "no runs at all" to "a month of logged training" (Rule 9).
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · It cannot detect a LIE that is merely ambitious. A 3:05 marathon typed
 *     by a 4:30 marathoner is inside every plausibility band here and will be
 *     believed at `USER_PR_MAX_WEIGHT`. The defence is the weight, not the
 *     validator — and the shrinkage is sized on the assumption that some
 *     entries are wrong.
 *   · It cannot tell a mistyped unit from a real time. 10800 seconds and
 *     10800 minutes both parse; only the second is caught, and only because
 *     it lands outside the pace band.
 *   · It says nothing about DURABILITY. A typed 5K PR prices threshold and
 *     nothing else; the marathon anchor still comes from the runner's own
 *     (absent) endurance evidence through the population exponent.
 */

import { vdotFromRace, tPaceFromVdot } from './vdot';
import {
  distanceMiOfBucket,
  whenRacedDaysAgo,
  type RaceHistoryEntry,
} from './race-history';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE PLAUSIBILITY BAND
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The fastest average pace any self-reported PR may claim, s/mi.
 *
 * 240 s/mi = 4:00/mi. The men's marathon world record averages ~4:33/mi and
 * the mile world record is 3:43, so nothing a runner could type at any of the
 * onboarding distances (5K and up) can legitimately be faster than this. A
 * value under it is a unit error, a typo, or a fabrication — three facts this
 * file cannot tell apart, and does not need to, because the correct response
 * to all three is the same refusal.
 *
 * CONVENTION, and deliberately generous: this is an ABSURDITY floor, not a
 * fitness judgement. Rejecting an entry because it is merely fast would be
 * this file deciding who is allowed to be good, which is not its question.
 */
export const PR_MIN_PLAUSIBLE_PACE_S_PER_MI = 240;

/**
 * The slowest average pace a self-reported PR may claim, s/mi.
 *
 * 1200 s/mi = 20:00/mi, which is a walk. Slower than this the entry is a
 * stopped watch, a typo, or a time entered in the wrong unit; it is also
 * outside anything `vdotFromRace` can represent, so believing it would put a
 * fabricated number into the ladder rather than a conservative one.
 */
export const PR_MAX_PLAUSIBLE_PACE_S_PER_MI = 1200;

/**
 * How fast a typed PR's AUTHORITY halves with age, in days.
 *
 * 365, and deliberately NOT `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS` (28), which
 * is Rule 16: those are two quantities, not one quantity with two names. The
 * 28-day half-life ages CONFIDENCE IN AN OBSERVATION the app made — how sure
 * are we that this runner is still where we watched them be. This one ages a
 * STATEMENT ABOUT WHO THE RUNNER IS: a half-marathon PR from ten months ago
 * still says "not a beginner", and decaying that on a four-week half-life
 * would make the app forget a fact the runner never stopped being true of.
 *
 * CONVENTION. What grounds it is the onboarding field's own buckets
 * (`whenRacedDaysAgo`): `<6mo` → 90 d → weight 0.84; `6-12mo` → 270 d →
 * 0.60; `1-2yr` → 547 d → 0.35; `2+yr` → 1095 d → 0.13. That is a curve that
 * still hears a recent PR clearly, is audibly unsure about a year-old one,
 * and has effectively forgotten a three-year-old one — without a cliff
 * anywhere, which is what the legacy path's hard 180-day cut had (Rule 9).
 */
export const USER_PR_HALF_LIFE_DAYS = 365;

/**
 * The most authority a typed PR may EVER have over the prior, before
 * staleness and before evidence coverage.
 *
 * 0.60. It is a shrinkage coefficient toward the app's own mileage prior:
 * even a PR typed yesterday by a runner with no logged running moves the
 * prescribed threshold pace only 60% of the way from the conservative
 * mileage anchor to the pace the PR implies.
 *
 * WHY A MAJORITY, AND WHY NOT ALL OF IT. A majority, because a plausible
 * recent PR is genuinely the most informative thing the app knows about a
 * runner it has never watched, and weighting it below the mileage bucket
 * would be pretending otherwise. Not all of it, because it is unverified and
 * this file's own Rule 22 section says the validator cannot catch an
 * ambitious lie — the shrinkage IS the defence, so it has to leave the
 * conservative anchor a real share. `Research/01` §"Pace conversion from a
 * race time" is what makes the PR→pace conversion legitimate at all; nothing
 * in it says how much to believe an unwitnessed claim, so this is a
 * CONVENTION and is labelled one.
 */
export const USER_PR_MAX_WEIGHT = 0.60;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE READ
 * ═══════════════════════════════════════════════════════════════════════ */

/** Why one self-reported PR entry was not usable. Structured, never prose. */
export type PrRejection =
  | 'UNPARSEABLE_DISTANCE'
  | 'UNPARSEABLE_WHEN'
  | 'UNPARSEABLE_TIME'
  | 'IMPLAUSIBLE_PACE'
  | 'OFF_VDOT_TABLE';

/** One accepted self-reported PR, and what it implies. */
export interface AcceptedPr {
  distanceMi: number;
  timeSec: number;
  daysAgo: number;
  paceSecPerMi: number;
  vdot: number;
  /** The T-pace the PR implies, s/mi. The quantity the caller shrinks. */
  tPaceSecPerMi: number;
  /** Continuous staleness weight in (0,1] — `USER_PR_HALF_LIFE_DAYS`. */
  freshness: number;
}

/**
 * Rule 11 as a shape: an answer, an explicit "nothing was on file", or an
 * explicit "something was on file and every entry failed validation, here is
 * why". The three are different facts and a caller must be able to say which
 * one it is looking at — a rejected PR is a thing to TELL the runner about,
 * an absent one is not.
 */
export type SelfReportedPrRead =
  | { ok: true; best: AcceptedPr; considered: number; rejected: PrRejection[] }
  | { ok: false; reason: 'NO_PR_ON_FILE'; considered: 0; rejected: [] }
  | { ok: false; reason: 'ALL_PRS_REJECTED'; considered: number; rejected: PrRejection[] };

/**
 * Validate `profile.race_history` and return the best usable PR.
 *
 * PURE — no database, no clock, no user id. The entries arrive from the
 * caller, which is what makes every rejection above falsifiable without a
 * fixture (Rule 18).
 *
 * "Best" is the HIGHEST IMPLIED VDOT among entries that pass validation, the
 * same choice `bestVdotFromRaceHistory` makes, and for the same reason: a
 * runner's PR set describes one runner, and the fastest of them is the one
 * that says the most about their ceiling. Staleness is priced by weight
 * afterwards rather than by dropping entries at a date cut — a 2-year-old
 * marathon PR is not worthless, it is faint, and the legacy path's hard
 * 180-day gate is exactly the Rule 9 shape this replaces.
 */
export function readSelfReportedPr(
  entries: readonly RaceHistoryEntry[] | null | undefined,
): SelfReportedPrRead {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return { ok: false, reason: 'NO_PR_ON_FILE', considered: 0, rejected: [] };

  const rejected: PrRejection[] = [];
  let best: AcceptedPr | null = null;

  for (const e of list) {
    const distanceMi = distanceMiOfBucket(e.distance, e.otherDistanceMi);
    if (distanceMi == null || !Number.isFinite(distanceMi) || distanceMi <= 0) {
      rejected.push('UNPARSEABLE_DISTANCE');
      continue;
    }
    const daysAgo = whenRacedDaysAgo(e.whenRaced);
    if (daysAgo == null) { rejected.push('UNPARSEABLE_WHEN'); continue; }
    const timeSec = Number(e.timeSec);
    if (!Number.isFinite(timeSec) || timeSec <= 0) { rejected.push('UNPARSEABLE_TIME'); continue; }

    const paceSecPerMi = timeSec / distanceMi;
    if (paceSecPerMi < PR_MIN_PLAUSIBLE_PACE_S_PER_MI
      || paceSecPerMi > PR_MAX_PLAUSIBLE_PACE_S_PER_MI) {
      rejected.push('IMPLAUSIBLE_PACE');
      continue;
    }

    const vdot = vdotFromRace(timeSec, distanceMi);
    const tPaceSecPerMi = vdot != null ? tPaceFromVdot(vdot) : null;
    if (vdot == null || tPaceSecPerMi == null || !Number.isFinite(tPaceSecPerMi)) {
      // Off the [30,85] Daniels table in either direction. Not clamped: a
      // clamp would invent a fitness the runner never claimed, in the one
      // place this file has no licence to invent anything.
      rejected.push('OFF_VDOT_TABLE');
      continue;
    }

    const freshness = Math.pow(2, -daysAgo / USER_PR_HALF_LIFE_DAYS);
    const cand: AcceptedPr = {
      distanceMi, timeSec, daysAgo, paceSecPerMi, vdot, tPaceSecPerMi, freshness,
    };
    if (best == null || cand.vdot > best.vdot) best = cand;
  }

  if (best == null) {
    return { ok: false, reason: 'ALL_PRS_REJECTED', considered: list.length, rejected };
  }
  return { ok: true, best, considered: list.length, rejected };
}

/**
 * How much authority a validated PR gets, given how much REAL running the app
 * has now seen.
 *
 * `USER_PR_MAX_WEIGHT × freshness × (1 − evidenceCoverage)`. Every term is
 * continuous on [0,1] and the product is monotone non-increasing in
 * `evidenceCoverage`, so a runner who logs more running can only ever move
 * the prescribed pace TOWARD their own demonstrated evidence and never across
 * a step (Rule 9). At full coverage the weight is exactly 0 and the PR has no
 * effect at all — which is the "direct evidence supersedes it over time"
 * property, expressed as a limit rather than as an `if`.
 */
export function prPriorWeight(freshness: number, evidenceCoverage: number): number {
  const f = Number.isFinite(freshness) ? Math.min(1, Math.max(0, freshness)) : 0;
  const c = Number.isFinite(evidenceCoverage) ? Math.min(1, Math.max(0, evidenceCoverage)) : 0;
  return USER_PR_MAX_WEIGHT * f * (1 - c);
}
