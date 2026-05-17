# Merge plan — our HEAD + origin/main → main

> Generated 2026-05-12 from `git diff origin/main..HEAD --stat` (134 differing files).
> HEAD = `claude/build-faff-app-OIRJr@0db9e91` plus uncommitted Wave 1 changes.
> Main = `origin/main@60c509d`.
> Common ancestor = `0fd5408` (2026-05-08).

## Summary

- **Total files differing:** 134 (committed) + 19 (uncommitted Wave 1 working tree)
- **Decision tally** (committed diff):
  - **OURS** — 47 files (May 9 designs, page ports, component library, new tokens, Wave-1 docs)
  - **THEIRS** — 56 files (real Coach engine, real VDOT, real lib/coach-engine, real strava-stats, real coach-workouts, real gpx-analysis, real race-detail page, real workout page, all main-only API routes, all main-only lib utilities, all tests)
  - **MERGE** — 14 files (coach.ts, types.ts, citations.ts, coach-state.ts, db.ts, doctrine/cite.ts, globals.css, components/nav.tsx, package.json, vitest.config.ts, coach-engine.ts, doctrine/recovery_protocols.ts, doctrine/pace_zones.ts, web/app/page.tsx)
  - **UNION** — 10 files (new doctrine constants on main: grading.ts, plan_integrity.ts; new web/lib utilities; new test files; new components on main not duplicated)
  - **CONFLICT** — 7 files flagged for human review (see P0 section)
- **Estimated merge effort:** **LARGE** — ~3 working days of careful merging, with the Coach engine and coach-state being the dominant complexity.

