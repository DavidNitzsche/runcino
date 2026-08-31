/**
 * lib/training/pace-corpus.ts · PACE READ DIRECTLY FROM THE RUNNING, PER ZONE.
 *
 * Phase 2 of the owner's 2026-08-30 ruling (`lib/training/vdot-corpus.ts`
 * carries Phase 1's full header — read it first, this file assumes it).
 * His sharpened diagnosis, same session:
 *
 *     "That's one fix but continuing to anchor fitness in VDOT that is based
 *      off of the same things we've been working with will continue to get us
 *      wrong times and information. It needs to be anchored in evidence and
 *      runs. Maybe we are making VDOT too much of a king."
 *
 * ── What was wrong, structurally ────────────────────────────────────────────
 *
 * `resolveCurrentTPace` (lib/training/vdot.ts) collapses every kind of
 * evidence into ONE scalar — VDOT — and then reads every pace type (easy,
 * marathon, threshold, interval) off ONE Daniels table keyed to that scalar.
 * There is no path for the engine to say "I have direct evidence you hold
 * 7:00 threshold pace" — threshold evidence is only ever visible after it has
 * already been forced through a VDOT conversion and back out again, and an
 * EASY-effort run is not visible to fitness math AT ALL: `vdotFromRun` has no
 * 'easy' branch, so a conversational-pace run falls through to
 * `vdotFromRace`, reads as a mediocre race, and produces a VDOT that
 * (correctly) never sets anything — which means easy-run evidence, more than
 * half the owner's logged history, was invisible in any useful sense.
 *
 * This file is two DIRECT-EVIDENCE readers, one per pace type, that answer
 * their own question from the runner's own classified running rather than
 * from a VDOT round-trip:
 *
 *   · `resolveEasyPaceCorpus`      — what easy pace does the evidence corroborate
 *   · `resolveThresholdPaceCorpus` — what threshold pace does the evidence corroborate
 *
 * Neither is wired into `resolveCurrentTPace`, `generate.ts`, `spec-builder.ts`
 * or any other plan-authoring path. That wiring is Phase 3, deliberately
 * separate — a large, sensitive change to the plan engine's core pace
 * derivation deserves its own focused pass once both readers are trustworthy
 * standalone. This file's public interface (`EasyPaceRead`,
 * `ThresholdPaceRead`, the two `resolve*` functions) is what Phase 3 calls.
 *
 * ── Why two different designs, not one shape stamped twice ─────────────────
 *
 * `vdot-corpus.ts` answers ONE question (a fitness ceiling) with ONE
 * statistic (Kth-highest). Easy pace and threshold pace are not the same
 * statistical shape as that question, and they are not the same shape as each
 * other — each design below is argued on its own, not copied from the other.
 *
 *   EASY  · a BAND, from a Kth-fastest edge (mirrors the corpus's own
 *           insensitive-to-the-bottom argument) and a median edge (which is
 *           NOT insensitive to the bottom — this is why easy pace, alone of
 *           the two, needs the Rule 8 filter). See "THE EASY DESIGN" below.
 *
 *   THRESHOLD · reuses `corroboratedCorpusVdot` on a zone-BUCKETED pool
 *           (threshold-zone observations only) rather than inventing a
 *           second raw-pace order statistic, because `vdotFromTpace` /
 *           `tPaceFromVdot` are exact inverses by construction — bucketing
 *           threshold observations and running the SAME Kth-highest on just
 *           that bucket is mathematically identical to a raw-pace Kth-fastest
 *           statistic on threshold paces directly, and it reuses far more
 *           proven code than a parallel implementation would. See
 *           "THE THRESHOLD DESIGN" below.
 *
 * ── THE CLASSIFIER, both readers share it ───────────────────────────────────
 *
 * `runStimulusType` (lib/runs/log-enrich.ts) returns null for 68 of the
 * owner's 123 runs that carry both pace and HR — more than half his usable
 * history. A reader that only trusted the label would starve on corroboration
 * for exactly the runner this was built for. So classification here is
 * PHYSIOLOGICAL FIRST: HR-zone (primary) + duration (plausibility), with the
 * label used only to (a) EXCLUDE a run whose label says something
 * incompatible — a 'race' or 'intervals' label must never count as easy
 * evidence even if a diluted average HR looks low — and (b) as a stronger bar
 * on the one fallback path that has no better evidence (the no-splits
 * threshold read; see below). The label never GATES membership on its own;
 * `passesRunHonestyGate` in vdot.ts was built to validate "was this an
 * ALL-OUT effort", which by design would reject genuine easy-effort running,
 * so it is not reused here — a different question needs a different gate.
 *
 * HR-ZONE BASIS · LTHR WHEN FRESH, ELSE %HRMAX. Research/03 §17 states the
 * precedence directly: "If two systems disagree, the more individualized one
 * (LTHR > Karvonen > %HRmax) wins." `lthrFloorIsFresh` (lib/training/max-hr.ts,
 * reused rather than re-derived — see CLAUDE.md's note that another session
 * is concurrently extending that file's HRmax ceiling; this reader only
 * IMPORTS from it) is the same shelf-life `lthr-reanchor.ts` already judges
 * staleness against. When `profile.lthr` is fresh, %LTHR is the gate; when it
 * is stale or absent (a stale LTHR licenses nothing — an out-trained or
 * under-trained anchor is not today's physiology), %HRmax is the fallback,
 * via `loadEffectiveMaxHr` — the canonical resolver every other HR consumer
 * in this app already goes through.
 *
 * Bands, Research/03 §8 "Daniels' HR Zones" (the Daniels-specific table, not
 * the generic 5-zone one — this reader answers a Daniels-vocabulary
 * question):
 *
 *     | E (Easy)      | 65-78% [HRmax] | ... | 30 min - 2.5 h            |
 *     | T (Threshold) | 86-92% [HRmax] | ... | reps 5-20 min, total 20-60 min |
 *
 * and §17 "Conversion Between Systems" for the %LTHR crosswalk:
 *
 *     %HRmax 65-75% ≈ %LTHR 75-88% ≈ Daniels E
 *     %HRmax 86-92% ≈ %LTHR 95-102% ≈ Daniels T
 *
 * Both bound in lib/doctrine/registry.ts (`PACE.easy-zone-is-daniels-e` /
 * `PACE.threshold-zone-is-daniels-t`), which parses the numbers out of §8's
 * table at run time rather than hardcoding both sides.
 *
 * ── THE EASY DESIGN ──────────────────────────────────────────────────────────
 *
 * A band, not a point — because Research/00a's own E-pace zone is a band, and
 * because a single number cannot honestly answer two different questions at
 * once: "the fastest he has repeatedly proven he can hold at genuinely easy
 * effort" and "what he typically runs easy." Both are real, and
 * `easyPaceBandFromAnchorPace` (vdot.ts) already returns `{lo, hi}` for the
 * VDOT-derived band, so a direct-evidence band is the shape Phase 3 can drop
 * in without reshaping its consumer.
 *
 *   lo = Kth-fastest qualifying pace (K = CORROBORATION_MIN_OBSERVATIONS) —
 *        the same order-statistic idea `corroboratedCorpusVdot` uses, applied
 *        to pace instead of VDOT: at least K sessions ran this fast or
 *        faster at genuinely easy effort, so no single good-weather day can
 *        set it.
 *   hi = median of every qualifying observation — a central tendency, and
 *        DELIBERATELY NOT an order statistic insensitive to the bottom of the
 *        window: a median moves when a slow taper jog enters the pool, which
 *        is exactly why this half of the band (unlike the corpus VDOT ceiling,
 *        and unlike the `lo` edge above) needs the Rule 8 filter. Reported
 *        rather than picked between, because Research/00a's own E-pace zone
 *        is a band and collapsing it to one number would be a second,
 *        needless information loss on top of collapsing every pace type into
 *        one VDOT — the exact failure this file exists to stop.
 *
 * `lo` and `hi` are sorted (`Math.min`/`Math.max`) rather than assumed ordered
 * — with a small qualifying pool the Kth-fastest and the median can sit close
 * enough that rounding or a thin sample flips their raw order, and a crossed
 * band would be worse than a narrow one.
 *
 * RULE 8 · FILTERED, and argued independently rather than inheriting
 * `vdot-corpus.ts`'s conclusion. Easy pace capability is explicitly a "what
 * CAN this runner do" question — CLAUDE.md's Rule 8 corollary names "typical
 * distance, typical intensity, typical anything" as needing the filter. The
 * `lo` edge (Kth-fastest) *would* survive unfiltered by the same
 * insensitive-to-the-bottom argument the corpus ceiling uses — but the `hi`
 * edge (median) would not, and reporting a band where only one edge is
 * honestly filtered is worse than filtering the whole input: it would look
 * like a considered choice was made about `hi` when none was. So both edges
 * are computed from the SAME filtered pool. `excludePrescribedDays` /
 * `loadPrescribedWindows` (lib/training/normal-window.ts) are reused, not
 * re-derived.
 *
 * ── THE THRESHOLD DESIGN ─────────────────────────────────────────────────────
 *
 * Reuses `corroboratedCorpusVdot` on a bucket of threshold-ZONE observations
 * only (see "Why two different designs" above for why this is not a
 * duplicate implementation). Each candidate observation's pace is converted
 * to a VDOT via `vdotFromTpace` — the SAME zone-aware conversion
 * `vdotFromRun` already trusts for a threshold-labelled run — corroborated at
 * K, then converted back via `tPaceFromVdot`. One statistic, reused twice
 * (once for the fitness ceiling on the whole corpus, once here on a
 * threshold-only slice), rather than a parallel order statistic invented on
 * raw pace.
 *
 * SPLITS-AWARE, for the owner's own real complaint: "Broken Long Run — 95 min
 * with Structured Blocks", a mixed session whose whole-run average dilutes
 * the T-effort with recovery-jog segments between reps. When `data.splits`
 * exists, every split whose HR lands in the T-zone (by the same LTHR/HRmax
 * precedence as the easy reader) is pooled — not required to be contiguous,
 * because splits are stored ~per-mile with no reliable rep/recovery flag, so
 * a strict contiguous-block scan would miss a broken workout's later reps as
 * readily as it misses the recovery jogs between them. Pooling BY ZONE
 * MEMBERSHIP is what actually excludes the diluting recovery segments: their
 * HR sits below the T-band and they never enter the average. The pooled
 * total must fall inside Research/03 §8's own "reps 5-20 min, total 20-60
 * min" (a little slack applied to the ceiling for split-boundary rounding).
 *
 * WHOLE-RUN FALLBACK, when splits are absent. Explicitly weaker and
 * explicitly gated harder: the run's OWN label must positively say
 * threshold-zone (`zoneFromType` returns `'threshold'`) — HR alone is not
 * trusted to isolate a work segment from a whole-run average when there is no
 * splits data to find the segment inside, and a WU/CD-diluted whole-run
 * average is precisely the ~3-point understatement `vdotFromRun`'s own
 * zone-aware read exists to prevent (see that function's header). This is the
 * Rule 22 residual, stated rather than hidden: a threshold session logged
 * with no per-mile splits and an ambiguous label (say, `'quality'`) cannot be
 * read by this fallback and will not corroborate, however honest the effort
 * was.
 *
 * RULE 8 · NOT FILTERED, and this is the one place this file's two readers
 * disagree about applicability — argued independently, not by symmetry with
 * the easy reader. `resolveThresholdPaceCorpus` reuses `corroboratedCorpusVdot`
 * unchanged, and that function's own order-statistic insensitivity argument
 * transfers directly: the Kth-highest observation in the threshold-VDOT
 * bucket is a function of the top K observations only, so a taper-week easy
 * day cannot enter this bucket in the first place (it would fail the T-zone
 * HR gate before it ever reached the statistic), and observations below the
 * Kth-highest cannot move the read by construction. `vdot-corpus.ts`'s own
 * residual applies verbatim: a taper week's genuine tune-up or sharpening
 * session at real T-HR is honest evidence of threshold capability — arguably
 * MORE honest than an ordinary Tuesday tempo, since it is run rested — and it
 * is bounded to one vote; it still needs K-1 corroborating sessions before it
 * can move anything.
 *
 * ── WHAT THIS CANNOT CATCH (Rule 22) ────────────────────────────────────────
 *
 *   · The same instrument-error blind spot `vdot-corpus.ts` names: K
 *     independent sessions on the SAME mis-calibrated watch corroborate a
 *     wrong number just as confidently as K sessions on a good one.
 *   · Easy reader: a run whose label is silent (no `workoutType`, common on
 *     this app's own history) and whose HR sits in-band by coincidence — a
 *     hard trail hike with a low cardiac response, say — has no positive
 *     signal to exclude it. The duration floor (Research/00a, ≥20 min) is the
 *     only guard against a short outlier; there is no guard against a long one.
 *   · Threshold reader, whole-run fallback: a genuine threshold session with
 *     no splits and a generic/ambiguous label cannot corroborate at all — see
 *     above. This is a false NEGATIVE (missed evidence), never a false
 *     positive, which is the safe direction for a reader that will feed a
 *     pace prescription.
 *   · Neither reader currently reads %LTHR and %HRmax as two independent
 *     corroborating votes — Research/03 §17's precedence is applied as a
 *     STRICT override (LTHR wins outright when fresh) rather than as a
 *     weighted blend. A borderline %HRmax reading that a fresh but
 *     borderline %LTHR reading would have corroborated is therefore not
 *     specially rescued; it is simply read by whichever basis wins
 *     precedence. If evidence later shows this materially under-corroborates,
 *     a blended vote is the next thing to try — not a wider band, per Rule 9.
 *   · THE THRESHOLD READER ONLY SEES `data.splits` (MILE-GRANULAR), NOT
 *     `coach_intents.value.phases` (THE WATCH'S PER-REP ACTUALS) — MEASURED,
 *     not theoretical, and this is the one residual worth flagging loudest.
 *     Rendered against the owner's real account, 2026-08-31: the threshold
 *     corpus corroborates T-pace 458 s/mi (7:38/mi) from `data.splits`, which
 *     is honest for what it reads but visibly slower than the 6:45-7:00/mi he
 *     described. The fastest work-phase in his `coach_intents` history over
 *     the same window is a 2026-08-12 1km interval rep — `actualPaceSPerMi:
 *     381` (6:21/mi), `avgHr: 164` (97.6% of his fresh 168 LTHR, squarely
 *     inside the T-band this file uses) — that never reaches this reader,
 *     because `vdotFromRun`'s own `useWork` split (vdot-inputs.ts) exists for
 *     exactly this reason: a mile-boundary split rolls a short fast rep
 *     together with the recovery jog straddling the mile marker, and dilutes
 *     it. `loadVdotInputs`'s `wc_work` CTE already reads this same source
 *     for the whole-corpus VDOT ceiling; extending
 *     `thresholdSegmentFromSplits`'s sibling to read it too — matching
 *     per-phase `avgHr` against the same T-band this file already uses — is
 *     the concrete next step, not a vague "could be improved." Deliberately
 *     not built in this pass: phase data carries its own complications (a
 *     `verdict:'missed'` tolerance flag, multiple reps per session, HR that
 *     may not have caught up to a short rep — Research/03 §8's own note that
 *     "R workouts: HR unreliable... coach by pace + RPE" bears directly on
 *     whether a HR-zone gate is even the right filter for a rep this short),
 *     and folding it in without its own falsification pass would be
 *     exactly the "wired and inert" failure CLAUDE.md's Rule 21 warns about,
 *     applied to reading instead of writing.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadEffectiveMaxHr, lthrFloorIsFresh } from '@/lib/training/max-hr';
import {
  CORROBORATION_MIN_OBSERVATIONS,
  corroboratedCorpusVdot,
  type CorpusObservation,
} from '@/lib/training/vdot-corpus';
import { vdotFromTpace, tPaceFromVdot, zoneFromType } from '@/lib/training/vdot';
import { normalizeDataWorkoutType, QUALITY_TYPES } from '@/lib/runs/log-enrich';
import { normalizeSplits } from '@/lib/runs/run-shape';
import { excludeDistanceReviewSql } from '@/lib/runs/distance-guard';
import {
  runDaySql,
  runDistanceMiSql,
  runFinishSecSql,
  runAvgHrSql,
  runWorkoutTypeSql,
  runSplitsSql,
  runNotMergedSql,
} from '@/lib/runs/run-shape';
import {
  loadPrescribedWindows,
  excludePrescribedDays,
} from '@/lib/training/normal-window';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · DOCTRINE-CITED BANDS AND FLOORS — bound by lib/doctrine/registry.ts
 * ═══════════════════════════════════════════════════════════════════════ */

