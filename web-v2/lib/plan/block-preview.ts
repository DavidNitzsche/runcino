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
  embedMidBlockRaces,
  type BlockPlan,
  type DistCategory,
  type DayPlan,
  type DOW,
  type ComposedWeek,
  type MidBlockRace,
  type EmbeddedRaceSummary,
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

/**
 * previewMidBlockRacePlacement · 2026-08-18
 *
 * David's follow-up to the phase-shape preview above: which WEEK will his
 * own upcoming tune-up races (Santa Monica 10K, Dodgers, Run Malibu — all
 * dated B/C races ahead of CIM) land in once the real block is generated?
 * `embedMidBlockRaces()` in generate.ts already answers this — it's the
 * function composePlan calls, inside composePlan, right after the week
 * skeleton is laid out (generate.ts ~3818-3827) — so this calls THAT
 * function rather than re-deriving any of its placement/mini-taper/
 * frequency-cap logic. Same anti-drift posture as `previewBlockShape`
 * calling the real `sizeBlocks`.
 *
 * THE SKELETON PROBLEM (read this before trusting the day-level output).
 * `embedMidBlockRaces(weeks, vols, opts)` takes a full `ComposedWeek[]` —
 * every day already typed easy/long/quality/rest with a real distanceMi —
 * not just phase week-counts. That skeleton is normally built by
 * `layoutWeek()` (generate.ts, private, called once per week inside
 * composePlan ~3701-3800), which needs `vols[wi]` (the ramped weekly
 * mileage from `volumeCurve`), `rx` (workout-library prescriptions),
 * `tierTarget`, and the overload `trajectory` — every one of those is
 * sized off exactly the rolling fitness data (tsbAtStart, 28-day volume/
 * quality) that `previewBlockShape`'s own header explains isn't available
 * yet during a recovery window. Calling the real `layoutWeek` here would
 * mean fabricating fitness numbers to feed it — worse than not previewing
 * at all.
 *
 * So this builds a SYNTHETIC placeholder skeleton instead — one week
 * template repeated across the block, days typed easy/long/quality/rest
 * from the runner's PREFERENCES only (long_run_day / rest_day /
 * quality_days / weekly_frequency — read once by the caller, same as
 * `weekStartDow` above), with round placeholder distances. Preferences are
 * genuinely data-independent (no rolling fitness read), so WHICH DAY OF
 * WEEK is long/quality/rest is real; the distances on each day are not,
 * and neither is the recent-quality-habit ramp `densityForWeek` in
 * generate.ts would otherwise apply (that ramp reads 28-day quality
 * history — the same reason `isMidBlock` above defaults to false).
 *
 * WHAT THIS MEANS FOR THE OUTPUT:
 *   - `weekIdx` on each returned race is REAL. It falls straight out of
 *     `daysBetween(startMondayISO, race.date) / 7` inside the real
 *     `embedMidBlockRaces` — pure calendar arithmetic against the same
 *     `blockStartISO`/`weekStartDow` `previewBlockShape` already computes.
 *     A race's week does not depend on the skeleton at all.
 *   - Which EXACT day inside that week gets the mini-taper / shakeout /
 *     post-race-easy treatment, and what a displaced quality session
 *     becomes, DOES depend on the skeleton — `embedMidBlockRaces` reads
 *     and mutates `slot.isLong`/`slot.isQuality`/`slot.distanceMi` on
 *     whichever day was already prescribed as what. Once the real rebuild
 *     runs with real volumes and real quality density, the same race could
 *     land its mini-taper on a different day than this preview shows (the
 *     WEEK will still match).
 */

