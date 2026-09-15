# faff.run — Race tiering and season philosophy

**Product direction:** Race priority describes the job a race performs in the runner's season. It
does not determine whether the result is true, whether the effort was physiologically costly, or
whether the race is useful evidence.

## Why races exist in the product

A race can be:

- the main outcome a season is built to deliver;
- a secondary performance goal;
- a rehearsal for pacing, fueling, equipment, or race execution;
- a fitness calibration;
- a hard training stimulus with a start line;
- a social or enjoyable event; or
- some explicit combination of these.

The app should know the intended job before it changes the plan around the race. “Race” is an event
type, not a sufficient coaching instruction.

## One vocabulary problem to remove

The codebase has used A/B/C in two different ways:

1. **race priority:** A race, B race, C race; and
2. **outcome bands:** stretch, realistic, and resilient or bad-day outcomes.

Those are different concepts and should not share runner-facing labels. This brief reserves
**A/B/C for race priority only**. Outcome bands should use plain names such as **stretch,
expected, and resilient**. A “C race” must never be confused with a “C outcome.”

## The three race priorities

### A race — the season goal

An A race is the event the block is primarily designed to deliver.

- The plan progresses toward its specific demands.
- Other races and hard sessions are arranged to support it.
- It receives the full appropriate taper and race-specific preparation.
- Goal feasibility is monitored throughout the block.
- The runner's stated goal remains theirs; the app may project against it but cannot silently
  rewrite it.
- Race-day pacing, fueling, terrain, weather, and execution guidance receive the highest detail.
- The result receives full interpretation, with context and evidence quality considered.

A season should normally have one clear A race within a coherent block. Two nearby “A races” require
an explicit decision about which one owns the peak and how the second will be approached.

### B race — a secondary goal or purposeful tune-up

A B race matters, but it serves the larger season as well as its own result.

Possible jobs include:

- a genuine secondary performance goal;
- a shorter-distance fitness calibration;
- a race-execution rehearsal;
- a marathon fueling or equipment rehearsal;
- a supported hard effort that replaces a planned quality session; or
- a confidence-building checkpoint.

A B race may receive reduced training beforehand, but the amount depends on its job, distance,
placement, and the runner's recent load. It should not automatically receive an A-race taper or be
treated as an ordinary workout.

If raced hard, its physiological cost and recovery are real. The B label does not make an all-out
10K “controlled” after the fact.

### C race — an event inside training

A C race does not own the season and should not cause the plan to peak around it. It can still be
useful when it has a clear job:

- a controlled supported run;
- a hard-workout substitute;
- practice with crowds, logistics, hills, or equipment;
- an enjoyable event with no performance demand; or
- a lower-stakes execution rehearsal.

A C race normally has no time goal from the coach. The runner receives an effort or execution
instruction tied to the event's purpose.

The label does not erase what actually happens. If the runner races a C event all-out, the result
can become valid capacity evidence and the recovery cost must reflect the actual effort. The app
should not keep the low planning cost of a C race while claiming the high evidentiary value of a
maximal test.

## Is a C race a useful checkpoint?

Only when the checkpoint is defined before the event.

A real checkpoint names:

1. the question being tested;
2. the execution required to answer it;
3. the evidence the app will read;
4. the conditions that would make the result inconclusive; and
5. what decision will change afterward.

Examples:

- “Can the runner hold controlled marathon effort over a rolling course without late fade?”
- “Does race-morning fueling remain comfortable at event intensity?”
- “Is current 10K capacity ready to re-anchor threshold pace?”

Those are different tests. A controlled marathon-effort run cannot also serve as a maximal 10K
fitness calibration. If no future coaching decision depends on the result, calling it a checkpoint
adds ceremony without value.

## Planning cost and evidence value are separate

Race priority sets the event's **planned cost** to the season: taper, surrounding load, specificity,
and how much the calendar protects it.

The completed event's **evidence value** comes from what actually occurred:

- actual effort and execution;
- official or curated result authority;
- preparation relevance;
- course and weather;
- pacing control and late-race durability;
- data quality;
- illness, injury, depletion, or interruption; and
- whether the effort answered the question the event was meant to test.

