/**
 * Rule 16 probe · does the Today "Half fitness" row agree with the race brain?
 *
 * `lib/fitness/fitness-model.ts` republishes `bestRecentVdot().best` and widens
 * it into a band. `lib/race/race-outlook.ts` is the canonical race-pace brain
 * and prices off the capacity resolvers. Both claim to describe what the runner
 * can race today. If they disagree materially they are two owners of one
 * question; if they agree, the fitness model is the reporting widening its own
 * header says it is.
 *
 * Read-only. Prints, decides nothing.
 */
import { pool } from '@/lib/db/pool';
import { bestRecentVdot, predictRaceTime } from '@/lib/training/vdot';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { resolveFitness } from '@/lib/fitness/fitness-model';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';

const UUID = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

function hms(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function main() {
  const todayISO = await runnerToday(UUID);
  const inputs = await loadVdotInputs(UUID, todayISO);
  const { best, considered } = bestRecentVdot(
    inputs.raceCandidates,
    todayISO,
    undefined,
    inputs.runCandidates,
    inputs.runFloorMi,
  );
  console.log('=== bestRecentVdot ===');
  console.log('best:', best ? JSON.stringify({ vdot: best.vdot, source: best.source, dist: best.distance_mi, age: best.age_days }) : 'null');
  console.log('considered:', considered.length);

  const fit = resolveFitness({ best, considered });
  console.log('\n=== resolveFitness (the Today row) ===');
  if (!fit) { console.log('null — no estimate'); }
  else {
    console.log('point vdot:', (fit as any).vdot ?? '(n/a)');
    console.log('confidence:', (fit as any).confidence);
    console.log('anchorDistanceMi:', (fit as any).anchorDistanceMi);
    console.log('basis:', (fit as any).basis);
    console.log('vdot band:', (fit as any).vdotLo, '->', (fit as any).vdotHi);
    const races = (fit as any).races ?? {};
    for (const k of Object.keys(races)) {
      const r = races[k];
      if (r && typeof r.loSec === 'number') console.log(`  ${k}: ${hms(r.loSec)} - ${hms(r.hiSec)}`);
    }
  }

  console.log('\n=== canonical anchors (the brain that prices the plan) ===');
  const anchors = await resolvePrescribedPaceAnchors(UUID);
  console.log(JSON.stringify(anchors, null, 2).slice(0, 4000));

  if (best) {
    console.log('\n=== same-VDOT half prediction, both paths ===');
    const halfFromBest = predictRaceTime(best.vdot, 13.1094);
    // Rule 11 · a null here means the VDOT ran off Daniels' table. That is a
    // different fact from a slow prediction and it is reported as one.
    console.log('half from bestRecentVdot anchor:',
      halfFromBest == null ? 'REFUSED (off table)' : hms(halfFromBest));
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
