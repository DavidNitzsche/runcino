// One-off, read-back-verified activation run for the PACE shadow-compare
// mechanism against production, per docs/PRODUCT_DECISIONS.md 2026-09-01 §2
// Part 5 ("confirm the cron actually starts persisting real records in
// production"). Uses the FULL write role (DATABASE_URL, not the RO role the
// audit tests deliberately use to prove zero mutation) because persisting a
// row into adaptation_shadow_log IS the intended write — nothing here
// touches plan_workouts, training_plans, or any other table. Run once,
// manually, from this session; not part of any test suite or cron.
import { readFileSync } from 'node:fs';

// Minimal .env.local loader — no `dotenv` package installed in this repo.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function main() {
  const { runAndPersistPaceShadowCompare } = await import('../lib/adaptation/shadow-compare.ts');
  const { pool } = await import('../lib/db/pool.ts');

  const before = await pool.query(
    `SELECT count(*)::int AS n FROM adaptation_shadow_log WHERE user_uuid = $1::uuid`,
    [OWNER],
  );
  console.log('rows before:', before.rows[0].n);

  const result = await runAndPersistPaceShadowCompare(OWNER);
  console.log('error:', result.error ?? 'none');
  console.log('persisted:', JSON.stringify(result.persisted));
  console.log('record.finalDecision:', result.record?.finalDecision);
  console.log('record.convergence.state:', result.record?.convergence.state);
  console.log('record.hrCompatibility?.verdict:', result.record?.hrCompatibility?.verdict ?? null);
  console.log('record.mutation:', JSON.stringify(result.record?.mutation));

  const after = await pool.query(
    `SELECT count(*)::int AS n FROM adaptation_shadow_log WHERE user_uuid = $1::uuid`,
    [OWNER],
  );
  console.log('rows after:', after.rows[0].n);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
