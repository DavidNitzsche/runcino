/**
 * lib/plan/authoring-shadow-compare.ts · SHADOW ONLY (§21, Rule 13, Rule 18).
 *
 * ── WHAT CHANGED ON 2026-09-01, AND WHY THE FILE HAD TO BE INVERTED ─────────
 *
 * When this file was written, `generate.ts` authored every plan through the
 * legacy VDOT cascade and the canonical anchors were the hypothetical. It
 * compared the REAL authoring path against a shadow twin.
 *
 * AUTHORING-CANONICAL-1 switched authoring over. So the real path is now the
 * canonical one, and the LEGACY leg is the reconstruction — and reconstructing
 * it is the only way to answer "what did this migration actually change".
 * Every claim in `docs/reports/canonical-authoring-migration-2026-09-01.md`
 * comes out of this file, so the reconstruction has to be exact and its limits
 * have to be stated rather than implied.
 *
 * ── WHAT THE LEGACY LEG REPRODUCES, EXACTLY ─────────────────────────────────
 *
 * `legacyAnchorsFor` rebuilds the four numbers the old `composePlan` priced a
 * block from, using the same functions it used:
 *
 *   · threshold  `resolveCurrentTPace(bestRecentVdot, belowTableAnchor,
 *                 recentWeeklyMi, conservativeVdotFromMileage)`
 *   · interval   the goal-distance-gated `iPaceFromVdot(vdotFromTpace(t))` /
 *                `iPaceFromAnchorPace`, `t − 18` when the goal was not
 *                5K/10K/HM
 *   · marathon   `resolveMarathonPace({tPaceSec, easyAnchorTSec, goalPaceSPerMi})`
 *   · easy       the legacy path had NO easy anchor of its own: every easy,
 *                long and recovery band was a fixed offset off the threshold
 *                scalar inside `buildWorkoutSpec`. The legacy leg therefore
 *                passes `anchors: null` for DAY PRICING, so those branches run
 *                exactly as they did.
 *
 * THE GOAL BLEND IS DELIBERATELY NOT REPRODUCED, and this is the one place
 * the reconstruction is not literal. `blendedTPaceForWeek` is deleted, and on
 * a FRESH AUTHORING it was a no-op anyway: `composeForUserInternal` only set
 * `measuredProgressFraction` when a prior non-archived plan for the same race
 * existed, and with it absent `gatedBlendFraction` returned 0, so
 * `weekT === currentT` for every week (verified in the audit's own §2 probe:
 * "blend 0.00 → weekT 7:11/mi Δ 0s (FRESH AUTHORING)"). The legacy leg
 * therefore reproduces a fresh authoring exactly and a MID-BLOCK REBUILD not
 * at all — on a rebuild the old engine moved the prescribed threshold up to
 * 20 s/mi toward the goal, which this comparison will UNDERSTATE. Said here
 * rather than discovered later.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ────────────────────────────────────────
 *
 *   · IT CANNOT JUDGE WHICH SIDE IS RIGHT. It produces a diff. The argument
 *     is the report's, and it is one person's read for a human to weigh.
 *   · THE STRUCTURAL LEG IS NOT A BYTE-LEGACY COMPOSITION. `composePlan` is
 *     re-run with a legacy-shaped anchor set so that `weekT`, `iPaceForWeek`
 *     and `weekMp` — the three inputs that drive workout SELECTION, the
 *     overload trajectory's at-pace caps and `layoutWeek`'s MP sizing — are
 *     the legacy numbers. That covers selection, phases, distances and week
 *     volumes, which is what the structural comparison is about. It does NOT
 *     make the legacy leg's day SPECS byte-legacy; those come from
 *     `specForComposedDay` with `anchors: null`, which is the real legacy
 *     builder.
 *   · IT READS WHATEVER ACCOUNTS THE CALLER NAMES. `resolvePrescribedPaceAnchors`
 *     is DB-backed per user. The synthetic `_sweep_allusers` corpus is reached
 *     through `compareArchetype` below, which drives the SAME comparison off
 *     `syntheticPaceAnchors` and therefore covers structure and pricing for
 *     runners this database does not contain — but never the DIRECT capacity
 *     rungs, because a synthetic runner has no pace corpus.
 *   · IT CANNOT PERSIST. No import of `mutatePlan`, `persistPlan` or
 *     `persistComposedPlan`; no write of any kind.
 */

