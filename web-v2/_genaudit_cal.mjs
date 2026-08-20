import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized:false } });
await c.connect();
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// user 606bcc38 freq=4 post-fix marathon plan — show CALENDAR dates wk0-2 to confirm Sun→Mon adjacency
const r = await c.query(`
  SELECT x.date_iso::text AS d, x.dow, x.type, x.distance_mi
    FROM plan_workouts x JOIN plan_weeks w ON w.id=x.week_id
    JOIN training_plans tp ON tp.id=w.plan_id
   WHERE tp.user_uuid=(SELECT id FROM users WHERE id::text LIKE '606bcc38%' LIMIT 1)
     AND tp.archived_iso IS NULL AND w.week_idx<=1 AND x.type<>'strength'
   ORDER BY x.date_iso`);
let prev=null;
for (const x of r.rows) {
  const dist = Number(x.distance_mi);
  const tag = dist>0 ? `RUN ${x.type} ${dist}mi` : `rest`;
  let adj='';
  if (prev && dist>0 && prev.run) { const dd=(new Date(x.d)-new Date(prev.d))/86400000; if (dd===1) adj=' <== BACK-TO-BACK with prev'; }
  console.log(`${x.d} ${DOW[x.dow]}  ${tag}${adj}`);
  prev={ d:x.d, run: dist>0 };
}
await c.end();
