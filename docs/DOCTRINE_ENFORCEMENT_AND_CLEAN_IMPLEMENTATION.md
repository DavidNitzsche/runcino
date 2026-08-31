# faff.run — Doctrine Enforcement & Clean Implementation Brief

**Locked 2026-08-31. Directed primarily at whoever (human or agent) implements
the fitness-vector rework — David's own framing: "a set of rules for you
mostly." Companion to `docs/PRODUCT_COACHING_DOCTRINE.md` (what faff believes)
and `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` (how each system behaves). This
document is HOW TO BUILD IT so contradictory logic can't re-enter through
legacy code, duplicated calculations, fallback paths, one-off fixes,
convenience helpers, feature-specific overrides, background agents, future
contributors, UI reinterpretation, or undocumented assumptions.**

The goal is not merely to build the new architecture. The goal is to make it
structurally difficult to violate it. One coherent source of truth per
coaching decision. No subsystem quietly invents its own answer.

---

## 1. Turn doctrine into hard ownership boundaries

Every major coaching question has exactly one owning service. No two services
independently answer the same question.

- **Runner Model** owns "what do we currently believe about the runner's
  underlying capacity?" — returns high-intensity capacity, threshold
  capacity, durability, confidence, evidence provenance. Nothing else may
  independently calculate "current fitness."
- **Evidence Engine** owns "what did this completed activity demonstrate?" —
  returns evidence observations. Does not prescribe paces, change plans, or
  decide race predictions.
- **Pace Prescription** owns "given current capacity and workout purpose,
  what intensity should be prescribed?" — nothing else calculates training
  pace targets.
- **Readiness / State** owns "is the planned demand appropriate today?" — may
  modify execution, must not silently rewrite underlying fitness.
- **Plan Generator** owns "what training should happen and when?" — consumes
  capacity and state, does not calculate fitness independently.
- **Adaptation Engine** owns "what should change in response to new
  evidence?" — proposes changes, does not independently reinterpret raw
  activity data.
- **Race Prediction** owns "what race performance does current evidence
  support?" — no other service exposes a separate race prediction.
- **Safety** owns "should normal training continue?" — may override other
  systems; no other system may override safety.

## 2. One question, one resolver

For every important derived value, one canonical resolver:
`resolveThresholdCapacity()`, `resolveHighIntensityCapacity()`,
`resolveDurability()`, `resolveEasyPrescription()`,
`resolveThresholdPrescription()`, `resolveRacePrediction()`,
`resolveCurrentState()`. No feature contains its own version. If a value has
multiple implementations, doctrine is already compromised.

## 3. Ban derived fitness math outside the ownership layer

Do not merely document that VDOT is no longer central — prevent other code
from using it as central fitness. Pure conversion utilities
(`convertRacePerformanceToVDOT`, `convertVDOTToEquivalentPace`) are allowed to
exist. `const threshold = vdotToThreshold(user.vdot)` inside arbitrary plan
code is not. Only the canonical resolver decides when VDOT is allowed to
matter, and may use it internally when direct evidence is insufficient — that
difference is critical.

## 4. Make legacy paths impossible to call by accident

No `// legacy — don't use` comments sitting next to new code — someone will
use it. Deprecated logic is removed, made private, renamed clearly, blocked
by type/interface boundaries, or deleted after migration. If old VDOT-first
resolution must temporarily remain, place it behind one explicit
`LegacyFitnessFallback` adapter that only the new resolver may call — no
feature code imports it directly. Delete once migration completes.

## 5. Use types to enforce doctrine

No loose numbers (`pace: 405`, `fitness: 52.7`, `confidence: 0.8`) passed
around meaninglessly six functions later. Strongly typed domain objects:
`ThresholdCapacityEstimate`, `HighIntensityCapacityEstimate`,
`DurabilityEstimate`, `RacePrediction`, `WorkoutPrescription`,
`ReadinessState`, `EvidenceObservation` — each carrying `pace`, `confidence`,
`uncertainty`, `evidence_ids`, `resolved_at`, `source_mode`. This makes it
structurally harder to accidentally use a race-prediction pace as a threshold
pace, or a goal pace as current capacity.

## 6. Goal data must be physically separated from fitness data

Enforce "goal never defines current fitness" structurally, not by
convention. `RunnerCapacity` and `RunnerGoal` are separate inputs, never one
generic "runner metrics" object every resolver receives. Most fitness
resolvers shouldn't receive the goal at all —
`resolveThresholdCapacity(evidence)` should not even have access to
`goalRaceTime`. If the service cannot see the goal, it cannot accidentally
train toward it.

