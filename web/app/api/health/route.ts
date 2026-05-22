/**
 * /api/health — server-side Coach bundle for the Health tab.
 *
 * Mirrors /api/races-page/route.ts. The Coach engine pulls in node-only
 * modules so every Coach method runs here on the server; the client
 * renders the single serialized envelope returned from this route.
 *
 * Coach methods wired:
 *   - bodySystems()         · 5-row tissue-healing card (centerpiece)
 *                             — Glycogen / Muscle / Connective / CNS /
 *                             Immune with healed-date predictions and
 *                             "quality returns ~MAY 24" callout
 *   - assessReadiness()     · headline readiness score + level + ACWR +
 *                             easy-share (the composite ring + signal
 *                             bars on the left of row 1)
 *   - prescribeWorkout()    · informs whether today is a quality day so
 *                             the page can frame "stressing systems"
 *                             vs "resting them"
 *
 * Biometric streams (HRV, RHR, sleep, VO2max, respiratory rate, body
 * temp) come from HealthKit (Research/15) which is M2-blocked. Those
 * are surfaced as stubs in the route response with a clear `source:
 * 'stub'` marker so the client can render the design but flag the
 * data lineage.
 */

import { gatherCoachState, type CoachState } from '../../../lib/coach-state';
import { buildTrainingLoad } from '../../../lib/training-load';
import { coach } from '../../../coach/coach';
import { query } from '../../../lib/db';
import { getProfile } from '../../../lib/profile-store';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';
import type {
  CoachDecision,
  BodySystemsReport,
} from '../../../coach/types';

// ─────────────────────────────────────────────────────────────────────
// Stub biometric shapes — kept here (not in lib/) so when HealthKit
// ingestion ships in M2 the shapes can shift in one place and the
// route + data + page all update from a single edit.
// ─────────────────────────────────────────────────────────────────────

export interface HealthBioStub {
  /** Whence this number came. 'stub' until HealthKit lands. */
  source: 'stub' | 'healthkit' | 'derived';
  /** False until HealthKit lands. When false every numeric field is null. */
  isAvailable: boolean;
  /** Latest reading (display number). Null when isAvailable:false. */
  current: number | null;
  /** Baseline / 30-day reference value. Null when isAvailable:false. */
  baseline: number | null;
  /** 7-day series, oldest → today. Empty when isAvailable:false. */
  series7d: number[];
  /** Optional 30-day series (HRV trend chart, VO2max). */
  series30d?: number[];
  /** 7-day low. */
  low7d?: number | null;
  /** 7-day high. */
  high7d?: number | null;
}

export interface HealthApiSleep extends HealthBioStub {
  /** Deep-sleep hours (avg over the window). Null when isAvailable:false. */
  deepHrs: number | null;
  /** REM hours. Null when isAvailable:false. */
  remHrs: number | null;
  /** Efficiency percent (0–100). Null when isAvailable:false. */
  efficiencyPct: number | null;
  /** Goal window in hours, e.g. [7, 9]. */
  goalHrs: [number, number];
}

export interface HealthApiVo2Max extends HealthBioStub {
  /** Age-graded percentile (0–100). Null when isAvailable:false. */
  percentile: number | null;
  /** Sex + age label for the percentile band (e.g. "M 38"). */
  ageBandLabel: string;
  /** Monthly series for the 6-month chart, oldest → newest. Empty when isAvailable:false. */
  series6mo: number[];
  /** Month labels matching `series6mo` (e.g. ["DEC","JAN", ...]). */
  series6moLabels: string[];
}

export interface HealthApiHrZoneTime {
  /** Z1 minutes (easy). */
  z1Min: number;
  z2Min: number;
  z3Min: number;
  z4Min: number;
  z5Min: number;
  /** Polarized share — Z1 minutes / total minutes (0–1). */
  easyShare: number;
  /** 14-day daily mix — each day has minutes per zone, plus a rest flag. */
  days: HealthApiZoneDay[];
}

export interface HealthApiZoneDay {
  /** ISO date. */
  dateISO: string;
  /** Day-of-week label ("M"/"T"/"W"...). */
  dayLabel: string;
  /** True if rest day (no zones logged). */
  rest: boolean;
  /** Zone minute totals for this day. */
  z1Min: number;
  z2Min: number;
  z3Min: number;
  z4Min: number;
  z5Min: number;
}

export interface HealthApiTrainingStress {
  /** CTL (fitness) — 28-day load average. */
  fitnessCtl: number;
  /** ATL (fatigue) — 7-day load average. */
  fatigueAtl: number;
  /** Form = CTL − ATL. */
  formTsb: number;
  /** 30-day load series, oldest → today (TSS-equivalent values). */
  series30d: number[];
  /** Peak week label (e.g. "PEAKED APR 13–19 · 142 MI"). */
  peakWindowLabel: string;
  /** UI verdict pin ("RACE READY" / "BUILDING" / etc.). */
  verdictLabel: string;
  /** Form chip label ("▲ FRESH" / "DETRAINING" / etc.). */
  formChip: string;
  /** Where the numbers came from — 'derived' once the Coach computes
   *  CTL/ATL from Strava, 'stub' until then. */
  source: 'stub' | 'derived';
}

export interface HealthApiBodyTemp extends HealthBioStub {
  /** Display unit (°F). */
  unit: 'F' | 'C';
}

