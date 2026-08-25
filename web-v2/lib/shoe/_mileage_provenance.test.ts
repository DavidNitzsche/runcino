/**
 * lib/shoe/_mileage_provenance.test.ts · two thirds of this runner's shoe
 * mileage was never observed, and nothing said so.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE
 *
 * A run's shoe reaches `runs.shoe_id` two ways: the runner picks one, or
 * `lib/shoe/auto-assign.ts` guesses from the preferred shoe and the run type
 * and stamps `shoe_auto_assigned_at`. The column exists to tell them apart.
 * Until 2026-08-24, `shoe_auto_assigned_at` had SIX writers in the codebase
 * and ZERO readers.
 *
 * Measured on production over `faff_readonly`, 2026-08-24 — 55 of 149
 * canonical rows carry a shoe, 38 of those 55 auto-assigned:
 *
 *     Asics Novablast 5     61.51 mi   100% inferred
 *     NB SC Trainer v3     101.05 mi    93% inferred   RETIRED on this figure
 *     Nike Zoom Fly 6        8.02 mi   100% inferred   RETIRED on this figure
 *                          ─────────
 *     all seven shoes      400.73 mi    65% inferred
 *
 * A shoe retires when its mileage reaches a cap. Rule one: a modelled number
 * must never look measured. The answer is not to stop inferring — a default
 * shoe is a good default — it is to stop the inference being invisible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS FILE EXISTS TO KEEP CAUGHT
 *
 * The first version of the breakdown query summed
 * `COALESCE(SUM(LEAST(inferred_mi, mi)), 0)`. **`LEAST` IGNORES NULLS** —
 * `LEAST(NULL, 5.95)` is 5.95, not NULL — so every MANUAL day was counted as
 * inferred and the query reported 100% inferred for all seven shoes. It
 * type-checked, it ran, it returned plausible numbers, and it was wrong in the
 * most alarming possible direction.
 *
 * It was caught by running the real emitted SQL against prod and READING THE
 * ARTEFACT, not by the query succeeding. That is why the arithmetic invariants
 * below are stated as invariants rather than as a snapshot: `inferredMi` never
 * exceeds `totalMi` is not the interesting one — `inferredMi` EQUALS
 * `totalMi` for every shoe at once is the tell, and only a shape test sees it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ShoeMileage } from '@/lib/shoe/mileage';

const WEB = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(WEB, 'lib/shoe/mileage.ts'), 'utf8');

/**
 * The production breakdown, 2026-08-24, as this function returned it.
 *
 * A fixture rather than a live query so the check runs on a laptop with no
 * `DATABASE_URL`. Shoe ids are the real ones.
 */
const PROD: Array<[number, string, ShoeMileage]> = [
  [2, 'Asics Superblast 3',   { totalMi: 114.38, inferredMi: 50.51, runs: 14, inferredRuns: 6 }],
  [6, 'NB SC Trainer v3',     { totalMi: 101.05, inferredMi: 94.15, runs: 15, inferredRuns: 14 }],
  [7, 'Nike Vomero Premium',  { totalMi: 62.73,  inferredMi: 26.61, runs: 9,  inferredRuns: 4 }],
  [3, 'Asics Novablast 5',    { totalMi: 61.51,  inferredMi: 61.51, runs: 9,  inferredRuns: 9 }],
  [8, 'Asics Megablast',      { totalMi: 40.68,  inferredMi: 5.97,  runs: 4,  inferredRuns: 1 }],
  [1, 'NB SC Trainer v3 red', { totalMi: 12.36,  inferredMi: 12.36, runs: 1,  inferredRuns: 1 }],
  [4, 'Nike Zoom Fly 6',      { totalMi: 8.02,   inferredMi: 8.02,  runs: 1,  inferredRuns: 1 }],
];

