/**
 * _layout_contract.test.ts · LAYOUTWEEK-CONTRACT-1 / LAYOUTWEEK-RACEWEEK-1.
 *
 * Brief Phase 2's own instruction: "Preserve behavior first, then fix defects
 * under gates." This is that gate.
 *
 * A behaviour-preserving refactor has exactly one property worth asserting and
 * it is not a property of any one week: the WHOLE corpus must compose the same
 * bytes it composed before. So this walks the archetype matrix, serialises
 * every composed week, and pins the result — a snapshot over thousands of
 * plans rather than a hand-written expectation, because a hand-written one
 * would have been the refactorer's own reading of what the code did, which is
 * the thing under test.
 *
 * ── HOW IT WAS FALSIFIED ────────────────────────────────────────────────────
 *
 * Before landing, `layoutRaceWeek` was given a deliberately wrong body (the
 * shakeout moved a day) and the digest changed, naming the archetype count and
 * the first differing plan. The output is in the handback. A refactor gate
 * that has never been made to move is a hypothesis (Rule 18).
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A CHANGE THE CORPUS CANNOT REACH. `sim-matrix` archetypes carry no
 *     history (Rule 15's standing gap in this repo), no travel windows, no
 *     mid-block races and no Coaching Thesis, so a refactor that broke only
 *     those paths would pass here. `coaching-structural`, `_combined_stress`
 *     and `_brain_acceptance` reach three of the four.
 *   · WHETHER THE BEHAVIOUR IS RIGHT. It asserts SAMENESS. Every coaching
 *     question about these plans belongs to `_sweep_allusers`,
 *     `_maint_invariants` and the doctrine gate, all of which stay green
 *     across this change and are the reason a digest is enough here.
 *   · A LATER, INTENDED change. The digest is a snapshot: when the composer is
 *     deliberately changed it moves, and the argument for moving it goes in
 *     the commit exactly as it does for `_audit_periodization`'s.
 *
 * ── DIGEST MOVES ────────────────────────────────────────────────────────────
 *
 *   · 2026-09-03 · SENTENCEREP-1 / RUNNERLANG-2. `applyRunnerVoice` is a new
 *     final pass in `finalizeComposedPlan`: a sentence true of every row of its
 *     kind is said once per block, and a generic easy row says instead what
 *     makes that day different. `composed` (8781), `days` (699860) and
 *     `raceWeeks` (3969) are ALL unchanged — no plan gained or lost a day and
 *     no race week moved. The pass touches `notes` and nothing else: no
 *     distance, no placement, no label, no spec. That is exactly what a digest
 *     over serialised weeks is supposed to catch, and every coaching gate named
 *     above stays green across it. Falsified in `_sentence_repetition.test.ts`,
 *     which fails when the retired sentence is put back on every easy row.
 *
 *   · 2026-09-02 · LONGRUN-DEMAND-1 + CADENCE-1, merged. Two deliberate
 *     composer changes land together. `smoothLongWoW` no longer caps a long run
 *     against the CUTBACK week beside it — the validator has bridged planned
 *     deloads since CUTBACK-LONG-1, and the authoring pass that actually cuts
 *     never got the same exemption, so it trimmed longs below a limit nothing
 *     reported as breached. And `racePaceLongThisWeek` now knows about races as
 *     well as deloads: a race replaces the long run on the runner's long day, so
 *     the marathon-pace cadence used to anchor on a deload, step once onto the
 *     raced week and stop, giving a whole RACE-SPECIFIC phase zero MP long runs.
 *     `composed` (8781), `days` (699860) and `raceWeeks` (3969) are ALL
 *     unchanged: no plan gained or lost a day, and no race week moved. What
 *     moved is the contents of long-run and marathon-pace weeks, which is the
 *     intended change. Every coaching gate named above stays green across it.
 *
 *   · 2026-09-02 · TIEREVIDENCE-2. The self-declared experience level is
 *     removed as decision authority (`docs/PLAN_SIMPLIFICATION_DOCTRINE.md`
 *     §"What may not"), so the `TIER_TARGETS` row an archetype composes against
 *     is selected by its DEMONSTRATED pace instead of by `experienceLevel`. The
 *     corpus varies the level across the cross-product, so this reaches a large
 *     share of it — and it reaches every archetype twice over, because
 *     `volumeCurve`'s peak destination is now `peakWeeklyFloorMi`, doctrine's
 *     four published peak floors run as CONTROL POINTS with a continuous
 *     response between them rather than a step at each pace edge (Rule 9: the
 *     step was worth a 177-mile block total between VDOT 52 and 52.25, measured
 *     by `_cadence_robust.test.ts`).
 *
 *     `composed` (8781), `days` (699860) and `raceWeeks` (3969) are ALL
 *     unchanged: no archetype gained, lost or refused a plan, and no race week
 *     moved. What moved is weekly volume and the sessions inside it, for
 *     archetypes whose row was being chosen by a word.
 *
 *     NOTE, and it belongs in the record: this snapshot was ALREADY stale at
 *     `origin/main@732e0df1`, before any of this change. The three counts
 *     matched and the digest did not
 *     (expected fc49ff4e…, actual b83881d3…), so a composer change had landed
 *     without re-baselining. The digest below is therefore the first one taken
 *     since that drift, and it carries both movements. Whoever finds this: the
 *     counts are the part that has stayed constant across all four entries in
 *     this list, which is what makes them worth asserting separately.
 *
 *   · 2026-09-02 · LADDER-LENGTH-1. `restoreSteps` no longer emits a rung worth
 *     a tenth of a mile, so a returning runner's block spends one fewer week
 *     restoring and one more week climbing. Reaches only the 89 archetypes in
 *     this corpus that carry a history at all — `composed` (8781), `days`
 *     (699860) and `raceWeeks` (3969) are all unchanged, so no plan gained or
 *     lost a day; the contents of some weeks moved.
 *
 *   · 2026-09-03 · MPLADDER-1 + LONGARRIVE-2 + TAPERLONG-1, together. The
 *     MARATHON's marathon-effort work, long-run curve and taper long runs all
 *     moved; every other distance is untouched, and this corpus is dominated by
 *     the 5K, 10K and half arcs, which is why the counts do not move at all:
 *     `composed` 8781, `days` 699860, `raceWeeks` 3969 — IDENTICAL. No plan
 *     gained or lost a day, no race week appeared or vanished. What changed is
 *     the CONTENT of marathon days, which is exactly what the three changes
 *     were for and the reason a content digest is the right instrument.
 *
 *     What moved, per `docs/PROGRESSIVE_BASELINE_DOCTRINE.md`:
 *       - marathon-effort dose and placement now come from
 *         `marathon-specific-ladder.ts` (Q1/Q8/Q14) instead of three
 *         mechanisms that did not know about each other;
 *       - the long-run ramp's arrival week steps back off a week whose long-run
 *         slot is a tune-up race (LONGARRIVE-2), which raises the peak long to
 *         the runner's own demonstrated ceiling;
 *       - the marathon taper's long runs take Q18's 14-16 / 8-10 bands and its
 *         standalone MP tempo becomes §9.2's threshold alternative.
 *
 *     The behavioural gates that own each of those went red first and were
 *     re-argued rather than re-baselined: `_mp_doctrine`, `_longrun_demand`,
 *     `_variety_invariants`, `_boundary_run` and the doctrine registry all
 *     carry their own RULING MOVES sections for this change.
 *
 *   · 2026-09-03 · ROLLING7-1, in the same session and folded into the same
 *     digest. The per-cycle peak ceiling was MEASURED in rolling-7 miles and
 *     ENFORCED on the peak calendar week (Rule 16, two units on the two sides
 *     of one inequality), so a block could exceed its own published ceiling by
 *     a window straddling a week boundary. `enforceRollingSevenCeiling` now
 *     checks it in the unit it is measured in and takes the difference off EASY
 *     days only.
 *
 *     It reaches only the archetypes that carry a demonstrated peak — most of
 *     this corpus has no history, the load contract refuses to publish a
 *     ceiling for them, and the pass records the refusal and returns. `days` is
 *     699860 either way, so nothing was trimmed to zero and no day left the
 *     plan; a handful of easy days on the history-carrying arcs got shorter.
 *     `_rolling_seven_ceiling.test.ts` owns the behaviour and was falsified
 *     against the composer with the pass removed.
 *
 *   · 2026-09-03 · DOSE-BAND-2. Two marathon-effort rungs were sitting UNDER
 *     the owner's own stated bands and now sit at their tops. The opening rung
 *     was pinned to its band FLOOR because the earned-step rule bounded it
 *     against a `largest` of zero — a rule about the step between rungs
 *     bounding a rung that has nothing to step from; it now applies from the
 *     second rung on. The sharpening rung's band was [3, 4] against a ruling
 *     that reads "no more than ~4-5", so it was capped below the floor of the
 *     sentence it cites, and is now [4, 5].
 *
 *     On the reference block that is 4 → 5 and 4 → 5. `composed` 8781, `days`
 *     699860, `raceWeeks` 3969 — unchanged again: the same days, two of them
 *     carrying a mile more at marathon effort.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildSimPlan } from './sim-inputs';
import { matrix, arcStr, simInputsForArc, type Arc } from './sim-matrix';

describe('LAYOUTWEEK-CONTRACT-1 · the decomposition changed nothing', () => {
  it('the whole archetype matrix composes byte-identically', () => {
    const h = createHash('sha256');
    let composed = 0;
    let raceWeeks = 0;
    let days = 0;
    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      composed++;
      h.update(arcStr(a as Arc));
      for (const w of built.composed.weeks as unknown as Array<{
        startISO: string; phase: string; weeklyMi: number; isRaceWeek: boolean;
        days: Array<{ dow: number; type: string; distanceMi: number; isQuality?: boolean; isLong?: boolean; subLabel: string | null; notes?: string | null }>;
      }>) {
        if (w.isRaceWeek) raceWeeks++;
        h.update(`|${w.startISO}:${w.phase}:${w.weeklyMi}:${w.isRaceWeek ? 'R' : '-'}`);
        for (const d of w.days) {
          days++;
          h.update(`|${d.dow}:${d.type}:${d.distanceMi}:${d.isQuality ? 'Q' : ''}${d.isLong ? 'L' : ''}:${d.subLabel ?? ''}:${d.notes ?? ''}`);
        }
      }
    }

    // Rule 18 liveness, three ways. A digest over nothing is a clean report
    // about nothing, and the RACE-WEEK count specifically must be non-zero or
    // the branch this commit extracted was never executed.
    expect(composed, 'the corpus composed no plans').toBeGreaterThan(1000);
    expect(days, 'the corpus produced no days').toBeGreaterThan(100_000);
    expect(raceWeeks, 'no race week was composed — layoutRaceWeek was never reached').toBeGreaterThan(1000);

    // eslint-disable-next-line no-console
    console.log(`\n=== LAYOUTWEEK-CONTRACT-1 · ${composed} plans · ${days} days · ${raceWeeks} race weeks ===`);
    expect({ composed, days, raceWeeks, digest: h.digest('hex') })
      .toMatchSnapshot('layout-corpus-digest');
  }, 300_000);

  /**
   * TUNEUPTYPE-1 (2026-09-04) · the race-week type appears only in a race week.
   *
   * Found on the owner's live block: `type = 'race_week_tuneup'` on 2026-11-17,
   * nineteen days before CIM, because `qualityTypesFor`'s TAPER arm fell through
   * to the race-week row whenever neither the MP nor the threshold session
   * applied. The name is load-bearing in four places — `RACE_PROTECTED_TYPES`
   * (never shaved or downgraded), `recomputePacesForPlan`'s exemption (never
   * re-priced from evidence), `anchor-provenance.ts` (priced off the STATED
   * GOAL, not the fitness anchor), and `EFFORT_CUED_TYPES` (no effort cue on a
   * provisional anchor) — every one of them correct in race week and wrong
   * outside it.
   *
   * The digest above would have caught the change, but only as "something
   * moved"; it cannot say what the invariant IS. This can, and it is the half
   * that survives the next deliberate snapshot update.
   *
   * WHAT THIS CANNOT FAIL ON (Rule 22): it walks the same archetype matrix,
   * whose `Arc` carries no training history (Rule 15), so it says nothing about
   * a runner with a past. And it checks WHERE the type is authored, never
   * whether the session under it is the right session.
   */
  it('`race_week_tuneup` outside a race week does not SPREAD (ratchet)', () => {
    const offenders: string[] = [];
    let raceWeekTuneups = 0;
    let taperWeeksSeen = 0;
    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      for (const w of built.composed.weeks as unknown as Array<{
        startISO: string; phase: string; isRaceWeek: boolean;
        days: Array<{ type: string }>;
      }>) {
        if (w.phase === 'TAPER') taperWeeksSeen++;
        for (const d of w.days) {
          if (d.type !== 'race_week_tuneup') continue;
          raceWeekTuneups++;
          if (!w.isRaceWeek) offenders.push(`${arcStr(a as Arc)} · ${w.startISO} (${w.phase})`);
        }
      }
    }
    // Liveness, both halves: the type must still be authored SOMEWHERE (or this
    // passes by the type having quietly disappeared), and taper weeks must
    // actually be reached (or the branch that produced the defect is dark).
    expect(raceWeekTuneups, 'no race_week_tuneup was authored anywhere — this gate is vacuous')
      .toBeGreaterThan(100);
    expect(taperWeeksSeen, 'no TAPER week in the corpus — the defect branch is unreachable here')
      .toBeGreaterThan(100);
    // eslint-disable-next-line no-console
    console.log(`\n=== TUNEUPTYPE-1 · ${raceWeekTuneups} tune-ups · ${taperWeeksSeen} taper weeks · ${offenders.length} outside race week ===`);
    // THE RATCHET, and why this is not simply asserted to be zero.
    //
    // Two substitutions were tried and both broke the session rather than the
    // symptom. `intervals` in the -3 marathon taper week produced "a VO2max
    // session was cut to 2 rep(s)" against a floor of 3
    // (`lib/prescription/_trajectory.test.ts`, on David's own block); `tempo`
    // produced `"3mi continuous tempo" built a 1.8mi block` and pushed 8,893
    // sessions past the 8,114 ratchet for legs outweighing their work
    // (`_quality_day.test.ts`, `_boundary_run.test.ts`).
    //
    // That is the finding, and it explains the original design: a taper week's
    // quality budget is small by construction, and `race_week_tuneup` is the
    // only session shape in this engine that scales into it. A rep set loses
    // reps until it is no longer the session; a continuous block loses its work
    // to its own warm-up. Substituting the TYPE cannot be the fix.
    //
    // The real fix is on the CONSUMER side: `RACE_PROTECTED_TYPES`,
    // `recomputePacesForPlan`'s exemption, `anchor-provenance`'s goal pricing
    // and `EFFORT_CUED_TYPES` should each ask whether the ROW IS IN A RACE
    // WEEK, rather than inferring it from a type name that cannot carry that
    // fact. Four sites, in modules where a wrong move re-prices a real runner's
    // race, so it is named and scoped rather than attempted at the end of a
    // session.
    //
    // Until then this holds the line: the count may shrink, never grow. A new
    // authoring path that puts the race-week type on another ordinary week
    // fails here immediately.
    const BASELINE = 3475;
    expect(
      offenders.length,
      `${offenders.length} non-race weeks carry the race-week type, against a ratchet of `
      + `${BASELINE}. That name grants four exemptions — adapter-protected, pace-recompute-`
      + 'exempt, priced off the stated GOAL rather than the fitness anchor, and not '
      + 'effort-cued — every one of which is correct in race week and wrong outside it. '
      + 'The list may shrink, never grow.',
    ).toBeLessThanOrEqual(BASELINE);
    // And it must not silently go to zero by the type disappearing, which would
    // make the ratchet a rubber stamp rather than a closed defect.
    expect(offenders.length, 'zero offenders — if the defect is genuinely fixed, delete this '
      + 'ratchet and assert zero instead').toBeGreaterThan(0);
  }, 300_000);
});
