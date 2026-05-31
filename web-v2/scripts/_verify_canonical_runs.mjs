/**
 * _verify_canonical_runs.mjs · sanity probe for the canonical run model.
 *
 * Run after any backfill / pull-sync to assert invariants:
 *   1. No unmerged duplicates (same minute, same distance).
 *   2. Every canonical row has non-empty provenance.
 *   3. Provenance source-tier ordering matches actual values
 *      (we don't have ground truth, but we flag tier-0 entries).
 *   4. Dedup-losers are all stamped absorbed.
 *
 * Run: node web-v2/scripts/_verify_canonical_runs.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n')
  .reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

function ok(s)   { console.log(`${GREEN}✓${RESET} ${s}`); }
function fail(s) { console.log(`${RED}✗${RESET} ${s}`); }
function warn(s) { console.log(`${YELLOW}⚠${RESET} ${s}`); }

async function main() {
  console.log('Canonical-run model · sanity probe\n');

  let failures = 0;

  // 1. Total canonical rows
  const totalRow = await pool.query(
    `SELECT COUNT(*) AS canonical
       FROM strava_activities
      WHERE absorbed_into_canonical_at IS NULL
        AND (data ? 'mergedIntoId') = false`,
  );
  const losersRow = await pool.query(
    `SELECT COUNT(*) AS losers
       FROM strava_activities
      WHERE data ? 'mergedIntoId'`,
  );
  console.log(`Canonical rows:  ${totalRow.rows[0].canonical}`);
  console.log(`Dedup losers:    ${losersRow.rows[0].losers}\n`);

  // 2. Losers all stamped absorbed
  const stranded = await pool.query(
    `SELECT COUNT(*) AS n
       FROM strava_activities
      WHERE data ? 'mergedIntoId'
        AND absorbed_into_canonical_at IS NULL`,
  );
  if (Number(stranded.rows[0].n) === 0) {
    ok('All dedup-losers are stamped absorbed.');
  } else {
    fail(`${stranded.rows[0].n} dedup-losers are stranded (not absorbed).`);
    failures++;
  }

  // 3. Every canonical has non-empty provenance
  const emptyProv = await pool.query(
    `SELECT COUNT(*) AS n
       FROM strava_activities
      WHERE absorbed_into_canonical_at IS NULL
        AND (data ? 'mergedIntoId') = false
        AND (provenance = '{}'::jsonb OR provenance IS NULL)`,
  );
  if (Number(emptyProv.rows[0].n) === 0) {
    ok('Every canonical row has non-empty provenance.');
  } else {
    fail(`${emptyProv.rows[0].n} canonical rows have empty provenance.`);
    failures++;
  }

  // 4. Provenance source breakdown
  console.log('\nProvenance source breakdown (top values across all canonical rows):');
  const provBreakdown = await pool.query(`
    SELECT v AS source, COUNT(*) AS n
      FROM strava_activities, jsonb_each_text(provenance) AS p(k, v)
     WHERE absorbed_into_canonical_at IS NULL
       AND (data ? 'mergedIntoId') = false
     GROUP BY v
     ORDER BY n DESC`);
  for (const r of provBreakdown.rows) {
    const tier = ({ watch: 5, manual: 4, apple_watch: 3, apple_health: 2, strava: 1, strava_webhook: 1 })[r.source] ?? 0;
    const indicator = tier === 0 ? `${YELLOW}tier 0 (unknown)${RESET}` : `tier ${tier}`;
    console.log(`  ${r.source.padEnd(20)} ${String(r.n).padStart(6)}  ${indicator}`);
  }

  // 5. Possible unmerged duplicates · same user, start within ±15 min, distance within ±0.1 mi
  console.log('\nLooking for likely unmerged duplicates…');
  const dupes = await pool.query(`
    WITH cano AS (
      SELECT id, user_uuid,
             COALESCE(
               (data->>'date')::timestamptz,
               (data->>'startLocal')::timestamptz,
               (data->>'startDate')::timestamptz
             ) AS started,
             COALESCE((data->>'distanceMi')::numeric, (data->>'distance_mi')::numeric, 0) AS dist_mi,
             data->>'source' AS source
        FROM strava_activities
       WHERE absorbed_into_canonical_at IS NULL
         AND (data ? 'mergedIntoId') = false
         AND (data ? 'date' OR data ? 'startLocal' OR data ? 'startDate')
    )
    SELECT a.id AS a_id, a.source AS a_src, a.started AS a_when, a.dist_mi AS a_mi,
           b.id AS b_id, b.source AS b_src, b.started AS b_when, b.dist_mi AS b_mi
      FROM cano a
      JOIN cano b
        ON a.user_uuid = b.user_uuid
       AND a.id < b.id
       AND ABS(EXTRACT(EPOCH FROM (a.started - b.started))) < 900
       AND a.dist_mi > 0 AND b.dist_mi > 0
       AND ABS(a.dist_mi - b.dist_mi) < 0.15
     ORDER BY a.started DESC`);
  if (dupes.rows.length === 0) {
    ok('No unmerged duplicates found.');
  } else {
    warn(`${dupes.rows.length} possible unmerged duplicate pairs:`);
    for (const d of dupes.rows.slice(0, 10)) {
      console.log(`  ${d.a_id} (${d.a_src}, ${Number(d.a_mi).toFixed(2)}mi) ↔ ${d.b_id} (${d.b_src}, ${Number(d.b_mi).toFixed(2)}mi) @ ${d.a_when?.toISOString()}`);
    }
  }

  // 6. Field coverage (using actual key names in our data shape)
  console.log('\nField coverage on canonical rows:');
  const coverage = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE data ? 'name') AS has_name,
      COUNT(*) FILTER (WHERE data ? 'date' OR data ? 'startLocal' OR data ? 'startDate') AS has_start,
      COUNT(*) FILTER (WHERE data ? 'distanceMi' OR data ? 'distance_mi') AS has_dist,
      COUNT(*) FILTER (WHERE data ? 'movingTimeS' OR data ? 'elapsedTimeS' OR data ? 'durationSec') AS has_dur,
      COUNT(*) FILTER (WHERE data ? 'routePolyline' OR data ? 'startLatLng' OR data ? 'summaryPolyline') AS has_gps,
      COUNT(*) FILTER (WHERE data ? 'splits' OR data ? 'splits_metric') AS has_splits,
      COUNT(*) FILTER (WHERE data ? 'avgHr' OR data ? 'maxHr' OR data ? 'average_heartrate') AS has_hr,
      COUNT(*) FILTER (WHERE data ? 'tempF' OR data ? 'weather') AS has_weather,
      COUNT(*) FILTER (WHERE shoe_id IS NOT NULL) AS has_shoe,
      COUNT(*) AS total
      FROM strava_activities
     WHERE absorbed_into_canonical_at IS NULL
       AND (data ? 'mergedIntoId') = false`);
  const c = coverage.rows[0];
  const pct = (n) => `${((Number(n) / Number(c.total)) * 100).toFixed(0)}%`;
  console.log(`  name:      ${c.has_name}/${c.total}  ${pct(c.has_name)}`);
  console.log(`  start:     ${c.has_start}/${c.total}  ${pct(c.has_start)}`);
  console.log(`  distance:  ${c.has_dist}/${c.total}  ${pct(c.has_dist)}`);
  console.log(`  duration:  ${c.has_dur}/${c.total}  ${pct(c.has_dur)}`);
  console.log(`  GPS:       ${c.has_gps}/${c.total}  ${pct(c.has_gps)}`);
  console.log(`  splits:    ${c.has_splits}/${c.total}  ${pct(c.has_splits)}`);
  console.log(`  HR:        ${c.has_hr}/${c.total}  ${pct(c.has_hr)}`);
  console.log(`  weather:   ${c.has_weather}/${c.total}  ${pct(c.has_weather)}`);
  console.log(`  shoe_id:   ${c.has_shoe}/${c.total}  ${pct(c.has_shoe)}`);

  console.log('');
  if (failures === 0) {
    ok('All invariants pass.');
  } else {
    fail(`${failures} invariant(s) failed.`);
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