import type { GenerateInput, DayPlan, ComposedWeek, ComposePlanInput, ComposePlanResult } from './generate';
import { composeForUser, specForComposedDay, composePlan, finalizeComposedPlan } from './generate';
import { buildWorkoutSpec, conservativeVdotFromMileage, resolveMarathonPace, totalDistanceMiFromSpec } from './spec-builder';
import {
  resolveCurrentTPace, iPaceFromVdot, iPaceFromAnchorPace, vdotFromTpace,
  type BelowTableAnchor,
} from '@/lib/training/vdot';
import { achievableRaceTarget } from '@/lib/training/achievable-target';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { syntheticPaceAnchors } from './authoring-anchors';
import { anchorSourceFromCapacityMode, isProvisionalAnchor } from './anchor-provenance';
import type { PrescribedPaceAnchors, PaceAnchorRead } from '@/lib/training/prescription-resolver';

/** The fields `specForComposedDay` needs, reproduced EXACTLY as
 *  `persistComposedPlan` builds them — so the legacy leg is provably what
 *  would have shipped, not a re-implementation that could quietly answer a
 *  different question. */
export interface LegacyAuthoringArgs {
  lthr: number | null;
  maxHr: number | null;
  goalPaceSec: number | null;
  easyAnchorTSec: number | null;
  belowTableAnchor?: BelowTableAnchor | null;
  prescribedRacePaceSec?: number | null;
}

/**
 * The four numbers the LEGACY composer priced a block from, rebuilt with the
 * functions it used. See the file header for what this reproduces exactly and
 * the one thing it deliberately does not.
 */
export interface LegacyPricing {
  thresholdSecPerMi: number | null;
  intervalSecPerMi: number | null;
  marathonSecPerMi: number | null;
  marathonAtGoalPace: boolean;
  goalPaceSec: number | null;
  iPaceEligible: boolean;
}

export function legacyPricingFor(
  compose: ComposePlanInput,
  distanceCategory: string,
): LegacyPricing {
  const t = resolveCurrentTPace(
    compose.bestRecentVdot ?? null, compose.belowTableAnchor ?? null,
    compose.recentWeeklyMi, conservativeVdotFromMileage,
  ).tPaceSec;
  const iPaceEligible = ['5k', '10k', 'hm'].includes(distanceCategory);
  const iPace = t == null
    ? null
    : (!iPaceEligible
        ? t - 18
        : ((compose.bestRecentVdot == null && compose.belowTableAnchor)
            ? iPaceFromAnchorPace(compose.belowTableAnchor.anchor)
            : (iPaceFromVdot(vdotFromTpace(t)) ?? t - 18)));
  const goalPaceSec = compose.goalPaceSec
    ?? (compose.belowTableAnchor ? Math.round(compose.belowTableAnchor.anchor.paceSPerMi) : null);
  const mp = (t != null && t > 0)
    ? resolveMarathonPace({ tPaceSec: t, easyAnchorTSec: t, goalPaceSPerMi: goalPaceSec })
    : null;
  return {
    thresholdSecPerMi: t,
    intervalSecPerMi: iPace,
    marathonSecPerMi: mp?.paceSPerMi ?? null,
    marathonAtGoalPace: mp?.source === 'goal',
    goalPaceSec,
    iPaceEligible,
  };
}

