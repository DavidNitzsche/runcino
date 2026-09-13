/**
 * lib/plan/_undo_against_archived_plan.db.test.ts · UNDOARCHIVED-1 (2026-09-12)
 *
 * ── WHAT THIS PROVES, AND WHY IT WAS MISSING ────────────────────────────────
 *
 * The independent review of ARCHIVEDGUARD-1 (`8ff90216f`) flagged that
 * `undoReschedule()` (lib/plan/reschedule.ts:2679) and its thin wrapper
 * `undoMove()` (lib/brain/orchestration/move-orchestrator.ts:1348) now
 * correctly refuse an undo whose `plan_reschedules` row points at a plan that
 * has since been archived by a rebuild — but only as an ACCIDENTAL side
 * effect of the shared `mutatePlan` boundary hardening, never as behavior
 * anyone asserted on purpose. An undocumented, unverified side effect is
 * exactly the shape Rule 20 names ("a product rule with no gate is a
 * hypothesis") — the refusal is correct today, but nothing would notice if a
 * future change to either function's plumbing quietly broke it.
 *
 * The mechanism: `undoReschedule` reads `plan_reschedules.plan_id` for the
 * decision being undone and forwards it as `mutatePlan({ planId, ... })`.
 * That is the EXACT explicit-`planId` path ARCHIVEDGUARD-1/2 harden — if the
 * plan named on the old decision has since been archived (the runner's plan
 * was rebuilt after the reschedule but before the undo), the boundary's own
 * "1 · resolve the plan" step now refuses it, `undoReschedule` maps that to
 * `{ ok: false, code: 'rejected' }`, and `undoMove` forwards the same
 * refusal untouched (it returns immediately on `!out.ok`, before it does
 * anything else).
 *
 * ── WHY THIS NEEDS THE REAL mutatePlan(), NOT THE MOCK ──────────────────────
 *
 * `_reschedule_contract.test.ts` mocks `@/lib/plan/mutate` entirely (its own
 * header says so) — a fake boundary that always returns `{ ok: true,
 * outcome: 'applied' }` on anything it is handed cannot exercise the
 * archived-plan check at all. This file runs `undoReschedule` and `undoMove`
 * for real against the scratch DB and the real `mutatePlan`, the same
 * posture as `_archived_plan_mutation_guard.db.test.ts` and
 * `_archived_plan_race_guard.db.test.ts`.
 *
 * ── REACHABILITY ─────────────────────────────────────────────────────────────
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_undo_against_archived_plan.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · Whether the ORIGINAL reschedule (the thing being undone) was itself
 *   doctrine-valid. It never ran through `recommendReschedule`/
 *   `applyReschedule` — the `plan_reschedules` row is seeded directly, as the
 *   already-decided artifact an undo starts from.
 * · `undoMove`'s success path (ledger write, briefing-cache bust, planVersion
 *   resolution) — it returns before any of that runs on the refusal path
 *   this file exercises.
 * · Any refusal reason OTHER than an archived plan_id — `not_found`,
 *   `already_undone`, `sealed` and `read_failed` are `undoReschedule`'s own
 *   concern and are not re-proven here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { undoReschedule } from './reschedule';
import { undoMove } from '@/lib/brain/orchestration/move-orchestrator';

const SCRATCH_DB = 'faff_roundtrip_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) {
    return `${label} points at host '${parsed.hostname}', which is not loopback`;
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL')]
  .filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;
const when = REACHABLE ? it : it.skip;

const TODAY = '2026-09-12';
// Comfortably in the future relative to TODAY, so `isDaySealed` never finds a
// matched run for this synthetic runner and the seal check this file does
// not intend to exercise stays out of the way.
const ORIGINAL_ISO = '2026-09-20';
const NEW_ISO = '2026-09-22';

let RUNNER = '';

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `undo-archived+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

/** One plan, one plan_workouts row, optionally archived. */
async function seedPlan(opts: { archived: boolean }): Promise<{ planId: string; workoutId: string }> {
  const planId = `pln_undoarc_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  const workoutId = `pw_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb, ${opts.archived ? 'NOW()' : 'NULL'})`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the undo-against-archived-plan suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the undo-against-archived-plan suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi,
        is_quality, is_long, notes, pace_target_s_per_mi, workout_spec)
     VALUES ($1, $2, $3, $4, 1, 'recovery', 4, false, false, '', 550, '{"kind":"recovery"}'::jsonb)`,
    [workoutId, planId, weekId, NEW_ISO],
  );
  return { planId, workoutId };
}

/**
 * Seed a `plan_reschedules` row directly — the already-decided artifact an
 * undo starts from — pointed at `planId`. Mirrors `recordDecision`'s own
 * INSERT (lib/plan/reschedule.ts:2604) column-for-column, and the
 * `RescheduleDecision.undo.edits` shape `undoReschedule` reads
 * (lib/plan/reschedule.ts:606-625).
 */
