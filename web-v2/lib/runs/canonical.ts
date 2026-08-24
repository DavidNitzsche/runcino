/**
 * lib/runs/canonical.ts · the canonical run model.
 *
 * David's rule (2026-05-31):
 *   "Faff app first, then HealthKit, then Strava. Never duplicate data,
 *    always enhance."
 *
 * ONE canonical strava_activities row per actual run. Multiple providers
 * sync the same run · each one ENHANCES the canonical row by filling
 * fields that are NULL/missing, never overwrites a non-null field unless
 * the new source ranks higher than what's recorded in `provenance`.
 *
 * This module is the enhancement layer that runs ON TOP of merge.ts.
 *
 *   merge.ts → assigns dedup-loser rows mergedIntoId pointing at the
 *               canonical. Picks one as canonical.
 *   canonical.ts → walks the dedup-loser rows and PULLS their unique
 *               fields back into the canonical. Stamps absorbed_into_canonical_at
 *               on the loser so future readers know it's been processed.
 *
 * The provenance jsonb column on strava_activities tracks
 * { fieldName: sourceTierName } per populated field.
 *
 * Source tier ladder (highest wins on ties):
 *   1. Faff watch app           (source = 'watch')        · TIER 5
 *   1. Faff phone GPS recording (source = 'phone')        · TIER 5
 *   2. Faff manual entry        (source = 'manual')       · TIER 4
 *   3. Apple Watch via HK       (source = 'apple_watch')  · TIER 3
 *   4. Apple Health raw         (source = 'apple_health') · TIER 2
 *   5. Strava (any flavor)      (source in 'strava','strava_webhook') · TIER 1
 *   any other / null                                       · TIER 0
 *
 * Higher tier = wins on overlap. If two providers both have RPE, the
 * highest-tier wins. If only Strava has RPE and canonical doesn't,
 * Strava's value lands.
 *
 * `phone` sits at the same tier as `watch`: both are the Faff app's own
 * direct-record path (no third-party ingest between the recording and the
 * canonical row). A phone-recorded run must never lose canonical selection
 * to a lower-fidelity Strava/HK duplicate of the same physical run just
 * because it was recorded without a paired watch.
 *
 * Special-case fields that don't just sit on `data`:
 *   - Strava `gear` / `gear_id` → match to shoes table → set
 *       strava_activities.shoe_id (not data.gear_id)
 *   - Strava `perceived_exertion` (1-10) → INSERT into post_run_rpe
 *       (not data.rpe)
 *   - GPS coords from any source → populate data.startLatLng if missing
 *
 * All other fields land on data as-is. provenance gets stamped.
 */
import { pool } from '@/lib/db/pool';

export const SOURCE_TIER: Record<string, number> = {
  watch:          5,  // Faff watch app
  phone:          5,  // Faff phone-only GPS recording (no paired watch) · same tier as watch, both are Faff's own direct-record path
  manual:         4,  // Faff manual entry on iPhone
  apple_watch:    3,  // Apple Watch via HK ingest
  apple_health:   2,  // raw HK sample
  treadmill:      5,  // Faff phone treadmill tracker · same direct-record path as watch/phone
  strava:         1,
  strava_webhook: 1,
};

/**
 * 2026-08-21 · ingest audit · the tier a canonical row's OWN values are worth.
 *
 * `provenance` only ever records fields that ARRIVED from another row. Every
 * field a row wrote itself is unstamped, so `tierFor(provenance[key])` returns
 * 0 for it — which made "does the incoming source outrank what's recorded?"
 * answer YES for every source above tier 0. The tier ladder was therefore
 * inverted in practice on first absorption: a tier-1 Strava loser overwrote a
 * tier-3 Apple-Watch canonical, and a tier-3 HK loser overwrote a tier-5 Faff
 * watch canonical. Confirmed on 66 of David's rows (e.g. the 2026-06-08 run:
 * source=watch, provenance distanceMi/startLocal/date <- apple_watch,
 * movingTimeS/paceSPerMi <- strava).
 *
 * The floor is the row's own source. A field is worth AT LEAST what the row
 * that wrote it is worth, and an absorbed stamp can only raise that.
 */
