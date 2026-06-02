/**
 * _scrub_stale_coach_intents.mjs · scrub watch_completion intents whose
 * underlying workout was sub-threshold (tap-test).
 *
 * Companion to _scrub_subthreshold_runs.mjs · the runs scrub deleted
 * the canonical rows but the coach_intents stayed, so the "A workout
 * finished on the watch · 2H AGO" banner kept rendering against tap
 * tests after the ingest filter shipped.
 *
 * Rule (matches lib/runs/length-guard.ts):
 *   value.totalDistanceMi < 0.25 AND value.totalDurationSec < 180
 *
 * On hit: set acknowledged_at = NOW() so the timeline / banner surfaces
 * stop pulling the row. DELETE would also work · ACK keeps the audit
 * trail intact (we can see WHEN we filtered them).
 *
 *   node web-v2/scripts/_scrub_stale_coach_intents.mjs
 *   node web-v2/scripts/_scrub_stale_coach_intents.mjs --commit
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const MIN_DISTANCE_MI = 0.25;
const MIN_DURATION_SEC = 180;

async function main() {
  console.log(`[scrub intents] ${COMMIT ? 'LIVE' : 'DRY-RUN'} · threshold = < ${MIN_DISTANCE_MI}mi AND < ${MIN_DURATION_SEC}s\n`);

  // Need to read value as text and parse · the column is text/jsonb-ish
  // mixed. Parse JS-side for the comparison.
  const rows = (await pool.query(
    `SELECT id, user_uuid::text AS user_uuid, reason, field, ts, value, acknowledged_at
       FROM coach_intents
      WHERE reason = 'watch_completion'
        AND acknowledged_at IS NULL`,
  )).rows;
  console.log(`Found ${rows.length} unacknowledged watch_completion intents\n`);

  const stale = [];
  for (const r of rows) {
    let v = r.value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    const dist = Number(v?.totalDistanceMi ?? 0);
    const dur = Number(v?.totalDurationSec ?? 0);
    if (dist < MIN_DISTANCE_MI && dur < MIN_DURATION_SEC) {
      stale.push({ id: r.id, ts: r.ts, dist, dur, source: v?.source, user: r.user_uuid });
    }
  }

  console.log(`${stale.length} sub-threshold (would acknowledge):\n`);
  for (const s of stale) {
    console.log(`  id=${s.id} · ${s.ts.toISOString()} · ${s.dist}mi / ${s.dur}s · source=${s.source ?? '?'} · user=${s.user.slice(0,8)}...`);
  }
  console.log();

  if (!COMMIT) {
    console.log('Dry-run complete. Re-run with --commit to apply.');
    await pool.end();
    return;
  }
  if (stale.length === 0) { console.log('Nothing to acknowledge.'); await pool.end(); return; }

  const ids = stale.map((s) => s.id);
  const res = await pool.query(
    `UPDATE coach_intents SET acknowledged_at = NOW() WHERE id = ANY($1::int[])`,
    [ids],
  );
  console.log(`Acknowledged ${res.rowCount} stale watch_completion intents.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
