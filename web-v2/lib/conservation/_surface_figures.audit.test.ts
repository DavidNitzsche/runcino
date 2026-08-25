/**
 * lib/conservation/_surface_figures.audit.test.ts · the real readers, over
 * real rows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE `_run_conservation.test.ts`
 *
 * That file drives fixtures through the pure seams and is the gate CI runs.
 * It has one structural blind spot it states honestly in its own header:
 * `loadRunDetail` is welded to five database queries, so the harness reads
 * run detail through the SHARED reader rather than through run detail.
 *
 * Which means: if run detail grows a private opinion about a figure again,
 * that file keeps calling the shared reader and keeps reporting clean. That
 * is exactly what happened with elevation. `pickElevationGain` was correct,
 * the fixtures went through it, and run detail was meanwhile running a
 * 250 ft/mi drift heuristic of its own that nothing looked at.
 *
 * This file closes that hole the only way it can be closed: by CALLING
 * `loadRunDetail` and `loadLogState` for real, against real production rows,
 * and comparing what they return against the resolution the poster uses.
 *
 * READ-ONLY, always. It opens `DATABASE_URL_RO` (`faff_readonly`) and asserts
 * the role before it does anything else. It writes nothing and it is skipped
 * entirely when that variable is absent, which is why it is an `.audit.`
 * file and not part of the CI gate.
 *
 * Run:
 *   npx vitest run lib/conservation/_surface_figures.audit.test.ts \
 *     --disable-console-intercept
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A DISAGREEMENT HERE MEANS
 *
 * Every figure below has ONE right answer per run. The clock is deliberately
 * absent from the comparison: the poster prints the elapsed clock and run
 * detail prints the moving one, on purpose, and both reach it through
 * `reconcileRun`. That is a labelled product difference and flattening it
 * would be a regression, not a fix. `_run_conservation.test.ts` encodes that
 * allowed pair as a negative control.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { pickElevationGain } from '@/lib/runs/elevation';
import { pickSplits } from '@/lib/runs/splits-pick';

const RO = process.env.DATABASE_URL_RO;
const USER = process.env.AUDIT_USER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** How many recent canonical runs to sweep. */
const LIMIT = Number(process.env.AUDIT_RUN_LIMIT ?? 25);

/**
 * The smallest number of runs that makes a clean report meaningful.
 *
 * A sweep that matched zero rows and reported no disagreements is the same
 * false clean this whole directory exists to prevent, and it is one typo in a
 * WHERE clause away at all times.
 */
const MIN_RUNS = 5;

interface Row { id: string; data: Record<string, any> }

