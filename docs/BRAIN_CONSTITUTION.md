# faff.run — Brain Constitution

**Locked 2026-08-31. This is THE canonical ownership reference — the
definitive answer to "who owns this question" for every coaching domain in
the app. Companion to, and the sharpest operational distillation of,
`docs/PRODUCT_COACHING_DOCTRINE.md`, `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md`,
`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`, and
`docs/ADAPTATION_PROGRESSION_DOCTRINE.md`. Where those documents explain WHY
and HOW, this one is the fast-reference OWNERSHIP TABLE and hard-rule set —
check this first when deciding where new logic belongs.**

## Purpose

The training brain is sophisticated enough now that the largest risk is no
longer missing intelligence — it's duplicated intelligence, multiple systems
answering the same question, contradictory outputs, hidden overrides,
feature-specific exceptions, overlapping scores, unnecessary abstractions,
new services created instead of fixing existing ones, "smart" logic leaking
into UI, systems changing things they don't own.

**One question. One owner. One canonical answer. Other systems consume that
answer. They do not independently recreate it.**

## 1. The brain at the highest level

```
RAW RUNNER DATA → EVIDENCE → RUNNER BELIEF → COACHING STRATEGY →
TRAINING PRESCRIPTION → RUNNER EXECUTION → ADAPTATION
```

Supporting systems modify interpretation where appropriate: DATA QUALITY,
ENVIRONMENT, READINESS, SAFETY.

Race prediction sits alongside the training loop:

```
RUNNER BELIEF + DURABILITY/PREPARATION + RACE CONTEXT → RACE OUTLOOK
```

Don't turn every box into five additional layers unless the code genuinely
requires it.

## 2. The core owners

### A. Activity Interpreter

**Owns: what actually happened during this activity?** Pause handling, bad
sample rejection, segmentation, identifying sustained effort changes,
distinguishing easy/steady/threshold-like/high-intensity/recovery/race-
specific work, comparing planned vs actual when prescription exists,
inferring structure when it doesn't, basic environmental context on
observations.

```
ActivityInterpretation { observed_segments, execution_summary, data_quality, contextual_factors }
```

Does NOT decide: current fitness, training paces, next week's workout, race
prediction, goal feasibility, whether the plan progresses.

*(Built tonight as `lib/evidence/activity-evidence.ts` — verify its scope
matches this ownership exactly as later work touches it.)*

### B. Evidence Engine

**Owns: what does this activity teach us?** Consumes the Activity
Interpreter. Determines which observations are admissible evidence, assigns
confidence/reliability, identifies what capacity the evidence informs,
records corroboration, maintains provenance, distinguishes strong vs weak
evidence, preserves uncertainty, creates evidence ledger entries.

```
Evidence { target: THRESHOLD, estimate, strength, confidence, provenance, context }
```

Does NOT decide: the runner's final threshold belief, training pace,
workout selection, plan progression.

**Doctrine: the Activity Interpreter describes the run. The Evidence Engine
describes what the run teaches us.**

### C. Runner Model

**Owns: what do we currently believe about this runner?** The canonical
source of fitness/capacity truth. Primary capacities: HIGH_INTENSITY,
THRESHOLD, DURABILITY. Each belief: estimate, confidence, provenance,
supporting evidence, last meaningful observation. Resolves conflicting
evidence, repeated evidence, stale evidence, confidence, historical priors,
fallbacks, direct vs inferred evidence.

Does NOT decide: today's workout, whether the runner is recovered, race
goal, training phase, race prediction, schedule changes.

**Hard rule: no other subsystem may maintain a competing fitness estimate.**
A feature that needs threshold capacity calls `getThresholdCapacity()`. It
does not calculate threshold itself.

*(Built tonight as `lib/training/capacity-resolver.ts`.)*

### D. Readiness / Current State

**Owns: what is appropriate for this runner today?** Deliberately separate
from fitness. Recent load, fatigue, soreness, illness, recovery, sleep,
acute environmental stress, proximity to recent races, recent demanding
workouts.

```
Readiness { state, confidence, constraints, recommended_modification }
```

State: NORMAL / CAUTION / REDUCED / RECOVERY. Does NOT change underlying
fitness. **Hard rule: tired ≠ less fit.**

*(Built tonight as `lib/training/runner-state.ts`.)*

### E. Safety

**Owns: is ordinary training logic allowed to proceed?** Sits above normal
optimization. Injury hard stops, illness hard stops, serious symptom
handling, return-to-running restrictions, escalation rules.

