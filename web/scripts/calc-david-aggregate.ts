#!/usr/bin/env tsx
/** One-shot diagnostic: compute David's aggregate VDOT with the full
 *  curated race set, post-strict-Option-B fix. Run from web/:
 *    npx tsx scripts/calc-david-aggregate.ts
 *  Used to confirm the new honest aggregate before the migration ack. */
import { aggregateVdotFromInputs, type RaceBest } from '../lib/compute-vdot';

const TODAY = new Date('2026-05-18T12:00:00Z');
const cycleStart = new Date('2026-01-27T00:00:00Z');

const bests: RaceBest[] = [
  { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: '17250968534', source: 'races' },
  { label: 'Marathon', canonicalMi: 26.219, finishS: 12700, date: '2026-03-08', activityId: '17654375467', source: 'races' },
  { label: 'Marathon', canonicalMi: 26.219, finishS: 13015, date: '2026-04-26', activityId: '18270567015', source: 'races' },
  { label: 'Half', canonicalMi: 13.109, finishS: 6057, date: '2026-05-03', activityId: '18362267811', source: 'races' },
];

const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: 'HM_ISH', today: TODAY });
console.log('Aggregate VDOT:', result?.value);
console.log('');
console.log('Contributors (sorted by weight):');
for (const s of result?.sources ?? []) {
  const days = Math.floor((TODAY.getTime() - new Date(s.date + 'T12:00:00Z').getTime()) / 86_400_000);
  console.log(`  ${s.canonicalLabel.padEnd(8)} ${s.date} (${days}d old): VDOT ${s.vdot.toFixed(1)}  weight=${s.weight.toFixed(3)}  recency=${s.weightBreakdown.recency.toFixed(3)} length=${s.weightBreakdown.length.toFixed(3)} tier=${s.weightBreakdown.tier}  source=${s.source} goalTier=${s.isGoalTier} inCycle=${s.isInCycle}`);
}
const totalW = (result?.sources ?? []).reduce((sum, s) => sum + s.weight, 0);
console.log('');
console.log('Weight shares:');
for (const s of result?.sources ?? []) {
  console.log(`  ${s.canonicalLabel.padEnd(8)} ${s.date}: ${(s.weight / totalW * 100).toFixed(1)}%`);
}
