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
 *   EASY  · a CEILING (Kth-fastest, mirrors the corpus's own
 *           insensitive-to-the-bottom argument) — settled 2026-08-31 as a
 *           single number with feel-based guidance, not a band to hit. See
 *           "THE EASY DESIGN" below for the ruling and why the Rule 8 filter
 *           still applies even though the statistic is now order-based.
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
 * 2026-08-31 UPDATE · A CEILING, NOT A BAND. This file originally reported a
 * `{lo, hi}` band (Kth-fastest edge + median edge). Overtaken same-day by a
 * SETTLED product decision from the owner's own conversation, recorded in
 * `docs/PRODUCT_DECISIONS.md` §"2026-08-31 · ... Easy pace is a ceiling, not a
 * band": prompted by a Runna comparison ("This is a limit, not a target - run
 * at whatever pace feels truly easy!"), the owner ruled that easy pace should
 * be a single ceiling with feel-based guidance, not a band to hit — "a band
 * implies a target to land inside; a ceiling plus feel-based guidance implies
 * a boundary not to cross, with the runner's own sense doing the rest." He
 * confirmed adopting it ("1 yes we can get this"). This reader now reports
 * ONLY that ceiling — the median edge (a central-tendency "typical easy pace"
 * claim) is deleted, not deferred, because the decision it served no longer
 * stands. `easyPaceBandFromAnchorPace` (vdot.ts, still `{lo, hi}`) is the
 * VDOT-formula path this decision is explicitly about replacing, not a shape
 * this reader owes matching.
 *
 * ceilingSecPerMi = Kth-fastest qualifying pace (K =
 * CORROBORATION_MIN_OBSERVATIONS) — the same order-statistic idea
 * `corroboratedCorpusVdot` uses, applied to pace instead of VDOT: at least K
 * sessions ran this fast or faster at genuinely easy effort, so no single
 * good-weather day can set it. This is exactly "the fastest pace corroborated
 * at genuinely-easy effort" the decision names.
 *
 * RULE 8 · STILL FILTERED, and the argument is NOT "the old `hi` edge needed
 * it so the file keeps filtering out of habit" — re-argued for the ceiling
 * alone, because the statistic changed and the old reasoning doesn't
 * automatically carry over. The Kth-fastest edge *would* survive an unfiltered
 * pool by the same insensitive-to-the-bottom argument `vdot-corpus.ts` uses
 * for ITS ceiling — so why does this one still filter, when that one does not?
 * The two ceilings answer physiologically different questions under a taper.
 * `vdot-corpus.ts`'s residual explicitly WANTS a taper-week fast observation
 * to count, because a race-pace tune-up run during a taper is unambiguous hard
 * effort — real evidence of fitness regardless of the calendar. An EASY run
 * during a taper has no equivalent cover: it is easy-effort by definition, and
 * a rested, low-fatigue body often runs its "easy" faster than it would
 * hold under real training load — which is precisely a claim about what he
 * NORMALLY runs easy, not what he has proven capable of under load, and Rule
 * 8's corollary puts "typical intensity, typical anything" on the filtered
 * side by default. So `excludePrescribedDays` / `loadPrescribedWindows`
 * (lib/training/normal-window.ts) are still applied, reused rather than
 * re-derived, on the sole remaining statistic.
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
 * exists, `thresholdSegmentFromSplits` finds the RELATIVE work-segment shape
 * within the run — a split both clears the absolute T-zone HR band and sits
 * meaningfully faster than the run's own slowest split SEEDS the block, then
 * adjacent splits GROW into it on pace-plus-not-clearly-easy-effort, not on
 * the absolute band alone. Membership is not required to be contiguous
 * end-to-end across the whole run (a broken workout's second rep group joins
 * the pool the same way its first does), but growth itself walks split-by-
 * split from each seed, so a genuine gap (a recovery jog, or 2026-07-14's
 * real HR anomaly) still stops one cluster from merging into another. See
 * `THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI`'s own header for the full
 * design, why a plain median-split and a largest-pace-gap clustering were
 * both tried and falsified first, and the four real/synthetic fixtures it
 * is proven against. The pooled total must still fall inside Research/03
 * §8's own "reps 5-20 min, total 20-60 min" (a little slack applied to the
 * ceiling for split-boundary rounding) — that duration window is unchanged
 * by this redesign; only which splits are ADMITTED into the pool changed.
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
 * PHASES-AWARE, ADDED 2026-08-31 · `coach_intents.value.phases` is the
 * watch's own MEASURED per-rep data (duration, distance, pace and HR all
 * directly instrumented by the device that ran the rep), tried BEFORE splits
 * for exactly that reason — see `thresholdSegmentFromPhases`'s own header
 * for the full design and `classifyThresholdCandidates` for the preference
 * order (phases, then splits, then whole-run; exactly one wins per row, so
 * one real effort never votes twice). Its one structural difference from the
 * splits and whole-run paths, and the reason it earned its own header rather
 * than reusing `hrZoneMatch`'s in/out boolean as a gate: HERE, HEART RATE
 * INFORMS RELIABILITY, IT DOES NOT GATE ADMISSION. Course-corrected mid-build
 * by an external architecture review — Research/03 §8's own footnote is why
 * ("R workouts: HR unreliable ... coach by pace + RPE"), and it is the
 * physiologically correct call: a phase's duration and type are the watch's
 * own boundary around the rep, which is stronger, more direct evidence than
 * an HR reading that may not have caught up in a short rep. Admission stays
 * BINARY per Rule 11 — `type === 'work'`, duration inside doctrine's per-rep
 * window (5-20 min, same citation as the splits path's floor, now with its
 * own ceiling — `THRESHOLD_MAX_REP_SEC`), distance/pace present and finite —
 * and heart rate, when present, is reported on the observation as `hrPct` /
 * `hrBandDistance` rather than thrown away, per `PaceObservation`'s own doc
 * (a retrofit applied to the splits and whole-run paths too, and to the easy
 * reader, so no source in this file collapses a measurement to a boolean any
 * more).
 *
 * RENDERED against the owner's real account, 2026-08-31, after the
 * seed-and-grow splits redesign (see `THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI`'s
 * header for the full "why" — this paragraph is the "what came out"): the
 * threshold corpus now CORROBORATES — 430 s/mi (7:10/mi), off 6
 * observations, VDOT 47.9. This supersedes an intermediate reading of
 * 489 s/mi (8:09/mi) off 4 observations that stood for a few hours between
 * the phases source landing and this redesign — that number was itself
 * still wrong, and visibly so: barely faster than the easy-pace ceiling
 * (491.7 s/mi), the exact defect that motivated this pass. The three
 * supporting observations now: 2026-07-16 (phase-derived, three ~6.8-min
 * reps pooled at 408 s/mi / 6:48/mi), 2026-08-06 (phase-derived, 420 s/mi /
 * 7:00/mi, no HR reading at all), and — NEW — 2026-07-07 (splits-derived,
 * 429 s/mi / 7:09/mi, five pooled work-block splits including HR-drifted
 * miles 158-168 bpm), which REPLACES the same run's own whole-run read
 * (489 s/mi / 8:09/mi) as the third and now-weakest supporting observation:
 * the same real session, read honestly instead of diluted by its own
 * warm-up. Two more real runs corroborate but do not set the level —
 * 2026-07-14 (435 s/mi / 7:15/mi) and 2026-07-21 (451 s/mi / 7:31/mi) — both
 * previously invisible entirely (see the fixtures in `_pace_corpus.test.ts`,
 * pasted verbatim from this same account). The new level sits close to his
 * own stated 6:45-7:00/mi tempo effort, materially closer than the
 * superseded 8:09/mi read, and — the sanity check this whole pass exists to
 * satisfy — 61.7 s/mi faster than the easy-pace ceiling (491.7 s/mi), a
 * physiologically sane gap between easy and threshold effort where the
 * prior number left almost none. His actual 2026-08-11 4x1km session (the
 * `actualPaceSPerMi: 381` / 6:21/mi rep this file's header used to cite as
 * the motivating "residual") correctly does NOT appear anywhere in this
 * corpus: every one of its four work phases is ~4 minutes, under
 * `THRESHOLD_MIN_QUALIFYING_SEC`'s 5-minute per-rep floor, so duration alone
 * excludes it as Repetition-pace work — no HR judgement was needed to reach
 * the right answer, which is the point of gating admission on duration and
 * type rather than on heart rate.
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
 *   · CLOSED 2026-08-31 · THE THRESHOLD READER USED TO ONLY SEE `data.splits`
 *     (MILE-GRANULAR), NOT `coach_intents.value.phases` (THE WATCH'S PER-REP
 *     ACTUALS). This was the one residual this section used to flag loudest.
 *     `thresholdSegmentFromPhases` closes it — see "PHASES-AWARE, ADDED
 *     2026-08-31" above for the design and the real numbers. Kept here,
 *     historically, because the diagnosis that motivated the fix is worth
 *     keeping legible: the fastest work-phase in the owner's `coach_intents`
 *     history was a 2026-08-11 1km interval rep at 381 s/mi (6:21/mi,
 *     `avgHr: 164`, 97.6% of a fresh 168 LTHR) that no reader could see,
 *     because `data.splits` rolls a short fast rep together with the
 *     recovery jog straddling its mile marker and dilutes it — the SAME
 *     reason `vdotFromRun`'s own `useWork` split (vdot-inputs.ts) exists.
 *     What the fix actually found, once built: that specific rep is real
 *     Repetition-pace work, not Threshold — its four reps are each ~4
 *     minutes, under doctrine's 5-minute T-rep floor — and duration alone
 *     correctly excludes it without needing an HR judgement call at all. The
 *     evidence that DOES corroborate T-pace lives in other sessions in the
 *     same corpus (2026-07-16, 2026-08-06) that the file could not see
 *     before this pass. Two complications this entry used to name as reasons
 *     to defer the build are handled explicitly, not sidestepped: HR
 *     unreliability on a short rep (Research/03 §8's "R workouts: HR
 *     unreliable ... coach by pace + RPE") is answered by NOT gating
 *     admission on HR for this source at all (see "PHASES-AWARE" above); the
 *     `verdict: 'missed'/'drifted'/'hit'/'incomplete'` tolerance flag is
 *     carried on `PhaseBreakdown` but still NOT read by this file — an
 *     honest residual, not a silent gap: a `'missed'` or `'incomplete'` work
 *     phase is still admitted today on duration/distance/pace alone, and
 *     whether the device's own pass/fail grade should factor into admission
 *     or into the `hrBandDistance`-style reliability signal is an open
 *     question for whichever pass builds the confidence scorer this file's
 *     richer per-observation metadata now exists to feed.
 *   · SPLITS RECONCILIATION (added same day, after the finding above was
 *     first written) MADE THIS WORSE BEFORE IT MADE IT HONEST — then CLOSED
 *     2026-08-31, same pass as the seed-and-grow redesign above. Once
 *     `thresholdSegmentFromSplits` was gated on `reconcileSplitsTotal`
 *     (lib/runs/coherence.ts — required by check-derived-consistency.sh, and
 *     a real gap: this reader had no defence against a splits array that
 *     doesn't even sum to its own run's distance, the same shape
 *     `splits-adopt.ts` documents a real production row for), the corpus's
 *     observation count on the owner's real 60-day window dropped from 7 to
 *     2 — an honest REFUSAL (Rule 11), not a bug, but an OVER-strict one:
 *     the shared function's absolute 0.25 mi tolerance and its
 *     zero-explicit-distance-means-skip-nothing arithmetic were both right
 *     for THAT function's other call sites and wrong for this one. Two of
 *     the owner's real, coherent runs were among the six casualties —
 *     2026-07-21 (7 of 8 splits carry no per-split distance at all, so the
 *     un-defaulted sum manufactured a false ~7 mi mismatch against a 7.52 mi
 *     row) and 2026-07-14 (a genuine 4.9% GPS auto-lap drift over 9 splits,
 *     comfortably inside ordinary instrumentation noise). This reader now
 *     runs its OWN reconciliation — `THRESHOLD_SPLITS_RELATIVE_DRIFT_FRACTION`,
 *     see that constant's header — that defaults a missing per-split
 *     distance the same way the pooling loop already does (only when at
 *     least one split in the array anchors a real distance) and scales its
 *     tolerance with the run's own length, while `reconcileSplitsTotal`
 *     itself is untouched for every OTHER caller. Both real runs now
 *     corroborate; see `_pace_corpus.test.ts`'s "seed-and-grow, three real
 *     runs" block for both pasted verbatim, and the file header's own
 *     "RENDERED" paragraph for the corpus this recovers them into.
 *   · `hrPct` / `hrBandDistance` (on `PaceObservation`, see its own doc) are
 *     COMPUTED AND PRESERVED, NOT YET CONSUMED. Added 2026-08-31 per an
 *     external architecture review specifically so a future confidence pass
 *     can weight a corroborating observation by how well its heart rate
 *     matched the target zone, instead of the boolean this file used to
 *     collapse that measurement to. As of this pass, nothing reads them —
 *     `thresholdPaceCorpus` / `easyPaceCorpus` still resolve purely by the
 *     Kth-highest order statistic, exactly as before. This is a deliberately
 *     incomplete wiring, not an oversight: the metadata's whole reason for
 *     existing is to be ready for a scorer that has not been built and
 *     falsified yet (CLAUDE.md Rule 21's "wired and inert" pattern would
 *     apply to a half-built consumer far more than it applies to unused
 *     evidence sitting on an observation record).
 */

import { pool } from '@/lib/db/pool';
import { rowsOrEmpty } from '@/lib/db/read';
import { runnerToday, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { loadEffectiveMaxHr, lthrFloorIsFresh } from '@/lib/training/max-hr';
import { mapWatchPhases, type PhaseBreakdown } from '@/lib/coach/run-state';
import {
  CORROBORATION_MIN_OBSERVATIONS,
  corroboratedCorpusVdot,
  type CorpusObservation,
} from '@/lib/training/vdot-corpus';
import { vdotFromTpace, tPaceFromVdot, zoneFromType } from '@/lib/training/vdot';
import { normalizeDataWorkoutType, QUALITY_TYPES } from '@/lib/runs/log-enrich';
import { normalizeSplits } from '@/lib/runs/run-shape';
import { excludeDistanceReviewSql } from '@/lib/runs/distance-guard';
import { MAX_SPLIT_SUM_DRIFT_MI } from '@/lib/runs/coherence';
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
  isPrescribedNonNormal,
  REPRESENTATIVE_LOOKBACK_MAX_DAYS,
  REPRESENTATIVE_LOOKBACK_STEP_DAYS,
  REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS,
  type PrescribedWindow,
} from '@/lib/training/normal-window';
import { SINGLE_ACTIVITY_EVIDENCE_CEILING } from '@/lib/evidence/activity-evidence';
import { classifyRecentActivities } from '@/lib/evidence/load-activity-evidence';

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

/**
 * Research/03 §8 · T row, duration column: "reps 5-20 min, total 20-60
 * min" — the REP CEILING half of the same cell `THRESHOLD_MIN_QUALIFYING_SEC`
 * already reads the floor from. Enforced only against
 * `coach_intents.value.phases` (see `thresholdSegmentFromPhases`), because a
 * phase carries a real rep boundary the watch itself decided, unlike a
 * mile-granular split. A 2026-08-11 production row is the reason this needs
 * its own constant rather than reusing `THRESHOLD_MAX_QUALIFYING_SEC`: four
 * ~4-minute 1&nbsp;km reps at 164-169 bpm (squarely T-zone by HR alone) —
 * without this ceiling they would pool into a 988-second "T session" that
 * is, by Daniels' own duration column, Repetition-pace work wearing a
 * Threshold-zone heart rate. Research/03 §8's own footnote is the reason HR
 * alone cannot be trusted to catch this: "R workouts: HR unreliable ...
 * coach by pace + RPE."
 */
export const THRESHOLD_MAX_REP_SEC = 20 * 60;

/**
 * Research/03 §8 · T row, duration column, the TOTAL FLOOR half of "total
 * 20-60 min" — distinct from `THRESHOLD_MIN_QUALIFYING_SEC` (a per-rep
 * floor) even though both currently read 20/5 minutes from the same cell;
 * they are different doctrine facts that happen to be nameable separately.
 * A single 6-minute qualifying phase is a real rep and still not, on its
 * own, a full threshold session — Daniels prices the SESSION at 20-60
 * minutes of pooled work, so a lone short rep needs company from another
 * rep in the same watch completion before the pooled observation counts.
 */
export const THRESHOLD_MIN_SESSION_TOTAL_SEC = 20 * 60;

/* ══════════════════════════════════════════════════════════════════════════
 * 1b · THE AUTHORITY MODEL (2026-09-01 · the P0 evidence contract)
 *
 * Before this, the threshold corpus was a SECOND evidence engine: it admitted
 * a session on `type === 'work'` + duration alone, ignored whether the phase
 * was ever completed, computed an HR band distance and never read it, gave
 * every admitted observation the same vote in a K-th-best order statistic,
 * and never consulted `lib/evidence/activity-evidence.ts` — the service the
 * Constitution names as the owner of "what did this run demonstrate". On the
 * owner's real account (independent audit, 2026-09-01) the two supporting
 * observations behind the live belief were an abandoned, HR-less treadmill
 * tempo (`completed: false`, 2.86 of 4.0 mi) and an interval day at 91% of
 * LTHR that the Evidence Engine had classified `no_evidence`; one completed
 * session then moved the anchor 10 s/mi in a day while the hero-workout guard
 * — computed by the Evidence Engine — said `anchorMoveCandidate: false`.
 *
 * The contract now: every observation carries a WEIGHT in [0, 1], assembled
 * from four factors that are each reported (`ObservationAuthority`), and the
 * order statistic is weighted (`thresholdPaceCorpus`). A factor of zero is an
 * EXCLUSION with a named reason; nothing is silently dropped.
 *
 *   · HR       · inside the T band → 1; fading linearly to 0 across one further
 *                half-width beyond either edge; absent → reduced, never full.
 *   · duration · the doctrine floor stays where the registry pins it; a session
 *                just under it ramps in over `THRESHOLD_SESSION_DURATION_RAMP_SEC`
 *                instead of vanishing at one second (Rule 9).
 *   · Evidence Engine · `capacities.threshold` for the same run: `evidence`
 *                weight scaled so a single-activity-ceiling session is 1;
 *                `indeterminate` reduced; `no_evidence` EXCLUDED — the owner of
 *                that question has answered it; unavailable → reduced.
 *   · context  · a prescribed taper / race-week / post-race window reduces
 *                authority (Rule 8) and marks the observation non-representative,
 *                so it can support a belief but cannot by itself clear a
 *                representative-session bar downstream.
 *
 * Every number below is a CONVENTION for model stability — not a physiological
 * claim — and is labelled as such in the doctrine registry. They shape how
 * fast a belief may move, never which direction the evidence points.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Sessions between (floor − ramp) and the floor ramp in linearly. CONVENTION. */
export const THRESHOLD_SESSION_DURATION_RAMP_SEC = 5 * 60;
/** Authority of a qualifying segment with NO heart-rate reading. CONVENTION. */
export const THRESHOLD_HR_ABSENT_AUTHORITY = 0.5;
/** Half-widths beyond the band edge over which HR authority fades to zero. CONVENTION. */
export const THRESHOLD_HR_OUT_OF_BAND_FADE_HALF_WIDTHS = 1;
/** Authority of a session inside a prescribed non-normal window (Rule 8). CONVENTION. */
export const PRESCRIBED_WINDOW_AUTHORITY = 0.75;
/** Authority when the Evidence Engine could not tell (`indeterminate`). CONVENTION. */
export const EVIDENCE_ENGINE_INDETERMINATE_AUTHORITY = 0.75;
/** Authority when the Evidence Engine read was unavailable for the row. CONVENTION. */
export const EVIDENCE_ENGINE_UNAVAILABLE_AUTHORITY = 0.75;
/**
 * The most the newest session's arrival may move the corroborated threshold
 * pace, per elapsed day since that session, s/mi. A stateless rate limit: the
 * belief converges on the new evidence over days rather than in one step, and
 * the same session is allowed twice the move the day after. CONVENTION for
 * model stability — doctrine's "one run rarely rewrites the runner" states the
 * direction, not this number.
 */
export const THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 5;

/**
 * SPLIT-LEVEL WORK-SEGMENT SHAPE, not an absolute HR band — 2026-08-31,
 * closing the gap the file's own falsification found the same night the
 * phases source landed: `thresholdSegmentFromSplits` gated every split on
 * absolute T-zone HR membership (`THRESHOLD_PCT_HRMAX_BAND` /
 * `THRESHOLD_PCT_LTHR_BAND`), and Research/03 §1's own confounder table
 * names why that starves real evidence — "Onset lag | 30–90 s to plateau |
 * unreliable for short reps." A tempo mile's HR is still climbing while its
 * PACE has already arrived; gating admission on the absolute band drops the
 * first work mile (or two) of a real effort every time, exactly the
 * "meaningfully faster/elevated relative to the run's own slowest splits"
 * shape a relative reader should catch instead.
 *
 * PROVEN AGAINST THREE REAL, PREVIOUSLY-INVISIBLE RUNS (Rule 13) —
 * 2026-07-21 (tempo, work block miles 3-6 at 156-160 bpm against a fresh
 * LTHR 168 · miles 3 and 4 sit at 92.9%/94.6%, BELOW the 95% absolute floor,
 * so the old gate produced zero splits observations for this run at all),
 * 2026-06-18 (tempo, work block miles 3-6 · mile 3 at 157 bpm/93.5% is the
 * same shape — the old gate pooled only miles 4-6 and quietly dropped a
 * quarter of the real work), and 2026-07-14 (tempo, work miles 3-4 and 6,
 * with mile 5 a genuine anomaly — 6:46/mi at only 141 bpm, a downhill or a
 * sensor glitch — that this design correctly excludes on HR alone without
 * needing to special-case it). See `_pace_corpus.test.ts` for these three
 * pasted verbatim.
 *
 * SEED, THEN GROW — two stages, not one relative test, because a plain
 * "faster/higher than this run's own median" split (tried and falsified
 * first) breaks on a structured workout where work reps OUTNUMBER the
 * warm-up/cooldown/recovery splits: with 5 T-reps against 3 easy splits the
 * median sits INSIDE the work cluster, not between the two, and silently
 * drops a real rep. A largest-gap 1-D clustering was tried next and also
 * falsified — it fixed that case but latched onto the single most extreme
 * outlier mile on a noisier real run (2026-07-14) instead of the true
 * work/non-work boundary. What holds against all four real and synthetic
 * fixtures:
 *
 *   1. SEED — a split both clears the absolute T-zone HR band (the existing,
 *      doctrine-cited signal — still the strongest available for the
 *      cleanest reps) AND sits meaningfully faster than this run's own
 *      slowest usable split (`THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI`).
 *      The pace half of this test is what keeps a late-run, HR-drifted-but-
 *      SLOWER mile (aerobic decoupling in a longer tempo — 2026-08-21's
 *      miles 8-9, 164-163 bpm but 512-519 s/mi against a 477-493 s/mi work
 *      block) from seeding the block and dragging the reported pace toward
 *      exactly the dilution this file exists to stop.
 *   2. GROW — from each seed, walk to the ADJACENT split (by array position,
 *      not `mile` index, so a null-`mile` shape still works) and admit it
 *      when its pace sits within `THRESHOLD_WORK_GROWTH_PACE_MARGIN_SEC_PER_MI`
 *      of the SEED CLUSTER'S OWN average pace — fixed once at seed time, not
 *      a walking reference, because a walking "current block max + margin"
 *      reference ratchets outward and re-admits the same decoupled tail the
 *      seed pace filter was built to keep out (verified against 2026-08-21:
 *      a walking anchor pulls miles 8-9 back in; a fixed one does not) — AND
 *      its effort sits above the EASY band's own upper edge (reusing
 *      `EASY_PCT_LTHR_BAND`/`EASY_PCT_HRMAX_BAND`, not a new invented
 *      threshold): "not still easy effort" is a lower, more honest bar than
 *      "in the T-band" for a split whose HR simply hasn't caught up yet, and
 *      it is what correctly excludes 2026-07-14's anomalous mile 5 (141 bpm,
 *      inside the run's OWN easy band despite a fast 406 s/mi) without a
 *      special case — a real work mile does not read as recovery-easy on
 *      its own heart rate, however GPS-fast it looks.
 *
 * FALLBACK WHEN THE RUN HAS NO SLOW REFERENCE AT ALL. A splits array that is
 * ALREADY trimmed to work-pace only (this file's own pre-existing unit
 * fixtures — three splits, all within 4 s/mi of each other) has no genuine
 * warm-up/cooldown split to measure "meaningfully faster than" against, so
 * requiring one would refuse real evidence for no reason. When the run's own
 * pace spread (`slowest − fastest`) is under
 * `THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI + THRESHOLD_WORK_GROWTH_PACE_MARGIN_SEC_PER_MI`
 * — too narrow to plausibly contain a real WU/CD-vs-work separation — the
 * pace half of the seed test is dropped and every split inside the absolute
 * T-zone band seeds directly, which is exactly the pre-existing behavior for
 * that shape and keeps every prior unit test passing unchanged.
 *
 * HR REMAINS METADATA, NOT AN ADMISSION GATE, on the pooled result — same
 * posture as `thresholdSegmentFromPhases` (see that function's header): the
 * absolute-band membership test still computes `hrPct`/`hrBandDistance` for
 * whatever the seed-and-grow algorithm pooled, so a later confidence pass
 * can weight the observation, but a pooled pct sitting outside the band no
 * longer discards the segment — only the RELATIVE shape and the doctrine
 * duration window do that now.
 */
export const THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI = 30;
export const THRESHOLD_WORK_GROWTH_PACE_MARGIN_SEC_PER_MI = 20;

/**
 * RECONCILIATION, SCALED TO THE RUN — 2026-08-31, the second half of the
 * same falsification pass. `reconcileSplitsTotal` (lib/runs/coherence.ts)
 * stays untouched for its OTHER call sites — its absolute
 * `MAX_SPLIT_SUM_DRIFT_MI` (0.25 mi) is right for the incident it was built
 * to catch (a 1.34-mile row wearing a 4.14-mile splits array, 209% drift, a
 * genuinely wrong-run array) and for a short run generally. It is too tight
 * for THIS reader's real evidence on a longer run: 2026-07-14's real 9-split
 * array sums to 8.41 mi against a stated 8.02 mi run — 0.39 mi, 4.9% of the
 * run — ordinary GPS auto-lap accumulation over 9 mile-triggers, ARITHMETIC
 * instrumentation noise, not a wrong-run array; `reconcileSplitsTotal`
 * refused it outright and the run fell through to the whole-run fallback,
 * where its own WU/CD-diluted average HR (86.9% of a fresh 168 LTHR, under
 * the 95% T-floor) correctly could not rescue it either — the exact
 * "reconciliation made this worse before it made it honest" shape this
 * file's own header already named for 6 OTHER rows, now closed properly
 * instead of accepted as a standing loss.
 *
 * `Math.max(MAX_SPLIT_SUM_DRIFT_MI, THRESHOLD_SPLITS_RELATIVE_DRIFT_FRACTION
 * × distanceMi)` — the absolute floor still governs a short run (unchanged
 * behavior, still catches the 1.34-mile incident: 2.8 mi of drift clears
 * either number by miles), and a longer run earns proportional room for
 * auto-lap noise that scales with its own split count. 7% clears
 * 2026-07-14's real 4.9% with comfortable margin (not a razor's width from
 * the boundary — Rule 9) while a genuinely wrong-run array (209% drift, or
 * the file's other cited incident: 5 splits totalling 4.14 mi on a 1.34-mile
 * row) fails by more than an order of magnitude either way. Arithmetic, not
 * physiology — same reasoning `coherence.ts`'s own header gives for why
 * `MAX_SPLIT_SUM_DRIFT_MI` itself carries no doctrine registry entry.
 *
 * Applied with the SAME per-split distance default the pooling loop below
 * already uses (`s.distanceMi` when present and positive, else 1 mile) —
 * 2026-07-21's real array carries an explicit distance on only its trailing
 * partial mile and none of its 7 full-mile splits; comparing the raw,
 * un-defaulted sum against the row's distance (what the OLD reconciliation
 * call effectively did, since `reconcileSplitsTotal` only sums splits that
 * carry an explicit distance field) manufactures a false 7-mile "mismatch"
 * out of a fully coherent array. Defaulting first is not a laxer check; it
 * is the same arithmetic the rest of this function already trusts, applied
 * before comparison instead of after.
 */
export const THRESHOLD_SPLITS_RELATIVE_DRIFT_FRACTION = 0.07;

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
 * not a guess): at 60 days the easy-pace ceiling read 524.5 s/mi (8:44/mi)
 * off exactly 5 representative observations, all from mid-July — visibly
 * slower than his stated "8:00/mi easily all day, everyday." (Measured
 * before the same-day product decision below dropped the `{lo, hi}` band
 * shape to a ceiling alone — `lo` and the ceiling are the identical Kth-
 * fastest statistic, so the numbers here still hold.) The cause was not the
 * classifier; it was the WINDOW. His
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
 * account's ceiling moved to 491.7 s/mi (8:12/mi) off 12 observations —
 * lining up with the owner's own stated pace to within a few seconds. 120
 * and 150 days recovered a few more observations (16) without moving the
 * ceiling at all, which is the Kth-fastest statistic behaving exactly as
 * designed: additional, slower evidence cannot pull it around.
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