/**
 * A legacy-shaped `PrescribedPaceAnchors`, for RE-COMPOSING the block through
 * the (now canonical) `composePlan` so structure, phases, distances and week
 * volumes can be compared.
 *
 * Only three fields drive composition — `thresholdSecPerMi` (weekT and the
 * long-run time cap), `intervalSecPerMi` (the trajectory's at-pace caps) and
 * `marathonSecPerMi` (`layoutWeek`'s MP sizing) — and those three carry the
 * legacy numbers. The rest are filled coherently off the threshold, the same
 * way `buildWorkoutSpec`'s legacy branches would have derived them, so the set
 * is ordered and nothing downstream trips.
 */
export function legacyShapedAnchors(
  p: LegacyPricing,
  basis: PrescribedPaceAnchors['basis'],
): PrescribedPaceAnchors | null {
  const t = p.thresholdSecPerMi;
  if (t == null || !Number.isFinite(t) || t <= 0) return null;
  return {
    thresholdSecPerMi: Math.round(t),
    intervalSecPerMi: Math.round(p.intervalSecPerMi ?? t - 18),
    repetitionSecPerMi: null,
    // The legacy easy band's fast edge: `buildWorkoutSpec`'s own T+80.
    easyCeilingSecPerMi: Math.round(t + 80),
    shakeoutCeilingSecPerMi: Math.round(t + 110),
    marathonSecPerMi: Math.round(p.marathonSecPerMi ?? t + 18),
    basis,
  };
}

/** What one day's spec reduces to for a diff. */
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
  /** PERSISTED distance — the SPEC's summed total, which is what
   *  `persistedDayShape` writes to `plan_workouts.distance_mi` and which is
   *  pace-dependent through the rep-count cap. The audit named its absence
   *  (§3.5 point 2) as a fidelity gap on cold-start accounts, where the two
   *  legs can differ by 100-180 s/mi. */
  totalMi: number | null;
}

function summarize(
  built: { paceTargetSPerMi: number | null; spec: unknown },
  fallbackDistanceMi: number,
): SpecSummary {
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
    totalMi: built.spec ? totalDistanceMiFromSpec(built.spec as never, fallbackDistanceMi) : null,
  };
}

/**
 * THE LEGACY TWIN of `specForComposedDay`. Same day, the legacy per-call VDOT
 * derivations, and `anchors: null` — which is what makes every band inside
 * `buildWorkoutSpec` run its pre-migration offset arithmetic rather than
 * reading a canonical price.
 */
export function legacySpecForComposedDay(
  d: DayPlan,
  p: LegacyPricing,
  legacy: LegacyAuthoringArgs,
): { paceTargetSPerMi: number | null; spec: ReturnType<typeof buildWorkoutSpec>['spec'] } {
  const weekT = p.thresholdSecPerMi;
  if (weekT == null) return { paceTargetSPerMi: null, spec: null };
  const iPaceSec = (p.iPaceEligible || d.type === 'race_week_tuneup')
    ? (legacy.belowTableAnchor
        ? iPaceFromAnchorPace(legacy.belowTableAnchor.anchor)
        : iPaceFromVdot(vdotFromTpace(weekT)))
    : null;
  const built = buildWorkoutSpec(
    d.type, d.distanceMi, weekT, legacy.lthr, d.subLabel, legacy.maxHr ?? null,
    d.raceGoalPaceSec !== undefined ? d.raceGoalPaceSec : (legacy.goalPaceSec ?? null),
    iPaceSec,
    legacy.easyAnchorTSec ?? null,
    d.effortCued === true,
    d.raceGoalPaceSec !== undefined ? null : (legacy.prescribedRacePaceSec ?? null),
    null, // ← the whole point: legacy pricing is `anchors == null`
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

/** Week-level structure, for the comparison the day loop cannot see. */
export interface WeekShape {
  weekIdx: number;
  phase: string;
  weeklyMi: number;
  longMi: number;
  qualityDays: number;
  runDays: number;
  types: string;
}

function weekShapes(weeks: ComposedWeek[]): WeekShape[] {
  return weeks.map((w, i) => ({
    weekIdx: i,
    phase: w.phase,
    weeklyMi: Math.round((w.weeklyMi ?? 0) * 10) / 10,
    longMi: Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi)),
    qualityDays: w.days.filter((d) => d.isQuality).length,
    runDays: w.days.filter((d) => d.distanceMi > 0).length,
    types: w.days.map((d) => d.type).join('/'),
  }));
}

