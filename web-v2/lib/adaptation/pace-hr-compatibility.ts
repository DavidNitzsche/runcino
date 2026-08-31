/**
 * lib/adaptation/pace-hr-compatibility.ts · the pace/HR compatibility
 * validator required by `docs/PRODUCT_DECISIONS.md` 2026-09-01 §3.
 *
 * ── The decision, verbatim ──────────────────────────────────────────────
 *
 * "Independent resolution, plus a mandatory compatibility validator. No
 * automatic paired HR increase... Pace Prescription resolves its range; the
 * HR owner resolves its own guard independently; a final compatibility
 * check determines whether both can truthfully describe one intended
 * stimulus. Policy: if the faster pace is compatible with existing HR
 * evidence, HR stays put; if HR would exceed ceiling only from adverse
 * conditions, that's a same-day readiness/environment adjustment, not a
 * capacity-belief change; if repeated controlled sessions show the HR
 * ceiling itself is stale, update it through HR evidence, not as a side
 * effect of a pace change; if genuinely incompatible at prescription time,
 * refuse or hold the pace progression rather than silently moving HR to
 * make it fit."
 *
 * ── SHADOW MODE ONLY ────────────────────────────────────────────────────
 *
 * §2 of the same decision authorizes PACE-only shadow-compare and withholds
 * any live mutation. This module has ZERO callers wired into a live
 * mutation path — it is a pure function for the shadow-compare harness (a
 * separate stream of work, per the brief that commissioned this file) to
 * call alongside the PACE lever's proposal. Nothing here writes to the
 * database, touches `adaptation-engine.ts`'s proposal composition, or
 * changes what a runner is prescribed. `docs/reports/
 * pace-hr-compatibility-2026-09-01.md` demonstrates it against the real
 * account, called standalone, exactly as a harness would call it.
 *
 * ── What this deliberately does NOT do ─────────────────────────────────
 *
 *  · It does not derive HR from pace, or pace from HR. Pace capacity
 *    (`resolveThresholdCapacity`, `capacity-resolver.ts`) and the HR guard
 *    (`computeZones`, `lib/training/zones.ts`, LTHR-based Friel bands) each
 *    resolve from their OWN evidence stream — pace/exertion data for one,
 *    measured heart rate for the other. This module only asks whether the
 *    two answers, each already resolved elsewhere, can truthfully describe
 *    the same session. That is what "independent resolution, plus a
 *    compatibility check" means structurally, not just procedurally.
 *  · It does not build new environment/heat logic. `heatHrBumpBpm` (`lib/
 *    weather/heat-adjustment.ts`) is Research/03's own heat-confounder
 *    table, already live and used by the post-run weather explainer; this
 *    module reuses it verbatim rather than re-deriving a second heat model.
 *  · It does not re-anchor LTHR. `decideLthrReanchor` (`lib/training/
 *    lthr-reanchor.ts`) is the one mechanism licensed to move the anchor,
 *    off race evidence, on its own cadence. This module only READS whether
 *    the LTHR owner already thinks a re-anchor is due (an optional input)
 *    and reports that as advisory context — it never re-anchors itself, and
 *    a stale-ceiling READ here never silently changes HR as a side effect
 *    of a pace proposal, which is the exact thing the decision forbids.
 *
 * ── Why the numbers below are shaped as they are ───────────────────────
 *
 * `MATERIAL_INCOMPATIBILITY_MIN_SESSIONS` mirrors
 * `PACE_PROGRESS_MIN_SESSIONS` (`adaptation-engine.ts`) on purpose: the same
 * "one session proves nothing, corroboration does" standard the PACE
 * proposal itself had to clear to exist in the first place is the standard
 * this validator holds the HR side to before it will contradict that
 * proposal. A validator that fires a refusal off a single session would be
 * a stricter bar going down than the one PACE itself has going up — Rule 9
 * (CLAUDE.md, "the bar to go UP may not be higher than the bar to come
 * DOWN") applies here in its mirror form: the bar to REFUSE may not be
 * lower than the bar the proposal itself had to clear to PROPOSE.
 */

import { computeZones } from '@/lib/training/zones';
import { heatHrBumpBpm } from '@/lib/weather/heat-adjustment';

// ── Inputs ──────────────────────────────────────────────────────────────