/** Label positively says easy/recovery/long/race — excludes a run from
 *  THRESHOLD candidacy so a stray HR spike (a strides set, a downhill surge)
 *  inside an easy day cannot masquerade as a threshold observation, AND so a
 *  race cannot either.
 *
 *  `'race'` ADDED alongside the phase-data source (2026-08-31): Daniels
 *  defines T-pace as roughly a runner's current ~1-hour race effort, and a
 *  race — strategically paced, run to a competitive plan rather than a
 *  training zone — is a categorically different thing from routine T-work,
 *  the same reasoning `labelExcludesEasy` already applies to easy candidacy.
 *  Concretely: David's 2026-08-16 half marathon carries `coach_intents`
 *  phase data (Point Loma Climb / The Drop / Mission Bay / Harbor Approach /
 *  Balboa Finish — real segments of the course, not reps) whose HR readings
 *  (163-172 bpm against a 168 LTHR) sit inside the T-band by coincidence.
 *  Admitting it would let one race's mile-by-mile effort corroborate a
 *  "threshold pace" that is really this runner's half-marathon race pace.
 *  Applies uniformly to the splits path too, which had no such exclusion
 *  before this change — a genuine pre-existing gap, closed here rather than
 *  narrowly to just the new phase source, because the argument is identical
 *  for both. */