## 7. State must not mutate capacity

Never `currentFitness = baseFitness * fatiguePenalty` — that collapses
fitness and state. Instead: `capacity = resolveCapacity(...)`, `state =
resolveCurrentState(...)`, `prescription = resolvePrescription({capacity,
state, workoutPurpose})`. State can modify today's demand. It cannot
overwrite the stored capacity estimate.

## 8. Raw activities should never directly change the plan

Explicit pipeline: raw activity → data quality → evidence classification →
evidence observation → evidence ledger → capacity resolver → adaptation
decision → proposed plan change. Never `if run.pace < target: increase plan
pace` anywhere in the system — that's exactly how contradictory behavior
reappears. Every adaptation passes through the same interpretation chain.

## 9. Every adaptation needs a reason object

Never return just `new_threshold_pace = 6:42`. Return `AdaptationProposal
{type, target, previous, proposed, confidence, supporting_evidence,
reason_codes, explanation}` — auditability, UI explanation, debugging,
reviewability, tests, and it makes silent behavior harder.

## 10. Doctrine rules as machine-checkable invariants

Some doctrine is important enough to become automated assertions: goal
isolation (fitness resolver has no goal input), adaptation proposal (any
meaningful fitness change produces a proposal rather than directly updating
targets), fitness/state separation (readiness cannot persistently modify
capacity anchors), evidence provenance (every non-fallback capacity estimate
contains supporting evidence IDs), race-prediction separation (capacity
resolution may not consume race prediction), no single-run overwrite (one
ordinary workout cannot replace a high-confidence anchor without an explicit
exceptional-evidence path). These become tests.

## 11. A doctrine test suite — not just unit tests

Tests designed to catch philosophical violations: **Goal Poisoning** (goal
1:25 over demonstrated 1:40 HM fitness must not move training pace). **Bad
Race** (one bad hilly race against repeated strong threshold/long-run
evidence must not collapse threshold capacity). **Hero Workout** (one
exceptional session makes evidence more optimistic, does not immediately jump
a high-confidence anchor absent exceptional-evidence criteria). **Stale
Evidence** (six weeks no threshold evidence → confidence declines, estimate
does not mechanically slow). **Fatigue** (high recent load can reduce today's
workout, must not change underlying capacity). **Goal Change** (editing a
stated goal changes feasibility, not current fitness). **Easy Run** (briefly
exceeding the easy ceiling downhill is not a compliance failure — overall
effort determines interpretation). **Modified Workout** (achieved stimulus
evaluated, not workout geometry).

## 12. Historical replay as a first-class test tool

For any runner, reconstruct "what would we have believed on this date using
only information available then?" — run the entire pipeline. Detects
future-data leakage, unstable estimates, accidental legacy fallbacks,
over/underreaction. Store snapshots (date, estimate, confidence) and inspect
which evidence caused each move.

## 13. Golden runners

Fixture set of representative histories, all must behave sanely on every
architecture change — if a change makes one behave absurdly, it does not
merge: **A — new runner** (little history, needs conservative fallback). **B
— fast 5K, weak durability** (should not receive aggressive marathon
prediction). **C — strong marathoner, modest speed** (should not be
underestimated for weaker short-distance speed). **D — inconsistent training**
(fitness may stay decent while readiness/load changes frequently). **E —
returning from injury** (fitness uncertainty rises, return-to-run controls
prescription). **F — aggressive goal** (goal does not poison current
training). **G — no HR data** (system still works). **H — bad HR data**
(rejected/downweighted without collapsing the coaching model).

## 14. No feature-specific fitness overrides

Never `// watch workouts need slightly different threshold pace`, `// race
screen uses Garmin estimate because it looks better`, `// coach card uses
goal pace to make messaging more motivating`. All surfaces consume canonical
outputs. Different interfaces may display them differently. They may not
calculate alternate truths.

## 15. UI must not reinterpret backend truth

The UI presents decisions, it does not create them. Never `if prediction <
goal: status = "on track"` inside a frontend component. Backend returns
`GoalAssessment {status, expected, gap, confidence, explanation}`; UI renders
it. Keep coaching logic out of presentation code.

## 16. Centralize fallback policy

One ordered fallback strategy per capacity, e.g. threshold: (1) strong direct
threshold evidence, (2) corroborated inferred threshold evidence, (3) recent
race-derived estimate, (4) VDOT-derived estimate, (5) onboarding prior. No
individual feature invents an alternate fallback order — the policy belongs
inside the owning resolver.

## 17. Fallbacks must identify themselves

