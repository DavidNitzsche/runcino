// READ-ONLY audit probe · runs surface + settings truth · 2026-08-17
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// 1 · canonical vs raw run counts (does the list dedup matter?)
const raw = await pool.query(
  `SELECT COUNT(*) AS n,
          COUNT(*) FILTER (WHERE data ? 'mergedIntoId') AS merged
     FROM runs WHERE user_uuid::text = $1`, [uid]);
console.log('[runs] total rows:', raw.rows[0].n, '· merged-away (mergedIntoId):', raw.rows[0].merged);

// 2 · most recent 10 runs incl. yesterday's race — types + names
const recent = await pool.query(
  `SELECT id, data->>'startLocal' AS start_local, data->>'type' AS type,
          data->>'name' AS name, ROUND((COALESCE((data->>'distanceMi')::numeric,0)),1) AS mi,
          (data ? 'mergedIntoId') AS merged
     FROM runs WHERE user_uuid::text = $1
    ORDER BY COALESCE(data->>'startLocal', data->>'startDate') DESC LIMIT 10`, [uid]);
for (const r of recent.rows) console.log('  run', (r.start_local ?? '').slice(0,10), '·', r.type, '·', r.mi, 'mi ·', (r.name ?? '').slice(0,40), r.merged ? '[MERGED]' : '');

// 3 · races: AFC result state after yesterday's auto-result wave
const races = await pool.query(
  `SELECT slug, date, actual_result IS NOT NULL AS has_result,
          actual_result->>'status' AS result_status,
          actual_result->>'chip_time' AS chip
     FROM races WHERE user_uuid::text = $1
    ORDER BY date DESC LIMIT 6`, [uid]);
for (const r of races.rows) console.log('  race', r.slug, r.date?.toISOString?.().slice(0,10) ?? r.date, 'result:', r.has_result, r.result_status ?? '', r.chip ?? '');

// 4 · pending plan proposals (the one-banner cap question)
const props = await pool.query(
  `SELECT id, kind, status, created_at::date AS d FROM plan_proposals
     WHERE user_uuid::text = $1 AND status IN ('pending','auto_applied')
    ORDER BY created_at DESC LIMIT 10`, [uid]).catch(e => ({ rows: [], err: e.message }));
console.log('[plan_proposals pending/auto]', props.err ?? '');
for (const r of props.rows ?? []) console.log('  ', r.kind, r.status, String(r.d).slice(0,10));

// 5 · workout proposals + coach proposals pending
for (const t of ['workout_proposals', 'coach_proposals']) {
  const q = await pool.query(
    `SELECT COUNT(*) AS n FROM ${t} WHERE user_uuid::text = $1 AND status = 'pending'`, [uid])
    .catch(e => ({ rows: [{ n: 'ERR ' + e.message.slice(0, 60) }] }));
  console.log(`[${t} pending]`, q.rows[0].n);
}

// 6 · notification prefs + device tokens (push promise vs APNs reality)
const prefs = await pool.query(
  `SELECT notification_prefs FROM profiles WHERE user_uuid::text = $1`, [uid])
  .catch(async e => pool.query(`SELECT notification_prefs FROM users WHERE id::text = $1`, [uid]).catch(e2 => ({ rows: [], err: e2.message })));
console.log('[notification_prefs]', JSON.stringify(prefs.rows?.[0]?.notification_prefs ?? prefs.err ?? null)?.slice(0, 300));
const toks = await pool.query(
  `SELECT COUNT(*) AS n FROM device_tokens WHERE user_uuid::text = $1`, [uid])
  .catch(e => ({ rows: [{ n: 'ERR ' + e.message.slice(0, 50) }] }));
console.log('[device_tokens]', toks.rows[0].n);

// 7 · RPE / check-in tables — has the acknowledge-loop any web-visible rows?
for (const t of ['run_rpe', 'run_checkins']) {
  const q = await pool.query(
    `SELECT COUNT(*) AS n, MAX(created_at)::date AS latest FROM ${t} WHERE user_uuid::text = $1`, [uid])
    .catch(e => ({ rows: [{ n: 'ERR ' + e.message.slice(0, 60), latest: '' }] }));
  console.log(`[${t}]`, q.rows[0].n, q.rows[0].latest ?? '');
}
await pool.end();
