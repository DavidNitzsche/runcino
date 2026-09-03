/**
 * _probe_ladder.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Sibling of `_probe_cim_block.test.ts`. Composes the owner's CIM block against
 * live rows and prints the marathon-specific ladder as it would be PERSISTED,
 * plus the live race outlook's execution layers, so the seam between the block
 * and race day can be read as one page.
 *
 * OFF by default, same reasoning as its siblings: one named production account,
 * read-only, asserts almost nothing.
 *   FAFF_CIM_PROBE=1 npx vitest run lib/plan/_probe_ladder.test.ts
 *   → /tmp/cim-ladder.txt
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { CRON_AUTHOR_INSTANT } from './probe-instant';
import { composeForUser } from './generate';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(CRON_AUTHOR_INSTANT); });
afterAll(() => { vi.useRealTimers(); });
const RUN = !!process.env.FAFF_CIM_PROBE;

const p = (s: number | null | undefined) =>
  s == null ? '  -  ' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const t = (s: number | null | undefined) => {
  if (s == null) return '-';
  const x = Math.round(s);
  return `${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

describe.skipIf(!RUN)('CIM ladder + seam', () => {
  it('prints', async () => {
    const out: string[] = [];
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok, r.ok ? '' : (r as { reason: string }).reason).toBe(true);
    if (!r.ok) return;
    const st = r.result.composed.authoredState as Record<string, unknown>;
    const ladder = st.marathon_specific_ladder as Record<string, unknown> | null;
    out.push('=== MARATHON-SPECIFIC LADDER ===');
    out.push(JSON.stringify(ladder, null, 1));
    out.push('=== ROLLING-7 CEILING ===');
    out.push(JSON.stringify(st.rolling_seven_ceiling, null, 1));
    out.push('=== LOAD CONTRACT ===');
    out.push(JSON.stringify(st.load_progression_contract, null, 1));

    const o = await resolveRaceOutlookBySlug(DAVID, 'cim', '2026-08-30');
    if (o) {
      out.push('=== CIM OUTLOOK · the layers ===');
      out.push(`stated goal        ${t(o.statedGoal.sec)}  ${p(o.statedGoal.paceSecPerMi)}/mi`);
      out.push(`current projection ${t(o.currentProjection.expectedSec)}  range ${(o.currentProjection.likelyRangeSec ?? []).map(t).join('-')}  conf ${o.currentProjection.confidence}`);
      out.push(`training pace      ${p(o.trainingPrescription.paceSecPerMi)}/mi  band ${(o.trainingPrescription.rangeSecPerMi ?? []).map(p).join('-')}`);
      out.push(`block forecast     ${t(o.expectedRaceDay.expectedSec)}  range ${(o.expectedRaceDay.likelyRangeSec ?? []).map(t).join('-')}  conf ${o.expectedRaceDay.confidence}`);
      out.push(`EXECUTION          ${t(o.execution.targetSec)}  ${p(o.execution.paceSecPerMi)}/mi  source ${o.execution.source}`);
      out.push(`   ${o.execution.reasonVsExpected}`);
      out.push(`conditional upside ${t(o.conditionalUpside?.targetSec)}  ${p(o.conditionalUpside?.paceSecPerMi)}/mi  conf ${o.conditionalUpside?.confidence}`);
      out.push(`seam               ${JSON.stringify(o.blockSeam)}`);
      out.push(`feasibility        ${JSON.stringify(o.goalFeasibility)}`);
    }
    for (const slug of ['dodgers', 'santa-monica-10k', 'run-malibu']) {
      const x = await resolveRaceOutlookBySlug(DAVID, slug, '2026-08-30');
      if (x) {
        out.push(`=== ${slug} · ${t(x.execution.targetSec)} ${p(x.execution.paceSecPerMi)}/mi · ${x.execution.source} · ${x.execution.effortCharacter}`);
        out.push(`   ${x.execution.strategyLabel} · ${x.execution.reasonVsExpected}`);
        out.push(`   HR ${JSON.stringify(x.execution.hr?.expectedRangeBpm ?? null)}`);
      }
    }
    fs.writeFileSync('/tmp/cim-ladder.txt', out.join('\n'));
    expect(true).toBe(true);
  }, 300_000);
});
