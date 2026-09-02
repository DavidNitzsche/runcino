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
/** The easy-plus-strides session the runner rejected on 2026-09-02. */
const RUN_0902 = '-145861381014809';

async function haveDb(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

/**
 * CI FIX 2026-09-02 · this file failed `test-full` on main. Its LIVENESS test
 * asserts a database was reached, which is exactly right when one is
 * CONFIGURED and wrong in a container where none is — CI has no
 * `DATABASE_URL_RO`, so the file turned a missing credential into a red build.
 *
 * The guard is the same one `lib/faff/_voice_live.audit.test.ts` uses and the
 * reason it passes CI: the whole describe is skipped when the read-only role is
 * absent. That keeps Rule 18 clause 2 intact where it means something — with
 * `DATABASE_URL_RO` set, LIVENESS still binds and still fails loudly on a
 * container that reads nothing — while a machine that was never given
 * credentials reports SKIPPED rather than FAILED, which is the honest of the
 * two. Rule 11: "not configured" and "configured and broken" are different
 * facts.
 */
const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;

describe.skipIf(!RO)('post-run experience · live payload', () => {
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

    /* THE EVIDENCE ENGINE'S REAL CLASSIFICATION — and it CHANGED on
     * 2026-09-02, because until that day the classifier was never handed a
     * belief to compare against.
     *
     * `load.ts` called `classifyStoredActivity(userId, runId)` with no
     * options, so `currentBelief` was null on every post-run classification
     * this app had ever run, so `readBeliefTension` refused immediately with
     * `no_belief_supplied` — and `role: 'CHALLENGES'` had therefore NEVER
     * FIRED, for any run, for any runner, while the screen went on saying
     * "This supports your current threshold range" as though a comparison had
     * happened. A field that exists and cannot fire, narrated as though it had.
     *
     * With `resolveThresholdCapacity` wired in, this session — 422 / 429 / 422
     * / 419 against the believed threshold — reads as what it actually is: an
     * observation that sits outside what the current number predicts. The
     * belief is still NOT moved (`anchorEffect` is the single literal
     * `no_change_flag_for_reexamination`), which is the third outcome the
     * Evidence Engine exists to express. */
    expect(out.evidence.role).toBe('CHALLENGES');
    expect(out.evidence.runnerSummary).toMatch(/sits outside what your current/);
    expect(out.evidence.beliefChanged).toBe(false);
    // The read HAPPENED. This is the assertion that would have caught the gap.
    expect(out.evidence.reasons).not.toContain('CURRENT_BELIEF_NOT_SUPPLIED_TO_CLASSIFIER');

    // Nothing has adapted since 2026-08-08 in this account, so this is a
    // measured "unchanged", not an assumed one.
    expect(out.plan.status).toBe('UNCHANGED');
    expect(out.plan.changes).toEqual([]);
    expect(out.plan.sealedHistoryChanged).toBe(false);

    expect(auditExplanation(out.briefing)).toEqual([]);
  }, 120_000);

  it("composes the owner's 2026-09-02 easy-plus-strides session from real rows", async () => {
    /* THE RUN HE COMPLAINED ABOUT. "the post run breakdown is awful. Not
     * showing all the miles, not showing the strides."
     *
     * Every number below was read out of `runs` and `plan_workouts` at
     * `faff_readonly` before it was asserted here. The row's totals were
     * repaired by hand on 2026-09-02 (`data.manualCorrection`) after the watch
     * truncated the recording at the last prescribed phase; the phases and
     * splits were deliberately left alone, which is why this session holds
     * three different correct distances at once. */
    if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }
    const out = await loadPostRunExperience(OWNER, { runId: RUN_0902 });
    expect(out).not.toBeNull();
    if (!out) return;

    expect(out.dateISO).toBe('2026-09-02');

    /* SIMROW-1 · IT READ *HIS* COMPLETION, not somebody's simulator run.
     *
     * Three `watch_completion` intents match this day in production:
     * `sim-recovery-live#1038` (3 phases), `sim-recovery-live#1101` (3
     * phases) and his own `...-2026-09-02#0919` (13 phases). The loader used
     * to take the most recent by timestamp and got a simulator's 0.09 mi
     * "Work" phase, which it then graded as his session — the live screen
     * read "The work block came in ahead of the ceiling" over a run with no
     * such block. Rule 14: filtering on the runner is not filtering on the
     * right rows.
     *
     * This assertion is the falsifier. It failed against the unfixed loader
     * and passes against the fixed one, and every assertion below it would
     * also fail if the wrong payload were ever picked again. */
    expect(out.capture.structuredDistanceMi).toBe(5.98);
    expect(out.strides?.recorded).toBe(6);

    // 1 · THE EASY BLOCK IS NOT A REPETITION, and the strides are not reps of it.
    expect(out.execution.summary).not.toMatch(/seven|\breps?\b/i);
    expect(out.execution.summary).toBe(
      'The work block stayed under the ceiling. Six strides after, walk-backs taken.',
    );
    expect(out.execution.intendedStimulus).toBe('Easy');

    // 2 · NO STRIDE IS CRITICISED FOR BEING QUICK. Four of his six came in at
    //     347-365 against a 401 target, which is what a stride is for.
    expect(out.execution.summary).not.toMatch(/quicker|faster|ahead of/i);

    // 3 · ALL SIX ARE SHOWN, with the walk-backs.
    expect(out.strides).not.toBeNull();
    expect(out.strides!.recorded).toBe(6);
    expect(out.strides!.completed).toBe(6);
    expect(out.strides!.strides.map((r) => r.paceSecPerMi)).toEqual([401, 347, 349, 365, 350, 431]);
    expect(out.strides!.recoveryCount).toBe(6);

    // 4 · THREE QUANTITIES, ONE TOTAL. 6.41 = 5.98 structured + 0.43 overtime,
    //     and the mile table draws five of it.
    expect(out.capture.status).toBe('OVERTIME');
    expect(out.capture.totalDistanceMi).toBe(6.41);
    expect(out.capture.structuredDistanceMi).toBe(5.98);
    expect(out.capture.overtimeDistanceMi).toBe(0.43);
    expect(out.capture.splitCount).toBe(5);
    expect(out.capture.summary).toMatch(/run on after the last prescribed piece/);

    // 5 · AND THE STALE DRIFT IS NOT NARRATED, because the totals were fixed.
    expect(out.capture.correctedManually).toBe(true);
    expect(out.capture.summary).not.toMatch(/stopped counting/);

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
