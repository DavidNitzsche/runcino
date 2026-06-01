# Brief · adaptation visibility · expose original vs adapted on every plan row

**For:** backend / plan-adapter agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Architecture · the runner can't see what changed

---

## The gap

When the plan auto-adapts a workout — downgrade, reschedule, shave — the database tracks the new state and `coach_intents` records WHY. But the frontend's per-day shape (`PlannedDay` on the week strip, the inline day cell on FULL PLAN) has no signal that **THIS specific row used to be something else**.

The user-visible failure:

> David, 2026-06-01, looking at Tue 6/02 on his FULL PLAN month grid:
> "TUE 2 · EASY · 6.0 mi · 6:47"
>
> The runner has no idea this was originally a Cruise Intervals workout.
> The system silently demoted it. From the runner's perspective, the
> plan just looks "off" — easy day at threshold pace.

`coach_intents` carries the narrative ("Readiness pullback · sleep 8 days running"). `plan_workouts.original_type` + `original_distance_mi` + `original_date_iso` carry the as-authored state. **Neither is on the seed payload per day.**

## What we want backend to expose

Per `PlannedDay` (week strip) and per inline day cell in `season.weekDays[i][j]` (FULL PLAN), surface a small adaptation envelope:

```ts
type AdaptationInfo = {
  /** True when the runner-facing fields (type, sub_label, distance,
   *  date, pace) differ from plan_workouts.original_*. */
  wasAdapted: boolean;
  /** The originally-authored values · null when wasAdapted is false. */
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  originalDateIso: string | null;
  /** Short coach-voice reason · "Readiness pullback (sleep streak)" /
   *  "Volume shaved (week 4 cutback)" / "Quality moved (rest day shift)".
   *  Source: the matching coach_intents row's reason field, narrated. */
  reason: string | null;
  /** ISO timestamp when the adaptation was applied. */
  adaptedAt: string | null;
  /** Adapter category · drives icon/copy variation on the frontend.
   *    'downgrade'   · type changed to easier
   *    'reschedule'  · date shifted
   *    'shave'       · distance reduced
   *    'mark_dirty'  · paces stale, awaiting recompute
   *    'other'       · catch-all */
  kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
};
```

Add to:

1. `glance-state.ts:GlanceWeekDay` → `adaptation: AdaptationInfo | null`
2. `training-state.ts:weeks[].days[i]` → same `adaptation` field

Both readers join `plan_workouts` to `coach_intents` (1:N, take the most recent matching row by `created_at`), resolve `wasAdapted` by comparing current cols to `original_*` cols, and produce the envelope.

## Frontend will then render

**Week strip chip · TodayView:**

Today (broken):
```
TUE 2
Easy
● 6.0 mi · 6:47          ← stale pace, no provenance
```

After this brief:
```
TUE 2
Easy             ← downgrade dot (small amber chevron next to name)
● 6.0 mi · 8:45
  was CRUISE INTERVALS    ← strikethrough subline, smaller
```

Tap on the chip → existing WorkoutDetail modal already opens → mount an "Adaptation" section under the title:

```
HOW IT CHANGED
Downgraded from Cruise Intervals to Easy
Yesterday morning · readiness pullback (sleep streak · 8 days below
baseline). Threshold-day load deferred to protect tonight's sleep
window. Coach.
```

The copy uses `reason`, `adaptedAt`, `kind`, and the comparison of current state vs original.

**FULL PLAN month cell:**

Today (broken):
```
2
EASY
6.0 mi · 6:47       ← stale pace, no provenance
```

After:
```
2  ⟲              ← small downgrade glyph in corner
EASY
6.0 mi · 8:45
was CRUISE INTERVALS  ← small strike-through subline
```

Tap to open the same day-detail modal with the adaptation section.

## What's NOT in scope here

- **Don't change `plan_workouts` schema.** The `original_*` columns + `coach_intents` table already hold the data. This brief is purely about surfacing existing data on the read path.
- **Don't gate the adaptation visibility on user preference.** Always show. Per David's autonomy doctrine (locked 2026-06-01): "build it to fix itself, not to prompt the runner." Visibility is the COMPLEMENT of autonomous action — the runner sees what the system did, no friction required to surface it.
- **Don't surface adaptation history beyond the most recent one per row.** If a row was downgraded then re-promoted then shaved, only show the most recent change. Audit history lives in the coach activity timeline.
- **Don't write a new SQL view.** Backend can compose the AdaptationInfo inline in the existing glance/training state readers.

## Edge cases

- **Row was authored as easy from the start (no adaptation):** `wasAdapted = false`, all original_* fields null in the envelope. Chip renders normally, no strike-through subline.
- **`original_type` is identical to current `type`, but `original_distance_mi` differs (volume shave):** `wasAdapted = true`, `kind = 'shave'`. Frontend renders "6.0 mi · 8:45 · was 8.0 mi" or similar.
- **Reschedule (date shifted):** the destination row's `original_date_iso` differs from `date_iso`. Show the source date in the subline. The original date's cell renders normally (no shadow).
- **`coach_intents` has multiple matching rows:** take the most recent by created_at.
- **No coach_intents row matches (silent mutation):** `reason = null`. Frontend renders the adaptation glyph + "was X" subline but skips the reason copy in the modal.

## Frontend dependencies

This brief depends on `workout-spec-clear-on-downgrade-brief.md` (sibling brief) being shipped first — otherwise the frontend's defensive guard masks the underlying issue and we can't trust the spec's pace data either way. Order:

1. workout_spec clearing ships + backfill runs.
2. Frontend removes its defensive PACE_DEFAULT override.
3. This brief ships · adaptation envelope on the seed payload.
4. Frontend renders the "was X" sublines + modal "How it changed" block.

## How to respond

1. Confirm AdaptationInfo shape (or push back with a counter-proposal).
2. Note any joins/queries that would slow down glance/training-state loading materially (we can paginate or lazy-fetch if needed).
3. Link the PR when it ships.

## Related briefs

- `designs/briefs/workout-spec-clear-on-downgrade-brief.md` · sibling, ship first.
- `designs/briefs/plan-auto-adapt-backend-landed.md` · the auto-adapt system already shipped, this brief is purely the read-side surfacing of what it does.
- `designs/briefs/backend-state-2026-06-01-landed.md` · context.
