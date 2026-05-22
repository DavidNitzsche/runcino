/**
 * HR zones — single source of truth for zone computation.
 *
 * S1 cleanup (David round 3): round 1 fixed buildHrZones in
 * fitness-resolver.ts to use HRR (Karvonen) when restingHr is known.
 * Round 2 fixed the inline HR_ZONES in /profile/page.tsx to do the
 * same. Two implementations of the same math. This module is the
 * shared utility both surfaces now import.
 *
 * Framework selection:
 *   - Karvonen / HRR when restingHr is available (more accurate for
 *     trained runners with low resting HR)
 *   - %max fallback when restingHr is null
 *
 * Zone fractions are the Daniels percentages:
 *   Z1 Recovery   50-60%
 *   Z2 Easy       60-70%
 *   Z3 Steady     70-80%
 *   Z4 Threshold  80-90%
 *   Z5 VO₂max     90-100%
 */

export type ZoneTier = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

export interface HrZone {
  tier: ZoneTier;
  name: string;
  lowBpm: number;
  highBpm: number;
  /** Human-readable percent label, e.g. "60–70% HRR" or "60–70% max". */
  pctLabel: string;
}

export interface HrZonesBundle {
  /** Whether HRR or %max was used to compute the zones. */
  framework: 'HRR' | '%max';
  /** Heart-rate reserve if HRR framework, otherwise null. */
  hrr: number | null;
  /** The user's max HR. */
  maxHr: number;
  /** The user's resting HR if known. */
  restingHr: number | null;
  /** Ordered list Z1 → Z5. */
  zones: HrZone[];
}

const ZONE_FRACTIONS: Array<{ tier: ZoneTier; name: string; lo: number; hi: number }> = [
  { tier: 'z1', name: 'Z1 · Recovery',  lo: 0.50, hi: 0.60 },
  { tier: 'z2', name: 'Z2 · Easy',      lo: 0.60, hi: 0.70 },
  { tier: 'z3', name: 'Z3 · Steady',    lo: 0.70, hi: 0.80 },
  { tier: 'z4', name: 'Z4 · Threshold', lo: 0.80, hi: 0.90 },
  { tier: 'z5', name: 'Z5 · VO₂max',    lo: 0.90, hi: 1.00 },
];

/** Build HR zones. Returns null when maxHr is invalid. */
export function buildHrZonesBundle(
  maxHr: number | null,
  restingHr: number | null,
): HrZonesBundle | null {
  if (!maxHr || maxHr <= 0) return null;

  const useHRR = !!(restingHr && restingHr > 0 && restingHr < maxHr);
  const hrr = useHRR ? (maxHr - restingHr) : null;
  const pctLabel = useHRR ? 'HRR' : 'max';

  const zones: HrZone[] = ZONE_FRACTIONS.map((z) => {
    const low = useHRR
      ? Math.round(restingHr! + hrr! * z.lo)
      : Math.round(maxHr * z.lo);
    const high = useHRR
      ? Math.round(restingHr! + hrr! * z.hi)
      : Math.round(maxHr * z.hi);
    return {
      tier: z.tier,
      name: z.name,
      lowBpm: low,
      highBpm: high,
      pctLabel: `${Math.round(z.lo * 100)}–${Math.round(z.hi * 100)}% ${pctLabel}`,
    };
  });

  return {
    framework: useHRR ? 'HRR' : '%max',
    hrr,
    maxHr,
    restingHr: restingHr ?? null,
    zones,
  };
}

/**
 * The "hard effort" HR floor — the bottom of the Threshold zone (Z4).
 *
 * A run averaging at/above this is a genuinely hard session for recovery
 * purposes. Uses Karvonen %HRR (resting + 0.80 × reserve) when resting HR
 * is known — more accurate for trained runners with low resting HR — and
 * falls back to 0.80 × maxHr otherwise.
 *
 * Cited: Research/03 §4 (Z4 Threshold = 80–90% / "comfortably hard") and
 * §5 (Karvonen HRR). This is THE single definition of "hard by HR" — every
 * consumer (readiness, plan-building 24h-recovery, run debrief) routes
 * through here so they can't drift apart again. Returns null when maxHr is
 * unknown (caller falls back to its own default).
 */
export function hardEffortFloorBpm(
  maxHr: number | null,
  restingHr: number | null,
): number | null {
  const bundle = buildHrZonesBundle(maxHr, restingHr);
  if (!bundle) return null;
  return bundle.zones.find((z) => z.tier === 'z4')?.lowBpm ?? null;
}

/** Classify an average HR into its Karvonen (or %max fallback) zone tier.
 *  Returns null when maxHr is unknown. */
export function classifyHrZone(
  avgHr: number,
  maxHr: number | null,
  restingHr: number | null,
): ZoneTier | null {
  const bundle = buildHrZonesBundle(maxHr, restingHr);
  if (!bundle) return null;
  // Walk high→low; first zone whose floor we're at/above wins.
  for (let i = bundle.zones.length - 1; i >= 0; i--) {
    if (avgHr >= bundle.zones[i].lowBpm) return bundle.zones[i].tier;
  }
  return bundle.zones[0].tier;
}

/** Convenience: zone bands in the FitnessHrZones shape (used by
 *  fitness-resolver). Same math, different output shape. */
export interface FitnessHrZonesShape {
  z1: { lowBpm: number; highBpm: number; label: 'Recovery' };
  z2: { lowBpm: number; highBpm: number; label: 'Easy' };
  z3: { lowBpm: number; highBpm: number; label: 'Steady' };
  z4: { lowBpm: number; highBpm: number; label: 'Threshold' };
  z5: { lowBpm: number; highBpm: number; label: 'VO2max' };
}

export function buildFitnessHrZones(
  maxHr: number | null,
  restingHr: number | null,
): FitnessHrZonesShape | null {
  const bundle = buildHrZonesBundle(maxHr, restingHr);
  if (!bundle) return null;
  const [z1, z2, z3, z4, z5] = bundle.zones;
  return {
    z1: { lowBpm: z1.lowBpm, highBpm: z1.highBpm, label: 'Recovery'  },
    z2: { lowBpm: z2.lowBpm, highBpm: z2.highBpm, label: 'Easy'      },
    z3: { lowBpm: z3.lowBpm, highBpm: z3.highBpm, label: 'Steady'    },
    z4: { lowBpm: z4.lowBpm, highBpm: z4.highBpm, label: 'Threshold' },
    z5: { lowBpm: z5.lowBpm, highBpm: z5.highBpm, label: 'VO2max'    },
  };
}
