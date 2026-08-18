import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rowCount + ')');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 2200));
  } catch (e) { console.log('=== ' + label + ' ERR: ' + e.message); }
};
await q('cim goal', `SELECT meta->>'goalDisplay' g, meta->>'distanceMi' mi FROM races WHERE user_uuid::text=$1 AND slug='cim'`, [uid]);
await q('plan_proposals', `SELECT id, proposal_kind, status, source, to_char(created_at,'MM-DD HH24:MI') ts, substr(reasons::text,0,160) rs FROM plan_proposals WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 8`, [uid]);
await q('workout_proposals', `SELECT id, action_kind, status, workout_date_iso, source, to_char(created_at,'MM-DD') ts FROM plan_workout_proposals WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 6`, [uid]);
await q('coach_proposals', `SELECT id, proposal_type, status, to_char(created_at,'MM-DD') ts FROM coach_proposals WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 5`, [uid]);
await q('latest vdot snapshot', `SELECT to_char(snapshot_date,'YYYY-MM-DD') d, vdot, projection_sec FROM projection_snapshots WHERE user_uuid::text=$1 ORDER BY snapshot_date DESC LIMIT 3`, [uid]);
await q('day_actions this week', `SELECT date_iso, action FROM day_actions WHERE user_uuid::text=$1 AND date_iso >= '2026-08-10' ORDER BY date_iso`, [uid]);
await q('briefings latest', `SELECT to_char(created_at,'MM-DD HH24:MI') ts, substr(payload::text,0,200) p FROM briefings WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 2`, [uid]);
await pool.end();
