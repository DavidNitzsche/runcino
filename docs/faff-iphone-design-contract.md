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
| **Palette re-lock** | **Done.** The build gate now asserts your palette — black ground, four surface steps, `#FF5A1F` / `#F2B03C` / `#FF4438`, all six day-state gradients — as the phone's lock, and brief v2 is marked superseded on the phone. The old palette is still asserted while screens read from it, and the gate fails the build the moment nothing does. Both typefaces are bundled and registered; the display face is Archivo at wght 800 / wdth 112, which is not a named instance, so it is reached through the variable axes (`Font.faffDisplay`). Tabular figures are on by default and verified: Instrument Sans's default digits are not tabular. |

---

## 5 · Deferred, on purpose

Coached mode, just-run mode, and distance-goal-without-a-race exist in the backend and all
work end to end. They get no phone screens for now. They need a graceful "not on phone yet"
rather than three blank screens — a refusal, not a screen set.

The training calendar and week strip were blocked on a plan day being identified by its
server id rather than its date. **Unblocked.** `/api/plan/week` now sends
`plan_workout_id` on every day and on the hidden second run of a double-booked date;
`/api/training/state` was already sending `id` and the client simply wasn't reading it.
Both structs key identity on the row id and fall back to a `date:`-prefixed key only for
a synthesised rest day. The date is still there and is still the right way to ask "which
day holds this date" — it is a lookup, not an identity.

---

## 6 · "Change the plan" — built, and there are five not four

`POST /api/plan/change` shipped. It proposes first and writes nothing until a confirm
carrying a state token, so "read the trade-off, then confirm or back out" is the actual
contract, not a convention. A token that has gone stale returns *plan moved* rather than
applying to a plan that changed underneath.

**The design lists four scenarios. There are five.** `move_day` was implied by the design
and had no representation; it now exists.

Every trade-off below is real output, not sample copy. Set type against these.

**Cutback** — *"Week 6 drops from 32 mi to 24.5 and the long from 12 to 9.5 · that is 23%
off the week. The second quality session becomes an easy run. You lose a hard week of the
build. Nothing before or after week 6 moves, and the race date does not change."*

**Travel** — *"You are out from 30 September to 6 October. 34 mi come out of week 7 and
they are not made up anywhere · you cannot bank miles. The 12 mi long run on 4 October goes
with it · there is nowhere in that week to put it that leaves the spacing between hard days
intact. You come back through week 9 at 30.5 rather than 34, because a jump straight back
to full is past the acute-to-chronic line doctrine calls high risk. The race date and the
taper do not move."*

**Extra day** — *"From week 10 you run 6 days instead of 5. The weeks keep their miles, so
they come off the runs you already have: your easy days go from 6 to 4 and Friday picks up
4. The long run and the quality sessions are untouched. There is one fewer rest day to
absorb a bad night."*

**Move a day** — *"Your easy run moves from Friday 23 October to Monday 26 October. Friday
becomes rest. The week keeps its 34.5 mi and its hard days stay spaced the way doctrine
asks."*

**Another race** — *"QA Tune-up 10K on 5 September lands in week 3. It becomes that week's
quality session and the days either side go easy. You trade that week's quality session for
a real fitness read 14 weeks out. The long run is not displaced unless the race falls on it.
The rest of the block is re-authored from where you are now, so other weeks can move by a
mile or two. Nothing before today changes."*

### The sheet must be able to refuse

A scenario can come back unavailable with a reason, and the design needs a state for it.
The refusals are real: a cutback on a taper week, a race week, a week already cut, or a week
already underway. A move that would break the spacing between hard days.

**And a two-week travel window is genuinely unsatisfiable.** Shrinking the re-entry week to
the safe line prices its interval session past the weekly cap; demoting that session then
empties a race-specific week. Both rules are right and no edit satisfies both, so the sheet
says so rather than proposing something it cannot do: *"Being away that long is not a week
off, it is a different block."* One-week windows work cleanly.

### Two things not built

**Undo.** The response carries what changed, but nothing restores it.

**Extra day changes the plan, not the saved weekly frequency**, so a later full rebuild
reverts it. That is stated in the response's caveats rather than hidden, and the design
should surface it.
