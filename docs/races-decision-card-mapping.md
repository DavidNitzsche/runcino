# Races · "Needs a decision" card — trigger vs verdict

The r2 design drives the card from an 8-value `verdict` enum. The backend also has an
8-value verdict enum. **They are different axes and both are real.**

- The **design's eight** are *why we are asking now* — a discrete event.
- The **backend's eight** are *what we think of the goal* — a standing judgement,
  recomputed on every read whether or not anything happened.

So the card carries two fields, not one. `trigger` may be absent (the goal drifted, no
event); `verdict` is always present.

## The mapping

| Design trigger | Backend source | Verdict it typically yields | Card shape |
|---|---|---|---|
| Fitness ahead of goal | `fitness-trajectory` `aheadOfGoal` | `comfortable` · `realistic` | **Goal decision** |
| Fitness behind goal | `goal-gap` widening | `ambitious` · `aggressive` · `out-of-reach` | **Goal decision** |
| Evidence gone stale | anchor fade + `STALE_ONSET_DAYS` inactivity decay | `unreadable` | **Goal decision**, but the ask is a test, not a target |
| Returning from injury | injury protocol active / walk-run ladder | `out-of-reach` · `date-passed` | **Goal decision** — the runway shrank |
| Race-morning heat | `race-conditions.ts`, heat band | *unchanged* | **Fact** |
| Course changed | `course_source`, `promoted_to_library_iso`, `course-impact.ts` | *unchanged*, projection moves | **Fact** |
| Chip-time lock approaching | `actual_result.provisional` · `'Training effort · race to lock in'` | *unchanged until locked* | **Fact** |
| Two A races conflicting | `auto-rebuild` `race_mismatch` | `open-ended` closest | **Choice** |

## The consequence for the design

**Four of the eight are not goal decisions**, and the three-button set
(`Hold the goal` / `Take 3:16:45` / `Not now`) does not fit them. They ask the runner
for a fact or a choice we cannot derive:

- *Heat* — the goal stands; race morning is harder. Acknowledge, or re-pace the day.
- *Course changed* — did you run the new course? We can detect the elevation changed;
  we cannot know which one you will race.
- *Chip-time lock* — confirm the official time, or leave it provisional. Until it locks,
  the result is explicitly not authoritative for fitness.
- *Two A races* — which one is the goal? Nothing in the engine can choose.

So the card needs **two shapes**:

1. **Goal decision** — verdict, safe target, stretch target, up to three cautions,
   and the three buttons naming real numbers.
2. **Fact or choice** — one question, its own answers, no safe/stretch pair.

Forcing all eight into shape 1 would put a "Take 3:16:45" button under "is it hot on
race morning", which is not a question about the goal.

## Two loose ends

- `date-passed` and `open-ended` have no design trigger. `open-ended` is a real state —
  a distance goal with no race booked — and it is exactly the goal-mode panel that has
  no design yet.
- `comfortable` and `realistic` almost certainly collapse into one treatment. The copy
  differs; the card does not need to.
