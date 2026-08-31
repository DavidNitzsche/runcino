# faff.run — Reference Case: Easy Run in Warm Conditions

**Real run, David's account, 2026-08-31. Locked as a doctrine regression
fixture — see `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §11-13
(doctrine test suite / golden runners). This is not a hypothetical — the run
exists in production (`runs` table, `user_uuid =
0645f40c-951d-4ccc-b86e-9979cd26c795`, `apple_watch` source, ~6.18mi, avg HR
147, 2026-08-31).**

## Purpose

A real-world example of how faff should ingest, classify, interpret and
learn from an ordinary training run. The lesson is not whether this run was
"good" or "bad" — it demonstrates how the system should distinguish what was
planned, what actually happened, what the runner felt, what the sensors
recorded, environmental effects, useful fitness evidence, training stimulus,
and whether anything actually needs to change. The desired outcome is
intelligent interpretation without unnecessary adaptation.

## 1. Runner intent

Intended: **Easy running**. Subjective experience: did not feel
progressively harder; effort remained generally comfortable; weather felt
somewhat hot; noticed heart rate increasing despite effort not subjectively
increasing; Apple post-run effort rating **4/Moderate**.

```
planned_intent: EASY
subjective_execution:
  effort: MODERATE
  perceived_progression: STABLE
  heat_perception: WARM
  felt_harder_over_time: FALSE
```

Subjective information matters — it helps EXPLAIN objective data, it does
not override it.

## 2. Raw activity

Distance 6.17mi · Workout time 51:35 · Elapsed time 55:00 · Avg pace
8:21/mi · Avg HR 147 bpm · HR range 75-164 · Avg power 286W · Cadence
162spm · Elevation +167ft · 76°F / 65% humidity · Reported effort 4/Moderate
· Vertical oscillation 10.1cm · Ground contact time 249ms · Stride length
1.1m.

## 3. Splits

| Mile | Pace | HR | Power |
|---|---:|---:|---:|
| 1 | 8:15 | 129 | 286W |
| 2 | 8:11 | 142 | 292W |
| 3 | 8:17 | 147 | 280W |
| 4 | 8:19 | 153 | 284W |
| 5 | 8:30 | 153 | 282W |
| 6 | 8:30 | 155 | 291W |
| final partial | 8:41 | 158 | 308W |

Pace stable. Power remarkably stable. Heart rate gradually increased.

## 4. Data quality

- **Pace/GPS: HIGH** — consistent, no large anomalies.
- **Power: HIGH** — ~280-292W throughout, agrees with pace on stable
  external workload.
- **Heart rate: MODERATE-HIGH** — the HR graph contains several abrupt
  downward spikes, likely brief pauses at crosswalks/interruptions rather
  than physiological events. Should NOT be read as sudden recovery or
  unusual cardiovascular behavior. **Implementation rule: brief stops and
  crosswalk pauses should be identified BEFORE calculating HR drift or
  aerobic decoupling. Where possible, calculations should operate on
  moving/eligible segments rather than treating stop-and-start behavior as
  continuous steady-state running.**
- **Continuity: MODERATE** — workout time 51:35 vs elapsed 55:00, ~3.5
  minutes outside active time, consistent with the reported interruptions.
  Reduces confidence in precise decoupling calculations; does not make the
  activity unusable.

## 5. Environmental context

76°F / 65% humidity is meaningful context. Warm enough that increased
cardiovascular cost is plausible even without a corresponding rise in
perceived effort. Rising HR must NOT in isolation be read as declining
fitness, excessive effort, poor aerobic conditioning, failed easy running,
or inadequate durability. **Environmental stress provides a plausible
partial explanation for increased cardiovascular cost.** The system does not
need to invent an exact "heat-adjusted pace" — it needs to change how
confidently it interprets the observed HR response.

## 6. Planned vs observed

```
planned_intent: EASY
observed_execution: EASY_TO_AEROBIC_STEADY
subjective_effort: MODERATE
external_output: STABLE
internal_cost: GRADUALLY_RISING
```

Do not rewrite the workout label. Do not call it a failure. Do not pretend
execution was identical to intent either.

## 7. What actually happened

**External output remained stable while internal cardiovascular cost
gradually increased.** Correct interpretation: "the cardiovascular cost of
maintaining approximately the same external workload increased as the run
progressed" — NOT "the runner was progressively struggling."

## 8. Cardiovascular drift

Detected, moderate magnitude, MODERATE confidence (warm conditions,
humidity, crosswalk interruptions, opening-portion HR settling, only ~52
active minutes, rolling terrain, unknown hydration/fatigue all argue for
conservatism).

```
cardiovascular_drift: { detected: TRUE, magnitude: MODERATE, confidence: MODERATE }
interpretation: { physiologically_real: LIKELY, heat_contribution: PLAUSIBLE, durability_implication: WEAK }
```

Do NOT apply `decoupling > 5% → durability problem`. That violates doctrine.

## 9. Fitness evidence produced

- **High-intensity capacity: NONE.** No appropriate high-intensity work. Do
  not update.
- **Threshold capacity: ESSENTIALLY NONE.** Nowhere near the sustained
  effort needed to identify threshold capability. Do not derive threshold
  from this run merely because pace and HR exist. Do not update.
- **Durability: LOW-TO-MODERATE SUPPORTING EVIDENCE.** Stable external
  workload + increasing cardiovascular cost is relevant to aerobic
  durability, but the activity is short, environmentally affected, and
  interrupted — enters the evidence ledger without materially moving the
  durability anchor by itself.

## 10. Evidence ledger entry (conceptual shape)

```
AEROBIC_DURABILITY_OBSERVATION
  date: 2026-08-31
  duration: 51:35 active
  distance: 6.17mi
  intent: EASY
  observed_execution: EASY_TO_AEROBIC_STEADY
  external_load: STABLE
  pace_stability: HIGH
  power_stability: HIGH
  cardiovascular_drift: MODERATE
  subjective_effort: MODERATE_AND_STABLE
  environment: WARM_HUMID
  interruptions: CROSSWALK_PAUSES_PRESENT
  reliability: LOW_TO_MODERATE_FOR_DURABILITY
  anchor_effect: SUPPORTING_EVIDENCE_ONLY