The high-level shape:
- **Take main as base** (95 commits we don't have, including all the real backend wiring).
- **Cherry-pick our 8 commits** (designs lock, Phase 0 foundation, 6 page ports).
- **Re-apply the uncommitted Wave 1 changes** (doctrine `Research/` migration + state.fitness + new DB tables + Coach.vdotSnapshot + real Riegel raceFitnessPrediction).
- **Selectively patch coach.ts** to combine main's real methods (paceStrategy/taperDepth/fuelingFor/retrospect/briefDailyTraining) with our 7+1 new methods (bodySystems, trajectory14wk, proofSessions, raceFitnessPrediction, weekDeltas, engineDetails, runRead, coachRead, vdotSnapshot).

---

## Per-file decisions

### Group 1 · UI pages (the May 9 design ports)

These are the canonical, locked port from `designs/*-2026-05-09.html`. Each one is a clean rewrite that replaces whatever main has been doing to the same page. They each have an accompanying `data.ts` and (for some) an `api/<page>/route.ts` that is the data wiring layer.

| File | Decision | Notes |
| ---- | -------- | ----- |
| `web/app/overview/page.tsx` | **OURS** | 2448 lines, brand-new directory (main puts it all in `web/app/page.tsx`). Mockup port. |
| `web/app/overview/data.ts` | **OURS** | New file — Coach-method-only data layer. |
| `web/app/training/page.tsx` | **OURS** | 3748 lines vs main's older version. Mockup port. |
| `web/app/training/data.ts` | **OURS** | New file. |
| `web/app/races/page.tsx` | **OURS** | Mockup port. Replaces main's older list view. |
| `web/app/races/data.ts` | **OURS** | New file. |
| `web/app/health/page.tsx` | **OURS** | 2558 lines — research-grounded rebuild. |
| `web/app/health/data.ts` | **OURS** | New file. |
| `web/app/log/page.tsx` | **OURS** | Mockup port; wired to Strava history. |
| `web/app/log/data.ts` | **OURS** | New file. |
| `web/app/profile/page.tsx` | **OURS** | Mockup port. |
| `web/app/profile/data.ts` | **OURS** | New file. |
| `web/app/page.tsx` (root) | **MERGE → OURS** | Our HEAD reduces this to a thin redirect to `/overview` (1479 lines). Main has it as the full 3201-line dashboard. **Keep our thin redirect**; the dashboard moved into `/overview`. Verify no important utility function from main's `page.tsx` got orphaned — if so, lift it out into `lib/`. |
| `web/app/races/[slug]/page.tsx` | **THEIRS** | Main built the full race-detail page (2757 lines) with course visuals, hydration tile, similar-races tile, etc. Our version is the stale 1867-line earlier port — main's wins on real coaching content. |
| `web/app/races/new/page.tsx` | **THEIRS** | Both sides have it; main's is current. Tiny diff likely. |
| `web/app/runs/[id]/page.tsx` | **MERGE** | Main wires it to RunnerHub + RpeInput; ours drops both. The HubProvider should be replaced anyway (next bullet) but `RpeInput` is genuinely useful — re-derive it from Wave 1 plumbing or take main's version and re-wire. **Recommendation:** start from MAIN's version, drop the `HubProvider` wrapper if our hub-less architecture wins, keep `RpeInput`. |
| `web/app/workout/[date]/page.tsx` | **THEIRS** | Main has the real client-side prescription view (reads from hub.weekShape + hub.next30Days). Ours is the static placeholder. Wire-up to our coach-state instead of hub if hub is dropped. |
| `web/app/calibration/page.tsx` | **THEIRS** | Main-only feature (422 lines). Not in our 6-page redesign, but useful — keep linkable from /profile. **Risk:** verify it doesn't conflict with our `/profile` page redesign. |
| `web/app/season/page.tsx` | **THEIRS** | Main-only (538 lines). Main's `nav.tsx` already removed it from public nav and merged content into /races. Keep as a direct-link page. |
| `web/app/library/page.tsx` | **THEIRS** | Main-only (307 lines). Same treatment as `/season`. |
| `web/app/components/preview/page.tsx` | **OURS** | New component preview gallery — useful internal dev tool. |
| `web/app/*/page.tsx.legacy-bak` files (4 of them) | **DROP** | These are backup copies of the pre-port versions. Useful as reference but not needed in the merged tree. Either drop them or move to `docs/` if you want the audit trail. |

### Group 2 · Component library (`web/app/components/*`)

Brand-new component library introduced in Phase 0 foundation. All 19 files are **OURS** and have no counterpart on main.

| File | Decision |
| ---- | -------- |
| `web/app/components/Card.tsx` | **OURS** (new) |
| `web/app/components/CoachRead.tsx` | **OURS** (new) |
| `web/app/components/CourseMap.tsx` | **OURS** (new) |
| `web/app/components/DatePicker.tsx` | **OURS** (new) |
| `web/app/components/Dropdown.tsx` | **OURS** (new) |
| `web/app/components/ElevationChart.tsx` | **OURS** (new) |
| `web/app/components/ElevationGradient.tsx` | **OURS** (new) |
| `web/app/components/EmptyState.tsx` | **OURS** (new) |
| `web/app/components/Field.tsx` | **OURS** (new) |
| `web/app/components/FileDrop.tsx` | **OURS** (new) |
| `web/app/components/Greet.tsx` | **OURS** (new) |
| `web/app/components/MileChip.tsx` | **OURS** (new) |
| `web/app/components/Modal.tsx` | **OURS** (new — distinct from old `web/components/modal.tsx`) |
| `web/app/components/PhaseCards.tsx` | **OURS** (new) |
| `web/app/components/RouteMap.tsx` | **OURS** (new) |
| `web/app/components/Row.tsx` | **OURS** (new) |
| `web/app/components/Stage.tsx` | **OURS** (new) |
| `web/app/components/TimePicker.tsx` | **OURS** (new) |
| `web/app/components/Topbar.tsx` | **OURS** (new) |
| `web/app/components/index.ts` | **OURS** (new — barrel) |
| `web/app/components/preview/page.tsx` | **OURS** (new) |

Old `web/components/*` (used by main's pages):
| `web/components/RpeInput.tsx` | **THEIRS** | Useful component; keep until /log redesign re-implements. |
| `web/components/coaching/CoachDailyBrief.tsx` | **THEIRS** | Still used by main's `/app/page.tsx` dashboard; needed temporarily by any not-yet-migrated route. |
| `web/components/coaching/ReadinessBanner.tsx` | **THEIRS** | Same as above. |
| `web/components/nav.tsx` | **MERGE** | Main expanded the tab list to 9 entries (added calibration, library, season). Ours kept the 6-tab design. **Recommendation:** keep our 6-tab `TABS` array (the May 9 IA only shows 6) BUT add Calibration as a 7th tab if we want to keep that route linkable, or drop the tab and accept direct-link access. Resolve via P0. |

### Group 3 · Coach engine

This is the highest-complexity area. Both sides have made substantial, mostly-disjoint advances.

#### `web/coach/coach.ts` → **MERGE** (largest single merge)

**Take main's CoachImpl as the base.** Methods to harvest from each side:

**Keep from OURS (HEAD, including uncommitted Wave 1):**
- `bodySystems()` — new, Stage 7+
- `trajectory14wk()` — new, Stage 7+
- `proofSessions()` — new, Stage 7+
- `raceFitnessPrediction()` — real Riegel-based prediction (Wave 1A, uncommitted). Pulls from `state.fitness.vdot` + Research/01 VDOT-row + Research/02 Riegel. **Critical: this is the Wave 1 highlight.** Replaces a Stage-7 stub.
- `weekDeltas()` — new
- `engineDetails()` — new
- `runRead()` — new
- `coachRead()` — new
- `vdotSnapshot()` — new in uncommitted working tree, Wave 1A. Pure pass-through over `state.fitness`. Mandatory: every page that wants VDOT reads it through Coach.

**Keep from THEIRS (main):**
- `paceStrategy()` — Stage 1, real implementation (HEAD has it as `notYet(1)`)
- `taperDepth()` — Stage 1, real implementation
- `fuelingFor()` — Stage 1, real implementation
- `retrospect()` — Stage 4, real implementation (HEAD has it as `notYet(4)`)
- `briefDailyTraining()` — new method on main, used by dashboard. **Must be kept.**

**Methods present on BOTH with different bodies (resolve per-method):**
- `prescribeWorkout()` — both have a real impl. Main's has been tuned across 95 commits with engine-gap fixes, RPE, post-race recovery, etc. **THEIRS wins** for the body; verify our caller contracts (`PrescribeWorkoutInput`, `WorkoutPrescription`) match.
- `assessReadiness()` — same logic as `prescribeWorkout`. **THEIRS wins** on body; check our caller contract still matches.
- `briefRaceMorning()` — same pattern, **THEIRS wins** on body.

**Coach interface (type) merge:**
- Take main's `Coach` interface as base.
- Add our 9 new methods (`bodySystems`, `trajectory14wk`, `proofSessions`, `raceFitnessPrediction`, `weekDeltas`, `engineDetails`, `runRead`, `coachRead`, `vdotSnapshot`).
- Keep main's `briefDailyTraining` on the interface.

**Imports header to merge:**
- Take main's imports as base.
- Add ours: `BodySystemsReport`, `Trajectory14wk`, `ProofSessionsReport`, `RaceFitnessPrediction`, `WeekDeltasReport`, `EngineDetailsReport`, `RunReadReport`, `CoachReadReport`, `VdotSnapshotReport` from `./types`.
- Add ours: `gradeAdjustmentFactor` from `../lib/minetti`, `M_PER_MI` from `../lib/time`, `TAPER_BY_DISTANCE`, `RACE_DAY_FUELING` from `./doctrine/race_week`, `TAPER_VOLUME_REDUCTION` from `./doctrine/taper`, `RACE_CARB_TARGETS_G_PER_HR`, `GLUCOSE_FRUCTOSE_RATIO`, `HEAT_CARB_BUMP` from `./doctrine/fueling`, `FIRST_MILE_TARGET` from `./doctrine/pacing`, `RIEGEL_FORMULA`, `RIEGEL_ACCURACY_BY_GAP` from `./doctrine/race_prediction`, `vdotRow` from `../lib/vdot`.
- Keep main's: `MILEAGE_TIER_RECOVERY`, `mileageTier` from `./doctrine`.

#### `web/coach/types.ts` → **MERGE**

Take ours (HEAD, 335 lines) as base; we have a superset. Specifically:
- Both sides have `Citation`, `CoachBrain`, `CoachDecision`, `CoachBaseContext`, `CoachCalibration`.
- We add: `BodySystem`, `BodySystemsReport`, `TrajectoryPoint`, `Trajectory14wk`, `ProofSession`, `ProofSessionsReport`, `RaceFitnessPrediction`, `DayDelta`, `WeekDeltasReport`, `EngineDetail`, `EngineDetailsReport`, `RunReadReport`, `CoachReadReport`, `VdotSnapshotReport`.
- Check: main may have added `DailyTrainingBriefInput` (referenced in `coach.ts`). Pull that into types if it's defined in `coach.ts` on main but should canonically live in `types.ts`.

#### `web/coach/citations.ts` → **OURS**

Our HEAD migrated 24 citations from `docs/coaching-research.md` to canonical `Research/NN-*.md` paths. Main's still uses the legacy `rc()` form everywhere. Take ours wholesale — citations are doctrine-as-code, our migration is canonical.

If any new workout types appear in main's `coach.ts` that aren't covered in our switch (`citationsForWorkoutType` / `citationsForReadiness`), add a `cite(..., 'research', 'NN')` entry per the canonical doc list.

#### `web/coach/llm.ts`, `web/coach/explanations.ts`, `web/coach/voice.md` → likely identical, otherwise **THEIRS**

Not in the diff stats but mention for completeness. Verify with `git diff origin/main..HEAD -- web/coach/llm.ts web/coach/explanations.ts web/coach/voice.md` before assuming.

### Group 4 · Doctrine (`web/coach/doctrine/*`)

The doctrine layer is mostly identical on both sides. The differences are:

**Files on MAIN only (we deleted in Wave 1):**
| `web/coach/doctrine/grading.ts` | **UNION → THEIRS** | 156 lines on main; deleted on HEAD. The age/sex grading doctrine (Research/24) was migrated out, but **main's engine references it** (`gradeVdot`, `ageDeclineFromThirty`). Restore the file from main; revisit whether to migrate the data to `Research/24` after the merge. **P0 — needs decision.** |
| `web/coach/doctrine/plan_integrity.ts` | **UNION → THEIRS** | 196 lines on main; deleted on HEAD. Used by `plan-validator.ts`. Restore from main. |
| `web/coach/plan-validator.ts` | **UNION → THEIRS** | 236 lines on main; deleted on HEAD. The declarative plan-integrity validator. Useful runtime guardrail. Restore from main. |
| `web/coach/__tests__/plan-validator.test.ts` | **UNION → THEIRS** | 261-line test suite for the validator. Restore. |

**Files modified on HEAD (uncommitted Wave 1 working-tree changes):**
These 14 doctrine files have unstaged edits that migrate citation footers from `docs/coaching-research.md`-form to canonical `Research/NN-*` form:
- `cadence.ts`, `fueling.ts`, `intensity.ts`, `load.ts`, `post_race.ts`, `recovery.ts`, `shoes.ts`, `strength.ts`, `taper.ts`, `volume.ts`

**Decision:** **OURS** (the Wave 1 citation migration). Apply on top of whatever main has there. The diffs are mechanical — re-route `rc('§N.M', '…')` to `cite('§N.M', '…', 'research', 'NN')`.

**Files on HEAD only or substantially changed on HEAD:**
- `web/coach/doctrine/cite.ts` → **MERGE** — main has `ResearchDocId '24'` and the `'24-vdot-age-sex-grading.md'` entry which we removed. Keep main's superset (which includes '24') — if `grading.ts` is restored (above), the cite IDs need to support '24'.
- `web/coach/doctrine/index.ts` → **MERGE** — main's barrel exports `pace_zones`, `plan_integrity`, `grading`. Ours dropped them. **If we restore those files (above), restore the exports too.**
- `web/coach/doctrine/pace_zones.ts` → **MERGE** — main has 826 lines with VDOT tier classification; ours is 670 lines (tier block removed). **Take main's superset** — the tiers (VDOT_TIERS, vdotTierFor, vdotFreshnessFor) are referenced by the engine. The 156 lines we removed are real doctrine.
- `web/coach/doctrine/recovery_protocols.ts` → **MERGE** — similar pattern. Main has 646 lines; ours is 550. Take main's superset.

### Group 5 · Libs (`web/lib/*`)

#### Main-only libs (UNION → keep all)

These 10 libs all came from main's 95 commits and are required by main's coach engine + dashboard. **Keep them all from THEIRS:**

| File | Purpose |
| ---- | ------- |
| `web/lib/coach-today-cache.ts` | Postgres-backed cache layer for `/api/coach/today`. Option-C eternal-cache. |
| `web/lib/coach-today-payload.ts` | Builds the cached payload (state + brief + workout). |
| `web/lib/hub-provider.tsx` | React Context that wraps every page; consumed by `useHub()`. |
| `web/lib/hub-types.ts` | Type defs for the hub. |
| `web/lib/hub.ts` | `/api/hub` fetcher. |
| `web/lib/long-run-cap.ts` | Doctrine-based long-run distance ceiling. |
| `web/lib/recovery-distance.ts` | Distance band for post-race protocols. |
| `web/lib/rpe-store.ts` | RPE persistence layer. |
| `web/lib/runner-profile-store.ts` | Postgres-backed profile store. |
| `web/lib/runner-profile.ts` | Profile helpers (age from birthdate, etc.). |

**However**, the May 9 design replaces the hub-driven dashboard with a Coach-method-driven `/overview` page that doesn't use `useHub()`. So `hub-provider.tsx`, `hub-types.ts`, `hub.ts` MIGHT be droppable. **P0 — needs decision.** Conservative path: keep them, the new pages just won't use them.

#### Libs that differ substantially → mostly **THEIRS**

| `web/lib/coach-engine.ts` | **THEIRS** | Main grew from 572 → 1273 lines with `computeAdaptiveSignal`, the validator integration, real `next30Days` + `weekShape` projection, post-race recovery, mileage-tier recovery, etc. **Take main's version wholesale.** This is *the* engine of the app. Wave 1 doesn't depend on it (the new shape `state.fitness` is upstream of the engine, not in it). |
| `web/lib/coach-state.ts` | **MERGE** | We add `state.fitness` (FitnessSnapshot + computation) in Wave 1 (uncommitted). Main adds `state.runner`, `state.rpe`, expanded `state.recovery`, expanded `state.races`. **Take main's version as base, then apply our Wave 1 patch** (the diff is mostly additive — adds FitnessSnapshot interface + a `fitness` field + a computation block in `gatherCoachState`). |
| `web/lib/coach-workouts.ts` | **THEIRS** | Main adds `vdotTest5K`, `goalPaceTag`, more elaborate VDOT-pace bands. |
| `web/lib/coach-plan.ts` | **THEIRS** | Main has the active-template selection + `templateWorkoutType` helper used by the engine. |
| `web/lib/coach-principles.ts` | **THEIRS** | Main adds `buildWindowDays`, `phaseProgress`, `lerpByProgress`, distance-aware constants. |
| `web/lib/storage.ts` | **THEIRS** | Main wires it through the hub; ours fell back to the older direct fetch. Take main's; mutations call `bumpHubCache()` which is a no-op if hub is dropped. |
| `web/lib/strava-stats.ts` | **THEIRS** | Main adds non-race filtering, more accurate long-run-avg, cutback detection. |
| `web/lib/gpx-analysis.ts` | **THEIRS** | Main has the 200m sliding-window steepest-grade refinement. |
| `web/lib/vdot.ts` | **THEIRS** | Main has the real `vdotSnapshot` with tiers + freshness; **our Wave 1 `state.fitness` builds on main's vdot.ts.** Confirm `vdotFromRace`, `vdotRow`, `pacesFromVdot` signatures are stable — Wave 1's `coach-state.ts` patch imports them. |
| `web/lib/db.ts` | **MERGE** | Main has tables: `races`, `strava_activities`, `strava_sync_state`, `shoes`, `recovery_sessions`, `runner_profile`, `coach_today_cache`, `workout_rpe`. **Take main as base.** Then apply Wave 1 working-tree patch which adds: `daily_checkin`, `personal_goals`, `user_prefs`, `profile`. These additions don't conflict — all are `CREATE TABLE IF NOT EXISTS`. Append our 4 tables to the bootstrap. |

#### Test files (UNION → keep all)

| `web/lib/__tests__/age-from-birthdate.test.ts` | **THEIRS** (new on main) |
| `web/lib/__tests__/decide-mode.test.ts` | **THEIRS** (new on main) |
| `web/lib/__tests__/effort-balance.test.ts` | **THEIRS** (new on main) |
| `web/lib/__tests__/grading.test.ts` | **THEIRS** (new on main, depends on `doctrine/grading.ts`) |
| `web/lib/__tests__/phase-progress.test.ts` | **THEIRS** (new on main) |
| `web/lib/__tests__/vdot-sanity.test.ts` | **MERGE** | Both have it. Main's expanded suite covers tiers + freshness; ours dropped those assertions in line with removing tiers. Restore main's full test, since pace_zones.ts also gets restored (above). |

### Group 6 · API routes

#### Main-only routes (UNION → keep all)

These are real endpoints powering main's dashboard:

| `web/app/api/brief/route.ts` | **THEIRS** | Real, wires through `coach.briefDailyTraining()`. |
| `web/app/api/cron/coach-refresh/route.ts` | **THEIRS** | Midnight cron for cache pre-warm. |
| `web/app/api/hub/route.ts` | **THEIRS** | The unified `/api/hub` aggregator. Drop only if hub is dropped (P0). |
| `web/app/api/retrospect/route.ts` | **THEIRS** | Real, wires `coach.retrospect()`. |
| `web/app/api/rpe/route.ts` | **THEIRS** | RPE log endpoint. |
| `web/app/api/runner-profile/route.ts` | **THEIRS** | Profile CRUD. |
| `web/app/api/strava/webhook/route.ts` | **THEIRS** | Strava webhook for cache invalidation. |

#### Our-only routes (page-data fetches)

| `web/app/api/health/route.ts` | **OURS** | New data layer for /health page. |
| `web/app/api/log/route.ts` | **OURS** | New data layer for /log page. |
| `web/app/api/overview/route.ts` | **OURS** | New data layer for /overview page. |
| `web/app/api/profile/route.ts` | **OURS** | New data layer for /profile page. Note: there's also `runner-profile/route.ts` on main — both should coexist (`/api/profile` is the new page-data route, `/api/runner-profile` is the CRUD endpoint). Verify no clash. |
| `web/app/api/races-page/route.ts` | **OURS** | New data layer for /races page. Distinct path from `/api/races` (CRUD). |
| `web/app/api/training/route.ts` | **OURS** | New data layer for /training page. |

#### Modified routes

| `web/app/api/coach/today/route.ts` | **MERGE → THEIRS** | Main has the cached version (5 lines, defers to `getCachedOrCompute()`). Ours has the direct compute path. **Take main's cached version.** The cache layer is a real performance win; Wave 1's `state.fitness` flows through it automatically once `coach-state.ts` is merged. |

### Group 7 · Designs + docs

#### Designs (only on HEAD)

All locked May 9 mockups — **OURS** (new files):
- `designs/_template-action-2026-05-09.html`
- `designs/_template-confirm-2026-05-09.html`
- `designs/_template-detail-2026-05-09.html`
- `designs/_template-edit-2026-05-09.html`
- `designs/_template-empty-2026-05-09.html`
- `designs/health-2026-05-09.html`
- `designs/log-2026-05-09.html`
- `designs/overview-2026-05-09.html`
- `designs/profile-2026-05-09.html`
- `designs/races-2026-05-09.html`
- `designs/training-2026-05-09.html`

These are CANONICAL per the user's intent #1.

#### Docs

Our-only docs:
| `docs/DESIGN_SYSTEM.md` | **OURS** (new) |
| `docs/HEALTH_PAGE_RESEARCH_ARCHITECTURE.md` | **OURS** (new) |
| `docs/MIGRATION_GAP_ANALYSIS.md` | **OURS** (new) |

Main-only docs (audit/session reports — historical record):
| `docs/AUDIT-2026-05-08-final.md` | **THEIRS** (keep — audit trail) |
| `docs/AUDIT-2026-05-08.md` | **THEIRS** |
| `docs/INVENTORY-2026-05-08.md` | **THEIRS** (2538-line inventory) |
| `docs/MORNING-SUMMARY-2026-05-08.md` | **THEIRS** |
| `docs/coach-refresh.yml.template` | **THEIRS** |
| `docs/audit-2026-05-08-evening.html` | **THEIRS** |
| `docs/audit-execution-2026-05-08.html` | **THEIRS** |
| `docs/inventory-2026-05-08.html` | **THEIRS** |
| `docs/morning-2026-05-08-pm.html` | **THEIRS** |
| `docs/morning-2026-05-08.html` | **THEIRS** |
| `docs/session-2026-05-08-evening.html` | **THEIRS** |
| `docs/session-2026-05-08-late.html` | **THEIRS** |
| `docs/walkthrough-audit-2026-05-08.html` | **THEIRS** |

Docs are append-only; keep both sets.

### Group 8 · Globals.css

| `web/app/globals.css` | **MERGE → OURS** | Ours adds 1342 lines of new tokens (May 9 design system: bars, pulse, mode hero, etc.). Main has the older design-token set. **Take ours as base, then diff vs main for any new utility classes main added (search for `dash-vdot-row`, `body-card`, etc. — main's recent commits mention them).** If they're orphaned (only main's old dashboard uses them), drop. Otherwise, keep both. |

### Group 9 · Misc

| `web/package.json` | **MERGE** | Our HEAD adds `@radix-ui/react-popover`, `@radix-ui/react-select`, `date-fns`, `react-day-picker`. Main drops `check-doctrine-drift` script. **Merge: keep main's scripts shape + add our 4 new deps.** |
| `web/package-lock.json` | **MERGE (regenerated)** | Run `npm install` after package.json is merged. Don't manually merge the lockfile. |
| `web/vitest.config.ts` | **MERGE** | Small diff (5 lines). Likely just an include-path change. Compare line-by-line and keep both sides' coverage. |
| `web/scripts/check-doctrine-drift.ts` | **UNION → OURS or DROP** | Only present on HEAD (main dropped it). Useful as a CI guard against doctrine drift; **keep if we restore `doctrine/grading.ts` + `plan_integrity.ts`**, otherwise drop because validator covers the same ground. |
| `.github/workflows/coach-refresh.yml` | **THEIRS** | Activated GitHub Actions cron on main; ours dropped it. **Take main's**, the cron is real and runs at midnight LA time. |
| `.claude/scheduled_tasks.lock` | **THEIRS** | Marker file from main's environment. Either is fine. |
| `web/CourseVisual.tsx` (note path) | Verify — not in diff stats but seen in `ls web/app/`. Check `git ls-tree` both sides; likely a misplaced or stale file. |

---

## Conflicts flagged for human review (P0)

These need a deliberate call from the user before merge execution:

1. **`web/coach/doctrine/grading.ts` + `plan_integrity.ts` + `plan-validator.ts`** — We deleted these in Wave 1 as part of the `Research/`-only doctrine migration, but main's engine references them and has tests against them. **Question:** Restore them from main and migrate their data to `Research/24` / `Research/22` later? Or rewrite the engine to no longer depend on them? Plan assumes: **restore from main** (lower risk).

2. **Hub provider / hub-driven dashboard** — Main's `web/lib/hub-provider.tsx` + `web/app/page.tsx` use a React Context that wraps every page. The May 9 design has no equivalent — each page calls Coach methods directly via its `data.ts`. **Question:** Drop the hub entirely (clean architecture, but requires careful removal of `useHub()` calls from any kept main-page like `/runs/[id]`, `/workout/[date]`) or keep it as a backward-compat layer that the new pages just don't consume? Plan assumes: **keep it as a backward-compat layer**, the new /overview etc. pages simply don't use it.

3. **Nav tab list (6 vs 9 entries)** — Main has 9 nav entries; the May 9 design shows 6 (Overview, Training, Races, Health, Log, Profile). Main's extra tabs (Calibration, Library, Season) are visible to users now. **Question:** Drop them from nav (May 9 IA) and accept users have to know the URLs to reach them? Or add a 7th "Calibration" entry to keep that feature discoverable? Plan assumes: **6-tab nav** per May 9 design; orphaned pages stay reachable by URL only.

4. **`web/app/page.tsx` (root)** — Our HEAD reduces it to a thin redirect; main has the full dashboard there. **Question:** Does `/` redirect to `/overview` (our design) or stay as a standalone dashboard? Plan assumes: **redirect to `/overview`**.

5. **`web/app/runs/[id]/page.tsx`** — Main wraps it in `HubProvider` + uses `RpeInput`. Our HEAD dropped both. **Question:** If hub is kept (P0 #2), keep main's wrapper; if hub is dropped, refactor `RpeInput` to call `/api/rpe` directly. Plan assumes: **take main's version, drop HubProvider wrapper, keep RpeInput**.

6. **`web/components/coaching/CoachDailyBrief.tsx` + `ReadinessBanner.tsx`** — Main's components used by the main-dashboard. Once `/overview` replaces the dashboard, these orphans. **Question:** Delete or keep until next cleanup pass? Plan assumes: **keep**, no rush.

7. **Wave 1 working-tree changes not yet committed** — They're sitting unstaged in HEAD's working tree. **Recommendation:** Commit them onto the current branch BEFORE the merge starts, so they're part of the cherry-pick set, not an out-of-band patch.

---

## Execution sequence

The order minimizes conflict surface by starting from the side with more changes and applying the smaller set on top:

1. **Commit Wave 1 working-tree changes onto HEAD branch.** Single commit "feat(wave-1): doctrine to Research + state.fitness + new tables + Coach.vdotSnapshot + real Riegel". Do not push.

2. **Create merge branch from origin/main.** `git checkout -b merge/may9-into-main origin/main`. Main has 95 commits we don't; this saves us 95 cherry-picks.

3. **Take our designs + docs wholesale.** No risk; new files only.
   ```
   git checkout claude/build-faff-app-OIRJr -- designs/ docs/DESIGN_SYSTEM.md docs/HEALTH_PAGE_RESEARCH_ARCHITECTURE.md docs/MIGRATION_GAP_ANALYSIS.md
   ```

4. **Take our component library wholesale.** Brand-new directory, no overlap.
   ```
   git checkout claude/build-faff-app-OIRJr -- web/app/components/
   ```

5. **Take our 6 page ports + data.ts files + new api routes.** Each one is a clean file replacement on a path main doesn't touch (except `runs/[id]`, `workout/[date]`, `races/[slug]`, `page.tsx` — handled separately in step 8).
   ```
   git checkout claude/build-faff-app-OIRJr -- \
     web/app/overview/ web/app/training/ web/app/races/page.tsx web/app/races/data.ts \
     web/app/health/ web/app/log/ web/app/profile/ \
     web/app/api/overview/ web/app/api/training/ web/app/api/races-page/ \
     web/app/api/health/ web/app/api/log/ web/app/api/profile/
   ```

6. **Take our globals.css.** Then audit for any orphaned classes from main and merge any utility classes worth keeping.
   ```
   git checkout claude/build-faff-app-OIRJr -- web/app/globals.css
   ```

7. **Patch package.json** to add the 4 new dependencies (`@radix-ui/react-popover`, `@radix-ui/react-select`, `date-fns`, `react-day-picker`). Run `npm install` to regenerate the lockfile.

8. **Merge `web/app/page.tsx`** (root) — replace with a thin redirect to `/overview`. Verify any utility functions that only existed in main's dashboard get extracted to `lib/` first.

9. **Merge the Coach engine layer** (the hardest step):
   - `web/coach/coach.ts` — manually splice ours + theirs as described in Group 3.
   - `web/coach/types.ts` — start from ours, add main's `DailyTrainingBriefInput`.
   - `web/coach/citations.ts` — keep ours; check any new workout types in main need cite entries.
   - `web/coach/doctrine/cite.ts` — keep main's (includes `'24'`).
   - `web/coach/doctrine/index.ts` — keep main's (includes `pace_zones`, `plan_integrity`, `grading`).
   - `web/coach/doctrine/pace_zones.ts` — keep main's (superset).
   - `web/coach/doctrine/recovery_protocols.ts` — keep main's (superset).
   - `web/coach/doctrine/grading.ts`, `plan_integrity.ts`, `plan-validator.ts` — restore from main.
   - Apply Wave 1 citation-migration patches to the 14 modified doctrine files.

10. **Merge `web/lib/coach-state.ts`** — start from main's version, apply our Wave 1 `state.fitness` patch (interface + compute block).

11. **Merge `web/lib/db.ts`** — start from main's version, append our 4 new tables (`daily_checkin`, `personal_goals`, `user_prefs`, `profile`).

12. **Merge `web/components/nav.tsx`** — pick 6 vs 9 tabs based on P0 #3.

13. **Run TSC** (`cd web && npx tsc --noEmit`). Fix import errors page by page.

14. **Run unit tests** (`npm test`). Fix breakages.

15. **Smoke test each major page** (`/`, `/overview`, `/training`, `/races`, `/races/[slug]`, `/health`, `/log`, `/profile`, `/workout/[date]`, `/runs/[id]`).

16. **Commit + open PR.** Title: "Merge May 9 design ports + Wave 1 onto main".

---

## Risk areas

1. **Coach.ts merge is fragile** — 12 methods are real on main, 9 are real on HEAD, 3 (`prescribeWorkout`, `assessReadiness`, `briefRaceMorning`) overlap. Mis-merging risks shipping a Coach where some methods throw or return stale data. **Mitigation:** TypeScript will catch missing methods; runtime CoachDecision-shape mismatches won't. Write a small test that iterates every Coach method with a minimal fixture and asserts no throw.

2. **state.fitness depends on lib/vdot.ts shapes** — Wave 1's `coach-state.ts` imports `vdotFromRace`, `vdotRow`, `pacesFromVdot`. Confirm main's signatures match. If `vdotRow` returns a different field set on main than ours expects, the equivalent-race-times block breaks.

3. **doctrine/cite.ts + index.ts + pace_zones.ts must move together** — restoring `grading.ts` requires `ResearchDocId '24'` in cite.ts, requires the barrel export in index.ts, requires test fixtures. Atomic restore.

4. **DB schema collision risk** — `runner_profile` (main) vs `profile` (ours) are *different tables* covering overlapping data. Decide:  Wave 1 said "the new `profile` table is the canonical source"; main's `runner_profile` table predates that. **Either rename `profile` to `runner_profile_v2` to coexist, or migrate runner_profile data → profile and drop runner_profile.** Plan assumes coexistence — the profile API route can read both during transition.

5. **Hub vs no-hub architecture** — If we drop hub-provider but leave hub-related API routes, no harm done. But if we keep `useHub()` callers (e.g. main's `/runs/[id]`) and drop hub-provider, those pages 500. **Mitigation:** TSC catches `useHub()` imports.

6. **package-lock.json regeneration** — `react-day-picker` v10 requires React 19; we ship React 19.2.4, should be fine. Verify after `npm install`.

7. **CSS class orphans** — Main's recent dashboard refactors added classes like `dash-vdot-row`, `body-card`. Our new `globals.css` doesn't define them. If main's `web/app/page.tsx` survives as the dashboard (P0 #4 says it doesn't), they'd 404 silently. Removing the dashboard removes the orphans.

8. **No CI signal on the merge branch** — without an integration test that hits every page after merge, regression risk is high. **Mitigation:** the smoke-test step (15) is mandatory.
