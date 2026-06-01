# Brief · workout_spec must clear on atomic downgrade

**For:** backend / plan-adapter agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Bug · half-cleaned adaptation surfacing on user data
**Priority:** High · visible to David today on Tue 6/02 row

---

## The bug

The catch-up brief promised:

> `e02c8412` · downgrade is atomic. type=easy/recovery/rest clears
> sub_label + pace + is_quality coherently. Backfill ran for the one
> rogue row (David's Tue 6/02).

It DID clear `sub_label`, `pace_target_s_per_mi`, and `is_quality`. It did NOT clear `workout_spec` (the jsonb column from migration 120).

Result for David's Tue 6/02 row right now:

| Column | Value |
|---|---|
| `type` | `easy` |
| `sub_label` | `NULL` |
| `pace_target_s_per_mi` | `NULL` |
| `is_quality` | `false` |
| `workout_spec` | **`{ ..., target_pace_s_per_mi: 407, ... }` (6:47/mi, the original threshold target)** |

Frontend pace resolver in `seed.ts:adaptWeek` falls through:

```ts
const specPace = paceFromSpec(d.plannedSpec);
const paceSec = specPace
  ?? (d as { paceTargetSPerMi?: number | null }).paceTargetSPerMi
  ?? PACE_DEFAULT[eff];
```

Since `specPace` resolves to 407s/mi from the stale spec, the chip renders "EASY · 6.0 mi · 6:47" — self-contradictory.

The week strip + FULL PLAN month view BOTH show this inconsistency (one source of truth at the DB layer, both surfaces honestly render the bad data).

## What we need backend to ship

Extend the atomic downgrade to also clear (or zero-out) `workout_spec` when type transitions to easy/recovery/rest. Three reasonable shapes:

**Option A · Hard clear (preferred).** Set `workout_spec = NULL` on downgrade. Simplest, matches the column-clearing pattern.

**Option B · Zero the pace target.** Keep the spec object but set `workout_spec.target_pace_s_per_mi = NULL` and any other quality-specific fields (target_hr, target_lactate, etc) to NULL. Preserves spec metadata for diagnostics.

**Option C · Audit field.** Add `workout_spec.adapted_at = <timestamp>` and let frontend logic skip the spec when adapted_at is set + type is easy. Most diagnostically rich, slightly more frontend logic.

Frontend recommends **Option A**. Easy to reason about, matches the existing column-clear pattern. If you want diagnostic history of "what was this originally," that's covered by the `original_type` / `original_distance_mi` columns + the adaptation-visibility brief (separate file).

## Backfill for existing rows

David's Tue 6/02 is the rogue row. After shipping the clear-on-downgrade logic, run a backfill:

```sql
UPDATE plan_workouts
   SET workout_spec = NULL
 WHERE type IN ('easy','recovery','rest')
   AND workout_spec IS NOT NULL
   AND (
     workout_spec->>'target_pace_s_per_mi' IS NOT NULL
       AND (workout_spec->>'target_pace_s_per_mi')::int < 480   -- faster than 8:00/mi
   );
```

The `< 480` guard is the sanity check: a legitimately easy spec might prescribe 8:30/mi (510s/mi) for a recovery day, which we want to keep. But ANY easy/recovery/rest row with a spec pace under 8:00/mi is by definition stale from a quality downgrade.

## What frontend just shipped as a defensive guard

Frontend now (commit shipping with this brief) overrides the pace resolver for easy-bucket types:

```ts
const paceSec = easyBucket
  ? PACE_DEFAULT[eff]            // 525s/mi (8:45) for easy
  : (specPace ?? d.paceTargetSPerMi ?? PACE_DEFAULT[eff]);
```

So even with stale spec data, the chip now renders "EASY · 6.0 mi · 8:45" coherently. This is a defensive UI guard, not a structural fix. Once backend clears workout_spec on downgrade, the frontend guard becomes a no-op (specPace would be null for easy rows anyway, and the fallback already lands on PACE_DEFAULT).

Frontend will remove the guard once backend confirms the clear-on-downgrade ships + backfill runs.

## Validation after backend ships

A quick SQL probe to confirm the fix:

```sql
SELECT type, COUNT(*) AS n
  FROM plan_workouts
 WHERE type IN ('easy','recovery','rest')
   AND workout_spec IS NOT NULL
   AND (workout_spec->>'target_pace_s_per_mi')::int < 480
 GROUP BY 1;
```

Should return 0 rows after the backfill. Run as part of the migration's `END` block or as a post-deploy sanity check.

## How to respond

1. Pick A / B / C (or propose D).
2. Link to the migration once it ships.
3. Frontend will remove the defensive guard in the next commit after that.