function labelExcludesThreshold(rawWorkoutType: unknown): boolean {
  const norm = normalizeDataWorkoutType(rawWorkoutType);
  return norm === 'easy' || norm === 'recovery' || norm === 'long' || norm === 'shakeout' || norm === 'race';
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
  /** Whether the pace came from a splits-aware segment, the whole run, or
   *  `coach_intents.value.phases` (the watch's own per-rep measurement —
   *  added 2026-08-31, see `thresholdSegmentFromPhases`). */
  source: 'splits' | 'whole-run' | 'phases' | 'evidence-segments';
  /** Which HR basis classified this observation into its zone. Null only
   *  for a phase-derived observation with no heart-rate reading at all
   *  (e.g. a treadmill session with no strap) — every other source always
   *  has one, because HR-in-zone is still a hard admission gate for them. */
  hrBasis: HrBasis | null;
  /**
   * `avgHr / basisBpm` for whichever basis classified this observation — the
   * raw fraction `hrZoneMatch` computed, kept rather than discarded once the
   * pass/fail verdict was read off it. ADDED 2026-08-31, per an external
   * architecture review: a later pass building continuous confidence scoring
   * on top of these readers needs the underlying measurement, not just the
   * boolean this file used to collapse it to. Null exactly when `hrBasis` is
   * null (no HR reading was available to compute it from).
   */
  hrPct: number | null;
  /**
   * How far `hrPct` sits from the CENTER of the qualifying band, in
   * band-half-width units: 0 at the center, 1 at either edge, greater than 1
   * outside it. For every source except phases this observation was already
   * required to be `<= 1` to be admitted at all (HR-in-zone is a hard gate);
   * for a phase-derived observation it can exceed 1 — HR informs reliability
   * there, it does not gate admission (see `thresholdSegmentFromPhases`).
   * Null exactly when `hrPct` is null.
   */
  hrBandDistance: number | null;
  /** 0..1 · the vote this observation carries in the weighted order statistic.
   *  1 for every easy-corpus observation (its gates are binary); the product of
   *  `authority`'s four factors for a threshold observation. */
  weight: number;
  /**
   * 0..1 · what this observation contributes toward the CORROBORATION bar
   * (and toward confidence): `weight` × the age discount. Doctrine: stale
   * evidence lowers CONFIDENCE, never the VALUE — so the level statistic
   * interpolates on `weight`, and only the "is there enough evidence" check
   * and the confidence read this. Undefined = same as `weight`.
   */
  supportWeight?: number;
  /** False only when a phase-derived segment had abandoned work phases dropped
   *  from its pool (the completed reps still count; the abandoned ones never). */
  completed: boolean;
  /** False when the run sits inside a prescribed taper / race-week / recovery
   *  window. Such an observation supports a belief at reduced authority and
   *  may NOT by itself clear a representative-session bar downstream. */
  representative: boolean;
  /** How `weight` was assembled. Reported, never re-derived downstream. */
  authority: ObservationAuthority;
}

