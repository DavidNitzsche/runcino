/**
 * Backfill: lift every existing race's course_geometry into the shared
 * course_library, with provenance.
 *
 * Mirrors web-v2/lib/courses/promote-from-race.ts in plain SQL/JS so it
 * can run as a one-shot .mjs without TS tooling. Same promotion rules:
 *
 *   - source='stub'         → upgrade to crowd-sourced
 *   - source='editorial'    → bump contributor_count, do not overwrite
 *   - source='crowd-sourced' → bump contributor_count (first-wins)
 *
 * Idempotency: each race is marked `races.promoted_to_library_iso = NOW()`
 * the first time it's promoted, so re-running this backfill is safe and
 * does NOT double-count contributors.
 *
 * Genericization: strips per-user / per-run fields (user_uuid, dates,
 * times, HR, pace). Keeps lat/lng/ele track + bbox + distance/elevation
 * + start/finish labels.
 *
 * Run: cd web-v2 && node scripts/_backfill_course_library_from_existing_races.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g,'');
  return a;
}, {});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hasRealTrackPoints(geometry) {
  const tp = geometry?.trackPoints;
  return Array.isArray(tp) && tp.length >= 2;
}

function genericize(raceGeometry) {
  const g = raceGeometry ?? {};
  const trackPoints = Array.isArray(g.trackPoints)
    ? g.trackPoints
        .filter((p) => p && typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => ({
          lat: Number(p.lat),
          lon: Number(p.lon),
          ele: p.ele == null ? null : Number(p.ele),
        }))
    : [];
  const out = {
    source: 'crowd-sourced',
    trackPoints,
    distance_mi: typeof g.distance_mi === 'number' ? g.distance_mi : null,
    elevation_gain_ft: typeof g.elevation_gain_ft === 'number' ? g.elevation_gain_ft : null,
    bbox: g.bbox && typeof g.bbox === 'object' ? {
      minLat: Number(g.bbox.minLat), maxLat: Number(g.bbox.maxLat),
      minLon: Number(g.bbox.minLon), maxLon: Number(g.bbox.maxLon),
    } : null,
  };
  if (typeof g.start_label === 'string') out.start_label = g.start_label;
  if (typeof g.finish_label === 'string') out.finish_label = g.finish_label;
  if (typeof g.raw_filename === 'string') {
    const fname = g.raw_filename.split('/').pop()?.split('\\').pop();
    if (fname) out.raw_filename = fname;
  }
  return out;
}

async function promote(race) {
  const { slug, user_uuid, course_geometry, promoted_to_library_iso, meta } = race;
  if (promoted_to_library_iso) {
    return { slug, action: 'noop', reason: 'already promoted' };
  }
  if (!hasRealTrackPoints(course_geometry)) {
    return { slug, action: 'noop', reason: 'no real trackPoints' };
  }

  const generic = genericize(course_geometry);
  const m = meta ?? {};
  const nameGuess = (typeof m.name === 'string' && m.name) || slug;
  const distGuess = (typeof m.distanceMi === 'number' && m.distanceMi) || generic.distance_mi || null;

  const libRes = await pool.query(
    `SELECT slug, source, contributor_count
       FROM course_library WHERE slug = $1 LIMIT 1`, [slug]);
  const lib = libRes.rows[0];

  let action, finalSource, finalCount;

  if (!lib) {
    await pool.query(
      `INSERT INTO course_library (
         slug, name, distance_mi, geometry_json, elevation_gain_ft,
         start_label, finish_label, notes,
         source, contributor_count, first_contributed_iso, updated_ts
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,
         'crowd-sourced', 1, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [slug, nameGuess, distGuess, JSON.stringify(generic),
       generic.elevation_gain_ft, generic.start_label ?? null,
       generic.finish_label ?? null,
       'Crowd-sourced from runner GPX upload (backfill).']);
    action = 'created'; finalSource = 'crowd-sourced'; finalCount = 1;
  } else if (lib.source === 'stub' || lib.source == null) {
    const upd = await pool.query(
      `UPDATE course_library SET
         source = 'crowd-sourced',
         geometry_json = $2::jsonb,
         distance_mi = COALESCE(distance_mi, $3),
         elevation_gain_ft = COALESCE($4, elevation_gain_ft),
         start_label = COALESCE(start_label, $5),
         finish_label = COALESCE(finish_label, $6),
         name = COALESCE(NULLIF(name, ''), $7),
         first_contributed_iso = NOW(),
         contributor_count = 1,
         updated_ts = NOW()
       WHERE slug = $1
       RETURNING source, contributor_count`,
      [slug, JSON.stringify(generic), distGuess,
       generic.elevation_gain_ft, generic.start_label ?? null,
       generic.finish_label ?? null, nameGuess]);
    action = 'upgraded';
    finalSource = upd.rows[0]?.source ?? 'crowd-sourced';
    finalCount = upd.rows[0]?.contributor_count ?? 1;
  } else if (lib.source === 'editorial') {
    const upd = await pool.query(
      `UPDATE course_library SET
         contributor_count = contributor_count + 1,
         first_contributed_iso = COALESCE(first_contributed_iso, NOW()),
         updated_ts = NOW()
       WHERE slug = $1
       RETURNING source, contributor_count`, [slug]);
    action = 'incremented';
    finalSource = 'editorial';
    finalCount = upd.rows[0]?.contributor_count ?? 1;
  } else {
    // crowd-sourced — first wins, bump counter
    const upd = await pool.query(
      `UPDATE course_library SET
         contributor_count = contributor_count + 1,
         updated_ts = NOW()
       WHERE slug = $1
       RETURNING source, contributor_count`, [slug]);
    action = 'incremented';
    finalSource = 'crowd-sourced';
    finalCount = upd.rows[0]?.contributor_count ?? 1;
  }

  await pool.query(
    `UPDATE races SET promoted_to_library_iso = NOW()
      WHERE slug = $1 AND user_uuid = $2`,
    [slug, user_uuid]);

  return { slug, user_uuid, action, source: finalSource, contributor_count: finalCount };
}

try {
  // BEFORE snapshot
  console.log('=== course_library BEFORE backfill ===');
  const before = await pool.query(
    `SELECT source, COUNT(*)::int AS n FROM course_library GROUP BY source ORDER BY source`);
  for (const r of before.rows) console.log(`  ${String(r.source).padEnd(16)} ${r.n}`);

  const candidates = (await pool.query(
    `SELECT slug, user_uuid, course_geometry, promoted_to_library_iso, meta
       FROM races
      WHERE course_geometry IS NOT NULL
        AND user_uuid IS NOT NULL
      ORDER BY user_uuid, slug`)).rows;
  console.log(`\nCandidates (races with course_geometry): ${candidates.length}`);

  const counts = { created: 0, upgraded: 0, incremented: 0, noop: 0 };
  for (const race of candidates) {
    try {
      const r = await promote(race);
      counts[r.action] = (counts[r.action] ?? 0) + 1;
      const who = String(race.user_uuid).slice(0, 8);
      console.log(`  [${who}] ${race.slug.padEnd(40)} → ${r.action}  source=${r.source ?? '-'}  contribs=${r.contributor_count ?? '-'}`);
    } catch (e) {
      console.log(`  [ERR] ${race.slug.padEnd(40)} ${e.message}`);
    }
  }
  console.log(`\nPromotion counts: ${JSON.stringify(counts)}`);

  // AFTER snapshot
  console.log('\n=== course_library AFTER backfill ===');
  const after = await pool.query(
    `SELECT source, COUNT(*)::int AS n FROM course_library GROUP BY source ORDER BY source`);
  for (const r of after.rows) console.log(`  ${String(r.source).padEnd(16)} ${r.n}`);

  console.log('\n=== per-slug detail ===');
  const detail = await pool.query(
    `SELECT slug, source, contributor_count,
            first_contributed_iso,
            jsonb_array_length(COALESCE(geometry_json->'trackPoints','[]'::jsonb)) AS pts
       FROM course_library
       ORDER BY source, slug`);
  for (const r of detail.rows) {
    console.log(`  ${String(r.source).padEnd(16)} ${r.slug.padEnd(38)} contribs=${String(r.contributor_count).padStart(3)}  pts=${String(r.pts).padStart(5)}  first=${r.first_contributed_iso ? new Date(r.first_contributed_iso).toISOString().slice(0,10) : '-'}`);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await pool.end();
}
