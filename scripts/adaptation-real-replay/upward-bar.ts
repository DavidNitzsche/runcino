/**
 * scripts/adaptation-real-replay/upward-bar.ts · IS THE BAR A BAR, OR IS IT A
 * WALL?
 *
 * CLAUDE.md Rule 21 sets a standard higher than Rule 15's:
 *
 *     "Prove it fires, on real history. Compute what the runner would have had
 *      to DO to trigger it, then check whether any week they have actually run
 *      would have. If none could, the bar is not a bar, it is a wall."
 *
 * The replay already answers half of that. It walks the owner's real season and
 * reports PROGRESS 0 across 120 records — the engine built to end Rule 21's
 * zero proposes zero increases on the runner Rule 21 measured. What it does not
 * answer is the half that matters for fixing anything: **how close did he ever
 * come, and to WHICH gate.** A distribution of zeroes tells you the door did not
 * open. It does not tell you whether the handle is stiff or the door is a wall.
 *
 * This file is the instrument for that question, and it answers it two ways
 * that have to agree.
 *
 * ── 1 · MEASUREMENT ────────────────────────────────────────────────────────
 *
 * At every decision point, each upward gate is read as a NUMBER against the
 * contract constant it is judged by:
 *
 *     lever · gate · unit · required · observed · met
 *
 * Aggregated over the season, that gives the sentence Rule 21 asks for: "the
 * bar is three consecutive weeks at 95%; his best three consecutive
 * non-cutback weeks completed at 88%, and that was the week of 2026-05-18."
 *
 * Every observation is read off the `CanonicalAdaptationInput` — which is data,
 * assembled by `build-input.ts` from his rows — or through the ENGINE'S OWN
 * admissibility functions. Nothing here re-implements a lever's decision. That
 * distinction is load-bearing: a harness that reimplements the engine proves
 * things about the harness (Rule 13's fixture trap, one level up).
 *
 * ── 2 · COUNTERFACTUAL, WHICH IS THE CHECK ON THE MEASUREMENT ──────────────
 *
 * A measurement can be confidently wrong. So each decision point is also
 * replayed through the real `evaluateAdaptation` under a LADDER of minimal
 * edits to what the runner did — his weeks credited at exactly the bar, then
 * his key sessions graded FULL, then his long runs at the bar — and the
 * SMALLEST rung that produces a PROGRESS is recorded.
 *
 * If the measurement says "he was one week short" and the rung that fixes
 * exactly that flips the engine to PROGRESS, the two agree and the reading can
 * be trusted. If the rung does NOT flip it, something else is binding and the
 * measurement was answering the wrong question — which is itself the finding,
 * and is exactly the kind of confident wrongness this repo has shipped before.
 *
 * The ladder is a diagnostic, never a proposal. Nothing it produces is written
 * anywhere, and the counterfactual inputs are discarded.
 *
 * ── RULE 22 · WHAT THIS INSTRUMENT CANNOT FAIL ON ──────────────────────────
 *
 * · **A gate nobody enumerated.** The measurement layer reads the gates listed
 *   in `GATES` below. A lever that grows a new precondition is not measured
 *   until somebody adds it, and the season summary would then confidently
 *   report a bar that is no longer the binding one. The counterfactual layer is
 *   the mitigation — a rung that clears every enumerated gate and still fails to
 *   produce PROGRESS names the omission — but it cannot say WHICH gate.
 * · **A wrong input.** Everything `build-input.ts` says about itself applies
 *   here in full. A mis-matched prescription makes a completion fraction
 *   confidently wrong, and the bar reading inherits it exactly.
 * · **Whether the bar is at the RIGHT height.** It can say he never reached
 *   three weeks at 95%. It has no opinion on whether 95% is the right number,
 *   and it must not have one: those constants are contract-cited and Rule 21 is
 *   explicit that push is bought by spending headroom doctrine already allows,
 *   never by weakening a guard.
 * · **The counterfactual being realistic.** "If his three missed July weeks had
 *   been completed" is a season he did not have. It bounds what the engine
 *   COULD have done; it does not claim he could have done it.
 * · **A gate that is unreachable for an input reason rather than a behaviour
 *   reason.** A long-run gate that never fires because the thirds are
 *   unreadable is reported as unmet, and "he never ran well enough" and "the
 *   watch never segmented it" are Rule 11 opposites. The `blockedByData` flag
 *   below is how they are told apart, and it is only as good as the flags
 *   `build-input.ts` could set.
 */
