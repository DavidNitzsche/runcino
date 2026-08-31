/**
 * lib/plan/authoring-shadow-compare.ts · SHADOW ONLY (§21, Rule 13, Rule 18).
 *
 * Scoped by `docs/reports/canonical-authoring-migration-2026-09-01.md`, itself
 * the direct follow-on to the boundary named in
 * `docs/reports/pace-shadow-compare-2026-09-01.md` §3: `generate.ts` still
 * authors every plan through the legacy VDOT cascade
 * (`lib/training/vdot.ts`), while `recompute-paces.ts` / `reanchor-plan.ts`
 * (the flex path) already price every unrun day through the canonical
 * `capacity-resolver.ts` / `prescription-resolver.ts` layer.
 *
 * THIS FILE DOES NOT AUTHOR A PLAN, AND IT CANNOT PERSIST ONE. It has no
 * import of `mutatePlan`, `persistPlan`, `persistComposedPlan` or any `pool`
 * write. It calls exactly two read-only entry points that already exist for
 * this purpose:
 *
 *   · `composeForUser` (`generate.ts`) — the LEGACY path, in-memory, no
 *     persist. Its own doc comment: "every verification of a dated plan
 *     defect before this had to re-implement the wiring in a harness and
 *     therefore verified the harness, not the engine."
 *   · `resolvePrescribedPaceAnchors` (`load-prescription-anchors.ts`) — the
 *     CANONICAL path, the same function `recompute-paces.ts` /
 *     `reanchor-plan.ts` call for real.
 *
 * ── WHY THE COMPARISON IS A NEW FUNCTION, NOT A FLAG INSIDE `generate.ts` ───
 *
 * The brief that commissioned this file asked for the comparison "behind a
 * flag/parameter that defaults to not affecting persisted output." The
 * safer reading of that instruction, given `generate.ts` is 14,000+ lines,
 * is the single largest, most heavily-gated file in the plan engine, and
 * several other sessions are touching adjacent files the same night: ZERO
 * lines of `generate.ts` or `spec-builder.ts` change for this pass. The
 * "flag" is which function a caller reaches for — `specForComposedDay`
 * (real, untouched, every real caller still gets it) or
 * `canonicalSpecForComposedDay` below (new, reachable only from this file
 * and its own tests). A boolean living inside the real authoring function
 * is one accidental default away from changing what a live plan persists;
 * a function nothing in the real path calls cannot, structurally, do that.
 *
 * `canonicalSpecForComposedDay` mirrors `specForComposedDay` line for line,
 * substituting the six canonical anchors for the legacy per-call VDOT
 * derivations, in exactly the shape `recompute-paces.ts` already proved out
 * (`anchors.thresholdSecPerMi` as the `tPaceSec` argument, `anchors` itself
 * as the trailing argument `buildWorkoutSpec` has carried, unused by every
 * authoring caller, since PRESCRIPTION-WIRE-1 landed).
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT (Rule 22) ────────────────────────
 *
 *   · It proves the two paths terminate on real composed weeks and produces
 *     an inspectable, structured diff.
 *   · IT DOES NOT SAY WHICH SIDE IS RIGHT where they disagree. That
 *     judgement is the report's own §5, explicitly labelled as one person's
 *     read for a human to weigh — see the brief's stated boundary.
 *   · IT READS WHATEVER ACCOUNTS THE CALLER NAMES. `resolvePrescribedPaceAnchors`
 *     is DB-backed per user; a synthetic `ComposePlanInput` archetype with no
 *     backing `users` row cannot be run through it at all — see the report's
 *     §5 for why the literal `_sweep_allusers` corpus could not be reached
 *     this way, and what was read instead.
 */

import type { GenerateInput, DayPlan, ComposedWeek } from './generate';
import { composeForUser, specForComposedDay } from './generate';
import { buildWorkoutSpec, conservativeVdotFromMileage } from './spec-builder';
import { resolveCurrentTPace, type BelowTableAnchor } from '@/lib/training/vdot';
import { achievableRaceTarget } from '@/lib/training/achievable-target';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PrescribedPaceAnchors, PaceAnchorRead } from '@/lib/training/prescription-resolver';

/** The fields `specForComposedDay` already needs, reproduced here EXACTLY as
 *  `persistComposedPlan` builds them for the real persisted call — so the
 *  "legacy" leg of this comparison is provably what would actually ship,
 *  not a re-implementation that could quietly answer a different question. */
export interface LegacyAuthoringArgs {
  lthr: number | null;
  maxHr: number | null;
  goalPaceSec: number | null;
  easyAnchorTSec: number | null;
  goalIPaceEligible: boolean;
  belowTableAnchor?: BelowTableAnchor | null;
  prescribedRacePaceSec?: number | null;
}

/** What one day's spec reduces to for a diff. Every field a human or a test
 *  might reasonably compare — not the full `WorkoutSpecKind`, which varies
 *  shape by branch (rest/cross have none at all). */
