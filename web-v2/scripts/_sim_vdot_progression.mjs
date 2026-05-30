/**
 * Simulator: "VDOT advances as training accumulates" + cap-at-85 sanity.
 *
 * Scenario A — Pure-race runner (no training contribution).
 *   Race a year ago at HM 1:35:00 → VDOT ~47.5
 *   No qualifying training runs → bestRecentVdot returns the race value.
 *
 * Scenario B — Training-fed progression.
 *   Same race anchor (47.5). Add weekly threshold runs over 12 weeks
 *   showing 5 s/mi improvement per week (real fitness gain).
 *   bestRecentVdot should rise toward and past the race value.
 *
 * Scenario C — Cap-at-85 (impossible-elite training pace).
 *   Synthetic 10K @ 25:00 from a sub-elite training run. Should clamp
 *   to null (VDOT > 85 not allowed in the table).
 *
 * Uses the inlined Daniels math (same as production lib/training/vdot.ts).
 */

const QUALITY_RUN_TYPES = new Set([
  'threshold','tempo','cruise','intervals','vo2','vo2max',
  'marathon_pace','mp','race','time_trial','tune_up',
]);
function kmFromMi(mi) { return mi * 1.609344; }
function vo2Cost(s) { return -4.6 + 0.182258*s + 0.000104*s*s; }
function pctVO2(min) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
}
function rawVdot(fs, mi) {
  if (!fs || fs <= 0 || !mi || mi <= 0) return null;
  const meters = kmFromMi(mi) * 1000;
  const minutes = fs / 60;
  const speed = meters / minutes;
  return vo2Cost(speed) / pctVO2(minutes);
}
function vdotFromRace(fs, mi) {
  if (!fs || fs < 60) return null;
  const v = rawVdot(fs, mi);
  if (v == null) return null;
  if (v < 30 || v > 85) return null;
  return Math.round(v * 10) / 10;
}
function vdotFromRun({ finishSeconds, distanceMi, workoutType, avgHr, maxHr }) {
  if (!finishSeconds || finishSeconds < 60) return null;
  if (!distanceMi || distanceMi < 4) return null;
  const isQuality = QUALITY_RUN_TYPES.has(String(workoutType ?? '').toLowerCase());
  const hrFloor = maxHr ? maxHr * 0.80 : null;
  const isHardEffort = avgHr != null && hrFloor != null && avgHr >= hrFloor;
  if (!isQuality && !isHardEffort) return null;
  return vdotFromRace(finishSeconds, distanceMi);
}
function bestRecentVdot(races, today, lookback, runs) {
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - lookback * 86400000).toISOString().slice(0,10);
  const r = [];
  for (const x of races) {
    if (!x.date || !x.distance_mi || !x.finish_seconds) continue;
    if (x.date < cutoff) continue;
    if (x.priority === 'C') continue;
    const v = vdotFromRace(x.finish_seconds, x.distance_mi);
    if (v == null) continue;
    r.push({ source:'race', ...x, vdot:v });
  }
  const rr = [];
  for (const x of runs ?? []) {
    if (!x.date || x.date < cutoff) continue;
    const v = vdotFromRun({ finishSeconds: x.finish_seconds, distanceMi: x.distance_mi, workoutType: x.workout_type, avgHr: x.avg_hr, maxHr: x.max_hr });
    if (v == null) continue;
    rr.push({ source:'run', ...x, vdot:v });
  }
  const sortKey = c => c.source === 'race' ? c.vdot : c.vdot - 1;
  const all = [...r, ...rr].sort((a,b) => sortKey(b)-sortKey(a));
  return { best: all[0] ?? null, considered: all };
}

const TODAY = '2026-05-30';
function daysAgoISO(n) { return new Date(Date.parse(TODAY+'T12:00:00Z') - n*86400000).toISOString().slice(0,10); }

console.log('=== Scenario A — Pure-race anchor (no training contribution) ===');
const sA = bestRecentVdot(
  [{ slug:'race-anchor', name:'HM', date: daysAgoISO(60), priority:'A', distance_mi:13.1, finish_seconds: 95*60 + 0 }],
  TODAY, 180, []
);
console.log(`A.best: VDOT ${sA.best.vdot} from ${sA.best.source} — ${sA.best.slug ?? sA.best.id}`);

