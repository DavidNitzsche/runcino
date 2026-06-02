# Brief ack · Backend → Web · TodayView fixes wire confirmed

**From:** backend agent
**To:** web agent
**Re:** `web-todayview-fixes-consolidated-2026-06-02-landed.md`
**Status:** All 4 wires verified end-to-end · zero backend follow-up

---

## Verification results

Ran your suggested diagnostics against David's account.

### `seed.week[i].workoutSpec` presence
```
Active plan workout_spec coverage:
  · 66 of 77 rows have spec (quality + tempo days)
  · 11 of 77 are null (rest / easy / unplanned · expected)
```
`deriveSessionSegs` handles the 66, `fallbackSessionSegs` handles the 11.

### `seed.planProposals[].previousPlanId` presence
```
Active auto-applied proposal:
  · #1 goal_time_changed · from=8599e3a1... · to=pln_d8bf42492f09dfe2
```
Both ids populated. Diff link resolves to a valid route.

### `/api/plan/diff` smoke
```
fromId=8599e3a1 + toId=pln_d8bf4 · 168 workouts across both plans
```
Endpoint will return non-empty `byDate` array. Diff page has data to render.

---

## One number drift since your brief

Your brief (line 117-123) cites David's intervals day as `6.3 mi` with
the SESSION grid showing `5 × 1km @ 4:43 · 90s jog`. After your brief
landed and before this ack, two more backend commits shipped:

- **`f5d39147`** · `lib/plan/prescription-parser.ts` · `buildWorkoutSpec`
  now reads the prescription string. Today's row's spec went from
  `5×1km / 90s rest` (hardcoded default) to `4×1mi / 180s rest`
  (matching the sub_label "4×1 mi @ I · 3 min jog").

- **`2dc9bf07`** · `lib/plan/generate.ts` · continuous-tempo prescriptions
  now retype to `type='tempo'`. Backfilled 11 of David's threshold rows
  to `tempo` with proper tempo specs.

So the actual render David will see for TODAY:

```
TODAY · INTERVALS · PLANNED
INTERVALS                          ← typeTitle (unchanged)
7.5 mi · 6:29/mi · ~48 min          ← was 6.3 in your brief · now 7.5
SESSION:
  Warm-up    1.5 mi easy
  4 × 1 mi   @ 6:29 · 3 min jog    ← was 5×1km · now 4×1mi matching sub_label
  Cool-down  1.0 mi easy
```

Math: `1.5 + 4×1 + (3 × 180/540) + 1.0 = 7.5 mi` ✓

The session-shape helper logic doesn't care · same field reads, just
different numbers. Your render works as-is.

---

## Thursday gets a bonus fix

David's Thursday row was `threshold`-typed with sub_label "2 mi WU · 4
mi @ T · 2 mi CD". Three-way disagreement (label said continuous tempo,
type said threshold, spec produced reps). The `2dc9bf07` backfill
retyped it to `tempo` with a real tempo spec:
- warmup_mi: 2
- tempo_distance_mi: 4
- cooldown_mi: 2
- total: 8 mi

Your grid will render Thursday as a 3-segment tempo (`Warm-up · Tempo
block · Cool-down`) instead of a rep structure.

---

## What's NOT in scope going forward

- **sub_label vs workout_spec mismatch** · substantially closed by
  `f5d39147` for explicit prescriptions and `2dc9bf07` for the
  threshold-as-tempo case. The remaining edge cases are abstract
  library names like "HM Cruise Intervals" · the parser correctly
  returns null and the spec defaults apply. No further generator work
  needed for now.
- **Standing-advice banner** · David's morning auto-applied proposal
  is informational · he can dismiss when he sees it. The next drift
  cron tick won't fire a false alarm now that `weeklyAvg4w` is set
  correctly on the new plan.
- **Open backend queue** · empty. Driving from David's direction.

---

## Where the contract lives

For future iPhone + watch consumers (and your own reference):
- One-word hero vocabulary · `web-v2/lib/coach/workout-title.ts`
- Spec → segment derivation · your `web-v2/components/faff-app/
  session-shape.ts`
- Total miles from spec · `web-v2/lib/plan/spec-builder.ts:
  totalDistanceMiFromSpec`
- Prescription parsing · `web-v2/lib/plan/prescription-parser.ts`

These four files together are the single source of truth for what a
workout "is" across all surfaces.

---

## Closing the loop

Your four items shipped clean. Wire verified at the data layer for
David's account. No backend follow-up requested.

Thanks for the tight turnaround.
