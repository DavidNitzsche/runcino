/**
 * lib/coach/readiness-brief.ts · the daily morning-brief composer.
 *
 * Turns the runner's current CoachState + 60d history into a rich,
 * design-ready envelope:
 *
 *   · Top line · score + band + plain-language headline + one-line mover
 *   · Per-pillar tiles · current value · baseline · band · weight · meaning + confounders
 *   · 14-day trends · score + per-pillar sparklines
 *   · Streaks · "HRV down 3 days in a row" (per Research/15 3-day persistence rule)
 *   · Movers · biggest pillar delta vs yesterday with plain-language frame
 *   · Citations · per-pillar research path (drawer can deep-link)
 *
 * Doctrine-grounded:
 *   · Research/15 §HRV (Plews 7d rolling + SWC + CV)
 *   · Research/15 §RHR (60d baseline · nocturnal preferred)
 *   · Research/00b §Sleep (7-9h healthy band · 8h+ under high load)
 *   · Research/15 §ACWR (directional, NOT deterministic per Impellizzeri critique)
 *   · Research/15 §Subjective Measures (Saw et al. · subjective beats objective when they disagree)
 *
 * Generic mechanism · works for any user. No hardcoded baselines.
 *
 * Returns null when the runner has zero data signal at all · the panel
 * renders an empty-state instead.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { computeReadiness, type ReadinessBreakdown, type ReadinessInput } from './readiness';
import { loadReadinessHistory, type PillarPoint, type ReadinessHistory } from './readiness-history';
import type { CoachState } from '@/lib/topics/types';
import { buildSynthesis } from './synthesis';
import { buildForecasts, type Forecast } from './forecasts';
import { computeTrainingForm } from './training-form';
import { buildHealthActions, type HealthAction } from './health-actions';

export type PillarKey = 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
export type PillarBand = 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
export type StreakDirection = 'above' | 'below';

export interface ReadinessStreak {
  pillar: PillarKey;
  direction: StreakDirection;
  days: number;             // ≥3 to be surfaced
  startDate: string;        // YYYY-MM-DD
  /** 5-10 word collapsed banner copy · default state. */
  short: string;
  /** Plain-language doctrine for what an n-day streak means · revealed on tap. */
  meaning: string;
}

export interface ReadinessMover {
  pillar: PillarKey;
  deltaPts: number;          // signed · positive = score up vs yesterday
  /** "HRV is the biggest mover · -6 pts vs yesterday." */
  label: string;
}

export interface ReadinessConfounder {
  /** Affected pillar · always equals the parent tile's key. Kept for
   *  legacy field stability · UI should NOT render this as the tag
   *  (it's redundant with the parent context). Use categoryTag instead. */
  pillar: PillarKey;
  /** One-line plausible explanation the runner can check against. */
  explanation: string;
  /** Whether THIS confounder is likely (vs just listed) · drives surfacing. */
  likely: boolean;
  /** 2026-06-03 · cause category for display. Names what's BEHIND the
   *  affected pillar's drop · 'SLEEP' / 'LOAD' / 'STRESS' / 'HEAT' /
   *  'ILLNESS' / 'HYDRATION' / 'ALCOHOL' / 'MEAL' / 'TRAVEL' / 'OTHER'.
   *  UI renders this as the tag. The old field `pillar` was the parent
   *  pillar (always self-referential · e.g. HRV confounder tagged HRV)
   *  which the Drawer displayed, producing the misleading
   *  "MOST LIKELY BEHIND IT: HRV · Sleep deficit..." (the cause is
   *  SLEEP, not HRV). */
  categoryTag: 'SLEEP' | 'LOAD' | 'STRESS' | 'HEAT' | 'ILLNESS' | 'HYDRATION' | 'ALCOHOL' | 'MEAL' | 'TRAVEL' | 'OTHER';
}

export interface ReadinessPillarTile {
  key: PillarKey;
  label: string;             // 'SLEEP'
  weightPct: number;          // 28
  observedValue: string;      // '7.2h · 7-night avg'
  observedSub: string;         // '+0.3h vs scaled 7.5h target'
  baseline: string;           // 'target 7.5h'
  band: PillarBand;
  weightContribution: number;  // signed contribution to score
  meaning: string;             // plain-language interpretation
  confounders: ReadinessConfounder[];
  trend: PillarPoint[];        // 14-day sparkline
  citation: string;            // 'Research/00b §Sleep'
}

export interface ReadinessBrief {
  date: string;                // YYYY-MM-DD
  score: number;
  band: PillarBand;
  label: string;               // 'READY'
  /** One-line plain-language headline for the top of the panel. */
  headline: string;
  /** "Score down 6 from yesterday · HRV is the mover." */
  oneLineMover: string | null;
  /** 2026-06-03 · "What should I DO today?" — concrete prescription
   *  derived from band + active streaks + today's planned workout type +
   *  subjective override (when present). Authored, not templated.
   *
   *  · action · imperative one-liner the runner can act on
   *  · why    · one-line reasoning citing the trigger
   *  · intent · structured intent for downstream comparison:
   *      'cut'   · prescription reduces planned load (skip quality,
   *                drop long, ease easy)
   *      'plan'  · prescription holds the plan as-is
   *      'send'  · prescription pushes (rare · for SHARP days)
   *      'rest'  · prescription is full rest
   *  · targetMinutes / targetMiles · the rough quantity the
   *      prescription suggests · null when the action is
   *      qualitative ("plan stands"). Used by the post-run reflection
   *      to compare actual run to the morning's call.
   *
   *  Examples:
   *    SHARP + planned quality → action="Send it. Plan as scheduled."
   *                              intent='send', target* null
   *    PULL-BACK + sleep streak + planned easy → action="Cut the easy
   *                              to 30min." intent='cut', targetMinutes=30
   *
   *  Null only on true cold-start (band='no-data') or when the
   *  composition can't read today's planned workout. */
  prescription: {
    action: string;
    why: string;
    intent: 'cut' | 'plan' | 'send' | 'rest';
    targetMinutes: number | null;
    targetMiles: number | null;
  } | null;
  /** Score trend, 14-day. Includes today's row. */
  scoreTrend: { date: string; score: number; band: PillarBand }[];
  pillars: ReadinessPillarTile[];
  streaks: ReadinessStreak[];
  movers: ReadinessMover[];
  /** When subjective wellness is recorded for today AND disagrees ≥15 pts
   *  with objective score · per Saw et al. doctrine, subjective wins. */
  subjectiveOverride: {
    subjectiveScore: number;   // 0-100 derived from 1-10 wellness
    objectiveScore: number;
    deltaAbs: number;
    advice: string;
  } | null;
  /** 2026-06-01 · today's morning subjective check-in state. Drives the
   *  Section-8 "How do you feel" prompt. answered=false → prompt renders ·
   *  answered=true → answer surfaces inline. Source: subjective_checkins. */
  subjectiveCheckin: {
    answeredAt: string | null;  // ISO timestamp of last answer
    rating: number | null;       // 0-10 scale
    answered: boolean;           // true when today's row exists
  };
  /** 2026-06-01 · cold-start envelope · only populated when band='no-data'
   *  (otherwise null). Drives the "Building your baseline · 5 more nights"
   *  empty-state UI per the redesigned drawer §"Special state: cold start". */
  coldStart: {
    nightsLogged: number;
    nightsNeeded: number;
    note: string;
    healthConnected: boolean;
  } | null;
  /** 2026-06-01 · authored coach-voice paragraph framing the 14-day score
   *  trend. References active streaks + biggest mover + trajectory · NOT a
   *  template. Null when scoreTrend has < 4 days (not enough to call a trend). */
  trendNote: string | null;
  /** 2026-06-01 · explicit BASELINE / NET / TODAY shape for the math row.
   *  Composer's source-of-truth baseline (mean of past 14d excluding today
   *  via snapshot rows). Null only on true cold start. */
  composition: {
    baseline: number;
    net: number;
    today: number;
  } | null;
  /** 2026-06-01 · HRV CV (Plews coefficient of variation, %).
   *  Research/15 · rising CV = destabilization · 24-72h early-overreach
   *  signal that fires BEFORE HRV ms itself drops. Surfaced on the
   *  Health page as its own tile. Null when < 14d of HRV history. */
  hrvCv: {
    pct: number;
    band: 'stable' | 'watch' | 'destabilizing';
    swcMs: number | null;
    /** 2026-06-01 · 14-day CV trend strip · empty when < 21d of HRV. */
    series: { date: string; pct: number }[];
  } | null;
  /** 2026-06-01 · Power moves #1 · engine-authored 2-3 sentence story
   *  per morning. Pulls dominant pillar movement + confounder hints +
   *  illness watch into plain coach English. Null on cold start. */
  synthesis: string | null;
  /** 2026-06-01 · Power moves #7 · Banister TSB on the brief envelope
   *  so Health page can render it alongside readiness. Same source as
   *  Train page's training-form.ts. Null when < 7 days of training data. */
  trainingForm: {
    tsb: number;
    ctl: number;
    atl: number;
    band: 'detraining' | 'race-ready' | 'productive' | 'loaded' | 'overreach';
    label: string;
  } | null;
  /** 2026-06-01 · Power moves #9 · forecasts · slope detection per
   *  pillar. Projects when each metric crosses into a new band based
   *  on the current trajectory. Empty when no detectable trend. */
  forecasts: Array<{
    pillar: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hrv_cv' | 'wrist_temp';
    daysUntilBandChange: number | null;
    projectedBand: string;
    message: string;
    confidence: 'high' | 'medium' | 'low';
    /** 2026-06-03 · 'good' when trajectory leads to better state. */
    direction?: 'good' | 'bad';
  }>;
  /** "Watching" callouts for tomorrow · the brief points the runner at
   *  what to verify if it persists. Kept on the envelope for backwards
   *  compat (iPhone clients still consume it) · the Health page web
   *  surface has replaced this slot with `actions` per 2026-06-03. */
  watchTomorrow: string[];
  /** 2026-06-03 · WHAT TO DO panel · replaces WATCHING TOMORROW on the
   *  Health page web view. Prioritized list of data-grounded actions
   *  the runner can take · sleep more, run easier, watch for cold
   *  symptoms, trim a long run, etc. Each entry carries a citation
   *  (the underlying number) so the runner can verify. Max 3 entries.
   *  When nothing triggers, surfaces a single ON COURSE entry. See
   *  lib/coach/health-actions.ts for trigger rules. */
  actions: HealthAction[];
  /** 2026-06-01 · Phase 2.3 · daily projection-vs-goal card. Composed
   *  from goal-gap engine (Phase 1.1) + simulator (Phase 2.1). The
   *  honest-projection surface · status-aware headline, confidence
   *  band, what-closes-it actions, A/B/C alternatives when not closing.
   *  Null when the runner has no active plan + goal (cold start). */
  gapReport: {
    headline: string;
    trajectorySec: number;
    goalSec: number;
    gapSec: number;
    status: 'closing' | 'static' | 'widening' | 'unclosable';
    confidenceBand: {
      p25Sec: number;
      medianSec: number;
      p75Sec: number;
    } | null;
    whatClosesIt: string[];
    alternativeRanges: {
      a: { sec: number; label: string };
      b: { sec: number; label: string };
      c: { sec: number; label: string };
    } | null;
    weeksRemaining: number;
    daysToRenegotiate: number | null;
    riskFlags: string[];
  } | null;
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  sleep: 'SLEEP', hrv: 'HRV', rhr: 'RHR', load: 'LOAD', hr_recovery: 'HR RECOVERY',
};
const PILLAR_WEIGHT: Record<PillarKey, number> = {
  sleep: 28, hrv: 28, rhr: 24, load: 15, hr_recovery: 5,
};
// 2026-06-01 · Pillar "citation" field stripped of Research/ pointers
// per the locked "no citations anywhere" rule. The value is still
// populated for backwards compat (do-not-render contract with frontend)
// but no longer carries doctrine identifiers that could leak to the runner.
// The underlying doctrine still lives in code comments + Research/ files.
const PILLAR_CITATION: Record<PillarKey, string> = {
  sleep: 'Sleep · 7-9h healthy band, 8h+ under high training load',
  hrv: 'HRV · 7-day rolling vs smallest-worthwhile-change',
  rhr: 'RHR · 60-day nocturnal baseline, ±5 bpm range',
  load: 'Load · directional sanity check, not a stop-light',
  hr_recovery: 'HR Recovery · 60s post-workout drop',
};

