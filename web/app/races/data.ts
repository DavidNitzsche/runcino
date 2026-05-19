/**
 * /races · data wiring layer.
 *
 * Mirrors /overview/data.ts and /training/data.ts. Every value rendered
 * on the Races page resolves to one of the functions in this module.
 *
 * Real sources are wired where they exist (race calendar from Postgres
 * via /api/races, Coach predictions via /api/races-page, Strava cache
 * for results). Stubs are clearly marked with `// TODO: wire to <source>`.
 * The shapes are stable — when the real engine ships, only the bodies
 * of each helper change.
 */

import type {
  CoachDecision,
  RaceFitnessPrediction,
  BodySystemsReport,
  Trajectory14wk,
} from '@/coach/types';
import type { CoachState } from '@/lib/coach-state';
import type { NormalizedActivity } from '@/lib/strava-activities';
import { onlyRuns } from '@/lib/strava-activities';
import type { SavedRace, ActualResult } from '@/lib/storage-types';
import { daysUntil } from '@/lib/dates';
import { vdotSnapshot } from '@/lib/vdot';
import type { RacesApiRacePrediction, RacesApiTaperReport } from '../api/races-page/route';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface RacesData {
  /** ISO "today". Locked once per load. */
  today: string;
  /** Profile snapshot — name + greeting tone. Identical to other pages. */
  profile: ProfileSnapshot;
  /** Coach engine state (read-only by the UI). */
  state: CoachState;
  /** All saved races, sorted upcoming-first then past-by-recency. */
  races: {
    all: SavedRace[];
    upcoming: SavedRace[];
    past: SavedRace[];
    nextA: SavedRace | null;
    nextB: SavedRace | null;
    daysToNextA: number | null;
    daysToNextB: number | null;
  };
  /** Coach predictions per upcoming race, keyed by slug for O(1) lookup. */
  predictions: Map<string, RacesApiRacePrediction>;
  /** Taper depths per imminent race, keyed by slug. */
  tapers: Map<string, RacesApiTaperReport>;
  /** Body-systems report — only present when A race is ≤14 days. */
  bodySystems: CoachDecision<BodySystemsReport> | null;
  /** 14-week trajectory for the phase backbone. */
  trajectory: CoachDecision<Trajectory14wk>;
  /** A-race hero snapshot (goal · fitness · headroom · build-starts). */
  aRaceHero: ARaceHero | null;
  /** Most recent past A-race for the recap card (right column of row 1). */
  latestRecap: LatestRecap | null;
  /** Year-scaled season timeline rows. */
  season: SeasonTimeline;
  /** Strava activities for context (may be null). */
  activities: NormalizedActivity[] | null;
  runs: NormalizedActivity[] | null;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-types
// ─────────────────────────────────────────────────────────────────────

export interface ProfileSnapshot {
  name: string;
  greeting: string;
}

export interface ARaceHero {
  slug: string;
  /** Race name in mixed-case (display). */
  name: string;
  /** ISO date. */
  dateISO: string;
  /** Days until race. */
  daysToRace: number;
  /** Distance label, e.g. "13.1 MI" or "MARATHON". */
  distanceLabel: string;
  /** Race location (free-form, may be empty). */
  location: string;
  /** Long display date (e.g. "SUNDAY · AUG 16, 2026 · SAN DIEGO · 13.1 MI"). */
  longDateLine: string;
  /** Goal time display, e.g. "1:35:00". */
  goalTime: string;
  /** Goal pace, e.g. "7:15/MI". */
  goalPace: string;
  /** Predicted finish display, e.g. "1:32:00". */
  fitnessPredicts: string;
  /** Predicted pace, e.g. "7:00/MI". */
  fitnessPace: string;
  /** VDOT label (e.g. "VDOT 50.4"). null when no usable race result yet
   *  — the UI renders "NO VDOT YET" rather than a hardcoded number. */
  vdotLabel: string | null;
  /** Headroom s/mi; positive = on track. */
  headroomSPerMi: number;
  /** Confidence label ("HIGH" / "MED" / "LOW"). */
  confidenceLabel: string;
  /** Days until build phase opens (= 0 if already in build). */
  buildStartsInDays: number;
  /** ISO date the build phase opens. */
  buildStartsDateLabel: string;
  /** B-race "up next" inset, or null if no nearer B exists. */
  upNext: UpNextInset | null;
}

export interface UpNextInset {
  slug: string;
  name: string;
  /** Days until B-race. */
  daysToRace: number;
  /** Short date (e.g. "JUN 22"). */
  shortDate: string;
  /** Tune-up label (e.g. "TUNE-UP"). */
  tuneupTag: string;
}

export interface LatestRecap {
  slug: string;
  name: string;
  /** Days since the race finished. */
  daysAgo: number;
  /** Short date (e.g. "APR 27"). */
  shortDate: string;
  /** Distance + terrain label (e.g. "MARATHON · HILLY · 4.2K FT GAIN"). */
  distanceLabel: string;
  finishDisplay: string;
  /** Pace display "/mi" suffix already stripped. */
  paceDisplay: string;
  /** PR label (e.g. "LIFETIME PR · −5:29") or "FINISHED" if not a PR. */
  prLabel: string;
  isPR: boolean;
  /** Split direction ("NEGATIVE SPLIT · −0:12" or "POSITIVE SPLIT · +0:08" or null). */
  splitLabel: string | null;
  splitNegative: boolean | null;
  /** Coach read text. Stub for now. */
  coachRead: string;
  /** Place text (e.g. "247/3.2k") — null when unknown. */
  place: string | null;
  /** Place sub (e.g. "TOP 8% · AG #23"). */
  placeSub: string | null;
  /** Conditions tile, or null if no weather captured. */
  conditions: { value: string; unit: string; sub: string } | null;
  /** AvgHR tile, or null if not captured. */
  avgHr: { value: number; pctMax: number; zone: string } | null;
  /** Verdict pin label ("PR" / "FINISHED" / "DNF" / null). */
  pinLabel: string | null;
  pinVariant: 'green' | 'amber' | 'warn' | 'race' | 'muted';
}

export interface SeasonTimeline {
  /** Calendar year being shown (current year). */
  year: number;
  /** Race markers along the timeline (positioned by day-of-year %). */
  markers: SeasonMarker[];
  /** Today position as a percent (0–100) along the year axis. */
  todayPct: number;
  /** Today short label (e.g. "MAY 9"). */
  todayShort: string;
  /** Summary tags row at top-right of the card. */
  summary: {
    countA: number;
    countB: number;
    countC: number;
    countRun: number;
    countAhead: number;
  };
}

export interface SeasonMarker {
  slug: string;
  name: string;
  /** Position percent along the year axis (0–100). */
  pct: number;
  /** Short date (e.g. "AUG 16"). */
  shortDate: string;
  /** Detail caption (e.g. "GOAL 1:35:00", "1:32:00", "BACKUP A"). */
  caption: string;
  /** Priority A/B/C. */
  priority: 'A' | 'B' | 'C';
  /** Tone — drives color + dot shape. */
  tone: 'pr' | 'past' | 'upcoming-a' | 'upcoming-b' | 'upcoming-c' | 'today';
  /** Was this a PR? */
  isPR: boolean;
  /** Has the race already happened? */
  inPast: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// API payload
// ─────────────────────────────────────────────────────────────────────

interface RacesApiOk {
  ok: true;
  today: string;
  state: CoachState;
  races: SavedRace[];
  predictions: RacesApiRacePrediction[];
  tapers: RacesApiTaperReport[];
  bodySystems: CoachDecision<BodySystemsReport> | null;
  trajectory: CoachDecision<Trajectory14wk>;
  /** Runner display name from `profile.full_name`. null when no profile
   *  row exists — UI renders "Runner". */
  profileName: string | null;
}

interface RacesApiErr {
  ok: false;
  error: string;
}

type RacesApiPayload = RacesApiOk | RacesApiErr;

// ─────────────────────────────────────────────────────────────────────
// Single load entry point
// ─────────────────────────────────────────────────────────────────────

export async function loadRacesData(
  activities: NormalizedActivity[] | null,
): Promise<RacesData> {
  const api = await fetchRacesApi();
  if (!api.ok) {
    throw new Error(api.error || 'races api not ok');
  }

  const today = api.today;
  const all = api.races;

  const upcoming = all
    .filter((r) => r.meta.date >= today)
    .sort((a, b) => a.meta.date.localeCompare(b.meta.date));
  const past = all
    .filter((r) => r.meta.date < today)
    .sort((a, b) => b.meta.date.localeCompare(a.meta.date));

  const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;
  const nextB = upcoming.find((r) => r.meta.priority === 'B') ?? null;
  const daysToNextA = nextA ? daysUntil(nextA.meta.date) : null;
  const daysToNextB = nextB ? daysUntil(nextB.meta.date) : null;

  const predictions = new Map<string, RacesApiRacePrediction>();
  for (const p of api.predictions) predictions.set(p.slug, p);

  const tapers = new Map<string, RacesApiTaperReport>();
  for (const t of api.tapers) tapers.set(t.slug, t);

  const runs = activities ? onlyRuns(activities) : null;

  const profile = getProfileSnapshot(today, api.profileName ?? null);
  const aRaceHero = getARaceHero(nextA, nextB, predictions, api.state, today);
  const latestRecap = getLatestRecap(past);
  const season = getSeasonTimeline(all, today);

  return {
    today,
    profile,
    state: api.state,
    races: { all, upcoming, past, nextA, nextB, daysToNextA, daysToNextB },
    predictions,
    tapers,
    bodySystems: api.bodySystems,
    trajectory: api.trajectory,
    aRaceHero,
    latestRecap,
    season,
    activities,
    runs,
  };
}

async function fetchRacesApi(): Promise<RacesApiPayload> {
  try {
    const res = await fetch('/api/races-page', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/races-page ${res.status}`);
    return (await res.json()) as RacesApiPayload;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────

function getProfileSnapshot(today: string, profileName: string | null): ProfileSnapshot {
  // Pulled from /api/races-page → getProfile() (web/lib/profile-store.ts).
  // Falls back to "Runner" when the profile row is missing or `full_name`
  // is blank. No hardcoded identity.
  const hour = new Date(today + 'T12:00:00').getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return {
    name: profileName ?? 'Runner',
    greeting,
  };
}

// ─────────────────────────────────────────────────────────────────────
// A-RACE hero — pulls from Coach.raceFitnessPrediction
// ─────────────────────────────────────────────────────────────────────

function getARaceHero(
  nextA: SavedRace | null,
  nextB: SavedRace | null,
  predictions: Map<string, RacesApiRacePrediction>,
  state: CoachState,
  today: string,
): ARaceHero | null {
  if (!nextA) return null;

  const daysToRace = daysUntil(nextA.meta.date);
  const predEntry = predictions.get(nextA.slug);
  const pred = predEntry?.prediction.answer ?? null;

  const distanceLabel = distanceLabelFor(nextA.meta.distanceMi);
  // TODO: wire to a location field on SavedRace.meta (doesn't exist
  // today — names like "Sombrero Half" don't carry city/state). For now
  // we slot the distance label only and let the runner read context from
  // the race name itself.
  const longDateLine = formatLongDateLine(nextA.meta.date, distanceLabel);

  // Goal vs fitness comes from Coach.raceFitnessPrediction. The
  // /api/races-page route already filtered out races with malformed
  // goalDisplay — but the prediction may still be missing if the goal
  // failed to parse. Fall back to goal-only rendering.
  const goalTime = pred?.goalDisplay ?? nextA.meta.goalDisplay;
  const goalPaceS = pred?.goalPaceSPerMi ?? null;
  const fitnessTime = pred?.predictedDisplay ?? '—';
  const fitnessPace = pred?.predictedPaceSPerMi ?? null;
  const headroom = pred?.headroomSPerMi ?? 0;

  // VDOT — prefer the prediction's own VDOT (race-specific), else fall
  // back to the dashboard snapshot (strongest recent race ≤ half). null
  // when no usable race result is logged — UI renders "NO VDOT YET"
  // rather than a hardcoded number.
  const snap = vdotSnapshot(state);
  const vdot = pred?.vdot ?? snap?.vdot ?? null;
  const vdotLabel = vdot != null ? `VDOT ${vdot.toFixed(1)}` : null;
  const confidence = pred?.confidence ?? 'medium';

  // Build window — base phase typically opens 14 days after a recovery
  // window from the most recent race. TODO: wire to Coach.trajectory14wk
  // phase boundaries (Stage 7 — plan-templates engine consumer). For now
  // we surface an approximation: 14 days from today if the runner is in
  // recovery, else 0.
  const buildStartsInDays = computeBuildStartsInDays(today);
  const buildStartsDateLabel = formatShortDateOffset(today, buildStartsInDays);

  // B-race up-next inset.
  const upNext = getUpNextInset(nextB, daysToRace);

  return {
    slug: nextA.slug,
    name: nextA.meta.name,
    dateISO: nextA.meta.date,
    daysToRace,
    distanceLabel,
    location: '',
    longDateLine,
    goalTime,
    goalPace: goalPaceS != null ? `${fmtPace(goalPaceS)}/MI` : '—',
    fitnessPredicts: fitnessTime,
    fitnessPace: fitnessPace != null ? `${fmtPace(fitnessPace)}/MI` : '—',
    vdotLabel,
    headroomSPerMi: headroom,
    confidenceLabel: confidence.toUpperCase(),
    buildStartsInDays,
    buildStartsDateLabel,
    upNext,
  };
}

function getUpNextInset(
  nextB: SavedRace | null,
  daysToA: number,
): UpNextInset | null {
  if (!nextB) return null;
  const daysToB = daysUntil(nextB.meta.date);
  // Only show the inset if B is sooner than A. If they're in the same
  // direction the runner needs to see B first.
  if (daysToB < 0 || daysToB >= daysToA) return null;
  return {
    slug: nextB.slug,
    name: nextB.meta.name,
    daysToRace: daysToB,
    shortDate: formatShortDate(nextB.meta.date),
    // TODO: wire to race_week.ts B-race classification — for now we
    // default to "TUNE-UP". Once Stage 7 lands the Coach will classify
    // B-races as TUNE-UP / FITNESS CHECK / OPENER based on phase position.
    tuneupTag: 'TUNE-UP',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Latest recap — most recent past race with actualResult
// ─────────────────────────────────────────────────────────────────────

function getLatestRecap(past: SavedRace[]): LatestRecap | null {
  // Prefer the most recent past race that has an actualResult; fall
  // back to the most recent past race even without one so the recap
  // card always renders something for a runner who's just raced.
  const withResult = past.find((r) => r.actualResult);
  const target = withResult ?? past[0] ?? null;
  if (!target) return null;

  const result: ActualResult | null = target.actualResult ?? null;
  const daysAgo = Math.abs(daysUntil(target.meta.date));
  const shortDate = formatShortDate(target.meta.date);
  const distanceLabel = distanceLabelFor(target.meta.distanceMi);
  const distanceFull = formatRecapDistance(target);

  const finishDisplay = result?.finishDisplay ?? '—:—:—';
  const paceDisplay = result?.paceDisplay ?? '—';
  const isPR = !!result?.isPR;

  const goalS = parseGoalS(target.meta.goalDisplay);
  const delta = result && goalS != null ? result.finishS - goalS : null;

  let prLabel = 'FINISHED';
  if (isPR) {
    prLabel = delta != null && delta < 0
      ? `LIFETIME PR · ${fmtDelta(delta)}`
      : 'LIFETIME PR';
  } else if (delta != null) {
    prLabel = delta < 0 ? `BEAT GOAL · ${fmtDelta(delta)}` : `MISSED GOAL · ${fmtDelta(delta)}`;
  }

  // Split direction — derive from per-mile splits when available.
  const splitInfo = computeSplitDelta(result);

  // Place — from bestEfforts is not the same shape. We don't have a
  // structured place field. TODO: wire to a `place` column on
  // actualResult (does NOT exist today). Surface null so the UI can
  // hide the tile rather than show fake data.
  const place: string | null = null;
  const placeSub: string | null = null;

  const avgHr = result?.avgHr != null
    ? {
        value: Math.round(result.avgHr),
        // TODO: wire to profile.maxHr — pulled from coach-state heartrate doctrine.
        // 187 is the value used elsewhere in this codebase (Training page); keep
        // consistent until the profile model surfaces a real number.
        pctMax: Math.round((result.avgHr / 187) * 100),
        zone: hrZoneLabel(result.avgHr, 187),
      }
    : null;

  // Conditions — no weather field on ActualResult yet. TODO: wire to
  // /api/weather + race-day capture (Stage 5 fueling/weather pull
  // doesn't currently store result-time conditions). Surface null.
  const conditions: LatestRecap['conditions'] = null;

  // Coach read — Stage R Coach.coachRead is not implemented (throws).
  // Synthesize a short readout from the result + goal.
  const coachRead = synthesizeCoachRead(target, result, delta);

  // Pin
  let pinLabel: string | null = null;
  let pinVariant: LatestRecap['pinVariant'] = 'muted';
  if (result) {
    if (isPR) { pinLabel = 'PR'; pinVariant = 'green'; }
    else if (delta != null && delta < 0) { pinLabel = 'BEAT'; pinVariant = 'green'; }
    else if (delta != null && delta > 60) { pinLabel = 'MISSED'; pinVariant = 'warn'; }
    else { pinLabel = 'FINISHED'; pinVariant = 'amber'; }
  }

  return {
    slug: target.slug,
    name: target.meta.name,
    daysAgo,
    shortDate,
    distanceLabel: distanceFull || distanceLabel,
    finishDisplay,
    paceDisplay,
    prLabel,
    isPR,
    splitLabel: splitInfo?.label ?? null,
    splitNegative: splitInfo?.negative ?? null,
    coachRead,
    place,
    placeSub,
    conditions,
    avgHr,
    pinLabel,
    pinVariant,
  };
}

function synthesizeCoachRead(
  race: SavedRace,
  result: ActualResult | null,
  delta: number | null,
): string {
  // TODO: wire to Coach.coachRead() — Stage R "Retrospective loop"
  // pending. Until then we produce a 2-sentence readout from the data
  // we have (avg pace + PR-ness + headline name).
  if (!result) {
    return `${race.meta.name} logged but no result captured yet. Add finish time + splits to unlock the Coach Read.`;
  }
  const paceLine = `Sustained ${result.paceDisplay}/mi`;
  const surface = race.meta.distanceMi >= 24 ? ' on the full distance' : '';
  if (result.isPR && delta != null && delta < 0) {
    return `${paceLine}${surface} for a lifetime PR ${fmtDelta(delta)} under the goal. Aerobic engine confirmed — momentum carries forward.`;
  }
  if (delta != null && delta < 0) {
    return `${paceLine}${surface}, ${fmtDelta(delta)} faster than goal. Fitness landed where projected.`;
  }
  if (delta != null && delta > 0) {
    return `${paceLine}${surface}, ${fmtDelta(delta)} off the goal. Bank the effort and review pace strategy before the next A.`;
  }
  return `${paceLine}${surface}. Result recorded — fuller Coach Read when retrospective lands.`;
}

function computeSplitDelta(result: ActualResult | null): { label: string; negative: boolean } | null {
  if (!result?.miles || result.miles.length < 4) return null;
  const half = Math.floor(result.miles.length / 2);
  const firstHalf = result.miles.slice(0, half);
  const secondHalf = result.miles.slice(half);
  const avgFirst = firstHalf.reduce((s, m) => s + m.paceSPerMi, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, m) => s + m.paceSPerMi, 0) / secondHalf.length;
  const splitDelta = avgSecond - avgFirst; // positive = positive split (slower second)
  if (Math.abs(splitDelta) < 4) return null; // negligible
  const negative = splitDelta < 0;
  const mag = fmtDelta(Math.abs(splitDelta));
  return {
    label: negative ? `NEGATIVE SPLIT · ${mag}` : `POSITIVE SPLIT · ${mag}`,
    negative,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Season timeline — past + today + future on a year scale
// ─────────────────────────────────────────────────────────────────────

function getSeasonTimeline(all: SavedRace[], today: string): SeasonTimeline {
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const inYear = all.filter((r) => r.meta.date >= yearStart && r.meta.date <= yearEnd);
  const todayPct = dayOfYearPct(today, year);
  const todayShort = formatShortDate(today);

  // Find the PR-anchor race (the one that set/holds the current PR for
  // the runner's main distance). For now we pick the past A-race with
  // the fastest finish.
  const prSlug = pickPRAnchorSlug(inYear);

  const markers: SeasonMarker[] = inYear.map((r) => {
    const inPast = r.meta.date < today;
    // meta.priority expanded to 6 levels (A/B/C/tune-up/training-run/
    // hilly-excluded) for compute-vdot weighting; collapse to A/B/C
    // for the season-strip visual treatment. Non-A/B levels render
    // as C-tier dots since they're all "less than primary goal".
    const rawPriority = r.meta.priority ?? 'A';
    const priority: 'A' | 'B' | 'C' = rawPriority === 'A' ? 'A' : rawPriority === 'B' ? 'B' : 'C';
    const isPR = !!r.actualResult?.isPR || r.slug === prSlug;
    const pct = dayOfYearPct(r.meta.date, year);

    let tone: SeasonMarker['tone'];
    if (isPR && inPast) tone = 'pr';
    else if (inPast) tone = 'past';
    else if (priority === 'A') tone = 'upcoming-a';
    else if (priority === 'B') tone = 'upcoming-b';
    else tone = 'upcoming-c';

    let caption: string;
    if (inPast && r.actualResult) {
      caption = r.actualResult.finishDisplay;
    } else if (inPast) {
      caption = 'FINISHED';
    } else if (priority === 'A') {
      caption = `GOAL ${r.meta.goalDisplay}`;
    } else if (priority === 'B') {
      caption = `GOAL ${r.meta.goalDisplay}`;
    } else {
      caption = r.meta.goalDisplay;
    }

    return {
      slug: r.slug,
      name: r.meta.name,
      pct,
      shortDate: formatShortDate(r.meta.date),
      caption,
      priority,
      tone,
      isPR,
      inPast,
    };
  });

  // Sort markers left-to-right by date so positioning + label staggering
  // can be deterministic downstream.
  markers.sort((a, b) => a.pct - b.pct);

  const countA = inYear.filter((r) => (r.meta.priority ?? 'A') === 'A').length;
  const countB = inYear.filter((r) => r.meta.priority === 'B').length;
  const countC = inYear.filter((r) => r.meta.priority === 'C').length;
  const countRun = inYear.filter((r) => r.meta.date < today).length;
  const countAhead = inYear.filter((r) => r.meta.date >= today).length;

  return {
    year,
    markers,
    todayPct,
    todayShort,
    summary: { countA, countB, countC, countRun, countAhead },
  };
}

function pickPRAnchorSlug(races: SavedRace[]): string | null {
  // TODO: wire to lib/strava-stats.naivePRs once the Strava-derived
  // distance PR set surfaces alongside saved races. For now we mark the
  // races whose actualResult.isPR === true; that covers the canonical
  // case (Big Sur PR, Disney PR) without inventing a ranking.
  const prFinishers = races.filter((r) => r.meta.date < new Date().toISOString().slice(0, 10) && r.actualResult?.isPR);
  if (prFinishers.length === 0) return null;
  // If multiple, pick the one with the fastest pace.
  prFinishers.sort((a, b) => (a.actualResult!.paceSPerMi - b.actualResult!.paceSPerMi));
  return prFinishers[0].slug;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function fmtPace(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function fmtDelta(s: number): string {
  const sign = s < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(s));
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${sign}${mm}:${ss.toString().padStart(2, '0')}`;
}

function parseGoalS(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function distanceLabelFor(distanceMi: number): string {
  if (Math.abs(distanceMi - 3.1) < 0.15) return '5K';
  if (Math.abs(distanceMi - 6.2) < 0.2) return '10K';
  if (Math.abs(distanceMi - 13.1) < 0.2) return 'HALF';
  if (Math.abs(distanceMi - 26.2) < 0.3) return 'MARATHON';
  if (Math.abs(distanceMi - 31.1) < 0.5) return '50K';
  return `${distanceMi.toFixed(1)} MI`;
}

function formatRecapDistance(race: SavedRace): string {
  const dist = distanceLabelFor(race.meta.distanceMi);
  // Add terrain hint if total_gain_ft is significant.
  const gainFt = race.plan?.race?.total_gain_ft ?? 0;
  if (gainFt >= 2000) {
    return `${dist} · HILLY · ${(gainFt / 1000).toFixed(1)}K FT GAIN`;
  }
  if (gainFt >= 800) {
    return `${dist} · ROLLING · ${Math.round(gainFt)} FT GAIN`;
  }
  return dist;
}

export function formatShortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatLongDateLine(iso: string, distanceLabel: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return `${iso} · ${distanceLabel}`;
  const d = new Date(iso + 'T12:00:00Z');
  const dow = DAYS_OF_WEEK[d.getUTCDay()];
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  const year = Number(m[1]);
  return `${dow} · ${month} ${day}, ${year} · ${distanceLabel}`;
}

function formatShortDateOffset(todayISO: string, offsetDays: number): string {
  const d = new Date(todayISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function dayOfYearPct(iso: string, year: number): number {
  const start = Date.UTC(year, 0, 1);
  const d = Date.parse(iso + 'T12:00:00Z');
  if (!isFinite(d)) return 0;
  const yearMs = Date.UTC(year + 1, 0, 1) - start;
  return Math.max(0, Math.min(100, ((d - start) / yearMs) * 100));
}

function computeBuildStartsInDays(today: string): number {
  // TODO: wire to coach.trajectory14wk phase boundaries. The trajectory
  // already knows where BASE → BUILD transitions sit for the current
  // macrocycle. For now we approximate: 14 days after today.
  void today;
  return 14;
}

function hrZoneLabel(hr: number, hrMax: number): string {
  const pct = hr / hrMax;
  if (pct < 0.60) return 'Z1 EASY';
  if (pct < 0.70) return 'Z2 AEROBIC';
  if (pct < 0.80) return 'Z3 STEADY';
  if (pct < 0.90) return 'Z4 THRESHOLD';
  return 'Z5 VO2';
}