/** Research/03-heart-rate-zones.md §8 "Daniels' HR Zones" · E row, %HRmax
 *  column: "65-78%". Fractions, not percentages. */
export const EASY_PCT_HRMAX_BAND: readonly [number, number] = [0.65, 0.78];

/** Research/03-heart-rate-zones.md §8 · T row, %HRmax column: "86-92%". */
export const THRESHOLD_PCT_HRMAX_BAND: readonly [number, number] = [0.86, 0.92];

/** Research/03-heart-rate-zones.md §17 "Conversion Between Systems" · the
 *  %LTHR crosswalk for a "Z2 easy" run: "%LTHR 75-88% ≈ Daniels E". */
export const EASY_PCT_LTHR_BAND: readonly [number, number] = [0.75, 0.88];

/** Research/03-heart-rate-zones.md §17 · the %LTHR crosswalk for
 *  "Threshold": "%LTHR 95-102% ≈ Daniels T". */
export const THRESHOLD_PCT_LTHR_BAND: readonly [number, number] = [0.95, 1.02];

/**
 * Research/00a §1/§2 (already cited by CLAUDE.md's Rule 12 for the same
 * reason): easy/recovery is priced 20-75 min, general aerobic 40-75. The
 * floor here is the SHORTER of the two — a run under it is a shakeout, not a
 * corroborating easy-pace observation, and admitting it on equal footing with
 * a 6-mile easy day is exactly the "3 miles is a real run for one runner and
 * a warm-up for another" problem Rule 12 names.
 */
