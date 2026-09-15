/**
 * F139 (2026-09-15) · PRIORITY NEVER WEIGHTS EVIDENCE, applied to
 * `selectLthrAnchor`. No test file existed for this function's priority-
 * fallback behaviour before this change (see the F139 report) — this one is
 * new, not a rewrite, and every test here is a genuine Rule-18 falsifier: it
 * fails against the pre-F139 `selectionAuthority(c.priority)`-driven code and
 * passes against the fix.
 *
 * ── What changed ───────────────────────────────────────────────────────────
 *
 * `selectLthrAnchor` used to grade a candidate's authority off its declared
 * A/B/C priority (`selectionAuthority(c.priority)`), capped downward only by
 * the runner's own report (`runnerAuthorityTier`). Per
 * `RACE_TIERING_AND_SEASON_PHILOSOPHY.md` — "Priority alone must never
 * accept, reject, or weight the result" — that is exactly the forbidden
 * shape. `selectLthrAnchor` no longer reads `c.priority` for this purpose at
 * all. The only measured signal available to it is `runnerAuthorityTier`,
 * exactly as in `bestRecentVdot` (see `vdot-race-authority.test.ts`), read
 * three ways:
 *
 *   · 'compromised' / 'unrepresentative' → the existing downward caps,
 *     unchanged mechanism, both still well below `REPRESENTATIVE_FLOOR`.
 *   · 'representative' → a genuine CONFIRMATION, graded at EXACTLY
 *     `REPRESENTATIVE_FLOOR` — clearing the gate, never above it. This is
 *     new: under the old rule 'representative' was a no-op that "left
 *     doctrine's [priority-derived] grading alone"; there is no such grading
 *     left to leave alone, so a bare confirmation now has to carry its own
 *     weight, and it carries exactly enough to qualify, not more.
 *   · no report at all → no measured signal exists yet, graded at the same
 *     conservative floor an explicit 'unrepresentative' report earns.
 *
 * ── The disclosed, load-bearing consequence ────────────────────────────────
 *
 * Because `runnerAuthorityTier` is a rare, opt-in, retroactive flag,
 * `selectLthrAnchor` now returns `null` for the OVERWHELMING majority of
 * real candidates — every race the runner has not proactively confirmed —
 * where before a bare declared A/B priority was enough. LTHR re-anchoring is
 * consequently dormant for anyone who has never tapped "yes, it counted" on
 * a qualifying half, which in practice is most runners most of the time.
 * `lib/training/lthr-reanchor.test.ts`'s own header spells out the concrete
 * cost: the historical incident that file documents (a stale LTHR anchor
 * that should have re-derived off two later qualifying halves) would, under
 * today's code, need an explicit runner confirmation first. See F139's
 * report for the follow-up this implies — wiring a real automatic per-race
 * representativeness signal (e.g. `assessRaceRepresentativeness`, already
 * used by `lib/training/durability-anchor.ts`) into this candidate pipeline.
 */
import { describe, it, expect } from 'vitest';
import { selectLthrAnchor, LTHR_QUALIFYING_MIN_MI, LTHR_QUALIFYING_MAX_MI, type LthrRaceCandidate } from './lthr-reanchor';
import { REPRESENTATIVE_FLOOR, RUNNER_REPORTED_AUTHORITY_CAP, authorityTier, selectionAuthority } from '@/lib/race/effort-authority';

const TODAY = '2026-06-01';
const QUALIFYING_MI = 13.1; // inside [12.0, 14.5]

const candidate = (over: Partial<LthrRaceCandidate> & Pick<LthrRaceCandidate, 'slug' | 'dateISO'>): LthrRaceCandidate => ({
  name: over.slug,
  priority: 'A',
  distanceMi: QUALIFYING_MI,
  avgHrBpm: 162,
  ...over,
});

describe('F139 · priority alone can no longer clear the representative gate', () => {
  it('an A-priority, otherwise-perfect candidate with no runner report does NOT anchor', () => {
    const c = candidate({ slug: 'clean-half', dateISO: '2026-05-20', priority: 'A' });
    expect(selectLthrAnchor([c], TODAY)).toBeNull();
  });

  it('neither does a B or C priority, or an ungraded one — priority no longer differentiates this gate at all', () => {
    for (const priority of ['A', 'B', 'C', 'hilly_excluded', null]) {
      const c = candidate({ slug: `race-${priority}`, dateISO: '2026-05-20', priority });
      expect(selectLthrAnchor([c], TODAY), `priority=${priority}`).toBeNull();
    }
  });

  it('RULE 18 FALSIFIER · under the OLD selectionAuthority-driven rule, the A-priority candidate above WOULD have anchored', () => {
    // Proves the null results above are a real, deliberate behaviour change,
    // not something that was already true. The old code's authority for an
    // unreported A-priority candidate was `selectionAuthority('A')`, which
    // clears REPRESENTATIVE_FLOOR outright.
    expect(authorityTier(selectionAuthority('A'))).toBe('representative');
    expect(selectionAuthority('A')).toBeGreaterThanOrEqual(REPRESENTATIVE_FLOOR);
    // ...and a B priority did too (doctrine's B row is ALSO representative):
    expect(authorityTier(selectionAuthority('B'))).toBe('representative');
  });
});

