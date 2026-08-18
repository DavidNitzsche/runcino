# Engine doctrine · evidence and levers

**Author: David. Locked 2026-08-17. These are HARD rules. They outrank convenience,
they outrank existing implementations, and any code that violates them is a defect.**

---

## Rule 1 · Fitness changes require evidence

> Time passing, plan completion, or scheduled progression alone cannot increase or decrease
> demonstrated fitness.

The engine may not conclude a runner is fitter because eight weeks elapsed, because the block
reached its race-specific phase, or because the plan said week 8 would be faster. Those are
schedules, not measurements.

**What counts as evidence:** a race, a time trial, a completed quality session with its
physiological response (HR, RPE, decoupling, recovery), a sustained trend across sessions.

**What does not:** the calendar, plan adherence, phase transitions, or the goal.

### Corollary · coming out of a recovery block

The app must not say, in effect, *"eight weeks have passed, congratulations, you're fitter."*
It should **preserve the prior estimate, reduce confidence if warranted, and require fresh
evidence before moving the ceiling.**

### Corollary · the downward direction is symmetric

A bad result is not automatic fitness loss. See Rule 3.

---

## Rule 2 · Training progression is not pace progression

> The engine may progress duration, volume, density, frequency, specificity, or pace. It should
> choose the cheapest effective lever before making the athlete run faster.

Pace is one axis and it is the most expensive one. A normal training app progresses pace because
pace is easy to see. A good coach progresses capacity first.

**Lever order, cheapest effective first:**

1. **Duration at the same physiological effort** — more time at threshold
2. **Density** — reduced recovery between reps
3. **Volume** — weekly mileage
4. **Frequency** — more sessions
5. **Specificity** — closer to race demands
6. **Pace** — only when evidence supports it

### The threshold progression model

1. Establish current threshold effort from **demonstrated** fitness.
2. Early progression increases **time at threshold**: 3×8 → 3×10 → 2×15 → 3×12.
3. If those are completed with stable HR and RPE, acceptable decoupling and normal recovery,
   **confidence increases.**
4. **Only then** does the model test a modest pace increase.
5. If the faster prescription produces excessive RPE, HR drift, failed reps or abnormal recovery,
   **pace backs off while capacity progression continues.**
6. A race, time trial or genuinely strong workout can jump the fitness model faster, because it is
   actual evidence.

---

## Rule 3 · A race result's authority scales with how representative it was

A race enters as a **high-weight observation**, but the model must first estimate whether the
performance was representative before deciding how much authority it gets.

**Factors that modulate authority:**

- Course profile (elevation, terrain)
- Heat, humidity, wind
- Pacing quality (was it evenly paced or a positive-split blow-up)
- Taper and fatigue state going in
- Illness
- Whether the athlete actually raced all-out

**The rule:**

> A clean, flat, well-paced race after a normal taper can move fitness hard.
> A hilly tune-up in heavy training might only nudge confidence or widen the fitness band.
>
> **Bad result ≠ automatic fitness loss.**
> **Bad result + evidence of true underperformance relative to the prior model = re-anchor.**

---

## Why these two rules matter

They make the app **hard to bullshit.** It can still be aggressive, but it has to earn every claim
that the athlete got fitter or less fit. An engine that advances paces on a calendar is asserting a
fitness change it never measured; an engine that re-anchors on one hot hilly race is discarding a
model on one noisy sample. Both are the same failure in opposite directions: **letting something
other than evidence move the fitness estimate.**

---

## Known violations at time of locking (2026-08-17)

| Violation | Where | Rule |
|---|---|---|
| `blendedTPaceForWeek` advances T-pace from measured VDOT toward the goal-derived ceiling on a **calendar** fraction (`weekIdx / round(buildWeeks × 0.6)`) | `lib/plan/generate.ts` | 1, 2 |
| The measured-progress gate is inert after a recovery block, because the recovery composer writes no `pace_blend` anchor for it to read — so the calendar blend runs ungated | `lib/plan/generate.ts` | 1 |
| `fitness_regression` auto-applies a downward re-anchor from a race result with no representativeness check | `lib/plan/adapt.ts` | 3 |
| Progression is modelled on pace and weekly volume only. Threshold **duration**, **density** and **frequency** are not progression levers anywhere in the engine | `lib/plan/generate.ts` | 2 |
