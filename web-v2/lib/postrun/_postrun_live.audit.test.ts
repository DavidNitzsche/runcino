/**
 * lib/postrun/_postrun_live.audit.test.ts · the loader, against production.
 *
 * Read-only. It runs `loadPostRunExperience` over the owner's real account and
 * asserts what comes back — because `_experience.test.ts` is fixtures, and
 * Rule 13 clause 2 says fixtures skip the code paths that break. Every number
 * below was read out of `runs`, `plan_workouts` and `coach_intents` before it
 * was asserted here.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS THE PAYLOAD, NOT THE PHONE. Nothing here proves a screen draws any
 *     of it. Rule 13's rendering half is not covered by this file and is not
 *     claimed by it.
 *   · IT IS ONE ACCOUNT AND A HANDFUL OF DAYS. Injury, illness, race day,
 *     treadmill and off-season are not exercised against real rows.
 *   · IT SKIPS ITSELF WITHOUT A DATABASE, so a CI container with no
 *     `DATABASE_URL` reports green having asserted nothing. The skip is LOUD
 *     (it fails the liveness test below) rather than silent.
 */
import { describe, it, expect } from 'vitest';
import { pool } from '@/lib/db/pool';
import { loadPostRunExperience } from './load';
import { auditExplanation } from '@/lib/faff/explanation';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** The 4 x 1 mile session the brief names as its acceptance fixture. */
const RUN_0901 = '-258355938987883';

async function haveDb(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

describe('post-run experience · live payload', () => {
  it("composes the owner's 2026-09-01 threshold session from real rows", async () => {
    if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }
    const out = await loadPostRunExperience(OWNER, { runId: RUN_0901 });
    expect(out).not.toBeNull();
    if (!out) return;

    expect(out.runId).toBe(RUN_0901);
    expect(out.dateISO).toBe('2026-09-01');
    expect(out.execution.status).toBe('CONTROLLED');
    expect(out.execution.intendedStimulus).toBe('Threshold');
    expect(out.execution.stimulusDelivered).toBe('FULL');
    // 422 / 429 / 422 / 419 against 430 +/- 8. Three hits, one fast.
    expect(out.execution.summary).toBe('All four reps landed, with one quicker than the window.');

    // The ceiling comes from the plan's own pass rule, work-scoped.
    expect(out.cost.hrScope).toBe('work');
    expect(out.cost.hrBpm).toBe(162);
    expect(out.cost.ceilingBpm).toBe(164);
    expect(out.cost.status).toBe('EXPECTED');

    // The Evidence Engine's real classification of this activity.
    expect(out.evidence.role).toBe('CORROBORATES');
    expect(out.evidence.domains).toEqual(['THRESHOLD', 'DURABILITY']);
    expect(out.evidence.beliefChanged).toBe(false);
    expect(out.evidence.planAuthorityEligible).toBe(false);

    // Nothing has adapted since 2026-08-08 in this account, so this is a
    // measured "unchanged", not an assumed one.
    expect(out.plan.status).toBe('UNCHANGED');
    expect(out.plan.changes).toEqual([]);
    expect(out.plan.sealedHistoryChanged).toBe(false);

    expect(auditExplanation(out.briefing)).toEqual([]);
  }, 120_000);

  it('PARITY · the run-id read and the date read are the same object, byte for byte', async () => {
    if (!await haveDb()) return;
    // This is the brief's first P0 as an assertion. Today-after-run resolves by
    // DAY and Run Detail resolves by RUN ID; if those two can produce different
    // objects then the two screens can disagree, which is exactly the defect.
    const byId = await loadPostRunExperience(OWNER, { runId: RUN_0901 });
    const byDate = await loadPostRunExperience(OWNER, { dateISO: '2026-09-01' });
    expect(byId).not.toBeNull();
    expect(JSON.stringify(byDate)).toBe(JSON.stringify(byId));
  }, 120_000);

  it('a run that is not this runner\'s is a null, and never someone else\'s run', async () => {
    if (!await haveDb()) return;
    const out = await loadPostRunExperience(OWNER, { runId: '999999999999999' });
    expect(out).toBeNull();
  }, 60_000);

  it('LIVENESS · the audit reached a database and read real rows', async () => {
    // Rule 18 clause 2. Without this, a container with no DATABASE_URL runs
    // every test above, asserts nothing, and reports confidence.
    expect(await haveDb()).toBe(true);
    const n = (await pool.query<{ n: string }>(
      `SELECT count(*)::text n FROM runs WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')`,
      [OWNER],
    )).rows[0]?.n;
    expect(Number(n)).toBeGreaterThan(50);
  }, 60_000);
});
