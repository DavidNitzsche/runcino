/**
 * lib/adaptation/volume-evidence/classify.ts · STEP 1 · WHAT THE EXTRA
 * MILEAGE REPRESENTS.
 *
 * The owner's specification, verbatim:
 *
 *     "The correct behavior is not 'I ran extra, therefore mechanically add
 *      the same amount forever.'"
 *
 * So before a single mile is spent as evidence, it is named. Six kinds, and
 * only two of them are volume the runner earned (`KINDS_THAT_COUNT_AS_VOLUME_
 * EVIDENCE`).
 *
 * ── WHY A DUPLICATE IS THE FIRST THING THIS FILE CHECKS ───────────────────
 *
 * CLAUDE.md Rule 14: filtering on the runner is not the same as filtering on
 * the right ROWS, and `absorbed_into_canonical_at` once zeroed 63 miles across
 * 7 days including the owner's true peak long run. The canonical predicate is
 * `NOT (data ? 'mergedIntoId')` and there is exactly one — `CANONICAL_ROW_SQL`
 * in `lib/runs/volume.ts`. This file is pure and holds no SQL, so it takes the
 * predicate's ANSWER as `SurplusRun.mergedIntoAnother` and refuses to treat a
 * merged row as volume no matter what else is true of it. A loader that
 * forgets the predicate hands this file rows it will classify as
 * `RECORDING_ARTIFACT`, which is the safe direction.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ───────────────────────────────
 *
 * · It cannot tell a genuinely-moved session from a missed one plus a
 *   spontaneous one on another day, beyond what the loader put in
 *   `movedFromDateISO`. `plan_workouts.original_date_iso` is the column that
 *   answers it and a loader that leaves it null makes a reschedule read as a
 *   supplemental run, which OVERSTATES surplus. Named rather than assumed.
 * · It cannot see a run that never synced. An absent row and a rest day are
 *   the same input.
 * · It cannot judge whether a "supplemental" run was a good idea. That is
 *   `admit.ts`'s question and it is a different one.
 */
import type { ExcludedEvidence } from '@/lib/adaptation/canonical/decision-record';
import { absent, failed, measured, type Measured } from '@/lib/adaptation/canonical/input';
import { roundTo } from '@/lib/format/run';
import {
  KINDS_THAT_COUNT_AS_VOLUME_EVIDENCE,
  type NonNormalReason,
  type ClassifiedRun,
  type SurplusKind,
  type SurplusRun,
  type WeekSurplus,
  type WeekSurplusInput,
} from './contract';

/**
 * A week the plan itself authored as non-normal. Rule 8's filter, applied at
 * the WEEK level here and at the RUN level nowhere, because a run inside a
 * taper week is excluded by the week it sits in.
 *
 * Deliberately NOT resting on `is_cutback` alone: the owner's real post-race
 * recovery block carries `is_cutback FALSE` on two weeks the plan was authored
 * `mode: 'recovery'` to prescribe as recovery, and a Rule 8 protection resting
 * on one column being right is a protection resting on one column being right.
 * Same argument, same defect, as `prescribedNonNormalWeek` in
 * `lib/adaptation/canonical/input.ts`.
 */
export function weekIsPrescribedNonNormal(w: WeekSurplusInput): NonNormalReason | null {
  if (w.authoredPlanMode === 'RECOVERY') return 'AUTHORED_RECOVERY_BLOCK';
  if (w.authoredPlanMode === 'TAPER') return 'AUTHORED_TAPER';
  if (w.isRaceWeek) return 'PLAN_MARKED_RACE_WEEK';
  if (w.inPrescribedRaceWindow) return 'INSIDE_A_RACE_TAPER_OR_RECOVERY_WINDOW';
  if (w.isCutback) return 'CUTBACK_WEEK';
  return null;
}

/** One sentence per reason, said once (Rule 17). */
const NON_NORMAL_DETAIL: Readonly<Record<NonNormalReason, string>> = {
  AUTHORED_RECOVERY_BLOCK: 'The plan is a recovery block. It authored this week small on purpose.',
  AUTHORED_TAPER: 'The plan is a taper. It authored this week small on purpose.',
  CUTBACK_WEEK: 'A cutback week. The plan authored it small on purpose.',
  PLAN_MARKED_RACE_WEEK: 'A race week. The plan authored it small on purpose.',
  INSIDE_A_RACE_TAPER_OR_RECOVERY_WINDOW:
    'Inside the taper or post-race recovery window of a race the runner actually ran.',
};

