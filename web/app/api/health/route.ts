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
import { coach } from '../../../coach/coach';
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
  /** Latest reading (display number). */
  current: number;
  /** Baseline / 30-day reference value. */
  baseline: number;
  /** 7-day series, oldest → today. */
  series7d: number[];
  /** Optional 30-day series (HRV trend chart, VO2max). */
  series30d?: number[];
  /** 7-day low. */
  low7d?: number;
  /** 7-day high. */
  high7d?: number;
}

export interface HealthApiSleep extends HealthBioStub {
  /** Deep-sleep hours (avg over the window). */
  deepHrs: number;
  /** REM hours. */
  remHrs: number;
  /** Efficiency percent (0–100). */
  efficiencyPct: number;
  /** Goal window in hours, e.g. [7, 9]. */
  goalHrs: [number, number];
}

export interface HealthApiVo2Max extends HealthBioStub {
  /** Age-graded percentile (0–100). */
  percentile: number;
  /** Sex + age label for the percentile band (e.g. "M 38"). */
  ageBandLabel: string;
  /** Monthly series for the 6-month chart, oldest → newest. */
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
  /** Latest 7-day rolling LnRMSSD (ms). */
  current: number;
  /** Personal baseline (30-day rolling). */
  baseline: number;
  /** Coefficient of variation (%) over the trailing window. */
  cv: number;
  /** Plews-method verdict bucket. */
  plewsVerdict: 'stable' | 'drifting' | 'crashed';
  /** Display label for the verdict ("STABLE", "DRIFTING", "CRASHED"). */
  plewsLabel: string;
  /** Trend direction summary ("▲ +4 vs base"). */
  trendDirection: string;
  /** 30-day series. */
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
  markers: HealthApiIllnessMarker[];
  /** Number of markers currently firing (0–5). */
  markersFiring: number;
  /** Top-level verdict bucket. */
  compositeVerdict: 'allClear' | 'oneDrift' | 'risk' | 'stopRest';
  /** Display label for the verdict. */
  verdictLabel: string;
  /** Citation. */
  citation: string;
  /** Source. */
  source: 'stub' | 'healthkit' | 'derived';
}

/** Row 4 — Body mass trend. */
export interface HealthApiBodyMass {
  /** Current weight. */
  current: number;
  /** 28-day baseline. */
  baseline28d: number;
  /** 14-day % delta (negative = lost weight). */
  delta14dPct: number;
  /** True when 14-day drop > 2% per 00b. */
  warningTriggered: boolean;
  /** 28-day series. */
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
  /** Current submax HR at fixed easy pace. */
  current: number;
  /** Personal baseline at same pace. */
  baseline: number;
  /** Drift in bpm (positive = trending overtrained). */
  driftBpm: number;
  /** 8-week series. */
  series8w: number[];
  /** Verdict bucket. */
  verdict: 'stable' | 'creeping' | 'drifting' | 'crashed';
  /** Display label. */
  verdictLabel: string;
  /** Citation. */
  citation: string;
  /** Source. */
  source: 'stub' | 'derived';
}

/** Row 5 (female users) — Cycle phase tracker. */
export interface HealthApiCycle {
  /** Current cycle phase. */
  phase: 'menstruation' | 'follicular' | 'ovulation' | 'luteal';
  /** Display label. */
  phaseLabel: string;
  /** Days into current phase. */
  daysIntoPhase: number;
  /** Training-load adjustment recommendation. */
  loadAdjustmentRec: string;
  /** Citation. */
  citation: string;
}

/** Row 5 (female users) — Ferritin / iron status. */
export interface HealthApiFerritin {
  /** Latest ferritin reading (ng/mL). Null = not measured. */
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
}

interface HealthApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
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

    // Biometric stubs — every one of these is HealthKit-blocked per
    // Research/15 + the M2 placeholder in coach-state. Local-dev values
    // mirror the locked May 9 mockup so QA renders meaningfully.
    const hrv = stubHrv();
    const rhr = stubRhr();
    const sleep = stubSleep();
    const vo2max = stubVo2max(today);
    const respiratoryRate = stubRespiratoryRate();
    const bodyTemp = stubBodyTemp();
    const hrZones = buildHrZones(today, state);
    const trainingStress = buildTrainingStress(state);
    const moodCheckin = stubMoodCheckin(today);

    // NEW research-grounded shapes — every one is a stub today.
    // TODO (Stage 7 Coach): replace each stub with the corresponding
    // Coach method when it lands. Names below match the planned
    // Coach surface so the wiring path stays obvious.
    const profile = stubProfile();                              // → coach.profile()
    const expandedCheckin = stubExpandedCheckin(today);         // → coach.dailyCheckin() / mood-log table
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
  return {
    source: 'stub',
    current: 68,
    baseline: 64,
    series7d: [62, 60, 64, 66, 70, 72, 74],
    series30d: [58, 59, 58, 60, 60, 62, 61, 62, 63, 62, 64, 63, 65, 64, 64, 65, 64, 66, 66, 67, 68, 67, 68, 68, 69, 70, 70, 71, 72, 74],
    low7d: 62,
    high7d: 72,
  };
}

