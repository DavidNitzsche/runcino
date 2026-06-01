# Brief · POST /api/plan/restore · let the runner override an adaptation

**For:** backend / plan-adapter agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Ask · frontend will wire the UI as soon as the endpoint lands

---

## TL;DR

The auto-adapter is doing the right thing most of the time. But the
runner is the human in the loop and needs a one-tap way to say "no,
I'm doing the original workout." Add `POST /api/plan/restore` that
promotes a row's `original_*` columns back into its active columns
and logs a coach_intent capturing the override.

---

## The runner moment

Today (2026-06-01), David's Tue 6/02 workout was auto-downgraded from
Cruise Intervals → Easy because of an 8-day sleep streak. The
frontend now surfaces this clearly · the chip shows "was THRESHOLD",
the hero shows an amber "Downgraded from THRESHOLD · Resting HR
averaging 57 bpm, 9 above 14-day baseline." line, and the
WorkoutDetail modal has a "How it changed" section.

What's missing: a button that lets David say "I read the reason,
appreciate the call, I'm doing the original anyway." Right now
there's no way to override.

---

## What we need

### Endpoint shape

```
POST /api/plan/restore
  body: { workoutId: string }
  → 200 { ok: true, restored: { type, sub_label, distance_mi, date_iso, workout_spec } }
  → 400 { ok: false, error: 'not_adapted' | 'missing_originals' }
  → 404 { ok: false, error: 'workout_not_found' }
```

### Behavior

Single transaction:

1. Read `plan_workouts` by id. If `original_type IS NULL` and
   `original_distance_mi IS NULL` and `original_date_iso IS NULL` →
   400 `not_adapted` (nothing to restore from).

2. Promote the originals back to the active fields:

   ```sql
   UPDATE plan_workouts
      SET type             = COALESCE(original_type, type),
          sub_label        = COALESCE(original_sub_label, sub_label),
          distance_mi      = COALESCE(original_distance_mi, distance_mi),
          date_iso         = COALESCE(original_date_iso, date_iso),
          is_quality       = (CASE WHEN original_type IN ('tempo','threshold','intervals') THEN true ELSE is_quality END),
          original_type           = NULL,
          original_sub_label      = NULL,
          original_distance_mi    = NULL,
          original_date_iso       = NULL
    WHERE id = $1 AND user_uuid = $2
   ```

   Note · `workout_spec` was atomically cleared on downgrade
   (per the workout-spec-clear-on-downgrade brief). To fully restore
   the original quality workout's pace target, you'll need to either:
   - Re-derive workout_spec from the restored type using the existing
     `resolveWorkoutSpec(type, mi, vdot)` helper, OR
   - Keep an `original_workout_spec` jsonb column. (Simpler · just
     re-derive · the spec is deterministic from type + distance + VDOT.)

3. Log a coach_intent:

   ```ts
   {
     domain: 'plan',
     reason: 'plan_adapt_overridden',
     severity: 'soft',
     field: workoutId,
     body: 'Runner overrode the auto-adapter · proceeding with original {originalSubLabel || originalType}.',
     source: 'runner_override',
   }
   ```

   This shows up in `CoachActivityTimeline` (the briefing surface)
   and gives the auto-adapter signal · "this runner pushes back when
   we downgrade." Future iterations could use the override-history
   to tune the adapter's confidence threshold.

4. Return the restored row's fresh state in the response so the
   frontend can update its local cache without re-fetching the seed.

### What's atomic and what's not

- The UPDATE + coach_intent INSERT should run in one transaction. If
  the intent write fails, roll back the restore (or vice versa).
- After the transaction, the seed will reflect the restored state on
  the next refresh (router.refresh on the frontend handles that).

---

## Edge cases the endpoint should handle

| Case | Behavior |
|---|---|
| Workout has `wasAdapted = false` (never adapted) | 400 `not_adapted` |
| Workout has `original_type IS NULL` (no record of original) | 400 `missing_originals` |
| Workout is in the past (already completed) | 400 `cannot_restore_past` · the runner already ran whatever they ran; restoring the planned-as-of column doesn't change history |
| Workout is more than 7 days in the future | OK · restore freely |
| Workout id doesn't belong to this user | 404 (or 403 if you want to distinguish) |
| Restoration would re-introduce a stale workout_spec | Re-derive via `resolveWorkoutSpec(type, mi, vdot)`. Don't restore the original spec verbatim if it has stale pace data. |

### Reversibility question

After a restore, the `original_*` columns are NULL. If the adapter
then re-fires on the same row (e.g. sleep streak continues), it'll
write fresh `original_*` from the restored state and downgrade again.
The runner could then restore again. This is fine · adversarial back-
and-forth between runner and adapter is unlikely in practice (the
adapter is multi-signal and won't fire twice on the same restored
day without new evidence).

If you want to prevent the adapter from re-downgrading a manually-
restored row, you could add a `restored_at` column and skip the
adapter for 24h after a restore. Optional · not required for v1.

---

## Frontend wiring (after backend lands)

The button lives **inside the WorkoutDetail modal's "How it changed"
section** (David call · "I can live in the how it changed section in
details"). The hero banner gets no inline button · just the link to
the modal.

UI shape:

```
HOW IT CHANGED
Downgraded from THRESHOLD to Easy
Yesterday · Resting HR averaging 57 bpm, 9 above 14-day baseline.

                              [ ↶  RESTORE ORIGINAL ]
```

On click:
1. POST `/api/plan/restore { workoutId: d.activityId || d.id }`
2. On 200: close the modal, optimistically update the local
   PlannedDay to reflect restored state, fire `router.refresh()` so
   the seed re-pulls and the chip's "was X" subline clears.
3. On 4xx: show inline error in the section ("Could not restore ·
   <error>").

No confirmation modal. The action is reversible (the runner can
re-skip the run, or the adapter will fire again if the conditions
warrant). Friction here is friction the runner is explicitly trying
to bypass.

---

## What's NOT in this brief

- **Bulk restore for a whole week's worth of adaptations.** One-at-a-
  time is fine for v1. If a runner wants the whole adapter off, that's
  a different surface (settings toggle for the auto-adapter).
- **Restore on completed runs.** The runner already ran whatever
  they ran; "restoring" a past day is meaningless.
- **A user-facing changelog of overrides.** The coach_intents row IS
  the changelog; CoachActivityTimeline already surfaces it.

---

## How to respond

1. Confirm endpoint shape (or push back).
2. PR link when shipped · frontend will wire the modal button within
   the day.
3. Note any edge case from the table above you want to handle
   differently.

---

## Related

- `designs/briefs/adaptation-visibility-backend-brief.md` · the brief
  that landed the original_* columns + the AdaptationInfo envelope.
- `designs/briefs/workout-spec-and-adaptation-visibility-landed.md` ·
  the reply confirming what shipped (commit a54c7069).
- `web-v2/components/faff-app/overlays/WorkoutDetail.tsx` · the
  AdaptationBlock component that will host the Restore button.
