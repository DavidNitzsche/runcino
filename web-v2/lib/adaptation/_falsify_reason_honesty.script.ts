/**
 * Falsifier for the reason-honesty fix, docs/reports/adaptation-reason-honesty-fix-2026-09-01.md.
 *
 * Not a gate, not part of `npm test`. Reads production (read-only role) via
 * the same `readAdaptationSplit` the shadow-run tooling already uses. Prints
 * `representative_execution`'s band, decision and summary for the real
 * 2026-08-16..2026-08-23 AFC post-race episode, so the "before" state can be
 * captured, then re-run after the fix to confirm the "after" state — same
 * band/decision, a better summary.
 *
 *   npx vitest run --config vitest.shadow-run.config.ts lib/adaptation/_falsify_reason_honesty.script.ts
 */
import { describe, it, expect } from 'vitest';
import { readAdaptationSplit } from './load';

const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

describe('reason-honesty falsifier (report tool, not a gate)', () => {
  it('prints representative_execution summary across the AFC episode', async () => {
    const dates = [
      '2026-08-15', // control — agrees, before the episode
      '2026-08-16', // race day — episode starts
      '2026-08-20', // mid-episode — the prior report's own anchor date
      '2026-08-23', // last disagreement day
      '2026-08-24', // agrees again — episode ends
    ];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d);
      expect(split).not.toBeNull();
      const r = split!.representative_execution;
      const a = split!.actual_load_absorption;
      console.log(`\n=== ${d} ===`);
      console.log(`absorption:     ${a.band}/${a.decision}`);
      console.log(`representative: ${r.band}/${r.decision}`);
      console.log(`  summary: ${r.summary}`);
    }
  });
});
