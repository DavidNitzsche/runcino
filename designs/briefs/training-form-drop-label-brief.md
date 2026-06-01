# Brief · Training Form card · drop the LOADED text label

**For:** frontend (faff-web)
**From:** backend / David call
**Date:** 2026-06-01
**Status:** Ask · trivial · rendering-only change

---

## TL;DR

The Training Form card currently renders the state as both a text
label ("LOADED") AND a descriptive line below ("Running hot ·
productive but watch sleep + recovery.").

David: *"what does LOADED mean and do we need it or can it just be a
clean number in a circle?"*

Answer: drop the label, keep everything else. The descriptive line
carries the meaning. The ring color still encodes the state visually.

---

## What to change

In whichever component renders the TRAINING FORM card, stop rendering
`seed.form.label`. Keep:

- Big `seed.form.delta` number (with sign)
- `Fitness ${seed.form.fitness} · Fatigue ${seed.form.fatigue}` line
- Bottom descriptive line (currently authored per band)
- Ring color encoding (amber/red/green per band)

Backend still ships `label` on the seed (`'OVERREACH' | 'LOADED' |
'PRODUCTIVE' | 'RACE-READY' | 'DETRAINING' | 'BUILDING'`) so other
surfaces can use it · just don't render it on the Today card.

---

## Before / after

```
BEFORE                         AFTER
                                
TRAINING FORM                  TRAINING FORM
                                
       −19                          −19
     LOADED          ←drop          
                                
Fitness 32 · Fatigue 51        Fitness 32 · Fatigue 51
                                
Running hot · productive       Running hot · productive
but watch sleep + recovery.    but watch sleep + recovery.
```

---

## Why

- The label was doing work the description already does
- The ring color encodes the band visually
- Most cards in the app are single-number + context line · LOADED is
  the only chip that doubles up
- Cleaner reads better on the small surface

---

## What's NOT in this brief

- Keep the label on accessibility / aria attributes if you use it
  for screen readers · that's the right consumer for the state name.
- Keep the label on any other surface that needs the state name
  (Health view, drill-down, etc.). This is a Today-card-only change.

---

## How to respond

1. PR link when shipped.
2. If you'd rather keep the label but make it smaller / lower-weight
  instead, that's fine · the call is yours on the visual treatment.
  David's ask is "make it cleaner."

---

## Related

- `designs/briefs/training-form-banister-frontend-brief.md` · the
  brief that introduced the LOADED/PRODUCTIVE/RACE-READY/DETRAINING/
  OVERREACH labels. That brief stays valid · the labels are still in
  the seed · this brief just removes one render site.
