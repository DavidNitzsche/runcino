/**
 * lib/coach/recovery-brief.ts · post-run "what to do tonight" brief.
 *
 * Mirrors readiness-brief.ts in structure: composes one engine-authored
 * payload by wrapping existing modules (readiness/training-form/
 * training-state/goal-gap), with all surface copy in pure authoring
 * functions at the bottom so unit tests can assert wording.
 *
 * Pairs with:
 *   · designs/briefs/today-postrun-pivot.md      (design spec)
 *   · designs/briefs/today-postrun-pivot-execution.md (engineering split)
 *
 * Surface contract:
 *   GET /api/coach/recovery-brief → RecoveryBrief | null
 *
 * Returns null when there's nothing to brief on (no run today, true
 * cold-start with no HRV/RHR baseline, no active plan). Caller must
 * gate UI rendering on payload presence — the iPhone agent's forward-
 * compat decode already does this.
 *
 * Score weighting · BuildResearch D1's table, imported from readiness.ts so
 * there is exactly one of it: HRV 40% · sleep 22% · RHR 18%, renormalised over
 * the pillars actually present, with training form applied AFTER as a load-
 * context multiplier rather than as a fourth pillar.
 *
 * This header used to read "per the execution brief: HRV 45% · RHR 25% ·
 * TSB 20% · sleep adequacy 10%". There is no such brief in the repo, and those
 * weights disagreed with doctrine in the two ways the 2026-08-17 audit had
 * already fixed in readiness.ts. See the reconciliation block above
 * `RECOVERY_FORM_MULTIPLIER`.
 *
 * Doctrine sources:
 *   · Pfitzinger Faster Road Racing §"Post-workout recovery monitoring"
 *   · Daniels Running Formula 3e Ch.3 §"Recovery between sessions"
 *   · Hudson Run Faster Ch.6 §"Adaptation indicators"
 *   · Research/00b-recovery-protocols.md §"In-Week Recovery" + §"Sleep"
 *
 * The doctrine citations live in code comments, not in the runner-
 * facing payload (per the locked "no citations anywhere" rule).
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { CoachState } from '@/lib/topics/types';
import { computeTrainingForm, type TrainingFormLabel } from './training-form';
import { loadTrainingState } from './training-state';
import { computeGoalGap } from '@/lib/plan/goal-gap';
import { hasSleepSignal, hasHrvSignal, hasRhrSignal, hasRecoverySignal, recoveryCoverage } from './state-presence';
// 2026-08-19 · ONE weight table and ONE sleep target, imported rather than
// restated. See the reconciliation blocks below.
import { READINESS_WEIGHTS, weeklyMpwFor } from './readiness';
import { sleepTargetForMileage } from './tier-rules';

/* ────────────────────────── Public types ────────────────────────── */

export type RecoveryMode = 'standard' | 'long_run';
export type RecoveryBand = 'recovered' | 'recovering' | 'dragging' | 'depleted';
/** `BUILDING` · COLD-4 · the Banister envelope has no verdict yet. */
export type FormBandLabel = 'OPTIMAL' | 'PRODUCTIVE' | 'OVERREACH' | 'FRESH' | 'BUILDING';
export type ArcDirection = 'on_track' | 'flat' | 'slipping';
export type FuelingWindowState = 'open' | 'closing' | 'closed';
/** `UNKNOWN` · COLD-3 · not enough observable history for a ratio. */
export type AcwrBand = 'OK' | 'WATCH' | 'RAMP_UP' | 'UNKNOWN';

export interface RecoveryBrief {
  mode: RecoveryMode;
  score: number;
  band: RecoveryBand;
  oneLine: string;
  bigCopy: string;

  /**
   * COLD-4 (2026-08-17) · what fraction of the recovery picture `score` is
   * actually backed by · `recoveryCoverage` over the four recovery pillars.
   *
   * 1.0 fully instrumented · 0.4 or below is a thin reading that should be
   * rendered with subdued chrome and a "limited signal" caption. The score is
   * now a real reading of however much we can see; this says how much that is.
   * Never zero — the cold-start gate returns null before it could be.
   */
  coverage: number;

  pillars: {
    sleepTarget: {
      /** 2026-06-05 · multi-tenant audit Pattern 1 fix · honest "no data"
       *  flag. False when the runner has no sleep_hours history · consumer
       *  should render "Sleep target unknown · log a night to start" instead
       *  of the made-up target. hoursDelta is meaningless without history.
       *  Cite: docs/2026-06-05-multi-tenant-audit.html § Pattern 1. */
      present: boolean;
      hoursTarget: number;
      hoursDelta: number;
      reason: string;
    };
    hrvRebound: {
      /** 2026-06-05 · present is false when no HRV current+baseline. The
       *  "your HRV is rebounding" narrative is fabricated otherwise. */
      present: boolean;
      currentDrop: number;
      projectedReturnISO: string;
      pct: number;
    };
    rhrDelta: {
      /** 2026-06-05 · present is false when no RHR current+baseline. The
       *  projected morning bpm is fabricated otherwise (was: ?? 60 default). */
      present: boolean;
      currentBpm: number;
      baselineBpm: number;
      projectedMorningBpm: number;
      pct: number;
    };
    fueling: {
      windowState: FuelingWindowState;
      minutesRemaining: number | null;
      pct: number;
    };
  };