function stubRhr(): HealthBioStub {
  return {
    source: 'stub',
    current: 42,
    baseline: 43,
    series7d: [44, 43, 44, 43, 43, 42, 42],
    low7d: 41,
    high7d: 44,
  };
}

function stubSleep(): HealthApiSleep {
  return {
    source: 'stub',
    current: 7.7, // 7:42 in decimal
    baseline: 7.4,
    series7d: [7.5, 7.8, 7.3, 8.1, 7.6, 8.2, 7.9],
    low7d: 7.3,
    high7d: 8.2,
    deepHrs: 1.90, // 1:54
    remHrs: 1.77,  // 1:46
    efficiencyPct: 92,
    goalHrs: [7, 9],
  };
}

function stubVo2max(today: string): HealthApiVo2Max {
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
    current: 52,
    baseline: 50.8,
    series7d: [],
    series30d: [],
    series6mo: [50.8, 51.0, 51.3, 51.6, 51.8, 52.0],
    series6moLabels: labels,
    percentile: 90,
    ageBandLabel: 'M 38',
  };
}

function stubRespiratoryRate(): HealthBioStub {
  return {
    source: 'stub',
    current: 14,
    baseline: 14.2,
    series7d: [14.5, 13.8, 14.6, 14.2, 13.6, 14.0, 13.8],
  };
}

