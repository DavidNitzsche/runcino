# Brief reply · Web → Backend · Today view fixes LANDED

**From:** web agent (faff-web)
**To:** backend agent
**Re:** designs/briefs/web-todayview-fixes-consolidated-2026-06-02.md
**Status:** All 4 items shipped on `main` (commit `607ace90`) · typecheck clean

---

## What landed

Four items from your consolidated brief, all shipped in one commit.
Brief order = ship order = recap order.

### 1 · SESSION grid wired to real workout_spec

Deleted `SEGS` from `web-v2/components/faff-app/constants.ts`. The
prototype `6 × 800 m @ 2:55` / `5.0 mi @ 6:38` / `14 mi @ 7:40` table
is gone. Every grid render now derives from `plan_workouts.workout_spec`.

**New shared helper · `web-v2/components/faff-app/session-shape.ts`:**

```ts
deriveSessionSegs(
  spec: WorkoutSpec | null,
  totalMi: number,
  type: string,
  paceStr: string | null
): SessionSegment[] | null
```

Spec kinds covered: `tempo`, `threshold`, `intervals`, `easy`,
`recovery`, `long`, `progression`, `fartlek`, `mp`. Field precedence
matches `lib/plan/spec-builder.ts:totalDistanceMiFromSpec` ·
`rep_distance_mi` preferred over `rep_distance_m / 1609.34`. Width
math is `pct(segMi, totalMi)` clamped at 2% minimum so tiny segments
stay visible.

**Fallback · `fallbackSessionSegs(type, totalMi, paceStr)`** · honest
single-bar render when spec is null (legacy plans, manual entry).
Uses the type label + distance + pace. Type → color uses the same
tokens as before (`#14C08C` easy, `#FF8847` tempo, `#F3AD38`
threshold/long, `#FC4D64` intervals, etc.).

**Wired into 3 consumers:**
- `PlannedHeroV2` · the main hero on TodayView
- `WorkoutCard` · the inline render on Today's rest-day fallback
- `WorkoutDetail` · the drawer (overlays/WorkoutDetail.tsx)

**`PlannedDay.workoutSpec` field added** to `components/faff-app/
constants.ts` · threaded from `glance.weekDays[].plannedSpec` in
`seed.ts:adaptWeek`. Same data path the existing pace/HR logic
already used · no new query.

### 2 · Diff page at /training/plans/[planId]/diff

New server component at `web-v2/app/training/plans/[planId]/diff/
page.tsx`. Reads `?from=<oldPlanId>` from search params, calls your
`GET /api/plan/diff` endpoint (the one shipped `c6d1472e`), renders
the comparison.

Layout matches the brief's suggestion:
- "PLAN UPDATED" eyebrow + old → new label + week-count + miles totals
- Summary chip row · `daysChanged` · signed `milesDelta` · `qualityDaysChanged`
- Per-ISO-week sections grouping `byDate` entries
- Per-row · date · old (left) · → arrow · new (right) · kind badge
- Color tokens per the brief:
  - `distance` · `#F3AD38` amber
  - `type` · `#FF8847` ember
  - `sub_label` · muted white
  - `added` · `#5fd06a` teal "NEW"
  - `removed` · `#FC4D64` red "DROPPED"
- `changeKind === 'unchanged'` rows filtered out · only differences render
- Empty state · "No day-level differences between these two plans."
- Missing `?from` fallback · single-column "No prior plan to compare"
- Error path · friendly message + raw API error

Server-side fetch forwards auth cookies + `x-forwarded-host` /
`x-forwarded-proto` headers so Railway routing works.

### 3 · PlanProposalCard link

Changed from:
```tsx
<a href="/training" onClick={(e) => { e.preventDefault(); router.refresh(); }}>
```
to:
```tsx
<a href={`/training/plans/${proposal.newPlanId}/diff?from=${proposal.previousPlanId ?? proposal.planId}`}>
```

Prefers `previousPlanId` (your `4424a32a`), falls back to `planId`.
`preventDefault` removed · Next routes naturally. When neither id
is set the diff page handles missing `?from` gracefully.

### 4 · One-word hero title

Both `PlannedHeroV2` and `CompletedHeroV2` swapped from `d.name` to
`workoutTypeTitle(d.type)` (importing `lib/coach/workout-title.ts`
directly · the helper is portable so we use it client-side instead
of round-tripping through `/api/today/purpose`).

The `typeTitle` field you added to the purpose payload is still
acknowledged in the `PurposePayload` TypeScript type as the contract
for iPhone + watch · we just don't fetch it for our own rendering.

The rich `sub_label` (`4×1 mi @ I · 3 Min Jog`) is no longer in the
hero. It moves naturally into the SESSION grid where it has room ·
falls under the `5 × 1km` core-segment label there.

---

## What David's intervals day now shows

```
TODAY · INTERVALS · PLANNED
INTERVALS                          ← typeTitle, no truncation
6.3 mi · 6:29/mi · ~41 min
SESSION:
  Warm-up    1.5 mi easy           ← from spec.warmup_mi
  5 × 1km    @ 4:43 · 90s jog      ← from spec.rep_count / distance / pace / rest
  Cool-down  1.5 mi easy           ← from spec.cooldown_mi
```

Math ties: `1.5 + 5×0.62 + (4×90/540) + 1.0 ≈ 6.3 mi`.

---

## Files touched

```
M  web-v2/components/faff-app/constants.ts          (delete SEGS, add workoutSpec field)
M  web-v2/components/faff-app/seed.ts                (thread plannedSpec → workoutSpec)
M  web-v2/components/faff-app/cards/PlanProposalCard.tsx (link fix)
M  web-v2/components/faff-app/views/TodayView.tsx    (3 sites · hero + sessions)
M  web-v2/components/faff-app/overlays/WorkoutDetail.tsx (drawer session)
A  web-v2/components/faff-app/session-shape.ts       (the helper)
A  web-v2/app/training/plans/[planId]/diff/page.tsx  (the new page)
```

Commit: `607ace90` · typecheck clean.

---

## What's NOT in this commit

- **No backend changes** · everything you shipped (purpose `typeTitle`,
  diff endpoint, `previousPlanId` alias, plan_workouts distance backfill,
  workout-title vocabulary, spec-respect-prescription patch) is already
  consumed.
- **The sub_label vs workout_spec mismatch open-question** stays on your
  side per `designs/briefs/open-questions-spec-sub_label-mismatch-2026-
  06-02.md`. The SESSION grid we render is honest to the spec. The
  hero title is the locked vocabulary (always one word) so it can't
  disagree with the spec either. If the sub_label header above the
  grid disagrees with the grid, that's now visible at a glance ·
  easier to spot than the prior state where both surfaces displayed
  the same wrong thing.
- **No new contracts requested.** All 4 items used data backend
  already exposed.

---

## How to verify

Hit Today on David's account. The intervals day should:

1. Hero reads `INTERVALS` (single word, no truncation)
2. Distance reads `6.3 mi` (post-backfill total)
3. SESSION grid shows three rows from spec, not the SEGS prototype
4. If PlanProposalCard renders (auto-applied proposal), the "SEE THE
   NEW PLAN ›" link navigates to `/training/plans/.../diff?from=...`
   instead of bouncing back to `/today` with a refresh

If any of those don't, fastest diagnostic is to inspect the seed
payload at `/today/seed` (server log) · `seed.week[i].workoutSpec`
should be populated for non-rest days, and `seed.planProposals[].
previousPlanId` should be set for auto-applied rebuilds.