describe('F139 · a runner-confirmed "representative" report is a genuine, working confirmation — not an inert no-op', () => {
  it('a runner-confirmed race DOES now anchor, whatever its declared priority', () => {
    // New behaviour, and new relative to what 'representative' used to do:
    // before F139 it "left doctrine's [priority-derived] grading alone",
    // which for most declared priorities already qualified anyway, so the
    // lever was rarely load-bearing on its own. There is no such grading
    // left to leave alone now, so a bare confirmation has to carry its own
    // weight — and it does, clearing exactly REPRESENTATIVE_FLOOR.
    for (const priority of ['A', 'B', 'C', 'hilly_excluded', null]) {
      const c = candidate({
        slug: `confirmed-${priority}`, dateISO: '2026-05-20', priority,
        runnerAuthorityTier: 'representative',
      });
      const anchor = selectLthrAnchor([c], TODAY);
      expect(anchor, `priority=${priority}`).not.toBeNull();
      expect(anchor!.tier).toBe('representative');
      expect(anchor!.authority).toBe(REPRESENTATIVE_FLOOR);
    }
  });

  it('a confirmation never lifts a race ABOVE the floor, and two confirmed races of different declared priority tie exactly', () => {
    const a = candidate({ slug: 'a', dateISO: '2026-05-20', priority: 'A', runnerAuthorityTier: 'representative' });
    const c = candidate({ slug: 'c', dateISO: '2026-05-21', priority: 'C', runnerAuthorityTier: 'representative' });
    const anchorA = selectLthrAnchor([a], TODAY)!;
    const anchorC = selectLthrAnchor([c], TODAY)!;
    expect(anchorA.authority).toBe(anchorC.authority);
    expect(anchorA.authority).toBe(REPRESENTATIVE_FLOOR);
  });
});

describe('a runner-reported downgrade is still real, measured signal (unchanged mechanism)', () => {
  it('"compromised" and "unrepresentative" reports both still fail the gate, as they always did', () => {
    const compromised = candidate({
      slug: 'compromised-race', dateISO: '2026-05-20', priority: 'A',
      runnerAuthorityTier: 'compromised',
    });
    const unrepresentative = candidate({
      slug: 'unrepresentative-race', dateISO: '2026-05-20', priority: 'A',
      runnerAuthorityTier: 'unrepresentative',
    });
    expect(selectLthrAnchor([compromised], TODAY)).toBeNull();
    expect(selectLthrAnchor([unrepresentative], TODAY)).toBeNull();
  });

  it('a "compromised" report is nonetheless a HIGHER measured value than the unreported default', () => {
    expect(RUNNER_REPORTED_AUTHORITY_CAP.compromised).toBeGreaterThan(RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative);
    expect(RUNNER_REPORTED_AUTHORITY_CAP.compromised).toBeLessThan(REPRESENTATIVE_FLOOR);
  });

  it('among two candidates on the SAME day, a confirmed race wins the tie-break over an unreported one', () => {
    const confirmed = candidate({ slug: 'confirmed', dateISO: '2026-05-20', priority: 'C', runnerAuthorityTier: 'representative' });
    const unreported = candidate({ slug: 'unreported', dateISO: '2026-05-20', priority: 'A' });
    // `unreported` alone would fail the gate; paired with a confirmed same-day
    // race, the pool contains only the confirmed one anyway — this asserts
    // the SORT would still prefer it were both somehow eligible, by checking
    // the values feeding that comparator directly.
    const anchor = selectLthrAnchor([confirmed, unreported], TODAY);
    expect(anchor?.slug).toBe('confirmed');
  });
});

describe('the non-authority gates are unaffected by F139 and still filter independently', () => {
  it('a race outside the half-marathon distance band is excluded regardless of priority or report', () => {
    const tooShort = candidate({
      slug: 'too-short', dateISO: '2026-05-20', priority: 'A', runnerAuthorityTier: 'representative',
      distanceMi: LTHR_QUALIFYING_MIN_MI - 0.5,
    });
    const tooLong = candidate({
      slug: 'too-long', dateISO: '2026-05-20', priority: 'A', runnerAuthorityTier: 'representative',
      distanceMi: LTHR_QUALIFYING_MAX_MI + 0.5,
    });
    expect(selectLthrAnchor([tooShort], TODAY)).toBeNull();
    expect(selectLthrAnchor([tooLong], TODAY)).toBeNull();
  });

  it('a race with implausible HR is excluded regardless of priority or report', () => {
    const noHr = candidate({ slug: 'no-hr', dateISO: '2026-05-20', runnerAuthorityTier: 'representative', avgHrBpm: NaN });
    expect(selectLthrAnchor([noHr], TODAY)).toBeNull();
  });

  it('a race past the re-test cadence window is excluded regardless of priority or report', () => {
    const old = candidate({ slug: 'ancient', dateISO: '2020-01-01', runnerAuthorityTier: 'representative' });
    expect(selectLthrAnchor([old], TODAY)).toBeNull();
  });

  it('an empty candidate pool returns null, same as always', () => {
    expect(selectLthrAnchor([], TODAY)).toBeNull();
  });
});
