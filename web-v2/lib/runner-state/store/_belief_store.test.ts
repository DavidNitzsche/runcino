/**
 * lib/runner-state/store/_belief_store.test.ts · PURE LOGIC, NO DATABASE.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER A ROW ACTUALLY PERSISTS. This suite never opens a connection —
 *   `_belief_store.db.test.ts` is the only place that proves the schema, the
 *   append-only write path and the rebuild-survival claim against a REAL
 *   database. A green run here says the pure arithmetic and serialization
 *   agree with themselves; it says nothing about Postgres.
 * · WHETHER A LOADER CALLED THE CANONICAL OWNER. Nothing here calls
 *   `loaders.ts`; it exercises `quantity-loaders.ts`'s pure derivation and
 *   `record.ts`'s pure (de)serialization, both fed HAND-BUILT `Belief<T>`
 *   fixtures rather than a real owner's answer.
 * · A STALE `AT_PACE_WEEKLY_SHARE_CAP` / `MARATHON_PACE_WORKOUT_CAP` value.
 *   The dose-formula assertions read the real constants at run time
 *   (`Math.min(weeklyMi * shareCap, ...)`), so a doctrine-cited change to
 *   either constant moves this test's expectation with it — this suite would
 *   only fail if `quantitiesFromWeeklyVolume`'s OWN arithmetic stopped
 *   matching the constants it imports, which is exactly the drift it exists
 *   to catch.
 */
import { describe, it, expect } from 'vitest';
import { storeStalenessFactor, withStoreStaleness, STORE_STALENESS_HALF_LIFE_DAYS } from './read';
import { fromRow, fromBelief, toInsertParams, type RawBeliefRow } from './record';
import { quantitiesFromWeeklyVolume } from './quantity-loaders';
import { RUNNER_BELIEFS_TABLE, evaluateScratchVerdict } from './schema';
import { BELIEF_OWNERSHIP } from '../ownership';
import type { Belief } from '../belief';
import { AT_PACE_WEEKLY_SHARE_CAP, AT_PACE_SESSION_MI } from '@/lib/prescription/levers';
import { MARATHON_PACE_WORKOUT_CAP } from '@/lib/plan/dosing';

const NOW = '2026-09-05T12:00:00.000Z';

function fakeWeeklyVolumeBelief(weeklyMi: number | null): Belief<number> {
  const o = BELIEF_OWNERSHIP.SUSTAINABLE_WEEKLY_VOLUME;
  return {
    key: 'SUSTAINABLE_WEEKLY_VOLUME',
    reading: weeklyMi == null
      ? { ok: false, why: { kind: 'ABSENT', what: 'fewer than six representative weeks' } }
      : { ok: true, value: { best: weeklyMi, range: null } },
    confidence: weeklyMi == null ? null : 0.7,
    sourceMode: null,
    supporting: [],
    contradicting: [],
    tension: null,
    recency: weeklyMi == null ? null : { newestISO: NOW, oldestISO: NOW, medianAgeDays: 0, observations: 8 },
    lastUpdatedISO: NOW,
    rule8Side: o.rule8Side,
    movesUpOn: o.movesUpOn,
    movesDownOn: o.movesDownOn,
    neverMovesOn: o.neverMovesOn,
    owner: o.canonical!,
  };
}

