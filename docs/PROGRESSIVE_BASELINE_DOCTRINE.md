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

---

# Round 3 rulings · locked 2026-09-03

## Q10 · Threshold progression — through WORKLOAD, not scheduled pace

Keep the baseline threshold anchor at the demonstrated **7:10/mi**. Progress the
session, not the pace: `4×1mi · 5×1mi · 3×1.5mi · 2×2mi · 3mi continuous · ~4mi
continuous or in longer reps` — **not that exact sequence**; preserve variety and
fit it around races and marathon-specific work.

Progress **total threshold duration · repetition length · recovery density ·
ability to hold the effort late**. *"Do not aggressively progress all three
simultaneously."*

> *"Threshold is currently a relative strength. The baseline should use it to
> support marathon development without turning the block into a
> threshold-focused plan. The Adaptation Engine — not an optimistic calendar
> forecast — should move the threshold pace when qualifying evidence supports
> it."*

## Q11 · Santa Monica 10k — a genuine B race

Raced hard but intelligently: controlled first mile, settle into honest 10K
effort, strong final portion if execution stays sound, no chasing an arbitrary
result. It buys a current benchmark, threshold and high-intensity evidence, an
early check on pace-model calibration, and a comparison point before Dodgers.

**Finding to act on:** *"The week may be a cutback, but 24.4 miles appears
excessively low relative to the surrounding 47-50-mile weeks. Reassess the
week's total so the race replaces quality work without unnecessarily cutting
approximately half the weekly volume."*

**Santa Monica is a hard race. Dodgers is a controlled training race. Their
distinct roles must appear in their prescriptions AND their post-run
interpretations.**

## Q12 · "Achieved intended stimulus" — seven conditions, five outcomes

**The simple pace-OR-HR rule is rejected.** *"Either channel can be misleading,
and averages can hide failed repetitions."*

A threshold workout achieved its stimulus when:

1. **≥90%** of prescribed work duration completed.
2. **≥75%** of prescribed work segments individually acceptable.
3. Session-level work pace within **~±3%** of target or range.
4. HR, **when reliable**, compatible with threshold work and not materially
   contradicting the pace result.
5. No major late-session collapse.
6. Recoveries not extended enough to materially change the workout.
7. Activity data sufficiently complete and correctly segmented.

**One noisy channel allowed.** Pace may be discounted for hills, GPS error, heat,
wind, or a deliberately effort-governed workout. HR may be discounted when
absent, delayed, obviously erroneous, or sensor-affected. **But the remaining
evidence must be credible** — *"do not let 'HR in range' validate a substantially
underperformed session, or 'pace in range' validate a session completed at
clearly excessive effort."* Grade-adjusted or terrain-aware comparison only where
trustworthy.

**Return five states, not pass/fail:** `FULL` · `SUBSTANTIAL` · `PARTIAL` ·
`DIFFERENT` · `INSUFFICIENT_EVIDENCE`.

For the earned-peak criterion, **FULL and defensible SUBSTANTIAL count. PARTIAL
does not automatically count.**

## Q13 · "Meaningful late-session deterioration"

Apply **only to comparable work**. Flag when any of:

- Final-third **grade/terrain-adjusted** pace >~4-5% slower than the middle
  third while HR is equal or higher.
- Pace within ~2% but **HR rises >~6 bpm**.
- **Pace-to-HR decoupling >~5%**.
- Multiple late work segments materially miss after earlier segments were
  controlled.

**Exclude or adjust for:** intentional progression · cool-down · stops and
traffic · meaningfully different terrain · heat or weather change · fuelling
stops · GPS or HR errors · prescribed recovery segments.

*"Do not infer deterioration from whole-run thirds when the workout contains
different prescribed phases."*

**"Repeated" means ≥2 relevant SESSIONS in the window, not two segments in one
run.** One deteriorated session reduces confidence; it must not independently
block progression unless the deterioration is extreme or that session was the
direct prerequisite.

## Q14 · Quality density

When a long run carries **≥~6 meaningful marathon-effort miles**, it IS a quality
session — schedule only **one** additional midweek quality workout.

Preferred: **Tue** threshold or other quality · **Thu** easy or steady, optionally
strides · **Sun** marathon-specific long run.

