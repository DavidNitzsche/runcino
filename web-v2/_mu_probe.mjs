import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p);

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function main() {
  // 1. users table shape
  const cols = await q(`select table_name, column_name, data_type from information_schema.columns where table_name in ('users','user_settings','races','training_plans','plan_workouts','projection_snapshots','runs','runner_calibration','sessions') order by table_name, ordinal_position`);
  const byTable = {};
  for (const r of cols.rows) (byTable[r.table_name] ||= []).push(r.column_name + ':' + r.data_type);
  for (const [t, c] of Object.entries(byTable)) console.log('TABLE', t, '=>', c.join(', '));

  console.log('\n=== USERS ===');
  const users = await q(`select * from users order by created_at`);
  for (const u of users.rows) {
    const copy = { ...u };
    delete copy.password_hash; delete copy.pw_hash;
    console.log(JSON.stringify(copy));
  }

  console.log('\n=== PER-USER DATA ===');
  const per = await q(`
    select u.id as uid, u.email,
      (select count(*) from runs r where r.user_uuid = u.id) as runs,
      (select count(*) from races ra where ra.user_uuid = u.id) as races,
      (select count(*) from training_plans tp where tp.user_uuid = u.id) as plans,
      (select count(*) from plan_workouts pw where pw.user_uuid = u.id) as plan_workouts,
      (select count(*) from projection_snapshots ps where ps.user_uuid = u.id) as proj_snaps,
      (select max(last_used_at) from sessions s where s.user_uuid = u.id) as last_session
    from users u order by u.created_at`);
  console.table(per.rows);

  console.log('\n=== RACES (non-David) ===');
  const races = await q(`select user_uuid, slug, user_id, meta, actual_result is not null as has_result, created_at, updated_at from races where user_uuid is distinct from $1 order by created_at`, [DAVID]);
  for (const r of races.rows) console.log(JSON.stringify(r));

  console.log('\n=== TRAINING PLANS (all) ===');
  const plans = await q(`select id, user_uuid, user_id, status, created_at, (meta is not null) as has_meta from training_plans order by created_at`).catch(e => ({ rows: [], err: e.message }));
  if (plans.err) console.log('ERR', plans.err); else for (const r of plans.rows) console.log(JSON.stringify(r));

  console.log('\n=== user_id=me landmine counts ===');
  const tabs = await q(`select table_name from information_schema.columns where column_name='user_id' and table_schema='public' group by table_name`);
  for (const t of tabs.rows) {
    try {
      const c = await q(`select count(*) filter (where user_id='me') as me_rows, count(*) as total from "${t.table_name}"`);
      console.log(t.table_name, JSON.stringify(c.rows[0]));
    } catch (e) { console.log(t.table_name, 'ERR', e.message); }
  }

  console.log('\n=== user_settings (all users) ===');
  const us = await q(`select * from user_settings`).catch(e => ({ rows: [], err: e.message }));
  if (us.err) console.log('ERR', us.err); else for (const r of us.rows) console.log(JSON.stringify(r));

  console.log('\n=== runner_calibration ===');
  const rc = await q(`select * from runner_calibration`).catch(e => ({ rows: [], err: e.message }));
  if (rc.err) console.log('ERR', rc.err); else for (const r of rc.rows) console.log(JSON.stringify(r));

  console.log('\n=== non-David runs sample ===');
  const nr = await q(`select user_uuid, count(*) n, min(coalesce(start_local::text,'')) first, max(coalesce(start_local::text,'')) last from runs where user_uuid is distinct from $1 group by user_uuid`, [DAVID]).catch(e => ({ rows: [], err: e.message }));
  if (nr.err) console.log('ERR', nr.err); else console.table(nr.rows);

  await pool.end();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