const STREAK_MIN_DAYS = 3;
const SUBJECTIVE_DISAGREE_THRESHOLD = 15;

/**
 * Compose the readiness brief for a runner.
 *
 * Pulls 60d of history, computes the score (using existing readiness.ts),
 * detects streaks, builds per-pillar tiles with confounder surfacing,
 * and frames everything in plain English.
 *
 * Returns null when CoachState carries zero recoverable signals (a brand-
 * new user before any HealthKit data lands). The panel renders an empty
 * state in that case.
 */
export async function loadReadinessBrief(
  userId: string,
  state: CoachState,
  todayISO?: string,
): Promise<ReadinessBrief | null> {
  const date = todayISO ?? new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const history = await loadReadinessHistory(userId);

  // Score today with the (existing) computeReadiness function · scale
  // the sleep target by ACWR per Research/00b ("recovery requirements
  // scale with absolute training load").
  const dynamicSleepTarget = computeDynamicSleepTarget(state.loadAcwr);
  const stateForScore: CoachState = { ...state };
  const breakdown = computeReadiness(stateForScore);

  // 2026-06-01 · cold-start no longer short-circuits to null · the
  // drawer needs the coldStart envelope to render the "Building your
  // baseline · 5 more nights" state per the redesigned drawer spec.
  if (breakdownIsEmpty(breakdown)) {
    const coldStart = await loadColdStart(userId, 'no-data');
    return {
      date,
      score: 0,
      band: 'no-data',
      label: 'BUILDING',
      headline: coldStart?.note ?? 'Connect Apple Health to start your baseline.',
      oneLineMover: null,
      prescription: null,
      scoreTrend: [],
      pillars: [],
      streaks: [],
      movers: [],
      subjectiveOverride: null,
      subjectiveCheckin: { answeredAt: null, rating: null, answered: false },
      coldStart,
      trendNote: null,
      composition: null,
      hrvCv: null,
      synthesis: null,
      trainingForm: null,
      forecasts: [],
      watchTomorrow: [],
      actions: [],
      gapReport: null,
    };
  }

  // 2026-06-03 · Pull yesterday's pillar weights for mover detection.
  // Was: read readiness_snapshots[yesterday] · but that table is
  // populated by the nightly cron at 09:00 UTC, BEFORE today's HRV/RHR
  // readings come in. Each snapshot row therefore stored the PREVIOUS
  // day's most-recent reading · so snapshot[6/2] held the 6/1 values.
  // Mover delta was computed against this one-day-stale baseline and
  // came out wildly understated (David's 6/3 HRV swing 85→37ms gave
  // a -7 mover instead of the real -35).
  //
  // Now: compute yesterday's pillar weights LIVE from raw signals (HRV
  // reading on yesterday's date, sleep avg ending yesterday, etc.) and
  // run them through computeReadiness. Mover delta = today.weight -
  // yesterday.weight using the same formula on both sides.
  const yesterdaySnap = await computeYesterdayPillars(userId, date, stateForScore);

  // 14-day score trend.
  const scoreTrend = await loadScoreTrend(userId, date, 14, breakdown);

  // Streaks per pillar (3-day persistence rule).
  const streaks = detectStreaks(history, breakdown);

  // Movers · biggest delta vs yesterday's score.
  const movers = computeMovers(breakdown, yesterdaySnap);

  // Per-pillar tiles · enrich with trend, confounders, banding.
  const pillars = buildPillarTiles(breakdown, history, state, dynamicSleepTarget);

  // Headline · band-aware + streak-aware.
  const headline = buildHeadline(breakdown, streaks, movers);

  // One-line mover frame.
  const oneLineMover = movers.length > 0
    ? `${movers[0].label}`
    : null;

  // 2026-06-01 · subjective check-in + override (web agent brief §1).
  // Reads today's subjective_checkins row. When the runner's 0-10
  // rating disagrees with the objective composite by ≥15 pts (after
  // ×10 normalization), populate subjectiveOverride per Saw et al.
  const subjectiveCheckin = await loadSubjectiveCheckin(userId, date);
  const subjectiveOverride = computeSubjectiveOverride(breakdown, subjectiveCheckin);

  // 2026-06-03 · prescription · concrete "what should I DO today" line
  // based on band + active streaks + today's planned workout type +
  // subjective override. Authored, not templated · the engine writes
  // one line the runner can act on, citing the trigger.
  const prescription = composePrescription({
    band: breakdown.band,
    streaks,
    todayWorkoutType: state.todayWorkout?.type ?? null,
    subjectiveOverride,
  });

  // 2026-06-01 · cold-start envelope (web agent brief §2). Null when
  // we have a score · only populated for band='no-data' runners.
  const coldStart = await loadColdStart(userId, breakdown.band);

  // 2026-06-01 · trendNote (web agent brief §4). Authored coach copy
  // for the 14-day chart · references streaks + movers + trajectory.
  const trendNote = buildTrendNote(scoreTrend, breakdown.score, streaks, movers);

  // 2026-06-01 · composition (web agent brief §5). Single source of
  // truth for BASELINE / NET / TODAY math row.
  const composition = buildComposition(scoreTrend, breakdown.score);

  // 2026-06-01 · HRV CV surface. Plews early-overreach signal already
  // computed in readiness-history · expose it here as a top-level field
  // so the Health page can render a tile. Bands per Research/15: <5%
  // stable · 5-7% watch · ≥7% destabilizing.
  const hrvCv = history.hrvPlews?.cv != null
    ? {
        pct: history.hrvPlews.cv,
        band: (history.hrvPlews.cv < 5
          ? 'stable'
          : history.hrvPlews.cv < 7 ? 'watch' : 'destabilizing') as 'stable' | 'watch' | 'destabilizing',
        swcMs: history.hrvPlews.swc,
        series: history.hrvPlews.cvSeries ?? [],
      }
    : null;

  // Watch tomorrow · forward-looking guidance. Kept for iPhone clients
  // that still consume `watchTomorrow`. Web Health page renders
  // `actions` below instead.
  const watchTomorrow = buildWatchTomorrow(breakdown, streaks, history);

  // 2026-06-01 · Phase 2.3 · gap report. The honest-projection card ·
  // status-aware headline + confidence band + A/B/C alternatives. Best-
  // effort (returns null when runner has no active plan + goal).
  const gapReport = await loadGapReport(userId);

  // 2026-06-01 · Power moves #7 · Training Form (Banister TSB). Lift
  // from training-form.ts onto the brief so Health page renders it
  // alongside readiness.
  const trainingFormRaw = await computeTrainingForm(userId).catch(() => null);
  const trainingForm = trainingFormRaw
    ? {
        tsb: Math.round(trainingFormRaw.tsb),
        ctl: Math.round(trainingFormRaw.ctl),
        atl: Math.round(trainingFormRaw.atl),
        band: (trainingFormRaw.label === 'RACE-READY' ? 'race-ready'
          : trainingFormRaw.label === 'PRODUCTIVE' ? 'productive'
          : trainingFormRaw.label === 'LOADED' ? 'loaded'
          : trainingFormRaw.label === 'OVERREACH' ? 'overreach'
          : trainingFormRaw.label === 'DETRAINING' ? 'detraining'
          : 'productive') as 'detraining' | 'race-ready' | 'productive' | 'loaded' | 'overreach',
        label: trainingFormRaw.label,
      }
    : null;

  // 2026-06-01 · Power moves #10 · forecasts. Slope detection per
  // pillar with band-crossing projections.
  const forecasts: Forecast[] = buildForecasts(history);

  // 2026-06-01 · Power moves #1 · synthesis card. Engine-authored
  // cross-metric story. Needs wrist temp + RR + sleep stages + TSB ·
  // pull those from health-state via a side-load (kept light · just
  // the deltas we need).
  const synthesisHealth = await loadSynthesisHealthSignals(userId, date);
  const recentHardSession = await detectRecentHardSession(userId, date);
  const synthesis = buildSynthesis({
    breakdown,
    state,
    wristTempDeltaC: synthesisHealth.wristTempDeltaC,
    rrDelta: synthesisHealth.rrDelta,
    sleepStages: synthesisHealth.sleepStages,
    tsb: trainingForm?.tsb ?? null,
    recentHardSession,
  });

  // 2026-06-03 · WHAT TO DO panel. Data-grounded actions per David's
  // ask "instead of watching tomorrow · can we surface something
  // about actions to take". Each rule fires only on a real trigger ·
  // when nothing fires, returns a single ON COURSE entry.
  // 2026-06-03 · plan adaptation context. When the plan adapter has
  // already mutated today's or tomorrow's workout (downgrade/shave/
  // reschedule), the action panel surfaces THAT instead of issuing a
  // parallel text prescription. "Panel describes the plan, doesn't
  // double-prescribe" architecture per David.
  const planAdaptation = await loadActivePlanAdaptation(userId, date);

  const actions = buildHealthActions({
    breakdown,
    state,
    history,
    streaks,
    trainingForm: trainingForm ? { tsb: trainingForm.tsb, label: trainingForm.label } : null,
    wristTempDeltaC: synthesisHealth.wristTempDeltaC,
    activeSick: false, // not currently tracked on CoachState · TODO when sick_episodes flows through
    // scoreTrend includes today (appended by loadScoreTrend) so the
    // tail of slice(-3) is [day-before-yesterday, yesterday, today].
    scoreTrend: scoreTrend.map((s) => ({ date: s.date, score: s.score })),
    planAdaptation,
  });

  return {
    date,
    score: breakdown.score,
    band: breakdown.band as PillarBand,
    label: breakdown.label,
    headline,
    oneLineMover,
    prescription,
    scoreTrend,
    pillars,
    streaks,
    movers,
    subjectiveOverride,
    subjectiveCheckin,
    coldStart,
    trendNote,
    composition,
    hrvCv,
    synthesis,
    trainingForm,
    forecasts,
    watchTomorrow,
    actions,
    gapReport,
  };
}