Outputs: NORMAL / CAUTION / MODIFY / STOP. Safety may override other
systems. Other systems may not override Safety. **SAFETY > TRAINING
OPTIMIZATION.**

### F. Coaching Thesis

**Owns: what are we currently trying to accomplish with this runner?** The
strategic bridge between fitness and planning. Current strengths, current
limiter, current priority, secondary priority, what's deliberately not being
emphasized, what evidence would change the strategy.

```
CoachingThesis {
  primary_limiter: DURABILITY
  priority: increase_long_run_demand
  secondary: maintain_threshold
  not_priority: additional_high_intensity
  reconsider_if: [threshold declines, long-run tolerance stalls, race evidence changes]
}
```

Should prevent the plan generator from behaving randomly. Does NOT calculate
fitness — consumes canonical Runner Model outputs. **Must never become a god
object** (§30) — it summarizes strategy, it doesn't independently calculate
every input (fitness, load, durability, pace, race prediction, goal
feasibility all stay owned elsewhere; Coaching Thesis only consumes them).

### G. Pace Prescription

**Owns: at what intensity should this runner train?** Consumes Runner Model
+ workout purpose + context. Easy/threshold/interval/steady/race-specific
intensity, confidence-aware fallback. **Hard rule: goal ≠ current training
capacity.** Does NOT decide: which workout happens, weekly volume, whether
the runner progresses, whether the goal is realistic.

*(Built tonight, shadow mode, as `lib/training/prescription-resolver.ts`.)*

### H. Plan Generator

**Owns: what training should this runner do and when?** Consumes Coaching
Thesis, Runner Model, readiness constraints, goal/race requirements,
training phase, available days, recent training, load history, adaptation
decisions. Weekly structure, workout selection/ordering, long-run placement,
recovery spacing, phase progression, specificity, taper. Does NOT calculate
threshold fitness, race prediction, readiness, evidence confidence,
adaptation eligibility — it USES those answers, never recreates them.

### I. Adaptation Engine

**Owns: should anything about the current training change?** One of the
most important boundaries in the whole system. Consumes Runner Model
changes + training execution + load tolerance + readiness + training phase
+ Coaching Thesis.

Decisions: PROGRESS / HOLD / REDUCE / RESTRUCTURE. Targets: PACE / DURATION
/ VOLUME / QUALITY_VOLUME / DENSITY / RECOVERY / SPECIFICITY / SCHEDULE.
Must state: what changed, why, how much, what evidence supports it.

**Correct flow:** Evidence → Runner Model updates → Adaptation notices
meaningful change → Adaptation proposes training response. **Never:**
"workout was fast → Adaptation invents a new threshold pace."

**§29 — Adaptation must never become a second coach.** It does not own
fitness, readiness, plan design, pace physiology, or safety. It coordinates
whether an existing coaching plan should change based on outputs from those
systems. Think: change controller, not god object.

*(In flight right now — build against this exact boundary.)*

### J. Race Prediction

**Owns: what could this runner realistically race right now?** Consumes
Runner Model, durability, race-specific preparation, recent volume,
long-run preparation, course, environment, target distance.

```
{ expected_result, likely_range, confidence, primary_limiter }
```

Does NOT define fitness — translates fitness + preparation into
distance-specific performance. **Race prediction is an output of the model,
not the model itself.**

### K. Goal System

**Owns: what does the runner want to accomplish?** Target race, target
time, priority, user-confirmed changes. Does NOT determine current fitness.
Does NOT automatically mutate from race prediction.

**Race Prediction may challenge the goal. Only explicit runner action can
change it.** *(This is the locked doctrine from `docs/PRODUCT_DECISIONS.md`'s
2026-08-31 goal-card entry — this Constitution restates it as a hard
ownership rule, not just a UI decision.)*

### L. Goal Feasibility

**Owns: how does the runner's goal compare with the current race outlook?**
Consumes Goal + Race Prediction. Result: COMFORTABLE / REALISTIC / AGGRESSIVE
/ UNLIKELY_CURRENTLY. Does NOT change the goal, fitness, or pace directly —
supplies context to the coaching strategy.

### M. Training Load

**Owns: how much training stress has recently been accumulated?**
Descriptive: weekly volume, quality volume, long-run exposure, recent
density, load change. Feeds Readiness, Adaptation, Plan Generation. **Must
not become a magical universal readiness or fitness score** — avoid "Load
Score = 71, therefore everything changes." Prefer underlying interpretable
information.

