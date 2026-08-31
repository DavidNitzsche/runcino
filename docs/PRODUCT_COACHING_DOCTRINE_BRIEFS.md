# faff.run — Detailed Product Doctrine Briefs

**Companion documents to `docs/PRODUCT_COACHING_DOCTRINE.md`, locked 2026-08-31.**

The master doctrine defines what faff believes. These briefs define how each
major system should behave. When implementation details conflict with the
master doctrine, the master doctrine wins unless the doctrine itself is
deliberately revised.

---

## BRIEF 01 — RUNNER MODEL & FITNESS STATE

**Purpose.** Maintain the best defensible understanding of what the runner is
currently capable of. The runner model is not a leaderboard score — it is the
internal representation used to make coaching decisions.

**Core principle.** Fitness is a confidence-weighted belief assembled from
evidence, not a number extracted from one performance. Three primary
capacities: **High-Intensity Capacity** (shorter intervals, repetitions,
faster quality work), **Threshold Capacity** (tempo, threshold, cruise
intervals, sustained quality, part of longer-distance prescription),
**Durability** (long runs, marathon-specific work, longer-distance
prediction, race readiness).

**Fitness is not state.** Keep fitness separate from fatigue, recovery,
illness, injury, temporary environmental stress, today's readiness. Fitness
answers "what can this runner do?" State answers "what should we ask them to
do today?"

**Confidence.**

```
CapacityEstimate {
  estimate
  confidence
  uncertainty_range
  last_confirmed_at
  evidence[]
}
```

Confidence increases when multiple independent observations agree, evidence
is recent, evidence quality is high, evidence spans useful durations,
different evidence types corroborate each other. Confidence decreases when
evidence becomes stale, observations conflict, sensor quality is poor,
context is uncertain, evidence is sparse.

**Critical rule.** Stale evidence should primarily reduce confidence. It
should not automatically reduce fitness. Actual fitness decline requires
supporting evidence.

**Fallback ladder.** Recent race → recent time trial → equivalent-performance
model / VDOT → historical performance → self-reported ability → conservative
population prior. As direct evidence accumulates, fallback assumptions should
lose authority.

**Success test.** The runner model should be able to answer: what do we
currently believe about this runner? Why? How certain are we? If those
questions cannot be answered, the model is too opaque.

---

## BRIEF 02 — EVIDENCE ENGINE

**Purpose.** Determine what completed running actually tells faff about the
athlete.

**Core principle.** Collect everything. Infer selectively. Not every run
should update fitness.

**Evidence hierarchy** (not absolute — context determines reliability).
Generally strongest: races, properly executed time trials, clean sustained
threshold work, substantial structured intervals, race-specific workouts,
structured long runs. Generally weaker: steady aerobic running, easy running,
recovery running, shakeouts, short or disrupted activities.

**Two-stage processing.**

- **Stage 1 — Eligibility.** Is there enough trustworthy information here to
  infer anything? Reject or heavily restrict: corrupted GPS, broken HR where
  HR is required, insufficient duration, major interruptions, insufficient
  samples, implausible data.
- **Stage 2 — Weight.** For admissible evidence: how strongly should this
  observation influence our belief? Weight based on duration, pace stability,
  physiological consistency, workout structure, classification confidence,
  terrain, environment, sensor quality, recency, corroboration.

**Planned vs demonstrated.** Never assume `workout.type = threshold therefore
threshold evidence`. Instead: planned structure + actual execution +
physiological/contextual evidence → demonstrated capacity. A planned interval
workout may produce threshold evidence. A planned threshold workout may
produce no useful evidence.

**Evidence ledger.** Every meaningful inference should remain traceable —
store enough information to answer "which activities support this estimate?"
Do not resolve observations into a number and discard their provenance.

**Corroboration.** Repeated evidence dominates isolated observations. One
extraordinary run is interesting. Three independent runs showing the same
thing is belief-changing.

**Success test.** Given any meaningful fitness change, engineering should be
able to identify exactly which evidence caused it.

---

## BRIEF 03 — PACE PRESCRIPTION

**Purpose.** Translate demonstrated capacity into appropriate workout
intensity.

**Core principle.** Prescribe the stimulus the runner needs, not a pace they
need to prove they can hit.

**Routing.** Easy — derived conservatively from aerobic/threshold capability
with broad flexibility. Threshold — primarily threshold capacity. Faster
intervals — high-intensity capacity plus workout-duration context.
Marathon-specific — threshold capacity modified substantially by durability
and race-specific preparation.