export interface StructuralDiff {
  weekIdx: number;
  field: string;
  legacy: string | number;
  canonical: string | number;
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
  legacy: LegacyPricing;
  /** The canonical leg. `anchors` is null exactly when the read refused
   *  (Rule 11 as a type, mirrored from `PaceAnchorRead`). */
  anchorRead: PaceAnchorRead;
  days: DayComparisonEntry[];
  /** SELECTION, PHASES, DISTANCES · the class the previous version of this
   *  file could not see at all, because both legs shared one composition. */
  structural: StructuralDiff[];
  legacyWeeks: WeekShape[];
  canonicalWeeks: WeekShape[];
}

/** Compare two week-shape arrays field by field. */
function diffWeeks(legacy: WeekShape[], canonical: WeekShape[]): StructuralDiff[] {
  const out: StructuralDiff[] = [];
  const n = Math.max(legacy.length, canonical.length);
  for (let i = 0; i < n; i++) {
    const l = legacy[i];
    const c = canonical[i];
    if (!l || !c) {
      out.push({ weekIdx: i, field: 'week exists', legacy: l ? 'yes' : 'no', canonical: c ? 'yes' : 'no' });
      continue;
    }
    for (const f of ['phase', 'weeklyMi', 'longMi', 'qualityDays', 'runDays', 'types'] as const) {
      if (l[f] !== c[f]) out.push({ weekIdx: i, field: f, legacy: l[f], canonical: c[f] });
    }
  }
  return out;
}

/** The comparison itself, once both compositions exist. Shared by the
 *  DB-backed and the synthetic-archetype entry points, so the two cannot
 *  measure different things (Rule 16). */
function compareCompositions(args: {
  compose: ComposePlanInput;
  canonicalComposed: ComposePlanResult;
  legacyComposed: ComposePlanResult | null;
  anchorRead: PaceAnchorRead;
  legacyPricing: LegacyPricing;
  legacyArgs: LegacyAuthoringArgs;
  totalWeeks: number;
  /** `composePlan`'s own `anchorIsProvisional`, so the canonical leg gates the
   *  race target the same way the shipped composer does. */
  anchorProvisional: boolean;
}): { days: DayComparisonEntry[]; structural: StructuralDiff[]; legacyWeeks: WeekShape[]; canonicalWeeks: WeekShape[] } {
  const days: DayComparisonEntry[] = [];
  const canonicalWeeks = weekShapes(args.canonicalComposed.weeks);
  const legacyWeeks = args.legacyComposed ? weekShapes(args.legacyComposed.weeks) : canonicalWeeks;
  const structural = args.legacyComposed ? diffWeeks(legacyWeeks, canonicalWeeks) : [];

  if (args.anchorRead.ok) {
    const anchors = args.anchorRead.anchors;
    // Days are compared on the CANONICAL composition — the one that ships.
    // Where the legacy composition selected something different, that is
    // reported in `structural` rather than silently paired up with a
    // different day.
    args.canonicalComposed.weeks.forEach((w, weekIdx) => {
      for (const d of w.days) {
        if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
        const legacyBuilt = legacySpecForComposedDay(d, args.legacyPricing, args.legacyArgs);
        const canonicalBuilt = specForComposedDay(d, anchors.thresholdSecPerMi, {
          lthr: args.legacyArgs.lthr,
          maxHr: args.legacyArgs.maxHr,
          goalPaceSec: args.legacyArgs.goalPaceSec,
          easyAnchorTSec: anchors.easyCeilingSecPerMi,
          belowTableAnchor: args.legacyArgs.belowTableAnchor ?? null,
          // MIRROR `composePlan` EXACTLY, provisional gate included. An
          // earlier version of this file passed the canonical VDOT
          // unconditionally, and on a cold-start archetype that BOUNDED a
          // race target `composePlan` deliberately leaves unbounded — the
          // compare then reported a 109 s/mi "divergence" that no shipped
          // plan has. A comparison that does not reproduce the guard is
          // measuring its own harness (Rule 13 point 2).
          prescribedRacePaceSec: args.anchorProvisional
            ? null
            : (achievableRaceTarget({
                goalSec: args.compose.goalSec,
                currentVdot: anchors.basis.threshold.vdot,
                raceDistanceMi: args.compose.raceDistanceMi,
                totalWeeks: args.totalWeeks,
              })?.paceSPerMi ?? null),
          anchors,
        });
        const l = summarize(legacyBuilt, d.distanceMi);
        const c = summarize(canonicalBuilt, d.distanceMi);
        days.push({
          weekIdx, phase: w.phase, isRaceWeek: w.isRaceWeek, dow: d.dow, type: d.type,
          isQuality: d.isQuality, isLong: d.isLong, distanceMi: d.distanceMi, subLabel: d.subLabel,
          legacy: l, canonical: c,
          paceDeltaSPerMi: (l.paceTargetSPerMi != null && c.paceTargetSPerMi != null)
            ? c.paceTargetSPerMi - l.paceTargetSPerMi
            : null,
        });
      }
    });
  }
  return { days, structural, legacyWeeks, canonicalWeeks };
}

