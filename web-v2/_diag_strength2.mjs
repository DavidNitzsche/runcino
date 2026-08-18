// READ-ONLY: confirm strength deletion + diagnose
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM strength_sessions WHERE user_uuid = $1::uuid`, [uid]);
console.log('David strength_sessions count NOW:', cnt.rows[0].n);

// The two hk_uuids we saw earlier — anywhere in the table, any owner?
const byUuid = await pool.query(
  `SELECT id, user_uuid, date::text AS date, source, LEFT(hk_uuid,8) AS hk8
     FROM strength_sessions
    WHERE hk_uuid LIKE '1E224D2F%' OR hk_uuid LIKE '4EBE14DF%'`);
console.log('rows matching the two known hk_uuids (any owner):', byUuid.rows.length ? byUuid.rows : '(none — both deleted)');

// Is ANY user's strength persisting? (table-wide recent activity)
const allRecent = await pool.query(
  `SELECT COUNT(*)::int AS n, MAX(created_at)::text AS latest_create, MAX(date)::text AS latest_date
     FROM strength_sessions WHERE created_at >= NOW() - interval '14 days'`);
console.log('table-wide strength rows created in last 14d:', allRecent.rows[0]);

// David's manual (hk_uuid NULL) rows — these would survive the HK delete-diff
const manual = await pool.query(
  `SELECT COUNT(*)::int AS n FROM strength_sessions WHERE user_uuid = $1::uuid AND hk_uuid IS NULL`, [uid]);
console.log('David manual (hk_uuid NULL, delete-diff-immune) rows:', manual.rows[0].n);

await pool.end();