**VDOT** remains useful as fallback, initialization, equivalency, sanity
check. It should not remain the central authority through which every
prescription must pass.

**Easy pace** should generally have a ceiling + effort guidance rather than a
narrow target band. The athlete should never need to speed up merely to
satisfy the bottom of an easy range.

**Precision should match the workout.** Threshold work may warrant tighter
targets. Easy running should not. Short repetitions may use pace ranges or
effort depending on conditions. Hills often require effort rather than pace.
Do not manufacture precision because the software can display it.

**Success test.** When an experienced runner sees a prescribed pace, it
should make immediate physiological sense given their demonstrated training.

---

## BRIEF 04 — PLAN GENERATION

**Purpose.** Turn the runner's current ability, goal, history and
availability into progressive training.

**Inputs, at minimum.** Goal race, race distance, race date, current fitness,
durability, current weekly volume, recent longest run, training frequency,
training history, available days, injury/return state, goal, experience
level.

**Core principle.** Every workout must have a reason to exist. The plan is
not a collection of workouts — it is a progression of training stimuli.

**Plan structure.** As race day approaches: general development → specific
development → race-specific preparation → taper. Exact composition depends
on the athlete and event.

**Progression variables.** Volume, duration, repetition count, repetition
duration, recovery reduction, density, race specificity, pace. Do not
automatically use pace as the primary progression mechanism.

**Recovery.** Recovery weeks exist because adaptation requires recovery. Do
not interpret reduced load during deliberate recovery as lost fitness.

**Success test.** For every workout: why this workout? why this week? why
for this runner?

---

## BRIEF 05 — WORKOUT LIBRARY & EVIDENCE COVERAGE

**Purpose.** Ensure the plan contains both appropriate training and recurring
opportunities to understand the athlete.

**Core principle.** Training quality comes first. Evidence quality breaks
ties. Never prescribe an inferior workout because the algorithm wants cleaner
data — but when two sessions provide equally useful training, prefer the one
that resolves meaningful uncertainty.

**Core workout families.** Recovery, easy, aerobic steady, easy long run,
progression long run, long run with steady blocks, race-specific long run,
continuous tempo, threshold intervals, cruise intervals, longer intervals,
VO2-oriented intervals, short repetitions, strides, hills, time trials,
tune-up races. Do not create workout variety simply for novelty.

**Evidence coverage.** Threshold — relatively frequently through tempo,
cruise work, sustained threshold sessions. High-intensity capacity —
periodically through intervals, time trials, appropriate races. Durability —
increasingly through long runs, progression long runs, steady blocks,
race-specific long runs.

**Evidence debt.** The generator may internally track whether a capacity
lacks recent trustworthy evidence:

```
EvidenceCoverage { high_intensity, threshold, durability }
```

When training choices are otherwise equivalent, evidence debt can influence
selection.

**Critical rule.** The runner does not exist to feed the model. The model
exists to coach the runner.

*(See `docs/design/plan-evidence-coverage-2026-08-31.md` for the concrete
architecture — deliberately deferred until the fitness-vector wiring lands.)*

---

## BRIEF 06 — DURABILITY

**Purpose.** Understand how well a runner preserves performance as duration
increases.

**Why it exists.** Equivalent short-distance runners do not necessarily
possess equivalent long-distance ability. This matters increasingly from 10K
→ half marathon → marathon.

**Durability is latent.** No single metric equals durability. Evidence may
include: race-distance conversion, personal Riegel behavior, long-run
history, weekly volume, long-run consistency, late-run pace degradation,
pace/HR decoupling, onset of decoupling, sustained race-specific work,
quality performed late in long runs, marathon history. These observations
collectively inform durability.

**Riegel.** Personal race history can inform individual distance conversion.
Do not treat a two-race exponent as established physiology. Partially pool
individual estimates toward a population endurance prior based on amount of
evidence, distance spread, recency, context quality, repeatability.

**Decoupling.** Use pace/HR drift as supporting evidence. Do not treat one
long run's decoupling percentage as truth — prefer repeated comparable runs.
Consider drift magnitude, drift onset, duration before drift, intensity,
heat, terrain, fueling, sensor quality.

**Success test.** The model should be able to distinguish "this runner has
the speed for the goal" from "this runner has demonstrated the ability to
hold enough of that speed for the goal distance."

---

## BRIEF 07 — ADAPTATION ENGINE

**Purpose.** Change training when meaningful evidence says something
important has changed.

