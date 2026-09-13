/**
 * lib/training/_current_fitness_contract.test.ts
 *
 * Q4 · the argued call, asserted rather than described: the two caveats found
 * on the owner's REAL live read do not refuse, and the two Rule 11 absences
 * do.
 *
 * Q5 · the typed contract, asserted the only way a type contract can be:
 * every outcome is answered or the call does not compile, and the numbers are
 * not properties of the returned object.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · WHETHER THE CLASSIFICATION IS CORRECT PHYSIOLOGY. `assessCaveats` encodes
 *   a judgement about which reason codes are confidence facts (§14) and which
 *   are absences (Rule 11). A miscategorised code yields a confident,
 *   well-typed, wrong tier and every test here still passes.
 * · A CALLER THAT REACHES INTO `._numbers`. TypeScript has no true private
 *   field on an object type; the repo-wide scan in
 *   `_wave2_no_mutation_scan.test.ts` is what watches for that, and it is a
 *   grep, not a proof.
 * · A HANDLER THAT RECEIVES THE CAVEATS AND IGNORES THEM. The type forces the
 *   parameter to exist. Nothing can force it to be used.
 * · THE COMPILE ERROR ITSELF. A vitest run cannot assert that omitting a
 *   handler fails `tsc`. The negative case is covered by a
 *   `@ts-expect-error` below, which DOES fail the typecheck if the error
 *   stops occurring — falsified by deleting it and watching `tsc` go quiet.
 */
import { describe, it, expect } from 'vitest';
import type { CapacityReasonCode } from '@/lib/training/capacity-resolver';
import type { CurrentFitnessRead } from '@/lib/training/resolve-current-fitness';
import {
  assessCaveats,
  toCurrentFitnessContract,
  withCurrentFitness,
  QUALIFYING_CAVEATS,
  DISQUALIFYING_CAVEATS,
} from '@/lib/training/current-fitness-contract';

/** The reason array measured against production for the owner on 2026-09-13. */
const REAL_REASONS: CapacityReasonCode[] = [
  'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE',
  'THREE_RECENT_CORROBORATING_SESSIONS',
  'OBSERVATIONS_AGREE',
  'FRESH_EVIDENCE',
  'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
  'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
];

function read(over: {
  reasons?: CapacityReasonCode[];
  vdot?: number;
  refuse?: { reason: 'BELIEF_SNAPSHOT_DISAGREEMENT' | 'INCOMPARABLE_BELOW_TABLE'; detail: string };
} = {}): CurrentFitnessRead {
  const provenance = {
    canonicalBelief: {
      vdot: over.vdot ?? 47.5,
      paceSecPerMi: 432,
      confidence: 0.772,
      sourceMode: 'direct' as const,
      reasons: over.reasons ?? REAL_REASONS,
      evidenceIds: ['-258355938987883', '-87627419857791', '-75144899844434'],
      resolvedAt: '2026-09-13T10:38:55.138Z',
    },
    legacyProbe: {
      status: 'ok' as const,
      snapshot: { reviewedVdot: 46.6, authoredStateVdot: 47.7, cascadeVdot: 46.6 },
    },
    deltaVdot: 0.9,
    disagreementThresholdVdot: 2,
  };
  if (over.refuse) {
    return { ok: false, reason: over.refuse.reason, detail: over.refuse.detail, provenance };
  }
  return {
    ok: true,
    vdot: over.vdot ?? 47.5,
    paceSecPerMi: 432,
    confidence: 0.772,
    sourceMode: 'direct',
    provenance,
  };
}

