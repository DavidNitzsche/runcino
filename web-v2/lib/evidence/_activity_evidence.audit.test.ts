/**
 * lib/evidence/_activity_evidence.audit.test.ts · RENDER IT (Rule 13).
 *
 * Runs the REAL Evidence Engine against the two REAL production rows the two
 * reference cases were written from, over the read-only role, and prints what
 * came out. Not part of the CI gate chain (`.audit.` convention, same as
 * `_capacity_resolver.audit.test.ts`) — it needs `DATABASE_URL_RO` and skips
 * without one, so CI never depends on a database.
 *
 * READ-ONLY, and enforced rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module under test must
 * be imported DYNAMICALLY inside the test body. A static top-level `import`
 * would be hoisted ahead of the override and reconnect this file to whatever
 * `DATABASE_URL` the process already had.
 *
 * ── WHAT THIS FILE EXISTS TO PROVE, AND THE ONE THING IT PROVES NEGATIVELY ──
 *
 * The 2026-08-30 long run is the honest case: its thirteen per-mile splits with
 * heart rate ARE in the database, so the classifier reproduces the
 * structured-long-run reference case end to end off production data with
 * nothing substituted.
 *
 * The 2026-08-31 easy run is NOT. Its row carries
 * `splits_unreliable: true` and `splits_validation: {deltaS: -110, durationS:
 * 3095, splitsSumS: 2985, droppedCount: 7}` — seven splits were computed at
 * ingest and DROPPED — and it stores no elapsed clock at all. So the two
 * signals the easy-run reference case's §4 grades (a heart-rate curve, and the
 * 55:00-vs-51:35 continuity gap) do not exist in production for that run, and
 * this file asserts the HONESTLY DEGRADED result rather than a fabricated
 * match: durability `indeterminate`, drift refused, continuity unknown — and
 * still no high-intensity evidence, no threshold evidence, no anchor move and
 * no adaptation trigger, which are the §9-11/§14 conclusions that ARE reachable
 * from whole-activity fields.
 *
 * That negative assertion is the point. A gate that reported a match here would
 * be reporting a match it could not have earned.
 *
 * Run with:
 *   npx vitest run lib/evidence/_activity_evidence.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const EASY_RUN_ID = '-41598809443969';        // 2026-08-31 · apple_watch · 6.18 mi
const LONG_RUN_ID = '-245190372869167';       // 2026-08-30 · watch · 13.49 mi

const d = RO ? describe : describe.skip;

d('Evidence Engine · real production rows', () => {
  it('reads the two rows and states exactly what each one carries', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const res = await pool.query<{ id: string; data: Record<string, unknown> }>(
      `SELECT id::text, data FROM runs WHERE user_uuid = $1::uuid AND id = ANY($2::bigint[])`,
      [OWNER, [EASY_RUN_ID, LONG_RUN_ID]],
    );
    const byId = new Map(res.rows.map((r) => [r.id, r.data]));
    const easy = byId.get(EASY_RUN_ID)!;
    const longRun = byId.get(LONG_RUN_ID)!;
    expect(easy).toBeTruthy();
    expect(longRun).toBeTruthy();

    // ── the easy run's two gaps, asserted as facts about production ────────
    expect(Array.isArray(easy.splits)).toBe(false);
    expect(easy.splits_unreliable).toBe(true);
    expect(easy.splits_validation).toMatchObject({
      deltaS: -110, durationS: 3095, splitsSumS: 2985, droppedCount: 7,
    });
    // No elapsed clock distinct from the moving clock — so the reference
    // case's 55:00-vs-51:35 continuity finding has no source here.
    expect(easy.elapsedTimeS ?? null).toBeNull();
    expect(easy.timeMoving).toBe('51:35');
    expect(easy.durationSec).toBe(3095);

    // ── the long run's splits ARE there, and match the unit fixture ────────
    const splits = longRun.splits as Array<{ hr: number; paceSecPerMi: number }>;
    expect(Array.isArray(splits)).toBe(true);
    expect(splits).toHaveLength(13);
    expect(longRun.splits_unreliable).toBe(false);
    // The exact array the unit suite transcribes. If production drifts, this
    // fails and the fixture is corrected rather than silently diverging.
    expect(splits.map((s) => [s.paceSecPerMi, s.hr])).toEqual([
      [505, 145], [490, 142], [470, 147], [412, 166], [442, 166], [518, 149],
      [436, 166], [453, 164], [474, 166], [447, 168], [510, 168], [501, 161], [505, 163],
    ]);

    // ── subjective data, checked rather than assumed absent ───────────────
    // Queried RAW, on every key `post_run_rpe.activity_id` is written with,
    // rather than through the loader's own filter — a verification query that
    // reuses the reader's key reproduces the reader's bug instead of revealing
    // it (Rule 14), and that is exactly what happened on the first run of this
    // file: the loader searched `data.activityId` and found nothing, which
    // looked like "the owner files no RPEs" rather than "the query is wrong".
    const rpe = await pool.query<{ activity_id: string; rpe: number | null }>(
      `SELECT activity_id, rpe FROM post_run_rpe
        WHERE user_uuid = $1::uuid AND activity_id = ANY($2::text[])`,
      [OWNER, [
        EASY_RUN_ID, LONG_RUN_ID,
        String(easy.id), String(longRun.id),
        String(easy.activityId), String(longRun.activityId),
      ]],
    );
    const rpeKeys = new Set(rpe.rows.map((r) => r.activity_id));
    // The long run HAS an RPE, and it is keyed on the ROW id.
    expect(rpeKeys.has(LONG_RUN_ID)).toBe(true);
    expect(rpe.rows.find((r) => r.activity_id === LONG_RUN_ID)?.rpe).toBe(7);
    // The easy run has NONE under any key — and the Apple effort rating the
    // reference case cites (4/Moderate) has no storage anywhere in this app.
    expect(rpeKeys.has(EASY_RUN_ID)).toBe(false);
    expect(rpeKeys.has(String(easy.activityId))).toBe(false);

    const lthr = await pool.query<{ lthr: number | string | null }>(
      `SELECT lthr FROM profile WHERE user_uuid = $1::uuid`, [OWNER],
    );
    expect(Number(lthr.rows[0]?.lthr)).toBe(168);

    console.log(
      `[audit] easy run ${EASY_RUN_ID}: splits ${Array.isArray(easy.splits) ? 'present' : 'ABSENT (dropped at ingest)'}` +
      ` · elapsed clock ${easy.elapsedTimeS ?? 'ABSENT'} · RPE none under any key\n` +
      `[audit] long run ${LONG_RUN_ID}: ${splits.length} splits with HR · RPE ${rpe.rows.find((r) => r.activity_id === LONG_RUN_ID)?.rpe}`,
    );
  }, 30_000);

  it('classifies the 2026-08-30 structured long run from production data', async () => {
    process.env.DATABASE_URL = RO;
    const { classifyStoredActivity } = await import('./load-activity-evidence');
    // The fixture's own hypothetical belief (~7:15/mi) so the Part 3 signal
    // has something to compare against. The REAL belief is resolved in the
    // next test.
    const r = await classifyStoredActivity(OWNER, LONG_RUN_ID, {
      currentBelief: { thresholdPaceSecPerMi: 435, thresholdConfidence: 0.6, asOf: '2026-08-29' },
    });
    expect(r).toBeTruthy();
    if (!r) return;

    console.log('[audit · 2026-08-30 long run]\n' + JSON.stringify({
      eligible: r.eligibility.admissible,
      signals: r.eligibility.signals,
      continuity: { grade: r.eligibility.continuity.grade, unaccountedSec: r.eligibility.continuity.unaccountedSec },
      environment: { load: r.environment.load, slowdownPct: r.environment.slowdownPct },
      plannedIntent: r.plannedIntent,
      observedExecution: r.observedExecution,
      structured: r.structured,
      easyPaceBaselineSecPerMi: r.easyPaceBaselineSecPerMi,
      segments: r.segments.map((s) => ({
        miles: s.splitIndices, cls: s.classification, pace: s.meanPaceSecPerMi,
        hr: s.meanHrBpm, atMin: s.accumulatedMinutesBefore, underLoad: s.underAccumulatedLoad,
        conf: s.confidence,
      })),
      qualityUnderLoad: r.qualityUnderLoad,
      capacities: r.capacities,
      beliefTension: r.beliefTension,
      ledger: r.ledger.map((l) => ({ kind: l.kind, reliability: l.reliability, anchorEffect: l.anchorEffect })),
      anchorMoveCandidate: r.anchorMoveCandidate,
      trainingLoad: r.trainingLoad,
    }, null, 1));

    // ── the structured-long-run reference case, off production ────────────
    expect(r.structured).toBe(true);
    expect(r.segments.map((s) => s.classification)).toEqual([
      'easy_aerobic', 'threshold_like', 'recovery', 'threshold_like', 'steady_aerobic',
    ]);
    expect(r.segments[3].underAccumulatedLoad).toBe(true);
    // Threshold: positive corroborating, never anchor-setting.
    expect(r.capacities.threshold.kind).toBe('evidence');
    if (r.capacities.threshold.kind === 'evidence') {
      expect(r.capacities.threshold.anchorEffect).toBe('supporting_evidence_only');
    }
    // High-intensity: little/none — the blocks are threshold-adjacent.
    expect(r.capacities.high_intensity.kind).toBe('no_evidence');
    // Durability: meaningful positive evidence.
    expect(r.capacities.durability.kind).toBe('evidence');
    if (r.capacities.durability.kind === 'evidence') {
      expect(r.capacities.durability.strength).toBe('moderate');
      expect(r.capacities.durability.anchorEffect).toBe('supporting_evidence_only');
    }
    // Quality under load, and the residual-HR nuance.
    expect(r.qualityUnderLoad.ok).toBe(true);
    if (r.qualityUnderLoad.ok) {
      expect(r.qualityUnderLoad.qualityBlocks).toBe(2);
      expect(r.qualityUnderLoad.lateRunPacingCollapse).toBe(false);
      expect(r.qualityUnderLoad.residualCardiovascularLoad).toBe(true);
    }
    // Part 3 · challenges the belief, does not update it.
    expect(r.beliefTension.ok).toBe(true);
    if (r.beliefTension.ok) {
      expect(r.beliefTension.code).toBe('CONTRADICTS_CURRENT_ESTIMATE');
      expect(r.beliefTension.anchorEffect).toBe('no_change_flag_for_reexamination');
    }
    // No fitness adjustment by itself.
    expect(r.anchorMoveCandidate).toBe(false);
    // The plan reads `long`, and the loader mapped it.
    expect(r.plannedIntent === 'LONG' || r.plannedIntent === null).toBe(true);
  }, 30_000);

  it('classifies the 2026-08-31 easy run from production — and REFUSES what the row cannot support', async () => {
    process.env.DATABASE_URL = RO;
    const { classifyStoredActivity } = await import('./load-activity-evidence');
    const r = await classifyStoredActivity(OWNER, EASY_RUN_ID);
    expect(r).toBeTruthy();
    if (!r) return;

    console.log('[audit · 2026-08-31 easy run, AS STORED]\n' + JSON.stringify({
      eligible: r.eligibility.admissible,
      signals: r.eligibility.signals,
      signalReasons: r.eligibility.signalReasons,
      continuity: r.eligibility.continuity,
      environment: r.environment,
      plannedIntent: r.plannedIntent,
      observedExecution: r.observedExecution,
      structured: r.structured,
      internalCost: r.internalCost,
      capacities: r.capacities,
      ledger: r.ledger.map((l) => l.kind),
      anchorMoveCandidate: r.anchorMoveCandidate,
      trainingLoad: r.trainingLoad,
      runningDynamics: r.runningDynamics,
    }, null, 1));

    // ── what the row CAN support · the §9-11 / §14 conclusions ────────────
    expect(r.eligibility.admissible).toBe(true);
    expect(r.observedExecution).toBe('EASY');   // Z2 off the whole-run mean
    expect(r.capacities.high_intensity.kind).toBe('no_evidence');
    expect(r.capacities.threshold.kind).toBe('no_evidence');
    expect(r.capacities.easy_ceiling.kind).toBe('no_evidence');
    expect(r.anchorMoveCandidate).toBe(false);
    for (const c of Object.values(r.capacities)) {
      if (c.kind === 'evidence') expect(c.anchorEffect).toBe('supporting_evidence_only');
    }
    // §12 · still valuable training.
    expect(r.trainingLoad.stimulus).toBe('aerobic_development');
    expect(r.trainingLoad.aerobicMinutes).toBeCloseTo(51.6, 1);
    // §18 · dynamics stored, silent.
    expect(r.runningDynamics.groundContactMs).toBe(249);
    expect(r.runningDynamics.surfaced).toBe(false);
    // §5 · the environmental read works from the row as stored.
    expect(r.environment.load).toBe('moderate');
    expect(r.environment.hrConfoundWeight).toBeGreaterThan(0);

    // ── what the row CANNOT support · asserted as refusals, not matches ───
    // No splits → no HR curve → the drift read refuses rather than reporting
    // "no drift", and durability is INDETERMINATE rather than the reference
    // case's low-to-moderate. This is the honest answer for this row today.
    expect(r.internalCost.ok).toBe(false);
    if (!r.internalCost.ok) expect(r.internalCost.reason).toBe('no_hr_curve');
    expect(r.capacities.durability.kind).toBe('indeterminate');
    expect(r.capacities.durability.reasons).toContain('NO_HR_CURVE_TO_READ_INTERNAL_COST');
    expect(r.eligibility.signalReasons).toContain('SPLITS_DROPPED_AT_INGEST');
    // No elapsed clock and no splits → continuity cannot be judged, and says
    // so rather than assuming the run was continuous (Rule 11).
    expect(r.eligibility.continuity.grade).toBe('unknown');
    expect(r.eligibility.continuity.reasons).toContain('SPLITS_DROPPED_SO_COVERAGE_UNKNOWN');
    // Nothing enters the durability ledger off a refusal.
    expect(r.ledger).toHaveLength(0);
  }, 30_000);

  it('renders the belief tension against the REAL resolved threshold capacity', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
    const { classifyStoredActivity } = await import('./load-activity-evidence');

    // The Runner Model RESOLVES the belief; the Evidence Engine is only handed
    // one. A test may call both — the ownership boundary is about which module
    // reads which, not about what a render may assemble.
    const capacity = await resolveThresholdCapacity(OWNER);
    const believed = Number.isFinite(capacity.paceSecPerMi) ? capacity.paceSecPerMi : null;

    const r = await classifyStoredActivity(OWNER, LONG_RUN_ID, {
      currentBelief: believed != null
        ? { thresholdPaceSecPerMi: believed, thresholdConfidence: capacity.confidence }
        : null,
    });
    console.log(
      `[audit · real belief] resolveThresholdCapacity → ${believed ?? 'no pace'} s/mi ` +
      `(confidence ${capacity.confidence}, sourceMode ${capacity.sourceMode})\n` +
      `[audit · real belief] tension → ${JSON.stringify(r?.beliefTension)}`,
    );
    // Whatever the live belief is, the signal must be COMPUTED (not stubbed)
    // and must never carry an anchor move.
    expect(r?.beliefTension).toBeTruthy();
    if (r?.beliefTension.ok) {
      expect(r.beliefTension.anchorEffect).toBe('no_change_flag_for_reexamination');
      expect(r.beliefTension.reexaminationWeight).toBeGreaterThan(0);
    }
    expect(r?.anchorMoveCandidate).toBe(false);
  }, 60_000);
});
