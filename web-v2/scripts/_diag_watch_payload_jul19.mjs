// Read-only · reproduce the EXACT /api/watch/today phases array for David's
// structured long runs, by running the verbatim pure logic from
//   lib/training/expand-spec.ts  (expandLong)
//   lib/watch/build-workout.ts   (ExpandedPhase -> WatchPhase + workout fields)
// against the REAL stored workout_spec (DATABASE_URL_RO).
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO = env.match(/^DATABASE_URL_RO=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });

// ── verbatim expandLong (expand-spec.ts:203-255) ─────────────────────────
function expandLong(s, totalMi, easyPaceSec, tolerance) {
  const lo = Number(s.pace_target_s_per_mi_lo ?? easyPaceSec - 30) || (easyPaceSec - 30);
  const hi = Number(s.pace_target_s_per_mi_hi ?? easyPaceSec + 30) || (easyPaceSec + 30);
  const mid = Math.round((lo + hi) / 2);
  const easyTol = Math.max(tolerance, Math.round((hi - lo) / 2));
  const finishMi = Number(s.finish_mi) || 0;
  const finishPace = Number(s.finish_pace_s_per_mi) || 0;
  if (finishMi > 0 && finishPace > 0 && finishMi < totalMi) {
    const easyMi = Number((totalMi - finishMi).toFixed(1));
    const finishLabel = String(s.finish_label ?? '').trim();
    const finishTag = finishLabel ? `@ ${finishLabel} pace` : '@ race pace';
    return [
      { type: 'work', label: `${easyMi.toFixed(1)} mi easy`, distanceMi: easyMi,
        durationSec: Math.round(easyMi * mid), targetPaceSPerMi: mid, tolerancePaceSPerMi: easyTol },
      { type: 'work', label: `${finishMi.toFixed(1)} mi ${finishTag}`, distanceMi: Number(finishMi.toFixed(1)),
        durationSec: Math.round(finishMi * finishPace), targetPaceSPerMi: finishPace,
        tolerancePaceSPerMi: Math.min(easyTol, 12) },
    ];
  }
  return [{ type: 'work', label: `${totalMi.toFixed(1)} mi long run`, distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * mid), targetPaceSPerMi: mid, tolerancePaceSPerMi: easyTol }];
}

// ── verbatim build-workout mapping (build-workout.ts:359-461) ────────────
function buildPhasesAndFields(spec, distanceMi) {
  const defaultTolerance = 20; // long: not threshold/intervals/tempo/race
  const expanded = expandLong(spec, distanceMi, 540, defaultTolerance);
  // isQualityWorkout = false for 'long' → workHrTargetBpm = null
  const phases = expanded.map((p, i) => ({
    index: i,
    type: p.type,
    label: p.label,
    durationSec: p.durationSec ?? Math.round((p.distanceMi ?? 0) * (p.targetPaceSPerMi ?? 540)),
    targetPaceSPerMi: p.targetPaceSPerMi ?? null,
    tolerancePaceSPerMi: p.tolerancePaceSPerMi ?? null,
    haptic: p.type === 'warmup' ? 'start' : p.type === 'recovery' ? 'transition-recovery'
          : p.type === 'cooldown' ? 'transition-cooldown' : 'transition-work',
    repUnit: p.distanceMi != null ? 'distance' : 'time',
    distanceMi: p.distanceMi ?? null,
    hrTargetBpm: null,
  }));
  // haptic patch: first = start
  if (phases.length) { phases[0].haptic = 'start'; }
  const lthr = spec.hr_cap_bpm ? Math.round(spec.hr_cap_bpm / 0.89) : null; // approx; cap derived from lthr
  const longHasFinish = Number(spec.finish_mi) > 0;
  const hrCeilingBpm = (!longHasFinish && lthr) ? Math.round(lthr * 0.89) : null;
  const displayHint = longHasFinish ? 'pace' : 'hr';
  return { phases, hrCeilingBpm, displayHint, longHasFinish };
}

// ── simulate the watch face router (ActiveWorkoutView.swift:104-146) ─────
function faceFor(displayHint, phases, phaseIdx) {
  if (['hr', 'progression', 'strides'].includes(displayHint)) {
    return { hr: 'LiveHR/HRFace', progression: 'LiveProgression/ProgressionFace', strides: 'LiveStrides/StridesFace' }[displayHint];
  }
  const workCount = phases.filter(p => p.type === 'work').length;
  if (workCount === 1) {
    return phases[phaseIdx].targetPaceSPerMi != null ? 'LiveEasy/EasyFace' : 'LiveSteady/SteadyRunFace';
  }
  // top label rendered by WorkIntervalFace.derivedLabel = "REP n/total"
  return `LiveWorkInterval/WorkIntervalFace  (topLabel "REP ${phaseIdx + 1}/${workCount}")`;
}

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const plan = (await pool.query(
  `SELECT id FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
  [DAVID])).rows[0];

for (const date of ['2026-07-19', '2026-06-28', '2026-07-26']) {
  const wo = (await pool.query(
    `SELECT date_iso, type, distance_mi, sub_label, workout_spec FROM plan_workouts WHERE plan_id=$1 AND date_iso=$2 LIMIT 1`,
    [plan.id, date])).rows[0];
  if (!wo) { console.log(`\n${date}: no row`); continue; }
  const dist = Number(wo.distance_mi);
  const { phases, hrCeilingBpm, displayHint, longHasFinish } = buildPhasesAndFields(wo.workout_spec, dist);
  console.log(`\n${'='.repeat(72)}\n${date} · ${wo.type} · ${dist} mi · name(sub_label)="${wo.sub_label}"`);
  console.log(`workout-level: displayHint="${displayHint}"  hrCeilingBpm=${hrCeilingBpm}  isRace=false  paceLabel="L"  totalEstMin=${Math.round(phases.reduce((a, p) => a + p.durationSec, 0) / 60)}`);
  console.log(`phases.length = ${phases.length}  (all type=work)\n`);
  phases.forEach((p, i) => {
    console.log(`  [${i}] type=${p.type}  label="${p.label}"`);
    console.log(`      targetPaceSPerMi=${p.targetPaceSPerMi} (${fmt(p.targetPaceSPerMi)}/mi)  tol=±${p.tolerancePaceSPerMi}s  distanceMi=${p.distanceMi}  repUnit=${p.repUnit}  durationSec=${p.durationSec}  haptic=${p.haptic}  hrTargetBpm=${p.hrTargetBpm}`);
    console.log(`      → WATCH renders on: ${faceFor(displayHint, phases, i)}`);
  });
  // engine transition at boundary (WorkoutEngine.swift:847-855)
  if (phases.length === 2) {
    const t = fmt(phases[1].targetPaceSPerMi);
    console.log(`\n  engine boundary cue (mile ${phases[0].distanceMi} → finish): GoFace flash  "REP 2 / 2"  target "${t}"  haptic=transition-work`);
    console.log(`  → NO "finish/lift to pace" identity; NO HR; mile-split takeovers SUPPRESSED (both phases are .work)`);
  }
}
await pool.end();
