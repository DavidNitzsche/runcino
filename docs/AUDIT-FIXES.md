# AUDIT-FIXES

Completed fixes and their follow-up queue. Add new items at the top of each section.

---

## Landed (2026-06-08 · coach voice audit · Item 6)

### Banned words — 5 hits removed

| File | Old | New |
|---|---|---|
| `components/faff-app/views/TodayView.tsx:2908` | `a genuinely easy run` | `an easy run` |
| `components/faff-app/views/GapPanel.tsx:266` | `genuinely mountainous` | `mountainous` |
| `lib/coach/checkin-reply-canned.ts:76` | `body honestly worked. Earned it.` | `body worked for it. Earned.` |
| `lib/coach/checkin-reply-canned.ts:79` | `Hit the goal honestly.` | `Hit the goal.` |
| `lib/coach/readiness-brief.ts:634` | `take the long honestly.` | `take the long as planned.` |

### Jargon — 5 instances replaced with plain English

| File | Change |
|---|---|
| `lib/coach/readiness.ts:172–173` | LOAD pillar `observedV` now `"0.95 ACWR (this week vs last 4 weeks)"` · `observedSub` now `"this week X · month avg Y mi/day"` |
| `components/faff-app/views/HealthView.tsx:752` | TRAINING FORM insight appends `"(weekly load vs monthly base)"` after bare ACWR number |
| `lib/coach/health-actions.ts:200` | Hard-rules footer: `"ACWR > 2.0, TSB ≤ −30"` → `"weekly load ratio > 2.0, form score ≤ −30"` |
| `lib/coach/health-actions.ts:358/360 + 514/516` | TSB overreach + race-ready action/cite labels: `"TSB …"` → `"Form score …"` |
| `components/faff-app/views/ProfileView.tsx:408` | Profile LTHR tile label: `"LTHR"` → `"LTHR (threshold HR)"` |

### Strength copy — pull-back band / multi-pillar jargon

`lib/coach/strength-recommender.ts:504`

```
BEFORE: Composite readiness in pull-back band (SLEEP below 14d). Heavy lifting under multi-pillar fatigue is injury risk.
AFTER:  Readiness low (SLEEP below 14d). Heavy lifting when sleep and recovery are both down is injury risk.
```

### Deferred — glossary / tooltip system

`StatTile` in `components/faff-app/toolkit/atoms.tsx:177` has an `onExplain` prop that renders a "WHY" button when wired. The hook is already scaffolded; it's only wired to `HealthProfile.tsx` today and fires an external callback. There is no glossary component, no definitions file, and no drawer/modal. HRV, ACWR, VDOT, and negative-split would all be good candidates for a first-use tooltip.

**What this would take:**
- A `GLOSSARY` definitions map (`Record<string, string>` or a small component per term)
- A reusable `GlossaryDrawer` or popover component
- Wire `onExplain` on the readiness pillar tiles and the TRAINING FORM insight tile

Good candidate for its own session. No urgency — the plain-English copy fixes above cover the most exposed surfaces.

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

### 9.3 · Watch complication — SCOPED, post-AFC

**Effort:** ~2.5–3 days (not weeks).

**Infrastructure already in place:**
- App Group `group.run.faff.app` registered in all three entitlements (`Faff.entitlements`, `FaffWatch Watch App.entitlements`). Zero provisioning surprise.
- `/api/watch/today` already returns `name`, `distanceMi`, `paceLabel`, `readinessScore`, `readinessLabel` — enough for lines 1+2 of the complication copy.
- `WatchReadiness.nextRace.daysAway` struct already modeled in `Watch.swift:342`; `loadCoachState` is already called in `buildWatchToday:506` so `daysToRace` is one field addition away.

**Work required (in order):**
1. New Widget Extension Xcode target + App Group capability added to all three targets (iPhone, watch, widget extension)
2. `PhoneSync.swift`: on workout receipt, write payload to `UserDefaults(suiteName: "group.run.faff.app")` + call `WidgetCenter.shared.reloadAllTimelines()`
3. Server: add `daysToRace: Int?` to `buildWatchToday` response (one line — `state.nextARace?.days_to_race` already in scope)
4. `AppIntentTimelineProvider` + timeline entry struct (morning-refresh policy + `WidgetCenter` trigger from watch)
5. SwiftUI views: `.accessoryRectangular` (primary) + `.accessoryCircular` (secondary) + nil states (rest day, no sync, no race in range)

**Complication copy:**
```
TEMPO · 8mi
READY 78 · AFC 38d
```

**Timing:** build after AFC (Aug 16). Target: CIM training block onset. Do NOT schedule during peak build — Xcode target setup + App Group entitlement changes touch all three targets and require a provisioning pass. High blast radius relative to the coaching engine work that dominates peak.

---

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
