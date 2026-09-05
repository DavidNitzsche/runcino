/**
 * lib/adaptation/canonical/_demand_ceiling.test.ts · THE TWO SIDES OF RULE 1
 * ARE ONE QUANTITY.
 *
 * `arbitration.ts`'s header makes a claim in prose:
 *
 *     "The old three-term scale in `plan-load.ts` is NOT a rival and is not
 *      deleted: `weekly-demand.ts` imports its three coefficients, and on
 *      BASE_ONLY against an unknown context the two produce the identical
 *      number. That identity is asserted, not asserted-in-prose (Rule 20)."
 *
 * This file is that assertion. CLAUDE.md Rule 20's corollary is explicit that a
 * header comment stating an invariant is documentation and not enforcement —
 * `lthr-reanchor.ts` asserted in its own header that it imported no database at
 * any depth, it was false for a day, and it kept production undeployed while
 * every gate stayed green. Gate the claim or delete the sentence.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · THE COEFFICIENTS BEING RIGHT. It proves two pricing paths agree, never
 *   that either is true. A wrong coefficient shared by both passes every
 *   assertion here — that is what "one scale" buys and also what it costs.
 * · THE CEILING BEING THE RIGHT NUMBER for a real athlete. Every week here is
 *   constructed.
 * · WHETHER A LOADER SUPPLIES HONEST CONTEXT. It proves the resolver refuses
 *   what it should refuse, given what it is handed.
 */
import { describe, it, expect } from 'vitest';
import {
  priceProjectedWeek, unknownWeekDemandContext, ceilingCostOf,
  type DemonstratedWeek,
} from '@/lib/plan/adjudication/weekly-demand';
import { projectPlanLoad } from './plan-load';
import { resolveAthleteWeeklyDemandCeiling, priceWeekOnBasis } from './demand-ceiling';

const WEEK = { weeklyMi: 48, longRunMi: 16, qualityMinutes: 60 } as const;
const CTX = unknownWeekDemandContext('2026-09-07');

const absorbed = (over: Partial<DemonstratedWeek> = {}): DemonstratedWeek => ({
  weekStartISO: '2026-08-31',
  weeklyMi: 48,
  longRunMi: 16,
  qualityMinutes: 60,
  absorbed: true,
  context: null,
  ...over,
});

