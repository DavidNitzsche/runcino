/**
 * max-hr.ts · canonical effective-max-HR resolution for any user.
 *
 * Single source of truth so every downstream reader (zone math, HRR
 * percentages, run-gate, projection snapshots, race header, coach
 * engine) sees the same number for the same runner on the same day.
 *
 * Doctrine (Joel Friel / Research/03 §HRmax):
 *
 *   HRmax is a physiological ceiling that doesn't drift much
 *   year-over-year for trained runners. Use the highest verified
 *   value from a hard effort in the last 12 months. A 30-day window
 *   is too short · most runners don't max-out monthly.
 *
 * Resolution order:
 *
 *   1. users.max_hr_override · explicit user setting · sovereign — CAN'T be
 *      overridden by observation OR by inference · user knows their
 *      physiology best. Wins outright and skips everything below.
 *
 *   2/3. Two EMPIRICAL/INFERENTIAL candidates, each taking the GREATER of
 *      itself and rung "2.5" below rather than returning early:
 *        2. Hybrid 12-month rolling MAX from health_samples.max_hr
 *           (HealthKit daily summary) and runs.data.maxHr (race / interval
 *           peak from watch + Strava) · GREATEST of the two, race efforts
 *           often produce higher peaks than HealthKit's daily rollup.
 *        3. users.max_hr · the stored value from manual entry. Fallback
 *           for runners with no HealthKit / runs history, and (unlike
 *           before 2026-08-31) still eligible to be lifted by rung 2.5.
 *      Rung 2 outranks rung 3 in PRECEDENCE when both exist — that part is
 *      unchanged — but rung 2.5 competes with whichever of them is on the
 *      table BY VALUE.
 *
 *   2.5. LTHR-IMPLIED FLOOR (2026-08-31) · a fresh, representative
 *      `profile.lthr` implies a conservative HRmax floor via the Research/03
 *      Threshold crosswalk (see `LTHR_TO_HRMAX_CONSERVATIVE_PCT`'s own
 *      header for the full derivation and the defect it closes). Only ever
 *      LIFTS rung 2 or 3 — never displaces a higher empirical reading, and
 *      never competes with rung 1's sovereign override.
 *
 *   4. null · cold start. Downstream falls back to age-derived
 *      estimate or LTHR-anchored zones.
 *
 * Generic mechanism: works for any user. No hardcoded values.
 */
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
// Pure leaf, zero imports (see that file's own header) — safe to pull into
// any graph, server or client, which is exactly why the LTHR re-test cadence
// lives there and not in lib/training/lthr-reanchor.ts.
import { LTHR_RETEST_CADENCE_DAYS } from '@/lib/training/lthr-cadence';

/**
 * 2026-08-25 · THE PLAUSIBILITY BAND FOR AN OBSERVED HRmax, NAMED ONCE.
 *
 * 100-230 bpm was already hardcoded four times in this file — the override
 * check, the `runs` aggregate, the stored-manual check, and the implicit
 * `>= 100` on the merged observation — and NOT AT ALL on the `health_samples`
 * aggregate, which is the branch a HealthKit import writes to. A constant
 * repeated by hand at four sites and forgotten at the fifth is how the fifth
 * happens; naming it is what makes the omission visible.
 *
 * This is a sanity band, not a doctrine claim. It says "no human running
 * outdoors has a max heart rate outside this", which is what you need to
 * reject a strap artefact. The doctrine claim in this file is the 12-month
 * window (Research/03 §HRmax), which is cited in the header and unchanged.
 *
 * The band is deliberately generous at both ends. It exists to reject
 * impossible values, not to second-guess an unusual runner.
 */
export const MAX_HR_FLOOR_BPM = 100;
export const MAX_HR_CEILING_BPM = 230;

/** True when `bpm` is a number a human heart could actually have produced. */
export function isPlausibleMaxHr(bpm: unknown): boolean {
  const n = Number(bpm);
  return Number.isFinite(n) && n >= MAX_HR_FLOOR_BPM && n <= MAX_HR_CEILING_BPM;
}

