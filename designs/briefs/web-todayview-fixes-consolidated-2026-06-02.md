# Brief · Backend → Web · Today view fixes from David's 2026-06-02 flag

**From:** backend agent
**To:** web agent
**Re:** Today screenshot flag · 4 items
**Status:** Backend half shipped · web work outstanding

---

## Context

David flagged the Today card this morning · 4 distinct issues. Backend
has shipped data + API fixes. Web owns the visible parts of items 2-4.

---

## What's already done on backend (no action needed)

- **`27ce14bf`** · sub-threshold ingest filter on all 4 write paths ·
  scrubbed 5 tap-test rows from David's data
- **`08093bbf`** · `plan_workouts.distance_mi` now stores TOTAL miles
  (WU + core + float-jogs + CD) · backfill ran on David's plan, 16
  rows updated. Today card distance is now 6.3 mi (was 4.0), Thursday
  is 6.8 mi (was 4.0). Confirmed rendering in the latest screenshot.
- **`c6d1472e`** · `GET /api/plan/diff` endpoint live
- **`<next commit>`** · `typeTitle: string` added to /api/today/purpose
  response · single source of truth for the hero title vocabulary

---

## Web work · 4 items

### 1 · Wire the SESSION breakdown grid to real `workout_spec`

**File:** `web-v2/components/faff-app/constants.ts:42-46`

The `SEGS` constant is hardcoded prototype data from the original
Faff design handoff. Every "intervals" day on Today renders
`6 × 800 m @ 2:55 · 400m float` regardless of what the engine
prescribed. Same problem for tempo (`5.0 mi @ 6:38`) and long
(`14 mi @ 7:40`). This is still rendering in David's latest
screenshot.

**The fix:** delete `SEGS` (nothing else reads it) and derive the
grid from `plan_workouts.workout_spec`. The spec is already loaded
on the today payload.

**Spec shape by type:**

```ts
// tempo
{ kind: 'tempo', warmup_mi, tempo_distance_mi, tempo_pace_s_per_mi, cooldown_mi, hr_target_bpm }

// threshold | intervals
{ kind: 'threshold' | 'intervals',
  warmup_mi,
  rep_count, rep_distance_mi (or legacy rep_distance_m in metres),
  rep_pace_s_per_mi, rep_rest_s, cooldown_mi, lthr_bpm }

// easy | recovery | long | shakeout | race
{ kind, pace_target_s_per_mi_lo, pace_target_s_per_mi_hi, hr_cap_bpm, fuel_mi: number[] }
```

**Render rules:**

| spec.kind | Segments (left → right) |
|---|---|
| `tempo` | Warm-up · Tempo block · Cool-down |
| `threshold` / `intervals` | Warm-up · `N × repMi` (@pace · `restS` jog) · Cool-down |
| `easy` / `recovery` / `shakeout` | Single bar · pace range from lo/hi |
| `long` | Single bar + fuel dots at `fuel_mi` values |
| `race` | Single bar · race pace |
| `rest` / null spec | No grid · show `subLabel` text only |

**Width math:** `w = round((segmentMi / totalMi) × 100)`. Total comes
from `distance_mi` (correct post-backfill).

**Schema note:** older rows have `rep_distance_m` (metres). Prefer
`rep_distance_mi` when present, fall back to `rep_distance_m / 1609.34`.
Mirror the field-precedence in `lib/plan/spec-builder.ts:totalDistanceMiFromSpec`.

---

### 2 · Build the "SEE THE NEW PLAN" diff page

**Backend endpoint:** `GET /api/plan/diff?from=<oldPlanId>&to=<newPlanId>`

Ownership-checked. Returns:

```ts
{
  ok: true,
  from: { id, label, authoredIso, archivedIso, totalMiles, weekCount },
  to:   { /* same */ },
  byDate: [
    {
      date: 'YYYY-MM-DD',
      old: WorkoutRow | null,
      new: WorkoutRow | null,
      changeKind: 'unchanged' | 'distance' | 'type' | 'sub_label' | 'added' | 'removed'
    }
  ],
  summary: { daysChanged, milesDelta /* signed */, qualityDaysChanged }
}

interface WorkoutRow {
  date, type, distanceMi, subLabel, isQuality, isLong, workoutSpec
}
```

**New page:** `/app/training/plans/[planId]/diff/page.tsx` (server
component). Reads `?from=<oldId>` from search params, calls the API,
renders comparison.

**Suggested layout:**
- Header · "PLAN UPDATED" eyebrow + old → new label
- Summary chip row · `daysChanged` · `milesDelta` (signed) ·
  `qualityDaysChanged`
- Per-ISO-week sections grouping `byDate` entries
- Per-row · date · old (left) · arrow · new (right) · change-kind badge

**Color hints (use existing tokens):**
- `unchanged` · muted, no row weight
- `distance` · amber on the number
- `type` · ember on the type chip
- `sub_label` · italic on the label
- `added` · teal "NEW" badge
- `removed` · red "DROPPED" badge

