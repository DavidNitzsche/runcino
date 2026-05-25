#!/usr/bin/env tsx
/**
 * sim-sweep-pace-bands · P0 step 1 diff report
 *
 * For each VDOT in a representative sweep, compute pace bands two ways:
 *
 *   LEGACY: web/lib/vdot.ts pacesFromVdot(v) — race-pace-derived formulas
 *   NEW:    web/lib/training-paces-resolver.ts resolveTrainingPaces(v) —
 *           canonical Daniels Table 2 values
 *
 * Diff the center pace of each zone (E/M/T/I/R). Flag any case where
 * |delta| ≥ LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi (15 sec/mi).
 *
 * Output: markdown report at docs/2026-05-19-sim-sweep.md
 *
 * NO behavioral change. Read-only diff. Run with:
 *   cd web && npx tsx scripts/sim-sweep-pace-bands.ts
 */

import { pacesFromVdot } from '../lib/vdot';
import { resolveTrainingPaces } from '../lib/training-paces-resolver';
import { LARGE_SHIFT_THRESHOLDS } from '../lib/adaptive-pattern';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VDOT_SWEEP = [30, 35, 40, 45, 46, 47, 47.2, 48, 49, 50, 55, 60, 65, 70, 72];

interface ZoneDiff {
  zone: 'E' | 'M' | 'T' | 'I' | 'R';
  legacyCenterS: number;
  newCenterS: number;
  deltaS: number;
  largeShift: boolean;
}

interface VdotRow {
  vdot: number;
  zones: ZoneDiff[];
  anyLargeShift: boolean;
  pendingVerification: boolean;
}

function fmtPace(s: number): string {
  if (s <= 0) return '—';
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  return `${mins}:${String(secs).padStart(2, '0')}/mi`;
}

function deltaArrow(d: number): string {
  if (d === 0) return '·';
  return d > 0 ? `↓${d}s slower` : `↑${-d}s faster`;
}

function diffVdot(vdot: number): VdotRow {
  const legacy = pacesFromVdot(vdot);
  const resolved = resolveTrainingPaces(vdot);

  const zoneCenters = (() => {
    if (!legacy) return null;
    return {
      E: (legacy.E.lowS + legacy.E.highS) / 2,
      M: (legacy.M.lowS + legacy.M.highS) / 2,
      T: (legacy.T.lowS + legacy.T.highS) / 2,
      I: (legacy.I.lowS + legacy.I.highS) / 2,
      R: (legacy.R.lowS + legacy.R.highS) / 2,
    };
  })();

  const newCenters = {
    E: resolved.eMidS,
    M: resolved.mS,
    T: resolved.tMileS,
    I: resolved.iMileS,
    R: resolved.rMileS,
  };

  const threshold = LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi;

  const zones: ZoneDiff[] = (['E', 'M', 'T', 'I', 'R'] as const).map((z) => {
    const lc = zoneCenters?.[z] ?? 0;
    const nc = newCenters[z];
    const deltaS = Math.round(nc - lc);
    return {
      zone: z,
      legacyCenterS: Math.round(lc),
      newCenterS: Math.round(nc),
      deltaS,
      largeShift: Math.abs(deltaS) >= threshold,
    };
  });

  return {
    vdot,
    zones,
    anyLargeShift: zones.some((z) => z.largeShift),
    pendingVerification: resolved.pendingVerification,
  };
}