/**
 * 2026-08-28 · age-aware plausibility ceiling for an OBSERVED HRmax reading.
 *
 * PRODUCT HEURISTIC, not doctrine. The research corpus has no derivation rule
 * for an observed HRmax; the closest statement is C7-ancillary.md:461 in the
 * BuildResearch directory ("Fitness baselines" table: Max HR = "Highest
 * 10-sec HR in last 90 days, capped at age-predicted + 10"). This constant is that idea with slightly
 * more headroom: reject a reading above (220 − age + 15), and above 230 bpm
 * regardless of age. The +15 exists because age formulas carry ±10-12 bpm SD
 * (Research/03-heart-rate-zones.md, "### Accuracy and Standard Error") — a
 * real runner two SDs above the formula must not have their genuine ceiling
 * rejected as an artefact. 220 − age appears here ONLY as a rejection bound
 * for garbage, never as a zone anchor — zones use Tanaka
 * (Research/REVIEW_NOTES.md: never default to 220 − age).
 *
 * Null/implausible age → the flat 230 band (the pre-existing behavior).
 */
export function maxHrPlausibilityCeiling(age: number | null | undefined): number {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 10 || a > 100) return MAX_HR_CEILING_BPM;
  return Math.min(220 - Math.round(a) + 15, MAX_HR_CEILING_BPM);
}

/**
 * 2026-08-31 · THE LTHR-IMPLIED FLOOR FOR "OBSERVED" HRmax.
 *
 * ── The defect ──────────────────────────────────────────────────────────
 *
 * Rung 2 below resolves "the highest verified value from a hard effort in
 * the last 12 months" (the header doctrine), which is the correct question
 * — but for a runner who has not done a genuinely maximal effort (an
 * all-out sprint finish, a VO2max test) in that window, "highest observed"
 * silently becomes "true ceiling" when it is actually a FLOOR. Verified
 * against prod 2026-08-31: the owner's effective max HR resolves to 180
 * (health_samples=180, runs.data.maxHr=179), sourced entirely from training
 * runs and a half marathon at threshold — none of which reach HRmax by
 * definition. His `profile.lthr` is 168, re-anchored 2026-08-30 from the
 * Americas Finest City half (`profile.lthr_method =
 * 'race_half · Americas Finest City · 2026-08-16'`, tier 'representative').
 *
 * That understates every %HRmax-gated computation in the app — zones, the
 * overexertion/readiness guards, and any evidence classifier that reads
 * %HRmax to decide whether a run was "easy" or "threshold." A run at
 * 155 bpm reads as 86% of a 180 ceiling (threshold-zone) but only 83% of a
 * 187 ceiling (comfortably aerobic) — the actual mechanism by which a real
 * easy run misclassifies as hard.
 *
 * ── The doctrine, combined ─────────────────────────────────────────────
 *
 * `Research/03-heart-rate-zones.md` §"Conversion Between Systems" gives the
 * Threshold crosswalk as one line naming BOTH fractions at once:
 *
 *   %HRmax 86-92% ~ %HRR 83-90% ~ %LTHR 95-102% ~ Daniels T
 *
 * LTHR is itself DEFINED (§6, "Why LTHR-Based Zones") as the HR at the
 * lactate threshold — i.e. at a T-effort, HR is approximately LTHR by
 * construction, which is exactly what the %LTHR 95-102% straddling 100%
 * says. Combined with the %HRmax band on the same line:
 *
 *   HRmax ~ LTHR / (0.86 to 0.92)
 *
 * For LTHR=168 that spans a CONSERVATIVE 168/0.92 ~ 182.6 to an aggressive
 * 168/0.86 ~ 195.3.
 *
 * ── Why the conservative (92%) end, not the midpoint or the aggressive end
 *
 * This number sets the ceiling every %HRmax-gated guard reads. Lifting it
 * TOO FAR would make a genuinely hard effort read as artificially easy,
 * which is a real safety concern for the guards that read %HRmax — the
 * exact opposite failure from the one being fixed. Dividing by the HIGH end
 * of the %HRmax-at-T band (92%) gives the SMALLER of the two implied
 * values, which is still real correction (182.6 > the observed 180, which
 * is what makes 180 wrong) without swinging to the aggressive end doctrine
 * itself flags as the outer edge of the same crosswalk line.
 *
 * Bound by `HR.lthr-implied-maxhr-conservative-floor`, which parses the
 * %HRmax band's own ceiling out of the doc's crosswalk line at run time.
 */
