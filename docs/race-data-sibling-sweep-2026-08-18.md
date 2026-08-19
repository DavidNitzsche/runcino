# Race-data sibling sweep — 2026-08-18

Follow-up to `f55798f2` (Activity Personal Records + Race Detail provisional
caveat). That commit fixed one confirmed instance of a named bug shape:

> A race-result-shaped number (finish time, finish pace, PR, race
> comparison, aggregate VDOT, race-anchored prediction) derived from
> unverified training data, presented as authoritative, with no provisional
> label.

This sweep applies CLAUDE.md's locked "Race-data source-of-truth" four-question
checklist to every consumer of race-related data across web (`faff-app` live
surface + parked `redesign` tree), `web-v2/lib/`, `web-v2/app/api/`, and the
`native-v2` iPhone app, hunting for siblings. Per CLAUDE.md's "per-finding
context filters" rule, each finding below was checked individually — a
surface-level "this reads races-state" pass doesn't clear every number on
that surface.

**Method:** four parallel read-only audit passes (one per tree), then manual
follow-up on every SUSPICIOUS/PLAUSIBLE finding — reading the actual source,
tracing the wire model, and in two cases finding the fix already existed
server-side but was never adopted client-side. Verified against `git show
f55798f2` for the reference bug shape and fix pattern throughout.

---

## Findings table

| # | Location | Shape | Live in prod? | Severity | Verdict |
|---|---|---|---|---|---|
| 1 | `native-v2/.../Views/ActivityView.swift` `computeRecords()` | "FASTEST PACE" tile picked the fastest-paced run from ANY run in the selected date range — zero gate on race vs. training, zero provenance label. Exact sibling of the original bug, just client-side-Swift instead of client-side-TS. | **Yes** — Activity STATS tab, every user | **High** | **CONFIRMED BUG — FIXED** |
| 2 | `native-v2/.../Views/RaceDayView.swift` (hero, `pbChip`, `countdownColor`, `countdownHeroStyle`, `countdownSub`, `retroCard` — 6 sites) | "PERSONAL BEST" badge/color/copy rendered whenever `race.pb == true`, never checking `race.finishProvisional` / `race.finishSource`, even though the model already decodes both. A date+distance-matched watch time (never a curated chip time) could headline as a confirmed PR. | **Yes** — Race Day / Goal detail screen, every user with a past race | **High** | **CONFIRMED BUG — FIXED** |
| 3 | `native-v2/.../Views/ProfileView.swift` `provenanceKindForVDOT()` | Captioned every non-null VDOT as `"from your recent race PR"` unconditionally, with no check of whether the VDOT's anchor was actually a race. Backend already sends `vdot_anchor_name` (populated only when a `races` row matches the anchor date); native already decodes it but never read it here. | **Yes** — Profile physiology tile, every user | **Medium** | **CONFIRMED BUG — FIXED** |
| 4 | `web-v2/lib/training/vdot-inputs.ts` `loadVdotInputs` (race candidate Strava-match fallback) | Rung-3 fallback (date+distance-matched training run) filled `finish_seconds` for a race candidate with no flag distinguishing it from a curated rung-1/2 result — `races-state.ts`'s identical fallback sets `finishProvisional: true`; this loader's copy of the same pattern didn't expose an equivalent. Feeds `bestRecentVdot` (aggregate VDOT), a checklist-named surface. | Yes (feeds every VDOT-consuming surface) | Low (transparency gap, not a display bug — see note) | **CONFIRMED GAP — FIXED (additive only)** |
| 5 | `web-v2/lib/coach/fact-reciter.ts` `reciteRaces()` PAST summary line | `most recent: {name} · {finishTime}` rendered `recent.finishTime` bare with no `finishProvisional` check, while the RACE DETAIL block ~100 lines down in the *same file* already gates the identical field correctly. | Yes — `/api/briefing`, `/api/coach/facts` | Low (compact summary line, not a headline card) | **CONFIRMED BUG — FIXED** |
| 6 | `web-v2/components/faff-app/views/TargetsView.tsx` anchor-line prose (`"Your {k} PR is {v}"`) | `anchorPr` is read straight from `seed.prs` (`adaptPRs`), which can be training-fallback-sourced (labeled `"· training"` only in the small grid caption below). The headline prose sentence — the single most-read line on the RECORDS section — carried no such qualifier and flatly asserted "PR." | **Yes** — Targets/Goal page, every user with a goal | **Medium** (headline claim, not a footnote) | **CONFIRMED BUG — FIXED** |
| 7 | `web-v2/components/faff-app/seed.ts` `recordsFromRuns` / `fastestConfirmedRace` | FASTEST 5K/10K — the original bug. | Yes | — | **Already fixed by `f55798f2`** (verified still correct, unchanged this round) |
| 8 | `web-v2/components/redesign/races/RaceDetailClient.tsx` "What it means" tile | Missing provisional caveat — the original bug's #2. | No (parked) | — | **Already fixed by `f55798f2`** (verified in place, correctly wired) |

