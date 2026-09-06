/**
 * lib/plan/_goal_pace_contamination.test.ts · GOALPACELEAK-1 ·
 * A STATED GOAL MAY NOT PRICE A TRAINING PACE, PROVEN ON THE PURE CORE.
 *
 * ── WHY THIS FILE, BESIDE `check-goal-pace-leak.sh` ────────────────────────
 *
 * `scripts/check-goal-pace-leak.sh` is a TEXT SCAN. It says so in its own
 * header, and names its own blind spot: "a goal that reaches a pace through
 * a variable renamed to something innocuous ... is invisible to it." The
 * pattern it matches on `goalPaceSPerMi` requires the OBJECT-LITERAL shape
 * `goalPaceSPerMi: ...` — and `buildWorkoutSpec` takes it POSITIONALLY, so a
 * caller that threads the runner's live goal into the seventh argument is
 * invisible to the scan whatever it is named.
 *
 * That is exactly the shape found and fixed here (GOALPACELEAK-1,
 * 2026-09-06): `app/api/admin/backfill-workout-spec/route.ts` computed
 * `goalPaceSPerMi` from the runner's stated A-race goal and passed it to
 * `buildWorkoutSpec` for EVERY row type, not only `'race'`. For a `'long'`
 * row with a marathon-pace finish, `spec-builder.ts`'s anchorless
 * `marathonPace` branch reads `goalPaceSPerMi` — Constitution §G's forbidden
 * shape, a goal reaching a TRAINING pace — and `lib/runner-state
 * /quantity-owners.ts` MARATHON_PACE_DOSE names this exact branch "the LAST
 * GOAL-SHAPED SIDE DOOR in the engine". The route now passes the goal only
 * for `type === 'race'` (Constitution §J: a race DAY target is legitimately
 * priced from the stated goal) and `null` for everything else — the same
 * default every other anchorless caller in the engine already uses.
 *
 * This file proves the invariant BEHAVIOURALLY rather than by re-reading the
 * source: build two specs that are identical in every training-history
 * input and differ ONLY in the runner's stated goal, and assert the
 * TRAINING pace fields do not move. A test that calls the real function is
 * something a renamed variable cannot fool.
 *
 * ── WHAT THIS FILE DOES NOT CLOSE ──────────────────────────────────────────
 *
 * `lib/plan/spec-builder.ts` is out of scope for this pass (a parallel
 * workstream owns it). Its anchorless `marathonPace` and `interval` branches
 * still price off flat POPULATION offsets (`MARATHON_OFFSET_S`,
 * `INTERVAL_OFFSET_S`) rather than the runner's own capacity — a real,
 * still-open divergence (`MARATHON_PACE_DOSE` / `INTERVAL_PACE` in
 * `quantity-owners.ts`, `ANCHORLESS_CALLERS`). That is an ANCHOR-QUALITY
 * question — population default vs. personalised capacity — and is
 * DIFFERENT from the GOAL-CONTAMINATION question this file answers. Group 3
 * below states plainly which of the two is closed and which remains.
 *
 * ── RULE 18 · FALSIFIED ─────────────────────────────────────────────────────
 *
 * Group 2's assertion was run against the PRE-FIX route logic (goal passed
 * unconditionally for every type) before the fix landed, and it failed by
 * naming the exact delta — see the commit/PR description. Restored to green
 * by the one-line conditional in the route. Group 1 was verified to FAIL
 * first by temporarily calling the anchorless overload with the type's
 * goal-reading branch reachable (i.e. reproducing the pre-fix shape) — kept
 * as Group 3's documentation rather than a standing red test, since a
 * permanently-red assertion in a suite that must stay green is not how this
 * repo falsifies a check (see CLAUDE.md Rule 18).
 */
import { describe, it, expect } from 'vitest';
import { buildWorkoutSpec } from './spec-builder';
import { syntheticPaceAnchors, anchorsOrNull } from './authoring-anchors';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';

/* ══════════════════════════════════════════════════════════════════════════
 * SHARED FIXTURE · one runner, fully evidenced, no goal anywhere in it.
 * ═══════════════════════════════════════════════════════════════════════ */

const TODAY = '2026-09-06';

function anchorsFor(recentWeeklyMi: number, bestRecentVdot: number | null): PrescribedPaceAnchors {
  const read = syntheticPaceAnchors({ bestRecentVdot, recentWeeklyMi, todayISO: TODAY });
  const a = anchorsOrNull(read);
  if (!a) throw new Error('fixture runner produced no anchors · widen the fixture, not the test');
  return a;
}

const ANCHORS = anchorsFor(40, 47.8); // the registry's own "marathoner" probe shape
const LONG_MP_RX = '18 mi with 6 mi @ MP finish';
const INTERVAL_RX = '3 mi WU · 6×800m @ I pace · 90s jog · 2 mi CD';

