/**
 * lib/plan/anchor-fit.ts · is this plan right FOR THIS RUNNER?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS FILLS
 *
 * Every gate in this repo asks one of two questions.
 *
 *   · Is the plan WELL-FORMED?  `_maint_invariants`, `_sweep_allusers` over
 *     7,680 archetypes, `_race_runup` — placement, distance, alignment,
 *     counts, phase shape.
 *   · Does it AGREE WITH THE RESEARCH?  `lib/doctrine/registry.ts`, hundreds of
 *     claims bound to verbatim `Research/` anchors.
 *
 * Nothing asked whether the numbers were right for the runner in front of it.
 * A block can be perfectly formed, correctly cited, internally consistent, and
 * built on the wrong anchor — and every gate stays green, because every gate
 * grades the plan against the anchor rather than the anchor against the runner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE BEING TESTED
 *
 * AN ANCHOR MEASURED OVER A WINDOW THAT THE PLAN'S OWN SUBJECT DEPRESSED IS
 * CIRCULAR.
 *
 * Post-race weeks are low BECAUSE of the race, so sizing post-race recovery off
 * them under-prescribes. The same shape applies to every window that can be low
 * BY DESIGN: a taper, an injury or illness layoff, travel, and a deliberate
 * cutback. Where an anchor averages over such a window it inherits the
 * depression, and the plan reconverges on a volume the runner had already left
 * behind.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS IN HERE, AND WHY IT IS NOT IN THE TEST FILE
 *
 * The checks are pure predicates over an `AnchorFacts` record. That split is
 * the point: `_anchor_fit.test.ts` runs them over runner shapes AND over
 * planted-bad fact sets, so the gate proves it can still see the bug it was
 * written for. A gate that inspects nothing and reports clean has shipped in
 * this repo twice this week; this one refuses to pass on nothing.
 */
import {
  RAMP_BASE_RESUME_FRACTION,
  RAMP_BASE_SUSTAINED_RANK,
  RECOVERY_MIN_EASY,
  type RampBaseEvidence,
} from './generate';

/** Everything a check may look at. One runner, one authoring. */
export interface AnchorFacts {
  /** Shape id, for the failure message. */
  readonly id: string;
  /** Which composer ran. */
  readonly mode: 'race-prep' | 'maintenance' | 'recovery';

  // ── what the runner actually did ──
  /** 16 most-recent-first 7-day sums, mi. Index 0 ends today. */
  readonly blocks: readonly number[];
  /** Rolling-7-day maximum over the 16-week look-back, mi. */
  readonly measuredPeakMi: number;
  /** 28-day mean, mi/wk. */
  readonly meanMi: number;

  // ── what the engine anchored to ──
  /** `peakAnchor` on the non-race composers. Null on race-prep. */
  readonly peakAnchorMi: number | null;
  /** RAMPBASE-1's evidence on race-prep. Null elsewhere. */
  readonly ramp: RampBaseEvidence | null;
  /** The pace anchor's provenance: a measured/self-reported VDOT, or null when
   *  the engine fell back to `conservativeVdotFromMileage(meanMi)`. */
  readonly vdotAnchor: number | null;

  // ── what it prescribed ──
  /** Per-week planned miles, in block order. */
  readonly weeklyMi: readonly number[];
  /** The week's LONGEST run, aligned to `weeklyMi`. Not the flagged long — the
   *  biggest number on the week — because what bounds a week is the size of its
   *  biggest run, whatever the composer labelled it. */
  readonly longestRunMi: readonly number[];
  /** Running days per week, aligned to `weeklyMi`. With the above it gives an
   *  arithmetic ceiling on what a week can carry, which is what separates "the
   *  engine under-prescribed" from "the week's shape could not hold the row". */
  readonly runDays: readonly number[];
  /** Doctrine's own per-week fraction of the anchor, aligned to `weeklyMi`.
   *  Empty when the composer publishes no such table (race-prep). */
  readonly doctrinePct: readonly number[];
  /** Every phase label + rationale the block carries, lowercased. */
  readonly blockSays: string;
  /** `GENERAL_RAMP_CEILING[level]` · what `enforceWeeklyRampCeiling` allows
   *  week-over-week. Lets a shortfall be attributed to that pass rather than
   *  reported as an unexplained miss. */
  readonly rampCeiling: number;
  /** What the block's own audit record claims it was sized at, when it
   *  publishes one: `weekly_pct_applied` and the anchor arm it names. */
  readonly statedPctApplied: number | null;
  readonly statedAnchorArm: string | null;

