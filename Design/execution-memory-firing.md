# Execution, memory and coach firing

**Author: David. Locked 2026-08-17. Canonical.**

Three systems that only work together:

- **Execution** answers: *what work actually happened?*
- **Memory** answers: *what from that history matters later?*
- **Firing policy** answers: *when is any of it worth saying out loud?*

> The app should not confuse literal compliance with useful training, or useful
> data with something worth mentioning.

---

# Part 1 · What counts as executing the plan

**The plan prescribes a training stimulus, not a file format.** Execution is
judged on two separate dimensions, and they are not the same thing:

- **Structural compliance** — did the athlete perform the workout as written?
- **Stimulus equivalence** — did they create substantially the intended effect?

A workout can be structurally different and physiologically equivalent. It can
also look complete on paper while missing the intended stimulus entirely.

```
structural_compliance = partial
stimulus_completion   = high
```

That is more useful than one boolean called `completed`.

## Execution states

Every planned session resolves to one of:

```
AS_PLANNED · EQUIVALENT · PARTIAL_PRODUCTIVE · PARTIAL_FAILED
REPLACED · MISSED · EXTRA
```

Then, separately: `stimulus_completion`, `execution_quality`, `evidence_value`.

## The five cases

### Same effort, different shape

Planned 5 × 1 mile threshold; ran 3 × 2 miles because the track was closed.

```
execution_state     = EQUIVALENT
stimulus_completion = full
```

Assuming similar total work duration, similar physiological intensity, recovery
structure not radically altered, and no major overreach. **The athlete did not
fail the plan. They solved a logistics problem.**

It counts as evidence — potentially very good evidence. But **grade what was
actually performed.** Do not compare 3 × 2 miles against the rep-level pace
window for 5 × 1. Reconstruct `actual_work_blocks`, `actual_work_duration`,
`actual_intensity`, `actual_recovery` and compare those to the intended
stimulus, not to the original shape.

> **Equivalent work earns equivalent credit.**

### Cut short because the athlete was cooked

Three reps of five, then pace collapsed and RPE spiked.

```
execution_state     = PARTIAL_FAILED
stimulus_completion = 55–70%
```

Three quality reps still created stimulus. But the progression system must
separate *useful training occurred* from *the athlete demonstrated readiness for
more stress*. Stopping cooked is evidence the prescription may already be at or
above available capacity that day.

```
training_credit  = yes
progression_credit = low/none
fitness_evidence = context-dependent
```

Once, after bad sleep or heat: mostly noise. Three quality sessions running:
signal.

> Do not treat 60% completed as zero. Do not reward it as though it
> demonstrated capacity for 110%.

### Session moved two days

The session itself can still be fully executed: `AS_PLANNED`, full stimulus.
Movement has a *separate* consequence — back-to-back quality days, reduced
long-run recovery, extra fatigue, missed downstream work — accounted for
separately.

Moving a workout does **not** reduce its evidence value. The important datum is
not "athlete disobeyed Tuesday"; it is "threshold stimulus occurred Thursday,
changing the spacing before Saturday's long run."

> **Calendar adherence and training execution are separate things.**

### Session replaced by a race

`REPLACED`, not a miss. The race is evaluated independently and may provide
better fitness evidence than the workout it replaced — while costing more
recovery.

```
fitness_evidence = high
training_stress  = higher_than_planned
recovery_cost    = higher_than_planned
```

Adjust downstream training rather than marking Saturday green.

> **Replacement does not mean equivalence.**

### Unplanned extra run

`EXTRA` — never bonus compliance. Then assess what it actually did: an easy
30-minute jog is small effect and low risk; an unplanned hard 8 miles is
meaningful effect, meaningful recovery cost, high schedule impact.

It does not automatically earn progression. **More work is not evidence that
more work was appropriate.** The adaptation model asks whether the athlete
absorbed it without degrading subsequent training — and only retrospectively
might it contribute evidence that capacity is higher than thought.

> **Extra training is data, not achievement.**