/* eslint-disable no-console */
describe.skipIf(!RO)('surface figures · the real readers over real rows (READ-ONLY)', () => {
  it('run detail agrees with the poster about every absolute figure', async () => {
    // Point the shared pool at the READ-ONLY role for the duration. The
    // surfaces below import `pool` transitively; there is no way to hand them
    // a different one, and the role itself is the guarantee — `faff_readonly`
    // cannot write even if a code path tried.
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');

    const who = (await pool.query('SELECT current_user')).rows[0].current_user;
    console.log(`\n[audit] connected as ${who}`);
    expect(who, 'refusing to run as anything but the read-only role').toBe('faff_readonly');

    const rows: Row[] = (await pool.query(
      `SELECT id::text AS id, data FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
        ORDER BY data->>'date' DESC
        LIMIT $2`,
      [USER, LIMIT],
    )).rows;

    const { loadRunDetail } = await import('@/lib/coach/run-state');

    const findings: string[] = [];
    let compared = 0;
    let swept = 0;

    for (const row of rows) {
      const d = row.data ?? {};
      const runId = String(d.id ?? d.activityId ?? row.id);

      // NOT wrapped in a catch that returns null. A loader that throws is a
      // finding, not an absence — a swallowed failure and an honest nothing
      // are the same value, and that is how the drift monitor sat dead for
      // months. See lib/db/read.ts.
      const detail: any = await loadRunDetail(USER, runId);
      if (detail == null) {
        findings.push(`${d.date} · loadRunDetail returned null for a canonical row`);
        continue;
      }
      swept++;

      // THE POSTER'S RESOLUTION, built from the same candidates its route
      // builds them from. Not a transcription of the route's logic — the
      // resolvers themselves, which is what the route calls.
      const twins = (await pool.query(
        `SELECT data FROM runs WHERE data->>'mergedIntoId' = $1`, [row.id],
      )).rows.map((t) => t.data ?? {});

      const posterElev = pickElevationGain([
        { ft: Number(d.elevGainFt) || null, source: d.elevGainSource ?? null, ingest: d.source ?? null },
        ...twins.map((t) => ({ ft: Number(t.elevGainFt) || null, source: t.elevGainSource ?? null, ingest: t.source ?? null })),
      ]);
      const posterSplits = pickSplits(Number(d.distanceMi) || null, [
        { splits: Array.isArray(d.splits) ? d.splits : null, source: 'canonical' },
        ...twins.map((t) => ({ splits: Array.isArray(t.splits) ? t.splits : null, source: t.source ?? null })),
      ]);

      const check = (label: string, poster: number | null, detailV: number | null, tol = 0.5) => {
        if (poster == null || detailV == null) return;
        compared++;
        if (Math.abs(poster - detailV) > tol) {
          findings.push(
            `${d.date} ${d.source} · ${label}: run detail ${detailV}, poster ${poster}`);
        }
      };

      check('elevation gain (ft)', posterElev?.ft ?? null, detail.elev_gain_ft ?? null);
      check('average heart rate', Number(d.avgHr) || null, detail.hr_avg ?? null);
      check('max heart rate', Number(d.maxHr) || null, detail.hr_max ?? null);
      check('cadence', Number(d.avgCadence) || null, detail.cadence_avg ?? null);
      check('temperature (F)', Number(d.tempF) || null, detail.temp_f ?? null);
      check('distance (mi)', Number(d.distanceMi) || null, detail.distance_mi ?? null, 0.005);

      // THE BREAKDOWN. Both surfaces must draw the same miles — 2026-08-24
      // had run detail on three splits covering 3.00 of 4.02 while the
      // poster drew the absorbed twin's five covering 4.11.
      if (posterSplits != null && Array.isArray(detail.splits)) {
        compared++;
        const posterCov = posterSplits.coverageMi;
        const detailCov = (detail.splits as any[]).reduce(
          (s, sp) => s + (Number(sp.distanceMi) || 1), 0);
        // A whole split apart is two different arrays, not two roundings. The
        // trailing-stub arithmetic legitimately drops a fabricated final
        // split from run detail's copy, so the band allows exactly that.
        if (Math.abs(posterCov - detailCov) > 1.05) {
          findings.push(
            `${d.date} ${d.source} · splits: run detail covers ${detailCov.toFixed(2)} mi ` +
            `in ${detail.splits.length}, poster covers ${posterCov.toFixed(2)} mi ` +
            `in ${posterSplits.splits.length}`);
        }
      }

      /* A MODELLED CLIMB MUST CARRY THE MARK. Rule one, on real rows. */
      if (detail.elev_gain_ft != null && detail.elev_gain_measured === true
        && posterElev != null && !posterElev.measured) {
        findings.push(
          `${d.date} · ${detail.elev_gain_ft} ft from \`${posterElev.source}\` presented as measured`);
      }
    }

    console.log(`[audit] swept ${swept} runs · ${compared} figure comparisons · ${findings.length} disagreements`);
    for (const f of findings) console.log(`  ${f}`);

    await pool.end();

    // THE FLOOR. A sweep that read nothing and found nothing is not a pass.
    expect(swept, 'too few runs swept for a clean report to mean anything')
      .toBeGreaterThanOrEqual(MIN_RUNS);
    expect(compared, 'no figure was actually compared — the sweep did not run')
      .toBeGreaterThanOrEqual(MIN_RUNS * 3);

    expect(findings,
      'run detail and the poster print different numbers for the same run',
    ).toEqual([]);
  }, 300_000);
});
