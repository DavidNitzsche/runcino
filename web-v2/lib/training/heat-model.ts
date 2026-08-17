/**
 * lib/training/heat-model.ts · THE heat doctrine table and, since
 * 2026-08-17, THE pre-processing that turns raw weather into it.
 *
 * 2026-06-09 state-audit fix: the app previously ran TWO temp→slowdown
 * tables — weather-adjust's piecewise curve sat ~2× above the cited
 * doctrine (70°F → 8% vs 4%) while heat-adjustment halved it for HM via
 * an uncited 0.5× distance scale. Post-run verdicts over-forgave heat
 * and the race projection under-budgeted it. Both now read THIS table.
 *
 * ── 2026-08-17 · doctrine-conformance audit, cluster 5 ────────────────────
 *
 * That fix left the header claiming the engines "can never disagree again",
 * and they still did — because sharing a TABLE is not sharing a MODEL. Five
 * consumers each decided for themselves what to feed it:
 *
 *   judgeWeather          Tair + solar bump, dewpoint (or estimated from RH)
 *   applyHeatToPace       Tair only · no solar, no dewpoint
 *   execution-plan        Tair only · no solar, no dewpoint
 *   drift-monitor         Tair, dewpoint (or from RH), interval halving
 *   env-schedule          Tair only · no dewpoint at all
 *
 * Same conditions, five answers. A half marathon at 80°F, clear sky,
 * dewpoint 70 was +6.4% on the Targets projection and +9.35% on the same
 * day's post-run verdict — a 3-percentage-point disagreement about one
 * afternoon, entirely from which pre-processing steps each caller happened
 * to remember.
 *
 * The pre-processing now lives HERE, behind one entry point. Callers pass
 * the weather they have; the model decides what to do with it. A consumer
 * that cannot answer a field passes null and the model degrades in one
 * documented way rather than five undocumented ones.
 *
 * Doctrine: Research/06-weather-adjustments.md
 *   §1  Maughan/Ely/Vihma marathon-slowdown synthesis (the table below,
 *       verbatim — slowdown % vs 50°F baseline, by ability tier)
 *   §2  "For repeats with ≥1:1 work:rest, apply half the continuous-run
 *       adjustment"
 *   §12 quick-reference: +1% per 10°F dewpoint above 60°F
 *   §3  the WBGT approximation's solar correction (full sun +5°F,
 *       partial +2°F, overcast 0°F), which is where the effective-temp
 *       bump comes from · lib/coach/heat-gate.ts holds the flag table
 *
 * Engine-internal modifier (documented as such, NOT from Research/06):
 *   durationHeatScale — the table is marathon-anchored; most of the
 *   penalty is cumulative (dehydration, core temp, glycogen accel) and
 *   takes hours to bite. Sub-marathon efforts pay a scaled fraction,
 *   ramping 0.40 (very short) → 1.00 (2h+). Applied symmetrically by
 *   every consumer so a verdict and a projection can never disagree
 *   about the same physics again.
 */

export type AbilityTier = 'elite' | 'mid_pack' | 'slow';

