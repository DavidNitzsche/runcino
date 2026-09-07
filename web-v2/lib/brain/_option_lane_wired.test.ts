/**
 * OPTIONLANE-1 · IS THE OPTION LANE ACTUALLY CALLED?
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `_orchestration.test.ts` ───────────────
 *
 * It exists because that gate was FALSIFIED and did not fail.
 *
 * `steps.ts` step 7 was flipped SHADOW → WIRED in the same change that added
 * `lib/brain/option-lane.ts`. To trust the flip (Rule 18) the wiring was then
 * broken on purpose — the `await import('@/lib/brain/option-lane')` in
 * `app/api/cron/run-adaptations/route.ts` was replaced with an inline stub —
 * and `_orchestration.test.ts` STILL REPORTED 9/9 PASSING.
 *
 * That is not a bug in that gate so much as the limit of what it asks. It
 * walks the import graph to the step's OWNER MODULE, and step 7's owner is
 * `lib/plan/adjudication/adjudicate.ts`, which is independently reachable
 * through `detectSimultaneousStressAddition` (live-sequence.ts → the same
 * cron). The module was reachable before this change and would stay reachable
 * if every line of the option lane were deleted. Its own header already
 * records the mirror-image version of this ("step 16 pointed at adjudicate.ts,
 * which IS reachable, and the gate correctly complained that an UNWIRED step
 * was reachable") — it catches UNWIRED-but-reachable, and it cannot catch
 * WIRED-but-nobody-calls-it.
 *
 * So the WIRED claim for step 7 rests on THIS file, which asserts the thing
 * the claim actually means: a production entry point calls `runOptionLane`,
 * and the lane calls `rankOptions`.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ────────────────────────────────────
 *
 * · WHETHER THE CALL EVER EXECUTES. It is inside a `try` in a per-runner loop
 *   and a runner with no due boundary reaches it and does nothing. This
 *   asserts the EDGE exists, not that it fired tonight. The runtime evidence
 *   for firing is the walk (`_organic_push_proofs.script.ts`), not this.
 * · WHETHER THE RANKING IS CORRECT. It asserts `rankOptions` is called, not
 *   that its answer is good.
 * · A RENAMED CRON. If the nightly entry point moves to another file, this
 *   fails loudly rather than silently passing — which is the intended
 *   direction, but it does mean a legitimate move has to update this list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** Block and line comments removed, so a scan sees CODE and not documentation. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The production entry points that must reach the lane. */
const ENTRY_POINTS = ['app/api/cron/run-adaptations/route.ts'] as const;

describe('OPTIONLANE-1 · the option lane has a production caller', () => {
  it('is liveness-checked: every file it scans is non-empty', () => {
    // Rule 18 · a scanner that reads nothing must not report clean.
    let scanned = 0;
    for (const f of [...ENTRY_POINTS, 'lib/brain/option-lane.ts']) {
      const src = read(f);
      expect(src.length).toBeGreaterThan(500);
      scanned += 1;
    }
    expect(scanned).toBe(ENTRY_POINTS.length + 1);
  });

  it('a production cron imports AND calls runOptionLane', () => {
    const hits = ENTRY_POINTS.filter((f) => {
      const src = read(f);
      return src.includes("import('@/lib/brain/option-lane')")
        && /\brunOptionLane\s*\(/.test(src);
    });
    expect(hits).toEqual([...ENTRY_POINTS]);
  });

  it('the lane is fed the rolling-boundary verdict rather than re-deriving one', () => {
    const src = read('app/api/cron/run-adaptations/route.ts');
    /* The verdict must be CAPTURED. Before OPTIONLANE-1 this call's return
     * value was discarded, which is the entire gap being closed: the boundary
     * resolved a real PROCEED and nothing downstream ever saw it. */
    expect(src).toMatch(/const\s+evaluated\s*=\s*await\s+evaluateDueRollingBoundariesForUser\(/);
    expect(src).toMatch(/runOptionLane\(\s*uid\s*,\s*today\s*,\s*evaluated\s*\)/);
  });

  it('the lane calls the step-7 owner rather than ranking options itself', () => {
    const src = read('lib/brain/option-lane.ts');
    expect(src).toMatch(/from '@\/lib\/plan\/adjudication\/adjudicate'/);
    expect(src).toMatch(/\brankOptions\s*\(/);
    /* Rule 16 · it must not grow its own scoring. `heuristicRankScore` is the
     * owner's, and a locally-defined weight table here would be a second
     * answer to "how do these options compare". */
    expect(src).not.toMatch(/const\s+stimulus\s*:/);
  });

  it('the lane reads the full 19-tag evidence record, not the six-tag slice', () => {
    const src = read('lib/brain/option-lane.ts');
    expect(src).toMatch(/\bclassifyEvidence\s*\(/);
    /* `completion.partial` and `completion.overrun` reached nothing anywhere
     * in the app before this lane. If this assertion ever fails, they are
     * decoration again and should be deleted rather than left. */
    expect(src).toMatch(/completion\.partial/);
    expect(src).toMatch(/completion\.overrun/);
  });

  it('the lane never reads or relaxes the authority seam', () => {
    /* COMMENTS STRIPPED FIRST, and that is the point rather than a nicety:
     * the lane's header discusses `AUTOMATIC_ADAPTATION_AUTHORITY` at length
     * to explain why it is NOT read, and a scan over raw source would fail on
     * the very prose that documents compliance. Asserting on code means this
     * still fails the moment the seam is genuinely imported or branched on. */
    const code = stripComments(read('lib/brain/option-lane.ts'));
    /* The seam may be NAMED — the ledger's `hold.blocker` string says which
     * blocker holds the decision, and that sentence is the audit trail. What
     * it may never be is IMPORTED or BRANCHED ON, which is the difference
     * between recording why the engine may not write and deciding that it
     * may. */
    expect(code).not.toMatch(/from\s+'@\/lib\/plan\/adaptation-authority'/);
    expect(code).not.toMatch(/import\s*\(\s*'@\/lib\/plan\/adaptation-authority'/);
    expect(code).not.toMatch(/if\s*\(\s*AUTOMATIC_ADAPTATION_AUTHORITY/);
    expect(code).not.toMatch(/\bmutatePlan\s*\(/);
    expect(code).not.toMatch(/UPDATE\s+plan_workouts/i);
    /* And the positive half: it DOES record a held decision and raise an
     * offer, through the owners for each. */
    expect(code).toMatch(/\brecordDecision\s*\(/);
    expect(code).toMatch(/\bwriteActionProposal\s*\(/);
    expect(code).toMatch(/authorityVerdict:\s*'HELD'/);
  });
});
