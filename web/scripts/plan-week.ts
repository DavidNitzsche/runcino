#!/usr/bin/env tsx
/**
 * CLI: print a training block or a specific week.
 *
 * Usage:
 *   npm run plan-week
 *     [--race "Big Sur Marathon"]
 *     [--date 2026-04-26]                 (goal race date)
 *     [--base-pace 526]                   (baseline flat marathon pace, s/mi)
 *     [--weeks 18]
 *     [--peak-mpw 50]
 *     [--today 2026-04-19]                (show current week only)
 *     [--hilly]                           (flag for hilly goal race)
 */

import { generateBlock, currentWeekNumber } from '../lib/training';
import { formatPaceMi } from '../lib/time';

function arg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}
function flag(name: string, args: string[]): boolean {
  return args.includes(`--${name}`);
}

async function main() {
  const args = process.argv.slice(2);
  const block = generateBlock({
    goalRaceName: arg('race', args) ?? 'Big Sur Marathon',
    goalRaceDate: arg('date', args) ?? '2026-04-26',
    weeksTotal: arg('weeks', args) ? Number(arg('weeks', args)) : 18,
    peakMpw: arg('peak-mpw', args) ? Number(arg('peak-mpw', args)) : 50,
    basePaceSPerMi: arg('base-pace', args) ? Number(arg('base-pace', args)) : 526,
    hilly: flag('hilly', args),
  });

  const today = arg('today', args);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` RUNCINO · training block · ${block.goalRace}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Goal date: ${block.goalDate}`);
  console.log(`  ${block.weeksTotal} weeks · peak ${block.peakMpw} mpw · philosophy: ${block.philosophy}`);
  console.log();

  if (today) {
    const weekNum = currentWeekNumber(today, block);
    const week = block.weeks[weekNum - 1];
    console.log(`  → Week ${weekNum} (${week.phase}) · ${week.totalDistanceMi} mi total`);
    console.log(`     ${week.narrative}`);
    console.log();
    for (const d of week.days) {
      const pace = d.targetPaceSPerMi !== null ? formatPaceMi(d.targetPaceSPerMi) : '—';
      const dist = d.distanceMi > 0 ? `${d.distanceMi.toFixed(1)} mi` : '';
      console.log(`    ${d.dow}  ${d.date}  ${d.label.padEnd(22)} ${dist.padEnd(10)} ${pace}`);
    }
    console.log();
    return;
  }

  // Full block summary
  for (const w of block.weeks) {
    const quality = w.days.filter(d => d.kind === 'tempo' || d.kind === 'intervals').length;
    const long = w.days.find(d => d.kind === 'long' || d.kind === 'long_hilly');
    const longMi = long ? long.distanceMi.toFixed(1) : '—';
    console.log(
      `  W${String(w.weekNumber).padStart(2)}  ${w.phase.padEnd(6)}  ${String(w.totalDistanceMi).padStart(5)} mi   ${quality} quality   long ${longMi} mi`
    );
  }
  console.log();
}

main().catch(err => {
  console.error('plan-week failed:', err);
  process.exit(1);
});
