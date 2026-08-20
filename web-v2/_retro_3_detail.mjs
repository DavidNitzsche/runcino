// READ-ONLY retro probe 3: run data keys, race splits, races.plan, mutations, quality splits
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// keys of a null-movingTime run
const k = await pool.query(`SELECT id, (SELECT array_agg(key) FROM jsonb_object_keys(data) key) AS keys
  FROM runs WHERE user_uuid=$1::uuid AND id='-266958841059441'`, [uid]);
console.log('=== keys of run without movingTimeS ===');
console.log(k.rows[0]);

// try alternate duration fields
const alt = await pool.query(`SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
    ROUND((data->>'distanceMi')::numeric,2) AS mi,
    data->>'movingTimeS' AS mts, data->>'durationS' AS ds, data->>'elapsedS' AS es,
    data->>'movingS' AS ms, data->>'timeS' AS ts, data->>'durationSec' AS dsec
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN '2026-06-01' AND '2026-08-16'
    AND (data->>'movingTimeS') IS NULL ORDER BY d LIMIT 8`, [uid]);
console.log('\n=== alt duration fields ===');
for (const r of alt.rows) console.log(JSON.stringify(r));

// races.plan + actual_result for americas-finest-city
const race = await pool.query(`SELECT plan, actual_result, meta FROM races WHERE slug='americas-finest-city' AND user_uuid=$1::uuid`, [uid]);
console.log('\n=== races.plan ===');
console.log(JSON.stringify(race.rows[0]?.plan, null, 1)?.slice(0, 4000));
console.log('\n=== races.actual_result ===');
console.log(JSON.stringify(race.rows[0]?.actual_result, null, 1)?.slice(0, 2000));

// race day run splits
const rs = await pool.query(`SELECT id, data->'splits' AS splits, data->>'maxHr' AS maxhr
  FROM runs WHERE user_uuid=$1::uuid AND id='-161412146640788'`, [uid]);
console.log('\n=== race run splits ===');
const sp = rs.rows[0]?.splits ?? [];
console.log('n splits:', sp.length, 'maxHr:', rs.rows[0]?.maxhr);
if (sp[0]) console.log('keys:', Object.keys(sp[0]).join(','));
for (const s of sp) console.log(JSON.stringify(s));

// all plan_mutations for user (any plan) in window
const m = await pool.query(`SELECT id, workout_id, ts, reason, trigger_kind, status, changed_fields
  FROM plan_mutations WHERE user_uuid=$1::uuid ORDER BY ts`, [uid]);
console.log('\n=== plan_mutations ALL for user (' + m.rows.length + ') ===');
for (const r of m.rows) console.log(r.ts.toISOString(), r.workout_id, r.trigger_kind, r.status, '|', r.reason, '|', JSON.stringify(r.changed_fields));

await pool.end();