export type MidBlockRacePlacementInput = BlockShapePreviewInput & {
  /**
   * Target date of the plan's own race — same value as `raceDateISO`
   * above. Kept as a distinct field (rather than reusing `raceDateISO`
   * silently) because `embedMidBlockRaces` takes `raceDateISO` as an opt
   * that excludes any candidate race on/after it — spelling it out here
   * mirrors that opt's own name so the exclusion rule is visible at the
   * call site, not just in `BlockShapePreviewInput`.
   */
  raceDateISO: string;
  /**
   * Candidate B/C races that MIGHT land inside this block. The route
   * builds this from `loadRacesState()` — every upcoming B/C race other
   * than the target itself, distance-capped at the target's own distance
   * (a race longer than the target isn't a tune-up; mirrors generate.ts's
   * own `midBlockRaceRows` filter at ~6008-6010). Deliberately NOT further
   * filtered by date here: the exact "does this fall inside the block, and
   * is it before the target race" predicate lives inside the real
   * `embedMidBlockRaces` (`race.date >= opts.raceDateISO` excluded; offset
   * outside `[0, totalDays)` excluded) — passing every plausible candidate
   * and letting the real function decide is what keeps this preview from
   * drifting out of step with it.
   */
  midBlockRaces: MidBlockRace[];
  /**
   * Runner's rest day (0=Sun..6=Sat). Default 6 (Saturday) — generate.ts's
   * own default (`loadGeneratorInputs`: `prefs?.rest_day ?? 'sat'`).
   */
  restDow?: number;
  /**
   * Runner's quality days (0=Sun..6=Sat). Default [2, 4] (Tue/Thu) —
   * generate.ts's own default (`prefs?.quality_days ?? ['tue','thu']`).
   * NOT sliced down by the recent-quality-habit ramp (`densityForWeek`)
   * or by `available_days` — both read rolling data/settings this preview
   * doesn't take on, so every week gets the runner's full stated quality
   * density. Sourcing is reported on the result the same way `isMidBlock`
   * is above.
   */
  qualityDows?: number[];
  /**
   * Runner's stated training days/week (profile.weekly_frequency). Passed
   * straight through to the real `embedMidBlockRaces`'s own frequency-cap
   * trim (a race landing on a former rest day adds a running day; the cap
   * trims an easy day back to rest to hold the runner's stated frequency).
   * null preserves the legacy fill-every-slot behavior, same as the real
   * generator's own null case (David / pre-frequency profiles).
   */
  trainingDaysPerWeek?: number | null;
};

export interface MidBlockRacePlacementPreview extends BlockShapePreview {
  /**
   * The real `embedMidBlockRaces`'s own return value, passed through
   * unreshaped — one entry per candidate race that actually landed inside
   * the previewed block (a race outside the block's date range, on/after
   * the target race, or inside the block's own final race week is silently
   * dropped by the real function, exactly as it would be at generation
   * time).
   */
  embeddedRaces: EmbeddedRaceSummary[];
  /** Sourcing of the day-of-week inputs used to build the placeholder skeleton. */
  skeletonAssumptions: {
    restDow: { value: number; sourced: 'explicit' | 'default' };
    qualityDows: { value: number[]; sourced: 'explicit' | 'default' };
    trainingDaysPerWeek: { value: number | null; sourced: 'explicit' | 'default' };
  };
  /** See the file-level doc comment above `previewMidBlockRacePlacement` for the full explanation. */
  skeletonDisclaimer: string;
}

const DEFAULT_REST_DOW = 6;               // Saturday — generate.ts's own default.
const DEFAULT_QUALITY_DOWS: DOW[] = [2, 4]; // Tue/Thu — generate.ts's own default.
/** Round, structurally-plausible placeholder distances. Never meant to be
 *  read as a real prescription — embedMidBlockRaces only ever compares them
 *  (`> 0`, `Math.min(d.distanceMi, N)` caps), never presents them as the
 *  session's actual dose, so any consistent nonzero set works. */
const PLACEHOLDER_LONG_MI = 12;
const PLACEHOLDER_QUALITY_MI = 8;
const PLACEHOLDER_EASY_MI = 5;

/**
 * One repeating week template — long/rest/quality days placed purely from
 * prefs, everything else easy — expanded across the whole block. Exported
 * for direct testing (drift guard against embedMidBlockRaces below).
 */
