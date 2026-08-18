/**
 * lib/plan/block-preview.ts
 *
 * Pure preview of the SHAPE of the training block a runner will get once
 * their current post-race recovery window ends and generatePlan rebuilds
 * toward the next target race — surfaced BEFORE the nightly `recovery_complete`
 * cron (app/api/cron/plan-drift/route.ts) actually fires the rebuild.
 *
 * 2026-08-18 · David asked why the shape of the CIM block stays invisible
 * until the night recovery ends. Investigation found: the FINE-GRAIN numbers
 * (starting volume, pace anchors, cutback cadence) genuinely need to wait —
 * they're sized off tsbAtStart, rolling 28-day volume/quality stats and
 * niggle/injury signals that are still evolving during the recovery window,
 * so generating the real plan early would size it off exhausted-runner
 * numbers. But the block's overall SHAPE — how many weeks of BASE / QUALITY /
 * RACE-SPECIFIC / TAPER — is NOT data-dependent. `sizeBlocks()` in
 * generate.ts takes only (totalWeeks, raceDistanceMi, isMidBlock) and a
 * static per-distance table (BLOCK_SHAPE); zero rolling fitness data. That
 * makes it safe to preview early, clearly labeled provisional.
 *
 * This file calls generate.ts's own exported `sizeBlocks` rather than
 * re-deriving BLOCK_SHAPE or the phase-sizing arithmetic a second time.
 * CLAUDE.md Rule 6/Rule 7 lineage: "one row of a per-distance table applied
 * elsewhere and drifting" is a defect class that has already bitten this
 * codebase twice (recovery-duration-vs-depth conflation, marathon taper
 * curve applied to every distance). One function, one place it can drift.
 * Likewise `weekStartDow`/`daysBetween`/`weekStartBoundaryOf` are imported
 * from generate.ts (the exact functions the real generator's totalWeeks
 * arithmetic uses at composePlan / generatePlan) rather than reimplemented.
 *
 * No DB access here — pure input → pure output. The API route
 * (app/api/race/[slug]/block-preview/route.ts) does all the reading.
 */
import {
  sizeBlocks,
  weekStartBoundaryOf,
  daysBetween,
  distanceCategoryOfPublic,
  type BlockPlan,
  type DistCategory,
} from './generate';
import { addDays } from './core';

export interface BlockShapePreviewInput {
  /** Runner-local "today" (YYYY-MM-DD), e.g. from runnerToday(userId). */
  todayISO: string;
  /** The target race's date (YYYY-MM-DD). */
  raceDateISO: string;
  /** The target race's distance in miles. */
  raceDistanceMi: number;
  /**
   * Day-of-week (0=Sun..6=Sat) the runner's training week STARTS — the day
   * AFTER their long-run day, matching generate.ts's
   * `weekStartDow = (longRunDow + 1) % 7`. Default 1 (Monday) — the
   * generator's own default for a Sunday long run (David's case; a
   * byte-identical no-op with plain Monday-anchoring per generate.ts's own
   * weekStartBoundaryOf doc comment).
   */
  weekStartDow?: number;
  /**
   * The last prescribed day of an ACTIVE recovery-mode plan currently
   * targeting this race — MAX(plan_workouts.date_iso) for that plan, the
   * exact value app/api/cron/plan-drift/route.ts's `recoveryCompleteDue`
   * reads to decide when to fire the real rebuild. Null/undefined when the
   * runner isn't currently in a recovery window gating this race — the
   * block is then previewed as if it would start today.
   */
  recoveryEndISO?: string | null;
  /**
   * Whether the runner will look "mid-block" (recent quality work) to the
   * real generator's `detectMidBlock()` at the moment the actual rebuild
   * fires. Optional — see `assumptions.isMidBlock` on the result for why
   * this can only ever be a guess from inside a preview.
   */
  isMidBlock?: boolean;
}

export interface BlockShapePreview {
  /** Always true. Structural marker, not a comment — never treat these numbers as final. */
  provisional: true;
  raceDistanceMi: number;
  distanceCategory: DistCategory;
  /** Whole runway, today → race day, snapped to the same week boundary sizeBlocks uses. Includes any recovery time still ahead. */
  totalWeeksToRace: number;
  inRecovery: boolean;
  recoveryEndISO: string | null;
  /** Weeks from today until the recovery window above closes. 0 when not in recovery. */
  recoveryWeeksRemaining: number;
  /** Boundary-snapped date the previewed block (BASE/QUALITY/…) is expected to start — day after recovery ends (or today, boundary-snapped, if not in recovery). */
  blockStartISO: string;
  /** The exact totalWeeks value fed into sizeBlocks — phases[].weeks sums to this. */
  totalWeeksForBlock: number;
  /** Phase breakdown from generate.ts's real sizeBlocks() — the SAME function the real generator calls, not a re-derivation. */
  phases: BlockPlan['phases'];
  assumptions: {
    isMidBlock: {
      value: boolean;
      sourced: 'explicit' | 'default';
      note: string;
    };
    weekStartDow: {
      value: number;
      sourced: 'explicit' | 'default';
    };
  };
  disclaimer: string;
}