import {
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
  THRESHOLD_MIN_QUALIFYING_SESSIONS,
  LONG_RUN_COMPLETION_MIN_FRAC,
  LONG_RUN_LOOKBACK_COUNT,
  LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} from '@/lib/adaptation/canonical/contract-constants';
import {
  qualifiesAsLongRunEvidence, qualifiesAsThresholdEvidence,
} from '@/lib/adaptation/canonical/admissibility';
import { assessDeterioration, deteriorationPattern } from '@/lib/adaptation/canonical/deterioration';
import { GRADES_THAT_COUNT_AS_EVIDENCE } from '@/lib/adaptation/canonical/stimulus';
import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';
import {
  measured, prescribedNonNormalWeek,
  type CanonicalAdaptationInput, type CanonicalLever,
} from '@/lib/adaptation/canonical/input';

/* ══════════════════════════════════════════════════════════════════════════
 * THE READING
 * ═══════════════════════════════════════════════════════════════════════ */

export interface BarReading {
  readonly decisionISO: string;
  readonly lever: CanonicalLever;
  /** Stable id, so a season summary can group without matching prose. */
  readonly gate: string;
  /** What the gate asks, in the runner's terms. */
  readonly question: string;
  readonly unit: string;
  readonly required: number;
  readonly observed: number;
  /** True when a HIGHER observed value is better. False for "no more than N". */
  readonly higherIsBetter: boolean;
  readonly met: boolean;
  /**
   * Rule 11 · the gate could not be judged because the data was unreadable,
   * which is a different fact from the runner falling short of it. A summary
   * that collapses the two says "he never earned it" about a watch that never
   * segmented the run.
   */
  readonly blockedByData: boolean;
  /** The evidence behind the number, so a reading can be argued with. */
  readonly detail: string;
}

export interface GateSummary {
  readonly lever: CanonicalLever;
  readonly gate: string;
  readonly question: string;
  readonly unit: string;
  readonly required: number;
  readonly higherIsBetter: boolean;
  readonly pointsEvaluated: number;
  readonly pointsBlockedByData: number;
  /** Rule 21's question, answered yes or no. */
  readonly everMet: boolean;
  /** The closest he ever came, and when. */
  readonly bestObserved: number | null;
  readonly bestOnISO: string | null;
  readonly bestDetail: string | null;
  /** How far short the closest attempt was, in the gate's own unit. */
  readonly shortfallAtBest: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATES  ·  one entry per upward precondition, measured off the input
 * ═══════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS);

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/**
 * Read every upward gate at one decision point.
 *
 * The three lever sections mirror the order the levers themselves check in, so
 * a reader can hold this beside `levers/*.ts` and see that nothing was invented
 * and nothing was dropped.
 */
