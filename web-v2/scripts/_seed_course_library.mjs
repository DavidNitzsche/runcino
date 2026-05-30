/**
 * Seed course_library from legacy/web/data/courses/*.json + races already
 * in the DB.
 *
 * Strategy:
 *   1. For each JSON file, create/update a course_library row with the
 *      race metadata (name, distance, gain, peak, descriptions, phases).
 *      geometry_json carries the phases array as a "phases" key, plus a
 *      placeholder empty trackPoints[] so the NOT NULL constraint holds.
 *      Real GPS lat/lon is a follow-up (no trackPoints in repo).
 *   2. For each David race with no matching JSON, still create a stub
 *      row with name + distance from races.meta so the slug exists in
 *      the library for joins.
 *
 * Idempotent via ON CONFLICT (slug) DO UPDATE.
 */
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COURSES_DIR = '/Volumes/WP/06 Claude Code/Runcino/legacy/web/data/courses';
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function q(sql, params=[]) { return (await pool.query(sql, params)); }

try {
  const jsons = readdirSync(COURSES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.includes('overrides'));
  console.log('JSON sources:', jsons);

  // 1) Seed from JSON files
  for (const f of jsons) {
    const j = JSON.parse(readFileSync(join(COURSES_DIR, f), 'utf8'));
    const r = j.race;
    if (!r) continue;
    const slug = r.slug;
    const name = r.name;
    const dist = r.expected_facts?.distance_mi ?? null;
    const gain = r.expected_facts?.total_gain_ft ?? null;
    const startLabel = (r.description?.match(/from ([^.]+?)(?: to |\,|\.)/)?.[1]) ?? null;
    const finishLabel = (r.description?.match(/to ([^.]+?)\b/)?.[1]) ?? null;
    const geometryJson = {
      trackPoints: [],           // placeholder until real GPS ingested
      phases: j.phases ?? [],    // editorial phase annotations from JSON
      facts: r.expected_facts ?? null,
      tolerances: r.expected_tolerances ?? null,
      course_type: r.course_type ?? null,
      typical_date: r.typical_date ?? null,
      sources: r.sources ?? [],
    };
    const notes = r.description ?? null;
    const res = await q(
      `INSERT INTO course_library (slug, name, distance_mi, geometry_json, elevation_gain_ft, start_label, finish_label, notes, updated_ts)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, NOW())
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name, distance_mi = EXCLUDED.distance_mi,
           geometry_json = EXCLUDED.geometry_json,
           elevation_gain_ft = EXCLUDED.elevation_gain_ft,
           start_label = COALESCE(EXCLUDED.start_label, course_library.start_label),
           finish_label = COALESCE(EXCLUDED.finish_label, course_library.finish_label),
           notes = EXCLUDED.notes, updated_ts = NOW()`,
      [slug, name, dist, JSON.stringify(geometryJson), gain, startLabel, finishLabel, notes]
    );
    console.log(`✓ ${slug}: ${name} (${dist}mi · ${gain ?? '?'}ft gain) — rowCount ${res.rowCount}`);
  }

  // 2) Stub rows for David's other race slugs (no JSON file)
  const davidRaces = (await q(
    `SELECT slug, meta FROM races WHERE user_uuid = $1`, [DAVID]
  )).rows;
  for (const dr of davidRaces) {
    const exists = (await q(`SELECT 1 FROM course_library WHERE slug = $1`, [dr.slug])).rowCount;
    if (exists) continue;
    const meta = dr.meta || {};
    const name = meta.name ?? dr.slug;
    const dist = meta.distanceMi ?? null;
    const geom = { trackPoints: [], phases: [], facts: null, sources: [], stub: true };
    await q(
      `INSERT INTO course_library (slug, name, distance_mi, geometry_json, notes, updated_ts)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [dr.slug, name, dist, JSON.stringify(geom), `Stub row — metadata only. Add GPX via /api/gpx/import.`]
    );
    console.log(`  ➕ stub: ${dr.slug}`);
  }

  const final = await q(`SELECT slug, name, distance_mi, elevation_gain_ft FROM course_library ORDER BY slug`);
  console.log('\ncourse_library now:');
  for (const r of final.rows) console.log(`  ${r.slug.padEnd(30)} ${String(r.name).padEnd(38)} ${r.distance_mi ?? '?'}mi`);
} catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
