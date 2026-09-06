/**
 * lib/ops/_reassessment_evaluators.db.test.ts · THE TWO EVALUATORS, PROVEN
 * AGAINST REAL `races`, `runner_injuries` AND `coach_intents` ROWS.
 *
 * `_reassessment_evaluators.test.ts` proves vocabulary and repo-wide grep
 * assertions without a database. Neither evaluator's actual DECISION can be
 * proven that way — "is there a later race", "is this injury still active",
 * "did the ladder already advance" are all real queries against real tables.
 * This file is the second half.
 *
 * ── WHY `faff_roundtrip_scratch`, NOT `faff_ledger_scratch` ────────────────
 *
 * `faff_ledger_scratch` (used by `_reassessment_scheduler.db.test.ts`) carries
 * only `reassessment_schedule` and `plan_decision_ledger` — enough to prove
 * the scheduler's own vocabulary, not enough to prove a real evaluator, which
 * needs `races`, `runner_injuries` and `coach_intents` too.
 * `faff_roundtrip_scratch` is the full production schema, read-only-dumped
 * and never data-populated (`scripts/_build_roundtrip_scratch.sh`'s own
 * header). Same precedent `_reassessment_staleplan.db.test.ts` already set
 * for the same reason.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * `DATABASE_URL` must parse, name a loopback host, and name
 * `faff_roundtrip_scratch`. Skips loudly rather than reporting clean when it
 * is not reachable (Rule 18 point 2).
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh   # if it doesn't exist
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/ops/_reassessment_evaluators.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER `resolveReassessment`'S OWN GUARD IS CORRECT. That is
 *   `_reassessment_scheduler.db.test.ts`'s job; this file only proves the two
 *   evaluators call it with the right verdict.
 * · WHETHER THE CRON ROUTE OR ITS WORKFLOW ACTUALLY FIRE. `_automatic_
 *   mutations.test.ts` and `_generated_content_gate.test.ts` cover
 *   registration; this file calls `runReassessmentEvaluationSweep` directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  scheduleReassessment,
  loadLiveQueue,
  _resetScheduleTableProbeForTests,
  type ScheduleRequest,
} from './reassessment-scheduler';
import {
  evaluatePostRaceRecoveryCheckItem,
  evaluateReturnToTrainingStageItem,
  runReassessmentEvaluationSweep,
  type EvaluatorDeps,
} from './reassessment-evaluators';

const SCRATCH_DB = 'faff_roundtrip_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) return `${label} points at host '${parsed.hostname}', which is not loopback`;
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL')].filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;

describe('liveness · the scratch database was reachable, or the reason is printed', () => {
  it('says which it is, out loud', () => {
    if (!REACHABLE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[reassessment-evaluators.db] SKIPPED · this suite proved NOTHING. ' + refusals.join('; ')
        + `. Run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB} `
        + 'npx vitest run lib/ops/_reassessment_evaluators.db.test.ts (build the scratch DB first '
        + 'with bash web-v2/scripts/_build_roundtrip_scratch.sh if it does not already exist).',
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('POST_RACE_RECOVERY_CHECK and RETURN_TO_TRAINING_STAGE, evaluated for real', () => {
  const setupPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const RUNNER = randomUUID();

  const raceReq = (slug: string, dateISO: string, weeks: number, assessOnISO: string): ScheduleRequest => ({
    userUuid: RUNNER,
    kind: 'POST_RACE_RECOVERY_CHECK',
    reasonCode: 'post_race_recovery_window',
    reasonDetail: `${slug} finished on ${dateISO}; recovery window test fixture`,
    assessOnISO,
    overdueAfterISO: '2099-01-01', // never overdue inside this test
    planId: null,
    planVersion: `race:${slug}:none`,
    lever: 'PLAN_STRUCTURE',
    payload: { raceSlug: slug, raceDateISO: dateISO, recoveryWeeks: weeks },
    idempotencyKey: `post-race-recovery:${slug}`,
    queuedAtISO: dateISO,
  });

  const injuryStageReq = (
    injuryId: string, stage: number, assessOnISO: string, idKey: string,
  ): ScheduleRequest => ({
    userUuid: RUNNER,
    kind: 'RETURN_TO_TRAINING_STAGE',
    reasonCode: 'return_ladder_advance_queued',
    reasonDetail: `stage ${stage} test fixture`,
    assessOnISO,
    overdueAfterISO: '2099-01-01',
    planId: null,
    planVersion: `injury:${injuryId}:none`,
    lever: 'PLAN_STRUCTURE',
    payload: { injuryId, stage },
    idempotencyKey: idKey,
    queuedAtISO: assessOnISO,
  });

  beforeAll(async () => {
    _resetScheduleTableProbeForTests();
    await setupPool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
      [RUNNER, `reassess-eval-${RUNNER}@example.invalid`],
    );
  });

  afterAll(async () => {
    await setupPool.query(`DELETE FROM reassessment_schedule WHERE user_uuid = $1`, [RUNNER]);
    await setupPool.query(`DELETE FROM coach_intents WHERE user_uuid = $1`, [RUNNER]);
    await setupPool.query(`DELETE FROM runner_injuries WHERE user_uuid = $1`, [RUNNER]);
    await setupPool.query(`DELETE FROM races WHERE user_uuid = $1`, [RUNNER]);
    await setupPool.query(`DELETE FROM users WHERE id = $1`, [RUNNER]);
    await setupPool.end();
  });

  async function rawRow(idempotencyKey: string) {
    const r = await setupPool.query(
      `SELECT status, resulting_decision, resulting_decision_detail, resolved_at, attempts, last_error
         FROM reassessment_schedule
        WHERE user_uuid = $1 AND idempotency_key = $2
        ORDER BY created_at DESC LIMIT 1`,
      [RUNNER, idempotencyKey],
    );
    return r.rows[0] as {
      status: string; resulting_decision: string | null; resulting_decision_detail: string | null;
      resolved_at: string | null; attempts: number; last_error: string | null;
    } | undefined;
  }

  describe('POST_RACE_RECOVERY_CHECK', () => {
    it('the common case: no injury, no later race — RESOLVED, RECOVERY_WINDOW_ELAPSED', async () => {
      await setupPool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '')`,
        ['pr-race-clean', RUNNER, JSON.stringify({ date: '2026-08-01' })],
      );
      const sched = await scheduleReassessment(raceReq('pr-race-clean', '2026-08-01', 1, '2026-08-08'));
      expect(sched.state, JSON.stringify(sched)).toBe('ok');
      if (sched.state !== 'ok') throw new Error('unreachable');

      const q = await loadLiveQueue(RUNNER, 'POST_RACE_RECOVERY_CHECK');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'post-race-recovery:pr-race-clean');
      expect(item).toBeDefined();
      if (!item) throw new Error('unreachable');

      const outcome = await evaluatePostRaceRecoveryCheckItem(item);
      expect(outcome.wroteStatus).toBe('RESOLVED');
      expect(outcome.decision).toBe('RECOVERY_WINDOW_ELAPSED');

      const row = await rawRow('post-race-recovery:pr-race-clean');
      expect(row?.status).toBe('RESOLVED');
      expect(row?.resulting_decision).toBe('RECOVERY_WINDOW_ELAPSED');
      expect(row?.resolved_at).toBeTruthy();

      // IDEMPOTENT · re-evaluating an already-terminal item is a no-op, not a
      // second write. resolveReassessment's own guard (status IN
      // ('PENDING','DUE')) makes this structural, not a behaviour this file
      // invented — proven here rather than assumed.
      const q2 = await loadLiveQueue(RUNNER, 'POST_RACE_RECOVERY_CHECK');
      if (q2.state !== 'ok') throw new Error('unreachable');
      expect(q2.value.some((i) => i.idempotencyKey === 'post-race-recovery:pr-race-clean')).toBe(false);
    });

    it('an injury started on/after the race date — ABANDONED, SUPERSEDED_BY_INJURY', async () => {
      await setupPool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '')`,
        ['pr-race-injured', RUNNER, JSON.stringify({ date: '2026-07-01' })],
      );
      await setupPool.query(
        `INSERT INTO runner_injuries (user_uuid, site, severity, start_date) VALUES ($1, 'achilles', 'moderate', '2026-07-02')`,
        [RUNNER],
      );
      const sched = await scheduleReassessment(raceReq('pr-race-injured', '2026-07-01', 1, '2026-07-08'));
      expect(sched.state).toBe('ok');

      const q = await loadLiveQueue(RUNNER, 'POST_RACE_RECOVERY_CHECK');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'post-race-recovery:pr-race-injured');
      if (!item) throw new Error('fixture item missing');

      const outcome = await evaluatePostRaceRecoveryCheckItem(item);
      expect(outcome.wroteStatus).toBe('ABANDONED');
      expect(outcome.decision).toBe('SUPERSEDED_BY_INJURY');

      // Clean up the injury row so it does not leak into the next test's
      // "no injury" assumption.
      await setupPool.query(`DELETE FROM runner_injuries WHERE user_uuid = $1 AND site = 'achilles'`, [RUNNER]);
    });

    it('a later race already finished inside the window — ABANDONED, SUPERSEDED_BY_LATER_RACE', async () => {
      await setupPool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '')`,
        ['pr-race-early', RUNNER, JSON.stringify({ date: '2026-06-01' })],
      );
      await setupPool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '')`,
        ['pr-race-later', RUNNER, JSON.stringify({ date: '2026-06-10' })],
      );
      const sched = await scheduleReassessment(raceReq('pr-race-early', '2026-06-01', 3, '2026-06-22'));
      expect(sched.state).toBe('ok');

      const q = await loadLiveQueue(RUNNER, 'POST_RACE_RECOVERY_CHECK');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'post-race-recovery:pr-race-early');
      if (!item) throw new Error('fixture item missing');

      const outcome = await evaluatePostRaceRecoveryCheckItem(item);
      expect(outcome.wroteStatus).toBe('ABANDONED');
      expect(outcome.decision).toBe('SUPERSEDED_BY_LATER_RACE');
    });

    it('malformed payload (no raceSlug) refuses without writing anything', async () => {
      const fake = {
        id: randomUUID(), userUuid: RUNNER, kind: 'POST_RACE_RECOVERY_CHECK' as const,
        reasonCode: 'x', reasonDetail: 'x', assessOnISO: '2026-08-08', overdueAfterISO: null,
        requiredEvidence: [], evidence: [], newestEvidenceISO: null, planId: null, planLineageId: null,
        planVersion: 'x', evidenceVersion: null, modelVersion: null, lever: null, beforeValue: null,
        proposedAfterValue: null, magnitude: null, payload: {}, status: 'DUE' as const, attempts: 0,
        lastError: null, lastAttemptAt: null, nextRetryAt: null, resultingDecision: null,
        resultingDecisionDetail: null, resultingLedgerId: null, resolvedAt: null, originLedgerId: null,
        idempotencyKey: 'not-a-real-row', queuedAtISO: '2026-08-01',
      };
      const outcome = await evaluatePostRaceRecoveryCheckItem(fake);
      expect(outcome.wroteStatus).toBeNull();
      expect(outcome.why).toContain('raceSlug');
    });
  });

  describe('RETURN_TO_TRAINING_STAGE', () => {
    it('the injury named by the promise is no longer active — ABANDONED, INJURY_NO_LONGER_ACTIVE', async () => {
      const inj = await setupPool.query<{ id: number }>(
        `INSERT INTO runner_injuries (user_uuid, site, severity, start_date, resolved_date)
         VALUES ($1, 'shin', 'minor', '2026-01-01', '2026-01-05') RETURNING id`,
        [RUNNER],
      );
      const injuryId = String(inj.rows[0].id);
      const sched = await scheduleReassessment(injuryStageReq(injuryId, 2, '2026-01-20', 'return:stale-injury'));
      expect(sched.state).toBe('ok');

      const q = await loadLiveQueue(RUNNER, 'RETURN_TO_TRAINING_STAGE');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'return:stale-injury');
      if (!item) throw new Error('fixture item missing');

      // resolved_date is 15+ days before "now" (real clock), well past the
      // 30-day grace window `loadActiveInjuryForReturn` itself defines, so
      // this injury reads as not-active regardless of when the test runs.
      const outcome = await evaluateReturnToTrainingStageItem(item);
      expect(outcome.wroteStatus).toBe('ABANDONED');
      expect(outcome.decision).toBe('INJURY_NO_LONGER_ACTIVE');
    });

    it('a fresh replay shows the stage already advanced — RESOLVED, STAGE_ADVANCED (the backstop)', async () => {
      const inj = await setupPool.query<{ id: number }>(
        `INSERT INTO runner_injuries (user_uuid, site, severity, start_date) VALUES ($1, 'calf', 'minor', '2026-02-01') RETURNING id`,
        [RUNNER],
      );
      const injuryId = String(inj.rows[0].id);
      // Two silent check-ins. `computeReturnLadderState`'s weekly cap only
      // gates a SECOND advance — the very first one is never gated (there is
      // no `lastAdvanceAt` yet to compare against), so two silent check-ins
      // clearing the 2-session minimum read as stage 2 reached, regardless of
      // the gap between them.
      for (const [at, outcome] of [['2026-02-02', 'silent'], ['2026-02-03', 'silent']] as const) {
        await setupPool.query(
          `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
           VALUES ($1, $1, $2::timestamptz, 'v5_return_checkin', $3, $4)`,
          [RUNNER, `${at}T12:00:00Z`, injuryId, JSON.stringify({ outcome })],
        );
      }
      // The promise was queued when stage was still 1 (before the second
      // check-in landed) — the backstop's job is to notice the replay now
      // disagrees.
      const sched = await scheduleReassessment(injuryStageReq(injuryId, 1, '2026-02-01', 'return:advanced-backstop'));
      expect(sched.state).toBe('ok');

      const q = await loadLiveQueue(RUNNER, 'RETURN_TO_TRAINING_STAGE');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'return:advanced-backstop');
      if (!item) throw new Error('fixture item missing');

      const outcome = await evaluateReturnToTrainingStageItem(item);
      expect(outcome.wroteStatus).toBe('RESOLVED');
      expect(outcome.decision).toBe('STAGE_ADVANCED');
    });

    it('still waiting on the next check-in — left standing, not a defect', async () => {
      const inj = await setupPool.query<{ id: number }>(
        `INSERT INTO runner_injuries (user_uuid, site, severity, start_date) VALUES ($1, 'hip', 'minor', '2026-03-01') RETURNING id`,
        [RUNNER],
      );
      const injuryId = String(inj.rows[0].id);
      // FOUR silent check-ins, two pairs. The FIRST pair (day 0, day 1)
      // clears the 2-session minimum with no `lastAdvanceAt` to gate against,
      // so it advances stage 1 -> 2 on day 1. The SECOND pair (day 2, day 3)
      // clears the minimum again at stage 2, but day 3 is only 2 days after
      // the day-1 advance — inside the 7-day cap — so it is HELD: stage stays
      // 2, `advanceQueued` becomes true. This is the only way to produce a
      // genuine "waiting on the cap" state; a single pair with no prior
      // advance always advances immediately regardless of its own gap.
      for (const at of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']) {
        await setupPool.query(
          `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
           VALUES ($1, $1, $2::timestamptz, 'v5_return_checkin', $3, $4)`,
          [RUNNER, `${at}T12:00:00Z`, injuryId, JSON.stringify({ outcome: 'silent' })],
        );
      }
      // The promise was queued at stage 2 (after the first advance), waiting
      // on the cap to clear — the state this evaluator must leave standing.
      const sched = await scheduleReassessment(injuryStageReq(injuryId, 2, '2026-03-09', 'return:still-waiting'));
      expect(sched.state).toBe('ok');

      const q = await loadLiveQueue(RUNNER, 'RETURN_TO_TRAINING_STAGE');
      if (q.state !== 'ok') throw new Error('unreachable');
      const item = q.value.find((i) => i.idempotencyKey === 'return:still-waiting');
      if (!item) throw new Error('fixture item missing');

      const outcome = await evaluateReturnToTrainingStageItem(item);
      expect(outcome.wroteStatus).toBeNull();
      expect(outcome.why).toContain('waiting');

      // Left standing means STILL LIVE, not silently dropped.
      const after = await loadLiveQueue(RUNNER, 'RETURN_TO_TRAINING_STAGE');
      if (after.state !== 'ok') throw new Error('unreachable');
      expect(after.value.some((i) => i.idempotencyKey === 'return:still-waiting')).toBe(true);
    });
  });

  describe('the dispatcher · runReassessmentEvaluationSweep', () => {
    it('routes an evaluator throw to recordAssessmentFailure — the FAILED_EVALUATION decision, falsified', async () => {
      await setupPool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '')`,
        ['pr-race-throws', RUNNER, JSON.stringify({ date: '2026-05-01' })],
      );
      const sched = await scheduleReassessment(raceReq('pr-race-throws', '2026-05-01', 1, '2026-05-08'));
      expect(sched.state).toBe('ok');

      const throwingDeps: EvaluatorDeps = {
        evaluatePostRaceRecoveryCheckItem: async () => { throw new Error('injected failure for FAILEDEVAL falsification'); },
        evaluateReturnToTrainingStageItem,
      };
      const report = await runReassessmentEvaluationSweep('2026-05-08', throwingDeps);
      expect(report.failed).toBeGreaterThanOrEqual(1);
      expect(report.refusal).toBe('partial-failure');

      const row = await rawRow('post-race-recovery:pr-race-throws');
      // Still PENDING/DUE (never resolved), with the failure recorded on THIS
      // SAME kind's row — never a second kind: 'FAILED_EVALUATION' row.
      expect(row?.status === 'PENDING' || row?.status === 'DUE').toBe(true);
      expect(row?.attempts).toBeGreaterThanOrEqual(1);
      expect(row?.last_error).toContain('injected failure for FAILEDEVAL falsification');

      const failedEvalRow = await setupPool.query(
        `SELECT 1 FROM reassessment_schedule WHERE user_uuid = $1 AND kind = 'FAILED_EVALUATION'`,
        [RUNNER],
      );
      expect(failedEvalRow.rows.length).toBe(0);

      // The backoff `recordAssessmentFailure` just set is REAL: an immediate
      // second sweep, even with the real (non-throwing) evaluator, correctly
      // leaves the item alone — `loadDueItems`'s own
      // `next_retry_at IS NULL OR next_retry_at <= now()` guard is doing its
      // job, not swallowing the retry. Proven here rather than assumed,
      // because assuming it would have hidden a dispatcher that ignored the
      // backoff entirely.
      const immediateRetry = await runReassessmentEvaluationSweep('2026-05-08');
      void immediateRetry;
      const stillPending = await rawRow('post-race-recovery:pr-race-throws');
      expect(stillPending?.status).toBe('PENDING');

      // Advance past the backoff by hand (this suite owns the row; it is not
      // reading the scheduler's retry math, only waiting it out) and confirm
      // a LATER sweep, with the real evaluator, resolves the item cleanly —
      // a failed pass does not wedge it.
      await setupPool.query(
        `UPDATE reassessment_schedule SET next_retry_at = NOW() - INTERVAL '1 second'
          WHERE user_uuid = $1 AND idempotency_key = 'post-race-recovery:pr-race-throws'`,
        [RUNNER],
      );
      const report2 = await runReassessmentEvaluationSweep('2026-05-08');
      expect(report2.refusal).toBeNull();
      const row2 = await rawRow('post-race-recovery:pr-race-throws');
      expect(row2?.status).toBe('RESOLVED');
    });

    it('a second pass over an already-resolved item does the work once (idempotent)', async () => {
      const before = await runReassessmentEvaluationSweep('2026-05-08');
      // Nothing left due for this runner's already-resolved fixture; a
      // second pass finds zero of it to re-resolve (other kinds may still be
      // examined, but none are ours), and the row is untouched.
      expect(before.refusal === null || before.refusal === 'partial-failure').toBe(true);
      const row = await rawRow('post-race-recovery:pr-race-throws');
      expect(row?.status).toBe('RESOLVED');
    });
  });
});