### N. Environmental Context

**Owns: what external conditions affect interpretation?** Temperature,
humidity, elevation, hills, altitude, wind. Modifies interpretation, does
NOT own fitness. Correct: `Activity + Environment → Evidence
interpretation`. Incorrect: `Heat Model → separate fitness estimate`.

### O. Workout Library

**Owns: what training structures are available?** Easy, recovery, steady,
threshold, cruise intervals, VO2 intervals, hills, long runs, progression
runs, race-specific long runs — each with purpose, structure, intended
stimulus, progression family, evidence opportunities. Does NOT decide which
workout the runner needs — the Plan Generator chooses from it.

### P. UI / Coaching Presentation

**Owns: how do we communicate the canonical coaching decision?** May
summarize, explain, prioritize, progressively disclose. May NOT
independently calculate fitness, training pace, readiness, race projection,
adaptation, goal feasibility, or workout classification. **UI displays
intelligence. UI does not create intelligence.**

## 3. The canonical flow

```
ACTIVITY DATA → Activity Interpreter → Evidence Engine → Evidence Ledger →
Runner Model → Coaching Thesis → Plan Generator → Pace Prescription
```

Adaptation observes changes around this loop (Runner Model, Execution,
Readiness, Load, Phase) → Adaptation → Plan Generator.

Race path: `Runner Model + Durability + Preparation + Race Context → Race
Prediction → Goal Feasibility`.

Safety overlays everything.

## 4. No side doors

There must be no path like: Activity → Plan Generator directly. Race Result
→ Pace Prescription directly. Goal Time → Fitness directly. Readiness →
Threshold Capacity directly. UI → calculate race prediction directly. Every
decision moves through its canonical owner.

## 5. One question, one resolver

`getThresholdCapacity()` — Runner Model. Today's threshold pace — Pace
Prescription. Should threshold pace change — Adaptation. What race time
does this imply — Race Prediction. Is that compatible with the goal — Goal
Feasibility.

Never `thresholdFromRace()` / `thresholdFromWorkout()` /
`thresholdFromVDOT()` / `thresholdForPlan()` / `thresholdForPrediction()`
all independently returning different truths. Those may exist internally
*as evidence methods*. The application-level answer comes from
`resolveThresholdCapacity()`, once.

## 6. Derivation vs authority

Many systems may derive evidence (a race, a workout, HR regression, VDOT can
all suggest threshold). Only one system has authority (the Runner Model
resolves the evidence). They produce THRESHOLD EVIDENCE. They do not
individually define THE RUNNER'S THRESHOLD.

## 7. No feature-specific overrides

Never `if marathonPlan: threshold = ...` inside Plan Generator, or `if
raceScreen: fitness = ...`, or `if userHasGoal: trainingPace =
goalPaceAdjusted`. These create alternate brains. All features consume
canonical brain outputs.

## 8. No "temporary" second truth

Avoid "we'll leave the old system running while the new one exists" unless
it's an explicit migration/shadow comparison. During migration: OLD →
shadow only, NEW → authority (or vice versa until switchover). Never
"sometimes old, sometimes new, depending on screen."

## 9. Anti-bloat rule: before creating any new system

The code agent must answer: what exact question does this answer? Who
currently answers it? Why can't the existing owner be extended? Would this
create another source of truth? Could this simply be another evidence
source / field / strategy inside an existing owner / output from an
existing resolver? If yes to the last question: **do not create a new
subsystem.**

## 10. Signals are not systems (the most important anti-bloat principle)

HR drift, temperature, cadence, RPE, race result, pace stability, long-run
duration, weekly mileage, sleep, power — none of these deserve their own
engine. They feed existing owners. `HR drift → durability evidence`. Never
`Decoupling Engine → Durability Modifier → Endurance Readiness Engine →
Marathon Correction Layer`. That's how bloat happens.

## 11. Scores require justification

Don't create a new score unless necessary for a decision that can't be made
cleanly from existing domain state. Training Score, Fitness Score, Readiness
Score, Durability Score, Race Score, Execution Score, Adaptation Score,
Confidence Score — the brain quickly becomes score soup. Prefer actual
domain statements: threshold capacity, durability confidence, recent load,
readiness constraint. If a score exists solely to combine six other scores,
question it aggressively.

## 12. No boolean explosion