  // ── context that makes a low stretch legitimate ──
  /** True when the recent dip is one the ENGINE ITSELF prescribed — a taper
   *  plus its post-race recovery window — and is still inside it. */
  readonly dipIsMandated: boolean;
  /** How many of the most recent 7-day blocks sit below the resume level. */
  readonly interruptionWeeks: number;
  /** How long an interruption this authoring is entitled to read through. */
  readonly allowedInterruptionWeeks: number;
}

export type Severity = 'FIRM' | 'DECISION';

export interface Finding {
  readonly check: string;
  readonly severity: Severity;
  readonly message: string;
}

/** Rank-N of a most-recent-first series · the level a runner reached REPEATEDLY.
 *  Same statistic `resolveRampBase` uses, for the same reason: one big week is
 *  not a capacity. */
export function sustainedOf(blocks: readonly number[]): number {
  const sorted = [...blocks].filter((v) => Number.isFinite(v)).sort((a, b) => b - a);
  if (sorted.length < RAMP_BASE_SUSTAINED_RANK) return 0;
  return sorted[RAMP_BASE_SUSTAINED_RANK - 1] ?? 0;
}

/** The volume this runner is CURRENTLY holding · the most recent complete week. */
export function currentWeekMi(blocks: readonly number[]): number {
  return blocks[0] ?? 0;
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : 'n/a');

/**
 * A1 · THE ANCHOR IS NOT MEASURED OVER A WINDOW IT DISRUPTED.
 *
 * The live instance: a post-race recovery block sized off the four weeks BEFORE
 * it, which are peak-taper-taper-race — a mean nothing was ever trained at.
 * Research/22 §14 "Return from Short Layoff" names the floor a runner resumes
 * at after an interruption and states it as a fraction of PRE-interruption
 * volume: 70%. So whatever anchor a block is sized off, when the recent dip is
 * one the engine itself prescribed, that anchor may not sit below 70% of the
 * level this runner repeatedly held.
 *
 * Skipped when the dip is NOT mandated and has outrun its allowance: that is a
 * layoff rather than a deload, and coming down IS the correct answer.
 */
export function checkAnchorNotCircular(f: AnchorFacts): Finding | null {
  const sustained = sustainedOf(f.blocks);
  if (!(sustained > 0)) return null;
  if (!f.dipIsMandated && f.interruptionWeeks > f.allowedInterruptionWeeks) return null;
  const anchor = f.mode === 'race-prep' ? (f.ramp?.baseMi ?? f.meanMi) : (f.peakAnchorMi ?? 0);
  const floor = Math.round(sustained * RAMP_BASE_RESUME_FRACTION * 10) / 10;
  if (anchor + 0.05 >= floor) return null;
  return {
    check: 'ANCHOR_CIRCULAR',
    severity: 'FIRM',
    message:
      `${f.id} · ${f.mode} sized off ${anchor.toFixed(1)} mi/wk, which is ` +
      `${pct(anchor, sustained)} of this runner's sustained ${sustained.toFixed(1)} mi/wk ` +
      `(3rd-highest of 16 weeks). The recent dip is engine-mandated, so the anchor is a ` +
      `measurement of the plan's own prescription. Research/22 §14 floors a resume at ` +
      `${floor.toFixed(1)}. 28-day mean was ${f.meanMi.toFixed(1)}` +
      (Math.abs(anchor - f.meanMi) < 0.6 ? ' — the anchor IS the depressed mean.' : '.'),
  };
}

/**
 * A2 · THE ANCHOR REFLECTS CAPACITY, NOT A RECENT DIP — AND NOT A FICTION.
 *
 * The other direction of A1. An anchor above what the runner has ever actually
 * run is an invented capacity, and it prescribes off a body that does not
 * exist. Rule 1: a modelled number must never look measured.
 */