/**
 * One controlled session backing the PACE proposal under review.
 *
 * Deliberately NOT `QualitySessionRead` (`adaptation-engine.ts`) — that type
 * is the Evidence Engine's classification output (control, late-collapse,
 * internal cost) and carries no raw telemetry at all, by design (`lib/
 * evidence/load-activity-evidence.ts` is where avgHr/tempF actually live,
 * off `runs.data`). A harness wiring this validator in joins the SAME
 * `activityId`s `PaceEvidence.sessions` already names against that raw
 * telemetry and builds this shape; this module has no DB dependency of its
 * own, matching the pure/impure split `capacity-resolver.ts` and
 * `lthr-reanchor.ts` already use.
 */
export interface HrCheckedSession {
  activityId: string;
  dateISO: string;
  /**
   * Average HR over the WORK segment specifically (not warm-up/cool-down,
   * not the whole run), bpm. Null when unavailable — Rule 11: an absent
   * reading is a third fact, never coerced to "in band" or to zero. A
   * session with no HR is excluded from the tally, named in
   * `excludedForMissingHr`, and never silently counted either way.
   */
  avgWorkHrBpm: number | null;
  /**
   * Peak air temperature the work segment ran through, °F. Null means no
   * heat confounder can be PRICED for this session — never treated as "it
   * was cool," which would let an unlogged hot day masquerade as
   * incompatibility.
   */
  tempF: number | null;
}

/** What the LTHR owner (`lib/training/lthr-reanchor.ts`) already believes
 *  about its own staleness. Optional, advisory, read-only from this
 *  module's point of view — see the file header's "what this does not do." */
export interface LthrReanchorAdvisory {
  stale: boolean;
  action: 'write' | 'hold' | 'stale' | 'none';
  why: string;
}

export interface PaceHrCompatibilityInput {
  /**
   * The proposal under review, in the PACE lever's own units (s/mi, lower
   * is faster). Mirrors `AdaptationProposal`'s `target: 'PACE'` arm
   * (`previous`/`proposed`, both `{unit: 'sec_per_mi', value}`) without a
   * compile-time import of `adaptation-engine.ts` — this module stays
   * callable from anywhere, including a harness that has not yet decided
   * how it will shape its own proposal objects.
   */
  previousSecPerMi: number;
  proposedSecPerMi: number;
  /** The runner's own LTHR, bpm. Null → the HR guard cannot be resolved at
   *  all, which is a DIFFERENT fact from "resolved and compatible" (Rule
   *  11) — see `INSUFFICIENT_HR_EVIDENCE` below. */
  lthrBpm: number | null;
  /** The controlled sessions backing the proposal — see `HrCheckedSession`. */
  sessions: HrCheckedSession[];
  lthrReanchor?: LthrReanchorAdvisory | null;
}

// ── Policy constants ────────────────────────────────────────────────────

/** See file header — mirrors `PACE_PROGRESS_MIN_SESSIONS`
 *  (`adaptation-engine.ts`), currently 3. Not imported directly (this
 *  module has no dependency on adaptation-engine.ts by design), but kept
 *  numerically identical on purpose; if that constant moves, this one
 *  should be reconsidered alongside it. */
export const MATERIAL_INCOMPATIBILITY_MIN_SESSIONS = 3;

/**
 * A session's avg work HR must sit at least this many bpm above the
 * runner's own Z4 (Threshold) ceiling — AFTER the heat confounder is
 * subtracted — to count as a genuine, unexplained overage rather than
 * ordinary Friel Z4/Z5 seam rounding. `zones.ts`'s own band arithmetic
 * (`ZONE-BANDS-1`) ties every edge to the nearest whole bpm by construction,
 * so a 1-2 bpm overage is measurement/rounding noise, not a finding.
 */
export const UNEXPLAINED_OVERAGE_MATERIAL_BPM = 3;

/**
 * How far UNDER the Z4 floor a clean (controlled, non-environmental)
 * session's avg work HR must sit to count toward "the ceiling may be
 * stale" rather than "a good day." Wider than the overage margin above on
 * purpose — undershoot is the LOW-URGENCY branch of this validator (it
 * recommends a look at HR evidence, it never blocks or changes anything),
 * so it is deliberately harder to trigger than the refusal branch.
 */
export const STALE_CEILING_UNDERSHOOT_BPM = 5;

// ── Output ──────────────────────────────────────────────────────────────

export type PaceHrCompatibilityVerdict =
  | 'COMPATIBLE'
  | 'COMPATIBLE_ENVIRONMENTAL_EXPLAINED'
  | 'COMPATIBLE_HR_CEILING_LIKELY_STALE'
  | 'INSUFFICIENT_HR_EVIDENCE'
  | 'INCOMPATIBLE_REFUSE';