/**
 * One run, named.
 *
 * ORDER MATTERS and is the argument of the whole file: a merged row is an
 * artifact even if it also looks like a race; a race is an event even if it
 * also overran its prescription. The most disqualifying fact wins, because
 * every later branch would spend the miles.
 */
export function classifyRun(run: SurplusRun, weekHasPlan: boolean): ClassifiedRun {
  const base = { activityId: run.activityId, dateISO: run.dateISO };

  // 1 · Rule 14. A duplicate is never volume, whatever else it is.
  if (run.mergedIntoAnother) {
    return {
      ...base,
      kind: 'RECORDING_ARTIFACT',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: 'This row was absorbed into another activity. It is the same run recorded twice.',
    };
  }

  // 2 · Rule 11. An unreadable distance is not a zero-mile run, and it is not
  //     a surplus of zero either. It is an artifact for THIS question and the
  //     week that holds it will refuse rather than under-count.
  if (!run.distanceMi.ok) {
    return {
      ...base,
      kind: 'RECORDING_ARTIFACT',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: 'This activity has no readable distance, so it cannot contribute miles either way.',
    };
  }

  const mi = run.distanceMi.value;

  // 3 · A race is real load and is not ordinary training volume. Research/00b
  //     gives a race its own recovery protocol; counting one as a week's
  //     surplus would train the next block off a race day.
  if (run.isRace) {
    return {
      ...base,
      kind: 'RACE_OR_EVENT',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: `A race of ${roundTo(mi)} miles. Real load, and not evidence about ordinary training volume.`,
    };
  }

  // 4 · A reschedule is not new work. The miles are already in the week's
  //     prescription; crediting them again manufactures a surplus.
  if (run.movedFromDateISO != null) {
    return {
      ...base,
      kind: 'MOVED_SESSION',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: `Prescribed for ${run.movedFromDateISO} and run on ${run.dateISO}. Moved, not added.`,
    };
  }

  // 5 · Rule 11 again. A day the resolver could not read is not a day with no
  //     prescription. `match: null` is a REFUSAL input, and reading it as
  //     "supplemental" is exactly how an unmatched run becomes free credit.
  if (run.match == null) {
    return {
      ...base,
      kind: 'RECORDING_ARTIFACT',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: 'The execution resolver could not say what this run satisfied, so it is not counted.',
    };
  }

  // 6 · No plan covered this week at all. Real running, and there is no
  //     prescription for it to be surplus TO.
  if (!weekHasPlan) {
    return {
      ...base,
      kind: 'UNPRESCRIBED_WEEK',
      surplusMi: 0,
      countsAsVolumeEvidence: false,
      detail: `${roundTo(mi)} miles in a week with no prescription. Nothing to measure a surplus against.`,
    };
  }

  // 7 · Supplemental: a run that satisfied no prescription. Every mile is new.
  if (run.match === 'supplemental' || run.prescribedMi == null) {
    return {
      ...base,
      kind: 'SUPPLEMENTAL_RUN',
      surplusMi: roundTo(mi),
      countsAsVolumeEvidence: true,
      detail: `${roundTo(mi)} miles beyond what the day prescribed.`,
    };
  }

  // 8 · The prescribed session, run longer than prescribed. Only the excess is
  //     new. A session run SHORT contributes a zero surplus, never a negative
  //     one: a shortfall is the completion bar's question and it is answered
  //     there, once (Rule 16).
  const over = mi - run.prescribedMi;
  return {
    ...base,
    kind: 'PRESCRIBED_OVERRUN',
    surplusMi: over > 0 ? roundTo(over) : 0,
    countsAsVolumeEvidence: over > 0,
    detail: over > 0
      ? `Prescribed ${roundTo(run.prescribedMi)}, ran ${roundTo(mi)}. ${roundTo(over)} miles over.`
      : `Prescribed ${roundTo(run.prescribedMi)}, ran ${roundTo(mi)}. No surplus.`,
  };
}

/**
 * A week, classified.
 *
 * `completedMi` REFUSES when any canonical row in the week has an unreadable
 * distance, rather than summing what it can read. That is the same posture
 * `live-input.ts` already takes for `WeekObservation.completedMi`, and it is
 * Rule 11: a week that is 80% readable is not a week that is 80% as long.
 */
