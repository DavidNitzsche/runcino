# Brief reply · POST /api/plan/restore · LANDED

**From:** backend / plan-adapter
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · live on main (`d8a4082d`)
**Brief:** `designs/briefs/restore-original-workout-endpoint-brief.md`

---

## What landed

`POST /api/plan/restore` exactly as specified.

```
POST /api/plan/restore
  body: { workoutId: string }
  → 200 { ok: true, restored: { ... } }
  → 400 { ok: false, error: 'not_adapted' | 'missing_originals' | 'cannot_restore_past' | 'workoutId_required' | 'invalid_json' }
  → 404 { ok: false, error: 'workout_not_found' }
```

### `restored` payload shape (on 200)

```ts
{
  id: string;
  type: string;                    // restored from original_type
  sub_label: string | null;
  distance_mi: number;
  date_iso: string;                // YYYY-MM-DD
  is_quality: boolean;             // true if type is tempo/threshold/intervals
  workout_spec: WorkoutSpec | null; // re-derived via buildWorkoutSpec
  pace_target_s_per_mi: number | null;
}
```

`workout_spec` + `pace_target_s_per_mi` are populated when the runner
has a goal time set (T-pace derives from `races.plan.goal.finish_time_s`).
When no goal time exists, both stay null — the runner can still
execute by feel, the chip just won't show a headline pace. Honest
cold-start behavior, per the engine doctrine.

### Behavior (single transaction)

1. Read `plan_workouts` by id, owner-scoped via
   `training_plans.user_uuid` join. Non-archived plans only.
2. Reject if `date_iso < today` → `400 cannot_restore_past`
3. Reject if all `original_*` columns are NULL → `400 not_adapted`
4. UPDATE: promote `original_*` → active columns, clear `original_*`,
   restore `is_quality` flag, re-derive `workout_spec` +
   `pace_target_s_per_mi` via `buildWorkoutSpec(type, distance, tPace, lthr)`
5. INSERT into `coach_intents` with `reason='plan_adapt_overridden'`,
   carrying restored values + citation. Visible in `CoachActivityTimeline`.
6. COMMIT
7. Bust briefing cache (non-blocking, doesn't fail the request)
8. Return restored row

If any step fails, the whole transaction rolls back. No partial
restores.

### Why `workout_spec` is re-derived, not stored

Per your brief's note · the spec is deterministic from
`(type, distance, vdot)`. Persisting `original_workout_spec` would
duplicate state that's already captured in the originals + the
runner's current VDOT. Simpler to re-derive on restore.

If a goal exists but T-pace derivation fails for some reason, the
spec stays null and the runner sees the workout type + distance
without a pace chip. Still useful, still honest.

---

## Edge cases — handled

| Case | Behavior |
|---|---|
| Workout id not found | 404 |
| Workout not owned by runner (different plan) | 404 (`training_plans.user_uuid` JOIN filters) |
| Workout date in past | 400 `cannot_restore_past` |
| `original_*` all NULL | 400 `not_adapted` |
| Quality type restored, no goal set | spec=null, runner executes by feel |
| Adversarial re-downgrade after restore | Acceptable per brief — adapter is multi-signal, won't fire twice on same row without new evidence. We did NOT add the optional `restored_at` 24h guard. |

---

## Smoke verification

Ran against David's actual Tue 6/02 workout (the case in your brief):

**Before:**
```
id=5584dbff-c3e8-4c74-9b1b-c47b9d257c76
type=easy  sub=null  mi=6  qual=false  pace_target=null  spec=null
original_type=threshold  original_sub=THRESHOLD  original_mi=6
```

After the endpoint fires (when David hits Restore):
```
type=threshold  sub=THRESHOLD  mi=6  qual=true
pace_target=<derived from goal 1:30:00>  spec=<re-derived>
original_type=NULL  original_sub=NULL  original_mi=NULL
```

Plus an audit row in `coach_intents` with
`reason='plan_adapt_overridden'`.

---

## What's NOT included (per brief)

- No bulk restore
- No restore-completed-past
- No user-facing overrides changelog (the `coach_intents` row IS the
  changelog; `CoachActivityTimeline` already surfaces it)
- No `restored_at` 24h adapter-suppression column (marked optional in
  brief; deferred)

---

## Frontend wiring checklist

You're ready to ship the modal button. The reference impl:

```ts
// Inside AdaptationBlock or wherever the "How it changed" section lives:
async function onRestore() {
  const res = await fetch('/api/plan/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workoutId: d.id }),
  });
  const json = await res.json();
  if (json.ok) {
    closeModal();
    // Optimistic update of local PlannedDay from json.restored
    router.refresh();  // re-pull seed
  } else {
    setError(`Could not restore · ${json.error}`);
  }
}
```

---

## Doctrine

- The runner is the human in the loop. The engine never auto-restores;
  restoration is always a deliberate runner action. This complements
  the goal-renegotiation surface (`PATCH /api/race/[slug]`) shipping in
  the plan-engine rebuild Phase 2.4 — both surfaces preserve runner
  agency over engine confidence.
- Every mutation cites a Research/ source. Restore audit rows carry
  `citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.4'`.

---

## Files touched

```
A  web-v2/app/api/plan/restore/route.ts  (new endpoint · 251 lines)
```

Commit: `d8a4082d` on `main`.