export const EASY_MIN_DURATION_SEC = 20 * 60;

/** Research/03 §8 · T row, duration column: "reps 5-20 min, total 20-60
 *  min". The floor is the shortest a single rep may be; the ceiling carries a
 *  small slack (5 min) over the doctrine total for split-boundary rounding —
 *  a threshold pool that sums to 61:30 across mile-granular splits is not
 *  materially different from one that sums to 60:00. */
export const THRESHOLD_MIN_QUALIFYING_SEC = 5 * 60;
export const THRESHOLD_MAX_QUALIFYING_SEC = 65 * 60;

/** No splits data to isolate a work segment · the loose whole-run plausibility
 *  ceiling (Research/03 §8's total is 60 min; this allows for warm-up/
 *  cool-down around it, since the whole run — not just the work — is being
 *  read). Not doctrine-derived; a coarse sanity band on the one fallback path
 *  that has no better evidence, same spirit as `passesRunHonestyGate`'s own
 *  distance floor. */
const THRESHOLD_WHOLE_RUN_MAX_SEC = 90 * 60;

/**
 * Training-derived pace evidence goes stale faster than a race anchor — the
 * SAME reasoning `loadVdotInputs` states for its own fixed 60-day run window
 * (vdot-inputs.ts: "race results ... are valid anchors for the full
 * windowDays; training-derived VDOT from quality runs goes stale faster").
 * Reused rather than re-derived: 60 days, not re-argued from zero.
 *
 * This is the THRESHOLD reader's default — it is NOT Rule 8-filtered, so a
 * 60-day window is not at risk of the starvation described below.
 */
