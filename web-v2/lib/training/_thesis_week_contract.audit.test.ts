/**
 * lib/training/_thesis_week_contract.audit.test.ts · RENDER IT (Rule 13).
 *
 * Constitution §16 / §31 applied to the owner's LIVE plan: every authored
 * week of the active plan is assessed against the Coaching Thesis, and the
 * verdict per week is printed. The gate is that no NORMAL training week
 * contradicts the thesis ("durability is the limiter, plan keeps adding VO2
 * work without reason → reject or require explanation").
 *
 * Read-only role, `.audit.` convention, skipped without `DATABASE_URL_RO`.
 *
 * Run with:
 *   npx vitest run lib/training/_thesis_week_contract.audit.test.ts --silent=false
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-09-02';

describe.skipIf(!RO)('THESIS × PLAN · every week of the owner\'s active plan against the thesis', () => {
  it('no normal training week contradicts the thesis, and the verdicts are printed per week', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { resolveCoachingThesis, loadThesisWeekRows, assessWeekAgainstThesis } =
      await import('@/lib/training/coaching-thesis');

    const thesis = await resolveCoachingThesis(OWNER, TODAY);
    const plan = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
      [OWNER],
    )).rows[0];
    expect(plan).toBeTruthy();
    const weeks = (await pool.query<{ id: string; week_idx: number; week_start_iso: string }>(
      `SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [plan.id],
    )).rows;
    expect(weeks.length).toBeGreaterThan(0);

    /* eslint-disable no-console */
    console.log(`\n══ THESIS × PLAN · ${plan.id} · limiter=${thesis.primaryLimiter} basis=${thesis.basis} ══`);
    const contradictions: string[] = [];
    for (const w of weeks) {
      const end = new Date(Date.parse(w.week_start_iso + 'T12:00:00Z') + 6 * 86_400_000).toISOString().slice(0, 10);
      const rows = await loadThesisWeekRows(plan.id, w.week_start_iso, end);
      const verdict = assessWeekAgainstThesis(thesis.primaryLimiter, rows);
      const shape = rows.map((r) => `${r.type}${r.isLong ? '*' : ''}`).join(',');
      console.log(`  wk${String(w.week_idx).padStart(2)} ${w.week_start_iso} ${(rows[0]?.phaseLabel ?? '-').padEnd(13)} ${verdict.code.padEnd(28)} ${verdict.detail}  [${shape}]`);
      if (verdict.code === 'WEEK_CONTRADICTS_THESIS') contradictions.push(`${w.week_start_iso}: ${verdict.detail}`);
    }
    /* eslint-enable no-console */
    expect(contradictions, contradictions.join('\n')).toEqual([]);
  }, 120_000);
});
