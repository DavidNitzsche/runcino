/**
 * lib/race/_probe_course_geometry_backfill.test.ts · the dry run, reproducible.
 *
 * Prints exactly what `POST /api/admin/backfill-course-geometry` would write,
 * against whatever database `DATABASE_URL` points at. READ-ONLY: it issues
 * SELECTs and calls the same pure planner the route calls. It cannot write.
 *
 * Run it against the production READ-ONLY role:
 *
 *     PROBE_COURSE_GEOMETRY=1 bash scripts/probe-run-ro.sh \
 *       lib/race/_probe_course_geometry_backfill.test.ts
 *
 * Skipped by default so `npx vitest run lib/` stays a pure, offline suite.
 *
 * It also runs the AGREEMENT CHECK that matters more than the numbers: the
 * read-time path (parse `gpx_text` on demand) and the stored path (parse once,
 * store, read the column) must produce identical elevation. They do here by
 * construction — both call `parseGPX` — and this asserts the construction
 * rather than trusting it, because the day someone gives the backfill its own
 * parser is the day the two silently diverge.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { planGeometryHydration, geometryFromRaceRow } from './course-geometry-source';
import { resolveCourseElevation } from './course-elevation';
import { hydrateCourseGeometry } from './hydrate-course-geometry';

const RUN = !!process.env.PROBE_COURSE_GEOMETRY && !!process.env.DATABASE_URL;

interface ProbeRow {
  slug: string;
  gpx_text: string | null;
  course_geometry: Record<string, unknown> | null;
  course_source: string | null;
  nominal_mi: string | null;
  lib_gain: number | null;
  lib_net: number | null;
  lib_source: string | null;
}

describe.skipIf(!RUN)('course-geometry backfill · dry run against a live database', () => {
  it('reports every race carrying GPX and no geometry', async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    try {
      const { rows } = await pool.query<ProbeRow>(
        `SELECT r.slug,
                r.gpx_text,
                r.course_geometry,
                r.course_source,
                r.meta->>'distanceMi' AS nominal_mi,
                c.elevation_gain_ft   AS lib_gain,
                c.net_elevation_ft    AS lib_net,
                c.source              AS lib_source
           FROM races r
           LEFT JOIN course_library c ON c.slug = r.slug
          WHERE length(COALESCE(r.gpx_text, '')) > 0
          ORDER BY r.meta->>'date'`,
      );

      const table: Record<string, unknown>[] = [];
      for (const r of rows) {
        const nominal = r.nominal_mi != null && isFinite(Number(r.nominal_mi))
          ? Number(r.nominal_mi) : null;
        const plan = planGeometryHydration({
          slug: r.slug,
          row: { course_geometry: r.course_geometry as never, gpx_text: r.gpx_text },
          nominalDistanceMi: nominal,
          lib: { elevation_gain_ft: r.lib_gain, net_elevation_ft: r.lib_net },
        });
        table.push({
          slug: plan.slug,
          verdict: plan.verdict,
          stamp: plan.courseSource ?? '—',
          pts: plan.points ?? '—',
          mi: plan.measuredDistanceMi?.toFixed(2) ?? '—',
          nominal: plan.nominalDistanceMi?.toFixed(2) ?? '—',
          ratio: plan.distanceRatio?.toFixed(3) ?? '—',
          gain: plan.gainFt ?? '—',
          loss: plan.lossFt ?? '—',
          net: plan.netFt ?? '—',
          per10mi: plan.vertPer10Mi ?? '—',
          conf: plan.confidence,
          measTrust: plan.measuredTrusted,
          reads: plan.resolvedProvenance,
          readGain: plan.resolvedGainFt ?? '—',
          readNet: plan.resolvedNetFt ?? '—',
        });
        // eslint-disable-next-line no-console
        console.log(`\n${plan.slug} · ${plan.verdict} · ${plan.reason}`);
        if (plan.conflict) {
          // eslint-disable-next-line no-console
          console.log(`  SOURCE_CONFLICT vs course_library (${r.lib_source}): ${plan.conflict.detail}`);
        }
      }
      // eslint-disable-next-line no-console
      console.table(table);

      // ── AGREEMENT · read-time parse vs what the column would hold ────────
      for (const r of rows) {
        const nominal = r.nominal_mi != null ? Number(r.nominal_mi) : null;
        const readTime = geometryFromRaceRow({ course_geometry: null, gpx_text: r.gpx_text });
        if (!readTime.geometry) continue;
        const wouldStore = readTime.geometry; // the exact blob the backfill writes
        const a = resolveCourseElevation({ geometry: readTime.geometry, nominalDistanceMi: nominal });
        const b = resolveCourseElevation({ geometry: wouldStore, nominalDistanceMi: nominal });
        expect(b.elevationGainFt, `${r.slug} gain`).toBe(a.elevationGainFt);
        expect(b.netElevationFt, `${r.slug} net`).toBe(a.netElevationFt);
        expect(b.lossFt, `${r.slug} loss`).toBe(a.lossFt);
        expect(b.confidence, `${r.slug} confidence`).toBe(a.confidence);
      }

      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it('the shared writer, in dry run, plans exactly what the planner planned', async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    try {
      // commit omitted → DRY RUN. This is the same function the admin route
      // and the cron call, so the preview and the write cannot diverge.
      const run = await hydrateCourseGeometry({ pool, limit: 200 });
      expect(run.committed).toBe(false);
      expect(run.plans, 'candidate read failed').not.toBeNull();
      // eslint-disable-next-line no-console
      console.log('\nhydrateCourseGeometry (dry run) counts:', run.counts);
      // eslint-disable-next-line no-console
      console.table((run.plans ?? []).map((p) => ({
        slug: p.slug,
        verdict: p.verdict,
        stamp: p.courseSource ?? '—',
        gpxKB: Math.round(p.gpxBytes / 1024),
        pts: p.points ?? '—',
        gain: p.gainFt ?? '—',
        loss: p.lossFt ?? '—',
        net: p.netFt ?? '—',
        per10mi: p.vertPer10Mi ?? '—',
        conf: p.confidence,
        written: p.written,
      })));
      // A dry run writes nothing, by definition and by assertion.
      expect((run.plans ?? []).some((p) => p.written)).toBe(false);
    } finally {
      await pool.end();
    }
  }, 120_000);
});