describe('Q4 · the argued call, on the real live shape', () => {
  it('REDUCED_AUTHORITY + NON_REPRESENTATIVE together do NOT refuse — they QUALIFY', () => {
    // Constitution §14: data quality modifies confidence, never creates
    // alternate truth. Both codes come from a reduced observation WEIGHT that
    // is already inside the 0.772 confidence returned beside them; refusing
    // charges the discount twice and promotes a confidence fact into a truth
    // fact. Rule 21: refusing here would make the resolver inert for the only
    // real runner this app has, on an ordinary day.
    const a = assessCaveats(REAL_REASONS);
    expect(a.tier).toBe('QUALIFIED');
    expect(a.caveats).toEqual([
      'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
      'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
    ]);
    expect(toCurrentFitnessContract(read()).outcome).toBe('qualified');
  });

  it('a clean read is CLEAN, and the two tiers are distinguishable — ok:true is no longer one fact', () => {
    const clean = assessCaveats([
      'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE', 'OBSERVATIONS_AGREE', 'FRESH_EVIDENCE',
    ]);
    expect(clean.tier).toBe('CLEAN');
    expect(toCurrentFitnessContract(read({ reasons: [
      'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE', 'OBSERVATIONS_AGREE', 'FRESH_EVIDENCE',
    ] })).outcome).toBe('clean');
    // Rule 11, the whole point: the two reads are BOTH `ok: true` underneath
    // and they are no longer the same fact upstream.
    expect(read().ok).toBe(true);
  });

  it('EVIDENCE_ENGINE_READ_UNAVAILABLE DOES refuse — a read that did not happen is not a weak read', () => {
    const a = assessCaveats([...REAL_REASONS, 'EVIDENCE_ENGINE_READ_UNAVAILABLE']);
    expect(a.tier).toBe('DISQUALIFYING');
    const c = toCurrentFitnessContract(read({
      reasons: [...REAL_REASONS, 'EVIDENCE_ENGINE_READ_UNAVAILABLE'],
    }));
    expect(c.outcome).toBe('refused');
    if (c.outcome !== 'refused') throw new Error('unreachable');
    expect(c.reason).toBe('DISQUALIFYING_CAVEATS');
  });

  it('OBSERVATIONS_DISAGREE + SPARSE_CORROBORATION refuse ONLY as a conjunction', () => {
    expect(assessCaveats(['OBSERVATIONS_DISAGREE']).tier).toBe('QUALIFIED');
    expect(assessCaveats(['SPARSE_CORROBORATION']).tier).toBe('QUALIFIED');
    expect(assessCaveats(['OBSERVATIONS_DISAGREE', 'SPARSE_CORROBORATION']).tier)
      .toBe('DISQUALIFYING');
  });

  it('the tier is DIRECTION-BLIND — Rule 21, and the signature proves it', () => {
    // `assessCaveats` takes exactly one argument and it is the reason list.
    // There is no direction to pass, so the bar to go UP cannot differ from
    // the bar to come DOWN. Asserted on the arity so a future added parameter
    // fails this test rather than sliding in.
    expect(assessCaveats.length).toBe(1);
    // And the same reasons yield the same tier whichever way the caller
    // intends to move the runner — there is only one call to make.
    expect(assessCaveats(REAL_REASONS).tier).toBe(assessCaveats([...REAL_REASONS].reverse()).tier);
  });

  it('the two lists are disjoint, and every code in them is a real CapacityReasonCode', () => {
    for (const c of DISQUALIFYING_CAVEATS) expect(QUALIFYING_CAVEATS).not.toContain(c);
    // Liveness (Rule 18): the lists are not empty, so the checks above are
    // not passing over nothing.
    expect(QUALIFYING_CAVEATS.length).toBeGreaterThan(0);
    expect(DISQUALIFYING_CAVEATS.length).toBeGreaterThan(0);
  });

  it('an underlying resolver refusal passes straight through, with its own reason preserved', () => {
    const c = toCurrentFitnessContract(read({
      refuse: { reason: 'BELIEF_SNAPSHOT_DISAGREEMENT', detail: 'they disagree by 4.4.' },
    }));
    expect(c.outcome).toBe('refused');
    if (c.outcome !== 'refused') throw new Error('unreachable');
    expect(c.reason).toBe('BELIEF_SNAPSHOT_DISAGREEMENT');
    // The caveats are still assessed and carried, so a refusal can say
    // whether the evidence was ALSO caveated. Two facts, both kept.
    expect(c.assessment.tier).toBe('QUALIFIED');
  });
});

describe('Q5 · the typed caller contract', () => {
  it('the numbers are not properties of the contract — there is no `.vdot` to read', () => {
    const c = toCurrentFitnessContract(read());
    expect(Object.prototype.hasOwnProperty.call(c, 'vdot')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(c, 'paceSecPerMi')).toBe(false);
  });

  it('the qualified route hands the caveats to the handler as a required argument', () => {
    let seen: readonly CapacityReasonCode[] | null = null;
    const out = withCurrentFitness(toCurrentFitnessContract(read()), {
      onClean: (n) => n.vdot,
      onQualified: (n, caveats) => { seen = caveats; return n.vdot; },
      onRefused: () => -1,
    });
    expect(out).toBe(47.5);
    expect(seen).toEqual([
      'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
      'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
    ]);
  });

  it('a refusal reaches onRefused with a reason a human can act on, never a number', () => {
    const out = withCurrentFitness(
      toCurrentFitnessContract(read({ reasons: ['EVIDENCE_ENGINE_READ_UNAVAILABLE'] })),
      {
        onClean: () => 'clean',
        onQualified: () => 'qualified',
        onRefused: (reason, detail) => `${reason}|${detail}`,
      },
    );
    expect(out).toMatch(/^DISQUALIFYING_CAVEATS\|/);
    expect(out).toMatch(/read that did not happen/);
  });

  it('omitting a handler is a COMPILE error, not a runtime surprise', () => {
    // @ts-expect-error — `onRefused` is required. Deleting this directive
    // makes `tsc --noEmit` fail, which is how this assertion is falsified:
    // if the contract ever stopped requiring every outcome, the directive
    // would become an unused-expect-error and the typecheck would break.
    withCurrentFitness(toCurrentFitnessContract(read()), {
      onClean: () => 0,
      onQualified: () => 0,
    });
    expect(true).toBe(true);
  });
});
