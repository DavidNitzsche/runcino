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
 * The 2026-08-31 easy run's DATA QUALITY IS NOT THIS FILE'S TO PIN. It was
 * written asserting `splits_unreliable: true`, `droppedCount: 7`, no elapsed
 * clock and `observedExecution: 'EASY'` as facts about production. On
 * 2026-09-01 the row was re-ingested from the watch, arrived carrying its
 * seven splits and a 3300 s elapsed clock, and both assertions went red — on
 * ordinary ingest, with no code change and nothing wrong. A test that pins a
 * live, mutable row's data-quality state fails for a reason that is not a
 * defect, and its header goes on asserting the old state to every future
 * reader (Rule 20's corollary).
 *
 * So the split is now explicit:
 *
 *  · THE DEGRADED-ROW BEHAVIOUR IS A FIXTURE, in `_activity_evidence.test.ts`
 *    ("degraded-row fixture") — splits dropped, no elapsed clock, and the
 *    honest consequences: drift refused, durability `indeterminate`,
 *    continuity `unknown`, empty ledger. That input is stated exactly and
 *    cannot drift, and it runs with no database.
 *
 *  · THIS FILE ASSERTS ONLY WHAT IS INVARIANT ACROSS BOTH STATES, and BRANCHES
 *    on the row's live `splits_unreliable` for everything that is not. The
 *    invariants are the §9-11/§14 conclusions the exercise exists for: no
 *    high-intensity evidence, no threshold evidence, no easy-ceiling evidence,
 *    no anchor move, and every capacity that does report evidence carries
 *    `supporting_evidence_only`. Better data may lift a refusal; it may not
 *    turn a `no_evidence` into an anchor move, and that is what this checks.
 *
 * WHAT THIS FILE CANNOT FAIL ON (Rule 22): it cannot fail on the degraded
 * branch being wrong, because production is not in that state today and the
 * branch does not execute. The fixture suite is what holds that half; if you
 * weaken the fixture, nothing here notices.
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

    // ── the easy run · WHICH data-quality state is a live fact, not a pin ──
    // The clocks are the run itself and do not move with re-ingest.
    expect(easy.timeMoving).toBe('51:35');
    expect(easy.durationSec).toBe(3095);
    // `splits_unreliable` DOES move. Read it, state it, and assert the
    // internally-consistent shape of whichever state the row is in — never
    // one of the two states as a fact (Rule 20's corollary).
    const easySplits = Array.isArray(easy.splits) ? (easy.splits as unknown[]) : null;
    const easyDegraded = easy.splits_unreliable === true || easySplits == null || easySplits.length === 0;
    if (easyDegraded) {
      // Pre-2026-09-01 shape: splits computed at ingest and DROPPED.
      expect(easy.splits_unreliable).toBe(true);
      expect(easySplits == null || easySplits.length === 0).toBe(true);
      // With no splits there is no second clock to reconcile against either.
      expect(Number(easy.elapsedTimeS ?? 0) > Number(easy.durationSec)).toBe(false);
    } else {
      // Re-ingested shape: splits present, each one a usable per-mile read.
      // Read them through `normaliseSplits`, the app's ONE reader for the
      // several spellings `runs.data.splits` carries (`pace: "8:14"` on watch
      // rows, `paceSecPerMi` on others) — a verification that re-spells the
      // shape by hand tests the spelling, not the data (Rule 14).
      expect(easy.splits_unreliable).toBe(false);
      const { normaliseSplits } = await import('./load-activity-evidence');
      const normalised = normaliseSplits(easy.splits);
      expect(normalised.length).toBeGreaterThan(0);
      for (const s of normalised) expect(s.paceSecPerMi).toBeGreaterThan(0);
    }
    // `splits_validation` is a REPORT about reconciliation and survives both
    // states. Assert its shape, not its numbers — the numbers are the row's.
    if (easy.splits_validation != null) {
      const v = easy.splits_validation as Record<string, unknown>;
      for (const k of ['deltaS', 'durationS', 'splitsSumS', 'droppedCount']) {
        expect(Number.isFinite(Number(v[k]))).toBe(true);
      }
    }
    // An elapsed clock, where one exists, is never SHORTER than the moving one.
    if (easy.elapsedTimeS != null) {
      expect(Number(easy.elapsedTimeS)).toBeGreaterThanOrEqual(Number(easy.durationSec));
    }

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
    // The easy run's RPE is a LIVE fact — the runner may file one at any time,
    // and one was filed after this file was first written. What is invariant
    // is the KEY: `post_run_rpe.activity_id` carries the `runs` row id, never
    // the source `data.activityId`, which is the Rule 14 point this block
    // exists to make. Assert the key, state the value.
    expect(rpeKeys.has(String(easy.activityId))).toBe(false);
    const easyRpe = rpe.rows.find((r) => r.activity_id === EASY_RUN_ID)?.rpe ?? null;
    if (easyRpe != null) {
      expect(easyRpe).toBeGreaterThanOrEqual(1);
      expect(easyRpe).toBeLessThanOrEqual(10);
    }

    const lthr = await pool.query<{ lthr: number | string | null }>(
      `SELECT lthr FROM profile WHERE user_uuid = $1::uuid`, [OWNER],
    );
    expect(Number(lthr.rows[0]?.lthr)).toBe(168);

    console.log(
      `[audit] easy run ${EASY_RUN_ID}: ${easyDegraded ? 'DEGRADED (splits dropped at ingest)' : `${easySplits!.length} splits present`}` +
      ` · elapsed clock ${easy.elapsedTimeS ?? 'ABSENT'} · RPE ${easyRpe ?? 'none under any key'}\n` +
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

  it('classifies the 2026-08-31 easy run from production — invariants hold in EITHER data-quality state', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { classifyStoredActivity } = await import('./load-activity-evidence');

    // Read the row's LIVE data-quality state first. The branch below is on a
    // fact, not on an expectation — see the file header.
    const rowRes = await pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM runs WHERE user_uuid = $1::uuid AND id = $2::bigint`,
      [OWNER, EASY_RUN_ID],
    );
    const rowData = rowRes.rows[0]?.data ?? {};
    const rowSplits = Array.isArray(rowData.splits) ? (rowData.splits as unknown[]) : null;
    const degraded = rowData.splits_unreliable === true || rowSplits == null || rowSplits.length === 0;

    const r = await classifyStoredActivity(OWNER, EASY_RUN_ID);
    expect(r).toBeTruthy();
    if (!r) return;

    console.log(`[audit · 2026-08-31 easy run, AS STORED · ${degraded ? 'DEGRADED' : 'SPLITS PRESENT'}]\n` + JSON.stringify({
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

    // ── INVARIANT in either state · the §9-11 / §14 conclusions ───────────
    // This is what the exercise exists to prove, and none of it may move on a
    // re-ingest: an ordinary easy run demonstrates no speed, no threshold and
    // no new easy ceiling, and never moves an anchor. Better data may lift a
    // refusal; it may not manufacture evidence.
    expect(r.eligibility.admissible).toBe(true);
    expect(r.capacities.high_intensity.kind).toBe('no_evidence');
    expect(r.capacities.threshold.kind).toBe('no_evidence');
    expect(r.capacities.easy_ceiling.kind).toBe('no_evidence');
    expect(r.anchorMoveCandidate).toBe(false);
    for (const c of Object.values(r.capacities)) {
      if (c.kind === 'evidence') expect(c.anchorEffect).toBe('supporting_evidence_only');
    }
    for (const l of r.ledger) expect(l.anchorEffect).toBe('supporting_evidence_only');
    // Still an easy run under any read. The label REFINES with splits (a
    // segment read can say `EASY_TO_AEROBIC_STEADY` where the whole-run mean
    // says `EASY`); it does not change category.
    expect(['EASY', 'EASY_TO_AEROBIC_STEADY']).toContain(r.observedExecution);
    // §12 · still valuable training.
    expect(r.trainingLoad.stimulus).toBe('aerobic_development');
    expect(r.trainingLoad.aerobicMinutes).toBeCloseTo(51.6, 1);
    // §18 · dynamics stored, silent.
    expect(r.runningDynamics.groundContactMs).toBe(249);
    expect(r.runningDynamics.surfaced).toBe(false);
    // §5 · the environmental read works from the row as stored.
    expect(r.environment.load).toBe('moderate');
    expect(r.environment.hrConfoundWeight).toBeGreaterThan(0);

    // ── STATE-DEPENDENT · whichever state the row is in, assert it honestly ─
    if (degraded) {
      // No splits → no HR curve → the drift read REFUSES rather than reporting
      // "no drift", and durability is INDETERMINATE. The same behaviour is
      // pinned input-exactly by the degraded-row fixture in the unit suite;
      // this branch only proves production still gets it when it applies.
      expect(r.internalCost.ok).toBe(false);
      if (!r.internalCost.ok) expect(r.internalCost.reason).toBe('no_hr_curve');
      expect(r.capacities.durability.kind).toBe('indeterminate');
      expect(r.capacities.durability.reasons).toContain('NO_HR_CURVE_TO_READ_INTERNAL_COST');
      expect(r.eligibility.signalReasons).toContain('SPLITS_DROPPED_AT_INGEST');
      expect(r.eligibility.continuity.grade).toBe('unknown');
      expect(r.eligibility.continuity.reasons).toContain('SPLITS_DROPPED_SO_COVERAGE_UNKNOWN');
      expect(r.ledger).toHaveLength(0);
    } else {
      // Splits present → the refusals LIFT, and every lift must be justified
      // by the data rather than assumed: coverage is read per split, the drift
      // read either succeeds or names why it did not, and durability may only
      // reach `evidence` as SUPPORTING evidence (asserted invariantly above).
      expect(r.eligibility.signalReasons).not.toContain('SPLITS_DROPPED_AT_INGEST');
      expect(r.eligibility.continuity.grain).toBe('per_split');
      expect(r.eligibility.continuity.grade).not.toBe('unknown');
      if (!r.internalCost.ok) expect(r.internalCost.reason).toBeTruthy();
      expect(['evidence', 'indeterminate']).toContain(r.capacities.durability.kind);
    }
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
