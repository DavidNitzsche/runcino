/**
 * lib/plan/phase-answers.ts · PHASE-ANSWERS-1 (2026-09-01) · every phase of a
 * composed block answers four questions, in a STRUCTURED field, not prose only.
 *
 *   1. What are we developing?
 *   2. Why now?
 *   3. What evidence says the runner can absorb it?
 *   4. What would cause the phase to hold, progress, or restructure?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `sizeBlocks` stamps each phase with one fixed sentence ("Intervals +
 * threshold sessions to lift aerobic ceiling.") and one citation, the same
 * words for every runner on every block. `docs/PRODUCT_COACHING_DOCTRINE.md`
 * §36 sets the bar the block has to clear: "What are we trying to improve? Why
 * is today's workout appropriate? Is the runner responding? What, if anything,
 * should change?" — and Brief 04's success test is "for every workout: why this
 * workout? why this week? why for this runner?". A sentence that does not
 * mention the runner cannot answer "why for this runner".
 *
 * ── OWNERSHIP (Constitution §H, §F) ──────────────────────────────────────────
 *
 * The Plan Generator OWNS "what training should happen and when", so the phase
 * answers are its to write. It does NOT own fitness or strategy: the limiter
 * named here is the Coaching Thesis's, carried in as an input and quoted, and
 * every number in the evidence sentence is a reading the composer was already
 * handed (ramp evidence, habit readers, the canonical anchors' provenance).
 * Nothing here computes a capacity, ranks one, or invents a score (§11).
 *
 * ── RULE 11 · three facts, never one ─────────────────────────────────────────
 *
 * A reading the composer was not given is said to be absent ("not yet
 * measured"), never zero-filled into a confident sentence. A thesis that was
 * not resolved (a pure caller, a failed read) is `UNRESOLVED`, and the
 * sentence says the limiter has not been named rather than picking one.
 *
 * ── VOICE ────────────────────────────────────────────────────────────────────
 *
 * Coach voice (CLAUDE.md §Operating posture): short, direct, no hype, no
 * exclamation marks, no em dashes. Numbers are the runner's own. The prose is
 * built from the structured `basis` so the two cannot disagree (Rule 16).
 *
 * ── RULE 22 · what this module cannot fail on ────────────────────────────────
 *
 * It describes the block the composer authored; it cannot tell whether that
 * block was RIGHT. A wrong phase length with a correct sentence about it
 * passes here and belongs to the sweep and the doctrine gate.
 */

import type { DistCategory } from './goal-tiers';
import { roundTo } from '@/lib/format/run';
import type { GoalTier, TierTarget } from './goal-tiers';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import type { SourceMode } from '@/lib/training/capacity-resolver';
import type { ThesisLimiter, ThesisPriority } from '@/lib/training/coaching-thesis';

/** The slice of the Coaching Thesis a block authoring carries. Resolved by
 *  `resolveCoachingThesis` (the owner) in `loadGeneratorInputs`; a pure caller
 *  has none and the answers say so. */
export interface ThesisAtAuthoring {
  primaryLimiter: ThesisLimiter;
  priority: ThesisPriority;
  /** The limiter's own resolved confidence, or null when `UNKNOWN`. */
  confidence: number | null;
  /** `resolved` · the owner answered. `read_failed` · the owner could not be
   *  reached; a different fact from "no runner history" (Rule 11). */
  source: 'resolved' | 'read_failed';
}

/** The stressors a phase moves, in the adaptation doctrine's own vocabulary
 *  (`docs/ADAPTATION_PROGRESSION_DOCTRINE.md` · pace / duration / density /
 *  specificity are separate questions). */
export type PhaseStressor =
  | 'aerobic_volume'
  | 'run_frequency'
  | 'threshold'
  | 'high_intensity'
  | 'long_run_duration'
  | 'race_pace_durability'
  | 'race_specificity'
  | 'freshness';