**Core principle.** Adapt deliberately, not constantly. Stable training has
value. The algorithm should not fiddle with the plan simply because new data
exists.

**Types of adaptation.** Fitness (underlying capability changed → adjust
relevant training intensity). Load (runner not tolerating current
volume/density → adjust training load). Schedule (life disrupted training →
reorganize while preserving intent). Goal (race expectation materially
changed → surface the change). Safety (training inappropriate due to injury
or illness → override normal progression).

**Evidence requirement, before adapting.** What changed? What evidence
supports it? How confident are we? Does it materially affect training? What
is the smallest appropriate intervention?

**Proposal.** Meaningful adaptations should generally be surfaced, e.g. "Your
recent threshold work consistently supports faster training. We recommend
moving threshold targets approximately 5-8 sec/mi faster." The runner accepts
or declines.

**Success test.** The runner should rarely be surprised by a change once
faff explains why it happened.

---

## BRIEF 08 — TRAINING LOAD, RECOVERY & READINESS

**Purpose.** Determine whether the runner can appropriately absorb today's
planned training.

**Core principle.** Fitness describes capacity. Readiness modifies today's
demand.

**Inputs, potentially.** Recent mileage, workout density, intensity
distribution, long-run load, recent race, recovery duration, subjective
feedback, sleep where trustworthy, illness, soreness, unusual HR response,
recent training interruption. Do not blindly combine these into a magical
readiness score.

**Output.** The system should primarily answer: proceed / proceed with
caution / reduce / replace / recover / stop. This is a coaching decision. It
does not need a score of 73.

**Success test.** The system should recognize the difference between "you're
not fit enough for this workout" and "you're fit enough, but today isn't the
day."

---

## BRIEF 09 — RACE PREDICTION & GOAL FEASIBILITY

**Purpose.** Estimate what the runner can realistically race and whether
their stated goal remains supported.

**Race prediction inputs.** Relevant fitness capacities, durability, recent
volume, long-run preparation, race-specific work, recent races, training
consistency, course, environmental conditions where known.

**Output.** Avoid fake precision. Prefer "Expected: 1:32. Likely: 1:30-1:35.
Confidence: High" over a bare point estimate.

**Explainability.** Where useful, explain the limiter — e.g. "Threshold
fitness supports approximately 1:30, but durability evidence keeps the
current expectation closer to 1:32."

**Goal feasibility.** Compare current prediction against goal and time
remaining. Potential statuses: conservative, on track, aggressive, unlikely,
no longer realistic. Do not silently change the runner's goal.

**Success test.** Prediction should become more accurate and more
individualized as evidence accumulates. It should never become falsely more
certain simply because the app has more data.

---

## BRIEF 10 — MISSED TRAINING, MODIFICATIONS & REAL LIFE

**Purpose.** Coach humans rather than idealized training-plan executors.

**Core principle.** Preserve training intent, not calendar purity.

**Missed workout.** Ask: what stimulus was lost? How important was it? What
comes next? Is recovery sufficient? Does anything actually need replacing? Do
not automatically cram missed quality into later days.

**Modified workout.** Evaluate what was actually accomplished. `5×1mile →
3×2miles` may preserve the intended stimulus. `5×1mile → 3×1mile because the
athlete was exhausted` may indicate something very different. Structure
change alone does not determine success.

**Time off.** Short interruptions should primarily cause schedule/load
adaptation. Longer interruptions may eventually affect fitness confidence and
then capacity estimates. Do not instantly destroy fitness because the runner
missed a week.

**Success test.** After disruption, the revised plan should look like what a
competent human coach would do — not like an algorithm trying to repay
training debt.

---

## BRIEF 11 — SAFETY, INJURY & ILLNESS

**Purpose.** Prevent optimization logic from overriding obvious reasons not
to train.

**Core principle.** Safety sits above the normal coaching loop.

**Escalation.** Differentiate normal training discomfort, minor niggle,
worsening pain, altered gait, suspected significant injury, illness,
concerning physiological response. Not every complaint requires stopping.
Not every complaint should be trained through.

**Hard stops.** When available evidence suggests meaningful injury risk,
normal plan optimization stops. The app should be willing to say "do not run
today" and appropriately recommend professional evaluation when warranted.

**Return.** Return-to-run should prioritize rebuilding tolerance before
trying to recover lost training. Never compress missed training into the
return period.

**Success test.** The system should never encourage a runner to take
unnecessary health risk merely to preserve plan adherence or goal
probability.