export interface HealthApiMoodCheckin {
  /** ISO date of today's logged check-in. Null if not logged yet. */
  loggedAtISO: string | null;
  /** 1–5 score (1=worst, 5=peak). Null if not logged. */
  score: number | null;
  /** Display label ("Great", "Tired", etc.). Null if not logged. */
  label: string | null;
  /** Local time the user logged ("7:42 AM"). Null if not logged. */
  loggedTimeLabel: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// NEW research-grounded shapes for the rebuilt /health page.
// Every type maps to one card on the new page; the route stubs each
// one with values that match the locked May 2026 mockup until the
// Coach Stage 7 wiring lands (hrvDetail, illnessComposite, formReport,
// bodyMassTrend, cyclePhase, ferritinLevel, subjectiveAgreement).
// ─────────────────────────────────────────────────────────────────────

/** Row 1 — Expanded daily check-in (Saw 2016 / Hooper Index). */
export interface HealthApiExpandedCheckin extends HealthApiMoodCheckin {
  /** Energy slider · 1–10. Null if not logged. */
  energy: number | null;
  /** Soreness slider · 1–10 (10 = worst). Null if not logged. */
  soreness: number | null;
  /** Stress slider · 1–10 (10 = worst). Null if not logged. */
  stress: number | null;
  /** Subjective composite (0–100). Null if not logged. */
  subjectiveScore: number | null;
  /** Research citation footer. */
  citation: string;
}

/** Row 1 — Agreement chip between subjective + wearable. */
export interface HealthApiSubjectiveAgreement {
  /** Subjective composite 0–100 from sliders. Null if not logged. */
  subjectiveScore: number | null;
  /** Objective composite 0–100 from HRV/RHR/sleep. */
  objectiveScore: number;
  /** Comparison verdict. */
  agreementDirection: 'match' | 'subjective_lower' | 'subjective_higher' | 'no_subjective';
  /** Short verdict ("AGREE · GREEN" / "SPLIT · SUBJ WINS"). */
  agreementLabel: string;
  /** Coach tie-breaker note. */
  tieBreakerNote: string;
  /** Research citation. */
  citation: string;
}

/** Row 2 — HRV deep card with CV + Plews verdict. */
export interface HealthApiHrvDetail {
  /** False until HealthKit HRV streams land. When false every metric is null. */
  isAvailable: boolean;
  /** Latest 7-day rolling LnRMSSD (ms). Null when isAvailable:false. */
  current: number | null;
  /** Personal baseline (30-day rolling). Null when isAvailable:false. */
  baseline: number | null;
  /** Coefficient of variation (%) over the trailing window. Null when isAvailable:false. */
  cv: number | null;
  /** Plews-method verdict bucket. Null when isAvailable:false. */
  plewsVerdict: 'stable' | 'drifting' | 'crashed' | null;
  /** Display label for the verdict ("STABLE", "DRIFTING", "CRASHED", "NO DATA YET"). */
  plewsLabel: string;
  /** Trend direction summary ("▲ +4 vs base"). Null when isAvailable:false. */
  trendDirection: string | null;
  /** 30-day series. Empty when isAvailable:false. */
  series30d: number[];
  /** Citation. */
  citation: string;
  /** Source — 'stub' until HealthKit lands. */
  source: 'stub' | 'healthkit' | 'derived';
}

/** Row 3 — Form / CTL · ATL · TSB. */
export interface HealthApiFormReport {
  /** Chronic Training Load (28-day). */
  ctl: number;
  /** Acute Training Load (7-day). */
  atl: number;
  /** TSB = CTL − ATL (the hero number). */
  tsb: number;
  /** Operating band per 00a §CTL/ATL/TSB. */
  tsbBand: 'fresh' | 'optimal' | 'overreached' | 'overtrained';
  /** Display label for the band. */
  bandLabel: string;
  /** Cite. */
  citation: string;
  /** Source. */
  source: 'stub' | 'derived';
}

/** Row 4 — Illness early-warning composite (5 markers). */
export interface HealthApiIllnessMarker {
  /** Stable id. */
  id: 'rhr' | 'hrv' | 'sleepEff' | 'bodyTemp' | 'respRate';
  /** Display label. */
  label: string;
  /** Current value. */
  current: number;
  /** Baseline value. */
  baseline: number;
  /** Mini sparkline (4 days back). */
  series4d: number[];
  /** True if this marker is firing (drifted in the wrong direction). */
  warningTriggered: boolean;
  /** "+0.4" delta string. */
  deltaLabel: string;
  /** Direction the value goes when it's a warning ('up' or 'down'). */
  warningDirection: 'up' | 'down';
  /** Display unit. */
  unit: string;
}

export interface HealthApiIllnessComposite {
  /** False until HealthKit lands. When false markers is empty. */
  isAvailable: boolean;
  markers: HealthApiIllnessMarker[];
  /** Number of markers currently firing (0–5). */
  markersFiring: number;
  /** Top-level verdict bucket. Null when isAvailable:false. */
  compositeVerdict: 'allClear' | 'oneDrift' | 'risk' | 'stopRest' | null;
  /** Display label for the verdict ("ALL CLEAR" / "NO DATA YET" / etc.). */
  verdictLabel: string;
  /** Citation. */
  citation: string;
  /** Source. */
  source: 'stub' | 'healthkit' | 'derived';
}

/** Row 4 — Body mass trend. */
export interface HealthApiBodyMass {
  /** False until HealthKit weight samples land. */
  isAvailable: boolean;
  /** Current weight. Null when isAvailable:false. */
  current: number | null;
  /** 28-day baseline. Null when isAvailable:false. */
  baseline28d: number | null;
  /** 14-day % delta (negative = lost weight). Null when isAvailable:false. */
  delta14dPct: number | null;
  /** True when 14-day drop > 2% per 00b. */
  warningTriggered: boolean;
  /** 28-day series. Empty when isAvailable:false. */
  series28d: number[];
  /** Display unit. */
  unit: 'lb' | 'kg';
  /** Citation. */
  citation: string;
  /** Source. */
  source: 'stub' | 'healthkit' | 'derived';
}

/** Row 5 — Submax HR drift (earliest overtraining marker). */
export interface HealthApiSubmaxHrDrift {
  /** False until Strava HR-stream rollup lands. */
  isAvailable: boolean;
  /** Current submax HR at fixed easy pace. Null when isAvailable:false. */
  current: number | null;
  /** Personal baseline at same pace. Null when isAvailable:false. */
  baseline: number | null;
  /** Drift in bpm (positive = trending overtrained). Null when isAvailable:false. */
  driftBpm: number | null;
  /** 8-week series. Empty when isAvailable:false. */
  series8w: number[];
  /** Verdict bucket. Null when isAvailable:false. */
  verdict: 'stable' | 'creeping' | 'drifting' | 'crashed' | null;
  /** Display label. */
  verdictLabel: string;
  /** Citation. */
  citation: string;
  /** Source. */
  source: 'stub' | 'derived';
}

/** Row 5 (female users) — Cycle phase tracker. */
export interface HealthApiCycle {
  /** False until cycle-log table lands. */
  isAvailable: boolean;
  /** Current cycle phase. Null when isAvailable:false. */
  phase: 'menstruation' | 'follicular' | 'ovulation' | 'luteal' | null;
  /** Display label. */
  phaseLabel: string;
  /** Days into current phase. Null when isAvailable:false. */
  daysIntoPhase: number | null;
  /** Training-load adjustment recommendation. Null when isAvailable:false. */
  loadAdjustmentRec: string | null;
  /** Citation. */
  citation: string;
}

/** Row 5 (female users) — Ferritin / iron status. */
export interface HealthApiFerritin {
  /** False until lab-result table lands. */
  isAvailable: boolean;
  /** Latest ferritin reading (ng/mL). Null = not measured / not yet available. */
  currentNgPerMl: number | null;
  /** Trend bucket. */
  trend: 'rising' | 'stable' | 'falling' | 'unknown';
  /** True when < 30 ng/mL threshold (per Research/13 §8). */
  belowThreshold: boolean;
  /** Citation. */
  citation: string;
}

/** Profile snapshot — drives sex-specific Row 5 rendering. */
export interface HealthApiProfile {
  /** Sex flag — drives whether Row 5 renders. */
  sex: 'male' | 'female' | 'unspecified';
  /** Age band label. */
  ageBandLabel: string;
}

export interface HealthApiSignal {
  /** Stable id ('effort', 'load', 'mileage', 'easy', 'strain'). */
  id: 'effort' | 'load' | 'mileage' | 'easy' | 'strain';
  /** Plain-English label rendered verbatim. */
  label: string;
  /** Signal weight contribution (−0.25, 0.00, +0.25). */
  weight: number;
  /** Bar fill 0–1 — drives the % width on the right of the row. */
  fill: number;
  /** Tone — 'good' / 'neutral' / 'warn'. */
  tone: 'good' | 'neutral' | 'warn';
}

export interface HealthApiReadinessComposite {
  /** Score on 0–100 from the assessReadiness signal mix. */
  score: number;
  /** Headline state (BUILDING / READY / PULL BACK / etc.). */
  headlineLabel: string;
  /** Top-line pin ("READY TO RUN" / "PULL BACK"). */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn';
  /** ACWR + Coach context line ("SCORE +0.30 · COACH +12% VOLUME"). */
  scoreContextLabel: string;
  /** 5 signal bars — each renders as one row in the card. */
  signals: HealthApiSignal[];
}

interface HealthApiOk {
  ok: true;
  today: string;
  state: CoachState;
  bodySystems: CoachDecision<BodySystemsReport>;
  readiness: HealthApiReadinessComposite;
  /** Today's prescription summary so the page can phrase "stressing
   *  vs resting" without re-querying coach. */
  prescription: {
    label: string;
    isQuality: boolean;
    isLong: boolean;
    phaseLabel: string;
    paceLow: number | null;
    paceHigh: number | null;
  } | null;
  hrv: HealthBioStub;
  rhr: HealthBioStub;
  sleep: HealthApiSleep;
  vo2max: HealthApiVo2Max;
  respiratoryRate: HealthBioStub;
  bodyTemp: HealthApiBodyTemp;
  hrZones: HealthApiHrZoneTime;
  trainingStress: HealthApiTrainingStress;
  moodCheckin: HealthApiMoodCheckin;
  // ── NEW research-grounded shapes (rebuilt Health page) ───────────
  expandedCheckin: HealthApiExpandedCheckin;
  subjectiveAgreement: HealthApiSubjectiveAgreement;
  hrvDetail: HealthApiHrvDetail;
  formReport: HealthApiFormReport;
  illnessComposite: HealthApiIllnessComposite;
  bodyMass: HealthApiBodyMass;
  submaxHrDrift: HealthApiSubmaxHrDrift;
  cycle: HealthApiCycle | null;
  ferritin: HealthApiFerritin | null;
  profile: HealthApiProfile;
  /** Per-signal freshness map — drives the "Coach is watching" UI
   *  strip. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
}

interface HealthApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    let userId: string | undefined;
    try {
      const { requireActiveUser } = await import('../../../lib/auth');
      userId = (await requireActiveUser()).id;
    } catch { /* anon ok */ }
    const state = await gatherCoachState({ userId });
    const today = state.now.slice(0, 10);

