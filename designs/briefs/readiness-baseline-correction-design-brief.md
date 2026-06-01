# Brief · Readiness card baseline was mislabeled · honest contract

**For:** design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Live bug fix · the "Baseline 53 → today 42 · −11" you've
been designing around was nonsense. Correct contract below.

---

## What you were told

A previous brief gave you a readiness card spec like:

```
HEALTH
Recovery & form · Mon, Jun 1

42                       (today's score, 0-100)
Baseline 53 → today 42 · −11
```

You designed honestly around that information. The data carrier
exists (`seed.readiness.baseline`) and renders that number.

---

## The actual bug

The seed was setting:

```ts
seed.readiness.baseline = health.hrv.baseline ?? 60;
```

That's the runner's **HRV in milliseconds** — 53ms — labeled and
rendered as if it were a readiness score baseline (0-100 scale).

So the card showed:

```
today 42          ← readiness score (0-100)
Baseline 53       ← HRV in MILLISECONDS
−11               ← apples minus oranges (meaningless)
```

Two different metrics with two different units stitched into a
single sentence. The runner sees "−11" and assumes "I'm 11 points
below my readiness baseline." Wrong. The 53 has nothing to do with
readiness.

**The readiness score itself was correct all along** — it's
computed from per-pillar baselines (HRV vs HRV baseline, RHR vs
RHR baseline, etc.) inside `lib/coach/readiness.ts`. The buggy
field was only used in the card display. Score 42 = honest.

---

## The corrected contract

After today's fix (`46320e82`), the seed populates baseline from
real readiness history:

```ts
seed.readiness.baseline =
  readinessBrief.composition.baseline      // mean of past 14 readiness scores
  ?? readiness.score                        // first-day fallback (delta 0)
```

`readinessBrief.composition` shape (already in the seed):

```ts
composition: {
  baseline: number;   // mean of past 14d readiness scores excl. today
  net: number;        // signed · today minus baseline (the real delta)
  today: number;      // duplicates `score` for self-contained reads
} | null;
```

**Use this everywhere the baseline/delta math runs.** Don't compute
the delta from `readiness.score - readiness.baseline` in the
renderer · the seed's `composition.net` is the source of truth and
it's an honest int because both sides are on the 0-100 score scale.

---

## Visual implications

The card design itself doesn't need to change much. But the meaning
of the numbers shifts:

| | Before (wrong) | After (correct) |
|---|---|---|
| Today | readiness score 0-100 | readiness score 0-100 |
| Baseline | HRV ms (wrong units) | rolling 14-day readiness avg |
| Delta | nonsense | true net (real signed integer) |
| Trend chart | meaningless against baseline | tracks against same scale |

The trajectory of "today vs baseline" is now real and meaningful.
A −11 net now actually means: you're 11 points lower than your
recent 14-day readiness average.

---

## Cold-start state

When the runner has < 1 day of readiness history (brand-new
runner, no readiness_snapshots populated yet):

- `composition` is `null`
- Seed falls back to `baseline: score` (today)
- Card should render as "first day · baseline forming" rather
  than "−0 from baseline"

Suggested copy: **"Baseline forming · check back tomorrow"** or
**"Day 1 of trend tracking"** instead of "0 from baseline".

The 7-day trend strip should also handle this · when there are
fewer than 7 prior snapshots, render the missing days as faded
placeholders, not flat lines at the same score.

---

## What still needs design attention

1. **Cold-start state copy** — what does the card say when there's
   no real baseline yet? Avoiding "−0" or "Baseline 42 today 42" (
   redundant) would be ideal.

2. **Trend strip when sparse** — when the runner has 2 days of
   data, what do days 3-7 show? Faded placeholder? Hidden? Up to
   you.

3. **Net visual** — currently the design renders the net as a
   colored number (green positive, red negative). With real data
   the range is bigger (e.g. −20 to +20 is common). Make sure the
   visual scale accommodates.

---

## What's NOT changing

- The big readiness gauge (42, color-banded)
- The "WHAT IS DRIVING IT" pillar list
- The 7-day trend strip layout
- "NOW 42 · AVG 67" right-side stats

These all read from real, correct signals. The only thing that
was wrong was the "Baseline 53 → today 42 · −11" line and its
underlying number.

---

## Doctrine fit

This aligns with David's locked rule: **honest projection over
heroic prescription**. The card should not show numbers that aren't
real, and any displayed delta should be on the same scale as the
quantity being delta'd against.

Two metrics with different units cannot be subtracted. The previous
contract violated that doctrine inadvertently.

---

## How to respond

1. If the cold-start copy / trend-strip-when-sparse have a clear
   design direction you'd like, send it · backend will ship the
   matching field shape.
2. The current spec just needs to know the baseline is now real ·
   no visual rework required unless the cold-start state needs new
   treatment.

---

## Related

- `designs/briefs/readiness-brief-backend-landed.md` · the
  readinessBrief contract this layers onto
- `web-v2/components/faff-app/seed.ts:1817-1829` · the fix
- `web-v2/components/faff-app/views/HealthView.tsx:153` · the
  display site that was rendering the bogus number