export function checkAnchorNotInflated(f: AnchorFacts): Finding | null {
  const anchor = f.mode === 'race-prep' ? (f.ramp?.baseMi ?? f.meanMi) : (f.peakAnchorMi ?? 0);
  if (!(f.measuredPeakMi > 0)) return null;           // cold start · nothing to exceed
  if (anchor <= f.measuredPeakMi + 0.05) return null;
  return {
    check: 'ANCHOR_INFLATED',
    severity: 'FIRM',
    message:
      `${f.id} · ${f.mode} sized off ${anchor.toFixed(1)} mi/wk, above the runner's ` +
      `highest measured 7-day block of ${f.measuredPeakMi.toFixed(1)}. Nothing in the ` +
      `history supports it.`,
  };
}

/**
 * A3 · THE COMPOSED VOLUMES ARE IN DOCTRINE'S BAND **OF THAT ANCHOR**.
 *
 * Where the shape gate and the doctrine gate meet, and where neither currently
 * looks. `_doctrine_gate` proves `RECOVERY_WEEKLY_PCT_OF_BASE.hm` is `[0.60,
 * 0.80]` and that those match Research/00b. `_maint_invariants` proves the
 * weeks are well placed. Neither multiplies the published fraction by the
 * anchor and compares it to the miles the runner was actually given.
 *
 * Tolerance is deliberately loose — the composer rounds to whole miles, then
 * `finalizeComposedPlan` reconciles the week to its realized day-sum, and a
 * low-volume week can be moved several miles by a single coherence floor. It
 * is there to catch a week off by a THIRD, which is the size of the error this
 * whole file exists for.
 */
export const BAND_TOLERANCE = 0.15;

/** The most `finalizeComposedPlan` lets a non-long day reach, as a fraction of
 *  the week's long run — its own easy≤long sweep holds easy "STRICTLY below the
 *  long (~0.8×) so the long stays visibly the longest run". Mirrored here so
 *  the granularity attribution below bounds a week by the engine's rule rather
 *  than by a guess about it. */
export const EASY_BELOW_LONG = 0.8;