## The architectural fix

Every planned workout carries an **intended stimulus** description separate from
its syntax:

```
workout_type: threshold
target_work_duration: 30 min
target_intensity: threshold
acceptable_intensity_band: X
recovery_intent: incomplete
primary_adaptation: lactate_threshold
secondary_adaptation: durability
```

The performed workout is translated into the same schema, and the engine
compares `planned_stimulus` against `actual_stimulus` — never `planned_reps`
against `actual_reps`.

## Evidence value is separate from completion

- Fully executed, low evidence — a routine easy run.
- Fully executed, high evidence — a controlled benchmark workout.
- **Partially executed, high evidence** — the athlete fails badly at a pace
  previously considered established. Extremely informative.
- Structurally different, high evidence — an equivalent session in another shape.

Maintain `execution_credit`, `adaptation_evidence`, `fitness_evidence` and
`risk_evidence` separately. **No single `completed = true` may control all four.**

---

# Part 2 · Memory

> **The database remembers everything. The coach remembers selectively.**

Coach memory exists to improve future decisions or make coaching feel
continuous. It is not a scrapbook. The test:

> Will remembering this change what the coach does, says, or understands later?

If not, leave it as historical data.

## What earns memory

- **Durable preferences** — long runs on Saturday; poor workouts after travel;
  prefers effort targets to rigid pace alerts. Relevant for months.
- **Meaningful patterns** — easy runs drift fast when fresh; threshold falls
  apart after 30 minutes; handles mileage well but not two quality days close
  together. **Patterns are far more valuable than isolated events, and memory
  should generally require repeated evidence before forming.**
- **Physiological history** — previous bone stress injury; recurring calf issue
  at speed; historically tolerates 45–50 mpw. Directly affects prescription.
- **Goal history** — the original 1:30 HM, revised to 1:34 after a missed
  block. Useful for understanding trajectory. Do not constantly remind the
  athlete of abandoned goals.
- **Milestones** — first 40-mile week absorbed; first 16-mile long run; first
  30 continuous minutes at threshold. **Storing is not speaking.**
- **Significant races** — PRs, breakthroughs, collapses, first marathon, goal
  races. Again: memory ≠ announcement.

## What does not

Every completed easy run · every good sleep score · every missed single workout
· random pace fluctuation · soreness that resolved immediately · every
compliment already given · one-off behaviour without consequence.

Those belong in the database. **Memory must stay sparse enough to stay
meaningful.**

## When memory is spoken back

Only when it materially improves the current moment.

> You've had this pattern before: the first workout after travel usually feels
> flat. I'm not treating today's result as a fitness change yet.

> Forty miles isn't new territory anymore. You've handled this range for three
> straight weeks, so the progression is intentional.

The first explains a decision; the second establishes earned confidence. Against:

> Remember when you ran your first 16-miler eight weeks ago?

**Avoid nostalgia without function.**

## PRs

A PR enters the evidence model. The coach does not shout `NEW PR!!!` — other
surfaces display records. The coach mentions it only when its meaning matters:

> That performance changes the fitness model. Your training paces are moving up.

> That's not just a good race. It's enough evidence to re-anchor your fitness.

**The coach interprets. It does not act like a trophy notification.**

## Decay

| Lifespan | Contents |
|---|---|
| **Permanent** | injury history, stable preferences, major races, long-running patterns |
| **Medium** | current response to mileage, current pacing tendency, recent recovery pattern, current limiter — expire or revalidate over weeks |
| **Short** | bad sleep, minor soreness, travel fatigue, one unusual workout — days |

**Do not let temporary state become permanent identity.** "Athlete struggles in
heat" after one hot run is wrong; "has repeatedly shown disproportionate decline
in high heat" is earned. Only promote patterns when they become patterns.

## What memory must never do

Shame the athlete · weaponise past misses · raise a bad race simply because it
can · surprise them with irrelevant personal detail · turn transient weakness
into identity · use injury history to catastrophise every symptom · repeat
encouragement from months ago · create the feeling that the app is keeping score
emotionally.

