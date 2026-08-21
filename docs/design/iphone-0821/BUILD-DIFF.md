# 0821 handoff · what changes, and two decisions I need

The 2026-08-21 handoff covers the whole iPhone surface (5a–19a, final) and adds
seven pieces the v5 kit had no shape for (20a–24a, first pass). This is the diff
against what is actually built and shipping.

Source of truth is now
`/Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_iphone_app 0821/`.
Its README is copied here as `HANDOFF-README.md` so the repo carries the spec.

---

## Already built, and the handoff confirms it

Twenty of the twenty-five screens need no change. Worth naming three where the
handoff is explicit and the build already agrees, because they were judgement
calls:

- **Races · the three card shapes.** The handoff splits eight triggers into
  Decision / Fact / Choice and says a target-naming button under a heat question
  "answers something nobody asked". The build already switches on `card.shape`,
  never on verdict and never by sniffing whether targets are present.
- **Shoes · retirement bands are backend-owned.** "Don't hardcode figures from
  this doc." The build reads them from the engine's own shoe-type config.
- **Change the plan · refusal is an Alert with no confirm.** Built, and all five
  scenarios now reach the engine (three of them could not be answered at all
  until yesterday).

## Built provisionally · needs bringing onto the approved design

| Piece | Built as | Approved design | Work |
|---|---|---|---|
| Add a race | One pushed screen, details + course together | **20a sheet** for details → **20b pushed screen** for course import | Split it. The sheet holds name/date/distance/priority/goal; Continue pushes to a dedicated import screen because it is a real network round trip. |
| Course import | Text field, button, candidate list | **20b, four explicit states** — idle, loading (skeleton, no shimmer), found (name, distance, mini elevation profile, amber `~` when found distance disagrees with entered), failed (`Alert tone="fault"`) | Rebuild. Failure must never block saving — "Skip for now" and "Add manually" always present. That matches the answer I gave, so no conflict. |
| Add a shoe | Brand, model, type, optional mileage cap | **21a** — name, type, **starting mileage**; no band or retirement number anywhere | Drop the cap field (band is backend-owned), add starting mileage. Replace the placeholder eight types with the real eight from `Research/17` — the handoff says so explicitly. |
| Run detail | Splits as list rows | **23a** — per-mile split **bar chart**, plus route-by-pace, elevation, ZoneBar, shoes, coach line | Swap the split list for the bar chart. Everything else is built. |
| Sick | Built from backend vocabulary | **24a** — keeps 13a's posture, not its structure; Better/Same/Worse, no return ladder | Check the built flow against 24a; likely close, since the handoff reached the same conclusion I did. |

## Genuinely new · not built

- **20b course import** as its own screen with the four states above.
- **22b · a stepped-to day.** Today's poster grammar, but the panel drops the
  day-state gradient for a quiet flat fill, no avatar, no week strip, and a
  "‹ Today" link where the avatar would be.
- **The calendar sheet's past "Done" rows become tappable**, which is 22b's only
  drawn entry point.

---

# Two decisions I need from David

## 1 · The third poster stat

The handoff still specifies a three-value stats plate on the before-run poster:
**pace band / ceiling / effort**. The build ships two.

The reason is not laziness. There is no doctrine anywhere in `Research/` that
prescribes an RPE band per workout type, and a locked project rule says the
engine may not extrapolate beyond the research — every rule carries a citation.
So a prescribed effort number would be one we invented, which is what rule one
exists to prevent.

Note the handoff already does the right thing on the **after**-run screen: effort
there is the runner's own 1–10, tappable, measured. That one is real.

**Options:** ship two before the run and three after (my recommendation, and what
is built) · or name a third stat the engine can actually derive · or David decides
an invented band is acceptable and I will build it, on the record.

This crossed with my answers doc in the post — the designer may simply not have
seen it yet.

## 2 · Day stepping · the design replaces what you asked me to build

You asked for this directly: *"Nothing in the week strip seems clickable, should
be able to go forward and back in days."* I built it — tap any day in the strip,
the panel cross-fades, a "Today" chip returns you.

The handoff replaces that mechanism. 22b is reached **from the training-calendar
sheet, by tapping a past "Done" row**, and its own note says it exists because a
stepped-to day "cannot be mistaken for today, which was the open risk in the
day-stepping control this replaces." So the designer read my round-two ask and
answered it — but by removing the strip as navigation.

That leaves a real gap: **22b covers looking back at a run you did. It does not
cover looking forward at Friday's planned session.** The strip is the only thing
that ever offered that, and the handoff has no shape for it.

**Options:**

- **Keep both.** Strip taps stay for forward days (they carry a real day-state,
  so the gradient is correct there), and past days route to 22b's quiet
  treatment. Two mechanisms, but each is honest about what it shows.
- **Design's way only.** Strip becomes decorative, everything goes through the
  calendar sheet, and I ask the designer for a forward-day shape.
- **Drop forward stepping.** You only ever wanted to look back, and I
  over-read the original request.

I lean to the first. A planned Friday and a finished Tuesday are genuinely
different objects and should not share a screen — but a runner asking "what is
Friday" should not have to open a sheet to find out.

---

## Sequencing

Five agents are auditing engine correctness — treadmill tracking, outdoor GPS,
ingest and dedup, onboarding, watch and push. Their fixes touch the same files
some of this work would. The seven new pieces are mostly new files and can start
without colliding; the two decisions above gate what I build in Today.

One defensive fix I will make regardless: `V5SheetHost` sizes to its content with
no maximum and no scroll, which is exactly how add-a-race ended up with its title
under the clock and its buttons under the tab bar. The handoff warns that the
another-race trade-off runs to six sentences and "the sheet must hold its longest
realistic string without scrolling" — so it needs a guard that fails visibly
rather than silently sliding off-screen.
