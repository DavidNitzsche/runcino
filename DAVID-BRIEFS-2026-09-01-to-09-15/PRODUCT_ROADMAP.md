# faff.run — prioritized product roadmap

## North star

Build a coach that understands the runner in front of it, trains them toward the runner they want to
become, and earns enough trust that they can rely on it through progress, races, missed training,
time off, maintenance, injury, and return.

The defining runner moment is:

> “Oh shit… I've gotten better at running.”

Adaptation is the central product outcome. Reliability, evidence integrity, and delivery are the
conditions that make adaptation safe and believable. They come first in execution when broken, but
they are not the final product.

## Roadmap rules

1. **Drop anything faked.** Do not ship fabricated values, padded charts, invented explanations,
   unsupported causality, false affordances, or screens that imply knowledge the app lacks.
2. **Close the loop.** Understanding without a changed future plan is analytics. A changed backend
   row that does not reach the phone is unfinished delivery.
3. **Push both pace and volume.** The app must be able to progress pace, volume, duration, density,
   and specificity when evidence supports them.
4. **Keep one owner per decision.** Signals feed owners; features do not create side-door coaching
   logic.
5. **Explain consequential changes.** The runner understands what was learned, what changes, and why.
6. **Offer a choice under real ambiguity.** Do not disguise uncertainty as an automatic adjustment.
7. **Make incident work earn closure.** Fix, review, integrate, deliver, and verify on the actual
   device before moving the state to closed.
8. **Keep the full product alive.** Urgent races and incidents do not erase the 27-area programme.
9. **iPhone first.** Watch supports execution. The web frontend remains paused.
10. **Generalize after David proves value.** David is the first runner and highest-resolution test
    case. Productize the rule once its owner, evidence, and limits are understood.

## Priority 0 — restore trust in the active product

This is the immediate gate. The app cannot coach ambitiously if the runner cannot trust what Today
says, whether a plan changed, or whether a completed race is still runnable.

### Outcomes

- Today and Block remain usable from safe local truth during failed reads.
- The rejected outage screens and global connection banner are removed from the delivered iPhone.
- Day rollover cannot show yesterday as Today.
- Completed races cannot expose a new Run action from stale state.
- A stale receipt cannot imply that a new plan change just happened.
- Plan replacement fails closed when recovery safety cannot be established.
- Decision-relevant time uses the runner's canonical date instead of ambient clocks.
- Production corrections preserve current pace truth and invalidate native caches correctly.
- Every urgent fix reaches a named native build and receives device verification.

### Proof of completion

The exact reviewed code is integrated, pushed, deployed where relevant, included in a named iPhone
build, and reproduced on the physical failure scenarios. Source review alone does not complete this
priority.

### Coverage areas

Today, Block/plan experience, post-run, post-race, reliability and synchronization, coaching voice,
and run execution.

## Priority 1 — establish one trustworthy model of the runner

The app cannot adapt well until it can distinguish performance evidence, current capacity,
durability, load tolerance, recovery context, and data quality without letting one weak observation
or the runner's goal take over.

### Outcomes

- One canonical evidence ledger classifies each activity and preserves source, context, confidence,
  and lineage.
- One Runner Model holds confidence-weighted beliefs across high-intensity capacity, threshold
  capacity, durability, and relevant tolerance dimensions.
- Race results use curated race authority; training efforts remain provisional when used as race
  evidence.
- Race outcome separates target validity, prepared-capacity comparison, evidence validity,
  execution, automatic adaptation, and recovery.
- Goal feasibility and current capacity remain physically and conceptually separate.
- Conflicting sources reduce confidence or trigger adjudication rather than silently selecting a
  convenient answer.
- Historical evidence decays in confidence rather than having its value rewritten merely because
  time passed.
- Context filters apply to each observation that contributes to an aggregate finding.

### Proof of completion

Golden runners and real David scenarios demonstrate the correct answer under good races, bad races,
hero workouts, stale evidence, fatigue, missing heart rate, easy running, modified workouts, and
aggressive goals. The same quantity has the same value and label on every consumer.

### Coverage areas

Progress and fitness, activity/history, health and runner metrics, readiness/illness/injury, and
race/post-race truth.

## Priority 2 — make upward adaptation work end to end

This is the highest product priority once the trust and evidence foundation can support it. The
current programme has repeatedly built records, gates, and proposals without proving that the
runner's future plan becomes meaningfully harder.

### Outcomes

- Per-activity execution is interpreted for control, consistency, physiological cost, and late
  deterioration.
- Pace, volume, duration, density, and hold are adjudicated separately.
- The system recognizes earned headroom and proposes a material progression.
- One primary stressor progresses at a time unless doctrine supports a combined change.
- The runner sees the evidence, proposed change, and practical consequence.
- Ambiguous cases offer a meaningful choice.
- Accepted changes mutate only the active plan, record their lineage, remain undoable where
  promised, and survive cache/native reconciliation.
- The system records whether the runner absorbed the progression and uses that outcome in the next
  decision.
- Recovery and interruption flows include a defined path back to progression.

### Proof of completion

A real or high-fidelity golden runner follows training, demonstrates improvement, receives a
meaningful upward change, accepts it, sees it on iPhone and Watch, completes it, and has the outcome
inform the next decision. Separate scenarios prove appropriate hold and reduction. The programme
tracks eligible, proposed, accepted, delivered, and absorbed upward changes.

### Coverage areas

Adaptation experience, progress and fitness, Block/plan experience, coaching voice, Today, and
reliability.

## Priority 3 — make the baseline plan worthy of adaptation

Adaptation should improve a strong plan, not continually rescue a weak template.

### Outcomes

- Plans develop the specific capabilities required by the goal.
- Marathon preparation contains real progression in sustained marathon work rather than identical
  repeated exposures.
