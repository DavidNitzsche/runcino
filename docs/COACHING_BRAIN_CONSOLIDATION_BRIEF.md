# faff.run — Coaching Brain Consolidation & Implementation Brief

**Locked 2026-08-31. The governing process document for how the rest of
tonight's rework proceeds — supersedes the implicit "build new resolvers,
wire them in later" sequencing tonight had been following. Read alongside
`docs/PRODUCT_COACHING_DOCTRINE.md`, `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md`,
`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`, and
`docs/ADAPTATION_PROGRESSION_DOCTRINE.md` — this one governs SEQUENCING and
PROCESS, those govern WHAT the system believes and HOW it's shaped.**

## Purpose

The next phase is not to add more intelligence indiscriminately. It is to:
simplify the architecture; establish clear ownership; remove redundant or
contradictory logic; make adaptation evidence-driven; ensure every generated
workout follows a coherent coaching strategy; make the system learn the
individual runner over time; keep complexity underneath the product.

**This document is not permission to build a large collection of new
scoring systems.** Prefer fewer concepts with clearer ownership. The goal is
not to perfectly model human physiology — it is to make consistently good
coaching decisions.

## The fundamental coaching loop

```
OBSERVE → WHAT DO WE BELIEVE ABOUT THIS RUNNER? → WHAT CURRENTLY MATTERS
MOST? → WHAT SHOULD WE TRAIN? → PRESCRIBE → RUNNER TRAINS → WHAT ACTUALLY
HAPPENED? → WHAT DID WE LEARN? → DOES OUR BELIEF NEED TO CHANGE? → DOES THE
TRAINING NEED TO CHANGE? → REPEAT
```

If a subsystem does not materially improve one of these decisions, question
whether it needs to exist.

## Core concepts (consolidating what's already locked elsewhere tonight)

The runner model holds three capacity concepts (`HIGH_INTENSITY_CAPACITY`,
`THRESHOLD_CAPACITY`, `DURABILITY`) as internal coaching beliefs, not
necessarily user-facing scores — each roughly `{estimate, confidence,
supporting_evidence, last_meaningful_observation, provenance}`, following
the EXISTING architecture (`capacity-resolver.ts`) rather than a parallel
schema invented to match this document's examples.

Fitness ≠ readiness (capacity vs state, never mutated into each other).
Fitness is a belief, not a fact (evidence changes estimate and/or
confidence — a workout can be useful without moving the estimate at all).
Stale evidence lowers confidence, not fitness, absent real evidence of
decline. Raw activities never directly alter the plan — they pass through
Data Quality → Activity Interpretation → Evidence Extraction → Evidence
Ledger → Runner Model → Adaptation, and the Evidence Engine answers "what
did this demonstrate," never "what should next week be." Workout labels are
context, not physiological truth — infer from the actual shape of the run
(pause handling → meaningful effort changes → sustained segments →
physiological classification → evidence extraction), never flattened to a
whole-run average for structured/variable activities. One activity can
produce multiple evidence streams (a long run with quality blocks feeds
threshold, durability, load, and recovery-behavior evidence simultaneously,
never forced into one bucket). Evidence is two-stage: eligibility (is this
admissible), then weight (how much should we trust it) — avoid false
mathematical precision in the weighting. HR informs, doesn't rule — it
modifies interpretation and confidence, never vetoes obvious performance
evidence outright. Environment changes interpretation conservatively — never
invent a precise heat-adjusted equivalent pace the evidence doesn't support.

Durability depends on no single metric (race-distance conversion, long-run
performance, late-run degradation, decoupling, drift onset, quality-late,
consistency, volume, race-specific work, marathon history — collectively).
Quality under fatigue matters: the same output means different things
depending on accumulated duration/load before it occurred — preserve that
context, don't discard it. Decoupling is supporting evidence only,
longitudinal trends beat single-run conclusions.