Avoid `isFatigued` / `isImproving` / `isRaceReady` / `isOvertrained` /
`isHeatAdjusted` / `isThresholdReady` / `isProgressing` when these are
competing interpretations of richer state. Prefer typed domain decisions:
`AdaptationDecision { action: HOLD, target: THRESHOLD_PACE, reason:
INSUFFICIENT_CORROBORATION }` — much harder to contradict accidentally.

## 13. Don't build "smartness" in five places

If Plan Generator, Pace Engine, Workout Builder, UI, and the post-run screen
all have their own smart logic, nobody knows which one is the coach.
Instead: brain makes decision → features consume decision. Intelligence
belongs in domain owners.

## 14. Data quality modifies confidence, never creates alternate truth

Poor HR quality → HR-derived evidence confidence ↓. Never "switch to an
entirely different hidden training model." Poor GPS → lower pace-evidence
authority, same principle.

## 15. Contradiction prevention by type

**Goal contradiction** (goal changed, runner didn't approve) → reject.
**Fitness contradiction** (two screens show different threshold) →
architecture bug. **Pace contradiction** (plan says 6:50, watch says 7:05)
→ architecture bug. **Readiness contradiction** (readiness says REDUCED,
plan delivers a normal hard workout) → must be explicitly reconciled.
**Safety contradiction** (safety says STOP, plan says RUN) → forbidden.
**Race contradiction** (prediction says 3:35, progress screen says 3:22) →
single-source violation. **Coaching-strategy contradiction** (durability is
the limiter, plan keeps adding VO2 work without reason) → reject or require
explanation.

## 16. Final decision validator

Before a workout/recommendation reaches the runner, a lightweight validator
asks: does Safety allow this? Does Readiness allow this? Does the workout
support the Coaching Thesis? Are prescribed intensities from Pace
Prescription? Does weekly structure obey Plan Generator constraints? Does
this adaptation have a reason? Does this conflict with current goal policy?
Does another canonical system disagree? **This validator does not invent a
new decision — it detects invalid combinations. If a contradiction exists:
FAIL LOUDLY rather than silently choosing one.**

## 17. Do not resolve contradictions with priority order unless necessary

Bad: "fitness says X, plan says Y, adaptation says Z, use adaptation because
it has priority 3" — that hides the underlying problem (why were three
canonical answers produced at all?). Priority is legitimate for a true
hierarchy (Safety > normal plan). It should not paper over duplicate
ownership.

## 18. Explicit override hierarchy

1. SAFETY
2. ACUTE READINESS CONSTRAINT
3. ADAPTATION DECISION
4. PLAN STRATEGY
5. NORMAL PRESCRIPTION

**Note: Readiness does not redefine fitness. Safety does not redefine
fitness. They modify what training is appropriate, never the underlying
belief.**

## 19. Adaptation does not mutate history

Avoid destructive behavior where adapting a plan rewrites what faff
believed previously. Store: previous belief, new evidence, new belief,
adaptation resulting from the change. Preserves explainability and
debugging.

## 20. Raw observations stay immutable

Keep source data intact. Interpretations can improve, models can be
recomputed. Do not transform raw historical activities into permanently
baked coaching conclusions — the brain will evolve.

## 21. Every derived decision needs provenance

Should be answerable: "why is this workout 70 minutes?" → "goal requires
durability → Coaching Thesis prioritizes durability → recent 65-minute runs
absorbed well → Adaptation approved duration progression → Plan Generator
selected 70 minutes." Never just "because `calculateRunLength()` returned
70."

## 22. Every new feature consumes the brain, it doesn't extend it

A home-screen widget consumes Today's canonical workout — it does not
create a `WidgetWorkoutResolver`. Apple Watch consumes the canonical
workout prescription — it does not recalculate paces. A race screen
consumes Race Prediction + Goal + Goal Feasibility — no new race
intelligence needed.

## 23. Database schema is not domain ownership

Separate tables (`activities`, `races`, `plans`, `fitness`, `workouts`)
don't mean each gets its own intelligence layer. Domain ownership follows
coaching questions, not persistence structure.

## 24. Resist micro-services inside the monolith

A file called `heat-adjustment-engine.ts` doesn't automatically make the
architecture better. Prefer small pure helpers contained within the
appropriate owner: `EvidenceEngine.assessHeatContext() /
assessPaceReliability() / assessHrReliability()`, not three competing
engines.

