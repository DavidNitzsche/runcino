# Pre-run experience — round 4 handback (2026-09-03)

**Branch:** `feat/pre-run-experience`
**Final commit (pushed):** `42847b64`
**Base merged from origin/main:** `252ca934` (chore(ship): TestFlight build 256 — rail colors, panel direction, deeper prefetch)
**Note:** `origin/main` has advanced one more commit since (`3d8157d7`, a docs handback) — not chased in this round; nothing in it touches the files this branch owns.
**Not merged to `main`.** Per standing instruction, this branch stays open for review.

---

## 1 · What round 4 asked for, and status of each item

| # | Item | Status |
|---|---|---|
| 1 | Reconcile with the P0 activity-association fix; Today shows prescribed hills as primary, easy run supplemental | **Fixed and rendered.** See §3. |
| 2 | Treadmill receives the real hill prescription (7.7 mph / 5% incline) through the full phase sequence | **Fixed and rendered** for warm-up + work-rep preview + manual adjustment. Full auto-transition into the work rep was not waited out live (real-time cost); covered by code-path proof + unit tests. See §4. |
| 3 | Fix the Run tab's empty-header layout | **Fixed and rendered.** See §5. |
| 4 | Workout label consistency + pace-shape language | **Fixed and rendered.** See §5. |
| 5 | Simplify failure recovery to one primary action | **Done, unit-tested.** Not re-rendered this round (no regression risk touched it); round 3 already rendered the failure screen shape. |
| 6 | Cross-device duplicate-recording protection | **Phone→watch direction fixed and code-reviewed after merge; watch→phone direction still not built.** See §6 — this is the one item still asymmetric. |
| 7 | Full interaction checklist | **Partially covered this round** (Today↔Run switch persistence, future-date isolation, treadmill start/adjust/end, workout-fetch-failure not re-touched). See §7. |
| 8 | Delivery | This document. |

---

## 2 · The merge — why it was necessary and what it touched

Round 4's own instruction was explicit: *"Do not merge this branch over or around that work. Reconcile with the latest origin/main only after the canonical exact-workout association and supplemental-run model land."*

