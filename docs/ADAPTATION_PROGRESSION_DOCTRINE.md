# faff.run — Adaptation & Progression Doctrine

**Locked 2026-08-31. Extends Brief 07 (Adaptation Engine) in
`docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` with the actual progression
mechanics. Not yet built — depends on the Evidence Engine (in flight as of
this writing), since this engine's core job — telling demonstrated capacity
apart from aggressive pacing — is exactly what the Evidence Engine's
per-activity classification produces. Build this next, once that lands.**

## The governing principle

**Progress only when the runner has demonstrated they can absorb the
current training.** Not because the calendar moved forward. Not because
week 4 says "make it harder." Not because the goal pace is faster.

**Constitutional line: the calendar proposes progression. The runner earns
it.** Governs pace, distance, quality volume, long-run length, and race
specificity alike.

## Four separate questions — never one generic "progression score"

1. Should pace get faster?
2. Should duration/distance get longer?
3. Should the workout get denser/harder?
4. Should the plan hold or back off?

Different decisions, different evidence, different owners inside the
adaptation engine. Do not collapse them into one score.

## Pace progresses from capacity evidence

Strongest evidence: repeated quality sessions. If threshold work is
consistently completed at or faster than target, with controlled physiology
and no late collapse, the threshold anchor moves. Once the anchor moves with
enough confidence, the pace prescription service naturally returns faster
targets — this is already the shape `capacity-resolver.ts` +
`prescription-resolver.ts` implement.

```
better evidence → stronger capacity belief → new prescription
```

NOT:

```
runner beat target once → immediately speed everything up
```

A single great workout mostly increases confidence or creates a candidate
upward update. Two or three corroborating sessions make it much more
believable — this is the existing corroboration-count discipline, applied
here as a progression trigger, not just a fitness-read trigger.

## Duration/volume progresses from load tolerance, not fitness

Treat as load tolerance and durability progression, not fitness
progression. If the runner is consistently completing current volume,
recovering normally, not showing deterioration in easy runs, and handling
long runs without excessive late-run collapse, extend volume.

```
current weekly load absorbed
+ long run tolerated
+ no safety/readiness concerns
+ goal requires more endurance
= progress duration
```

E.g. 45→50→55min easy, 10→11→12mi long, or a little more quality volume.
Does not necessarily mean faster.

**The big distinction:** pace progresses when capacity improves. Duration
progresses when training tolerance improves. Specificity progresses as the
athlete becomes ready for more race-relevant work. **These are
independently controlled** — the same discipline as capacity/state
separation (Rule 7), applied one level up: pace-capacity and
duration-tolerance are also separate beliefs that must not be conflated
into one lever.

## Density progresses independently too

Rep count, rep duration, recovery length, continuous-vs-broken work, where
quality appears within a long run — all separate levers from pace or
volume. `3×8min/3min recovery → 3×10min/2min recovery` without changing
pace at all is real progression: sustaining the same physiological
intensity for more work with less recovery.

Long-run progression, same idea: `90min easy → 100min easy → 100min with
2×10min steady late → 110min with race-specific work`. **The progression is
what kind of runner is being built, not merely "make the number bigger."**

## Hold is a real, frequent, correct state

If current training is working, there is no requirement to change something
every week. If threshold is improving but load is already rising, hold
pace. If pace is going well but long-run durability is lagging, progress
duration instead. If fitness is improving but fatigue is high, hold or
reduce load. If the goal is far away, there may be no reason to rush
specificity.

The adaptation brain asks: **what is the current limiter? What has
improved? What has been absorbed? What does the next phase require? What is
the smallest useful progression?** Then chooses ONE lever.

## Progress one primary stressor at a time

Do not simultaneously make reps faster, longer, add a rep, and shorten
recovery — that makes it impossible to know what caused success or failure
and creates unnecessary load spikes.

**Doctrine: progress one primary stressor at a time whenever possible.**
E.g.: more volume same intensity / longer reps same pace / same reps
slightly faster pace / same work shorter recovery / same duration more race
specificity. Progressive overload while keeping the stimulus interpretable.

## Compare intended stimulus vs actual execution — not just completion

`4×1mile threshold @ 6:50-7:00`, executed `6:49/6:48/6:47/6:45` with
controlled HR, stable form, RPE 6/10 → upward evidence. Executed
`6:30/6:32/6:45/7:10` finishing destroyed → NOT evidence threshold should
get faster; may suggest poor execution instead. **The system needs to
understand control**, reading: target vs actual, consistency, physiological
cost, late-session deterioration, subjective effort, recovery between reps,
surrounding load, environment, repetition across workouts — to decide
whether a session demonstrates new capacity or merely aggressive pacing.

For long runs: distance increases because the runner is TOLERATING current
duration, not just because they completed it. Ask: **did they finish
functioning like a runner who could have reasonably absorbed it?** (pace
stayed controlled, no cardiovascular explosion, no significant form
collapse, next few days normal, no pain/injury signals) — much more
meaningful than `completed: true`.

## State machine

```
decision: PROGRESS | HOLD | REDUCE | RESTRUCTURE
target:   PACE | VOLUME | DURATION | DENSITY | SPECIFICITY | RECOVERY | SCHEDULE
```

Example outputs:

```
decision: PROGRESS
target: THRESHOLD_DURATION
change: +4 minutes total quality
reason: repeated controlled threshold execution
```

```
decision: HOLD
target: PACE
reason: pace is appropriate; current limiter is durability
```

```
decision: PROGRESS
target: LONG_RUN_DURATION
change: 100 → 110 min
reason: recent long-run load consistently absorbed
```

Clean semantics — every decision names what changed and why, matching
Doctrine Enforcement §9's `AdaptationProposal` shape.

## The plan's expected path is a proposal, evidence decides the actual step

```
expected next step + runner evidence = actual next step
```

Ahead of schedule → progression may come sooner. Exactly on track → follow
the plan. Mixed evidence → hold. Struggling → reduce or change the TYPE of
stress (not just less of the same). This — evidence-driven deviation from a
static progression curve — is where faff can beat a static training plan,
and it is the whole reason tonight's rework exists.
