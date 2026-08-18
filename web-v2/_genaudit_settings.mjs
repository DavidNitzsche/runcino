import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized:false } });
await c.connect();
// How many users have available_days / non-default day prefs in user_settings?
const r = await c.query(`
  SELECT
    COUNT(*) FILTER (WHERE user_settings ? 'available_days') AS has_avail,
    COUNT(*) FILTER (WHERE user_settings ? 'long_run_day') AS has_long,
    COUNT(*) FILTER (WHERE user_settings ? 'quality_days') AS has_quality,
    COUNT(*) FILTER (WHERE user_settings ? 'rest_day') AS has_rest,
    COUNT(*) AS total
  FROM profile`);
console.log('user_settings key coverage:', JSON.stringify(r.rows[0]));
// distinct long_run_day values actually set
const l = await c.query(`SELECT user_settings->>'long_run_day' AS lrd, COUNT(*) FROM profile WHERE user_settings ? 'long_run_day' GROUP BY 1`);
console.log('long_run_day set values:', JSON.stringify(l.rows));
const av = await c.query(`SELECT user_settings->'available_days' AS ad, COUNT(*) FROM profile WHERE user_settings ? 'available_days' GROUP BY 1`);
console.log('available_days set values:', JSON.stringify(av.rows));
// weekly_frequency distribution among onboarded users
const f = await c.query(`SELECT weekly_frequency AS f, COUNT(*) FROM profile WHERE onboarding_completed_at IS NOT NULL GROUP BY 1 ORDER BY 1`);
console.log('weekly_frequency dist (onboarded):', JSON.stringify(f.rows));
await c.end();
