# Progressive baseline doctrine

**Locked 2026-09-03 by David.** The central product requirement. Read with
`PLAN_SIMPLIFICATION_DOCTRINE.md`, which says what may not influence the plan;
this says what the plan must DO.

---

## The requirement

> **The baseline plan must be intrinsically progressive and capable of making
> the runner faster. Adaptation must personalize that progression based on what
> the runner actually demonstrates.**

> *"The baseline is not a static repetition of current fitness. It is the
> engine's best initial forecast of the training path from current demonstrated
> ability toward the stated goal."*

**The failing condition, stated as a test:** *"A plan that merely repeats
today's capability fails even if every number is internally consistent."*

That sentence is the acceptance criterion. Internal consistency is necessary and
not sufficient.

## What must intentionally progress

Sustainable weekly volume · long-run durability · threshold capacity ·
high-intensity capacity · **marathon-effort duration** · **marathon-specific
pace** · race-specific execution · confidence in the race outlook.

## What every meaningful progression must state

1. Starting point.
2. Intended future point.
3. The training stimulus intended to create the change.
4. When the change is scheduled.
5. The evidence expected before the next progression.
6. **What assumption the generator is making about training response.**

Item 6 is the one that makes adaptation possible. A forecast with a named
assumption can be replaced by evidence; an unlabelled number cannot.

## The division of labour

> *"The Adaptation Engine does not rescue a weak plan. It replaces the
> baseline's assumptions with observed evidence."*

```
Baseline forecasts the path
  → completed training tests the forecast
    → adaptation confirms, advances, holds, or refuses
      → the remaining plan stays coherent
```

Canonical adaptation behaviours:

- Progress matches expectation → **preserve** the planned progression.
- Evidence shows faster progress → **advance the relevant lever**, within
  validated bounds.
- Progress is slower → **hold or revise only the affected lever**.
- Evidence conflicts or is insufficient → **refuse**.
- One capacity improves → **do not automatically move unrelated capacities**.
- Always **preserve the coherence of the remaining marathon build**.

> *"The goal supplies direction and required future capability. Current evidence
> supplies the starting point. The baseline plan connects them. Adaptation
> determines how quickly and by which route the runner can continue moving
> toward the goal."*

---

## Q7 · The active race target

| Layer | Value | Rule |
|---|---|---|
| Aspirational goal | **3:00** | unchanged, never used as capacity |
| Active current-evidence target | **~3:24 · 7:47/mi** | the projection-derived value, used **wherever one current execution number is required** |
| Likely range | the canonical current-evidence range | displayed as a range |
| Conditional upside | **~3:13-3:15** | with explicit criteria attached |

**3:13:30 must not be labelled the current execution target merely because it is
the fast edge of a wide range.** And: *"Do not average the projection and goal to
manufacture a compromise target."*

The app must make temporality explicit. His own framing:

> *"Based on what you have demonstrated today, the executable plan is
> approximately 3:24. The current block is designed to move that forward.
> Approximately 3:13-3:15 is available as an upside outcome if marathon-specific
> workouts, tune-up racing, and accumulated training support it."*

**By race week the system must select ONE specific execution plan with a range
for uncertainty — not four competing targets.**

## Q8 · Marathon-effort progression in the baseline

The baseline progresses **both duration and pace** — but the scheduled pace
progression is *a forecast of expected development, not evidence the runner
already possesses the future pace.*

Directional bounds, **not hardcoded values** — resolve exact prescriptions
through the canonical pace and load contracts:

| Phase | Marathon-effort pace |
|---|---|
| Early marathon-specific work | 7:50-7:55/mi |
| Middle progression | ~7:45-7:50/mi |
| Later peak-specific work | ~7:38-7:45/mi, **only after preceding development** |
| Taper rehearsal | preserve the most recently supported effort; **no large new pace jump** |

**No mechanical linear march from 7:52 toward the 6:52 goal.**

Every future pace step carries: the prior supported pace · the expected training
development behind the new pace · the amount of scheduled change · the evidence
expected before execution · **a supported fallback pace if the forecast is not
confirmed.**

**Duration is the primary early lever. Pace moves in smaller increments.** Do
not increase pace and marathon-effort volume aggressively in the same step
unless evidence supports both independently.

> *"The path from approximately 7:52 training effort to a possible 7:23 race
> execution must be explicit. If the training evidence never closes enough of
> that gap, the race target must remain slower."*

## Q9 · Peak volume, and what "earned" means

**Shape.** A single planned **60-mile peak week**. A limited number of
low-to-mid-50s weeks — *"do not raise the entire floor merely to manufacture"*
them, since he has never recorded a 50-mile calendar week and repeated weeks in
that range are already a meaningful new demand. Planned cutbacks preserved. **No
attempt to make 60 the normal weekly baseline**, and no abrupt collapse after it
except an intentional cutback, tune-up race, or taper.

*"Judge the plan by the successfully accumulated sequence, not by touching 60."*

**Planned versus earned.** The 60 is planned in the baseline, supported
prospectively by the time-aware progression envelope, **conditional on preceding
execution**, and confirmed or held by the canonical Adaptation Engine as it
approaches.

> **"'Earned' must be machine-evaluable. It cannot exist only as prose."**

Evaluated **7-10 days before** the peak week, over the preceding relevant
training. All eight:

1. At least **two of the preceding three non-cutback weeks** completed at **≥90%**
   of prescribed volume.
2. Relevant preceding long runs substantially completed — normally **≥90%** of
   prescribed distance.
3. Key quality sessions achieved their intended **stimulus** — this does **not**
   require perfect pace compliance.
4. No repeated meaningful **late-session deterioration** across the relevant long
   or marathon-specific work.
5. **No unresolved missing, duplicate, truncated or misclassified activity data**
   affecting the decision.
6. The demonstrated-load envelope has advanced sufficiently to authorise it.
7. Weekly volume, long-run demand and quality density remain coherent together.
8. The proposed week passes every plan invariant.

**Forbidden inputs:** readiness · sleep · HRV · TSB · injury automation ·
illness automation · self-declared experience.

**Outcomes.** Earned → preserve 60. Not earned → propose **holding near the most
recently demonstrated load, likely ~55-57**, preserving the important workout
purposes. It must **not collapse the plan, restart a base phase, or re-phase the
block.** While automatic adaptation is disabled this appears as an
**owner-visible proposal, never a silent mutation.** Insufficient data → **refuse
to claim the week is earned and present the uncertainty. Missing data is not
successful training.**