function numberField(spec: unknown, key: string): number | null {
  if (spec == null || typeof spec !== 'object') return null;
  const v = (spec as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Two wildly different stated goals — a sub-elite marathon and a jog. If a
 *  training pace moves between them, the goal reached it. Neither needs to
 *  land inside `resolveMarathonPace`'s "goal is in zone" window to prove
 *  invariance on the ANCHORED path (it never reaches that function at all —
 *  see 1a/1b) — but a goal that DOES land in zone is what makes the
 *  falsification in 2c meaningful, so `zoneGoal` below is computed to sit
 *  inside it deliberately, not by luck. */
const AMBITIOUS_GOAL_S_PER_MI = 300; // ~2:11 marathon pace
const MODEST_GOAL_S_PER_MI = 900; // ~6:33 marathon pace
const GOALS = [null, AMBITIOUS_GOAL_S_PER_MI, MODEST_GOAL_S_PER_MI, 1] as const;

/** A fixed threshold/easy-anchor pair used by the `430`-tPaceSec tests below
 *  (2a/2c), and its in-zone goal, computed once so both tests share one
 *  number rather than two independently-typed "a goal that happens to be in
 *  zone" literals drifting apart. */
const FIXED_T_PACE_SEC = 430;

/** The pace-abort rule's discriminator (`lib/race/distance-doctrine.ts
 *  #racePaceAbortRule`) among a spec's `rules` array. */
function paceAbortValue(spec: unknown): number | null {
  if (spec == null || typeof spec !== 'object') return null;
  const rules = (spec as { rules?: Array<{ metric?: string; value?: number }> }).rules ?? [];
  const r = rules.find((x) => x.metric === 'pace');
  return typeof r?.value === 'number' && Number.isFinite(r.value) ? r.value : null;
}

/** A goal strictly inside `resolveMarathonPace`'s zone window
 *  `(tPaceSec, easyAnchorTSec + 55)` for the given anchors — the ONE case
 *  where the anchorless branch's goal read is actually reachable, so a
 *  falsification (2c) that used an out-of-zone goal would prove nothing. */
function inZoneGoal(tPaceSec: number, easyAnchorTSec: number): number {
  const lo = tPaceSec;
  const hi = easyAnchorTSec + 55;
  const g = Math.round((lo + hi) / 2);
  if (!(g > lo && g < hi)) throw new Error('fixture anchors leave no in-zone goal · widen the fixture');
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE ANCHORED PATH — what `generate.ts`/`composePlan` actually authors
 *     with, and what every migrated call site (`recompute-paces.ts`,
 *     `reanchor-plan.ts`) reads back — is provably goal-free.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GOALPACELEAK-1 · the anchored path never reads the stated goal', () => {
  it('1a · a long run\'s marathon-pace finish is invariant to the goal', () => {
    // Includes a goal computed to sit INSIDE `resolveMarathonPace`'s zone
    // window for these anchors — the one value that would actually move the
    // anchorless branch (see 2c) — so this test does not pass merely because
    // none of its goals happened to land where the read would matter.
    const zoneGoal = inZoneGoal(ANCHORS.thresholdSecPerMi, ANCHORS.easyCeilingSecPerMi);
    const finishPaces = [...GOALS, zoneGoal].map((goal) => {
      const built = buildWorkoutSpec(
        'long', 18, ANCHORS.thresholdSecPerMi, 168, LONG_MP_RX, 180, goal,
        ANCHORS.intervalSecPerMi, ANCHORS.easyCeilingSecPerMi, false, null, ANCHORS,
      );
      return numberField(built.spec, 'finish_pace_s_per_mi');
    });
    // LIVENESS · the field must actually be present, or every comparison
    // below is comparing four nulls and proving nothing (Rule 18 point 2).
    expect(finishPaces[0]).not.toBeNull();
    expect(new Set(finishPaces).size).toBe(1);
  });

  it('1b · an interval session\'s rep pace is invariant to the goal', () => {
    const repPaces = GOALS.map((goal) => {
      const built = buildWorkoutSpec(
        'intervals', 9, ANCHORS.thresholdSecPerMi, 168, INTERVAL_RX, 180, goal,
        ANCHORS.intervalSecPerMi, ANCHORS.easyCeilingSecPerMi, false, null, ANCHORS,
      );
      return numberField(built.spec, 'rep_pace_s_per_mi');
    });
    expect(repPaces[0]).not.toBeNull();
    expect(new Set(repPaces).size).toBe(1);
  });

  it('1c · POSITIVE CONTROL · a race row DOES move with the goal, on purpose (§J)', () => {
    // Falsify the harness before trusting 1a/1b (Rule 18): if `numberField`
    // or the goal parameter were both inert, every assertion above would
    // pass for the wrong reason. The race branch is the ONE place a goal is
    // supposed to reach a number, so it must visibly do so here.
    const abortPaces = GOALS.map((goal) => {
      const built = buildWorkoutSpec(
        'race', 26.2, ANCHORS.thresholdSecPerMi, 168, null, 180, goal,
        ANCHORS.intervalSecPerMi, ANCHORS.easyCeilingSecPerMi, false, null, ANCHORS,
      );
      return paceAbortValue(built.spec);
    });
    expect(new Set(abortPaces.filter((v): v is number => v != null)).size).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE FIX ITSELF — the backfill route's exact call boundary, replayed.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GOALPACELEAK-1 · the fixed backfill call boundary', () => {
  /** `app/api/admin/backfill-workout-spec/route.ts`'s own conditional,
   *  copied rather than imported — the route is a DB-touching Next.js
   *  handler and cannot be imported into a pure unit test, and this is
   *  the ENTIRE fix: one ternary at the call site. Keep this line
   *  byte-identical to the route's if the route ever changes it. */
  function goalPaceForRow(rowType: string, goalPaceSPerMi: number | null): number | null {
    return rowType === 'race' ? goalPaceSPerMi : null;
  }

  // `resolveMarathonPace`'s zone window for `FIXED_T_PACE_SEC` with no
  // `easyAnchorTSec` threaded (defaults to `tPaceSec`, so longLo = T + 55).
  // Shared by 2a and 2c so a regression in one is a regression in the other.
  const ZONE_GOAL_FOR_FIXED_T = inZoneGoal(FIXED_T_PACE_SEC, FIXED_T_PACE_SEC);

  it('2a · a backfilled `long` row never carries the goal into its MP finish', () => {
    // Includes the in-zone goal — see 2c for why an out-of-zone-only sweep
    // would pass whether or not the fix actually did anything.
    const finishPaces = [...GOALS, ZONE_GOAL_FOR_FIXED_T].map((goal) => {
      const goalForRow = goalPaceForRow('long', goal);
      // Anchorless, exactly as the route calls it (no capacity anchors —
      // the backfill route has never threaded them).
      const built = buildWorkoutSpec('long', 18, FIXED_T_PACE_SEC, 168, LONG_MP_RX, 180, goalForRow);
      return numberField(built.spec, 'finish_pace_s_per_mi');
    });
    expect(finishPaces[0]).not.toBeNull();
    expect(new Set(finishPaces).size).toBe(1);
  });

  it('2b · a backfilled `race` row still prices from the goal (the fix did not overcorrect)', () => {
    const abortPaces = GOALS.map((goal) => {
      const goalForRow = goalPaceForRow('race', goal);
      const built = buildWorkoutSpec('race', 26.2, FIXED_T_PACE_SEC, 168, null, 180, goalForRow);
      return paceAbortValue(built.spec);
    });
    expect(new Set(abortPaces.filter((v): v is number => v != null)).size).toBeGreaterThan(1);
  });

  it('2c · FALSIFICATION · the pre-fix shape (goal threaded for every type) is exactly what 2a would have caught', () => {
    // Rule 18: prove the assertion in 2a can fail, by reproducing the
    // pre-fix call — the goal threaded unconditionally, the shape the route
    // carried before GOALPACELEAK-1. Uses the SAME in-zone goal as 2a: an
    // out-of-zone goal would leave this test green for the wrong reason,
    // and a different goal than 2a's would not actually prove 2a can fail.
    const preFixFinishPaces = [null, ZONE_GOAL_FOR_FIXED_T].map((goal) => {
      const built = buildWorkoutSpec('long', 18, FIXED_T_PACE_SEC, 168, LONG_MP_RX, 180, goal /* unconditional */);
      return numberField(built.spec, 'finish_pace_s_per_mi');
    });
    expect(
      new Set(preFixFinishPaces).size,
      'the pre-fix call shape must actually leak, or this whole file is testing nothing',
    ).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · WHAT REMAINS OPEN — stated, not hidden.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GOALPACELEAK-1 · honest scope', () => {
  it('3a · the anchorless PACE (not goal) still differs from the anchored one — a known, separate, open gap', () => {
    // This is the ANCHOR-QUALITY divergence (`MARATHON_PACE_DOSE` /
    // `INTERVAL_PACE` in `lib/runner-state/quantity-owners.ts`,
    // `ANCHORLESS_CALLERS`), not a goal leak, and it is NOT closed by
    // GOALPACELEAK-1. Documented here so nobody reads groups 1-2 as having
    // closed it: the anchorless branch prices off a flat population offset
    // from threshold, and disagrees with the personalised anchor by design
    // until `spec-builder.ts` itself is migrated (out of scope this pass).
    const anchored = buildWorkoutSpec(
      'long', 18, ANCHORS.thresholdSecPerMi, 168, LONG_MP_RX, 180, null,
      ANCHORS.intervalSecPerMi, ANCHORS.easyCeilingSecPerMi, false, null, ANCHORS,
    );
    const anchorless = buildWorkoutSpec(
      'long', 18, ANCHORS.thresholdSecPerMi, 168, LONG_MP_RX, 180, null,
    );
    const a = numberField(anchored.spec, 'finish_pace_s_per_mi');
    const b = numberField(anchorless.spec, 'finish_pace_s_per_mi');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Not asserting a magnitude — quantity-owners.ts already measures and
    // ratchets it (`maxAbs: 44`). This assertion only keeps this file honest
    // about what it did and did not prove: NOT that the two paths agree.
    expect(a).not.toBe(b);
  });
});