export interface PhaseAnswerBasis {
  label: string;
  weeksInPhase: number;
  /** Whole weeks from the phase's first day to race day. */
  weeksOutAtStart: number;
  /** Whole weeks from the phase's last day to race day (0 = race week). */
  weeksOutAtEnd: number;
  stressors: PhaseStressor[];
  limiter: ThesisLimiter | 'UNRESOLVED';
  thesisPriority: ThesisPriority | null;
  facts: {
    sustainedMi: number | null;
    meanMi: number | null;
    heldMi: number | null;
    peakMi: number | null;
    recentLongMi: number | null;
    easyDayMedianMi: number | null;
    qualityPerWeekHabit: number | null;
    qualityPerWeekPlanned: number;
    blockPeakWeeklyMi: number;
    blockPeakLongMi: number;
    phasePeakWeeklyMi: number;
    phasePeakLongMi: number;
    racePaceLongsInPhase: number;
    tuneUpRacesInPhase: string[];
    thresholdSourceMode: SourceMode | null;
    thresholdConfidence: number | null;
    marathonSourceMode: SourceMode | null;
    marathonConfidence: number | null;
    tier: GoalTier | null;
    tierPeakWeeklyBand: [number, number] | null;
    tierPeakLongBand: [number, number] | null;
  };
  doctrine: string[];
}

export interface PhaseAnswer {
  developing: string;
  whyNow: string;
  evidence: string;
  hold: string;
  progress: string;
  restructure: string;
  basis: PhaseAnswerBasis;
}

/** Everything the answers are built from. Every field is a reading the
 *  composer already holds; none is derived here. */
export interface PhaseAnswerInputs {
  cat: DistCategory;
  raceDistanceMi: number;
  phases: ReadonlyArray<{ label: string; weeks: number }>;
  weeks: ReadonlyArray<{
    phase: string;
    weeklyMi: number;
    isRaceWeek: boolean;
    days: ReadonlyArray<{ type: string; distanceMi: number; isLong: boolean; isQuality: boolean; subLabel: string | null }>;
  }>;
  /** Null on a composer that classifies no tier (the recovery block). */
  tier: GoalTier | null;
  tierTarget: Pick<TierTarget, 'peakWeeklyMileageBand' | 'peakLongMiBand'> | null;
  qualityDowsPlanned: number;
  rampEvidence: {
    sustainedMi: number; meanMi: number; heldMi: number; peakMi: number;
    returning: boolean; interruptionWeeks: number; allowedInterruptionWeeks: number;
  } | null;
  recentLongMi: number | null;
  easyDayMedianMi: number | null;
  /** `undefined` · not measured. `null` · the read failed. A number, including
   *  0, is a measurement. */
  recentQualityPerWeek: number | null | undefined;
  anchors: Pick<PrescribedPaceAnchors, 'basis'> | null;
  thesis: ThesisAtAuthoring | null;
  embeddedRaces: ReadonlyArray<{ name: string; weekIdx: number; priority: 'B' | 'C'; distanceMi: number }>;
  isMidBlock: boolean;
  /** The engine's own layoff allowance for this authoring (weeks). */
  allowedInterruptionWeeks: number | null;
}

const LIMITER_WORD: Record<Exclude<ThesisLimiter, 'UNKNOWN'>, string> = {
  THRESHOLD: 'threshold',
  HIGH_INTENSITY: 'speed',
  DURABILITY: 'durability',
};

const RACE_WORD: Record<DistCategory, string> = {
  '5k': '5K', '10k': '10K', hm: 'half marathon', m: 'marathon', ultra: 'ultra',
};

function mi(n: number): string {
  return `${roundTo(n, 1)} mi`;
}

/**
 * RULE 11, APPLIED ONCE · a mileage reading that is genuinely absent.
 *
 * The readers this module quotes state their own contract for absence, and it
 * is the same one in every case: `resolveRampBase` returns `sustainedMi` /
 * `heldMi` / `peakMi` as 0 when there is NO HISTORY to rank, `easyDayMedianMi`
 * returns 0 as its documented REFUSAL ("no recoverable baseline"), and
 * `recentPeakLongMi` returns 0 for "no runs in the window". None of them can
 * emit a measured zero — a runner who ran zero miles has no run rows at all,
 * which is the same state.
 *
 * Written as a guard rather than as `v > 0 ? v : null` at six call sites for
 * two reasons. Rule 16: six copies of one interpretation is six chances to
 * disagree about what absence means. And Rule 11: a ternary buried in an
 * object literal is exactly the shape that makes a collapse invisible, so the
 * interpretation is named, stated and citable in one place instead.
 *
 * A caller with a reading that CAN be a measured zero must not route it
 * through here — `qualityPerWeekHabit` deliberately does not, because a
 * measured "no quality sessions" is a real and important fact.
 */