## 25. Three levels of code are enough most of the time

`DOMAIN OWNER → HELPERS/STRATEGIES → DATA`. Be suspicious if a simple
coaching decision travels through ten abstraction layers.

## 26. Prefer deletion

When fixing architecture, ask "what can disappear?" before "what should we
add?" Every audit should explicitly report DELETE / MERGE / KEEP / REWRITE,
not just NEW COMPONENTS.

## 27. No new concept without product meaning

If someone introduces "Aerobic Resilience Index," they must explain: what
coaching decision does this enable that Durability does not? No clear
answer → do not create it.

## 28. The test for bloat

Every brain concept must pass all three: does it answer a distinct coaching
question? Does another concept already answer that question? Does its
existence materially improve a decision? If not: remove it.

## 29. Required ownership table

| Question | Canonical owner |
|---|---|
| What happened during the run? | Activity Interpreter |
| What did the run teach us? | Evidence Engine |
| What do we believe about fitness? | Runner Model |
| Is normal training appropriate today? | Readiness |
| Is training safe? | Safety |
| What currently matters most? | Coaching Thesis |
| How hard should this workout be? | Pace Prescription |
| What training should happen? | Plan Generator |
| Should training change? | Adaptation |
| What can they likely race? | Race Prediction |
| Is the stated goal realistic? | Goal Feasibility |
| What does the runner want? | Goal System |
| How do we tell them? | Coaching/UI |

**If a PR introduces a second answer to any row: reject it.**

## 30. Required PR questions for any brain-related change

What coaching question does this change? Who owns that question? Does this
add a new source of truth? What existing logic does this replace? What can
be deleted? What inputs does the owner consume? What output does it own?
What is it explicitly NOT allowed to do? What contradiction tests were
added? If the author can't answer clearly, the design isn't ready.

## 31. Required architectural tests

Change goal → fitness unchanged. Increase fatigue → fitness unchanged. Bad
race → no automatic total fitness overwrite. Strong workout → no automatic
giant progression. Race prediction changes → goal unchanged. Pace capacity
changes → all workout surfaces receive the same canonical pace. Safety
STOP → no runnable workout emitted. Readiness REDUCED → plan output
respects the constraint. Coaching Thesis says durability → generated week
cannot become unjustifiably VO2-dominant.

## 32. The brain fails honestly

UNKNOWN / LOW_CONFIDENCE / FALLBACK are legitimate states. Don't add
complexity solely to avoid admitting uncertainty — a simple fallback beats
fake intelligence.

## 33. Keep the Runner Model small

Don't add a new capacity axis every time a new physiological concept
surfaces. For now: High-Intensity Capacity, Threshold, Durability, plus
Current State should explain most coaching decisions. Additional
physiological info exists as evidence beneath these. Only promote a new
top-level dimension if repeated real coaching decisions genuinely can't be
handled without it.

## 34. The ultimate anti-bloat rule

Every time the app learns something new, ask: **does this require a new
belief, or is it merely new evidence about an existing belief?** Most of
the time it's new evidence. That single distinction prevents a tremendous
amount of architecture creep.

## 35. Simple mental model

What happened? → Activity Interpreter. What does it mean? → Evidence
Engine. What do we believe? → Runner Model. What matters now? → Coaching
Thesis + Readiness. What should we do? → Plan + Pace Prescription. Should
that change? → Adaptation. What could they race? → Race Prediction. Is
that their goal? → Goal System / Goal Feasibility. Is it safe? → Safety. If
the architecture becomes impossible to explain using this diagram, it's
probably getting too complicated.

---

## FINAL CONSTITUTION

One coaching question has one canonical owner. Systems consume answers;
they do not recreate them. Signals are evidence, not new engines. Fitness,
readiness, goal and race prediction are separate concepts. Adaptation
changes training; it does not secretly become the fitness model. The Plan
Generator chooses training; it does not invent physiology. Pace Prescription
chooses intensity; it does not choose the workout. The Evidence Engine
interprets evidence; it does not coach the week. The Runner Model owns what
we believe. The Coaching Thesis owns what currently matters. Safety may
override training, but does not redefine fitness. UI never becomes a second
brain. New evidence should usually enrich an existing belief rather than
create a new concept. Before adding code, look for code to remove. If two
systems can produce different answers to the same coaching question, the
architecture is wrong. When uncertainty exists, represent uncertainty
instead of manufacturing complexity.

**faff should have one brain, not a committee.**