    // Coach methods we actually call. bodySystems is the centerpiece;
    // assessReadiness powers the composite + signal bars; prescribeWorkout
    // tells us whether today is a stressor or a rest.
    const bodySystems = await coach.bodySystems({ today, state });
    const readinessDecision = await coach.assessReadiness({ today, state });
    let prescription: HealthApiOk['prescription'] = null;
    try {
      const p = await coach.prescribeWorkout({ today, state });
      prescription = {
        label: p.answer.label,
        isQuality: p.answer.isQuality,
        isLong: p.answer.isLong,
        phaseLabel: p.answer.phaseLabel,
        paceLow: p.answer.paceTargetSPerMi?.lower ?? null,
        paceHigh: p.answer.paceTargetSPerMi?.upper ?? null,
      };
    } catch {
      // prescribeWorkout shouldn't throw, but if it does we still want
      // the page to render — fall through with a null prescription.
    }

    const readiness = buildReadinessComposite(state, readinessDecision.answer);

    // Profile drives the female-only Row 5 (cycle + ferritin) and the
    // VO2max age-band label — read it first.
    const profile = await readProfileForHealth();              // real getProfile() read

    // Biometric stubs — every one of these is HealthKit-blocked per
    // Research/15 + the M2 placeholder in coach-state. Local-dev values
    // mirror the locked May 9 mockup so QA renders meaningfully.
    const hrv = stubHrv();
    const rhr = stubRhr();
    const sleep = stubSleep();
    const vo2max = stubVo2max(today, profile.ageBandLabel);
    const respiratoryRate = stubRespiratoryRate();
    const bodyTemp = stubBodyTemp();
    const hrZones = buildHrZones(today, state);
    const trainingStress = buildTrainingStress(state);
    const moodCheckin = stubMoodCheckin(today);

