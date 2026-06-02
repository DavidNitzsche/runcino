# Brief · Aerobic decoupling chip on run-detail page

**For:** design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Backend shipped · `9b4e2a1a` · field is on
`runDetail.aerobic_decoupling` · render as a chip on long-run detail

---

## What it is

Research/15 §cardiac decoupling · the single best signal for aerobic
fitness extractable from per-mile splits.

When a runner is aerobically fit, pace and HR move together. When the
aerobic engine is undertrained, HR climbs in the second half of a long
run while pace stays the same (or pace slows while HR stays the same).
The percentage drift between halves is the signal.

Joel Friel's bands (widely used in endurance coaching):
- **< 5% · race-ready** · aerobic engine is solid
- **5-7% · building** · base is improving, more work needed
- **> 7% · poor** · aerobic base is weak, mileage emphasis needed

---

## Field shape

```ts
runDetail.aerobic_decoupling: {
  drift_pct: number;         // e.g. 6.0
  verdict: 'race-ready' | 'building' | 'poor';
  h1_hr: number;             // first-half avg HR (bpm)
  h1_pace_sec: number;       // first-half avg pace (sec/mile)
  h2_hr: number;             // second-half avg HR
  h2_pace_sec: number;       // second-half avg pace
} | null
```

Null when:
- Run is < 6 miles (need volume for steady-state)
- Splits missing HR or pace
- Halves differ by > 20 sec/mi (was a progression / fartlek / race)
- Workout type is tempo / intervals / threshold / race / fartlek
- Drift magnitude > 20% (noisy / not steady-state)

When null, just don't render the chip. The card stays clean.

---

## Real values for David's recent long runs

```
5/25  6.16mi  H1 129bpm @ 9:08  H2 137bpm @ 9:28  →  +10.1% POOR
5/29  7.71mi  H1 136bpm @ 9:15  H2 143bpm @ 9:17  →  +6.0% BUILDING
5/31  12.36mi  (progression · filtered · null)
```

The 5/25 reading shows real aerobic-fitness gap · HR climbed 8 bpm
while pace slowed by 20 sec/mi. Classic decoupling.

The 5/31 12-miler was a progression (H2 paced 37 sec/mi faster), so
the helper correctly returned null · decoupling math only applies to
steady efforts.

---

## Suggested chip treatment

I'd put the chip near the top of the run-detail card, alongside the
other "this is how the run went" signals (temp delta, HR delta vs
usual, etc.).

```
AEROBIC DECOUPLING  +6.0%  BUILDING
H1 136bpm @ 9:15  →  H2 143bpm @ 9:17
```

Color coding:
- `race-ready` → green (use design system's recovery/active green)
- `building` → amber/warn
- `poor` → red/warn

The H1 → H2 micro line is optional. Drops it for a compact chip
("AEROBIC DECOUPLING +6.0% · BUILDING") if you want to save space.

---

## Why this matters

The runner's current readout is "I felt ok" or "HR was high today."
Aerobic decoupling makes the WHY visible: HR climbed because the
aerobic engine wasn't ready for the duration. Two interpretations:
- Race-ready → trust the engine, can push race effort
- Building → keep stacking miles, base is forming
- Poor → emphasize Z2 / easy miles for the next 4-6 weeks

It's a no-bullshit fitness metric · grounded in physiology, not
subjective effort or watch zones.

---

## What's NOT on this

- Doesn't trigger plan adaptations (yet). Backend has the signal but
  the plan engine doesn't read it. If we want "POOR decoupling on
  3 of last 4 long runs → bump easy-mile weeks", that's a separate
  build. Don't bake it into the design.
- Doesn't generate copy ("your aerobic base is weak"). The chip is
  just data; you author the framing.
- Doesn't roll up to a daily Health page tile. Per-run only · the
  decoupling chart over time COULD live on Health but that's a
  follow-up. Today: per-run chip only.

---

## How to respond

1. Drop the chip into the run-detail design wherever you want.
2. If you want the chip to render even for short runs (< 6mi) just
   with a different verdict, say the word · I can drop the distance
   filter on a flag.
3. If you'd like the decoupling time-series surfaced on the Health
   page (last 8 long-runs strip showing drift trend), file a
   follow-up · backend can ship a helper.

---

## Related

- `lib/training/aerobic-decoupling.ts` · the helper
- `lib/coach/run-state.ts:204` · the new field on RunDetail
- `designs/briefs/health-page-coverage-audit.md` · Tier 1 item we
  identified that's now shipped
- `designs/briefs/health-page-data-ready.md` · the parallel Health
  page brief