describe('RULE 16 · one scale, proven rather than asserted', () => {
  /* FALSIFIED · changing `QUALITY_MINUTE_TO_EASY_MILE` in `plan-load.ts` from
   * 0.33 to 0.4 does NOT break this (the demand model imports it, which is the
   * point). Retyping the constant inside `weekly-demand.ts` instead of
   * importing it, and then changing one copy (0.33 -> 0.4 inside
   * `baseCostOfWeek`), fails with "anchor delta 0: expected 76 to be close to
   * 71.8, received difference is 4.2". That is the drift this identity exists
   * to catch, and it is the only way to produce it. */
  it('BASE_ONLY against an unknown context IS the arbitration scale, exactly', () => {
    for (const delta of [0, -3, -12, 5]) {
      const model = priceProjectedWeek(CTX, { ...WEEK, thresholdAnchorDeltaSecPerMi: delta }, 'BASE_ONLY');
      const legacy = projectPlanLoad({ ...WEEK, thresholdAnchorDeltaSecPerMi: delta }).demandIndex;
      expect(model, `anchor delta ${delta}`).toBeCloseTo(legacy, 9);
    }
  });

  it('a faster anchor costs MORE, on both paths, by the same amount', () => {
    // The contract's "do not pretend pace changes are load-neutral", asserted
    // on the model side too — a pace lever whose demand delta were zero could
    // never be deferred for the week, which is behaviour 2's whole subject.
    const flat = priceProjectedWeek(CTX, { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, 'BASE_ONLY')!;
    const faster = priceProjectedWeek(CTX, { ...WEEK, thresholdAnchorDeltaSecPerMi: -3 }, 'BASE_ONLY')!;
    expect(faster).toBeGreaterThan(flat);
    expect(faster - flat).toBeCloseTo(
      projectPlanLoad({ ...WEEK, thresholdAnchorDeltaSecPerMi: -3 }).demandIndex
      - projectPlanLoad({ ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }).demandIndex,
      9,
    );
  });

  it('the omitted anchor delta is a MEASURED zero and never an unknown', () => {
    // The one default this file's model allows, and the argument for it is on
    // the field: a week nobody proposed anything against is priced at the
    // anchor it was written at. If that ever became an unknown, every
    // historical week would stop pricing.
    expect(ceilingCostOf({ ...CTX, ...WEEK }, 'BASE_ONLY'))
      .toBe(ceilingCostOf({ ...CTX, ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, 'BASE_ONLY'));
  });
});

describe('RULE 11 · the resolver refuses rather than inventing a ceiling', () => {
  /* FALSIFIED · replacing each `absent(...)`/`failed(...)` below with
   * `measured({ value: 0, ... })` fails with "expected true to be false" on
   * the corresponding `.ok` assertion. A ceiling of zero would suppress every
   * proposal forever and read, from the outside, exactly like a very careful
   * engine. */
  it('NOBODY LOOKED and NONE FOUND are different refusals with different sentences', () => {
    const didNotLook = resolveAthleteWeeklyDemandCeiling({
      context: CTX, week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, demonstratedWeeks: null,
    });
    const lookedAndFoundNone = resolveAthleteWeeklyDemandCeiling({
      context: CTX, week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, demonstratedWeeks: [],
    });
    expect(didNotLook.ok).toBe(false);
    expect(lookedAndFoundNone.ok).toBe(false);
    if (didNotLook.ok || lookedAndFoundNone.ok) throw new Error('unreachable');
    expect(didNotLook.why.kind).toBe('ABSENT');
    expect(lookedAndFoundNone.why.kind).toBe('ABSENT');
    // Two facts, two sentences.
    const a = didNotLook.why.kind === 'READ' ? '' : didNotLook.why.what;
    const b = lookedAndFoundNone.why.kind === 'READ' ? '' : lookedAndFoundNone.why.what;
    expect(a).not.toBe(b);
    expect(a).toMatch(/nobody looked/);
  });

  it('a week nobody has JUDGED does not raise the ceiling', () => {
    // `absorbed: null` is unknown, and unknown must not license a bigger plan.
    const unjudged = resolveAthleteWeeklyDemandCeiling({
      context: CTX,
      week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 },
      demonstratedWeeks: [absorbed({ absorbed: null, weeklyMi: 90 })],
    });
    expect(unjudged.ok).toBe(false);
  });

  it('a ceiling it cannot compare the week against is a FAILED read, not a number', () => {
    // The mixed-basis defect, made unsayable: the ceiling exists, and the week
    // being evaluated carries an unreadable quality term, so the comparison
    // refuses instead of running on half a basis.
    const r = resolveAthleteWeeklyDemandCeiling({
      context: CTX,
      week: { ...WEEK, qualityMinutes: Number.NaN, thresholdAnchorDeltaSecPerMi: 0 },
      demonstratedWeeks: [absorbed()],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.why.kind).toBe('FAILED');
  });
});

describe('the ceiling and every projection are priced on ONE basis', () => {
  it('a resolved ceiling prices the week it governs, and both sides agree', () => {
    const r = resolveAthleteWeeklyDemandCeiling({
      context: CTX, week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, demonstratedWeeks: [absorbed()],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // The demonstrated week IS this week, so the two must be equal to the last
    // digit. A comparison whose two sides came from different arithmetic would
    // be off by the context terms and nothing would say so.
    expect(priceWeekOnBasis(r.value, { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }))
      .toBeCloseTo(r.value.value, 9);
    expect(r.value.basis).toBe('BASE_ONLY');
    expect(r.value.fromWeekStartISO).toBe('2026-08-31');
  });

  it('an unknown component of the week is CARRIED OUT, not swallowed', () => {
    const r = resolveAthleteWeeklyDemandCeiling({
      context: CTX, week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 }, demonstratedWeeks: [absorbed()],
    });
    if (!r.ok) throw new Error('unreachable');
    // The unknown context makes four of the seven components unreadable, and a
    // reader of the decision record is entitled to know that rather than
    // seeing a confident number with no provenance.
    expect(r.value.unknownComponents.length).toBeGreaterThan(0);
    expect(r.value.detail).toMatch(/BASE_ONLY/);
  });

  it('the basis DEGRADES symmetrically rather than mixing', () => {
    // One unreconstructable absorbed week pulls BOTH sides down to BASE_ONLY.
    // The alternative — pricing the proposed week in full against a base-only
    // ceiling — inflates every week with two hard sessions, in the direction
    // this engine is already biased (Rule 22).
    const r = resolveAthleteWeeklyDemandCeiling({
      context: CTX,
      week: { ...WEEK, thresholdAnchorDeltaSecPerMi: 0 },
      demonstratedWeeks: [absorbed(), absorbed({ weekStartISO: '2026-08-24', weeklyMi: 52 })],
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.basis).toBe('BASE_ONLY');
    expect(r.value.weeksWithoutContext).toContain('2026-08-31');
    // The bigger week is the ceiling. It is the MAXIMUM absorbed week, not the
    // mean, because a mean would put his ceiling below weeks he has run.
    expect(r.value.fromWeekStartISO).toBe('2026-08-24');
  });
});