export function checkVolumesInBandOfAnchor(f: AnchorFacts): Finding | null {
  if (f.doctrinePct.length === 0) return null;
  const anchor = f.peakAnchorMi ?? 0;
  if (!(anchor > 0)) return null;
  for (let i = 0; i < Math.min(f.doctrinePct.length, f.weeklyMi.length); i++) {
    const want = anchor * f.doctrinePct[i];
    const got = f.weeklyMi[i];
    if (!(want > 0)) continue;
    const off = Math.abs(got - want) / want;
    // Absolute floor: on a genuinely tiny week (a 5K's 2-mile row) a 28%
    // relative miss is under a mile and is rounding, not a defect.
    if (off <= BAND_TOLERANCE || Math.abs(got - want) <= 1.5) continue;
    const detail =
      `${f.id} · ${f.mode} week ${i + 1} prescribes ${got.toFixed(1)} mi where doctrine's own ` +
      `${(f.doctrinePct[i] * 100).toFixed(0)}% of the ${anchor.toFixed(1)} mi/wk anchor is ` +
      `${want.toFixed(1)} (${pct(got, want)} of it).`;
    // ── ATTRIBUTION · THE ROW IS FINER THAN THE GRID THE WEEK LANDS ON ────
    //
    // The ramp cap was one reason a reverse-taper week missed its row. With it
    // closed, a second one is visible underneath at low volume, and it is not
    // a cap at all — it is granularity, and it misses in BOTH directions.
    //
    // A recovery week of N running days can only express volumes between
    //   N × RECOVERY_MIN_EASY               (the 2-mile junk-run floor)
    //   L × (1 + EASY_BELOW_LONG × (N - 1)) (the longest run, plus N-1 runs at
    //                                        the most finalizeComposedPlan will
    //                                        let a non-long day reach)
    // On an 18 mi/wk beginner running four days, that grid is 8 to 10.2 miles.
    // Doctrine's week-2 row is 30-40% of peak — 6.3 mi — which is BELOW the
    // floor, so the week comes out over. Its week-4 row is 75% — 13.5 mi —
    // which is above the ceiling, because `RECOVERY_LONG_PCT` holds the
    // marathon's recovery long at 20% of the week (right for a marathoner on
    // six days; on four it makes the longest run under three miles, and
    // finalizeComposedPlan then holds every easy day at ~0.8 of it). So the
    // same runner is over-prescribed in week 2 and under-prescribed in week 4,
    // from one cause.
    //
    // Both halves of the bound are the engine's OWN rules read back, not
    // assumptions about it: the floor is `RECOVERY_MIN_EASY`, imported rather
    // than restated, and `EASY_BELOW_LONG` mirrors the easy≤long sweep in
    // `finalizeComposedPlan` ("easy is held STRICTLY below the long, ~0.8×, so
    // the long stays visibly the longest run"). A week cannot exceed the
    // bracket, so this can never swallow a miss the week's shape could have
    // absorbed.
    //
    // A DECISION: closing it means raising the recovery long-run share at low
    // day counts and/or moving the junk-run floor. Both move real miles for
    // real runners, and both are different constants from the ceiling fixed
    // here.
    const longest = f.longestRunMi[i] ?? 0;
    const days = f.runDays[i] ?? 0;
    if (longest > 0 && days > 0) {
      const gridLo = days * RECOVERY_MIN_EASY;
      const gridHi = longest * (1 + EASY_BELOW_LONG * (days - 1));
      if (want < gridLo || want > gridHi) {
        return {
          check: 'RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME',
          severity: 'DECISION',
          message:
            `${detail} The row is outside what this week can express: ${days} running days land ` +
            `between ${gridLo.toFixed(1)} mi (every run at the ${RECOVERY_MIN_EASY}-mile ` +
            `junk-run floor) and ${gridHi.toFixed(1)} mi (a ${longest.toFixed(1)}-mile longest ` +
            `run plus ${days - 1} at ${EASY_BELOW_LONG} of it). No ceiling is involved — the ` +
            `floor and the recovery long-run share bracket the week, and doctrine's row falls ` +
            `outside the bracket.`,
        };
      }
    }
    // ── ATTRIBUTION, not just complaint ──────────────────────────────────
    //
    // A shortfall that lands within a whisker of `prior peak × ramp ceiling`
    // is not a mystery: it is `enforceWeeklyRampCeiling` (WKRAMP-1), which
    // runs in `finalizeComposedPlan` for EVERY composer including recovery.
    //
    // That pass's own header names the two regimes it reasoned about — a step
    // onto new ground, and a rebound off a planned cutback — and it handles
    // the second by measuring against the block's PRIOR PEAK rather than last
    // week, "because measuring a rebound against the deload week would punish
    // the runner for deloading". A post-race reverse taper is a third regime,
    // and it defeats that reasoning completely: the block contains nothing BUT
    // deload weeks, so the prior peak IS the deload. Week 1 of a marathon
    // recovery is 15% of peak, the ceiling is 1.15, and 0.15 × 1.15³ = 23% —
    // so the block can never reach the 75% row it is supposed to end on, no
    // matter what the anchor says.
    //
    // RULED ON (2026-08-25) and fixed in WKRAMP-REC-1: a recovery block now
    // carries its own whole-block ceiling, `peak × recoveryBlockCeilingPct`,
    // and `enforceWeeklyRampCeiling` grades it against that instead of against
    // its own deload weeks. The attribution STAYS — it is the regression lock.
    // If the wiring is ever lost the shortfall comes back, and this names it
    // rather than reporting an unexplained miss.
    //
    // IT RUNS SECOND, AND THAT ORDER IS LOAD-BEARING. This test is a numeric
    // COINCIDENCE — "the miss happens to sit near prior peak × ceiling" — and
    // coincidences happen. With the ceiling fixed, the owner's own post-CIM
    // week 4 landed 32 mi against a 30 mi week before it and a 1.10 ceiling,
    // which is 33: a whisker from the cap, and nothing to do with the cap. The
    // grid bound above is an arithmetic PROOF that the week could not have held
    // the row, so it is asked first and this only speaks about a week whose
    // shape could have.
    const prev = i > 0 ? f.weeklyMi[i - 1] : 0;
    const priorPeak = i > 0 ? Math.max(...f.weeklyMi.slice(0, i)) : 0;
    const cap = priorPeak * f.rampCeiling;
    const cappedHere = got < want && priorPeak > 0 && Math.abs(got - cap) <= Math.max(1.5, cap * 0.08);
    if (cappedHere) {
      return {
        check: 'RAMP_CAP_TRUNCATES_REVERSE_TAPER',
        severity: 'DECISION',
        message:
          `${detail} The shortfall is the general ramp ceiling: prior peak in this block is ` +
          `${priorPeak.toFixed(1)} mi (last week ${prev.toFixed(1)}), × ${f.rampCeiling} = ` +
          `${cap.toFixed(1)}. enforceWeeklyRampCeiling is capping a reverse taper against its ` +
          `own deload weeks.`,
      };
    }

    return { check: 'VOLUME_OUTSIDE_ANCHOR_BAND', severity: 'FIRM', message: detail };
  }
  return null;
}

