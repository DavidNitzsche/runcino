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
import {
  preserveMergedIntoIdSql, runMergedIntoIdSql, runNotMergedSql,
  runSourceSql, runSplitsSql,
} from '@/lib/runs/run-shape';
import { chooseSplits, type SplitCandidate } from '@/lib/runs/splits-adopt';
import { MAX_PAUSED_SHARE, MAX_DISPLAY_DRIFT_S_PER_MI } from '@/lib/runs/coherence';

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

  /* 2026-08-30 · THE FAMILY BELONGS TO THE ROW, REGARDLESS OF COVERAGE.
   *
   * This loop used to ask only whether some PRESENT sibling outranked the
   * incoming source, which left two holes the 2026-08-23 incident happened to
   * miss and a re-run would not:
   *
   *   · EQUAL TIER. `siblingTier > incomingTier` is strict, so a second
   *     tier-1 Strava row could fill a family member beside a first tier-1
   *     Strava row that disagreed with it.
   *   · A ROW WHOSE OWN SOURCE IS UNKNOWN. Seven of the owner's canonical
   *     rows carry no `source` at all, so every present sibling scores tier 0
   *     and ANY incoming source outranks it. The family could then be
   *     assembled from two different providers one key at a time — exactly
   *     the shape this guard exists to stop.
   *
   * The floor is now the row's own tier as well as its siblings'. A source may
   * contribute to this family only if it is at least as authoritative as the
   * row it is contributing to, whether or not the specific sibling it would
   * sit beside happens to be populated. `existingTierFor` already floors a
   * field at the row's own source, so asking it about `key` itself — the field
   * that is ABSENT — is precisely "what is this row's clock worth".
   */
  const rowFloor = existingTierFor(data, provenance, key);
  if (incomingTier < rowFloor) {
    // Only a refusal when there is actually a family here to contradict. A row
    // holding no clock at all has nothing for a lower-tier source to break,
    // and refusing there would leave a gap the reconciler cannot fill either.
    for (const sibling of CLOCK_FAMILY) {
      if (sibling === key) continue;
      const v = data[sibling];
      if (v == null || v === '') continue;
      return { allow: false, blockedBy: sibling, siblingTier: rowFloor };
    }
  }

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

/* ══════════════════════════════════════════════════════════════════════════
 * THE ROW-LOCAL CLOCK INVARIANT · WHAT WOULD HAVE REJECTED IT AT WRITE TIME
 *
 * 2026-08-30. The tier guard above is about WHO said a number. This is about
 * whether the number the row would then hold is possible. It makes no claim
 * about provenance and none about physiology — every test is a ratio between
 * two figures the row itself carries — so a source ladder that is wrong, or a
 * new provider nobody has tiered yet, cannot get past it.
 *
 * Deliberately the SAME arithmetic and the SAME constants as
 * `lib/runs/coherence.ts`, imported rather than restated. The reconciler
 * refuses this shape on the READ; this refuses it on the WRITE. Two guards
 * that disagreed about what "contradictory" means would be worse than one.
 *
 * Against the 2026-08-23 row, `movingTimeS: 2389` arriving beside the watch's
 * `durationSec: 5298` implies 54.9% of an eleven-mile run was paused, and
 * `paceSPerMi: 217` implies 16.6 mph. Both are refused here, and the run keeps
 * a coherent 8:01/mi.
 *
 * MEASURED: over the owner's 153 canonical rows this rejects exactly one —
 * 2026-08-23. The five rows where a Strava `paceSPerMi` sits 6-11% from
 * `durationSec/distanceMi` are NOT rejected, and must not be: that gap is
 * moving-time-versus-wall-clock, which is a real difference between two
 * correct measurements, not a contradiction. Only the members that are
 * arithmetically bound to each other are compared to each other.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The fastest average a stored `avgSpeedMph` may claim before it is a unit
 * error or a foreign clock rather than a run.
 *
 * 13 mph is 4:37/mi held for a whole session. The world record marathon
 * average is 13.1 mph and the 5000 m record is 14.1, so this cannot reject a
 * human running: it rejects a row whose speed came from arithmetic over the
 * wrong denominator. Not a doctrine constant — it prescribes nothing and
 * grades nobody, it is a unit sanity bound on a stored average.
 */
export const MAX_STORED_AVG_SPEED_MPH = 13;

/** Parse a stored clock-family scalar. Rejects '', NaN and non-numeric text. */
function clockNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Would `key = value` make this row contradict itself?
 *
 * Returns the reason, or null to allow. Checked against the row AS IT WOULD
 * BE — the candidate is merged in before the tests run, so a member is judged
 * on the row it would actually create.
 */
