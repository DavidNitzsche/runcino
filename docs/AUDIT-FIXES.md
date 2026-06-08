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

### CI-followup-1 — §13.7 band refinements deferred (marathon one-sided + aged input)

**Context:** `computeConfidenceInterval` (`lib/training/goal-projection.ts`) ships a **symmetric** band sized off Research/02 §13.7 keyed on target distance (≤10K ±2.0% · HM ±2.5% · marathon+ ±3.0%), status-scaled (on-track ×1.0 · watching ×1.25 · off-track ×1.5). Correct for David's HM→HM case (same-distance, advanced, recent anchor).

**Two §13.7 refinements are NOT yet wired** — both need data the function isn't passed today:

1. **Marathon-without-a-block → one-sided pessimism.** §13.1 / §13.7 say a marathon predicted from a sub-half input with no marathon-specific block runs **±10% one-sided slow** (optimistic bias). Needs: the VDOT anchor's distance + a "marathon-specific block present" signal (long-run volume / MP work in the last 8-12 wk). The band would become `{ lo: center − smallHalf, hi: center + bigHalf }`.
2. **>6-month-old anchor → ±8% override.** §13.7 "cross-prediction with >6-month-old input → ±8%." Needs: the anchoring race/run **date**. `bestRecentVdot` already returns the winning candidate with its `date` + `distance_mi` — thread those through `computeGoalProjection` (add `vdotAnchorDistanceMi` + `vdotAnchorDateISO` args) and the override is a few lines.

**Also deferred:** §13.5 novice widening (+2pp for `experience_level` novice/beginner) — David is advanced so it's a no-op today; add when a beginner user lands.

**Where:** `computeConfidenceInterval` has the documented hooks in its header comment. Symmetric band is the honest default until the anchor metadata is threaded.

### CI-followup-2 — iPhone confidence band + label render — DONE (ed8cdeac, 2026-06-08)

**Server:** `route.ts` now emits `confidenceInterval` + `confidenceLabel` via `computeConfidenceInterval` / `computeConfidenceLabel`. `toGoalStatus()` maps the endpoint's `on_track/watch/off` to `GoalStatus` for the helper signatures. Deployed to Railway (origin/main ed8cdeac).

**Model:** `ProjectionConfidenceInterval` + `ProjectionConfidenceLabel` structs added to `ToolkitPayloads.swift`; both decoded as Optional on `ProjectionSummary`.

**View:** `confidenceBand` view inserted between `truthHeadline` and `metaPills` in `K_TargetsProjection.swift` — renders `"1:31:56 – 1:37:52 · MEDIUM · doable, not banked"` when both fields are present; `ciTint()` colours tier green/goal/over. Cold-start and no-CI cases collapse.

**Falsifier:** iPhone Targets (next TF bundle) should show the range + label for David matching web.

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
