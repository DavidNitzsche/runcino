/**
 * A READ-ONLY probe of the live sequence gate against a real block.
 *
 * A `.script.ts`, not a test: it needs `DATABASE_URL_RO` and a real runner, and
 * a suite member that requires either is a suite member that goes red on every
 * machine that has neither. Run it deliberately:
 *
 *   npx vitest run lib/plan/adjudication/_live_sequence_probe.script.ts
 */
import { describe, it, expect } from 'vitest';
import { loadPlannedWeeks, findSequenceFindings } from './live-sequence';

const RUNNER = process.env.PROBE_RUNNER_UUID ?? '';

describe('live sequence probe', () => {
  it('reads the block and reports every sequence finding', async () => {
    if (RUNNER === '') {
      console.log('PROBE_RUNNER_UUID not set · nothing to probe');
      return;
    }
    const read = await loadPlannedWeeks(RUNNER);
    if (!read.ok) { console.log('REFUSED:', read.why); return; }
    for (const w of read.weeks) {
      console.log(`${w.weekStartISO}  ${String(w.weeklyMi).padStart(5)} mi  `
        + `long ${String(w.longestMi).padStart(5)}  ${w.stressors.length} [${w.stressors.join(', ')}]`
        + `${w.isTaper ? ' TAPER' : ''}${w.isRaceWeek ? ' RACEWK' : ''}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const findings = findSequenceFindings(read.weeks, today);
    console.log(`FINDINGS: ${findings.length}`);
    for (const f of findings) {
      console.log(`  ${f.weekStartISO} · +${(f.volumeStep * 100).toFixed(1)}% · `
        + `stressors ${f.stressorsBefore} -> ${f.stressorsAfter} · names ${f.targetDateISO} ${f.targetType}`);
    }
    expect(Array.isArray(findings)).toBe(true);
  }, 120_000);
});
