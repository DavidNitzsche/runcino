/**
 * lib/plan/authoring-anchors.ts · HOW A COMPOSER GETS ITS SIX PRICES.
 *
 * `composePlan` is PURE — no `userId`, no pool, no clock — and that is
 * deliberate: it is what lets 11,598 sweep archetypes, every bench persona and
 * `/sim/plan` drive the real engine with no database. The canonical pace
 * anchors are DB-backed (`resolvePrescribedPaceAnchors` reads four capacity
 * resolvers per runner). Those two facts have to be reconciled, and this file
 * is the reconciliation.
 *
 * ── THE RULE, AND WHY THIS IS NOT A SECOND TRUTH (Constitution §8) ──────────
 *
 * There is ONE pricing path. `composePlan` reads `input.paceAnchors` and
 * nothing else. What differs between a real authoring and a synthetic one is
 * only WHERE the four capacity estimates came from:
 *
 *   · REAL   — `loadGeneratorInputs` calls `resolvePrescribedPaceAnchors`,
 *              the same function `recompute-paces.ts` and `reanchor-plan.ts`
 *              already call. Real corpus reads, real habit windows, real
 *              onboarding priors.
 *   · PURE   — `syntheticPaceAnchors` below feeds the caller's OWN evidence
 *              fields (`bestRecentVdot`, `belowTableAnchor`, `recentWeeklyMi`)
 *              into `composeThresholdCapacity` / `composeHighIntensityCapacity`
 *              / `composeEasyCeiling` / `composeDurability` — the identical
 *              PURE CORES the DB path resolves through — and then through the
 *              identical `composePaceAnchors`.
 *
 * So the ladder, the source modes, the confidence bands, the zone ordering and
 * the coherence refusal are the SAME CODE on both legs. The synthetic leg is
 * not a fallback to the old VDOT cascade; it is the canonical resolver with a
 * hand-supplied bottom rung, which is exactly what a fixture is for.
 *
 * ── WHY THIS MATTERS FOR THE CORPUS (Rule 15) ───────────────────────────────
 *
 * Before this, `_sweep_allusers`' archetypes could not reach the canonical
 * pricing layer AT ALL — it needed a `users` row. Every one of those 11,598
 * cases exercised only the legacy cascade, so the corpus was evidence about a
 * path the app was about to stop using. Routing the pure callers through the
 * pure cores is what makes the sweep evidence about the engine that ships.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · It cannot be more right than the evidence its caller hands it. A
 *     synthetic archetype has no pace corpus, so tier 1 (`direct`) is
 *     unreachable on this leg and every synthetic runner is priced off a
 *     fallback rung. That is honest — the fixture genuinely has no observed
 *     sessions — but it means the sweep cannot exercise the direct reader.
 *   · It has no durability EVIDENCE, so every synthetic marathon pace comes
 *     off the population Riegel exponent. A real runner's own fitted exponent
 *     is the single largest divergence the shadow compare measures, and no
 *     synthetic case can reach it.
 *   · It cannot catch a WIRING defect in `loadGeneratorInputs`. If the real
 *     path stopped calling `resolvePrescribedPaceAnchors`, every test that
 *     drives `composePlan` directly would still pass.
 */

import {
  composeThresholdCapacity,
  composeHighIntensityCapacity,
  composeEasyCeiling,
  composeDurability,
} from '@/lib/training/capacity-resolver';
import {
  composePaceAnchors,
  type PrescribedPaceAnchors,
  type PaceAnchorRead,
} from '@/lib/training/prescription-resolver';
import type { BelowTableAnchor } from '@/lib/training/vdot';
import type { NormalReading } from '@/lib/training/normal-window';

/** The evidence a pure caller actually has about a runner. Every field is
 *  already on `ComposePlanInput` / `ComposeNonRaceInput`; nothing new is
 *  invented and no goal is among them (Constitution §G). */
export interface SyntheticAnchorEvidence {
  /** The runner's measured VDOT, when the caller has one. */
  bestRecentVdot?: number | null;
  /** A demonstrated pace the [30,85] table cannot represent. */
  belowTableAnchor?: BelowTableAnchor | null;
  /** Habit weekly mileage — the cold-start rung's input. */
  recentWeeklyMi: number;
  /** Today, for the freshness terms. Fixtures may omit it. */
  todayISO?: string;
  /** The date behind `bestRecentVdot`, when the caller knows it. Absent →
   *  the freshness term reads it as undated, which `fallbackConfidence`
   *  already handles as its most conservative case. */
  bestRecentVdotDateISO?: string | null;
}

/**
 * Compose the six canonical anchors from a pure caller's own evidence.
 *
 * Returns the same `PaceAnchorRead` the DB path returns, refusal branch and
 * all — a synthetic caller must branch on an incoherent set exactly like a
 * real one, or the two legs would differ in the one place it matters.
 */
export function syntheticPaceAnchors(ev: SyntheticAnchorEvidence): PaceAnchorRead {
  const todayISO = ev.todayISO ?? '1970-01-01';
  // A synthetic caller has no pace corpus and no habit-window refusal to
  // report: it hands over a single mileage number it already believes.
  // Reported as an OK reading over a full representative window, because that
  // is what the caller is asserting — not as a refusal, which would be this
  // file inventing an uncertainty the caller never expressed (Rule 11).
  const normalWeeklyMi: NormalReading<number> = {
    ok: true,
    value: Math.max(0, ev.recentWeeklyMi),
    representativeDays: 28,
    excludedDays: 0,
  };
  const fallback = {
    measuredVdot: ev.bestRecentVdot ?? null,
    measuredVdotEvidenceId: null,
    measuredVdotDate: ev.bestRecentVdotDateISO ?? null,
    measuredVdotSource: null,
    belowTableAnchor: ev.belowTableAnchor ?? null,
    normalWeeklyMi,
    // A synthetic mileage number IS the caller's evidence about this runner's
    // running, so it saturates the coverage term: there is no onboarding
    // self-report on a fixture to retire, and treating the number as
    // zero-coverage would leave every archetype priced off a prior it never
    // supplied.
    normalRunDays: 16,
    selfReportedWeeklyMi: null,
    selfReportedPr: { ok: false as const, reason: 'NO_PR_ON_FILE' as const, considered: 0 as const, rejected: [] as [] },
  };

  const threshold = composeThresholdCapacity({
    direct: { ok: false, reason: 'no_observations', observations: 0 },
    fallback,
    todayISO,
  });
  const highIntensity = composeHighIntensityCapacity({ fallback, todayISO });
  const easyCeiling = composeEasyCeiling({
    direct: { ok: false, reason: 'no_observations', observations: 0 },
    threshold,
    todayISO,
  });
  const durability = composeDurability({
    raceExponent: { ok: false, reason: 'no_races', races: 0 },
    decoupling: { ok: false, reason: 'no_observations', observations: 0 },
  });

  return composePaceAnchors({ threshold, highIntensity, easyCeiling, durability });
}

/** Narrow helper for the composers: the anchors, or a thrown-away refusal
 *  turned into a caller-visible null. Kept separate from
 *  `syntheticPaceAnchors` so the refusal is never silently dropped inside the
 *  composer that needs it. */
export function anchorsOrNull(read: PaceAnchorRead): PrescribedPaceAnchors | null {
  return read.ok ? read.anchors : null;
}
