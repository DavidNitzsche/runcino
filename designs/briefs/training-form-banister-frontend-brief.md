# Brief · Training Form card · label values changed (Banister TSB)

**For:** frontend (faff-web)
**From:** backend / coach-engine
**Date:** 2026-06-01
**Status:** Ask · backend shipped real Banister TSB in 39a42b4b · web
agent updates label colors + helper copy + meta subline

---

## TL;DR

The Training Form card was showing **+39 OVER-REACH** for David —
two unrelated signals stitched together. Backend just shipped real
Banister CTL/ATL/TSB so the numbers + label now agree.

The seed shape is the same · just the **label values changed** and
the math behind the numbers is now real. Frontend updates the color
map + helper copy.

---

## What backend changed

`adaptForm()` in `components/faff-app/seed.ts` now reads real
Banister TSB from `lib/coach/training-form.ts`:

```ts
seed.form: {
  fitness: number;  // CTL · 42-day EWMA of training load
  fatigue: number;  // ATL · 7-day EWMA
  delta:   number;  // TSB = CTL - ATL · SIGNED · negative = fatigued
  label:   'OVERREACH' | 'LOADED' | 'PRODUCTIVE' | 'RACE-READY' | 'DETRAINING' | 'BUILDING';
  acwr:    number | null;
}
```

Field shape is identical to before. **Label values changed**:

| Was | Now |
|---|---|
| OVER-REACH | OVERREACH |
| LOADED | LOADED |
| STEADY | PRODUCTIVE |
| BUILDING | BUILDING (cold-start only) |
| FRESH | RACE-READY |
| (none) | DETRAINING |

---

## Label → TSB band mapping (canonical Coggan)

```
TSB > +25      → DETRAINING    (too fresh too long · fitness eroding)
TSB +10..+25   → RACE-READY    (post-taper · primed for race)
TSB -10..+10   → PRODUCTIVE    (productive training · balanced)
TSB -20..-10   → LOADED        (high stress · productive but watch fatigue)
TSB < -20      → OVERREACH     (injury risk · sustained negative)
CTL < 10       → BUILDING      (cold-start · not enough history)
```

David right now: **TSB −39 · OVERREACH**, with Fitness 40 / Fatigue 79.
The negative TSB and OVERREACH label now agree (last 7d load is 2× his
42d baseline · real overreach territory).

---

## What to render

### Big number

`delta` (TSB). Render with sign · positive shows `+`, negative shows `−`.

### Label

`label` verbatim. Color by band:

| Label | Color |
|---|---|
| DETRAINING | amber/warn (too fresh isn't ideal either) |
| RACE-READY | success/green |
| PRODUCTIVE | neutral (current STEADY color works) |
| LOADED | amber/warn |
| OVERREACH | critical/red |
| BUILDING | neutral with subtle "building" tone |

### Meta subline

Update the "Fitness 44 · Fatigue 5" line to reflect what's actually
shown:

```
Fitness 40 · Fatigue 79
```

Same field names, just real numbers now. CTL/ATL are the engineering
labels but you can stay with Fitness/Fatigue for the runner.

### Ring fill

The ring currently visualizes `delta`. With the new sign-aware scale:

- The ring fill could read +50 to −50 (the typical band a year-round
  runner traverses)
- Negative TSB fills "left/down", positive fills "right/up"
- Or simpler: ring fills proportional to `|delta|`, color encodes
  positive vs negative

Up to design which way feels right. The number + label combo carries
the meaning either way.

---

## Helper copy under the label (optional but recommended)

The runner doesn't know TSB. A one-liner per label helps:

| Label | Helper |
|---|---|
| DETRAINING | "Too fresh for too long · fitness eroding. Build back up." |
| RACE-READY | "Primed for a race. Don't add new load this week." |
| PRODUCTIVE | "Productive training · fatigue and fitness balanced." |
| LOADED | "Running hot · productive but watch sleep + recovery." |
| OVERREACH | "Acute load above your baseline. Pull back this week." |
| BUILDING | "Building your baseline · more data coming." |

The label itself plus one-liner is enough · no need for a deep
education page.

---

## What's NOT in this brief

- A separate trend chart for TSB over time. The seed can carry it
  later (it's already computed inside training-form.ts as `trend7`)
  but the card stays single-value for now.
- ACWR exposed separately. It's still in `seed.form.acwr` for
  back-compat but the card uses TSB as the primary signal.

---

## David's current card · what it should render

```
TRAINING FORM
       −39
    OVERREACH
Fitness 40 · Fatigue 79
Acute load above your baseline. Pull back this week.
```

(red ring + red label + amber helper)

Previously rendered:

```
TRAINING FORM
       +39
    OVER-REACH       ← contradiction
Fitness 44 · Fatigue 5
```

---

## How to respond

1. Confirm label mapping · I'll update if the bands feel wrong for a
   first-month runner vs an advanced runner (the bands above are the
   canonical Coggan values · they're tight for advanced runners and
   forgiving for new ones).
2. PR when shipped · backend will smoke against the card.

---

## Related

- `web-v2/lib/coach/training-form.ts` · the composer
- `web-v2/components/faff-app/seed.ts` · adaptForm() wiring
- Coggan/Banister TSS/CTL/ATL framework · industry standard
  (TrainingPeaks, Runalyze, Intervals.icu all use this)
