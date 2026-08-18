// READ-ONLY retro probe 5: verify tuneup, Aug1 fragments, day counts
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const t = await pool.query(`SELECT id, data->>'movingTimeS' AS mts, data->>'durationSec' AS dsec,
    data->>'distanceMi' AS mi, data->>'avgPaceMinPerMi' AS avgpace, data->>'name' AS name,
    data->'splits' AS splits
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = '2026-08-11'`, [uid]);
console.log('=== Aug 11 tuneup ===');
for (const r of t.rows) { const {splits, ...rest} = r; console.log(rest); }

const a1 = await pool.query(`SELECT id, data->>'source' AS src, data->>'startLocal' AS start,
    data->>'distanceMi' AS mi, data->>'name' AS name, ROUND((data->>'avgHr')::numeric) AS hr
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = '2026-08-01' ORDER BY start`, [uid]);
console.log('\n=== Aug 1 fragments ===');
for (const r of a1.rows) console.log(r);

const days = await pool.query(`SELECT COUNT(DISTINCT COALESCE(data->>'date', LEFT(data->>'startLocal',10))) AS days,
    COUNT(*) AS runs, ROUND(SUM((data->>'distanceMi')::numeric),1) AS mi
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN '2026-06-01' AND '2026-08-15'`, [uid]);
console.log('\n=== block totals excl race day ===', days.rows[0]);

// race avg HR context: pre-block LTHR was 162 per authored_state
const rr = await pool.query(`SELECT ROUND((data->>'avgHr')::numeric) AS avghr, data->>'maxHr' AS maxhr,
    data->>'movingTimeS' AS mts, data->>'distanceMi' AS mi
  FROM runs WHERE user_uuid=$1::uuid AND id='-161412146640788'`, [uid]);
console.log('=== race run ===', rr.rows[0]);

await pool.end();