---

### 3 · Update `PlanProposalCard.tsx`

**File:** `web-v2/components/faff-app/cards/PlanProposalCard.tsx:198-217`

Currently:
```tsx
<a
  href={`/training`}
  onClick={(e) => { e.preventDefault(); router.refresh(); }}
>
  SEE THE NEW PLAN ›
</a>
```

Change to:
```tsx
<a href={`/training/plans/${proposal.newPlanId}/diff?from=${proposal.previousPlanId ?? ''}`}>
  SEE THE NEW PLAN ›
</a>
```

Drop the `preventDefault` · let Next route to the new page.

**Dependency:** backend will add `previousPlanId` to `PlanProposalSeed`
in a follow-up commit. Until that lands, the `?from=` query param
will be empty · the diff page should handle that gracefully (show
"no prior plan to compare" or render the new plan in single-column
mode).

---

### 4 · One-word hero title on the Today card

**The flag:** the current hero renders `sub_label` ("4×1 MI @ ...")
which truncates awkwardly when there's a right-side panel. Every
workout should have a ONE WORD hero title: TEMPO, EASY, INTERVALS,
LONG, etc.

**Backend just shipped the vocabulary as `typeTitle` on
`/api/today/purpose`:**

```ts
typeTitle: string   // e.g. "TEMPO" | "INTERVALS" | "EASY" | "LONG"
```

The locked vocabulary lives in `web-v2/lib/coach/workout-title.ts`:

| `type`             | `typeTitle`   |
|--------------------|---------------|
| `easy`             | `EASY`        |
| `recovery`         | `RECOVERY`    |
| `long`             | `LONG`        |
| `tempo`            | `TEMPO`       |
| `threshold`        | `THRESHOLD`   |
| `intervals`        | `INTERVALS`   |
| `vo2max`           | `INTERVALS`   |
| `progression`      | `PROGRESSION` |
| `fartlek`          | `FARTLEK`     |
| `shakeout`         | `SHAKEOUT`    |
| `race`             | `RACE`        |
| `race_week_tuneup` | `TUNE-UP`     |
| `rest`             | `REST`        |
| `cross`            | `CROSS-TRAIN` |
| `strength`         | `STRENGTH`    |
| `unplanned`        | `UNPLANNED`   |

**Web change:** render `purpose.typeTitle` (Bebas / Oswald hero) for
the big title. Move `sub_label` to a secondary line below it or
into the SESSION grid's core-segment description.

Suggested layout:
```
TODAY · INTERVALS · PLANNED         ← existing eyebrow (already correct)

INTERVALS                            ← new hero · Bebas, was "4×1 MI @ ..."
4×1 mi @ I · 3 Min Jog               ← sub_label · smaller line · drop entirely if SESSION grid carries it

6.3 mi · 6:29/mi · ~41 min
```

This unblocks the truncation problem in David's screenshot. Same
field is consumable by iPhone (`titleText`) and watch (idle preview).

---

## Known follow-up · NOT blocking your work

Some quality rows have `sub_label` and `workout_spec` describing
different workouts (label says "4×1 mi @ I", spec says 5×1km). The
SESSION grid you build will be honest to the spec · the sub_label
header above it may still disagree on those rows.

Tracking: `designs/briefs/open-questions-spec-sub_label-mismatch-2026-06-02.md`

Backend will fix the generator in a separate cycle.

---

## Smoke after you ship

After everything lands, Today (David's screenshot scenario) should
render:

- Eyebrow: "TODAY · INTERVALS · PLANNED"
- Hero (NEW): **INTERVALS** ← typeTitle, was "4×1 MI @ ..." truncated
- Sub line: "4×1 mi @ I · 3 Min Jog" (or drop · grid carries the shape)
- Distance: 6.3 mi · 6:29/mi · ~41 min
- SESSION grid (from spec, post-rewire):
  - Warm-up 1.5 mi · 1.5 mi easy
  - 5 × 1km · @ 4:43 · 90s jog ← real spec, not hardcoded 6×800
  - Cool-down 1.0 mi · 1.0 mi easy
- "SEE THE NEW PLAN ›" navigates to the diff page

The 1.5 + 5×0.62 + (4×90/540) + 1.0 ≈ 6.3 mi math finally ties.

---

## Files this touches

- `web-v2/components/faff-app/constants.ts` (delete `SEGS`)
- `web-v2/components/faff-app/cards/PlanProposalCard.tsx` (link fix)
- `web-v2/components/faff-app/views/TodayView.tsx` (hero title swap +
  SESSION grid wiring · grep for `SEGS` usage)
- New: `web-v2/app/training/plans/[planId]/diff/page.tsx`

---

## Related briefs (full detail per item)

- `designs/briefs/backend-plan-diff-endpoint-2026-06-02.md`
- `designs/briefs/backend-session-grid-wire-to-spec-2026-06-02.md`
- `designs/briefs/open-questions-spec-sub_label-mismatch-2026-06-02.md`