Two midweek sessions may remain for easier long runs or a short marathon-effort
touch, if the whole week is coherent.

## Q15 · Cutback depth — CHANGED

Ordinary cutbacks: **~20-25%** reduction from the relevant preceding build load,
**preserving running frequency and a small intensity touch** while reducing total
volume and long-run demand.

25-30% may follow a particularly demanding peak, race or multi-week
accumulation, but **must not be the automatic depth of every cutback**. Avoid
~40-50% except for race-week structure, post-race recovery, taper, or a
deliberately exceptional transition.

**Calculate against the relevant surrounding BUILD level, not against a distorted
race or taper week.**

> *"Because consistency is the primary constraint, ordinary cutbacks should
> provide recovery without breaking the training rhythm."*

## Q16 · The week after Run Malibu

**Thursday or Friday · ~3 miles at currently supported marathon effort · embedded
in an otherwise easy run · comfortable warm-up and cool-down · no threshold
finish · no attempt to prove new fitness.** The half is already the major
stimulus. Rest of the week easy, with an easy **14-16 mi** long run if it fits
the progression.

## Q17 · Race-week tune-up

**Keep the 5×400m** at current 5K effort on Tuesday, with the intent made
explicit: controlled and relaxed · full or generous recoveries · low total work
volume · finish sharper, not tested · **no adaptation evidence inferred from it**
· missing the nominal pace is **not** a fitness verdict during race week.

## Q18 · Taper long runs — CHANGED

**Not 18/13.** Use **14-16 mi two weeks out** and **8-10 mi one week out**. The
final major long or marathon-specific rehearsal happens **~3 weeks out**; after
that the purpose is shedding fatigue while preserving rhythm.

The two-weeks-out run may carry a small controlled marathon-effort component if
earlier development supports it, but **must not function as another peak
workout**. The one-week-out run must not create meaningful residual fatigue.

> *"A research table matching 18/13 does not override the runner's actual
> consistency history, the aggressive preceding block, and the intended function
> of taper."*

## Q19 · Strides — CHANGED

**~2 stride exposures per week** in normal build weeks, not nearly every easy
day. Usually **4-6 × 20s**, full easy recovery, relaxed quick mechanics, never
all-out. **Avoid placing them immediately after the most demanding quality or
long-run days.** Dose broadly constant — neuromuscular maintenance, **not a
progression lever**. Occasional light hill strides early for variety; no separate
escalating hill-stride progression without a named purpose. Retain a small dose
in taper.

## Q20 · Evidence required to move the THRESHOLD anchor

**A single training session must never move it.**

Normally require: **≥2 independent qualifying threshold-relevant sessions**,
within **~21-28 days**, on separate days, with sufficient completed work and
reliable segmentation, showing a consistent direction, without material
contradictory evidence.

Accept any of: one well-executed **10K or half** race **plus ≥1 corroborating
recent training session**; or two qualifying training sessions; or multiple
consistent observations in the same direction.

**A 5K informs high-intensity capacity more than threshold. A 10K or half is
directly relevant. Marathon results are NOT clean threshold evidence** —
durability and execution dominate them.

Qualifying training evidence needs: sufficient threshold work duration ·
appropriate pace/HR relationship · acceptable recoveries · no major late
deterioration · representative conditions or suitable adjustment · complete
canonical data · stimulus classified **FULL or defensible SUBSTANTIAL**.

**Movement is bounded:** ~**3-5 s/mi** for an ordinary confirmed update; larger
movement requires stronger and more numerous evidence; **no same-day
oscillation**; **re-ingesting the same evidence is idempotent**; contradictory
evidence reduces confidence or produces **HOLD** — it must not make the anchor
bounce.

---

## The governing principles

- Progress strong capacities mainly through **workload** before moving their pace.
- Build marathon durability through **consistent weeks** and specific long runs.
- Make races serve **distinct purposes**.
- Treat marathon-specific long runs as **quality days**.
- Use ordinary cutbacks to **preserve consistency, not interrupt it**.
- **Taper by removing fatigue, not by completing unfinished development.**
- Require **corroborated, lever-specific** evidence before changing a pace anchor.
- **Preserve aggressive intent without confusing aggression with maximum load at
  every opportunity.**