/* ────────────────────────── Prescription ──────────────────────────
 * 2026-06-03 · "What should I DO today?" composer.
 *
 * Authored per band + active streaks + today's planned workout type.
 * Strong streaks (sleep / HRV) override band-only guidance because
 * chronic signals trump today's number.
 *
 * Subjective override (when the runner's check-in disagrees with
 * objective ≥15 pts) softens or hardens the prescription per Saw
 * et al. doctrine · "subjective wins on the day."
 *
 * Doctrine cites: Plews/Buchheit (HRV-guided training), Pfitzinger
 * (sleep is the recovery floor), Daniels (easy is non-negotiable
 * when load is elevated), Saw et al. (subjective beats objective).
 */
function composePrescription(args: {
  band: ReadinessBreakdown['band'] | 'no-data';
  streaks: ReadinessStreak[];
  todayWorkoutType: string | null;
  subjectiveOverride: ReadinessBrief['subjectiveOverride'];
}): ReadinessBrief['prescription'] {
  const { band, streaks, todayWorkoutType, subjectiveOverride } = args;
  if (band === 'no-data') return null;

  // Local helper · consolidates the return shape and structures the
  // 2026-06-03 intent + target fields downstream consumers (the
  // post-run reflection in particular) read to compare actual run to
  // the morning's call.
  const rx = (
    action: string,
    why: string,
    intent: 'cut' | 'plan' | 'send' | 'rest',
    targets: { min?: number; mi?: number } = {},
  ): ReadinessBrief['prescription'] => ({
    action,
    why,
    intent,
    targetMinutes: targets.min ?? null,
    targetMiles: targets.mi ?? null,
  });

  // Subjective override takes precedence per Saw et al. doctrine.
  if (subjectiveOverride) {
    const sub = subjectiveOverride.subjectiveScore;
    const obj = subjectiveOverride.objectiveScore;
    if (sub - obj >= 15) {
      return rx(
        'Plan stands. You feel better than the numbers.',
        `Subjective ${sub} vs objective ${obj} · trust the body when the gap is this wide.`,
        'plan',
      );
    }
    if (obj - sub >= 15) {
      return rx(
        'Ease back regardless of plan. Easy 20-30min only or full rest.',
        `Subjective ${sub} vs objective ${obj} · the body knows when the numbers don't.`,
        'cut',
        { min: 25 },
      );
    }
  }

  const sleepStreak = streaks.find((s) => s.pillar === 'sleep');
  const hrvStreak   = streaks.find((s) => s.pillar === 'hrv');
  const chronicSignal = sleepStreak || hrvStreak;
  const wType = (todayWorkoutType ?? '').toLowerCase();
  const isQuality = wType === 'intervals' || wType === 'tempo' || wType === 'threshold';
  const isLong    = wType === 'long';
  const isEasy    = wType === 'easy' || wType === 'recovery';
  const isRest    = wType === 'rest' || wType === '';

  const reason = (frame: string) =>
    chronicSignal
      ? `${chronicSignal.pillar.toUpperCase()} below for ${chronicSignal.days} days + ${frame}`
      : frame;

  // Hard pull-back when chronic streak compounds with a low band.
  if (band === 'pull-back') {
    if (chronicSignal && chronicSignal.days >= 5) {
      if (isQuality) return rx('Skip today\'s quality. Easy 30min only or full rest.', `${reason('PULL BACK band')} · don't add load on a depleted base.`, 'cut', { min: 30 });
      if (isLong)    return rx('Drop the long to 50-60% distance. No pace targets · jog.', `${reason('PULL BACK band')} · long-run cost will compound.`, 'cut');
      if (isEasy)    return rx('Cut the easy to 30min. Keep it conversational, walk if needed.', `${reason('PULL BACK band')} · pull back even on easy days.`, 'cut', { min: 30 });
      return rx('Rest. Or 20-30min walk if you need to move.', `${reason('PULL BACK band')} · the body needs the day off.`, 'rest', { min: 20 });
    }
    // Acute pull-back · no streak. Less aggressive.
    if (isQuality) return rx('Swap quality for easy 30-45min.', 'PULL BACK band today · save the work for a recovered day.', 'cut', { min: 40 });
    if (isLong)    return rx('Drop long to 70-80% distance. No pace targets.', 'PULL BACK band today · long-run on a bad day costs more than it gains.', 'cut');
    if (isEasy)    return rx('Easy as planned, but cut 1-2mi if it feels off.', 'PULL BACK band today · easy is already the right call.', 'plan');
    return rx('Rest as planned. Mobility if you want.', 'PULL BACK band · rest day matches the signal.', 'rest');
  }

  if (band === 'moderate') {
    if (chronicSignal && chronicSignal.days >= 5) {
      if (isQuality) return rx('Run quality as planned, but cap effort. Stop if pace slips badly.', `MODERATE band + ${chronicSignal.pillar.toUpperCase()} streak ${chronicSignal.days}d · proceed with caution.`, 'plan');
      if (isLong)    return rx('Long as planned, but slower than usual easy pace. No fast finish.', `MODERATE band + ${chronicSignal.pillar.toUpperCase()} streak ${chronicSignal.days}d · build aerobic, skip the strain.`, 'plan');
      return rx('Plan stands. Keep effort conservative.', `MODERATE band + ${chronicSignal.pillar.toUpperCase()} streak ${chronicSignal.days}d · run, don't push.`, 'plan');
    }
    if (isQuality) return rx('Plan stands. Hold the easy band on warm-up + recovery.', 'MODERATE band · execute, don\'t over-reach.', 'plan');
    if (isLong)    return rx('Long as planned. Cap effort at "tired, not wrecked."', 'MODERATE band · build aerobic without paying the next-day tax.', 'plan');
    return rx('Plan stands.', 'MODERATE band · within normal training band.', 'plan');
  }

  if (band === 'ready') {
    if (isQuality) return rx('Plan stands. Execute the workout.', 'READY band · system is recovered.', 'plan');
    if (isLong)    return rx('Long as planned. Optional fast finish if it feels right.', 'READY band · take the long honestly.', 'plan');
    if (isEasy)    return rx('Plan stands. Easy as scheduled.', 'READY band · easy days build the base.', 'plan');
    return rx('Plan stands.', 'READY band · run as scheduled.', 'plan');
  }

  if (band === 'sharp') {
    if (isQuality) return rx('Send it. Plan as scheduled.', 'SHARP band · system is firing · don\'t hold back.', 'send');
    if (isLong)    return rx('Send it. Plan stands · fast finish if it\'s scheduled.', 'SHARP band · use the day.', 'send');
    if (isEasy)    return rx('Easy as planned · don\'t turn it into a hard day because you feel good.', 'SHARP band but easy day · banking days like this matter.', 'plan');
    return rx('Plan stands.', 'SHARP band · run as scheduled.', 'plan');
  }

  // Avoid unused-var lint on isRest · kept for future use.
  void isRest;
  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function breakdownIsEmpty(b: ReadinessBreakdown): boolean {
  // All pillars showing "no data" = no signal at all.
  return b.inputs.every((i) => i.observedV === 'no data' || i.observedV === 'building history');
}

function computeDynamicSleepTarget(acwr: number | null | undefined): number {
  // Research/00b: 7-9h healthy band. 8-9h+ under high training load.
  // High load (ACWR > 1.2) → bump the bar; otherwise stay at 7.5h.
  if (acwr == null) return 7.5;
  if (acwr > 1.3) return 8.5;
  if (acwr > 1.0) return 8.0;
  return 7.5;
}

/**
 * 2026-06-03 · compute yesterday's pillar weights from raw signals.
 *
 * Replaces loadYesterdaySnapshot for the mover calc · the snapshot
 * table is populated by an early-morning cron and stores stale data
 * (one day behind on each pillar), which produced systematically
 * understated mover deltas.
 *
 * This helper queries the signals as they were on yesterday's date:
 *   · HRV: latest reading on or before yesterday
 *   · RHR: latest reading on or before yesterday
 *   · sleep7Avg: average of 7 nights ending yesterday
 *   · hr_recovery: latest reading on or before yesterday
 *   · load: ACWR not recomputed (slow-moving · today's value is fine
 *     proxy for yesterday's; if it changed > sensitivity threshold the
 *     trend will surface elsewhere)
 *
 * Then builds a snapshot-shaped CoachState with yesterday's values and
 * runs computeReadiness · returns the same shape loadYesterdaySnapshot
 * used to so the caller (computeMovers) doesn't change.
 */
async function computeYesterdayPillars(
  userId: string,
  todayISO: string,
  todayState: CoachState,
): Promise<{ score: number; pillars: Record<string, number> } | null> {
  try {
    const yesterdayISO = new Date(Date.parse(todayISO + 'T00:00:00Z') - 86400000)
      .toISOString().slice(0, 10);

    // Query each signal as of yesterday. Each query returns the
    // most-recent reading on or before yesterdayISO · matches what the
    // runner would have seen if they'd opened the app yesterday.
    const [hrvR, rhrR, sleepR, hrRecR] = await Promise.all([
      pool.query<{ v: string }>(
        `SELECT value::text AS v FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1
            AND sample_type = 'hrv'
            AND recorded_at::date <= $2::date
          ORDER BY recorded_at DESC LIMIT 1`,
        [userId, yesterdayISO],
      ).catch(() => ({ rows: [] as { v: string }[] })),
      pool.query<{ v: string }>(
        `SELECT value::text AS v FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1
            AND sample_type = 'resting_hr'
            AND recorded_at::date <= $2::date
          ORDER BY recorded_at DESC LIMIT 1`,
        [userId, yesterdayISO],
      ).catch(() => ({ rows: [] as { v: string }[] })),
      // 7-night avg ending yesterday · matches the sleep pillar's
      // observedV framing of "X.Xh · 7-night avg"
      pool.query<{ avg: string }>(
        `SELECT AVG(value)::text AS avg FROM (
            SELECT value FROM health_samples
             WHERE COALESCE(user_uuid, user_id) = $1
               AND sample_type = 'sleep_hours'
               AND sample_date <= $2::date
               AND value > 0
             ORDER BY sample_date DESC LIMIT 7
         ) s`,
        [userId, yesterdayISO],
      ).catch(() => ({ rows: [] as { avg: string }[] })),
      pool.query<{ v: string }>(
        `SELECT value::text AS v FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1
            AND sample_type = 'hr_recovery'
            AND recorded_at::date <= $2::date
          ORDER BY recorded_at DESC LIMIT 1`,
        [userId, yesterdayISO],
      ).catch(() => ({ rows: [] as { v: string }[] })),
    ]);

    // Build yesterday-state · clone today's state, overwrite the
    // signal values that drive the pillar weights. Baselines stay
    // today's values · they're 14-30 day rolling so the one-day shift
    // is noise. Load (ACWR) stays today's value · ACWR is a 7/28 ratio
    // that doesn't move materially day-to-day.
    const yesterdayState: CoachState = {
      ...todayState,
      hrvCurrent:        hrvR.rows[0]?.v != null ? Number(hrvR.rows[0].v) : null,
      rhrCurrent:        rhrR.rows[0]?.v != null ? Number(rhrR.rows[0].v) : null,
      sleep7Avg:         sleepR.rows[0]?.avg != null ? +Number(sleepR.rows[0].avg).toFixed(1) : null,
      hrRecoveryCurrent: hrRecR.rows[0]?.v != null ? Number(hrRecR.rows[0].v) : null,
    };

    const yesterdayBreakdown = computeReadiness(yesterdayState);
    const pillars: Record<string, number> = {};
    for (const i of yesterdayBreakdown.inputs) pillars[i.key] = i.weight;
    return { score: yesterdayBreakdown.score, pillars };
  } catch {
    return null;
  }
}

async function loadYesterdaySnapshot(
  userId: string,
  todayISO: string,
): Promise<{ score: number; pillars: Record<string, number> } | null> {
  try {
    const yesterdayISO = new Date(Date.parse(todayISO + 'T00:00:00Z') - 86400000)
      .toISOString().slice(0, 10);
    const row = (await pool.query<{ score: number; pillars: Record<string, { weight: number }> }>(
      `SELECT score, pillars FROM readiness_snapshots
        WHERE user_uuid = $1 AND snapshot_date = $2`,
      [userId, yesterdayISO],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!row) return null;
    const weights: Record<string, number> = {};
    for (const [key, val] of Object.entries(row.pillars ?? {})) {
      weights[key] = typeof val === 'object' && val != null && 'weight' in val
        ? Number((val as { weight: number }).weight)
        : 0;
    }
    return { score: row.score, pillars: weights };
  } catch {
    return null;
  }
}

async function loadScoreTrend(
  userId: string,
  todayISO: string,
  days: number,
  todayBreakdown: ReadinessBreakdown,
): Promise<{ date: string; score: number; band: PillarBand }[]> {
  try {
    const startISO = new Date(Date.parse(todayISO + 'T00:00:00Z') - (days - 1) * 86400000)
      .toISOString().slice(0, 10);
    const rows = (await pool.query<{ snapshot_date: Date; score: number; band: string }>(
      `SELECT snapshot_date, score, band FROM readiness_snapshots
        WHERE user_uuid = $1 AND snapshot_date >= $2 AND snapshot_date < $3
        ORDER BY snapshot_date ASC`,
      [userId, startISO, todayISO],
    ).catch(() => ({ rows: [] }))).rows;
    const trend = rows.map((r) => ({
      date: r.snapshot_date.toISOString().slice(0, 10),
      score: r.score,
      band: r.band as PillarBand,
    }));
    // Always include today (even if not yet snapshotted) so the trend has
    // a "now" data point regardless of cron timing.
    trend.push({ date: todayISO, score: todayBreakdown.score, band: todayBreakdown.band as PillarBand });
    return trend;
  } catch {
    return [{ date: todayISO, score: todayBreakdown.score, band: todayBreakdown.band as PillarBand }];
  }
}

/**
 * Detect 3+ day streaks per pillar. Research/15 says single-day swings
 * are noise; 3-day persistence is the actionable signal.
 *
 * Per pillar:
 *   · Sleep: < target for ≥3 days in a row
 *   · HRV: SWC-flagged drop for ≥3 days (Plews) OR straight < baseline
 *   · RHR: > baseline + 3 bpm for ≥3 days
 *   · HR recovery: < baseline by ≥4 bpm for ≥3 days
 *   · Load: ACWR > 1.3 for ≥3 days (read from snapshot history)
 */
function detectStreaks(
  history: ReadinessHistory,
  breakdown: ReadinessBreakdown,
): ReadinessStreak[] {
  const streaks: ReadinessStreak[] = [];

  // Sleep streak
  const sleepStreak = countTailRunLength(
    history.sleep.map((p) => p.value),
    (v, i, arr) => v < 7.5,  // strict against target; meaning is captured separately
  );
  if (sleepStreak.length >= STREAK_MIN_DAYS) {
    streaks.push({
      pillar: 'sleep',
      direction: 'below',
      days: sleepStreak.length,
      startDate: history.sleep.at(-sleepStreak.length)?.date ?? '',
      short: `Sleep below target ${sleepStreak.length} nights running.`,
      meaning: `Sleep below the 7.5h target ${sleepStreak.length} nights running. ` +
        `Cumulative debt compounds · Single short nights don't matter, ` +
        `sustained dips do.`,
    });
  }

  // HRV streak · Plews-flavored when we have the rolling
  if (history.hrvPlews?.swc != null && history.hrvPlews.deltaLn != null) {
    const drops = lastConsecutivePlewsDrops(history.hrv, history.hrvPlews.swc);
    if (drops >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'hrv',
        direction: 'below',
        days: drops,
        startDate: history.hrv.at(-drops)?.date ?? '',
        short: `HRV below baseline ${drops} days running.`,
        meaning: `HRV rolling-7 below baseline ${drops} days in a row · Early ` +
          `functional-overreach signal. Reduce intensity 24-72h and re-check.`,
      });
    }
  } else if (history.hrv.length >= STREAK_MIN_DAYS) {
    // Fallback to simple below-baseline streak when we lack rolling.
    const hrvBaseline = history.hrv.reduce((s, p) => s + p.value, 0) / history.hrv.length;
    const streakLen = countTailRunLength(
      history.hrv.map((p) => p.value),
      (v) => v < hrvBaseline,
    ).length;
    if (streakLen >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'hrv',
        direction: 'below',
        days: streakLen,
        startDate: history.hrv.at(-streakLen)?.date ?? '',
        short: `HRV below 60-day average ${streakLen} days running.`,
        meaning: `HRV below your 60-day average ${streakLen} days in a row. ` +
          `Could be stress, sleep, or accumulating load · Single days are noise, ` +
          `streaks are signal.`,
      });
    }
  }

  // RHR streak
  if (history.rhr.length >= STREAK_MIN_DAYS) {
    const rhrBaseline = history.rhr.length >= 7
      ? history.rhr.slice(0, -7).reduce((s, p) => s + p.value, 0) /
        Math.max(1, history.rhr.length - 7)
      : history.rhr.reduce((s, p) => s + p.value, 0) / history.rhr.length;
    const above = countTailRunLength(
      history.rhr.map((p) => p.value),
      (v) => v - rhrBaseline >= 3,
    ).length;
    if (above >= STREAK_MIN_DAYS) {
      streaks.push({
        pillar: 'rhr',
        direction: 'above',
        days: above,
        startDate: history.rhr.at(-above)?.date ?? '',
        short: `RHR up ${above} days running.`,
        meaning: `Resting HR ≥3 bpm above your 60-day baseline ${above} days ` +
          `in a row. Common culprits: brewing illness, dehydration, alcohol, ` +
          `or accumulating load.`,
      });
    }
  }

  return streaks;
}