function buildReport(rows: VdotRow[]): string {
  const threshold = LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi;
  const lines: string[] = [];

  lines.push('# Pace band sim sweep — legacy vs canonical Daniels');
  lines.push('');
  lines.push(`**Date:** 2026-05-18`);
  lines.push(`**Sweep:** VDOT ${VDOT_SWEEP.join(', ')}`);
  lines.push(`**Large-shift threshold:** ${threshold}s/mi (from \`LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi\`)`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const largeShiftCount = rows.reduce((n, r) => n + r.zones.filter((z) => z.largeShift).length, 0);
  const totalCells = rows.length * 5;
  lines.push(`- ${rows.length} VDOTs × 5 zones = ${totalCells} pace-band comparisons`);
  lines.push(`- **${largeShiftCount} cells** exceed the ${threshold}s/mi large-shift threshold`);
  lines.push(`- ${rows.filter((r) => r.anyLargeShift).length} of ${rows.length} VDOTs have at least one zone that trips the guard`);
  lines.push('');
  lines.push('Cells exceeding the threshold are marked **⚠** below. These would be blocked by the large-shift guard at the prescription layer when pacesFromVdot is wired to the new resolver, and require explicit user confirmation before applying.');
  lines.push('');
  lines.push('Per David\'s spec for the one-time migration from buggy formulas to canonical Daniels: the guard\'s "Apply" button gets pre-flagged with explanatory text ("This is a one-time correction from the previous pace formula bug. New paces are canonical Daniels for your VDOT.") and David confirms once. After that the guard operates normally for ongoing changes.');
  lines.push('');

  lines.push('## Per-VDOT diff');
  lines.push('');

  for (const r of rows) {
    lines.push(`### VDOT ${r.vdot}${r.pendingVerification ? ' (pending second-source verification — VDOT > 60)' : ''}`);
    lines.push('');
    lines.push('| Zone | Legacy center | New center | Δ | Flag |');
    lines.push('|------|---------------|------------|---|------|');
    for (const z of r.zones) {
      const flag = z.largeShift ? '**⚠ large-shift**' : '·';
      lines.push(
        `| ${z.zone} | ${fmtPace(z.legacyCenterS)} (${z.legacyCenterS}s) | ${fmtPace(z.newCenterS)} (${z.newCenterS}s) | ${deltaArrow(z.deltaS)} | ${flag} |`,
      );
    }
    lines.push('');
  }

  lines.push('## David-specific zoom (VDOT 47.2)');
  lines.push('');
  const david = rows.find((r) => r.vdot === 47.2);
  if (david) {
    lines.push('At David\'s current aggregate VDOT (47.2 per UNIT B sanity-check), the pace bands shift as follows:');
    lines.push('');
    lines.push('| Zone | Legacy | New (canonical Daniels) | Δ | Guard trips? |');
    lines.push('|------|--------|--------------------------|---|--------------|');
    for (const z of david.zones) {
      lines.push(
        `| ${z.zone} | ${fmtPace(z.legacyCenterS)} | ${fmtPace(z.newCenterS)} | ${deltaArrow(z.deltaS)} | ${z.largeShift ? '⚠ YES' : 'no'} |`,
      );
    }
    lines.push('');
    if (david.anyLargeShift) {
      lines.push(`At least one zone trips the ${threshold}s/mi guard. The wire-up will use the one-time-migration banner pattern: user confirms once, then guard operates normally.`);
    } else {
      lines.push(`No zone trips the ${threshold}s/mi guard. The wire-up can apply silently per David's adaptive-pattern Rule 8 default.`);
    }
    lines.push('');
  }

  lines.push('## Conclusion');
  lines.push('');
  if (largeShiftCount === 0) {
    lines.push('All pace-band shifts are within tolerance. Safe to wire pacesFromVdot → resolveTrainingPaces without the migration banner.');
  } else if (largeShiftCount <= 5) {
    lines.push(`Modest number of large shifts (${largeShiftCount} cells across ${rows.length} VDOTs). One-time migration banner pattern applies.`);
  } else {
    lines.push(`Many large shifts (${largeShiftCount} cells across ${rows.length} VDOTs). The legacy formula was systematically off from canonical Daniels — expected, since this is what UNIT A was built to fix. One-time migration banner is the right pattern.`);
  }
  lines.push('');
  lines.push('---');
  lines.push('Generated by `web/scripts/sim-sweep-pace-bands.ts`.');

  return lines.join('\n');
}

function main() {
  const rows = VDOT_SWEEP.map(diffVdot);
  const report = buildReport(rows);
  const outPath = resolve(__dirname, '..', '..', 'docs', '2026-05-19-sim-sweep.md');
  writeFileSync(outPath, report);
  console.log(`Wrote ${outPath}`);
  console.log('');

  const threshold = LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi;
  const largeShifts = rows.flatMap((r) => r.zones.filter((z) => z.largeShift).map((z) => `VDOT ${r.vdot} ${z.zone}: ${z.legacyCenterS}s → ${z.newCenterS}s (Δ ${z.deltaS}s)`));
  console.log(`Threshold: ${threshold}s/mi`);
  console.log(`Total large shifts: ${largeShifts.length}`);
  if (largeShifts.length > 0) {
    console.log('');
    for (const ls of largeShifts) console.log(`  ⚠ ${ls}`);
  }
}

main();