export const PACE_CORPUS_LOOKBACK_DAYS = 60;

/**
 * The EASY reader's default lookback — wider than the threshold reader's, and
 * argued separately rather than inheriting `PACE_CORPUS_LOOKBACK_DAYS`.
 *
 * MEASURED against the owner's real account, 2026-08-31 (Rule 13 — this is
 * not a guess): at 60 days the easy-pace band read {lo: 524.5, hi: 524.5}
 * s/mi (8:44/mi) off exactly 5 representative observations, all from
 * mid-July — visibly slower than his stated "8:00/mi easily all day,
 * everyday." The cause was not the classifier; it was the WINDOW. His
 * Americas Finest City half (2026-08-16, A) opened a Rule 8 exclusion window
 * spanning roughly 2026-08-02 through 2026-08-30 — nearly the entire back
 * half of a 60-day lookback ending 2026-08-31 — so every one of his faster,
 * more-recent easy days (2026-08-05 at 8:13/mi, 2026-08-07 at 7:37/mi) was
 * correctly excluded as prescribed taper/recovery, and the only
 * representative evidence left standing was older and slower.
 *
 * Per `normal-window.ts`'s own clause 1 ("EXCLUDE, DO NOT WIDEN"), a wider
 * window is the wrong fix for a reader that ISN'T excluding — it only
 * dilutes the taper. This reader ALREADY excludes (`excludePrescribedDays`
 * below); the taper days in a wider window are dropped exactly the same as
 * in a narrow one. So a longer nominal window here doesn't dilute anything —
 * it gives the exclusion something left to work with when a recent A-race
 * has already claimed most of a 60-day span. Measured at 90 days, the same
 * account's band moved to {lo: 491.7, hi: 517.0} s/mi (8:12-8:37/mi) off 12
 * observations — the `lo` edge lines up with the owner's own stated pace to
 * within a few seconds. 120 and 150 days recovered a few more observations
 * (16) without moving `lo` at all, which is the Kth-fastest edge behaving
 * exactly as designed: additional, slower evidence cannot pull it around.
 *
 * 90 is chosen over 120/150 as the smaller window that already recovers a
 * representative answer — per Rule 9, prefer the least aggressive fix that
 * clears the problem, not the widest one that also clears it.
 */