describe('shoe mileage provenance · a guessed mile is not a measured one', () => {
  it('the inferred share never exceeds the total, and is never negative', () => {
    for (const [id, name, m] of PROD) {
      expect(m.inferredMi, `${name} (#${id})`).toBeGreaterThanOrEqual(0);
      expect(m.inferredMi, `${name} (#${id}) reports more inferred than tracked`)
        .toBeLessThanOrEqual(m.totalMi);
      expect(m.inferredRuns).toBeLessThanOrEqual(m.runs);
    }
  });

  it('a shoe with manual assignments is NOT reported as fully inferred', () => {
    /* THE LEAST-IGNORES-NULLS REGRESSION, stated as a property.
     *
     * The broken query returned inferredMi === totalMi for all seven shoes.
     * A "less than or equal" check passes that happily; only asking whether
     * the manual days actually survived catches it. Three shoes here have
     * manual runs and must show strictly less inferred than total. */
    const withManual = PROD.filter(([, , m]) => m.inferredRuns < m.runs);
    expect(withManual.length, 'the fixture no longer contains a mixed shoe').toBeGreaterThanOrEqual(3);
    for (const [id, name, m] of withManual) {
      expect(m.inferredMi, `${name} (#${id}) has ${m.runs - m.inferredRuns} manual run(s) ` +
        'but reports every mile as inferred — LEAST(NULL, x) returns x')
        .toBeLessThan(m.totalMi);
    }
  });

  it('a shoe with no manual assignments IS fully inferred', () => {
    // The other direction. A guard that reported nothing inferred would pass
    // the check above and be just as useless.
    const allAuto = PROD.filter(([, , m]) => m.inferredRuns === m.runs);
    expect(allAuto.length, 'the fixture no longer contains a fully-guessed shoe').toBeGreaterThanOrEqual(3);
    for (const [id, name, m] of allAuto) {
      expect(m.inferredMi, `${name} (#${id}) is entirely auto-assigned and must say so`)
        .toBeCloseTo(m.totalMi, 2);
    }
  });

  it('the majority of this runner\'s shoe miles are inferred · the reason this exists', () => {
    const total = PROD.reduce((s, [, , m]) => s + m.totalMi, 0);
    const inferred = PROD.reduce((s, [, , m]) => s + m.inferredMi, 0);
    expect(Math.round(total * 100) / 100).toBeCloseTo(400.73, 1);
    expect(Math.round(inferred * 100) / 100).toBeCloseTo(259.13, 1);
    expect(inferred / total).toBeGreaterThan(0.5);
  });

  it('the query does not use a bare LEAST over a nullable column', () => {
    /* The planted-corruption equivalent for a SQL string that cannot be
     * executed here. `LEAST` with a NULL argument silently returns the other
     * one; guarding it with a CASE is what makes the null a zero. If the CASE
     * goes, this fails. */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*--[^\n]*/gm, ' ');
    expect(code, 'the breakdown query must still compute an inferred share')
      .toMatch(/LEAST\(inferred_mi, mi\)/);
    expect(code, 'a bare LEAST over a nullable column counts every manual day as inferred')
      .toMatch(/CASE WHEN inferred_mi IS NULL THEN 0\s*\n?\s*ELSE LEAST\(inferred_mi, mi\) END/);
  });

  it('the façade and the breakdown cannot disagree about a total', () => {
    // `computeShoeMileage` is implemented over `computeShoeMileageBreakdown`
    // rather than as a second query. A second query is how the stored
    // `shoes.mileage` column came to disagree with the run sum on 7 of 7 rows.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const facade = code.slice(code.indexOf('export async function computeShoeMileage('));
    expect(facade).toContain('computeShoeMileageBreakdown(');
    expect(facade, 'the façade grew its own query').not.toContain('pool.query');
  });

  it('the profile payload carries the inferred share', () => {
    // The wiring direction. A resolver nothing calls is a comment — the same
    // failure `lib/conservation/_reader_lint.test.ts` was written for.
    const profile = fs.readFileSync(path.join(WEB, 'lib/coach/profile-state.ts'), 'utf8');
    expect(profile, 'profile-state must ask for the breakdown, not the bare total')
      .toContain('computeShoeMileageBreakdown(');
    expect(profile, 'the shoe payload must expose inferredMi so a surface can mark it')
      .toMatch(/inferredMi:/);
    expect(profile, 'the ProfileState.shoes type must declare it')
      .toMatch(/inferredMi: number/);
  });
});
