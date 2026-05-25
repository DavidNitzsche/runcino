/**
 * V7 item 3 · V3 trajectory → C8 substitution menu cross-reference.
 *
 * The relation is 'tied to' (structural).  These tests lock the
 * semantic discipline check David called out:
 *
 *   "If V3 state changes BEHIND → ON TRACK, does C8's default option
 *    change in the same render cycle? Yes = tied to. No = consistent
 *    with."
 *
 * The "BEHIND → ON TRACK same render" test below proves the relation
 * is structural, V3 state literally changes the menu output.  Without
 * that, the relation would have to be downgraded to 'consistent with'.
 */
import { describe, expect, it } from 'vitest';
import { buildSubstitutionMenu } from '../workout-substitutions';

describe('buildSubstitutionMenu · trajectory-BEHIND structural derivation', () => {
  it('TIED-TO SEMANTIC CHECK · BEHIND → ON-TRACK changes output in same render', () => {
    // The discipline test for 'tied to' (structural derivation).
    // If toggling trajectoryBehind doesn't change the menu output,
    // the relation isn't structural and must be downgraded to
    // 'consistent with' (or no cross-reference at all).
    const behindMenu = buildSubstitutionMenu('threshold', 'Cruise Intervals', 7, true);
    const ontrackMenu = buildSubstitutionMenu('threshold', 'Cruise Intervals', 7, false);

    // Same workout, same distance, ONLY trajectory state differs.
    // The output MUST differ for 'tied to' to be honest.
    expect(behindMenu.recommendedIndex).not.toBe(ontrackMenu.recommendedIndex);
    expect(behindMenu.crossRef).toBeDefined();
    expect(ontrackMenu.crossRef).toBeUndefined();
  });

  it('quality workout + BEHIND → recommendedIndex=0 (half-volume quality wins)', () => {
    const out = buildSubstitutionMenu('threshold', 'Threshold · HM Tempo', 7, true);
    expect(out.recommendedIndex).toBe(0);
    expect(out.substitutions[0].label).toBe('Half-volume quality');
    expect(out.crossRef?.text).toBe('tied to the trajectory read on /races');
    expect(out.crossRef?.href).toBe('/races#trajectory-read');
  });

  it('long workout + BEHIND → recommendedIndex=0 (shorter long run wins)', () => {
    const out = buildSubstitutionMenu('long', 'Long Run · Progression', 14, true);
    expect(out.recommendedIndex).toBe(0);
    expect(out.substitutions[0].label).toBe('Shorter long run');
    expect(out.crossRef).toBeDefined();
  });
});

describe('buildSubstitutionMenu · relevance check (earned, not decorative)', () => {
  it('easy workout + BEHIND → NO recommendation (easy days have no quality to protect)', () => {
    // The relevance check rejects topic overlap that isn't actionable.
    // V3 BEHIND only matters when today's workout has quality at stake.
    const out = buildSubstitutionMenu('easy', 'Easy', 5, true);
    expect(out.recommendedIndex).toBeNull();
    expect(out.crossRef).toBeUndefined();
  });

  it('race day + BEHIND → NO recommendation (race day isn\'t skippable)', () => {
    const out = buildSubstitutionMenu('race', 'Race Day', 13.1, true);
    expect(out.recommendedIndex).toBeNull();
    expect(out.crossRef).toBeUndefined();
  });

  it('quality workout + NOT behind → NO recommendation (no trajectory pressure)', () => {
    const out = buildSubstitutionMenu('intervals', 'Intervals', 6, false);
    expect(out.recommendedIndex).toBeNull();
    expect(out.crossRef).toBeUndefined();
  });

  it('long workout + NOT behind → NO recommendation', () => {
    const out = buildSubstitutionMenu('long', 'Long Run', 12, false);
    expect(out.recommendedIndex).toBeNull();
    expect(out.crossRef).toBeUndefined();
  });

  it('default param (no trajectory passed) → behaves like NOT behind', () => {
    // Backward-compatible: callers that don't know about trajectory
    // still get a valid menu, just with no recommendation.
    const out = buildSubstitutionMenu('threshold', 'Tempo', 7);
    expect(out.recommendedIndex).toBeNull();
    expect(out.crossRef).toBeUndefined();
  });
});

describe('buildSubstitutionMenu · cross-reference shape', () => {
  it('uses "tied to" relation (structural, not consistent-with)', () => {
    const out = buildSubstitutionMenu('long', 'Long', 10, true);
    // 'tied to' is grammatically symmetric (object position), unlike
    // 'contributing to' which inverts subject.  Check the prefix.
    expect(out.crossRef!.text.startsWith('tied to')).toBe(true);
  });

  it('href deep-links to #trajectory-read anchor on /races', () => {
    const out = buildSubstitutionMenu('threshold', 'Tempo', 7, true);
    expect(out.crossRef!.href).toBe('/races#trajectory-read');
  });

  it('keeps existing substitution array unchanged, only adds metadata', () => {
    // Critical: V3 state DOESN'T change the list of options or their
    // order.  It changes the RECOMMENDATION metadata on top of the
    // unchanged list.  This keeps the substitutions stable while
    // letting V3 inform what to do with them.
    const behind = buildSubstitutionMenu('threshold', 'Tempo', 7, true);
    const normal = buildSubstitutionMenu('threshold', 'Tempo', 7, false);
    expect(behind.substitutions.length).toBe(normal.substitutions.length);
    expect(behind.substitutions.map((s) => s.label)).toEqual(
      normal.substitutions.map((s) => s.label),
    );
  });
});