export function clockFamilyContradiction(
  canonicalData: Record<string, unknown> | null | undefined,
  key: string,
  value: unknown,
): string | null {
  if (!CLOCK_FAMILY.has(key)) return null;
  const d = { ...(canonicalData ?? {}), [key]: value };

  const distanceMi = clockNum(d.distanceMi);
  const durationSec = clockNum(d.durationSec);
  const movingTimeS = clockNum(d.movingTimeS) ?? clockNum(d.movingSec);

  // 1 · The two clocks. A run cannot move for longer than it lasted, and it
  //     cannot spend more than MAX_PAUSED_SHARE of itself stopped and still be
  //     one session. Same rule, same constant, as `reconcileRun`.
  if (durationSec != null && durationSec > 0 && movingTimeS != null && movingTimeS > 0) {
    const paused = 1 - movingTimeS / durationSec;
    if (paused < 0) {
      return `moving time ${movingTimeS}s exceeds the row's own elapsed clock ${durationSec}s`;
    }
    if (paused > MAX_PAUSED_SHARE) {
      return `moving time ${movingTimeS}s against an elapsed ${durationSec}s implies `
        + `${(paused * 100).toFixed(1)}% of the run was paused`;
    }
  }

  // 2 · The stored pace against the clock it belongs to. `paceSPerMi` is the
  //     MOVING pace on every row that carries both, so it is compared with the
  //     moving clock and never with `durationSec` — comparing it to the wall
  //     clock would reject five rows whose only sin is having stopped at a
  //     light. When no moving clock survives, the wall clock is the only
  //     denominator there is and a gross disagreement still counts.
  const paceSPerMi = clockNum(d.paceSPerMi);
  if (paceSPerMi != null && paceSPerMi > 0 && distanceMi != null && distanceMi > 0) {
    const basis = movingTimeS ?? durationSec;
    if (basis != null && basis > 0) {
      const implied = basis / distanceMi;
      if (Math.abs(paceSPerMi - implied) > MAX_DISPLAY_DRIFT_S_PER_MI) {
        return `paceSPerMi ${paceSPerMi.toFixed(0)}s/mi against this row's own `
          + `${implied.toFixed(0)}s/mi over ${distanceMi} mi`;
      }
    }
  }

  // 3 · Speed, as a unit check and as a cross-check on the pace it mirrors.
  const avgSpeedMph = clockNum(d.avgSpeedMph);
  if (avgSpeedMph != null && avgSpeedMph > MAX_STORED_AVG_SPEED_MPH) {
    return `avgSpeedMph ${avgSpeedMph} exceeds ${MAX_STORED_AVG_SPEED_MPH} mph — `
      + `not a running average`;
  }
  if (avgSpeedMph != null && avgSpeedMph > 0 && paceSPerMi != null && paceSPerMi > 0
      && Math.abs(3600 / avgSpeedMph - paceSPerMi) > MAX_DISPLAY_DRIFT_S_PER_MI) {
    return `avgSpeedMph ${avgSpeedMph} implies ${(3600 / avgSpeedMph).toFixed(0)}s/mi `
      + `against a stored pace of ${paceSPerMi.toFixed(0)}s/mi`;
  }

  return null;
}

/** Real per-mile splits = a non-empty array with at least one entry carrying a
 *  per-mile pace (under any historical key). Drives the Fix-4a tier-independent
 *  splits absorption: a watch row's whole-run "stub" (or no splits) is NOT real;
 *  the HK row's per-mile array is. */