Goal ≠ current fitness, structurally (already enforced at the type level in
`prescription-resolver.ts`). Easy runs get an upper guardrail + feel
guidance, not an over-engineered mandatory band (already built —
`resolveEasyPaceCorpus`'s ceiling).

## The adaptation engine (full detail in `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`)

Four independent levers, not one progression score (pace / duration-volume /
density / hold-reduce-restructure). Pace progresses from capacity evidence;
duration from load-tolerance evidence; workout progression doesn't always
mean faster (more reps, longer reps, more total quality, shorter recovery,
quality later in a session, greater specificity are all real progression).
Progress one primary stressor at a time. Hold is a successful decision, not
a failure to adapt. Control matters — beating a target with deteriorating
physiology and destroyed finish is NOT positive pace evidence, regardless of
the raw numbers. The calendar proposes, the runner earns — `expected next
step + current runner evidence + current state = actual next step`. Adapt
the thing that actually changed (fitness / load / schedule / safety are
different problems with different triggers). Safety overrides normal
adaptation, unconditionally.

## Long-term personalization (new ground beyond tonight's other docs)

Over time faff should develop individualized coaching priors: normal easy-
pace variability, normal HR variability, heat response, long-run recovery,
quality-frequency tolerance, mileage-increase tolerance, threshold-block
response, injury-sensitive load patterns, durability profile, historical
race conversion, preferred/available training days. **Learn these gradually
when evidence supports them — never hardcode as universal truth.** Personal
baselines should eventually supersede generic population assumptions where
evidence is strong (a +7bpm HR difference may be significant for one runner
and normal variability for another). Long-term response-to-training
learning (which stimuli actually produce improvement for THIS runner) is
explicitly a long-term layer, not immediate authority — do not overfit short
histories.

Plateaus trigger DIAGNOSE before TRAIN HARDER (insufficient stimulus,
excessive fatigue, insufficient volume, poor specificity, durability
limitation, inconsistent training, insufficient recovery, or simply
insufficient time — distinguish before escalating stress). Phase
transitions (general → development → specific → taper) aren't purely
calendar-governed — runner development influences how aggressively the
system moves through them. Capacity ≠ race readiness — the gap between what
a runner's threshold suggests and what their durability/preparation
actually supports over the target distance should close as race day
approaches, and training should be the thing closing it.

## The coaching thesis — a genuinely new concept, build it

At any moment the brain should be able to state: what we believe, what
currently matters most, what we're trying to improve, what we're
deliberately NOT emphasizing, what evidence would change our mind.

```
CoachingThesis {
  current_picture: { threshold: improving, high_intensity: sufficient, durability: primary_limiter }
  current_strategy: [hold threshold intensity, increase threshold duration gradually,
                      progress long-run demand, introduce race-specific work]
  not_priority: [additional VO2 emphasis]
  change_conditions: [repeated late-run deterioration, poor load absorption,
                       new race evidence, meaningful threshold change]
}
```

Doesn't need to be a literal DB object if the existing architecture can
represent it cleanly, but the CONCEPT must exist — and every generated
workout should be checkable against it: if the thesis says durability is the
limiter and the plan suddenly generates extra VO2 work, that needs a
defensible reason or the workout gets rejected/regenerated.

## Multiple timescales — do not flatten to one recency score

Today/yesterday → readiness. Recent week → acute load. Recent several weeks
→ training response. Months → fitness trajectory/durability. Years →
experience/historical capability. Keep these distinct.

## Testing requirements

Historical replay (no future-data leakage — for any historical date, only
information that existed then). Golden runners (new, experienced, fast-5K-
weak-durability, strong-marathoner-modest-speed, inconsistent, aggressive
goal, injury return, no/bad HR data, heat-sensitive, highly durable,
improving rapidly, plateauing). Adversarial tests (huge downhill PB, GPS
error, HR-locks-to-cadence, one crushed workout, one bombed race, doubled
mileage, 10 missed days, immediate-strong-return, fueling-caused marathon
blowup, hot-weather HR spike, racing workout targets, easy runs faster than
generic expectations, label-contradicts-execution) — correct response is
usually conservative and explainable. Required invariants: goal isolation,
state isolation, single-run resistance, race resistance, hero-workout
resistance, provenance, prediction separation, adaptation restraint, safety
priority.

Contradiction check before finalizing any coaching output: does the workout
contradict the coaching thesis? Does the pace contradict current capacity?
Does today's recommendation ignore readiness? Does it chase the goal rather
than current fitness? Does race prediction contradict durability? Is an
easy run hidden quality? Is safety overridden by optimization? Are two
systems producing competing answers? **If yes to any: resolve before output.
Never just pick whichever subsystem ran last.**

## Restraint is a feature — QA the adaptation engine's own behavior

Track adaptation frequency, magnitude, reversal rate, time between changes,
unnecessary-change rate. If faff repeatedly speeds training up and slows it
back down shortly after, that's a bug in the adaptation engine, not
noise — investigate it. A good coach should appear stable.

## Why AND why-not, both recorded

Every meaningful decision explains itself, including why the obvious
alternative was NOT taken ("threshold pace didn't increase: only one strong
observation" / "long-run duration didn't increase: recent weekly load
already increased materially" / "race prediction didn't improve: threshold
evidence improved but durability remains unchanged"). Essential for
debugging — a decision log that only records what happened, not why the
alternative was rejected, is half a log.

---

## THE PROCESS MANDATE — this is what actually changes tonight's sequencing

### §53 — do not build another parallel fitness engine

Before implementing any new calculation: search the existing codebase first.
Does this concept already exist? Who currently owns it? Is it correct?
Should it be modified, consolidated, or deleted? **Do not solve
contradictions by creating another resolver. One question, one owner.**

### §63 — migration, not addition

Do not merely add the new architecture alongside the old. Identify legacy
fitness calculations, duplicate pace resolvers, race-derived caps,
feature-specific overrides, old adaptation paths, UI-derived calculations,
contaminated derived data — and for each: KEEP / REWRITE / ROUTE THROUGH
CANONICAL OWNER / RECOMPUTE / DELETE. Temporary compatibility layers are
acceptable during migration, but need an explicit removal path (matches
Doctrine Enforcement §4's `LegacyFitnessFallback` pattern already
established).

### §65 — implementation order (nine phases, do not skip ahead)

1. **Audit** — map existing fitness/pace/adaptation/plan-gen/race-prediction/
   workout-classification/readiness-load/UI calculations, identify duplicate
   ownership and contradictions.
2. **Canonical ownership** — establish one resolver per major question,
   route existing consumers through it.
3. **Runner model + evidence** — capacity beliefs, confidence, provenance.
4. **Pace prescription** — route intensity through demonstrated capacity.
5. **Adaptation** — PROGRESS/HOLD/REDUCE/RESTRUCTURE across independent
   levers.
6. **Coaching thesis** — coherent current strategy, validate workouts
   against it.
7. **Race prediction** — separate capacity from distance-specific readiness.
8. **Simplification** — remove obsolete calculations, concepts, UI.
9. **Replay** — historical and adversarial scenarios; fix bad coaching
   decisions before adding more sophistication.

**Where tonight's work actually sits against this order, stated honestly:**
Phase 3 (runner model / `capacity-resolver.ts`) and Phase 4 (pace
prescription, shadow-mode / `prescription-resolver.ts`) are substantially
built and verified against real data, ahead of a completed Phase 1. That's
the gap this brief exists to close — Phase 1 (the audit) is being run now,
against the codebase AS IT ACTUALLY STANDS including tonight's new modules,
so Phase 2 (canonical ownership / actual wiring) proceeds from a real map
rather than an assumption that the new modules are the only things that
exist.

### §67 — the working rule for every subsequent piece of code

Before writing code for any section of this brief: (1) inspect the existing
implementation, (2) identify the current owner, (3) identify conflicts with
doctrine, (4) identify code that can be removed, (5) propose the smallest
coherent change, (6) identify tests required, (7) then implement. **Do not
begin by creating new files/services/classes.** This is a consolidation
project first.

### §68 — required audit output, before further major implementation

```
CURRENT ARCHITECTURE       — relevant services/modules, current data flow
DUPLICATED RESPONSIBILITIES — where multiple systems answer the same question
DOCTRINE VIOLATIONS         — concrete examples
UNNECESSARY COMPLEXITY      — systems/calculations that can likely be removed
MISSING CAPABILITIES        — genuinely absent behavior this brief requires
PROPOSED TARGET ARCHITECTURE — ownership boundaries, canonical data flow
MIGRATION PLAN              — ordered changes, legacy retirement
TEST PLAN                   — invariants, historical fixtures, adversarial scenarios
```

**Do not implement the full redesign until this audit is complete.**
Dispatched as the immediate next step after this brief landed.

### §66 — what NOT to build yet

Dozens of physiological dimensions; one proprietary score per concept; ML
because rules feel inelegant; exact environmental equivalent-pace formulas
without validation; automatic adaptation from every activity; workout
reconstruction that over-classifies normal runs; speculative injury
prediction; user-facing confidence percentages everywhere; a dashboard
exposing the entire internal model. Prefer boring, understandable, testable
systems.

---

## Product north star

The runner should not think "this app has an incredibly sophisticated
physiological model." They should think "it gets me" → "the workouts make
sense" → "it notices when something changes" → "it doesn't freak out over
one weird run" → months later, "I'm a better runner."

## Final doctrine

Train the runner you have, not the goal they typed. Fitness and readiness
are different. Evidence changes beliefs; beliefs change prescriptions.
Repeated evidence beats isolated evidence. Context changes what evidence
means. Stale evidence lowers certainty before it lowers fitness. Pace
progresses when capacity improves. Duration progresses when training
tolerance improves. Specificity progresses when the runner is ready for it.
The calendar proposes progression; the runner earns it. Hold is a valid
coaching decision. Adapt the thing that actually changed. One run rarely
rewrites the runner. Training quality beats data collection. Understand the
shape of the run before interpreting its average. The workout label is
context, not physiological truth. Every workout needs a reason. Every
meaningful belief needs provenance. Every meaningful adaptation needs an
explanation. Complexity belongs in the engine, not in the runner's face.
When in doubt, prefer the smallest defensible coaching change. The goal is
not to model everything. The goal is to make the next good coaching
decision.