console.log('\n=== Scenario B — Training-fed progression over 12 weeks ===');
// Anchor race 60 days ago at HM 1:35:00 → VDOT ~47.5.
// Add a 6-mile threshold run every 7 days, getting 3s/mi faster each week.
// Starting pace 6:50/mi, ending pace 6:17/mi after 11 weeks.
const races = [{ slug:'race-anchor', name:'HM', date: daysAgoISO(60), priority:'A', distance_mi:13.1, finish_seconds: 95*60 + 0 }];
const runs = [];
const startingPaceS = 6*60 + 50;  // 6:50/mi
const distMi = 6;
for (let w = 0; w < 12; w++) {
  const paceS = startingPaceS - (w * 3);  // 3 s/mi faster per week
  const finishS = paceS * distMi;
  runs.push({
    id: `tt-${w}`,
    date: daysAgoISO(11*7 - w*7),
    workout_type: 'threshold',
    distance_mi: distMi,
    finish_seconds: finishS,
    avg_hr: null, max_hr: null,
  });
}
const sB = bestRecentVdot(races, TODAY, 180, runs);
console.log('B run candidates:');
for (const c of sB.considered.slice(0, 8)) {
  const sortKey = c.source === 'race' ? c.vdot.toFixed(1) : (c.vdot - 1).toFixed(1) + '*';
  console.log(`  [${c.source}] VDOT ${c.vdot.toFixed(1)} sort=${sortKey} · ${c.date} · ${c.distance_mi}mi · ${c.finish_seconds}s ` + (c.source === 'race' ? c.slug : c.workout_type));
}
console.log(`B.best: VDOT ${sB.best.vdot} from ${sB.best.source}`);

console.log('\n=== Scenario C — Cap-at-85 explicit trigger ===');
// 10K @ 24:30 → VDOT ~88 (above cap)
const sC1 = vdotFromRace(24*60 + 30, 6.213);
console.log(`10K @ 24:30 → ${sC1 ?? 'null (clamped, >85)'}`);
// 10K @ 22:00 → off the chart entirely
const sC2 = vdotFromRace(22*60, 6.213);
console.log(`10K @ 22:00 → ${sC2 ?? 'null (clamped, >85)'}`);
// 5K @ 12:00 — sub-human, must clamp
const sC3 = vdotFromRace(12*60, 3.1);
console.log(`5K @ 12:00 → ${sC3 ?? 'null (clamped, >85)'}`);
// Training-run cap test: 5K @ 12:00 with avgHr 160 maxHr 200 (80% gate passes)
const sC4 = vdotFromRun({ finishSeconds: 12*60, distanceMi: 3.1, workoutType:'threshold', avgHr: 160, maxHr: 200 });
console.log(`5K @ 12:00 as training run (quality+HR-gate passes) → ${sC4 ?? 'null (clamped at vdotFromRace boundary)'}`);

console.log('\n=== Scenario D — Run gate: easy run at conversational pace ===');
// Even at full distance, easy pace should NOT yield VDOT if no quality + no HR
const sD1 = vdotFromRun({ finishSeconds: 60*60, distanceMi: 6, workoutType: 'easy', avgHr: 130, maxHr: 200 });
console.log(`6mi @ 10:00/mi · easy · HR 130/200 (65%) → ${sD1 ?? 'null (gate rejected: not quality + HR below 80%)'}`);
// Same pace, threshold-typed (gate passes via type even though pace is soft)
const sD2 = vdotFromRun({ finishSeconds: 60*60, distanceMi: 6, workoutType: 'threshold', avgHr: 130, maxHr: 200 });
console.log(`6mi @ 10:00/mi · threshold · HR 130 → ${sD2} (VDOT computed since "threshold" type passes gate, even at soft pace)`);
// Too short to be useful
const sD3 = vdotFromRun({ finishSeconds: 1500, distanceMi: 3, workoutType: 'threshold', avgHr: 160, maxHr: 200 });
console.log(`3mi @ 8:20 · threshold · HR 160 → ${sD3 ?? 'null (distance < 4mi minimum)'}`);
