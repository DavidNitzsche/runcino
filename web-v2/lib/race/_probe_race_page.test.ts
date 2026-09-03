/**
 * _probe_race_page.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Reads the live race outlook for the owner's races, READ-ONLY, and prints
 * every quantity the race page must keep apart. Calls nothing that composes
 * or persists a plan — `resolveRaceOutlookBySlug` only.
 *
 *   FAFF_RACEPAGE_PROBE=1 npx vitest run lib/race/_probe_race_page.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';
import { raceOutlookPayload } from '@/lib/race/race-outlook-payload';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_RACEPAGE_PROBE;
const TODAY = process.env.FAFF_PROBE_TODAY ?? '2026-09-02';

const p = (s: number | null | undefined) =>
  s == null ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const t = (s: number | null | undefined) => {
  if (s == null) return '-';
  const x = Math.round(s);
  return `${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

describe.skipIf(!RUN)('race page probe', () => {
  it('prints every layer', async () => {
    const out: string[] = [];
    for (const slug of ['cim', 'dodgers', 'santa-monica-10k', 'run-malibu']) {
      const o = await resolveRaceOutlookBySlug(DAVID, slug, TODAY);
      out.push(`\n================ ${slug} ================`);
      if (!o) { out.push('  (no outlook)'); continue; }
      out.push(`race               ${o.race.name} · ${o.race.distanceMi} mi · priority ${o.race.priority} · ${o.race.daysToRace} days`);
      out.push(`stated goal        ${t(o.statedGoal.sec)}  ${p(o.statedGoal.paceSecPerMi)}/mi`);
      out.push(`current projection ${t(o.currentProjection.expectedSec)}  range ${(o.currentProjection.likelyRangeSec ?? []).map(t).join(' - ')}  conf ${o.currentProjection.confidence}  basis ${o.currentProjection.basis}  limiter ${o.currentProjection.primaryLimiter}`);
      out.push(`training pace      ${p(o.trainingPrescription.paceSecPerMi)}/mi  band ${(o.trainingPrescription.rangeSecPerMi ?? []).map(p).join(' - ')}  evidence ${o.trainingPrescription.evidence}`);
      out.push(`block forecast     ${t(o.expectedRaceDay.expectedSec)}  range ${(o.expectedRaceDay.likelyRangeSec ?? []).map(t).join(' - ')}  conf ${o.expectedRaceDay.confidence}  basis ${o.expectedRaceDay.basis}`);
      out.push(`expected gain      ${JSON.stringify(o.expectedImprovement)}`);
      out.push(`EXECUTION          ${t(o.execution.targetSec)}  ${p(o.execution.paceSecPerMi)}/mi  band ${(o.execution.paceBandSecPerMi ?? []).map(p).join(' - ')}  source ${o.execution.source}  character ${o.execution.effortCharacter}`);
      out.push(`   strategy         ${o.execution.strategyLabel}`);
      out.push(`   reason           ${o.execution.reasonVsExpected}`);
      out.push(`   HR               ${JSON.stringify(o.execution.hr)}`);
      out.push(`conditional upside ${t(o.conditionalUpside?.targetSec)}  ${p(o.conditionalUpside?.paceSecPerMi)}/mi  conf ${o.conditionalUpside?.confidence}`);
      out.push(`   criteria         ${JSON.stringify(o.conditionalUpside?.criteria, null, 1)}`);
      out.push(`block seam         ${JSON.stringify(o.blockSeam)}`);
      out.push(`feasibility        ${JSON.stringify(o.goalFeasibility)}`);
      out.push(`staleness          ${JSON.stringify(o.staleness)}`);
      out.push(`capacity           ${JSON.stringify(o.capacity)}`);
      out.push(`flags              ${JSON.stringify(o.flags)}`);
      out.push(`bridge             ${JSON.stringify(o.bridge, null, 1)}`);
      out.push(`invariants         ${JSON.stringify((await import('@/lib/race/race-outlook')).raceOutlookInvariants(o))}`);
      out.push(`--- WIRE PAYLOAD KEYS: ${Object.keys(raceOutlookPayload(o) ?? {}).join(', ')}`);
    }
    fs.writeFileSync('/tmp/race-page-probe.txt', out.join('\n'));
    console.log(out.join('\n'));
    expect(true).toBe(true);
  }, 300_000);
});
