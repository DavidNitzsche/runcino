/**
 * lib/runner-state/store/loaders.ts · THE ONE PLACE THAT CALLS THE
 * REGISTERED OWNERS AND SUBMITS WHAT THEY SAY.
 *
 * `lib/runner-state/assemble.ts` (merged onto `main` before this session)
 * already declares `submitted` / `absentBelief` / `failedBelief` /
 * `notLookedFor`, the `RunnerBeliefInput` total map, and `weld()`, which
 * pulls `rule8Side`, `owner`, `movesUpOn`, `movesDownOn` and `neverMovesOn`
 * out of `BELIEF_OWNERSHIP` rather than letting a loader declare them. This
 * file is the missing half: the twelve loaders the overnight brief actually
 * asked for, each calling the ONE registered owner `ownership.ts` /
 * `quantity-owners.ts` already name — never a second computation.
 *
 * ── WHY THIS FILE LIVES UNDER `store/` AND NOT BESIDE `assemble.ts` ────────
 *
 * `_runner_state.test.ts` walks the import graph from every `.ts` file
 * directly inside `lib/runner-state/` (non-recursive `readdirSync`) and fails
 * if that graph ever reaches `lib/db/pool` or `pg`. Every loader below opens
 * the database — that is the whole job — so this file sits one level down,
 * in `lib/runner-state/store/`, which the walk never enters because nothing
 * in `belief.ts` / `assemble.ts` / `ownership.ts` / `quantity-owners.ts`
 * imports anything under `store/`. The dependency points the other way: this
 * file imports them, never the reverse.
 *
 * ── WHAT IS DELIBERATELY NOT WIRED HERE, AND WHY ───────────────────────────
 *
 * `MAX_DEMONSTRATED_DOSE` USED TO BE ON THIS LIST — "THE SLOT EXISTS AND IS
 * EMPTY", `ownership.ts`'s own words — because nothing aggregated a per-
 * family completed maximum. F097 (2026-09-14) closed it:
 * `lib/execution/max-demonstrated-dose.ts#maxDemonstratedDoseByDomain` is now
 * the registered owner, a rolling 30-day per-domain MAX over
 * `reconstruct.ts#actualStimulus`, doctrine-cited at that file's header. See
 * §14 below.
 *
 * One belief still has NO canonical owner — `ownership.ts` says so by name:
 *
 *   TRAINING_PHASE  "There is no function anywhere that answers what phase
 *                   is this runner in today" — five readers, two
 *                   vocabularies, two current-week resolutions.
 *
 * Building that owner is engine work with its own corpus consequence (Rule
 * 15/21), not belief-store wiring, and the task brief is explicit that this
 * store must READ registered owners rather than invent a thirteenth. So its
 * loader below submits an honest `absentBelief` naming the ownership.ts
 * finding, which is itself the correct behaviour for a belief with no owner —
 * Rule 11's "unknown" state, not a manufactured guess.
 *
 * A further gap is narrower: `LONG_RUN_TOLERANCE`'s owner,
 * `lib/plan/generate.ts#evidenceLongCeilingMi`, is PURE and exported, but its
 * real inputs (`demonstratedLongMi`, `recentLongMi`) are private closures
 * inside `generate.ts` with no exported reader and no route to call them
 * without either duplicating that logic (forbidden — "never re-derive
 * independently") or `generate.ts` exporting them, which touches a file this
 * session's scope boundary keeps clear of (other agents are active in
 * `lib/plan/`). So this loader submits `failedBelief`, naming exactly that
 * seam, rather than a duplicate reading.
 */
import {
  submitted,
  absentBelief,
  failedBelief,
  notLookedFor,
  type RunnerBeliefInput,
} from '../assemble';
import type { BeliefKey } from '../belief';
import { sustainedWeeklyMileage } from '@/lib/training/normal-window';
import { computeAcwr, acwrAbsentCopy } from '@/lib/coach/acwr';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveDurability,
} from '@/lib/training/capacity-resolver';
import { marathonPaceFromDurability } from '@/lib/training/prescription-resolver';
import { resolveSafety } from '@/lib/safety/load-safety';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';
import { maxDemonstratedDoseByDomain } from '@/lib/execution/max-demonstrated-dose';
import type { Pool, PoolClient } from 'pg';