---

## Full coverage map (checked, no action needed)

### `web-v2/components/faff-app/` (live surface — `seed.ts` read in full, ~2962 lines)

| Location | What it displays | Verdict |
|---|---|---|
| `seed.ts` `adaptPastRaces` | Past race result list, provenance chip | CLEAN — `finishProvisional`/`finishSource` fully resolved, pace sourced from matched run but never claimed authoritative |
| `seed.ts` `adaptUnloggedRaceAlert` | "log your result" nudge | CLEAN — no result claim |
| `seed.ts` `adaptGoalRace` / goal-projection enrichment | Projected/target finish time | CLEAN — always labeled a projection, never a PR; "Projection pending" when absent, never silently backfilled from training |
| `seed.ts` `season.blockComplete` | Post-block race result | CLEAN — `resultProvisional` piped through and rendered with `· provisional` suffix in `TrainView.tsx` |
| `seed.ts` `vdotAnchor` | Health page VDOT staleness banner | CLEAN — falls back to honest "an effort" when no race name resolves, never claims race provenance it doesn't have |
| `views/RaceView.tsx` (full, 1141 lines) | Hero result, PR chip, provisional-confirm flow | CLEAN — reference-good pattern, textbook-correct |
| `raceDetail.ts` (full, 486 lines) | `buildRaceDetail` | CLEAN — sources `finishProvisional`/`finishProvisionalLabel` from the resolved row; retro reads `actual_result` explicitly |
| `views/TargetsView.tsx` RECORDS grid caption (`p.date`, `.prm` line) | Training-fallback PR caption | CLEAN but visually quiet — see "Deliberately not fixed" below |
| `views/TargetsView.tsx` RACES → RESULTS (`ResultRow`) | Provenance chip | CLEAN |
| `views/GapPanel.tsx` (full, 811 lines) | VDOT pill + staleness, always paired with anchor provenance | CLEAN |
| `views/TrainView.tsx` (2089 lines, grepped) | `blockComplete.result`, "fastest N splits" | CLEAN — the latter is intra-workout rep pacing, not a race claim |
| `views/HealthView.tsx` (1202 lines) | `vdotAnchor` staleness line, Training Form provisional flag | CLEAN |
| `views/TodayView.tsx` (5621 lines, all race/VDOT/PR hits read in context) | `RecentRaceBeat`, `RaceDayHero`, `GoalReadyBody` | CLEAN — textbook-correct provenance chip + confirm-to-promote flow; every projection honestly labeled |
| `views/ProfileView.tsx` PhysiologyBlock | VDOT tile + provenance caption | CLEAN within this file — depends on backend `/api/profile/state` computation (same field CLAUDE.md's 2026-05-19 doctrine already covers) |
| `toolkit/*`, `overlays/*`, `cards/*`, `RouteMap.tsx`, `Shell.tsx`, `Sidebar.tsx`, etc. | — | CLEAN / not applicable — grepped for `vdot\|VDOT\|fastest\|PR\b\|Personal Record\|projected\|finishTime\|race\|canonicalLabel`, no unflagged hits |
| Global: `grep -rn "canonicalLabel"` across the directory | — | **Zero matches.** Rule 4 never violated in `faff-app/` |

### `web-v2/components/redesign/` (parked — confirmed not live-routed after `2e05d1a1`)

| Location | Verdict |
|---|---|
| `races/RaceDetailClient.tsx` (full, 632 lines, every tile) | CLEAN — "The race story" band has no caveat, but verified against the live precedent `components/races/RaceRetrospective.tsx`, which also doesn't caption that specific band (only WHAT IT MEANS / RACE LOG do) — faithful parity, not a new gap |
| `activity/ActivityClient.tsx` Personal records tile | CLEAN — pure passthrough of `seed.ts`'s `recordsFromRuns` (already fixed), no independent computation |
| `season/SeasonClient.tsx`, `race-week/RaceWeekClient.tsx`, `today/TodayClient.tsx` | CLEAN — all forward-looking projections, explicitly labeled, never presented as settled results |
| `runs/RunDetailClient.tsx` | CLEAN — file header explicitly documents that `races.actual_result` chip-time wiring was deliberately NOT ported (deferred, not silently half-wired) |
| `block/BlockClient.tsx`, `WeekDetailClient.tsx`, `onboarding/*`, `settings/SettingsClient.tsx`, `log/LogSheetClient.tsx`, `run-action/RunActionClient.tsx`, `gear/GearClient.tsx` | CLEAN / not applicable — no race-result display |
| `core/`, `graphics/`, `feedback/`, `nav/`, `coach/` primitives | CLEAN / not applicable — prop-driven presentational only, no data logic |

### `web-v2/lib/`

| Area | Verdict |
|---|---|
| `lib/training/vdot.ts` `bestRecentVdot`, `vdotFromRun`/`passesRunHonestyGate` | CLEAN |
| `lib/training/vdot-inputs.ts` `loadVdotInputs` | Gap found and fixed (finding #4) |
| `lib/race/effort-authority.ts` `selectionAuthority` | Deliberate design — does not discount `actual_result.provisional` at selection, documented in-file. Left unchanged (see "Flagged, not fixed" below) |
| `lib/training/fitness-trajectory.ts`, `lib/training/goal-projection.ts` (full, 1948 lines) | CLEAN — pure functions over caller-supplied VDOT; race-reading detector (`detectRecentRaceDrift`) reads `actual_result.finishS`/`meta.finishTime` only, no Strava fallback |
| `lib/plan/adapt.ts` `detectPrBank` | CLEAN — reads `actual_result.finishS` but runs `assessRaceRepresentativeness`, which zeroes authority when `resultProvisional` is true |
| `lib/training/race-history.ts` | CLEAN / not applicable — self-reported onboarding PRs, not Strava-derived |
| `lib/race/personal-records.ts` `composePersonalRecords`/`loadPersonalRecords` | **CLEAN — the reference-good implementation.** Rung 1 `actual_result.finishS`, rung 2 `meta.finishTime`, rung 3 training-run fallback explicitly `provisional:true` + labeled. Never reads `canonicalLabel`. This is what native `/api/records` calls (finding #1's fix) |
| `lib/coach/races-state.ts` `loadRacesState` | CLEAN — canonical ladder, the doctrine's reference implementation |
| `lib/coach/run-win.ts`, `lib/coach/run-recap.ts` | CLEAN / not applicable — intra-run split "fastest", not cross-run PR |
| `lib/race/retrospective.ts` `buildRaceRetro` | CLEAN — explicit 4-point checklist in header, verified against code |
| `lib/race/pacing.ts`, `race/execution-plan.ts`, `race/b-goal.ts`, `race/effective-race-target.ts`, `race/race-detail-pacing.ts` | CLEAN / not applicable — pure pace calculators over caller-supplied values, no DB reads of race results |
| `lib/coach/block-comparison.ts`, `lib/plan/goal-gap.ts`, `lib/coach/limiter.ts` | CLEAN — explicit checklist comments in each, ladder correctly implemented |
| `lib/race/representativeness.ts` / `representativeness-inputs.ts` | CLEAN, notably rigorous — explicitly reads `provisional` and zeroes upward-anchor authority for unconfirmed results |
| `lib/race/auto-result.ts` | CLEAN — writes `actual_result.provisional:true` explicitly, never writes `meta.finishTime` (which would launder it as curated) |
| `lib/coach/race-replacement.ts` | CLEAN by design — explicitly avoids reading any race result at all |
| `lib/coach/fact-reciter.ts` `reciteRaceDetail` (RACE DETAIL block) | CLEAN — correctly gates `finishProvisional`, this is the pattern `reciteRaces` (finding #5) now mirrors |
| All 39 `FROM races` + 18 `actual_result` SQL sites not listed above (`glance-state.ts`, `log-state.ts`, `profile-state.ts`, `race-lookup.ts`, `voice-band.ts`, `training-state.ts`, `readiness-brief.ts`, `strength-recommender.ts`, `sleep-coaching.ts`, `plan/generate.ts`, `plan/simulator.ts`, `execution/load.ts`, `faff/race-week-course.ts`, `watch/build-workout.ts`) | CLEAN — race-calendar/logistics reads only (date, name, priority, distance), never a finish time |
| `strava_activities` table (13 references across `lib/`) | CLEAN — all on CLAUDE.md's explicit training-data-consumer allowlist (activity caching, log-state, HR reads, sync layer, TCX/push export) |
| Global: `canonicalLabel` in `lib/` | Zero live reads — only comments explicitly documenting that the code does NOT read it |

### `web-v2/app/api/`

| Route | Verdict |
|---|---|
| `api/records/route.ts` → `lib/race/personal-records.ts` | CLEAN — the reference-good endpoint. Built 2026-07-06 (phone+watch audit P1-7) specifically to fix finding #1, but the phone never adopted it until this round |
| `api/race/[slug]/route.ts`, `api/races/route.ts` | CLEAN — pass-through of `loadRacesState` |
| `api/race/result/route.ts` (POST) | CLEAN — writer, not a display consumer |
| `api/targets/projection/route.ts` | CLEAN — pass-through of `loadVdotInputs`/`loadProjectionSeries` |
| `api/race/[slug]/execution-plan/route.ts` | CLEAN — uses `projection_snapshots` (VDOT-gated) |
| `api/race/[slug]/autofill/route.ts`, `api/race/strava-course/route.ts` | Not applicable — logistics/course geometry, not results |
| `api/cron/snapshot-projections/route.ts` | CLEAN — uses gated `loadVdotInputs` |
| `api/goals/route.ts` | Not applicable — user-entered CRUD |
| `api/run/manual`, `api/watch/workouts/complete`, `api/ingest/workout` | CLEAN — correctly non-race consumers (within-run splits, HR) |
| `web-v2/app/api/admin/audit-races` | Does not exist in `web-v2` (CLAUDE.md's reference is to the legacy `web/` tree) |

### `native-v2/Faff/Faff/`

| File | Verdict |
|---|---|
| `Views/TodayView.swift` `postRaceResult` / `postRaceResultCard` | CLEAN — reference-good pattern: `(rd.finishProvisional == true) \|\| (rd.finishSource == "run_match")`, PROVISIONAL badge, one-tap confirm flow. This is the pattern findings #2 and #3's fixes now mirror |
| `Views/TargetsView.swift`, `Components/Toolkit/K_TargetsProjection.swift` | CLEAN — pass-through from `/api/targets/projection`, already server-gated |
| `Components/HowItWentPanel.swift`, `TodayPostRunBody.swift`, `RouteMapView.swift` | CLEAN / not applicable — within-run fastest/slowest splits, not race results |
| `Components/RaceEditSheet.swift` | Not applicable — writer |
| `Views/OnboardingView.swift` | Not applicable — user-supplied self-reported PRs |
| `Models/Races.swift` | CLEAN — `finishProvisional`/`finishSource`/`finishProvisionalLabel` correctly decoded; the model itself was never the problem, the consumers were (findings #2, #3) |

---

## Fixes applied

1. **`native-v2/Faff/Faff/Views/ActivityView.swift`** — removed the client-side "FASTEST PACE" derivation (`computeRecords()`), which picked the fastest-paced run from ANY run in the selected date range with zero race gate. Wired the "Personal records" grid to the already-existing, already-correct `/api/records` endpoint instead:
   - `native-v2/Faff/Faff/Models/Runs.swift` — added `PersonalRecordsResponse`/`PersonalRecordEntry`/`PersonalRecordTraining`/`PersonalRecordLongestRun`/`PersonalRecordBiggestWeek` wire models (lenient decode, per file doctrine).
   - `native-v2/Faff/Faff/API.swift` — added `API.fetchPersonalRecords()`.
   - `ActivityView.swift` — fetches records alongside log/profile/streak in `reload()`; `computeRecords()` now opens with the server-computed race-PR ladder (curated race result bare, training fallback captioned with the server's `provisionalLabel`), deliberately NOT range-scoped (a PR is an all-time fact, matching `seed.ts`'s identical section on web). LONGEST RUN / BIGGEST WEEK / MOST CLIMB / LAST THRESHOLD / RANGE TOTAL are untouched — legitimate range-scoped training facts, already correctly labeled as what they are.

2. **`native-v2/Faff/Faff/Views/RaceDayView.swift`** — added `isFinishProvisional` / `isPBConfirmed` computed properties (mirroring `TodayView.postRaceResult`'s identical check) and gated all 6 sites that previously drove a "PERSONAL BEST" claim off `race.pb == true` alone: hero badge + color, `pbChip`, `countdownColor`, `countdownHeroStyle`, `countdownSub`, `retroCard`. An unconfirmed watch-matched finish now reads "PROVISIONAL" / "FINISHED · PROVISIONAL" instead of silently keeping the gold PB treatment available the moment the server sets `pb: true`.

3. **`native-v2/Faff/Faff/Views/ProfileView.swift`** — `provenanceKindForVDOT()` now reads the already-decoded `physiology.vdot_anchor_name` (populated only when a `races` row matches the VDOT anchor date, per `profile-state.ts`) to decide between `.raceCalibrated("your {race name}")` and an honest `.estimated("your recent training")` fallback, instead of unconditionally claiming "recent race PR."

4. **`web-v2/lib/training/vdot-inputs.ts`** — added `provisional: boolean` to `RaceVdotInput`, computed from whether `finish_seconds` came from the rung-3 Strava date+distance match rather than rung 1/2 curated sources. **Additive only** — `bestRecentVdot`'s race-candidate parameter type is structural and doesn't read this field, so selection weighting is unchanged. `lib/race/effort-authority.ts`'s documented decision not to discount provisional races at selection time was left untouched (see "Flagged, not fixed" below).

5. **`web-v2/lib/coach/fact-reciter.ts`** — `reciteRaces()`'s PAST summary line now appends `(provisional)` when the most recent race's `finishTime` is provisional, mirroring the correctly-gated RACE DETAIL block in the same file.

6. **`web-v2/components/faff-app/types.ts` + `seed.ts` + `views/TargetsView.tsx`** — threaded `source: 'race' | 'training'` through the `PR` type and `adaptPRs()` (the underlying `byDist` map already tracked this internally; it just wasn't surfaced). `TargetsView.tsx`'s RECORDS section headline sentence ("Your {distance} PR is {time}") now reads "Your fastest {distance} training effort is {time} — no confirmed race yet" when `anchorPr.source === 'training'`, instead of asserting an unqualified PR in the single most-read sentence on the page.

---

## Flagged, not fixed — for David

- **`lib/race/effort-authority.ts`'s `selectionAuthority`** deliberately does not discount `actual_result.provisional` when grading a race's authority for VDOT *selection* (the file's own header explains: selection needs a usable anchor and the alternative default is worse). This is a real, documented, intentional trade-off, not an oversight — but it means an unconfirmed watch-matched race result can currently win the anchor slot at the same weight as a curated one. Finding #4's fix makes the provenance visible (`RaceVdotInput.provisional`) without changing this weighting. Whether to also start discounting provisional races at selection time is a threshold call with a real trade-off (worse anchor vs. risk of an unconfirmed number setting every training pace) — exactly CLAUDE.md's "decisions" bucket, not something to silently change.

## Deliberately not touched — cosmetic, in scope boundary

- **`seed.ts` `adaptPRs` training fallback caption** (`TargetsView.tsx`'s `.prm` grid-tile line) is correctly labeled `"· training"` — doctrine's checklist #3 is satisfied (a label exists) — but renders in a small, low-contrast caption versus the bold value above it, unlike the colored provenance chip `ResultRow`/`RaceView` use elsewhere. This is a visual-prominence question, not a correctness gap, and this pass is scoped to correctness only (an outside studio owns the redesign's visual design). Noted for whoever does the next design pass.

---

## Verification

- `cd web-v2 && npx tsc --noEmit` — **clean, zero errors** (ran after `npm install`; `node_modules` was absent in this worktree, installed fresh — 369 packages, no network issues).
- `npx vitest run lib/` — **3209 passed / 3220 total, 1 failed, 10 skipped** — exact match to the documented baseline (the one failure is `lib/plan/_wave1_smoke_dryrun.test.ts`, "The server does not support SSL connections," the known unrelated prod-DB-connectivity issue, not caused by this change).
- `xcodebuild -project Faff.xcodeproj -scheme Faff -destination 'generic/platform=iOS Simulator' build` — **BUILD SUCCEEDED**, zero errors, covering every native Swift file touched (`ActivityView.swift`, `RaceDayView.swift`, `ProfileView.swift`, `API.swift`, `Models/Runs.swift`).
- Doctrine gate (`lib/doctrine/_doctrine_gate.test.ts` / `_doctrine_lint.test.ts`) is included in the `lib/` vitest run above and passed — no new doctrine registry claims were added or needed (these are correctness fixes against already-cited rules, matching `f55798f2`'s precedent).
- Did not re-run the live-DB verification `f55798f2` did (confirming David has no confirmed 5K/10K on file) — this worktree is read-only-DB-role by default per CLAUDE.md, and the fixes here are code-shape fixes (gating, labeling, endpoint adoption) verifiable by tracing the data flow, not fixes that depend on a specific runner's current race history.
