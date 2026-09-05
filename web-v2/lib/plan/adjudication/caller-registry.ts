/**
 * lib/plan/adjudication/caller-registry.ts · WHO MAY AUTHOR A PLAN WITHOUT
 * BEING ABLE TO SIZE IT AGAINST THE RUNNER, AND WHY.
 *
 * ── THE PROBLEM THIS SOLVES, AND THE ONE IT REFUSES TO SOLVE ────────────────
 *
 * `validateComposedPlan` runs the adjudication unconditionally. When the
 * demonstrated history is absent the adjudication CANNOT RUN, and Rule 11 says
 * that is "don't know", never "passed". The honest answer is to refuse.
 *
 * Refusing on every path would brick authoring, because two live callers
 * genuinely have no runner to read a history for. So they are NAMED here, with
 * an ARGUED reason, in a RATCHET — modelled on `lib/audit/normal-window-
 * registry.ts` and on `NOT_A_SEAM` in `_seal_single_seam.test.ts`, both of
 * which take the same shape for the same reason.
 *
 * WHAT THIS FILE CANNOT DO, and the line is deliberate:
 *
 *   · It cannot excuse a REAL adjudication finding. An unsupported decision, a
 *     simultaneous-peak week that was still pushed, a decision that did not
 *     compare all three options — those are fatal on every path, for every
 *     caller, always. `validate.ts` partitions on the refusal prefix before it
 *     ever consults this map, and `_wired.test.ts` falsifies that partition in
 *     both directions.
 *   · It is not a boolean. There is no "skip adjudication" flag anywhere,
 *     because the owner's standing objection to the advisory shape is exactly
 *     that: "no production caller ever passed the callback, so the check was
 *     declared and never ran."
 *
 * ── THE RATCHET ────────────────────────────────────────────────────────────
 *
 * The allowlist may SHRINK and never grow. `_wired.test.ts` asserts:
 *
 *   1. every exempt caller's source really does NOT pass `demonstratedHistory`
 *      — so the moment one starts supplying it, the exemption is stale and
 *      FAILS until the entry is deleted;
 *   2. `plan/generate` is NOT in this map — the production authoring path is
 *      never exempt, and an attempt to add it fails by name;
 *   3. every reason is an argument and not a shrug.
 */

/** Every path that reaches `validateComposedPlan`. Stated, so nobody is anonymous. */
export type AdjudicationCaller =
  /** `lib/plan/generate.ts` · the production authoring path. NEVER exempt. */
  | 'plan/generate'
  /** `lib/plan/mutate.ts` · the plan mutation boundary, re-validating a persisted plan. */
  | 'plan/mutate'
  /** `app/api/plan/simulate/route.ts` · the internal plan simulator. */
  | 'api/plan/simulate'
  /** Vitest fixtures and the `scripts/` probes. */
  | 'fixture';

/**
 * Callers excused from the ABSENT-HISTORY refusal, and the argument for each.
 *
 * A caller absent from this map that supplies no history gets a fatal
 * violation. That is the default, and it is the default on purpose.
 */
export const ADJUDICATION_HISTORY_EXEMPTIONS: Partial<Record<AdjudicationCaller, string>> = {
  'plan/mutate':
    'violationsOf() re-runs the validator over a REHYDRATED persisted plan inside the mutation '
    + 'boundary. It is synchronous and pure by contract (`lib/plan/mutate.ts` header: "runs on an '
    + 'in-memory ComposePlanResult"), it holds a PlanMutationContext that carries no runner history, '
    + 'and it already documents §2 and §3 as not applicable to an in-place mutation for the same '
    + 'reason. The block it re-validates was adjudicated at AUTHORING, by plan/generate, which is '
    + 'not exempt, so a block cannot reach production without having been adjudicated once. What '
    + 'this exemption costs is that a mutation which pushes an already-authored week past the '
    + 'runner is not re-adjudicated, and closing it means making the boundary async and giving it a '
    + 'history loader. Delete this entry when that lands.',
  'api/plan/simulate':
    'buildSimPlan() composes a plan from a SimInputs form body with no user, no session and no '
    + 'database. There is no runner whose history could be read: the simulator exists to show what '
    + 'the generator does with a hypothetical, and every synthetic caller is already refused the '
    + 'designed-weekend exception on exactly this reasoning (see ComposePlanInput.'
    + 'designedWeekendPairEvidence: "UNDEFINED IS NOT ZERO ... every synthetic caller leaves it '
    + 'undefined, and every one of them is therefore refused"). Closing this entry means the sim '
    + 'form gains four demonstrated-history fields the operator fills in.',
  fixture:
    'Vitest suites and the scripts/p0-proof probes construct a ComposePlanResult directly to '
    + 'exercise ONE validator section, and none of them has a database. Requiring a history here '
    + 'would make roughly twenty existing suites fail for a reason unrelated to what they test, '
    + 'which is how a gate gets loosened to make room for another. A fixture that WANTS the '
    + 'adjudication passes a demonstratedHistory and drops the caller id; _wired.test.ts is that '
    + 'fixture and it is what proves the gate is not inert.',
};

