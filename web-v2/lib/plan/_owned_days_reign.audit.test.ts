/**
 * lib/plan/_owned_days_reign.audit.test.ts · RENDER IT (Rule 13), against the
 * real account that found this bug.
 *
 * `ownedDaysSql`'s tiebreak used to pick "the plan with the latest
 * `authored_iso`" once every candidate for a date was archived. That is not
 * the same question as "which plan was actually the account's live plan on
 * that date" — see `docs/reports/taper-tempo-comparison-basis-2026-09-01.md`
 * and `docs/reports/owned-days-plan-selection-fix-2026-09-01.md`. A plan
 * authored 2026-06-07 and reverted 21 MINUTES later carried a later
 * `authored_iso` than the runner's real plan (authored 2026-06-03, live for
 * two and a half months, adapted four times) — so once the race archived the
 * real plan too, the 21-minute ghost outranked it for the entire 42-day
 * window the adaptation model reads.
 *
 * This is an `.audit.` test (same convention as
 * `_activity_evidence.audit.test.ts`) — it needs `DATABASE_URL_RO` and skips
 * without one, so CI never depends on a database. `_plan_undo.test.ts`'s
 * describe-block 5 is the CI-safe structural sibling: it asserts the ORDER BY
 * clause shape without touching a database. This file is what actually proves
 * the shape is semantically correct, against the real rows that exposed the
 * bug.
 *
 * READ-ONLY, enforced the same way as its sibling: `DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` runs, so every module under test is imported DYNAMICALLY
 * inside the test body — a static top-level import would already have
 * connected to whatever `DATABASE_URL` the process started with.
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// The plan the runner actually trained under: authored 2026-06-03, adapted in
// place four times, archived only when the race it was built for completed.
const REAL_PLAN = 'pln_ca91f252bba50c74';
// The 21-minute ghost: authored 2026-06-07, archived 21 minutes later, never
// served a single day to the runner — but authored AFTER the real plan, so
// the old "most recently authored, once both are archived" tiebreak picked it
// for every date they both cover.
const GHOST_PLAN = 'pln_c0ff77ee065b8fe4';

// The old tiebreak, reproduced verbatim so this file can prove the bug is
// real before proving the fix, per Rule 18 ("a gate is not trusted until it
// has been made to fail").
const OLD_ORDER_BY = '(tp.archived_iso IS NULL) DESC, tp.authored_iso DESC';

// The 7 dates from the investigation report's table, and the plan/session
// shape the runner's REAL plan prescribed for each.
const EXPECTED: Array<{
  date: string; type: string; isQuality: boolean; distanceMi: number; paceTargetSPerMi: number | null;
}> = [
  { date: '2026-07-21', type: 'tempo', isQuality: true, distanceMi: 8, paceTargetSPerMi: 419 },
  { date: '2026-07-23', type: 'intervals', isQuality: true, distanceMi: 7.5, paceTargetSPerMi: 389 },
  { date: '2026-07-28', type: 'tempo', isQuality: true, distanceMi: 8, paceTargetSPerMi: 419 },
  { date: '2026-07-30', type: 'easy', isQuality: false, distanceMi: 7.5, paceTargetSPerMi: null },
  { date: '2026-08-04', type: 'tempo', isQuality: true, distanceMi: 8, paceTargetSPerMi: 419 },
  { date: '2026-08-06', type: 'tempo', isQuality: true, distanceMi: 8, paceTargetSPerMi: 419 },
  { date: '2026-08-16', type: 'race', isQuality: true, distanceMi: 13.1, paceTargetSPerMi: 412 },
];

const d = RO ? describe : describe.skip;

d('ownedDaysSql · reverted-plan regression, real account', () => {
  it('FALSIFIER: the old authored_iso-only tiebreak really does pick the 21-minute ghost', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query<{ date_iso: string; plan_id: string }>(
      `SELECT DISTINCT ON (pw.date_iso) pw.date_iso, pw.plan_id
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE pw.user_uuid = $1 AND pw.date_iso >= $2 AND pw.date_iso < $3
        ORDER BY pw.date_iso, ${OLD_ORDER_BY}`,
      [OWNER, '2026-07-20', '2026-08-17'],
    );
    const byDate = new Map(r.rows.map((row) => [row.date_iso, row.plan_id]));
    for (const { date } of EXPECTED) {
      expect(byDate.get(date), `old tiebreak for ${date}`).toBe(GHOST_PLAN);
    }
  });

  it('ownedDaysSql resolves every report date to the real, long-lived plan — not the reverted one', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { ownedDaysSql } = await import('./owned-days');
    const sql = `WITH owned AS (${ownedDaysSql({
      columns: 'pw.date_iso, pw.type, pw.is_quality, pw.distance_mi, pw.pace_target_s_per_mi, pw.plan_id',
    })}) SELECT * FROM owned ORDER BY owned.date_iso`;
    const r = await pool.query<{
      date_iso: string; type: string | null; is_quality: boolean | null;
      distance_mi: string | null; pace_target_s_per_mi: number | null; plan_id: string;
    }>(sql, [OWNER, '2026-07-20', '2026-08-17']);
    const byDate = new Map(r.rows.map((row) => [row.date_iso, row]));

    for (const exp of EXPECTED) {
      const got = byDate.get(exp.date);
      expect(got, `no owned row for ${exp.date}`).toBeTruthy();
      expect(got!.plan_id, `${exp.date} must resolve to the real plan, not the ghost`).toBe(REAL_PLAN);
      expect(got!.type, `${exp.date} type`).toBe(exp.type);
      expect(got!.is_quality === true, `${exp.date} is_quality`).toBe(exp.isQuality);
      expect(Number(got!.distance_mi), `${exp.date} distance_mi`).toBe(exp.distanceMi);
      expect(
        got!.pace_target_s_per_mi == null ? null : Number(got!.pace_target_s_per_mi),
        `${exp.date} pace_target_s_per_mi`,
      ).toBe(exp.paceTargetSPerMi);
    }
  });

  it('the entire 42-day adaptation window resolves to one plan, with zero gaps', async () => {
    // The investigation report found every date from 07-06 through 08-16
    // resolving through the ghost. Confirm the fixed window is clean and
    // single-plan, matching `loadAdaptationInput`'s own 42-day span.
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { ownedDaysSql } = await import('./owned-days');
    const sql = `WITH owned AS (${ownedDaysSql({ columns: 'pw.date_iso, pw.plan_id' })})
                 SELECT * FROM owned ORDER BY owned.date_iso`;
    const r = await pool.query<{ date_iso: string; plan_id: string }>(
      sql, [OWNER, '2026-07-06', '2026-08-17'],
    );
    expect(r.rows.length).toBe(42);
    const planIds = new Set(r.rows.map((row) => row.plan_id));
    expect([...planIds]).toEqual([REAL_PLAN]);
  });
});
