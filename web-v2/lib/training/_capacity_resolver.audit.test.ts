/**
 * lib/training/_capacity_resolver.audit.test.ts · RENDER IT (Rule 13).
 *
 * Runs the four REAL canonical resolvers against the owner's actual account
 * over the read-only role, and prints what came out. Not part of the CI gate
 * chain (`.audit.` convention, same as `_pace_corpus.audit.test.ts` and
 * `_splits_repair_sql.audit.test.ts`) — it needs `DATABASE_URL_RO` and skips
 * without one, so CI never depends on a database.
 *
 * READ-ONLY, and enforced rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module under test must
 * be imported DYNAMICALLY inside the test body. A static top-level `import`
 * would be hoisted ahead of the override (ES module evaluation order) and
 * reconnect this file to whatever `DATABASE_URL` the process already had.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT (Rule 22) ────────────────────────
 *
 * It proves the wrapping layer preserves the numbers its readers produce, that
 * every resolver terminates against real data, and that the ladder picks the
 * rung the evidence supports on a real account. It does NOT validate the
 * numbers themselves — the readers underneath carry their own Rule 13 renders
 * for that (`_pace_corpus.audit.test.ts`, `_durability_anchor.audit.test.ts`),
 * and a wrapper cannot be more correct than what it wraps.
 *
 * THE LOAD-BEARING ASSERTION HERE is the pass-through check: the threshold
 * capacity's pace must EQUAL `resolveThresholdPaceCorpus`'s own, and the easy
 * ceiling must EQUAL `resolveEasyPaceCorpus`'s own, whenever both resolve
 * directly. A wrapping layer that quietly transforms the number it was built
 * to carry is the exact defect this file exists to catch before the wiring
 * phase builds on it.
 *
 * Run with:
 *   npx vitest run lib/training/_capacity_resolver.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Anchor "today" to a fixed real date rather than calling runnerToday (which
// would issue its own DB read before we need one). A stale anchor only narrows
// the lookback window; it never invalidates the read.
const TODAY = '2026-08-31';

describe.skipIf(!RO)('CAPACITY RESOLVER · rendered against the owner\'s real account', () => {
  it('resolves all four capacities, and the wrapping layer changes no number', async () => {
    process.env.DATABASE_URL = RO;
    const {
      resolveThresholdCapacity,
      resolveHighIntensityCapacity,
      resolveEasyCeiling,
      resolveDurability,
      CAPACITY_CONFIDENCE_BANDS,
    } = await import('@/lib/training/capacity-resolver');
    const { resolveThresholdPaceCorpus, resolveEasyPaceCorpus } =
      await import('@/lib/training/pace-corpus');

    const [threshold, highIntensity, easy, durability, rawThreshold, rawEasy] = await Promise.all([
      resolveThresholdCapacity(OWNER, TODAY),
      resolveHighIntensityCapacity(OWNER, TODAY),
      resolveEasyCeiling(OWNER, TODAY),
      resolveDurability(OWNER, TODAY),
      resolveThresholdPaceCorpus(OWNER, TODAY),
      resolveEasyPaceCorpus(OWNER, TODAY),
    ]);

    const brief = (label: string, e: { confidence: number; sourceMode: string; evidenceIds: string[]; reasons: string[] }) =>
      `${label} · mode=${e.sourceMode} confidence=${e.confidence.toFixed(3)} ` +
      `evidence=${e.evidenceIds.length} reasons=[${e.reasons.join(', ')}]`;

    /* eslint-disable no-console */
    console.log('\n══ THRESHOLD CAPACITY ══');
    console.log(brief('threshold', threshold));
    console.log(`  paceSecPerMi=${threshold.paceSecPerMi} (${Math.floor(threshold.paceSecPerMi / 60)}:${String(Math.round(threshold.paceSecPerMi % 60)).padStart(2, '0')}/mi)  vdot=${threshold.vdot}`);
    console.log(`  evidenceIds=${JSON.stringify(threshold.evidenceIds)}`);

    console.log('\n══ HIGH-INTENSITY CAPACITY ══');
    console.log(brief('high-intensity', highIntensity));
    console.log(`  I=${highIntensity.intervalPaceSecPerMi} s/mi  R=${highIntensity.repetitionPaceSecPerMi} s/mi  vdot=${highIntensity.vdot}`);
    console.log(`  evidenceIds=${JSON.stringify(highIntensity.evidenceIds)}`);

    console.log('\n══ EASY CEILING ══');
    console.log(brief('easy', easy));
    console.log(`  ceilingSecPerMi=${easy.ceilingSecPerMi} (${Math.floor(easy.ceilingSecPerMi / 60)}:${String(Math.round(easy.ceilingSecPerMi % 60)).padStart(2, '0')}/mi)`);
    console.log(`  evidenceIds=${JSON.stringify(easy.evidenceIds)}`);

    console.log('\n══ DURABILITY ══');
    console.log(brief('durability', durability));
    console.log(`  enduranceExponent=${durability.enduranceExponent}`);
    console.log(`  raceExponent=${JSON.stringify(durability.raceExponent)}`);
    console.log(`  decoupling=${JSON.stringify(durability.decoupling)}`);

    console.log('\n══ UNDERLYING READERS (pass-through check) ══');
    console.log(`  resolveThresholdPaceCorpus · ${JSON.stringify(rawThreshold.ok ? { tPace: rawThreshold.tPaceSecPerMi, vdot: rawThreshold.vdot, n: rawThreshold.observations } : rawThreshold)}`);
    console.log(`  resolveEasyPaceCorpus      · ${JSON.stringify(rawEasy.ok ? { ceiling: rawEasy.ceilingSecPerMi, n: rawEasy.observations } : rawEasy)}\n`);
    /* eslint-enable no-console */

    // ── THE PASS-THROUGH ASSERTION ─────────────────────────────────────────
    if (rawThreshold.ok) {
      expect(threshold.sourceMode).toBe('direct');
      expect(threshold.paceSecPerMi).toBe(rawThreshold.tPaceSecPerMi);
      expect(threshold.vdot).toBe(rawThreshold.vdot);
      expect(threshold.evidenceIds.sort()).toEqual(rawThreshold.supporting.map((o) => o.id).sort());
    } else {
      expect(threshold.sourceMode).not.toBe('direct');
    }
    if (rawEasy.ok) {
      expect(easy.sourceMode).toBe('direct');
      expect(easy.ceilingSecPerMi).toBe(rawEasy.ceilingSecPerMi);
    } else {
      expect(easy.sourceMode).not.toBe('direct');
    }

    // ── RANGE / SANITY (§30) ───────────────────────────────────────────────
    // Threshold must be FASTER than the easy ceiling. This is the sanity check
    // the whole pace-corpus pass was run to satisfy — a threshold read that
    // lands within a few seconds of a runner's easy pace is the defect, not a
    // finding — and it is asserted here on the CANONICAL resolvers rather than
    // on the readers, because it is the canonical numbers a plan will spend.
    expect(threshold.paceSecPerMi).toBeLessThan(easy.ceilingSecPerMi);
    // I-pace is faster than T-pace, always (Research/01 §Pace conversion).
    expect(highIntensity.intervalPaceSecPerMi).toBeLessThan(threshold.paceSecPerMi);
    // Every confidence sits inside a declared band.
    for (const e of [threshold, highIntensity, easy, durability]) {
      expect(e.confidence).toBeGreaterThanOrEqual(CAPACITY_CONFIDENCE_BANDS.populationPrior);
      expect(e.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.directCeiling);
      expect(e.reasons.length).toBeGreaterThan(0);
    }
    // A durability exponent outside a plausible endurance range would mean the
    // fit escaped its own shrinkage.
    expect(durability.enduranceExponent).toBeGreaterThan(0.9);
    expect(durability.enduranceExponent).toBeLessThan(1.4);
    // The aggregate is never less confident than its strongest component — the
    // defect this render itself found on 2026-08-31, asserted here on the real
    // account as well as on fixtures, because the real account is where the
    // component confidence that broke it (0.937) actually occurs.
    const strongestComponent = Math.max(
      durability.raceExponent.present ? durability.raceExponent.confidence : 0,
      durability.decoupling.present ? durability.decoupling.confidence : 0,
    );
    expect(durability.confidence).toBeGreaterThanOrEqual(strongestComponent);
  }, 60_000);
});