export interface SpecSummary {
  paceTargetSPerMi: number | null;
  kind: string | null;
  byEffort: boolean;
  warmupMi: number | null;
  cooldownMi: number | null;
  repCount: number | null;
  repDistanceMi: number | null;
  repPaceSPerMi: number | null;
  repRestS: number | null;
  paceLoSPerMi: number | null;
  paceHiSPerMi: number | null;
  hrCapBpm: number | null;
  lthrBpm: number | null;
  label: string | null;
}

function summarize(built: { paceTargetSPerMi: number | null; spec: unknown }): SpecSummary {
  const spec = (built.spec ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    paceTargetSPerMi: built.paceTargetSPerMi,
    kind: str(spec.kind),
    byEffort: spec.by_effort === true,
    warmupMi: num(spec.warmup_mi),
    cooldownMi: num(spec.cooldown_mi),
    repCount: num(spec.rep_count),
    repDistanceMi: num(spec.rep_distance_mi),
    repPaceSPerMi: num(spec.rep_pace_s_per_mi),
    repRestS: num(spec.rep_rest_s),
    paceLoSPerMi: num(spec.pace_target_s_per_mi_lo),
    paceHiSPerMi: num(spec.pace_target_s_per_mi_hi),
    hrCapBpm: num(spec.hr_cap_bpm),
    lthrBpm: num(spec.lthr_bpm),
    label: str(spec.label),
  };
}

/**
 * THE SHADOW TWIN of `specForComposedDay`. Identical day-placement inputs,
 * the CANONICAL six anchors instead of the legacy per-call VDOT cascade.
 *
 * Follows `recompute-paces.ts`'s own proven wiring exactly:
 *   · `anchors.thresholdSecPerMi` where the legacy call passed `weekT`
 *   · `anchors.intervalSecPerMi` where the legacy call passed a
 *     goal-distance-gated `iPaceSec` (PRESCRIPTION-WIRE-1's own comment:
 *     "the I-PACE ELIGIBILITY GATE IS DELETED, NOT MOVED" — high-intensity
 *     capacity answers for every runner, unconditionally, once it is wired)
 *   · `anchors.easyCeilingSecPerMi` where the legacy call passed
 *     `easyAnchorTSec`
 *   · `anchors` itself as the trailing argument, so every branch
 *     `buildWorkoutSpec` has that reads `anchors` directly (easy band,
 *     tempo, marathon, interval — see `spec-builder.ts` lines ~1130-1140)
 *     takes over from the positional arguments
 *
 * `prescribedRacePaceSec` is re-derived off the CANONICAL threshold VDOT
 * (`anchors.basis.threshold.vdot`) rather than carried from the legacy leg,
 * matching RACEPACE-1's own precedent in `recompute-paces.ts`: "Race
 * Prediction consumes the Runner Model (Constitution §J), and handing it a
 * different fitness read than the one that priced the block would be two
 * answers to one question (Rule 16)." Race Prediction itself is NOT being
 * migrated here — `achievableRaceTarget` is untouched — only its INPUT
 * moves to the canonical VDOT, exactly as it already does in the live flex
 * path.
 */
export function canonicalSpecForComposedDay(
  d: DayPlan,
  anchors: PrescribedPaceAnchors,
  legacy: LegacyAuthoringArgs,
  totalWeeks: number,
  goalSec: number | null,
  raceDistanceMi: number,
): { paceTargetSPerMi: number | null; spec: ReturnType<typeof buildWorkoutSpec>['spec'] } {
  const canonicalRacePaceSec = achievableRaceTarget({
    goalSec,
    currentVdot: anchors.basis.threshold.vdot,
    raceDistanceMi,
    totalWeeks,
  })?.paceSPerMi ?? null;

  const raceGoalPaceSec = d.raceGoalPaceSec !== undefined ? d.raceGoalPaceSec : (legacy.goalPaceSec ?? null);
  const prescribedRacePaceSec = d.raceGoalPaceSec !== undefined ? null : canonicalRacePaceSec;

  const built = buildWorkoutSpec(
    d.type, d.distanceMi,
    anchors.thresholdSecPerMi,          // tPaceSec — legacy weekT's canonical twin
    legacy.lthr,
    d.subLabel,
    legacy.maxHr ?? null,
    raceGoalPaceSec,
    anchors.intervalSecPerMi,           // iPaceSec — unconditional, per PRESCRIPTION-WIRE-1
    anchors.easyCeilingSecPerMi,        // easyAnchorTSec
    d.effortCued === true,
    prescribedRacePaceSec,
    anchors,                            // the argument every real caller still passes null
  );
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}

export interface DayComparisonEntry {
  weekIdx: number;
  phase: string;
  isRaceWeek: boolean;
  dow: number;
  type: DayPlan['type'];
  isQuality: boolean;
  isLong: boolean;
  distanceMi: number;
  subLabel: string | null;
  legacy: SpecSummary;
  canonical: SpecSummary;
  /** null when either side has no headline pace (rest/cross, or a
   *  by-effort/no-target branch on both sides — Rule 11: a missing pace on
   *  ONE side only is reported as a structural diff, never coerced to 0). */
  paceDeltaSPerMi: number | null;
}

export interface AuthoringShadowCompareRefusal {
  ok: false;
  reason: string;
  detail?: string;
}

