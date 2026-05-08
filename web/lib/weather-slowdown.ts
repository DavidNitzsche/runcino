/**
 * Weather slowdown calculator — combines heat, dewpoint, wind, and
 * altitude into a single race-day pace adjustment.
 *
 * Source doctrine: web/coach/doctrine/weather.ts (Research/06).
 *
 * Engine consumers:
 *   - coach.briefRaceMorning   computes a quantified slowdown + per-mile
 *                              seconds for the race-morning brief
 *   - /races/[slug]            shows the projected adjusted goal time
 *
 * The math follows Research/06 §10 race-day decision flow:
 *   total_slowdown_pct ≈ heat_pct + altitude_pct + wind_pct
 *   final_pace = base_pace × (1 + total_slowdown_pct/100) + wind_sec/mi
 *
 * Heat compounds slightly with altitude when both >5%; we apply a
 * 10% reduction in that case, matching the research's compounding
 * note.
 */

import {
  MAUGHAN_HEAT_SLOWDOWN,
  TEMP_DEWPOINT_SUM_ADJUSTMENT,
  DEWPOINT_PACE_ADJUSTMENT,
  ALTITUDE_RACE_LOSS,
  WIND_PER_MILE_COST,
  SINGLE_NUMBER_HEAT_FALLBACK,
  QUALITY_SESSION_BAIL_TRIGGERS,
  HARD_CANCEL_TRIGGERS,
} from '../coach/doctrine/weather';

export interface WeatherSlowdownInput {
  /** Air temperature, °F. Required. */
  tairF: number;
  /** Dewpoint, °F. Optional — when present, drives a Td-aware
   *  calculation; when absent, falls back to Tair-only heuristic. */
  dewpointF?: number;
  /** Sustained wind speed, mph. Net headwind (positive) on an
   *  out-and-back course; tailwind benefit is asymmetric (~half) and
   *  this calc treats wind as net-cost only. */
  windMph?: number;
  /** Race elevation, feet. Adjustment kicks in above 3000 ft. */
  elevationFt?: number;
  /** Whether the runner is acclimatized to altitude (≥3 weeks
   *  resident). Default: false (acute traveler). */
  altitudeAcclimatized?: boolean;
  /** Goal pace, seconds per mile. When provided, the result includes
   *  a per-mile seconds estimate. */
  runnerPaceSPerMi?: number;
  /** Runner ability tier — used to select the right Maughan heat
   *  curve. 'elite' (sub-3:00 marathon), 'mid_pack' (3:00-4:30),
   *  'slow' (4:30+). Default: 'mid_pack'. */
  abilityTier?: 'elite' | 'mid_pack' | 'slow';
}

export interface WeatherSlowdown {
  /** Combined slowdown as a percentage. Apply to base pace as
   *  base × (1 + pct/100). */
  totalPct: number;
  /** Per-mile seconds adjustment, when goal pace is known. */
  perMileSecs: number | null;
  /** Component breakdown for transparency in the brief. */
  breakdown: {
    heatPct: number;
    altitudePct: number;
    windSecPerMi: number;
    compoundingPenaltyPct: number;
  };
  /** One-line rationale per active component. Used in the brief
   *  voice when the slowdown is non-trivial. */
  rationale: string[];
  /** Hard-bail signal when the day exceeds research thresholds. */
  bailFlag: 'cancel' | 'easy_only' | 'caution' | null;
  /** Bail reason, when bailFlag is set. */
  bailReason?: string;
}

const ABILITY_KEY: Record<NonNullable<WeatherSlowdownInput['abilityTier']>, 'elitePct' | 'midPaceMarathonerPct' | 'slowMarathonerPct'> = {
  elite:    'elitePct',
  mid_pack: 'midPaceMarathonerPct',
  slow:     'slowMarathonerPct',
};

