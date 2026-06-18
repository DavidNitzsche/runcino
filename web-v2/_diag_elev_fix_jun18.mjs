/**
 * _diag_elev_fix_jun18.mjs
 *
 * Read-only diagnostic: fetches the polyline for today's Jun 18 tempo run
 * (id=-251580989059278, currently stored as 554ft from barometric drift),
 * calls Open-Meteo DEM, and outputs the corrected elevation + the UPDATE
 * SQL to fix the row. Run the UPDATE only after David's explicit go.
 *
 * Usage: node web-v2/_diag_elev_fix_jun18.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

// Parse DATABASE_URL from .env.local
const envText = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const dbUrl = envText.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
if (!dbUrl) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }

const client = new Client({ connectionString: dbUrl });
await client.connect();

const RUN_ID = '-251580989059278';

const { rows } = await client.query(`
  SELECT id,
         data->>'routePolyline'  AS poly,
         data->>'elevGainFt'     AS elev,
         data->>'elevGainSource' AS elev_src,
         data->>'distanceMi'     AS dist_mi,
         data->>'startLocal'     AS start_local,
         user_uuid
    FROM runs
   WHERE id = $1::BIGINT
   LIMIT 1
`, [RUN_ID]);

await client.end();

if (!rows[0]) { console.error('Run not found:', RUN_ID); process.exit(1); }

const { poly, elev, elev_src, dist_mi, start_local, user_uuid } = rows[0];
console.log(`Run: ${start_local}  dist=${dist_mi}mi  stored elev=${elev}ft (${elev_src})`);

if (!poly || poly.length < 20) { console.error('No polyline on this row'); process.exit(1); }
console.log(`Polyline: ${poly.length} chars`);

// Decode Google encoded polyline (pure JS)
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

const points = decodePolyline(poly);
console.log(`Decoded ${points.length} GPS points`);

// Downsample to 100 points (Open-Meteo cap per request)
const target = Math.min(100, points.length);
const step = (points.length - 1) / Math.max(1, target - 1);
const sampled = Array.from({ length: target }, (_, i) => points[Math.round(i * step)]);

// Call Open-Meteo elevation API
const lats = sampled.map(p => p[0]).join(',');
const lons = sampled.map(p => p[1]).join(',');
const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

let elevations;
try {
  const res = await fetch(url);
  if (!res.ok) { console.error('Open-Meteo error:', res.status); process.exit(1); }
  const data = await res.json();
  elevations = data.elevation;
} catch (e) {
  console.error('Open-Meteo fetch failed:', e.message); process.exit(1);
}

if (!elevations || elevations.length < 4) { console.error('Too few elevation points from DEM'); process.exit(1); }

// Sum positive deltas (>= 0.5m threshold, same as server-side)
let gainM = 0;
for (let i = 1; i < elevations.length; i++) {
  const delta = elevations[i] - elevations[i - 1];
  if (delta >= 0.5) gainM += delta;
}
const gainFt = Math.round(gainM * 3.28084);

console.log(`\nGPS-DEM result: ${gainFt}ft (Open-Meteo SRTM, ±10ft accuracy)`);
console.log(`Current stored: ${elev}ft (barometric drift, split0=502ft spike)`);
console.log(`\n--- APPROVE TO FIX (DDL go required) ---`);
console.log(`UPDATE runs`);
console.log(`   SET data = jsonb_set(`);
console.log(`               jsonb_set(data, '{elevGainFt}', to_jsonb(${gainFt}::int)),`);
console.log(`               '{elevGainSource}', '"gps_derived"'::jsonb`);
console.log(`             )`);
console.log(` WHERE id = ${RUN_ID}::BIGINT`);
console.log(`   AND user_uuid = '${user_uuid}'`);
console.log(`   AND data->>'elevGainFt' = '${elev}';`);
console.log(`\nThe WHERE guard (matches current value ${elev}) prevents double-firing.`);
