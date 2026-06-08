# AUDIT-FIXES

Completed fixes and their follow-up queue. Add new items at the top of each section.

---

## Landed (2026-06-08 · commit cea76a26)

| ID | File | Fix |
|---|---|---|
| F3 | `lib/plan/simulator-db-errors.test.ts` | `baseRouteQuery` matched `training_plans` before `plan_workouts`; the aggregation SQL JOINs training_plans so it hit the wrong mock branch → `weeklyMi = NaN` → `projectedVdot = NaN`. Moved `plan_workouts` check first. |
| E7 | `app/api/ingest/workout/route.ts:192` | `splits_unreliable: !splitsCheck.reliable && rawSplits.length > 0` → explicit ternary `rawSplits.length > 0 ? !splitsCheck.reliable : false` so watch-direct rows with no splits stamp `false`, not a reliance on the `&&` short-circuit to accidentally produce `false`. |
| E8 | `lib/coach/training-form.ts:168` | `inferred_type ?? 'easy'` → `inferred_type ?? (mi >= 10 ? 'long' : 'easy')`. Un-matched plan rows ≥ 10 mi now get intensity factor 0.95 (long) instead of 0.85 (easy). |
| E9 | — | Tempo Jun 4 `hr_target_bpm = null` in `workout_spec` — left as-is; past run, cosmetic, no consumer reads it at render time. |

---

## Follow-up queue

### E8-followup — HR-based intensity inference in training-form (low urgency)

**What:** The training-form query only has `d`, `mi`, and `inferred_type` (from `plan_workouts`). When `inferred_type` is null (no plan row match), we currently fall back to distance only (`mi >= 10 → 'long'`). We can't distinguish a 7mi easy from a 7mi workout without a quality signal.

**Fix:** Add `MAX(data->>'avgHr')::numeric AS avg_hr` to the `daily_runs` CTE in `computeTrainingForm`, then infer intensity when `inferred_type` is null:

```ts
// rough sketch — needs LTHR lookup at query site or passed in
const type = r.inferred_type
  ?? (mi >= 10 ? 'long'
    : r.avg_hr && lthr && r.avg_hr >= lthr * 0.88 ? 'tempo'
    : r.avg_hr && lthr && r.avg_hr >= lthr * 0.78 ? 'progression'
    : 'easy');
```

Friel zone boundaries: Z4 threshold ≥ 0.88 × LTHR → tempo; Z3 ≥ 0.78 × LTHR → progression/moderate; below → easy. Cite: Friel *The Triathlete's Training Bible* zone table.

**Constraint:** LTHR must be read from `profile` at the top of `computeTrainingForm` (already available as `lthr` via the zone-bucketing path in ingest — confirm it's populated before using it here). If LTHR is null, fall back to the current distance-only heuristic.

**Files to touch:**
- `web-v2/lib/coach/training-form.ts` — enrich `daily_runs` CTE + inference logic
- Confirm `profile.lthr` is populated for the test user before enabling

**Out of scope for this change:** HR-TSS (replacing distance × intensity_factor with actual TSS from HR-based training load). That's a larger architectural change.