Every resolved estimate carries `source_mode: DIRECT | INFERRED |
RACE_DERIVED | VDOT_FALLBACK | USER_PRIOR | POPULATION_PRIOR`. A direct
threshold estimate with four supporting workouts is not equivalent to a guess
derived from a self-reported 10K — downstream systems need to know the
difference.

## 18. Environmental normalization is a supporting layer, not an alternate engine

Weather/elevation corrections answer "how should we interpret this
observation?" — not "what is the runner's fitness?" Architecture: raw
performance + environmental context → normalized evidence interpretation,
then normal evidence processing continues. No separate "heat fitness" or
"hill fitness" resolver bypasses the evidence engine.

## 19. Safety gets an explicit override channel

`SafetyDecision: NORMAL | CAUTION | MODIFY | STOP`. The plan generator and
workout execution layer must respect it. No downstream service can undo
`STOP` because race day is close or plan adherence is low.

## 20. Feature flags for major architectural migration

Explicit flags (`fitness_architecture_v2`, `race_prediction_v2`,
`anchor_prescription_v2`), run old vs new on the same historical runner data.
Feature flags are temporary migration tools — set a deletion date for legacy
paths, don't leave parallel architectures alive indefinitely.

## 21. Shadow mode before authority

For new resolvers: run in shadow mode → record what they would have returned
→ compare against production behavior → inspect disagreements → decide which
reflects doctrine → promote → remove old authority. Especially for threshold
capacity, high-intensity capacity, durability, race prediction. Disagreement
alone is not evidence the new model is wrong — doctrine and real training
behavior are the arbiter.

## 22. All agents receive the same doctrine context

A coding agent touching coaching logic gets: master doctrine, relevant
subsystem brief, ownership map, explicit invariants, forbidden behaviors,
acceptance tests. Never "fix threshold pace bug" alone — that invites a local
patch. Frame as "fix threshold pace behavior within this architecture; do not
introduce independent fitness calculations or bypass the evidence/anchor
resolver."

## 23. "Doctrine impact" section required for relevant PRs

For any change touching fitness, training pace, plan generation, race
prediction, adaptation, readiness, safety, or workout interpretation:
which doctrine rule does this implement? which owning service changed? does
this create a new derived value? a new fallback? can this alter fitness or
prescription? what evidence justifies that? which golden-runner tests
changed?

## 24. Ban "temporary" cross-layer shortcuts

Never "we'll calculate a temporary threshold estimate in the plan builder,"
"we'll use goal pace here until the new resolver lands," "we'll directly
adjust the workout target from yesterday's HR," "we'll duplicate the VDOT
calculation just for this screen." These shortcuts almost always survive. If
the canonical service is missing functionality, add it there — don't route
around it.

## 25. No silent new coaching rules

Any new rule affecting coaching behavior declares: what decision it changes,
evidence required, owning subsystem, confidence behavior, fallback behavior,
user-visible effect, tests. Not "if HR drift > 5%, reduce marathon
prediction" — instead "add HR drift as one low-to-medium reliability
durability observation, subject to duration, terrain, heat and
sensor-quality checks."

## 26. New signals start as evidence, not authority

Sleep, HRV, power, cadence, running dynamics, temperature, subjective
soreness — default assumption is "this may provide supporting evidence," not
"this now controls training." Signals earn authority through validation.

## 27. Build explainability into domain outputs, not as an afterthought

`ThresholdCapacityEstimate {pace, confidence, reasons: [...]}` where reasons
are structured (`THREE_RECENT_CORROBORATING_SESSIONS`,
`STABLE_HR_RESPONSE`, `STRONG_DURATION_SUPPORT`) — UI explanation, debugging
and testing all draw from the same underlying rationale. Never generate
explanations independently with an LLM and hope they match what the model
actually did.

## 28. Log decisions, not just inputs

For meaningful coaching events: inputs used, evidence selected, estimates
before/after, reason, confidence, fallback used, adaptation outcome. `"threshold
changed 6:55 → 6:47"` is insufficient — you need why.

## 29. Build a contradiction checker

Before returning a final coaching output, run sanity checks: goal
contradiction (pace derived from goal rather than capacity → reject);
readiness contradiction (capacity lowered by temporary fatigue → reject);
race contradiction (marathon prediction faster than durability supports
without explicit reason → flag); easy contradiction (easy target faster than
steady/aerobic logic permits → reject); evidence contradiction (high-
confidence anchor changed materially from one low-quality observation →
flag); safety contradiction (normal workout prescribed while safety state is
STOP → reject). Deterministic validation layer.

## 30. Range and monotonicity tests

