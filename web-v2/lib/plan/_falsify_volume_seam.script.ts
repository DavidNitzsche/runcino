/**
 * lib/plan/_falsify_volume_seam.script.ts
 *
 * RULE 18, EXECUTED, for VOLUMESEAM-1. "A gate is not trusted until it has been
 * made to fail."
 *
 * Same shape and same exemption as
 * `lib/adaptation/volume-evidence/_falsify_mileage_responsive.script.ts`: it is
 * a `.script.ts` rather than a `.test.ts` BECAUSE IT MUTATES SOURCE FILES on
 * purpose, and a normal `npm test` run must never rewrite files underneath
 * itself. Each case plants one violation into one source file, runs
 * `_volume_seam.test.ts` against the mutated tree, asserts the suite FAILED and
 * that the failure names the right thing, restores the file in a `finally`, and
 * verifies the restoration BYTE FOR BYTE.
 *
 *     npm --prefix web-v2 run falsify:volume-seam
 *
 * ── WHY EACH PLANT IS THE ONE IT IS ───────────────────────────────────────
 *
 * The first four are the claims that were FALSE before this change, so they are
 * the ones most worth proving a gate can see. The rest are defects this repo
 * has already shipped once, pointed at the new seam:
 *
 *  1 · UNWIRE THE CRON. The whole finding: nine modules with no production
 *      caller. If the gate cannot notice the import going away, it cannot
 *      notice the orphan coming back.
 *  2 · RENAME THE RECOMPUTE. `demonstratedLoadAfterEachWeek` was a promise in a
 *      header for three days. Rule 20's corollary: gate the claim or delete the
 *      sentence, and this is the gate.
 *  3 · RE-LIST THE ORPHANS. The registry's own staleness half, from the other
 *      direction: an entry claiming "no production importer" about a module
 *      that has one.
 *  4 · NAME A PLAN WRITER IN THE LANE. The authority boundary, which is the one
 *      thing in this change that could actually hurt the runner.
 *  5 · RESTORE THE BINARY ADMISSION BAR. Rule 9's own incident, in the owner's
 *      words: a week 0.4 mi short of a bar contributed zero.
 *  6 · UNCAP THE ENORMOUS OVERRUN. "One extreme overrun does not establish
 *      sustainable capacity" becomes false the moment the saturation goes.
 *  7 · SPEND A RECOVERY WEEK AS NORMAL. Rule 8's own incident, six times over,
 *      and on this account the two LARGEST surpluses of the year are recovery
 *      weeks.
 *  8 · COUNT A MERGED ROW AS VOLUME. Rule 14's own incident. 112 merged rows
 *      sit inside this lane's window on the reference account.
 *  9 · RAISE A CUTBACK WEEK. The owner's step 6, verbatim: "More mileage this
 *      week must not make every later week larger."
 * 10 · FLATTEN RECENCY. Makes four weeks worth exactly what one week is worth,
 *      which breaks accumulation without breaking any single reading — the
 *      quiet shape a point-sampling gate misses.
 *
 * ── RULE 22 · WHAT THIS FALSIFIER CANNOT TELL YOU ─────────────────────────
 *
 * It proves the gate NOTICES ten specific breakages. It says nothing about the
 * breakages nobody thought to plant, and it cannot tell a gate that fails for
 * the right reason from one that fails for an adjacent one, beyond the message
 * fragment each case asserts. It also cannot plant a defect in the LOADER,
 * because `_volume_seam.test.ts` deliberately does not depend on it — that gap
 * is stated in the suite's own header and is covered by the production probe
 * instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const WEB = path.resolve(__dirname, '..', '..');
const SUITE = 'lib/plan/_volume_seam.test.ts';

/** Run the suite. Returns `{ ok, output }` and never throws on a red run. */
function runSuite(): { ok: boolean; output: string } {
  try {
    const out = execFileSync('npx', ['vitest', 'run', SUITE], {
      cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000,
    });
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}

interface Edit {
  /** Relative to `web-v2`. */
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

interface Plant {
  readonly name: string;
  /**
   * EVERY site the property is defended at, not one of them.
   *
   * A one-line plant is the right shape for a property with one owner, and the
   * WRONG shape for one defended in depth: plant 8 below stayed green through
   * two separate single-site drafts because the merged-row predicate is
   * applied at three layers, and removing any one of them changes no outcome.
   * A falsifier that reports "the gate did not notice" in that situation is
   * reporting on itself, not on the gate. So a plant may name several edits
   * and they are applied together.
   */
  readonly edits: readonly Edit[];
  /** A fragment the red run must contain, so the gate fails for the RIGHT reason. */
  readonly expectNames: string;
}

const one = (file: string, find: string, replace: string): Edit[] => [{ file, find, replace }];

const PLANTS: readonly Plant[] = [
  {
    name: '1 · the cron stops calling the lane (the orphan returns)',
    edits: one('app/api/cron/run-adaptations/route.ts',
      '        : await runVolumeEvidenceLane(uid);',
      '        : 0; void runVolumeEvidenceLane;'),
    expectNames: 'runVolumeEvidenceLane(',
  },
  {
    name: '2 · `demonstratedLoadAfterEachWeek` stops being exported under that name',
    edits: one('lib/adaptation/volume-evidence/after-each-week.ts',
      'export function demonstratedLoadAfterEachWeek(input: RecomputeInput)',
      'export function demonstratedLoadAfterEachWeekX(input: RecomputeInput)'),
    expectNames: 'demonstratedLoadAfterEachWeek',
  },
  {
    name: '3 · the orphan registry re-lists a module that now has a caller',
    edits: one('lib/audit/generated-content-registry.ts',
      "  'web-v2/lib/adaptation/volume-evidence/_replay_real_history.script.ts':",
      "  'web-v2/lib/adaptation/volume-evidence/respond.ts':\n"
      + "    'A deliberately stale claim planted by _falsify_volume_seam.script.ts, asserting this "
      + "module has no production importer when it does. If nothing fails, the registry has "
      + "stopped meaning anything.',\n"
      + "  'web-v2/lib/adaptation/volume-evidence/_replay_real_history.script.ts':"),
    expectNames: 'respond.ts',
  },
  {
    name: '4 · the lane names a plan writer (the authority boundary)',
    edits: one('lib/plan/volume-evidence-proposal.ts',
      '  const cards = await writeWorkoutProposals(userUuid, [decision.action], [decision.trigger]);',
      '  const applyAdaptations = writeWorkoutProposals;\n'
      + '  const cards = await applyAdaptations(userUuid, [decision.action], [decision.trigger]);'),
    expectNames: 'applyAdaptations',
  },
  {
    name: '5 · the binary admission bar comes back (Rule 9\'s cliff)',
    edits: one('lib/adaptation/volume-evidence/weight.ts',
      '  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC);',
      '  return surplusFrac < PER_WEEK_CREDIT_CEILING_FRAC\n'
      + '    ? 0 : PER_WEEK_CREDIT_CEILING_FRAC;'),
    expectNames: 'continuous',
  },
  {
    name: '6 · one enormous overrun is no longer capped',
    edits: one('lib/adaptation/volume-evidence/weight.ts',
      '  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC);',
      '  return gpsNoiseGate(surplusFrac) * surplusFrac;'),
    expectNames: 'capped',
  },
  {
    name: '7 · a recovery week is spent as the runner\'s normal (Rule 8)',
    edits: one('lib/adaptation/volume-evidence/classify.ts',
      "  if (w.authoredPlanMode === 'RECOVERY') return 'AUTHORED_RECOVERY_BLOCK';",
      "  if (false) return 'AUTHORED_RECOVERY_BLOCK';"),
    expectNames: 'Rule 8',
  },
  /* 8 AND 11 · RULE 14, AT THE TWO SITES THAT ACTUALLY BIND.
   *
   * The first draft of plant 8 targeted `classifyRun`'s own
   * `if (run.mergedIntoAnother)` branch — the same string
   * `_falsify_mileage_responsive.script.ts` plants — and THE SUITE STAYED
   * GREEN. That is the falsifier doing its job: the merged predicate is
   * defence in depth, and `classifyRun`'s branch is the THIRD layer. The two
   * that bind for a caller reading a whole week are
   * `classifyWeekSurplus`'s `canonical` filter (the capacity channel) and
   * `readFatigue`'s (the fatigue channel), and a gate that only ever saw the
   * third layer would have reported clean while duplicates trained the runner.
   *
   * Both channels are planted separately, because the owner's requirement is
   * that a duplicate affects NEITHER, and one plant cannot prove two. */
  {
    name: '8 · a merged row is counted as volume · the CAPACITY channel (Rule 14)',
    edits: [
      { file: 'lib/adaptation/volume-evidence/classify.ts',
        find: '  const canonical = input.runs.filter((r) => !r.mergedIntoAnother);',
        replace: '  const canonical = input.runs;' },
      { file: 'lib/adaptation/volume-evidence/classify.ts',
        find: '  if (run.mergedIntoAnother) {',
        replace: '  if (false && run.mergedIntoAnother) {' },
      { file: 'lib/adaptation/volume-evidence/after-each-week.ts',
        find: '    if (r.mergedIntoAnother) continue;',
        replace: '    if (false) continue;' },
    ],
    expectNames: 'Rule 14',
  },
  {
    name: '9 · a cutback week is raised with the weeks around it (step 6)',
    edits: one('lib/adaptation/volume-evidence/respond.ts',
      '    if (w.isCutback) {',
      '    if (false) {'),
    expectNames: 'cutback',
  },
  {
    name: '11 · a merged row is counted as load · the FATIGUE channel (Rule 14)',
    edits: one('lib/adaptation/volume-evidence/evidence.ts',
      '  const canonical = input.runs.filter((r) => !r.mergedIntoAnother);',
      '  const canonical = input.runs;'),
    expectNames: 'Rule 14',
  },
  {
    name: '10 · recency is flattened, so accumulation stops accumulating',
    edits: one('lib/adaptation/volume-evidence/evidence.ts',
      '    const contributed = r.confirmedUnits * recency;',
      '    const contributed = totalUnits > 0 ? 0 : r.confirmedUnits * recency;'),
    expectNames: 'accumulat',
  },
];

describe('RULE 18 · every guard over the volume seam has been made to fail', () => {
  it('the suite is GREEN before anything is planted (liveness)', () => {
    const r = runSuite();
    expect(r.ok, `the suite must be green before falsification:\n${r.output.slice(-4000)}`).toBe(true);
    // A falsifier that runs against an already-red suite proves nothing, and a
    // falsifier whose suite has zero tests proves less than nothing.
    expect(r.output).toMatch(/Tests\s+\d+ passed/);
  }, 900_000);

  for (const plant of PLANTS) {
    it(`FAILS when planted: ${plant.name}`, () => {
      const originals = new Map<string, string>();
      for (const e of plant.edits) {
        const abs = path.join(WEB, e.file);
        if (!originals.has(abs)) originals.set(abs, readFileSync(abs, 'utf8'));
        expect(originals.get(abs)!.includes(e.find),
          `plant target missing in ${e.file}: ${e.find}`).toBe(true);
      }
      let red: { ok: boolean; output: string };
      try {
        const mutated = new Map(originals);
        for (const e of plant.edits) {
          const abs = path.join(WEB, e.file);
          mutated.set(abs, mutated.get(abs)!.replace(e.find, e.replace));
        }
        for (const [abs, src] of mutated) writeFileSync(abs, src, 'utf8');
        red = runSuite();
      } finally {
        for (const [abs, src] of originals) writeFileSync(abs, src, 'utf8');
      }
      // BYTE FOR BYTE. A falsifier that leaves the tree mutated is worse than
      // no falsifier at all.
      for (const [abs, src] of originals) expect(readFileSync(abs, 'utf8')).toBe(src);

      expect(red.ok, `PLANT DID NOT FAIL: ${plant.name}\n${red.output.slice(-4000)}`).toBe(false);
      expect(
        red.output.toLowerCase().includes(plant.expectNames.toLowerCase()),
        `the suite failed but did not name "${plant.expectNames}":\n${red.output.slice(-4000)}`,
      ).toBe(true);
    }, 900_000);
  }

  it('and the suite is GREEN again afterwards', () => {
    const r = runSuite();
    expect(r.ok, `the tree was not restored:\n${r.output.slice(-4000)}`).toBe(true);
  }, 900_000);
});