export interface AuthoringShadowCompareResult {
  ok: true;
  userId: string;
  todayISO: string;
  mode: string;
  totalWeeks: number;
  raceDistanceMi: number;
  goalSec: number | null;
  /** The legacy leg's plan-wide anchors, for the top-line diff. */
  legacy: {
    tPaceSec: number | null;
    bestRecentVdot: number | null | undefined;
  };
  /** The canonical leg. `anchors` is null exactly when `anchorRefusal` is
   *  set (Rule 11 as a type, mirrored from `PaceAnchorRead`). */
  anchorRead: PaceAnchorRead;
  days: DayComparisonEntry[];
}

/**
 * Run both authoring paths against the SAME real account and return a
 * structured, per-day comparison. Read-only end to end.
 *
 * `input` is whatever `composeForUser` would take for a real authoring call
 * (raceSlug or goalTarget) — this function does not invent one.
 */
export async function runAuthoringShadowCompare(
  input: GenerateInput,
): Promise<AuthoringShadowCompareResult | AuthoringShadowCompareRefusal> {
  const staged = await composeForUser(input);
  if (!staged.ok) return { ok: false, reason: `composeForUser refused: ${staged.reason}` };
  const { compose, composed, mode, todayISO } = staged.result;

  const anchorRead = await resolvePrescribedPaceAnchors(input.userId, todayISO);

  // ── THE LEGACY ARGS, REPRODUCED EXACTLY AS persistComposedPlan BUILDS THEM ──
  const easyAnchorTSec = resolveCurrentTPace(
    compose.bestRecentVdot ?? null, compose.belowTableAnchor ?? null,
    compose.recentWeeklyMi, conservativeVdotFromMileage,
  ).tPaceSec;

  // Not Rule 11's zero-erasure shape: a pace of zero or negative seconds per
  // mile is not a legitimate measurement this field could ever honestly
  // carry (unlike a count or a distance, which CAN be a real zero) — it is
  // malformed data, and the guard below reports that state explicitly via an
  // early return rather than folding a real "zero pace" into a "no read"
  // null, because no real pace read can be zero.
  const prescribedRacePaceSecLegacy = ((): number | null => {
    const p = (composed.authoredState as Record<string, unknown> | undefined)
      ?.prescribed_race_pace as { pace_s_per_mi?: unknown } | null | undefined;
    const v = p?.pace_s_per_mi;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (v <= 0) {
      console.error(`[authoring-shadow-compare] malformed prescribed_race_pace.pace_s_per_mi=${v} (not a real measurement, treating as absent)`);
      return null;
    }
    return v;
  })();

  const goalPaceSecLegacy = compose.goalPaceSec
    ?? (compose.belowTableAnchor ? Math.round(compose.belowTableAnchor.anchor.paceSPerMi) : null);

  const iPaceEligible = ['5k', '10k', 'hm'].includes(
    // Local, tiny re-implementation of `distanceCategoryOf` avoided on
    // purpose — imported from goal-tiers.ts, the exported sibling of
    // generate.ts's own module-local copy, so this file cannot drift from
    // either.
    (await import('./goal-tiers')).distanceCategoryOf(compose.raceDistanceMi),
  );

  const legacyArgs: LegacyAuthoringArgs = {
    lthr: compose.lthr,
    maxHr: compose.maxHr,
    goalPaceSec: goalPaceSecLegacy,
    easyAnchorTSec,
    goalIPaceEligible: iPaceEligible,
    belowTableAnchor: compose.belowTableAnchor ?? null,
    prescribedRacePaceSec: prescribedRacePaceSecLegacy,
  };

  const days: DayComparisonEntry[] = [];
  if (anchorRead.ok) {
    const anchors = anchorRead.anchors;
    (composed.weeks as ComposedWeek[]).forEach((w, weekIdx) => {
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? compose.tPaceSec ?? null;
      for (const d of w.days) {
        if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
        const legacyBuilt = specForComposedDay(d, weekT, legacyArgs);
        const canonicalBuilt = canonicalSpecForComposedDay(
          d, anchors, legacyArgs, composed.totalWeeks, compose.goalSec, compose.raceDistanceMi,
        );
        const l = summarize(legacyBuilt);
        const c = summarize(canonicalBuilt);
        days.push({
          weekIdx,
          phase: w.phase,
          isRaceWeek: w.isRaceWeek,
          dow: d.dow,
          type: d.type,
          isQuality: d.isQuality,
          isLong: d.isLong,
          distanceMi: d.distanceMi,
          subLabel: d.subLabel,
          legacy: l,
          canonical: c,
          paceDeltaSPerMi: (l.paceTargetSPerMi != null && c.paceTargetSPerMi != null)
            ? c.paceTargetSPerMi - l.paceTargetSPerMi
            : null,
        });
      }
    });
  }

  return {
    ok: true,
    userId: input.userId,
    todayISO,
    mode,
    totalWeeks: composed.totalWeeks,
    raceDistanceMi: compose.raceDistanceMi,
    goalSec: compose.goalSec,
    legacy: { tPaceSec: compose.tPaceSec ?? null, bestRecentVdot: compose.bestRecentVdot },
    anchorRead,
    days,
  };
}