    // NEW research-grounded shapes — every one is a stub today.
    // TODO (Stage 7 Coach): replace each stub with the corresponding
    // Coach method when it lands. Names below match the planned
    // Coach surface so the wiring path stays obvious.
    const expandedCheckin = await readExpandedCheckin(today);   // reads daily_checkin table, falls back to stub
    const hrvDetail = stubHrvDetail(hrv);                       // → coach.hrvDetail()
    const formReport = stubFormReport(trainingStress);          // → coach.formReport()
    const illnessComposite = stubIllnessComposite();            // → coach.illnessComposite()
    const bodyMass = stubBodyMass();                            // → coach.bodyMassTrend()
    const submaxHrDrift = stubSubmaxHrDrift();                  // → coach.submaxHrDrift()
    const cycle = profile.sex === 'female' ? stubCycle() : null;       // → coach.cyclePhase()
    const ferritin = profile.sex === 'female' ? stubFerritin() : null; // → coach.ferritinLevel()
    const subjectiveAgreement = stubSubjectiveAgreement(
      expandedCheckin,
      readiness,
      hrvDetail,
    );                                                          // → coach.subjectiveAgreement()

    const body: HealthApiOk = {
      ok: true,
      today,
      state,
      bodySystems,
      readiness,
      prescription,
      hrv,
      rhr,
      sleep,
      vo2max,
      respiratoryRate,
      bodyTemp,
      hrZones,
      trainingStress,
      moodCheckin,
      expandedCheckin,
      subjectiveAgreement,
      hrvDetail,
      formReport,
      illnessComposite,
      bodyMass,
      submaxHrDrift,
      cycle,
      ferritin,
      profile,
      freshness: await gatherFreshness({ state }),
    };
    return Response.json(body);
  } catch (e) {
    const err: HealthApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Readiness composite — builds the 5-signal-bar score from the Coach's
// assessReadiness output plus state. assessReadiness only returns
// level/message/acwr/easyShare; the mockup wants 5 named signals with
// per-signal weights so we synthesize those here.
//
// TODO: when Coach.assessReadiness grows a structured signals[] output
// (Stage 7 — readiness signal breakdown), replace this synthesis with
// the engine's own breakdown.
// ─────────────────────────────────────────────────────────────────────

function buildReadinessComposite(
  state: CoachState,
  readiness: { level: 'green' | 'yellow' | 'red'; message: string; acwr: number | null; easyShare: number | null },
): HealthApiReadinessComposite {
  // Score band — surface a single integer the ring can render.
  // 88 = mockup default for green/BUILDING. Bracket green 80-95, yellow
  // 60-79, red <60.
  const baseScore = readiness.level === 'green' ? 88 : readiness.level === 'yellow' ? 70 : 50;
  const acwr = readiness.acwr ?? 1.0;
  const easy = readiness.easyShare ?? 0.92;
  const heavyBlock = state.flags.heavyBlockSuspected;
  const recentRaceCount = state.races.raceCount30d;

  // Effort trend — pulled from volume delta 4w vs 8w.
  // TODO: wire to a dedicated RPE rollup once daily RPE check-ins land.
  const effortDelta = state.volume.deltaPct4v4 ?? 0;
  const effortWeight = effortDelta < -0.05 ? 0.25 : effortDelta > 0.10 ? -0.25 : 0;
  const effortTone: HealthApiSignal['tone'] = effortWeight > 0 ? 'good' : effortWeight < 0 ? 'warn' : 'neutral';
  const effortLabel = `Effort trend · ${effortDelta >= 0 ? '+' : ''}${(effortDelta * 100).toFixed(0)}% vs 8w avg`;

  // Load balance — ACWR sweet spot 0.8-1.2.
  const inSweetSpot = acwr >= 0.8 && acwr <= 1.2;
  const loadWeight = inSweetSpot ? 0.25 : acwr > 1.5 || acwr < 0.5 ? -0.25 : 0;
  const loadTone: HealthApiSignal['tone'] = inSweetSpot ? 'good' : loadWeight < 0 ? 'warn' : 'neutral';
  const loadLabel = `Load balance · ${acwr.toFixed(2)} ${inSweetSpot ? '(sweet spot)' : acwr > 1.2 ? '(elevated)' : '(low)'}`;

  // Mileage trend — 4w vs 8w.
  const mileTrendDelta = state.volume.deltaPct4v4 ?? 0;
  const mileWeight = Math.abs(mileTrendDelta) < 0.10 ? 0 : mileTrendDelta > 0 ? 0.25 : -0.25;
  const mileTone: HealthApiSignal['tone'] = mileWeight > 0 ? 'good' : mileWeight < 0 ? 'warn' : 'neutral';
  const mileLabel = `Mileage trend · 4w vs 8w avg`;

  // Easy pace share.
  const easyWeight = easy >= 0.80 ? 0.25 : easy >= 0.70 ? 0 : -0.25;
  const easyTone: HealthApiSignal['tone'] = easyWeight > 0 ? 'good' : easyWeight < 0 ? 'warn' : 'neutral';
  const easyLabel = `Easy pace share · ${Math.round(easy * 100)}%`;

  // Recent strain — race count.
  const strainWeight = recentRaceCount >= 3 ? -0.25 : recentRaceCount === 2 ? 0 : 0.25;
  const strainTone: HealthApiSignal['tone'] = strainWeight > 0 ? 'good' : strainWeight < 0 ? 'warn' : 'neutral';
  const strainLabel = recentRaceCount === 0
    ? 'Recent strain · none'
    : `Recent strain · ${recentRaceCount} race${recentRaceCount === 1 ? '' : 's'} / 30d`;

  const signals: HealthApiSignal[] = [
    { id: 'effort',  label: effortLabel,  weight: effortWeight, fill: 0.80, tone: effortTone },
    { id: 'load',    label: loadLabel,    weight: loadWeight,   fill: 0.75, tone: loadTone },
    { id: 'mileage', label: mileLabel,    weight: mileWeight,   fill: 0.50, tone: mileTone },
    { id: 'easy',    label: easyLabel,    weight: easyWeight,   fill: Math.min(1, easy + 0.05), tone: easyTone },
    { id: 'strain',  label: strainLabel,  weight: strainWeight, fill: 0.65, tone: strainTone },
  ];

  const weightSum = signals.reduce((s, x) => s + x.weight, 0);
  const score = Math.max(0, Math.min(100, baseScore + Math.round(weightSum * 8)));

  const headlineLabel = heavyBlock ? 'RECOVERING'
    : readiness.level === 'green' ? 'BUILDING'
    : readiness.level === 'yellow' ? 'HOLDING'
    : 'PULL BACK';
  const pinLabel = readiness.level === 'green' ? 'READY TO RUN'
    : readiness.level === 'yellow' ? 'HOLD STEADY'
    : 'EASY ONLY';
  const pinVariant: 'green' | 'amber' | 'warn' = readiness.level === 'green'
    ? 'green'
    : readiness.level === 'yellow'
    ? 'amber'
    : 'warn';

  const scoreSign = weightSum >= 0 ? '+' : '−';
  const scoreContextLabel = `SCORE ${scoreSign}${Math.abs(weightSum).toFixed(2)}`;

  return {
    score,
    headlineLabel,
    pinLabel,
    pinVariant,
    scoreContextLabel,
    signals,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Biometric stubs — HealthKit M2 wiring. Values mirror the locked May 9
// mockup so local-dev QA renders meaningful charts.
// TODO: wire to HealthKit ingestion (M2) — once the iOS app writes the
// HealthKit JSON to iCloud each helper reads that block instead.
// ─────────────────────────────────────────────────────────────────────

function stubHrv(): HealthBioStub {
  // HealthKit-blocked. NO DATA YET until HealthKit ingestion writes
  // real LnRMSSD values per Research/15 §HRV.
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
    series30d: [],
    low7d: null,
    high7d: null,
  };
}

function stubRhr(): HealthBioStub {
  // HealthKit-blocked. NO DATA YET until HealthKit writes morning
  // resting heart rate samples.
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
    low7d: null,
    high7d: null,
  };
}

function stubSleep(): HealthApiSleep {
  // HealthKit-blocked. NO DATA YET until HealthKit sleep analysis
  // lands. Goal window stays so the card can render its target band.
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
    low7d: null,
    high7d: null,
    deepHrs: null,
    remHrs: null,
    efficiencyPct: null,
    goalHrs: [7, 9],
  };
}

