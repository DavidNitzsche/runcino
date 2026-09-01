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
 * BOTH DATES ARE RUN, on purpose. 2026-08-31 and 2026-09-01 are the two reads
 * the audit caught the old ranking flipping between
 * (`docs/reports/independent-coaching-system-audit-2026-09-01/
 * G-real-run-traces.md` §3), so the account-level assertion this file adds is
 * that they now agree. `_coaching_thesis.test.ts` holds the same property as a
 * database-free walk; this one proves it on the real rows.
 *
 * Run with:
 *   npx vitest run lib/training/_coaching_thesis.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATES = ['2026-08-31', '2026-09-01'] as const;

describe.skipIf(!RO)('COACHING THESIS · rendered against the owner\'s real account', () => {
  it('resolves a real thesis on both audit dates, and the limiter does not move', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveCoachingThesis } = await import('@/lib/training/coaching-thesis');
    const {
      resolveThresholdCapacity,
      resolveHighIntensityCapacity,
      resolveDurability,
      CAPACITY_CONFIDENCE_BANDS,
    } = await import('@/lib/training/capacity-resolver');

    const limiters: string[] = [];

    for (const TODAY of DATES) {
      const [thesis, threshold, highIntensity, durability] = await Promise.all([
        resolveCoachingThesis(OWNER, TODAY),
        resolveThresholdCapacity(OWNER, TODAY),
        resolveHighIntensityCapacity(OWNER, TODAY),
        resolveDurability(OWNER, TODAY),
      ]);

      /* eslint-disable no-console */
      console.log(`\n══ COACHING THESIS · todayISO=${TODAY} ══`);
      console.log(`  primaryLimiter=${thesis.primaryLimiter}  basis=${thesis.basis}`);
      console.log(`  priority=${thesis.priority}`);
      console.log(`  confidence=${thesis.confidence == null ? 'null (no limiter)' : thesis.confidence.toFixed(3)}`
        + `  evidenceIds=${JSON.stringify(thesis.evidenceIds)}`);
      console.log(`  reasons=[${thesis.reasons.join(', ')}]`);
      console.log('  standings:');
      for (const s of thesis.standings) {
        const tail = s.rankable
          ? `confidence=${s.confidence.toFixed(3)} sourceMode=${s.sourceMode}`
          : `UNRANKABLE (${s.reason}) sourceMode=${s.sourceMode}`;
        const dur = s.durability
          ? `  [raceExponent=${s.durability.raceExponent ?? 'absent'}`
            + ` prior=${s.durability.populationPrior}`
            + ` decoupling=${s.durability.decouplingPct ?? 'absent'}]`
          : '';
        console.log(`    ${s.capacity.padEnd(14)} ${tail}${dur}`);
      }
      console.log('  heldConstant:');
      for (const h of thesis.heldConstant) console.log(`    ${h.capacity} [${h.code}] ${h.note}`);
      console.log('  reconsiderIf:');
      for (const c of thesis.reconsiderIf) console.log(`    - [${c.code}] ${c.detail}`);
      console.log(`  addressedBy (${thesis.addressedBy.length} session(s) this week):`);
      for (const s of thesis.addressedBy) {
        console.log(`    ${s.dateIso} ${s.type} "${s.subLabel}" serves=${s.serves}`);
        console.log(`      rationale: ${s.selectionRationale ?? '(none persisted)'}`);
      }
      console.log(`  coachLine: ${thesis.coachLine}`);
      console.log(`  resolvedAt=${thesis.resolvedAt}  modelVersion=${thesis.modelVersion}\n`);
      /* eslint-enable no-console */

      limiters.push(thesis.primaryLimiter);

      // ── STRUCTURAL ASSERTIONS ──────────────────────────────────────────
      expect(['THRESHOLD', 'HIGH_INTENSITY', 'DURABILITY', 'UNKNOWN']).toContain(thesis.primaryLimiter);
      expect(thesis.standings).toHaveLength(3);

      // Rankable capacities come first, ascending by their OWN confidence, and
      // an unrankable one can never sit in front of a rankable one.
      let sawUnrankable = false;
      let prev = -Infinity;
      for (const s of thesis.standings) {
        if (!s.rankable) { sawUnrankable = true; continue; }
        expect(sawUnrankable, 'a rankable standing appeared after an unrankable one').toBe(false);
        expect(s.confidence).toBeGreaterThanOrEqual(prev);
        prev = s.confidence;
      }

      // The limiter is standings[0] when there is one, and it is rankable.
      if (thesis.primaryLimiter === 'UNKNOWN') {
        expect(thesis.standings.every((s) => !s.rankable)).toBe(true);
        expect(thesis.confidence).toBeNull();
        expect(thesis.evidenceIds).toEqual([]);
        expect(thesis.addressedBy).toEqual([]);
        expect(thesis.priority).toBe('establish_evidence_before_prioritising');
      } else {
        expect(thesis.standings[0].capacity).toBe(thesis.primaryLimiter);
        expect(thesis.standings[0].rankable).toBe(true);
        const byCapacity = { THRESHOLD: threshold, HIGH_INTENSITY: highIntensity, DURABILITY: durability };
        const primaryEstimate = byCapacity[thesis.primaryLimiter];
        // Never a fallback rung. This is the whole fix.
        expect(['direct', 'inferred', 'race_derived']).toContain(primaryEstimate.sourceMode);
        // confidence/evidenceIds are a pass-through of the primary limiter's
        // own resolved estimate — never re-derived, never invented.
        expect(thesis.confidence).toBe(primaryEstimate.confidence);
        expect(thesis.evidenceIds).toEqual(primaryEstimate.evidenceIds);
        expect(thesis.confidence!).toBeGreaterThanOrEqual(CAPACITY_CONFIDENCE_BANDS.populationPrior);
        expect(thesis.confidence!).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.directCeiling);
      }

      // Every addressedBy session actually matches the limiter's family.
      for (const s of thesis.addressedBy) {
        if (thesis.primaryLimiter === 'THRESHOLD') expect(['threshold', 'tempo']).toContain(s.type);
        if (thesis.primaryLimiter === 'HIGH_INTENSITY') expect(s.type).toBe('intervals');
        expect(s.serves).toBe('MATCHES_LIMITER_FAMILY');
      }

      // Coach voice, on the real composed line.
      expect(thesis.coachLine, thesis.coachLine).not.toMatch(/[—!·]/);
      expect(thesis.reconsiderIf.length).toBeGreaterThan(0);
    }

    // ── THE DEFECT THIS FILE EXISTS TO CATCH ─────────────────────────────
    // 2026-08-31 read HIGH_INTENSITY and 2026-09-01 read THRESHOLD on the old
    // ceiling-normalized basis, with no high-intensity session between them.
    expect(limiters[0], `limiter moved overnight: ${limiters.join(' -> ')}`).toBe(limiters[1]);
  }, 60_000);
});