  trainingInput: {
    tssDelta: number;
    formDelta: number;
    formBandLabel: FormBandLabel;
    arcDirection: ArcDirection;
  };

  nextHard: {
    type: string;
    dateISO: string;
    label: string;
    hoursUntil: number;
    trajectoryChip: string;
  };

  weekProgress: {
    bankedMi: number;
    targetMi: number;
    dots: number;
    longRun: { dateISO: string; mi: number; daysUntil: number } | null;
    acwr: { value: number; band: AcwrBand };
  };

  /** 2026-06-03 · top-level "fully recovered at" timestamp · ISO.
   *  iPhone agent's feedback (RE: 28110604 verified) · was deriving
   *  this client-side from pillars.hrvRebound.projectedReturnISO +
   *  pct; prefers a dedicated field on the envelope.
   *
   *  Definition · the LATEST of the pillar return-times. HRV is
   *  typically the slowest (24-36h after a hard session), so the
   *  HRV rebound time wins in the common case. On a high-RHR day
   *  with mild HRV impact, RHR's projected return wins instead.
   *
   *  We do NOT include sleep target completion (waking) because
   *  that's the runner's tonight-sleep window, not a recovery
   *  marker · "fully recovered" reads as "physiology back at
   *  baseline" not "after you wake up." */
  fullyRecoveredAt: string;
}

/* ────────────────────────── Internal shapes ────────────────────────── */

interface TodayRunTimingRow {
  start_local: string | null;
  moving_s: number | null;
  distance_mi: number | null;
  type_hint: string | null;
  end_unix_s: number | null;
}

/* ────────────────────────── Doctrine constants ────────────────────────── */

/**
 * Sleep · the extension INCREMENT after a long run. The TARGET itself is
 * `sleepTargetForMileage` (tier-rules.ts) — see computeSleepTarget below.
 *
 * ── 2026-08-19 · sleep-target reconciliation ─────────────────────────────
 *
 * This file used to carry a flat 8.5h standard target and a 9.25h long-run
 * one, citing Research/00b §"Sleep Extension and Sleep Banking". That section
 * is a DELTA table, not a target table: "Add 60–120 min/night for 5–7+ nights"
 * is an amount to add to something, and the something is the per-mileage
 * target in §"Recovery Scaled to Weekly Mileage". Reading a delta as an
 * absolute is how a 45 mpw runner got an 8.5h bar where doctrine says 8.0h,
 * and a 90 mpw runner got 8.5h where doctrine says 9.0h — wrong in both
 * directions at once, because a flat number cannot track a scaling one.
 *
 * The 9.25h long-run figure came from a Pfitzinger citation (+30-60 min above
 * habit on hard days). Book-only citations were closed to zero in the
 * 2026-08-17 doctrine sweep, so it is re-pointed at the extension table's own
 * LOW END: +60 min, read out of the doc at run time by the registry claim
 * SLEEP.extension-is-a-delta-not-a-target rather than written down here as
 * 0.75.
 */
const SLEEP_EXTENSION_LONG_RUN_H = 1.0;

/** HRV rebound timeline per Plews et al. — typical hard-session HRV drop
 *  recovers ~70% within 24h, fully within 48h. We project return-to-baseline
 *  for ~24h post-session (clamped). */
const HRV_REBOUND_HOURS_DEFAULT = 24;

/**
 * ── 2026-08-19 · the second composite, reconciled ────────────────────────
 *
 * This file carried its OWN readiness weights — HRV .45 / RHR .25 / TSB .20 /
 * SLEEP .10 — under the comment "per execution brief", naming no source. No
 * such brief exists in `BuildResearch/` or `Research/`. It was a second,
 * unbound readiness model sitting next to the bound one, and it disagreed with
 * it in exactly the two ways the 2026-08-17 audit had already found and fixed
 * in `readiness.ts`:
 *
 *   · SLEEP AT .10 against doctrine's .22. D1 §"Summary table" puts sleep at
 *     22%; this halved it and handed the difference to HRV and RHR.
 *   · LOAD AS A PILLAR. TSB at .20 could add a fifth of the score on its own.
 *     D1 §2.4 makes load "a 'load context' multiplier in the range [0.85,
 *     1.10] applied after the biometric composite", and D1 §"Why these
 *     weights" says as a multiplier "it can't *create* a score; it can only
 *     modulate one". A runner with no biometrics at all was banking load
 *     points for having trained.
 *
 * Both are now the same shape as `readiness.ts`: the biometric pillars are
 * weighted by `READINESS_WEIGHTS` — the ONE table, imported rather than
 * copied, so the two composites can no longer drift — and training form is
 * applied as a multiplier on the finished composite, never as a term in it.
 *
 * The renormalisation added by COLD-4 (2026-08-17) is preserved: a pillar we
 * cannot see does not vote, and the weights of the pillars we can see are
 * renormalised so absence is neither rewarded nor punished.
 *
 * WHY THE WEIGHTS ARE IMPORTED AND NOT RESTATED. This module's HRV/RHR terms
 * are percentages-of-extension rather than the raw deviations `readiness.ts`
 * scores, so the two composites still produce different numbers for different
 * questions ("how recovered from yesterday" vs "how ready today"). What they
 * must not do is disagree about how much each PILLAR IS WORTH, which is the
 * only thing doctrine actually fixes.
 */
