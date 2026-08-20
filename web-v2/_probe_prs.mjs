import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const u = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// past races as adaptPRs would see
const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
const rows = (await pool.query("SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1 ORDER BY (meta->>'date') NULLS LAST", [u])).rows;
const all = rows.map(r => {
  const m = r.meta ?? {};
  const ar = r.actual_result ?? {};
  const date = m.date ?? null;
  const is_past = date ? date < today : false;
  let finishTime = m.finishTime ?? null;
  if (!finishTime && ar?.finishS && Number(ar.finishS) > 0) {
    const secs = Math.round(Number(ar.finishS));
    const h = Math.floor(secs/3600);
    const mm = Math.floor((secs%3600)/60);
    const ss = secs%60;
    finishTime = h>0 ? `${h}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${mm}:${String(ss).padStart(2,'0')}`;
  }
  return { slug: r.slug, name: m.name ?? r.slug, date: date ?? "", priority: m.priority ?? null, distance_label: m.distanceLabel ?? null, distance_mi: m.distanceMi ?? null, finishTime, is_past };
});
const past = all.filter(r => r.is_past);
console.log("Past races visible to adaptPRs:");
for (const r of past) console.log(" ", r.slug, "label=", r.distance_label, "mi=", r.distance_mi, "finish=", r.finishTime, "date=", r.date);

// Apply bucketing from adaptPRs
const byDist = {};
for (const r of past) {
  if (!r.finishTime) continue;
  const lbl = (r.distance_label || '').toUpperCase();
  const key = lbl.includes('5K') ? '5K'
    : lbl.includes('10K') ? '10K'
    : lbl.includes('HALF') || lbl.includes('HM') ? 'HALF'
    : (r.distance_mi != null && r.distance_mi >= 25) ? 'MARATHON' : null;
  console.log(" bucket for", r.slug, "lbl=", lbl, "key=", key);
  if (!key) continue;
  const cur = byDist[key];
  const toSec = (t) => { const p = t.split(':').map(Number); if (p.length===3) return p[0]*3600+p[1]*60+p[2]; if (p.length===2) return p[0]*60+p[1]; return 0; };
  if (!cur || toSec(r.finishTime) < toSec(cur.val)) byDist[key] = { val: r.finishTime, date: r.date };
}
console.log("Resulting PRs:");
for (const k of ['5K','10K','HALF','MARATHON']) if (byDist[k]) console.log(" ", k, "=>", byDist[k]);
await pool.end();