export function computeWeatherSlowdown(input: WeatherSlowdownInput): WeatherSlowdown {
  const tier = input.abilityTier ?? 'mid_pack';
  const tierKey = ABILITY_KEY[tier];

  // ── Heat component ───────────────────────────────────────────
  let heatPct = 0;
  let heatRationale: string | null = null;

  if (input.dewpointF != null) {
    // Td-aware path — use Tair+Td sum table (Hadley framework, more
    // accurate than Tair alone). Mid-band of the row.
    const sum = input.tairF + input.dewpointF;
    const row = TEMP_DEWPOINT_SUM_ADJUSTMENT.value.find(r =>
      sum >= r.sumLowF && (r.sumHighF == null || sum <= r.sumHighF)
    );
    if (row && row.pctLow != null && row.pctHigh != null) {
      heatPct = (row.pctLow + row.pctHigh) / 2;
      heatRationale = `${input.tairF}°F + ${input.dewpointF}°F dewpoint (sum ${sum}) — ${row.notes.toLowerCase()}.`;
    }
  } else {
    // Tair-only fallback per Research/06 §12 single-number table.
    const row = SINGLE_NUMBER_HEAT_FALLBACK.value.find(r =>
      input.tairF >= r.tairFLow && input.tairF <= r.tairFHigh
    );
    if (row) {
      heatPct = (row.slowdownPctLow + row.slowdownPctHigh) / 2;
      if (heatPct > 0) {
        heatRationale = `${input.tairF}°F start — heat costs about ${heatPct.toFixed(1)}% for a ${tier === 'elite' ? 'sub-3 marathoner' : tier === 'slow' ? '4:30+ runner' : 'mid-pack runner'}.`;
      }
    }

    // Cross-check against Maughan tier table when in marathon range.
    const maughanRow = MAUGHAN_HEAT_SLOWDOWN.value.find(r => Math.abs(r.tairF - input.tairF) <= 5);
    if (maughanRow) {
      const tierPct = maughanRow[tierKey];
      // Use the tier-specific Maughan number when available (more
      // ability-aware than the single-number fallback).
      heatPct = tierPct;
      if (tierPct > 0) {
        heatRationale = `${input.tairF}°F (Maughan/Ely/Vihma synthesis): about ${tierPct.toFixed(1)}% slowdown for a ${tier === 'elite' ? 'sub-3' : tier === 'slow' ? '4:30+' : '3:30'} runner.`;
      }
    }
  }

  // Below 50°F we add nothing for heat.
  if (input.tairF < 50) {
    heatPct = 0;
    heatRationale = null;
  }

  // ── Altitude component ───────────────────────────────────────
  let altitudePct = 0;
  let altitudeRationale: string | null = null;
  if (input.elevationFt != null && input.elevationFt > 1000) {
    const row = ALTITUDE_RACE_LOSS.value.slice().reverse().find(r => input.elevationFt! >= r.elevationFt);
    if (row) {
      const acclim = input.altitudeAcclimatized ?? false;
      const pctLow = acclim ? row.acclimatizedPctLow : row.acutePctLow;
      const pctHigh = acclim ? row.acclimatizedPctHigh : row.acutePctHigh;
      altitudePct = (pctLow + pctHigh) / 2;
      if (altitudePct > 0) {
        altitudeRationale = `${input.elevationFt} ft elevation${acclim ? ' (acclimatized)' : ' (acute)'}: about ${altitudePct.toFixed(1)}% slowdown.`;
      }
    }
  }

  // ── Wind component ───────────────────────────────────────────
  let windSecPerMi = 0;
  let windRationale: string | null = null;
  if (input.windMph != null && input.windMph >= 5) {
    // Pick the closest pace band from the wind table.
    const tablePace = input.runnerPaceSPerMi != null && input.runnerPaceSPerMi <= 420 ? '6:00' : '8:00';
    const row = WIND_PER_MILE_COST.value.slice().reverse().find(r => input.windMph! >= r.windMph);
    if (row) {
      windSecPerMi = tablePace === '6:00' ? row.headwindCostS6Min : row.headwindCostS8Min;
      // Out-and-back rule: net loss is ~30-40% of headwind cost (the
      // brief always assumes net headwind — point-to-points should
      // override).
      windSecPerMi = Math.round(windSecPerMi * 0.35);
      if (windSecPerMi >= 1) {
        windRationale = `${input.windMph} mph wind — net cost on an out-and-back course about +${windSecPerMi} sec/mi.`;
      }
    }
  }

  // ── Compounding penalty (Research/06 §10) ─────────────────────
  let compoundingPenaltyPct = 0;
  if (heatPct > 5 && altitudePct > 5) {
    // Heat + altitude don't strictly add: real cost ~10% less than
    // sum. We subtract 10% of (heatPct + altitudePct) as a corrective.
    compoundingPenaltyPct = -Math.round((heatPct + altitudePct) * 0.10 * 10) / 10;
  }

  // ── Combine + per-mile ────────────────────────────────────────
  const totalPct = Math.round((heatPct + altitudePct + compoundingPenaltyPct) * 10) / 10;
  let perMileSecs: number | null = null;
  if (input.runnerPaceSPerMi != null) {
    perMileSecs = Math.round(input.runnerPaceSPerMi * (totalPct / 100)) + windSecPerMi;
  }

  // ── Bail flag (Research/06 §11) ───────────────────────────────
  let bailFlag: WeatherSlowdown['bailFlag'] = null;
  let bailReason: string | undefined;

  // Hard-cancel triggers
  if (input.dewpointF != null && input.dewpointF >= 80) {
    bailFlag = 'cancel';
    bailReason = HARD_CANCEL_TRIGGERS.value.find(t => t.trigger.includes('Td'))?.reason;
  } else if (input.tairF >= 90 && (input.dewpointF == null || input.dewpointF >= 70)) {
    bailFlag = 'cancel';
    bailReason = 'Tair ≥90°F with high dewpoint — ACSM black-flag conditions.';
  } else if (input.dewpointF != null && input.dewpointF >= 70) {
    bailFlag = 'easy_only';
    bailReason = QUALITY_SESSION_BAIL_TRIGGERS.value.find(t => t.trigger.includes('Td'))?.reason;
  } else if (heatPct >= 5 || (input.windMph ?? 0) >= 20) {
    bailFlag = 'caution';
    bailReason = 'Significant adjustment needed — pace conservatively, target finish over time.';
  }

  const rationale = [heatRationale, altitudeRationale, windRationale].filter((s): s is string => s != null);

  return {
    totalPct,
    perMileSecs,
    breakdown: {
      heatPct: Math.round(heatPct * 10) / 10,
      altitudePct: Math.round(altitudePct * 10) / 10,
      windSecPerMi,
      compoundingPenaltyPct,
    },
    rationale,
    bailFlag,
    bailReason,
  };
}

/** Format a slowdown for inline insertion into a brief paragraph.
 *  Returns null when the day is essentially neutral. */
export function formatSlowdownForBrief(s: WeatherSlowdown): string | null {
  if (s.totalPct < 0.5 && Math.abs(s.breakdown.windSecPerMi) < 2) return null;
  const parts: string[] = [];
  if (s.totalPct >= 0.5) {
    parts.push(`expect about ${s.totalPct.toFixed(1)}% slowdown`);
  }
  if (s.perMileSecs != null && s.perMileSecs >= 2) {
    parts.push(`roughly +${s.perMileSecs} sec/mi vs cool-day goal`);
  } else if (s.breakdown.windSecPerMi >= 2) {
    parts.push(`wind alone adds about +${s.breakdown.windSecPerMi} sec/mi`);
  }
  return parts.join(' — ');
}
