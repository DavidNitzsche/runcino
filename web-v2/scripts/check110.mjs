import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='sessions'`);
console.log('sessions columns:', r.rows.map(r=>r.column_name));
const p = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profile' AND column_name IN ('strava_auto_push','phone_hr_alerts','apple_user_id','strava_athlete_id')`);
console.log('profile new cols:', p.rows.map(r=>r.column_name));
await pool.end();
