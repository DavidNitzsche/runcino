/**
 * Verify: fueling.ts atMins is deduped so long runs don't render
 * "... + 175 + 175 min" in DayDetailModal.
 *
 * Drives computeFueling with the 180min / 20mi marathon-prep input
 * that originally produced duplicate clamped minutes, asserts:
 *   - no duplicates in atMins
 *   - gels === atMins.length (count stays in sync with rendered times)
 *   - shortLine doesn't repeat "+ 175 + 175"
 *
 * Also runs a sweep over 60..240min to make sure no other duration
 * silently re-introduces a duplicate.
 *
 * Run from web-v2/:  node scripts/_verify_fueling_clamp.mjs
 *
 * No DB needed — pure-function test. Uses tsx so we exercise the actual
 * TypeScript source (mirrors how the production app runs it).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const driver = `
import { computeFueling } from './lib/training/fueling';

const out = [];

// Primary case from the bug report: 180min / 20mi / no race ramp / default 22g gels.
const primary = computeFueling({
  durationEstMin: 180,
  distanceMi: 20,
  workoutType: 'long',
  tempF: 65,
  daysToARace: null,
  raceFuelTargetGPerHr: null,
  gelCarbsG: null,    // default 22g
  gelLabel: 'gel',
});
out.push({ label: 'primary 180min/20mi', plan: primary });

// Maurten 100 (25g) — same duration.
const maurten = computeFueling({
  durationEstMin: 180,
  distanceMi: 20,
  workoutType: 'long',
  tempF: 65,
  daysToARace: null,
  raceFuelTargetGPerHr: null,
  gelCarbsG: 25,
  gelLabel: 'Maurten 100',
});
out.push({ label: 'Maurten 100 180min', plan: maurten });

// Race-ramp case: 7 days out, marathon target 90g/hr — pushes gels higher.
const raceRamp = computeFueling({
  durationEstMin: 180,
  distanceMi: 20,
  workoutType: 'long',
  tempF: 65,
  daysToARace: 7,
  raceFuelTargetGPerHr: 90,
  gelCarbsG: null,
  gelLabel: 'gel',
});
out.push({ label: 'race ramp 7d', plan: raceRamp });

// Sweep durations 60..240 step 5min for sanity — no duplicates anywhere.
const sweep = [];
for (let dur = 60; dur <= 240; dur += 5) {
  const p = computeFueling({
    durationEstMin: dur,
    distanceMi: dur / 9,
    workoutType: 'long',
    tempF: 60,
    daysToARace: null,
    raceFuelTargetGPerHr: null,
    gelCarbsG: null,
    gelLabel: 'gel',
  });
  sweep.push({ dur, gels: p.gels, atMins: p.atMins });
}
out.push({ label: 'sweep 60..240', sweep });

console.log(JSON.stringify(out));
process.exit(0);
`;

const tsxPath = path.join(process.cwd(), '_verify_fueling_driver.mts');
fs.writeFileSync(tsxPath, driver);

let exitCode = 0;
try {
  const child = spawnSync('npx', ['--yes', 'tsx', tsxPath], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (child.stderr && child.stderr.trim()) {
    console.error('tsx stderr:\n' + child.stderr.trim().slice(0, 1200));
  }
  const lastLine = (child.stdout ?? '').trim().split('\n').filter(Boolean).pop();
  if (!lastLine) throw new Error('tsx produced no output: ' + (child.error?.message ?? '(no err)'));
  const out = JSON.parse(lastLine);

  let pass = 0;
  let fail = 0;
  function assert(label, ok, extra = '') {
    const tag = ok ? '✓' : '⚠️';
    console.log(`  ${tag} ${label}${extra ? ' — ' + extra : ''}`);
    if (ok) pass++; else fail++;
  }

  for (const { label, plan } of out.filter((o) => o.plan)) {
    console.log('\n[' + label + ']');
    console.log('  gels=' + plan.gels + ' atMins=' + JSON.stringify(plan.atMins));
    console.log('  shortLine: ' + plan.shortLine);
    const unique = new Set(plan.atMins);
    assert(
      'no duplicates in atMins',
      unique.size === plan.atMins.length,
      `unique=${unique.size}/${plan.atMins.length}`,
    );
    assert(
      'gels count matches atMins.length',
      plan.gels === plan.atMins.length,
      `gels=${plan.gels} atMins.length=${plan.atMins.length}`,
    );
    assert(
      'shortLine does not repeat any minute',
      !/\b(\d+)\s*\+\s*\1\b/.test(plan.shortLine),
    );
    if (plan.atMins.length >= 2) {
      const sorted = [...plan.atMins].sort((a, b) => a - b);
      const stillUnique = new Set(sorted).size === sorted.length;
      assert('after sort still unique', stillUnique);
    }
  }

  const sweepRow = out.find((o) => o.sweep);
  if (sweepRow) {
    console.log('\n[sweep 60..240]');
    let sweepFail = 0;
    for (const { dur, gels, atMins } of sweepRow.sweep) {
      const unique = new Set(atMins);
      if (unique.size !== atMins.length || gels !== atMins.length) {
        console.log(
          `  ⚠️ dur=${dur} gels=${gels} atMins=${JSON.stringify(atMins)} unique=${unique.size}`,
        );
        sweepFail++;
      }
    }
    assert(`sweep: no duplicates across ${sweepRow.sweep.length} durations`, sweepFail === 0);
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) {
    exitCode = 1;
  } else {
    console.log('\n✓ fueling clamp dedupe verified');
  }
} catch (e) {
  console.error('verify failed:', e.message);
  if (e.stack) console.error(e.stack);
  exitCode = 1;
} finally {
  try { fs.unlinkSync(tsxPath); } catch {}
}
process.exit(exitCode);
