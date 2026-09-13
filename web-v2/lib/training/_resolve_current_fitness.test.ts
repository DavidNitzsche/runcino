/**
 * lib/training/_resolve_current_fitness.test.ts
 *
 * Proves the three things the wave-2 proposal claims about
 * `resolve-current-fitness.ts`:
 *
 *   1. No-disagreement case: the canonical belief answers, and its
 *      provenance names both readings.
 *   2. It EXPLAINS its provenance — not just a number, the underlying
 *      canonical estimate and legacy cascade value are both present on the
 *      result, on both branches.
 *   3. It REFUSES rather than guesses when the belief and the legacy
 *      snapshot disagree by more than `SELF_HEAL_REANCHOR_DELTA`, and when
 *      the canonical belief has no VDOT to compare (below-table).
 *
 * `decideCurrentFitness` is pure, so these tests drive it directly with
 * hand-built fixtures — no database, no mocking of `resolveThresholdCapacity`
 * needed for the decision logic itself. A separate smoke test at the bottom
 * exercises `resolveCurrentFitnessVdot`'s wiring (that it calls the canonical
 * resolver and the read-only legacy query, and nothing else) with the DB
 * pool mocked.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): this suite does not re-test
 * `resolveThresholdCapacity`'s own ladder — that belongs to
 * `_capacity_resolver.test.ts`. It also does not prove the disagreement
 * threshold is the RIGHT number, only that the resolver respects whatever
 * `SELF_HEAL_REANCHOR_DELTA` currently is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SELF_HEAL_REANCHOR_DELTA } from '@/lib/training/pace-anchor';
import {
  decideCurrentFitness,
  resolveCurrentFitnessVdot,
  type CanonicalBeliefInput,
  type LegacySnapshotProbe,
} from '@/lib/training/resolve-current-fitness';

function canonical(overrides: Partial<CanonicalBeliefInput> = {}): CanonicalBeliefInput {
  return {
    vdot: 50.0,
    paceSecPerMi: 384,
    confidence: 0.72,
    sourceMode: 'direct',
    reasons: ['THREE_RECENT_CORROBORATING_SESSIONS', 'OBSERVATIONS_AGREE', 'FRESH_EVIDENCE'],
    evidenceIds: ['run-1', 'run-2', 'run-3'],
    resolvedAt: '2026-09-13T12:00:00.000Z',
    ...overrides,
  };
}

describe('decideCurrentFitness · no disagreement (current, real-world shape)', () => {
  it('answers with the canonical belief when the legacy cascade agrees within threshold', () => {
    const legacy: LegacySnapshotProbe = {
      status: 'ok',
      snapshot: { reviewedVdot: 46.6, authoredStateVdot: 48.9, cascadeVdot: 48.9 },
    };
    const result = decideCurrentFitness(canonical({ vdot: 50.0 }), legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vdot).toBe(50.0);
    expect(result.sourceMode).toBe('direct');
    // Provenance names BOTH readings, not just the number returned.
    expect(result.provenance.canonicalBelief.vdot).toBe(50.0);
    expect(result.provenance.legacyProbe).toEqual(legacy);
    expect(result.provenance.deltaVdot).toBeCloseTo(1.1, 5);
    expect(result.provenance.disagreementThresholdVdot).toBe(SELF_HEAL_REANCHOR_DELTA);
  });

  it('answers with the canonical belief alone when no legacy anchor exists at all', () => {
    const legacy: LegacySnapshotProbe = { status: 'none' };
    const result = decideCurrentFitness(canonical(), legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.provenance.deltaVdot).toBeNull();
    expect(result.provenance.legacyProbe.status).toBe('none');
  });

  it('answers with the canonical belief when the legacy cross-check read failed, and SAYS SO', () => {
    // Rule 11: a failed read is not the same fact as "no anchor exists".
    // The canonical belief still answers (a broken cross-check must not
    // block the doctrine-designated authority), but the provenance must
    // distinguish this from a clean no-disagreement check.
    const legacy: LegacySnapshotProbe = { status: 'failed' };
    const result = decideCurrentFitness(canonical(), legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.provenance.legacyProbe.status).toBe('failed');
    expect(result.provenance.deltaVdot).toBeNull();
  });
});

describe('decideCurrentFitness · refuses on real disagreement', () => {
  it('refuses when the canonical belief and the legacy cascade disagree by more than the threshold', () => {
    // This is the live, real shape this investigation found: vdot_last_reviewed
    // frozen at 46.6 for 4+ months while the canonical evidence-based belief
    // has moved. Exact numbers here are illustrative, not the live values.
    const legacy: LegacySnapshotProbe = {
      status: 'ok',
      snapshot: { reviewedVdot: 46.6, authoredStateVdot: 46.6, cascadeVdot: 46.6 },
    };
    const result = decideCurrentFitness(canonical({ vdot: 51.0 }), legacy);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('BELIEF_SNAPSHOT_DISAGREEMENT');
    // The refusal still carries both readings — a caller (or a human) can
    // see exactly what disagreed and by how much.
    expect(result.provenance.canonicalBelief.vdot).toBe(51.0);
    expect((result.provenance.legacyProbe as { status: 'ok'; snapshot: { cascadeVdot: number | null } }).snapshot.cascadeVdot).toBe(46.6);
    expect(result.provenance.deltaVdot).toBeCloseTo(4.4, 5);
    expect(result.detail).toMatch(/coaching decision/);
  });

  it('does not refuse at exactly the threshold, only strictly beyond it (Rule 9: no cliff at the boundary itself)', () => {
    const legacy: LegacySnapshotProbe = {
      status: 'ok',
      snapshot: { reviewedVdot: 48.0, authoredStateVdot: 48.0, cascadeVdot: 48.0 },
    };
    const atThreshold = decideCurrentFitness(
      canonical({ vdot: 48.0 + SELF_HEAL_REANCHOR_DELTA }),
      legacy,
    );
    expect(atThreshold.ok).toBe(true);

    const beyondThreshold = decideCurrentFitness(
      canonical({ vdot: 48.0 + SELF_HEAL_REANCHOR_DELTA + 0.01 }),
      legacy,
    );
    expect(beyondThreshold.ok).toBe(false);
  });

  it('refuses symmetrically when the legacy anchor reads HIGHER than the canonical belief', () => {
    const legacy: LegacySnapshotProbe = {
      status: 'ok',
      snapshot: { reviewedVdot: 55.0, authoredStateVdot: 55.0, cascadeVdot: 55.0 },
    };
    const result = decideCurrentFitness(canonical({ vdot: 50.0 }), legacy);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.provenance.deltaVdot).toBeCloseTo(-5.0, 5);
  });
});

describe('decideCurrentFitness · below-table incomparability', () => {
  it('refuses rather than fabricating a VDOT when the canonical belief is below-table', () => {
    const legacy: LegacySnapshotProbe = {
      status: 'ok',
      snapshot: { reviewedVdot: 30.0, authoredStateVdot: 30.0, cascadeVdot: 30.0 },
    };
    const result = decideCurrentFitness(canonical({ vdot: null, paceSecPerMi: 900 }), legacy);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('INCOMPARABLE_BELOW_TABLE');
    expect(result.detail).toMatch(/below-table/);
  });

  it('refuses the same way even with no legacy anchor to disagree with', () => {
    const result = decideCurrentFitness(canonical({ vdot: null }), { status: 'none' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('INCOMPARABLE_BELOW_TABLE');
  });
});

// ── Wiring smoke test · resolveCurrentFitnessVdot ──────────────────────────
//
// Proves this resolver (a) calls the canonical resolver, (b) issues exactly
// one READ-ONLY legacy query and no write of any kind, and (c) never touches
// `applyAdaptations`, `sealAutomaticActions`, or any mutation path — the
// 2026-09-02 seal is not reachable from this file because it is never
// imported.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn(async () => '2026-09-13') }));
vi.mock('@/lib/training/capacity-resolver', async () => {
  const actual = await vi.importActual<typeof import('@/lib/training/capacity-resolver')>(
    '@/lib/training/capacity-resolver',
  );
  return {
    ...actual,
    resolveThresholdCapacity: vi.fn(async () => ({
      vdot: 50.0,
      paceSecPerMi: 384,
      confidence: 0.72,
      sourceMode: 'direct',
      reasons: ['THREE_RECENT_CORROBORATING_SESSIONS'],
      evidenceIds: ['run-1'],
      resolvedAt: '2026-09-13T12:00:00.000Z',
      modelVersion: '1.0.0',
    })),
  };
});

describe('resolveCurrentFitnessVdot · wiring and seal preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the canonical resolver and one read-only legacy query, issues no write', async () => {
    const { pool } = await import('@/lib/db/pool');
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ reviewed: '46.6', authored_state: { pace_recompute: { vdot: 46.6 } } }],
    });

    const result = await resolveCurrentFitnessVdot('user-1');

    // Exactly one DB call, a SELECT, never an UPDATE/INSERT.
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/^\s*SELECT/i);
    expect(sql).not.toMatch(/UPDATE|INSERT|DELETE/i);

    // 50.0 vs 46.6 legacy anchor → delta 3.4, beyond the 2.0 threshold →
    // refusal, which is itself proof the cross-check ran on live-shaped data.
    expect(result.ok).toBe(false);
  });

  it('never imports the mutation seam', async () => {
    // Scoped to actual import/call sites, not prose — the file's own header
    // comment NAMES `adaptation-authority` and `applyAdaptations` to explain
    // why it does not use them, which a whole-file substring match cannot
    // tell apart from actually using them (Rule 18: an assertion that cannot
    // distinguish the two proves nothing).
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./resolve-current-fitness.ts', import.meta.url), 'utf8'),
    );
    const importLines = src
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/adaptation-authority/);
    expect(importLines).not.toMatch(/recompute-paces/);
    expect(importLines).not.toMatch(/['"]@\/lib\/plan\/adapt['"]/);
    // The only SQL statements this file may issue are SELECTs — mutation
    // verbs never appear outside prose describing what this file avoids,
    // so this checks the actual query template literals, not the whole file
    // (which legitimately names UPDATE/INSERT in its own header comment
    // explaining why it does neither).
    const allLiterals = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
    const sqlLiterals = allLiterals.filter((l) => /\bFROM\b/i.test(l));
    for (const q of sqlLiterals) {
      expect(q).toMatch(/^\s*SELECT/i);
      expect(q).not.toMatch(/UPDATE|INSERT|DELETE/i);
    }
    expect(sqlLiterals.length).toBeGreaterThan(0); // liveness: the scan found something
  });
});
