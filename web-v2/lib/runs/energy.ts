/**
 * lib/runs/energy.ts · what the calorie column means, decided once.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE COLUMN MEANS ACTIVE ENERGY. IT MEANS THAT ON EVERY SURFACE.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `runs.data` carries two energy keys and they are two different quantities:
 *
 *   · `calories` — Strava/HealthKit TOTAL energy. Basal included. The cost of
 *                  the hour, of which running is one part and being alive is
 *                  the other.
 *   · `kcal`     — the watch's ACTIVE energy, straight off
 *                  HKLiveWorkoutBuilder. The cost of the running.
 *
 * Both are correct. Neither is a bad reading. Measured over the 25 canonical
 * rows carrying both (2026-08-24, prod): `calories` is 1.210x to 1.380x
 * `kcal`, mean 1.314x. That spread IS the basal share of an hour's running,
 * and it varies with how long the hour was.
 *
 * Until now two readers COALESCEd them — `lib/coach/run-state.ts` at tier 1
 * and `components/faff-app/seed.ts:723` — so ONE column labelled `kcal` was
 * total energy on a run that reached Strava and active energy on the run
 * beside it. On 2026-08-16 the runner was shown 2202 next to a measured 1807
 * for the same effort. The number moved 30% for a reason he could not see,
 * and a number that means something different from its label is the defect.
 *
 * The owner ruled on 2026-08-24: ACTIVE ENERGY EVERYWHERE, knowing it drops
 * the figure on every Strava-sourced run in his history.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TOTAL IS REFUSED RATHER THAN CONVERTED
 *
 * The obvious alternative is to subtract a basal rate from the total and keep
 * the row. That subtraction is a physiological assertion, and per CLAUDE.md
 * Rule 7 a constant that asserts physiology carries a doctrine citation.
 * There is none to carry. `Research/` was searched for a resting- or
 * basal-metabolic-rate basis on 2026-08-24 and holds nothing usable:
 * `Research/13-sex-specific-training.md` uses "basal" only of body
 * TEMPERATURE, and `Research/REVIEW_NOTES.md` raises resting metabolic rate
 * as an open question rather than answering it. No Harris-Benedict, no
 * Mifflin-St Jeor, no kcal/kg/hr figure anywhere in the corpus.
 *
 * So a conversion factor here would be a number invented to keep a cell full
 * — the exact shape the doctrine registry exists to catch. The mean 1.314x is
 * a description of 25 rows, not a rate; dividing by it would be curve-fitting
 * this runner's own data and calling it physiology.
 *
 * A total is therefore not a weaker active reading. It is a different
 * quantity, and this ladder does not accept one. `resolveActiveEnergy` takes
 * no Strava-total argument at all, which is the structural half of the guard:
 * a caller cannot pass a total in by mistake, only by editing this file.
 *
 * The cost of refusing, measured: ONE canonical row app-wide carries a total
 * and no active reading (2026-08-01, 1.34 mi). It falls to the estimator like
 * any other row with no measurement, marked as modelled. Every other
 * total-carrying row has the watch's own active figure sitting beside it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE LADDER · a measurement first, and the model says so
 *
 *   1. `data.kcal`   — the watch measured it. MEASURED.
 *   2. the estimator — distance x weight x 1.04 x an HR multiplier.
 *                      MODELLED, and every surface that prints it has to mark
 *                      it. See `ActiveEnergy.measured`.
 *
 * Both answer the same question, so the fallback is a fallback rather than a
 * change of quantity — which is exactly what the old tier 1 was not.
 *
 * Returns null when neither tier can answer. A refusal is a correct answer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE HEALTHKIT TIER IS GONE, AND IT WAS NOT A FALLBACK · 2026-08-24
 *
 * Run detail used to carry a tier between those two: sum the `active_energy`
 * health samples whose timestamp falls inside [start, start + window]. It
 * read as the obvious second opinion. It cannot work, and it was measured:
 *
 *   · `health_samples` carries UNIQUE (user_id, sample_type, sample_date).
 *     One active_energy row per user per DAY is all the table can hold. Prod,
 *     2026-08-24: 123 active_energy rows, 123 distinct (user, day) pairs,
 *     never two rows for one day.
 *   · `app/api/ingest/health/route.ts` knows this and pre-aggregates the
 *     phone's ~15-second buckets into that one daily total on purpose,
 *     because the upsert would otherwise keep only the last ~1 kcal fragment.
 *   · The daily row's `recorded_at` is set to the INGEST BATCH TIME, not to
 *     any moment the energy was spent. Every one of David's 123 rows is
 *     stamped 2026-08-25 02:58 UTC, the second his phone synced.
 *
 * So the tier asked "which samples fall inside this run" of a column that
 * holds when the phone last talked to the server. Across the 106 canonical
 * rows that reached it app-wide it matched ZERO samples and had never once
 * produced a number.
 *
 * Deleting it is not tidying, it is closing a hazard. Had a background sync
 * landed mid-run — which background HealthKit delivery makes a matter of
 * timing, not of possibility — the tier would have matched whole DAILY
 * TOTALS, summed however many the batch wrote in that second, and returned
 * the result as this run's measured cost with `measured: true` beside it. A
 * day's energy, or several days', printed as an hour's, and printed as
 * measured. The estimator it was sitting above is wrong by tens of percent;
 * that failure would have been wrong by hundreds and looked more authoritative.
 *
 * WHAT WOULD BRING IT BACK. Per-sample active-energy storage — a table that
 * can hold many rows per day with each sample's own start and end — and then
 * a window sum is honest again. That is DDL and out of this change's scope.
 * Until then, a run with no watch reading gets a MARKED estimate, which says
 * what it is.
 */
