/**
 * lib/plan/_null_anchor_reachability.test.ts · IS THE LEGACY LEG STILL REACHED?
 *
 * AUTHORING-CANONICAL-1's cleanup asked a specific question: `buildWorkoutSpec`
 * carries a whole second pricing path — every band, every zone and every
 * offset it derives when its `anchors` argument is null — and if nothing
 * reaches it any more, it is 400 lines of second truth waiting for a caller
 * (Constitution §8, and `DOCTRINE_ENFORCEMENT` §"legacy VDOT-cascade paths get
 * deleted once migrated, never left as a comment someone will call anyway").
 *
 * THE ANSWER IS: IT IS STILL REACHED, by five callers, and this file is the
 * proof rather than the assertion. Deleting the leg today would break all
 * five. What this test does instead is PIN THE LIST, so it can only shrink —
 * the day it empties, the leg goes with it, and until then nobody has to
 * re-derive who is still on it.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ────────────────────────────────────────
 *
 *   · It is a SOURCE scan. A caller that reaches `buildWorkoutSpec` through a
 *     wrapper, or that passes `anchors` as a variable that happens to be null
 *     at runtime, is invisible to it. It counts positional argument shape, not
 *     runtime values.
 *   · It says nothing about whether those five callers SHOULD be on the legacy
 *     leg. Two of them (`adapt.ts`, `restore`) are open §G questions named in
 *     `scripts/check-goal-pace-leak.sh`'s allowlist; the other three are
 *     legitimate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const REPO = path.resolve(__dirname, '..', '..');

/**
 * Every non-test module that calls `buildWorkoutSpec`, and whether it supplies
 * the 12th argument (`anchors`).
 *
 * RATCHET: an entry may leave this list; nothing may join it without an
 * argument. A new caller on the legacy leg is a new second truth.
 */
const KNOWN_NULL_ANCHOR_CALLERS: Readonly<Record<string, string>> = {
  'lib/plan/adapt.ts':
    'ADAPT-TIME RESTORE. Rebuilds ONE row when a proposal is declined or a session is restored, and '
    + 'has no anchor set in scope. Phase 3 of the P0 order owns the adaptation path and re-points it '
    + 'at resolvePrescribedPaceAnchors; migrating it here would collide with that work. OPEN.',
  'lib/plan/progression-pass.ts':
    'PROGRESSION PROBE. Builds a candidate spec to measure a proposed overload step against, at a pace '
    + 'the caller already resolved. It compares two shapes at ONE pace, so the pricing layer is not the '
    + 'question it asks — but it should inherit the block anchors once adapt.ts carries them.',
  'lib/plan/intensity-distribution.ts':
    'ACCOUNTING, not prescription. Builds a spec purely to sum at-pace minutes for the TID check. The '
    + 'zone SHARES it computes are pace-independent, so the legacy offsets cannot move its verdict.',
  'lib/plan/seed-from-onboarding.ts':
    'THE ONBOARDING SEED, which runs BEFORE any capacity resolver has a runner to read. It is the one '
    + 'caller for which no canonical answer can exist yet, and it is exactly what the cold-start priors '
    + 'in capacity-resolver.ts are for once the first plan is authored.',
  'app/api/plan/restore/route.ts':
    'RESTORE. Rebuilds a single archived row from the plan\'s own stored anchors. Same open question as '
    + 'adapt.ts and the same owner.',
  'lib/plan/authoring-shadow-compare.ts':
    'SHADOW ONLY, AND DELIBERATE. Its legacy leg exists to reproduce the pre-migration pricing so the '
    + 'migration can be measured. It has no runtime importer (MODULE_ORPHANS) and cannot persist.',
  'app/api/admin/backfill-workout-spec/route.ts':
    'ADMIN BACKFILL for historical rows whose spec was never written. It reconstructs what the row WAS '
    + 'priced at, which is the legacy pricing by definition.',
};

/** Callers that DO supply anchors — the migrated set. Also pinned, so a
 *  regression that drops the argument shows up as a caller moving from this
 *  list to the one above rather than as silence. */
const KNOWN_ANCHORED_CALLERS: readonly string[] = [
  'lib/plan/generate.ts',
  'lib/plan/recompute-paces.ts',
  'lib/plan/reanchor-plan.ts',
];

describe('the null-anchor legacy leg in spec-builder.ts', () => {
  const callers = (() => {
    const out = execSync(
      "grep -rln 'buildWorkoutSpec(' lib app || true",
      { cwd: REPO, encoding: 'utf8' },
    );
    return out.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => f !== 'lib/plan/spec-builder.ts')
      // The audit/doctrine trees describe the signature, they do not price a
      // plan with it.
      .filter((f) => !f.startsWith('lib/audit/') && !f.startsWith('lib/doctrine/'));
  })();

  it('liveness · the scan found the callers it is supposed to reason about', () => {
    // Rule 18 · a scanner that reads nothing reports clean.
    expect(callers.length).toBeGreaterThanOrEqual(8);
    expect(readFileSync(path.join(REPO, 'lib/plan/spec-builder.ts'), 'utf8').length).toBeGreaterThan(50000);
  });

  it('the leg is STILL REACHED, so it may not be deleted — and every caller is named', () => {
    const unexplained = callers.filter(
      (f) => !(f in KNOWN_NULL_ANCHOR_CALLERS) && !KNOWN_ANCHORED_CALLERS.includes(f),
    );
    expect(
      unexplained,
      'a new caller of buildWorkoutSpec is not accounted for · say whether it supplies the canonical '
      + 'anchors or reaches the legacy leg, and why',
    ).toEqual([]);

    // The whole point: the leg has live callers. If this ever reaches zero the
    // leg should be deleted in the same change that empties it.
    const stillOnLegacy = callers.filter((f) => f in KNOWN_NULL_ANCHOR_CALLERS);
    expect(stillOnLegacy.length).toBeGreaterThan(0);
  });

  it('RATCHET · a declared null-anchor caller that has migrated must be removed from the list', () => {
    // A stale exemption fails until deleted (Rule 18 point 4). If a file in
    // KNOWN_NULL_ANCHOR_CALLERS no longer calls buildWorkoutSpec at all, the
    // entry is describing nothing.
    const gone = Object.keys(KNOWN_NULL_ANCHOR_CALLERS).filter((f) => !callers.includes(f));
    expect(
      gone,
      'these files are listed as null-anchor callers of buildWorkoutSpec and no longer call it · '
      + 'delete the entries',
    ).toEqual([]);
  });

  it('the three migrated callers still pass the anchors argument', () => {
    for (const f of KNOWN_ANCHORED_CALLERS) {
      const src = readFileSync(path.join(REPO, f), 'utf8');
      expect(
        /anchors,?\s*\n?\s*\)/.test(src) || /anchors ?\?\? null,/.test(src) || /args\.anchors ?\?\? null,/.test(src),
        `${f} no longer threads the canonical anchors into buildWorkoutSpec · it has fallen back onto `
        + 'the legacy pricing leg',
      ).toBe(true);
    }
  });
});
