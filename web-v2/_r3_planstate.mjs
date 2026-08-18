import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL_RO=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const uuid='b8b75dd8-2a04-48b4-8896-44897d9e0b25';
const p = await c.query(`
  SELECT id, mode, race_id, archived_iso IS NULL AS active, archive_reason,
         to_char(authored_iso,'YYYY-MM-DD HH24:MI:SS.MS') AS authored,
         to_char(archived_iso,'YYYY-MM-DD HH24:MI:SS.MS') AS archived
  FROM training_plans WHERE user_uuid=$1
  ORDER BY authored_iso DESC NULLS LAST LIMIT 15`, [uuid]);
let actives=0;
for (const r of p.rows){ if(r.active) actives++; console.log(JSON.stringify(r)); }
console.log('\nACTIVE PLAN COUNT NOW =', actives, '/ total shown', p.rowCount);
// races for test user
const races = await c.query(`SELECT slug, name, meta->>'date' AS date, meta->>'priority' AS pri, meta->>'distanceLabel' AS dist FROM races WHERE user_uuid=$1 ORDER BY (meta->>'date')::date DESC NULLS LAST LIMIT 10`, [uuid]).catch(e=>({rows:[],err:e.message}));
console.log('\nraces:', races.err||'');
for (const r of races.rows) console.log(JSON.stringify(r));
await c.end();