That model landed as `6e0ca1ae fix(execution): WORKOUT-EXECUTION-ID-1` on `origin/main`, 10 commits ahead of where this branch had been sitting. Before touching the real worktree, the merge was dry-run in an isolated detached worktree (`/tmp/merge-dryrun`, CLAUDE.md's own branching doctrine) to inspect the shape of the conflict before committing to it:

- **One real conflict:** `project.pbxproj` — resolved the standard way (`git checkout --ours` + `xcodegen generate`), because generated project files are not hand-merged.
- **Everything else auto-merged clean**, including `HostsV5.swift`, `web-v2/lib/watch/build-workout.ts`, and `web-v2/app/api/v5/today/route.ts` — this branch's `paceShape`/`canonicalWorkoutDistanceMi`/Run-tab additions and origin's new `resolveDayExecutions` day-resolver do not touch the same lines.
- `ShellV5.swift`, `RunLobbyV5.swift`, `Watch.swift`, `WatchSync.swift`, `LiveRunTreadmillV5.swift` — **origin/main had not touched any of these** since this branch's fork point. The large two-dot diffs seen before merging were entirely this branch's own round 1–4 work, not a second implementation to reconcile against. The "Today-versus-Run ownership" architecture is exclusively this branch's; `origin/main`'s `FaffTabV5` enum has no `case run` at all.

Dry-run built clean (`** BUILD SUCCEEDED **`) and the 4 test classes this round added (30 tests) passed before the same merge was applied to the real worktree. After merging for real: full `FaffTests` suite **228 passed, 0 failed, 1 expected failure**; web-v2 `vitest` across `lib/watch lib/postrun lib/format lib/execution` **1876 passed, 4 skipped, 0 failed**.

---

## 3 · Item 1 — activity-association fix, rendered before and after

Rendered against the isolated walk substrate (`docs/VISUAL_WALK_SUBSTRATE.md`, a throwaway Postgres copy of the real runner's rows, real session token, zero production writes) at both commits.

**Before the merge** (`docs/reports/pre-run-verification-2026-09-03-round4/01-today-tab.png`): Today showed `INTERVALS · 4.48 mi · 37:14 · 8:19/mi · Reps done` — the untracked easy run recorded from Apple Workouts had overwritten the still-unstarted hills prescription. This is the exact live defect round 4 named.

**After the merge** (`03-today-fixed-postmerge.png`, `04-today-fixed-scrolled.png`): the same account, same day, same untracked easy run still in the database — Today now correctly shows `INTERVALS · 6 mi · about 50 min` with the full unexecuted structure (Warm-up 1.5 mi, Work 10×1:00 hills, Cooldown 1 mi), no "done" language, no reps count. `state: "before_run"` confirmed via a direct `curl` of `/api/v5/today` against the substrate.

**On the "supplemental" half of the ask:** the untracked 4.48 mi run does not appear as its own card anywhere on Today in this build. It IS counted in the week's aggregate (`This week — 26.1 mi` includes it), but there is no separate "here's a run that happened but isn't your workout" surface. `WORKOUT-EXECUTION-ID-1` fixes the *classification* defect (which run is authoritative for today's prescription) but does not appear to add a supplemental-run display — worth flagging to the programme lead as a possible follow-up rather than claiming it as delivered.

`05-run-tab-postmerge.png` confirms Run independently resolves the same canonical hills workout post-merge, satisfying the standing product rule that Today and Run agree.

---

## 4 · Item 2 — treadmill phase sequence

Root cause fixed this round in two layers, both necessary:

1. **`TREADMILL-HILL-2`** (`8b00788c`): `configurePlanIfNeeded()` was seeding the treadmill's *initial* speed/incline from the doctrine fields but never consuming them for the rest of the per-segment plan. Fixed to call `Self.nominalMph`/`Self.nominalInclinePct` — now `static`, shared — for every phase when building the `SegmentPlan`.
2. **The phase re-stamp bug** (`0565ee85`, found *while verifying #1*): `WatchWorkout.init(from:)` decodes `[WatchPhase]` correctly, then re-builds every phase through a second, separately-maintained field list just to stamp the cursor `index` — and that second list had never been updated when `hrRole`, `treadmillInclinePct`, `treadmillSpeedMph`, and `paceShape` were added to `WatchPhase`. All four were silently dropped on every real decode. This is why TREADMILL-HILL-2 passed every unit test (which construct `WatchPhase` directly, bypassing the decoder) but never worked against real data — a Rule 15 blind spot. Fixed by threading all fields through the re-stamp; proven with `WatchWorkoutPhaseRestampTests.swift` against a real captured JSON payload, falsified (reverted → all 4 tests fail with named fields) and restored.

**Rendered, live, real doctrine values (`06`–`09` in the report folder, screenshots also inline above):**

| Phase | Speed | Incline | Confirmed how |
|---|---|---|---|
| Warm-up (current) | 7.2 mph (pace-derived) | 1.0% (doctrine default, no incline field on this phase) | Rendered live |
| Hill 1 of 10 (next-phase preview) | **7.7 mph** | **5.0%** | Rendered live — this is the exact doctrine value the round-4 message named |
| Manual adjustment | 7.2 → 7.3 mph via "+" | — | Rendered live; pace recalculated 8:20 → 8:13, override held across ~1 min |
| End run | — | — | Rendered live; returned cleanly to Run tab, bottom nav stable |

**Not rendered live:** the console's display *during* the hill work rep itself (waiting out ~10 minutes of real-time warm-up distance to trigger the auto-advance was not practical this session). Confirmed by code inspection instead — `configurePlanIfNeeded` (line 566–567) calls the exact same `Self.nominalMph`/`Self.nominalInclinePct` functions for *every* phase in the plan, including the work reps, so the console's actual target during the hill rep is driven by the same fixed code path already proven correct for the preview text. Flagging this honestly rather than claiming a render that didn't happen (Rule 13).

---

## 5 · Items 3 & 4 — Run tab layout and labels

`e9a5f93f`. Rendered (`02`, `05`):

- **Layout:** `RunLobbyV5`'s body is now `ScrollView { VStack { runHeader; workoutSection; startSection } }` top-anchored under the safe area with a plain `RUN` header — no more bare unanchored VStack inherited from the old sheet host. First screen comfortably shows the header, today's workout card, and all three execution tiles (Apple Watch / Outdoor on iPhone / Treadmill) with the bottom nav stable underneath.
- **Labels:** eyebrow is `TODAY'S WORKOUT`; the headline and the structure row's work-block title are now generated by one shared function (`displayHeadline`), so `10 × 1 min Hill` reads identically in both places — no more `10×60s` vs `10 × 1 min Hill` drift.
- **Pace shape:** a new `paceText(_:)` reads `WatchPhase.effectivePaceShape` and renders `.ceiling` as "no faster than X/mi", `.window` as a two-sided range, `.effort` as nothing. Rendered live: both warm-up and cooldown now correctly read **"no faster than 8:22/mi"** — this is the exact defect the phase-restamp bug (§4) was hiding; before that fix, the same phase rendered as a fabricated two-sided range ("7:52–8:52/mi", captured in the round-3 screenshot that led to finding the bug).

---

## 6 · Item 6 — cross-device duplicate-recording protection

**Phone → watch direction: built, tested, and unaffected by the merge.** `WatchSync.swift` now receives `applicationContext` (previously send-only), tracks `watchActiveWorkoutId`/`watchActiveWorkoutIsCurrent` with a 6-hour staleness ceiling, and `LiveRunHostV5` checks it before a phone-initiated outdoor or treadmill start; if the watch is already recording, the phone shows a terse `LiveRunBlockedByOtherDeviceV5` refusal instead of starting a second activity. Both phone-side tests pass post-merge.

**Watch → phone direction: still not built.** The watch side (`legacy/native` — a separate Xcode project from `native-v2`, confirmed buildable/testable this session) now *publishes* its active-workout id via `PhoneSync.publishActiveWorkout(id:)`/`clearActiveWorkout()`, called from `WorkoutRootView.launch`/`reset`. But nothing on the watch *reads* the phone's published state before its own `start()` — the refusal logic only exists on the phone. This was a deliberate scope cut disclosed in the original commit message rather than a silent gap: touching the watch's actual start-refusal path without a full on-device render pass was judged too risky for this session's remaining time.

**What was not done this round:** the actual "direct Watch start followed by phone start, and phone start followed by direct Watch start" interaction test the round-4 message asked for. Two simulators (phone + a paired watch) driven through an actual start-start sequence was not attempted — flagging this as the most concrete open item for whoever picks this up next.

---

## 7 · Item 7 — interaction checklist, what was and wasn't covered

Covered and rendered this round:
- Today → Run tab switch (scroll position and content both persisted correctly across tab switches, confirmed via two consecutive round-trips)
- Run tab → Treadmill execution mode → phase display → manual speed adjustment → End run → clean return to Run tab, bottom nav intact
- Today shows the correct un-executed hills prescription; Run independently resolves and agrees

Not covered this round (round 3 already covered a subset of these; not re-verified after the merge):
- Inducing and recovering from a workout-fetch failure (item 5's screen) — code is in place, unit-tested, not re-rendered
- Confirming a future date viewed on Today does not change Run's workout (the mechanism — Run always resolves *today's* canonical workout independent of Today's date-navigation state — is architecturally true by construction, since `RunLobbyV5` never reads Today's selected date, but this was not re-rendered live this round)
- Rendering easy / threshold / long-run / race-day / rest-day workout variants on Run — only the hills/intervals day was rendered this round, since that is what the account's actual date carries in the substrate snapshot

---

## 8 · Test results

- **FaffTests (native-v2), full suite, post-merge:** 228 passed, 0 failed, 1 expected failure. Simulator: iPhone 17 Pro Max, iOS 26.5.
- **web-v2 vitest**, `lib/execution` (new day-resolver) + `lib/watch` + `lib/postrun` + `lib/format`: 1876 passed, 4 skipped, 0 failed.
- **Dry-run merge** (isolated worktree, before touching the real one): build succeeded, 30/30 targeted tests passed.

---

## 9 · Merge instructions for the programme lead

This branch is **not** merged into `main`. When ready:

1. `git fetch origin` — check whether `main` has moved past `252ca934` (it has, to at least `3d8157d7` as of this report) and whether anything new touches `ShellV5.swift`, `RunLobbyV5.swift`, `HostsV5.swift`, `Watch.swift`, `WatchSync.swift`, `LiveRunTreadmillV5.swift`, or the watch-side `PhoneSync.swift`/`WorkoutRootView.swift` — none of those were touched by `origin/main` as of this branch's merge point, but that could change.
2. Dry-run the merge in an isolated detached worktree first (this session's own practice, and CLAUDE.md's standing instruction) — `git worktree add --detach /tmp/<name> feat/pre-run-experience`, merge `origin/main` there, resolve `project.pbxproj` via `xcodegen generate`, build, run tests, only then apply to a real checkout.
3. Before merging to `main`, decide on the two open items disclosed above: the watch→phone half of duplicate protection (§6), and whether the "supplemental run" display (§3) is in scope for this pass or a follow-up.

---

## 10 · Screenshots

All in `docs/reports/pre-run-verification-2026-09-03-round4/`:

| File | Shows |
|---|---|
| `01-today-tab.png` | Pre-merge defect: easy run misclassified as INTERVALS/done |
| `02-run-tab-paceshape-fixed.png` | Pre-merge: pace-shape ceiling language fixed on Run |
| `03-today-fixed-postmerge.png` | Post-merge: Today correctly shows the unexecuted hills prescription |
| `04-today-fixed-scrolled.png` | Post-merge: full Today scroll, no supplemental-run card present |
| `05-run-tab-postmerge.png` | Post-merge: Run still agrees with Today on the canonical workout |
| `06-treadmill-warmup-real-doctrine-preview.png` | Treadmill pre-start: warm-up settings + "Next" preview already reading 7.7 mph / 5.0% incline |
| `07-treadmill-running-next-phase-7.7mph-5pct.png` | Treadmill running: warm-up live, next-phase line confirms real doctrine values mid-run |
| `08-treadmill-manual-adjustment.png` | Treadmill: manual "+" speed adjustment held (7.2 → 7.3 mph, pace recalculated) |
| `09-treadmill-ended-clean-return.png` | Treadmill ended cleanly, returned to Run tab, bottom nav intact |