export function splitsAreReal(v: unknown): boolean {
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
  /**
   * The absorption stamp was REFUSED because the invariant did not hold at the
   * moment of the write — see `mayStampAbsorbed`. Non-fatal by design (an
   * absorb refusal must never fail an ingest), but it is the tell for a
   * concurrent merge pass and the caller surfaces it.
   */
  stampRefused?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ABSORPTION INVARIANT · why the stamp is conditional
 *
 * 2026-08-30. `runs` carries two markers for "this row lost a dedup":
 *
 *     data->>'mergedIntoId'          a pointer to the row that won
 *     absorbed_into_canonical_at     a timestamp stamped at absorption
 *
 * They are one fact written in two places, and the invariant binding them is:
 *
 *     a row carrying the STAMP carries a POINTER, and that pointer names a row
 *     that is itself neither stamped nor pointing anywhere.
 *
 * Seven of the owner's runs broke it — stamped, no pointer, and the CANONICAL
 * row for their day with their own duplicates pointing correctly at them. 63.0
 * miles across ten weeks, including a peak 18.00 mi long run, in a state
 * nothing in the system could repair.
 *
 * The stamp used to be unconditional: `SET absorbed_into_canonical_at = NOW()
 * WHERE id = $1 AND absorbed_into_canonical_at IS NULL`. It asked whether the
 * row was already stamped and nothing else — not whether the row was still a
 * loser, not whether the row it supposedly lost to had itself since been
 * demoted. `autoMergeForDate` is called from FOUR live ingest paths plus the
 * nightly cron, all of which can fire for the same (user, date) at once, and
 * it applied its plan as three independent statements over a snapshot read
 * outside any transaction. So a pass whose snapshot said "R is the loser"
 * could land its stamp on R after a fresher pass had already promoted R and
 * stripped both of R's markers. R keeps the stamp; the pointer is gone; the
 * fresher pass has already pointed the real duplicates at R.
 *
 * merge.ts now serialises passes under an advisory lock, which closes the
 * window. This predicate closes the STATE: even if a pass somehow arrives
 * stale, a stamp it is not entitled to write is refused rather than written.
 * Two independent defences, because the cost of the state is silent mileage
 * loss and the cost of a refused stamp is one warning line.
 * ═══════════════════════════════════════════════════════════════════════ */

/** One side of the invariant, as the SQL sees it. `null` = absent. */
export interface AbsorptionStampContext {
  /** The loser's current `data->>'mergedIntoId'`. */
  loserMergedIntoId: string | null;
  /** The loser's current `absorbed_into_canonical_at`. */
  loserAbsorbedAt: string | null;
  /** The row we are absorbing INTO. */
  canonicalId: string;
  /** The canonical's current `data->>'mergedIntoId'` — must be absent. */
  canonicalMergedIntoId: string | null;
  /** The canonical's current `absorbed_into_canonical_at` — must be absent. */
  canonicalAbsorbedAt: string | null;
}

/**
 * May this absorption stamp be written?
 *
 * The JS mirror of the WHERE clause in `enhanceCanonicalFromAbsorbed`, so the
 * rule can be tested without a database and the SQL has exactly one thing to
 * agree with. Returns the reason for a refusal, or `null` to allow.
 *
 * `alreadyStamped` is NOT a refusal in the failure sense — it is the idempotent
 * re-run, and it was the only condition the pre-2026-08-30 statement checked.
 */
export function mayStampAbsorbed(
  ctx: AbsorptionStampContext,
): { allow: true } | { allow: false; reason: string; benign: boolean } {
  if (ctx.loserAbsorbedAt != null) {
    return { allow: false, reason: 'already stamped', benign: true };
  }
  if (ctx.loserMergedIntoId == null) {
    // The row is not a loser any more. A fresher merge pass promoted it and
    // stripped its pointer; stamping now mints the orphan.
    return { allow: false, reason: 'loser carries no mergedIntoId (promoted since this pass planned)', benign: false };
  }
  if (String(ctx.loserMergedIntoId) !== String(ctx.canonicalId)) {
    return { allow: false, reason: `loser points at ${ctx.loserMergedIntoId}, not ${ctx.canonicalId}`, benign: false };
  }
  if (ctx.canonicalMergedIntoId != null) {
    // Stamping here would record a loss to a row that has itself lost — the
    // chain the invariant forbids, and one step from a cycle.
    return { allow: false, reason: `canonical ${ctx.canonicalId} is itself merged into ${ctx.canonicalMergedIntoId}`, benign: false };
  }
  if (ctx.canonicalAbsorbedAt != null) {
    return { allow: false, reason: `canonical ${ctx.canonicalId} is itself absorbed`, benign: false };
  }
  return { allow: true };
}

/**
 * The SQL that mirrors `mayStampAbsorbed`. Exported so the invariant test can
 * assert the two never drift, and so this is provably the only shape that
 * writes the column.
 *
 * `$1` = loser id, `$2` = canonical id. The `->>` comparison against
 * `c.id::text` reads both jsonb spellings of the pointer (legacy rows wrote a
 * string, `merge.ts` writes a number) without a cast that could throw.
 */
export const STAMP_ABSORBED_SQL = `
  UPDATE runs AS l
     SET absorbed_into_canonical_at = NOW()
    FROM runs AS c
   WHERE l.id = $1::BIGINT
     AND c.id = $2::BIGINT
     AND l.absorbed_into_canonical_at IS NULL
     AND ${runMergedIntoIdSql('l')} = c.id::text
     AND ${runNotMergedSql('c')}
     AND c.absorbed_into_canonical_at IS NULL`;

/**
 * Every splits array that belongs to this run, from every sibling that lost
 * the dedup to it — plus the row being absorbed right now.
 *
 * WHY ALL OF THEM, when the absorber is handed one loser at a time: the
 * adoption ranks candidates against each other (count, then source tier), and
 * a ranking that can only see one candidate is not a ranking. With a per-loser
 * view, whichever admissible sibling merge.ts happened to walk first would
 * take the gaps and the tier tie-break would never run, so the same day could
 * resolve two different ways depending on ingest order. Reading them together
 * makes the outcome a function of the data.
 *
 * SCOPE, STATED (Rule 14) · the losers of ONE canonical row, by the pointer
 * `runMergedIntoIdSql` defines, never by `absorbed_into_canonical_at`. The
 * stamp answers a different question and filtering on it here would hide the
 * very siblings holding the missing miles.
 *
 * The incoming row is unioned in explicitly rather than relied on: merge.ts
 * commits the pointer transaction before calling the absorber, so it will
 * normally be in the query's result already, but the absorber is also called
 * from paths that have not necessarily flagged it yet, and a candidate that
 * silently vanished would be a Rule 11 failure dressed as a clean read.
 */
async function loadSiblingSplitCandidates(
  canonicalId: string,
  incomingId: string,
  incomingData: Record<string, unknown>,
  incomingSource: string,
): Promise<SplitCandidate[]> {
  const out: SplitCandidate[] = [];
  const seen = new Set<string>();
  try {
    const rows = (await pool.query<{ id: string; source: string | null; splits: unknown }>(
      `SELECT id::text AS id, ${runSourceSql()} AS source, ${runSplitsSql()} AS splits
         FROM runs
        WHERE ${runMergedIntoIdSql()} = $1::text
          AND jsonb_typeof(${runSplitsSql()}) = 'array'`,
      [String(canonicalId)],
    )).rows;
    for (const r of rows) {
      seen.add(String(r.id));
      out.push({ source: r.source, raw: r.splits });
    }
  } catch (err) {
    // A failed read is NOT "no siblings" (Rule 11). Returning [] here would
    // silently disable the adoption and look identical to a clean run, so the
    // failure is surfaced and the incoming row alone is still considered —
    // which is exactly the old behaviour, never worse than it.
    console.warn('[canonical] sibling splits read failed for', canonicalId, '→', err);
  }
  if (!seen.has(String(incomingId))) {
    out.push({ source: incomingSource || null, raw: incomingData.splits });
  }
  return out;
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
      /* 2026-08-30 · A PARTIAL ARRAY USED TO BLOCK ADOPTION ENTIRELY.
       *
       * The condition was `!splitsAreReal(canonicalVal)`, so present-but-short
       * read as present and the absorber walked away from a sibling holding
       * the miles the canonical was missing — 21 canonical rows, always losing
       * from the END, which for this runner is the fast-finish segment.
       *
       * `chooseSplits` (lib/runs/splits-adopt.ts) now decides, and it decides
       * over ALL of this canonical's siblings at once rather than only the one
       * being absorbed. That is what makes the outcome independent of the
       * order merge.ts happens to walk the losers in: with a per-loser view,
       * whichever admissible sibling arrived first would take the gaps and the
       * tier tie-break would never be consulted. See that module's header for
       * the ranking and for why the winner is not simply the longest array.
       */
      const adoption = chooseSplits(
        canonicalVal,
        await loadSiblingSplitCandidates(canonicalId, absorbedRow.id, incomingData, incomingSource),
        Number(canonicalData.distanceMi),
        tierFor,
      );
      if (adoption.splits != null) {
        updatedData[key] = adoption.splits;
        // The array is now a union, so the provenance stamp names the source
        // the ADDED miles came from. Stamping it as though one source supplied
        // the whole array would be a claim the row cannot support.
        updatedProv[key] = adoption.adoptedFrom ?? incomingSource;
        fieldsAdded.push(
          `splits (+${adoption.milesAdded.length} mile(s) [${adoption.milesAdded.join(',')}] `
          + `from ${adoption.adoptedFrom ?? 'unknown'})`);
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
        // Rule 11 · say WHICH of the three this was. "No candidate was richer"
        // and "a richer candidate was refused because it decomposes a
        // different distance" are different facts about this row, and only the
        // second is worth a human looking at.
        fieldsSkipped.push(
          'splits (no adoption · '
          + (adoption.refusals.map((r) => `${r.source ?? 'incumbent'}:${r.reason}`).join(', ')
             || 'nothing richer available')
          + ')');
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
      if (!verdict.allow) {
        fieldsSkipped.push(
          key + ' (clock family · would contradict ' + verdict.blockedBy
          + ' at tier ' + verdict.siblingTier + ' from tier ' + incomingTier + ')',
        );
      } else {
        // The second, source-independent net. Even a source entitled to
        // contribute to this family may not contribute a value the row's own
        // arithmetic disproves — a tier ladder cannot catch a provider that is
        // simply wrong, and 2026-08-23's Strava row was internally correct
        // about a clock this run did not have.
        const contradiction = clockFamilyContradiction(updatedData, key, incomingVal);
        if (contradiction) {
          fieldsSkipped.push(key + ' (clock family · row-local invariant · ' + contradiction + ')');
        } else {
          updatedData[key] = incomingVal;
          updatedProv[key] = incomingSource;
          fieldsAdded.push(key);
        }
      }
    } else if (IDENTITY_FILL_ONLY.has(key)) {
      // Present already · an absorbed row never moves the run in time.
      fieldsSkipped.push(key + ' (identity field · fill-only, never overwritten)');
    } else if (incomingTier > existingTier) {
      // Higher tier wins · overwrite, unless the resulting row would disprove
      // itself. Outranking the incumbent is permission to replace a value, not
      // permission to make the row incoherent.
      const contradiction = clockFamilyContradiction(updatedData, key, incomingVal);
      if (contradiction) {
        fieldsSkipped.push(key + ' (clock family · row-local invariant · ' + contradiction + ')');
      } else {
        updatedData[key] = incomingVal;
        updatedProv[key] = incomingSource;
        fieldsAdded.push(key + ' (overwrote tier ' + existingTier + ' with tier ' + incomingTier + ')');
      }
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

  // Commit the data + provenance updates.
  //
  // Rule 6 · `updatedData` is built from a SNAPSHOT of the canonical read at
  // the top of this function, and everything between here and there is another
  // await. A full `SET data = $1` would therefore write back whatever
  // `mergedIntoId` state the snapshot happened to hold, and a concurrent merge
  // pass that flagged this row in the meantime would have its pointer erased —
  // while `absorbed_into_canonical_at`, a COLUMN, survived untouched. That is
  // one of the two ways the orphan stamp was minted.
  //
  // The pointer is never this function's to write: `mergedIntoId` is in
  // NEVER_COPY, so the payload has no opinion about it. The CASE takes the
  // live row's answer in both directions — preserve a pointer that arrived
  // after the snapshot, and do not resurrect one that left after it.
  if (fieldsAdded.some(f => !f.includes('shoe_id') && !f.includes('post_run_rpe'))) {
    await pool.query(
      `UPDATE runs
          SET data = ${preserveMergedIntoIdSql('$1')},
              provenance = $2::jsonb
        WHERE id = $3::BIGINT`,
      [JSON.stringify(updatedData), JSON.stringify(updatedProv), canonicalId],
    );
  }

  // Stamp the absorbed row — only if it is still entitled to the stamp.
  // See the ABSORPTION INVARIANT block above for what this refuses and why.
  let stampRefused: string | undefined;
  const stamped = await pool.query(STAMP_ABSORBED_SQL, [absorbedRow.id, canonicalId]);
  if ((stamped.rowCount ?? 0) === 0) {
    const ctx = (await pool.query<{
      lm: string | null; la: string | null; cm: string | null; ca: string | null;
    }>(
      `SELECT ${runMergedIntoIdSql('l')}         AS lm,
              l.absorbed_into_canonical_at::text AS la,
              ${runMergedIntoIdSql('c')}         AS cm,
              c.absorbed_into_canonical_at::text AS ca
         FROM runs l LEFT JOIN runs c ON c.id = $2::BIGINT
        WHERE l.id = $1::BIGINT`,
      [absorbedRow.id, canonicalId],
    )).rows[0];
    const verdict = mayStampAbsorbed({
      loserMergedIntoId: ctx?.lm ?? null,
      loserAbsorbedAt: ctx?.la ?? null,
      canonicalId,
      canonicalMergedIntoId: ctx?.cm ?? null,
      canonicalAbsorbedAt: ctx?.ca ?? null,
    });
    if (!verdict.allow && !verdict.benign) {
      stampRefused = verdict.reason;
      // Loud, and never thrown: refusing the stamp is the CORRECT outcome of a
      // stale pass. What must not happen is refusing it silently, because then
      // the only trace of a concurrent-merge collision is a number that no
      // longer matches the plan.
      console.warn(
        `[canonical] absorption stamp REFUSED · loser=${absorbedRow.id} ` +
        `canonical=${canonicalId} · ${verdict.reason}`,
      );
    }
  }

  return { canonicalId, fieldsAdded, fieldsSkipped, shoeAttributed, rpeWritten, stampRefused };
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
