/**
 * lib/coach/heat-gate.ts · the heat safety gate · Research/06 §§3, 11.
 *
 * HEAT-1 (2026-08-17). Research/06 carries three tables that decide
 * whether a session runs as written, runs as time-on-feet, or does not
 * run at all:
 *
 *   :141-148  WBGT flag table (ACSM + Korey Stringer Institute)
 *   :481-487  "When to convert to time-on-feet (drop pace targets)"
 *   :489-499  "Hard bail triggers (cancel/postpone)"
 *
 * None of them were in the code. The app priced heat into pace and
 * wrote a sentence about it; at WBGT 84°F — ACSM black flag, "Cancel
 * competitive racing. Easy only, early/late only." — the prescription
 * was unchanged and the runner got a note about hydration.
 *
 * This module is the doctrine, and only the doctrine: no thresholds
 * that are not in the research, no severity ladder of our own. It is
 * pure so the conformance test can assert the numbers directly.
 *
 * It PROPOSES. Per the locked no-reactive-coach rule the engine does
 * not silently rewrite a session; `proposeFirst` is true on every
 * non-normal verdict, mirroring how readiness_pullback hands the change
 * to the runner (lib/plan/adapt.ts PROPOSE_FIRST_TRIGGERS).
 */
// Imported from the shared model rather than from weather-adjust (which
// re-exports it) so this module has no dependency on the verdict engine —
// weather-adjust now reads the band taxonomy below.
import { estimateDewpointF } from '@/lib/training/heat-model';

export const CITATION_HEAT_GATE = {
  slug: 'research-06-weather-adjustments',
  label: 'Research/06 · Weather Adjustments §§3, 11',
};

/** ACSM / KSI flag · Research/06:141-148. */
export type HeatFlag = 'white' | 'green' | 'yellow' | 'red' | 'black' | 'unknown';

/**
 * What the gate asks of the session.
 *
 *   normal              · run it as written
 *   reduce_hard_volume  · yellow · trim hard-session volume 5-10% (:145)
 *   reduce_intensity    · red · cut intensity 10-20%, shorten quality (:146)
 *   easy_time_on_feet   · convert every hard session to easy time on feet,
 *                         drop pace targets (:147, :484)
 *   cancel              · do not run this session outdoors (:493-499)
 */
export type HeatGateAction =
  | 'normal'
  | 'reduce_hard_volume'
  | 'reduce_intensity'
  | 'easy_time_on_feet'
  | 'cancel';

export interface HeatGateInput {
  tairF: number | null | undefined;
  humidityPct?: number | null;
  /** 0-100. Drives the solar correction in the WBGT approximation. */
  cloudCoverPct?: number | null;
  /** Supply directly when known; otherwise derived from Tair + RH. */
  dewpointF?: number | null;
  /** Air Quality Index, when the surface has it · :487, :496. */
  aqi?: number | null;
}

export interface HeatGateVerdict {
  flag: HeatFlag;
  /** Approximated wet-bulb globe temperature, °F. Null when RH is unknown. */
  wbgtF: number | null;
  dewpointF: number | null;
  action: HeatGateAction;
  /** True when this verdict changes what the runner should do. */
  fires: boolean;
  /** Propose, never apply · the runner gates the change. */
  proposeFirst: boolean;
  /** Short coach-voice line. No exclamation, no hype. */
  headline: string;
  /** The rule that fired, with its research line. */
  citation: string;
}

// ─── Research/06:172 · heat acclimation dose ──────────────────────────
//
// "Heat dose: Tair >=85°F or WBGT >=75°F". The shipped code applied the
// WBGT number, 75, to AIR temperature, so an ordinary 75°F morning
// counted as acclimation stimulus and the runner was told they were
// adapting to heat they had never been in.
export const HEAT_DOSE_TAIR_F = 85;
export const HEAT_DOSE_WBGT_F = 75;