/**
 * The caller a `PlanValidationContext` did not name.
 *
 * Anything that does not identify itself is treated as a fixture, and that is
 * the one soft edge in this file. It is bounded by a STATIC assertion in
 * `_wired.test.ts`: every call to `validateComposedPlan` from `app/` or from a
 * non-test file under `lib/plan/` must pass `adjudicationCaller`. So a new
 * PRODUCTION caller cannot inherit the fixture exemption by staying silent —
 * it fails the scan instead.
 */
export const UNNAMED_CALLER: AdjudicationCaller = 'fixture';

/** Is this caller excused from the absent-history refusal, and on what argument? */
export function historyExemptionFor(
  caller: AdjudicationCaller | undefined,
): string | null {
  return ADJUDICATION_HISTORY_EXEMPTIONS[caller ?? UNNAMED_CALLER] ?? null;
}

/**
 * Prescribed quantities the app has NO READER for yet, and the argument for
 * each. Same ratchet, same rules: an entry whose reader now exists is stale and
 * fails until deleted.
 *
 * Searched 2026-09-04 across `lib/evidence`, `lib/execution`, `lib/adaptation`,
 * `lib/training`, `lib/plan` and `lib/coach` before either entry was written.
 * Neither is a decision not to measure; both are a statement that nothing
 * measures it today, which is the difference between a gap on the record and a
 * gap nobody knows about.
 */
export const ADJUDICATION_QUANTITY_EXEMPTIONS: Record<string, string> = {
  maxCompletedMpMi:
    'Nothing in this app reads the largest marathon-pace dose the runner has COMPLETED inside a '
    + 'long run. The nearest substrate is qualifyingMarathonRehearsal / loadMarathonRehearsals in '
    + 'lib/training/durability-anchor.ts, which does compute a per-run segmentMi from completed '
    + 'splits, but it aggregates to a median PACE, no consumer anywhere reads segmentMi, it '
    + 'requires LTHR plus per-split HR, and MARATHON_REHEARSAL_MIN_SEGMENT_MI = 6 makes a completed '
    + '4 mi MP dose invisible to it by construction. Everything else named mp/marathonPace in '
    + 'lib/plan is PRESCRIBED, not completed. A max over loadMarathonRehearsals().observations '
    + 'would be a few lines and is the obvious next step; until it exists, this quantity is UNKNOWN '
    + 'and says so rather than being sized against a plan-side number.',
  maxStressorsInAWeek:
    'Nothing computes the MAXIMUM named stressors in a single COMPLETED week. '
    + 'generate.ts#recentQualityPerWeek buckets completed runs into 7-day blocks and then throws '
    + 'the per-block counts away to take a MEDIAN; lib/faff/week-mileage.ts#computeWeekMileage '
    + 'returns hardSessionsDone but is a pure single-window function over caller-supplied days with '
    + 'no cross-week loop; every other per-week quality figure in the app is prescribed or '
    + 'forward-looking. detectStackedStress already handles null here honestly: it falls back to '
    + 'STACKED_STRESSOR_THRESHOLD, doctrine\'s own bar, rather than to a fabricated count — so this '
    + 'entry records a known blind spot rather than excusing a silent one.',
};
