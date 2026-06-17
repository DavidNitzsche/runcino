/**
 * lib/race/fuel-resolve.ts · resolve a race's fuel inputs.
 *
 * Precedence (most specific wins, field by field):
 *   1. Per-race meta (races.meta.fuelProduct / fuelCarbsPerServingG /
 *      fuelCadenceMin / fuelCarbsPerHourTargetG) — what the runner
 *      entered for THIS race.
 *   2. Runner-level default (users.fuel_brand / fuel_gel_carbs_g /
 *      fuel_target_g_per_hr) — their usual product.
 *   3. Nothing — composeRaceExecutionPlan applies documented defaults
 *      (Research/18 §1: 60 g/hr floor, 22 g serving) and flags isDefault.
 *
 * Used by GET /api/race/[slug] and /execution-plan so both surfaces show
 * the identical fuel recommendation.
 *
 * Cite: Research/18-fueling-products.md §1 + §11.
 */
import type { RaceFuelingInput } from '@/lib/race/execution-plan';

/** Subset of users.fuel_* used as the runner-level default. */
export interface RunnerFuelDefaults {
  fuel_brand: string | null;
  fuel_gel_carbs_g: number | null;
  fuel_target_g_per_hr: number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

export function resolveRaceFuel(
  meta: Record<string, unknown> | null | undefined,
  defaults: RunnerFuelDefaults | null | undefined,
): { fuel: RaceFuelingInput; fuelIsDefault: boolean } {
  const m = meta ?? {};
  const d = defaults ?? { fuel_brand: null, fuel_gel_carbs_g: null, fuel_target_g_per_hr: null };

  // Per-race values present?
  const raceProduct = str(m.fuelProduct);
  const raceServing = num(m.fuelCarbsPerServingG);
  const raceCadence = num(m.fuelCadenceMin);
  const raceRate = num(m.fuelCarbsPerHourTargetG);
  const hasRaceFuel = !!(raceProduct || raceServing || raceCadence || raceRate);

  // Runner-default values present?
  const defProduct = str(d.fuel_brand);
  const defServing = num(d.fuel_gel_carbs_g);
  const defRate = num(d.fuel_target_g_per_hr);
  const hasDefaultFuel = !!(defProduct || defServing || defRate);

  const fuel: RaceFuelingInput = {
    product: raceProduct ?? defProduct ?? null,
    carbsPerServingG: raceServing ?? defServing ?? null,
    cadenceMin: raceCadence ?? null,            // cadence is per-race only
    carbsPerHourTargetG: raceRate ?? defRate ?? null,
  };

  // isDefault: neither the race nor the runner has any real product entry,
  // so every value the plan uses is a documented default → prompt to enter.
  return { fuel, fuelIsDefault: !hasRaceFuel && !hasDefaultFuel };
}
