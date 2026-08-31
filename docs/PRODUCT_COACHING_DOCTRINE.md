# faff.run — Product & Coaching Doctrine

**Locked 2026-08-31, David's own words. This is the canonical doctrine — the
fullest, most current statement of what this app is for and how it should
behave. Where anything in `CLAUDE.md`'s numbered rules or `docs/PRODUCT_DECISIONS.md`
conflicts with this document, treat the conflict as a signal to reconcile
explicitly, not to silently pick one — most should already agree, since this
document was written the same night as and consolidates that work.**

**Companion:** `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` — twelve detailed
per-system briefs (Runner Model, Evidence Engine, Pace Prescription, Plan
Generation, Workout Library & Evidence Coverage, Durability, Adaptation
Engine, Training Load/Recovery/Readiness, Race Prediction & Goal Feasibility,
Missed Training, Safety, Coaching Experience) that define HOW each system
should behave under this doctrine, with explicit ownership boundaries so no
subsystem quietly answers another's question. This document defines WHAT faff
believes; the briefs define HOW.

**Standing directive (David, 2026-08-31): as new doctrine lands, actively
audit for and remove anything already in the app that contradicts it — this
is not a one-time reconciliation, it's ongoing practice for every change from
here forward.**

---

## The Guiding Light

faff exists to answer one question:

**What should this runner do next to become a better runner?**

Everything in the product serves that question.

The app has access to enormous amounts of information: pace, distance, heart
rate, elevation, races, workouts, training history, volume, consistency,
weather, goals, recovery, injuries, missed sessions, performance trends and
more.

The goal is not to use all of it all the time.

The goal is to know which information matters to the next coaching decision.

faff should feel less like a dashboard analyzing a runner and more like an
excellent coach who has watched every run they've ever done. It knows where
they are. It knows where they're trying to go. It understands what their
training is showing. It changes course when the evidence warrants it. And most
importantly: it gives them the right training today.

## 1. THE PRODUCT PROMISE

A runner gives faff: their running history, their current training, their
races, their goal, their schedule, their wearable data, their feedback when
necessary.

In return, faff should continuously answer:

- **Where am I now?** What fitness has the runner actually demonstrated?
- **Where am I going?** What are they training for, and what does success require?
- **What should I do today?** What training provides the most useful stimulus
  given their current fitness, recent training and place in the plan?
- **Is it working?** Are they absorbing the training and becoming more capable?
  Should anything change?
- **What can I realistically race?** What does the available evidence support today?

These are the fundamental responsibilities of the product.

## 2. THE CORE LOOP

The entire system should reduce to:

**UNDERSTAND → PRESCRIBE → OBSERVE → INTERPRET → ADAPT → REPEAT**

- **Understand** — build the best defensible picture of the runner from available evidence.
- **Prescribe** — give them training appropriate for their demonstrated ability, goal, history and current state.
- **Observe** — capture what actually happened.
- **Interpret** — determine what the performance means rather than merely comparing planned versus actual numbers.
- **Adapt** — change what needs changing when sufficient evidence exists.
- **Repeat** — every completed week gives the system a better understanding of the athlete.

This loop is the heart of faff. Everything else is infrastructure.

## 3. TRAIN THE RUNNER YOU HAVE

Training is prescribed from demonstrated current ability. Never from
aspiration.

If a runner currently demonstrates 1:40 half-marathon fitness and wants to run
1:25: 1:40 describes where training begins. 1:25 describes where they want to
go.

The goal can influence: plan duration, progression, workout emphasis,
race-specific preparation, feasibility assessment. It cannot manufacture
fitness the runner has not demonstrated.

The system should help runners become capable of their goals. It should never
pretend they already are.

## 4. FITNESS IS A BELIEF BUILT FROM EVIDENCE

faff should never treat fitness as something it knows perfectly. It maintains
a best current belief, built from evidence such as races, time trials,
threshold sessions, intervals, long runs, race-specific workouts, sustained
aerobic work, training history, heart rate, pace, duration, terrain,
environmental conditions.

Different observations have different reliability. A properly raced 10K is
stronger evidence than a random fast Tuesday. A clean 30-minute tempo is
stronger threshold evidence than an interrupted progression run. Three
corroborating workouts are stronger than one extraordinary workout.

The system should always prefer multiple independent observations over one
impressive number.

## 5. FITNESS IS NOT ONE NUMBER

Running ability is not adequately represented by a single VDOT, VO2max
estimate or equivalent race time. At the coaching level, faff should
understand at least three dimensions:

