/**
 * READ-ONLY · what does each competing threshold-pace owner return for the
 * owner's account today? No writes, no DDL.
 *
 *   DATABASE_URL="$DATABASE_URL_RO" npx tsx --tsconfig tsconfig.json \
 *     scripts/p0-proof/threshold-owners.ts [YYYY-MM-DD]
 */
import { pool } from '@/lib/db/pool';
import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import {
  bestRecentVdot, resolveCurrentTPace, VDOT_FULL_VALUE_DAYS, tPaceFromVdot,
} from '@/lib/training/vdot';
import { conservativeVdotFromMileage } from '@/lib/plan/spec-builder';
import { distanceMiOfMeta } from '@/lib/race/distance';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const mmss = (s: number | null | undefined) =>
  s == null ? 'null' : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}/mi`;

async function main() {
  const today = process.argv[2]
    ?? (await pool.query<{ d: string }>(
      `SELECT to_char(now() AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD') AS d`,
    )).rows[0].d;
  console.log(`# threshold owners · user ${USER} · ${today}\n`);

  /* 1 · CANONICAL — Runner Model */
  const cap = await resolveThresholdCapacity(USER, today);
  console.log('1 CANONICAL  capacity-resolver.resolveThresholdCapacity');
  console.log(`             ${cap.paceSecPerMi} s/mi (${mmss(cap.paceSecPerMi)})  vdot=${cap.vdot}  mode=${cap.sourceMode}  conf=${cap.confidence.toFixed(3)}`);
  console.log(`             reasons=${cap.reasons.join(',')}`);

  /* 1b · the Pace Prescription anchor the plan engine actually writes */
  const anchors = await resolvePrescribedPaceAnchors(USER, today);
  console.log('1b PRESCRIBED load-prescription-anchors.resolvePrescribedPaceAnchors');
  console.log(anchors.ok
    ? `             ${anchors.anchors.thresholdSecPerMi} s/mi (${mmss(anchors.anchors.thresholdSecPerMi)})  basis=${JSON.stringify(anchors.anchors.basis)}`
    : `             REFUSED · ${anchors.reason}`);

  /* 2 · LEGACY CASCADE — vdot.ts */
  const inputs = await loadVdotInputs(USER, today);
  const read = bestRecentVdot(
    inputs.raceCandidates, today, VDOT_FULL_VALUE_DAYS, inputs.runCandidates, inputs.runFloorMi,
  );
  // Rule 8 · the cascade's bottom rung asks what this runner NORMALLY does, so
  // the probe asks it through the one shared habit reader rather than
  // hand-rolling a rolling-window aggregate over `runs` (which is exactly what
  // `_normal_window_scan.test.ts` exists to catch, and did catch here).
  const { normalWeeklyMileage } = await import('@/lib/training/normal-window');
  const habit = await normalWeeklyMileage(USER, today);
  const weekly = habit.ok ? habit.value : null;
  const cascade = resolveCurrentTPace(
    read.best?.vdot ?? null, read.belowTableAnchor, weekly ?? 0, conservativeVdotFromMileage,
  );
  console.log(`2 LEGACY     vdot.resolveCurrentTPace  (measuredVdot=${read.best?.vdot ?? null}, normalWeeklyMi=${weekly ?? `REFUSED · ${habit.ok ? '' : habit.refusal}`})`);
  console.log(`             ${cascade.tPaceSec} s/mi (${mmss(cascade.tPaceSec)})  tier=${cascade.tier}`);

  /* 3 · GOAL SIDE DOOR — spec-builder.tPaceFromGoal, via adapt.ts's rebuild */
  const race = (await pool.query<{ slug: string; meta: unknown; plan: { goal?: { finish_time_s?: number } } | null }>(
    `SELECT tp.race_id AS slug, r.meta, r.plan
       FROM training_plans tp
       JOIN races r ON r.user_uuid = tp.user_uuid AND r.slug = tp.race_id
      WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL
      ORDER BY tp.authored_iso DESC LIMIT 1`,
    [USER],
  )).rows[0];
  if (!race) {
    console.log('3 GOAL DOOR  no active plan race row · unreachable today');
  } else {
    const goalSec = Number(race.plan?.goal?.finish_time_s);
    const distMi = distanceMiOfMeta(race.meta);
    const mod = await import('@/lib/plan/spec-builder') as Record<string, unknown>;
    const fn = (mod.tPaceFromGoal ?? null) as ((a: number, b: number | null) => number | null) | null;
    const fixture = await import('@/lib/plan/_fixture-goal-tpace')
      .then((m) => (m as Record<string, unknown>).fixtureTPaceFromGoalPace as (a: number, b: number | null) => number | null)
      .catch(() => null);
    const t = fn ? fn(goalSec, distMi) : (fixture ? fixture(goalSec, distMi) : null);
    console.log(`3 GOAL DOOR  spec-builder.tPaceFromGoal  (race=${race.slug}, goal=${goalSec}s over ${distMi}mi)`);
    console.log(`             ${t} s/mi (${mmss(t)})${fn ? '' : '   [DELETED from production — value shown via the test fixture]'}`);
  }

  /* 4 · what the plan rows actually carry today */
  const rows = (await pool.query<{ n: string; p: string | null }>(
    `SELECT COUNT(*)::text AS n, MIN(pw.pace_target_s_per_mi)::text AS p
       FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL
        AND pw.type IN ('threshold','tempo') AND pw.date_iso::date >= $2::date`,
    [USER, today],
  )).rows[0];
  console.log(`4 PERSISTED  future threshold/tempo rows n=${rows?.n} minPaceTarget=${rows?.p} (${mmss(rows?.p ? Number(rows.p) : null)})`);

  /* 5 · anchor VDOT the adapters gate on */
  const anchorRow = (await pool.query<{ reviewed: string | null; authored_state: Record<string, unknown> | null }>(
    `SELECT (SELECT vdot_last_reviewed::numeric::text FROM users WHERE id=$1::uuid) AS reviewed, tp.authored_state
       FROM training_plans tp WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL
      ORDER BY tp.authored_iso DESC LIMIT 1`,
    [USER],
  )).rows[0];
  const { anchorVdotFromState } = await import('@/lib/training/pace-anchor');
  const anchorVdot = anchorVdotFromState(anchorRow?.reviewed, anchorRow?.authored_state);
  console.log(`5 ADAPTER    anchorVdotFromState=${anchorVdot}  →  tPaceFromVdot=${tPaceFromVdot(anchorVdot)} (${mmss(tPaceFromVdot(anchorVdot))})`);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