function stubVo2max(today: string, ageBandLabel: string): HealthApiVo2Max {
  // HealthKit-blocked. NO DATA YET until HealthKit VO2Max samples
  // land. Month labels stay so the X-axis can render in empty state.
  // ageBandLabel comes from the real profile read (readProfileForHealth)
  // so the percentile-band label reflects the runner — no more M 38.
  const month = Number(today.slice(5, 7));
  const monthOrder = [
    'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
  ];
  // 6 months ending in current month.
  const labels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = ((month - 1 - i) + 12) % 12;
    labels.push(monthOrder[m]);
  }
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
    series30d: [],
    series6mo: [],
    series6moLabels: labels,
    percentile: null,
    ageBandLabel,
  };
}

function stubRespiratoryRate(): HealthBioStub {
  // HealthKit-blocked. NO DATA YET until HealthKit respiratory rate
  // samples land (Research/15 §Spotting Illness Early §5).
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
  };
}

function stubBodyTemp(): HealthApiBodyTemp {
  // HealthKit-blocked. NO DATA YET until HealthKit wrist temperature
  // samples land (Research/15 §Spotting Illness Early §4).
  return {
    source: 'stub',
    isAvailable: false,
    current: null,
    baseline: null,
    series7d: [],
    unit: 'F',
  };
}