Threshold pace should generally be faster than marathon-specific pace; easy
ceiling should generally be slower than steady work; stronger durability
should not worsen marathon prediction all else equal; increasing goal
aggressiveness should not increase current fitness; higher fatigue should not
increase workout demand; lower confidence should not produce more aggressive
precision; adding corroborating strong evidence should not reduce confidence
absent contradiction.

## 31. Version the model

`fitness_model_version: 2.1`, `race_prediction_version: 1.3` on every
important output — so a behavior change can be attributed to new evidence vs.
changed algorithm vs. changed fallback vs. changed normalization, and
historical comparisons stay possible.

## 32. Migrate data, not just code

Old stored values may reflect old doctrine (persisted VDOT-derived paces,
cached race predictions, stored training zones, old confidence assumptions).
Do not point new code at legacy derived values and assume they're neutral.
Classify: raw observations (keep), derived values still valid under new
doctrine (possibly migrate), derived values contaminated by old architecture
(recompute). Rebuild from raw evidence where practical.

## 33. Define source-of-truth order

For every important field, document what wins, with an explicit precedence
list — e.g. threshold capacity: canonical resolver → direct evidence ledger →
approved fallback → never UI cache → never goal → never arbitrary last
workout. No ambiguity about precedence, ever.

## 34. Retire duplicate concepts

Audit for synonyms that may represent duplicated logic — "fitness score,"
"pace fitness," "VDOT fitness," "current performance," "runner level," "race
fitness," "threshold estimate," "training speed score." Determine: canonical,
derived display, obsolete, duplicated, or misleading. Delete or rename
aggressively — naming ambiguity creates architectural ambiguity.

## 35. Don't let database schema become doctrine

`user.vdot` existing in the schema does not mean VDOT deserves central
importance. The domain architecture defines the truth; storage supports it,
not the other way around.

## 36. Keep raw data immutable

Raw activity data stays raw; normalized observations, evidence, and capacity
are all derived. Never overwrite original activity values with corrected or
interpreted equivalents — preserving source data makes reprocessing possible
as models improve.

## 37. Recomputation should be possible

Raw historical corpus → current model → rebuild evidence → rebuild
capacities → rebuild prediction. If a future bug is found in elevation
normalization or HR interpretation, the system should be able to recalculate
beliefs from raw history. Avoid permanently baking inference into
irreversible records.

## 38. Each system fails honestly

When evidence is insufficient, return `insufficient_evidence` or an explicit
fallback — never fabricate specificity. "Threshold based on race-derived
fallback; direct evidence currently insufficient" beats silently pretending
confidence.

## 39. Acceptance criteria for the entire rework

**Architecture:** one owner per major coaching decision; legacy duplicate
resolvers removed or isolated; goal cannot influence current capacity; state
cannot overwrite capacity; race prediction separate from fitness; adaptation
flows through evidence. **Data:** important estimates retain provenance;
confidence exists; raw data remains recoverable; derived legacy values are
audited. **Testing:** doctrine tests pass; golden runners pass; historical
replay works; monotonicity/sanity tests pass; bad-race and hero-workout cases
behave correctly. **Product:** generated training looks sane; explanations
match actual reasoning; no major adaptation occurs silently; predictions
return uncertainty; easy running is not over-prescribed; plan behavior
survives real-life modifications.

## 40. The merge rule

Ask, in order: **Can this code produce a coaching decision that contradicts
doctrine without passing through the owning service?** If yes — do not merge.
**Can another part of the codebase independently derive a competing answer?**
If yes — consolidate ownership first. **Can we explain exactly why this
output exists from the evidence and rules that produced it?** If no — the
system is not ready.

---

## FINAL IMPLEMENTATION DOCTRINE

Do not rely on developers remembering the doctrine. Encode it into the
architecture.

One question gets one owner. One derived truth gets one resolver. Raw
activity becomes evidence before it becomes belief. Belief becomes
prescription through explicit services. Goals cannot leak backward into
fitness. Fatigue cannot masquerade as lost capacity. Race prediction cannot
redefine fitness. Fallbacks are centralized and visible. Meaningful
adaptations are traceable and proposed. New signals begin as evidence, not
authority. Legacy paths are deleted rather than politely discouraged. UI
displays coaching decisions; it does not invent them. Every important belief
carries provenance. Every significant change can explain itself. Every
architecture change runs against historical runners. Every contributor gets
the same doctrine.

And every PR touching coaching logic must answer one final question: **does
this implementation make it harder or easier for faff to contradict itself?**
If it makes contradiction easier, it is the wrong implementation.
