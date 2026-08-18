import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized:false } });
await c.connect();
// For every active race-prep plan, find weeks where a non-long run >= the long run (inversion),
// and weeks where the long isn't the max.
const r = await c.query(`
  SELECT tp.id::text AS pid, tp.user_uuid::text AS uid, w.week_idx,
         MAX(x.distance_mi) FILTER (WHERE x.type='long') AS long_mi,
         MAX(x.distance_mi) FILTER (WHERE x.type<>'long' AND x.type<>'strength' AND x.type<>'rest') AS max_nonlong,
         (array_agg(x.type ORDER BY x.distance_mi DESC))[1] AS biggest_type,
         MAX(x.distance_mi) AS week_max
    FROM plan_workouts x JOIN plan_weeks w ON w.id=x.week_id JOIN training_plans tp ON tp.id=w.plan_id
   WHERE tp.archived_iso IS NULL AND tp.mode='race-prep' AND w.is_race_week=false
   GROUP BY tp.id, tp.user_uuid, w.week_idx
   HAVING MAX(x.distance_mi) FILTER (WHERE x.type='long') IS NOT NULL
      AND MAX(x.distance_mi) FILTER (WHERE x.type<>'long' AND x.type<>'strength' AND x.type<>'rest')
          >= MAX(x.distance_mi) FILTER (WHERE x.type='long')
   ORDER BY tp.user_uuid, w.week_idx`);
console.log(`WEEKS WHERE A NON-LONG RUN >= THE LONG (inversion): ${r.rowCount}`);
for (const x of r.rows.slice(0,25)) console.log(`  u=${x.uid.slice(0,8)} wk${x.week_idx} long=${x.long_mi} maxNonLong=${x.max_nonlong} (biggest=${x.biggest_type})`);
await c.end();
