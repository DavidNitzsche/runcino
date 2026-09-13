/**
 * lib/plan/_duration_progress_offer.db.test.ts · DURATIONOFFER-1 (2026-09-12),
 * PROVEN AGAINST A REAL DATABASE — not merely type-checked.
 *
 * `DURATION_PROGRESS_OFFER` is a propose-only exception to the 2026-09-02
 * reshape ruling, authorized narrowly for exactly one axis (interval_duration)
 * and direction (ACCELERATE). Per Rule 13 ("a fix to something the runner sees
 * is verified by RENDERING it"), this proves the full lifecycle — write,
 * render, accept, decline — with a real Postgres row, not a mocked one. The
 * load-bearing property under test is negative: accepting this offer must
 * write NOTHING to `plan_workouts`, ever, on either schema state.
 *
 * Run against both scratch databases:
 *
 *     DATABASE_URL=postgresql://localhost/faff_166absent_scratch \
 *       npx vitest run lib/plan/_duration_progress_offer.db.test.ts
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_duration_progress_offer.db.test.ts
 *
 * SKIPS AND PRINTS WHY when `DATABASE_URL` is not a loopback scratch DB
 * (Rule 18 — reporting clean because it looked at nothing is the worst
 * outcome, since it also reports confidence).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { writeActionProposal } from '@/lib/brain/proposal/write';
import { loadPendingProposalById, dismissProposal } from './workout-proposals';
import { applyBrainAction } from '@/lib/brain/proposal/accept';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { actionHeadline } from '@/lib/faff/v5-action-render';
import type { BrainAction } from '@/lib/brain/proposal/action';

const SCRATCH_DBS = new Set(['faff_166absent_scratch', 'faff_roundtrip_scratch']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined): string | null {
  if (!url) return 'DATABASE_URL is not set';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'DATABASE_URL is not a parseable URL'; }
  if (!LOOPBACK.has(parsed.hostname)) return `DATABASE_URL points at host '${parsed.hostname}', not loopback`;
  const db = parsed.pathname.replace(/^\//, '');
  if (!SCRATCH_DBS.has(db)) return `DATABASE_URL names '${db}', not one of the known scratch databases`;
  return null;
}

const refusal = scratchVerdict(process.env.DATABASE_URL);
const when = refusal === null ? it : it.skip;
if (refusal !== null) {
  // eslint-disable-next-line no-console
  console.warn(`[_duration_progress_offer.db.test.ts] SKIPPED · ${refusal}`);
}

const TODAY = '2026-09-12';

async function seedPlan(): Promise<{ runnerUuid: string; planId: string; workoutId: string }> {
  const runnerUuid = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, 'not-a-real-hash')`,
    [runnerUuid, `duration-offer+${runnerUuid.slice(0, 8)}@scratch.local`],
  );
  const planId = `pln_duroffer_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb)`,
    [planId, runnerUuid, runnerUuid, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the duration-offer suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the duration-offer suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  const workoutId = `pw_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi,
        is_quality, is_long, notes, pace_target_s_per_mi, duration_min, workout_spec)
     VALUES ($1, $2, $3, $4, 3, 'intervals', 8, true, false, '', 400, 32,
             '{"kind":"intervals","reps":4,"repMinutes":8,"recoveryMinutes":2}'::jsonb)`,
    [workoutId, planId, weekId, `2026-09-1${5}`],
  );
  return { runnerUuid, planId, workoutId };
}

async function planWorkoutSnapshot(workoutId: string): Promise<Record<string, unknown>> {
  const r = await pool.query(
    `SELECT distance_mi, duration_min, pace_target_s_per_mi, workout_spec, sub_label, notes
       FROM plan_workouts WHERE id = $1`,
    [workoutId],
  );
  return r.rows[0];
}

describe('DURATION_PROGRESS_OFFER · propose/render/accept/decline against a real database', () => {
  beforeAll(() => {
    if (refusal !== null) return;
  });

  when('writes, renders, and accepting it mutates NOTHING in plan_workouts', async () => {
    const { runnerUuid, planId, workoutId } = await seedPlan();
    const before = await planWorkoutSnapshot(workoutId);

    const offer: BrainAction = {
      schemaVersion: 1,
      direction: 'MORE',
      before: [{ planWorkoutId: workoutId, dateISO: '2026-09-15', type: 'intervals', distanceMi: 8 }],
      kind: 'DURATION_PROGRESS_OFFER',
      to: { unit: 'min', value: 9 },
    };

    // 1 · WRITE. The same writer HOLD/SAFETY_STOP use — never `writeWorkoutProposals`.
    const written = await writeActionProposal({
      userUuid: runnerUuid,
      action: offer,
      anchorWorkoutId: workoutId,
      anchorDateISO: '2026-09-15',
      reason: 'You are absorbing this block well, so this week asks for a little more than the plan had drawn up.',
      evidence: { planned_type: 'intervals', planned_distance_mi: 8 },
      source: 'cron_evening',
      todayISO: TODAY,
    });
    expect(written.ok, written.ok ? '' : `write refused: ${(written as { because?: string }).because}`).toBe(true);
    expect((written as { written: boolean }).written, 'the offer must actually be written, not silently skipped').toBe(true);
    const proposalId = (written as { proposalId: number }).proposalId;

    // 2 · RENDER. Read it back through the real production reader, not a mock.
    const lookup = await loadPendingProposalById(runnerUuid, proposalId);
    if (!lookup.ok) throw new Error('lookup failed');
    const pending = lookup.proposal;
    expect(pending, 'the written offer must be readable back as a pending proposal').not.toBeNull();
    // `action_kind` is stored lower-cased (`ActionRowKind = Lowercase<ActionKind>`, `write.ts`'s `rowKindOf`).
    expect(pending!.actionKind).toBe('duration_progress_offer');
    const storedAction = actionFromPending(pending!);
    expect(storedAction, 'the stored action must round-trip through actionFromPending').not.toBeNull();
    const headline = actionHeadline(storedAction!, 'Tuesday');
    expect(headline, 'the card must read as an OFFER ("could"), never as an applied change ("goes to")')
      .toBe('Tuesday could go to 9 minutes');
    expect(headline).not.toContain('goes to');

    // 3 · ACCEPT. Must record only — zero plan_workouts writes, on EITHER
    // schema state (RECORD_ONLY never touches mutatePlan/the ledger at all).
    const outcome = await applyBrainAction(storedAction!, {
      userUuid: runnerUuid,
      todayISO: TODAY,
      proposalId,
      why: 'test acceptance',
    });
    expect(outcome.ok, outcome.ok ? '' : `accept refused: ${JSON.stringify(outcome)}`).toBe(true);
    if (outcome.ok) {
      expect(outcome.recordedOnly, 'accepting a DURATION_PROGRESS_OFFER must be record-only').toBe(true);
      expect(outcome.applied, 'accepting it must apply zero rows').toBe(0);
    }

    const afterAccept = await planWorkoutSnapshot(workoutId);
    expect(afterAccept, 'plan_workouts must be byte-identical after accepting an offer — this is the whole point').toEqual(before);
  });

  when('declining leaves the session exactly as prescribed', async () => {
    const { runnerUuid, workoutId } = await seedPlan();
    const before = await planWorkoutSnapshot(workoutId);

    const offer: BrainAction = {
      schemaVersion: 1,
      direction: 'MORE',
      before: [{ planWorkoutId: workoutId, dateISO: '2026-09-15', type: 'intervals', distanceMi: 8 }],
      kind: 'DURATION_PROGRESS_OFFER',
      to: { unit: 'min', value: 9 },
    };
    const written = await writeActionProposal({
      userUuid: runnerUuid,
      action: offer,
      anchorWorkoutId: workoutId,
      anchorDateISO: '2026-09-15',
      reason: 'test offer for decline',
      evidence: { planned_type: 'intervals', planned_distance_mi: 8 },
      source: 'cron_evening',
      todayISO: TODAY,
    });
    expect(written.ok).toBe(true);
    const proposalId = (written as { proposalId: number }).proposalId;

    const dismissed = await dismissProposal(runnerUuid, proposalId);
    expect(dismissed, 'a DURATION_PROGRESS_OFFER must be genuinely declinable, not refused as not-decidable').toBeTruthy();

    const status = await pool.query<{ status: string }>(
      `SELECT status FROM plan_workout_proposals WHERE id = $1`, [proposalId],
    );
    expect(status.rows[0].status).toBe('dismissed');

    const after = await planWorkoutSnapshot(workoutId);
    expect(after, 'declining must also leave plan_workouts untouched').toEqual(before);
  });
});