export type HrAuthority = 'in_band' | 'near_band' | 'out_of_band' | 'absent';
export type EvidenceEngineVerdictKind = 'evidence' | 'no_evidence' | 'indeterminate' | 'unavailable';

export type ObservationAuthorityReason =
  | 'HR_IN_THRESHOLD_BAND'
  | 'HR_NEAR_THRESHOLD_BAND'
  | 'HR_ABSENT_REDUCED_AUTHORITY'
  | 'SESSION_SHORT_OF_DOCTRINE_FLOOR'
  | 'EVIDENCE_ENGINE_CORROBORATES'
  | 'EVIDENCE_ENGINE_INDETERMINATE'
  | 'EVIDENCE_ENGINE_UNAVAILABLE'
  | 'SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER'
  | 'INSIDE_PRESCRIBED_WINDOW'
  | 'ABANDONED_PHASES_DROPPED'
  | 'PRICED_FROM_EVIDENCE_ENGINE_SEGMENTS'
  | 'AGE_DISCOUNTED_BEYOND_BASE_WINDOW';

export interface ObservationAuthority {
  hr: HrAuthority;
  hrFactor: number;
  durationFactor: number;
  evidenceKind: EvidenceEngineVerdictKind;
  /** The Evidence Engine's own 0..1 threshold weight for the run, when read. */
  evidenceWeight: number | null;
  anchorMoveCandidate: boolean | null;
  evidenceFactor: number;
  contextFactor: number;
  /** 1 inside the base lookback; halves every
   *  `REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS` beyond it when the window had to
   *  widen. Applied last, so an old session can support but never dominate. */
  stalenessFactor: number;
  ageDays: number | null;
  reasons: ObservationAuthorityReason[];
}

export type ExclusionReason =
  | 'LABEL_RACE'
  | 'LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE'
  | 'EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE'
  | 'WORK_PHASES_ABANDONED'
  | 'NO_QUALIFYING_SEGMENT'
  | 'SESSION_BELOW_DURATION_FLOOR'
  | 'HR_OUTSIDE_THRESHOLD_BAND'
  | 'LABEL_NON_QUALITY_UNPRICEABLE'
  | 'OUTSIDE_LOOKBACK_WINDOW';

/** An observation the classifier looked at and refused, with the reason. Kept
 *  so "why is this run not in my threshold evidence" is answerable. */
export interface ExcludedObservation {
  id: string;
  date: string;
  reason: ExclusionReason;
  paceSecPerMi: number | null;
  detail: string;
}

/** The Evidence Engine's verdict on one run's THRESHOLD capacity, as the
 *  corpus consumes it (`lib/evidence/activity-evidence.ts#CapacityEvidence`). */
export interface ThresholdEvidenceVerdict {
  kind: 'evidence' | 'no_evidence' | 'indeterminate';
  weight: number | null;
  anchorMoveCandidate: boolean;
  /** The Engine's own `threshold_like` segments — the ONLY admissible pricing
   *  for a run whose plan label says easy/long/recovery. Pooling HR-in-zone
   *  splits from a long run prices cardiac drift, not threshold (the owner's
   *  2026-07-12 long run read 8:06/mi "threshold" that way). */
  segments?: EvidenceSegmentRead[];
}

export interface EvidenceSegmentRead {
  paceSecPerMi: number;
  durationSec: number;
  meanHrBpm: number | null;
}

/** Full authority — the easy corpus's observations, whose admission gates are
 *  all binary and already applied. */
export function fullAuthority(): Pick<PaceObservation, 'weight' | 'completed' | 'representative' | 'authority'> {
  return {
    weight: 1,
    completed: true,
    representative: true,
    authority: {
      hr: 'in_band', hrFactor: 1, durationFactor: 1,
      evidenceKind: 'unavailable', evidenceWeight: null, anchorMoveCandidate: null,
      evidenceFactor: 1, contextFactor: 1, stalenessFactor: 1, ageDays: null, reasons: [],
    },
  };
}

/**
 * How far `pct` sits from the center of `band`, in band-half-width units — 0
 * at the center, 1 at either edge, greater than 1 outside it. Pure; shared by
 * every classifier below so "how well did HR match" is computed the same way
 * regardless of which source produced the observation.
 */
function hrBandDistance(pct: number | null, band: readonly [number, number]): number | null {
  if (pct == null) return null;
  const center = (band[0] + band[1]) / 2;
  const halfWidth = (band[1] - band[0]) / 2;
  if (!(halfWidth > 0)) return null;
  return Math.abs(pct - center) / halfWidth;
}

/** `EASY_PCT_LTHR_BAND` when `basis` is `'pct_lthr'`, else
 *  `EASY_PCT_HRMAX_BAND` — the band `hrZoneMatch` actually used, so a caller
 *  computing `hrBandDistance` after the fact matches the same precedence. */
function easyBandFor(basis: HrBasis): readonly [number, number] {
  return basis === 'pct_lthr' ? EASY_PCT_LTHR_BAND : EASY_PCT_HRMAX_BAND;
}

/** The threshold-reader sibling of `easyBandFor`. */
function thresholdBandFor(basis: HrBasis): readonly [number, number] {
  return basis === 'pct_lthr' ? THRESHOLD_PCT_LTHR_BAND : THRESHOLD_PCT_HRMAX_BAND;
}

export type EasyPaceCorpusReason = 'no_observations' | 'insufficient_corroboration';

/** The easy-pace corpus's answer. Refusal carries no `band` (Rule 11). */
export type EasyPaceRead =
  | {
      ok: true;
      /** The fastest pace corroborated at genuinely-easy effort, s/mi — a
       *  single ceiling per the 2026-08-31 product decision ("a boundary not
       *  to cross", not a band to hit). */
      ceilingSecPerMi: number;
      observations: number;
      /** The K fastest qualifying observations — what sets the ceiling. */
      supporting: PaceObservation[];
    }
  | {
      ok: false;
      reason: EasyPaceCorpusReason;
      observations: number;
    };

/** The move-cap record for a read that was not compared against a prior
 *  (test fixtures, hand-built reads). */
export function uncappedMoveCap(tPaceSecPerMi: number): ThresholdMoveCap {
  return {
    applied: false, uncappedSecPerMi: tPaceSecPerMi, priorSecPerMi: null,
    allowedSecPerMi: null, newestDate: null, daysSinceNewest: null,
  };
}

/** How the daily move cap treated this read. Reported on every ok read. */
export interface ThresholdMoveCap {
  applied: boolean;
  /** The weighted read INCLUDING the newest session, s/mi. */
  uncappedSecPerMi: number;
  /** The weighted read EXCLUDING every observation on the newest date, s/mi.
   *  Null when that read could not corroborate on its own (first evidence). */
  priorSecPerMi: number | null;
  /** How far the newest session was allowed to move the read, s/mi. */
  allowedSecPerMi: number | null;
  newestDate: string | null;
  daysSinceNewest: number | null;
}

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
      /** Σ weight over every admitted observation. The corroboration bar is
       *  measured against THIS, not against a head count. */
      weightedSupport: number;
      /** Supporting observations outside any prescribed window. */
      representativeSupporting: number;
      excluded: ExcludedObservation[];
      moveCap: ThresholdMoveCap;
      /** The lookback the read settled on, days (base, or widened in steps). */
      windowDays: number;
    }
  | {
      ok: false;
      reason: EasyPaceCorpusReason;
      observations: number;
      weightedSupport: number;
      excluded: ExcludedObservation[];
      windowDays: number;
    };

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · PURE STATISTICS — no DB, unit-testable without a fixture
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Pure · the easy-pace ceiling from a set of already-classified observations.
 * Every judgement about which runs QUALIFY (HR zone, duration, label,
 * Rule 8) has already happened upstream — this function's only job is the
 * order statistic, which is why it is testable without a fixture.
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
  return {
    ok: true,
    ceilingSecPerMi: kthFastest,
    observations: usable.length,
    supporting: byPaceAsc.slice(0, minObservations),
  };
}

/**
 * Pure · the threshold-pace read from a set of already-classified, already-
 * WEIGHTED observations.
 *
 * ── THE WEIGHTED ORDER STATISTIC ────────────────────────────────────────────
 * `corroboratedCorpusVdot` (the fitness ceiling) is "the K-th best VDOT of N":
 * every admitted observation has one vote and a new observation either takes a
 * slot or does not. That is the shape that let one session move the owner's
 * anchor 8 s/mi in a day — it displaced the third-fastest slot outright — and
 * it is the shape Rule 9 forbids: a hair's difference in one observation's
 * admissibility is a categorical change in the answer.
 *
 * This reader keeps the K-corroboration PRINCIPLE (the level is set by evidence
 * that at least K observations' worth of authority agrees with or beats) and
 * makes it continuous: observations are sorted fastest-first, their weights
 * accumulate, and the level is the pace at which the running weight reaches K,
 * interpolated between the two observations that straddle it. An observation
 * at weight 0.5 pulls the level half as far as a full one; an observation whose
 * weight goes 0 → 1 moves the answer smoothly, never in a step.
 *
 * ── THE DAILY MOVE CAP ─────────────────────────────────────────────────────
 * Doctrine: "one run should rarely rewrite the runner". The Evidence Engine
 * already computes a per-activity `anchorMoveCandidate`; that flag now reaches
 * this reader through the weights (`ObservationAuthority`). Independently of
 * the weights, the read is compared against the same read WITHOUT every
 * observation on the newest date, and the difference is bounded by
 * `THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI` per elapsed day since that date.
 * Stateless, so it needs no persisted prior: the day after, the same session is
 * allowed twice the move, and the belief converges on the evidence over days.
 * Only applies when the without-read can itself corroborate; the FIRST
 * corroboration is never capped against nothing.
 */
export function thresholdPaceCorpus(
  observations: readonly PaceObservation[],
  minObservations: number = CORROBORATION_MIN_OBSERVATIONS,
  opts?: {
    todayISO?: string;
    excluded?: readonly ExcludedObservation[];
    windowDays?: number;
    /** The read WITHOUT the newest date's observations, settled on its own
     *  window by the caller. When omitted, computed from `observations`
     *  alone (the pure-statistic path). */
    priorRead?: ThresholdPaceRead | null;
  },
): ThresholdPaceRead {
  const excluded = [...(opts?.excluded ?? [])];
  const windowDays = opts?.windowDays ?? PACE_CORPUS_LOOKBACK_DAYS;
  const full = weightedThresholdLevel(observations, minObservations);
  if (!full.ok) {
    return {
      ok: false, reason: full.reason, observations: full.observations,
      weightedSupport: full.weightedSupport, excluded, windowDays,
    };
  }

  let tPace = full.tPaceSecPerMi;
  let vdot = full.vdot;
  const newestDate = full.usable.reduce<string | null>(
    (m, o) => (m == null || o.date > m ? o.date : m), null,
  );
  const moveCap: ThresholdMoveCap = {
    applied: false, uncappedSecPerMi: full.tPaceSecPerMi, priorSecPerMi: null,
    allowedSecPerMi: null, newestDate, daysSinceNewest: null,
  };
  if (opts?.todayISO && newestDate) {
    const without: { ok: true; tPaceSecPerMi: number } | { ok: false } = opts.priorRead !== undefined
      ? (opts.priorRead && opts.priorRead.ok ? { ok: true, tPaceSecPerMi: opts.priorRead.tPaceSecPerMi } : { ok: false })
      : weightedThresholdLevel(full.usable.filter((o) => o.date !== newestDate), minObservations);
    const daysSince = Math.max(0, Math.round(
      (Date.parse(opts.todayISO + 'T12:00:00Z') - Date.parse(newestDate + 'T12:00:00Z')) / 86_400_000,
    ));
    moveCap.daysSinceNewest = daysSince;
    if (without.ok) {
      const allowed = THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI * (daysSince + 1);
      moveCap.priorSecPerMi = without.tPaceSecPerMi;
      moveCap.allowedSecPerMi = allowed;
      const delta = full.tPaceSecPerMi - without.tPaceSecPerMi;
      if (Math.abs(delta) > allowed) {
        tPace = Math.round(without.tPaceSecPerMi + Math.sign(delta) * allowed);
        vdot = vdotFromTpace(tPace) ?? vdot;
        moveCap.applied = true;
      }
    }
  }

  return {
    ok: true,
    tPaceSecPerMi: tPace,
    vdot,
    observations: full.observations,
    supporting: full.supporting,
    weightedSupport: full.weightedSupport,
    representativeSupporting: full.supporting.filter((o) => o.representative).length,
    excluded,
    moveCap,
    windowDays,
  };
}

