# Adaptive progression engine

**Author: David. Locked 2026-08-17. Canonical. Supersedes and absorbs
`Design/engine-doctrine-evidence-and-levers.md`.**

> **Fitness must be demonstrated. Progression only needs to be earned.**

The engine must be able to push an athlete toward a faster goal without falsely upgrading their
demonstrated fitness because time passed.

---

## The split · three systems, not one

Today one number does all three jobs. That is the root defect. Split it.

### A · Fitness model — *what can this athlete race today?*

Conservative. Evidence-only. Inputs: races, time trials, high-confidence benchmark workouts,
course/conditions adjustment, workout history, HR/RPE where useful, and the recency and confidence
of each piece of evidence.

**Calendar time alone must never increase fitness. Completing eight weeks of a plan must not
increase VDOT.**

Output is a range with a confidence level:

```
HM fitness estimate: 1:38–1:40
confidence: high
```

Never `1:38:17`. Fake precision is a lie about how well we know the number.

### B · Adaptation model — *how well is this athlete absorbing the training?*

Allowed to move faster than the fitness model. Inputs: workout completion, target adherence, rep
consistency, RPE, HR response, HR drift, recovery after sessions, easy-run behaviour, weekly load
tolerance, consistency, pain and injury signals, repeated over- or under-performance.

Output: `strong · normal · marginal · poor`.

**This is the system that decides whether the athlete has earned more training stress.**

### C · Prescription model — *what should we prescribe next?*

In: current fitness, goal, goal gap, weeks remaining, primary limiter, adaptation state, recent
load, recovery state, injury risk, planned phase. Out: the next training stimulus.

**Explicitly allowed to prescribe training harder than what the athlete has demonstrated. It must
not confuse that with declaring the athlete fitter.**

---

## The rules

### 1 · Goal does not set workout pace

Goal HM 1:30 (6:52/mi) with demonstrated HM fitness ~1:39 does not license threshold at 6:52.
The goal defines the eventual physiological demand. Current fitness defines the starting point.
The engine closes the gap progressively.

### 2 · Progression is not pace progression

Levers, roughly cheapest-adaptation-first:

```
weekly_volume · run_frequency · long_run_duration · quality_duration
interval_duration · number_of_reps · recovery_duration · work_density
pace · race_specificity · goal_pace_exposure
```

Canonical threshold progression:

```
W1  3 × 8 min  @ current threshold effort
W2  3 × 10 min @ same effort
W3  2 × 15 min @ same effort
W4  recovery
W5  3 × 10 min slightly faster
```

Meaningful progression, entirely before the fitness model moves.

### 3 · Calendar proposes, evidence permits

The plan carries a default overload trajectory (W1 24 min → W2 27 → W3 30 → W4 recovery → W5 32 →
W6 34). Progression against it is conditional:

| adaptation | action |
|---|---|
| strong | progress as planned, or slightly accelerate |
| normal | progress as planned |
| marginal | hold current stimulus |
| poor | reduce or modify stimulus |

**Calendar time proposes progression. Evidence permits or modifies it. Calendar time does not
update fitness.**

### 4 · The challenge zone

Training is not capped at demonstrated ability. Every prescribed effort carries an intent:

- **ESTABLISHED** — known manageable stimulus (3 × 10 min @ 7:10–7:15). Purpose: accumulate adaptation.
- **PROGRESSIVE** — slight overload (3 × 12 min at the same effort, or 3 × 10 @ 7:05–7:10). Purpose: create additional stimulus.
- **PROBE** — controlled exposure beyond established capability (reps 1–2 @ 7:05–7:10, final rep @ 6:55–7:00 if controlled). Purpose: test readiness and gather evidence.

**A successful probe does not immediately become new demonstrated fitness.** Repeated successful
evidence moves the fitness model.

### 5 · Goal-pace exposure ramps

Goal pace is not absent until goal fitness arrives. For a 1:30 HM (~6:52/mi):

```
early     6 × 1 min @ goal pace inside an aerobic run
middle    6 × 3 min @ goal pace, generous recovery
later     3 × 2 miles near goal pace
specific  2 × 3 miles near goal pace
peak      5–7 miles total around HM goal demand
```

Duration, density, continuity and specificity all increase. **Goal-pace exposure is training. It is
not proof of goal fitness.**

### 6 · The progression gate

Do not require a new race result for every training progression. The athlete can earn more stimulus
without proving new race fitness.