function stubBodyTemp(): HealthApiBodyTemp {
  return {
    source: 'stub',
    current: 98.4,
    baseline: 98.3,
    series7d: [98.3, 98.2, 98.4, 98.5, 98.3, 98.2, 98.4],
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

function buildHrZones(today: string, state: CoachState): HealthApiHrZoneTime {
  // Synthesized 14-day rollup mirroring the mockup. Easy share comes
  // from coach-state.intensity which IS real if Strava activities are
  // loaded; the per-day mix is mock.
  const easyShare = state.intensity.easyShare14d > 0 ? state.intensity.easyShare14d : 0.92;
  const daysMix: HealthApiZoneDay[] = [];
  const offsetLabels = ['M','T','W','T','F','S','S'];
  const baseDate = new Date(today + 'T12:00:00Z');
  // Mockup pattern: 14 days, mix of mostly Z1 with sprinkled Z4/Z5 + rest days.
  // Index 12 = today; index 13 = tomorrow (future, rendered dashed).
  const pattern = [
    { z1: 55, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 62, z4: 18, z5: 0, rest: false },
    { z1: 48, z4: 0, z5: 0, rest: false },
    { z1: 70, z4: 0, z5: 15, rest: false },
    { z1: 42, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 52, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 38, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 40, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true }, // today
    { z1: 35, z4: 0, z5: 0, rest: false }, // tomorrow (future hint)
  ];
  for (let i = 0; i < 14; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + (i - 12));
    const dow = d.getUTCDay();
    daysMix.push({
      dateISO: d.toISOString().slice(0, 10),
      dayLabel: offsetLabels[(dow + 6) % 7], // Mon-first
      rest: pattern[i].rest,
      z1Min: pattern[i].z1,
      z2Min: 0,
      z3Min: 0,
      z4Min: pattern[i].z4,
      z5Min: pattern[i].z5,
    });
  }

  return {
    z1Min: 14 * 60, // 14h
    z2Min: 0,
    z3Min: 0,
    z4Min: 42,
    z5Min: 28,
    easyShare,
    days: daysMix,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Training stress (CTL · ATL · TSB) — derived from Strava actuals once
// the doctrine wearables.ts CTL/ATL calc is exposed as a Coach method.
// TODO: add Coach.formScore(ctl, atl) once Stage 3 engine wires this up.
// ─────────────────────────────────────────────────────────────────────

function buildTrainingStress(state: CoachState): HealthApiTrainingStress {
  // Light derivation from coach-state volume signals. Numbers map to
  // the mockup defaults so QA matches the spec until Coach.formScore lands.
  const ctl = state.volume.weeklyAvg8w > 0
    ? Math.round(state.volume.weeklyAvg8w * 1.8)
    : 62;
  const atl = state.volume.last7Mi > 0
    ? Math.round(state.volume.last7Mi * 1.5)
    : 38;
  const tsb = ctl - atl;
  // 30-day TSS series — synthesized arc that peaks mid-window and tapers.
  const series30d = [
    20, 25, 30, 35, 45, 60, 75, 88, 95, 92, 80, 65, 55, 48, 42,
    40, 38, 40, 42, 42, 45, 48, 50, 48, 45, 42, 40, 38, 36, 36,
  ];
  const formChip = tsb > 10 ? '▲ FRESH' : tsb > 0 ? 'NEUTRAL' : tsb > -20 ? 'BUILDING' : 'OVERLOAD';
  const verdictLabel = tsb > 10 ? 'RACE READY' : tsb > 0 ? 'HOLDING' : 'BUILDING';

  return {
    fitnessCtl: ctl,
    fatigueAtl: atl,
    formTsb: tsb,
    series30d,
    peakWindowLabel: 'PEAKED APR 13–19 · 142 MI',
    verdictLabel,
    formChip,
    source: 'stub',
  };
}

// ─────────────────────────────────────────────────────────────────────
// NEW research-grounded stubs. Every helper below has a marked
// Stage 7 Coach method TODO. Numbers are deliberately mockup-faithful
// so QA renders meaningfully until the engine lands.
// ─────────────────────────────────────────────────────────────────────

/** Profile stub. Sex defaults to 'male' so Row 5 is off by default;
 *  toggle to 'female' here to QA the cycle + ferritin row. */
function stubProfile(): HealthApiProfile {
  // TODO: wire to coach.profile() (Stage 7) / users table.
  // RESEARCH: Research/13 §1, §8 — sex-specific rendering.
  return {
    sex: 'male', // flip to 'female' to render Row 5 in QA.
    ageBandLabel: 'M 38',
  };
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
  // TODO: wire to coach.hrvDetail() (Stage 7).
  // RESEARCH: Research/15 §HRV Plews approach — CV (coefficient of
  // variation) is the first-line destabilization signal; rises before
  // the rolling mean drops.
  const series = hrv.series30d ?? hrv.series7d;
  const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, series.length);
  const variance =
    series.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, series.length);
  const cv = mean > 0 ? Math.round((Math.sqrt(variance) / mean) * 100 * 10) / 10 : 0;

  // Plews-method bucket: stable if CV < 8%, drifting 8-12%, crashed >12%
  // OR if current dropped more than 1 SD below baseline.
  let plewsVerdict: HealthApiHrvDetail['plewsVerdict'] = 'stable';
  if (cv > 12) plewsVerdict = 'crashed';
  else if (cv > 8 || hrv.current < hrv.baseline - Math.sqrt(variance)) plewsVerdict = 'drifting';

  const plewsLabel = plewsVerdict === 'stable' ? 'STABLE' : plewsVerdict === 'drifting' ? 'DRIFTING' : 'CRASHED';
  const trend = hrv.current - hrv.baseline;
  const trendDirection = `${trend >= 0 ? '▲ +' : '▼ −'}${Math.abs(Math.round(trend))} VS BASE`;

  return {
    current: hrv.current,
    baseline: hrv.baseline,
    cv,
    plewsVerdict,
    plewsLabel,
    trendDirection,
    series30d: series,
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
    citation: '/Research/00a §CTL/ATL/TSB · Banister model',
    source: 'stub',
  };
}

/** Illness-early-warning composite stub. Combines 5 markers per
 *  /Research/15 §Spotting Illness Early. */
function stubIllnessComposite(): HealthApiIllnessComposite {
  // TODO: wire to coach.illnessComposite() (Stage 7).
  // RESEARCH: /Research/15 §Spotting Illness Early — when 3+
  // markers go off simultaneously, illness is likely within 48-72h.
  const markers: HealthApiIllnessMarker[] = [
    {
      id: 'rhr',
      label: 'RHR',
      current: 42,
      baseline: 43,
      series4d: [43, 42, 42, 42],
      warningTriggered: false,
      deltaLabel: '−1 BPM',
      warningDirection: 'up',
      unit: 'bpm',
    },
    {
      id: 'hrv',
      label: 'HRV',
      current: 68,
      baseline: 64,
      series4d: [62, 65, 67, 68],
      warningTriggered: false,
      deltaLabel: '+4 MS',
      warningDirection: 'down',
      unit: 'ms',
    },
    {
      id: 'sleepEff',
      label: 'SLEEP EFFICIENCY',
      current: 92,
      baseline: 91,
      series4d: [90, 91, 92, 92],
      warningTriggered: false,
      deltaLabel: '+1%',
      warningDirection: 'down',
      unit: '%',
    },
    {
      id: 'bodyTemp',
      label: 'BODY TEMP',
      current: 98.4,
      baseline: 98.3,
      series4d: [98.3, 98.4, 98.4, 98.4],
      warningTriggered: false,
      deltaLabel: '+0.1°F',
      warningDirection: 'up',
      unit: '°F',
    },
    {
      id: 'respRate',
      label: 'RESP RATE',
      current: 14,
      baseline: 14.2,
      series4d: [14.2, 14.0, 14.1, 14.0],
      warningTriggered: false,
      deltaLabel: '−0.2',
      warningDirection: 'up',
      unit: '/min',
    },
  ];
  const markersFiring = markers.filter((m) => m.warningTriggered).length;
  let compositeVerdict: HealthApiIllnessComposite['compositeVerdict'] = 'allClear';
  if (markersFiring >= 4) compositeVerdict = 'stopRest';
  else if (markersFiring >= 3) compositeVerdict = 'risk';
  else if (markersFiring >= 1) compositeVerdict = 'oneDrift';

  const verdictLabel =
    compositeVerdict === 'allClear' ? 'ALL CLEAR'
    : compositeVerdict === 'oneDrift' ? `${markersFiring} SIGNAL DRIFTING`
    : compositeVerdict === 'risk' ? 'ILLNESS RISK ELEVATED'
    : 'STOP — REST';

  return {
    markers,
    markersFiring,
    compositeVerdict,
    verdictLabel,
    citation: '/Research/15 §Spotting Illness Early',
    source: 'stub',
  };
}

/** Body-mass trend stub. Flags 2%+ drop in 14d per 00b. */
function stubBodyMass(): HealthApiBodyMass {
  // TODO: wire to coach.bodyMassTrend() (Stage 7) / HealthKit weight.
  // RESEARCH: /Research/00b §Quantitative Signals — sustained drop
  // >2% over 14 days = stress signal.
  const series28d = [
    169.4, 169.6, 169.2, 169.0, 168.9, 169.1, 168.8, 168.6, 168.5, 168.7,
    168.4, 168.2, 168.3, 168.0, 167.9, 168.1, 167.8, 167.6, 167.4, 167.5,
    167.3, 167.1, 167.2, 166.9, 167.0, 166.8, 166.7, 166.8,
  ];
  const current = series28d[series28d.length - 1];
  const baseline28d = series28d.reduce((a, b) => a + b, 0) / series28d.length;
  const valueAt14dAgo = series28d[series28d.length - 14];
  const delta14dPct = ((current - valueAt14dAgo) / valueAt14dAgo) * 100;
  const warningTriggered = delta14dPct < -2.0;

  return {
    current: Math.round(current * 10) / 10,
    baseline28d: Math.round(baseline28d * 10) / 10,
    delta14dPct: Math.round(delta14dPct * 10) / 10,
    warningTriggered,
    series28d,
    unit: 'lb',
    citation: '/Research/00b §Quantitative Signals',
    source: 'stub',
  };
}

/** Submax HR drift stub — earliest reliable overtraining marker. */
function stubSubmaxHrDrift(): HealthApiSubmaxHrDrift {
  // TODO: wire to coach.submaxHrDrift() (Stage 7) — derives HR at
  // fixed easy pace from Strava activity HR streams.
  // RESEARCH: /Research/15 §Spotting Overtraining Early §4 — "HR
  // for a given easy pace creeps up 3–8 bpm."
  const series8w = [138, 137, 138, 139, 138, 139, 140, 141];
  const current = series8w[series8w.length - 1];
  const baseline = 138;
  const driftBpm = current - baseline;

  let verdict: HealthApiSubmaxHrDrift['verdict'] = 'stable';
  if (driftBpm >= 8) verdict = 'crashed';
  else if (driftBpm >= 5) verdict = 'drifting';
  else if (driftBpm >= 3) verdict = 'creeping';

  const verdictLabel =
    verdict === 'stable' ? '● STABLE'
    : verdict === 'creeping' ? '▲ CREEPING'
    : verdict === 'drifting' ? '▲ DRIFTING'
    : '▲ CRASHED';

  return {
    current,
    baseline,
    driftBpm,
    series8w,
    verdict,
    verdictLabel,
    citation: '/Research/15 §Spotting Overtraining Early §4',
    source: 'stub',
  };
}

/** Cycle stub — only renders for female users. */
function stubCycle(): HealthApiCycle {
  // TODO: wire to coach.cyclePhase() (Stage 7) + cycle-log table.
  // RESEARCH: /Research/13 §1 Menstrual Cycle — phase-aware load.
  return {
    phase: 'follicular',
    phaseLabel: 'FOLLICULAR',
    daysIntoPhase: 4,
    loadAdjustmentRec: 'Build window — quality days well-tolerated.',
    citation: '/Research/13 §1 Menstrual Cycle',
  };
}

/** Ferritin stub — only renders for female users. */
function stubFerritin(): HealthApiFerritin {
  // TODO: wire to coach.ferritinLevel() (Stage 7) + lab-result table.
  // RESEARCH: /Research/13 §8 Iron Deficiency — threshold <30 ng/mL.
  return {
    currentNgPerMl: 38,
    trend: 'stable',
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