> Bad: *You also skipped this workout three months ago.*
> Good: *Friday workouts have been missed repeatedly. Moving this session may
> fit your actual week better.*

**Use history to solve problems, not to prosecute the athlete.**

---

# Part 3 · When the coach speaks

> **Every coaching message spends attention. Attention is finite.**

The coach speaks when silence would leave the athlete meaningfully less
informed, less prepared, or more likely to make a bad training decision.
Everything else is optional.

## Four levels

**INTERRUPT** — unrequested, and timing matters enough to intrude. Rare.
Qualifying: safety or injury; a material workout change before execution;
significant weather intervention; an important schedule conflict; genuinely
time-sensitive race execution. **The threshold is high.**

**SURFACE** — the athlete already opened the relevant screen. Most coaching
belongs here.

> You ran the easy miles too hard again. No damage today, but that's the second
> time this week.

> I've increased threshold duration but kept pace steady because you're
> absorbing the work well.

**AVAILABLE** — useful, not worth volunteering. Detailed HR trend, full limiter
analysis, why threshold is prescribed, historical comparison, load breakdown,
race equivalency. Behind *"Why this workout?"*, *"View analysis"*, *"Goal
trajectory"*.

**SILENT** — the most common response to normal training. Easy run completed
normally; no meaningful change; recovery normal; plan continues. There is no
requirement for *"Nice work."* **The app should be comfortable doing nothing.
That makes future messages credible.**

## The firing test

Did something change? If no — probably silence. Does the athlete need to know?
If no — store it. Does knowing *now* change what they should do? If yes —
potentially interrupt. Is it useful only because they are already looking?
Surface it. Is it mostly explanatory depth? Make it available.

## No duplicate coaching

One insight must not fire across every surface. Easy run too fast should not
buzz the watch, warn post-run, push a notification, appear in the evening
summary *and* return in the weekly review.

Instead: during the run, only if drift persists — `BACK IT DOWN`. Post-run, only
if the pattern matters. Weekly, only if it became a pattern: *"Three easy runs
drifted above target this week. That's now worth correcting."*

**One event escalates through the system only if repetition increases its
importance.**

## Episode suppression

Once delivered, suppress equivalent messages until something materially changes
— behaviour improves, behaviour worsens, the pattern crosses a new threshold, or
enough time passes that a reminder becomes useful.

## Positive messages need the same threshold

Do not lower the bar because a message is nice.

> Bad: *Great consistency!* after four normal days.
> Good: *You've now absorbed four straight weeks above your previous mileage
> ceiling. That's enough evidence to move the baseline.*

Praise when something means something — not because the system wants engagement.

---

# The pipeline

```
RAW ACTIVITY → EXECUTION INTERPRETATION → STIMULUS MATCH
→ EVIDENCE EXTRACTION → MEMORY CANDIDATE → COACH SIGNIFICANCE → FIRING POLICY
```

```
execution: { state: EQUIVALENT, stimulus_completion: 0.96 }
evidence:  { adaptation: positive, fitness: moderate, risk: none }
memory:    { create: false }
coach:     { firing: SURFACE, reason: shape changed but stimulus preserved }
```

```
execution: { state: PARTIAL_FAILED, stimulus_completion: 0.61 }
evidence:  { adaptation: negative, fitness: low_confidence, fatigue: meaningful }
memory:    { create: false, pattern_counter: threshold_failure +1 }
coach:     { firing: SURFACE }
```

On the third repeated failure:

```
memory: { create: true, pattern: threshold durability issue }
coach:  { firing: SURFACE, importance: high }
plan:   MODIFY
```

---

# Non-negotiable rules

