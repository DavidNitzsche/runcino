# Plan-generation evidence coverage — filed for later

**Status: NOT started. Filed by David 2026-08-31, explicitly deferred — "file this
away for later steps but its very important." Do not build until picked up
deliberately.**

## The core idea

Everything built tonight (the fitness-vector rearchitecture — speed/threshold/
durability anchors, evidence-first pace readers, the durability anchor) answers
"can we infer fitness from whatever runs happen to occur?" This brief is the next
layer: **the plan generator itself should deliberately create clean opportunities
to observe each anchor, not just hope normal training produces readable evidence.**

Concretely diagnosed from tonight's own findings: the threshold-pace reader found
only 11 labeled tempo/threshold sessions in 120 days — verified as roughly accurate,
not a data bug, but on the light side for a full marathon build. That's not a bug
to fix in the reader; it's a signal the PLAN never deliberately ensured a steady
cadence of clean, classifiable evidence. This is that fix, one layer up.

## The concrete architecture proposed

### 1. A formalized workout inventory, one purpose + one evidence mapping per type

Easy/recovery → weak evidence, mostly load/tolerance. Aerobic steady, long easy,
long progression, long w/ steady blocks, long w/ race-specific blocks → increasing
durability evidence strength. Continuous tempo, cruise intervals → strong threshold
evidence. Long intervals → threshold + some high-intensity. VO2 intervals, short
reps/strides → high-intensity evidence, strong to weak respectively. Hill reps →
training stimulus, weak pace inference. Time trial, race → strongest evidence,
context-adjusted.

### 2. An evidence cadence target, not a weekly test

Rough proposed rhythm for a 4-6 day/week runner: high-intensity — useful
observation every 2-4 weeks; threshold — every 1-2 weeks (easiest to keep fresh,
tempo/cruise work belongs in most plans anyway); durability — every 2-3 weeks,
increasing in specificity as race day approaches (rotate easy long → progression →
steady-block → race-specific, not identical long runs every week).

### 3. Workout purpose and evidence purpose stay SEPARATE fields

```
Workout {
  training_goal
  structure
  expected_stimulus
  evidence_opportunities[]
}
```

An easy 50-minute run: training purpose aerobic development, evidence
opportunity none by default — and that's healthy, not a gap. The engine should
not feel obligated to extract a fitness update from every run.

### 4. Some workouts should deliberately be "clean" for calibration

Not every threshold session needs to be a bespoke geometry (8min/6min/3min/9min/
hills/float). Periodically prescribe standardized, boring-but-legible sessions
(3×10min controlled threshold; 20-30min continuous tempo; 5×1K; a controlled
progression long run) specifically because they're easy to compare over time —
this is what actually solves the unlabeled/messy-data problem David raised
tonight, structurally, rather than requiring ever-cleverer inference on ever-
weirder workout shapes.

### 5. The doctrine to lock alongside this — David's own words, verbatim

> "Never prescribe a workout solely because the model wants data when another
> workout would produce better training. Prefer workouts that accomplish both...
> When multiple workouts provide equally appropriate training stimulus, prefer
> the workout that resolves the greatest evidence uncertainty. Never compromise
> the training program merely to feed the model. Do not force every run to
> produce fitness information. Some runs should simply be training."

Training wins. Evidence only breaks ties between otherwise-equally-valid choices.
David flagged this specific line as possibly the most important rule in the
whole rework — record it as such when this is picked up.

### 6. Evidence debt tracking — the actual mechanism to build

```
EvidenceCoverage {
  high_intensity { last_strong_observation, confidence, next_useful_window }
  threshold      { last_strong_observation, confidence, next_useful_window }
  durability     { last_strong_observation, confidence, next_useful_window }
}
```

Consulted only as a tie-breaker when the coach logic already has multiple
physiologically-valid session choices for a given slot — never as a reason to
insert a workout the training plan didn't already call for.

### 7. Evidence OPPORTUNITY vs evidence OBSERVATION — a distinct pair

The plan, at authoring time, can mark a workout as carrying an evidence
opportunity ("this 25-min tempo could tell us about threshold"). Whether it
actually DOES depends on execution — HR sensor dropout, traffic stops, wrong
terrain can turn a planned clean observation into a low-reliability or refused
one after the fact. The opportunity is a property of the plan; the observation
is a property of what happened. Don't conflate them.

### 8. Workout category ≠ anchor assignment (already true of tonight's work — reinforces it)

Runna itself uses "tempo"/"interval" as structural labels, not physiological
zones — both can train threshold depending on rep duration/intensity. Same
principle tonight's readers already follow (classify actual effort → determine
evidence → route to the right anchor, never `if workout.type == INTERVAL`).
A 6×1mile session could be mostly threshold evidence; a 12×400m session could be
mostly high-intensity; a progression long run could carry both threshold and
durability evidence depending on how it was actually run. Structure describes
intent; execution describes what was demonstrated.

## Where this sits relative to tonight's work

Tonight's work (still landing) builds the INFERENCE side: given whatever runs
occurred, read fitness honestly from them. This brief is the GENERATION side:
make sure the plan deliberately produces enough of the right kind of runs in the
first place. They compose — this doesn't change or block anything currently in
flight, it's the natural next layer once the anchors are actually wired into the
plan engine and proven against real data.

## Explicitly not started

No code, no design doc beyond this file, no agent dispatched. Pick this up
deliberately once the current wiring phase (anchors → plan engine → regenerated,
verified live plan) is confirmed working end to end.
