/**
 * /health · data wiring layer.
 *
 * Mirrors /races/data.ts. Every value rendered on the Health page
 * resolves to one of the helpers in this module. Real sources are
 * wired where they exist; HealthKit-blocked streams (HRV, sleep,
 * body temp, respiratory rate, VO2max) are stubs from /api/health
 * that match the locked May 9 mockup for local-dev QA.
 *
 * The shape is stable — when HealthKit ingestion lands in M2 only
 * the bodies of the helpers change.
 */

import type { BodySystemsReport, CoachDecision } from '@/coach/types';
import type { CoachState } from '@/lib/coach-state';
import type { NormalizedActivity } from '@/lib/strava-activities';
import { onlyRuns } from '@/lib/strava-activities';
import type {
  HealthApiBodyTemp,
  HealthApiHrZoneTime,
  HealthApiMoodCheckin,
  HealthApiReadinessComposite,
  HealthApiSleep,
  HealthApiTrainingStress,
  HealthApiVo2Max,
  HealthBioStub,
  // NEW research-grounded shapes (rebuilt Health page)
  HealthApiExpandedCheckin,
  HealthApiSubjectiveAgreement,
  HealthApiHrvDetail,
  HealthApiFormReport,
  HealthApiIllnessComposite,
  HealthApiBodyMass,
  HealthApiSubmaxHrDrift,
  HealthApiCycle,
  HealthApiFerritin,
  HealthApiProfile,
} from '../api/health/route';

// ─────────────────────────────────────────────────────────────────────
// Re-export NEW research-grounded shapes so /health/page.tsx and any
// future consumers can pull from one module. The wire format is owned
// by /api/health/route.ts — data.ts only flattens and forwards.
// ─────────────────────────────────────────────────────────────────────

export type {
  HealthApiExpandedCheckin as ExpandedCheckin,
  HealthApiSubjectiveAgreement as SubjectiveAgreement,
  HealthApiHrvDetail as HrvDetail,
  HealthApiFormReport as FormReport,
  HealthApiIllnessComposite as IllnessComposite,
  HealthApiIllnessMarker as IllnessMarker,
  HealthApiBodyMass as BodyMass,
  HealthApiSubmaxHrDrift as SubmaxHrDrift,
  HealthApiCycle as Cycle,
  HealthApiFerritin as Ferritin,
  HealthApiProfile as Profile,
} from '../api/health/route';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface HealthData {
  /** ISO "today" — locked once per load. */
  today: string;
  /** Coach engine state (read-only by the UI). */
  state: CoachState;
  /** Headline composite + 5 signals. Real (assessReadiness). */
  readiness: HealthApiReadinessComposite;
  /** Body-systems report — the centerpiece. Real (bodySystems stub). */
  bodySystems: CoachDecision<BodySystemsReport>;
  /** Today's prescription summary (for "stressor vs rest" framing). */
  prescription: {
    label: string;
    isQuality: boolean;
    isLong: boolean;
    phaseLabel: string;
    paceLow: number | null;
    paceHigh: number | null;
  } | null;
  /** Biometric streams. All currently HealthKit-stubbed. */
  hrv: HealthBioStub;
  rhr: HealthBioStub;
  sleep: HealthApiSleep;
  vo2max: HealthApiVo2Max;
  respiratoryRate: HealthBioStub;
  bodyTemp: HealthApiBodyTemp;
  /** 14-day HR zone rollup. Synthesized today; wire to Strava streams. */
  hrZones: HealthApiHrZoneTime;
  /** Training stress (CTL/ATL/TSB). Stubbed; wire to Coach.formScore. */
  trainingStress: HealthApiTrainingStress;
  /** Daily mood check-in. Empty when not logged. */
  moodCheckin: HealthApiMoodCheckin;
  /** Strava activities for context (may be null). */
  activities: NormalizedActivity[] | null;
  runs: NormalizedActivity[] | null;
  /** Greet eyebrow string (top of page). */
  greetEyebrow: string;
  /** Greet sub-lede (body sentence beneath the H1). */
  greetSub: string;
  /** Days post most-recent A-race (for "DAY N POST-X" labels). */
  daysSincePeakStress: number;

  // ── NEW research-grounded shapes (rebuilt Health page) ───────────
  // Each maps 1:1 to a Coach method that needs to land in Stage 7.
  /** Expanded daily check-in (energy/soreness/stress sliders). */
  expandedCheckin: HealthApiExpandedCheckin;
  /** Subjective-vs-wearable agreement chip. */
  subjectiveAgreement: HealthApiSubjectiveAgreement;
  /** HRV deep card — CV + Plews verdict + 30d series. */
  hrvDetail: HealthApiHrvDetail;
  /** Form / CTL · ATL · TSB with operating band. */
  formReport: HealthApiFormReport;
  /** Illness-early-warning composite (5 markers). */
  illnessComposite: HealthApiIllnessComposite;
  /** Body-mass trend. */
  bodyMass: HealthApiBodyMass;
  /** Submax HR drift (earliest overtraining marker). */
  submaxHrDrift: HealthApiSubmaxHrDrift;
  /** Cycle phase — null when profile.sex !== 'female'. */
  cycle: HealthApiCycle | null;
  /** Ferritin status — null when profile.sex !== 'female'. */
  ferritin: HealthApiFerritin | null;
  /** Profile snapshot — drives Row 5 rendering. */
  profile: HealthApiProfile;
}

