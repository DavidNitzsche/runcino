# Plan simplification doctrine

**Locked 2026-09-02 by David.** Supersedes any earlier instruction that
conflicts with it. Read alongside `PRODUCT_COACHING_DOCTRINE.md`, which states
what the app is for; this states what the app must NOT try to do yet.

---

## The ruling

> *"The work has revealed that too many independent levers can soften, reshape,
> re-phase, refuse, or automatically mutate the plan. That complexity is now
> working against the primary product requirement."*
>
> *"Produce one excellent, aggressive, coherent marathon plan for me that
> remains stable and understandable."*
>
> *"Optimize for one kick-ass marathon plan — not for a generalized coaching
> platform."*

This is not a retreat from the hero statement at the top of `CLAUDE.md`. *Train
the runner you have, build the runner they want to become* still governs. What
changed is the order: the plan must be excellent before anything is allowed to
change it. A coach who cannot write a good week does not earn the right to
adjust one.

---

## What may influence the plan

Exactly these, and nothing else:

- demonstrated running history
- recent and sustained mileage
- long-run history
- demonstrated pace capacity
- marathon durability evidence
- race date and distance
- the stated goal, **kept distinct from current capacity**
- available training days
- his explicit preference for aggressive training
- completed versus future dates
- race and tune-up schedule

## What may not

Decision authority removed — not hidden, not defaulted off, removed. Where
historical data must survive for compatibility, it becomes **observational
only**.

readiness · illness · injury · daily training form or TSB · sleep, HRV, resting
HR, wearable readiness · goal-realism flags · self-declared experience-level
bands · confidence thresholds that change plan structure · automatic
return-to-training ladders · recovery pullbacks · automatic plan-drift rebuilds
· automatic adaptation mutations · legacy mutation writers · transient-state
rebuild triggers · **any hidden rule that silently makes the plan easier or
reorganizes it**

Two of these deserve naming because they were already producing measured harm:

- **Self-declared experience-level bands.** `profile.experience_level` reads
  `advanced` because he typed it at onboarding, yielding a peak band of 65-90
  mi/wk against a measured best week of **48.5** and zero weeks at 50 or above.
  A label he typed was outranking his own record.
- **Daily training form.** `cutbackCadence(tsb) = tsb < -10 ? 3 : 4` re-phased
  **13 of 15 weeks** when his form moved from −6 to −11. A day's reading was
  reorganising a season.

---

## What is kept

A small, explicit set of authoring invariants. They exist to **reject clearly
broken output** — not to tune, shave or cheapen an otherwise valid plan. That
distinction is the whole doctrine in one line.

1. Completed history is immutable.
2. The race date and full block calendar are preserved.
3. No accidental duplicate workouts.
4. Hard days and long runs are intentionally placed.
5. Weekly and long-run progression are deliberate.
6. **Cutback weeks are authored into the plan, not triggered by daily state.**
7. Race-plus-long-run weekends require an explicit authored purpose.
8. The taper is preserved.
9. Pace, HR, effort, notes and workout structure agree.
10. **The plan never derives current capacity from an aspirational goal.**
11. **Missing or unreliable data cannot silently create a more aggressive plan.**

Invariant 11 is Rule 11 pointed at the simplification itself: as inputs are
deleted, no guard may be left reading a source that is now always empty, because
a guard that cannot run is a guard that has silently stopped guarding.

---

## Determinism and explanation

> *"Given the same meaningful inputs, the generator should produce the same
> plan. A one-point change in a transient metric must not re-phase thirteen
> weeks."*

And for every planned week the engine must be able to say: why this mileage;
why this long run; why these quality sessions; why this cutback or recovery
week; how it develops the previous week; how it prepares for the marathon.

Derived by the engine and persisted — not written into a report by whoever built
it, and not a sentence repeated on every row (Rule 17).

---

## Adaptation is deferred

Upward and downward automatic adaptation stay **disabled**. Completed runs may
update evidence and produce an **advisory comparison**; they may not mutate the
live plan.

> *"There must be exactly one future adaptation boundary, disabled by default.
> Remove or seal all legacy mutation paths now so we do not preserve competing
> brains for later."*

One seam, off. Not several dormant ones. And the consequence that follows,
which is the standard the plan is now held to:

> *"The initial plan must stand on its own without requiring adaptation to
> rescue it."*

Nothing may be justified on the grounds that adaptation will fix it later.