/**
 * A8 · THE BLOCK'S OWN AUDIT RECORD AGREES WITH THE BLOCK.
 *
 * `composeMaintenancePlan` publishes the trio `volume_anchor`,
 * `weekly_pct_applied` and `target_weekly_mi` — VOL-2 added them precisely "so
 * the audit surface cannot quietly disagree with the plan". It still can:
 * `target_weekly_mi` is rewritten to the REALIZED day-sum downstream, while the
 * fraction and the arm beside it still describe the intent. A record that says
 * "75% of last cycle's peak" beside a number that is 15% of it is a modelled
 * number wearing a measurement's clothes.
 */
export function checkStatedSizingMatchesPlan(f: AnchorFacts): Finding | null {
  if (f.statedPctApplied == null || f.peakAnchorMi == null) return null;
  const intended = f.peakAnchorMi * f.statedPctApplied;
  const biggest = Math.max(0, ...f.weeklyMi);
  if (!(intended > 0)) return null;
  if (biggest >= intended * (1 - BAND_TOLERANCE) - 1.5) return null;
  return {
    check: 'AUDIT_RECORD_DISAGREES_WITH_PLAN',
    severity: 'DECISION',
    message:
      `${f.id} · authored_state says ${f.statedAnchorArm ?? 'anchor'} × ` +
      `${f.statedPctApplied} of ${f.peakAnchorMi.toFixed(1)} = ${intended.toFixed(1)} mi/wk, ` +
      `and the biggest week in the block is ${biggest.toFixed(1)} (${pct(biggest, intended)}).`,
  };
}

/** "Never came down": peak, sustained level and current week inside one band. */
export const STEADY_SPREAD = 1.15;

/**
 * A4 · THE PLAN DOES NOT PRESCRIBE LESS THAN THE RUNNER IS ALREADY DOING —
 *      UNLESS SOMETHING MAKES THAT DELIBERATE, AND THE BLOCK SAYS SO.
 *
 * Recovery, injury and illness all legitimately prescribe below current volume;
 * that is their whole job. What is not legitimate is doing it silently. Rule 3:
 * a refusal is a correct answer, not an empty state — and the same holds for a
 * deliberate cut. The runner is owed the reason.
 *
 * The floor is again Research/22 §14's 70%: a block whose BIGGEST week is under
 * 70% of what the runner just ran is asking them to come down, and must say why.
 */
// Deliberately NOT 'hold' / 'maintain' / 'base'. Those name the MODE, not a
// reason to come down — `composeMaintenancePlan`'s own rationale opens with
// "Holding aerobic fitness", which would have exempted every maintenance block
// from this check including the one that cuts a steady runner by a third.
const DELIBERATE_WORDS = /recover|taper|deload|cutback|injur|illness|sick|return to|rebuild|easy running only|no quality/;