function measuredMi(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  if (!(v > 0)) return null;
  return v;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function sourceWord(mode: SourceMode | null): string {
  switch (mode) {
    case 'direct': return 'a direct read of your own sessions';
    case 'inferred': return 'inferred from your training';
    case 'race_derived': return 'derived from a race you ran';
    case 'vdot_fallback': return 'a VDOT equivalence, not a direct read';
    case 'user_prior': return 'what you told us, not yet observed';
    case 'population_prior': return 'a population assumption, not yet observed';
    default: return 'not yet priced';
  }
}

/** Race-pace long: a long run whose sub_label declares a race-pace segment. */
function isRacePaceLong(d: { type: string; isLong: boolean; subLabel: string | null }): boolean {
  return d.isLong && d.type === 'long' && /@\s*(HM|MP|M|T)\b/i.test(String(d.subLabel ?? ''));
}

/**
 * Build one answer set per phase, in the block's own phase order.
 *
 * Pure. Deterministic for the same inputs, so an authoring and its simulator
 * twin produce byte-identical answers (the same discipline as `sizeBlocks`).
 */
export function buildPhaseAnswers(input: PhaseAnswerInputs): PhaseAnswer[] {
  const totalWeeks = input.weeks.length;
  const blockPeakWeeklyMi = Math.max(0, ...input.weeks.filter((w) => !w.isRaceWeek).map((w) => w.weeklyMi ?? 0));
  const blockPeakLongMi = Math.max(0, ...input.weeks.flatMap((w) =>
    w.days.filter((d) => d.isLong && d.type === 'long').map((d) => d.distanceMi)));
  const ev = input.rampEvidence;
  const th = input.anchors?.basis.threshold ?? null;
  const mp = input.anchors?.basis.marathon ?? null;
  const limiter: ThesisLimiter | 'UNRESOLVED' =
    input.thesis && input.thesis.source === 'resolved' ? input.thesis.primaryLimiter : 'UNRESOLVED';
  const qualityHabit = typeof input.recentQualityPerWeek === 'number' ? input.recentQualityPerWeek : null;
  const raceWord = RACE_WORD[input.cat];

  const out: PhaseAnswer[] = [];
  let cursor = 0;
  for (const ph of input.phases) {
    const startIdx = cursor;
    const endIdx = Math.min(totalWeeks - 1, cursor + ph.weeks - 1);
    cursor += ph.weeks;
    const phaseWeeks = input.weeks.slice(startIdx, endIdx + 1);
    const weeksOutAtStart = Math.max(0, totalWeeks - 1 - startIdx);
    const weeksOutAtEnd = Math.max(0, totalWeeks - 1 - endIdx);
    const phasePeakWeeklyMi = Math.max(0, ...phaseWeeks.filter((w) => !w.isRaceWeek).map((w) => w.weeklyMi ?? 0));
    const phasePeakLongMi = Math.max(0, ...phaseWeeks.flatMap((w) =>
      w.days.filter((d) => d.isLong && d.type === 'long').map((d) => d.distanceMi)));
    const racePaceLongsInPhase = phaseWeeks.reduce(
      (n, w) => n + w.days.filter(isRacePaceLong).length, 0);
    const tuneUps = input.embeddedRaces
      .filter((r) => r.weekIdx >= startIdx && r.weekIdx <= endIdx)
      .map((r) => r.name);

    const facts: PhaseAnswerBasis['facts'] = {
      sustainedMi: measuredMi(ev?.sustainedMi),
      meanMi: ev?.meanMi ?? null,
      heldMi: measuredMi(ev?.heldMi),
      peakMi: measuredMi(ev?.peakMi),
      recentLongMi: measuredMi(input.recentLongMi),
      easyDayMedianMi: measuredMi(input.easyDayMedianMi),
      qualityPerWeekHabit: qualityHabit,
      qualityPerWeekPlanned: input.qualityDowsPlanned,
      blockPeakWeeklyMi, blockPeakLongMi, phasePeakWeeklyMi, phasePeakLongMi,
      racePaceLongsInPhase, tuneUpRacesInPhase: tuneUps,
      thresholdSourceMode: th?.sourceMode ?? null,
      thresholdConfidence: th ? Math.round(th.confidence * 100) / 100 : null,
      marathonSourceMode: mp?.sourceMode ?? null,
      marathonConfidence: mp ? Math.round(mp.confidence * 100) / 100 : null,
      tier: input.tier,
      tierPeakWeeklyBand: input.tierTarget?.peakWeeklyMileageBand ?? null,
      tierPeakLongBand: input.tierTarget?.peakLongMiBand ?? null,
    };

    const base: Omit<PhaseAnswerBasis, 'stressors' | 'doctrine'> = {
      label: ph.label, weeksInPhase: ph.weeks, weeksOutAtStart, weeksOutAtEnd,
      limiter, thesisPriority: input.thesis?.source === 'resolved' ? input.thesis.priority : null, facts,
    };

    // ── shared sentences ───────────────────────────────────────────────────
    const volumeEvidence = (() => {
      const sustained = measuredMi(ev?.sustainedMi);
      if (ev == null || sustained == null) {
        return 'There is no measured weekly volume behind this block yet, so it is sized from what you told us and stays conservative until a few weeks are logged.';
      }
      // `heldMi` absent means the ramp reader had no completed 7-day block to
      // read, and the 28-day mean is then the only honest statement of what
      // the runner is running now.
      const held = measuredMi(ev.heldMi) ?? ev.meanMi;
      const peak = measuredMi(ev.peakMi);
      return `You have held ${mi(sustained)} a week repeatedly and are running ${mi(held)} now`
        + (peak != null ? `, with a biggest week of ${mi(peak)}.` : '.');
    })();
    const thresholdEvidence = th
      ? `Threshold pace is ${sourceWord(th.sourceMode)} at confidence ${facts.thresholdConfidence}.`
      : 'Threshold pace has not been priced.';
    const limiterSentence = limiter === 'UNRESOLVED'
      ? 'The limiter has not been named for this authoring.'
      : limiter === 'UNKNOWN'
        ? 'There is not enough direct evidence yet to name a limiter, so no single trait is pushed ahead of the others.'
        : `The coaching thesis names ${LIMITER_WORD[limiter]} as the least evidenced capacity, so it is where the work goes.`;
    const layoffSentence = input.allowedInterruptionWeeks != null
      ? `A layoff longer than ${input.allowedInterruptionWeeks} weeks hands the block to the comeback protocol and it is re-authored.`
      : 'A layoff hands the block to the comeback protocol and it is re-authored.';

    let answer: PhaseAnswer;
    switch (ph.label) {
      case 'BASE': {
        const sustainedForShare = measuredMi(ev?.sustainedMi);
        const below = sustainedForShare != null && ev != null ? pct(ev.meanMi, sustainedForShare) : null;
        answer = {
          developing: 'Aerobic volume and run frequency, with strides on the easy days. No structured quality yet.',
          whyNow: below != null
            ? `Volume is at ${below}% of the level you have held, below the deepest planned down week, so volume is rebuilt before intensity. ${ph.weeks} weeks are spent here with ${weeksOutAtEnd} weeks still to the ${raceWord}.`
            : `Volume is rebuilt before intensity. ${ph.weeks} weeks are spent here with ${weeksOutAtEnd} weeks still to the ${raceWord}.`,
          evidence: `${volumeEvidence} ${thresholdEvidence}`,
          hold: 'Easy days that run above the heart-rate ceiling, or a week that is not absorbed, hold volume where it is.',
          progress: `Weeks absorbed at the prescribed volume earn the next step, toward ${mi(phasePeakWeeklyMi)} by the end of the phase.`,
          restructure: `${layoffSentence} An injury or illness flag stops normal training first.`,
          basis: {
            ...base,
            stressors: ['aerobic_volume', 'run_frequency'],
            doctrine: [
              'Research/00a-distance-running-training.md §Periodization',
              'Research/00b-recovery-protocols.md §Reverse Periodization for Marathon Recovery',
            ],
          },
        };
        break;
      }
      case 'QUALITY': {
        const opensOnQuality = startIdx === 0 && input.isMidBlock;
        const sustainedForOpen = measuredMi(ev?.sustainedMi);
        const whyOpen = (() => {
          if (!opensOnQuality) return 'The base phase is done.';
          if (ev == null || sustainedForOpen == null) {
            return 'You have been doing quality work recently, so the block opens on quality rather than base.';
          }
          const holding = measuredMi(ev.heldMi) ?? ev.meanMi;
          return `The base is in place: you are holding ${pct(holding, sustainedForOpen)}% of the ${mi(sustainedForOpen)} a week you have held, inside the range doctrine treats as a down week, so the block opens on quality rather than base.`;
        })();
        const qualityHabitSentence = qualityHabit != null
          ? `You have run ${qualityHabit} quality sessions a week in normal training and the plan asks for ${input.qualityDowsPlanned}.`
          : `Quality frequency in normal training is not yet measured, so the plan opens at ${input.qualityDowsPlanned} a week from your preferences.`;
        const longSentence = facts.recentLongMi != null
          ? `Your longest run in normal training is ${mi(facts.recentLongMi)}, and the long run climbs to ${mi(phasePeakLongMi)} inside this phase.`
          : `The long run climbs to ${mi(phasePeakLongMi)} inside this phase.`;
        answer = {
          developing: `Threshold and high-intensity capacity, and the long run's duration, before ${raceWord} pace work starts. ${limiterSentence}`,
          whyNow: `${whyOpen} ${ph.weeks} weeks are spent here, from ${weeksOutAtStart} to ${weeksOutAtEnd} weeks out, and the weeks after it are reserved for race-specific work and the taper.`,
          evidence: `${volumeEvidence} ${thresholdEvidence} ${qualityHabitSentence} ${longSentence}`,
          hold: 'Quality sessions not held with control, or heart rate climbing well past the band for the pace, hold pace where it is. A long run that fades late holds duration.',
          progress: 'Three corroborated sessions faster than target with heart rate in the band move the threshold anchor. A long run finished under control earns the next step in duration. One stressor moves at a time.',
          restructure: `${layoffSentence} A tune-up race that moves the race outlook past its likely range, or an injury flag, re-authors the phase.`,
          basis: {
            ...base,
            stressors: ['threshold', 'high_intensity', 'long_run_duration'],
            doctrine: [
              'Research/04-workout-vocabulary.md §15. Training-cycle placement summary',
              'Research/00a-distance-running-training.md §Volume progression rules',
              'docs/ADAPTATION_PROGRESSION_DOCTRINE.md',
            ],
          },
        };
        break;
      }
      case 'RACE-SPECIFIC': {
        const mpSentence = input.cat === 'm'
          ? (mp
              ? `Marathon pace is ${sourceWord(mp.sourceMode)}, threshold carried to 26.2 through your own endurance exponent, at confidence ${facts.marathonConfidence}.`
              : 'Marathon pace has not been priced.')
          : '';
        const tuneUpSentence = tuneUps.length > 0
          ? ` ${tuneUps.join(' and ')} sits inside this phase as a tune-up and takes its own recovery window.`
          : '';
        answer = {
          developing: input.cat === 'm' || input.cat === 'hm'
            ? `Race-pace durability: race-pace segments inside the long run and race-specific sessions. ${racePaceLongsInPhase} long run${racePaceLongsInPhase === 1 ? '' : 's'} in this phase carr${racePaceLongsInPhase === 1 ? 'ies' : 'y'} race pace.`
            : `Race-pace work at the ${raceWord}'s own demands, with threshold support.`,
          whyNow: `Doctrine places the ${raceWord}'s race-specific work in the last ${ph.weeks + weeksOutAtEnd} weeks before the taper. This phase runs from ${weeksOutAtStart} to ${weeksOutAtEnd} weeks out.${tuneUpSentence}`,
          evidence: `The long run reached ${mi(blockPeakLongMi)} and the biggest week ${mi(blockPeakWeeklyMi)} before or during this phase. ${thresholdEvidence} ${mpSentence}`.trim(),
          hold: 'A race-pace segment that fades late, or heart rate that decouples from pace inside it, holds the segment length where it is.',
          progress: 'A race-pace segment finished under control earns a longer one. Pace moves only when the capacity anchor moves.',
          restructure: `A tune-up result that moves the race outlook past its likely range, or an injury flag, re-authors the phase. ${layoffSentence}`,
          basis: {
            ...base,
            stressors: ['race_pace_durability', 'race_specificity'],
            doctrine: [
              'Research/04-workout-vocabulary.md §4.4 Marathon-pace long run',
              'Research/04-workout-vocabulary.md §14. Race-specific workouts',
              'Research/00a-distance-running-training.md §7. Race-specific',
            ],
          },
        };
        break;
      }
      case 'TAPER': {
        answer = {
          developing: 'Freshness. Volume comes down, intensity stays, and the race-pace touches are rehearsals rather than tests.',
          whyNow: `Doctrine gives the ${raceWord} a taper of ${ph.weeks} weeks. The block's peak week (${mi(blockPeakWeeklyMi)}) and longest run (${mi(blockPeakLongMi)}) are behind you.`,
          evidence: `The taper is sized as a fraction of the block's own peak week, ${mi(blockPeakWeeklyMi)}, not of a template. ${thresholdEvidence}`,
          hold: 'Nothing changes on a flat or heavy-legged session. Taper crud is normal and the work is done.',
          progress: 'A taper does not progress. The sessions hold the pace already earned.',
          restructure: 'Illness or injury inside the taper hands the week to the race-week briefing, which decides the day.',
          basis: {
            ...base,
            stressors: ['freshness'],
            doctrine: [
              'Research/08-pacing-and-race-week.md §9.1 Taper duration by distance',
              'Research/08-pacing-and-race-week.md §9.2 Marathon taper structure (3 weeks)',
            ],
          },
        };
        break;
      }
      default: {
        // MAINTENANCE / RECOVERY, authored outside `sizeBlocks`. Their shape
        // is the composer's; the answers describe it honestly rather than
        // pretending it is a build phase.
        const isRecovery = ph.label === 'RECOVERY';
        answer = {
          developing: isRecovery
            ? 'Recovery. Easy running only, rebuilding frequency before duration and duration before intensity.'
            : 'Holding aerobic fitness. Volume and one quality session a week, no race-specific stress.',
          whyNow: isRecovery
            ? 'A race was just run and its recovery window is not over.'
            : 'The next build has not opened yet.',
          evidence: `${volumeEvidence} ${thresholdEvidence}`,
          hold: 'A week that is not absorbed holds volume where it is.',
          progress: isRecovery
            ? 'Frequency returns first, then duration, then a short tempo. Quality returns when the recovery window closes.'
            : 'The build opens when the race is inside its build window.',
          restructure: `${layoffSentence}`,
          basis: {
            ...base,
            stressors: isRecovery ? ['run_frequency', 'aerobic_volume'] : ['aerobic_volume'],
            doctrine: isRecovery
              ? ['Research/00b-recovery-protocols.md §Reverse Periodization for Marathon Recovery']
              : ['Research/22-plan-templates.md §7. Maintenance Plan'],
          },
        };
      }
    }
    out.push(answer);
  }
  return out;
}

/** The additive wire keys a phase carries on `/api/v5/block` `phases[]`.
 *  Named here so the route and its test read one list (Rule 16). */
export const PHASE_ANSWER_WIRE_KEYS = ['developing', 'whyNow', 'evidence', 'hold', 'progress', 'restructure'] as const;
export type PhaseAnswerWireKey = (typeof PHASE_ANSWER_WIRE_KEYS)[number];
