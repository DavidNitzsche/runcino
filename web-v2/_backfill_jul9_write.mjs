import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const id = '-71886754295643';
const newSplits = [{"mile":1,"pace":"8:45","hr":137,"paceSecPerMi":525,"distanceMi":1},{"mile":2,"pace":"7:50","hr":150,"paceSecPerMi":470,"distanceMi":1},{"mile":3,"pace":"7:11","hr":164,"paceSecPerMi":431,"distanceMi":1},{"mile":4,"pace":"7:41","hr":164,"paceSecPerMi":461,"distanceMi":1},{"mile":5,"pace":"7:20","hr":167,"paceSecPerMi":440,"distanceMi":1}];
// Field-level jsonb update (Rule 6) — touch only splits + flags, preserve everything else.
const upd = await pool.query(
  `UPDATE runs SET data = jsonb_set(
       jsonb_set(
         jsonb_set(data, '{splits}', $2::jsonb),
         '{splits_unreliable}', 'false'::jsonb),
       '{splits_source}', '"watch_rederive_2026-07-09"'::jsonb)
   WHERE id=$1 RETURNING id`, [id, JSON.stringify(newSplits)]);
console.log('updated rows:', upd.rowCount);
const rb = await pool.query(`SELECT data->'splits' splits, data->>'splits_unreliable' unrel, data->>'splits_source' src FROM runs WHERE id=$1`, [id]);
console.log('=== read-back ==='); console.log('unreliable:', rb.rows[0].unrel, '| source:', rb.rows[0].src);
(rb.rows[0].splits||[]).forEach(s=>console.log(`mile ${s.mile}: ${s.pace}  hr ${s.hr}`));
await pool.end();