export function checkNoSilentDowngrade(f: AnchorFacts): Finding | null {
  const now = currentWeekMi(f.blocks);
  if (!(now > 0)) return null;
  const biggest = Math.max(0, ...f.weeklyMi);
  const floor = now * RAMP_BASE_RESUME_FRACTION;
  if (biggest + 0.05 >= floor) return null;
  if (DELIBERATE_WORDS.test(f.blockSays)) return null;
  const detail =
    `${f.id} · ${f.mode}'s biggest week is ${biggest.toFixed(1)} mi against ` +
    `${now.toFixed(1)} mi the runner just ran (${pct(biggest, now)}), and no phase ` +
    `rationale gives a reason. Block says: "${f.blockSays.slice(0, 120)}"`;

  // ── ATTRIBUTION · the maintenance percentage, and why it is a decision ──
  //
  // `composeMaintenancePlan`'s discriminator is
  // `measuredPeakWeeklyMi != null ? measuredPeakWeeklyMi > 0 : recentPeak > mean`.
  // MAINT-NOBLOCK-1 wrote it to tell a day-one onboarder ("has logged nothing")
  // from a runner who genuinely came down from a block. It cannot: for anybody
  // with ANY logged history the first arm is true, so a runner steadily holding
  // 35 mi/wk — whose peak IS their mean — is graded "last cycle's peak" and cut
  // by a third. The two arms of the same ternary give that runner opposite
  // answers, and the one that fires in production is the one that cuts.
  //
  // Research/22 §6, the section DOCTRINE-MAINTFREQ-1 ruled governs this mode,
  // says "80-100% of last cycle's peak (or whatever level the runner can
  // sustain durably)". The parenthetical is written for exactly this runner.
  //
  // A DECISION: closing it raises maintenance volume for every steadily
  // training runner.
  if (f.mode === 'maintenance' && f.statedAnchorArm === 'last_cycle_peak') {
    const sustained = sustainedOf(f.blocks);
    const noBlockBehind = f.measuredPeakMi <= sustained * STEADY_SPREAD;
    return {
      check: 'MAINTENANCE_CUTS_BELOW_CURRENT_VOLUME',
      severity: 'DECISION',
      message:
        `${detail} Sized 'last_cycle_peak' × ${f.statedPctApplied ?? '?'} off a peak of ` +
        `${f.measuredPeakMi.toFixed(1)} against a sustained ${sustained.toFixed(1)}` +
        (noBlockBehind
          ? ' — and there is no block behind this runner to be a percentage OF.'
          : '.'),
    };
  }
  return { check: 'SILENT_DOWNGRADE', severity: 'FIRM', message: detail };
}

/**
 * A5 · THE VOLUME ANCHOR AND THE PACE ANCHOR DESCRIBE THE SAME RUNNER.
 *
 * RAMPBASE-1 teaches the volume curve to read THROUGH a mandated interruption.
 * Nothing taught the pace side the same thing: with no in-window race,
 * `resolveCurrentTPace` falls to `conservativeVdotFromMileage(recentWeeklyMi)`,
 * and `recentWeeklyMi` is the interruption. So one authoring can open at the
 * sustained level's 70% and pace it off a runner half that size.
 *
 * A DECISION: closing it moves prescribed PACES for every runner without a
 * fresh race.
 */
export function checkPaceAnchorAgreesWithVolume(f: AnchorFacts): Finding | null {
  if (f.mode !== 'race-prep') return null;
  if (!f.ramp?.lifted) return null;
  if (f.vdotAnchor != null) return null;
  return {
    check: 'PACE_ANCHOR_STILL_DEPRESSED',
    severity: 'DECISION',
    message:
      `${f.id} · the volume base was lifted to ${f.ramp.baseMi.toFixed(1)} mi/wk through a ` +
      `mandated interruption, but there is no measured VDOT, so every pace is anchored on ` +
      `conservativeVdotFromMileage(${f.meanMi.toFixed(1)}) — the interruption itself. ` +
      `Volume reads the runner before the dip; pace reads the runner inside it.`,
  };
}

/**
 * A6 · ONE FREAK WEEK IS NOT A CAPACITY.
 *
 * `resolveRampBase` takes the THIRD-highest of sixteen 7-day blocks and says so
 * in as many words: "a base is a volume the runner reached repeatedly, so one
 * big week can never set it (nor can two)". `recentPeakWeeklyMileage`, feeding
 * the same runner's recovery and maintenance blocks, takes a raw MAX. Two
 * readers of the same history, two definitions of a peak.
 *
 * A DECISION: after a real build the raw max IS the peak the reverse taper
 * unwinds, and switching to rank-3 would lower prescribed recovery and
 * maintenance volume for every runner.
 */