// ─── Research/06:141-148 · WBGT flag table, verbatim ──────────────────
export const WBGT_FLAGS: ReadonlyArray<{
  maxF: number;          // upper bound of the band, °F
  flag: HeatFlag;
  action: HeatGateAction;
  note: string;
}> = [
  { maxF: 50, flag: 'white',  action: 'normal',             note: 'Optimal. Normal training and racing.' },
  { maxF: 64, flag: 'green',  action: 'normal',             note: 'Low risk. Normal sessions.' },
  { maxF: 72, flag: 'yellow', action: 'reduce_hard_volume', note: 'Moderate risk. Reduce hard-session volume 5-10%.' },
  { maxF: 82, flag: 'red',    action: 'reduce_intensity',   note: 'High risk. Reduce intensity 10-20%, shorten quality.' },
  { maxF: 86, flag: 'black',  action: 'easy_time_on_feet',  note: 'Extreme risk. Cancel competitive racing. Easy only, early or late only.' },
  { maxF: Infinity, flag: 'black', action: 'cancel',        note: 'Cease outdoor sessions.' },
] as const;

// ─── Research/06:481-487 · convert to time-on-feet ────────────────────
/** Td >= this → quality goes time-based and RPE-driven (:483). */
export const TD_TIME_ON_FEET_F = 70;
/** WBGT >= this → all hard sessions convert to easy time-on-feet (:484). */
export const WBGT_TIME_ON_FEET_F = 80;

// ─── Research/06:489-499 · hard bail triggers ─────────────────────────
/** WBGT > this → ACSM black flag (:493). */
export const WBGT_BAIL_F = 86;
/** Td >= this → evaporative cooling fails (:494). */
export const TD_BAIL_F = 80;
/** AQI > this → acute health risk (:496). */
export const AQI_BAIL = 200;
/** AQI in this band → easy time-on-feet <=30 min or indoors (:487). */
export const AQI_TIME_ON_FEET_LOW = 151;

/**
 * WBGT approximation · Research/06:135-137, verbatim:
 *
 *   WBGT_approx (°F) ~= Tair - ((100 - RH) / 5) + solar_correction
 *   solar_correction: full_sun = +5°F, partial = +2°F, overcast = 0°F
 *
 * Cloud cover maps to the three solar buckets. When cloud cover is
 * unknown we take FULL SUN. That is the conservative direction here:
 * the failure this gate exists to prevent is a runner doing intervals
 * at black-flag WBGT, and the cost of the other error is one proposed
 * easy day the runner can decline.
 */
export function wbgtApproxF(
  tairF: number,
  humidityPct: number | null | undefined,
  cloudCoverPct?: number | null,
): number | null {
  if (humidityPct == null || !Number.isFinite(humidityPct)) return null;
  const rh = Math.max(0, Math.min(100, humidityPct));
  const solar = cloudCoverPct == null || !Number.isFinite(cloudCoverPct)
    ? 5                                  // unknown → full sun
    : cloudCoverPct <= 25 ? 5            // full sun
      : cloudCoverPct <= 75 ? 2          // partial
        : 0;                             // overcast
  return tairF - ((100 - rh) / 5) + solar;
}

/** Flag band for a WBGT reading · Research/06:141-148. */
export function flagForWbgt(wbgtF: number): { flag: HeatFlag; action: HeatGateAction; note: string } {
  for (const band of WBGT_FLAGS) {
    if (wbgtF <= band.maxF) return { flag: band.flag, action: band.action, note: band.note };
  }
  const last = WBGT_FLAGS[WBGT_FLAGS.length - 1];
  return { flag: last.flag, action: last.action, note: last.note };
}

// ─── The heat band, once · doctrine-conformance audit cluster 6 ───────────
//
// Four taxonomies described the same afternoon before 2026-08-17, none of
// them from Research/:
//
//   weather-adjust.bandFor   slowdown % · neutral <2, warm <4, hot <8, extreme
//   race-conditions.heatBandFor  Tair · neutral <60, warm <70, hot <80, extreme
//   J_CoachVerdict.HeatBand.from(tempF:)  Tair · 60 / 75 / 85 ("Maughan-ish")
//   WBGT_FLAGS above         the actual doctrine, used only by the safety gate
//
// At 72°F the server said "hot" and the phone said "warm", about the same
// run. Doctrine's taxonomy is the ACSM / Korey Stringer flag table, and it
// is the one already sitting in this file. The four-word band the UI renders
// is now a pure presentation mapping of that flag — the words stay, the
// thresholds are doctrine's.
//
// WBGT needs humidity. A surface that cannot supply it gets `null` and shows
// the temperature with no heat word, rather than a parallel scale invented
// to fill the gap. That is the whole point: a missing input should read as a
// missing input.
export type HeatBandWord = 'neutral' | 'warm' | 'hot' | 'extreme';

