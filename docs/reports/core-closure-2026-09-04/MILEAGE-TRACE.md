# Does running extra mileage increase future planned mileage?

Traced through the real code path on 2026-09-04, at `origin/main` `a8392d08`.
Not from intent, not from documentation, not from a proposal.

## The answer

**No. Three independent paths point down. None points up.**

The engine does detect that you ran more than prescribed. Its only response is
to propose **cutting the next seven days by 17%**.

## The trace, stage by stage

| Stage | Owner | What actually happens |
|---|---|---|
| **ingest** | `app/api/ingest/workout/route.ts` | Writes a `runs` row. Since EXECIDENT-2 (today) it also stamps `data.planWorkoutId` when exactly one candidate matches, and refuses to stamp when more than one does. **Works.** |
| **execution identity** | `lib/execution/day-resolver.ts` | EXACT (`planWorkoutId`) / LEGACY (`workoutType` + `workoutTypeSource='plan'`) / SUPPLEMENTAL. **Works.** Before today, 2 of 159 canonical rows carried `planWorkoutId`, so 98.7% resolved LEGACY. |
| **weekly execution total** | `lib/plan/adapt.ts` · `overshootFires` | The ONLY place prescribed and completed weekly volume are compared. `completedMi > overshootBaseline(scheduledMi, fallbackBaselineMi, ctx).baseline * 1.25`. |
| **evidence grading** | `lib/adaptation/canonical/stimulus.ts` · `gradeStimulus` | Grades an individual SESSION against its prescription. There is no weekly-volume grade. Weekly overrun is not an input to any grade. |
| **capacity belief** | — | **DEAD END. There is no demonstrated-volume belief.** Capacity beliefs are pace-anchored (VDOT, threshold). Volume never updates one. |
| **adaptation proposal** | `lib/plan/adapt.ts` | `volume_overshoot` → `kind: 'shave'`, **17% off the next 7 days, proportional**. In `PROPOSE_FIRST_TRIGGERS`, so it proposes rather than auto-applies. |
| **upward proposal** | `lib/plan/adaptive-ramp.ts` · `tryAdaptiveBump` | First executable line: `if (!automaticPlanMutationIsAuthorised()) return null;`. `AUTOMATIC_ADAPTATION_AUTHORITY: false = false`. **Sealed by the owner on 2026-09-02 and it stays sealed.** |
| **arbitration** | `lib/adaptation/canonical/arbitration.ts` | Never reached from a volume overrun, because no upward volume proposal is ever produced. |
| **future plan mutation** | `lib/plan/adapt.ts` · `applyAdaptations` | The only mutation an overrun can reach is the shave, and only if the runner accepts the proposal. |
| **runner-facing explanation** | `coach_intents` + the proposal card | A card offering to cut the next seven days. There is no sentence anywhere that says "you handled more, so next week grows." |

## The three downward paths, named

**1 · Detection is a safety trigger, not evidence.** `volume_overshoot` is the
only mechanism in the engine that reads a weekly overrun, and its output is a
17% cut. Running 25% over baseline is treated purely as risk.

**2 · The upward lever refuses before it reads anything.** `tryAdaptiveBump`
returns `null` on its first line. This is deliberate and correct: it is the
owner's own 2026-09-02 seal, placed BEFORE any read specifically so no live call
site sits one edit away from mutating a plan. It is not a defect. It does mean
the volume axis has no live upward path at all.

**3 · Extra mileage actively CLOSES the upward gate.** Even with the seam open,
the five ramp signals are `acwrHeadroom`, `lastQualityOnPace`, `lastLongClean`,
`belowTierUpper`, `noBumpRecent`. **None reads "he ran more than prescribed."**
The only channel extra mileage has into the ramp is ACWR, and
`acwrHeadroom = acwrValue < 1.3` is a CEILING. More mileage raises acute load,
raises ACWR, and turns the gate off.

**So the harder you train, the less likely the engine is to let you train
harder.** That is the Rule 21 asymmetry, measured rather than asserted.

## The one upward channel that does exist, and why it is not enough

`recentPeakWeeklyMileage` → `recomputeAdaptationCeiling` → `tierWeeklyUpperMi` →
`belowTierUpper`. A bigger demonstrated peak raises the tier ceiling, which makes
`belowTierUpper` more likely to be true.

That is a **permission**, not a trigger and not a belief. It widens the room a
bump could use if a bump were ever proposed. Nothing proposes one.

## Thresholds and suppressors, listed

| Name | Value | Direction | Owner |
|---|---|---|---|
| `overshootFires` multiplier | 1.25 x baseline | DOWN (triggers a cut) | `lib/plan/adapt.ts` |
| shave fraction | 17% of next 7 days | DOWN | `lib/plan/adapt.ts` |
| `ACWR_ADD_LOAD_CEILING` | 1.30 | suppressor of UP | `lib/plan/adaptive-ramp.ts` |
| `COOLDOWN_DAYS` | 7 | suppressor of UP | `lib/plan/adaptive-ramp.ts` |
| `MAX_WEEKLY_BUMP_MI` | 5.0 | caps UP | `lib/plan/adaptive-ramp.ts` |
| `MAX_LONG_BUMP_MI` | 1.0 | caps UP | `lib/plan/adaptive-ramp.ts` |
| `LONG_DECOUPLING_PCT_CAP` | 5 | suppressor of UP | `lib/plan/adaptive-ramp.ts` |
| `AUTOMATIC_ADAPTATION_AUTHORITY` | `false` | blocks UP entirely | `lib/plan/adaptation-authority.ts` |
| pull-back lookback | 48h | suppressor of UP | `lib/plan/adaptive-ramp.ts` |

Nine entries. **Eight suppress or cap an increase. One triggers a decrease.
Zero trigger an increase.**

## Two historical defects worth knowing, both already fixed, both the same shape

They are recorded here because they show this is a pattern rather than an
accident.

- The ramp's quality gate read `runs.data->>'type'`, a key that has never held a
  session type on any row. It returned empty on every call for every runner, so
  the upward ramp could not fire whatever anybody ran. Measured: it passed on 0
  of the owner's last 121 days.
- The bump cooldown queried `coach_intents.reason = 'plan_adapt_bump'`, a string
  nothing in the codebase has ever written, so the seven-day cooldown never
  engaged and the log could not distinguish "fired nightly" from "never fired".

Both are Rule 14 (a query naming a population that does not exist), and both sat
on the upward path.

## What is being built

The missing path, specified by the owner and under construction on branch
`mileage-responsive`: classify the extra mileage, accept it as evidence only when
identity, telemetry, deterioration, injury and absorption all permit, update a
demonstrated-volume belief that does not exist today, re-adjudicate future
unsealed weeks, preserve cutbacks and tapers, refuse to advance volume and
intensity together, and explain the result.

**The seam stays sealed.** This builds and proves the path in shadow. Turning it
on is a separate decision and needs the owner's explicit approval.