- Pace, duration, density, long-run share, cutbacks, taper, and cross-week quality spacing coexist
  without jointly making the required preparation impossible.
- Easy mileage is sized intentionally before quality is layered in.
- B and C races have explicit jobs and do not silently replace non-equivalent training.
- Plans roll coherently across races, recovery, maintenance, time off, and new goals.
- A goal without a booked race can still produce a purposeful development plan.
- The calendar can change shape without losing the runner's current evidence, commitments, or
  completed history.

### Proof of completion

Generated calendars for David and the golden-runner set show meaningful safe progression, correct
specificity, valid spacing, realistic recovery, and no dependency on a later adaptation pass to
become coachable.

### Coverage areas

Block/plan experience, race page, race morning, post-race, schedule management, travel and missed
training, cold start/return, and additional runner types and goals.

## Priority 4 — make improvement and coaching legible

The runner should not have to compare old screenshots or infer meaning from changed numbers.

### Outcomes

- The app tells the runner what improved, the evidence, confidence, and what training can now
  progress.
- Plan-change receipts describe the final active plan after all corrections, not an intermediate
  rebuild.
- Evidence can be worth reporting even when the plan does not change.
- Missed and modified training is stated without judgment and followed by a useful next action.
- Race preparation, race execution, and post-race learning form one continuous story.
- Coach voice is consistent, ordinary, direct, and free of internal jargon or invented causality.
- Notifications are reserved for consequential changes or requested actions.

### Proof of completion

Real-data renders and device sessions show that runners can answer: What did the coach learn? What
changed? Why? What do I do? What stayed the same? No surface contradicts another.

### Coverage areas

Today, pre-run, post-run, coaching voice, progress/fitness, race surfaces, Health, and notifications.

## Priority 5 — build the whole-life coaching layer

The app should have the runner's back outside a clean race build without becoming a medical or
lifestyle dashboard.

### Outcomes

- Health turns sleep, HRV, resting heart rate, weight, load, symptoms, and subjective feedback into
  restrained coaching insight.
- Health can become a dedicated iPhone dashboard or section when longitudinal insight, source and
  privacy controls, and deeper explanation provide enough value beyond the concise Today summary.
- Illness and injury flows preserve safety and provide a clear route back.
- Maintenance plans keep purpose and progression without a race date.
- Time off and returning-runner flows recalibrate without punishment or false certainty.
- Repeated non-adherence triggers recommitment or recalibration.
- Travel, heat, altitude, surface, and schedule changes are treated as context through canonical
  owners.
- Profile and settings expose meaningful runner control without turning the app into a settings
  project.

### Proof of completion

Scenario journeys cover healthy build, maintenance, vacation, illness, injury return, low-data
onboarding, inconsistent training, and a non-race performance goal. Each produces a coherent plan,
voice, and next action.

### Coverage areas

Health and runner metrics, readiness/illness/injury, travel/missed training, cold start/return,
onboarding, profile/settings, and additional runner types/goals.

## Priority 6 — make Watch execution exceptional

The runner expects to leave with the planned workout and complete it reliably.

### Outcomes

- Phone and Watch agree on the exact workout, pace, duration, recovery, and race guidance.
- Interval transitions, haptics, timers, pause behavior, and completion state are reliable.
- Offline execution preserves the authored workout and records enough truth for later interpretation.
- Duplicate, overwritten, or unmatched runs cannot silently corrupt history.
- Any during-run modification is offered explicitly, limited in scope, and reconciled afterward.
- Phone and Watch writes preserve one canonical completion.

### Proof of completion

Physical-device journeys cover easy, intervals, long run, treadmill, race, pause/resume, offline,
reconnect, interruption, duplicate completion, and degraded sensors.

### Coverage areas

Run execution, pre-run, post-run, activity/history, reliability, and accessibility/device coverage.

## Priority 7 — generalize and prepare for broader release

Only after the core coaching loop works for David should the programme expand deliberately.

### Outcomes

- David-proven rules generalize across speeds, experience, sex, schedules, devices, climates, race
  distances, and goals.
- Onboarding establishes honest priors and creates a useful first plan with sparse evidence.
- Accessibility and device/layout coverage meet a public-product bar.
- Privacy, authentication, deletion/export, account isolation, App Store, and commercial behavior
  are ready for more runners.
- Dead code, obsolete paths, stale exemptions, and duplicate owners are removed.
- Observability detects failures without surfacing system anxiety to runners.

### Coverage areas

Generalize David-proven rules, onboarding, App Store/privacy/auth/commercial, accessibility/device
coverage, shoes, and dead-code removal.

## What is deliberately later

- Web-frontend parity or redesign.
- Social feeds, leaderboards, and engagement mechanics unrelated to better coaching.
- More scores without a clear runner decision.
- Generative chat that cannot act through canonical owners.
- Broad wearable expansion before HealthKit truth and lineage are reliable.
- Commercial optimization before the core adaptive loop works.

## How work enters the roadmap

Every proposed item must answer:

1. Which runner problem does it solve?
2. Which roadmap priority does it advance?
3. What existing owner or mechanism should contain it?
4. What can be deleted or consolidated instead?
5. What evidence will prove runner-visible success?
6. Does it require a major product or structural decision from David?

The programme lead owns sequencing within this roadmap. Immediate safety, data-integrity, and live
trust failures can pre-empt the current build order, but they do not rewrite the north star.

## Roadmap completion test

The roadmap has succeeded when the app can take a runner through improvement, interruption,
recovery, racing, maintenance, and a new goal while preserving one trustworthy model of the runner,
changing training in both directions, explaining every consequential change, and delivering the
same truth to iPhone and Watch.