export const OUTLIER_RATIO = 1.35;

export function checkPeakIsNotAnOutlier(f: AnchorFacts): Finding | null {
  if (f.mode === 'race-prep') return null;
  const sustained = sustainedOf(f.blocks);
  if (!(sustained > 0) || !(f.measuredPeakMi > 0)) return null;
  if (f.measuredPeakMi <= sustained * OUTLIER_RATIO) return null;
  return {
    check: 'PEAK_IS_AN_OUTLIER',
    severity: 'DECISION',
    message:
      `${f.id} · the peak anchor is ${f.measuredPeakMi.toFixed(1)} mi/wk against a sustained ` +
      `${sustained.toFixed(1)} (${pct(f.measuredPeakMi, sustained)}). ` +
      `resolveRampBase would refuse this as a base; recentPeakWeeklyMileage takes it as one.`,
  };
}

/**
 * A7 · A STALE PEAK IS NOT A CURRENT ONE.
 *
 * `recentPeakWeeklyMileage`'s 16-week window is chosen so a post-race authoring
 * always contains the build's peak. It has no upper guard: a runner whose
 * interruption has run LONGER than anything the engine mandated is still
 * anchored to the week before it started. That is the same circularity in
 * reverse — an anchor that describes a body from four months ago.
 *
 * A DECISION: the composers have no notion of interruption length at all
 * (RAMPBASE-1 gave that only to race-prep), so wiring it in changes prescribed
 * volume for every interrupted maintenance and recovery runner.
 */
export function checkPeakIsNotStale(f: AnchorFacts): Finding | null {
  if (f.mode === 'race-prep') return null;
  if (f.dipIsMandated) return null;
  if (f.interruptionWeeks <= f.allowedInterruptionWeeks) return null;
  const anchor = f.peakAnchorMi ?? 0;
  const now = currentWeekMi(f.blocks);
  if (!(anchor > 0)) return null;
  if (anchor <= Math.max(now, 1) * 1.6) return null;
  return {
    check: 'PEAK_IS_STALE',
    severity: 'DECISION',
    message:
      `${f.id} · ${f.interruptionWeeks} weeks below the resume level with only ` +
      `${f.allowedInterruptionWeeks} explained, yet the block is still anchored to ` +
      `${anchor.toFixed(1)} mi/wk from before it. The runner is currently on ` +
      `${now.toFixed(1)}. resolveRampBase refuses to read through this; the peak reader ` +
      `has no equivalent guard.`,
  };
}

/**
 * A9 · A RECOVERY BLOCK IS STILL RECOVERY.
 *
 * The other side of WKRAMP-REC-1. That fix removed a cap, and a removed cap
 * needs something asserting what still bounds the thing — otherwise the next
 * edit to `recoveryBlockCeilingPct` or to the wiring in `finalizeComposedPlan`
 * has nothing standing in its way.
 *
 * Research/00b's reverse taper runs to 70-80% of peak and then says, in the
 * note under its own table, that "full return to peak training load" is
 * typically week 5-6 — AFTER the block. So no week inside a recovery block may
 * reach the pre-race peak. A3 already grades each week against its own row in
 * both directions; this is the absolute line underneath it, stated separately
 * because it is the one the fix could plausibly break.
 *
 * FIRM. Nothing about it is a judgement call.
 */
export function checkRecoveryStaysBelowPeak(f: AnchorFacts): Finding | null {
  if (f.mode !== 'recovery') return null;
  const anchor = f.peakAnchorMi ?? 0;
  if (!(anchor > 0)) return null;
  const biggest = Math.max(0, ...f.weeklyMi);
  if (biggest <= anchor + 0.05) return null;
  return {
    check: 'RECOVERY_EXCEEDS_PRE_RACE_PEAK',
    severity: 'FIRM',
    message:
      `${f.id} · a recovery week prescribes ${biggest.toFixed(1)} mi against a pre-race peak of ` +
      `${anchor.toFixed(1)} (${pct(biggest, anchor)}). Research/00b puts the full return to peak ` +
      `at week 5-6, after this block — the reverse taper ends at 70-80%, not above it.`,
  };
}

