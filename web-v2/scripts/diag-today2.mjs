import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const briefs = (await pool.query(
  `SELECT surface, generated_at, payload->>'lead' AS lead, payload->'voice' AS voice
     FROM briefings WHERE user_id::text = $1 ORDER BY generated_at DESC LIMIT 3`,
  [userId]
)).rows;
for (const b of briefs) {
  console.log(`\n=== ${b.surface} @ ${b.generated_at.toISOString()} ===`);
  console.log(`LEAD: ${b.lead}`);
  console.log('VOICE:');
  const v = typeof b.voice === 'string' ? JSON.parse(b.voice) : b.voice;
  for (const p of (Array.isArray(v) ? v : [String(v)])) console.log(`  ${p}`);
}
await pool.end();