const DEFAULT_WEEK_START_DOW = 1; // Monday — generator's default for a Sunday long run.

export function previewBlockShape(input: BlockShapePreviewInput): BlockShapePreview {
  const weekStartDow = input.weekStartDow ?? DEFAULT_WEEK_START_DOW;
  const inRecovery = !!input.recoveryEndISO && input.recoveryEndISO >= input.todayISO;
  const recoveryEndISO = inRecovery ? input.recoveryEndISO! : null;

  // "today" boundary-snapped — matches generatePlan's own startMondayISO for
  // its default startAnchor='monday' path (generate.ts ~5859-5861).
  const todayBoundaryISO = weekStartBoundaryOf(input.todayISO, weekStartDow);
  const raceBoundaryISO = weekStartBoundaryOf(input.raceDateISO, weekStartDow);
  const totalWeeksToRace = Math.max(0, daysBetween(todayBoundaryISO, raceBoundaryISO) / 7 + 1);

  // The real rebuild fires the cron tick AFTER recovery's last prescribed day
  // (recoveryCompleteDue), anchored on whatever "today" is when that tick
  // runs — unknowable at preview time, so the day after recoveryEndISO stands
  // in for it. Not in recovery → the block would start today.
  const blockStartAnchorISO = inRecovery ? addDays(recoveryEndISO!, 1) : input.todayISO;
  const blockStartISO = weekStartBoundaryOf(blockStartAnchorISO, weekStartDow);

  const recoveryWeeksRemaining = inRecovery
    ? Math.max(0, Math.ceil(daysBetween(input.todayISO, recoveryEndISO!) / 7))
    : 0;

  // Mirrors composePlan's own floor (generate.ts ~3388-3395): totalWeeks must
  // be an integer >= 3, or phase advancement breaks — fractional weeks never
  // hit exactly 0, the exact bug composePlan's own comment documents.
  const totalWeeksForBlock = Math.max(3,
    Math.floor(daysBetween(blockStartISO, raceBoundaryISO) / 7) + 1
  );

  // isMidBlock: the real generator asks detectMidBlock() — a DB query over
  // the last 28 days of prescribed + completed quality work. A recovery-
  // window runner has, BY CONSTRUCTION, zero prescribed quality
  // (composeRecoveryPlan is "easy running only, no quality"), so the honest
  // default while still inside (or freshly out of) a recovery window is
  // false. A caller with real signal (e.g. re-running this preview after the
  // window has actually closed and quality has resumed) can override.
  const isMidBlockSourced = input.isMidBlock !== undefined;
  const isMidBlock = input.isMidBlock ?? false;

  const distanceCategory = distanceCategoryOfPublic(input.raceDistanceMi);
  const { phases } = sizeBlocks(totalWeeksForBlock, input.raceDistanceMi, isMidBlock);

  return {
    provisional: true,
    raceDistanceMi: input.raceDistanceMi,
    distanceCategory,
    totalWeeksToRace: Math.round(totalWeeksToRace * 10) / 10,
    inRecovery,
    recoveryEndISO,
    recoveryWeeksRemaining,
    blockStartISO,
    totalWeeksForBlock,
    phases,
    assumptions: {
      isMidBlock: {
        value: isMidBlock,
        sourced: isMidBlockSourced ? 'explicit' : 'default',
        note: 'The real generator computes this from actual 28-day quality-session data '
          + '(detectMidBlock in generate.ts) at rebuild time. This preview cannot see that '
          + 'data before the rebuild happens, so it defaults to false — recovery plans '
          + 'prescribe no quality by design, so false is the honest assumption unless the '
          + 'caller has a real reason to override it.',
      },
      weekStartDow: {
        value: weekStartDow,
        sourced: input.weekStartDow !== undefined ? 'explicit' : 'default',
      },
    },
    disclaimer: 'PROVISIONAL — phase shape only (how many weeks of BASE/QUALITY/RACE-SPECIFIC/TAPER). '
      + 'Volume, pace anchors and cutback cadence are NOT computed here and will differ from this '
      + 'preview once the real rebuild runs with actual post-recovery training data.',
  };
}