```
execution      completed? hit intended effort? stable reps?
internal cost  RPE appropriate? HR appropriate? excessive drift?
recovery       normal recovery? next-day fatigue acceptable?
consistency    recent weeks completed? load tolerated?
trend          single good day, or repeated positive evidence?
→ strong · normal · marginal · poor
```

### 7 · Fitness may stay flat while training progresses

This is intended behaviour, not a bug.

| | fitness | workout |
|---|---|---|
| W1 | HM 1:39–1:41 | 3 × 8 min threshold |
| W3 | HM 1:39–1:41 | 3 × 10 min threshold |
| W5 | HM 1:37–1:39 *(repeated evidence)* | slightly faster |
| W8 | HM 1:34–1:36 *(strong 10K race)* | larger adjustment licensed |

### 8 · Downward changes need evidence too

Do not re-anchor downward from every poor race. Diagnose first: course difficulty, heat, humidity,
wind, altitude, race pacing, fatigue, taper state, illness, whether the race was maximal, fuelling.

```
poor_race + conditions_normal + tapered + well_paced + maximal  → meaningful downward re-anchor
poor_race + hilly|hot|fatigued|badly_paced                      → reduce confidence, smaller adjustment
```

**One noisy race should not destroy a stable fitness model.**

### 9 · Goal-gap logic

Maintain continuously: `goal_performance · current_fitness · projected_race_day_fitness ·
goal_gap · weeks_remaining`.

The question is not "is the athlete at goal fitness" — it is **"is the gap closing quickly
enough."** 16 weeks out at 1:39 against a 1:30 goal is a 9-minute gap and may be a healthy
trajectory.

### 10 · Feasibility states

```
SUPPORTED    current trajectory supports the target
REACH        not there yet; the required improvement is realistic
STRETCH      significant gap, but enough time to keep pursuing
UNLIKELY     trajectory does not support the goal without unusual improvement
UNSUPPORTED  time and demonstrated fitness no longer justify training as though it is realistic
```

**Do not silently change the goal.** Propose a revised race target while preserving the original as
a longer-term goal.

### 11 · Limiter-based prescription

Identify what is actually preventing the goal: `aerobic_capacity · threshold · speed_reserve ·
endurance · durability · training_volume · recovery_capacity`.

| limiter | progress |
|---|---|
| threshold | threshold duration → density → eventually pace |
| endurance | long-run duration, aerobic volume, long threshold blocks, race-specific durability |
| speed reserve | strides, short intervals, VO2 work |
| training capacity | frequency, easy volume, long-run consistency |

**Do not simply make every workout faster.**

### 12 · Push logic

```
adaptation strong ∧ recovery good ∧ injury_risk low ∧ consistency high → increase stimulus
```

Change **one or a small number** of major variables at once. Not simultaneously more mileage,
faster threshold, longer long run and more intervals. **Productive overload, not maximal overload.**

### 13 · Recovery blocks

After a recovery block: retain the previous fitness estimate, optionally lower confidence if
evidence is stale, resume progression from the new training response. Never `8 weeks elapsed →
increase VDOT`.

---

## The control loop

```
GOAL → CURRENT FITNESS → GOAL GAP → LIMITER DIAGNOSIS → PLANNED STIMULUS
     → READINESS / RISK CHECK → PRESCRIPTION → ATHLETE EXECUTES
     → RESPONSE ANALYSIS → ADAPTATION UPDATE → FITNESS EVIDENCE UPDATE
     → GOAL TRAJECTORY UPDATE → NEXT PRESCRIPTION
```

Decision after each meaningful cycle:

- **STAY** — current training is working, continue.
- **PROGRESS** — the athlete is absorbing the load, increase stimulus.
- **MODIFY** — the stimulus is not creating the intended response.
- **PROTECT** — fatigue, pain, illness or conditions make progression inappropriate.

---

## Non-negotiable engine rules

1. Time alone cannot increase fitness.
2. Plan completion alone cannot increase fitness.
3. Training progression does not equal pace progression.
4. The app may prescribe beyond demonstrated fitness in controlled doses.
5. Successful harder training can earn further progression before it proves new race fitness.
6. Goal pace may be progressively introduced before goal fitness is achieved.
7. Poor race results must be diagnosed before large downward fitness re-anchors.
8. Strong adaptation should allow the engine to push.
9. Poor adaptation should hold or reduce progression regardless of what the calendar expected.
10. Goal, current fitness and training prescription must remain separate concepts.