/** The weighted K-th-best level, uncapped. Pure. */
function weightedThresholdLevel(
  observations: readonly PaceObservation[],
  minObservations: number,
):
  | { ok: true; tPaceSecPerMi: number; vdot: number; observations: number; weightedSupport: number; supporting: PaceObservation[]; usable: PaceObservation[] }
  | { ok: false; reason: EasyPaceCorpusReason; observations: number; weightedSupport: number } {
  // One observation per run: a duplicate id (two qualifying segments off the
  // same run) keeps the FASTER read — the more informative of two observations
  // of one effort — so the same real effort cannot vote twice.
  const byId = new Map<string, PaceObservation>();
  for (const o of observations) {
    if (!Number.isFinite(o.paceSecPerMi) || o.paceSecPerMi <= 0) continue;
    if (!(o.weight > 0)) continue;
    if (vdotFromTpace(o.paceSecPerMi) == null) continue;
    const existing = byId.get(o.id);
    if (!existing || o.paceSecPerMi < existing.paceSecPerMi) byId.set(o.id, o);
  }
  const usable = [...byId.values()];
  if (usable.length === 0) return { ok: false, reason: 'no_observations', observations: 0, weightedSupport: 0 };
  const k = Math.max(1, minObservations);
  // Fastest first == highest VDOT first == smallest s/mi first.
  const sorted = [...usable].sort((a, b) => a.paceSecPerMi - b.paceSecPerMi);
  const weightedSupport = sorted.reduce((acc, o) => acc + Math.min(1, o.supportWeight ?? o.weight), 0);
  if (weightedSupport < k) {
    return { ok: false, reason: 'insufficient_corroboration', observations: usable.length, weightedSupport };
  }
  let cum = 0;
  let levelPace = sorted[sorted.length - 1].paceSecPerMi;
  let idx = sorted.length - 1;
  for (let i = 0; i < sorted.length; i++) {
    const w = Math.min(1, sorted[i].weight);
    const before = cum;
    cum += w;
    if (cum >= k) {
      // Interpolate between the previous observation's pace (the level the
      // running weight had reached) and this one's, by the share of this
      // observation's weight needed to reach K.
      const frac = w > 0 ? (k - before) / w : 1;
      const prevPace = i === 0 ? sorted[0].paceSecPerMi : sorted[i - 1].paceSecPerMi;
      levelPace = prevPace + (sorted[i].paceSecPerMi - prevPace) * Math.max(0, Math.min(1, frac));
      idx = i;
      break;
    }
  }
  const tPace = Math.round(levelPace);
  const vdot = vdotFromTpace(tPace);
  if (vdot == null) return { ok: false, reason: 'no_observations', observations: usable.length, weightedSupport };
  return {
    ok: true, tPaceSecPerMi: tPace, vdot,
    observations: usable.length, weightedSupport,
    supporting: sorted.slice(0, idx + 1), usable,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · SEGMENT EXTRACTION (threshold only) — splits-aware, whole-run fallback
 * ═══════════════════════════════════════════════════════════════════════ */

interface ThresholdSegment {
  /** Work phases dropped from the pool because the watch recorded them as
   *  never completed. Only the phases reader can know this. */
  abandonedPhases?: number;
  paceSecPerMi: number;
  durationSec: number;
  source: 'splits' | 'whole-run' | 'phases' | 'evidence-segments';
  /** Null only for a phase-derived segment with no HR reading at all. */
  basis: HrBasis | null;
  /** See `PaceObservation.hrPct` — carried through unchanged. */
  hrPct: number | null;
  /** See `PaceObservation.hrBandDistance` — carried through unchanged. */
  hrBandDistance: number | null;
}

/**
 * Pool every split whose HR lands in the T-zone (not required to be
 * contiguous — see "THE THRESHOLD DESIGN" for why), sum their distance and
 * time, and require the pooled total to fall inside doctrine's rep/total
 * window. This is what lets a broken structured workout (the owner's own
 * "Broken Long Run" example) count as threshold evidence instead of being
 * diluted into a moderate-looking whole-run average.
 *
 * `runDistanceMi` gates trust in the splits array itself before any of that:
 * `reconcileSplitsTotal` (lib/runs/coherence.ts) is the shared check that a
 * splits array actually decomposes ITS OWN run — `splits-adopt.ts`'s own
 * header names a real production row whose splits summed to 12.0 mi against a
 * stated 1.00 mi. A corrupted array like that would otherwise hand a fast,
 * HR-plausible-looking pace to the threshold corpus from a run that never
 * happened at that distance. Refuses (falls through to the whole-run
 * fallback) only on an EXPLICIT mismatch (`false`) — `null` means the splits
 * carry no per-split distance to check at all, which most of the historical
 * shapes don't, and is not itself a contradiction (see that function's own
 * doc comment).
 */
export function thresholdSegmentFromSplits(
  rawSplits: unknown,
  ctx: HrContext,
  runDistanceMi: number | null = null,
): ThresholdSegment | null {
  const splits = normalizeSplits(rawSplits);
  if (splits.length === 0) return null;

  // Distance per split, defaulted the SAME way the pooling loop below
  // defaults it — see THRESHOLD_SPLITS_RELATIVE_DRIFT_FRACTION's own doc for
  // why comparing the raw, un-defaulted sum (what reconcileSplitsTotal does)
  // manufactures a false mismatch on an array whose full-mile splits carry
  // no explicit distance field at all.
  const miFor = (s: { distanceMi: number | null }): number =>
    s.distanceMi != null && s.distanceMi > 0 ? s.distanceMi : 1;

  // Only when at least one split carries a REAL, explicit distance do we
  // have any evidence the "1 mile when absent" default is a valid reading of
  // this array at all (2026-07-21's real row: 7 of 8 splits carry none, and
  // its one trailing partial-mile split is exactly that anchor). Zero
  // anchors — every split silent on distance, e.g. a shape that reports
  // per-kilometre rather than per-mile — is the SAME "nothing to check"
  // case `reconcileSplitsTotal` itself refuses to touch, not license to
  // assume miles; skip the check rather than default-fill blind.
  const anchored = splits.some((x) => x.distanceMi != null && x.distanceMi > 0);
  if (anchored && runDistanceMi != null && runDistanceMi > 0) {
    const summed = splits.reduce((s, x) => s + miFor(x), 0);
    const tolerance = Math.max(
      MAX_SPLIT_SUM_DRIFT_MI,
      THRESHOLD_SPLITS_RELATIVE_DRIFT_FRACTION * runDistanceMi,
    );
    if (Math.abs(summed - runDistanceMi) > tolerance) return null;
  }

  // Every split carrying both an HR and a pace, with the SAME absolute
  // T-zone classification the old admission gate used — still computed, now
  // spent as the SEED signal (and later as pooled metadata) rather than as
  // the sole admission test. `index` is the split's position in the
  // normalized array, not `mile` — adjacency below walks POSITION, since a
  // shape carrying no `mile` field still has a real sequence.
  const signals = splits
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.hr != null && s.paceSec != null && s.paceSec > 0)
    .map(({ s, index }) => {
      const { inZone, basis, pct } = hrZoneMatch(
        s.hr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND,
      );
      return { index, paceSec: s.paceSec as number, mi: miFor(s), inThresholdBand: inZone, basis, pct };
    });
  if (signals.length === 0) return null;

  const paces = signals.map((s) => s.paceSec);
  const slowestPaceSec = Math.max(...paces);
  const fastestPaceSec = Math.min(...paces);
  const spreadSec = slowestPaceSec - fastestPaceSec;
  const seedMargin = THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI + THRESHOLD_WORK_GROWTH_PACE_MARGIN_SEC_PER_MI;
  // No genuine slow reference to separate from (an already-trimmed,
  // work-pace-only array) — trust the absolute band alone, the pre-existing
  // behavior for that shape. See this constant's own doc for the fixtures
  // this fallback keeps passing.
  const seedPaceCeiling = spreadSec >= seedMargin
    ? slowestPaceSec - THRESHOLD_WORK_SEED_PACE_MARGIN_SEC_PER_MI
    : Infinity;

  const seeds = signals.filter((s) => s.inThresholdBand && s.paceSec <= seedPaceCeiling);
  if (seeds.length === 0) return null;

  const seedAvgPace = seeds.reduce((a, s) => a + s.paceSec, 0) / seeds.length;
  const growthCeiling = seedAvgPace + THRESHOLD_WORK_GROWTH_PACE_MARGIN_SEC_PER_MI;

  const easyCeilingFor = (basis: HrBasis): number =>
    basis === 'pct_lthr' ? EASY_PCT_LTHR_BAND[1] : EASY_PCT_HRMAX_BAND[1];
  const notClearlyEasy = (s: (typeof signals)[number]): boolean =>
    s.basis != null && s.pct != null && s.pct > easyCeilingFor(s.basis);

  const byIndex = new Map(signals.map((s) => [s.index, s]));
  const admitted = new Set(seeds.map((s) => s.index));
  const queue = [...admitted];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    for (const n of [i - 1, i + 1]) {
      if (admitted.has(n)) continue;
      const sig = byIndex.get(n);
      if (!sig) continue;
      if (sig.paceSec <= growthCeiling && notClearlyEasy(sig)) {
        admitted.add(n);
        queue.push(n);
      }
    }
  }

  const pooled = signals.filter((s) => admitted.has(s.index));
  let totalSec = 0;
  let totalMi = 0;
  let pctWeighted = 0;
  let pctWeight = 0;
  let basisUsed: HrBasis | null = null;
  for (const s of pooled) {
    const sec = s.paceSec * s.mi;
    totalSec += sec;
    totalMi += s.mi;
    basisUsed = basisUsed ?? s.basis;
    if (s.pct != null) { pctWeighted += s.pct * sec; pctWeight += sec; }
  }
  if (totalMi <= 0) return null;
  if (totalSec < THRESHOLD_MIN_QUALIFYING_SEC || totalSec > THRESHOLD_MAX_QUALIFYING_SEC) return null;

  const pooledPct = pctWeight > 0 ? pctWeighted / pctWeight : null;
  return {
    paceSecPerMi: totalSec / totalMi,
    durationSec: totalSec,
    source: 'splits',
    basis: basisUsed,
    hrPct: pooledPct,
    hrBandDistance: basisUsed != null ? hrBandDistance(pooledPct, thresholdBandFor(basisUsed)) : null,
  };
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
  const { inZone, basis, pct } = hrZoneMatch(row.avgHr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND);
  if (!inZone || basis == null) return null;
  if (row.finishSec < THRESHOLD_MIN_QUALIFYING_SEC || row.finishSec > THRESHOLD_WHOLE_RUN_MAX_SEC) return null;
  return {
    paceSecPerMi: row.finishSec / row.distanceMi,
    durationSec: row.finishSec,
    source: 'whole-run',
    basis,
    hrPct: pct,
    hrBandDistance: hrBandDistance(pct, thresholdBandFor(basis)),
  };
}