/**
 * Run both authoring paths against the SAME real account and return a
 * structured, per-day AND per-week comparison. Read-only end to end.
 */
export async function runAuthoringShadowCompare(
  input: GenerateInput,
): Promise<AuthoringShadowCompareResult | AuthoringShadowCompareRefusal> {
  const staged = await composeForUser(input);
  if (!staged.ok) return { ok: false, reason: `composeForUser refused: ${staged.reason}` };
  const { compose, composed, mode, todayISO } = staged.result;

  const anchorRead = await resolvePrescribedPaceAnchors(input.userId, todayISO);

  const { distanceCategoryOf } = await import('./goal-tiers');
  const legacyPricing = legacyPricingFor(compose, distanceCategoryOf(compose.raceDistanceMi));

  // Not Rule 11's zero-erasure shape: a pace of zero or negative seconds per
  // mile is not a legitimate measurement this field could ever honestly
  // carry — it is malformed data, reported explicitly rather than folded into
  // a "no read" null.
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

  const legacyArgs: LegacyAuthoringArgs = {
    lthr: compose.lthr,
    maxHr: compose.maxHr,
    goalPaceSec: legacyPricing.goalPaceSec,
    easyAnchorTSec: legacyPricing.thresholdSecPerMi,
    belowTableAnchor: compose.belowTableAnchor ?? null,
    prescribedRacePaceSec: prescribedRacePaceSecLegacy,
  };

  // THE STRUCTURAL LEG · re-compose with the legacy prices so selection,
  // phases and distances can be compared. Failures are non-fatal: a legacy
  // pricing that cannot form a coherent set is itself the finding, and the
  // day-level comparison still runs.
  let legacyComposed: ComposePlanResult | null = null;
  if (anchorRead.ok) {
    const shaped = legacyShapedAnchors(legacyPricing, anchorRead.anchors.basis);
    if (shaped) {
      try {
        legacyComposed = composePlan({ ...compose, paceAnchors: shaped });
        // FINALIZE IT TOO. The canonical leg arrives from `composeForUser`,
        // which runs `finalizeComposedPlan` — the long-run WoW smoother, the
        // taper rescale, the dosing caps and the VOL-1 reconcile all live
        // there. Comparing a finalized composition against a raw one reported
        // a 35-mile block-volume "divergence" on the owner that was entirely
        // the missing pass; the real figure is under a mile. A harness that
        // does not run both legs through the same passes is measuring itself
        // (Rule 13 point 2).
        finalizeComposedPlan(legacyComposed, compose.raceDistanceMi, compose.level, compose.courseTerrain ?? undefined);
        legacyComposed.vols = legacyComposed.weeks.map((w) => w.weeklyMi);
      } catch (e) {
        console.error('[authoring-shadow-compare] legacy structural leg refused:', e);
      }
    }
  }

  const cmp = compareCompositions({
    compose, canonicalComposed: composed, legacyComposed, anchorRead,
    legacyPricing, legacyArgs, totalWeeks: composed.totalWeeks,
    anchorProvisional: anchorRead.ok
      ? isProvisionalAnchor(anchorSourceFromCapacityMode(anchorRead.anchors.basis.threshold.sourceMode))
      : true,
  });

  return {
    ok: true,
    userId: input.userId,
    todayISO,
    mode,
    totalWeeks: composed.totalWeeks,
    raceDistanceMi: compose.raceDistanceMi,
    goalSec: compose.goalSec,
    legacy: legacyPricing,
    anchorRead,
    ...cmp,
  };
}