/** Walk the array from the tail, count how many consecutive items
 *  match the predicate. Returns { length } where length ≥ 0. */
function countTailRunLength(
  arr: number[],
  pred: (v: number, i: number, arr: number[]) => boolean,
): { length: number } {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i], i, arr)) count++;
    else break;
  }
  return { length: count };
}

/** Plews per-day drop detection · count tail days where the day's
 *  LnRMSSD is ≥ SWC below the 7-day rolling preceding it. */
function lastConsecutivePlewsDrops(hrv: PillarPoint[], swc: number): number {
  if (hrv.length < 8) return 0;
  const ln = hrv.map((p) => Math.log(p.value));
  let count = 0;
  for (let i = ln.length - 1; i >= 6; i--) {
    const rolling = ln.slice(i - 6, i + 1).reduce((s, v) => s + v, 0) / 7;
    // is THIS day a drop > SWC vs the prior rolling?
    const priorRolling = i >= 7
      ? ln.slice(i - 7, i).reduce((s, v) => s + v, 0) / 7
      : rolling;
    if (priorRolling - ln[i] >= swc) count++;
    else break;
  }
  return count;
}

function computeMovers(
  today: ReadinessBreakdown,
  yesterday: { score: number; pillars: Record<string, number> } | null,
): ReadinessMover[] {
  if (!yesterday) return [];
  const movers: ReadinessMover[] = [];
  for (const input of today.inputs) {
    const yWeight = yesterday.pillars[input.key] ?? 0;
    const delta = input.weight - yWeight;
    if (Math.abs(delta) < 2) continue;
    // 2026-06-03 · honest framing · "X down 7 pts vs yesterday" reads as
    // "X dropped 7 (its-own-unit)" · for HRV especially, runners assume
    // -7ms when actually it's -7 readiness pts (the pillar's contribution
    // to today's score moved down by 7). Made the unit explicit: this is
    // the pillar's hit to the readiness score, not the raw value.
    const direction = delta > 0 ? 'lifted the score' : 'pulled the score down';
    const label = delta > 0
      ? `${PILLAR_LABEL[input.key]} ${direction} ${Math.abs(delta)} pts vs yesterday`
      : `${PILLAR_LABEL[input.key]} ${direction} ${Math.abs(delta)} pts vs yesterday`;
    movers.push({
      pillar: input.key,
      deltaPts: delta,
      label,
    });
  }
  movers.sort((a, b) => Math.abs(b.deltaPts) - Math.abs(a.deltaPts));
  return movers.slice(0, 3);
}