const W_HRV = READINESS_WEIGHTS.hrv;
const W_RHR = READINESS_WEIGHTS.rhr;
const W_SLEEP = READINESS_WEIGHTS.sleep;

/**
 * Training form as a load-context MULTIPLIER, mirroring
 * `readiness.ts:loadContextMultiplier` and D1 §2.4's stated [0.85, 1.10]
 * range. Bands are the Coggan TSB labels `training-form.ts` already uses:
 * fatigue (TSB well negative) trims, freshness lifts a little, the productive
 * middle is neutral.
 *
 * It cannot manufacture a score, which is D1's requirement. The mechanism is
 * `computeScore`'s early return: with no biometric pillar present the total
 * weight is zero and the function returns before the multiplier is ever
 * reached, so there is nothing for freshness to lift. It modulates a real
 * reading or it does not run at all.
 */
export const RECOVERY_FORM_MULTIPLIER = {
  overreach: 0.88,
  fatigued: 0.95,
  neutral: 1.00,
  fresh: 1.05,
} as const;

export function recoveryFormMultiplier(tsb: number | null): number {
  if (tsb == null || !isFinite(tsb)) return RECOVERY_FORM_MULTIPLIER.neutral;
  // Coggan bands as carried by training-form.ts labelForTsb.
  if (tsb <= -30) return RECOVERY_FORM_MULTIPLIER.overreach;
  if (tsb <= -10) return RECOVERY_FORM_MULTIPLIER.fatigued;
  if (tsb > 10) return RECOVERY_FORM_MULTIPLIER.fresh;
  return RECOVERY_FORM_MULTIPLIER.neutral;
}

/** Fueling window per sports-nutrition consensus (Burke/Jeukendrup):
 *  open <30min post-run, closing 20-30min, closed >30min. */
const FUEL_OPEN_MIN = 20;
const FUEL_CLOSING_MAX = 30;

/** Intensity factor for today's-run TSS estimate · mirrors training-form.ts. */
const INTENSITY_FACTOR: Record<string, number> = {
  rest: 0.0,
  shakeout: 0.7,
  recovery: 0.8,
  easy: 0.85,
  long: 0.95,
  progression: 1.05,
  fartlek: 1.1,
  tempo: 1.15,
  threshold: 1.15,
  intervals: 1.25,
  race: 1.4,
};

/* ────────────────────────── Composer ────────────────────────── */

/**
 * Compose the recovery brief for a runner.
 *
 * Returns null when:
 *   · There is no run for today (caller should be gating on
 *     todayRunDone before calling, but we defend in depth)
 *   · There is no recoverable HRV/RHR/sleep baseline (cold start)
 *
 * The iPhone agent's forward-compat Decodable treats every field
 * leniently · partial payloads never drop the decode, so missing
 * sub-shapes return zeros / empty strings rather than dropping
 * the whole brief.
 */
export async function loadRecoveryBrief(
  userId: string,
  state: CoachState,
  mode: RecoveryMode = 'standard',
  todayISO?: string,
): Promise<RecoveryBrief | null> {
  const today = todayISO ?? await runnerToday(userId);

  // 1. Today's run timing · drives fueling window + post-run TSS estimate.
  const runTiming = await loadTodayRunTiming(userId, today);
  if (!runTiming) return null;

  // 2. Cold-start gate.
  //
  // COLD-4 (2026-08-17) · this read `hrvBaseline == null && rhrBaseline == null`
  // — AND, not OR. It only turned the brief off for a runner missing BOTH, and
  // a watch surfaces RHR days before it has enough overnights for an HRV
  // baseline, so the ordinary new-watch runner walked straight through it. Then
  // `computeScore` charged absent HRV `100 - 0 = 100` at weight 0.45 and absent
  // sleep a hardcoded 50, and the brief opened with "Recovered cleanly ·
  // banking the work" at ~89/100 for a runner we could barely see.
  //
  // Two changes, and the second is the one that matters: the gate now asks the
  // canonical presence API instead of hand-rolling a sixth definition of "real
  // signal", AND `computeScore` weighs only the pillars that are present (see
  // below), so passing this gate on RHR alone yields an RHR-shaped score rather
  // than a full-confidence one.
  if (!hasRecoverySignal(state, 'baseline')) {
    return null;
  }

  // 3. Pillars
  const sleepTarget = computeSleepTarget(state, mode);
  const hrvRebound = computeHrvRebound(state, runTiming);
  const rhrDelta = computeRhrDelta(state);
  const fueling = computeFueling(runTiming, mode);

  // 4. Training input · TSS for today + form delta from Banister model
  const form = await computeTrainingForm(userId).catch(() => null);
  const tssEstimate = estimateTss(runTiming);
  const trainingInput = composeTrainingInput(form, tssEstimate, await arcDirection(userId));

  // 5. Next hard quality + week progress · from training-state
  const trainingState = await loadTrainingState(userId).catch(() => null);
  const nextHard = composeNextHard(trainingState, mode, today, {
    sleepDeficit: state.sleep7Deficit,
    hrvDrop: hrvRebound.currentDrop,
    band: bandFromPillars({ sleepTarget, hrvRebound, rhrDelta, fueling }),
  });
  const weekProgress = composeWeekProgress(trainingState, state, today);

  // 6. Score + band + authored copy
  //
  // COLD-4 · each pillar passes null when it has no signal, so `computeScore`
  // can drop it instead of scoring its absence. `form` contributes only when
  // the Banister envelope has a full CTL window behind it — below that its TSB
  // is measuring how long the account has existed (see training-form.ts
  // COLD-1), and `tsb ?? 0` used to turn exactly that into 70/100.
  const formSufficient = form != null && form.label !== 'BUILDING';
  const score = computeScore({
    hrvPct: hrvRebound.present ? hrvRebound.pct : null,
    rhrPct: rhrDelta.present ? rhrDelta.pct : null,
    tsb: formSufficient ? form.tsb : null,
    sleepAdequacyPct: sleepAdequacyPct(state.sleep7Avg, sleepTarget.hoursTarget),
  });
  const band = bandFromScore(score);
  const oneLine = authorOneLine(band, mode, { hrvDrop: hrvRebound.currentDrop, sleepDeficit: state.sleep7Deficit });
  const bigCopy = authorBigCopy(band, mode, {
    hrvDrop: hrvRebound.currentDrop,
    rhrDelta: rhrDelta.currentBpm - rhrDelta.baselineBpm,
    projectedReturnISO: hrvRebound.projectedReturnISO,
    nextHardLabel: nextHard.label,
  });

  // 2026-06-03 · fullyRecoveredAt · LATEST pillar return-time.
  // HRV typically wins (slowest signal · 24-36h rebound). RHR can
  // win on a high-RHR + mild-HRV day where RHR needs longer to
  // ratchet back to baseline. We project RHR baseline-return as the
  // run-end + Nh where N = max(6, 4 × bpm-above-baseline) · roughly
  // 6h for a 1bpm bump, 24h+ for a 6bpm bump.
  const runEndMs = (runTiming.end_unix_s ?? Math.floor(Date.now() / 1000)) * 1000;
  const rhrAbove = Math.max(0, rhrDelta.currentBpm - rhrDelta.baselineBpm);
  const rhrReboundHours = Math.max(6, rhrAbove * 4);
  const rhrReturnMs = runEndMs + rhrReboundHours * 3600 * 1000;
  const hrvReturnMs = Date.parse(hrvRebound.projectedReturnISO);
  const fullyRecoveredAt = new Date(Math.max(
    Number.isFinite(hrvReturnMs) ? hrvReturnMs : 0,
    rhrReturnMs,
  )).toISOString();

  return {
    mode,
    score,
    coverage: recoveryCoverage(state),
    band,
    oneLine,
    bigCopy,
    pillars: { sleepTarget, hrvRebound, rhrDelta, fueling },
    trainingInput,
    nextHard,
    weekProgress,
    fullyRecoveredAt,
  };
}