- **High-Intensity Capacity** — what the runner demonstrates at faster
  intensities. Primarily informs faster interval and repetition work.
- **Threshold Capacity** — what the runner can sustain around threshold.
  Primarily informs tempo, cruise and sustained quality work and contributes to
  longer-distance prescription.
- **Durability** — how well the runner preserves their underlying ability as
  duration increases. Primarily informs long-duration training,
  marathon-specific work and longer-distance race prediction.

These are not necessarily three numbers shown to the runner. They are three
different things the coach needs to understand.

## 6. FITNESS AND READINESS ARE DIFFERENT

A runner can be very fit and very tired. Do not confuse the two.

Capacity asks: what is this runner capable of? State asks: what is
appropriate for this runner today?

Current state may include: accumulated fatigue, recent training load, illness,
injury, recovery, unusual physiological response, environmental stress.

State can modify today's training without rewriting underlying fitness. A bad
Tuesday after a huge week does not mean the runner suddenly became slower.

## 7. PRESCRIPTION EXISTS TO CREATE ADAPTATION

Every workout needs a reason to exist. Not because the calendar needed
something on Wednesday. Not because a template says runners should do
intervals.

The workout should create a useful stimulus toward the runner's goal. Training
should deliberately develop: aerobic capacity, threshold, high-intensity
capacity, running economy, strength, endurance, durability, race-specific
ability, recovery capacity.

The mix changes based on: runner experience, current ability, goal distance,
race date, available days, training history, recent load, demonstrated
strengths and limitations.

The plan should be individualized where individualization changes training. It
should remain simple where it doesn't.

## 8. PROGRESSION IS EARNED

Training should become harder because the runner has demonstrated they can
absorb the current training. Not simply because another week passed.

Progression may mean: more volume, longer duration, more repetitions, longer
repetitions, shorter recovery, greater race specificity, faster pace, more
sustained quality.

These are different progression tools. Faster is not synonymous with better.
A runner may need to hold pace constant while increasing duration. Another may
need more volume before more intensity. Another may need no progression at all
that week.

The plan should progress the stimulus required, not blindly increase numbers.

## 9. EASY RUNS ARE TRAINING, NOT TESTS

Easy running exists primarily to accumulate aerobic volume, support
adaptation, develop endurance, allow recovery, increase training capacity. Do
not turn it into another performance target.

Easy pace should generally be treated as a ceiling with feel-based guidance,
not a narrow band the runner must hit: "No faster than approximately X. Run
whatever feels genuinely easy below that."

The runner should not finish an easy run wondering whether they "failed"
because they ran too slowly. Easy enough is successful.

## 10. QUALITY RUNS DEVELOP FITNESS AND REVEAL FITNESS

Threshold sessions, intervals, time trials and structured long runs have two
useful properties: they train the athlete, and they create evidence.

The plan should periodically create clean opportunities to observe the
capacities it relies upon. Threshold should remain reasonably well observed
through tempo and cruise work. High-intensity capacity should be periodically
corroborated through suitable interval, time-trial or race efforts. Durability
should accumulate evidence through long-duration running and increasingly
race-specific long runs.

But: never compromise good training simply because the model wants more data.
Training comes first. Evidence collection breaks ties between equally
appropriate training choices.

*(See `docs/design/plan-evidence-coverage-2026-08-31.md` — the concrete
architecture for this, deliberately deferred until the fitness-vector wiring
lands.)*

## 11. WORKOUT LABELS DO NOT DEFINE PHYSIOLOGY

"Tempo." "Intervals." "Long run." These describe structures or intentions.
They do not automatically tell us what the runner demonstrated.

A 6×1 mile interval workout might primarily demonstrate threshold capacity.
12×400m may tell us considerably more about high-intensity capacity. A
progression long run might provide useful threshold and durability evidence.

Planned structure tells us what was intended. Completed performance tells us
what actually occurred. Fitness evidence should be classified from the actual
run, not blindly from its label.

## 12. NOT EVERY RUN NEEDS TO TEACH US SOMETHING

faff does not need to extract a fitness update from every activity. Some runs
should simply make the runner fitter. Easy runs may primarily contribute
training load. Recovery runs may tell us almost nothing about maximum
capability. Short shakeouts may contain no useful fitness information
whatsoever. That is fine.

The system should know when not to infer. Restraint is part of intelligence.

## 13. CONTEXT CHANGES WHAT PERFORMANCE MEANS