/** WBGT flag → the word the UI shows. Research/06:141-148 band for band. */
export function heatBandForFlag(flag: HeatFlag): HeatBandWord | null {
  switch (flag) {
    case 'white':
    case 'green':
      return 'neutral';                 // "Optimal" / "Low risk"
    case 'yellow':
      return 'warm';                    // "Moderate risk"
    case 'red':
      return 'hot';                     // "High risk"
    case 'black':
      return 'extreme';                 // "Extreme risk"
    default:
      return null;                      // unknown · no WBGT, no word
  }
}

export interface HeatBandReading {
  /** ACSM / KSI flag · 'unknown' when WBGT could not be computed. */
  flag: HeatFlag;
  /** Approximated WBGT °F, or null when humidity is unknown. */
  wbgtF: number | null;
  /** The word for the UI · null means "we cannot say", not "neutral". */
  band: HeatBandWord | null;
}

/**
 * THE band read. Every surface that shows a heat word calls this.
 * Research/06 §3's approximation and flag table, nothing else.
 */
export function heatBandForConditions(input: {
  tairF: number | null | undefined;
  humidityPct?: number | null;
  cloudCoverPct?: number | null;
  conditions?: string | null;
}): HeatBandReading {
  const t = input.tairF;
  if (t == null || !Number.isFinite(t)) return { flag: 'unknown', wbgtF: null, band: null };
  // `conditions` is the same three-bucket sky signal cloud cover carries;
  // map it onto cloud cover so a surface with only a word still resolves.
  const cloud = input.cloudCoverPct != null && Number.isFinite(input.cloudCoverPct)
    ? input.cloudCoverPct
    : skyWordToCloudPct(input.conditions);
  const wbgtF = wbgtApproxF(t, input.humidityPct, cloud);
  if (wbgtF == null) return { flag: 'unknown', wbgtF: null, band: null };
  const flag = flagForWbgt(wbgtF).flag;
  return { flag, wbgtF: Math.round(wbgtF * 10) / 10, band: heatBandForFlag(flag) };
}

/** 'clear' / 'partly cloudy' / … → the cloud-cover % the solar buckets read. */
function skyWordToCloudPct(conditions?: string | null): number | null {
  const c = (conditions ?? '').toLowerCase();
  if (c === 'clear') return 0;
  if (c === 'partly cloudy') return 50;
  if (c === 'cloudy' || c === 'rain' || c === 'snow') return 100;
  return null;
}

const SEVERITY: Record<HeatGateAction, number> = {
  normal: 0,
  reduce_hard_volume: 1,
  reduce_intensity: 2,
  easy_time_on_feet: 3,
  cancel: 4,
};

/**
 * Evaluate the conditions against the three Research/06 tables and
 * return the most severe verdict any of them produces.
 *
 * Per-finding context filters (CLAUDE.md, locked 2026-05-19 round 4):
 * each trigger below asks its own question against its own reading. The
 * WBGT band does not stand in for the dewpoint bail, and neither stands
 * in for AQI.
 */