async function seedRescheduleDecision(planId: string, workoutId: string): Promise<string> {
  const decisionId = `rsd_undoarc_${randomUUID().slice(0, 8)}`;
  const before = {
    dateISO: ORIGINAL_ISO, type: 'recovery', distanceMi: 4,
    isQuality: false, isLong: false, subLabel: null,
    paceTargetSPerMi: 550, spec: { kind: 'recovery' },
  };
  const after = {
    dateISO: NEW_ISO, type: 'recovery', distanceMi: 4,
    isQuality: false, isLong: false, subLabel: null,
    paceTargetSPerMi: 550, spec: { kind: 'recovery' },
  };
  const edit = { planWorkoutId: workoutId, before, after, why: 'test/undo-against-archived-plan' };
  const decision = {
    kind: 'RESCHEDULE', origin: 'RUNNER_CONSTRAINT', evidenceEffect: 'NONE',
    decisionId, planId, userUuid: RUNNER, decidedAtISO: TODAY,
    constraint: { kind: 'UNAVAILABLE_DATES', dates: [ORIGINAL_ISO] },
    original: { planWorkoutId: workoutId, ...before },
    identity: { kind: 'SAME_INSTANCE' }, stimulusPreservation: 'FULL',
    optionId: 'opt_a', moveKind: 'MOVE', newDateISO: NEW_ISO,
    edits: [edit], undo: { edits: [edit] },
  };
  await pool.query(
    `INSERT INTO plan_reschedules
       (id, user_uuid, plan_id, plan_workout_id, decided_at,
        kind, origin, move_kind, stimulus_preservation, identity_kind,
        original_date_iso, new_date_iso, decision)
     VALUES ($1, $2::uuid, $3, $4, now(),
             'RESCHEDULE', 'RUNNER_CONSTRAINT', $5, $6, $7,
             $8, $9, $10::jsonb)`,
    [
      decisionId, RUNNER, planId, workoutId,
      decision.moveKind, decision.stimulusPreservation, decision.identity.kind,
      ORIGINAL_ISO, NEW_ISO, JSON.stringify(decision),
    ],
  );
  return decisionId;
}

async function undoneAtOf(decisionId: string): Promise<string | null> {
  const r = await pool.query<{ undone_at: string | null }>(
    `SELECT undone_at::text AS undone_at FROM plan_reschedules WHERE id = $1`,
    [decisionId],
  );
  return r.rows[0]?.undone_at ?? null;
}

async function workoutDateOf(workoutId: string): Promise<string | undefined> {
  const r = await pool.query<{ date_iso: string }>(
    `SELECT date_iso::text AS date_iso FROM plan_workouts WHERE id = $1`,
    [workoutId],
  );
  return r.rows[0]?.date_iso;
}

const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[undo-against-archived-plan] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

describe('UNDOARCHIVED-1 · an undo against a since-archived plan is refused, on purpose', () => {
  when(
    'undoReschedule() refuses when the decision\'s plan has been archived by a rebuild',
    async () => {
      await seedRunner();
      const { planId, workoutId } = await seedPlan({ archived: true });
      const decisionId = await seedRescheduleDecision(planId, workoutId);

      const out = await undoReschedule({ userUuid: RUNNER, todayISO: TODAY, decisionId });

      expect(
        out.ok,
        'an undo against an archived plan_id was applied — the mutation ' +
        'boundary\'s archived-plan guard did not fire for this caller',
      ).toBe(false);
      if (!out.ok) {
        expect(out.code).toBe('rejected');
        expect(
          out.violations?.join(' ') ?? '',
          'the refusal should name the archived/not-owned plan, not some ' +
          'unrelated doctrine violation — otherwise this is passing for the ' +
          'wrong reason',
        ).toContain('archived');
      }

      // Nothing moved: the row this decision would have restored is
      // untouched, and the decision itself is not marked undone.
      expect(await workoutDateOf(workoutId)).toBe(NEW_ISO);
      expect(
        await undoneAtOf(decisionId),
        'the decision was marked undone even though the restore was refused',
      ).toBeNull();
    },
  );

  when(
    'undoMove() forwards the same refusal, unchanged, without touching the ' +
    'ledger or the briefing cache',
    async () => {
      await seedRunner();
      const { planId, workoutId } = await seedPlan({ archived: true });
      const decisionId = await seedRescheduleDecision(planId, workoutId);

      const out = await undoMove({ userUuid: RUNNER, todayISO: TODAY, decisionId });

      expect(out.ok, 'undoMove applied an undo its own undoReschedule should have refused').toBe(false);
      if (!out.ok) {
        expect(out.code).toBe('rejected');
      }
      expect(await workoutDateOf(workoutId)).toBe(NEW_ISO);
      expect(await undoneAtOf(decisionId)).toBeNull();
    },
  );

  when(
    'control · the same undo against the plan while it is still ACTIVE succeeds',
    async () => {
      await seedRunner();
      const { planId, workoutId } = await seedPlan({ archived: false });
      const decisionId = await seedRescheduleDecision(planId, workoutId);

      const out = await undoReschedule({ userUuid: RUNNER, todayISO: TODAY, decisionId });

      expect(
        out.ok,
        'a legitimate undo against the runner\'s own still-active plan must ' +
        'still work — this file is not proving the guard by making undo ' +
        'unconditionally refuse',
      ).toBe(true);
      if (out.ok) expect(out.restored).toBe(1);
      expect(
        await workoutDateOf(workoutId),
        'undo should have restored the workout to its ORIGINAL date',
      ).toBe(ORIGINAL_ISO);
      expect(await undoneAtOf(decisionId)).not.toBeNull();
    },
  );
});
