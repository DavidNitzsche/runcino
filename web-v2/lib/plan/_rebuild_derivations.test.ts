/**
 * ANCHOR-STALE-3 (2026-08-30) · CLAUDE.md Rule 10 · the HR anchors
 * `adapt.ts:rebuildWorkoutDerivations` feeds `buildWorkoutSpec`.
 *
 * THE DEFECT. `rebuildWorkoutDerivations` fires on `tempo` / `threshold` /
 * `intervals` rows after a shave and rebuilds `workout_spec` from
 * (type, distance, T-pace). It passed a literal `null` for BOTH HR anchors,
 * under the note that "the next briefing/render will re-load HR anchors
 * through the standard pipeline."
 *
 * Nothing does. Rendering and briefing are READ paths; no read path writes
 * `workout_spec`. And `preserveProgressionSql` carries forward exactly one key
 * (`overload_progression`) — every other key is replaced wholesale. So the
 * rebuild did not leave the HR numbers STALE, it DELETED them, and a spec with
 * no HR fields is perfectly well-formed, so nothing failed. This is the same
 * false claim, in the same words, that `recompute-paces.ts` carried until
 * `db3fb5e7`.
 *
 * WHAT IS LOCKED HERE. The live anchors need a database, so what this pins is
 * the CONTRACT the fix rests on, at the seam it actually crosses — what
 * `buildWorkoutSpec` does with each pair of anchors for exactly the three types
 * the function gates on:
 *
 *   1. THE WIPE     — the old `(null, null)` call is reproduced and shown to
 *                     carry no HR at all. This is the test that would have
 *                     caught the defect, so it is written first.
 *   2. MOVEMENT     — at 162 (the owner's live `profile.lthr`) and at 168 (the
 *                     re-derived anchor) every HR number is present and the two
 *                     differ. A fix that read the live anchor and produced the
 *                     same output either way would not be a fix.
 *   3. MAXHR INERT  — the honest scope of the second anchor: for these three
 *                     types the spec is byte-identical with and without HRmax,
 *                     because only `hrCapEasy` / `raceAbortHrBpm` read it. It
 *                     is passed for writer symmetry, and this test is what
 *                     stops that claim from rotting silently if a branch later
 *                     starts reading it.
 *   4. CONVERGENCE  — the rebuild and the recompute are the two writers of
 *                     these columns. At one anchor they must produce one spec.
 *
 * Cite: Research/03-heart-rate-zones.md §6 (Friel Z2 ceiling · 89% LTHR); the
 * pass/bail derivation lives in `spec-builder.ts`'s `contingencyRules`.
 */
import { describe, it, expect } from 'vitest';
import { buildWorkoutSpec } from './spec-builder';

/** Exactly the types `rebuildWorkoutDerivations` gates on. */
const REBUILT_TYPES = ['tempo', 'threshold', 'intervals'] as const;

/** The owner's stored anchor, and the value the race-evidence re-anchor moves it to. */
const STORED_LTHR = 162;
const REANCHORED_LTHR = 168;
/** The owner's live effective HRmax (`loadEffectiveMaxHr`), not `users.max_hr` (181). */
const EFFECTIVE_MAX_HR = 180;

const build = (type: string, lthr: number | null, maxHr: number | null) =>
  buildWorkoutSpec(type, 6, 400, lthr, null, maxHr).spec as Record<string, unknown>;

/** The HR-bearing surface of a spec: the anchors plus the contingency rules. */
const hrOf = (spec: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(spec).filter(([k]) => /hr|rules/.test(k)));

/** The single HR number each type carries: tempo targets, the other two anchor. */
const hrFieldFor = (type: string) => (type === 'tempo' ? 'hr_target_bpm' : 'lthr_bpm');

