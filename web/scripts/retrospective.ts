#!/usr/bin/env tsx
/**
 * CLI: compute a retrospective for a plan + actual race export.
 *
 * Usage:
 *   npm run retrospective -- [--plan path] [--actual path]
 *
 * Defaults:
 *   --plan    public/big-sur-3-50.runcino.json
 *   --actual  fixtures/bigsur-actual.json
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRetrospective, type ActualRace } from '../lib/retrospective';
import { formatHMS, formatPaceMi } from '../lib/time';
import type { RuncinoPlan } from '../lib/types';

function arg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const planPath = resolve(here, '..', arg('plan', args) ?? 'public/big-sur-3-50.runcino.json');
  const actualPath = resolve(here, '..', arg('actual', args) ?? 'fixtures/bigsur-actual.json');

  const plan: RuncinoPlan = JSON.parse(readFileSync(planPath, 'utf8'));
  const actual: ActualRace = JSON.parse(readFileSync(actualPath, 'utf8'));

  const retro = computeRetrospective(plan, actual);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' RUNCINO · post-race retrospective');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Race: ${retro.race_name} · ${retro.race_date}`);
  console.log(`  Planned:  ${formatHMS(retro.planned_finish_s)}`);
  console.log(`  Actual:   ${formatHMS(retro.actual_finish_s)}`);
  console.log(`  Delta:    ${retro.finish_delta_s >= 0 ? '+' : ''}${retro.finish_delta_s} s`);
  console.log();

  console.log('  Phase deltas:');
  for (const pd of retro.phase_deltas) {
    const sign = pd.deltaSPerMi >= 0 ? '+' : '−';
    const mark = pd.status === 'on_plan' ? ' ' : pd.status === 'small_drift' ? '·' : '!';
    console.log(
      `  ${mark} ${pd.label.padEnd(32)} planned ${formatPaceMi(pd.plannedPaceSPerMi).padEnd(8)}  actual ${formatPaceMi(pd.actualPaceSPerMi).padEnd(8)}  ${sign}${String(Math.abs(pd.deltaSPerMi)).padStart(2)} s/mi   HR ${pd.meanHrBpm}/${pd.peakHrBpm}`
    );
  }

  console.log();
  console.log('  Calibration:');
  console.log(`    Climb coefficient:   ${retro.calibration.climb_coefficient} ×`);
  console.log(`    Descent coefficient: ${retro.calibration.descent_coefficient} ×`);
  if (retro.calibration.headwind_sensitivity_s_per_mi_per_mph !== null) {
    console.log(`    Headwind sensitivity: +${retro.calibration.headwind_sensitivity_s_per_mi_per_mph} s/mi per mph`);
  }
  console.log(`    HR drift (early → late): ${retro.calibration.hr_drift_bpm >= 0 ? '+' : ''}${retro.calibration.hr_drift_bpm} bpm`);

  console.log();
  console.log('  Takeaways:');
  for (const [i, t] of retro.takeaways.entries()) {
    console.log(`    ${i + 1}. ${t.title}`);
    console.log(`       ${t.note}`);
  }
  console.log();
}

main().catch(err => {
  console.error('Retrospective failed:', err);
  process.exit(1);
});