/* ══════════════════════════════════════════════════════════════════════════
 * THE EIGHT BELIEFS OUTSIDE TONIGHT'S SCOPE
 *
 * `RunnerBeliefInput` is total over all twenty `BeliefKey`s. David's brief
 * names twelve; the other eight (RECENT_COMPLETED_VOLUME,
 * RUN_FREQUENCY_TOLERANCE, RECOVERY_RESPONSE, TRAINING_CONSISTENCY,
 * RACE_PERFORMANCE, ENVIRONMENTAL_SENSITIVITY, DATA_QUALITY, READINESS) get
 * `notLookedFor` — Rule 11's third fact, "the loader did not ask", which is
 * the honest submission for a belief this pass never attempted rather than a
 * fabricated absence.
 * ═══════════════════════════════════════════════════════════════════════ */
const NOT_IN_SCOPE_TONIGHT: readonly BeliefKey[] = [
  'RECENT_COMPLETED_VOLUME',
  'RUN_FREQUENCY_TOLERANCE',
  'RECOVERY_RESPONSE',
  'TRAINING_CONSISTENCY',
  'RACE_PERFORMANCE',
  'ENVIRONMENTAL_SENSITIVITY',
  'DATA_QUALITY',
  'READINESS',
];

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SUSTAINABLE_WEEKLY_VOLUME · owner sustainedWeeklyMileage
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadSustainableWeeklyVolume(
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['SUSTAINABLE_WEEKLY_VOLUME']> {
  const r = await sustainedWeeklyMileage(userUuid, todayISO);
  const now = new Date().toISOString();
  if (!r.ok) {
    return absentBelief(r.refusal.message, now);
  }
  return submitted({
    estimate: { best: r.value.weeklyMi, range: null },
    // sustainedWeeklyMileage is a pure order-statistic reader, not one of the
    // §17 capacity ladders — it produces no confidence/sourceMode of its own.
    // Null, not invented (belief.ts: "Null when the owner does not produce
    // one, which is itself worth knowing").
    confidence: null,
    sourceMode: null,
    recency: {
      newestISO: todayISO,
      oldestISO: todayISO,
      medianAgeDays: 0,
      observations: r.value.weeksObserved,
    },
    lastUpdatedISO: now,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2/3 · ACUTE_LOAD + CHRONIC_LOAD · one call, computeAcwr, two beliefs
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadAcuteAndChronicLoad(
  userUuid: string,
  todayISO: string,
): Promise<{
  ACUTE_LOAD: RunnerBeliefInput['ACUTE_LOAD'];
  CHRONIC_LOAD: RunnerBeliefInput['CHRONIC_LOAD'];
}> {
  const r = await computeAcwr(userUuid, todayISO);
  const now = new Date().toISOString();
  if (r.acwr == null || r.acute7 == null || r.chronic28 == null) {
    const why = acwrAbsentCopy(r.reason);
    return { ACUTE_LOAD: absentBelief(why, now), CHRONIC_LOAD: absentBelief(why, now) };
  }
  const recency = {
    newestISO: todayISO, oldestISO: todayISO, medianAgeDays: 0, observations: r.coverageDays,
  };
  return {
    ACUTE_LOAD: submitted({
      estimate: { best: r.acute7, range: null },
      confidence: null,
      sourceMode: null,
      recency,
      lastUpdatedISO: now,
    }),
    CHRONIC_LOAD: submitted({
      estimate: { best: r.chronic28, range: null },
      confidence: null,
      sourceMode: null,
      recency,
      lastUpdatedISO: now,
    }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THRESHOLD_PACE · owner resolveThresholdCapacity
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadThresholdPace(
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['THRESHOLD_PACE']> {
  const est = await resolveThresholdCapacity(userUuid, todayISO);
  return submitted({
    estimate: { best: est.paceSecPerMi, range: null },
    confidence: est.confidence,
    sourceMode: est.sourceMode,
    supporting: [],
    recency: est.evidence
      ? {
          newestISO: todayISO,
          oldestISO: todayISO,
          medianAgeDays: 0,
          observations: est.evidence.representativeSupporting,
        }
      : null,
    lastUpdatedISO: est.resolvedAt,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · INTERVAL_PACE · owner resolveHighIntensityCapacity
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadIntervalPace(
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['INTERVAL_PACE']> {
  const est = await resolveHighIntensityCapacity(userUuid, todayISO);
  return submitted({
    estimate: { best: est.intervalPaceSecPerMi, range: null },
    confidence: est.confidence,
    sourceMode: est.sourceMode,
    lastUpdatedISO: est.resolvedAt,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · MARATHON_PACE · owner marathonPaceFromDurability, fed threshold+durability
 *
 * PURE composition of two already-registered owner calls
 * (resolveThresholdCapacity, resolveDurability) — this is the exact call
 * `ownership.ts` names as canonical, not a new computation.
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadMarathonPace(
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['MARATHON_PACE']> {
  const [threshold, durability] = await Promise.all([
    resolveThresholdCapacity(userUuid, todayISO),
    resolveDurability(userUuid, todayISO),
  ]);
  const marathon = marathonPaceFromDurability({
    thresholdPaceSecPerMi: threshold.paceSecPerMi,
    durability,
  });
  const now = new Date().toISOString();
  return submitted({
    estimate: { best: marathon.paceSecPerMi, range: { low: marathon.rangeSecPerMi[0], high: marathon.rangeSecPerMi[1] } },
    // marathonPaceFromDurability produces no confidence of its own — it is a
    // pure carry, not a ladder rung. The threshold READ that fed it does
    // carry one, and its uncertainty dominates the carry (the exponent only
    // widens the band, which is already reflected in `range` above), so it
    // is inherited here rather than left null. An engineering choice, not a
    // doctrine citation: flagged in the session report. Discounted 15% when
    // the carry rests on the population endurance prior rather than a
    // personally fitted exponent, per the read's own `personallyEvidenced`
    // flag — the SAME distinction `ThresholdCapacityEstimate.sourceMode`
    // already makes for the threshold half, applied to the marathon half.
    confidence: marathon.personallyEvidenced ? threshold.confidence : threshold.confidence * 0.85,
    sourceMode: threshold.sourceMode,
    lastUpdatedISO: now,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · GOAL_FEASIBILITY ("race projection") · owner composeRaceOutlook
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which race the "race projection" belief is about. Not a coaching
 * computation — an ENTITY RESOLUTION, the same kind Rule 16 asks a surface
 * about an entity to do ("resolves THAT entity, not the most important one in
 * scope"). No registered owner exists for "the runner's current goal race" as
 * a standalone function (only `lib/faff/race-on-today.ts#buildRaceOnToday`
 * resolves race-DAY, a different question), so this is the narrowest honest
 * query: the soonest upcoming race, A-priority first, exactly the ordering
 * `lib/faff/race-on-today.ts:94` already uses for the sibling question.
 */
async function findGoalRaceSlug(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  todayISO: string,
): Promise<string | null> {
  const r = await exec.query<{ slug: string }>(
    `SELECT slug FROM races
      WHERE user_uuid = $1::uuid AND (meta->>'date') >= $2
      ORDER BY (meta->>'priority' = 'A') DESC, (meta->>'date') ASC
      LIMIT 1`,
    [userUuid, todayISO],
  );
  return r.rows[0]?.slug ?? null;
}

async function loadGoalFeasibility(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['GOAL_FEASIBILITY']> {
  const now = new Date().toISOString();
  const slug = await findGoalRaceSlug(exec, userUuid, todayISO);
  if (!slug) {
    return absentBelief('no upcoming race is on record for this runner', now);
  }
  const outlook = await resolveRaceOutlookBySlug(userUuid, slug, todayISO);
  if (!outlook) {
    return failedBelief(`race outlook could not be resolved for ${slug}`, now);
  }
  if (outlook.goalFeasibility.status === 'unavailable') {
    return absentBelief(
      outlook.goalFeasibility.reasons.join('; ') || 'no projection available',
      outlook.resolvedAt,
    );
  }
  return submitted({
    estimate: { best: outlook.goalFeasibility.status, range: null },
    confidence: outlook.currentProjection.confidence ?? outlook.capacity.confidence,
    sourceMode: outlook.capacity.sourceMode,
    recency: outlook.capacity.newestEvidenceISO
      ? {
          newestISO: outlook.capacity.newestEvidenceISO,
          oldestISO: outlook.capacity.newestEvidenceISO,
          medianAgeDays: 0,
          observations: outlook.capacity.evidenceIds.length,
        }
      : null,
    lastUpdatedISO: outlook.resolvedAt,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 12/13 · INJURY_STATE + ILLNESS_STATE ("safety/recovery state") · owner
 * resolveSafety (loadSafetyInputs + classifySafety) · one call, two beliefs
 * ═══════════════════════════════════════════════════════════════════════ */

async function loadInjuryAndIllness(
  userUuid: string,
  todayISO: string,
): Promise<{
  INJURY_STATE: RunnerBeliefInput['INJURY_STATE'];
  ILLNESS_STATE: RunnerBeliefInput['ILLNESS_STATE'];
}> {
  const now = new Date().toISOString();
  const res = await resolveSafety(userUuid, { todayISO });
  if (!res.known) {
    const why = `safety signals unreadable: ${res.unreadable.map((u) => u.signal).join(', ')}`;
    return { INJURY_STATE: failedBelief(why, now), ILLNESS_STATE: failedBelief(why, now) };
  }
  const injury = res.injury;
  const daysOpenFor = (startISO: string): number =>
    Math.max(0, Math.round((Date.parse(todayISO) - Date.parse(startISO)) / 86_400_000));
  return {
    INJURY_STATE: submitted({
      estimate: {
        best: {
          open: injury != null,
          site: injury?.site ?? null,
          severity: injury?.severity ?? null,
          daysOpen: injury ? daysOpenFor(injury.startDateISO) : null,
        },
        range: null,
      },
      confidence: null,
      sourceMode: null,
      lastUpdatedISO: now,
    }),
    ILLNESS_STATE: submitted({
      estimate: {
        best: {
          open: res.illness != null,
          hasFever: res.illness?.hasFever ?? false,
          daysActive: res.illness?.daysActive ?? null,
        },
        range: null,
      },
      confidence: null,
      sourceMode: null,
      lastUpdatedISO: now,
    }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 14 · MAX_DEMONSTRATED_DOSE · F097 · owner maxDemonstratedDoseByDomain
 *
 * THE SLOT USED TO EXIST AND BE EMPTY (`ownership.ts`'s own words, until this
 * pass). `lib/execution/max-demonstrated-dose.ts` is the aggregator that
 * finding names as missing — a rolling 30-day, per-domain MAX over
 * `reconstruct.ts#actualStimulus`'s already-computed `{domain, workMinutes}`,
 * taper/race-week/post-race-recovery days excluded from the candidate pool.
 * See that file's header for the full doctrine citation
 * (`for coaching consult/consult-log/2026-09-14-023-…` and its
 * `2026-09-15-025-…` correction) and the exact reuse of `recentPeakLongMi`'s
 * window-construction pattern.
 *
 * An EMPTY `atPaceMinutesByFamily` is a real, submitted answer, not an
 * absence — `MaxDoseBelief`'s own doc comment: "Empty when measured and none
 * found, which is not the same as never looked." Only a read that did not
 * COMPLETE (a thrown error) is `failedBelief`.
 *
 * EXPORTED, unlike every sibling loader in this file — the one deliberate
 * exception to this file's own "loaders stay private, only the whole build
 * is exported" convention. F097's Rule 18 falsification needs a test that
 * reverts this function to its pre-fix body (`return absentBelief(...)`) and
 * confirms a test catches exactly that regression; doing that through
 * `buildRunnerBeliefInput` alone would require mocking nine unrelated owner
 * functions to isolate one field. `_max_demonstrated_dose_loader.test.ts` is
 * that test.
 * ═══════════════════════════════════════════════════════════════════════ */

export async function loadMaxDemonstratedDose(
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput['MAX_DEMONSTRATED_DOSE']> {
  const now = new Date().toISOString();
  try {
    const read = await maxDemonstratedDoseByDomain(userUuid, todayISO);
    return submitted({
      estimate: { best: { atPaceMinutesByFamily: read.atPaceMinutesByDomain }, range: null },
      confidence: null,
      sourceMode: null,
      recency: null,
      lastUpdatedISO: now,
    });
  } catch (err) {
    return failedBelief(
      `max-demonstrated-dose aggregation did not complete: `
      + `${err instanceof Error ? err.message : String(err)}`,
      now,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 15 · TRAINING_PHASE · NO CANONICAL OWNER
 *
 * `ownership.ts` OPEN finding with `canonical: null`. Submitting a value here
 * would be the thirteenth-owner defect the brief explicitly forbids; the
 * honest submission is `absentBelief`, naming the finding so a reader of the
 * stored row can see WHY rather than assuming a bug.
 * ═══════════════════════════════════════════════════════════════════════ */

function loadTrainingPhase(): RunnerBeliefInput['TRAINING_PHASE'] {
  return absentBelief(
    'no canonical owner exists (ownership.ts OPEN: five readers, two phase '
    + 'vocabularies, two different current-week resolutions — '
    + 'lib/coach/state-loader.ts#loadCoachState, lib/coach/glance-state.ts#loadGlanceState, '
    + 'lib/workout-catalogue/select.ts#PHASE_FROM_ENGINE, '
    + 'lib/plan/catalogue-rx.ts#doctrinePhasesForWeek can all disagree on the same day)',
    new Date().toISOString(),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 16 · LONG_RUN_TOLERANCE · owner evidenceLongCeilingMi, real inputs UNWIRED
 * ═══════════════════════════════════════════════════════════════════════ */

function loadLongRunTolerance(): RunnerBeliefInput['LONG_RUN_TOLERANCE'] {
  return failedBelief(
    'evidenceLongCeilingMi (lib/plan/generate.ts) is the registered PURE owner, '
    + 'but its real inputs (demonstratedLongMi, recentLongMi) are unexported '
    + 'closures inside generate.ts with no reader outside it; wiring this belief '
    + 'without duplicating that logic needs generate.ts to export them, which is '
    + 'out of this session\'s file scope (lib/runner-state/ only)',
    new Date().toISOString(),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE WHOLE BUILD · one call per runner, one RunnerBeliefInput out
 * ═══════════════════════════════════════════════════════════════════════ */

export async function buildRunnerBeliefInput(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput> {
  const now = new Date().toISOString();
  const [
    sustainableWeeklyVolume,
    loads,
    thresholdPace,
    intervalPace,
    marathonPace,
    goalFeasibility,
    safety,
    maxDemonstratedDose,
  ] = await Promise.all([
    loadSustainableWeeklyVolume(userUuid, todayISO),
    loadAcuteAndChronicLoad(userUuid, todayISO),
    loadThresholdPace(userUuid, todayISO),
    loadIntervalPace(userUuid, todayISO),
    loadMarathonPace(userUuid, todayISO),
    loadGoalFeasibility(exec, userUuid, todayISO),
    loadInjuryAndIllness(userUuid, todayISO),
    loadMaxDemonstratedDose(userUuid, todayISO),
  ]);

  const input = {
    SUSTAINABLE_WEEKLY_VOLUME: sustainableWeeklyVolume,
    ACUTE_LOAD: loads.ACUTE_LOAD,
    CHRONIC_LOAD: loads.CHRONIC_LOAD,
    THRESHOLD_PACE: thresholdPace,
    INTERVAL_PACE: intervalPace,
    MARATHON_PACE: marathonPace,
    GOAL_FEASIBILITY: goalFeasibility,
    INJURY_STATE: safety.INJURY_STATE,
    ILLNESS_STATE: safety.ILLNESS_STATE,
    MAX_DEMONSTRATED_DOSE: maxDemonstratedDose,
    TRAINING_PHASE: loadTrainingPhase(),
    LONG_RUN_TOLERANCE: loadLongRunTolerance(),
  } as Record<BeliefKey, RunnerBeliefInput[BeliefKey]>;

  for (const key of NOT_IN_SCOPE_TONIGHT) {
    (input as Record<BeliefKey, unknown>)[key] = notLookedFor(key, now);
  }

  return input as RunnerBeliefInput;
}

/** Allow a caller (the orchestrator, or a test) to run this against the pool
 *  directly rather than threading a transaction through every call. */
export async function buildRunnerBeliefInputOnPool(
  pool: Pool,
  userUuid: string,
  todayISO: string,
): Promise<RunnerBeliefInput> {
  return buildRunnerBeliefInput(pool, userUuid, todayISO);
}