/* ────────────────────────── Pillar computers ────────────────────────── */

function computeSleepTarget(state: CoachState, mode: RecoveryMode) {
  // 2026-08-19 · ONE target, doctrine's own, mileage-scaled. The former flat
  // 8.5h base and the +0.25h ACWR bump are both gone: Research/00b scales the
  // recovery requirement to ABSOLUTE training load (mileage), and the ratio
  // bump was a second axis with nothing behind it.
  const baseTarget = sleepTargetForMileage(weeklyMpwFor(state));
  // After a long run, doctrine's sleep-EXTENSION increment applies on top.
  const extension = mode === 'long_run' ? SLEEP_EXTENSION_LONG_RUN_H : 0;
  const hoursTarget = +(baseTarget + extension).toFixed(2);

  // 2026-06-05 · multi-tenant audit Pattern 1 fix · was:
  //   const personalAvg = state.sleep7Avg ?? hoursTarget;
  // When sleep7Avg was null, personalAvg silently became the TARGET
  // itself · hoursDelta = 0 said "you're sleeping at target" with
  // zero data to back it up. Now: present=false signals the consumer
  // to render "Sleep target unknown · log a night to start" instead.
  const present = hasSleepSignal(state);
  const personalAvg = state.sleep7Avg ?? hoursTarget;
  const hoursDelta = present ? +(hoursTarget - personalAvg).toFixed(2) : 0;

  // The reason names the axis the target actually moved on, so the runner can
  // check it. Both branches are Research/00b.
  const reason = mode === 'long_run'
    ? 'Long-run carryover · sleep extension drives glycogen + tissue repair'
    : 'Recovery needs scale with weekly mileage';

  return { present, hoursTarget, hoursDelta, reason };
}

function computeHrvRebound(state: CoachState, runTiming: TodayRunTimingRow) {
  // 2026-06-05 · multi-tenant audit Pattern 1 fix · was:
  //   const baseline = state.hrvBaseline ?? 0;
  //   const current = state.hrvCurrent ?? baseline;
  //   const currentDrop = max(0, baseline - current);  // = 0 when no data
  // Said "your HRV is rebounding at baseline" when there was no HRV at
  // all. Now: gate the math on hasHrvSignal(state, 'baseline').
  const present = hasHrvSignal(state, 'baseline');
  const baseline = state.hrvBaseline ?? 0;
  const current = state.hrvCurrent ?? baseline;
  const currentDrop = present ? Math.max(0, baseline - current) : 0;

  // Project return-to-baseline ~24h post-run end (or 36h if drop > 15ms).
  const runEndMs = (runTiming.end_unix_s ?? Math.floor(Date.now() / 1000)) * 1000;
  const reboundHours = currentDrop > 15 ? 36 : HRV_REBOUND_HOURS_DEFAULT;
  const projectedReturnISO = new Date(runEndMs + reboundHours * 3600 * 1000).toISOString();

  // pct = how far through the rebound window we are right now (0-100).
  // Meaningless when present=false · zero it so the UI doesn't paint
  // a progress arc that looks earned.
  const elapsedH = (Date.now() - runEndMs) / 3600000;
  const pct = present
    ? Math.max(0, Math.min(100, Math.round((elapsedH / reboundHours) * 100)))
    : 0;

  return { present, currentDrop, projectedReturnISO, pct };
}