```

## 11. Fitness update

High-intensity: UNCHANGED. Threshold: UNCHANGED. Durability: CENTRAL
ESTIMATE UNCHANGED (observation added to ledger only). Overall fitness: NO
MATERIAL CHANGE. **The system successfully learned something without
deciding that fitness changed.**

## 12. Training load

Still matters substantially as training: ~52min aerobic running, 6.17mi
volume, aerobic stimulus, musculoskeletal load, training consistency,
durability exposure, environmental-response data. **Training stimulus and
fitness evidence are different concepts** — a workout doesn't need to update
a fitness anchor to be valuable.

## 13. Readiness / recovery

Nothing here suggests unusual recovery concern (pace maintained, power
maintained, no increasing-difficulty report, duration completed, moderate
rating). `recovery_cost: NORMAL_TO_MODERATE`, `readiness_concern:
NONE_FROM_THIS_ACTIVITY_ALONE`. The next workout should not automatically
change because HR increased — readiness should consider surrounding
training before deciding that.

## 14. Plan adaptation

Does NOT justify: changing threshold/high-intensity/easy pace, changing
race prediction, reducing or increasing fitness, changing the goal, changing
the next workout by itself. **PLAN ADAPTATION: NONE.**

## 15. Easy-run interpretation (the coaching line)

Not: "You ran your easy run too hard." Better: **"You kept the run
controlled, but cardiovascular effort drifted upward later despite similar
pace and power. Warm conditions likely contributed. On similar days, it's
fine to let pace slow slightly to preserve easy effort rather than trying to
hold a number."**

## 16-17. Longitudinal value

One run doesn't redefine easy pace, but the observation is retained. If
similar conditions repeatedly produce ~8:20 pace / ~285W / HR rising into
mid-150s, while cooler conditions produce the same pace/power with HR
staying mid-140s, the system learns an individualized environmental
response — eventually: "it's warmer today, don't worry about pace, run by
easy effort and expect it to be somewhat slower." That beats globally
slowing prescribed easy pace off one warm run.

The real adaptation signal, longitudinally, isn't "pace got faster" — it's
"the runner can sustain equal or greater external output for longer at
lower and more stable internal cost under comparable conditions."

## 18. Running dynamics

Cadence, vertical oscillation, ground contact time, stride length: store
them. Do NOT automatically produce coaching from them — insufficient
evidence from one activity to justify intervention. Future value comes from
personal longitudinal patterns (e.g. "ground contact time consistently
increases late in long runs at the same point pace begins deteriorating"
could become fatigue/durability evidence). **Doctrine: store potentially
useful signals, only surface them when they change a coaching decision.**

## 19. Backend summary shape

```
ACTIVITY CLASSIFICATION: Easy → Aerobic Steady
INTENDED STIMULUS: Easy aerobic development
ACHIEVED STIMULUS: Aerobic development
EXECUTION: Controlled
PACE STABILITY: High          POWER STABILITY: High
CARDIOVASCULAR COST: Increasing    SUBJECTIVE COST: Stable/Moderate
ENVIRONMENTAL LOAD: Moderate
HIGH-INTENSITY EVIDENCE: None      THRESHOLD EVIDENCE: None
DURABILITY EVIDENCE: Low-Moderate Supporting
FITNESS CHANGE: None               READINESS CONCERN: None apparent
PLAN CHANGE: None
PRIMARY TRAINING VALUE: Aerobic volume + consistency
SECONDARY MODEL VALUE: Durability + environmental-response observation
```

## 20. What the runner should actually see

> **Solid easy miles.** You kept pace and power very steady throughout.
> Heart rate gradually rose later even though you didn't feel like the
> effort was increasing. It was warm and humid, which likely contributed.
> On similar days, don't worry about holding pace — let it slow if needed
> and keep the effort genuinely easy.
>
> **Training effect:** Aerobic development · **Plan:** No change

## 21. What we should NOT say

"Your aerobic fitness decreased." / "Your durability is poor." / "You
exceeded your HR zone." / "Your easy pace should now be slower." / "Your
fitness score changed." / "You need to increase your cadence." / "Your
decoupling was X%, therefore..." — the evidence does not justify any of
these.

## 22-23. Why this case matters

A simplistic system sees "HR increased" and concludes "effort increased" or
"fitness problem." A better system sees "HR increased + pace stable + power
stable + perceived effort stable + warm/humid conditions + brief
interruptions" and concludes "there was increasing cardiovascular cost,
likely influenced by conditions, but no evidence that anything is wrong or
that fitness changed" — then stores the observation. That's the difference
between data analysis and coaching. Before this run: fitness belief
essentially unchanged. After: training/load/aerobic/environmental-response
history all richer, durability evidence slightly richer, future comparable
runs have a baseline, plan remains intact. **Learning does not require
adaptation.**

## 24. Implementation lessons — the acceptance checklist for this fixture

1. Crosswalk pauses identified and excluded/downweighted in continuous
   physiological analysis.
2. Opening HR stabilization not mistaken for massive aerobic drift.
3. Environmental context modifies interpretation, does not manufacture an
   exact corrected pace.
4. Subjective effort retained alongside sensor data.
5. Planned workout type and observed execution remain separate fields.
6. An intended easy run can classify as slightly more aerobic/steady
   without being marked failed.
7. Stable pace/power with rising HR creates a durability observation.
8. One moderate-duration warm run does not materially alter durability.
9. Produces no threshold or high-intensity fitness update.
10. Produces no automatic pace adjustment.
11. Produces no automatic race-prediction adjustment.
12. Produces no unnecessary plan adaptation.
13. The activity remains valuable as training even with little fitness
    evidence.
14. Running-dynamics metrics stored but silent unless they eventually
    affect a coaching decision.
15. The user-facing explanation is dramatically simpler than the underlying
    analysis.

## Reference-case verdict

Intent: Easy · Observed: Easy → aerobic steady · Execution: Controlled ·
Conditions: Warm/humid · Pace: Stable · Power: Stable · HR: Gradually
rising · Perceived effort: Moderate, not progressively harder · Likely
interpretation: Normal cardiovascular drift with environmental contribution
· Training benefit: Good aerobic volume and consistency · High-intensity
evidence: None · Threshold evidence: None · Durability evidence:
Low-moderate supporting · Fitness update: None · Race prediction update:
None · Plan adaptation: None · Coaching action: On similarly warm days,
allow pace to float slower if necessary to preserve genuinely easy effort.

## Guiding lesson

This run should teach faff something without forcing faff to do something.
Useful aerobic training was completed. The physiological response contained
information. The conditions helped explain that response. The information
was not strong enough to justify changing fitness. Correct coaching
decision: **record it, understand it, use it as context for future runs,
don't overreact to it.**