export const EASY_CORPUS_LOOKBACK_DAYS = 90;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SHARED CLASSIFICATION
 * ═══════════════════════════════════════════════════════════════════════ */

export type HrBasis = 'pct_lthr' | 'pct_hrmax';

export interface HrContext {
  maxHrBpm: number | null;
  lthrBpm: number | null;
  lthrFresh: boolean;
}

/**
 * Research/03 §17: "the more individualized one (LTHR > Karvonen > %HRmax)
 * wins." Fresh LTHR is the gate when available; %HRmax (via
 * `loadEffectiveMaxHr`, the canonical resolver) is the fallback.
 */
function hrZoneMatch(
  avgHr: number | null,
  ctx: HrContext,
  hrMaxBand: readonly [number, number],
  lthrBand: readonly [number, number],
): { inZone: boolean; basis: HrBasis | null; pct: number | null } {
  if (avgHr == null || !(avgHr > 0)) return { inZone: false, basis: null, pct: null };
  if (ctx.lthrFresh && ctx.lthrBpm != null && ctx.lthrBpm > 0) {
    const pct = avgHr / ctx.lthrBpm;
    return { inZone: pct >= lthrBand[0] && pct <= lthrBand[1], basis: 'pct_lthr', pct };
  }
  if (ctx.maxHrBpm != null && ctx.maxHrBpm > 0) {
    const pct = avgHr / ctx.maxHrBpm;
    return { inZone: pct >= hrMaxBand[0] && pct <= hrMaxBand[1], basis: 'pct_hrmax', pct };
  }
  return { inZone: false, basis: null, pct: null };
}

/** Label positively says quality/race effort — excludes a run from EASY
 *  candidacy however low its (possibly diluted) average HR reads. Reuses
 *  `QUALITY_TYPES`, the same vocabulary `badgeForRun`/`completedNear`
 *  (log-enrich.ts / adapt.ts) already trust for "this label says quality". */
function labelExcludesEasy(rawWorkoutType: unknown): boolean {
  const norm = normalizeDataWorkoutType(rawWorkoutType);
  return norm != null && (QUALITY_TYPES.has(norm) || norm === 'race');
}

/** Label positively says easy/recovery/long — excludes a run from THRESHOLD
 *  candidacy so a stray HR spike (a strides set, a downhill surge) inside an
 *  easy day cannot masquerade as a threshold observation. */
function labelExcludesThreshold(rawWorkoutType: unknown): boolean {
  const norm = normalizeDataWorkoutType(rawWorkoutType);
  return norm === 'easy' || norm === 'recovery' || norm === 'long' || norm === 'shakeout';
}

/** Label positively says threshold-zone — the stronger bar the no-splits
 *  threshold fallback requires. Reuses `zoneFromType`, the same classifier
 *  `vdotFromRun` trusts to route a run through the zone-aware read. */
