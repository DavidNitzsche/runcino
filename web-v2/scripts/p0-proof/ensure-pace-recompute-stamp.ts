// One-off, authorized production trigger: the rebuilt plan (pln_7636bcc0a201bf2d)
// has no authored_state.pace_recompute.anchors stamp yet because that stamp is
// written by recomputePacesForPlan, which runs on a separate schedule
// (plan-drift / reanchor) from plan authoring itself — a real, expected
// Rule-23 timing gap, not a rebuild defect. Ensures the precondition now
// rather than waiting for the next scheduled pass, using the plan's own
// already-current, unchanged VDOT anchor (confirmed 47.7 earlier tonight).
// Deliberately NOT run under vitest/FAFF_VERIFICATION — a real production
// write through the app's own writable pool, same posture as the shadow-eval
// trigger earlier tonight.
import { recomputePacesForPlan } from '../../lib/plan/recompute-paces';
import { pool } from '../../lib/db/pool';

async function main() {
  const planId = process.argv[2];
  const vdot = Number(process.argv[3]);
  if (!planId || !Number.isFinite(vdot)) throw new Error('usage: tsx ensure-pace-recompute-stamp.ts <planId> <vdot>');
  const res = await recomputePacesForPlan(planId, vdot, { source: 'ensure_stamp_2026_09_03' });
  console.log(JSON.stringify(res, null, 2));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
