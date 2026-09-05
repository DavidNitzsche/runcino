# One brain · the consolidation map

Before and after for every path that could change a training prescription.

## The authority boundary

`lib/plan/mutate.ts` has been the transactional door in front of
`plan_workouts` since it was written. Its own header called itself "the single
door". It validated the RESULT and never the AUTHORITY, so
`AUTOMATIC_ADAPTATION_AUTHORITY = false` was true at the same moment an
unattended cron rewrote 76 workouts through `reanchorActivePlan`.

`MutatePlanOptions.authority` is now **required**. A caller cannot inherit a
default, and adding a writer without classifying it is a compile error.

| class | permitted while the seam is closed |
|---|---|
| `RUNNER_INITIATED` | yes · it is his plan |
| `RUNNER_ACCEPTED` | yes · the destination the whole loop is built toward |
| `LIFECYCLE` | yes, and narrowly |
| `COACHING_ADAPTATION` | **refused** |
| `AUTHORSHIP` | yes · nothing to change yet |

## Every mutation site, classified

| authority | count | sites |
|---|---:|---|
| RUNNER_INITIATED | 7 | `plan/workout`, `plan/replan`, `plan/restore`, `today/reschedule`, `reschedule.ts` x2, `replan-scenarios.ts` |
| RUNNER_ACCEPTED | 3 | `coach/proposal`, `accept-standing`, `workout-proposals/[id]/accept` |
| AUTHORSHIP | 3 | `generate.ts`, `seed-from-onboarding.ts`, `injury-builder.ts` |
| LIFECYCLE | 3 | `race-row-refresh.ts`, `race-role-apply.ts`, `admin/backfill-workout-spec` |
| **COACHING_ADAPTATION** | **4** | **`reanchor-plan.ts` x3, `recompute-paces.ts`** |

## The one that mattered most

`applyAdaptations` is reached by TWO authorities and could not tell them apart.
`/api/plan/workout-proposals/[id]/accept` calls it after the runner accepts;
`run-adaptations` calls it unattended. **They were the same call.** That is how
an automatic coaching change and a runner-consented one became
indistinguishable at the write. It now takes the authority as a parameter,
threaded from the caller, never assumed here.

## The named hold, not an exemption

`reanchorActivePlan` and `recompute-paces` declare `COACHING_ADAPTATION` and
carry a hold with all three fields:

- **owner** David
- **blocker** the refusal has nowhere to go until reanchor raises a proposal
  instead of writing
- **expires when** reanchor creates a proposal and applies it under
  RUNNER_ACCEPTED

**The hold logs on every run.** That is the difference between a hold and a
bypass, and it is why the paces still re-anchor today while the path out is
named rather than silent.

`lifecycleClaimIsHonest` guards the obvious escape: a write claiming LIFECYCLE
while touching `distance_mi`, `duration_min`, `pace_target_s_per_mi`, `type`,
`is_quality`, `is_long`, `workout_spec` or `date_iso` is a coaching adaptation
whatever it calls itself.

## Threshold pace · five owners became one

| owner | value | disposition |
|---|---|---|
| `capacity-resolver.resolveThresholdCapacity` | **430 s/mi** | **CANONICAL** |
| `resolvePrescribedPaceAnchors` | 430 | consumes the canonical |
| `vdot.resolveCurrentTPace` | 431 | subordinate rungs 2-4 |
| **`spec-builder.tPaceFromGoal`** | **394** | **DELETED**, guarded as removed |
| `tPaceFromVdot(anchorVdotFromState)` | **440** | migrated at `reconstruct.ts` |

Widest pair **46 s/mi**. The 394 was derived from the 3:00 GOAL, which
`DOCTRINE_ENFORCEMENT` forbids outright. Three owners remain OPEN, each named
with file:line rather than half-migrated.

## The asymmetry, with its mechanism

`Research/01` §"Triggers to retest":

- **up** · "Tempo runs feel notably easier at the same target pace" → +1 VDOT,
  **no session count**
- **down** · "Tempo runs unexpectedly hard for **>=2 sessions**" → -1 to -2 VDOT

**"2 sessions" appears only in the DOWNWARD row.**
`ADAPTATION.training-lead-quantum` parsed it out of that row at build time and
pinned it to the UPWARD constant. The constants were named `TRAINING_LEAD_*`.

| condition | UP required | DOWN required |
|---|---|---|
| delta | >= +1.0 | < -1.5 |
| qualifying sessions | >= 2 | **none** |
| span | >= 14 days | **none** |
| freshness | <= 28 days | **none** |
| winner is a run | required | **none** |

The downward arm's only corroboration counted `snapshot_date` rows, which are
cron mornings rather than sessions. Corrected: both arms now corroborate through
one direction-free helper, and the constants are renamed `TRAINING_TREND_*`.

## Retired, wrapped, held

| former owner | disposition |
|---|---|
| `spec-builder.tPaceFromGoal` | **RETIRED** · deleted, guarded as removed |
| `vdot.resolveCurrentTPace` | **WRAPPED** · subordinate rungs behind the canonical resolver |
| `reconstruct.ts` VDOT ladder | **MIGRATED** · reads the canonical anchors |
| 3 dead legacy-cascade imports | **RETIRED** |
| `reanchorActivePlan` | **HELD** · named owner, blocker, expiry, logged every run |
| `recompute-paces.ts` | **HELD** · inherits reanchor's blocker |
| `goal-projection.ts` x2 | **OPEN** · named with file:line, not half-migrated |
| `seed-from-onboarding.ts` | **OPEN** · cold start, provisional, replaced within days |
