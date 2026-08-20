# What the phone needs from design · round two

Everything below came out of running the app against David's live account
on 20 August 2026, after the first batch of asks was already sent. None of
it blocks the build — every item is shipped and working, drawn with the v5
tokens and the closest existing pattern. These are places where I made a
judgement the handoff does not cover, and where a real design would beat
mine.

Ordered by how often a runner will see it.

---

## 1 · The week strip as navigation

The handoff draws the strip as a *read*: seven days, today marked. It is now
also the way through the week — tapping a day loads that day, and the panel
carries a "Today" chip to come back.

**What I chose.** The tapped day takes the selected-pill treatment the
current day already has; the panel cross-fades between days rather than
dropping to black. The header swaps `TODAY` for the day's own date
(`FRI 21 AUG`) and puts the return chip beside it.

**What design should settle.** Whether a day you have *stepped to* should
look different from *today* — right now they are identical, so at a glance
you cannot tell you are looking at Friday until you read the header. And
whether the strip should scroll into the next week or stop at the boundary.

## 2 · Add a race, and the course import

There is no add-a-race screen in the handoff. It is a pushed screen now,
with the standard AppBar: name, date, distance, priority, goal, then a
course step that takes a Strava route URL or searches Strava by name.

**What design should settle.** The whole screen. In particular the course
step — right now it is a text field, a button, and a list of candidate
routes with distance and elevation. It is the one part of the app where the
runner is asked to go and find something.

## 3 · Add a pair of shoes

Also not in the handoff. It expands in place at the bottom of Shoes: brand,
model, type, optional mileage cap. The retirement band comes from the
engine off the shoe type, never typed.

## 4 · The plan-change input steps

"Change the plan" offers five scenarios. Three of them need an answer
before the engine can propose anything, and the handoff draws none of the
asking:

- **Add a day** — seven weekday rows.
- **Move a day** — this week's movable sessions, then that session's open days.
- **Add a race** — the runner's own upcoming B and C races.

I used plain list rows in both steps. Travel's date-range step was already
designed and I matched its shape.

## 5 · Past run detail

The run log and one run out of it are both built (splits with HR and
elevation, the pace-gradient route map, the zone bar, shoes worn). Neither
is in the handoff.

**What design should settle.** The zone bar in particular. It is a
proportional bar with the zone labels under it; when a run sits entirely in
two zones — a race does — five evenly spaced labels under two blocks
misread badly, so each label now takes its own bar's width and an empty
zone gets no label. It works, but it is a workaround, not a design.

## 6 · The third poster stat

Still open from round one. The 5a poster has three stat slots; the engine
fills pace band and HR ceiling and has no constant for the third (the
design shows an effort/RPE band). It ships with two rather than inventing
one. Either name a third stat the engine can actually derive, or bless the
two-stat poster.

## 7 · The sick flow

Built from the backend's own vocabulary — symptom codes, a `started` enum,
a trend check-in that mirrors the injury flare. Not in the handoff, and
unlike injury it has a *recovery* concept (the episode clears) that the
injury ladder does not.

## 8 · Two small ones

- **A calendar button after the run.** The before-run and rest-day headers
  carry one; the after-run header does not. If that is deliberate, it is
  fine — say so and I will leave it. If not, it needs the month sheet.
- **A race with no priority** leaves an empty chip-sized gap in the Races
  list (Big Sur, in David's data). Either a fourth chip state or collapse
  the column.