export const LTHR_TO_HRMAX_CONSERVATIVE_PCT = 0.92;

/**
 * The HRmax a fresh, representative LTHR implies at the conservative
 * (92%-of-HRmax) end of the Threshold crosswalk. Pure, null-safe, and
 * bounded by the same physiological plausibility band every other rung in
 * this file uses — a garbage LTHR must not produce a garbage floor.
 */
export function hrMaxImpliedByLthr(lthrBpm: number | string | null | undefined): number | null {
  const n = Number(lthrBpm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const implied = Math.round(n / LTHR_TO_HRMAX_CONSERVATIVE_PCT);
  return isPlausibleMaxHr(implied) ? implied : null;
}

/**
 * True when a stored LTHR is inside Friel's re-test cadence — the same
 * shelf-life `lib/training/lthr-reanchor.ts` already judges staleness
 * against (`Research/03` §6, "Re-test every 6-12 weeks," ceiling read as
 * `LTHR_RETEST_CADENCE_DAYS`). A stale anchor licenses nothing: an LTHR the
 * runner has long since out-trained (or under-trained) is not a floor on
 * today's physiology. Reused rather than re-derived so the profile tile's
 * stale marker and this floor agree on the same number by construction.
 */
export function lthrFloorIsFresh(
  setAtISO: string | null | undefined,
  todayISO: string,
): boolean {
  if (!setAtISO) return false;
  const a = Date.parse(String(setAtISO).slice(0, 10) + 'T12:00:00Z');
  const b = Date.parse(String(todayISO).slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const ageDays = Math.round((b - a) / 86400000);
  return ageDays >= 0 && ageDays <= LTHR_RETEST_CADENCE_DAYS;
}

/** An empirical/inferential candidate for the effective max HR — the two
 *  rungs an LTHR-implied floor is allowed to compete with (never the
 *  sovereign override). */
export interface MaxHrCandidate {
  bpm: number;
  source: 'observed_12mo' | 'manual_stored';
  observedFrom: 'health_samples' | 'runs' | null;
}

/**
 * Take the GREATER of an empirical candidate and the LTHR-implied floor.
 * Pure, so the merge rule is unit-testable without a database — the LTHR
 * floor may only LIFT the ceiling, never pull it down below a real reading,
 * per the file header's `4. PROVENANCE PRECEDENCE`-style reasoning: an
 * empirical observation is never silently discarded, only beaten by a
 * larger one.
 */
export function mergeWithLthrFloor(
  baseline: MaxHrCandidate | null,
  lthrFloorBpm: number | null,
): { bpm: number | null; source: EffectiveMaxHr['source']; observedFrom: 'health_samples' | 'runs' | null } {
  if (lthrFloorBpm != null && (baseline == null || lthrFloorBpm > baseline.bpm)) {
    return { bpm: lthrFloorBpm, source: 'lthr_implied', observedFrom: null };
  }
  if (baseline) {
    return { bpm: baseline.bpm, source: baseline.source, observedFrom: baseline.observedFrom };
  }
  return { bpm: null, source: 'unknown', observedFrom: null };
}

export interface EffectiveMaxHr {
  /** The number to use everywhere. */
  bpm: number | null;
  /** Where it came from. Drives the doctrine surface ("based on your
   *  override" vs "based on observed efforts over the last year"). */
  source: 'user_override' | 'observed_12mo' | 'manual_stored' | 'lthr_implied' | 'unknown';
  /** When source === 'observed_12mo', which sample type produced the
   *  ceiling. Helps debug + lets the UI show "from your race on
   *  2026-04-12" eventually. */
  observedFrom: 'health_samples' | 'runs' | null;
  /**
   * 2026-08-31 · Rule 10 (a persisted derived value carries its anchor).
   * Set whenever a fresh, representative LTHR produced a competing floor —
   * regardless of whether it WON the merge — so a UI or a future auditor
   * can always see the competing number, not just the winner. Null when no
   * usable LTHR anchor existed for this resolution (absent, or stale past
   * the re-test cadence).
   */
  lthrFloorBpm: number | null;
  /**
   * The `profile.lthr` value and its `lthr_set_at` date that produced
   * `lthrFloorBpm` — the anchor itself, not just the number derived from
   * it. Null exactly when `lthrFloorBpm` is null. This resolver is called
   * fresh on every read (never persisted-and-frozen), which is the
   * "recompute" posture Rule 10 asks for; carrying the anchor here is what
   * lets a caller that DOES persist something downstream (e.g. a snapshot
   * column) stamp `{anchor, value, at}` instead of a bare number.
   */
  lthrAnchor: { lthrBpm: number; setAtISO: string | null } | null;
}

/**
 * Resolve the effective max HR for a user as of today.
 *
 * @param userId UUID string
 * @param today  YYYY-MM-DD anchor for the 12-month rolling window
 */
export async function loadEffectiveMaxHr(
  userId: string,
  todayArg?: string,
): Promise<EffectiveMaxHr> {
  // 2026-06-03 · default to runner TZ instead of server UTC.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = todayArg ?? await runnerToday(userId);
  // 2026-08-21 perf · three queries per call, and a render resolves the same
  // (user, day) max-HR more than once. Request-scoped only; the returned
  // record is read-only at every call site. See lib/runtime/request-memo.ts.
  const { memo } = await import('@/lib/runtime/request-memo');
  return memo(`maxHr:${userId}:${today}`, () => resolveEffectiveMaxHr(userId, today));
}

async function resolveEffectiveMaxHr(
  userId: string,
  today: string,
): Promise<EffectiveMaxHr> {
  // 1. Override always wins.
  const overrideRow = await pool.query<{ ovr: number | string | null; stored: number | string | null }>(
    `SELECT max_hr_override AS ovr, max_hr AS stored FROM users WHERE id = $1`,
    [userId],
  ).then((r) => r.rows[0]);

  if (overrideRow?.ovr != null) {
    const bpm = Number(overrideRow.ovr);
    if (Number.isFinite(bpm) && bpm >= 100 && bpm <= 230) {
      // Sovereign. A human said "this is my max" — not something an LTHR
      // inference gets to compete with, let alone overrule. See the file
      // header's rung-1 doctrine.
      return { bpm: Math.round(bpm), source: 'user_override', observedFrom: null, lthrFloorBpm: null, lthrAnchor: null };
    }
  }

  // 2. Hybrid 12-month observed max from health_samples + runs.
  //    Compute both sources independently so we know which "won."
  //
  // 2026-08-28 · the ceiling is age-aware where age is known (see
  // maxHrPlausibilityCeiling — a PRODUCT HEURISTIC, headroom over the
  // C7-ancillary "age-predicted + 10" cap). A 40-year-old's 212 bpm strap
  // artefact used to pass the flat 230 band and, because the ratchet is
  // monotone UP with a 365-day memory, set their ceiling for a year.
  // rowOrNull: a failed age read degrades to the flat 230 band (the
  // pre-existing behavior), logged rather than swallowed.
  const ageRow = await rowOrNull<{ age: number | string | null }>(
    'max-hr · profile age for plausibility ceiling',
    pool.query(
      `SELECT COALESCE(EXTRACT(YEAR FROM age(birthday))::int, age) AS age
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ),
  );
  const ceilingBpm = maxHrPlausibilityCeiling(
    ageRow?.age != null ? Number(ageRow.age) : null,
  );

  const [hkRow, runsRow, lthrRow] = await Promise.all([
    pool.query<{ value: number | string | null }>(
      // 2026-08-25 · THE SAME PHYSIOLOGICAL BAND THE `runs` BRANCH BELOW HAS
      // ALWAYS HAD. This branch had none.
      //
      // Every heart-rate zone and every HR-derived pace in the app descends
      // from this number, and the ratchet that stores it is monotone UP with a
      // 365-day memory and no history row. So one absurd HealthKit `max_hr`
      // sample — a strap artefact, a cadence lock, a bad import — set the
      // runner's ceiling for a year, invisibly and irreversibly except by
      // typing an override.
      //
      // The `>= 100` check below caught garbage that was too LOW and let
      // through anything too HIGH, which is the wrong half: the ratchet only
      // moves upward, so high garbage is the only kind that sticks.
      //
      // Bounded in SQL rather than in JS on purpose. `MAX()` picks the winner
      // inside the database, so a value filtered afterwards has already won;
      // it has to be excluded before the aggregate sees it.
      //
      // Verified against prod 2026-08-25: `health_samples` does hold
      // out-of-band `max_hr` rows (81, 84, 86, 88, 90, 94, 97). All of them
      // happen to be low, so nothing has stuck yet. The guard was absent, not
      // merely untested.
      `SELECT COALESCE(MAX(value::numeric), 0) AS value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'max_hr'
          AND value::numeric BETWEEN ${MAX_HR_FLOOR_BPM} AND $3::numeric
          AND sample_date >= ($2::date - interval '365 days')`,
      [userId, today, ceilingBpm],
    ).then((r) => r.rows[0]),
    pool.query<{ value: number | string | null }>(
      `SELECT COALESCE(MAX((data->>'maxHr')::numeric), 0) AS value FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND data->>'maxHr' IS NOT NULL
          AND (data->>'maxHr')::numeric BETWEEN ${MAX_HR_FLOOR_BPM} AND $3::numeric
          AND (data->>'date')::date >= ($2::date - interval '365 days')`,
      [userId, today, ceilingBpm],
    ).then((r) => r.rows[0]),
    // 2026-08-31 · the LTHR anchor this floor competes against. A failed read
    // degrades to "no floor available" — the same posture `ageRow` above
    // takes — rather than blocking the pre-existing observed/manual cascade.
    rowOrNull<{ lthr: number | string | null; lthr_set_at: string | null }>(
      'max-hr · profile LTHR for the implied-floor rung',
      pool.query(
        `SELECT lthr, lthr_set_at::date::text AS lthr_set_at
           FROM profile WHERE user_uuid = $1 LIMIT 1`,
        [userId],
      ),
    ),
  ]);

  const hkMax = Number(hkRow?.value ?? 0);
  const runsMax = Number(runsRow?.value ?? 0);
  // 2026-08-25 · belt to the SQL band's braces. Both aggregates are bounded
  // now, so this cannot fire; it is here because the number leaving this
  // function sets every HR zone the runner trains to, and "cannot fire" is
  // what was true of the `runs` branch while the `health_samples` branch
  // beside it had no bound at all.
  const observedBaseline: MaxHrCandidate | null =
    hkMax >= MAX_HR_FLOOR_BPM || runsMax >= MAX_HR_FLOOR_BPM
      ? (() => {
          const observed = Math.max(hkMax, runsMax);
          return isPlausibleMaxHr(observed)
            ? { bpm: Math.round(observed), source: 'observed_12mo' as const, observedFrom: (runsMax >= hkMax ? 'runs' : 'health_samples') as 'runs' | 'health_samples' }
            : null;
        })()
      : null;

  // 2026-08-31 · rung 2.5 — the LTHR-implied floor (see the constant's own
  // header comment above for the doctrine and the conservatism argument).
  // Computed once, competes against BOTH the observed_12mo candidate above
  // and the manual_stored candidate below — an empirical/inferential rung
  // either way, unlike the sovereign override.
  const lthrFresh = lthrFloorIsFresh(lthrRow?.lthr_set_at, today);
  const lthrFloorBpm = lthrFresh ? hrMaxImpliedByLthr(lthrRow?.lthr) : null;
  const lthrAnchor =
    lthrFloorBpm != null && lthrRow?.lthr != null
      ? { lthrBpm: Number(lthrRow.lthr), setAtISO: lthrRow?.lthr_set_at ?? null }
      : null;

  // 3. Stored manual value — computed here (not returned early) so it can
  // compete with the LTHR floor exactly the way observed_12mo does.
  let manualCandidate: MaxHrCandidate | null = null;
  if (overrideRow?.stored != null) {
    const bpm = Number(overrideRow.stored);
    if (Number.isFinite(bpm) && bpm >= 100 && bpm <= 230) {
      manualCandidate = { bpm: Math.round(bpm), source: 'manual_stored', observedFrom: null };
    }
  }

  // observed_12mo outranks manual_stored in PRECEDENCE (unchanged from
  // before this fix) — but the LTHR floor competes with whichever of the two
  // is on the table BY VALUE, per `mergeWithLthrFloor`'s own doc comment.
  const baseline = observedBaseline ?? manualCandidate;
  const merged = mergeWithLthrFloor(baseline, lthrFloorBpm);
  if (merged.bpm != null) {
    return { ...merged, lthrFloorBpm, lthrAnchor };
  }

  // 4. Cold start.
  return { bpm: null, source: 'unknown', observedFrom: null, lthrFloorBpm, lthrAnchor };
}

/**
 * Background ratchet · idempotent. Updates users.max_hr to the
 * 12-month observed ceiling so downstream reads that bypass
 * loadEffectiveMaxHr() (legacy code paths, raw SQL pulls) still see
 * a sensible recent value. Does NOT touch max_hr_override.
 *
 * Safe to call from cron · ratchets up only when observed exceeds
 * stored, so a low-effort week never drags the stored value down.
 *
 * 2026-08-31 · widened to also ratchet on `lthr_implied`. Before the LTHR
 * floor existed this only ever fired on `observed_12mo`, and that was the
 * whole cascade an inferential rung could win from. Now that an LTHR-implied
 * floor can legitimately win the resolver's live cascade (see `max-hr.ts`
 * header + `mergeWithLthrFloor`), a legacy raw-SQL reader of `users.max_hr`
 * would otherwise stay pinned at the stale lower number forever — the exact
 * "recompute vs. frozen snapshot" gap Rule 10 exists to close. `manual_stored`
 * stays excluded: it is already what `users.max_hr` holds, so ratcheting off
 * it would be writing a value back onto itself.
 *
 * Returns the new value if a write happened, null otherwise.
 */
export async function ratchetUsersMaxHr(
  userId: string,
  todayArg?: string,
): Promise<number | null> {
  // 2026-06-03 · runner TZ default.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = todayArg ?? await runnerToday(userId);
  const eff = await loadEffectiveMaxHr(userId, today);
  if ((eff.source !== 'observed_12mo' && eff.source !== 'lthr_implied') || eff.bpm == null) return null;

  // GREATEST ensures we only ratchet up · never down.
  // Skip when override is set (override is sovereign).
  const r = await pool.query<{ new_max: number | string | null }>(
    `UPDATE users
        SET max_hr = GREATEST(COALESCE(max_hr, 0), $1::int)
      WHERE id = $2 AND max_hr_override IS NULL
      RETURNING max_hr AS new_max`,
    [eff.bpm, userId],
  );

  // 2026-08-28 · mirror the observed ceiling onto profile.hrmax_observed.
  // Same reasoning as users.max_hr above: loadEffectiveMaxHr stays the
  // canonical resolver every live read goes through, but raw-SQL readers and
  // diagnostics that SELECT the profile row directly (scripts/_q_david.sql,
  // admin views, the iPhone gap check in TodayView) had been reading a column
  // NOTHING wrote — NULL since the Cluster 3 deprecation moved the sovereign
  // path to users.max_hr_override. A snapshot column that is refreshed
  // nightly is honest; one that is never written is a trap. (When an override
  // is set the resolver short-circuits before computing the observed ceiling,
  // so this snapshot — like the users.max_hr ratchet above — only advances
  // for runners without an override. The override user's live reads all go
  // through the resolver anyway.)
  // attempt: non-fatal (the users.max_hr ratchet above already landed) but
  // logged — a snapshot that silently stops writing is the bug this exists
  // to fix. A missing profile row is rowCount 0, not an error.
  await attempt(
    'max-hr · profile.hrmax_observed snapshot',
    pool.query(
      `UPDATE profile
          SET hrmax_observed = GREATEST(COALESCE(hrmax_observed, 0), $1::int)
        WHERE user_uuid = $2`,
      [eff.bpm, userId],
    ),
  );

  return r.rows[0]?.new_max != null ? Number(r.rows[0].new_max) : null;
}
