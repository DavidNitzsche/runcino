/**
 * lib/training/lthr-reanchor.ts · LTHR re-anchors off race evidence, the way
 * VDOT already does.
 *
 * ── The defect this closes ─────────────────────────────────────────────────
 *
 * `profile.lthr` was written once, on 2026-05-26, as the average of two half
 * marathons from January and February, and then never moved. Two further
 * qualifying halves landed after it — one of them two weeks ago — and neither
 * re-derived anything, because the ONLY code path that could write a
 * race-derived LTHR was `PATCH /api/race`'s inline `calibrateLthr` call, and a
 * chip time entered through `POST /api/race/result` does not go through it.
 * `runPostResultChain` — the shared follow-on both result writers run — moved
 * VDOT, snapshots, the plan and the cache, and left the threshold heart rate
 * exactly where it was.
 *
 * So the anchor aged six bpm low, and every LTHR-derived number aged with it:
 * the Friel bands (`lib/training/zones.ts`), the easy ceiling (`hrCapEasy`),
 * the watch's HR ceiling, the race abort trigger, the workout-type inference,
 * and the stored per-run zone distribution. On the owner's 2026-08-30 long run
 * that read as 60% of an easy long run in Zone 5.
 *
 * ── What doctrine actually licenses ────────────────────────────────────────
 *
 * `Research/03-heart-rate-zones.md` §6 gives Friel's 30-minute time trial and
 * ends the protocol with "Re-test every 6-12 weeks." That cadence is the whole
 * rule: LTHR is not a constant of the runner, it is a measurement with a shelf
 * life, and the same section says why — "LTHR shifts upward with fitness —
 * re-test gives a feedback signal." An anchor older than the ceiling of that
 * band is stale BY DOCTRINE, not by opinion.
 *
 * §16's "Field Alternatives" table names the methods that yield an LTHR: the
 * 30-min TT, and a 5K race via a stated conversion. A half marathon is not in
 * that table, so the half-marathon proxy this engine uses is grounded
 * elsewhere and stated as such: §1 defines LTHR as "HR at the maximal lactate
 * steady state, ~1-hour time-trial pace HR", and `Research/08` §6.1 prices a
 * half at 96-100% of LTHR — the tightest band any race distance gets. Reading
 * the top of that band (a well-run half is AT threshold) inverts to
 * `LTHR = half-marathon average HR`, which is what `lthrFromRace` has always
 * returned. `LTHR.half-marathon-inverts-at-the-band-top` binds that inversion
 * to the doc's own table cell.
 *
 * ── The four decisions, and why ────────────────────────────────────────────
 *
 * 1 · WHICH DISTANCE. Half marathons only. The marathon row of the same
 *     Research/08 table is 88-95% — a seven-point band, so inverting it spans
 *     ~10 bpm, and §12 of `Research/03` adds that cardiac drift inflates the
 *     average of the longest efforts most. `lthrFromMarathon` still exists for
 *     the hand-entry path; it does not get to move the anchor automatically.
 *
 * 2 · WHICH EFFORT. Only a race doctrine grades as REPRESENTATIVE.
 *     `lib/race/effort-authority.ts` already owns that question for VDOT
 *     selection — `Research/00b`'s effort table grades a C race "Strong
 *     effort, no taper ... treat like a hard workout" — and the same grading
 *     transfers unchanged. It has to: LTHR is the heart rate at the maximal
 *     lactate steady state, so a half run at sub-race effort reads LOW, which
 *     is the exact direction of the bug being fixed. A `hilly-excluded` or
 *     `training_run` row is not a graded race at all and grades to the C row.
 *     The runner's own report (`actual_result.authority_tier`, written by
 *     `POST /api/v5/race-authority`) caps it further, downward only — the same
 *     asymmetry `bestRecentVdot` applies, and the machinery a heat- or
 *     illness-compromised race already flows through.
 *
 * 3 · ONE RACE, NOT A BLEND. The most recent qualifying race wins outright.
 *     Friel's protocol is a re-TEST, not a rolling mean: the new measurement
 *     replaces the old one, which is what makes it "a feedback signal". A
 *     recency-weighted blend is what produced this defect — averaging Disney
 *     and Rose Bowl pinned the anchor to a January-February pair and then
 *     froze it.
 *
 * 4 · PROVENANCE PRECEDENCE. A field-tested or hand-entered LTHR is NEVER
 *     overwritten by a derived one. §16's table is explicit that the 30-min TT
 *     is the only field method whose HR estimate "did not significantly differ
 *     from blood-lactate-determined LTHR"; a race proxy does not get to
 *     silently outrank it. When a tested anchor is past the re-test cadence
 *     AND a fresh qualifying race disagrees materially, the disagreement is
 *     SURFACED (`action: 'hold'` with `stale: true`) rather than written.
 *
 * This module is PURE and imports no database at any depth, so a client bundle
 * can read `LTHR_RETEST_CADENCE_DAYS` from it — the profile tile's stale marker
 * and the engine's staleness limb are then the same number by construction.
 * The queries and the write live in `lib/training/lthr-reanchor-store.ts`.
 */