**Product principle.** The app should not wait for the athlete to become faster before challenging
them. It should apply the next appropriate overload that is likely to make them faster, measure the
response, and use that evidence to decide what comes next.

---

# Conformance · where the codebase actually stood when this was locked

Audited 2026-08-17 against the shipped engine. Recorded so the gap is a work list, not a memory.

## A · Fitness model

| item | state |
|---|---|
| Evidence-only anchor, freshness bands, fresh-race precedence (`lib/training/vdot.ts:783`) | **GOOD.** The strongest asset. Keep. |
| Fitness as a **range** | **ABSENT.** `bestRecentVdot` is a scalar. |
| Confidence on the fitness estimate | **MISPLACED.** A real `ConfidenceInterval` exists (`goal-projection.ts:77`) but is attached to the goal projection, not to fitness. |
| Non-evidence leaks | **PRESENT.** `conservativeVdotFromMileage(recentWeeklyMi)` substitutes mileage for measurement (`generate.ts:2531`); `BASE_BUILD_RATE = 0.35 VDOT/wk` is calendar gain (`fitness-trajectory.ts:52`); `executionQuality` routes plan completion into projected fitness (`:106`). |

`bestRecentVdot` already assembles `considered[]` — a full candidate distribution — and discards
everything but `[0]` (`vdot.ts:1091`). **The range is nearly free.**

## B · Adaptation model

**Every input signal already exists and is computed. The classifier that consumes them does not.**
Sixteen live signals: missed key workouts, per-session target verdict, rep consistency, tempo
execution, RPE pullback, HR thirds, HR drift and decoupling trend, pace fade, cadence under
fatigue, recovery phase, easy discipline, training form band, personalised readiness, pain and
niggle severity, quality/easy/long drift, and adapter-downgrade frequency.

**They drain into the wrong sink.** `executionQualityFromTestPoints` routes missed workouts and
adapter downgrades into `projectedVdot` — so poor absorption makes the *predicted race time worse*
instead of making the *next workout easier*. The comment at `goal-projection.ts:1551` already names
the correct semantic and still routes it to the wrong consumer.

## C · Prescription model

| item | state |
|---|---|
| Goal pace sets workout pace | **VIOLATION.** `tPaceFromGoal(goalSec)` is the blend destination for all quality work (`generate.ts:2562`); direct goal pace on race day, long-run finish, and tune-ups. |
| Calendar-indexed pace ramp | **VIOLATION.** `blendedTPaceForWeek` ramps on `weekIdx` (`recompute-paces.ts:118`). The evidence gate exists but **is inert on fresh authoring** — `measuredProgressFraction` is only populated when a prior plan for the same race exists, so a new block is pure calendar. |
| Duration / density / rep progression at constant effort | **ABSENT.** Prescription strings resolve once per (distance, phase, level) and repeat every week of that phase. No week index reaches the rep path. Only `densityForWeek` and the volume curve progress. |
| Goal-pace exposure ramp | **PARTIAL.** Real, and the only constant-effort duration ramp in the engine — but long-run only, calendar-keyed, and absent entirely for 5K/10K (`generate.ts:1199`). |
| ESTABLISHED / PROGRESSIVE / PROBE | **ABSENT.** Nearest hook: `nextTestPoints[].passCriteria` already states pass numbers before a run. |

## Extras

- **Limiter diagnosis — ABSENT.** No physiological limiter is diagnosed anywhere. `goal-gap.ts:269` `whatClosesIt[]` returns hardcoded prose where the limiter's output belongs.
- **Feasibility — five overlapping vocabularies.** `GoalStatusTier` (ahead/on-pace/watching/behind), `GoalGapStatus` (closing/static/widening/unclosable), `GoalStatus` (on-track/watching/off-track), `GoalTier` (elite→developing, actually ambition not feasibility), and `goal-ready.ts`'s five TT states. The five-state ladder above replaces the first and reopens the deliberate ruling at `goal-status.ts:18` that collapsed a fifth state into a flag.
- **Downward re-anchor — the most brief-aligned mechanism already shipped.** `detectFitnessRegression` (`adapt.ts:2188`) is evidence-only, suppresses inside race week, and splits race evidence (auto-apply) from training drift (propose-first). What it lacks is rule 8's diagnosis: it does not ask whether the race was representative.
