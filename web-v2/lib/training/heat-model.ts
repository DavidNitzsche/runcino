/**
 * lib/training/heat-model.ts · THE heat doctrine table + its two engine
 * modifiers. Single source for every surface that prices heat:
 *
 *   · applyHeatToPace (lib/weather/heat-adjustment.ts) — race projection,
 *     Conditions chunk, prescription adjustment
 *   · judgeWeather (lib/coach/weather-adjust.ts) — post-run verdicts,
 *     heat-adjusted pace bands, recap copy
 *   · race execution plan (lib/race/execution-plan.ts)
 *
 * 2026-06-09 state-audit fix: the app previously ran TWO temp→slowdown
 * tables — weather-adjust's piecewise curve sat ~2× above the cited
 * doctrine (70°F → 8% vs 4%) while heat-adjustment halved it for HM via
 * an uncited 0.5× distance scale. Post-run verdicts over-forgave heat
 * and the race projection under-budgeted it. Both now read THIS table.
 *
 * Doctrine: Research/06-weather-adjustments.md
 *   §1 Maughan/Ely/Vihma marathon-slowdown synthesis (the table below,
 *      verbatim — slowdown % vs 50°F baseline, by ability tier)
 *   §12 quick-reference: +1% per 10°F dewpoint above 60°F
 *
 * Engine-internal modifier (documented as such, NOT from Research/06):
 *   durationHeatScale — the table is marathon-anchored; most of the
 *   penalty is cumulative (dehydration, core temp, glycogen accel) and
 *   takes hours to bite. Sub-marathon efforts pay a scaled fraction,
 *   ramping 0.40 (very short) → 1.00 (2h+). Applied symmetrically by
 *   both consumers so a verdict and a projection can never disagree
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
 * Composed slowdown for an effort: (temp table + dewpoint surcharge) ×
 * duration scale. The one formula both engines share.
 */
export function effortSlowdownPct(args: {
  tempF: number;
  dewpointF?: number | null;
  durationS?: number | null;
  tier?: AbilityTier;
}): number {
  const base = maughanSlowdownPct(args.tempF, args.tier ?? 'mid_pack');
  const dp = dewpointAddPct(args.dewpointF);
  return (base + dp) * durationHeatScale(args.durationS);
}