import {
  RUNNER_REPORTED_AUTHORITY_CAP,
  authorityTier,
  selectionAuthority,
  type AuthorityTier,
} from '@/lib/race/effort-authority';
import { lthrFromRace } from '@/lib/training/lthr';

// ── Doctrine constants ─────────────────────────────────────────────────────

/**
 * Friel's re-test cadence, defined in `lib/training/lthr-cadence.ts` and
 * re-exported here so this module's public surface is unchanged.
 *
 * THE DEFINITION MOVED BECAUSE THE PURITY CLAIM ABOVE WAS NOT TRUE. A client
 * bundle cannot read a constant from this module: the `lthrFromRace` import
 * below reaches `lib/training/lthr.ts`, whose `resolveThresholdHr` lazily does
 * `await import('@/lib/db/pool')`. A dynamic import is still a bundled edge, so
 * `ProfileView.tsx` ('use client') pulled `pg` into the browser graph and
 * `next build` failed on `fs` · `dns` · `net` · `tls`. Every Railway deploy of
 * `main` failed from 9a0c6314 onward while `tsc` and all twelve prebuild gates
 * passed.
 *
 * The constants now live in a leaf with no imports at all, which is what makes
 * the original intent — one number shared by the profile tile's stale marker
 * and the engine's staleness limb — actually hold. Read the file itself for the
 * doctrine citation.
 */
export {
  LTHR_RETEST_MIN_WEEKS,
  LTHR_RETEST_MAX_WEEKS,
  LTHR_RETEST_CADENCE_DAYS,
} from '@/lib/training/lthr-cadence';

// A re-export does not bind the names locally, and this module reads all three
// below — the cadence in `selectAnchorRace` and `planLthrReanchor`, the week
// bounds in the stale verdict's own sentence.
import {
  LTHR_RETEST_MIN_WEEKS,
  LTHR_RETEST_MAX_WEEKS,
  LTHR_RETEST_CADENCE_DAYS,
} from '@/lib/training/lthr-cadence';

/**
 * The half-marathon band a race must land in to anchor LTHR. Identical to
 * `lthrFromRace`'s own gate — this is the SELECTION copy, so a candidate that
 * would be rejected downstream never enters the pool and never suppresses a
 * better one behind it.
 */
export const LTHR_QUALIFYING_MIN_MI = 12.0;
export const LTHR_QUALIFYING_MAX_MI = 14.5;

/**
 * How far a derived value must move the anchor before it is worth writing.
 *
 * `Research/03` §3 states the reproducibility of a repeated HR field test:
 * "Reproducibility on retest 1-2 weeks later: ±3 bpm." A change smaller than
 * the test's own repeatability is noise, and re-writing the anchor for it
 * would churn every zone edge, every stored zone distribution and every coach
 * line for nothing. At or above it, the two readings genuinely disagree.
 *
 * Bound by `LTHR.material-change-is-the-retest-noise-floor`.
 */
export const LTHR_MATERIAL_CHANGE_BPM = 3;

// ── Provenance ─────────────────────────────────────────────────────────────

/**
 * How the stored anchor was obtained. `lthr_method` is free text and has
 * carried at least four shapes over the app's life, so the classifier reads the
 * MACHINE TOKEN — everything before the first ' · ' separator — and falls back
 * to pattern-matching the legacy prose forms.
 */
export type LthrProvenance = 'field_test' | 'manual' | 'derived' | 'unknown';

/** The token this module writes into `lthr_method`, ahead of the race name. */
export const LTHR_RACE_METHOD_TOKEN = 'race_half';

export function lthrProvenanceOf(method: string | null | undefined): LthrProvenance {
  const raw = String(method ?? '').trim();
  if (!raw) return 'unknown';
  const token = raw.split('·')[0].trim().toLowerCase();
  if (token === 'field_test') return 'field_test';
  if (token === 'manual') return 'manual';
  if (token === 'race_half' || token === 'race_full' || token === 'race_marathon') return 'derived';
  if (token === 'maxhr-crosswalk' || token === 'stored-lthr') return 'derived';
  // Legacy prose. The value in production on the day this shipped was
  // "derived: Disney HM (162) + Rose Bowl HM (159) avg, half-marathon avg HR ≈
  // LTHR" — a derivation, and it must classify as one or the fix cannot reach
  // the runner it was written for.
  if (/^derived\b/i.test(raw)) return 'derived';
  if (/field[\s_-]?test/i.test(raw)) return 'field_test';
  // Anything else is a human's own words for a number they set themselves.
  return 'manual';
}