function computeRhrDelta(state: CoachState) {
  // 2026-06-05 · multi-tenant audit Pattern 1 fix · was:
  //   const baselineBpm = state.rhrBaseline ?? state.rhrCurrent ?? 60;
  // For a cold-start runner with no RHR, baselineBpm became 60 · the
  // hardcoded fabricated default the audit called out by name. Now:
  // gate on hasRhrSignal(state, 'baseline') and zero the math when
  // the runner has no real RHR signal.
  //
  // COLD-4 (2026-08-17) · that fix gated the DERIVED fields and left the `?? 60`
  // itself executing, so `baselineBpm` and `currentBpm` still shipped 60/60 in
  // the payload underneath a comment saying the fabricated default was gone.
  // `loadRecoveryBrief` then differenced them for the headline copy. The two
  // raw fields now follow the same `present ? … : 0` rule as their siblings —
  // and 0 is the value the surfaces already read as absent: the native RHR chip
  // self-suppresses on `currentBpm > 0` (TodayRecoveryPanel.swift:206).
  const present = hasRhrSignal(state, 'baseline');
  const baselineBpm = present ? (state.rhrBaseline ?? state.rhrCurrent ?? 0) : 0;
  const currentBpm = present ? (state.rhrCurrent ?? baselineBpm) : 0;
  // Projected morning RHR · runs are typically +3-5bpm above baseline
  // immediately post-effort, returning to baseline by morning if recovery
  // is on track. Project a straight-line return.
  const above = present ? Math.max(0, currentBpm - baselineBpm) : 0;
  const projectedMorningBpm = present
    ? Math.max(baselineBpm, currentBpm - Math.round(above * 0.7))
    : 0;
  // pct = inverse of how far above baseline (0% = at baseline · 100% = +10bpm)
  const pct = present
    ? Math.max(0, Math.min(100, Math.round((above / 10) * 100)))
    : 0;
  return { present, currentBpm, baselineBpm, projectedMorningBpm, pct };
}

function computeFueling(runTiming: TodayRunTimingRow, mode: RecoveryMode) {
  // Long-run mode reframes window as the 24h carb-replenish target;
  // pct ramps over 24h since end-of-run.
  const runEndMs = (runTiming.end_unix_s ?? Math.floor(Date.now() / 1000)) * 1000;
  const minutesSinceEnd = (Date.now() - runEndMs) / 60000;

  if (mode === 'long_run') {
    const hoursWindow = 24;
    const elapsedH = minutesSinceEnd / 60;
    const pct = Math.max(0, Math.min(100, Math.round((elapsedH / hoursWindow) * 100)));
    const minutesRemaining = Math.max(0, Math.round((hoursWindow * 60) - minutesSinceEnd));
    const windowState: FuelingWindowState = elapsedH < 4 ? 'open' : elapsedH < 12 ? 'closing' : 'closed';
    return { windowState, minutesRemaining, pct };
  }

  // Standard window: open <20min, closing 20-30min, closed >30min.
  const windowState: FuelingWindowState =
    minutesSinceEnd < FUEL_OPEN_MIN ? 'open'
    : minutesSinceEnd < FUEL_CLOSING_MAX ? 'closing'
    : 'closed';
  const minutesRemaining = windowState === 'closed'
    ? null
    : Math.max(0, Math.round(FUEL_CLOSING_MAX - minutesSinceEnd));
  // pct climbs as the window closes (so the bar drains as opportunity ends)
  const pct = Math.max(0, Math.min(100, Math.round((minutesSinceEnd / FUEL_CLOSING_MAX) * 100)));
  return { windowState, minutesRemaining, pct };
}

/* ────────────────────────── Training input ────────────────────────── */

function composeTrainingInput(
  form: Awaited<ReturnType<typeof computeTrainingForm>>,
  tssDelta: number,
  arcDir: ArcDirection,
): RecoveryBrief['trainingInput'] {
  return {
    tssDelta,
    formDelta: form?.trend7 ?? 0,
    formBandLabel: mapFormBand(form?.label ?? null),
    arcDirection: arcDir,
  };
}

function mapFormBand(label: TrainingFormLabel | null): FormBandLabel {
  // Mapping from training-form.ts labels → brief's band:
  //   DETRAINING / RACE-READY → FRESH    (excess freshness)
  //   PRODUCTIVE              → PRODUCTIVE
  //   LOADED                  → OPTIMAL  (productive overload zone)
  //   OVERREACH               → OVERREACH
  //   BUILDING / null         → BUILDING (we cannot say yet)
  //
  // COLD-4 (2026-08-17) · `BUILDING` and `null` used to fall through to
  // PRODUCTIVE, captioned "cold-start neutral". Neutral is not what PRODUCTIVE
  // says: it is a verdict that the runner is absorbing their training well, and
  // it was being handed to every runner we could not yet see. BUILDING already
  // exists in the source vocabulary and means the honest thing; it now survives
  // the mapping. Wire-safe · the native chip reads this as a free string
  // (TodayRecoveryPanel.swift:238).
  switch (label) {
    case 'DETRAINING':
    case 'RACE-READY':
      return 'FRESH';
    case 'LOADED':
      return 'OPTIMAL';
    case 'OVERREACH':
      return 'OVERREACH';
    case 'PRODUCTIVE':
      return 'PRODUCTIVE';
    case 'BUILDING':
    default:
      return 'BUILDING';
  }
}