Raw pace is not fitness. A 7:00 mile uphill, at 90°F, late in a 20-mile run
does not mean the same thing as a 7:00 mile on a track, at 50°F, after a
taper.

Where reliable, interpretation should consider: elevation, heat, humidity,
wind, workout duration, recent load, accumulated fatigue, recovery intervals,
HR, HR drift, fueling, interruptions, sensor quality.

But normalization should remain conservative. The system does not need to
claim "7:12 on this hill precisely equals 6:43.8 on flat ground." It needs to
understand "this performance was stronger than raw pace alone suggests."

Useful truth beats fake precision.

## 14. HEART RATE IS EVIDENCE, NOT TRUTH

Heart rate is valuable. It is also noisy. Sensors fail. Max HR estimates can
be wrong. Heat raises HR. Fatigue raises HR. Stress changes HR. Caffeine
changes HR. Hydration changes HR.

HR should help answer: how costly was this performance? It should not
independently dictate what the runner is capable of.

When pace, duration, workout structure and HR agree, confidence increases.
When they disagree, uncertainty increases and the system investigates rather
than forcing an answer.

## 15. ONE RUN SHOULD RARELY REWRITE THE RUNNER

A terrible race should not automatically destroy fitness. An incredible
workout should not automatically create it. Performance varies. The system
should look for corroboration.

When something unusual happens, ask: was the course difficult? Was the weather
unusual? Was the runner sick? Was pacing poor? Was the data reliable? Was the
workout executed differently? Does recent training support this result? Is
this part of a trend?

Strong evidence should move the model. Repeated strong evidence should move it
confidently. Anomalies should primarily create questions.

## 16. STALE EVIDENCE MEANS WE KNOW LESS

Time passing does not automatically make someone slower. If threshold was
strongly demonstrated six weeks ago but hasn't been tested recently,
confidence should decline. The system should not mechanically reduce
threshold pace simply because the observation aged.

Fitness should decline when there is evidence supporting decline: prolonged
time off, sustained training reduction, injury, illness, repeated weaker
performances, meaningful detraining.

**Doctrine: uncertainty decays with stale evidence. Fitness does not
automatically decay with stale evidence.**

## 17. DURABILITY MATTERS

Short-distance fitness does not guarantee long-distance performance. Two
runners can have identical 5K ability and dramatically different marathon
ability. faff should understand how well each runner preserves performance as
duration increases.

Evidence may include: race-distance conversion, long-run history, long-run
duration, weekly volume, pace/HR decoupling, onset of late-run deterioration,
race-specific work, late-run pace stability, marathon history, quality
performed under accumulated duration.

No single metric defines durability. They collectively inform it. This
prevents the app from promising marathon performances simply because a runner
has a fast 5K or half marathon.

## 18. RACE PREDICTION IS NOT FITNESS

Race prediction is an application of fitness. It should combine underlying
capacity, distance-specific durability, recent preparation, race-specific
work, course and conditions to answer: what is this runner realistically
capable of over this distance?

Prediction should return uncertainty. Prefer "Expected: 1:32. Likely range:
1:30-1:35. Confidence: High" over "Predicted time: 1:31:47" — the latter
implies knowledge the system does not possess.

## 19. EXPLAIN WHAT LIMITS THE RUNNER

Race prediction becomes substantially more useful when faff can explain why.
For example: "Your threshold fitness supports something close to 1:30, but we
don't yet have enough long-duration evidence to confidently predict you can
hold it for 13.1 miles." Or: "Your endurance is strong enough for the
distance. Improving threshold is currently the biggest opportunity to move
your prediction."

Now the prediction isn't merely entertainment. It informs training.

## 20. GOALS SHOULD BE EVALUATED CONTINUOUSLY

A goal is a destination, not a promise. As training progresses, faff should
continuously compare demonstrated trajectory against required trajectory.

The goal can become: conservative, realistic, aggressive, unlikely, no longer
realistic. When that changes, say so.

Do not secretly alter the goal. Do not continue prescribing unrealistic
training to protect the runner's feelings. Do not declare failure prematurely
because of one bad week. Use the evidence. Then explain the conclusion.

*(This is informational-status only — see the standing rule that the coach
projects and never renegotiates a stated goal via a card or button.)*

## 21. LIFE HAPPENS

Real runners miss workouts, move workouts, travel, get sick, sleep badly,
shorten sessions, swap days, change workout structure, have stressful weeks.

The system should preserve the purpose of training, not worship the original
calendar. Ask: what training stimulus was intended? Then: given what actually
happened, what should happen next?

