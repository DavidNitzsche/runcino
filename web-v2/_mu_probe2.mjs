import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p);
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

console.log('=== RACES (non-David) ===');
const races = await q(`select user_uuid, slug, meta, actual_result is not null as has_result, saved_at from races where user_uuid is distinct from $1 order by saved_at`, [DAVID]);
for (const r of races.rows) console.log(JSON.stringify(r).slice(0, 600));

console.log('\n=== TRAINING PLANS non-David (status dist) ===');
const cols = await q(`select column_name from information_schema.columns where table_name='training_plans' order by ordinal_position`);
console.log('tp cols:', cols.rows.map(r => r.column_name).join(', '));
const tp = await q(`select user_uuid, count(*) n, array_agg(distinct status) statuses from training_plans where user_uuid is distinct from $1 group by user_uuid order by n desc limit 15`, [DAVID]).catch(e=>({rows:[],err:e.message}));
if (tp.err) console.log('ERR', tp.err); else console.table(tp.rows);

console.log('\n=== plan_workouts user_uuid null? ===');
const pw = await q(`select count(*) total, count(*) filter (where user_uuid is null) null_uuid, count(*) filter (where user_uuid = $1) david from plan_workouts`, [DAVID]);
console.log(JSON.stringify(pw.rows[0]));
// join: workouts belonging to non-david plans
const pw2 = await q(`select tp.user_uuid, count(pw.id) wo from training_plans tp join plan_workouts pw on pw.plan_id = tp.id where tp.user_uuid is distinct from $1 group by tp.user_uuid limit 10`, [DAVID]).catch(e=>({rows:[],err:e.message}));
if (pw2.err) console.log('ERR', pw2.err); else console.table(pw2.rows);

console.log('\n=== training_plans sample non-David ===');
const tps = await q(`select id, user_uuid, status, created_at from training_plans where user_uuid is distinct from $1 order by created_at desc limit 8`, [DAVID]).catch(e=>({rows:[],err:e.message}));
if (tps.err) console.log('ERR', tps.err); else for (const r of tps.rows) console.log(JSON.stringify(r));

console.log('\n=== me landmine ===');
const tabs = await q(`select table_name from information_schema.columns where column_name='user_id' and table_schema='public' and table_name in (select table_name from information_schema.tables where table_type='BASE TABLE') group by table_name`);
for (const t of tabs.rows) {
  try {
    const c = await q(`select count(*) filter (where user_id::text='me') as me_rows, count(*) as total from "${t.table_name}"`);
    console.log(t.table_name, JSON.stringify(c.rows[0]));
  } catch (e) { console.log(t.table_name, 'ERR', e.message.slice(0,80)); }
}

console.log('\n=== user_settings coverage ===');
const usc = await q(`select column_name from information_schema.columns where table_name='user_settings' order by ordinal_position`);
console.log('us cols:', usc.rows.map(r=>r.column_name).join(', '));
const us = await q(`select count(*) total, count(*) filter (where user_uuid = $1) david from user_settings`, [DAVID]).catch(e=>({rows:[{}],err:e.message}));
console.log(JSON.stringify(us.rows[0]), us.err || '');
const usx = await q(`select * from user_settings limit 5`).catch(e=>({rows:[],err:e.message}));
for (const r of (usx.rows||[])) console.log(JSON.stringify(r).slice(0,500));

console.log('\n=== runner_calibration ===');
const rc = await q(`select user_uuid, as_of, data_quality, source_workout_count from runner_calibration order by as_of desc limit 10`).catch(e=>({rows:[],err:e.message}));
if (rc.err) console.log('ERR', rc.err); else console.table(rc.rows);
const rcc = await q(`select count(*) t, count(distinct user_uuid) u from runner_calibration`).catch(e=>({rows:[{}]}));
console.log(JSON.stringify(rcc.rows[0]));

console.log('\n=== biometrics/settings tables with user scoping ===');
const allT = await q(`select t.table_name,
  bool_or(c.column_name='user_uuid') has_uuid, bool_or(c.column_name='user_id') has_uid
  from information_schema.tables t join information_schema.columns c on c.table_name=t.table_name
  where t.table_schema='public' and t.table_type='BASE TABLE' group by t.table_name order by t.table_name`);
console.log(allT.rows.map(r => `${r.table_name}${r.has_uuid?' [uuid]':''}${r.has_uid?' [uid]':''}`).join('\n'));

await pool.end();
