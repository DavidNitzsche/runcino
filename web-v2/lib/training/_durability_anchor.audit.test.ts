/**
 * _durability_anchor.audit.test.ts · READ-ONLY, reports the owner's real
 * durability anchor. `.audit.` per this directory's existing convention
 * (`lib/runs/_splits_repair_sql.audit.test.ts`): needs `DATABASE_URL_RO`
 * and skips without one, so it is not part of the CI gate chain and cannot
 * make a build depend on a live database.
 *
 * Prints the owner's fitted Riegel exponent (with confidence and the
 * supporting race list) and his aerobic-decoupling coefficient (with
 * confidence and the supporting long-run list) — real information, not a
 * fixture, per Rule 13.
 *
 * Run with:
 *   npx vitest run lib/training/_durability_anchor.audit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

import {
  fitRaceExponent,
  aggregateDecoupling,
  qualifyingDecouplingObservation,
  loadRaceObservationsForDurability,
  loadDecouplingObservations,
  resolveDurabilityAnchor,
  POPULATION_ENDURANCE_PRIOR,
  type DurabilityRaceObservation,
} from '@/lib/training/durability-anchor';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

describe.skipIf(!RO)('DURABILITY ANCHOR · the owner\'s real numbers', () => {
  it('race exponent — fitted from his real graded races', async () => {
    const pool = new Pool({
      connectionString: RO,
      ssl: RO!.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 2,
    });
    try {
      // Reuse the module's own loader function against the RO pool by
      // constructing the query the same way it does — the module imports
      // the shared `@/lib/db/pool` singleton, which this suite must not
      // open a second connection through with write credentials. Read the
      // races directly here instead, using the exact same SQL shape.
      const { rows } = await pool.query<{
        slug: string; meta: Record<string, unknown> | null; actual_result: Record<string, unknown> | null;
      }>(`SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1`, [OWNER]);

      expect(rows.length).toBeGreaterThan(0); // LIVENESS

      // Reproduce loadRaceObservationsForDurability's filtering inline
      // (it reads via the shared pool, not this RO connection) so the
      // audit exercises the same rules against a connection this suite
      // controls.
      const { isGradedRacePriority, selectionAuthority } = await import('@/lib/race/effort-authority');
      const { distanceMiFromLabel } = await import('@/lib/race/distance');
      const { parseRaceTime } = await import('@/lib/training/vdot');
      const { isProvisionalResult } = await import('@/lib/coach/races-state');

      const observations: DurabilityRaceObservation[] = [];
      for (const r of rows) {
        const m = (r.meta ?? {}) as Record<string, unknown>;
        const ar = (r.actual_result ?? {}) as Record<string, unknown>;
        const priority = (m.priority as string) ?? null;
        console.log(`  race: ${r.slug} · priority=${priority} · date=${m.date} · distanceMi=${m.distanceMi}`);
        if (!isGradedRacePriority(priority)) { console.log('    -> excluded: not a graded A/B/C priority'); continue; }
        const distanceMi = m.distanceMi != null ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel as string);
        if (distanceMi == null || !(distanceMi > 0)) { console.log('    -> excluded: no distance'); continue; }
        let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
        if (!finishSec || !(finishSec > 0)) finishSec = parseRaceTime(m.finishTime as string);
        if (!finishSec || !(finishSec > 0)) { console.log('    -> excluded: no rung-1/2 finish time'); continue; }
        if (isProvisionalResult(ar)) { console.log('    -> excluded: provisional result'); continue; }
        const date = (m.date as string) ?? '';
        if (!date) continue;
        const weight = selectionAuthority(priority);
        console.log(`    -> INCLUDED: finishSec=${finishSec} weight=${weight}`);
        observations.push({ slug: r.slug, date, distanceMi, finishSec, priority, weight });
      }

      const today = new Date().toISOString().slice(0, 10);
      const r = fitRaceExponent(observations, { today });
      console.log('\n=== RACE EXPONENT READ ===');
      console.log(JSON.stringify(r, null, 2));
      if (r.ok) {
        console.log(`\nPopulation default: ${POPULATION_ENDURANCE_PRIOR}`);
        console.log(`Raw fitted exponent: ${r.rawFittedExponent.toFixed(4)}`);
        console.log(`Confidence: ${r.confidence.toFixed(3)}`);
        console.log(`Shrunk value (what a caller would spend): ${r.value.toFixed(4)}`);
      }
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('decoupling — corroborated from his real long runs', async () => {
    const observations = await loadDecouplingObservations(OWNER);
    console.log(`\n=== DECOUPLING · ${observations.length} qualifying observations over the lookback window ===`);
    for (const o of observations) {
      console.log(`  ${o.date} · run ${o.id} · driftPct=${o.driftPct} · durationMin=${o.durationMin}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const r = aggregateDecoupling(observations, { today });
    console.log('\n=== DECOUPLING READ ===');
    console.log(JSON.stringify(r, null, 2));
    if (r.ok) {
      console.log(`\nMean decoupling: ${r.value.toFixed(2)}%`);
      console.log(`Confidence: ${r.confidence.toFixed(3)}`);
      console.log(`Supporting observations: ${r.observations}`);
    } else {
      console.log(`\nREFUSED: ${r.reason} (${r.observations} observations)`);
    }
    // No liveness assertion forcing ok:true — an honest refusal is a valid
    // real answer (Rule 11), and this suite reports whichever is true
    // rather than asserting a result it wants to see.
    expect(r).toBeDefined();
  });

  it('the combined anchor resolves end to end', async () => {
    const anchor = await resolveDurabilityAnchor(OWNER);
    console.log('\n=== COMBINED DURABILITY ANCHOR ===');
    console.log(JSON.stringify(anchor, null, 2));
    expect(anchor.halfLifeDays).toBeGreaterThan(0);
    expect(anchor.raceExponent).toBeDefined();
    expect(anchor.decoupling).toBeDefined();
  });

  it('sanity: qualifyingDecouplingObservation is reachable and pure (no DB) — imported to confirm the export surface', () => {
    expect(typeof qualifyingDecouplingObservation).toBe('function');
    expect(typeof loadRaceObservationsForDurability).toBe('function');
  });
});
