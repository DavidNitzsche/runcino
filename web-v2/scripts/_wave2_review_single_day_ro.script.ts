/* READ-ONLY re-validation of resolve-current-fitness.ts against real data.
 * Fresh-reviewer verification: does NOT trust the prior pass's reported numbers. */
import { pool } from '@/lib/db/pool';

async function main() {
  const users = await pool.query<{ id: string; email: string; vdot_last_reviewed: string | null }>(
    `SELECT id::text AS id, email, vdot_last_reviewed::numeric::text AS vdot_last_reviewed
       FROM users ORDER BY created_at ASC NULLS LAST LIMIT 30`,
  );
  console.log('--- users ---');
  for (const u of users.rows) console.log(u.id, u.email, 'vdot_last_reviewed=', u.vdot_last_reviewed);

  const me = users.rows.find((u) => u.email === 'dnitch85@me.com') ?? users.rows[0];
  console.log('\n--- target ---', me.id, me.email);

  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = await runnerToday(me.id);
  console.log('runnerToday =', today);

  const { resolveCurrentFitnessVdot } = await import('@/lib/training/resolve-current-fitness');
  const r = await resolveCurrentFitnessVdot(me.id, today);
  console.log('\n--- resolveCurrentFitnessVdot ---');
  console.log(JSON.stringify(r, null, 2));

  const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
  const est = await resolveThresholdCapacity(me.id, today);
  console.log('\n--- raw capacity estimate (reasons/evidence) ---');
  console.log('vdot', est.vdot, 'pace', est.paceSecPerMi, 'conf', est.confidence, 'mode', est.sourceMode);
  console.log('reasons', JSON.stringify(est.reasons));
  console.log('evidenceIds', JSON.stringify(est.evidenceIds));
  console.log('resolvedAt', est.resolvedAt, 'modelVersion', est.modelVersion);

  // Determinism / stability probe: two consecutive resolves in the same process.
  const est2 = await resolveThresholdCapacity(me.id, today);
  console.log('\n--- stability (2nd call same process) ---');
  console.log('vdot', est2.vdot, 'pace', est2.paceSecPerMi, 'conf', est2.confidence,
    'sameEvidence', JSON.stringify(est2.evidenceIds) === JSON.stringify(est.evidenceIds));

  // Are the evidenceIds REAL `runs` rows? The capacity estimate's own doc
  // comment says they are `runs.id` strings; they look like negative bigints,
  // so this checks rather than assumes.
  const backing = await pool.query<{ id: string; start_local: string | null }>(
    `SELECT id::text AS id, data->>'startLocal' AS start_local
       FROM runs WHERE user_uuid = $1::uuid AND id::text = ANY($2::text[])
      ORDER BY 2`,
    [me.id, est.evidenceIds],
  );
  console.log('\n--- evidenceIds resolved against `runs` ---');
  console.log(`named ${est.evidenceIds.length}, matched ${backing.rows.length}`);
  for (const r of backing.rows) console.log(' ', r.id, r.start_local);

  // Is migration 166 applied? The idempotency design rests on it.
  const reg = await pool.query<{ reg: string | null }>(
    `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
  );
  console.log('\n--- migration 166 (plan_decision_ledger) ---', reg.rows[0]?.reg ?? 'NOT APPLIED');

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