// ─────────────────────────────────────────────────────────────────────
// API payload
// ─────────────────────────────────────────────────────────────────────

interface HealthApiOk {
  ok: true;
  today: string;
  state: CoachState;
  bodySystems: CoachDecision<BodySystemsReport>;
  readiness: HealthApiReadinessComposite;
  prescription: HealthData['prescription'];
  hrv: HealthBioStub;
  rhr: HealthBioStub;
  sleep: HealthApiSleep;
  vo2max: HealthApiVo2Max;
  respiratoryRate: HealthBioStub;
  bodyTemp: HealthApiBodyTemp;
  hrZones: HealthApiHrZoneTime;
  trainingStress: HealthApiTrainingStress;
  moodCheckin: HealthApiMoodCheckin;
  // NEW research-grounded shapes
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

type HealthApiPayload = HealthApiOk | HealthApiErr;

// ─────────────────────────────────────────────────────────────────────
// Single load entry point
// ─────────────────────────────────────────────────────────────────────

export async function loadHealthData(
  activities: NormalizedActivity[] | null,
): Promise<HealthData> {
  const api = await fetchHealthApi();
  if (!api.ok) {
    throw new Error(api.error || 'health api not ok');
  }

  const runs = activities ? onlyRuns(activities) : null;
  const { greetEyebrow, greetSub, daysSincePeakStress } = synthesizeGreetCopy(api);

  return {
    today: api.today,
    state: api.state,
    readiness: api.readiness,
    bodySystems: api.bodySystems,
    prescription: api.prescription,
    hrv: api.hrv,
    rhr: api.rhr,
    sleep: api.sleep,
    vo2max: api.vo2max,
    respiratoryRate: api.respiratoryRate,
    bodyTemp: api.bodyTemp,
    hrZones: api.hrZones,
    trainingStress: api.trainingStress,
    moodCheckin: api.moodCheckin,
    activities,
    runs,
    greetEyebrow,
    greetSub,
    daysSincePeakStress,
    expandedCheckin: api.expandedCheckin,
    subjectiveAgreement: api.subjectiveAgreement,
    hrvDetail: api.hrvDetail,
    formReport: api.formReport,
    illnessComposite: api.illnessComposite,
    bodyMass: api.bodyMass,
    submaxHrDrift: api.submaxHrDrift,
    cycle: api.cycle,
    ferritin: api.ferritin,
    profile: api.profile,
  };
}

async function fetchHealthApi(): Promise<HealthApiPayload> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/health ${res.status}`);
    return (await res.json()) as HealthApiPayload;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Greet copy synthesis. Pulls from the readiness pin + bodySystems
// rationale so the H1 / sub-lede always reflect the data on the page.
// ─────────────────────────────────────────────────────────────────────

function synthesizeGreetCopy(api: HealthApiOk): {
  greetEyebrow: string;
  greetSub: string;
  daysSincePeakStress: number;
} {
  const score = api.readiness.score;
  const headline = api.readiness.headlineLabel;
  const recentRace = api.state.races.recent[0] ?? null;
  const daysSincePeakStress = api.bodySystems.answer.daysSincePeakStress;
  const daysLogged = api.state.recovery.consecutiveRunDays;

  const eyebrowParts: string[] = [`RECOVERY ${score}`, headline];
  if (daysLogged > 0) eyebrowParts.push(`${daysLogged} DAYS LOGGED`);
  const greetEyebrow = eyebrowParts.join(' · ');

  // Sub-lede: lean on the bodySystems rationale for the headline message
  // (it already speaks in Coach voice). Fall back to a generic line if
  // no recent race.
  const qualityReturnsLabel = formatShortDate(api.bodySystems.answer.qualityReturnsISO);
  const slowestBuilding = api.bodySystems.answer.systems
    .filter((s) => s.state === 'building')
    .sort((a, b) => b.daysToHealed - a.daysToHealed)[0];
  let greetSub: string;
  if (recentRace && slowestBuilding) {
    greetSub = `All vitals trending positive. ${slowestBuilding.label} still rebuilding from ${recentRace.name} — quality returns ~ ${qualityReturnsLabel}.`;
  } else if (recentRace) {
    greetSub = `All vitals trending positive. ${recentRace.name} fully absorbed — back to base building.`;
  } else {
    greetSub = `All vitals trending positive. No recent race — body in steady state.`;
  }

  return { greetEyebrow, greetSub, daysSincePeakStress };
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatShortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** Format minutes as "Xh" or "Xm" depending on size. */
export function formatZoneTime(minutes: number): { value: string; unit: string } {
  if (minutes >= 60) {
    const hrs = Math.round((minutes / 60) * 10) / 10;
    return { value: Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1), unit: 'h' };
  }
  return { value: String(Math.round(minutes)), unit: 'm' };
}

/** Convert decimal hours (7.7) to "H:MM" display ("7:42"). */
export function formatHoursToHMM(decimalHrs: number): string {
  const h = Math.floor(decimalHrs);
  const m = Math.round((decimalHrs - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Topbar clock formatter — DOW · MON D · H:MM AM/PM. */
export function formatTopbarClock(d: Date): string {
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const hh = d.getHours();
  const mm = d.getMinutes();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${dows[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}
