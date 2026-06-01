# Brief · per-lever quantified delta strings

**For:** backend / coach-engine
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Awaiting backend · web ships read surface with text-only levers in tandem
**Parent:** `designs/from Design agent/train-page/README.md` §4

---

## TL;DR

The new train-page projection panel renders a "WHAT CLOSES IT" list
of action levers as inline rows: glyph + text + delta chip. The
design's example deltas are `15-30s / wk` and `0.5 VDOT / 4wk` ·
research-domain quantifications that say how much the lever moves
the projection per unit of work.

Web currently consumes `goal.levers[i]` (rich shape, with `title`,
`deltaSec`, `controllability`, etc.) and falls back to
`gapReport.whatClosesIt[i]` (string only). Neither carries the
design's intended delta string.

Until backend ships these strings, the chip stays absent and rows
render as text + glyph only.

---

## What we want

### Option A · add `quantDelta` to `goal.levers[i]`

```ts
levers: Array<{
  // ...existing fields
  /** Research-quantified delta string · what this lever moves the
   *  projection by per unit of work. Coach voice, terse, no caps.
   *  e.g. "15-30s / wk", "0.5 VDOT / 4wk", "30s w/ cooler corral". */
  quantDelta: string | null;
}>
```

Null when the lever is logistics or unquantifiable (e.g. "Sign up for
a tune-up" — kind='tune_up_race'). Frontend hides the chip on null.

### Option B · extend `gapReport.whatClosesIt`

If the lever list grows beyond `goal.levers`, ship a richer
`whatClosesIt`:

```ts
whatClosesIt: Array<{
  text: string;
  quantDelta: string | null;
}>
```

Either works. Option A is the smaller change since `goal.levers`
already exists with rich shape.

---

## Why we want the design's exact phrasing

The deltas the design shows are research-grounded. "15-30s per
threshold-block-week" comes from Daniels/Fitzgerald threshold dose-
response numbers. "0.5 VDOT per 4-week marathon-pace block" comes
from Pfitzinger. The design isn't picking these strings arbitrarily ·
they encode what coaching research says the lever buys.

Web cannot author these client-side without violating the doctrine
locked in `feedback_engine_match_research.md` ("coach engine cannot
extrapolate beyond research; every rule needs a citation"). So we
need backend to carry them in the same envelope where the lever
data lives.

---

## Where the read surface is

`web-v2/components/faff-app/views/TrainView.tsx` · the PROJECTION
card on the dashboard. Looks for `lv.quantDelta` first (Option A),
then falls back to nothing (chip hidden).

Currently shipped: lever rows render as glyph + text. Adding the
chip is a 3-line render addition once the field arrives.

---

## Acceptance criteria

- [ ] `goal.levers[i].quantDelta` populated for all quantifiable
      lever kinds (`threshold_block`, `vo2_block`, `goal_pace_block`,
      `cooler_corral`)
- [ ] Null for non-quantifiable kinds (`tune_up_race`, `sharpen`,
      `hold_fitness`) · or a coach-voice non-numeric phrase if
      research supports one (e.g. "consistency over magnitude")
- [ ] Coach voice · terse · lowercase · numbers + per-unit-of-work
- [ ] Citations live in code comments, not in the string itself
      (no "Daniels §X" in the chip)

---

## How to respond

PR link when shipped, or pushback if the quantifications don't have
clean citations and the chip should ship empty.