export function existingTierFor(
  canonicalData: Record<string, unknown> | null | undefined,
  provenance: Record<string, string> | null | undefined,
  key: string,
): number {
  const ownTier = tierFor(String(canonicalData?.source ?? '') || null);
  const stampedTier = tierFor(provenance?.[key]);
  return Math.max(ownTier, stampedTier);
}

/**
 * Fields that identify WHEN the run happened. An absorbed row may FILL these
 * when the canonical has none, but must never OVERWRITE them.
 *
 * Overwriting them rewrites the canonical's identity after the clustering that
 * chose it — the row moves to a different instant (or a different calendar
 * day), so the next merge pass no longer clusters it with the losers pointing
 * at it, the absorption that would repair the damage is never planned, and the
 * flags freeze in a state the engine disagrees with. Eight of David's days sit
 * in exactly that state; 2026-05-24 is the visible cost (canonical carries
 * `splits: []` while its loser holds the 12 real per-mile splits, because the
 * pair stopped clustering before the absorber could put them back).
 */
export const IDENTITY_FILL_ONLY = new Set<string>([
  'date', 'startLocal', 'startUtc', 'timezone',
]);

function tierFor(source: string | null | undefined): number {
  if (!source) return 0;
  return SOURCE_TIER[source] ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ARITHMETIC FAMILIES · THE FILL-WHEN-MISSING HOLE
 *
 * 2026-08-24. The tier ladder protects a field the canonical ALREADY HAS. It
 * does nothing for a field the canonical LACKS: the branch below reads
 * "Canonical field is missing · always populate", and always means always,
 * from any tier.
 *
 * That is how David's 2026-08-23 run ended up telling three different stories.
 * The watch row (tier 5) carried `durationSec` 5298 and `avgPaceMinPerMi`
 * "8:01" for 11.01 miles. It does NOT write `movingTimeS`, `paceSPerMi`,
 * `elapsedTimeS` or `avgSpeedMph` — see /api/watch/workouts/complete, which
 * writes `durationSec`, `movingSec`, `timeMoving` and `avgPaceMinPerMi` and
 * nothing else in this family. So when the Strava twin (tier 1) was absorbed:
 *
 *   durationSec       present on canonical → tier 1 < tier 5 → SKIPPED. Good.
 *   avgPaceMinPerMi   present on canonical → tier 1 < tier 5 → SKIPPED. Good.
 *   movingTimeS       absent  on canonical → "always populate" → 2389. Bad.
 *   paceSPerMi        absent  on canonical → "always populate" →  217. Bad.
 *   elapsedTimeS      absent  on canonical → "always populate" → 2389. Bad.
 *
 * Neither source was wrong. Strava's row was internally consistent at
 * 3:37/mi, the watch's at 8:01/mi. The canonical was built from half of each,
 * and no read could tell which half to believe because both halves came with
 * the same authority.
 *
 * THE RULE: a member of an arithmetic family may not enter a row from a source
 * that did not also supply the rest of the family. Provenance belongs to the
 * FAMILY, not to the field.
 *
 * The fill-when-missing branch therefore asks one more question: does the
 * canonical already hold a sibling of this family, from a source that outranks
 * the incoming one? If so the gap is left open, and the read-time reconciler
 * (lib/runs/coherence.ts) computes the missing member from the siblings that
 * agree. A gap the reconciler can fill beats a number that contradicts.
 *
 * Kept deliberately narrow — clock/pace/speed only. These are the members
 * bound by exact arithmetic, where one wrong entrant makes the whole row
 * unreadable. Splits, elevation and HR are absorbed as before: they have their
 * own guards (`splitsAreReal` above, `split-sanity.ts`, `elev-sanity.ts`) and
 * no cross-key arithmetic that a single field can break.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The keys bound by `pace × distance = time`, as one unit.
 *
 * Mirrors the `clock.*`, `pace.*` and `speed.*` entries in
 * `lib/runs/derived-registry.ts`. `distanceMi` is deliberately NOT here: it is
 * the family's shared denominator, present on 100% of rows, and never the
 * member that arrives alone.
 */
export const CLOCK_FAMILY = new Set<string>([
  'movingTimeS', 'movingSec', 'durationSec', 'elapsedTimeS',
  'paceSPerMi', 'avgPaceMinPerMi', 'avgSpeedMph', 'timeMoving',
]);

/**
 * Whether a MISSING field may be filled from this absorbed row.
 *
 * True for anything outside the clock family, and for a clock-family member
 * when the canonical holds no sibling that outranks the incoming source.
 *
 * Exported for `_canonical_family.test.ts`, which is the only reason it is not
 * a closure.
 */
export function familyGuardedFill(
  key: string,
  canonicalData: Record<string, unknown> | null | undefined,
  provenance: Record<string, string> | null | undefined,
  incomingTier: number,
): { allow: true } | { allow: false; blockedBy: string; siblingTier: number } {
  if (!CLOCK_FAMILY.has(key)) return { allow: true };
  const data = canonicalData ?? {};
  for (const sibling of CLOCK_FAMILY) {
    if (sibling === key) continue;
    const v = data[sibling];
    if (v == null || v === '') continue;
    const siblingTier = existingTierFor(data, provenance, sibling);
    if (siblingTier > incomingTier) {
      return { allow: false, blockedBy: sibling, siblingTier };
    }
  }
  return { allow: true };
}

/** Real per-mile splits = a non-empty array with at least one entry carrying a
 *  per-mile pace (under any historical key). Drives the Fix-4a tier-independent
 *  splits absorption: a watch row's whole-run "stub" (or no splits) is NOT real;
 *  the HK row's per-mile array is. */
function splitsAreReal(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.some((s) => s && typeof s === 'object' && (
    (s as Record<string, unknown>).pace != null
    || (s as Record<string, unknown>).paceSPerMi != null
    || (s as Record<string, unknown>).paceSecPerMi != null));
}

/**
 * Fields that live on the canonical row's `data` jsonb. Order doesn't matter
 * · we walk every key in the absorbed row and decide per key.
 *
 * Some keys are NEVER copied (metadata that's per-row, not per-run):
 *   id · primary key, never copy
 *   activityId · provider-specific, multiple providers will have different ones
 *   source · per-row, not per-run
 *   ingestedAt · per-row
 *   mergedIntoId · merge-engine bookkeeping
 *   client_workout_id · per-row
 */
const NEVER_COPY = new Set<string>([
  'id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId',
  'client_workout_id', 'absorbed_into_canonical_at',
]);

/**
 * Fields that need special routing rather than landing on `data`.
 */
const SPECIAL_ROUTE = new Set<string>([
  'gear', 'gear_id',         // → shoe_id via shoes match
  'perceived_exertion',      // → post_run_rpe row
  'rpe',                     // → post_run_rpe row (Strava sometimes uses 'rpe')
]);

export interface EnhanceResult {
  canonicalId: string;
  fieldsAdded: string[];
  fieldsSkipped: string[];
  shoeAttributed: number | null;
  rpeWritten: number | null;
}

/**
 * Walk an absorbed (dedup-loser) row's data and pull unique non-null fields
 * into the canonical. Updates provenance accordingly. Stamps
 * absorbed_into_canonical_at on the loser.
 *
 * Idempotent: re-running against an already-absorbed row is a no-op.
 */
export async function enhanceCanonicalFromAbsorbed(args: {
  canonicalId: string;
  absorbedRow: { id: string; data: Record<string, unknown>; user_uuid: string };
}): Promise<EnhanceResult> {
  const { canonicalId, absorbedRow } = args;
  const incomingSource = String(absorbedRow.data?.source ?? '');
  const incomingTier = tierFor(incomingSource);

  // Load canonical
  const canonical = (await pool.query<{
    id: string;
    data: Record<string, unknown>;
    provenance: Record<string, string>;
    shoe_id: number | null;
  }>(
    `SELECT id, data, provenance, shoe_id
       FROM runs
      WHERE id = $1::BIGINT`,
    [canonicalId],
  )).rows[0];

  if (!canonical) {
    return { canonicalId, fieldsAdded: [], fieldsSkipped: ['canonical not found'], shoeAttributed: null, rpeWritten: null };
  }

  const canonicalData = canonical.data ?? {};
  const canonicalProv = canonical.provenance ?? {};
  const incomingData = absorbedRow.data ?? {};

  const fieldsAdded: string[] = [];
  const fieldsSkipped: string[] = [];

  // Walk every key in the incoming row's data
  const updatedData: Record<string, unknown> = { ...canonicalData };
  const updatedProv: Record<string, string> = { ...canonicalProv };

  for (const key of Object.keys(incomingData)) {
    if (NEVER_COPY.has(key)) continue;
    if (SPECIAL_ROUTE.has(key)) continue;

    const incomingVal = incomingData[key];
    if (incomingVal == null || incomingVal === '' || (Array.isArray(incomingVal) && incomingVal.length === 0)) {
      continue;
    }

    const canonicalVal = canonicalData[key];
    const existingTier = existingTierFor(canonicalData, canonicalProv, key);

    // Fix 4a · splits are absorbed whenever the canonical lacks REAL per-mile
    // splits and the incoming row has them — TIER-INDEPENDENT — so the L7
    // decoupling / threshold-adherence signals are never silently starved
    // (a tier-5 watch canonical with no per-mile data takes the tier-2 HK
    //  row's real splits). Subsumes the old single-entry stub special-case.
    if (key === 'splits') {
      if (!splitsAreReal(canonicalVal) && splitsAreReal(incomingVal)) {
        updatedData[key] = incomingVal;
        updatedProv[key] = incomingSource;
        fieldsAdded.push('splits (absorbed real per-mile · tier-independent)');
        // 2026-08-21 · backend audit · THE FLAG DESCRIBED THE SPLITS WE JUST
        // REPLACED, so it cannot survive them.
        //
        // `splits_unreliable` is a verdict on one specific splits array.
        // /api/watch/workouts/complete sets it true and drops the array to []
        // when the derived per-mile times fail splitTimesReliable; it has no
        // path that ever sets it back to false (the iPhone ingest route does,
        // which is why only watch-canonical rows carry the stale flag). This
        // branch then fills the same row with REAL per-mile splits off the
        // HealthKit sibling — and left the old verdict sitting on top of the
        // new data.
        //
        // Four readers gate on it and all four silently drop the run:
        // lib/coach/pacing-discipline.ts (SQL `IS NOT TRUE` — the run leaves
        // the query entirely), lib/training/goal-projection.ts
        // (judgeTestPointExecution skips split-based judging),
        // lib/execution/reconstruct.ts, and /api/runs/[id]/recap. In prod
        // that is 6 canonical runs, among them a 13.13 mi and a 14.02 mi long
        // run — the longest efforts on the calendar, which is exactly where
        // pacing discipline is the signal worth having.
        //
        // Deleting rather than setting false: absent is what an untouched run
        // carries, and re-deriving a verdict here would mean re-running the
        // reliability check against an array this function did not compute.
        // `splits_validation` is the reconciliation that PRODUCED the verdict,
        // so it goes with it — leaving it behind would document a decision
        // about data the row no longer holds.
        if ('splits_unreliable' in updatedData || 'splits_validation' in updatedData) {
          delete updatedData.splits_unreliable;
          delete updatedData.splits_validation;
          delete updatedProv.splits_unreliable;
          delete updatedProv.splits_validation;
          fieldsAdded.push('splits_unreliable (cleared · verdict was about the replaced splits)');
        }
      } else {
        fieldsSkipped.push('splits (canonical already has real per-mile, or incoming has none)');
      }
      continue;
    }

    if (
      canonicalVal == null
      || canonicalVal === ''
      || (Array.isArray(canonicalVal) && canonicalVal.length === 0)
    ) {
      // Canonical field is missing · populate UNLESS it is one member of an
      // arithmetic family whose other members already came from a better
      // source. See familyGuardedFill above for the 2026-08-23 incident.
      const verdict = familyGuardedFill(key, canonicalData, canonicalProv, incomingTier);
      if (verdict.allow) {
        updatedData[key] = incomingVal;
        updatedProv[key] = incomingSource;
        fieldsAdded.push(key);
      } else {
        fieldsSkipped.push(
          key + ' (clock family · would contradict ' + verdict.blockedBy
          + ' at tier ' + verdict.siblingTier + ' from tier ' + incomingTier + ')',
        );
      }
    } else if (IDENTITY_FILL_ONLY.has(key)) {
      // Present already · an absorbed row never moves the run in time.
      fieldsSkipped.push(key + ' (identity field · fill-only, never overwritten)');
    } else if (incomingTier > existingTier) {
      // Higher tier wins · overwrite
      updatedData[key] = incomingVal;
      updatedProv[key] = incomingSource;
      fieldsAdded.push(key + ' (overwrote tier ' + existingTier + ' with tier ' + incomingTier + ')');
    } else {
      fieldsSkipped.push(key + ' (existing tier ' + existingTier + ' >= incoming tier ' + incomingTier + ')');
    }
  }

  // Special routing: the absorbed row's OWN shoe, then gear → shoe_id.
  //
  // 2026-08-21 · ingest audit · the shoe rides on a COLUMN, not on `data`, so
  // the field walk above never saw it and only the Strava `gear` object was
  // ever routed. A shoe the runner picked by hand therefore stayed on whatever
  // row was canonical when they picked it, and if the merge later promoted a
  // different row the pick went invisible: lib/shoe/mileage.ts sums canonical
  // rows only. Live cost — 16 of David's runs, 123.5 mi, all of them manual
  // picks (`shoe_auto_assigned_at IS NULL`), attributed to no shoe at all, so
  // every retirement number reads that much low.
  //
  // The loser's own shoe goes first because it is either the runner's pick or
  // an earlier auto-assign, both of which beat re-deriving one from gear text.
  // `shoe_auto_assigned_at` rides along so a manual pick stays marked manual —
  // that NULL stamp is what stops the day-level shoe route from overriding it.
  let shoeAttributed: number | null = null;
  if (canonical.shoe_id == null) {
    const moved = await pool.query<{ shoe_id: number }>(
      `UPDATE runs c
          SET shoe_id = l.shoe_id, shoe_auto_assigned_at = l.shoe_auto_assigned_at
         FROM runs l
        WHERE c.id = $1::BIGINT
          AND l.id = $2::BIGINT
          AND c.shoe_id IS NULL
          AND l.shoe_id IS NOT NULL
       RETURNING c.shoe_id`,
      [canonicalId, absorbedRow.id],
    ).catch(() => ({ rows: [] as Array<{ shoe_id: number }> }));
    const movedId = moved.rows[0]?.shoe_id;
    if (movedId != null) {
      canonical.shoe_id = movedId;
      shoeAttributed = movedId;
      fieldsAdded.push('shoe_id (from absorbed row ' + absorbedRow.id + ')');
    }
  }
  if (canonical.shoe_id == null) {
    const gear = (incomingData as Record<string, unknown>).gear;
    const gearId = (incomingData as Record<string, unknown>).gear_id;
    const shoeId = await tryAttributeShoe({
      userUuid: absorbedRow.user_uuid,
      gearObject: gear,
      gearId: typeof gearId === 'string' ? gearId : null,
    });
    if (shoeId != null) {
      await pool.query(
        `UPDATE runs SET shoe_id = $1 WHERE id = $2::BIGINT AND shoe_id IS NULL`,
        [shoeId, canonicalId],
      );
      shoeAttributed = shoeId;
      fieldsAdded.push('shoe_id (from ' + incomingSource + ' gear)');
    }
  }

  // Special routing: perceived_exertion / rpe → post_run_rpe
  let rpeWritten: number | null = null;
  const rpeRaw = (incomingData as Record<string, unknown>).perceived_exertion
    ?? (incomingData as Record<string, unknown>).rpe;
  if (typeof rpeRaw === 'number' && rpeRaw >= 1 && rpeRaw <= 10) {
    // Check if there's already an RPE row for this activity
    const existingRpe = (await pool.query(
      // A DEDUP READ, so narrowness fails OPEN: a miss here does not hide a
      // row, it writes a SECOND one for the same run. Match both user
      // columns for the same reason the writer does.
      `SELECT id FROM post_run_rpe
        WHERE (user_uuid = $1 OR user_id::text = $1::text) AND activity_id = $2
        LIMIT 1`,
      [absorbedRow.user_uuid, canonicalId],
    )).rows[0];
    if (!existingRpe) {
      await pool.query(
        `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
         VALUES ($1::text, $1::uuid, $2, $3, $4, NOW())`,
        [absorbedRow.user_uuid, canonicalId, Math.round(rpeRaw),
         `auto-imported from ${incomingSource}`],
      );
      rpeWritten = Math.round(rpeRaw);
      fieldsAdded.push('post_run_rpe row (from ' + incomingSource + ')');
    }
  }

  // Commit the data + provenance updates
  if (fieldsAdded.some(f => !f.includes('shoe_id') && !f.includes('post_run_rpe'))) {
    await pool.query(
      `UPDATE runs
          SET data = $1::jsonb, provenance = $2::jsonb
        WHERE id = $3::BIGINT`,
      [JSON.stringify(updatedData), JSON.stringify(updatedProv), canonicalId],
    );
  }

  // Stamp the absorbed row
  await pool.query(
    `UPDATE runs
        SET absorbed_into_canonical_at = NOW()
      WHERE id = $1::BIGINT
        AND absorbed_into_canonical_at IS NULL`,
    [absorbedRow.id],
  );

  return { canonicalId, fieldsAdded, fieldsSkipped, shoeAttributed, rpeWritten };
}

/**
 * Try to match a Strava gear payload against the runner's shoes.
 * Strava's gear object usually looks like:
 *   { id: 'g123', name: 'Nike Vomero 17', brand_name: 'Nike', model_name: 'Vomero 17' }
 *
 * Strategy:
 *   1. Exact brand + model match
 *   2. Loose match: brand match + model substring match
 *   3. No match · return null
 */
async function tryAttributeShoe(args: {
  userUuid: string;
  gearObject: unknown;
  gearId: string | null;
}): Promise<number | null> {
  const { userUuid, gearObject } = args;

  let brandQuery = '';
  let modelQuery = '';

  if (gearObject && typeof gearObject === 'object') {
    const g = gearObject as Record<string, unknown>;
    brandQuery = String(g.brand_name ?? g.brand ?? '').trim();
    modelQuery = String(g.model_name ?? g.model ?? g.name ?? '').trim();
  }

  if (!brandQuery && !modelQuery) return null;

  // Try exact match first
  if (brandQuery && modelQuery) {
    const exact = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes
        WHERE user_uuid = $1
          AND retired = false
          AND LOWER(brand) = LOWER($2)
          AND LOWER(model) = LOWER($3)
        LIMIT 1`,
      [userUuid, brandQuery, modelQuery],
    )).rows[0];
    if (exact) return exact.id;
  }

  // Loose: brand match + model substring
  if (brandQuery && modelQuery) {
    const loose = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes
        WHERE user_uuid = $1
          AND retired = false
          AND LOWER(brand) = LOWER($2)
          AND (LOWER(model) LIKE '%' || LOWER($3) || '%' OR LOWER($3) LIKE '%' || LOWER(model) || '%')
        LIMIT 1`,
      [userUuid, brandQuery, modelQuery],
    )).rows[0];
    if (loose) return loose.id;
  }

  return null;
}

/**
 * Diagnostic · returns the current source-tier rank table for visibility.
 */
export function explainTier(source: string): { source: string; tier: number; doctrineLine: string } {
  const tier = tierFor(source);
  const line = `${source} = tier ${tier} (Faff watch=5, Faff manual=4, Apple Watch=3, Apple Health=2, Strava=1)`;
  return { source, tier, doctrineLine: line };
}