export type SessionClassification =
  | 'within_band' | 'below_band' | 'environmental' | 'unexplained_hot';

export interface SessionRead {
  activityId: string;
  dateISO: string;
  avgWorkHrBpm: number;
  /** bpm above the runner's own Z4 ceiling. Negative = under it. */
  deltaAboveZ4Bpm: number;
  /** How much of any overage the heat confounder alone explains, bpm. */
  heatExplainedBpm: number;
  /** Overage AFTER subtracting the heat confounder — the part environment
   *  cannot explain. Zero when the session was not above band. */
  unexplainedOverageBpm: number;
  classification: SessionClassification;
}

export interface PaceHrCompatibilityResult {
  verdict: PaceHrCompatibilityVerdict;
  /**
   * True for every verdict except `INCOMPATIBLE_REFUSE`. This is the ONE
   * field a shadow-compare harness reads to decide whether the PACE
   * proposal is allowed to stand — everything else on this object is
   * explanation, not authority. `INSUFFICIENT_HR_EVIDENCE` is `true` here
   * on purpose: "we could not check" is not the same fact as "we checked
   * and it disagrees" (Rule 11), and a compatibility check whose only job
   * is to catch a DEMONSTRATED contradiction must not manufacture a new
   * veto out of missing data doctrine never asked it to require.
   */
  paceProposalMayProceed: boolean;
  /** Coach-voice reason, assembled from the fields below it — never stated
   *  independently of the numbers (mirrors adaptation-engine.ts §27). */
  reason: string;
  /** The runner's own Threshold (Z4) HR band — the HR owner's independently
   *  resolved guard, straight from `computeZones`. Null only when
   *  `lthrBpm` was null or out of `computeZones`' valid range. */
  z4BandBpm: { lower: number; upper: number } | null;
  sessionReads: SessionRead[];
  /** Sessions dropped from the tally for missing HR — named, never
   *  silently absorbed into either side of the count (Rule 11). */
  excludedForMissingHr: string[];
  /** Echoes the input advisory, or null if none was supplied. Never
   *  computed here — see file header. */
  lthrReanchorAdvisory: LthrReanchorAdvisory | null;
}

// ── The check ───────────────────────────────────────────────────────────

/**
 * Whether a proposed PACE change and the runner's own, independently
 * resolved HR guard can truthfully describe one intended stimulus.
 *
 * Pure. Every input is supplied — no database, no clock, no import of
 * `adaptation-engine.ts` — so it is unit-testable and callable from
 * anywhere without pulling in the proposal-composition file this pass is
 * explicitly not touching.
 */