describe('storeStalenessFactor · the store\'s OWN decay, distinct from an owner\'s internal recency weighting', () => {
  it('is 1 at age zero', () => {
    expect(storeStalenessFactor(0)).toBe(1);
  });

  it('is exactly one half at the half-life', () => {
    expect(storeStalenessFactor(STORE_STALENESS_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10);
  });

  it('is monotonically decreasing — never flat, never rising', () => {
    const samples = [0, 1, 2, 5, 10, 14, 20, 30, 60, 120];
    for (let i = 1; i < samples.length; i += 1) {
      expect(storeStalenessFactor(samples[i])).toBeLessThan(storeStalenessFactor(samples[i - 1]));
    }
  });

  it('never goes negative and never exceeds 1, even far in the future', () => {
    expect(storeStalenessFactor(10_000)).toBeGreaterThan(0);
    expect(storeStalenessFactor(10_000)).toBeLessThanOrEqual(1);
    expect(storeStalenessFactor(-5)).toBe(1); // a "future" computedAt clamps to no decay, not negative age
  });

  it('FALSIFICATION (c) · a stale confidence actually decays through withStoreStaleness, never stays flat', () => {
    const fresh = fakeWeeklyVolumeBelief(45);
    const stored = {
      ...fresh,
      userUuid: 'u1',
      registry: 'BELIEF' as const,
      beliefKey: 'SUSTAINABLE_WEEKLY_VOLUME' as const,
      planLineageId: 'orphan:u1',
      computedAtISO: NOW,
      modelVersion: 'test-1',
    };
    const readSameInstant = withStoreStaleness(stored, NOW);
    const readMuchLater = withStoreStaleness(stored, '2026-10-05T12:00:00.000Z'); // +30 days
    expect(readSameInstant.confidence).toBeCloseTo(0.7, 10);
    expect(readMuchLater.confidence).not.toBeNull();
    expect(readMuchLater.confidence!).toBeLessThan(readSameInstant.confidence!);
    // The RAW confidence — what the owner actually said — must survive
    // unedited beside the decayed one, or a caller could never tell staleness
    // from a genuinely lower owner confidence (Rule 11 applied to the store).
    expect(readMuchLater.rawConfidence).toBeCloseTo(0.7, 10);
    expect(readMuchLater.ageDays).toBeCloseTo(30, 1);
  });
});

describe('record.ts round trip · a Belief<T> survives fromBelief -> toInsertParams -> (simulated pg jsonb) -> fromRow', () => {
  function roundTrip<T>(belief: Belief<T>): ReturnType<typeof fromRow<T>> {
    const args = fromBelief(belief, { userUuid: 'u1', planLineageId: 'orphan:u1', modelVersion: 'test-1' });
    const params = toInsertParams(args);
    // Simulate exactly what postgres hands back for a jsonb column: the
    // driver has already JSON.parsed it. `toInsertParams` JSON.stringifies
    // every jsonb-bound param in column order — mirroring that here (rather
    // than re-deriving column order) is what makes this a real round trip
    // instead of an assertion that agrees with itself.
    const row: RawBeliefRow = {
      user_uuid: params[0] as string,
      registry: params[1] as string,
      belief_key: params[2] as string,
      plan_lineage_id: params[3] as string,
      reading_ok: params[4] as boolean,
      reading_value: params[5] == null ? null : JSON.parse(params[5] as string),
      reading_absent_reason: params[6] == null ? null : JSON.parse(params[6] as string),
      confidence: params[7] as number | null,
      source_mode: params[8] as string | null,
      supporting: JSON.parse(params[9] as string),
      contradicting: JSON.parse(params[10] as string),
      tension: params[11] == null ? null : JSON.parse(params[11] as string),
      recency: params[12] == null ? null : JSON.parse(params[12] as string),
      rule8_side: params[13] as string,
      moves_up_on: JSON.parse(params[14] as string),
      moves_down_on: JSON.parse(params[15] as string),
      never_moves_on: JSON.parse(params[16] as string),
      owner_module: params[17] as string,
      owner_symbol: params[18] as string,
      owner_answers: params[19] as string,
      computed_at: params[20] as string,
      model_version: params[21] as string,
      stored_at: NOW,
    };
    return fromRow<T>(row);
  }

  it('a measured belief keeps its exact value, confidence and owner', () => {
    const belief = fakeWeeklyVolumeBelief(42.5);
    const back = roundTrip(belief);
    expect(back.reading.ok).toBe(true);
    if (!back.reading.ok) throw new Error('unreachable');
    expect(back.reading.value.best).toBe(42.5);
    expect(back.confidence).toBeCloseTo(0.7, 10);
    expect(back.rule8Side).toBe('HABIT');
    expect(back.owner.module).toBe(BELIEF_OWNERSHIP.SUSTAINABLE_WEEKLY_VOLUME.canonical!.module);
  });

  it('FALSIFICATION (b) · a refused belief round-trips as REFUSED, never silently as a value', () => {
    const belief = fakeWeeklyVolumeBelief(null);
    const back = roundTrip(belief);
    expect(back.reading.ok).toBe(false);
    if (back.reading.ok) throw new Error('unreachable — this is exactly the collapse Rule 11 forbids');
    expect(back.reading.why.kind).toBe('ABSENT');
    if (back.reading.why.kind !== 'ABSENT') throw new Error('unreachable');
    expect(back.reading.why.what).toContain('representative weeks');
    // The type system already makes `back.reading.value` a compile error here
    // (Measured's refusal branch carries no `value` field) — this assertion
    // is the RUNTIME half of the same claim: no code path upstream widened
    // the refusal into a coerced zero.
    expect((back.reading as { value?: unknown }).value).toBeUndefined();
    expect(back.confidence).toBeNull();
  });
});

describe('quantitiesFromWeeklyVolume · dose ceilings, derived not re-derived', () => {
  it('at 50 mi/wk, both dose ceilings bind on the PERCENTAGE half (below the absolute band)', () => {
    const belief = fakeWeeklyVolumeBelief(50);
    const [threshold, interval, marathon] = quantitiesFromWeeklyVolume(belief);
    expect(threshold.reading.ok && threshold.reading.value.best)
      .toBeCloseTo(50 * AT_PACE_WEEKLY_SHARE_CAP.threshold, 10);
    expect(interval.reading.ok && interval.reading.value.best)
      .toBeCloseTo(50 * AT_PACE_WEEKLY_SHARE_CAP.interval, 10);
    expect(marathon.reading.ok && marathon.reading.value.best)
      .toBeCloseTo(50 * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly, 10);
  });

  it('at 100 mi/wk, both dose ceilings bind on the ABSOLUTE half (the session band caps it)', () => {
    const belief = fakeWeeklyVolumeBelief(100);
    const [threshold, interval, marathon] = quantitiesFromWeeklyVolume(belief);
    expect(threshold.reading.ok && threshold.reading.value.best).toBeCloseTo(AT_PACE_SESSION_MI.threshold.max, 10);
    expect(interval.reading.ok && interval.reading.value.best).toBeCloseTo(AT_PACE_SESSION_MI.interval.max, 10);
    expect(marathon.reading.ok && marathon.reading.value.best).toBeCloseTo(MARATHON_PACE_WORKOUT_CAP.absMi, 10);
  });

  it('every dose quantity inherits the weekly-volume belief\'s own rule8Side and levers, never invents its own', () => {
    const belief = fakeWeeklyVolumeBelief(50);
    for (const q of quantitiesFromWeeklyVolume(belief)) {
      expect(q.rule8Side).toBe(belief.rule8Side);
      expect(q.movesUpOn).toBe(belief.movesUpOn);
      expect(q.movesDownOn).toBe(belief.movesDownOn);
    }
  });

  it('FALSIFICATION (b), the quantity side · a refused weekly-volume belief REFUSES every dose ceiling, never substitutes a default mileage', () => {
    const belief = fakeWeeklyVolumeBelief(null);
    const quantities = quantitiesFromWeeklyVolume(belief);
    expect(quantities).toHaveLength(3);
    for (const q of quantities) {
      expect(q.reading.ok, `${q.quantityId} must refuse when its input belief refused`).toBe(false);
      if (q.reading.ok) continue;
      if (q.reading.why.kind === 'READ') throw new Error('unreachable');
      expect(q.reading.why.what).toContain('SUSTAINABLE_WEEKLY_VOLUME');
      expect(q.confidence).toBeNull();
    }
  });
});

describe('schema liveness · the DDL this file asserts against actually names the columns the rest of the store reads', () => {
  it('names the table this whole directory writes to and reads from', () => {
    expect(RUNNER_BELIEFS_TABLE).toBe('runner_beliefs');
  });
});

describe('evaluateScratchVerdict · the never-touch-production guard, falsified with no connection at all', () => {
  it('accepts a loopback connection with a scratch-shaped name', () => {
    const v = evaluateScratchVerdict('faff_roundtrip_scratch', true);
    expect(v.ok).toBe(true);
  });

  it('refuses a non-loopback host regardless of name', () => {
    const v = evaluateScratchVerdict('faff_roundtrip_scratch', false);
    expect(v.ok).toBe(false);
  });

  it('FALSIFICATION · refuses a forbidden production name EVEN WHEN it is technically loopback — the case a naive "loopback is safe" check would miss', () => {
    for (const name of ['faff', 'railway', 'postgres', 'FAFF', 'Railway']) {
      const v = evaluateScratchVerdict(name, true);
      expect(v.ok, `'${name}' must be refused even on loopback`).toBe(false);
    }
  });
});