export function buildPlaceholderWeekSkeleton(opts: {
  blockStartISO: string;
  weekStartDow: number;
  longRunDow: number;
  restDow: number;
  qualityDows: number[];
  totalWeeksForBlock: number;
  phases: BlockPlan['phases'];
}): { weeks: ComposedWeek[]; vols: number[] } {
  // Expand sizeBlocks' phase week-counts into one label per week index, so
  // the placeholder weeks at least carry the real phase name even though
  // their day-level contents are synthetic.
  const phaseLabels: string[] = [];
  for (const p of opts.phases) for (let i = 0; i < p.weeks; i++) phaseLabels.push(p.label);

  const weeks: ComposedWeek[] = [];
  const vols: number[] = [];
  for (let wi = 0; wi < opts.totalWeeksForBlock; wi++) {
    const startISO = addDays(opts.blockStartISO, wi * 7);
    const isRaceWeek = wi === opts.totalWeeksForBlock - 1;
    const days: DayPlan[] = [];
    for (let j = 0; j < 7; j++) {
      const dow = ((opts.weekStartDow + j) % 7) as DOW;
      if (dow === opts.longRunDow) {
        days.push({ dow, type: 'long', distanceMi: PLACEHOLDER_LONG_MI, isQuality: false, isLong: true, subLabel: null, notes: '' });
      } else if (dow === opts.restDow) {
        days.push({ dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: '' });
      } else if (opts.qualityDows.includes(dow)) {
        days.push({ dow, type: 'threshold', distanceMi: PLACEHOLDER_QUALITY_MI, isQuality: true, isLong: false, subLabel: null, notes: '' });
      } else {
        days.push({ dow, type: 'easy', distanceMi: PLACEHOLDER_EASY_MI, isQuality: false, isLong: false, subLabel: null, notes: '' });
      }
    }
    const weeklyMi = Math.round(days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    weeks.push({
      startISO,
      phase: phaseLabels[wi] ?? phaseLabels[phaseLabels.length - 1] ?? 'BASE',
      weeklyMi,
      days,
      isRaceWeek,
      tPaceSec: null,
      isCutback: false,
    });
    vols.push(weeklyMi);
  }
  return { weeks, vols };
}

export function previewMidBlockRacePlacement(input: MidBlockRacePlacementInput): MidBlockRacePlacementPreview {
  const shape = previewBlockShape(input);
  const weekStartDow = input.weekStartDow ?? DEFAULT_WEEK_START_DOW;
  // Same relationship previewBlockShape's own header documents:
  // weekStartDow = (longRunDow + 1) % 7.
  const longRunDow = ((weekStartDow + 6) % 7) as DOW;

  const restDowSourced = input.restDow !== undefined;
  const restDow = input.restDow ?? DEFAULT_REST_DOW;
  const qualityDowsSourced = input.qualityDows !== undefined;
  const qualityDows = input.qualityDows?.length ? input.qualityDows : DEFAULT_QUALITY_DOWS;
  const trainingDaysPerWeekSourced = input.trainingDaysPerWeek !== undefined;
  const trainingDaysPerWeek = input.trainingDaysPerWeek ?? null;

  const { weeks, vols } = buildPlaceholderWeekSkeleton({
    blockStartISO: shape.blockStartISO,
    weekStartDow,
    longRunDow,
    restDow,
    qualityDows,
    totalWeeksForBlock: shape.totalWeeksForBlock,
    phases: shape.phases,
  });

  // The real function itself — not reimplemented. It reads/mutates `weeks`
  // (and syncs `vols`) in place and returns the placement summary.
  const embeddedRaces = embedMidBlockRaces(weeks, vols, {
    startMondayISO: shape.blockStartISO,
    raceDateISO: input.raceDateISO,
    midBlockRaces: input.midBlockRaces,
    trainingDaysPerWeek,
  });

  return {
    ...shape,
    embeddedRaces,
    skeletonAssumptions: {
      restDow: { value: restDow, sourced: restDowSourced ? 'explicit' : 'default' },
      qualityDows: { value: qualityDows, sourced: qualityDowsSourced ? 'explicit' : 'default' },
      trainingDaysPerWeek: { value: trainingDaysPerWeek, sourced: trainingDaysPerWeekSourced ? 'explicit' : 'default' },
    },
    skeletonDisclaimer: 'PROVISIONAL, one level deeper than the phase shape above. Which WEEK each race '
      + 'lands in is real date arithmetic against the same block start this preview already computes. '
      + 'Which EXACT day inside that week becomes the mini-taper/shakeout/recovery-easy day, and what a '
      + 'displaced quality session turns into, was computed against a SYNTHETIC placeholder week (long/'
      + 'quality/rest days placed from the runner\'s own preferences, but with round placeholder distances '
      + 'and no recent-quality-habit ramp) — not the real prescribed week the actual rebuild will build. '
      + 'Expect the week to match and the day-level detail to shift once the real rebuild runs.',
  };
}