/**
 * Per-pillar tile. Combines the score breakdown's interpretation with:
 *   · 14-day trend series (from history)
 *   · Confounder list (plausible-cause checklist for elevated/depressed values)
 *   · Citation pointer for the doctrine drawer
 */
function buildPillarTiles(
  breakdown: ReadinessBreakdown,
  history: ReadinessHistory,
  state: CoachState,
  dynamicSleepTarget: number,
): ReadinessPillarTile[] {
  return breakdown.inputs.map((input) => {
    const trend = trendFor(input.key, history).slice(-14);
    const band = inputToBand(input);
    const confounders = confoundersFor(input.key, input, state, history);
    const baseline = baselineLabel(input.key, input, dynamicSleepTarget);

    return {
      key: input.key,
      label: PILLAR_LABEL[input.key],
      weightPct: PILLAR_WEIGHT[input.key],
      observedValue: input.observedV,
      observedSub: input.observedSub,
      baseline,
      band,
      weightContribution: input.weight,
      meaning: input.meaning,
      confounders,
      trend,
      citation: PILLAR_CITATION[input.key],
    };
  });
}

function trendFor(key: PillarKey, history: ReadinessHistory): PillarPoint[] {
  switch (key) {
    case 'sleep': return history.sleep;
    case 'hrv': return history.hrv;
    case 'rhr': return history.rhr;
    case 'hr_recovery': return history.hrRecovery;
    case 'load': return [];   // load trend would need run history; surfaced elsewhere
  }
}

