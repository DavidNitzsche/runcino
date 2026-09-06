/**
 * lib/health/resync-preview.ts · DECISION 3 (2026-09-06) · the HealthKit
 * resync PREVIEW, never the resync itself.
 *
 * David's ruling, verbatim: "Do not patch values with SQL. Prepare a
 * HealthKit resync preview showing: Every affected date. Current stored
 * total. On-device recomputed total. Delta. Source sample count. Upsert
 * identity. Rows that would change. Rows that would remain untouched. Do not
 * trigger the production resync until approved."
 *
 * ── WHY THIS IS A PREVIEW AND NOT A REAL RESYNC, STATED PLAINLY (Rule 13) ──
 *
 * The corrupted days named in `active-energy-batch.ts`'s own header (54 of
 * 135 stored days below 100 kcal, REQUESTSTORM-2) lost their raw per-bucket
 * HealthKit samples the moment the old last-write-wins upsert overwrote them
 * — the buckets are gone from this database, not merely mis-summed. There is
 * no query against `health_samples` that recovers a correct historical
 * total; only a fresh read of the PHONE's own HealthKit store, for the exact
 * historical date range, can produce one. This file is therefore the
 * SERVER HALF only: a pure diff between whatever a resync claims for a date
 * and what is currently stored, and an admin route that reports it without
 * writing anything. It does not read HealthKit itself and cannot — that read
 * has to happen on the device. Wiring a native dry-run flow that calls this
 * preview instead of the live ingest endpoint is real, separate, follow-on
 * work, named here rather than pretended finished.
 *
 * ── THE SIX FIELDS ──────────────────────────────────────────────────────
 *
 * Every row in the report carries exactly what was asked for: the affected
 * date, the current stored total, the resync's own recomputed total, the
 * delta, the source sample count the resync itself reports, and the upsert
 * identity this would land on if applied — `(user_id, sample_type,
 * sample_date)`, the real unique index `app/api/ingest/health/route.ts`'s
 * `ON CONFLICT` already targets (Rule 16 — read the real identity, not a
 * re-derived guess). Rows are split into `wouldChange` and `unchanged`
 * rather than left to the caller to filter, so "nothing here needs fixing"
 * is a fact the report states rather than an absence the caller has to
 * notice.
 */

export interface ResyncCandidate {
  /** ISO date, `YYYY-MM-DD`. */
  readonly dateISO: string;
  /** What a fresh on-device sum for this date claims. */
  readonly recomputedTotalKcal: number;
  /** How many raw HealthKit samples the device summed to produce it — the
   *  fragment-shape evidence `active-energy-batch.ts` already reports for a
   *  live ingest, carried here for the same reason: a total built from one
   *  sample and a total built from fourteen hundred are different claims
   *  about how trustworthy the number is, even when they agree. */
  readonly sourceSampleCount: number;
}

export interface CurrentStoredRow {
  readonly dateISO: string;
  readonly storedTotalKcal: number | null;
}

export interface ResyncPreviewRow {
  readonly dateISO: string;
  readonly currentStoredKcal: number | null;
  readonly onDeviceRecomputedKcal: number;
  /** `null` when there is no current stored value to diff against — a date
   *  the resync would INSERT rather than UPDATE. Never coerced to 0
   *  (Rule 11): "never stored" and "stored zero" are different facts. */
  readonly deltaKcal: number | null;
  readonly sourceSampleCount: number;
  readonly upsertIdentity: { readonly userId: string; readonly sampleType: 'active_energy'; readonly sampleDate: string };
  readonly wouldChange: boolean;
}

export interface ResyncPreviewReport {
  readonly userId: string;
  readonly generatedAtISO: string;
  readonly rows: readonly ResyncPreviewRow[];
  readonly wouldChange: readonly ResyncPreviewRow[];
  readonly unchanged: readonly ResyncPreviewRow[];
}

const ROUND_KCAL_EPSILON = 0.05;

/**
 * Pure. Every field the report needs is already resolved into its
 * arguments — no I/O, no clock read except what the caller stamps as
 * `generatedAtISO` — so this is falsifiable with no database and no device.
 */
export function buildResyncPreview(
  userId: string,
  candidates: readonly ResyncCandidate[],
  current: ReadonlyMap<string, CurrentStoredRow>,
  generatedAtISO: string,
): ResyncPreviewReport {
  const rows: ResyncPreviewRow[] = candidates.map((c) => {
    const stored = current.get(c.dateISO) ?? null;
    const storedKcal = stored?.storedTotalKcal ?? null;
    const delta = storedKcal == null ? null : roundTo2(c.recomputedTotalKcal - storedKcal);
    const wouldChange = storedKcal == null || Math.abs(c.recomputedTotalKcal - storedKcal) > ROUND_KCAL_EPSILON;
    return {
      dateISO: c.dateISO,
      currentStoredKcal: storedKcal,
      onDeviceRecomputedKcal: c.recomputedTotalKcal,
      deltaKcal: delta,
      sourceSampleCount: c.sourceSampleCount,
      upsertIdentity: { userId, sampleType: 'active_energy', sampleDate: c.dateISO },
      wouldChange,
    };
  });
  return {
    userId,
    generatedAtISO,
    rows,
    wouldChange: rows.filter((r) => r.wouldChange),
    unchanged: rows.filter((r) => !r.wouldChange),
  };
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