1. Completion is not binary.
2. Judge the intended stimulus, not only workout syntax.
3. Equivalent work earns legitimate execution credit.
4. Partial work can be useful without earning progression.
5. Evidence value is separate from execution credit.
6. Schedule adherence is separate from physiological execution.
7. Replacement sessions must be interpreted, not simply marked complete.
8. Extra work is data, not bonus credit.
9. The database can remember everything; coach memory must remain selective.
10. Memory should improve future coaching, not create nostalgia or guilt.
11. Normal successful training should often produce no coach message.
12. Interruptions require a materially higher threshold than in-app coaching.
13. Repetition should increase significance, not message frequency.
14. Positive observations must earn airtime too.
15. Silence is not missing behaviour. Silence is successful filtering.

**Product principle.** The app should understand what the athlete actually did,
remember only the parts that matter later, and speak only when saying something
improves the next decision. That is the difference between tracking behaviour
and understanding training.

---

# Conformance · where the codebase stood when this was locked

## Execution

| Item | State |
|---|---|
| Seven execution states | **ABSENT.** Seven independent predicates answer "was it done", using four different distance thresholds (none, ≥1.0 mi, ≥0.8×, ≥max(1, 0.6×), 0.7–1.3×). A 6 mi run on an 8 mi tempo day is simultaneously done and missed depending which surface you read. |
| `stimulus_completion` | **ABSENT.** Nothing measures dose against intent. |
| Intended-stimulus schema on the plan | **PARTIAL.** `workout_spec` carries structure, and the `progression` block now carries reps / duration / recovery / pace / zone — the raw material. There is no `primary_adaptation` or `acceptable_intensity_band`. |
| Grading the shape actually performed | **VIOLATION.** `judgeTestPointExecution` grades against the PLANNED work window. Rule: do not compare 3 × 2 mi to the rep window for 5 × 1. |
| Partial ≠ zero | **VIOLATION.** `goal-projection.ts:984` *abstains* on a cut-short session, so it is dropped entirely rather than recorded as partial. 60% completed reads as no evidence. |
| Moved sessions | **CORRECT.** Reschedule updates `date_iso` and stamps `original_date_iso`; the adaptation loader follows the moved day. |
| `EXTRA` is not credit | **CORRECT.** The consistency dimension penalises overshoot in both directions, and today's fix stopped a volume-overshoot shave from counting as "not absorbing". |
| Evidence split four ways | **ABSENT.** One `completed` boolean feeds everything. |
| The device already knows | **DISCARDED.** The watch computes a per-phase verdict (`hit`/`drifted`/`missed`/`incomplete`) against the server's own tolerance, plus `timeInToleranceSec` and a run-level `status` (`completed`/`partial`/`abandoned`). `status` is declared at the endpoint and read nowhere. |

**The sharpest conflict is with work shipped the same day.** The adaptation
model's execution gate — *you cannot earn more stress by not doing the work* —
counts a quality day as done if a run exists on that date, and cannot tell
`EQUIVALENT` from `MISSED`. Rule 4 refines it precisely: partial work earns
training credit and not progression credit, which is a distinction the current
gate collapses into one band cap.

## Memory

`lib/coach/coach-log.ts` exists and records. **There is no promotion rule, no
pattern counter, no decay, and no separation between storing and speaking.**
Every item in the "what earns memory" list is currently either absent or
indistinguishable from ordinary history.

## Firing

| Item | State |
|---|---|
| Four levels | **ABSENT as a policy.** Individual detectors decide for themselves. |
| INTERRUPT threshold | **ALIGNED by accident.** Notifications were cut to one category — "tomorrow's session changed, here's why" — which is exactly a qualifying interrupt. |
| Episode suppression | **PARTIAL.** `easy-discipline` implements it properly: speaks once when a pattern establishes, once when it resolves, never between. It is the reference implementation and the only one. |
| Silence as a designed state | **ALIGNED.** Already locked in the voice brief. |
| No duplicate coaching | **UNVERIFIED.** No mechanism prevents one insight firing on the watch, the recap, the evening summary and the weekly review. |
| Positive messages earning airtime | **VIOLATION.** The recap congratulated a runner for leaving the threshold band until today. |