function inputToBand(input: ReadinessInput): PillarBand {
  if (input.observedV === 'no data' || input.observedV === 'building history') return 'no-data';
  if (input.weight >= 5) return 'sharp';
  if (input.weight >= 0) return 'ready';
  if (input.weight >= -5) return 'moderate';
  return 'pull-back';
}

function baselineLabel(
  key: PillarKey,
  input: ReadinessInput,
  dynamicSleepTarget: number,
): string {
  switch (key) {
    case 'sleep': return `target ${dynamicSleepTarget.toFixed(1)}h`;
    case 'hrv':
    case 'rhr':
    case 'hr_recovery':
      return input.observedSub;
    case 'load':
      return 'Gabbett sweet spot 1.0-1.3';
  }
}

/**
 * Confounders · per Research/15 §RHR + §HRV, surface the alternative
 * explanations for a degraded pillar value. "Likely" flags fire when
 * we have a data signal that supports the confounder (e.g. recent heat
 * → "heat exposure"). The rest are listed for the runner to check.
 */
function confoundersFor(
  key: PillarKey,
  _input: ReadinessInput,
  state: CoachState,
  _history: ReadinessHistory,
): ReadinessConfounder[] {
  switch (key) {
    case 'rhr':
      return [
        { pillar: 'rhr', categoryTag: 'ILLNESS',   explanation: 'Brewing illness or recent vaccine', likely: false },
        { pillar: 'rhr', categoryTag: 'HYDRATION', explanation: 'Dehydration · check fluid intake last 24h', likely: false },
        { pillar: 'rhr', categoryTag: 'ALCOHOL',   explanation: 'Alcohol last night', likely: false },
        { pillar: 'rhr', categoryTag: 'MEAL',      explanation: 'Late or heavy dinner', likely: false },
        { pillar: 'rhr', categoryTag: 'LOAD',      explanation: 'Recent volume bump or hard session',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'rhr', categoryTag: 'HEAT',      explanation: 'Heat exposure on a recent run',
          likely: false },
        { pillar: 'rhr', categoryTag: 'LOAD',      explanation: 'Genuine training overreach',
          likely: state.loadAcwr != null && state.loadAcwr > 1.4 },
      ];
    case 'hrv':
      return [
        { pillar: 'hrv', categoryTag: 'LOAD',    explanation: 'Cumulative training load',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'hrv', categoryTag: 'SLEEP',   explanation: 'Sleep deficit · check the sleep tile',
          likely: state.sleep7Avg != null && state.sleep7Avg < 7.0 },
        { pillar: 'hrv', categoryTag: 'STRESS',  explanation: 'Life stress · work, travel, emotional', likely: false },
        { pillar: 'hrv', categoryTag: 'ALCOHOL', explanation: 'Alcohol or stimulants last night', likely: false },
        { pillar: 'hrv', categoryTag: 'ILLNESS', explanation: 'Body fighting something off', likely: false },
      ];
    case 'sleep':
      return [
        { pillar: 'sleep', categoryTag: 'OTHER',   explanation: 'Schedule debt · catch up over the weekend', likely: false },
        { pillar: 'sleep', categoryTag: 'LOAD',    explanation: 'High training load needs MORE than 7.5h',
          likely: state.loadAcwr != null && state.loadAcwr > 1.2 },
        { pillar: 'sleep', categoryTag: 'ALCOHOL', explanation: 'Caffeine after 2pm or evening alcohol', likely: false },
        { pillar: 'sleep', categoryTag: 'TRAVEL',  explanation: 'Race-week travel or time zone shift', likely: false },
      ];
    case 'load':
      return [
        { pillar: 'load', categoryTag: 'LOAD',  explanation: 'Big week recently · sweet spot is 1.0-1.3', likely: false },
        { pillar: 'load', categoryTag: 'LOAD',  explanation: 'Long layoff before this week · low chronic28', likely: false },
        { pillar: 'load', categoryTag: 'LOAD',  explanation: 'Race week · taper drops ACWR by design', likely: false },
      ];
    case 'hr_recovery':
      return [
        { pillar: 'hr_recovery', categoryTag: 'LOAD',   explanation: 'Hard session in last 24h', likely: false },
        { pillar: 'hr_recovery', categoryTag: 'HEAT',   explanation: 'Heat or humidity during the workout', likely: false },
        { pillar: 'hr_recovery', categoryTag: 'SLEEP',  explanation: 'Sleep deficit or stress', likely: false },
      ];
  }
}

function buildHeadline(
  b: ReadinessBreakdown,
  streaks: ReadinessStreak[],
  movers: ReadinessMover[],
): string {
  // 2026-06-03 · stripped prescriptive tails ("Today is for hard work",
  // "Trade hard work for easy today") per no-reactive-coach. The
  // headline describes the readiness state · the plan decides the
  // workout. "Today is whatever the plan says" stays · it's the
  // doctrine line that reinforces the runner's plan as source of truth.
  if (streaks.length > 0) {
    const s = streaks[0];
    return `${PILLAR_LABEL[s.pillar]} ${s.direction} for ${s.days} days · The trend matters more than today's number.`;
  }
  if (b.band === 'sharp') {
    return movers.length && movers[0].deltaPts > 0
      ? `Sharp · The system is firing. ${movers[0].label.toLowerCase()}.`
      : `Sharp · The system is firing.`;
  }
  if (b.band === 'ready') {
    return `Ready · All systems in their normal band. Today is whatever the plan says.`;
  }
  if (b.band === 'moderate') {
    return `Moderate · One or two pillars dipped. Single-day dips are noise; the next reading clears it up.`;
  }
  return `Pull back · Multiple pillars are flagging.`;
}