export function evaluateHeatGate(input: HeatGateInput): HeatGateVerdict {
  const tairF = input.tairF;
  if (tairF == null || !Number.isFinite(tairF)) {
    return {
      flag: 'unknown', wbgtF: null, dewpointF: null, action: 'normal', fires: false,
      proposeFirst: false, headline: 'No conditions data for this session.',
      citation: 'Research/06 §11 · gate needs an air temperature to run',
    };
  }

  const wbgtF = wbgtApproxF(tairF, input.humidityPct, input.cloudCoverPct);
  const dewpointF = input.dewpointF != null && Number.isFinite(input.dewpointF)
    ? input.dewpointF
    : (input.humidityPct != null && Number.isFinite(input.humidityPct)
      ? estimateDewpointF(tairF, input.humidityPct)
      : null);

  let best: { action: HeatGateAction; flag: HeatFlag; headline: string; citation: string } = {
    action: 'normal',
    flag: wbgtF != null ? flagForWbgt(wbgtF).flag : 'unknown',
    headline: 'Conditions are fine. Run it as written.',
    citation: 'Research/06:141-148 · WBGT flag table',
  };
  const consider = (
    action: HeatGateAction, flag: HeatFlag, headline: string, citation: string,
  ) => {
    if (SEVERITY[action] > SEVERITY[best.action]) best = { action, flag, headline, citation };
  };

  // 1 · WBGT flag band (:141-148).
  if (wbgtF != null) {
    const band = flagForWbgt(wbgtF);
    consider(band.action, band.flag, `WBGT ${Math.round(wbgtF)}°F. ${band.note}`,
      'Research/06:141-148 · WBGT flag table');
  }

  // 2 · Convert to time-on-feet (:481-487). Its own reading, not the
  //     flag band's: Td 72°F at WBGT 78°F is a red flag by the table but
  //     an independent time-on-feet trigger by the dewpoint row.
  if (wbgtF != null && wbgtF >= WBGT_TIME_ON_FEET_F) {
    consider('easy_time_on_feet', 'black',
      `WBGT ${Math.round(wbgtF)}°F. Hard sessions become easy time on feet. Drop the pace targets.`,
      'Research/06:484 · WBGT >=80°F · all hard sessions convert to easy time-on-feet');
  }
  if (dewpointF != null && dewpointF >= TD_TIME_ON_FEET_F && dewpointF < TD_BAIL_F) {
    consider('reduce_intensity', best.flag === 'unknown' ? 'red' : best.flag,
      `Dew point ${Math.round(dewpointF)}°F. Run the quality session on time and effort, not pace.`,
      'Research/06:483 · Td >=70°F · quality sessions time-based, RPE-driven');
  }

  // 3 · Hard bail (:489-499). Each row is its own check.
  if (wbgtF != null && wbgtF > WBGT_BAIL_F) {
    consider('cancel', 'black',
      `WBGT ${Math.round(wbgtF)}°F. Black flag. Not outdoors today.`,
      'Research/06:493 · WBGT >86°F · ACSM black flag');
  }
  if (dewpointF != null && dewpointF >= TD_BAIL_F) {
    consider('cancel', 'black',
      `Dew point ${Math.round(dewpointF)}°F. Sweat stops cooling you at this point. Move it indoors or postpone.`,
      'Research/06:494 · Td >=80°F · evaporative cooling fails');
  }
  if (input.aqi != null && Number.isFinite(input.aqi)) {
    if (input.aqi > AQI_BAIL) {
      consider('cancel', best.flag,
        `AQI ${Math.round(input.aqi)}. Indoors today.`,
        'Research/06:496 · AQI >200 · acute health risk');
    } else if (input.aqi >= AQI_TIME_ON_FEET_LOW) {
      consider('easy_time_on_feet', best.flag,
        `AQI ${Math.round(input.aqi)}. Easy, 30 minutes at most, or indoors.`,
        'Research/06:487 · AQI 151-200 · easy time-on-feet <=30 min or indoors');
    }
  }

  const fires = best.action !== 'normal';
  return {
    flag: best.flag,
    wbgtF: wbgtF != null ? Math.round(wbgtF * 10) / 10 : null,
    dewpointF: dewpointF != null ? Math.round(dewpointF * 10) / 10 : null,
    action: best.action,
    fires,
    // Propose-first, never apply-now · the runner gates every plan
    // change, same contract as readiness_pullback.
    proposeFirst: fires,
    headline: best.headline,
    citation: best.citation,
  };
}

/**
 * Does this day count as heat-acclimation stimulus? Research/06:172 ·
 * "Tair >=85°F or WBGT >=75°F". Either satisfies the dose.
 */
export function isHeatDoseDay(
  tairF: number | null | undefined,
  humidityPct?: number | null,
  cloudCoverPct?: number | null,
): boolean {
  if (tairF == null || !Number.isFinite(tairF)) return false;
  if (tairF >= HEAT_DOSE_TAIR_F) return true;
  const wbgt = wbgtApproxF(tairF, humidityPct, cloudCoverPct);
  return wbgt != null && wbgt >= HEAT_DOSE_WBGT_F;
}
