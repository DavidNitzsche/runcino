# Answers to the design questions

Where the engine already decides something, I have given you its answer rather
than an opinion. Two of these are not really design calls — the shoe types and
the third stat are both constrained by what the backend can honestly produce.

---

## 1 · Third poster stat · pace / ceiling / effort

**Two stats before the run. Three after it.**

The question is right that no RPE-band doctrine exists per workout type, and a
locked project rule says the engine may not extrapolate beyond the research —
every rule needs a citation. So a prescribed effort band would be a number we
invented, which is the one thing rule one forbids. Not a placeholder either: an
empty third slot is a promise of a number.

But the option list misses a real third stat. **After** the run the poster can
carry three honestly, because effort is no longer prescribed — it is measured.
The after-run screen already asks "how hard was it" on a 1-10 scale and the
runner answers it. That is their own number, not ours.

So: the before-run poster is a two-stat plate (pace band, HR ceiling). The
after-run poster is a three-stat plate (distance, time, pace) and effort sits
below it as the runner's own answer. If you want three slots on the before-run
poster, the third has to come from doctrine that does not exist yet, and I would
rather ship two than invent one.

---

## 2 · Course import · when the URL fails or finds nothing

**Let them skip the course and finish adding the race.**

Rule three: a refusal is a correct answer. Blocking the race on a course would
mean a missing Strava route stops a race from existing, and the race is the
important object — it anchors the plan, the taper and the projection. The course
is detail.

Three supporting reasons:

- Plenty of races have no Strava route at all. Blocking would make those races
  unenterable.
- The race screen already handles a course-less race honestly. It says "No
  elevation data yet." and draws no profile — it does not pretend or fail.
- Elevation is now a *measured, trust-gated* field, not a typed one. A course
  added later upgrades the race cleanly; a course guessed at to get past a
  blocker would poison it.

What the screen should do on a failed search is name what happened and offer the
two ways forward — try a different name, or continue without a course. Not an
error state.

---

## 3 · Shoe types · the set to offer

**The five in the form are not the set the engine knows, and the label is not
cosmetic — it selects a doctrine-gated retirement band.**

The backend has eight categories, each bound to one row of
`Research/17-footwear.md` § "Mileage Lifespan by Category", and CI asserts each
band against that table:

| Offer this label | Doctrine band | Default retirement |
|---|---|---|
| Daily trainer | 400–500 mi | 400 |
| Max cushion | 400–600 mi | 400 |
| Stability | 400–500 mi | 400 |
| Trail | 300–500 mi | 400 |
| Tempo trainer | 300–400 mi | 350 |
| Super shoe | 150–250 mi | 250 |
| Racing flat | 200–300 mi | 250 |
| Track spike | 100–200 mi | 150 |

Two things the proposed five would break:

- **"Racing (super shoe)" collapses two different shoes.** A plated super shoe
  and a racing flat have different bands (150–250 vs 200–300), and the super
  shoe additionally carries a frequency limit from `Research/00b` — at most 1–2
  sessions a week, because bone and connective tissue still take the full load.
  A racing flat carries no such limit. Merging them loses a real distinction the
  engine already encodes.
- **Max cushion is missing**, and it is the category that would misband most
  often — it is a 600-mile shoe being offered a 500-mile label.

Offer all eight. It is one select and eight rows is not a burden; a runner who
picks the wrong band gets told to retire a shoe hundreds of miles early or late.

---

## 4 · Where does browsing past runs live?

**Both — they answer different questions.**

- The list answers "show me my history": scroll, grouped by week with weekly
  totals, tap into any run. That is the door for browsing.
- The calendar answers "what did I do on the 12th": you already know the day.

One route, two doors. The list is built and live (120 runs, 872 mi, grouped by
week, race runs labelled). One correction to the option as written: its door is
currently in **Block**, not Today — "Runs · Everything you've logged, splits and
all". Today is the day you are on; Block is the shape of the training. If you
would rather it hang off Today, say so and I will move it, but I think it reads
better where it is.

The calendar door is the part that does not exist yet: past days in the calendar
sheet are not tappable. That is the one to design.

---

## 5 · The ‹ › day-stepping control

**That control no longer exists — David killed it during the build.**

His instruction was: no arrows, just make the week strip days tappable, with a
transition that does not go to black. So what is shipped now is:

- Tap any day in the strip and that day loads, panel cross-fading rather than
  blanking.
- The header swaps `TODAY` for that day's own date (`FRI 21 AUG`) and puts a
  `Today` chip beside it to come back.
- The calendar sheet button stays in the header for jumping further out.

So the real open question is not "keep the arrows or use the calendar" — it is
the one in my round-two asks: **a day you have stepped to looks identical to
today.** The selected pill is the same treatment in both cases, so at a glance
you cannot tell you are looking at Friday until you read the header. That is
worth a design.

---

## 6 · Sick flow relative to injury flare (13a)

**Give it its own shape.**

They behave differently in a way the screens have to show:

- **Illness ends. Injury graduates.** A sick episode has a `recovered` state
  that clears it server-side by itself. Injury has an eight-stage walk-run
  ladder and a clinician gate before the ladder even opens. Mirroring 13a would
  bolt a return-to-running ladder onto something that just stops.
- **The check-in means different things.** Injury asks how the tissue feels and
  the answer moves you along a ladder. Illness asks for a daily *trend* —
  better, same, worse, recovered — and the answer either holds you or ends the
  episode.
- **The return gate is different.** Illness has real physiological gates that
  injury does not: fever-free for 24 hours, sleep back up, resting HR near
  baseline. Those are conditions, not stages, and there are no payload fields
  for them yet — flag that as a backend ask if you design them in.

What it should keep from 13a is the *posture*: a quiet panel with no day-state
gradient, because there is nothing prescribed. Same posture, different shape.