function buildWatchTomorrow(
  b: ReadinessBreakdown,
  streaks: ReadinessStreak[],
  history: ReadinessHistory,
): string[] {
  // 2026-06-03 · per no-reactive-coach doctrine:
  //   1. Dropped the streak echo entirely · it restated the STREAKS
  //      card immediately above and tacked "Ease the load." on the end.
  //      David: "1- I have no idea wtf that means and 2 its not really
  //      helpful tbh." Drawer version was unmounted at 182ad4e3 but
  //      Health page still rendered it from this source · killing here.
  //   2. Dropped "Worth reducing one hard session if it persists" tail
  //      from the HRV CV note · engine describes the signal, runner
  //      decides the action.
  //   3. Dropped "One 9h+ night this week resets the trend." tail from
  //      sleep debt · prescription, not observation.
  // What stays · pure forward-looking observation that isn't already
  // surfaced elsewhere on the page.
  const out: string[] = [];
  // Sleep debt · forward-looking, not redundant with any other card.
  if (history.sleep.length >= 3) {
    const last3 = history.sleep.slice(-3).reduce((s, p) => s + Math.max(0, 7.5 - p.value), 0);
    if (last3 >= 3) {
      out.push(`Sleep debt is building · roughly ${last3.toFixed(1)}h short over the last 3 nights.`);
    }
  }
  // CV rising · Plews early-overreach signal.
  if (history.hrvPlews?.cv != null && history.hrvPlews.cv > 5) {
    out.push(`HRV rolling-CV is at ${history.hrvPlews.cv.toFixed(1)}% · the early-destabilization band per Plews.`);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 2026-06-01 · Field additions per readiness-brief-field-additions.md
// ────────────────────────────────────────────────────────────────────────

/**
 * Load today's subjective check-in row · the 0-10 morning rating per
 * Saw et al. 2016 doctrine. Returns the envelope expected by the
 * Section-8 prompt: answered=false → drawer renders the prompt;
 * answered=true → drawer surfaces the answer inline.
 */
async function loadSubjectiveCheckin(
  userId: string,
  todayISO: string,
): Promise<{ answeredAt: string | null; rating: number | null; answered: boolean }> {
  const row = (await pool.query<{ rating: number; updated_at: Date }>(
    `SELECT rating, updated_at
       FROM subjective_checkins
      WHERE user_uuid = $1::uuid AND date = $2::date
      LIMIT 1`,
    [userId, todayISO],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!row) return { answeredAt: null, rating: null, answered: false };
  return {
    answeredAt: row.updated_at?.toISOString() ?? null,
    rating: row.rating,
    answered: true,
  };
}

/**
 * Compute the subjective override block per Saw et al. doctrine ·
 * when the runner's 0-10 rating (×10 normalized) disagrees with the
 * objective composite by ≥15 pts, subjective wins.
 *
 * Returns null when the runner hasn't answered today (no signal) or
 * when objective + subjective agree closely (no override needed).
 */
function computeSubjectiveOverride(
  breakdown: ReadinessBreakdown,
  checkin: { rating: number | null; answered: boolean },
): {
  subjectiveScore: number;
  objectiveScore: number;
  deltaAbs: number;
  advice: string;
} | null {
  if (!checkin.answered || checkin.rating == null) return null;
  const subjective100 = Math.round(checkin.rating * 10);
  const objective = breakdown.score;
  const deltaAbs = Math.abs(objective - subjective100);
  if (deltaAbs < SUBJECTIVE_DISAGREE_THRESHOLD) return null;

  // Direction · subjective lower or higher than objective changes the
  // framing. Both directions are valid per the doctrine.
  const subjectiveLower = subjective100 < objective;
  const advice = subjectiveLower
    ? `Your read is lower than the numbers (${subjective100} vs ${objective}). ` +
      `When subjective and objective disagree, your read wins · Ease the day.`
    : `Your read is higher than the numbers (${subjective100} vs ${objective}). ` +
      `When subjective and objective disagree, your read wins · Proceed as planned.`;

  return {
    subjectiveScore: subjective100,
    objectiveScore: objective,
    deltaAbs,
    advice,
  };
}

/**
 * Load the cold-start envelope · only populated when band='no-data'.
 * Counts distinct sleep nights synced in the last 14 days + checks
 * whether HealthKit is already connected (so the CTA can be tailored).
 *
 * Returns null when band != 'no-data' (rest of the brief is the source
 * of truth at that point).
 */
async function loadColdStart(
  userId: string,
  band: string,
): Promise<{
  nightsLogged: number;
  nightsNeeded: number;
  note: string;
  healthConnected: boolean;
} | null> {
  if (band !== 'no-data') return null;

  const NIGHTS_NEEDED = 7;

  // 2026-06-03 · runner TZ instead of server CURRENT_DATE.
  // The 14-day window slides off the runner's calendar day, not the
  // server's UTC day.
  const today = await runnerToday(userId);
  const sleepCount = (await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT sample_date::date)::text AS n
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = 'sleep_hours'
        AND sample_date >= $2::date - INTERVAL '14 days'`,
    [userId, today],
  ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
  const nightsLogged = Math.min(NIGHTS_NEEDED, Number(sleepCount?.n ?? 0));

  // Health connected · check user_profiles for a non-null connection
  // marker. We use sleep_hours presence in the last 14d as a proxy
  // when explicit columns aren't present · either it's flowing or it
  // isn't.
  const healthConnected = nightsLogged > 0;

  const remaining = Math.max(0, NIGHTS_NEEDED - nightsLogged);
  const note = nightsLogged === 0
    ? `No nights logged yet. Connect Apple Health to sync the last few ` +
      `nights · Or wear your watch tonight and the brief fills in by morning.`
    : remaining === 0
      ? `Enough data · Your first real score lands tomorrow morning.`
      : `${nightsLogged} of ${NIGHTS_NEEDED} nights logged. ${remaining} more ` +
        `${remaining === 1 ? 'night' : 'nights'} until your first real score.`;

  return { nightsLogged, nightsNeeded: NIGHTS_NEEDED, note, healthConnected };
}

/**
 * Authored coach-voice paragraph framing the 14-day score trend.
 * Pulls active streaks + biggest mover + trajectory direction so the
 * note names the actual cause · not template prose.
 *
 * Returns null when scoreTrend has < 4 days (not enough to call a trend).
 */
function buildTrendNote(
  scoreTrend: { date: string; score: number }[],
  todayScore: number,
  streaks: ReadinessStreak[],
  movers: ReadinessMover[],
): string | null {
  if (scoreTrend.length < 4) return null;

  // Baseline · mean of past 14d EXCLUDING today.
  const past = scoreTrend.slice(0, -1);
  if (past.length === 0) return null;
  const priorAvg = Math.round(past.reduce((s, p) => s + p.score, 0) / past.length);
  const delta = todayScore - priorAvg;
  const direction = delta <= -5 ? 'down' : delta >= 5 ? 'up' : 'holding';

  // Lead with trajectory · then graft cause from streaks or biggest mover.
  let cause = '';
  if (streaks.length > 0) {
    const s = streaks[0];
    cause = ` · ${s.days}-day ${PILLAR_LABEL[s.pillar]} ` +
      `${s.direction === 'below' ? 'dip' : 'rise'} is dragging the composite`;
  } else if (movers.length > 0 && Math.abs(movers[0].deltaPts) >= 4) {
    const m = movers[0];
    cause = ` · ${PILLAR_LABEL[m.pillar]} is the mover ` +
      `(${m.deltaPts > 0 ? '+' : ''}${m.deltaPts} pts)`;
  }

  // Closing prescription · what to do next.
  let resolve = '';
  if (direction === 'down') {
    resolve = streaks.find((s) => s.pillar === 'sleep')
      ? '. One full night resets the trend.'
      : streaks.find((s) => s.pillar === 'hrv')
        ? '. 24-72h easier work, then re-check.'
        : '. Watch tomorrow · Single-day noise resolves quickly.';
  } else if (direction === 'up') {
    resolve = '. Trend is healthy · Proceed as planned.';
  } else {
    resolve = '. Within normal day-to-day range.';
  }

  const lead = direction === 'down'
    ? `Down from a ${priorAvg} average`
    : direction === 'up'
      ? `Up from a ${priorAvg} average`
      : `Holding near your ${priorAvg} average`;

  return `${lead}${cause}${resolve}`;
}

/**
 * Composition · BASELINE / NET / TODAY. Single source of truth for
 * the math row. Baseline = mean of past 14 days excluding today.
 * Null only when scoreTrend has 0 prior days (true cold start).
 */
function buildComposition(
  scoreTrend: { date: string; score: number }[],
  todayScore: number,
): { baseline: number; net: number; today: number } | null {
  const past = scoreTrend.slice(0, -1);
  if (past.length === 0) return null;
  const baseline = Math.round(past.reduce((s, p) => s + p.score, 0) / past.length);
  return {
    baseline,
    net: todayScore - baseline,
    today: todayScore,
  };
}

/**
 * 2026-06-01 · Phase 2.3 · load the daily gap report.
 *
 * Composes the projection-vs-goal card from goal-gap (Phase 1.1) +
 * simulator (Phase 2.1). Best-effort · returns null when the runner
 * has no active plan + goal time (cold start) or any of the upstream
 * loads fail.
 *
 * The card is the honest-projection surface that closes the loop ·
 * the runner sees their trajectory + what closes the gap + A/B/C
 * alternatives every morning.
 */
/**
 * 2026-06-03 · pull today's + tomorrow's plan_workouts adaptation
 * state, if either has been mutated by the plan adapter. Returns the
 * most-recent adaptation (so a tomorrow downgrade trumps a today
 * downgrade in the chip · "what's about to happen" beats "what
 * already happened"). Returns null when neither row has been adapted.
 *
 * The action panel uses this to:
 *   1. Surface the actual plan change as the primary read ("Tomorrow's
 *      tempo downgraded to easy") instead of duplicating it as a
 *      separate text prescription.
 *   2. Suppress streak/pull-back triggers that would otherwise issue a
 *      parallel command · the plan already absorbed the signal.
 */
async function loadActivePlanAdaptation(
  userId: string,
  todayISO: string,
): Promise<{
  date: string;
  isToday: boolean;
  currentType: string;
  currentSubLabel: string | null;
  currentDistanceMi: number | null;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  reason: string | null;
  kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
} | null> {
  try {
    const tomorrowISO = new Date(Date.parse(todayISO + 'T00:00:00Z') + 86400000)
      .toISOString().slice(0, 10);
    // Most-recent adaptation across today + tomorrow · prefer tomorrow
    // (forward-looking) when both rows are adapted.
    const r = (await pool.query<{
      date_iso: string;
      type: string;
      sub_label: string | null;
      distance_mi: number | string | null;
      original_type: string | null;
      original_sub_label: string | null;
      original_distance_mi: number | string | null;
      intent_reason: string | null;
      intent_value: { kind?: string; why?: string } | null;
    }>(
      `SELECT pw.date_iso, pw.type, pw.sub_label, pw.distance_mi,
              pw.original_type, pw.original_sub_label, pw.original_distance_mi,
              adapt.reason AS intent_reason,
              adapt.value::jsonb AS intent_value
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         LEFT JOIN LATERAL (
           SELECT ci.reason, ci.value
             FROM coach_intents ci
            WHERE ci.field = pw.id::text
              AND ci.reason LIKE 'plan_adapt%'
            ORDER BY ci.ts DESC
            LIMIT 1
         ) adapt ON TRUE
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso IN ($2, $3)
          AND (pw.original_type IS NOT NULL
               OR pw.original_sub_label IS NOT NULL
               OR pw.original_distance_mi IS NOT NULL)
        ORDER BY (pw.date_iso = $3) DESC, pw.date_iso ASC
        LIMIT 1`,
      [userId, todayISO, tomorrowISO],
    ).catch(() => ({ rows: [] }))).rows[0];

    if (!r) return null;

    // Validate adaptation actually changed something (jsonb numeric
    // round-trips can mark a row "adapted" when nothing real changed).
    const typeChanged = r.original_type != null && r.original_type !== r.type;
    const subLabelChanged = r.original_sub_label != null
      && r.original_sub_label !== r.sub_label;
    const distanceChanged = r.original_distance_mi != null
      && r.distance_mi != null
      && Math.abs(Number(r.original_distance_mi) - Number(r.distance_mi)) > 0.05;
    if (!typeChanged && !subLabelChanged && !distanceChanged) return null;

    let kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null = null;
    if (r.intent_value?.kind) {
      const k = r.intent_value.kind;
      if (k === 'downgrade' || k === 'reschedule' || k === 'shave' || k === 'mark_dirty') {
        kind = k;
      } else {
        kind = 'other';
      }
    } else if (r.intent_reason) {
      const suffix = r.intent_reason.replace(/^plan_adapt_?/, '');
      if (['downgrade', 'reschedule', 'shave', 'mark_dirty'].includes(suffix)) {
        kind = suffix as 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty';
      } else {
        kind = 'other';
      }
    } else {
      kind = 'other';
    }

    return {
      date: r.date_iso,
      isToday: r.date_iso === todayISO,
      currentType: r.type,
      currentSubLabel: r.sub_label,
      currentDistanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      originalType: r.original_type,
      originalSubLabel: r.original_sub_label,
      originalDistanceMi: r.original_distance_mi != null ? Number(r.original_distance_mi) : null,
      reason: r.intent_value?.why ?? r.intent_reason ?? null,
      kind,
    };
  } catch {
    return null;
  }
}

/**
 * Power moves #1 · pull the minimum health signals the synthesis card
 * needs. Light query so we don't load the full HealthState envelope.
 */
async function loadSynthesisHealthSignals(userId: string, today: string): Promise<{
  wristTempDeltaC: number | null;
  rrDelta: number | null;
  sleepStages: {
    deepMin: number | null;
    remMin: number | null;
    lightMin: number | null;
    totalMin: number | null;
  } | null;
}> {
  const [wt, rr, ss] = await Promise.all([
    pool.query<{ today: number | string | null; baseline: number | string | null }>(
      `SELECT
        (SELECT AVG(value::numeric) FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'wrist_temp'
            AND sample_date >= ($2::date - interval '2 days')) AS today,
        (SELECT AVG(value::numeric) FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'wrist_temp'
            AND sample_date >= ($2::date - interval '30 days')
            AND sample_date < ($2::date - interval '2 days')) AS baseline`,
      [userId, today],
    ).then((r) => r.rows[0]),
    pool.query<{ today: number | string | null; baseline: number | string | null }>(
      `SELECT
        (SELECT AVG(value::numeric) FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'respiratory_rate'
            AND sample_date >= ($2::date - interval '2 days')) AS today,
        (SELECT AVG(value::numeric) FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'respiratory_rate'
            AND sample_date >= ($2::date - interval '30 days')
            AND sample_date < ($2::date - interval '2 days')) AS baseline`,
      [userId, today],
    ).then((r) => r.rows[0]),
    pool.query<{ stage: string; avg: number | string }>(
      `SELECT sample_type AS stage, AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type IN ('sleep_deep_minutes','sleep_rem_minutes','sleep_light_minutes')
          AND sample_date >= ($2::date - interval '7 days')
        GROUP BY sample_type`,
      [userId, today],
    ).then((r) => r.rows),
  ]);

  const wristTempDeltaC = wt?.today != null && wt?.baseline != null
    ? +(Number(wt.today) - Number(wt.baseline)).toFixed(2)
    : null;
  const rrDelta = rr?.today != null && rr?.baseline != null
    ? +(Number(rr.today) - Number(rr.baseline)).toFixed(1)
    : null;
  const deep = ss.find((r) => r.stage === 'sleep_deep_minutes')?.avg;
  const rem = ss.find((r) => r.stage === 'sleep_rem_minutes')?.avg;
  const light = ss.find((r) => r.stage === 'sleep_light_minutes')?.avg;
  let sleepStages: { deepMin: number | null; remMin: number | null; lightMin: number | null; totalMin: number | null } | null = null;
  if (deep != null || rem != null || light != null) {
    const deepN = deep != null ? Math.round(Number(deep)) : null;
    const remN = rem != null ? Math.round(Number(rem)) : null;
    const lightN = light != null ? Math.round(Number(light)) : null;
    const totalN = (deepN ?? 0) + (remN ?? 0) + (lightN ?? 0);
    sleepStages = { deepMin: deepN, remMin: remN, lightMin: lightN, totalMin: totalN > 0 ? totalN : null };
  }
  return { wristTempDeltaC, rrDelta, sleepStages };
}

/**
 * Power moves #1 · was yesterday's run a hard session? Used by the
 * synthesis card to frame recovery-debt stories.
 */
async function detectRecentHardSession(userId: string, today: string): Promise<boolean> {
  const r = await pool.query<{ type: string | null; dist: number | string | null }>(
    `SELECT data->>'type' AS type, (data->>'distanceMi')::numeric AS dist
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= ($2::date - interval '2 days')
        AND (data->>'date')::date < $2::date
      ORDER BY (data->>'date')::date DESC LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as { type: string | null; dist: number | string | null }[] }));
  const row = r.rows[0];
  if (!row) return false;
  const type = (row.type ?? '').toLowerCase();
  if (type === 'race' || type === 'long' || type === 'intervals' || type === 'tempo'
      || type === 'threshold' || type === 'fartlek') return true;
  // Distance heuristic when type is missing
  const dist = row.dist != null ? Number(row.dist) : 0;
  return dist >= 12;
}

async function loadGapReport(userId: string): Promise<ReadinessBrief['gapReport']> {
  try {
    const { composeGapReport } = await import('@/lib/plan/gap-report');
    const r = await composeGapReport(userId);
    if (!r) return null;
    return {
      headline: r.headline,
      trajectorySec: r.trajectorySec,
      goalSec: r.goalSec,
      gapSec: r.gapSec,
      status: r.status,
      confidenceBand: r.confidenceBand,
      whatClosesIt: r.whatClosesIt,
      alternativeRanges: r.alternativeRanges,
      weeksRemaining: r.weeksRemaining,
      daysToRenegotiate: r.daysToRenegotiate,
      riskFlags: r.riskFlags,
    };
  } catch {
    return null;
  }
}
