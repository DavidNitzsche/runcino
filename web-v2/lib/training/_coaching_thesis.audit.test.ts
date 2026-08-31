/**
 * lib/training/_coaching_thesis.audit.test.ts · RENDER IT (Rule 13).
 *
 * Runs the real `resolveCoachingThesis` against the owner's actual account
 * over the read-only role, and prints what came out. Not part of the CI gate
 * chain (`.audit.` convention, same as `_capacity_resolver.audit.test.ts`) —
 * needs `DATABASE_URL_RO` and skips without one, so CI never depends on a
 * database.
 *
 * READ-ONLY, enforced the same way its sibling enforces it:
 * `process.env.DATABASE_URL` is overridden onto the read-only role BEFORE
 * `lib/db/pool`'s module-level `new Pool(...)` is constructed, so every app
 * module under test is imported DYNAMICALLY inside the test body.
 *
 * Run with:
 *   npx vitest run lib/training/_coaching_thesis.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-08-31';

describe.skipIf(!RO)('COACHING THESIS · rendered against the owner\'s real account', () => {
  it('resolves a real thesis, ranking derived from the real capacity resolvers', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveCoachingThesis } = await import('@/lib/training/coaching-thesis');
    const {
      resolveThresholdCapacity,
      resolveHighIntensityCapacity,
      resolveDurability,
      CAPACITY_CONFIDENCE_BANDS,
    } = await import('@/lib/training/capacity-resolver');

    const [thesis, threshold, highIntensity, durability] = await Promise.all([
      resolveCoachingThesis(OWNER, TODAY),
      resolveThresholdCapacity(OWNER, TODAY),
      resolveHighIntensityCapacity(OWNER, TODAY),
      resolveDurability(OWNER, TODAY),
    ]);

    /* eslint-disable no-console */
    console.log('\n══ COACHING THESIS ══');
    console.log(`  primaryLimiter=${thesis.primaryLimiter}  basis=${thesis.basis}`);
    console.log(`  priority=${thesis.priority}`);
    console.log(`  confidence=${thesis.confidence.toFixed(3)}  evidenceIds=${JSON.stringify(thesis.evidenceIds)}`);
    console.log(`  reasons=[${thesis.reasons.join(', ')}]`);
    console.log('  ranking:');
    for (const r of thesis.ranking) {
      console.log(`    ${r.capacity.padEnd(14)} confidence=${r.confidence.toFixed(3)} normalized=${r.normalizedConfidence.toFixed(3)} sourceMode=${r.sourceMode}`);
    }
    console.log(`  secondaryPriority=${JSON.stringify(thesis.secondaryPriority)}`);
    console.log(`  notPriority=${JSON.stringify(thesis.notPriority)}`);
    console.log('  reconsiderIf:');
    for (const c of thesis.reconsiderIf) console.log(`    - ${c}`);
    console.log(`  addressedBy (${thesis.addressedBy.length} session(s) this week):`);
    for (const s of thesis.addressedBy) {
      console.log(`    ${s.dateIso} ${s.type} "${s.subLabel}" — rationale: ${s.selectionRationale ?? '(none persisted)'}`);
    }
    console.log(`  resolvedAt=${thesis.resolvedAt}\n`);
    /* eslint-enable no-console */

    // ── STRUCTURAL ASSERTIONS ────────────────────────────────────────────
    expect(['THRESHOLD', 'HIGH_INTENSITY', 'DURABILITY']).toContain(thesis.primaryLimiter);
    expect(thesis.ranking).toHaveLength(3);
    // The ranking is sorted ascending by normalizedConfidence — the primary
    // limiter is always ranking[0].
    expect(thesis.ranking[0].capacity).toBe(thesis.primaryLimiter);
    for (let i = 1; i < thesis.ranking.length; i++) {
      expect(thesis.ranking[i].normalizedConfidence).toBeGreaterThanOrEqual(thesis.ranking[i - 1].normalizedConfidence);
    }
    // confidence/evidenceIds are a pass-through of the primary limiter's own
    // resolved estimate — never re-derived, never invented.
    const byCapacity = { THRESHOLD: threshold, HIGH_INTENSITY: highIntensity, DURABILITY: durability };
    const primaryEstimate = byCapacity[thesis.primaryLimiter];
    expect(thesis.confidence).toBe(primaryEstimate.confidence);
    expect(thesis.evidenceIds).toEqual(primaryEstimate.evidenceIds);
    expect(thesis.confidence).toBeGreaterThanOrEqual(CAPACITY_CONFIDENCE_BANDS.populationPrior);
    expect(thesis.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.directCeiling);
    // HIGH_INTENSITY never gets the "push it harder" priority — the direct
    // rung that posture needs does not exist for this capacity yet.
    if (thesis.primaryLimiter === 'HIGH_INTENSITY') {
      expect(thesis.priority).toBe('establish_high_intensity_evidence');
    }
    // Every addressedBy session actually matches the limiter's family.
    for (const s of thesis.addressedBy) {
      if (thesis.primaryLimiter === 'THRESHOLD') expect(['threshold', 'tempo']).toContain(s.type);
      if (thesis.primaryLimiter === 'HIGH_INTENSITY') expect(s.type).toBe('intervals');
    }
    expect(thesis.reconsiderIf.length).toBeGreaterThan(0);
  }, 30_000);
});
