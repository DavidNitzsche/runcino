/**
 * lib/plan/_plan_snapshot.test.ts · PLANSNAPSHOT-1's own coverage.
 *
 * `loadPlanSnapshot` itself is DB-integrated (owned-days, glance-state,
 * execution resolution, three live queries) — this project's own convention
 * (`lib/plan/_owned_days_active_first.test.ts` and siblings) is to test the
 * PURE decision functions directly rather than mock the database, and per
 * Rule 13 a fixture-based integration test would skip exactly the real-data
 * shapes that broke SPECFIRST-1 in the first place. The full loader was
 * instead live-verified against David's real, unmodified block via
 * `scripts/walk-substrate.sh` (isolated local copy, read-only from
 * production) — see the Stage-2 handback for the transcript: plan bounds
 * 2026-08-24..2026-12-06, 105 days, 2026-09-03 resolving `matched: exact`
 * with 1 supplemental run (the exact incident EXECUTION-IDENTITY-1's own
 * handback names), zero `Research/` citations anywhere in the response.
 *
 * What IS tested here, directly and falsifiably: the two pure projections
 * this file owns — `wireSafeCard` (the citation-scrub contract) and
 * `treadmillGuidanceFor` (the hill-vs-baseline incline decision).
 */
import { describe, it, expect } from 'vitest';
import { wireSafeCard, treadmillGuidanceFor, type PlanSnapshotCard } from './plan-snapshot';
import type { SpecCard } from '@/lib/training/spec-card';
import type { PrescriptionStep } from '@/lib/training/prescriptions';

function makeCard(overrides: Partial<SpecCard> = {}): SpecCard {
  return {
    type: 'threshold',
    headline: 'Threshold',
    why: 'Raises the pace you can hold for an hour.',
    citation: 'Research/04 §intervals-and-threshold',
    selectionRationale: 'Research/04 §15 places it on this slot in QUALITY.',
    steps: [],
    total_mi: 6,
    workPaceSPerMi: 420,
    workToleranceSPerMi: 8,
    hasRacePaceFinish: false,
    totalDurationSec: 2400,
    basis: 'spec',
    ...overrides,
  };
}

describe('wireSafeCard', () => {
  it('returns null for a null card (rest days carry no card)', () => {
    expect(wireSafeCard(null)).toBeNull();
  });

  it('strips citation and selectionRationale, keeps everything else byte-identical', () => {
    const card = makeCard();
    const wire = wireSafeCard(card) as PlanSnapshotCard;
    expect(wire).not.toHaveProperty('citation');
    expect(wire).not.toHaveProperty('selectionRationale');
    expect(wire.headline).toBe(card.headline);
    expect(wire.why).toBe(card.why);
    expect(wire.steps).toBe(card.steps);
    expect(wire.total_mi).toBe(card.total_mi);
    expect(wire.workPaceSPerMi).toBe(card.workPaceSPerMi);
    expect(wire.basis).toBe(card.basis);
  });

  it('never lets a Research/ reference survive in the serialized wire object', () => {
    const wire = wireSafeCard(makeCard());
    const serialized = JSON.stringify(wire);
    expect(serialized).not.toMatch(/Research\//);
  });

  it('falsified: a card carrying a citation ONLY in a field this function does not know to strip still leaks', () => {
    // Not a test of production code — a demonstration that the two-field
    // strip is a real, breakable guarantee, not a tautology. If someone
    // adds a THIRD citation-carrying field to SpecCard without updating
    // wireSafeCard, this is the shape of test that would need to change to
    // catch it — named here so the next person adding a field sees it.
    const card = { ...makeCard(), why: 'Research/99 leaked through an unstripped field' };
    const wire = wireSafeCard(card);
    expect(JSON.stringify(wire)).toMatch(/Research\//);
  });
});

describe('treadmillGuidanceFor', () => {
  it('returns null for a null card', () => {
    expect(treadmillGuidanceFor(null)).toBeNull();
  });

  it('returns null for a zero-mileage card (a rest-shaped card with no distance)', () => {
    expect(treadmillGuidanceFor(makeCard({ total_mi: 0 }))).toBeNull();
  });

  it('uses the baseline 1% incline when no step names a hill rep', () => {
    const steps: PrescriptionStep[] = [{ label: 'Reps', reps: 5, note: 'x' }];
    const g = treadmillGuidanceFor(makeCard({ steps }));
    expect(g?.inclinePct).toBe(1);
  });

  it('uses the doctrine 5% hill incline when any step carries rep_noun "hills"', () => {
    const steps: PrescriptionStep[] = [
      { label: 'Reps', reps: 8, rep_noun: 'hills', note: 'x' },
    ];
    const g = treadmillGuidanceFor(makeCard({ steps }));
    expect(g?.inclinePct).toBe(5);
  });

  it('derives speed from workPaceSPerMi as 3600 / pace, rounded to 0.1 mph', () => {
    // 7:00/mi = 420 s/mi → 3600/420 = 8.571... → 8.6 mph
    const g = treadmillGuidanceFor(makeCard({ workPaceSPerMi: 420 }));
    expect(g?.speedMph).toBe(8.6);
  });

  it('leaves speed null when the work goes out by feel (no workPaceSPerMi) — a hill day, typically', () => {
    const steps: PrescriptionStep[] = [{ label: 'Reps', reps: 10, rep_noun: 'hills', effort_target: 'By effort', note: 'x' }];
    const g = treadmillGuidanceFor(makeCard({ steps, workPaceSPerMi: null }));
    expect(g?.speedMph).toBeNull();
    expect(g?.inclinePct).toBe(5);
  });
});