function stubMoodCheckin(_today: string): HealthApiMoodCheckin {
  // TODO: wire to a daily mood log table (does NOT exist today —
  // Research/20 §Mood logging defines the rule, no data path yet).
  // Surface today's logged value if present; otherwise null + the
  // banner renders the empty state.
  void _today;
  return {
    loggedAtISO: null,
    score: null,
    label: null,
    loggedTimeLabel: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// HR zones — 14-day rollup. Currently fed by Strava activity HR streams
// (when present) but the daily-mix detail isn't built yet so we surface
// a synthesized polarized pattern matching the mockup.
// TODO: wire to a `lib/strava-hr-zones.ts` rollup that aggregates
// per-activity HR streams into zone minutes per day.
// ─────────────────────────────────────────────────────────────────────

function buildHrZones(_today: string, state: CoachState): HealthApiHrZoneTime {
  // easyShare is REAL — derived from Strava intensity (pace-based proxy
  // for polarized share). The per-zone minute totals + daily mix require
  // Strava HR streams which aren't wired yet; those return NO DATA YET
  // (zero totals, empty days) until lib/strava-hr-zones.ts lands.
  void _today;
  const easyShare = state.intensity.easyShare14d > 0 ? state.intensity.easyShare14d : 0;
  return {
    z1Min: 0,
    z2Min: 0,
    z3Min: 0,
    z4Min: 0,
    z5Min: 0,
    easyShare,
    days: [],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Training stress (CTL · ATL · TSB) — derived from Strava actuals once
// the doctrine wearables.ts CTL/ATL calc is exposed as a Coach method.
// TODO: add Coach.formScore(ctl, atl) once Stage 3 engine wires this up.
// ─────────────────────────────────────────────────────────────────────

function buildTrainingStress(state: CoachState): HealthApiTrainingStress {
  // Real CTL/ATL/TSB + verdict labels from the shared pure helper
  // (lib/training-load.ts), driven by state.volume per Research/00a
  // §CTL/ATL/TSB. Identical scalars to before — the math just moved
  // into the lib so /health can render the same numbers.
  const load = buildTrainingLoad({
    weeklyAvg8wMi: state.volume.weeklyAvg8w,
    last7Mi: state.volume.last7Mi,
  });
  // 30-day TSS series — derived. Without per-day TRIMP we approximate
  // a flat arc around current CTL. Real series will land alongside the
  // strava activity HR-stream pipeline.
  const series30d = Array.from({ length: 30 }, (_, i) => {
    const drift = Math.sin((i / 30) * Math.PI) * 6; // gentle arc
    return Math.max(0, Math.round(load.fitnessCtl + drift));
  });

  return {
    fitnessCtl: load.fitnessCtl,
    fatigueAtl: load.fatigueAtl,
    formTsb: load.formTsb,
    series30d,
    peakWindowLabel: load.peakWindowLabel,
    verdictLabel: load.verdictLabel,
    formChip: load.formChip,
    source: 'derived',
  };
}

// ─────────────────────────────────────────────────────────────────────
// NEW research-grounded stubs. Every helper below has a marked
// Stage 7 Coach method TODO. Numbers are deliberately mockup-faithful
// so QA renders meaningfully until the engine lands.
// ─────────────────────────────────────────────────────────────────────

/** Real profile reader — replaces the prior male/M-38 hardcoded stub
 *  that Wave H caught. Reads sex + age from the `profile` table and
 *  surfaces a band label like "M 38" / "F 41" / "— —" when missing.
 *  Sex 'unspecified' suppresses the female-only Row 5. */
async function readProfileForHealth(): Promise<HealthApiProfile> {
  try {
    const row = await getProfile();
    const sexRaw = row?.sex?.trim().toLowerCase() ?? '';
    const sex: HealthApiProfile['sex'] =
      sexRaw === 'female' || sexRaw === 'f' ? 'female'
      : sexRaw === 'male' || sexRaw === 'm' ? 'male'
      : 'unspecified';
    const ageStr = row?.age != null ? String(row.age) : '—';
    const sexLetter = sex === 'female' ? 'F' : sex === 'male' ? 'M' : '—';
    return {
      sex,
      ageBandLabel: `${sexLetter} ${ageStr}`,
    };
  } catch {
    // DB down / table missing — surface a dash so the UI renders
    // "NO PROFILE YET — set in /profile".
    return { sex: 'unspecified', ageBandLabel: '— —' };
  }
}

/** Reads today's daily_checkin row if it exists, otherwise returns
 *  the stub (no-checkin state). Wraps stubExpandedCheckin so the
 *  greet tile + DAILY CHECK-IN card both react to a real DB write
 *  the moment the runner clicks LOG TODAY. */
async function readExpandedCheckin(today: string): Promise<HealthApiExpandedCheckin> {
  try {
    const rows = await query<{
      energy: number;
      soreness: number;
      stress: number;
      logged_at: string;
    }>(
      `SELECT energy, soreness, stress, logged_at::text
       FROM daily_checkin
       WHERE user_id = $1 AND date = $2
       LIMIT 1`,
      ['me', today],
    );
    const row = rows[0];
    if (!row) return stubExpandedCheckin(today);

    // Compute the composite subjective score: higher energy + lower
    // soreness + lower stress = better. 0-100 scale. (Saw 2016 / Hooper).
    const energyN = row.energy;                  // 1-10, higher = better
    const sorenessInv = 11 - row.soreness;       // invert: 10 → 1, 1 → 10
    const stressInv = 11 - row.stress;
    const subjectiveScore = Math.round(((energyN + sorenessInv + stressInv) / 30) * 100);

    // 1-5 label band derived from subjectiveScore.
    let score = 1;
    let label = 'Drained';
    if (subjectiveScore >= 85) { score = 5; label = 'Peak'; }
    else if (subjectiveScore >= 70) { score = 4; label = 'Good'; }
    else if (subjectiveScore >= 55) { score = 3; label = 'Steady'; }
    else if (subjectiveScore >= 40) { score = 2; label = 'Tired'; }

    // Local time of the logged_at timestamp.
    const loggedAt = new Date(row.logged_at);
    const loggedTimeLabel = loggedAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
    });

    return {
      loggedAtISO: row.logged_at,
      score,
      label,
      loggedTimeLabel,
      energy: row.energy,
      soreness: row.soreness,
      stress: row.stress,
      subjectiveScore,
      citation: 'Saw 2016 · /Research/15 §Decision Matrix',
    };
  } catch {
    // DB down or table missing — fall back to stub silently. The page
    // shouldn't 500 on a check-in lookup.
    return stubExpandedCheckin(today);
  }
}

/** Expanded check-in stub. Mockup default: not yet logged today. */
function stubExpandedCheckin(_today: string): HealthApiExpandedCheckin {
  // TODO: wire to coach.dailyCheckin() (Stage 7) + mood-log table.
  // RESEARCH: Research/15 §When Wearable Data Agrees vs. Disagrees ·
  // Research/00b §Qualitative Signals (Hooper index pattern).
  void _today;
  return {
    loggedAtISO: null,
    score: null,
    label: null,
    loggedTimeLabel: null,
    energy: null,
    soreness: null,
    stress: null,
    subjectiveScore: null,
    citation: 'Saw 2016 · /Research/15 §Decision Matrix',
  };
}

/** HRV detail stub. Surfaces the CV + Plews-method verdict per
 *  Research/15 §HRV — Plews approach §5. */
function stubHrvDetail(hrv: HealthBioStub): HealthApiHrvDetail {
  // HealthKit-blocked. When HRV is unavailable, return NO DATA YET.
  // RESEARCH: Research/15 §HRV Plews approach — CV (coefficient of
  // variation) is the first-line destabilization signal; rises before
  // the rolling mean drops. Cannot be computed without HRV samples.
  void hrv;
  return {
    isAvailable: false,
    current: null,
    baseline: null,
    cv: null,
    plewsVerdict: null,
    plewsLabel: 'NO DATA YET',
    trendDirection: null,
    series30d: [],
    citation: '/Research/15 §HRV Plews approach §5',
    source: 'stub',
  };
}

/** Form report stub (CTL · ATL · TSB with operating band). */
function stubFormReport(stress: HealthApiTrainingStress): HealthApiFormReport {
  // TODO: wire to coach.formReport() (Stage 7) — Banister/Allen-Coggan
  // fitness/fatigue model.
  // RESEARCH: /Research/00a §CTL/ATL/TSB · /Research/15 §Fitness/
  // Fatigue/Form Operating Bands.
  // Operating bands per /Research/15 §Fitness/Fatigue/Form:
  //   > +5  = fresh
  //   -10 to -30 = optimal training stress
  //   -30 to -40 = overreached
  //   < -40 = overtrained / dig-hole
  let tsbBand: HealthApiFormReport['tsbBand'] = 'optimal';
  if (stress.formTsb > 5) tsbBand = 'fresh';
  else if (stress.formTsb < -40) tsbBand = 'overtrained';
  else if (stress.formTsb < -30) tsbBand = 'overreached';
  else if (stress.formTsb >= -30 && stress.formTsb <= 5) tsbBand = 'optimal';

  const bandLabel =
    tsbBand === 'fresh' ? '▲ FRESH'
    : tsbBand === 'optimal' ? '● OPTIMAL TRAINING'
    : tsbBand === 'overreached' ? '▼ OVERREACHED'
    : '▼ DIG HOLE';

  return {
    ctl: stress.fitnessCtl,
    atl: stress.fatigueAtl,
    tsb: stress.formTsb,
    tsbBand,
    bandLabel,
    citation: '/Research/15-wearable-data.md §Fitness/Fatigue/Form (CTL/ATL/TSB)',
    source: 'derived',
  };
}

/** Illness-early-warning composite stub. Combines 5 markers per
 *  /Research/15 §Spotting Illness Early. */
function stubIllnessComposite(): HealthApiIllnessComposite {
  // HealthKit-blocked. All 5 markers (RHR · HRV · sleep efficiency ·
  // body temp · respiratory rate) require HealthKit samples. NO DATA
  // YET until ingestion lands.
  // RESEARCH: /Research/15 §Spotting Illness Early — when 3+ markers
  // go off simultaneously, illness is likely within 48-72h.
  return {
    isAvailable: false,
    markers: [],
    markersFiring: 0,
    compositeVerdict: null,
    verdictLabel: 'NO DATA YET',
    citation: '/Research/15 §Spotting Illness Early',
    source: 'stub',
  };
}

/** Body-mass trend stub. Flags 2%+ drop in 14d per 00b. */
function stubBodyMass(): HealthApiBodyMass {
  // HealthKit-blocked. NO DATA YET until HealthKit weight samples land.
  // RESEARCH: /Research/00b §Quantitative Signals — sustained drop
  // >2% over 14 days = stress signal.
  return {
    isAvailable: false,
    current: null,
    baseline28d: null,
    delta14dPct: null,
    warningTriggered: false,
    series28d: [],
    unit: 'lb',
    citation: '/Research/00b §Quantitative Signals',
    source: 'stub',
  };
}

/** Submax HR drift stub — earliest reliable overtraining marker. */
function stubSubmaxHrDrift(): HealthApiSubmaxHrDrift {
  // Strava-HR-stream blocked. NO DATA YET until the per-activity HR-
  // stream rollup at fixed easy pace lands.
  // RESEARCH: /Research/15 §Spotting Overtraining Early §4 — "HR
  // for a given easy pace creeps up 3–8 bpm."
  return {
    isAvailable: false,
    current: null,
    baseline: null,
    driftBpm: null,
    series8w: [],
    verdict: null,
    verdictLabel: 'NO DATA YET',
    citation: '/Research/15 §Spotting Overtraining Early §4',
    source: 'stub',
  };
}

/** Cycle stub — only renders for female users. */
function stubCycle(): HealthApiCycle {
  // Cycle-log table not yet built. NO DATA YET until cycle-log lands.
  // RESEARCH: /Research/13 §1 Menstrual Cycle — phase-aware load.
  return {
    isAvailable: false,
    phase: null,
    phaseLabel: 'NO DATA YET',
    daysIntoPhase: null,
    loadAdjustmentRec: null,
    citation: '/Research/13 §1 Menstrual Cycle',
  };
}

/** Ferritin stub — only renders for female users. */
function stubFerritin(): HealthApiFerritin {
  // Lab-result table not yet built. NO DATA YET until lab results land.
  // RESEARCH: /Research/13 §8 Iron Deficiency — threshold <30 ng/mL.
  return {
    isAvailable: false,
    currentNgPerMl: null,
    trend: 'unknown',
    belowThreshold: false,
    citation: '/Research/13 §8 Iron Deficiency',
  };
}

/** Subjective-vs-objective agreement chip. */
function stubSubjectiveAgreement(
  checkin: HealthApiExpandedCheckin,
  readiness: HealthApiReadinessComposite,
  _hrvDetail: HealthApiHrvDetail,
): HealthApiSubjectiveAgreement {
  // TODO: wire to coach.subjectiveAgreement() (Stage 7).
  // RESEARCH: /Research/15 §Decision Matrix — when subjective and
  // wearable disagree, subjective wins (Saw 2016).
  void _hrvDetail;
  const objectiveScore = readiness.score;
  const subjectiveScore = checkin.subjectiveScore;
  if (subjectiveScore == null) {
    return {
      subjectiveScore: null,
      objectiveScore,
      agreementDirection: 'no_subjective',
      agreementLabel: 'AWAITING CHECK-IN',
      tieBreakerNote: 'Coach defaults to wearable until you log today.',
      citation: '/Research/15 §Decision Matrix · Saw 2016',
    };
  }
  const delta = subjectiveScore - objectiveScore;
  let agreementDirection: HealthApiSubjectiveAgreement['agreementDirection'] = 'match';
  if (delta < -10) agreementDirection = 'subjective_lower';
  else if (delta > 10) agreementDirection = 'subjective_higher';
  const agreementLabel =
    agreementDirection === 'match' ? '✓ AGREE'
    : agreementDirection === 'subjective_lower' ? '▼ SUBJ LOWER · COACH DEFERS'
    : '▲ SUBJ HIGHER · COACH DEFERS';
  const tieBreakerNote =
    agreementDirection === 'match'
      ? 'Subjective and wearable agree.'
      : agreementDirection === 'subjective_lower'
      ? 'Coach is pulling back. Subjective wins ties (Saw 2016).'
      : 'Coach holds the wearable line — body says go, signals say steady.';
  return {
    subjectiveScore,
    objectiveScore,
    agreementDirection,
    agreementLabel,
    tieBreakerNote,
    citation: '/Research/15 §Decision Matrix · Saw 2016',
  };
}
