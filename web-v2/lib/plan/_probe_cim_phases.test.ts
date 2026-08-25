/**
 * _probe_cim_phases.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * "Do I need a base phase since I'm coming off of training?"
 *
 * Answers it by COMPOSING rather than by reading the source. Prints the phase
 * labels and week counts off a real composition against production, with every
 * value the BASE decision actually turns on printed beside them:
 * `isMidBlock`, `baseRebuilt` and which of its four disjuncts fired, and the
 * resolved `rampBaseEvidence`.
 *
 * Off by default, same reasoning as its siblings.
 *   FAFF_CIM_PROBE=1 npx vitest run lib/plan/_probe_cim_phases.test.ts
 *   → /tmp/cim-phases.txt
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { composeForUser, BASE_REBUILT_SHARE } from './generate';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const AUTHOR_INSTANT = new Date('2026-08-31T19:00:00Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AUTHOR_INSTANT);
});
afterAll(() => {
  vi.useRealTimers();
});

const RUN = !!process.env.FAFF_CIM_PROBE;

describe.skipIf(!RUN)('does his CIM block contain a BASE phase?', () => {
  it('composes and prints the phases with the gate values that produced them', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok, r.ok ? '' : (r as { reason: string }).reason).toBe(true);
    if (!r.ok) return;
    const { compose, composed } = r.result;
    const ev = compose.rampBaseEvidence ?? null;

    const out: string[] = [];
    out.push('=== THE ANSWER ===');
    const basePhase = composed.blocks.phases.find((p) => p.label === 'BASE');
    out.push(`BASE weeks in the composed block: ${basePhase?.weeks ?? 0}`);
    out.push(`phases: ${composed.blocks.phases.map((p) => `${p.label}:${p.weeks}`).join(' / ')}`);
    out.push(`total weeks: ${composed.totalWeeks}`);
    out.push('per-week phase labels:');
    for (const [i, w] of composed.weeks.entries()) {
      out.push(`  W${String(i + 1).padStart(2)} ${w.startISO} ${w.phase}`);
    }

    out.push('\n=== THE TWO GATES ===');
    out.push(`isMidBlock            = ${compose.isMidBlock}`);
    out.push(`BASE_REBUILT_SHARE    = ${BASE_REBUILT_SHARE}`);
    out.push(`rampBaseEvidence      = ${JSON.stringify(ev)}`);

    // baseRebuilt, recomputed here EXACTLY as composePlan computes it, with
    // each disjunct named so the answer says which one fired.
    const d1 = ev == null;
    const d2 = !(ev != null && ev.sustainedMi > 0);
    const d3 = ev != null && ev.meanMi >= BASE_REBUILT_SHARE * ev.sustainedMi;
    const d4 = ev != null && !!ev.lifted;
    const baseRebuilt = d1 || d2 || d3 || d4;
    out.push('\nbaseRebuilt disjuncts:');
    out.push(`  1 · rampEvidence == null                                  = ${d1}`);
    out.push(`  2 · !(sustainedMi > 0)                                    = ${d2}`);
    out.push(`  3 · meanMi >= ${BASE_REBUILT_SHARE} × sustainedMi` +
      (ev ? `  (${ev.meanMi} >= ${(BASE_REBUILT_SHARE * ev.sustainedMi).toFixed(2)})` : '') +
      `  = ${d3}`);
    out.push(`  4 · lifted                                                = ${d4}`);
    out.push(`  → baseRebuilt = ${baseRebuilt}`);
    out.push(`  → sizeBlocks(..., isMidBlock && baseRebuilt = ${compose.isMidBlock && baseRebuilt})`);

    // ── FALSIFIER · does the gate still tell him apart from a detrained
    //    runner? A gate that says yes to everybody is not a gate. Every series
    //    below is fed to the SAME `resolveRampBase` the composer just used.
    out.push('\n=== FALSIFIER · who gets the lift, and who does not ===');
    {
      const { resolveRampBase } = await import('./generate');
      const mean4 = (a: number[]) => (a[0] + a[1] + a[2] + a[3]) / 4;
      // Most-recent week first, exactly as the composer builds it.
      const cases: Array<[string, number[], number]> = [
        ['HIM · 1 week under resume, post-half', [0, 32.4, 19.2, 38.1, 10, 37.8, 40.3, 46.4, 6, 27.9, 41.4, 40, 45.9, 38.7, 40.8, 43.5], 4],
        ['post-half, 3 weeks under resume', [10, 10, 10, 38.1, 10, 37.8, 40.3, 46.4, 6, 27.9, 41.4, 40, 45.9, 38.7, 40.8, 43.5], 4],
        ['post-half, 6 weeks under resume', [10, 10, 10, 10, 10, 10, 40.3, 46.4, 6, 27.9, 41.4, 40, 45.9, 38.7, 40.8, 43.5], 4],
        ['DETRAINED · 8 weeks off, no race', [0, 0, 0, 0, 0, 0, 0, 0, 44, 45, 43, 46, 44, 45, 43, 46], 2],
        ['DETRAINED · 8 weeks off, stale plan on file', [3, 3, 4, 3, 4, 3, 4, 3, 44, 45, 43, 46, 44, 45, 43, 46], 2],
      ];
      for (const [label, series, allowed] of cases) {
        const e = resolveRampBase({
          meanWeeklyMi: mean4(series), weeklySeries: series, allowedInterruptionWeeks: allowed,
        });
        const d3 = e.meanMi >= BASE_REBUILT_SHARE * e.sustainedMi;
        const rebuilt = e.sustainedMi <= 0 || d3 || e.lifted;
        out.push(
          `${label.padEnd(44)} interruptionWk=${String(e.interruptionWeeks).padStart(2)}/${e.allowedInterruptionWeeks} ` +
          `mean=${e.meanMi.toFixed(1)} sustained=${e.sustainedMi} lifted=${String(e.lifted).padEnd(5)} ` +
          `→ baseRebuilt=${String(rebuilt).padEnd(5)} → BASE weeks: ${rebuilt ? 'NONE' : 'YES'}`,
        );
      }
    }

    out.push('\n=== WHAT A BASE WEEK WOULD CONTAIN, IF HE GOT ONE ===');
    const { BASE_QUALITY_TYPES } = await import('./generate');
    out.push(`BASE_QUALITY_TYPES = ${JSON.stringify(BASE_QUALITY_TYPES)}`);

    require('fs').writeFileSync('/tmp/cim-phases.txt', out.join('\n'));
    expect(composed.weeks.length).toBeGreaterThan(0);
  }, 300_000);
});