An A race can produce weak or non-representative evidence. A C race can produce strong evidence.
Priority alone must never accept, reject, or weight the result.

## Season construction rules

1. Start with the A race or primary non-race performance goal.
2. Identify the adaptations needed to reach it.
3. Add B races only where they create useful evidence, rehearsal, or motivation without replacing
   more important specific work.
4. Add C races only when their purpose and effort fit the surrounding training.
5. Protect the A race from accumulated racing cost, not merely from calendar overlap.
6. Never use a tune-up race as a substitute for a different stimulus without proving equivalence.
7. Preserve the forward plan after every race. Recovery is a bridge back to the goal, not a reset
   into generic training.
8. Re-evaluate race purpose when the runner's fitness, goal, injury state, or season changes.

The app should show the runner why each race is present: goal, test, rehearsal, workout, or fun.
Internal A/B/C shorthand should not be the only explanation.

## Goal and pacing policy

- A runner-stated goal is not silently changed.
- A coach-set projection is clearly labelled, evidence-based, and editable.
- Goal pace never becomes evidence of current capacity.
- A-race guidance may include a goal, expected outcome, likely range, and contingency plan.
- B-race guidance follows the event's declared job. A performance B race can carry a time target; a
  rehearsal B race may be better framed by effort and execution.
- C-race guidance defaults to effort and purpose rather than a time target.
- Course, weather, and preparation can change execution guidance without rewriting the runner's
  underlying fitness.

## Post-race interpretation

Every completed race should answer separate questions rather than collapse into “met” or “missed”:

- Was the published target valid?
- How did performance compare with prepared capacity?
- Is the result valid fitness evidence?
- Is execution failure established?
- Should automatic fitness or plan adaptation occur?
- What recovery did the actual effort create?
- What did the season learn, and what changes next?

This protects the Santa Monica lesson: an unsupported target can be invalid while the result remains
valid evidence and the runner's performance remains within prepared capacity.

## Recovery policy

Recovery follows actual cost, not the letter printed beside the race.

Consider:

- distance and duration;
- actual intensity;
- taper or training load entering the event;
- symptoms and subjective recovery;
- muscle damage and terrain;
- weather and fueling;
- upcoming key training; and
- the runner's individual recovery history.

Use a graded re-entry near the edge of a recovery window. A week-level template does not prove a
day-level ban on quality, and an ambitious A-race build does not justify ignoring a genuinely costly
tune-up.

## Applying the philosophy to the Dodgers question

Dodgers can be either:

- a controlled C event that replaces a hard workout and preserves the following long run; or
- a real 10K checkpoint raced hard enough to calibrate performance.

It cannot honestly be both under the same execution plan. If controlled, its value is rehearsal,
terrain, logistics, and supported effort; it should not be treated as maximal 10K capacity evidence.
If used as a capacity checkpoint, the plan must accept the harder effort and adjudicate recovery and
the 17-mile run accordingly.

The programme still needs a specific coaching decision about the chosen job and execution. This
brief removes the conceptual ambiguity; it does not invent the exact Dodgers pace.

## Runner controls

The runner should be able to state or revise:

- the race's importance;
- its purpose;
- whether the intent is time, effort, rehearsal, or enjoyment;
- a personal goal; and
- whether circumstances changed the intended effort.

The app may recommend a tier or purpose and explain the season cost. A major reclassification that
changes the plan should be visible and require the runner's awareness.

## Acceptance criteria

The tiering system succeeds when:

- every planned race has a clear job;
- A/B/C priority never substitutes for actual evidence quality or recovery cost;
- no race receives contradictory “controlled” and maximal-calibration instructions;
- tune-ups support rather than hollow out A-race preparation;
- the app explains what it learned and what changes next;
- stated goals remain under runner control; and
- the plan continues coherently across races instead of rebuilding as isolated templates.

## Open decisions

- the maximum number and spacing of A races in different season shapes;
- the default taper cost for each B-race purpose and distance;
- whether runners see A/B/C labels at all or only plain-language race purposes;
- how a runner changes a race's purpose after registration; and
- the exact Dodgers purpose and execution plan.