function estimateTss(runTiming: TodayRunTimingRow): number {
  const mi = Number(runTiming.distance_mi) || 0;
  const type = runTiming.type_hint ?? 'easy';
  const ifct = INTENSITY_FACTOR[type] ?? 0.85;
  // training-form.ts uses raw mi × IF, presentation-scaled ×10 for TSB.
  // Here we want a TSS-like single number sized in the same band as
  // commercial TSS (typical easy 5mi ≈ 40 TSS · marathon ≈ 320). The
  // SCALE factor of 10 from training-form.ts already matches.
  return Math.round(mi * ifct * 10);
}

async function arcDirection(userUuid: string): Promise<ArcDirection> {
  try {
    const gap = await computeGoalGap(userUuid);
    if (!gap) return 'flat';
    if (gap.status === 'closing') return 'on_track';
    if (gap.status === 'static') return 'flat';
    return 'slipping'; // widening | unclosable
  } catch {
    return 'flat';
  }
}

/* ────────────────────────── Next hard + week progress ────────────────────────── */

function composeNextHard(
  trainingState: Awaited<ReturnType<typeof loadTrainingState>> | null,
  mode: RecoveryMode,
  today: string,
  ctx: { sleepDeficit: number; hrvDrop: number; band: RecoveryBand },
): RecoveryBrief['nextHard'] {
  const nq = trainingState?.nextQuality;
  if (!nq) {
    return {
      type: 'easy',
      dateISO: today,
      label: 'NO QUALITY QUEUED',
      hoursUntil: 0,
      trajectoryChip: 'Easy week · let HRV drift back to baseline',
    };
  }
  const todayMs = Date.parse(today + 'T12:00:00Z');
  const nextMs = Date.parse(nq.date + 'T12:00:00Z');
  const hoursUntil = Math.max(0, Math.round((nextMs - todayMs) / 3600000));
  const label = `${dowShort(nq.dow)} ${nq.type.toUpperCase()}`;
  const trajectoryChip = authorTrajectoryChip(ctx.band, mode, {
    sleepDeficit: ctx.sleepDeficit,
    hrvDrop: ctx.hrvDrop,
    hoursUntil,
    nextType: nq.type,
  });
  return { type: nq.type, dateISO: nq.date, label, hoursUntil, trajectoryChip };
}

function composeWeekProgress(
  trainingState: Awaited<ReturnType<typeof loadTrainingState>> | null,
  state: CoachState,
  today: string,
): RecoveryBrief['weekProgress'] {
  // #52 (audit 2026-06-16) · banked mi prefers trainingState.weekDone, which now
  // sums the canonical deduper (mileageByDay) over the long_run_day week window —
  // not the deprecated MAX-per-day heuristic it used before. The state.weekDone
  // fallback is also canonical (state-loader → canonicalMileageByDay), so both
  // arms agree with Today's "WEEK MI." Per the volume source-of-truth rule.
  const bankedMi = +Number(trainingState?.weekDone ?? state.weekDone ?? 0).toFixed(1);
  const targetMi = +Number(trainingState?.weekPlanned ?? state.weekPlanned ?? 0).toFixed(1);

  // dots = number of run-done days banked so far this week (cap 7).
  // We don't have per-day done flags here · approximate by mileage
  // checkpoint count: ceil(bankedMi / (targetMi/7)) clamped.
  let dots = 0;
  if (targetMi > 0 && bankedMi > 0) {
    dots = Math.min(7, Math.max(1, Math.round((bankedMi / targetMi) * 7)));
  }

  // Long run · find the highest-mi 'long' day in current week from training-state
  // weeks[currentWeekIdx]. Cheap fallback · look at currentWeekDays in CoachState.
  let longRun: RecoveryBrief['weekProgress']['longRun'] = null;
  const longDay = state.currentWeekDays
    .filter((d) => d.type === 'long')
    .sort((a, b) => b.mi - a.mi)[0];
  if (longDay && longDay.date) {
    const todayMs = Date.parse(today + 'T12:00:00Z');
    const dayMs = Date.parse(longDay.date + 'T12:00:00Z');
    longRun = {
      dateISO: longDay.date,
      mi: longDay.mi,
      daysUntil: Math.max(0, Math.round((dayMs - todayMs) / 86400000)),
    };
  }

  // COLD-3 · `state.loadAcwr ?? 0` used to band an absent ratio as 'OK' — a
  // verdict on nothing, and the one the native badge paints teal. Zero already
  // renders as an em-dash on the tile (TodayRecoveryPanel.swift:447); the band
  // now agrees with it instead of contradicting it.
  const acwrValue = state.loadAcwr ?? 0;
  const acwrBand: AcwrBand = state.loadAcwr == null ? 'UNKNOWN'
    : acwrValue >= 1.5 ? 'RAMP_UP'
    : acwrValue >= 1.3 ? 'WATCH'
    : 'OK';

  return {
    bankedMi,
    targetMi,
    dots,
    longRun,
    acwr: { value: +acwrValue.toFixed(2), band: acwrBand },
  };
}

