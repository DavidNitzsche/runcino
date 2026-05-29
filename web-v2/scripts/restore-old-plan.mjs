// One-off · restore old plan after plan-builder regen produced a regression.
//
// Strategy: un-archive the prior plan (8599e3a1...) + archive the new one (pln_895f6f08...).
// glance-state.ts picks the most-recent non-archived plan, so flipping the
// archived_iso values swaps which one is active without touching plan_workouts.

import { Client } from 'pg';

const OLD_PLAN_ID = '8599e3a1-07ab-4610-9f77-eae6a6f80032';
const NEW_PLAN_ID = 'pln_895f6f08e3511326';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log('[1/3] current state:');
const before = await client.query(
  `SELECT id::text, archived_iso, authored_iso FROM training_plans WHERE id::text IN ($1, $2) ORDER BY authored_iso DESC`,
  [OLD_PLAN_ID, NEW_PLAN_ID]
);
console.table(before.rows);

console.log('[2/3] archiving new plan, un-archiving old plan…');
await client.query(`UPDATE training_plans SET archived_iso = NOW() WHERE id::text = $1`, [NEW_PLAN_ID]);
await client.query(`UPDATE training_plans SET archived_iso = NULL WHERE id::text = $1`, [OLD_PLAN_ID]);

console.log('[3/3] state after:');
const after = await client.query(
  `SELECT id::text, archived_iso, authored_iso FROM training_plans WHERE id::text IN ($1, $2) ORDER BY authored_iso DESC`,
  [OLD_PLAN_ID, NEW_PLAN_ID]
);
console.table(after.rows);

await client.end();
console.log('done.');