export function checkPaceHrCompatibility(
  input: PaceHrCompatibilityInput,
): PaceHrCompatibilityResult {
  const { lthrBpm, sessions, lthrReanchor = null } = input;

  const zones = lthrBpm != null ? computeZones({ lthr: lthrBpm }) : null;
  const z4 = zones?.zones.find((z) => z.idx === 4) ?? null;
  const z4BandBpm =
    z4?.lower != null && z4?.upper != null ? { lower: z4.lower, upper: z4.upper } : null;

  if (z4BandBpm == null) {
    return {
      verdict: 'INSUFFICIENT_HR_EVIDENCE',
      paceProposalMayProceed: true,
      reason: lthrBpm == null
        ? 'No LTHR on file · the HR guard cannot be resolved, so this validator has nothing '
          + 'to check the pace proposal against. The proposal is not blocked on a check that '
          + 'cannot run.'
        : `LTHR ${lthrBpm} is outside the range computeZones() will resolve a table for · the `
          + 'HR guard cannot be resolved.',
      z4BandBpm: null,
      sessionReads: [],
      excludedForMissingHr: sessions.map((s) => s.activityId),
      lthrReanchorAdvisory: lthrReanchor,
    };
  }

  const excludedForMissingHr: string[] = [];
  const sessionReads: SessionRead[] = [];

  for (const s of sessions) {
    if (s.avgWorkHrBpm == null) {
      excludedForMissingHr.push(s.activityId);
      continue;
    }
    const deltaAboveZ4Bpm = s.avgWorkHrBpm - z4BandBpm.upper;
    if (deltaAboveZ4Bpm <= 0) {
      sessionReads.push({
        activityId: s.activityId,
        dateISO: s.dateISO,
        avgWorkHrBpm: s.avgWorkHrBpm,
        deltaAboveZ4Bpm,
        heatExplainedBpm: 0,
        unexplainedOverageBpm: 0,
        classification: s.avgWorkHrBpm < z4BandBpm.lower ? 'below_band' : 'within_band',
      });
      continue;
    }
    const heatExplainedBpm = s.tempF != null ? heatHrBumpBpm(s.tempF) : 0;
    const unexplainedOverageBpm = Math.max(0, deltaAboveZ4Bpm - heatExplainedBpm);
    sessionReads.push({
      activityId: s.activityId,
      dateISO: s.dateISO,
      avgWorkHrBpm: s.avgWorkHrBpm,
      deltaAboveZ4Bpm,
      heatExplainedBpm,
      unexplainedOverageBpm,
      classification:
        unexplainedOverageBpm >= UNEXPLAINED_OVERAGE_MATERIAL_BPM ? 'unexplained_hot' : 'environmental',
    });
  }

  const unexplainedHot = sessionReads.filter((r) => r.classification === 'unexplained_hot');
  const environmental = sessionReads.filter((r) => r.classification === 'environmental');
  const materiallyBelowBand = sessionReads.filter(
    (r) => r.classification === 'below_band' && z4BandBpm.lower - r.avgWorkHrBpm >= STALE_CEILING_UNDERSHOOT_BPM,
  );

  // ── (d) Genuinely incompatible at proposal time · REFUSE ──────────────
  if (unexplainedHot.length >= MATERIAL_INCOMPATIBILITY_MIN_SESSIONS) {
    const bpms = unexplainedHot.map((r) => Math.round(r.unexplainedOverageBpm));
    return {
      verdict: 'INCOMPATIBLE_REFUSE',
      paceProposalMayProceed: false,
      reason: `${unexplainedHot.length} of the ${sessionReads.length} controlled sessions backing `
        + `this pace proposal ran ${bpms.join(', ')} bpm over the runner's own Z4 ceiling `
        + `(${z4BandBpm.lower}-${z4BandBpm.upper} bpm) with no heat confounder to explain it. `
        + `The pace this proposal asks for is not one the runner's own HR evidence agrees he can `
        + 'hold at threshold effort — refuse the pace step rather than silently moving HR to fit it.',
      z4BandBpm,
      sessionReads,
      excludedForMissingHr,
      lthrReanchorAdvisory: lthrReanchor,
    };
  }

  // ── (b) Adverse same-day conditions explain the apparent mismatch ─────
  if (environmental.length > 0 && unexplainedHot.length === 0) {
    return {
      verdict: 'COMPATIBLE_ENVIRONMENTAL_EXPLAINED',
      paceProposalMayProceed: true,
      reason: `${environmental.length} session(s) ran hot relative to the Z4 ceiling, but the `
        + "heat confounder (Research/03's own table) explains the overage. This is a same-day "
        + 'readiness/environment fact, not a capacity-belief change — HR stays where it is and '
        + 'the pace proposal is not penalized for a hot morning.',
      z4BandBpm,
      sessionReads,
      excludedForMissingHr,
      lthrReanchorAdvisory: lthrReanchor,
    };
  }

  // ── (c) Repeated controlled sessions undershoot the ceiling ────────────
  if (materiallyBelowBand.length >= MATERIAL_INCOMPATIBILITY_MIN_SESSIONS) {
    return {
      verdict: 'COMPATIBLE_HR_CEILING_LIKELY_STALE',
      paceProposalMayProceed: true,
      reason: `${materiallyBelowBand.length} controlled sessions backing this pace proposal all `
        + `ran well under the runner's own Z4 floor (${z4BandBpm.lower} bpm). The pace proposal `
        + "is compatible and proceeds — but this pattern is the HR owner's evidence to act on "
        + '(LTHR re-anchor), not a side effect of this pace change. '
        + (lthrReanchor
          ? `LTHR owner's own read: ${lthrReanchor.action} (${lthrReanchor.why})`
          : 'No LTHR-reanchor read was supplied to this check — flag for one.'),
      z4BandBpm,
      sessionReads,
      excludedForMissingHr,
      lthrReanchorAdvisory: lthrReanchor,
    };
  }

  // ── (a) Compatible, no action ───────────────────────────────────────
  return {
    verdict: 'COMPATIBLE',
    paceProposalMayProceed: true,
    reason: `The controlled sessions backing this pace proposal sit inside or reasonably near `
      + `the runner's own Z4 ceiling (${z4BandBpm.lower}-${z4BandBpm.upper} bpm). The faster pace `
      + 'is compatible with existing HR evidence — HR stays put, no action.',
    z4BandBpm,
    sessionReads,
    excludedForMissingHr,
    lthrReanchorAdvisory: lthrReanchor,
  };
}