A changed workout is not automatically a failed workout. A missed Tuesday
should not require rebuilding the runner's identity. Adapt intelligently.

## 22. ADAPT THE RIGHT THING

Not every problem is a fitness problem. There are different kinds of
adaptation:

- **Fitness Adaptation** — evidence suggests underlying capability changed.
  Change relevant pace prescription and predictions.
- **Load Adaptation** — the runner is not tolerating current training volume
  or density. Change volume, frequency or recovery.
- **Schedule Adaptation** — life disrupted the calendar. Restructure upcoming
  training while preserving intent.
- **Goal Adaptation** — evidence materially changes what appears achievable on
  race day. Discuss the goal.
- **Safety Adaptation** — injury or illness makes normal training
  inappropriate. Safety overrides progression.

Keeping these separate prevents one signal from rewriting the entire system.

## 23. ADAPTATION SHOULD BE CONSERVATIVE AND EXPLAINABLE

faff should not constantly fiddle with the plan. A runner needs enough
consistency for training to work. Adapt when something meaningful changes.

When it does: say what changed, say why, say what faff recommends doing about
it. Example: "Your last three threshold sessions have been consistently ahead
of target without increased effort. We think your threshold fitness has
improved from approximately 6:55/mi to 6:47/mi. Future threshold work can move
slightly faster." Then allow the runner to accept the change.

**Doctrine: adaptation proposes. It does not silently impose.**

## 24. THE PLAN SHOULD ALSO KEEP ITSELF INFORMED

The plan generator should understand whether its fitness evidence is becoming
stale — high-intensity, threshold and durability evidence each sufficiently
recent? When two workouts provide equally appropriate training, prefer the one
that gives the system a cleaner view of an uncertain capacity.

But always preserve this hierarchy: **1. Athlete safety. 2. Training quality.
3. Appropriate progression. 4. Evidence quality.**

The runner does not exist to feed the algorithm. The algorithm exists to coach
the runner.

## 25. EVERY IMPORTANT BELIEF SHOULD BE TRACEABLE

If faff believes "threshold = approximately 6:47/mi," the system should know
why. Maintain an evidence ledger containing the observations supporting
important fitness beliefs.

That makes the system debuggable, explainable, testable, reversible,
auditable. When something looks wrong, we should be able to identify the
evidence that produced it. No important fitness belief should emerge
mysteriously from a black box.

## 26. FALLBACKS ARE GOOD

A new runner may not have enough evidence. That's normal. Use self-reported
performance, recent race, VDOT/equivalent models, conservative population
assumptions, onboarding information as initial priors and fallbacks. Then
replace assumptions with direct evidence as the runner trains.

The ideal progression is: population assumption → individual observation →
repeated individual evidence. The system should become more personalized
because it learns more about the runner. Not because onboarding asked them 47
questions.

## 27. CONFIDENCE SHOULD MATTER

Not all beliefs deserve equal authority. Internally, important estimates
should carry uncertainty.

Low-confidence estimates should use conservative prescriptions, resist large
changes, prefer gathering useful evidence, produce wider race-prediction
ranges. High-confidence estimates can prescribe more specifically, adapt more
decisively, produce tighter predictions.

The product doesn't need to expose a confidence decimal everywhere. But the
system should know the difference between "we think" and "we know this pretty
damn well."

## 28. SAFETY OVERRIDES OPTIMIZATION

When evidence suggests significant injury, possible bone stress injury,
concerning acute pain, significant illness, dangerous physiological response —
the normal optimization loop stops.

The question is no longer "what's the optimal workout?" It becomes "should
this person be running?" The app should be willing to say: don't run today. No
fitness goal outranks safety.

## 29. THE USER EXPERIENCE SHOULD BE MUCH SIMPLER THAN THE MODEL

The system underneath faff may evaluate dozens of signals. The runner should
not have to. They need: **Today** — what am I doing? **During** — how should
it feel? **After** — how did that go? **When something changes** — what did
you learn? **Looking ahead** — am I getting closer to my goal?

The intelligence should make the product feel simpler. If additional
intelligence creates additional cognitive load for the runner, question
whether it belongs in the interface.

## 30. COACHING VOICE

faff should communicate like a very good coach. Direct. Calm. Specific.
Evidence-based. Never performatively motivational. Never shaming. Never
catastrophizing one bad run. Never pretending everything is going amazingly
when it isn't.

A good coach can say: "That wasn't a good session. Don't chase it tomorrow.
Nothing else changes yet." Or: "You're consistently outperforming these
targets. It's time to move them." Or: "3:00 isn't supported by your current
training. Right now the evidence points closer to 3:10-3:15."