export const CHECKS: readonly { name: string; run: (f: AnchorFacts) => Finding | null }[] = [
  { name: 'ANCHOR_CIRCULAR', run: checkAnchorNotCircular },
  { name: 'ANCHOR_INFLATED', run: checkAnchorNotInflated },
  { name: 'VOLUME_OUTSIDE_ANCHOR_BAND', run: checkVolumesInBandOfAnchor },
  { name: 'AUDIT_RECORD_DISAGREES_WITH_PLAN', run: checkStatedSizingMatchesPlan },
  { name: 'SILENT_DOWNGRADE', run: checkNoSilentDowngrade },
  { name: 'PACE_ANCHOR_STILL_DEPRESSED', run: checkPaceAnchorAgreesWithVolume },
  { name: 'PEAK_IS_AN_OUTLIER', run: checkPeakIsNotAnOutlier },
  { name: 'PEAK_IS_STALE', run: checkPeakIsNotStale },
  { name: 'RECOVERY_EXCEEDS_PRE_RACE_PEAK', run: checkRecoveryStaysBelowPeak },
];

/**
 * Every finding name this module can emit. Two of the checks ATTRIBUTE — they
 * emit a different, more specific name when the shortfall has a known cause —
 * so the list is longer than `CHECKS`. `_anchor_fit.test.ts`'s GUARD 0 proves
 * a positive control exists for each of these, because a predicate that can
 * never fire is a gate reporting a clean codebase it never looked at.
 */
export const EMITTABLE: readonly string[] = [
  'ANCHOR_CIRCULAR',
  'ANCHOR_INFLATED',
  'VOLUME_OUTSIDE_ANCHOR_BAND',
  'RAMP_CAP_TRUNCATES_REVERSE_TAPER',
  'RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME',
  'RECOVERY_EXCEEDS_PRE_RACE_PEAK',
  'AUDIT_RECORD_DISAGREES_WITH_PLAN',
  'SILENT_DOWNGRADE',
  'MAINTENANCE_CUTS_BELOW_CURRENT_VOLUME',
  'PACE_ANCHOR_STILL_DEPRESSED',
  'PEAK_IS_AN_OUTLIER',
  'PEAK_IS_STALE',
];

export function runChecks(f: AnchorFacts): Finding[] {
  const out: Finding[] = [];
  for (const c of CHECKS) {
    const r = c.run(f);
    if (r) out.push(r);
  }
  return out;
}

/* ── fixture helper · a daily series from a weekly one ───────────────────────
 *
 * `weeks[0]` is the 7 days ending today. Within a week the miles are laid out
 * over `runDays` days with the long run first, which is what makes the ROLLING
 * peak differ from the calendar one — the property `recentPeakWeeklyMileage`
 * exists to capture and the reason a fixture cannot be weekly totals alone.
 */
export function dailyFromWeekly(
  weeks: readonly number[],
  opts: { runDays?: number; longShare?: number; offsetDays?: number } = {},
): number[] {
  const runDays = Math.max(1, Math.min(7, opts.runDays ?? 5));
  const longShare = opts.longShare ?? 0.28;
  const offset = opts.offsetDays ?? 0;
  const daily: number[] = [];
  for (const wk of weeks) {
    const days = new Array(7).fill(0) as number[];
    if (wk > 0) {
      const long = Math.round(wk * longShare * 10) / 10;
      const rest = Math.max(0, wk - long);
      const each = runDays > 1 ? Math.round((rest / (runDays - 1)) * 10) / 10 : 0;
      days[(0 + offset) % 7] = long;
      for (let i = 1; i < runDays; i++) days[(i * 2 + offset) % 7 || 1] = each;
      // Put any rounding residue on the long run so the week sums exactly.
      const sum = days.reduce((a, b) => a + b, 0);
      days[(0 + offset) % 7] = Math.round((days[(0 + offset) % 7] + (wk - sum)) * 10) / 10;
    }
    for (const d of days) daily.push(Math.max(0, Math.round(d * 10) / 10));
  }
  return daily;
}