---

## BRIEF 12 — COACHING EXPERIENCE & COMMUNICATION

**Purpose.** Turn complicated analysis into simple, useful coaching.

**Core principle.** Complex underneath. Clear above. The runner does not need
to see the machinery.

**Before a workout.** Tell them what they're doing, what matters, how it
should feel.

**During a workout.** Only interrupt when information changes behavior.
Useful: "Ease off slightly. This rep is about threshold, not racing." Not
useful: constant congratulation or unnecessary metrics.

**After a workout.** Answer "how did that go?" — not "here are 19 charts."
E.g. "Strong session. All five reps stayed controlled and you finished
without fading." Or: "You hit the pace, but effort climbed much higher than
expected. We're treating this as a hard session, not evidence that your
threshold moved."

**When the model learns something.** Tell the runner what changed, why, what
happens next.

**When nothing changes.** Sometimes say nothing. The app does not need to
manufacture insight after every run.

**Voice.** Direct, calm, concise, specific, evidence-based, honest about
uncertainty. Never shaming, hyperbolic, relentlessly motivational, robotic,
falsely certain.

**Success test.** The runner should understand the decision without needing
to understand the model.

---

## CROSS-SYSTEM RULES

Every system above inherits the following:

1. **Training beats data collection.** Never compromise training merely to
   improve model observability.
2. **Demonstrated ability beats aspiration.** Goals do not define current
   fitness.
3. **Multiple observations beat isolated performances.** Corroborate
   meaningful changes.
4. **Context matters.** Raw pace alone is not enough.
5. **Uncertainty is legitimate.** Do not manufacture precision.
6. **Stale evidence means lower confidence, not automatic fitness loss.**
   Require evidence before changing capacity.
7. **Fitness and readiness remain separate.** Temporary fatigue does not
   automatically mean lost fitness.
8. **Labels describe intent, not physiological truth.** Analyze what
   actually happened.
9. **Adapt the thing that changed.** Fitness, load, schedule, goal and
   safety are separate problems.
10. **Important beliefs must be traceable.** Know what evidence produced
    them.
11. **Complexity must improve a decision.** If it doesn't change coaching,
    question why it exists.
12. **The runner comes first.** The runner is not a data source serving the
    model. The model is a tool serving the runner.

---

## SYSTEM OWNERSHIP

The boundaries between these briefs matter. No subsystem should quietly take
ownership of another subsystem's question.

| System | Owns |
|---|---|
| Runner Model | What do we believe about the athlete? |
| Evidence Engine | What did this activity demonstrate? |
| Pace Prescription | What intensity corresponds to the desired stimulus? |
| Plan Generator | What training should happen and when? |
| Workout Library | What workout structures can produce that stimulus? |
| Durability | How does capability survive duration? |
| Adaptation Engine | What should change because of new evidence? |
| Readiness | Is today's planned demand appropriate today? |
| Race Prediction | What performance does current ability support over this distance? |
| Real-Life Adaptation | What happens when execution differs from plan? |
| Safety | Should normal training continue? |
| Coaching Experience | What does the runner need to know? |

---

## END-TO-END FLOW

```
RUNNER HISTORY + GOAL
        ↓
INITIAL FITNESS BELIEF
        ↓
PLAN GENERATION
        ↓
WORKOUT PRESCRIPTION
        ↓
RUNNER TRAINS
        ↓
ACTIVITY INGESTION
        ↓
DATA QUALITY
        ↓
EVIDENCE INTERPRETATION
        ↓
EVIDENCE LEDGER
        ↓
FITNESS / DURABILITY UPDATE
        ↓
READINESS + TRAINING RESPONSE
        ↓
ADAPTATION DECISION
        ↓
UPDATED TRAINING
        ↓
RUNNER TRAINS AGAIN
```

Alongside that loop:

```
FITNESS + DURABILITY + RACE PREPARATION + COURSE/CONDITIONS
        ↓
RACE PREDICTION
        ↓
GOAL FEASIBILITY
```

And above everything: **SAFETY**.

The output of all of this complexity should still be something as simple as
"Tomorrow: 50 minutes easy. Keep it relaxed." or "You're ready for slightly
faster threshold work." or "Your speed is there. The next six weeks are
about building the durability to carry it through 26.2."

That is the standard. If the architecture gets more sophisticated while the
coaching gets simpler and more accurate, faff is moving in the right
direction. If the architecture gets more sophisticated and the coaching gets
harder to explain, something has probably gone wrong.
