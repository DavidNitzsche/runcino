# faff.run iPhone — the backend contract

For the Claude Design project. What the app can actually say, what it can never say, and
the one change outstanding after r2.

**Scope: race-mode only, this design, nothing else.** The phone is the hero surface. A
runner with a goal race is the only mode being built. Coached runners, just-run runners
and distance-goal-without-a-race are deferred — they exist in the backend but get no
phone screens for now.

---

## 1 · Four rules the design cannot break

These are enforced in the engine, several as build gates. A screen that contradicts one
will either be untrue or unbuildable.

**A modelled number must never look measured.** This is the only real sin. A projected
finish, a pace derived from training rather than a race, a projection after time off —
all modelled. r2's amber tilde (`~`) is the mark, and it is now a system rule rather than
one screen's fix. Apply it everywhere a number is estimated.

**One signal never changes a session.** Readiness grades from five independent domains and
requires *three* to converge before it can downgrade a session. That is asserted as a build
gate: every domain driven alone at extreme severity must still grade green. So any copy
about a changed session names the convergence, never a single cause.

**A refusal is a correct answer, not an empty state.** The engine declines on purpose: a
week that cannot carry a quality session, a distance we do not plan, a goal out of reach,
a race whose distance we cannot identify. These must not look like the data-outage screen,
which means *we could not read this*. A refusal means *we read it and the answer is no*.

**Coach voice.** Short, direct. No hype, no exclamation marks, no emoji, no em dashes.
Never scold. A product that moralises about a six-hour night is one the runner deletes.

---

## 2 · The decision card — the one outstanding change

The Races card is driven by an eight-value enum. The backend has one too. **They are
different axes and both are real.**

- The design's eight are *why we are asking now* — a discrete event.
- The backend's eight are *what we think of the goal* — a standing judgement, recomputed
  on every read whether or not anything happened:
  `comfortable · realistic · ambitious · aggressive · out-of-reach · open-ended ·
  date-passed · unreadable`

So the card carries **both**. The trigger may be absent (the goal simply drifted); the
verdict is always present.

| Design trigger | Verdict it yields | Card shape |
|---|---|---|
| Fitness ahead of goal | comfortable · realistic | Goal decision |
| Fitness behind goal | ambitious · aggressive · out-of-reach | Goal decision |
| Evidence gone stale | unreadable | Goal decision |
| Returning from injury | out-of-reach · date-passed | Goal decision |
| Race-morning heat | *unchanged* | **Fact** |
| Course changed | *unchanged, projection moves* | **Fact** |
| Chip-time lock approaching | *unchanged until locked* | **Fact** |
| Two A races conflicting | open-ended, loosely | **Choice** |

**Four of the eight are not decisions about the goal.** They ask the runner for a fact or
a choice the engine cannot derive, and the three-button set does not fit them.

So the card needs two bodies under an identical top:

1. **Goal decision** — verdict, safe target, stretch target, up to three cautions, and the
   three buttons naming real numbers (`Hold the goal` / `Take 3:16:45` / `Not now`).
2. **Fact or choice** — one question, its own answers, no safe/stretch pair, no target times.
   - *Heat* — the goal stands, race morning is harder. Acknowledge, or re-pace the day.
   - *Course changed* — we can see the elevation moved; we cannot know which course you will race.
   - *Chip-time lock* — confirm the official time or leave it provisional. Until it locks it
     is explicitly not authoritative for fitness. The engine's own label is already
     "Training effort · race to lock in".
   - *Two A races* — which one is the goal. Nothing in the engine can choose.

A `Take 3:16:45` button under *"is it hot on race morning"* answers a question nobody asked.

**Loose ends.** `open-ended` has no trigger in the design's list — it means a distance goal
with no race booked, which is the deferred mode. `comfortable` and `realistic` almost
certainly collapse into one treatment; the copy differs, the card need not.

---

## 3 · What each new screen can be fed

### Today changed overnight (17a)

Real. The engine downgrades a session at 03:00 so it is settled before the runner wakes.

- Sends: that it changed, what it was, and a sentence naming the convergence.
- **Does not have** an evening reading and a morning reading to compare. Readiness works on
  a 7-day rolling median against a 30-day baseline, and resting heart rate as a 3-day
  rolling average. r2's "what converged" list against rolling baselines is the right shape.
- Real copy: *"Three short nights, four days of low HRV and a resting heart rate above your
  usual. Today is easy running instead. The threshold session comes back when the numbers do."*

### Paces slower / faster (18a)

Real in both directions, and r2's three-variant split is correct.

- **Zones do not move by the same amount.** Measured on a three-point fitness drop:
  threshold `+24 s/mi`, interval `+22`, rep `+19`. There is no single headline delta —
  per-zone rows only.
- `faster-race` is hard evidence: no tilde, and a single action. A race result is not
  noise to dismiss.
- `slower` and `faster-training` are modelled: tilde on every value, and dismissible.
- **Do not assert a cause.** The engine detects the re-anchor; it does not diagnose
  "accumulated fatigue". State the fact; where the diagnosis is not confirmed, say so.

### Return to running (19a)

Real, and r2 matches the protocol.

- Eight stages. **Stage 1 is run 1 · walk 4 × 5.** No walk-only stage.
- Max one stage advance per week, minimum two sessions at each.
- Bone stress injuries are clinician-gated; a niggle is not.

### The confirm on a slower read

Do not ask *"do you accept these paces"* — paces come from evidence and declining them
means training at paces the runner's fitness does not support.

Ask **"did this race count?"** The engine already tiers every race as
`representative / compromised / unrepresentative` and there is no user-facing path to it.
Heat, illness, ran-it-as-a-workout, paced-a-friend are things the runner knows and we do not.

Hard constraint for the copy: if they say it did not count, we fall back to the **next-best
anchor**, not to the old faster paces. Otherwise it becomes a "make me faster" button.

---

## 4 · What the backend is building

Needs nothing from design.

| | Notes |
|---|---|
| **Phone-initiated runs** | The setting that reveals the RUN pill. Recording is **foreground-only** — a phone in a pocket with the screen off stops the run. The treadmill HEART tile has no source without a watch. |
| **Change the plan** | Cutback, travel, extra day are new. "Another race" is already built and produces the design's exact sentence. Each states its trade-off before the runner confirms. |
| **Shoe retirement** | Mileage and percent-used already exist. Adding a shoe type and one agreed default. *Confirm the bands you want: racing 150–250, trainers 400.* |
| **Palette re-lock** | The build gate is being re-pointed at the new palette, and both typefaces bundled. Your palette is canonical. |

---

## 5 · Deferred, on purpose

Coached mode, just-run mode, and distance-goal-without-a-race exist in the backend and all
work end to end. They get no phone screens for now. They need a graceful "not on phone yet"
rather than three blank screens — a refusal, not a screen set.

The training calendar and week strip are blocked on a plan day being identified by its
server id rather than its date. Half-fixed already.