/** A derived anchor may be replaced automatically; a tested one may not. */
export function isAutoReplaceable(p: LthrProvenance): boolean {
  return p === 'derived' || p === 'unknown';
}

// ── Candidate selection ────────────────────────────────────────────────────

export interface LthrRaceCandidate {
  slug: string;
  name: string;
  /** `meta->>'date'`, ISO yyyy-mm-dd. */
  dateISO: string;
  /** Raw `meta->>'priority'` — A/B/C, or a non-race label like `hilly-excluded`. */
  priority: string | null;
  distanceMi: number | null;
  avgHrBpm: number | null;
  /** The runner's own downgrade of their race, when they gave one. */
  runnerAuthorityTier?: AuthorityTier | null;
}

export interface LthrAnchor {
  slug: string;
  name: string;
  dateISO: string;
  ageDays: number;
  lthr: number;
  authority: number;
  tier: AuthorityTier;
}

/** Whole days between two ISO dates, floored at 0. */
export function daysBetween(fromISO: string, toISO: string): number | null {
  const a = Date.parse(String(fromISO).slice(0, 10) + 'T12:00:00Z');
  const b = Date.parse(String(toISO).slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * The one race that anchors LTHR today, or null.
 *
 * Gates, in the order a candidate meets them:
 *   · a resolvable date, distance and average heart rate;
 *   · the half-marathon distance band (decision 1 above);
 *   · a REPRESENTATIVE effort grading, after the runner's own downward-only
 *     report is applied (decision 2);
 *   · inside Friel's re-test cadence — a race older than the shelf life of a
 *     measurement is not a fresh measurement.
 *
 * Ranking is date-descending, then authority-descending: the most recent
 * qualifying race wins (decision 3), and two races on the same day break toward
 * the better-graded one.
 */
export function selectLthrAnchor(
  candidates: readonly LthrRaceCandidate[],
  todayISO: string,
): LthrAnchor | null {
  const pool: LthrAnchor[] = [];
  for (const c of candidates ?? []) {
    if (!c?.dateISO) continue;
    const ageDays = daysBetween(c.dateISO, todayISO);
    if (ageDays == null) continue;
    if (ageDays > LTHR_RETEST_CADENCE_DAYS) continue;
    const distanceMi = Number(c.distanceMi);
    if (!Number.isFinite(distanceMi)) continue;
    if (distanceMi < LTHR_QUALIFYING_MIN_MI || distanceMi > LTHR_QUALIFYING_MAX_MI) continue;
    const avgHr = Number(c.avgHrBpm);
    if (!Number.isFinite(avgHr)) continue;
    // Effort grading. `selectionAuthority` already reads an ungraded label
    // (`hilly-excluded`, `training_run`) down to doctrine's lowest row rather
    // than up to its highest, so the hilly marathon and a jogged tune-up both
    // fall out here without this module naming either of them.
    const declared = selectionAuthority(c.priority);
    const reported = c.runnerAuthorityTier ?? null;
    const authority = (reported && reported !== 'representative')
      ? Math.min(declared, RUNNER_REPORTED_AUTHORITY_CAP[reported])
      : declared;
    const tier = authorityTier(authority);
    if (tier !== 'representative') continue;
    // The distance/HR plausibility gate is `lthrFromRace`'s, not a second copy.
    const lthr = lthrFromRace(distanceMi, avgHr);
    if (lthr == null) continue;
    pool.push({ slug: c.slug, name: c.name, dateISO: c.dateISO, ageDays, lthr, authority, tier });
  }
  if (pool.length === 0) return null;
  pool.sort((a, b) =>
    a.dateISO === b.dateISO ? b.authority - a.authority : (a.dateISO < b.dateISO ? 1 : -1));
  return pool[0];
}

// ── The decision ───────────────────────────────────────────────────────────

export interface StoredLthr {
  lthr: number | null;
  method: string | null;
  /** `lthr_set_at`, ISO. Null when the anchor was never stamped. */
  setAtISO: string | null;
}

export type LthrReanchorAction = 'write' | 'hold' | 'stale' | 'none';

export interface LthrReanchorDecision {
  action: LthrReanchorAction;
  /** What the anchor becomes on 'write'. Null on every other action. */
  nextLthr: number | null;
  /** The `lthr_method` string to store on 'write'. */
  nextMethod: string | null;
  previousLthr: number | null;
  previousProvenance: LthrProvenance;
  anchor: LthrAnchor | null;
  /** True when the STORED anchor is past Friel's re-test cadence. */
  stale: boolean;
  /** Age of the stored anchor in days · null when it was never stamped. */
  storedAgeDays: number | null;
  /** One short sentence naming why this action and not another. */
  why: string;
}

/**
 * Decide what to do with the runner's LTHR today. Pure — every input is
 * supplied, so the whole rule is unit-testable without a database.
 *
 * Actions:
 *   · `write` — a qualifying race disagrees materially with a REPLACEABLE
 *     anchor, or there is no anchor at all. Re-derive.
 *   · `hold`  — a qualifying race exists but the stored anchor was field-tested
 *     or hand-entered. Never overwritten. `stale` says whether the held anchor
 *     is also past the cadence, which is the case worth telling the runner
 *     about.
 *   · `stale` — no qualifying race and the stored anchor is past the cadence.
 *     Nothing to re-derive FROM, so the answer is a field test, not a write.
 *   · `none`  — nothing to do.
 */
export function decideLthrReanchor(args: {
  stored: StoredLthr;
  anchor: LthrAnchor | null;
  todayISO: string;
}): LthrReanchorDecision {
  const { stored, anchor, todayISO } = args;
  const previousLthr = Number.isFinite(Number(stored.lthr)) && Number(stored.lthr) > 0
    ? Number(stored.lthr)
    : null;
  const previousProvenance = lthrProvenanceOf(stored.method);
  const storedAgeDays = stored.setAtISO ? daysBetween(stored.setAtISO, todayISO) : null;
  // An anchor with no stamp cannot be shown to be fresh, and an anchor that
  // does not exist is not stale — it is absent, and absence is handled by the
  // write limb the moment any qualifying race lands.
  const stale = previousLthr != null && (storedAgeDays == null || storedAgeDays > LTHR_RETEST_CADENCE_DAYS);

  const base = {
    nextLthr: null as number | null,
    nextMethod: null as string | null,
    previousLthr,
    previousProvenance,
    anchor,
    stale,
    storedAgeDays,
  };

  if (!anchor) {
    return stale
      ? {
          ...base,
          action: 'stale',
          why: `Threshold HR was last set ${storedAgeDays ?? '?'} days ago and no qualifying race since. `
            + `Friel re-tests every ${LTHR_RETEST_MIN_WEEKS}-${LTHR_RETEST_MAX_WEEKS} weeks.`,
        }
      : { ...base, action: 'none', why: 'No qualifying race, and the stored anchor is inside the re-test cadence.' };
  }

  if (previousLthr != null && !isAutoReplaceable(previousProvenance)) {
    const delta = Math.abs(anchor.lthr - previousLthr);
    return {
      ...base,
      action: 'hold',
      why: stale && delta >= LTHR_MATERIAL_CHANGE_BPM
        ? `${anchor.name} reads ${anchor.lthr}, and the ${previousProvenance === 'field_test' ? 'field-tested' : 'hand-entered'} `
          + `anchor of ${previousLthr} is ${storedAgeDays ?? '?'} days old. A tested anchor is never overwritten automatically.`
        : `A ${previousProvenance === 'field_test' ? 'field-tested' : 'hand-entered'} anchor outranks a race-derived one.`,
    };
  }

  if (previousLthr == null) {
    return {
      ...base,
      action: 'write',
      nextLthr: anchor.lthr,
      nextMethod: lthrMethodString(anchor),
      why: `No threshold HR on file · ${anchor.name} anchors it at ${anchor.lthr}.`,
    };
  }

  const delta = anchor.lthr - previousLthr;
  if (Math.abs(delta) < LTHR_MATERIAL_CHANGE_BPM) {
    return {
      ...base,
      action: 'none',
      why: `${anchor.name} reads ${anchor.lthr} against a stored ${previousLthr} · inside the ±${LTHR_MATERIAL_CHANGE_BPM} bpm retest noise floor.`,
    };
  }

  // A derived anchor already sourced from THIS race and already agreeing does
  // not need re-writing; a disagreement of 3+ bpm means the stored one came
  // from different evidence, however it was worded.
  return {
    ...base,
    action: 'write',
    nextLthr: anchor.lthr,
    nextMethod: lthrMethodString(anchor),
    why: `${anchor.name} (${anchor.dateISO}) reads ${anchor.lthr} · the stored ${previousLthr} moves ${delta > 0 ? '+' : ''}${delta}.`,
  };
}

/** `race_half · Americas Finest City · 2026-08-16` — machine token first so
 *  `lthrProvenanceOf` and the profile UI both read it without parsing prose. */
export function lthrMethodString(anchor: LthrAnchor): string {
  return `${LTHR_RACE_METHOD_TOKEN} · ${anchor.name} · ${anchor.dateISO}`;
}