function labelSaysThreshold(rawWorkoutType: unknown): boolean {
  return zoneFromType(normalizeDataWorkoutType(rawWorkoutType)) === 'threshold';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · OBSERVATION + REFUSAL SHAPES (Rule 11 · no `.value`/pace on refusal)
 * ═══════════════════════════════════════════════════════════════════════ */

/** One pace observation, in the shape both readers report as `supporting`
 *  evidence — "which runs said this" answerable without re-deriving it
 *  (the observability half of Rule 21, same intent as `CorpusObservation`). */
export interface PaceObservation {
  /** `runs.id` of the row this read came from. */
  id: string;
  /** Run day, ISO. */
  date: string;
  /** The pace this observation supports, s/mi. For threshold, this is the
   *  qualifying SEGMENT's pace, not necessarily the whole run's. */
  paceSecPerMi: number;
  /** Seconds of qualifying effort this observation contributes. */
  durationSec: number;
  /** Whether the pace came from a splits-aware segment or the whole run. */
  source: 'splits' | 'whole-run';
  /** Which HR basis classified this observation into its zone. */
  hrBasis: HrBasis;
}

export type EasyPaceCorpusReason = 'no_observations' | 'insufficient_corroboration';

/** The easy-pace corpus's answer. Refusal carries no `band` (Rule 11). */
export type EasyPaceRead =
  | {
      ok: true;
      /** `lo` = Kth-fastest corroborated pace (the honest ceiling of the
       *  E-band); `hi` = median of the qualifying pool (typical easy). Both
       *  s/mi, `lo <= hi`. */
      band: { lo: number; hi: number };
      observations: number;
      /** The K fastest qualifying observations — what sets `lo`. */
      supporting: PaceObservation[];
    }
  | {
      ok: false;
      reason: EasyPaceCorpusReason;
      observations: number;
    };

/** The threshold-pace corpus's answer. Refusal carries no `tPaceSecPerMi`
 *  (Rule 11). Mirrors `CorpusRead`'s shape one level down (VDOT → T-pace). */
export type ThresholdPaceRead =
  | {
      ok: true;
      /** T-pace the corroborated threshold-zone VDOT implies, s/mi. */
      tPaceSecPerMi: number;
      /** The corroborated threshold-zone VDOT itself (`tPaceFromVdot`'s
       *  input) — reported so a caller can explain the number without
       *  re-deriving it. */
      vdot: number;
      observations: number;
      supporting: PaceObservation[];
    }
  | {
      ok: false;
      reason: EasyPaceCorpusReason;
      observations: number;
    };

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · PURE STATISTICS — no DB, unit-testable without a fixture
 * ═══════════════════════════════════════════════════════════════════════ */

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Pure · the easy-pace band from a set of already-classified observations.
 * Every judgement about which runs QUALIFY (HR zone, duration, label,
 * Rule 8) has already happened upstream — this function's only job is the
 * two statistics, which is why it is testable without a fixture.
 */
export function easyPaceCorpus(
  observations: readonly PaceObservation[],
  minObservations: number = CORROBORATION_MIN_OBSERVATIONS,
): EasyPaceRead {
  const usable = observations.filter((o) => Number.isFinite(o.paceSecPerMi) && o.paceSecPerMi > 0);
  if (usable.length === 0) return { ok: false, reason: 'no_observations', observations: 0 };
  if (usable.length < minObservations) {
    return { ok: false, reason: 'insufficient_corroboration', observations: usable.length };
  }
  // Ascending by pace = fastest first (smaller s/mi is faster).
  const byPaceAsc = [...usable].sort((a, b) => a.paceSecPerMi - b.paceSecPerMi);
  const kthFastest = byPaceAsc[minObservations - 1].paceSecPerMi;
  const med = median(usable.map((o) => o.paceSecPerMi));
  return {
    ok: true,
    band: { lo: Math.min(kthFastest, med), hi: Math.max(kthFastest, med) },
    observations: usable.length,
    supporting: byPaceAsc.slice(0, minObservations),
  };
}

/**
 * Pure · the threshold-pace read from a set of already-classified
 * observations. Converts each to a VDOT (`vdotFromTpace`), corroborates with
 * the SAME `corroboratedCorpusVdot` the fitness ceiling uses, converts back
 * (`tPaceFromVdot`). See "THE THRESHOLD DESIGN" in the file header for why
 * this reuses rather than reimplements the order statistic.
 */
export function thresholdPaceCorpus(
  observations: readonly PaceObservation[],
  minObservations: number = CORROBORATION_MIN_OBSERVATIONS,
): ThresholdPaceRead {
  const byId = new Map<string, PaceObservation>();
  const corpusObs: CorpusObservation[] = [];
  for (const o of observations) {
    if (!Number.isFinite(o.paceSecPerMi) || o.paceSecPerMi <= 0) continue;
    const vdot = vdotFromTpace(o.paceSecPerMi);
    if (vdot == null) continue;
    // Keyed by id, matching corroboratedCorpusVdot's CorpusObservation shape.
    // A duplicate id (two qualifying segments off the same run) keeps the
    // FASTER read — the more informative of two observations of one effort.
    const existing = byId.get(o.id);
    if (!existing || o.paceSecPerMi < existing.paceSecPerMi) byId.set(o.id, o);
    corpusObs.push({ id: o.id, date: o.date, vdot });
  }
  // Re-dedupe corpusObs by id after the byId pass settled the winner, so
  // corroboratedCorpusVdot never double-counts one run as two observations.
  const dedupedObs = [...byId.entries()].map(([id, o]) => {
    const vdot = vdotFromTpace(o.paceSecPerMi)!;
    return { id, date: o.date, vdot };
  });
  const corpusRead = corroboratedCorpusVdot(dedupedObs, minObservations);
  if (!corpusRead.ok) {
    return { ok: false, reason: corpusRead.reason, observations: corpusRead.observations };
  }
  const tPace = tPaceFromVdot(corpusRead.vdot);
  if (tPace == null) {
    // Cannot happen in practice — corpusRead.vdot came FROM tPaceFromVdot's
    // own inverse (vdotFromTpace) and is therefore always in [30,85] — kept
    // as an honest refusal rather than a non-null assertion, per Rule 11.
    return { ok: false, reason: 'no_observations', observations: corpusRead.observations };
  }
  const supporting = corpusRead.supporting
    .map((s) => byId.get(s.id))
    .filter((o): o is PaceObservation => o != null);
  return {
    ok: true,
    tPaceSecPerMi: tPace,
    vdot: corpusRead.vdot,
    observations: corpusRead.observations,
    supporting,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · SEGMENT EXTRACTION (threshold only) — splits-aware, whole-run fallback
 * ═══════════════════════════════════════════════════════════════════════ */

interface ThresholdSegment {
  paceSecPerMi: number;
  durationSec: number;
  source: 'splits' | 'whole-run';
  basis: HrBasis;
}

/**
 * Pool every split whose HR lands in the T-zone (not required to be
 * contiguous — see "THE THRESHOLD DESIGN" for why), sum their distance and
 * time, and require the pooled total to fall inside doctrine's rep/total
 * window. This is what lets a broken structured workout (the owner's own
 * "Broken Long Run" example) count as threshold evidence instead of being
 * diluted into a moderate-looking whole-run average.
 */
export function thresholdSegmentFromSplits(
  rawSplits: unknown,
  ctx: HrContext,
): ThresholdSegment | null {
  const splits = normalizeSplits(rawSplits);
  if (splits.length === 0) return null;
  let totalSec = 0;
  let totalMi = 0;
  let basisUsed: HrBasis | null = null;
  for (const s of splits) {
    if (s.hr == null || s.paceSec == null || !(s.paceSec > 0)) continue;
    const mi = s.distanceMi != null && s.distanceMi > 0 ? s.distanceMi : 1;
    const { inZone, basis } = hrZoneMatch(
      s.hr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND,
    );
    if (!inZone || basis == null) continue;
    totalSec += s.paceSec * mi;
    totalMi += mi;
    basisUsed = basisUsed ?? basis;
  }
  if (totalMi <= 0 || basisUsed == null) return null;
  if (totalSec < THRESHOLD_MIN_QUALIFYING_SEC || totalSec > THRESHOLD_MAX_QUALIFYING_SEC) return null;
  return { paceSecPerMi: totalSec / totalMi, durationSec: totalSec, source: 'splits', basis: basisUsed };
}

/**
 * The weaker fallback for a row with no usable splits. Gated harder than the
 * splits path: the label must positively say threshold-zone, on top of the
 * HR-zone and duration checks — see "THE THRESHOLD DESIGN" for why.
 */
export function thresholdSegmentFromWholeRun(
  row: { finishSec: number | null; distanceMi: number | null; avgHr: number | null; workoutTypeRaw: unknown },
  ctx: HrContext,
): ThresholdSegment | null {
  if (row.finishSec == null || !(row.finishSec > 0)) return null;
  if (row.distanceMi == null || !(row.distanceMi > 0)) return null;
  if (!labelSaysThreshold(row.workoutTypeRaw)) return null;
  const { inZone, basis } = hrZoneMatch(row.avgHr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND);
  if (!inZone || basis == null) return null;
  if (row.finishSec < THRESHOLD_MIN_QUALIFYING_SEC || row.finishSec > THRESHOLD_WHOLE_RUN_MAX_SEC) return null;
  return {
    paceSecPerMi: row.finishSec / row.distanceMi,
    durationSec: row.finishSec,
    source: 'whole-run',
    basis,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · DB-BACKED LOADERS — build the observation pools, then call the pure fns
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CandidateRow {
  id: string;
  date: string;
  distanceMi: number | null;
  finishSec: number | null;
  avgHr: number | null;
  workoutTypeRaw: string | null;
  splits: unknown;
}

/**
 * Pure · classify a set of candidate rows into easy-pace observations.
 * Factored out of `resolveEasyPaceCorpus` so the classification logic (label
 * exclusion + HR-zone gate + duration floor) is testable without a database —
 * every judgement below is a function of its inputs only. Rule 8 filtering is
 * NOT applied here (the caller does it, since it needs the runner's race
 * history, which this function does not take).
 */
export function classifyEasyCandidates(
  rows: readonly CandidateRow[],
  ctx: HrContext,
): PaceObservation[] {
  const out: PaceObservation[] = [];
  for (const row of rows) {
    if (labelExcludesEasy(row.workoutTypeRaw)) continue;
    if (row.finishSec == null || row.finishSec < EASY_MIN_DURATION_SEC) continue;
    if (row.distanceMi == null || !(row.distanceMi > 0)) continue;
    const { inZone, basis } = hrZoneMatch(row.avgHr, ctx, EASY_PCT_HRMAX_BAND, EASY_PCT_LTHR_BAND);
    if (!inZone || basis == null) continue;
    out.push({
      id: row.id,
      date: row.date,
      paceSecPerMi: row.finishSec / row.distanceMi,
      durationSec: row.finishSec,
      source: 'whole-run',
      hrBasis: basis,
    });
  }
  return out;
}

/**
 * Pure · classify a set of candidate rows into threshold-pace observations,
 * splits-aware with the whole-run fallback. Same factoring rationale as
 * `classifyEasyCandidates`. No Rule 8 filtering — see "THE THRESHOLD DESIGN".
 */
export function classifyThresholdCandidates(
  rows: readonly CandidateRow[],
  ctx: HrContext,
): PaceObservation[] {
  const out: PaceObservation[] = [];
  for (const row of rows) {
    if (labelExcludesThreshold(row.workoutTypeRaw)) continue;
    const seg =
      thresholdSegmentFromSplits(row.splits, ctx) ??
      thresholdSegmentFromWholeRun(row, ctx);
    if (seg == null) continue;
    out.push({
      id: row.id,
      date: row.date,
      paceSecPerMi: seg.paceSecPerMi,
      durationSec: seg.durationSec,
      source: seg.source,
      hrBasis: seg.basis,
    });
  }
  return out;
}

async function loadCandidateRows(
  userId: string,
  todayISO: string,
  lookbackDays: number,
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.parse(todayISO + 'T12:00:00Z') - lookbackDays * 86400000)
    .toISOString().slice(0, 10);
  const rows = await pool.query<{
    id: string; date: string; distance_mi: string | null; finish_seconds: string | null;
    avg_hr: string | null; workout_type: string | null; splits: unknown;
  }>(
    `SELECT sa.id::text AS id,
            ${runDaySql('sa')} AS date,
            ${runDistanceMiSql('sa')} AS distance_mi,
            ${runFinishSecSql('sa')} AS finish_seconds,
            ${runAvgHrSql('sa')} AS avg_hr,
            ${runWorkoutTypeSql('sa')} AS workout_type,
            ${runSplitsSql('sa')} AS splits
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND ${runNotMergedSql('sa')}
        AND ${runDaySql('sa')} >= $2
        AND ${runDaySql('sa')} <= $3
        AND ${runFinishSecSql('sa')} > 60
        AND ${runDistanceMiSql('sa')} > 0
        AND ${runAvgHrSql('sa')} IS NOT NULL
        AND ${excludeDistanceReviewSql('sa')}`,
    [userId, cutoff, todayISO],
  ).then((r) => r.rows);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
    finishSec: r.finish_seconds != null ? Number(r.finish_seconds) : null,
    avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
    workoutTypeRaw: r.workout_type,
    splits: r.splits,
  }));
}

async function loadHrContext(userId: string, todayISO: string): Promise<HrContext> {
  const [maxHr, lthrRow] = await Promise.all([
    loadEffectiveMaxHr(userId, todayISO),
    pool.query<{ lthr: number | string | null; lthr_set_at: string | null }>(
      `SELECT lthr, lthr_set_at::date::text AS lthr_set_at FROM profile WHERE user_uuid = $1`,
      [userId],
    ).then((r) => r.rows[0] ?? null),
  ]);
  const lthrBpm = lthrRow?.lthr != null ? Number(lthrRow.lthr) : null;
  return {
    maxHrBpm: maxHr.bpm,
    lthrBpm: Number.isFinite(lthrBpm) && (lthrBpm as number) > 0 ? lthrBpm : null,
    lthrFresh: lthrFloorIsFresh(lthrRow?.lthr_set_at ?? null, todayISO),
  };
}

/**
 * Resolve the easy-pace band from the runner's own classified training.
 *
 * @param todayISO defaults to the runner's local today (`runnerToday`).
 */
export async function resolveEasyPaceCorpus(
  userId: string,
  todayISO?: string,
  opts?: { lookbackDays?: number; minObservations?: number },
): Promise<EasyPaceRead> {
  const today = todayISO ?? await runnerToday(userId);
  const lookbackDays = opts?.lookbackDays ?? EASY_CORPUS_LOOKBACK_DAYS;
  const [rows, ctx, windows] = await Promise.all([
    loadCandidateRows(userId, today, lookbackDays),
    loadHrContext(userId, today),
    loadPrescribedWindows(userId, today),
  ]);

  const raw = classifyEasyCandidates(rows, ctx);
  // Rule 8 · filtered here, on both edges — see "THE EASY DESIGN" for why the
  // median edge specifically needs this and the Kth-fastest edge would not.
  const filtered = excludePrescribedDays(raw, (o) => o.date, windows);
  return easyPaceCorpus(filtered, opts?.minObservations);
}

/**
 * Resolve the threshold-pace read from the runner's own classified training.
 * Deliberately NOT Rule 8-filtered — see "THE THRESHOLD DESIGN" above.
 */
export async function resolveThresholdPaceCorpus(
  userId: string,
  todayISO?: string,
  opts?: { lookbackDays?: number; minObservations?: number },
): Promise<ThresholdPaceRead> {
  const today = todayISO ?? await runnerToday(userId);
  const lookbackDays = opts?.lookbackDays ?? PACE_CORPUS_LOOKBACK_DAYS;
  const [rows, ctx] = await Promise.all([
    loadCandidateRows(userId, today, lookbackDays),
    loadHrContext(userId, today),
  ]);

  const raw = classifyThresholdCandidates(rows, ctx);
  return thresholdPaceCorpus(raw, opts?.minObservations);
}