/**
 * PHASE RELIABILITY, NOT A GATE — added 2026-08-31 alongside
 * `coach_intents.value.phases` as a threshold-evidence source, course-
 * corrected mid-build by an external architecture review of this exact
 * change. `thresholdSegmentFromSplits` / `FromWholeRun` above treat the
 * T-zone HR check as STAGE-1 ADMISSION: fail it and the segment never enters
 * the pool. A phase is different evidence and earns a different design: it
 * is the watch's own MEASURED per-rep boundary — duration, distance and pace
 * are directly instrumented by the device that ran the rep, not
 * reconstructed after the fact from a mile-binned GPS stream the way a split
 * is. "Right duration, right pace, clearly a work interval and not a
 * recovery jog" is already strong evidence on its own, and Research/03 §8's
 * own footnote says heart rate is the WEAKER signal for a short rep, not the
 * stronger one: "R workouts: HR unreliable ... coach by pace + RPE."
 *
 * So admission here is STAGE 1 ONLY, and it stays binary per Rule 11 — a
 * phase either qualifies or it does not, on facts that cannot be corrupted
 * into ambiguity:
 *
 *   · genuinely `type === 'work'` — never a recovery jog, warm-up or
 *     cool-down, so the rest BETWEEN reps can never masquerade as the reps
 *     themselves.
 *   · `actual_duration_sec` inside doctrine's own PER-REP window — the same
 *     citation the splits path already uses for its pooled-total floor,
 *     applied here per-phase because a phase, unlike a split, IS one rep:
 *     `THRESHOLD_MIN_QUALIFYING_SEC` (5 min) to `THRESHOLD_MAX_REP_SEC`
 *     (20 min). This is what correctly excludes David's 2026-08-11 4x1km
 *     session (four ~4-minute reps at a T-zone heart rate that are, by
 *     duration alone, Repetition-pace work) without needing HR to make that
 *     call at all.
 *   · `actual_distance_mi` present, finite and positive — not corrupted.
 *
 * Heart rate — when present — is computed exactly as it is for the other two
 * sources (`hrZoneMatch` against the same T-band) and reported on the
 * resulting segment as `hrPct` / `hrBandDistance`, but it does NOT gate
 * admission and it does NOT widen or narrow the duration/type checks above.
 * A future confidence pass can weight a corroborating observation by how
 * close its HR sat to band center; this pass only refuses to throw that
 * measurement away before such a pass exists to use it (see
 * `PaceObservation`'s own doc for the same reasoning applied to every
 * source, including a retrofit of the two above).
 *
 * POOLING mirrors the splits path: multiple qualifying work phases in one
 * watch completion (repeated cruise intervals, say) sum their distance and
 * time into one observation, and the pooled total must still clear
 * doctrine's SESSION floor (`THRESHOLD_MIN_SESSION_TOTAL_SEC`, 20 min) —
 * one lone 6-minute rep is real work and still not, by itself, a full
 * threshold session.
 */
export function thresholdSegmentFromPhases(
  phases: readonly PhaseBreakdown[],
  ctx: HrContext,
): ThresholdSegment | null {
  // 2026-09-01 · an abandoned phase is not a rep. The watch stamps
  // `completed: false` on a work phase the runner stopped before its target;
  // its partial distance and pace describe a rep that did not happen. The
  // owner's 2026-08-06 treadmill (`completed: false`, 2.86 of 4.0 mi, no HR)
  // was half of the live threshold belief through this gap.
  const abandoned = phases.filter((p) => p.type === 'work' && p.completed === false).length;
  const qualifying = phases.filter((p) =>
    p.type === 'work'
    && p.completed !== false
    && p.actual_duration_sec != null
    && p.actual_duration_sec >= THRESHOLD_MIN_QUALIFYING_SEC
    && p.actual_duration_sec <= THRESHOLD_MAX_REP_SEC
    && p.actual_distance_mi != null
    && p.actual_distance_mi > 0,
  );
  if (qualifying.length === 0) return null;

  let totalSec = 0;
  let totalMi = 0;
  let hrWeighted = 0;
  let hrWeight = 0;
  for (const p of qualifying) {
    const sec = p.actual_duration_sec as number;
    totalSec += sec;
    totalMi += p.actual_distance_mi as number;
    // A phase with no reading contributes to neither numerator nor weight —
    // same convention as `workAveragesFromPhases`, so a partly-instrumented
    // session (a strap that dropped mid-run) does not drag the pooled HR
    // toward a reading that was never measured.
    if (p.avg_hr != null && p.avg_hr > 0) { hrWeighted += p.avg_hr * sec; hrWeight += sec; }
  }
  if (totalMi <= 0) return null;
  // The doctrine floor is still the floor (`THRESHOLD_MIN_SESSION_TOTAL_SEC`,
  // registry-bound). A session inside `THRESHOLD_SESSION_DURATION_RAMP_SEC`
  // under it is RETURNED and ramped in by weight in `classifyThresholdCandidates`
  // rather than vanishing at one second — the owner's 2026-08-04 (1161 s) and
  // 2026-08-06 (1200 s) shapes differed by 39 s and one was half the runner
  // model while the other did not exist (Rule 9).
  if (totalSec < THRESHOLD_MIN_SESSION_TOTAL_SEC - THRESHOLD_SESSION_DURATION_RAMP_SEC
      || totalSec > THRESHOLD_MAX_QUALIFYING_SEC) return null;

  const pooledHr = hrWeight > 0 ? hrWeighted / hrWeight : null;
  const { basis, pct } = hrZoneMatch(pooledHr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND);
  return {
    abandonedPhases: abandoned,
    paceSecPerMi: totalSec / totalMi,
    durationSec: totalSec,
    source: 'phases',
    basis,
    hrPct: pct,
    hrBandDistance: basis != null ? hrBandDistance(pct, thresholdBandFor(basis)) : null,
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
  /**
   * `coach_intents.value.phases` for this row's date, already parsed via
   * `mapWatchPhases` (lib/coach/run-state.ts — the same accessor run detail
   * itself uses, reused rather than re-derived). Optional and defaults to
   * empty: `classifyEasyCandidates` never reads it, `loadCandidateRows`
   * itself does not populate it (a separate, batched query does — see
   * `loadPhasesByDate`), and every hand-built `CandidateRow` literal in this
   * file's own unit tests predates this field.
   */
  phases?: PhaseBreakdown[];
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
    const { inZone, basis, pct } = hrZoneMatch(row.avgHr, ctx, EASY_PCT_HRMAX_BAND, EASY_PCT_LTHR_BAND);
    if (!inZone || basis == null) continue;
    out.push({
      id: row.id,
      date: row.date,
      paceSecPerMi: row.finishSec / row.distanceMi,
      durationSec: row.finishSec,
      source: 'whole-run',
      hrBasis: basis,
      hrPct: pct,
      hrBandDistance: hrBandDistance(pct, easyBandFor(basis)),
      ...fullAuthority(),
    });
  }
  return out;
}

/**
 * Pure · classify a set of candidate rows into threshold-pace observations:
 * phase-aware first (the watch's own MEASURED per-rep data — the most
 * direct evidence, see `thresholdSegmentFromPhases`), then splits-aware,
 * then the whole-run fallback. Same factoring rationale as
 * `classifyEasyCandidates`. No Rule 8 filtering — see "THE THRESHOLD DESIGN".
 *
 * Exactly one segment wins per row — a run whose watch completion carries
 * BOTH qualifying phases and reconciling splits contributes ONE observation
 * to the corroboration pool, not two, so the same real effort cannot vote
 * twice. Phases are tried first because they are the more direct
 * measurement: a mile-granular split is a mile-boundary reconstruction of a
 * continuous GPS/pace stream, while a phase is the boundary the watch itself
 * drew around the rep as it ran it.
 */
export function classifyThresholdCandidates(
  rows: readonly CandidateRow[],
  ctx: HrContext,
  opts?: ThresholdClassifyOptions,
): PaceObservation[] {
  return classifyThresholdCandidatesDetailed(rows, ctx, opts).observations;
}

export interface ThresholdClassifyOptions {
  /** The Evidence Engine's per-run threshold verdicts, keyed by `runs.id`.
   *  `undefined` = the read was not attempted; a map = it was, and a run
   *  absent from it was not classified (treated as unavailable). */
  evidence?: ReadonlyMap<string, ThresholdEvidenceVerdict> | null;
  /** Prescribed taper / race-week / recovery windows (Rule 8 context). */
  windows?: readonly PrescribedWindow[] | null;
}

/**
 * Pure · classify candidate rows into WEIGHTED threshold observations, and
 * return every exclusion with its reason (the evidence contract's
 * "preserve provenance for every included and excluded observation").
 *
 * Admission order, and what each step may and may not decide:
 *   1 · a `race` label is excluded outright — a race enters the model through
 *       the durability exponent, never as routine T work.
 *   2 · the Evidence Engine's verdict outranks the plan label. A day labelled
 *       easy/long/recovery/shakeout is admissible when the Engine found
 *       threshold evidence in it (the owner's 2026-08-30 long run carried 44
 *       minutes of threshold-like work); a day labelled tempo is excluded when
 *       the Engine says it demonstrated nothing.
 *   3 · a segment reader must price it (phases → splits → whole-run). Abandoned
 *       work phases are dropped before pooling; a row whose only work was
 *       abandoned is excluded, not priced off the partial rep.
 *   4 · the four authority factors multiply into `weight`; a zero factor is an
 *       exclusion with its own reason.
 */