Trust comes from being right often and honest when uncertain.

## 31. THE APP SHOULD MAKE RUNNERS BETTER IN THREE WAYS

- **Better Training** — give the runner the appropriate stimulus at the
  appropriate time. Not too easy because an old race underestimated them. Not
  too hard because their goal is aggressive. Not generic because everyone else
  is doing the same plan.
- **Better Decisions** — help runners understand when to push, when to hold,
  when to recover, when to adjust, when a goal is realistic, when something is
  going wrong. Many runners don't fail because they lack effort. They fail
  because they apply effort badly. faff should fix that.
- **Better Self-Knowledge** — over time, the runner should understand
  themselves better. Not through endless charts. Through useful observations:
  "You have enough speed for this goal. Durability is currently the limiter."
  "Your fitness is improving, but you're accumulating fatigue faster than
  we're comfortable with." "Your long-run stability has improved significantly
  over the last six weeks."

The app should teach runners what their training means.

## 32. WHAT FAFF SHOULD NOT BECOME

Do not optimize for: the most metrics, the most physiology, the most adaptive
events, the most complicated training plans, the most precise-looking
predictions, the most AI. None of those automatically produce better
coaching. Complexity has to earn its place.

## 33. THE TEST FOR EVERY NEW FEATURE

Before adding a model, signal, rule or metric, ask: **does this materially
improve a coaching decision?**

If no: don't build it. If sometimes: use it as supporting evidence. If yes:
determine exactly which decision it informs (fitness, state, prescription,
progression, load, schedule, race prediction, goal feasibility, safety) and
keep it within that responsibility. Do not allow every signal to influence
everything.

## 34. THE TEST FOR EVERY PRESCRIBED WORKOUT

Ask: why is the runner doing this? There should be a clear answer. Then: is
this appropriate for the runner they are today? Then: how does this move them
toward the runner they need to become?

If those questions cannot be answered, the workout probably doesn't belong in
the plan.

## 35. THE TEST FOR EVERY ADAPTATION

Before changing something, ask: what new evidence caused us to change our
belief? Then: is there enough evidence to justify intervention? Then: what is
the smallest appropriate change?

The system should prefer stable, progressive training over constant
algorithmic tinkering.

## 36. THE TEST FOR THE ENTIRE PRODUCT

At any point in the training cycle, faff should be able to answer: what do we
believe about this runner? What evidence supports that belief? How confident
are we? What are we trying to improve? Why is today's workout appropriate? Is
the runner responding? What, if anything, should change? What can they
realistically race today? Are they moving toward their goal?

If the system can answer those questions coherently, the architecture is
working.

## 37. THE NORTH STAR

faff should not try to know everything about running. It should know enough
about this runner to make the next good decision.

Sometimes that requires sophisticated modeling. Sometimes it requires ignoring
most of the available data. Sometimes it means progressing. Sometimes it
means holding. Sometimes it means telling someone they're fitter than their
old race suggests. Sometimes it means telling them their goal is getting away
from them. Sometimes the best adaptation is no adaptation at all.

The intelligence is knowing the difference.

---

## FINAL DOCTRINE

**Train the runner you have. Build the runner they want to become.**

Prescribe from demonstrated ability, not aspiration. Treat fitness as a
confidence-weighted belief built from multiple observations, not a single
number. Separate underlying capacity from today's readiness. Use races and
quality workouts as strong evidence, easy running primarily as training, and
context to understand what performance actually means. Build plans that
create the right physiological stimulus first and useful evidence second.
Progress training when the runner demonstrates readiness for progression.

Do not mistake faster for better. Do not mistake one bad day for lost fitness.
Do not mistake one great day for new fitness. Do not mistake stale evidence
for declining fitness. Do not mistake heart rate for truth. Do not mistake a
workout label for physiology. Do not mistake short-distance ability for
long-distance durability. Do not mistake a race prediction for certainty. Do
not mistake adherence to the calendar for successful training.

Adapt the thing that actually changed. Make important beliefs traceable to
evidence. Express uncertainty when uncertainty exists. Use complexity
underneath the product to create simplicity above it. Protect consistency.
Protect recovery. Protect the runner.

And before building anything else, ask: will this help faff make a better
coaching decision? If it won't, leave it out.

The product wins when the runner doesn't think "this app has a sophisticated
fitness model." They think "it gets me." And twelve weeks later: "I'm a
better runner."
