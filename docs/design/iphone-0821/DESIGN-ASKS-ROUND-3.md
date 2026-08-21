# Round three · what the phone build needs from design

Written after building the 0821 set. Everything below is a real block or a
deliberate deviation I want ruled on, not a preference. Six items, ordered by
how much they cost to leave open.

---

## 1 · The third poster stat has no doctrine behind it

**Blocking, and it has been open since round two.**

0821 still specifies a three-value stats plate on the before-run poster:
**pace band / ceiling / effort**. The build ships two.

The reason is not laziness. There is no doctrine anywhere in `Research/`
prescribing an RPE band per workout type, and a locked project rule says the
engine may not extrapolate beyond the research — every rule carries a
citation. A prescribed effort number would be one we invented, which is
exactly what rule one exists to prevent.

The after-run screen already does the right thing: effort there is the
runner's own 1-10, tappable, measured. That one is real.

**Pick one:** two stats before the run and three after (recommended, and what
is built) · name a third stat the engine can actually derive from the plan ·
or rule that an invented band is acceptable, on the record.

---

## 2 · 22b covers looking back. Nothing covers looking forward.

22b is reached by tapping a past "Done" row in the training calendar, and its
own note says it exists because a stepped-to day "cannot be mistaken for
today". Agreed, and built: quiet flat fill, no week strip, no account disc,
"‹ Today" standing where the disc was.

**But a runner asking "what is Friday" has nowhere to go.** The week strip was
the only thing that ever offered that, and 22b replaces the strip as
navigation without replacing that job.

I made a call to keep building, and I want it confirmed or overruled:
**the gradient means today, in both directions.** A stepped-to Friday gets the
same quiet treatment as a stepped-to Tuesday. Every word survives — the kicker
still names the state, the type still reads EASY — but the day-state ramp
does not. A planned Friday carries a real day-state and the gradient would be
truthful there, which is precisely the trap: truthful and still mistakable for
today is the failure the screen exists to prevent.

One rule, no exceptions, nothing to misread. If you want a distinct
forward-day treatment instead, it needs drawing.

---

## 3 · The gradient panel fails contrast, and it is the most-read surface

White on the quality ramp's amber (`#F3AD38`) measures **1.94:1**. AA text
wants 4.5:1. This is the panel every runner reads first, every day.

It is not fixable by nudging opacity. It needs either a darker ramp end
behind text, a scrim under the text block, or ink that changes with the ramp.
Design's call which — but it does need one.

---

## 4 · The route map grades a number good

The run-detail route colours by pace with a hue ramp that runs green at the
fast end. Green as a verdict is out everywhere else in this palette,
deliberately, and a fast mile inside an easy run is not good — it is off the
prescription.

The split chart I just built resolves the same problem the other way: filled
in signal when the mile sat inside what the session asked for, one flat grey
when it did not, in **both** directions. Fast is not graded good.

Should the route follow that logic, or stay a single-hue intensity ramp with
no verdict in it at all? The 0821 spec says "single-hue signal-orange opacity
ramp, never a second hue" — the build has not caught up, and I would rather
change it once, correctly.

---

## 5 · The split chart has no axis, and I deviated on one bar

Built to spec: bars only, no labels, no scale. It reads beautifully as the
shape of a run. It cannot answer "which mile was that". VoiceOver carries mile
and pace per bar, so the data is not lost — but sighted readers get shape
only. Confirm that is intended.

**The deviation:** a 13.2 mile run reports fourteen splits and the last is two
tenths long, measured over the shortest distance and therefore swinging
hardest. Drawing it full width claims a weight it does not have, so it is
drawn at its real fraction and VoiceOver calls it a part mile. Same principle
as the amber tilde — nothing should look like more than it is. If you want
equal widths back, say so and I will revert it.

---

## 6 · Small, but they recur

- **ZoneBar on a race** renders Z4/Z5 in flat greys. On the one run where
  time-in-zone is the whole story, it is the least legible element on screen.
- **Sheet height.** `V5SheetHost` sizes to content with no maximum. The
  another-race trade-off runs to six sentences and 0821 warns the sheet "must
  hold its longest realistic string without scrolling". A guard is in, but the
  longest strings want checking against a real drawn sheet.

---

## 7 · Two phone screens the 0821 set does not draw · raised by the watch build

Both come from the watch handoff's commitment that "the watch does not quietly
forget" — every decision taken on the wrist surfaces on the phone.

**A decision needs a shape, and the asked-vs-ran table is the wrong one.**
The wrist can lift a ceiling, skip a rep as a deliberate choice rather than a
failure, or extend a recovery. Neither 5b nor 23a has anywhere to put that.
The asked-vs-ran table compares numbers; a decision is a choice with a reason,
and routing it through that table flattens it into a delta — which reads as a
miss. This is rule two's territory: the copy has to name why the runner
decided, not just what changed.

**The hours after a race, holding a watch time and no chip time.** The phone
has a race-day mode. It has nothing for the window between crossing the line
and the result being official — which is precisely when the runner looks at
it most. The watch hands off to this screen and it does not exist. The
race-data rule already governs what it may claim: a watch clock is a training
effort until the chip time lands, and must never render as a personal record.

Neither will be improvised into 5b. Holding for a drawn shape.

---

## Not asks · things 0821 got right that are now built

Worth saying, because these were judgement calls that could have gone wrong:
the three Races card shapes switch on `card.shape` and never on verdict; shoe
retirement bands stay backend-owned with no figure hardcoded; a refusal is an
Alert with no confirm, and all five change-the-plan scenarios now reach the
engine.