/* ────────────────────────── Score + band ────────────────────────── */

/**
 * COLD-4 (2026-08-17) · the weighted mean now runs over the pillars that are
 * PRESENT and renormalises, instead of scoring absence.
 *
 * What it did before: every term was unconditional, and each one's "no data"
 * value happened to be a good one.
 *
 *   absent HRV    → pct 0  → `100 - 0` = 100 at weight 0.45   → 45 pts
 *   absent RHR    → pct 0  → `100 - 0` = 100 at weight 0.25   → 25 pts
 *   absent form   → `tsb ?? 0` → `70 + 0` = 70 at weight 0.20 → 14 pts
 *   absent sleep  → hardcoded 50 at weight 0.10               →  5 pts
 *                                                              ──────
 *                                                                89/100
 *
 * 89 bands as `recovered` and the brief opens "Recovered cleanly · banking the
 * work." Sixty-four of those points came from data that did not exist, and
 * every default happened to flatter. A pillar we cannot see must not vote.
 *
 * Renormalising means a runner with RHR only is scored on RHR only — a real
 * reading of a thin picture, rather than a confident reading of a fabricated
 * one. `coverage` on the brief says how thin.
 */
function computeScore(inputs: {
  hrvPct: number | null;
  rhrPct: number | null;
  tsb: number | null;
  sleepAdequacyPct: number | null;
}): number {
  // Each pillar contributes a 0-100 score · inverted where needed so
  // higher is always "better recovery." HRV/RHR pct above are 0=fully
  // recovered → 100=most extended; invert.
  //
  // 2026-08-19 · THREE BIOMETRIC PILLARS ONLY. Training form (TSB) used to sit
  // here as a fourth term worth .20; it is now a multiplier applied below, per
  // D1 §2.4. See the RECOVERY_FORM_MULTIPLIER block above.
  const terms: Array<[number | null, number]> = [
    [inputs.hrvPct == null ? null : 100 - inputs.hrvPct, W_HRV],
    [inputs.rhrPct == null ? null : 100 - inputs.rhrPct, W_RHR],
    [inputs.sleepAdequacyPct, W_SLEEP],
  ];
  let weighted = 0;
  let totalWeight = 0;
  for (const [value, weight] of terms) {
    if (value == null) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  // The caller's cold-start gate guarantees at least one recovery pillar, so
  // this cannot divide by zero · the guard is here so a future caller cannot
  // reintroduce the fabrication by loosening the gate.
  if (totalWeight <= 0) return 0;
  const composite = weighted / totalWeight;

  // Load context, applied AFTER the composite and bounded by it. A multiplier
  // "can't *create* a score; it can only modulate one" (D1), so freshness may
  // lift a real reading but a runner with no biometrics has nothing to lift.
  const scored = composite * recoveryFormMultiplier(inputs.tsb);
  return Math.max(0, Math.min(100, Math.round(scored)));
}

function bandFromScore(score: number): RecoveryBand {
  if (score >= 80) return 'recovered';
  if (score >= 65) return 'recovering';
  if (score >= 50) return 'dragging';
  return 'depleted';
}

function bandFromPillars(_pillars: Pick<RecoveryBrief['pillars'], 'sleepTarget' | 'hrvRebound' | 'rhrDelta' | 'fueling'>): RecoveryBand {
  // Cheap proxy used before the full score is computed (for the
  // trajectory-chip authoring context). Mid-band fallback.
  return 'recovering';
}

/**
 * COLD-4 (2026-08-17) · returned a hardcoded 50 for a runner with no sleep
 * data — a mid-band number indistinguishable at the callsite from a measured
 * one. Null now, and `computeScore` drops the term.
 */
function sleepAdequacyPct(sleep7Avg: number | null, hoursTarget: number): number | null {
  if (sleep7Avg == null) return null;
  const ratio = sleep7Avg / hoursTarget;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/* ────────────────────────── Authoring functions ────────────────────────── */

/** authorOneLine · ≤ 90 chars, plain English, no doctrine names. */
export function authorOneLine(
  band: RecoveryBand,
  mode: RecoveryMode,
  ctx: { hrvDrop: number; sleepDeficit: number },
): string {
  if (mode === 'long_run') {
    if (band === 'depleted') return 'Big effort · eat early, sleep long.';
    if (band === 'dragging') return 'Long-run carryover real · 9h+ tonight.';
    if (band === 'recovering') return 'Glycogen + sleep are the levers tonight.';
    return 'Recovered well · keep the carb window open.';
  }
  if (band === 'depleted') return 'Sleep is the only thing that fixes this.';
  if (band === 'dragging') {
    if (ctx.sleepDeficit > 3) return 'Sleep tonight matters · debt is real.';
    return 'HRV down · easy tomorrow non-negotiable.';
  }
  if (band === 'recovering') {
    if (ctx.hrvDrop > 12) return 'Sleep tonight matters.';
    return 'Good session · refuel and rest.';
  }
  return 'Recovered cleanly · banking the work.';
}

/** authorBigCopy · 2-line headline blending one-line + concrete next thing. */
export function authorBigCopy(
  band: RecoveryBand,
  mode: RecoveryMode,
  ctx: { hrvDrop: number; rhrDelta: number; projectedReturnISO: string; nextHardLabel: string },
): string {
  const head = authorOneLine(band, mode, { hrvDrop: ctx.hrvDrop, sleepDeficit: 0 });
  const tail = mode === 'long_run'
    ? buildLongRunTail(ctx)
    : buildStandardTail(ctx);
  return `${head} ${tail}`;
}

function buildStandardTail(ctx: { hrvDrop: number; rhrDelta: number; projectedReturnISO: string; nextHardLabel: string }): string {
  const parts: string[] = [];
  if (ctx.hrvDrop > 8) {
    const eta = new Date(ctx.projectedReturnISO);
    const hh = String(eta.getHours()).padStart(2, '0');
    parts.push(`HRV down ${ctx.hrvDrop}ms · should rebound to baseline by ${hh}:00.`);
  } else if (ctx.rhrDelta > 4) {
    parts.push(`RHR up ${ctx.rhrDelta}bpm · trending back overnight.`);
  } else {
    parts.push(`${ctx.nextHardLabel.replace(/_/g, ' ')} sits next on the board.`);
  }
  return parts.join(' ');
}

function buildLongRunTail(ctx: { nextHardLabel: string }): string {
  return `${ctx.nextHardLabel.replace(/_/g, ' ')} is the next quality piece · keep tomorrow easy.`;
}

/** authorTrajectoryChip · 3-7 words, what matters between now and next hard. */
export function authorTrajectoryChip(
  band: RecoveryBand,
  mode: RecoveryMode,
  ctx: { sleepDeficit: number; hrvDrop: number; hoursUntil: number; nextType: string },
): string {
  if (mode === 'long_run') {
    return "Monday's easy will determine Tuesday quality";
  }
  if (band === 'depleted') return 'Add a recovery day before next hard';
  if (ctx.sleepDeficit > 2) return 'SLEEP TONIGHT MATTERS';
  if (ctx.hrvDrop > 10) return 'HRV will set the cap';
  if (ctx.hoursUntil < 30 && ctx.nextType === 'intervals') return 'Tight turn · easy run tomorrow';
  if (ctx.hoursUntil < 48) return 'Stack matters · sleep + fuel tonight';
  return 'Trajectory holds · stay on the plan';
}

/* ────────────────────────── Internal SQL helpers ────────────────────────── */

/**
 * Today's run timing for fueling window + TSS estimate.
 *
 * Returns null when no run today (caller should already be gated on
 * todayRunDone but this defends in depth · the brief returns null and
 * iPhone hides the post-run view).
 *
 * end_unix_s · best-effort end-of-run timestamp computed from startLocal
 * + movingTimeS. When startLocal is missing we fall back to "midpoint
 * of today" so fueling window logic still degrades gracefully.
 */
async function loadTodayRunTiming(userUuid: string, todayISO: string): Promise<TodayRunTimingRow | null> {
  const row = (await pool.query<{
    start_local: string | null;
    moving_s: string | null;
    distance_mi: string | null;
    type_hint: string | null;
  }>(
    `WITH today_runs AS (
       SELECT data
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date = $2::date
          AND (data->>'distanceMi')::numeric > 1
        ORDER BY COALESCE(data->>'startLocal', '') DESC
        LIMIT 1
     ),
     -- Pull a type hint from the matching plan_workouts row · so the
     -- TSS estimate matches the prescribed intensity factor rather than
     -- defaulting to easy when the runner did a tempo.
     plan_hint AS (
       SELECT pw.type
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso::date = $2::date
        LIMIT 1
     )
     SELECT (t.data->>'startLocal') AS start_local,
            -- #2 · COALESCE the moving-time key. Webhook-ingested runs carry
            -- movingSec/durationSec, not movingTimeS, so a strict movingTimeS
            -- read returned null and the recovery-window end anchor silently
            -- fell back to "midpoint of today" for Strava-webhook runs.
            COALESCE(
              t.data->>'movingTimeS',
              t.data->>'movingSec',
              t.data->>'durationSec'
            ) AS moving_s,
            (t.data->>'distanceMi')  AS distance_mi,
            p.type AS type_hint
       FROM today_runs t
       LEFT JOIN plan_hint p ON true`,
    [userUuid, todayISO],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!row) return null;

  // Compute end_unix_s · startLocal + movingTimeS. startLocal is an
  // ISO-ish string with timezone offset; Date.parse handles it.
  let endUnixS: number | null = null;
  if (row.start_local && row.moving_s) {
    const startMs = Date.parse(row.start_local);
    const movingS = Number(row.moving_s);
    if (Number.isFinite(startMs) && Number.isFinite(movingS)) {
      endUnixS = Math.floor((startMs + movingS * 1000) / 1000);
    }
  }
  // Fallback · midpoint of today in user local time
  if (endUnixS == null) {
    endUnixS = Math.floor(Date.parse(todayISO + 'T12:00:00Z') / 1000);
  }

  return {
    start_local: row.start_local,
    moving_s: row.moving_s ? Number(row.moving_s) : null,
    distance_mi: row.distance_mi ? Number(row.distance_mi) : null,
    type_hint: row.type_hint,
    end_unix_s: endUnixS,
  };
}

/* ────────────────────────── Misc ────────────────────────── */

function dowShort(dow: number): string {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dow % 7] ?? 'TUE';
}