import type { RunData } from '@/lib/runs/run-shape';

/**
 * Which instrument produced the figure.
 *
 * `healthkit` is reserved, not emitted. It comes back when active energy is
 * stored per sample rather than one total per day — see the header.
 */
export type ActiveEnergySource = 'watch' | 'healthkit' | 'estimate';

export interface ActiveEnergy {
  /** Active kilocalories. Never total energy. */
  kcal: number;
  source: ActiveEnergySource;
  /**
   * False for `estimate` only. A surface printing a false here must say so —
   * a modelled number must never look measured. On web that means wrapping
   * the value in `<Modelled>` from `components/faff-app/Modelled.tsx`, which
   * owns the amber tilde and the screen-reader wording; guards 8-9 of
   * `scripts/check-modelled-mark.sh` police it.
   */
  measured: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PURE HALF · no database, callable from a harness
 * ═══════════════════════════════════════════════════════════════════════ */

function pos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The watch's own active-energy total for a row, or null.
 *
 * This is the ONLY key on `runs.data` that is active energy. `data.calories`
 * is deliberately not consulted; see the header.
 */
export function watchActiveEnergyKcal(data: RunData): number | null {
  const v = pos((data as Record<string, unknown>).kcal);
  return v == null ? null : Math.round(v);
}

/**
 * The estimator. MODELLED — never return this without `measured: false`.
 *
 * kcal = distance_mi x weight_kg x 1.04 x hr_multiplier
 *
 *   distance x weight x 1.04 is the canonical running-cost relation
 *   (Margaria 1963 · ~1 kcal per kg per km; miles convert via 1.609 / 1.55).
 *   hr_multiplier scales for effort: +0% at HR 130, +20% at HR 170.
 *
 * This is an ACTIVE-energy formula — it prices the running and nothing else —
 * which is the other reason the column reads active rather than total. Three
 * of the ladder's three tiers already agreed; only Strava's total did not.
 *
 * Returns null without a distance or a plausible body mass, rather than
 * guessing a weight. The 30-200 kg gate rejects a stray sample in pounds.
 */
export function estimateActiveEnergyKcal(args: {
  distanceMi: number;
  weightKg: number | null;
  avgHr: number | null;
}): number | null {
  if (!(args.distanceMi > 0)) return null;
  const w = args.weightKg;
  if (w == null || !Number.isFinite(w) || w <= 30 || w > 200) return null;
  const hrMult = args.avgHr != null && args.avgHr > 130
    ? 1 + Math.min(0.20, (args.avgHr - 130) / 200)
    : 1.0;
  return Math.round(args.distanceMi * w * 1.04 * hrMult);
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RESOLVED HALF · one ladder, batched, shared by every reader
 *
 * Batched because the two callers need different shapes of the same answer:
 * run detail resolves one run, the week seed resolves seven. Giving them one
 * batch entry point rather than one query each is what stops the seed growing
 * a second, shorter ladder — which is precisely how it came to COALESCE a
 * total into a column labelled kcal.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ActiveEnergyInput {
  /** The caller's own row key. Echoed back as the map key. */
  key: string;
  /**
   * `data.kcal`. Pass `watchActiveEnergyKcal(row)`.
   *
   * There is deliberately no `stravaTotalKcal` sibling. A total is a
   * different quantity and this ladder must not be able to receive one by
   * accident — only by someone editing this file and reading the header.
   */
  watchActiveKcal: number | null;
  distanceMi: number;
  avgHr: number | null;
}

/** Latest plausible body mass, for the estimator. One query per batch. */
async function loadWeightKg(userId: string): Promise<number | null> {
  const { pool } = await import('@/lib/db/pool');
  const r = await pool.query<{ value: string }>(
    `SELECT value::text FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = 'body_mass'
      ORDER BY sample_date DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as { value: string }[] }));
  const kg = Number(r.rows[0]?.value);
  return Number.isFinite(kg) ? kg : null;
}


/**
 * Resolve active energy for a set of runs. The one ladder.
 *
 * Keys absent from the returned map have no answer at any tier, and that is a
 * refusal rather than a zero — surfaces print no calories rather than a nought.
 */
export async function resolveActiveEnergyBatch(
  userId: string,
  rows: ActiveEnergyInput[],
): Promise<Map<string, ActiveEnergy>> {
  const out = new Map<string, ActiveEnergy>();
  if (rows.length === 0) return out;

  // Tier 1 · the watch measured it. No query needed.
  const unresolved = rows.filter((row) => {
    const watch = row.watchActiveKcal != null && row.watchActiveKcal > 0
      ? Math.round(row.watchActiveKcal) : null;
    if (watch != null) {
      out.set(row.key, { kcal: watch, source: 'watch', measured: true });
      return false;
    }
    return true;
  });
  if (unresolved.length === 0) return out;

  // Tier 2 · the model, and it is labelled as one. One weight query for the
  // whole batch, which is also why the week seed no longer runs its own.
  const weightKg = await loadWeightKg(userId);
  for (const row of unresolved) {
    const est = estimateActiveEnergyKcal({
      distanceMi: row.distanceMi,
      weightKg,
      avgHr: row.avgHr,
    });
    if (est != null) out.set(row.key, { kcal: est, source: 'estimate', measured: false });
  }
  return out;
}

/** One run's worth of the same ladder. */
export async function resolveActiveEnergy(
  userId: string,
  row: Omit<ActiveEnergyInput, 'key'>,
): Promise<ActiveEnergy | null> {
  const m = await resolveActiveEnergyBatch(userId, [{ ...row, key: 'one' }]);
  return m.get('one') ?? null;
}
