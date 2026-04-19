#!/usr/bin/env tsx
/**
 * Build a .runcino.json plan from a GPX, goal time, and fitness summary.
 *
 * Usage:
 *   npm run build-plan -- [--gpx path] [--goal 3:50:00] [--out path]
 *                         [--strategy even_effort|even_split|negative_split]
 *                         [--course big-sur-marathon]
 *
 * Defaults:
 *   --gpx       public/sample-bigsur.gpx
 *   --goal      3:50:00
 *   --out       public/big-sur-3-50.runcino.json
 *   --strategy  even_effort
 *   --course    big-sur-marathon
 *
 * Also prints a human-readable summary to stdout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGpx } from '../lib/gpx';
import { buildSegments } from '../lib/pacing';
import { groupPhases } from '../lib/grouping';
import { planFueling } from '../lib/fueling';
import { assemblePlan } from '../lib/export';
import {
  getCourseFacts,
  shippableLandmarks,
  validateCourseFactsStructure,
  validateGpxAgainstCourse,
} from '../lib/course-facts';
import { parseHMS, formatHMS, formatPaceMi } from '../lib/time';
import type { FitnessSummary } from '../lib/types';

function arg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function bail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const gpxPath = resolve(here, '..', arg('gpx', args) ?? 'public/sample-bigsur.gpx');
  const goalStr = arg('goal', args) ?? '3:50:00';
  const strategy =
    (arg('strategy', args) as 'even_effort' | 'even_split' | 'negative_split') ?? 'even_effort';
  const courseSlug = (arg('course', args) ?? 'big-sur-marathon') as 'big-sur-marathon';
  const outPath = resolve(here, '..', arg('out', args) ?? 'public/big-sur-3-50.runcino.json');

  const goalS = parseHMS(goalStr);
  if (!goalS) bail(`Invalid --goal "${goalStr}", expected h:mm:ss`);

  const facts = getCourseFacts(courseSlug);
  validateCourseFactsStructure(facts);

  const xml = readFileSync(gpxPath, 'utf8');
  const track = parseGpx(xml);

  // Pre-flight: validate the GPX against the course's expected geometry
  const check = validateGpxAgainstCourse(track, facts);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' RUNCINO · Big Sur pacing pipeline');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  GPX:        ${gpxPath}`);
  console.log(`  Goal:       ${goalStr}`);
  console.log(`  Strategy:   ${strategy}`);
  console.log(`  Course:     ${facts.race.name}`);
  console.log();
  console.log('  Geometry check:');
  console.log(
    `    Distance: parsed ${check.geometry.parsedDistanceMi.toFixed(2)} mi vs expected ${check.geometry.expectedDistanceMi} mi (Δ ${check.geometry.distanceDeltaMi.toFixed(2)})`
  );
  console.log(
    `    Gain:     parsed ${check.geometry.parsedGainFt.toFixed(0)} ft vs expected ${check.geometry.expectedGainFt} ft (Δ ${check.geometry.gainDeltaFt.toFixed(0)})`
  );
  console.log(
    `    Loss:     parsed ${check.geometry.parsedLossFt.toFixed(0)} ft vs expected ${check.geometry.expectedLossFt} ft (Δ ${check.geometry.lossDeltaFt.toFixed(0)})`
  );
  for (const w of check.warnings) console.log(`    ⚠  ${w}`);
  for (const e of check.errors) console.log(`    ✗  ${e}`);
  const force = args.includes('--force');
  if (!check.ok && !force) {
    console.log();
    console.log('  GPX failed pre-flight validation. Aborting.');
    console.log('  (For a race-day plan, use the real official GPX.)');
    console.log('  (To build anyway — dev/test only — rerun with --force.)');
    process.exit(2);
  }
  if (!check.ok && force) {
    console.log('  ⚠  Proceeding with --force despite errors — NOT for race day.');
  }
  console.log();

  const pacingInput = {
    goalFinishS: goalS,
    strategy,
    toleranceSPerMi: 10,
    segmentDistanceM: 800,
  };
  const segments = buildSegments(track, pacingInput);
  const phases = groupPhases(segments, { courseFacts: facts });
  const fueling = planFueling({ phases, finishS: goalS });

  // Extract only primary-source-verified landmarks as intervals
  const landmarks = shippableLandmarks(facts).map(l => ({
    atMi: l.at_mi,
    label: l.label,
  }));

  // Demo fitness summary — in the web UI this comes from the user
  const fitnessSummary: FitnessSummary = {
    baselineRace: { name: 'LA Marathon', finishS: 13200, monthsAgo: 5 },
    weeklyMileage: 38,
    weeklyMileageTrend6Wk: -4,
    longestRecentLongRunMi: 18,
    longestRecentLongRunAgeWk: 3,
    restingHrBpm: 48,
    restingHrTrend8Wk: -2,
    age: null,
    weightLb: null,
    source: 'manual',
  };

  const plan = assemblePlan({
    race: { name: facts.race.name, date: '2026-04-26' },
    track,
    pacing: pacingInput,
    phases,
    fueling,
    fitnessSummary,
    landmarks,
    claudeRationale: null,
    generator: 'runcino-web-cli@0.1.0',
  });

  writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');

  // Human summary
  console.log('━━━ PHASES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const p of phases) {
    const paceLabel = formatPaceMi(p.targetPaceSPerMi).padEnd(8);
    const miles = `${p.startMi.toFixed(1)}–${p.endMi.toFixed(1)}`.padEnd(11);
    const grade = (p.meanGradePct >= 0 ? '+' : '') + p.meanGradePct.toFixed(1) + '%';
    console.log(`  ${String(p.index + 1).padStart(2)}. ${p.label.padEnd(32)} ${miles} ${paceLabel} ${grade.padStart(6)}  → ${p.cumulativeTimeDisplay}`);
  }

  console.log();
  console.log('━━━ FUELING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${fueling.summary.gelCount} × ${fueling.summary.gelBrand} ${fueling.summary.gelCarbsG}g = ${fueling.summary.totalCarbsG}g carbs total`);
  for (const a of fueling.anchors) {
    const phase = phases[a.phaseIdx];
    console.log(`  Gel ${a.gelNumber} @ mile ${a.atMi.toFixed(1)}  (phase: ${phase?.label ?? '?'})`);
  }

  console.log();
  console.log('━━━ LANDMARKS (primary-source verified) ━━━━━━━');
  for (const l of landmarks) {
    console.log(`  mile ${String(l.atMi).padStart(5)}  ${l.label}`);
  }

  console.log();
  console.log('━━━ INTERVALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const kinds = plan.intervals.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  ${plan.intervals.length} total intervals → ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);

  const finishCheck = phases[phases.length - 1].cumulativeTimeS;
  const drift = finishCheck - goalS;
  console.log();
  console.log('━━━ CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Goal:     ${formatHMS(goalS)}`);
  console.log(`  Plan:     ${formatHMS(finishCheck)}`);
  console.log(`  Drift:    ${drift >= 0 ? '+' : ''}${drift} s  (tolerance ±2 s)`);

  console.log();
  console.log(`  Plan written to: ${outPath}`);
  console.log();
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
