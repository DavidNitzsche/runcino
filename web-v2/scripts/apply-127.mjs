import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('db/migrations/127_course_library_provenance.sql','utf8');
console.log('Applying migration 127 (course_library_provenance)…');
await pool.query(sql);

// Verify column shape on course_library
const cols = await pool.query(
  `SELECT column_name, data_type, column_default
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='course_library'
      AND column_name IN ('source','contributor_count','first_contributed_iso')
    ORDER BY column_name`);
console.log('course_library new columns:');
for (const r of cols.rows) console.log(`  ${r.column_name.padEnd(24)} ${r.data_type.padEnd(28)} default=${r.column_default ?? '(null)'}`);

// Verify the per-race promotion tracker
const r2 = await pool.query(
  `SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='races'
      AND column_name='promoted_to_library_iso'`);
console.log(`races.promoted_to_library_iso=${r2.rows[0]?.data_type ?? 'MISSING'}`);

// Source breakdown after backfill
const breakdown = await pool.query(
  `SELECT source, COUNT(*)::int AS n FROM course_library GROUP BY source ORDER BY source`);
console.log('course_library source breakdown:');
for (const r of breakdown.rows) console.log(`  ${String(r.source).padEnd(16)} ${r.n}`);

await pool.end();
