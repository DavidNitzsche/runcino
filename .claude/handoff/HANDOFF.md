# Handoff · run-completion workflow (dev → main)

Two parallel implementations of the same fix landed at the same time. This patch is the **dev-branch** version (commit `e5349b9` on `origin/claude/build-runcino-app-OIRJr`), produced before noticing the parallel `STEP 3` commit on `origin/main` (`8d4f529`). Hand to whichever agent is on `main` so they can compare / merge / pick.

## What this patch does

Closes the run-completion loop:

1. **Writeback rename** — `/api/strava/sync` now renames matched activities on Strava (`PUT /activities/{id}`) to "Easy · Apr 14" form. Idempotent (skips when name already starts with planned prefix). OAuth scope upgraded to include `activity:write`.
2. **Shoe auto-assign** — same sync pass stamps the user's preferred shoe for the run-type (planned type → RunType, not Strava name). Skips when `shoe_id` already set so manual picks are sticky. Increments shoe mileage.
3. **Completion ✓ pins** — hero `TodayCard` swaps `SCHEDULED` → green `✓ DONE · X MI` when actual ≥ 60% planned. Greet `TODAY` tile flips green. `/workout/[date]` gets `✓ COMPLETED` chip + "Actuals from Strava" tile (mi · duration · pace · HR). Existing week-strip / training calendar `isDone` paths already worked off `actualMi > 0` — left untouched.

## File layout on the dev branch

These don't exist on `origin/main` — main has its own equivalents:

- `web/lib/plan-match.ts` (new, ~170 LOC) — match logic + threshold + run-type mapper
- `web/lib/strava-writeback.ts` (new, ~115 LOC) — title generator + PUT call
- `web/lib/strava-cache.ts` (edited) — adds `markWriteback`, `autoAssignShoe`, `getActivitySyncMeta`
- `web/lib/db.ts` (edited) — adds `writeback_at`, `writeback_name`, `shoe_auto_assigned_at` columns (idempotent ALTERs)
- `web/app/api/strava/sync/route.ts` (edited) — adds `runPlanMatchPass`
- `web/app/api/strava/connect/route.ts` (edited) — scope `+activity:write`
- `web/app/api/overview/route.ts` + `web/app/overview/data.ts` + `web/app/overview/page.tsx` — surfaces `todayCompletion` + ✓ pin on hero
- `web/app/workout/[date]/page.tsx` (edited) — actuals tile + ✓ chip
- `web/lib/__tests__/plan-match.test.ts` (new, 28 cases) — match tolerance, rest-day exclusion, 60% threshold, title generator, idempotency

## Translating to main's file layout

`origin/main` references `lib/sync-strava-user.ts`, `lib/completed-runs.ts`, `lib/shoe-picker.ts` — none of which exist on dev. So `git apply` won't be clean. The main agent should treat this patch as a **reference implementation**, not a drop-in:

| Dev module | Where it likely lives on main |
|---|---|
| `lib/plan-match.ts` | merge into `lib/completed-runs.ts` (matching + completion helpers) |
| `lib/strava-writeback.ts` | already exists on main as `lib/strava-writeback.ts` (318 LOC vs my 115 — main's is more elaborate) |
| `lib/strava-cache.ts` helpers | adapt to main's `lib/sync-strava-user.ts` |
| DB column ALTERs | check schema-migration story on main |
| `runPlanMatchPass` in `/api/strava/sync` | the gap STEP 3 closed (webhook-only writeback) — verify it's wired |
| Overview ✓ pin + `/workout/[date]` actuals tile | check STEP 3 already added these |

## Verification done on dev

- `npx vitest run lib/__tests__/plan-match.test.ts` — 28/28 pass
- `npx tsc --noEmit` — clean
- `npx next build` — clean (47/47 routes generated)
- Browser preview — `/overview` and `/workout/[date]` render; `/api/overview` returns `todayCompletion` in response

Pre-existing failures on baseline (NOT introduced by this patch): `plan-builder.test.ts` race-week, `coach-engine-scenarios.test.ts` mid-build ramp tolerance, `retrospective.test.ts` (suite-level failure).

## Source of truth

Commit on dev: `e5349b9` on `origin/claude/build-runcino-app-OIRJr`. Apply via:

```bash
git checkout main
git am .claude/handoff/0001-feat-sync-writeback-rename-shoe-auto-assign-completi.patch
# expect conflicts — see translation table above
```

Or cherry-pick from the remote branch:
```bash
git fetch origin claude/build-runcino-app-OIRJr
git cherry-pick e5349b9
```