/** Research/06 §1 table, verbatim. Slowdown % vs 50°F baseline. */
export const MAUGHAN_HEAT_SLOWDOWN: ReadonlyArray<{
  tairF: number;
  elitePct: number;
  midPaceMarathonerPct: number;
  slowMarathonerPct: number;
}> = [
  { tairF: 40, elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
  { tairF: 50, elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
  { tairF: 60, elitePct: 0.5,  midPaceMarathonerPct: 1.5,  slowMarathonerPct: 2.5  },
  { tairF: 65, elitePct: 1.0,  midPaceMarathonerPct: 2.5,  slowMarathonerPct: 4.0  },
  { tairF: 70, elitePct: 1.5,  midPaceMarathonerPct: 4.0,  slowMarathonerPct: 6.0  },
  { tairF: 75, elitePct: 2.5,  midPaceMarathonerPct: 5.5,  slowMarathonerPct: 8.5  },
  { tairF: 80, elitePct: 3.5,  midPaceMarathonerPct: 7.5,  slowMarathonerPct: 11.5 },
  { tairF: 85, elitePct: 4.5,  midPaceMarathonerPct: 10.0, slowMarathonerPct: 15.0 },
  { tairF: 90, elitePct: 6.0,  midPaceMarathonerPct: 13.0, slowMarathonerPct: 19.0 },
];

const TIER_KEY: Record<AbilityTier, 'elitePct' | 'midPaceMarathonerPct' | 'slowMarathonerPct'> = {
  elite: 'elitePct',
  mid_pack: 'midPaceMarathonerPct',
  slow: 'slowMarathonerPct',
};

/**
 * Infer ability tier from VDOT. Daniels: VDOT ≥ 60 ~ elite marathon
 * (sub-3:00); 45-60 ~ mid-pack (3:00-4:30); below 45 ~ slow.
 */
export function abilityTierFromVdot(vdot: number | null | undefined): AbilityTier {
  const v = vdot ?? 50;
  if (v >= 60) return 'elite';
  if (v >= 45) return 'mid_pack';
  return 'slow';
}

/**
 * Marathon-anchored slowdown % vs the 50°F baseline, linearly
 * interpolated between the Research/06 bracket points. 0 at/below 50°F.
 * Above 90°F extends at the table's terminal slope (the doctrine table
 * ends at 90; running quality work up there is a bail-out conversation,
 * not a pace-adjustment one).
 */
export function maughanSlowdownPct(tempF: number, tier: AbilityTier = 'mid_pack'): number {
  if (!isFinite(tempF) || tempF <= 50) return 0;
  const key = TIER_KEY[tier];
  const last = MAUGHAN_HEAT_SLOWDOWN[MAUGHAN_HEAT_SLOWDOWN.length - 1];
  const prev = MAUGHAN_HEAT_SLOWDOWN[MAUGHAN_HEAT_SLOWDOWN.length - 2];
  if (tempF >= last.tairF) {
    const slope = (last[key] - prev[key]) / (last.tairF - prev.tairF);
    return last[key] + (tempF - last.tairF) * slope;
  }
  for (let i = 0; i < MAUGHAN_HEAT_SLOWDOWN.length - 1; i++) {
    const lo = MAUGHAN_HEAT_SLOWDOWN[i];
    const hi = MAUGHAN_HEAT_SLOWDOWN[i + 1];
    if (tempF >= lo.tairF && tempF <= hi.tairF) {
      const t = (tempF - lo.tairF) / (hi.tairF - lo.tairF);
      return lo[key] + (hi[key] - lo[key]) * t;
    }
  }
  return 0;
}

/**
 * Dewpoint surcharge · Research/06 §12 quick-reference: "+1% per 10°F
 * dewpoint above 60°F." Additive on top of the temperature slowdown
 * (replaces the old multiplicative 1.0–1.75× curve, which compounded
 * with the inflated temp table to triple doctrine at 78°F/humid).
 */
export function dewpointAddPct(dewpointF: number | null | undefined): number {
  if (dewpointF == null || !isFinite(dewpointF) || dewpointF <= 60) return 0;
  return (dewpointF - 60) / 10;
}

/**
 * Duration scale on the marathon-anchored table. Engine-internal
 * (no Research/06 section — documented deviation): the table prices a
 * 26.2-mile race; cumulative-heat effects accumulate over hours.
 *
 *   sub-30min → ~0.45 · 60min → 0.70 · 90min → 0.85 · 120min+ → 1.00
 *
 * Returns 1.0 when duration is unknown (the published table stands as
 * the safe default).
 */
export function durationHeatScale(durationS: number | null | undefined): number {
  if (!durationS || durationS <= 0) return 1.0;
  const TWO_HOURS = 7200;
  const t = Math.min(1, durationS / TWO_HOURS);
  return Math.max(0.40, Math.min(1.0, 0.40 + 0.60 * t));
}

/**
 * Estimate dewpoint from temperature and relative humidity when dewpoint
 * isn't directly supplied. Magnus-Tetens approximation, °F in / °F out.
 * Good to ±1°F in the running range we care about.
 *
 * Moved here from lib/coach/weather-adjust.ts on 2026-08-17 (which
 * re-exports it) so that "what dewpoint do we use" has one answer for every
 * consumer instead of being re-decided at each call site.
 */
export function estimateDewpointF(tempF: number, humidityPct: number): number {
  const T = (tempF - 32) * 5 / 9;
  const a = 17.625;
  const b = 243.04;
  const rh = Math.max(1, Math.min(100, humidityPct)) / 100;
  const alpha = Math.log(rh) + (a * T) / (b + T);
  const tdC = (b * alpha) / (a - alpha);
  return tdC * 9 / 5 + 32;
}

/**
 * Solar load as an effective-temperature bump, °F. Research/06 §3 gives the
 * same three buckets for the WBGT approximation's solar correction:
 * "full_sun = +5°F, partial = +2°F, overcast = 0°F".
 *
 * UNKNOWN SKY IS NOT FULL SUN HERE. lib/coach/heat-gate.ts assumes full sun
 * when cloud cover is missing because its failure mode is a runner doing
 * intervals at black-flag WBGT; this function only prices pace, where the
 * conservative direction is not to invent a penalty from a field nobody
 * filled in. The two defaults differ on purpose and each says why.
 */
export function solarEffectiveBumpF(
  conditions?: string | null,
  cloudCoverPct?: number | null,
): number {
  const cloud = cloudCoverPct != null && isFinite(cloudCoverPct) ? cloudCoverPct : null;
  const cond = (conditions ?? '').toLowerCase();
  if (cond === 'clear' || (cloud != null && cloud < 25)) return 5;
  if (cond === 'partly cloudy' || (cloud != null && cloud < 60)) return 2;
  return 0;
}

/**
 * Everything the model can use. Every field except `tempF` is optional, and
 * every consumer passes what it genuinely knows — a field it cannot answer
 * is null, never silently re-derived at the call site.
 */
export interface HeatConditions {
  /** Air temperature °F. For a completed run, the PEAK the run fought through. */
  tempF: number | null | undefined;
  /** Measured dewpoint °F. Falls back to `humidityPct` when absent. */
  dewpointF?: number | null;
  /** Relative humidity 0-100, used only to estimate a missing dewpoint. */
  humidityPct?: number | null;
  /** 'clear' | 'partly cloudy' | … · drives the solar bump. */
  conditions?: string | null;
  /** 0-100 · drives the solar bump when `conditions` is absent. */
  cloudCoverPct?: number | null;
  /** Effort duration, seconds. Null → the full marathon-anchored penalty. */
  durationS?: number | null;
  /** Defaults to mid_pack · the honest population default. */
  tier?: AbilityTier;
  /**
   * Research/06 §2 · "For repeats with ≥1:1 work:rest, apply half the
   * continuous-run adjustment". True for interval / VO2max sessions.
   */
  intervalStyle?: boolean;
}

/** Research/06 §2 · repeats cool partially between reps. */
export const INTERVAL_ADJUSTMENT_FACTOR = 0.5;

/** What the model saw and what it did with it · for copy and for tests. */
export interface HeatEffort {
  /** Air temperature after the solar bump, °F. */
  effectiveTempF: number;
  /** Dewpoint used: measured, estimated from RH, or null. */
  dewpointF: number | null;
  /** Final slowdown %, all modifiers applied. */
  slowdownPct: number;
}

/**
 * THE heat calculation. One set of conditions in, one number out, for every
 * surface in the app.
 *
 *   effective temp (Tair + solar)
 *     → Research/06 §1 Maughan table at the runner's tier
 *     + Research/06 §12 dewpoint surcharge (measured, or estimated from RH)
 *     × engine duration scale
 *     × Research/06 §2 interval factor, when the session is repeats
 */
export function heatEffort(c: HeatConditions): HeatEffort | null {
  const t = c.tempF;
  if (t == null || !isFinite(t)) return null;
  const effectiveTempF = t + solarEffectiveBumpF(c.conditions, c.cloudCoverPct);
  const dewpointF = c.dewpointF != null && isFinite(c.dewpointF)
    ? c.dewpointF
    : (c.humidityPct != null && isFinite(c.humidityPct) ? estimateDewpointF(t, c.humidityPct) : null);

  const base = maughanSlowdownPct(effectiveTempF, c.tier ?? 'mid_pack');
  const dp = dewpointAddPct(dewpointF);
  let pct = (base + dp) * durationHeatScale(c.durationS);
  if (c.intervalStyle) pct *= INTERVAL_ADJUSTMENT_FACTOR;
  return { effectiveTempF, dewpointF, slowdownPct: pct };
}

/**
 * Composed slowdown % for an effort. Thin wrapper on `heatEffort` for the
 * callers that only want the number. Returns 0 when temperature is unknown —
 * no weather, no correction, silently, never an invented one.
 */
export function effortSlowdownPct(c: HeatConditions): number {
  return heatEffort(c)?.slowdownPct ?? 0;
}