/**
 * THE SYNTHETIC-CORPUS ENTRY POINT · the same comparison, driven off a
 * `ComposePlanInput` with no backing `users` row.
 *
 * The audit's §3.5 point 3 named the gap this closes: the DB-backed corpus is
 * four accounts, and `_sweep_allusers`' 11,598 archetypes could not be run
 * through the canonical layer at all because `resolvePrescribedPaceAnchors`
 * needs a user id. `syntheticPaceAnchors` runs the identical pure capacity
 * cores on the archetype's own evidence fields, so the archetype corpus now
 * reaches the pricing layer.
 *
 * WHAT IT STILL CANNOT REACH: the DIRECT rungs. A synthetic runner has no
 * pace corpus and no durability evidence, so every archetype is priced off a
 * fallback rung and off the POPULATION endurance exponent — and the runner's
 * own fitted exponent is the single largest divergence this comparison finds
 * on a real account. The archetype sweep therefore UNDERSTATES the marathon
 * axis by construction.
 */
export function compareArchetype(
  compose: ComposePlanInput,
  distanceCategory: string,
): AuthoringShadowCompareResult | AuthoringShadowCompareRefusal {
  const anchorRead = syntheticPaceAnchors({
    bestRecentVdot: compose.bestRecentVdot ?? null,
    belowTableAnchor: compose.belowTableAnchor ?? null,
    recentWeeklyMi: compose.recentWeeklyMi,
  });
  const legacyPricing = legacyPricingFor(compose, distanceCategory);

  let canonicalComposed: ComposePlanResult;
  try {
    canonicalComposed = composePlan({ ...compose, paceAnchors: anchorRead.ok ? anchorRead.anchors : null });
  } catch (e) {
    return { ok: false, reason: 'canonical composition refused', detail: e instanceof Error ? e.message : String(e) };
  }

  let legacyComposed: ComposePlanResult | null = null;
  if (anchorRead.ok) {
    const shaped = legacyShapedAnchors(legacyPricing, anchorRead.anchors.basis);
    if (shaped) {
      try {
        legacyComposed = composePlan({ ...compose, paceAnchors: shaped });
        finalizeComposedPlan(legacyComposed, compose.raceDistanceMi, compose.level, compose.courseTerrain ?? undefined);
        legacyComposed.vols = legacyComposed.weeks.map((w) => w.weeklyMi);
      } catch { legacyComposed = null; }
    }
  }

  const legacyArgs: LegacyAuthoringArgs = {
    lthr: compose.lthr,
    maxHr: compose.maxHr,
    goalPaceSec: legacyPricing.goalPaceSec,
    easyAnchorTSec: legacyPricing.thresholdSecPerMi,
    belowTableAnchor: compose.belowTableAnchor ?? null,
    prescribedRacePaceSec: null,
  };

  const cmp = compareCompositions({
    compose, canonicalComposed, legacyComposed, anchorRead,
    legacyPricing, legacyArgs, totalWeeks: canonicalComposed.totalWeeks,
    anchorProvisional: anchorRead.ok
      ? isProvisionalAnchor(anchorSourceFromCapacityMode(anchorRead.anchors.basis.threshold.sourceMode))
      : true,
  });

  return {
    ok: true,
    userId: 'synthetic',
    todayISO: compose.startMondayISO,
    mode: 'race-prep',
    totalWeeks: canonicalComposed.totalWeeks,
    raceDistanceMi: compose.raceDistanceMi,
    goalSec: compose.goalSec,
    legacy: legacyPricing,
    anchorRead,
    ...cmp,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE AGGREGATES · computed here, not in a reporter
 *
 * The branch report's five errors, per the independent audit's §8, were all
 * aggregation errors rather than mechanism errors: the largest-divergence
 * cause was misattributed, the eleven long runs carrying 93% of the
 * volume-weighted divergence were omitted from every summary, the band deltas
 * printed as "-", the comparison was described as against what the runner sees
 * when it is against what authoring produced, and "zero structural diffs" was
 * guaranteed by construction. Computing the aggregates HERE, once, is what
 * stops a reporter deciding which of them to show.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CompareAggregates {
  pricedDays: number;
  pricedMi: number;
  /** MEAN OF |Δ|, not of Δ. A signed mean lets a +200 and a −200 cancel, which
   *  is exactly how a large divergence can be reported as small (audit §3.5
   *  point 3). Both are returned so the direction is still visible. */
  meanAbsDeltaSPerMi: number | null;
  meanSignedDeltaSPerMi: number | null;
  /** Σ |Δ| × mi over ALL priced days — the whole-block figure, not the
   *  quality-only proxy the branch report headlined. */
  volumeWeightedAbsSMi: number;
  volumeWeightedSignedSMi: number;
  /** Volume-weighted mean |Δ|, s/mi. */
  volumeWeightedMeanAbsSPerMi: number | null;
  maxAbsDeltaSPerMi: number;
  maxAbsDeltaDays: DayComparisonEntry[];
  /** Per day TYPE, so the long runs and the marathon-pace days cannot be
   *  omitted from a summary again. */
  byType: Array<{ type: string; days: number; mi: number; meanDelta: number | null; sumAbsSMi: number }>;
  byPhase: Array<{ phase: string; days: number; meanAbsDelta: number | null }>;
  /** Band edges, for the day groups that carry no headline pace and printed
   *  as "-" in the branch report's table. */
  bands: Array<{ type: string; days: number; legacyLo: number | null; legacyHi: number | null; canonicalLo: number | null; canonicalHi: number | null; deltaLo: number | null }>;
  /** Read-only compare of the race row. Phase 3 owns race pricing; this
   *  reports whether it moved and never changes it. */
  raceRows: Array<{ weekIdx: number; type: string; legacy: number | null; canonical: number | null; delta: number | null }>;
  /** WU/CD and HR guidance, which should be identical by construction. */
  warmupCooldown: { legacyWu: number | null; canonicalWu: number | null; legacyCd: number | null; canonicalCd: number | null };
  hrDivergences: number;
  /** Persisted `distance_mi` — the spec's summed total, pace-dependent
   *  through the rep-count cap. Named by the audit as unmeasured. */
  totalMiDivergences: number;
}

export function aggregate(days: DayComparisonEntry[]): CompareAggregates {
  const priced = days.filter((d) => d.paceDeltaSPerMi != null);
  const abs = (d: DayComparisonEntry) => Math.abs(d.paceDeltaSPerMi ?? 0);
  const pricedMi = priced.reduce((s, d) => s + d.distanceMi, 0);
  const maxAbs = priced.reduce((m, d) => Math.max(m, abs(d)), 0);

  const types = Array.from(new Set(days.map((d) => d.type)));
  const phases = Array.from(new Set(days.map((d) => d.phase)));

  const bandFor = (type: string) => {
    const ds = days.filter((d) => d.type === type);
    const first = ds[0];
    return {
      type,
      days: ds.length,
      legacyLo: first?.legacy.paceLoSPerMi ?? null,
      legacyHi: first?.legacy.paceHiSPerMi ?? null,
      canonicalLo: first?.canonical.paceLoSPerMi ?? null,
      canonicalHi: first?.canonical.paceHiSPerMi ?? null,
      deltaLo: (first?.canonical.paceLoSPerMi != null && first?.legacy.paceLoSPerMi != null)
        ? first.canonical.paceLoSPerMi - first.legacy.paceLoSPerMi : null,
    };
  };

  return {
    pricedDays: priced.length,
    pricedMi: Math.round(pricedMi * 10) / 10,
    meanAbsDeltaSPerMi: priced.length ? priced.reduce((s, d) => s + abs(d), 0) / priced.length : null,
    meanSignedDeltaSPerMi: priced.length ? priced.reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0), 0) / priced.length : null,
    volumeWeightedAbsSMi: priced.reduce((s, d) => s + abs(d) * d.distanceMi, 0),
    volumeWeightedSignedSMi: priced.reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0) * d.distanceMi, 0),
    volumeWeightedMeanAbsSPerMi: pricedMi > 0
      ? priced.reduce((s, d) => s + abs(d) * d.distanceMi, 0) / pricedMi : null,
    maxAbsDeltaSPerMi: maxAbs,
    maxAbsDeltaDays: priced.filter((d) => abs(d) === maxAbs),
    byType: types.map((t) => {
      const ds = priced.filter((d) => d.type === t);
      return {
        type: t,
        days: ds.length,
        mi: Math.round(ds.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10,
        meanDelta: ds.length ? ds.reduce((s, d) => s + (d.paceDeltaSPerMi ?? 0), 0) / ds.length : null,
        sumAbsSMi: ds.reduce((s, d) => s + abs(d) * d.distanceMi, 0),
      };
    }).sort((a, b) => b.sumAbsSMi - a.sumAbsSMi),
    byPhase: phases.map((ph) => {
      const ds = priced.filter((d) => d.phase === ph);
      return { phase: ph, days: ds.length, meanAbsDelta: ds.length ? ds.reduce((s, d) => s + abs(d), 0) / ds.length : null };
    }),
    bands: types.filter((t) => ['easy', 'long', 'shakeout', 'recovery'].includes(t)).map(bandFor),
    raceRows: days.filter((d) => d.type === 'race' || d.type === 'race_week_tuneup').map((d) => ({
      weekIdx: d.weekIdx, type: d.type,
      legacy: d.legacy.paceTargetSPerMi, canonical: d.canonical.paceTargetSPerMi,
      delta: d.paceDeltaSPerMi,
    })),
    warmupCooldown: (() => {
      const q = days.filter((d) => d.isQuality);
      const mean = (vals: Array<number | null>) => {
        const v = vals.filter((x): x is number => x != null);
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      return {
        legacyWu: mean(q.map((d) => d.legacy.warmupMi)),
        canonicalWu: mean(q.map((d) => d.canonical.warmupMi)),
        legacyCd: mean(q.map((d) => d.legacy.cooldownMi)),
        canonicalCd: mean(q.map((d) => d.canonical.cooldownMi)),
      };
    })(),
    hrDivergences: days.filter((d) => d.legacy.hrCapBpm !== d.canonical.hrCapBpm).length,
    totalMiDivergences: days.filter((d) => d.legacy.totalMi !== d.canonical.totalMi).length,
  };
}