export function classifyWeekSurplus(input: WeekSurplusInput): WeekSurplus {
  const weekHasPlan = input.prescribedMi > 0;
  const runs = input.runs.map((r) => classifyRun(r, weekHasPlan));
  const excluded: ExcludedEvidence[] = [];

  const canonical = input.runs.filter((r) => !r.mergedIntoAnother);
  for (const r of input.runs) {
    if (r.mergedIntoAnother) {
      excluded.push({
        activityId: r.activityId,
        dateISO: r.dateISO,
        reason: 'DATA_UNREADABLE',
        detail: 'Absorbed into another activity. The canonical row carries these miles.',
        stillAdmissibleFor: [],
      });
    }
  }

  const unreadable = canonical.filter((r) => !r.distanceMi.ok);
  for (const r of unreadable) {
    excluded.push({
      activityId: r.activityId,
      dateISO: r.dateISO,
      reason: 'DATA_UNREADABLE',
      detail: 'No readable distance on this activity.',
      stillAdmissibleFor: ['consistency'],
    });
  }

  const nonNormalBecause = weekIsPrescribedNonNormal(input);
  const nonNormal = nonNormalBecause != null;
  if (nonNormalBecause != null) {
    excluded.push({
      activityId: `week:${input.weekStartISO}`,
      dateISO: input.weekStartISO,
      reason: 'PRESCRIBED_RECOVERY_OR_TAPER',
      detail: NON_NORMAL_DETAIL[nonNormalBecause],
      stillAdmissibleFor: ['consistency', 'time on feet'],
    });
  }

  const completedMi: Measured<number> = unreadable.length > 0
    ? failed(`${unreadable.length} activities in this week have no readable distance`)
    : !input.dataComplete
      ? failed('the week contains missing, duplicate or misattributed activity data')
      : measured(roundTo(canonical.reduce((a, r) => a + (r.distanceMi.ok ? r.distanceMi.value : 0), 0)));

  const rawSurplusMi: Measured<number> = !completedMi.ok
    ? completedMi
    : !weekHasPlan
      ? absent('no prescription for this week, so there is no surplus to measure')
      : measured(Math.max(0, roundTo(completedMi.value - input.prescribedMi)));

  // A Rule 8 week contributes NO admissible surplus. Not zero-because-measured
  // (the runs happened and `rawSurplusMi` still reports them) but absent,
  // because the question "what does this runner normally absorb" cannot be
  // answered by a week the engine told him to go easy in.
  const admissibleSurplusMi: Measured<number> = !completedMi.ok
    ? completedMi
    : nonNormal
      ? absent('a prescribed recovery, taper, cutback or race week is never the runner\'s normal')
      : !weekHasPlan
        ? absent('no prescription for this week, so there is no surplus to measure')
        : measured(Math.min(
          // The per-day view: only the kinds that may be spent.
          roundTo(runs
            .filter((r) => KINDS_THAT_COUNT_AS_VOLUME_EVIDENCE.has(r.kind) && r.countsAsVolumeEvidence)
            .reduce((a, r) => a + r.surplusMi, 0)),
          // ── THE WEEK IS THE UNIT · found by the real-history replay ───────
          //
          // Without this cap, 2026-05-25 on the owner's own account read as
          // 2.3 mi of ADMITTED surplus on a week he completed at 39.7 of 44
          // prescribed. Two days ran past their own prescription and four ran
          // short, and the engine credited only the first half. That is the
          // question answered wrongly: he did not run more than prescribed
          // that week, he ran LESS, and a per-day sum with no week-level cap
          // will always find a surplus in any week containing one long day.
          //
          // The cap is `rawSurplusMi`, which is the week's own
          // `completed - prescribed`, floored at zero. So a week that came in
          // under prescription contributes exactly zero admissible surplus,
          // whatever its individual days did.
          rawSurplusMi.ok ? rawSurplusMi.value : 0,
        ));

  return {
    weekStartISO: input.weekStartISO,
    prescribedMi: input.prescribedMi,
    completedMi,
    rawSurplusMi,
    admissibleSurplusMi,
    prescribedNonNormal: nonNormal,
    nonNormalBecause,
    runs,
    excluded,
  };
}

/** Every kind present in a classified week, for a report or a test. */
export function kindsIn(week: WeekSurplus): ReadonlySet<SurplusKind> {
  return new Set(week.runs.map((r) => r.kind));
}