export function classifyThresholdCandidatesDetailed(
  rows: readonly CandidateRow[],
  ctx: HrContext,
  opts?: ThresholdClassifyOptions,
): { observations: PaceObservation[]; excluded: ExcludedObservation[] } {
  const out: PaceObservation[] = [];
  const excluded: ExcludedObservation[] = [];
  const evidence = opts?.evidence ?? null;
  const windows = opts?.windows ?? null;
  for (const row of rows) {
    const norm = normalizeDataWorkoutType(row.workoutTypeRaw);
    if (norm === 'race') {
      excluded.push({ id: row.id, date: row.date, reason: 'LABEL_RACE', paceSecPerMi: null,
        detail: 'a race is strategic effort, not routine threshold work; it reaches the model through the race exponent' });
      continue;
    }
    const verdict = evidence?.get(row.id) ?? null;
    const evidenceKind: EvidenceEngineVerdictKind = evidence == null ? 'unavailable' : (verdict?.kind ?? 'unavailable');
    const labelNonQuality = norm === 'easy' || norm === 'recovery' || norm === 'long' || norm === 'shakeout';
    if (labelNonQuality && evidenceKind !== 'evidence') {
      excluded.push({ id: row.id, date: row.date, reason: 'LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE', paceSecPerMi: null,
        detail: `labelled ${norm}; the Evidence Engine ${evidenceKind === 'unavailable' ? 'was not read' : `read ${evidenceKind}`} for threshold` });
      continue;
    }
    if (evidenceKind === 'no_evidence') {
      excluded.push({ id: row.id, date: row.date, reason: 'EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE', paceSecPerMi: null,
        detail: 'the Evidence Engine classified this run as demonstrating no threshold capacity' });
      continue;
    }

    const phaseSeg = labelNonQuality ? null : thresholdSegmentFromPhases(row.phases ?? [], ctx);
    const abandonedWork = (row.phases ?? []).filter((p) => p.type === 'work' && p.completed === false).length;
    // A non-quality label is priced ONLY off the Evidence Engine's own
    // threshold_like segments. The corpus's split pooling admits every mile
    // whose HR sat in the T zone, which on a long run is cardiac drift at easy
    // pace — the owner's 2026-07-12 long run priced 8:06/mi as "threshold" that
    // way. The Engine already separated the threshold-like blocks from the
    // drift; this reads its answer instead of re-deriving a worse one.
    // A quality or unlabelled row is priced by the corpus's own readers first
    // (the watch's per-rep phases are the most direct measurement); when none
    // qualifies, the Engine's threshold_like segments are the last honest
    // read — an unlabelled 47-minute two-block session (the owner's
    // 2026-08-23) is threshold evidence whether or not a watch structured it.
    const seg = labelNonQuality
      ? segmentFromEvidenceSegments(verdict?.segments ?? [], ctx)
      : (phaseSeg ?? thresholdSegmentFromSplits(row.splits, ctx, row.distanceMi) ?? thresholdSegmentFromWholeRun(row, ctx)
          ?? (evidenceKind === 'evidence' ? segmentFromEvidenceSegments(verdict?.segments ?? [], ctx) : null));
    if (seg == null && labelNonQuality) {
      excluded.push({ id: row.id, date: row.date, paceSecPerMi: null, reason: 'LABEL_NON_QUALITY_UNPRICEABLE',
        detail: 'the Evidence Engine found threshold-like work but its segments do not amount to a priceable threshold session' });
      continue;
    }
    if (seg == null) {
      const completedWorkSec = (row.phases ?? [])
        .filter((p) => p.type === 'work' && p.completed !== false && p.actual_duration_sec != null)
        .reduce((acc, p) => acc + (p.actual_duration_sec as number), 0);
      const belowRampFloor = abandonedWork === 0 && completedWorkSec > 0
        && completedWorkSec < THRESHOLD_MIN_SESSION_TOTAL_SEC - THRESHOLD_SESSION_DURATION_RAMP_SEC;
      excluded.push({
        id: row.id, date: row.date, paceSecPerMi: null,
        reason: abandonedWork > 0 ? 'WORK_PHASES_ABANDONED'
          : belowRampFloor ? 'SESSION_BELOW_DURATION_FLOOR'
          : 'NO_QUALIFYING_SEGMENT',
        detail: abandonedWork > 0
          ? `${abandonedWork} work phase(s) recorded as not completed and no completed segment qualified`
          : belowRampFloor
            ? `${Math.round(completedWorkSec)} s of completed work is under the ramp floor`
            : 'no phase, split or whole-run segment qualified as threshold work',
      });
      continue;
    }

    const reasons: ObservationAuthorityReason[] = [];
    // duration · ramp in over the last five minutes under the doctrine floor
    const durationFactor = seg.durationSec >= THRESHOLD_MIN_SESSION_TOTAL_SEC
      ? 1
      : Math.max(0, Math.min(1,
          (seg.durationSec - (THRESHOLD_MIN_SESSION_TOTAL_SEC - THRESHOLD_SESSION_DURATION_RAMP_SEC))
            / THRESHOLD_SESSION_DURATION_RAMP_SEC));
    if (durationFactor <= 0) {
      excluded.push({ id: row.id, date: row.date, reason: 'SESSION_BELOW_DURATION_FLOOR', paceSecPerMi: seg.paceSecPerMi,
        detail: `${Math.round(seg.durationSec)} s of qualifying work is under the ramp floor` });
      continue;
    }
    if (durationFactor < 1) reasons.push('SESSION_SHORT_OF_DOCTRINE_FLOOR');

    // HR · in band 1; fades to 0 one further half-width past either edge; absent reduced
    let hr: HrAuthority;
    let hrFactor: number;
    if (seg.hrBandDistance == null) {
      hr = 'absent'; hrFactor = THRESHOLD_HR_ABSENT_AUTHORITY; reasons.push('HR_ABSENT_REDUCED_AUTHORITY');
    } else if (seg.hrBandDistance <= 1) {
      hr = 'in_band'; hrFactor = 1; reasons.push('HR_IN_THRESHOLD_BAND');
    } else {
      const over = seg.hrBandDistance - 1;
      hrFactor = Math.max(0, 1 - over / THRESHOLD_HR_OUT_OF_BAND_FADE_HALF_WIDTHS);
      hr = hrFactor > 0 ? 'near_band' : 'out_of_band';
      if (hrFactor > 0) reasons.push('HR_NEAR_THRESHOLD_BAND');
    }
    if (hrFactor <= 0) {
      excluded.push({ id: row.id, date: row.date, reason: 'HR_OUTSIDE_THRESHOLD_BAND', paceSecPerMi: seg.paceSecPerMi,
        detail: `pooled HR sat ${seg.hrBandDistance?.toFixed(2)} half-widths from the T-band centre (${seg.hrPct?.toFixed(3)} of ${seg.basis === 'pct_lthr' ? 'LTHR' : 'HRmax'})` });
      continue;
    }

    // Evidence Engine · the owner of "what did this run demonstrate"
    let evidenceFactor: number;
    let evidenceWeight: number | null = null;
    let anchorMoveCandidate: boolean | null = null;
    if (evidenceKind === 'evidence' && verdict) {
      evidenceWeight = verdict.weight;
      anchorMoveCandidate = verdict.anchorMoveCandidate;
      evidenceFactor = verdict.weight != null
        ? Math.max(0, Math.min(1, verdict.weight / SINGLE_ACTIVITY_EVIDENCE_CEILING))
        : 1;
      reasons.push('EVIDENCE_ENGINE_CORROBORATES');
      if (!verdict.anchorMoveCandidate) reasons.push('SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER');
    } else if (evidenceKind === 'indeterminate') {
      anchorMoveCandidate = verdict?.anchorMoveCandidate ?? null;
      evidenceFactor = EVIDENCE_ENGINE_INDETERMINATE_AUTHORITY;
      reasons.push('EVIDENCE_ENGINE_INDETERMINATE');
    } else {
      evidenceFactor = EVIDENCE_ENGINE_UNAVAILABLE_AUTHORITY;
      reasons.push('EVIDENCE_ENGINE_UNAVAILABLE');
    }

    // Context · Rule 8
    const representative = !(windows && isPrescribedNonNormal(row.date, windows));
    const contextFactor = representative ? 1 : PRESCRIBED_WINDOW_AUTHORITY;
    if (!representative) reasons.push('INSIDE_PRESCRIBED_WINDOW');
    if ((seg.abandonedPhases ?? 0) > 0) reasons.push('ABANDONED_PHASES_DROPPED');

    if (seg.source === 'evidence-segments') reasons.push('PRICED_FROM_EVIDENCE_ENGINE_SEGMENTS');

    const weight = hrFactor * durationFactor * evidenceFactor * contextFactor;
    out.push({
      id: row.id,
      date: row.date,
      paceSecPerMi: seg.paceSecPerMi,
      durationSec: seg.durationSec,
      source: seg.source,
      hrBasis: seg.basis,
      hrPct: seg.hrPct,
      hrBandDistance: seg.hrBandDistance,
      weight,
      completed: (seg.abandonedPhases ?? 0) === 0,
      representative,
      authority: {
        hr, hrFactor, durationFactor, evidenceKind, evidenceWeight, anchorMoveCandidate,
        evidenceFactor, contextFactor, stalenessFactor: 1, ageDays: null, reasons,
      },
    });
  }
  return { observations: out, excluded };
}

/** Pool the Evidence Engine's threshold_like segments into one pricing. */
function segmentFromEvidenceSegments(
  segments: readonly EvidenceSegmentRead[],
  ctx: HrContext,
): ThresholdSegment | null {
  const usable = segments.filter((g) => Number.isFinite(g.paceSecPerMi) && g.paceSecPerMi > 0 && g.durationSec > 0);
  if (usable.length === 0) return null;
  let totalSec = 0, totalMi = 0, hrWeighted = 0, hrWeight = 0;
  for (const g of usable) {
    totalSec += g.durationSec;
    totalMi += g.durationSec / g.paceSecPerMi;
    if (g.meanHrBpm != null && g.meanHrBpm > 0) { hrWeighted += g.meanHrBpm * g.durationSec; hrWeight += g.durationSec; }
  }
  if (totalMi <= 0) return null;
  if (totalSec < THRESHOLD_MIN_SESSION_TOTAL_SEC - THRESHOLD_SESSION_DURATION_RAMP_SEC
      || totalSec > THRESHOLD_MAX_QUALIFYING_SEC) return null;
  const pooledHr = hrWeight > 0 ? hrWeighted / hrWeight : null;
  const { basis, pct } = hrZoneMatch(pooledHr, ctx, THRESHOLD_PCT_HRMAX_BAND, THRESHOLD_PCT_LTHR_BAND);
  return {
    paceSecPerMi: totalSec / totalMi,
    durationSec: totalSec,
    source: 'evidence-segments',
    basis,
    hrPct: pct,
    hrBandDistance: basis != null ? hrBandDistance(pct, thresholdBandFor(basis)) : null,
  };
}

/** Shared by `loadCandidateRows` and `loadPhasesByDate` so the two windows
 *  the threshold reader draws from (runs, watch-completion phases) always
 *  cover the same span of calendar days. */
function cutoffDateISO(todayISO: string, lookbackDays: number): string {
  return new Date(Date.parse(todayISO + 'T12:00:00Z') - lookbackDays * 86400000)
    .toISOString().slice(0, 10);
}

