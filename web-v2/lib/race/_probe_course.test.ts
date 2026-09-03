/**
 * _probe_course.test.ts · TEMPORARY AUDIT HARNESS (not a gate). READ-ONLY.
 *
 *   FAFF_COURSE_PROBE=1 npx vitest run lib/race/_probe_course.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { pool } from '@/lib/db/pool';
import { resolveCourseElevation } from '@/lib/race/course-elevation';
import { courseElevationCostSec } from '@/lib/training/elevation-model';
import { buildRacePacing } from '@/lib/race/pacing';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_COURSE_PROBE;

describe.skipIf(!RUN)('course probe', () => {
  it('prints course facts and the pacing total', async () => {
    const out: string[] = [];
    for (const t of ['races', 'course_library']) {
      const cols = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t],
      );
      out.push(`${t.toUpperCase()}: ${cols.rows.map(c => c.column_name).join(', ')}`);
    }
    const races = await pool.query<{ slug: string; distance_mi: string | null; course_source: string | null; has_geom: boolean; tp: number }>(
      `SELECT slug, (meta->>'distanceMi') AS distance_mi, course_source,
              (course_geometry IS NOT NULL) AS has_geom,
              COALESCE(jsonb_array_length(course_geometry->'trackPoints'), 0) AS tp
         FROM races WHERE user_uuid = $1 ORDER BY slug`,
      [DAVID],
    );
    for (const r of races.rows) {
      out.push(`${r.slug}  dist ${r.distance_mi}  source ${r.course_source}  geom ${r.has_geom} trackpoints ${r.tp}`);
    }
    out.push('\n=== course_library rows for these slugs ===');
    const lib = await pool.query(
      `SELECT slug, source, elevation_gain_ft, net_elevation_ft,
              (geometry_json IS NOT NULL) AS has_geom_json,
              COALESCE(jsonb_array_length(geometry_json->'phases'), 0) AS phases
         FROM course_library WHERE slug = ANY($1)`,
      [races.rows.map(r => r.slug)],
    );
    for (const r of lib.rows) out.push(JSON.stringify(r));

    out.push('\n=== resolveCourseElevation + canonical course cost + pacing total ===');
    for (const slug of ['cim', 'dodgers', 'santa-monica-10k', 'run-malibu']) {
      const g = await pool.query(
        `SELECT course_geometry FROM races WHERE slug = $1 AND user_uuid = $2`, [slug, DAVID],
      ).then(r => r.rows[0]?.course_geometry ?? null);
      const l = await pool.query(
        `SELECT elevation_gain_ft, net_elevation_ft, geometry_json FROM course_library WHERE slug = $1`, [slug],
      ).then(r => r.rows[0] ?? null);
      const distMi = { cim: 26.22, dodgers: 6.21, 'santa-monica-10k': 6.21, 'run-malibu': 13.11 }[slug] ?? 0;
      const resolved = resolveCourseElevation({
        lib: l ? { elevation_gain_ft: l.elevation_gain_ft, net_elevation_ft: l.net_elevation_ft } : null,
        geometry: g, nominalDistanceMi: distMi || null,
      });
      out.push(`\n--- ${slug} (${distMi} mi)`);
      out.push(`  resolveCourseElevation: ${JSON.stringify(resolved)}`);
      // A representative flat pace for the cost model: 7:46/mi on CIM.
      const flatPace = 466;
      const cost = courseElevationCostSec({
        distanceMi: distMi, flatPaceSPerMi: flatPace,
        gainFt: resolved.elevationGainFt, netFt: resolved.netElevationFt,
      });
      out.push(`  canonical course cost @ ${flatPace}s/mi: ${cost == null ? 'null (no data)' : Math.round(cost) + ' s'}`);
      // THE Q26 QUESTION: does the split plan's total reproduce the target?
      const targetSec = Math.round(flatPace * distMi);
      try {
        const p = buildRacePacing({ goalSec: targetSec, distanceMi: distMi, geometry: (l?.geometry_json ?? g) as never });
        const total = (p.phases ?? []).reduce((a, ph) => a + ph.pace_s_per_mi * (ph.end_mi - ph.start_mi), 0);
        out.push(`  pacing source ${p.source} / phases ${p.phase_source} · target ${targetSec}s · phase-integral ${Math.round(total)}s · drift ${Math.round(total - targetSec)}s`);
        for (const ph of p.phases ?? []) out.push(`     ${ph.label} ${ph.start_mi}-${ph.end_mi} ${ph.display} ${ph.cue ?? ''}`);
      } catch (e) { out.push(`  pacing threw: ${String(e)}`); }
    }
    fs.writeFileSync('/tmp/course-probe.txt', out.join('\n'));
    console.log(out.join('\n'));
    expect(true).toBe(true);
  }, 300_000);
});