export function readBarsAt(
  decisionISO: string,
  input: CanonicalAdaptationInput,
): BarReading[] {
  const out: BarReading[] = [];
  const push = (r: Omit<BarReading, 'decisionISO'>) => out.push({ decisionISO, ...r });

  /* ── THRESHOLD PACE ────────────────────────────────────────────────────── */

  const anchor = input.belief.thresholdPaceSecPerMi;
  const windowStart = new Date(
    Date.parse(`${decisionISO}T12:00:00Z`) - THRESHOLD_EVIDENCE_WINDOW_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);

  // The engine's OWN admissibility function, not a copy of its conditions.
  const qualifying = input.qualitySessions.filter(
    (s) => s.provenance.dateISO >= windowStart
      && qualifiesAsThresholdEvidence(s).admissible
      && s.thresholdEquivalentPaceSecPerMi.ok
      && assessDeterioration(s.thirds, s.provenance.truncation).verdict !== 'DETERIORATED',
  );
  // "on separate days" · one per calendar day, the fastest kept, as the lever does.
  const byDay = new Map<string, number>();
  for (const s of qualifying) {
    const p = s.thresholdEquivalentPaceSecPerMi.ok ? s.thresholdEquivalentPaceSecPerMi.value : NaN;
    const cur = byDay.get(s.provenance.dateISO);
    if (cur === undefined || p < cur) byDay.set(s.provenance.dateISO, p);
  }
  const distinct = [...byDay.entries()].map(([dateISO, paceSecPerMi]) => ({ dateISO, paceSecPerMi }));

  push({
    lever: 'THRESHOLD_PACE',
    gate: 'T1-corroboration',
    question: `Qualifying threshold sessions on separate days within ${THRESHOLD_EVIDENCE_WINDOW_DAYS} days`,
    unit: 'sessions',
    required: THRESHOLD_MIN_QUALIFYING_SESSIONS,
    observed: distinct.length,
    higherIsBetter: true,
    met: distinct.length >= THRESHOLD_MIN_QUALIFYING_SESSIONS,
    blockedByData: false,
    detail: distinct.length === 0
      ? `No qualifying threshold session since ${windowStart}.`
      : distinct.map((q) => `${q.dateISO} ${q.paceSecPerMi.toFixed(0)}s/mi`).join(' · '),
  });

  const faster = distinct.filter((q) => q.paceSecPerMi < anchor);
  const slower = distinct.filter((q) => q.paceSecPerMi > anchor);
  // The lever's own rule: agree >= MIN && agree >= 2 * disagree.
  const requiredFaster = Math.max(THRESHOLD_MIN_QUALIFYING_SESSIONS, 2 * slower.length);
  push({
    lever: 'THRESHOLD_PACE',
    gate: 'T2-direction',
    question: 'Faster sessions clearing the corroboration bar and outnumbering the slower ones two to one',
    unit: 'faster sessions',
    required: requiredFaster,
    observed: faster.length,
    higherIsBetter: true,
    met: faster.length >= requiredFaster,
    blockedByData: distinct.length === 0,
    detail: `${faster.length} faster, ${slower.length} slower, against an anchor of ${anchor.toFixed(0)} s/mi.`,
  });

  if (distinct.length > 0) {
    const mean = distinct.reduce((a, q) => a + q.paceSecPerMi, 0) / distinct.length;
    const delta = Math.abs(mean - anchor);
    push({
      lever: 'THRESHOLD_PACE',
      gate: 'T3-meaningful-step',
      question: 'The demonstrated mean differs from the anchor by enough to be a change rather than rounding',
      unit: 's/mi',
      required: THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
      observed: Number(delta.toFixed(2)),
      higherIsBetter: true,
      met: delta >= THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
      blockedByData: false,
      detail: `Mean of ${distinct.length} qualifying session(s) is ${mean.toFixed(0)} s/mi against an anchor of ${anchor.toFixed(0)}.`,
    });
  }

  /* ── WEEKLY VOLUME ─────────────────────────────────────────────────────── */

  // The lever's own window: walk back from the most recent week, skipping weeks
  // the plan itself prescribed as non-normal (Rule 8), until it has three.
  const nonCutback = [];
  for (const w of [...input.weeks].reverse()) {
    if (prescribedNonNormalWeek(w).nonNormal) continue;
    nonCutback.push(w);
    if (nonCutback.length >= VOLUME_MIN_CONSECUTIVE_WEEKS) break;
  }

  push({
    lever: 'WEEKLY_VOLUME',
    gate: 'V1-weeks-available',
    question: 'Consecutive non-cutback weeks with something to read',
    unit: 'weeks',
    required: VOLUME_MIN_CONSECUTIVE_WEEKS,
    observed: nonCutback.length,
    higherIsBetter: true,
    met: nonCutback.length >= VOLUME_MIN_CONSECUTIVE_WEEKS,
    blockedByData: false,
    detail: nonCutback.map((w) => w.weekStartISO).join(' · ') || 'none',
  });

  const unreadable = nonCutback.filter((w) => !w.completedMi.ok || !w.dataComplete);
  const completions = nonCutback
    .filter((w) => w.completedMi.ok && w.prescribedMi > 0)
    .map((w) => ({
      weekStartISO: w.weekStartISO,
      frac: (w.completedMi.ok ? w.completedMi.value : 0) / w.prescribedMi,
      completedMi: w.completedMi.ok ? w.completedMi.value : 0,
      prescribedMi: w.prescribedMi,
    }));

  if (completions.length > 0) {
    // The BINDING number: the weakest of the three has to clear the bar, so the
    // worst week is what "how close did he come" means for this gate.
    const worst = completions.reduce((a, c) => (c.frac < a.frac ? c : a));
    push({
      lever: 'WEEKLY_VOLUME',
      gate: 'V2-week-completion',
      question: `Every one of the last ${VOLUME_MIN_CONSECUTIVE_WEEKS} non-cutback weeks completed at the bar`,
      unit: 'fraction of prescribed, worst week',
      required: VOLUME_WEEK_COMPLETION_MIN_FRAC,
      observed: Number(worst.frac.toFixed(4)),
      higherIsBetter: true,
      met: completions.length >= VOLUME_MIN_CONSECUTIVE_WEEKS
        && completions.every((c) => c.frac >= VOLUME_WEEK_COMPLETION_MIN_FRAC),
      blockedByData: unreadable.length > 0,
      detail: completions
        .map((c) => `${c.weekStartISO} ${c.completedMi.toFixed(1)}/${c.prescribedMi.toFixed(1)} = ${pct(c.frac)}`)
        .join(' · '),
    });
  }

  const evidenceFromISO = nonCutback.length > 0
    ? nonCutback[nonCutback.length - 1].weekStartISO
    : decisionISO;
  const keyInWindow = input.qualitySessions.filter((s) => s.provenance.dateISO >= evidenceFromISO);
  const badKey = keyInWindow.filter(
    (s) => !GRADES_THAT_COUNT_AS_EVIDENCE.has(s.grade) && s.grade !== 'INSUFFICIENT',
  );
  push({
    lever: 'WEEKLY_VOLUME',
    gate: 'V3-key-sessions',
    question: 'No key session in the window graded below SUBSTANTIAL',
    unit: 'bad sessions',
    required: 0,
    observed: badKey.length,
    higherIsBetter: false,
    met: badKey.length === 0,
    blockedByData: false,
    detail: badKey.length === 0
      ? `${keyInWindow.length} key session(s) in the window, none below SUBSTANTIAL.`
      : badKey.map((s) => `${s.provenance.dateISO} ${s.grade}`).join(' · '),
  });

  push({
    lever: 'WEEKLY_VOLUME',
    gate: 'V4-cadence',
    question: 'No upward step already taken in this cutback cycle',
    unit: 'steps taken',
    required: VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE - 1,
    observed: input.plan.stepsTakenThisCycle.WEEKLY_VOLUME,
    higherIsBetter: false,
    met: input.plan.stepsTakenThisCycle.WEEKLY_VOLUME < VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
    blockedByData: false,
    detail: `${input.plan.stepsTakenThisCycle.WEEKLY_VOLUME} step(s) this cycle, cap ${VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE}.`,
  });

  push({
    lever: 'WEEKLY_VOLUME',
    gate: 'V5-something-to-move',
    question: 'The week a proposal would affect prescribes something',
    unit: 'mi prescribed next week',
    required: 0.01,
    observed: input.plan.nextWeekPrescribedMi,
    higherIsBetter: true,
    met: input.plan.nextWeekPrescribedMi > 0,
    blockedByData: input.plan.nextWeekPrescribedMi === 0,
    detail: `Next affected week prescribes ${input.plan.nextWeekPrescribedMi.toFixed(1)} mi.`,
  });

  /* ── LONG RUN ──────────────────────────────────────────────────────────── */

  const recentLongs = input.longRuns.slice(-LONG_RUN_LOOKBACK_COUNT);
  push({
    lever: 'LONG_RUN',
    gate: 'L1-runs-available',
    question: 'Relevant prescribed long runs to read',
    unit: 'long runs',
    required: LONG_RUN_LOOKBACK_COUNT,
    observed: recentLongs.length,
    higherIsBetter: true,
    met: recentLongs.length >= LONG_RUN_LOOKBACK_COUNT,
    blockedByData: false,
    detail: recentLongs.map((l) => l.provenance.dateISO).join(' · ') || 'none',
  });

  const inadmissible = recentLongs.filter((l) => !qualifiesAsLongRunEvidence(l).admissible);
  push({
    lever: 'LONG_RUN',
    gate: 'L2-admissible',
    question: 'Both recent long runs were recorded well enough to judge',
    unit: 'inadmissible runs',
    required: 0,
    observed: inadmissible.length,
    higherIsBetter: false,
    met: recentLongs.length >= LONG_RUN_LOOKBACK_COUNT && inadmissible.length === 0,
    // Truncation and unreadable distance are DATA facts, not runner facts.
    blockedByData: inadmissible.length > 0,
    detail: inadmissible.length === 0
      ? 'Both admissible.'
      : inadmissible
        .map((l) => `${l.provenance.dateISO} ${qualifiesAsLongRunEvidence(l).reason ?? 'inadmissible'}`)
        .join(' · '),
  });

  const longCompletions = recentLongs
    .filter((l) => l.completedMi.ok && l.prescribedMi > 0)
    .map((l) => ({
      dateISO: l.provenance.dateISO,
      frac: (l.completedMi.ok ? l.completedMi.value : 0) / l.prescribedMi,
      completedMi: l.completedMi.ok ? l.completedMi.value : 0,
      prescribedMi: l.prescribedMi,
    }));
  if (longCompletions.length > 0) {
    const worst = longCompletions.reduce((a, c) => (c.frac < a.frac ? c : a));
    push({
      lever: 'LONG_RUN',
      gate: 'L3-completion',
      question: `Both of the last ${LONG_RUN_LOOKBACK_COUNT} long runs completed at the bar`,
      unit: 'fraction of prescribed, worst run',
      required: LONG_RUN_COMPLETION_MIN_FRAC,
      observed: Number(worst.frac.toFixed(4)),
      higherIsBetter: true,
      met: longCompletions.length >= LONG_RUN_LOOKBACK_COUNT
        && longCompletions.every((c) => c.frac >= LONG_RUN_COMPLETION_MIN_FRAC),
      blockedByData: false,
      detail: longCompletions
        .map((c) => `${c.dateISO} ${c.completedMi.toFixed(1)}/${c.prescribedMi.toFixed(1)} = ${pct(c.frac)}`)
        .join(' · '),
    });
  }

  const thirdsReadable = recentLongs.filter((l) => l.thirds.comparable).length;
  push({
    lever: 'LONG_RUN',
    gate: 'L4-durability-readable',
    question: 'How the final third went could be read on both runs',
    unit: 'readable runs',
    required: LONG_RUN_LOOKBACK_COUNT,
    observed: thirdsReadable,
    higherIsBetter: true,
    met: thirdsReadable >= LONG_RUN_LOOKBACK_COUNT,
    // This is the purest Rule 11 case in the whole instrument: an unreadable
    // third is the WATCH failing, not the runner.
    blockedByData: thirdsReadable < recentLongs.length,
    detail: `${thirdsReadable} of ${recentLongs.length} recent long runs have comparable thirds.`,
  });

  const deteriorated = recentLongs.filter(
    (l) => assessDeterioration(l.thirds, l.provenance.truncation).verdict === 'DETERIORATED',
  );
  push({
    lever: 'LONG_RUN',
    gate: 'L5-no-deterioration',
    question: 'Neither run fell away in its final third',
    unit: 'deteriorated runs',
    required: 0,
    observed: deteriorated.length,
    higherIsBetter: false,
    met: deteriorated.length === 0,
    blockedByData: false,
    detail: deteriorated.map((l) => l.provenance.dateISO).join(' · ') || 'none',
  });

  push({
    lever: 'LONG_RUN',
    gate: 'L6-cadence',
    question: 'No increase already taken in this cutback cycle',
    unit: 'steps taken',
    required: LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE - 1,
    observed: input.plan.stepsTakenThisCycle.LONG_RUN,
    higherIsBetter: false,
    met: input.plan.stepsTakenThisCycle.LONG_RUN < LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE,
    blockedByData: false,
    detail: `${input.plan.stepsTakenThisCycle.LONG_RUN} step(s) this cycle, cap ${LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE}.`,
  });

  // `Research/00a`'s spike rule. A doctrine-cited injury guard, and the one gate
  // on this list that must NEVER be relaxed to manufacture a push.
  const nextLong = input.plan.nextWeekLongRunMi;
  // `evaluate.ts`'s `longestInPrior30Days`, read the same way it reads it:
  // LITERAL and unfiltered, because Rule 8's corollary says an absorbed-load
  // guard must see what the tissue actually did, not what the runner normally
  // does. Recomputed here rather than plumbed, because it is not a field on the
  // input — and it is the one number in this file that mirrors engine code, so
  // `_upward_bar.test.ts` pins it against the engine's own long-run verdict.
  const prior30Cutoff = Date.parse(input.evaluatedAtISO) - 30 * DAY_MS;
  const longestPrior30 = input.longRuns.reduce(
    (m, l) => (Date.parse(l.provenance.dateISO) >= prior30Cutoff && l.completedMi.ok
      ? Math.max(m, l.completedMi.value) : m),
    0,
  );
  const ceiling = longestPrior30 * 1.10;
  push({
    lever: 'LONG_RUN',
    gate: 'L7-spike-headroom',
    question: 'A one-mile increase stays under 110% of the longest run in the prior 30 days',
    unit: 'mi of headroom',
    required: 1.0,
    observed: Number((ceiling - nextLong).toFixed(2)),
    higherIsBetter: true,
    met: nextLong + 1.0 <= ceiling,
    blockedByData: longestPrior30 === 0,
    detail: `Next long ${nextLong.toFixed(1)} mi; prior-30-day max ${longestPrior30.toFixed(1)} mi, ceiling ${ceiling.toFixed(1)} mi.`,
  });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEASON SUMMARY  ·  Rule 21's question, answered per gate
 * ═══════════════════════════════════════════════════════════════════════ */

export function summariseBars(readings: readonly BarReading[]): GateSummary[] {
  const byGate = new Map<string, BarReading[]>();
  for (const r of readings) {
    const k = `${r.lever}|${r.gate}`;
    const b = byGate.get(k);
    if (b) b.push(r); else byGate.set(k, [r]);
  }
  return [...byGate.values()].map((rs) => {
    const first = rs[0];
    // The closest he came is the best observation among the points where the
    // gate was actually judgeable. Including data-blocked points would report a
    // watch failure as a training shortfall.
    const judgeable = rs.filter((r) => !r.blockedByData);
    const pool = judgeable.length > 0 ? judgeable : rs;
    const best = pool.reduce((a, r) => {
      if (first.higherIsBetter) return r.observed > a.observed ? r : a;
      return r.observed < a.observed ? r : a;
    });
    return {
      lever: first.lever,
      gate: first.gate,
      question: first.question,
      unit: first.unit,
      required: first.required,
      higherIsBetter: first.higherIsBetter,
      pointsEvaluated: rs.length,
      pointsBlockedByData: rs.filter((r) => r.blockedByData).length,
      everMet: rs.some((r) => r.met),
      bestObserved: best.observed,
      bestOnISO: best.decisionISO,
      bestDetail: best.detail,
      shortfallAtBest: Number(
        (first.higherIsBetter
          ? first.required - best.observed
          : best.observed - first.required).toFixed(4),
      ),
    };
  }).sort((a, b) => (a.lever === b.lever ? a.gate.localeCompare(b.gate) : a.lever.localeCompare(b.lever)));
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE COUNTERFACTUAL LADDER  ·  the engine checks the measurement
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rungs, in order of how much of the runner's real behaviour they change.
 *
 * Each rung is a MINIMAL edit: a week is credited at exactly the bar, never
 * above it, so the rung that flips a verdict names the gate that was binding
 * rather than swamping every gate at once.
 */
export type Rung =
  | 'AS_RUN'
  | 'WEEKS_AT_BAR'
  | 'WEEKS_AND_KEY_SESSIONS'
  | 'WEEKS_KEY_AND_LONGS'
  | 'EVERYTHING_AT_BAR';

export const RUNGS: readonly Rung[] = [
  'AS_RUN',
  'WEEKS_AT_BAR',
  'WEEKS_AND_KEY_SESSIONS',
  'WEEKS_KEY_AND_LONGS',
  'EVERYTHING_AT_BAR',
];

export const RUNG_MEANING: Readonly<Record<Rung, string>> = {
  AS_RUN: 'exactly what he did',
  WEEKS_AT_BAR: 'every non-cutback week completed at exactly 95% of its prescription',
  WEEKS_AND_KEY_SESSIONS: 'the weeks, plus every key session graded FULL',
  WEEKS_KEY_AND_LONGS: 'the weeks and sessions, plus both long runs at 95% and holding to the finish',
  EVERYTHING_AT_BAR: 'all of the above, plus a qualifying threshold session 5 s/mi faster on two separate days',
};

/** A cheap deep-ish clone that keeps the readonly shape honest. */
function withWeeksAtBar(input: CanonicalAdaptationInput): CanonicalAdaptationInput {
  return {
    ...input,
    weeks: input.weeks.map((w) => {
      if (prescribedNonNormalWeek(w).nonNormal || w.prescribedMi <= 0) return w;
      const atBar = w.prescribedMi * VOLUME_WEEK_COMPLETION_MIN_FRAC;
      const actual = w.completedMi.ok ? w.completedMi.value : 0;
      return {
        ...w,
        completedMi: measured(Math.max(actual, atBar)),
        dataComplete: true,
      };
    }),
  };
}

function withKeySessionsFull(input: CanonicalAdaptationInput): CanonicalAdaptationInput {
  return {
    ...input,
    qualitySessions: input.qualitySessions.map((s) => ({ ...s, grade: 'FULL' as const })),
  };
}

function withLongsAtBar(input: CanonicalAdaptationInput): CanonicalAdaptationInput {
  const solidThirds = {
    middlePaceSecPerMi: measured(500),
    finalPaceSecPerMi: measured(498),
    middleHrBpm: measured(150),
    finalHrBpm: measured(150),
    comparable: true,
  };
  return {
    ...input,
    longRuns: input.longRuns.map((l) => ({
      ...l,
      provenance: { ...l.provenance, truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' } },
      completedMi: measured(Math.max(
        l.completedMi.ok ? l.completedMi.value : 0,
        l.prescribedMi * LONG_RUN_COMPLETION_MIN_FRAC,
      )),
      thirds: solidThirds,
      followingKeySessionOk: measured(true),
    })),
  };
}

function withFasterThresholdEvidence(input: CanonicalAdaptationInput): CanonicalAdaptationInput {
  const anchor = input.belief.thresholdPaceSecPerMi;
  const solidThirds = {
    middlePaceSecPerMi: measured(anchor - 5),
    finalPaceSecPerMi: measured(anchor - 6),
    middleHrBpm: measured(158),
    finalHrBpm: measured(158),
    comparable: true,
  };
  const day = (n: number) => new Date(
    Date.parse(`${input.evaluatedAtISO}T12:00:00Z`) - n * DAY_MS,
  ).toISOString().slice(0, 10);
  const synth = (n: number) => ({
    provenance: {
      activityId: `COUNTERFACTUAL-${n}`,
      dateISO: day(n),
      paceFlags: [] as never[],
      truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' },
      treadmill: false,
    },
    tests: 'THRESHOLD' as const,
    grade: 'FULL' as const,
    workPaceSecPerMi: measured(anchor - 5),
    thresholdEquivalentPaceSecPerMi: measured(anchor - 5),
    thirds: solidThirds,
    raceDistance: null,
  });
  return { ...input, qualitySessions: [...input.qualitySessions, synth(4), synth(11)] };
}

export function applyRung(input: CanonicalAdaptationInput, rung: Rung): CanonicalAdaptationInput {
  switch (rung) {
    case 'AS_RUN': return input;
    case 'WEEKS_AT_BAR': return withWeeksAtBar(input);
    case 'WEEKS_AND_KEY_SESSIONS': return withKeySessionsFull(withWeeksAtBar(input));
    case 'WEEKS_KEY_AND_LONGS': return withLongsAtBar(withKeySessionsFull(withWeeksAtBar(input)));
    case 'EVERYTHING_AT_BAR':
      return withFasterThresholdEvidence(withLongsAtBar(withKeySessionsFull(withWeeksAtBar(input))));
  }
}

export interface RungResult {
  readonly decisionISO: string;
  readonly rung: Rung;
  /** Levers that returned PROGRESS under this rung. */
  readonly progressed: CanonicalLever[];
  /** The reason each lever gave, so a rung that does NOT flip can be read. */
  readonly reasons: Readonly<Record<string, string>>;
}

/**
 * Walk the ladder at one decision point and report which rung, if any, buys a
 * PROGRESS on each lever.
 *
 * The result is a DIAGNOSTIC. Nothing here is proposed, applied or persisted.
 */
export function climbAt(
  decisionISO: string, input: CanonicalAdaptationInput,
): RungResult[] {
  return RUNGS.map((rung) => {
    const out = evaluateAdaptation(applyRung(input, rung));
    const reasons: Record<string, string> = {};
    for (const r of out.records) reasons[r.lever] = `${r.decision} · ${r.reason}`;
    return {
      decisionISO,
      rung,
      progressed: out.records.filter((r) => r.decision === 'PROGRESS').map((r) => r.lever),
      reasons,
    };
  });
}
