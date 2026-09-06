/**
 * lib/plan/_move_ledger_absent.db.test.ts · A REAL MOVE-A-RUN WRITE, PROVEN
 * TO REFUSE VISIBLY WHEN THE LEDGER IS ABSENT, AND TO SUCCEED CLEANLY WHEN IT
 * IS PRESENT.
 *
 * `_ledger_atomicity.db.test.ts`'s LEDGERREQUIRED-1 proof already covers this
 * mechanism generically, through a synthetic `bumpPace` mutation. This file
 * proves the SAME contract through `applyReschedule` — the actual write
 * kernel every live mover shares (`POST /api/plan/move` via `applyMove`
 * called it until MOVEREADJUDICATE-1's iPhone repoint; `POST /api/plan/
 * reschedule` still calls it directly and remains reachable even though its
 * only real client has moved on — see the handback report for that finding).
 * `applyReschedule` calls `mutatePlan` with `touches: 'structural'`
 * (`lib/plan/reschedule.ts:2487`), which is exactly where LEDGERREQUIRED-1
 * lives — so this is not a second implementation of the guard, it is the
 * SAME guard, exercised through the real Move-a-Run code path rather than a
 * hand-rolled stand-in.
 *
 * ── WHY `faff_roundtrip_scratch` ────────────────────────────────────────
 *
 * `recommendReschedule`/`applyReschedule` read `training_plans`, `plan_weeks`,
 * `plan_workouts`, `races` and `users` — the full schema, not the scheduler's
 * two-table scratch DB. Same precedent `_reassessment_staleplan.db.test.ts`
 * and `_reassessment_evaluators.db.test.ts` already set.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh   # if it doesn't exist
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_move_ledger_absent.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER EVERY OTHER MUTATION THROUGH `mutatePlan` ALSO REFUSES. That is
 *   `_ledger_atomicity.db.test.ts`'s job; this file proves ONE real caller.
 * · WHETHER `POST /api/plan/move` OR `POST /api/plan/reschedule` THEMSELVES
 *   refuse the same way over HTTP — this calls the shared library function
 *   directly, not the route handler (no `req`/`NextResponse` plumbing here).
 *   Both routes call this exact function with no additional write of their
 *   own around it, so the HTTP behaviour is the same by construction, not by
 *   a second, separately-verified path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  recommendReschedule, applyReschedule, addDaysISO, dowOfISO, resolveConstraint,
} from './reschedule';

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
        '[move-ledger-absent.db] SKIPPED · this suite proved NOTHING about LEDGERREQUIRED-1 against a '
        + `real Move-a-Run write. ${refusals.join('; ')}. Run with: `
        + `DATABASE_URL=postgresql://localhost/${SCRATCH_DB} npx vitest run lib/plan/_move_ledger_absent.db.test.ts `
        + '(build the scratch DB first with bash web-v2/scripts/_build_roundtrip_scratch.sh if it does not '
        + 'already exist).',
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('LEDGERREQUIRED-1 · a real Move-a-Run write, against a real ledger table', () => {
  const setupPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const RUNNER = randomUUID();
  const PLAN_ID = `move-ledger-test-${randomUUID()}`;
  // Far future, so `target.dateISO <= todayISO` and `isDaySealed` (which
  // reads `runs`, empty for this fresh user) never refuse for reasons this
  // test isn't about.
  const TODAY_ISO = '2030-01-05';
  const TARGET_ISO = '2030-01-10'; // Thursday, an easy day, inside the search window
  const TO_ISO = '2030-01-12'; // Saturday, two days later, empty (rest) — a clean landing spot

  async function seedFreshPlan(): Promise<void> {
    // Three weeks of plan_weeks spanning the full ±6-day easy-search window
    // around TARGET_ISO, and one plan_workouts row per day across that same
    // span — 'rest' everywhere except TARGET_ISO, which carries the movable
    // easy run.
    await setupPool.query(
      `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
       VALUES ($1, $2, 'base', 0, 2, 'fixture phase for LEDGERREQUIRED-1 proof', 'n/a')`,
      [`${PLAN_ID}-phase0`, PLAN_ID],
    );
    const weekStarts = ['2029-12-31', '2030-01-07', '2030-01-14'];
    for (let i = 0; i < weekStarts.length; i++) {
      await setupPool.query(
        `INSERT INTO plan_weeks (id, plan_id, phase_id, week_idx, week_start_iso, rationale)
         VALUES ($1, $2, $3, $4, $5, 'fixture week for LEDGERREQUIRED-1 proof')`,
        [`${PLAN_ID}-wk${i}`, PLAN_ID, `${PLAN_ID}-phase0`, i, weekStarts[i]],
      );
    }
    const weekIdFor = (iso: string): string => {
      if (iso < '2030-01-07') return `${PLAN_ID}-wk0`;
      if (iso < '2030-01-14') return `${PLAN_ID}-wk1`;
      return `${PLAN_ID}-wk2`;
    };
    for (let iso = '2030-01-01'; iso <= '2030-01-20'; iso = addDaysISO(iso, 1)) {
      const isTarget = iso === TARGET_ISO;
      await setupPool.query(
        `INSERT INTO plan_workouts
           (id, plan_id, week_id, date_iso, dow, type, distance_mi, is_quality, is_long, notes, workout_spec, user_uuid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10::jsonb, $11)`,
        [
          `${PLAN_ID}-${iso}`, PLAN_ID, weekIdFor(iso), iso, dowOfISO(iso),
          isTarget ? 'easy' : 'rest',
          isTarget ? 5 : 0,
          false, false,
          isTarget ? JSON.stringify({ kind: 'easy' }) : null,
          RUNNER,
        ],
      );
    }
  }

  beforeAll(async () => {
    await setupPool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
      [RUNNER, `move-ledger-${RUNNER}@example.invalid`],
    );
    await setupPool.query(
      `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state)
       VALUES ($1, $2::text, $2::uuid, 'race-prep', '2030-06-01', '{}'::jsonb)`,
      [PLAN_ID, RUNNER],
    );
    await seedFreshPlan();
  });

  afterAll(async () => {
    await setupPool.query(`DELETE FROM plan_decision_ledger WHERE plan_id = $1`, [PLAN_ID]).catch(() => {});
    await setupPool.query(`DELETE FROM plan_workouts WHERE plan_id = $1`, [PLAN_ID]);
    await setupPool.query(`DELETE FROM plan_weeks WHERE plan_id = $1`, [PLAN_ID]);
    await setupPool.query(`DELETE FROM plan_phases WHERE plan_id = $1`, [PLAN_ID]);
    await setupPool.query(`DELETE FROM training_plans WHERE id = $1`, [PLAN_ID]);
    await setupPool.query(`DELETE FROM users WHERE id = $1`, [RUNNER]);
    await setupPool.end();
  });

  it('the fixture is real · the ledger table exists on this database', async () => {
    const r = await setupPool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
    );
    expect(
      r.rows[0]?.reg,
      'plan_decision_ledger is absent on the scratch database, so every mutation below takes the '
      + 'pre-migration branch and this suite proves nothing about the SUCCESS path. Apply db/migrations/166.',
    ).not.toBeNull();
  });

  it('a real recommendation exists to move the easy run', async () => {
    const rec = await recommendReschedule({
      userUuid: RUNNER, todayISO: TODAY_ISO, dateISO: TARGET_ISO,
      constraint: resolveConstraint([], [], undefined),
    });
    expect(rec.ok, JSON.stringify(rec)).toBe(true);
    if (!rec.ok) throw new Error('unreachable');
    expect(rec.recommendation.options.length).toBeGreaterThan(0);
  });

  it('LEDGER ABSENT · the real Move-a-Run write REFUSES, and the plan does not move', async () => {
    const rec = await recommendReschedule({
      userUuid: RUNNER, todayISO: TODAY_ISO, dateISO: TARGET_ISO,
      constraint: resolveConstraint([], [], undefined),
    });
    expect(rec.ok, JSON.stringify(rec)).toBe(true);
    if (!rec.ok) throw new Error('unreachable');
    const option = rec.recommendation.options.find((o) => o.newDateISO === TO_ISO) ?? rec.recommendation.options[0];

    const before = (await setupPool.query<{ date_iso: string }>(
      `SELECT date_iso FROM plan_workouts WHERE id = $1`, [`${PLAN_ID}-${TARGET_ISO}`],
    )).rows[0]?.date_iso;
    expect(before).toBe(TARGET_ISO);

    // Made genuinely absent by renaming the real table — the honest
    // simulation `_ledger_atomicity.db.test.ts` already established, not a
    // JS stub of the probe.
    await setupPool.query(`ALTER TABLE plan_decision_ledger RENAME TO plan_decision_ledger_hidden`);

    let outcome: Awaited<ReturnType<typeof applyReschedule>>;
    try {
      outcome = await applyReschedule({
        userUuid: RUNNER, todayISO: TODAY_ISO, dateISO: TARGET_ISO,
        constraint: resolveConstraint([], [], undefined),
        optionId: option.id, token: rec.recommendation.token,
      });
    } finally {
      await setupPool.query(`ALTER TABLE plan_decision_ledger_hidden RENAME TO plan_decision_ledger`);
    }

    expect(outcome.ok, `a Move-a-Run write with no ledger table must not report success: ${JSON.stringify(outcome)}`).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('rejected');
    // FOUND-BUT-NOT-FIXED (handback report) · `applyReschedule`'s own mapping
    // (lib/plan/reschedule.ts:2518-2524) folds `mutatePlan`'s `ledger_unwritten`
    // outcome into the SAME generic "That move would break the plan" sentence
    // a real doctrine rejection gets, because both arrive with a non-empty
    // `violations` array. The safety property still holds — nothing moved —
    // but the human-readable `reason` cannot tell a caller "the ledger was
    // unavailable" from "this move breaks the plan". The SPECIFIC message
    // survives in `violations[0]`, which is what this asserts instead of the
    // generic `reason` text.
    const outcomeWithViolations = outcome as { violations?: readonly string[] };
    expect(outcomeWithViolations.violations?.length ?? 0).toBeGreaterThan(0);
    expect(String(outcomeWithViolations.violations?.[0] ?? '')).toContain('ledger');

    const after = (await setupPool.query<{ date_iso: string }>(
      `SELECT date_iso FROM plan_workouts WHERE id = $1`, [`${PLAN_ID}-${TARGET_ISO}`],
    )).rows[0]?.date_iso;
    expect(after, 'the workout moved even though the ledger could not record it').toBe(TARGET_ISO);
  });

  it('LEDGER PRESENT · the same real Move-a-Run write SUCCEEDS, and the plan moves', async () => {
    const ledgerReg = (await setupPool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
    )).rows[0]?.reg;
    expect(ledgerReg, 'the previous test must have restored the ledger table').not.toBeNull();

    const rec = await recommendReschedule({
      userUuid: RUNNER, todayISO: TODAY_ISO, dateISO: TARGET_ISO,
      constraint: resolveConstraint([], [], undefined),
    });
    expect(rec.ok, JSON.stringify(rec)).toBe(true);
    if (!rec.ok) throw new Error('unreachable');
    const option = rec.recommendation.options.find((o) => o.newDateISO === TO_ISO) ?? rec.recommendation.options[0];

    const outcome = await applyReschedule({
      userUuid: RUNNER, todayISO: TODAY_ISO, dateISO: TARGET_ISO,
      constraint: resolveConstraint([], [], undefined),
      optionId: option.id, token: rec.recommendation.token,
    });

    expect(outcome.ok, `the complete successful path must apply cleanly with the ledger present: ${JSON.stringify(outcome)}`).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');

    const moved = (await setupPool.query<{ date_iso: string }>(
      `SELECT date_iso FROM plan_workouts WHERE id = $1`, [`${PLAN_ID}-${TARGET_ISO}`],
    )).rows[0]?.date_iso;
    expect(moved, 'the easy run did not actually move').toBe(option.newDateISO);
    expect(moved).not.toBe(TARGET_ISO);

    const ledgerRow = await setupPool.query(
      `SELECT id FROM plan_decision_ledger WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [PLAN_ID],
    );
    expect(ledgerRow.rows.length, 'the successful move left no ledger row behind').toBeGreaterThan(0);
  });
});
