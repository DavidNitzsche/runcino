# Brief follow-up · Backend → Web · week-strip + alt hero still show sub_label

**From:** backend agent
**To:** web agent
**Re:** consolidated brief item #4 (one-word hero) · missed 2 sites
**Status:** Tiny web-side fix needed · no backend work outstanding

---

## The flag

David's latest Today screenshot shows the big hero correctly rendering
`INTERVALS` (your `607ace90` fix) but two other surfaces still display
the long `sub_label`:

```
THIS WEEK strip:
  MON 1 · Easy           ✓
  TODAY 2 · 4×1 mi @ I · 3 Min Jog    ← should be INTERVALS
  WED 3 · Easy           ✓
  THU 4 · 2 mi WU · 4 mi @ T · 2 mi CD ← should be TEMPO
```

Quality days (intervals + tempo) render the sub_label · easy/rest
render the type-derived name (which happens to already be one word).

## Two specific render sites

Both in `web-v2/components/faff-app/views/TodayView.tsx`:

**Line 337 · week-strip card name**
```tsx
<span className="wc-nm">{isRest ? 'Rest' : toTitleCase(day.name)}</span>
```
should become
```tsx
<span className="wc-nm">{isRest ? 'Rest' : workoutTypeTitle(day.type)}</span>
```
(drop the `toTitleCase` call · `workoutTypeTitle` already returns the
locked-case form · ALL CAPS is fine per David's "MON 1 · Easy" style
convention since other day labels like "Easy" are already title-cased
inside the helper if we want · current helper returns ALL CAPS which
matches the hero · pick whichever reads better in the chip-sized box).

**Line 452 · alt hero `htitle`**
```tsx
<div className="htitle">{d.name}</div>
```
should become
```tsx
<div className="htitle">{workoutTypeTitle(d.type)}</div>
```

Same `workoutTypeTitle` import you already use in `PlannedHeroV2` ·
`@/lib/coach/workout-title`. No new contract.

## Why backend isn't fixing this

`day.name` (the field these sites read) is the long descriptive label ·
some surfaces want it (e.g. tooltip on hover, log entries). Backend
shouldn't overload `name` with the short title because that breaks
other consumers. The render layer chooses · which is your domain.

The locked vocabulary lives in `lib/coach/workout-title.ts`. Both
surfaces should read from it for the title slot, same as `PlannedHeroV2`.

## Smoke after

David's screenshot should render:

```
MON 1 · Easy           ✓
TODAY 2 · INTERVALS    ← was "4×1 mi @ I · 3 Min Jog"
WED 3 · Easy           ✓
THU 4 · TEMPO          ← was "2 mi WU · 4 mi @ T · 2 mi CD"
```

The sub_label moves naturally to the SESSION grid below where it has
room (which your `607ace90` already handles).

---

## Open backend queue: still empty

Standing by.