async function loadCandidateRows(
  userId: string,
  todayISO: string,
  lookbackDays: number,
): Promise<CandidateRow[]> {
  const cutoff = cutoffDateISO(todayISO, lookbackDays);
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
 * Batched `coach_intents.value.phases` loader, one date at a time is what
 * `loadPhaseBreakdown` (lib/coach/run-state.ts, private to that file) does
 * for run detail — this answers the whole lookback window in ONE query
 * instead of one per candidate run, which is the only structural
 * difference. The date-BUCKETING rule is copied from that function rather
 * than reinvented: a `field` carrying a trailing `-YYYY-MM-DD` (an optional
 * `#NNNN` de-dup suffix) is bucketed by that literal date; every other shape
 * (a treadmill's `trd_<uuid>`, a `just-run-<uuid>#hhmm`) is bucketed by `ts`
 * converted into the runner's OWN wall-clock timezone
 * (`runnerTimezoneOrPacific` — the same helper, for the same "coach_intents
 * watch-completion day bucketing" reason its own doc comment names, and the
 * same reason a `to_char(... AT TIME ZONE tz, 'YYYY-MM-DD')` string extract
 * is used rather than a `::date` cast — see the node-pg timestamp TZ trap
 * this repo has hit before). `mapWatchPhases` (also from run-state.ts) does
 * 100% of the actual parsing — this function only resolves "which date does
 * this row belong to" and hands each date's raw phases array to it.
 *
 * A ±2/+1 day pad around the window covers a matched date that lands just
 * outside `[cutoffISO, todayISO]` after timezone conversion; rows whose
 * matched date is still outside the caller's actual window are simply never
 * looked up by `classifyThresholdCandidates` (which only requests a
 * candidate row's own `date`), so the pad cannot leak an out-of-window
 * observation into the corpus.
 *
 * Two watch completions landing on the SAME local date (a rare two-a-day, or
 * a re-submitted completion) keep the most recent by `ts`, matching
 * `loadPhaseBreakdown`'s own `ORDER BY ts DESC LIMIT 1` per-date semantics.
 * Malformed JSON in `value` refuses that one row cleanly (Rule 11) rather
 * than throwing and losing every other row in the window.
 */
async function loadPhasesByDate(
  userId: string,
  cutoffISO: string,
  todayISO: string,
): Promise<Map<string, PhaseBreakdown[]>> {
  const tz = await runnerTimezoneOrPacific(userId).catch(() => 'America/Los_Angeles');
  // `rowsOrEmpty` (lib/db/read.ts, per check-swallowed-failure.sh) rather
  // than a bare `.catch(() => [])`: this reader IS the argued escape-hatch
  // case — a failed lookup here just means fewer phase observations reach
  // an already-conservative corroboration statistic (Rule 11 is upheld one
  // layer up, by thresholdPaceCorpus's own explicit refusal reasons), so
  // "no phases found" and "the query failed" are the same answer to every
  // caller of this function. `rowsOrEmpty` still LOGS the failure rather
  // than swallowing it silently, which is the floor this file's own gate
  // requires even for an argued-safe fallback.
  const rows = await rowsOrEmpty<{ value: string | null; matched_date: string | null }>(
    'pace-corpus.loadPhasesByDate',
    pool.query(
      `SELECT ci.value AS value,
              CASE
                WHEN ci.field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                  THEN substring(ci.field from '([0-9]{4}-[0-9]{2}-[0-9]{2})(?:#[0-9]+)?$')
                ELSE to_char(ci.ts AT TIME ZONE $4::text, 'YYYY-MM-DD')
              END AS matched_date
         FROM coach_intents ci
        WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
          AND ci.reason = 'watch_completion'
          AND ci.ts >= $2::timestamptz - interval '2 days'
          AND ci.ts <= $3::timestamptz + interval '1 day'
        ORDER BY ci.ts DESC`,
      [userId, cutoffISO, todayISO, tz],
    ),
  );

  const out = new Map<string, PhaseBreakdown[]>();
  for (const row of rows) {
    const date = row.matched_date;
    if (!date || out.has(date)) continue; // ORDER BY ts DESC · first row per date wins
    if (row.value == null) continue;
    let payload: unknown;
    try { payload = JSON.parse(row.value); } catch { continue; } // Rule 11 · refuse this row, not the query
    out.set(date, mapWatchPhases((payload as { phases?: unknown })?.phases));
  }
  return out;
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
  // Rule 8 · filtered — see "THE EASY DESIGN" for why a taper-day easy run
  // isn't given the same cover vdot-corpus.ts gives a taper-week tune-up.
  const filtered = excludePrescribedDays(raw, (o) => o.date, windows);
  return easyPaceCorpus(filtered, opts?.minObservations);
}

/** Everything the threshold corpus needs, loaded ONCE so the capacity
 *  resolver's two passes (base read, relaxed-bar read) classify the same
 *  rows against the same Evidence Engine verdicts. */
export interface ThresholdCorpusInputs {
  todayISO: string;
  /** The window the read starts from (`PACE_CORPUS_LOOKBACK_DAYS`). */
  baseLookbackDays: number;
  /** How far the rows below actually reach. */
  maxLookbackDays: number;
  rows: CandidateRow[];
  ctx: HrContext;
  windows: PrescribedWindow[];
  /** Null when the Evidence Engine read failed — reported, never silently
   *  substituted (Rule 11): every observation then carries
   *  `EVIDENCE_ENGINE_UNAVAILABLE` and reduced authority. */
  evidence: Map<string, ThresholdEvidenceVerdict> | null;
}

export async function loadThresholdCorpusInputs(
  userId: string,
  todayISO?: string,
  opts?: { lookbackDays?: number },
): Promise<ThresholdCorpusInputs> {
  const today = todayISO ?? await runnerToday(userId);
  const baseLookbackDays = opts?.lookbackDays ?? PACE_CORPUS_LOOKBACK_DAYS;
  // Load the WIDEST window the read may settle on, once; the composer widens
  // in `REPRESENTATIVE_LOOKBACK_STEP_DAYS` steps from the base only as far as
  // corroboration needs, discounting what lies beyond the base by age.
  const lookbackDays = Math.max(baseLookbackDays, REPRESENTATIVE_LOOKBACK_MAX_DAYS);
  const cutoff = cutoffDateISO(today, lookbackDays);
  const [rows, ctx, phasesByDate, windows, classified] = await Promise.all([
    loadCandidateRows(userId, today, lookbackDays),
    loadHrContext(userId, today),
    loadPhasesByDate(userId, cutoff, today),
    loadPrescribedWindows(userId, today).catch((err) => {
      console.warn('[pace-corpus] prescribed windows read failed · context factors unavailable', err);
      return [] as PrescribedWindow[];
    }),
    classifyRecentActivities(userId, cutoff, today).catch((err) => {
      console.warn('[pace-corpus] Evidence Engine read failed · every observation carries reduced authority', err);
      return null;
    }),
  ]);
  const evidence = classified == null
    ? null
    : new Map<string, ThresholdEvidenceVerdict>(classified.map((c) => {
        const t = c.result.capacities.threshold;
        return [c.runId, {
          kind: t.kind,
          weight: t.kind === 'evidence' ? t.weight : null,
          anchorMoveCandidate: c.result.anchorMoveCandidate,
          segments: c.result.segments
            .filter((g) => g.classification === 'threshold_like')
            .map((g) => ({ paceSecPerMi: g.meanPaceSecPerMi, durationSec: g.spanSec, meanHrBpm: g.meanHrBpm })),
        }];
      }));
  return {
    todayISO: today,
    baseLookbackDays,
    maxLookbackDays: lookbackDays,
    rows: rows.map((r) => ({ ...r, phases: phasesByDate.get(r.date) ?? [] })),
    ctx,
    windows,
    evidence,
  };
}

/** Pure · the corpus read from already-loaded inputs. */
export function thresholdCorpusFromInputs(
  inputs: ThresholdCorpusInputs,
  minObservations?: number,
): ThresholdPaceRead {
  const k = minObservations ?? CORROBORATION_MIN_OBSERVATIONS;
  const { observations, excluded } = classifyThresholdCandidatesDetailed(inputs.rows, inputs.ctx, {
    evidence: inputs.evidence,
    windows: inputs.windows,
  });
  const ageOf = (iso: string): number => Math.max(0, Math.round(
    (Date.parse(inputs.todayISO + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86_400_000,
  ));
  // The narrowest window (base, base+step, … max) whose age-discounted
  // authority reaches K. Beyond the base window an observation's weight halves
  // every `REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS` — the SAME convention the
  // adaptation engine's representative lookback applies (Rule 8: reach further
  // back for evidence rather than cliff, and price its age).
  const base = inputs.baseLookbackDays;
  const discounted = (o: PaceObservation): PaceObservation => {
    const age = ageOf(o.date);
    const stalenessFactor = age <= base ? 1 : Math.pow(0.5, (age - base) / REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS);
    const reasons = stalenessFactor < 1
      ? [...o.authority.reasons, 'AGE_DISCOUNTED_BEYOND_BASE_WINDOW' as const]
      : o.authority.reasons;
    return { ...o, supportWeight: o.weight * stalenessFactor, authority: { ...o.authority, stalenessFactor, ageDays: age, reasons } };
  };
  const all = observations.map(discounted);
  const settle = (pool: readonly PaceObservation[]): { windowDays: number; inWindow: PaceObservation[]; outside: ExcludedObservation[] } => {
    let windowDays = base;
    for (let w = base; w <= inputs.maxLookbackDays; w += REPRESENTATIVE_LOOKBACK_STEP_DAYS) {
      windowDays = w;
      const support = pool.filter((o) => (o.authority.ageDays ?? 0) <= w).reduce((acc, o) => acc + Math.min(1, o.supportWeight ?? o.weight), 0);
      if (support >= k) break;
    }
    return {
      windowDays,
      inWindow: pool.filter((o) => (o.authority.ageDays ?? 0) <= windowDays),
      outside: pool.filter((o) => (o.authority.ageDays ?? 0) > windowDays)
        .map((o): ExcludedObservation => ({ id: o.id, date: o.date, reason: 'OUTSIDE_LOOKBACK_WINDOW', paceSecPerMi: o.paceSecPerMi,
          detail: `${o.authority.ageDays} days old · the read settled on a ${windowDays}-day window` })),
    };
  };
  const withNewest = settle(all);
  // The prior for the daily move cap is the read the runner would have had
  // WITHOUT the newest date's session(s), settled on ITS OWN window — a
  // corpus that only reaches K by widening must widen again when the newest
  // session is removed, or the cap would never find a prior to compare to.
  const newestDate = all.reduce<string | null>((m, o) => (m == null || o.date > m ? o.date : m), null);
  const priorPool = newestDate ? all.filter((o) => o.date !== newestDate) : [];
  const priorSettled = settle(priorPool);
  // An empty prior pool is a refusal from the corpus itself (insufficient
  // corroboration), not a null manufactured here — Rule 11.
  const priorRead = thresholdPaceCorpus(priorSettled.inWindow, k, { windowDays: priorSettled.windowDays });
  return thresholdPaceCorpus(withNewest.inWindow, k, {
    todayISO: inputs.todayISO,
    excluded: [...excluded, ...withNewest.outside],
    windowDays: withNewest.windowDays,
    priorRead,
  });
}

/**
 * Resolve the threshold-pace read from the runner's own classified training.
 *
 * Deliberately NOT Rule 8-FILTERED, and now Rule 8-WEIGHTED: a quality session
 * inside a prescribed window is admitted at reduced authority and marked
 * non-representative — it may support a belief; it may not, by itself, clear a
 * representative-session bar downstream. See "THE THRESHOLD DESIGN" above and
 * section 1b.
 */
export async function resolveThresholdPaceCorpus(
  userId: string,
  todayISO?: string,
  opts?: { lookbackDays?: number; minObservations?: number },
): Promise<ThresholdPaceRead> {
  const inputs = await loadThresholdCorpusInputs(userId, todayISO, { lookbackDays: opts?.lookbackDays });
  return thresholdCorpusFromInputs(inputs, opts?.minObservations);
}