describe('ANCHOR-STALE-3 · rebuildWorkoutDerivations HR anchors', () => {
  it('THE WIPE · the old (null, null) call carried no HR at all', () => {
    for (const type of REBUILT_TYPES) {
      const spec = build(type, null, null);
      expect(spec[hrFieldFor(type)], `${type} kept an HR anchor it cannot have`).toBeNull();
      // The pass/bail rules the watch reads mid-session are derived from LTHR,
      // so a null threshold removes them from the spec entirely. Their ABSENCE
      // is the half of this defect that no shape check could ever see.
      expect(spec.rules, `${type} kept contingency rules with no threshold`).toBeUndefined();
    }
  });

  it('MOVEMENT · at 162 the HR numbers exist, and at 168 every one of them moves', () => {
    for (const type of REBUILT_TYPES) {
      const at162 = build(type, STORED_LTHR, EFFECTIVE_MAX_HR);
      const at168 = build(type, REANCHORED_LTHR, EFFECTIVE_MAX_HR);
      expect(at162[hrFieldFor(type)], `${type} carries no HR at the live anchor`).not.toBeNull();
      expect(JSON.stringify(hrOf(at168)), `${type} did not move with the anchor`)
        .not.toBe(JSON.stringify(hrOf(at162)));
      expect(Array.isArray(at162.rules) && (at162.rules as unknown[]).length).toBe(2);
    }

    // The exact numbers, read off the two anchors rather than asserted as a
    // shape. These are the same values `recompute-paces.ts` produces — see
    // CONVERGENCE below — so a drift in either writer fails here.
    expect(build('tempo', STORED_LTHR, EFFECTIVE_MAX_HR).hr_target_bpm).toBe(149);
    expect(build('tempo', REANCHORED_LTHR, EFFECTIVE_MAX_HR).hr_target_bpm).toBe(155);
    expect(build('threshold', STORED_LTHR, EFFECTIVE_MAX_HR).lthr_bpm).toBe(162);
    expect(build('threshold', REANCHORED_LTHR, EFFECTIVE_MAX_HR).lthr_bpm).toBe(168);
    expect(build('intervals', STORED_LTHR, EFFECTIVE_MAX_HR).lthr_bpm).toBe(162);
    expect(build('intervals', REANCHORED_LTHR, EFFECTIVE_MAX_HR).lthr_bpm).toBe(168);

    // The work-pass gate and the bail, which are what the watch acts on.
    const ruleValues = (spec: Record<string, unknown>) =>
      (spec.rules as Array<{ kind: string; value: number }>).map((r) => `${r.kind}:${r.value}`);
    expect(ruleValues(build('threshold', STORED_LTHR, EFFECTIVE_MAX_HR)))
      .toEqual(['pass:158', 'bail:167']);
    expect(ruleValues(build('threshold', REANCHORED_LTHR, EFFECTIVE_MAX_HR)))
      .toEqual(['pass:164', 'bail:173']);
  });

  it('MAXHR INERT · for these three types HRmax changes nothing, at either anchor', () => {
    // The honest scope of the second anchor. `hrCapEasy` (easy/long/recovery)
    // and `raceAbortHrBpm` (race) are its only readers, and none of the three
    // rebuilt types reaches either. If a branch ever starts reading it, this
    // fails and the claim at the call site gets rewritten instead of rotting.
    for (const type of REBUILT_TYPES) {
      for (const lthr of [STORED_LTHR, REANCHORED_LTHR]) {
        expect(JSON.stringify(build(type, lthr, EFFECTIVE_MAX_HR)), `${type}@${lthr}`)
          .toBe(JSON.stringify(build(type, lthr, null)));
      }
    }
  });

  it('CONVERGENCE · the rebuild and the recompute agree at one anchor', () => {
    // `recomputePacesForPlan` calls `buildWorkoutSpec` with the same first six
    // positional arguments and then four more that default. The rebuild passes
    // six. If those defaults ever stop matching, the two writers of
    // `workout_spec.lthr_bpm` diverge and a shaved row starts describing a
    // different runner than the row beside it — the fork class this codebase
    // has already paid for twice.
    for (const type of REBUILT_TYPES) {
      const rebuild = buildWorkoutSpec(type, 6, 400, STORED_LTHR, null, EFFECTIVE_MAX_HR).spec;
      const recompute = buildWorkoutSpec(
        type, 6, 400, STORED_LTHR, null, EFFECTIVE_MAX_HR, null, null, null, false, null,
      ).spec;
      expect(JSON.stringify(rebuild), `${type} · rebuild and recompute disagree`)
        .toBe(JSON.stringify(recompute));
    }
  });
});
