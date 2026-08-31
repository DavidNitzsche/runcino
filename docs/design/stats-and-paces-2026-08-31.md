# Stats & Paces — a new iPhone surface, filed for after the wiring phase

**Idea from David, 2026-08-31: "What is my threshold. How has it changed over
30 days... not only is it great info but it can really help to visually see
how the brains of faff 2.0 are working."**

## Why this fits the doctrine (it's a real risk otherwise)

`docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` is explicit that fitness
sub-scores, confidence decimals, and evidence counts don't get permanent
placement on Today — this idea is exactly that content, so it has to land as
a **destination**, not a card. The distinction that keeps it honest: Today
tells you what to do; this tells you why the app believes what it believes,
for the runner who chooses to look. Same posture as `/health`'s "deeper
insights" pattern already in the app, applied to the fitness anchors instead
of readiness.

It also directly serves Rule 25 (every important belief traceable to
evidence) and Brief 01's own success test: "the runner model should be able
to answer what do we believe, why, how certain — if it can't, the model is
too opaque." This makes that answerable, visibly, instead of only living in
logs and test output.

## Competitive reference, and the actual differentiator

David: "Strava and Garmin have something similar for paces and predictions
and it's one of my favorite features." Both are real, validated precedents —
Garmin's race predictor, Strava's fitness/freshness trend. Both are also
black boxes: a line moves, a number appears, with no way to ask why.

The differentiator faff has and they don't: the evidence ledger. Every point
on this trend line can answer "which runs moved this, and how much did each
one count" — not just that it moved. That's the actual product advantage
here, not feature parity with Strava/Garmin. Build the trend line, but don't
ship it without the tap-through to evidence — the tap-through is the point,
not a nice-to-have on top of a chart Strava already has.

## What it shows

Per capacity anchor (threshold, easy ceiling, high-intensity, durability):

- Current value, in plain units (pace, not a raw score)
- Confidence, in words, not a decimal (per the doctrine's own "we think" vs
  "we know this pretty damn well" distinction)
- A trend line over a selectable window (30/90 days) — what the anchor
  resolved to at points across that window
- On tap: the evidence ledger for the current value — which runs supported
  it, when, how strong each observation was (reusing `CapacityEstimate`'s
  existing `evidenceIds`/`reasons` fields directly, no new data shape)

## Why this is cheap to build, not a new subsystem

`capacity-resolver.ts`'s four resolvers already take `(userId, todayISO)`.
A trend is `[resolveThresholdCapacity(userId, d) for d in last30Days]` — no
new persistence, no snapshot table, fully consistent with Rule 10
(recompute, don't freeze). This is the same mechanism the doctrine's
required historical-replay testing needs (`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
§12/§58) — build one, get both. Confirm no future-data leakage as a side
effect of building the runner-facing version (if a historical read on date D
can see evidence dated after D, that's a bug in both the feature and the
test suite at once).

## Where it lives

Reached from Progress (or Profile, matching `/health`'s placement pattern
for the same kind of opt-in depth) — not a new primary tab. "Nothing is
precious, add a page if the info needs a home" per David's own standing
instruction tonight — this is a page, not a tab.

## Dependency — why this is queued, not started

Needs the capacity resolvers wired into something stable and the Evidence
Engine's per-activity classification landed, since the evidence ledger this
displays is built from real per-run evidence, not just the resolver's
current output. Build after the wiring phase, using real historical data to
verify the trend actually looks like something a coach would recognize
(Rule 13 — render it against David's real account, not a fixture) before
calling it done.
