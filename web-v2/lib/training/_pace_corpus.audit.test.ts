/**
 * lib/training/_pace_corpus.audit.test.ts · RENDER IT (Rule 13), not a fixture.
 *
 * Runs the REAL `resolveEasyPaceCorpus` / `resolveThresholdPaceCorpus` against
 * the owner's actual canonical runs over the read-only role. Not part of the
 * CI gate chain (`.audit.` convention, same as `_splits_repair_sql.audit.test.ts`)
 * — it needs `DATABASE_URL_RO` and skips without one.
 *
 * READ-ONLY. Every query the functions under test issue is a SELECT; this
 * file additionally forces the connection itself onto the read-only role
 * rather than trusting that, so a future edit to the resolvers cannot
 * silently start writing through this test. `process.env.DATABASE_URL` is
 * overridden BEFORE `lib/db/pool`'s module-level `new Pool(...)` is ever
 * constructed — which means the app modules under test must be imported
 * DYNAMICALLY, inside the test body, after the override runs. A static
 * top-level `import` would be hoisted ahead of the override (ES module
 * evaluation order), reconnecting this file to whatever `DATABASE_URL` the
 * process already had — the same trap `_splits_repair_sql.audit.test.ts`
 * avoided by not touching the shared pool at all. This file takes the other
 * escape: it exercises the real DB-backed resolvers end to end (the whole
 * point of a Rule 13 render), by making sure the override lands first.
 *
 * Run with:
 *   npx vitest run lib/training/_pace_corpus.audit.test.ts --reporter=verbose
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Anchor "today" to a fixed real date rather than calling runnerToday (which
// would issue its own DB read before we need one) — the conversation's own
// current date. A stale anchor only narrows the lookback window, never
// invalidates the read.
const TODAY = '2026-08-31';

describe.skipIf(!RO)('PACE CORPUS · rendered against the owner\'s real account', () => {
  it('easy-pace corpus', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveEasyPaceCorpus } = await import('@/lib/training/pace-corpus');
    const read = await resolveEasyPaceCorpus(OWNER, TODAY);
    // eslint-disable-next-line no-console
    console.log('EASY PACE CORPUS ·', JSON.stringify(read, null, 2));
    expect(read).toBeDefined();
    if (read.ok) {
      // Sanity: a plausible running-pace ceiling (4-20 min/mi).
      expect(read.ceilingSecPerMi).toBeGreaterThan(240);
      expect(read.ceilingSecPerMi).toBeLessThan(1200);
      expect(read.observations).toBeGreaterThanOrEqual(3);
    } else {
      expect(['no_observations', 'insufficient_corroboration']).toContain(read.reason);
    }
  }, 30_000);

  it('threshold-pace corpus', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveThresholdPaceCorpus } = await import('@/lib/training/pace-corpus');
    const read = await resolveThresholdPaceCorpus(OWNER, TODAY);
    // eslint-disable-next-line no-console
    console.log('THRESHOLD PACE CORPUS ·', JSON.stringify(read, null, 2));
    expect(read).toBeDefined();
    if (read.ok) {
      expect(read.tPaceSecPerMi).toBeGreaterThan(240);
      expect(read.tPaceSecPerMi).toBeLessThan(900);
      expect(read.observations).toBeGreaterThanOrEqual(3);
    } else {
      expect(['no_observations', 'insufficient_corroboration']).toContain(read.reason);
    }
  }, 30_000);

  it('classification recovers evidence the OLD race-shaped read could not see (Rule 18)', async () => {
    process.env.DATABASE_URL = RO;
    const { classifyEasyCandidates, classifyThresholdCandidates } =
      await import('@/lib/training/pace-corpus') as unknown as {
        classifyEasyCandidates: (rows: any[], ctx: any) => any[];
        classifyThresholdCandidates: (rows: any[], ctx: any) => any[];
      };
    const { pool } = await import('@/lib/db/pool');
    const {
      runDaySql, runDistanceMiSql, runFinishSecSql, runAvgHrSql,
      runWorkoutTypeSql, runSplitsSql, runNotMergedSql,
    } = await import('@/lib/runs/run-shape');
    const { excludeDistanceReviewSql } = await import('@/lib/runs/distance-guard');
    const { loadEffectiveMaxHr, lthrFloorIsFresh } = await import('@/lib/training/max-hr');
    const { vdotFromRun } = await import('@/lib/training/vdot');

    const cutoff = new Date(Date.parse(TODAY + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
    const rows = (await pool.query<any>(
      `SELECT sa.id::text AS id,
              ${runDaySql('sa')} AS date,
              ${runDistanceMiSql('sa')} AS distance_mi,
              ${runFinishSecSql('sa')} AS finish_seconds,
              ${runAvgHrSql('sa')} AS avg_hr,
              ${runWorkoutTypeSql('sa')} AS workout_type,
              ${runSplitsSql('sa')} AS splits
         FROM runs sa
        WHERE sa.user_uuid = $1
          AND ${runNotMergedSql('sa')}
          AND ${runDaySql('sa')} >= $2
          AND ${runDaySql('sa')} <= $3
          AND ${runFinishSecSql('sa')} > 60
          AND ${runDistanceMiSql('sa')} > 0
          AND ${runAvgHrSql('sa')} IS NOT NULL
          AND ${excludeDistanceReviewSql('sa')}`,
      [OWNER, cutoff, TODAY],
    )).rows.map((r) => ({
      id: r.id, date: r.date,
      distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      finishSec: r.finish_seconds != null ? Number(r.finish_seconds) : null,
      avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
      workoutTypeRaw: r.workout_type,
      splits: r.splits,
    }));

    const maxHr = await loadEffectiveMaxHr(OWNER, TODAY);
    const lthrRow = (await pool.query<any>(
      `SELECT lthr, lthr_set_at::date::text AS lthr_set_at FROM profile WHERE user_uuid = $1`,
      [OWNER],
    )).rows[0];
    const ctx = {
      maxHrBpm: maxHr.bpm,
      lthrBpm: lthrRow?.lthr != null ? Number(lthrRow.lthr) : null,
      lthrFresh: lthrFloorIsFresh(lthrRow?.lthr_set_at ?? null, TODAY),
    };

    const easyObs = classifyEasyCandidates(rows, ctx);
    const thresholdObs = classifyThresholdCandidates(rows, ctx);

    // How many of the easy-pace observations would the OLD (race-shaped)
    // vdotFromRun have made visible to any fitness read at all?
    let oldVisibleCount = 0;
    for (const row of rows) {
      const v = vdotFromRun({
        finishSeconds: row.finishSec ?? 0,
        distanceMi: row.distanceMi ?? 0,
        workoutType: row.workoutTypeRaw,
        avgHr: row.avgHr,
        maxHr: maxHr.bpm,
      });
      if (v != null) oldVisibleCount++;
    }

    console.log(
      'RULE 18 · classification recovery ·',
      JSON.stringify({
        totalCanonicalRunsInWindow: rows.length,
        easyObservationsRecovered: easyObs.length,
        thresholdObservationsRecovered: thresholdObs.length,
        oldMechanismVisibleCount: oldVisibleCount,
        splitsAwareThresholdSegments: thresholdObs.filter((o) => o.source === 'splits').length,
        lthrBasisContext: ctx,
      }, null, 2),
    );

    // ── Diagnostic: LTHR-precedence vs %HRmax-only, on the SAME rows ────────
    // `profile.lthr` was re-anchored the same day this audit ran (age 0 days,
    // maximally "fresh" by lthrFloorIsFresh), so the strict LTHR-wins
    // precedence in "THE CLASSIFIER" governs every row in this window. This
    // block asks what %HRmax alone would have classified, so a real
    // discrepancy between the two bases is visible rather than silently
    // decided by precedence order.
    const hrMaxOnlyCtx = { ...ctx, lthrFresh: false };
    const easyObsHrMaxOnly = classifyEasyCandidates(rows, hrMaxOnlyCtx);
    const thresholdObsHrMaxOnly = classifyThresholdCandidates(rows, hrMaxOnlyCtx);
    console.log(
      'RULE 22 · LTHR-vs-%HRmax basis comparison ·',
      JSON.stringify({
        easyObservations_lthrBasis: easyObs.length,
        easyObservations_hrMaxBasisOnly: easyObsHrMaxOnly.length,
        thresholdObservations_lthrBasis: thresholdObs.length,
        thresholdObservations_hrMaxBasisOnly: thresholdObsHrMaxOnly.length,
      }, null, 2),
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 30_000);
});
