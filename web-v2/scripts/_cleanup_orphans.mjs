// _cleanup_orphans.mjs
//
// Idempotent backfill for the 2 orphan rows (user_uuid IS NULL) that
// were stranded by the 2026-05-30 cross-user-leak fix (see SYSTEM_AUDIT_
// 2026-05-30.md). Both rows traced back to David via independent
// evidence — backfilling is safer than deleting.
//
// Evidence trail (recorded 2026-05-30):
//
//   strava_activities 18589376553 ("Afternoon Run", 2026-05-20, 5.08mi)
//     • only Strava connector_tokens row belongs to David (provider_user_id 203630)
//     • mergedIntoId in this row's data jsonb is -3363396946462586 — and
//       that target row IS David's, identical 5.08mi same date
//     • this is the raw Strava-sourced row that was supposed to be merged
//       INTO David's canonical record; the merge ran but user_uuid was
//       never stamped on the source
//
//   shoes 7 ("Nike Vomero Premium", #e85d26, 19.18mi, preferred=true)
//     • David is the only user with shoes (6 others)
//     • brand pattern (Nike Vomero ...) matches his collection
//     • preferred=true → an actively-used shoe, not a dormant import
//
// David's UUID: 0645f40c-951d-4ccc-b86e-9979cd26c795
//
// Safety: every UPDATE is guarded by user_uuid IS NULL so re-runs are
// no-ops. The script prints a verification count at the end.

import pg from 'pg';
import fs from 'fs';

const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return a;
}, {});

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // ── 1. Verify David exists (sanity check before we stamp his UUID anywhere)
  const userCheck = await pool.query('SELECT id, name FROM users WHERE id = $1', [DAVID_UUID]);
  if (userCheck.rows.length === 0) {
    console.error(`ABORT: user ${DAVID_UUID} does not exist`);
    process.exit(1);
  }
  console.log(`Target user: ${userCheck.rows[0].name} (${userCheck.rows[0].id})\n`);

  // ── 2. Pre-state
  const beforeStrava = await pool.query(
    `SELECT id, data->>'name' AS name, data->>'date' AS date, data->>'distanceMi' AS miles
       FROM strava_activities WHERE user_uuid IS NULL`,
  );
  const beforeShoes = await pool.query(
    `SELECT id, brand, model, mileage::float AS miles, preferred
       FROM shoes WHERE user_uuid IS NULL`,
  );
  console.log(`Pre-state:`);
  console.log(`  strava_activities orphans: ${beforeStrava.rowCount}`);
  for (const r of beforeStrava.rows) {
    console.log(`    id=${r.id} "${r.name}" ${r.date} ${r.miles}mi`);
  }
  console.log(`  shoes orphans: ${beforeShoes.rowCount}`);
  for (const r of beforeShoes.rows) {
    console.log(`    id=${r.id} ${r.brand} ${r.model} ${r.miles}mi preferred=${r.preferred}`);
  }
  console.log('');

  if (beforeStrava.rowCount === 0 && beforeShoes.rowCount === 0) {
    console.log('No orphans to backfill — already clean.');
    await pool.end();
    return;
  }

  // ── 3. Backfill strava_activities
  //
  // Narrow filter: only the known orphan id, only if still NULL, only if
  // its mergedIntoId still points to a row that belongs to David. The
  // mergedIntoId check is the strongest evidence link — if that target
  // moved or was deleted, we'd want a human to look before stamping.
  const stravaUpdate = await pool.query(
    `UPDATE strava_activities sa
        SET user_uuid = $1::uuid
      WHERE sa.user_uuid IS NULL
        AND sa.id = 18589376553
        AND EXISTS (
          SELECT 1 FROM strava_activities target
           WHERE target.id = (sa.data->>'mergedIntoId')::bigint
             AND target.user_uuid = $1::uuid
        )
      RETURNING id`,
    [DAVID_UUID],
  );
  console.log(`strava_activities backfilled: ${stravaUpdate.rowCount} row(s)`);

  // ── 4. Backfill shoes
  //
  // Narrow filter: only id=7, only if still NULL. Brand/model encoded
  // in the WHERE so an unrelated future orphan with the same id (e.g.
  // a fresh insert after re-seed) wouldn't accidentally get stamped.
  const shoeUpdate = await pool.query(
    `UPDATE shoes
        SET user_uuid = $1::uuid
      WHERE user_uuid IS NULL
        AND id = 7
        AND brand = 'Nike'
        AND model = 'Vomero Premium'
      RETURNING id`,
    [DAVID_UUID],
  );
  console.log(`shoes backfilled: ${shoeUpdate.rowCount} row(s)\n`);

  // ── 5. Post-state verification
  const afterStrava = await pool.query(
    `SELECT COUNT(*)::int AS n FROM strava_activities WHERE user_uuid IS NULL`,
  );
  const afterShoes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM shoes WHERE user_uuid IS NULL`,
  );
  console.log(`Post-state:`);
  console.log(`  strava_activities orphans remaining: ${afterStrava.rows[0].n}`);
  console.log(`  shoes orphans remaining: ${afterShoes.rows[0].n}`);

  if (afterStrava.rows[0].n === 0 && afterShoes.rows[0].n === 0) {
    console.log('\nAll orphan rows backfilled. Re-runs are safe (UPDATEs are guarded by IS NULL).');
  } else {
    console.warn('\nWARN: orphans still remain — manual review needed.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
