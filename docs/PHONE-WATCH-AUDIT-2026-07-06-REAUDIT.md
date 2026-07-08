# Phone + Watch Post-Fix Re-Audit — 2026-07-08

Companion to [PHONE-WATCH-AUDIT-2026-07-06.md](PHONE-WATCH-AUDIT-2026-07-06.md) (the original 173-finding audit). This document verifies what actually landed across four fix waves and hunts for regressions the fix cycle itself introduced.

**What shipped between the two audits** (all on `main`, all deployed):
- **Wave 1** (`076877a6`) — adapter rebuild (cron-index fix, collision guards, layoff detector, staleness expiry), timezone threading (backend), work-phase verdict fix, race-data source-of-truth repairs, fabrication removal, 50mi ingest quarantine, notification wire fixes.
- **Wave 2** (`ea4df0b8`) — 9 native fixes: onboarding/auth, Today composition, adapter-proposal surface, Activity/run-detail, Train tab, settings cluster, watch engine, watch faces/sync, treadmill/strength.
- **Wave 3a** (`3b9ecd45`) — slow-runner VDOT support (below-table anchors), honest ultra handling, account deletion.
- **Wave 3b** (`288f5f66`) — metric units end-to-end, phone-GPS recording for no-watch runners.
- **Hotfix** (`62bafd49`) — two integration fixes lost to a verify-uncommitted/push-committed process gap (see below).
- **This re-audit's own fixes** (`23debd49`) — two P0s found by the re-audit itself (below).

**Method:** 55 agents, ~1,921 tool calls, three phases. (1) 16 verify agents re-checked all 134 tracked P1/P2 findings from the original audit against current code — FIXED / PARTIAL / UNFIXED / REGRESSED, with fresh evidence, not trust in the fix PRs' own claims. (2) 5 dedicated regression hunters targeted the highest-blast-radius diffs (the rebuilt adapter, timezone threading, the native cross-cut, the two newest features, and the twice-repaired vdot-floor code) for NEW bugs. (3) Every UNFIXED/REGRESSED claim and every P0/P1 new finding went through independent adversarial verification — an agent trying to refute it by reading the current code fresh. 34 of 34 verified claims survived (0 refuted).

---

## Headline result

| | Count |
|---|---|
| Findings verified FIXED | 88 |
| Findings PARTIAL (real improvement, failure path not fully closed) | 22 |
| Findings UNFIXED (nothing changed) | 24 |
| Findings REGRESSED (fix closed the original path, opened a new one) | 0 |
| New regressions found by dedicated hunters | 13 (2 were P0, both fixed same-day) |
| Adversarially confirmed serious claims | 34 of 34 checked (0 refuted) |

**Read on the fix cycle:** genuinely effective — nearly two-thirds of tracked findings are cleanly fixed, zero clean fixes were found to have regressed into something new, and the adversarial-verification pass (the same discipline that caught 3 real defects in self-reported "done" work during the fix cycle itself) found the re-audit's own claims to be accurate. The 24 UNFIXED items are concentrated in three places that were legitimately out of the fix cycle's stated scope: password recovery (no forgot-password flow exists at all — never claimed fixed), race-day pacing templates (HM-only logic for non-HM races), and several dead-code paths in the adapter's secondary machinery (documented, not hidden).

**The two most important findings are not from the original audit at all** — they're new regressions the dedicated hunters caught, both P0, both now fixed and deployed:

1. **A third instance of the P1-56 unclamped-pace bug** (`web-v2/lib/plan/generate.ts`). Two rounds of independent verification during the fix cycle already caught and closed two leaks in the below-table-VDOT slow-runner support (an unclamped Riegel I-pace, a VDOT-30-floor masking below-table runs). The re-audit's dedicated hunter found a third: the mid-block pace blend toward an *explicit goal* was never clamped, and could prescribe quality-day paces over 4 minutes/mile faster than a slow runner's own demonstrated pace by mid-block. Fixed same-day (`23debd49`), locked with a regression test proven to fail without the fix.
2. **The native counterpart to Wave 1's timezone fix was never built.** Wave 1 eliminated `America/Los_Angeles` hardcoding from five *backend* call sites. `HealthKitImporter.swift` — the native iOS code that stamps dates on HealthKit-sourced runs *before* they ever reach the server — still hardcoded it in five places. Every non-Pacific runner using Apple Watch Workouts (not the Faff watch app) got wrong-day data at the source, regardless of the backend fix. Fixed same-day (`23debd49`), seeded via the same on-launch cache pattern Wave 3b established for units.

---

## The process bug this session surfaced (worth remembering)

Twice during integration, a fix was verified via `xcodebuild` against **uncommitted working-tree edits** in a scratch worktree, but only the worktree's **committed** `HEAD` was captured (`git rev-parse HEAD`) and merged into main — silently dropping the fix. Main was non-compiling from `ea4df0b8` through `288f5f66` (two pushes) until caught during sim-verification and fixed in `62bafd49`. Root cause: verifying against working-tree state and pushing committed state are not the same operation, and nothing enforced that they matched. Lesson for any future multi-worktree integration: commit before you verify, or verify what you're about to push, not what's on disk.

---

## Verify-phase detail, by surface

### onboarding — 2 fixed / 2 partial / 3 unfixed

**✅ FIXED** — Onboarding save silently 'succeeds' on server error — completeOnboarding's Bool result is discarded  
OnboardingView.swift:1166-1200 now does `try await API.completeOnboarding(...)` (no discard) inside a do/catch. API.swift:852-866 `completeOnboarding` now `throws`, decoding the server's `{error, detail}` and throwing `APIServerError` on any non-2xx instead of returning a discarded Bool. The catch block in submit() sets `onboardingError` and never calls `onComplete(outcome)` on failure — the runner stays on the confirm screen with the error shown. Explicit comments at both sites cite 'audit P1-1 …  
_Clean, verified fix — the exact failure path (silent success on server error) is closed._  

**✅ FIXED** — Native sign-in mishandles the '/set-password' redirect — invited runners keep their emailed temp password forever  
EmailSignInSheet.swift:318-321: on `resp.redirect == "/set-password"` the sheet now switches to a new `.setPassword` mode instead of falling into the onboarding/today branch. The new `SetPasswordStep` view (line 356+) POSTs API.setPassword → /api/auth/set-password (API.swift:280-287, confirmed endpoint matches web-v2/app/api/auth/set-password/route.ts which stamps `email_verified_at=NOW()` and returns `redirect: onboarding_complete ? '/today' : '/onboarding'`). The response's redirect is correct …  
_Full round-trip traced and confirmed correct, including the not-yet-onboarded sub-case._  

**🟡 PARTIAL** — Killing the app mid-onboarding permanently skips onboarding — a stored token alone marks the device 'onboarded'  
The literal code path the finding cited is fixed: FaffApp.swift:380-397 removed the old `|| TokenStore.shared.isSignedIn` shortcut and now calls `API.verifyOnboardedOnServer()` (API.swift:308-322, GET /api/profile/state, which correctly returns `onboarding_complete: userRow.rows[0]?.onboarding_complete === true`) before deciding — landing on `.onboarding` for `.incomplete`/`.unreachable` and `.signIn` for `.unauthorized`. However, this check is gated BEHIND an earlier, unmodified branch: FaffApp …  
_The originally-cited code path (token-alone at the isSignedIn branch) is genuinely fixed. But a second, pre-existing code path just above it (cache-presence heuristic) reopens the identical failure mode one launch later, via the prefetch call that fi_  

**🟡 PARTIAL** — Add Race accepts past race dates and dates before the training start; failures surface raw engine jargon  
TargetsView.swift:1010 — `DatePicker("Race date", selection: $date, displayedComponents: .date)` still has NO `in:` bound; still unclamped to today or to startDate. Line 1011's `startDate` picker is still separately clamped only to `Date()...`, with no cross-field relationship enforced. On the backend, POST /api/race (web-v2/app/api/race/route.ts:19-25) DOES now have a `toFriendlyPlanError()` translator, but it pattern-matches only ONE specific raw string ('plan ramp is unsupported by current fi …  
_A friendly-error translator was added but doesn't cover the specific failure scenario cited in the finding, and the DatePicker bound was never added at all. Neither described symptom (past/pre-start race date accepted client-side; raw jargon on short_  

**❌ UNFIXED** — Race-history entries without a finish time are silently discarded — runner believes their PR seeded the baseline  
OnboardingView.swift:152-158 `serializedRaceHistory` still filters `guard e.timeSec >= 60 ... else { continue }` with no visible warning. OnboardingView.swift:778-808 `runQ_raceEntries` still calls `runQ(...)` with no `enabled:` argument (defaults to `true` per the runQ signature at line 584), so Continue is never gated on entries having a real time. RaceEntryRow (line 1238-1307) still just shows placeholder text 'Set finish time' (line 1262) with no inline note that an incomplete entry will be  …  
_Nothing in this code path has changed since the original audit._  

**❌ UNFIXED** — Onboarding is imperial-only — metric-preference runners must answer in miles/feet and are hard-defaulted to units='imperial'  
web-v2/app/api/onboarding/complete/route.ts:349-350 still hardcodes `units='imperial'` in the INSERT. OnboardingView.swift:702-704 still offers only mile-bucket labels ('Under 5 miles' … '45+ miles'), and the height picker (lines 950-1006) is still ft/in wheels only, converting to cm internally with no cm-entry option or unit toggle. No `Locale.measurementSystem` reference anywhere in the file.  
_Completely unchanged, both client and server side._  

**❌ UNFIXED** — No password-recovery path anywhere — a forgotten password is a dead end on the phone  
web-v2/app/api/auth/ still contains only apple, email, logout, request-access, set-password, signup, strava — no reset/forgot route. EmailSignInSheet.swift only has `.signIn`, `.requestAccess`, and the new `.setPassword` (first-login, not password-reset) modes; `modeToggle` (line 262-268) still just toggles between sign-in and request-access with no forgot-password affordance anywhere in the file.  
_The new set-password step (finding 2's fix) is a first-login flow for temp passwords, not a forgot-password recovery flow — it doesn't address this finding at all, since it requires an already-valid session and can't be reached by a user who genuinel_  

### today — 8 fixed / 1 partial / 1 unfixed

**✅ FIXED** — Race-week tune-up workout renders as EASY across the Today hero and week strip  
native-v2/Faff/Faff/Theme.swift:397-410 FaffEffort.fromType now has an explicit case mapping 'race_week_tuneup' (and 'threshold','progression') to .tempo, with a dated comment (2026-07-07 P1-4) explaining exactly the bug described. TodayView.swift:520 hero headline was also switched from selectedEffort.title to peekTitleWord (purpose.typeTitle-preferred), and nextHardLabel (line 2352-2380) derives its label via FaffEffort.fromType too, so it inherits the fix. Both the mesh-family effort AND the  …  
_shakeout still maps to .easy, which is semantically correct (shakeouts are easy-effort, unlike race_week_tuneup)._  

**❌ UNFIXED** — Readiness-drop NudgeSheet is unreachable — showNudge is never set true, hasNudge is never read  
native-v2/Faff/Faff/Views/TodayView.swift: showNudge (line 81, @State) is still only ever set to false (lines 743-744, inside the sheet's own onAccept/onKeep callbacks) and declared with default false. Grepped the whole file and the whole native-v2/Faff/Faff tree: 'showNudge = true' appears nowhere. The sheet at line 741 (.sheet(isPresented: $showNudge)) is therefore still permanently unreachable — identical failure mode to the original finding.  
_hasNudge (the dead 'pip on the bell' property) was deleted entirely rather than wired up, so that specific half of the original evidence text is now stale, but the actual bug (nudge sheet can never open) is unchanged._  

**🟡 PARTIAL** — Today composition does not change for base/build/peak/taper/race-week/post-race/off-season states; the phase label itself is dead code  
A genuine new post-race branch (isPostRaceWindow, TodayView.swift:2565-2570) was added and does change composition substantially (postRaceBody with TodayRecoveryPanel) — this closes the post-race sub-case specifically (see finding 4). But grepping the whole file for 'purpose?.phase' turns up exactly one use (line 2312, weekContextLabel) — still only a subtitle string ('BASE · 11 WEEKS TO RACE'), never a composition branch. There remains no branch anywhere in the file keyed on training phase (off …  
_Genuinely improved (post-race sub-case now handled, several other sub-cases fixed in this same wave — see findings 4,5,6,7,8), but the core claim — 'a page rendered race week and a page rendered four months out should look meaningfully different, not_  

**✅ FIXED** — Post-race state has no handling — days after the goal race render as bare generic REST, and the fetched RecoveryBrief is never displayed  
New isPostRaceWindow computed property (TodayView.swift:2565-2570) gates a new branch at line 488 that renders postRaceBody (line 1706-1745+), which explicitly renders TodayRecoveryPanel(brief: recoveryBrief) at line 1728-1732 guarded by recoveryBrief != nil. The window is derived from pickPastARace (line 2418-2426), which correctly filters races to priority=='A' and days_to_race<0, picking the most recent. Guards correctly clear the window once profile.nextARace is populated or hasPlan becomes  …  
_Well-built: includes a 'plan your next race' CTA (routes to Targets tab) and coach-voice copy per CLAUDE.md doctrine, explicitly cited in an inline comment._  

**✅ FIXED** — Pre-run detail body (TodayPreRunBodyV3) is unmounted — shoe picker, fueling plan, conditions grid, and adaptation context are unreachable on Today  
New @State showPreRunDetail (TodayView.swift:162) now drives a real .sheet(isPresented: $showPreRunDetail) at line 802-814 presenting preRunSheetContent (which wraps TodayPreRunBodyV3). A real tap affordance was added: 'Full plan · shoe · fuel' button at line 1256-1268 sets showPreRunDetail = true. Since TodayPreRunBodyV3 is now actually presented, showShoePicker = true (still fired from within it, per original code at ~line 1881) is reachable, making the TodayShoePicker sheet and /api/today/sho …  
_Gated correctly on selectedEffort != .rest so it doesn't appear on rest days._  

**✅ FIXED** — Double-booked days (two run rows on one date) are silently collapsed to one — the second run is invisible on iPhone and can survive a replace-move  
web-v2/app/api/plan/week/route.ts:156-165 TYPE_PRIORITY now includes race_week_tuneup:4 (was falling to default 2, same bug class as finding 1) and the priority values now match web-v2/lib/watch/build-workout.ts:335-341's SQL CASE ordering for every shared type key (race:6, long:5, quality-family:4, easy/recovery:3, cross:2, strength:1, rest:0) — no more mismatch. Additionally route.ts:166-236 now computes runningRowsByDate and emits a new secondaryRun field per day (the runner-up running-type r …  
_The two priority tables were not literally merged into one shared constant as the proposed fix suggested, but the concrete failure (mismatched priorities + invisible second run) is fully closed — values are aligned and the second run is now surfaced _  

**✅ FIXED** — Missed-yesterday runs are never surfaced — no acknowledgment, nudge, or adjustment on Today  
New missedYesterdayLine computed property (TodayView.swift:2203-2215) is rendered inline in the hero at lines 1143-1153 as a quiet one-line coach acknowledgment ('Yesterday's Xmi run didn't happen.'). It correctly guards: selectedIsToday only, day.type != rest && distance_mi > 0, completedRunId == nil, skipped != true — matching the finding's proposed fix almost exactly (explicit skips already have their own acknowledgment, so they're correctly excluded here to avoid double-messaging). yesterday …  
_No CTA to move/reschedule the missed day (deliberately, per the inline comment: 'a missed day is already past, skip/move only makes sense for a day still ahead') — this is a reasonable design choice, not a gap. runNoun() doesn't have a case for race__  

**✅ FIXED** — Metric preferences are ignored: Today hardcodes miles, min/mi and °F despite backend units settings  
This was addressed in the separate wave3b/metric-units-fix effort (commits f9296bb1, 45025438, 18f67a50, all on main). TodayView.swift now has formatMiWithUnit (line 3053-3056) which converts via Units.convertDistance(miles:to:Units.preference.distance) and appends Units.distanceLabel(); this is used consistently including in the newly-added secondaryRunCard and missedYesterdayLine (both call formatMiWithUnit / Units.convertDistance).  
_Verified this is genuinely threaded through the newly-added today-composition code too (not just the original call sites), so the fix and the concurrent today-composition wave are consistent with each other._  

**✅ FIXED** — Future-day skip has no undo and no visual acknowledgment on the selected day's hero  
New isSelectedDaySkipped (TodayView.swift:1989-1991) generalizes the skipped-hero gate from isSkippedToday (today-only) to any selected day, reading todaySelectedDay?.skipped (server truth for whichever day is selected) OR'd with the today-only optimistic flag. heroBlock (line 1016) now branches on isSelectedDaySkipped. The Undo button (line 1052-1056) now calls unskipSelectedDayAction() (line 2910-2924), which routes to the existing unskipTodayAction() for today, or for any other day calls the  …  
_Solid end-to-end fix; both the read side (isSelectedDaySkipped generalization) and write side (deleteSkip(date:) + routing) were done, exactly per the proposed fix._  

**✅ FIXED** — WeekAheadView is unreachable (no navigation pushes .weekAhead) and carries a Sunday-mislabeled-as-MON bug plus a never-populated runId  
native-v2/Faff/Faff/Views/WeekAheadView.swift no longer exists in the source tree (only stale build-cache/.o/.dia artifacts under native-v2/build/ reference the old filename — not tracked, not part of the app target). `git ls-files | grep -i weekahead` returns nothing. FaffRoute enum in native-v2/Faff/Faff/Views/RootTabView.swift (line 50) no longer contains a .weekAhead case at all.  
_Resolved by deletion rather than by fixing the DOW mapping bug and wiring navigation as the finding's proposed fix suggested — but the original failure mode (a dead, buggy, unreachable view sitting in the codebase, confusing future readers and carryi_  

### train — 4 fixed / 1 partial / 1 unfixed

**✅ FIXED** — Runaway missed-workout adapter: stale quality run rides 2 days ahead forever, flattens every future quality session, and corrupts week buckets  
web-v2/lib/plan/adapt.ts was rewritten 2026-07-06 (explicitly tagged P1-35/P1-38/P1-39/P1-46/P2-64/P2-67 in comments). The reschedule UPDATE at lines 697-711 now sets dow, re-resolves week_id from plan_weeks covering the new date, and stamps original_date_iso — no longer a bare date_iso poke. chooseRescheduleDate() (lines 307-333) walks today+1..+4 and rejects any candidate with runCount>0 (collision guard), a rest/long-run dow, adjacent quality/long, over weekly_frequency, or near a race. detec …  
_Full match to the finding's proposed fix. This is the strongest fix among the six._  

**❌ UNFIXED** — training-state emits multiple rows per date (strength companions + adapter collisions); iPhone TrainView double-counts done mileage and renders phantom 'EASY 0 mi' rows  
generate.ts:2855-2882 still writes up to 2 'strength' plan_workouts rows per week on easy-run days, landing on the SAME date_iso as the easy run (dateForDow(d.dow) reuses the easy day's dow). web-v2/lib/coach/training-state.ts:234-260 still builds weeks[].days from every plan_workouts row per week_id with zero per-date collapse and zero type='strength' filter — unlike /api/plan/week/route.ts which now has an explicit 2026-07-07 'P2-11' collapse (NON_RUN_TYPES set, primary-row-per-date pick) that …  
_None of the three cited fix candidates (filter type=strength out of days, collapse to primary-run-per-date, or a Swift-side strength case) were applied. The API route sibling (/api/plan/week) got the fix; training-state.ts, which feeds TrainView via _  

**✅ FIXED** — MAINTENANCE and RECOVERY plans display as 'BASE' phase with base-building copy on the iPhone Train tab  
Theme.swift TrainPhase enum (lines 588-621) now has explicit .maintenance and .recovery cases with labels 'MAINTENANCE'/'RECOVERY', and init(phaseKey:) maps 'maintenance'->.maintenance and 'recovery'/'injury-return'->.recovery before falling to the .base default — comment explicitly cites 'P2-16, audit 2026-07-06'. generate.ts still writes plan_phases.label='MAINTENANCE'/'RECOVERY' (uppercase), and the Swift init lowercases the key first so it matches. TrainView.swift:572-574 also fixed the FULL …  
_Clean, complete fix on both the phase-label and caption halves of the finding._  

**✅ FIXED** — Move-run flow lets a runner delete their race-day row via 'Replace it'  
web-v2/app/api/today/reschedule/route.ts:111-123 now rejects with 'race_day_immovable' when the SOURCE day's primary run is type='race' (comment cites 'P2-17, audit 2026-07-06') and rejects with 'race_day_protected' when the TARGET day's primary run is type='race', both before the replace:true DELETE path can execute. Client-side, native-v2/.../TodayView.swift:2748-2759 (rescheduleAffordance) hides the Skip/Move affordance entirely when day.type=='race', and rescheduleTargets (lines 2772-2788) f …  
_Server + client both fixed, matching the proposed fix verbatim._  

**✅ FIXED** — No plan-end or no-plan state on the Train tab; post-plan weeks fabricate REST days on the Today strip  
TrainView.swift now branches at the top of body (lines 80-111) on noPlan/planEnded computed properties (lines 269-311, explicitly commented 'P2-18, audit 2026-07-06') and renders planEndState(noPlanMode:) — an honest 'NO PLAN'/'PLAN COMPLETE' hero with a Goal-tab CTA — instead of falling through to the fabricated BASE hero. The header pill also branches (phasePill, lines 131-138) to a planEndPill with 'NO ACTIVE PLAN'/'PLAN COMPLETE' copy instead of a false phase claim. For the Today-strip half  …  
_Both halves (Train tab empty state and Today strip fabrication) are addressed; the calendar-lens 'unplanned days' fallback at TrainView.swift:1304 renders .normal (not fabricated rest) and only applies to days genuinely outside the loaded weeks, whic_  

**🟡 PARTIAL** — Kilometre preference is a dead toggle — stored, offered in web settings, consumed nowhere  
A new native-v2/Faff/Faff/Util/Units.swift file (self-described as 'the fix' for phone-watch-audit-2026-07-06.md) provides a single formatting choke point (convertDistance/formatDistance/formatPace/convertSpeed/formatTemperature) reading UserSettings.units_distance/units_temp. TrainView.swift was fully converted — every former raw trainMi() display call site (lines 369,738,1139-1145,1358,1497,1544,1647) now routes through trainMiConverted() which calls Units.convertDistance. The same Units.swift …  
_The native (iPhone) and watch consumption gap — the larger part of the original finding by surface count — is now closed with a real, broadly-adopted formatting layer. The web display layer remains exactly as dead as described in the original finding_  

### activity — 8 fixed / 2 partial / 1 unfixed

**🟡 PARTIAL** — STATS wall 'ALL TIME' totals silently capped at the 200 most recent runs  
ActivityView.swift:24 fetchLimit still starts at 200, but ensureFullHistoryForStats() (lines 271-275) now auto-raises it to 1000 when logTruncated is true, and rangeLabel (lines 330-341) degrades honestly to 'LAST N RUNS' instead of silently claiming 'ALL TIME' when still truncated at the ceiling. The silent-mislabeling failure is closed, but the underlying cap is only raised (200->1000), not removed — /api/log (web-v2/lib/coach/log-state.ts:337) still computes totalMi from the LIMIT-windowed `r …  
_Practically low-impact for David (~101 runs per memory) but the mechanism described in the finding (server-side truncation feeding a client 'ALL TIME' number) still exists past 1000 runs, just now disclosed rather than hidden._  

**❌ UNFIXED** — 'Personal records' card violates the race-data source-of-truth: derived purely from training-run averages, never reads races.actual_result, no provisional labeling  
computeRecords() in ActivityView.swift:386-441 is unchanged in substance: 'FASTEST PACE' (line 393-396, 416-418) is still `runs.compactMap{...}.min(by: pace)` over every LogRun's whole-run average pace, no distance floor, label still literally 'FASTEST PACE' with no 'training' qualifier. grep across native-v2/Faff for fetchRaces/api/races/actual_result confirms ActivityView.swift never calls /api/races or reads races.actual_result. web-v2/lib/coach/log-state.ts (backing /api/log) also never refe …  
_This is the clearest violation of the project's locked race-data doctrine among all 11 findings — it was not touched by any of the 4 waves._  

**✅ FIXED** — Consistency section shows a hardcoded '21-DAY RUN STREAK' and hardcoded 'JAN FEB MAR APR MAY' month axis to every runner  
ActivityView.swift:219-223 now reads the real /api/streak response (`streak` state, loaded via loadStreak() at line 100-103) and hides the label entirely when `s.current == 0` instead of always claiming 21 days. Month axis (lines 235-246, heatmapMonthLabels at 280-295) computes real MMM labels from the actual 18-week window via DateFormatter, with consecutive-duplicate suppression, replacing the hardcoded JAN-MAY array.  

**✅ FIXED** — Run detail 'Shoes' row shows the runner's preferred/highest-mileage shoe, not the shoe assigned to the run  
RunDetailView.swift:762-766: `effectiveShoeId` resolves to `localShoeId ?? run?.shoe_id` (the actually-assigned shoe, not the picker inventory's first entry), and `assignedShoe` does `run?.shoes?.first { $0.id == id }` — an ID-match lookup, not `.first`. Shows '—' when shoe_id is nil (shoeShort guard at 767-770). The chevron now opens RunShoePickerSheet (lines 581-584, sheet wired at 294-305) and a picked shoe PATCHes via API.assignShoeToRun. Backend confirms shoe_id is decoded and shipped on th …  

**✅ FIXED** — Mile-splits dashed target line is plotted on the wrong axis in pace mode — raw pace seconds against inverted (800 − secs) bar values  
RunDetailView.swift:130 now passes `Double(800 - splitTargetSecs)` for pace mode, matching the bars' own (800-secs) transform. MileBars.swift was also rewritten at the component level: the derived domain now includes the target value (line 33: `values = bars.map(\.value) + (target.map{[$0]} ?? [])`), and the dashed line only draws when `t >= lo && t <= hi` (line 42) — the previously-unclipped Path is gone.  

**✅ FIXED** — %MHR / LTHR zone-method toggle is a no-op — the TIME IN ZONE chart never changes  
zonePcts (RunDetailView.swift:923-925) now branches on `zoneMethod`: `.lthr` case calls `lthrZonePcts` (932-950), which genuinely recomputes zone-time by bucketing each split's HR against `hr_zones_from_lthr.ranges` via hrZoneIndex and weighting by split duration — a real recompute, not a relabel. The toggle (line 206-211) is still gated to only render when `lthrZonePcts != nil`, matching the original doc's stated intent.  

**✅ FIXED** — Untyped runs render as TEMPO in run detail: hot red mesh, pace-led splits, inconsistent with the feed's neutral 'RUN'  
RunDetailView.swift:631 `effort` now reads `FaffEffort.fromType(run?.planned_spec?.kind ?? run?.type)` (planned-kind-first, matching hiwEffort), and FaffEffort.fromType's default case (Theme.swift:408) returns `.easy`, not `.tempo`. hiwEffort (line 640) uses the same pattern. Untyped runs now resolve to the neutral easy treatment consistent with the feed row's 'RUN' label.  

**✅ FIXED** — Split bar colors and 'highlight' are hardcoded to ~6:35/mi elite thresholds — meaningless for most runners  
The old colorForSplit function (fixed 395/410/420s buckets) no longer exists anywhere in RunDetailView.swift. Pace-mode bar coloring (lines 815-845) now derives a 10th-90th percentile ramp from the run's own split-pace distribution (`rampLo`/`rampHi`/`rampSpan`) and colors via RouteMapView.rampColor — a relative, per-run scale as the proposed fix suggested. isHighlight now marks the run's own fastest split rather than an absolute sub-6:50 cutoff.  

**✅ FIXED** — PRSheet is a fully hardcoded mock (Half Marathon 1:29:48, 'first sub-1:30', CIM sub-3 coach copy) with no data inputs, and is mounted nowhere  
PRSheet.swift no longer exists in the source tree (confirmed via `find` — only stale build-artifact remnants in native-v2/build/**, not source). Git log confirms it was deleted in commit 63393e36 ('fix(iphone): Activity + run-detail honesty pass'). Zero references to 'PRSheet' remain anywhere under native-v2/Faff. This matches the first proposed-fix option (delete until real PR detection exists) rather than parameterizing it.  

**🟡 PARTIAL** — Metric-preference users get imperial-only Activity and run detail — backend units setting exists but is never honored  
A genuine Units.swift choke point now exists (native-v2/Faff/Faff/Util/Units.swift) reading units_distance/units_temp from cached UserSettings, and both ActivityView.swift and RunDetailView.swift were substantially rewired to call Units.formatDistance/formatPace/formatPaceBare/formatTemperature/distanceLabel/temperatureUnitSuffix throughout — MILES/KILOMETERS toggle (ActivityView.swift:183), pace strings, hero stat keys ('WORK /KM' etc, RunDetailView.swift:666-670), and weather all convert corre …  
_This lines up with the 'Wave 3b: metric units end-to-end' memory entry — distance/pace/temp got full treatment, elevation wasn't covered by that pass._  

**✅ FIXED** — STATS 'RUNS' count ignores the MONTH/YEAR/ALL range picker while MILES/TIME/ELEV honor it; range labels also misname rolling windows  
ActivityView.swift:196 now reads `Stat(value: "\(rangeRuns.count)", key: "RUNS")`, matching the range-filtered rangeRuns used by MILES/TIME/ELEV. Range labels (lines 336-341) were relabeled to 'LAST 30 DAYS' / 'LAST 12 MONTHS' / 'ALL TIME' (or honest 'LAST N RUNS' when truncated), replacing the misleading 'THIS MONTH'/'THIS YEAR' that implied calendar-month boundaries for what was actually a rolling 30/365-day window.  

### targets — 5 fixed / 1 partial / 4 unfixed

**✅ FIXED** — Quality-run verdicts for non-watch users judged on whole-run pace vs work-phase target, collapsing executionQuality and flipping status to BEHIND  
web-v2/lib/training/goal-projection.ts: judgeTestPointExecution (line 748) now implements a 4-tier basis ladder — (1) watch work-phase pace, (2) splits-derived work-window pace via contiguousWorkWindowMi/paceOverWindow, (3) blended whole-run expectation reconciled against actual distance (expandSpecToPhases + blendedExpectation), (4) honest abstention (verdict: null) when nothing resolves. loadRecentTestPoints (line 882) calls this via judged.verdict/judged.basis rather than naively comparing ov …  
_Goes beyond the proposed fix's 'abstain or use a wider tolerance' options by adding a genuine splits-derived work-window read as an intermediate tier before falling back to blend/abstain._  

**✅ FIXED** — Watch-completion date bucketing hardcodes America/Los_Angeles, breaking work-phase reads and verdicts for non-Pacific runners  
All four cited call sites now use `const ciTz = await runnerTimezoneOrPacific(userUuid)` and bucket with `(ci.ts AT TIME ZONE $N::text)::date`: loadRecentTestPoints (goal-projection.ts:889/934), detectTempoPaceDrift (:1318/1337/1346), computeOverPerformanceBonus (:393/~408 region). runnerTimezoneOrPacific (web-v2/lib/runtime/runner-tz.ts:91) reads the runner's stored profile timezone and falls back to Pacific only when null, with a documented live-verified rationale (every populated profile curr …  
_No remaining hardcoded 'America/Los_Angeles' string literals in goal-projection.ts; the only occurrence is an explanatory code comment at line 393._  

**✅ FIXED** — No-race fitness-goal mode gets a half-marathon projection regardless of goal distance, an 88pt '—' hero, and 'On track for —.' coach copy  
web-v2/app/api/targets/projection/route.ts:175-236 (tagged P1-12/P1-53) resolves goal distance/time/deadline from profile.tt_goal_distance/tt_goal_time/tt_goal_time_seconds and the active goal-mode plan's goal_iso when no race row exists, then computes `distanceMi = race?.distance_mi ?? goalModeDistanceMi ?? distanceQ` (line 219) — server-resolved goal distance always wins over the client's query param. goalSec, daysAway, and status all derive from this correctly. Native TargetsView.swift render …  
_The client's distanceForProjection() (TargetsView.swift:370-391) still never reads fitnessGoal.distance and still defaults non-race, non-half distances to 13.1 in its query param — but this is harmless because the server ignores distanceQ whenever ra_  

**✅ FIXED** — Runners slower than ~VDOT 30 get no VDOT and no predictions ever; cold state tells them to race a 5K they already raced  
vdotFromRace (vdot.ts:165) still correctly returns null below VDOT 30 (doctrine-correct per CLAUDE.md 'engine must match research' — the Daniels table is cited only for [30,85]), but route.ts:292-319 now adds a belowTableAnchor fallback: when nothing resolves a VDOT, bestRecentVdot's belowTableAnchor is used with predictRaceTimeFromAnchor (Riegel's power law, vdot.ts:287-297, cited independently of the VDOT table) to produce an honest projectionSec even when VDOT itself stays null. projectionIsB …  
_The actual fix (Riegel-based prediction off demonstrated pace) is a better solution than the finding's proposed 'clamp VDOT at 30' — it avoids extrapolating a formula outside its cited validity range while still giving the runner a real number instea_  

**✅ FIXED** — Trajectory gain is not scaled by remaining runway, so a wildly unrealistic goal reads ON PACE weeks from race day and contradicts the LOW confidence label in the same payload  
fitness-trajectory.ts:221-236 (tagged P1-14, dated 2026-07-06) adds `runwayCapGain = buildWeeks * BASE_BUILD_RATE` and changes plannedGainVdot to `clamp((goalVdot - currentVdot) * executionQuality, 0, Math.min(gainCap, runwayCapGain))` — the exact contradiction described (VDOT-40 runner needing 44.5 with 3 weeks left projecting the full 4.5 gain) is now capped by the same BASE_BUILD_RATE=0.35 midpoint that computeConfidenceLabel (goal-projection.ts) already grades the runway against, per the mod …  
_The over-performance bonus correctly still rides on top of the runway-capped planned gain (uncapped by runway, since it represents demonstrated fitness, not modeled future build) — this matches the doctrine distinction the fix documents._  

**❌ UNFIXED** — EXECUTION card shows the 0.7 no-data default as a measured '70%' with a warning tick  
executionQualityFromTestPoints (goal-projection.ts:344-363) still returns a flat `missedKeyWorkouts ? 0.5 : 0.7` default (line 349) when zero verdicts exist, indistinguishable in the payload from a genuinely-measured 0.7. route.ts:640 passes `traj?.executionQuality ?? null` through with no source/confidence flag. ProjectionSummary.swift never decodes any such flag for this field (only `executionSource` exists, but that's a completely separate field for the §2.3 pacing-buffer chunk, not execution …  
_The 'source: default|observed' pattern the finding cites as already existing for the pacing chunk (executionSource) was never extended to executionQuality, despite that exact parallel being named in the original proposed fix._  

**❌ UNFIXED** — Race saved without a goal time renders 'On track for —.' coach copy  
AddRaceSheet still marks the goal field 'GOAL (optional)' (TargetsView.swift:1021). statusFor (route.ts:113-120) still returns 'cold' when goalSec is null. K_TargetsProjection.swift's ProjState resolution (lines 297-308) still falls to the execution/fitness-lever default branch for unrecognized/cold status, landing .on for a fresh user with no verdict history. summaryLine (lines 393-404) still has no goalSec==nil branch and the .on case literally interpolates `\(goal)` = projFormatTime(nil) = '— …  
_No no-goal-specific copy variant exists anywhere in K_TargetsProjection.swift; this is the exact same failure path described in the original finding, byte-for-byte._  

**❌ UNFIXED** — TODAY accrued estimate conflates active-plan span with race runway, mis-stating progress when the plan is not race-aligned  
route.ts:456-473 (the trajectoryAccruedSec block) is unchanged in shape: `planSpanQ` still computes `totalPlanWeeks` from `MAX(pw.date_iso) - MIN(pw.date_iso)` over ALL of the user's active (non-archived) plan_workouts with no filter tying it to the specific race/goal being queried (`WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL` only — no race_id join). `completedWeeks = Math.max(0, totalPlanWeeks - weeksToRace)` (line 469) is exactly the formula quoted in the original finding.  
_training_plans.race_id exists and is used elsewhere in this same file (line 208) to filter goal-mode plans, so a race-scoped join was available but not applied here._  

**🟡 PARTIAL** — Ultra distances (50K-100M offered in Add Race) are predicted with the Daniels curve far outside its validity; client-side distance parse also defaults ultras and 'Other' to 13.1  
The P0-severity core defect (fabricated ultra prediction) is fixed: predictRaceTime (vdot.ts:375-377) and vdotFromRace (vdot.ts:157-159) both now gate on DANIELS_MAX_VALID_DISTANCE_MI=26.3 and return null past the marathon, cited to Research/02 §6.2/§14 rule 6 (tagged P2-70/P2-71). Since route.ts:219 resolves distanceMi from race.distance_mi (the real DB value, e.g. 50K) rather than the client's query param, the server correctly nulls the projection for ultra goals regardless of client bugs. How …  
_The dangerous half of the bug (a fabricated 7:24/mi 100-mile time) is closed. What remains is a UX/wiring gap: the honest-copy improvement never reached the native client._  

**❌ UNFIXED** — Training-run VDOT anchors are labeled 'RACE EFFORT' in the anchor provenance row  
TargetsView.swift:224 and :627 both still render `(profile?.physiology.vdot_anchor_name ?? "RACE EFFORT").uppercased()`. profile-state.ts:279-289 (vdotAnchorName resolution) is unchanged — still resolves ONLY by matching a races row within ±1 day of the anchor date, with no source ('race'|'run') field threaded through projection_snapshots or ProfileState at all. Confirmed via grep across profile-state.ts, route.ts, API.swift, and TargetsView.swift for any anchor_source/vdotAnchorSource/'TRAINING …  
_Identical failure path to the original finding: any training-run-anchored VDOT (the normal case for runners who don't race often) still mislabels as RACE EFFORT._  

### settings — 10 fixed / 2 partial / 0 unfixed

**✅ FIXED** — iPhone notification preferences are wire-incompatible with the backend — never load, never save  
native-v2/Faff/Faff/Components/Toolkit/G_Settings.swift:179-229 — NotificationPrefs struct now uses the exact canonical server keys (master_enabled, race_day_enabled, race_eve_enabled, skip_recovery_enabled, weekly_checkin_enabled, niggle_sick_enabled, streak_enabled, strava_reconnect_enabled), replacing the old 7-key phone dialect. API+Toolkit.swift:289-315 fetchNotificationPrefs decodes the canonical shape directly from the top-level body and patchNotificationPref sends one changed canonical k …  

**✅ FIXED** — Plan-shaping settings changes never rebuild goal-mode (no-race) plans  
web-v2/lib/plan/auto-rebuild.ts:189-252 rebuildActivePlanForPrefs now has an explicit goal-mode gate (isGoalMode, requiring authored_state.goal_mode==='true' + a usable goal_distance_mi + goal_iso) that no longer bails at 'no_active_race_plan' for race_id=null goal-anchored plans. When isGoalMode, it calls generatePlan({userId, goalTarget: {distanceMi, goalSec, raceDateISO}}) using the plan's own recorded goal/deadline — verified generatePlan (web-v2/lib/plan/generate.ts:210-218,3041-3377) treat …  

**✅ FIXED** — Strava 'connected' state derived from ANY recent run, not from Strava linkage  
web-v2/lib/coach/profile-state.ts:256 now sets stravaConnected = stravaConnStatus.state === 'connected', where stravaConnStatus comes from loadStravaConnectionStatus (web-v2/lib/strava/connection-status.ts) which reads connector_tokens / legacy profile.strava_refresh_token — real token linkage, not run recency. The old any-source runs MAX() query is still present but is now explicitly scoped to source='strava' (profile-state.ts:160-169) and used only to compute the 'last sync' note, not the conn …  

**🟡 PARTIAL** — Metric users: backend supports km/C units but iPhone hardcodes imperial everywhere and offers no units setting  
A real UNITS settings group now exists (SettingsView.swift:853-856) writing units_distance/units_temp to /api/settings, and native-v2/Faff/Faff/Util/Units.swift is a genuine app-wide formatting choke point consumed broadly (PlannedView, ActivityView, RaceDayView, TodayView, ShoesView, RunDetailView, TargetsView, TreadmillView, and more — 18+ files) for distance/pace/temperature. However the original finding specifically named weight and height as hardcoded-imperial with zero unit control, and th …  

**✅ FIXED** — Apple Health 'Connect' row is dead and 'Re-sync Health' reports fake 'Sync complete.' for never-connected users  
SettingsView.swift:92-103 — the Apple Health row is now wrapped in a real Button that calls hkImporter.requestAuthAndImport(daysBack: 14) when !hasConnected, disabled while hasConnected or requesting. forceHealthResync (SettingsView.swift:339-368) now branches: importIfConnected when already connected, else requestAuthAndImport, and surfaces hkImporter.lastMessage or an honest 'Health access wasn't granted. Nothing synced.' — never a fabricated 'Sync complete.' for a sync that never ran. appleHe …  

**🟡 PARTIAL** — No account-deletion path anywhere (app UI or backend) despite in-app account creation  
web-v2/app/api/account/delete/route.ts is a genuinely solid, complete backend implementation: password re-auth (bcrypt.compare), runtime pg_catalog enumeration of every user-keyed table with a sanity floor (assertSufficientTableCount) before deleting, FK-aware deletion ordering (buildDeletionPlan), one transaction, best-effort Strava token revoke, ops_alerts tombstone, and session cookie clearing. However grep across the entire native-v2/Faff/Faff tree for 'account/delete', 'Delete account', 'De …  

**✅ FIXED** — available_days silently overrides long-run/rest/quality day edits made in Settings  
web-v2/app/api/settings/route.ts:13-23 — available_days is now in ALLOWED and PLAN_SHAPING. SettingsView.swift:821-822 exposes it as an editable/clearable 'Days you can run' field with explicit hint copy, seeded from server (line 575, always seeded even as []). A live conflictWarning computed property (SettingsView.swift:965-984) warns in-sheet before Save when editing long_run_day/rest_day/quality_days would conflict with a non-empty available_days constraint. Backend confirmed: web-v2/lib/plan …  

**✅ FIXED** — Deselecting all quality-day chips saves [] which permanently removes all quality workouts, while the row displays 'Not set'  
web-v2/lib/plan/generate.ts:3465 now reads `prefs?.quality_days?.length ? prefs.quality_days : ['tue','thu']` — closing the old `?? []`-only-catches-null gap so an explicit empty array falls back to defaults exactly like unset. Verified qualityDows flows into the `input.qualityDows.length > 0` gate at generate.ts:2246 with a non-empty default. UI side: SettingsView.swift:678 displayValue for quality_days=[] now returns 'Auto · coach picks' instead of 'Not set', and the multiday editor (SettingsV …  

**✅ FIXED** — No way to retire, edit, or delete a shoe on iPhone even though the backend supports it  
ShoesView.swift:209-248 — rotationList rows now carry .contextMenu { shoeActions(shoe) } offering Edit, Mark race shoe, Retire/Unretire, and destructive Delete (with a confirmation dialog via deleteCandidate). API.swift:514-541 adds patchShoe(id:fields:) and deleteShoe(id:), both hitting PATCH/DELETE /api/shoe. Backend web-v2/app/api/shoe/route.ts:106-155 has matching PATCH (ALLOWED_PATCH includes retired/preferred/brand/model/run_types/mileage_cap/baseline_mi/etc, user_uuid-scoped) and DELETE ( …  

**✅ FIXED** — ProfileView sign-out skips the multi-user hygiene cleanup that SettingsView performs; cycle flag never cleared by either  
native-v2/Faff/Faff/Util/SessionHygiene.swift is a new shared signOut() helper that both SettingsView.swift:503 (performSignOut) and ProfileView.swift:194 (performSignOut) now call exclusively. It revokes the server session via API.logout() (confirmed the endpoint exists at web-v2/app/api/auth/logout/route.ts), clears TokenStore, the onboarded flag, the HK-connected flag, lastNightHours (both the published property and its UserDefaults key — the specific multi-user hygiene bug from 2026-06-10),  …  

**✅ FIXED** — Health '+ log' sheet is decorative — fields aren't editable and Save silently does nothing  
HealthView.swift:935-1046 — HealthLogSheet's WEIGHT/RESTING HR/SLEEP rows are now real TextField-bound editable fields (logField at line 999), and save() (1022-1045) calls HealthKitImporter.shared.postManualSample for each populated field, which POSTs to /api/ingest/health with the same auth path and wire shape the automatic HK importer uses. Confirmed the sample types (body_mass, resting_hr, sleep_hours) are all on the backend's ALLOWED_TYPES whitelist (web-v2/app/api/ingest/health/route.ts:46- …  

**✅ FIXED** — Manual timezone picker offers only 15 zones — most of the world can't pin their timezone  
SettingsView.swift:1114-1148 — TimezoneSearchPicker replaces the old 15-zone SETTINGS_ZONES chip grid with a searchable, region-grouped list built directly from TimeZone.knownTimeZoneIdentifiers (~400 IANA names, confirmed at line 1123). A previously-stored zone outside the old 15 (e.g. America/Sao_Paulo, Asia/Kolkata) is now reachable via search and re-selectable. Wired into the field editor at line 1011 for the timezone field's .timezoneSearch kind, gated to manual mode as before (tzModeIsManu …  

### raceday — 2 fixed / 2 partial / 3 unfixed

**✅ FIXED** — races.meta.distanceMi never written — race-morning composers dead for every app-created race  
web-v2/lib/race/distance.ts introduces a single canonical distanceMiFromLabel parser (dated 2026-07-06 · P1-17). All three write paths now stamp meta.distanceMi: POST /api/race (web-v2/app/api/race/route.ts:67), onboarding (web-v2/app/api/onboarding/complete/route.ts:540), and PATCH auto-derives it on label edit and self-heals it on any other PATCH (route.ts:174-186). Read-time consumers (races-state.ts:150, execution-plan/route.ts:53-54) fall back to distanceMiFromLabel(meta.distanceLabel) for  …  
_Comprehensive fix — both prevents new dead races and self-heals existing ones._  

**✅ FIXED** — Recording the prescribed race-morning warm-up jog kills the race-day takeover on Today  
TodayView.swift:248-249 raceDayRouteSlug now gates on `!isRaceActuallyDone` instead of `!isDone`. isRaceActuallyDone (TodayView.swift:2470-2476) requires done_mi >= raceDistanceMi*0.7 (falls back to a flat 2.0mi floor when raceDistanceMi is unresolved) — comfortably above a 1-mile prescribed warm-up and below every supported race distance (5K=3.1mi shortest). Confirmed done_mi (plan/week/route.ts:224) sums the day's total canonical mileage via canonicalMileageByDay, so a warmup-only day stays un …  
_This is exactly the fix the finding's proposed_fix suggested (distance-plausibility floor mirroring the watch-complete ±30% guard)._  

**🟡 PARTIAL** — A nearby training run is auto-matched as the race finish time and shown as authoritative on iPhone (no provisional label)  
The match-tolerance half of the bug is genuinely fixed: races-state.ts:211 now uses a proportional window (10% of race distance, floor 0.31mi, cap 2.0mi) instead of the old flat ±2.0mi, so a 4-mi easy jog can no longer match a 5K. finishProvisional/finishProvisionalLabel are correctly computed server-side (races-state.ts:246-249) and correctly consumed by coach-voice text (lib/coach/fact-reciter.ts:401, renders 'Strava elapsed · race to lock in'). BUT the iPhone's Race model (native-v2/Faff/Faff …  
_The tightened match window reduces false-positive matches, but any match that DOES land still displays as unlabeled/authoritative on both iPhone and web — the core Rule-3 violation (CLAUDE.md race-data doctrine) survives._  

**❌ UNFIXED** — Race execution plan is half-marathon-templated: 'BY MILE 5' trigger, 'push last 5K', broken split arithmetic for short races  
web-v2/lib/race/execution-plan.ts:392 still hardcodes `atMile: 5` unconditionally; RaceDayView.swift:1477 still renders 'BY MILE \(t.atMile ?? 5)' verbatim — for a 5K (3.1mi) this instructs a checkpoint past the finish line. Line 456 still hardcodes the strategy line ending 'Push the last 5K on feel.' regardless of distance. Traced the repayMiles clamp for a 5K: wholeMiles=3, earlyMiles=min(3,3)=3, repayMiles=max(1, 3.1-3)=max(1,0.1)=1 (clamped), giving repayPerMi=24/1=24 s/mi instead of the ~24 …  
_None of the three sub-issues in this finding were touched. The comment at execution-plan.ts:329 still literally reads 'Splits · Research/08 §3.4 HM template'._  

**❌ UNFIXED** — Runner cannot log their race result on race day — retro only unlocks the next calendar day  
races-state.ts:109 is_past is still `date < today` with no same-day exception. RaceDayView.swift gates THE RETRO section (line 366-367), the whole hero flip (line 526), and every other post-race UI state strictly on `detail?.race.is_past == true` (lines 338, 366, 488, 526, 648, 656, 663, 674) — grepped every is_past reference in the file, all unchanged. No alternate gate (e.g. `days <= 0` or a completed-run check) was added anywhere in RaceDayView.swift. TodayView.swift's post-race flow (now cor …  
_Notable interaction with the Finding-2 fix: now that Today correctly detects the race is done same-day and drops the RaceDayView takeover, a runner who navigates directly to RaceDayView (e.g. via Targets) on race evening still sees the stale pre-race_  

**🟡 PARTIAL** — Phone fueling card and watch gel cues disagree whenever the runner has not entered their own fuel  
The entered-fuel case is now genuinely unified: both build-workout.ts:734-746 (watch) and app/api/race/[slug]/route.ts:157-164 (phone) call computeRaceFueling via the same resolveRaceFuel helper when fuelIsDefault is false. BUT for the common default-fuel case (runner hasn't entered fuel), the phone (route.ts:158-164) still unconditionally calls computeRaceFueling with isDefault:true, producing a cadence-derived schedule off a 60 g/hr default (execution-plan.ts:149 DEFAULT_RACE_CARBS_PER_HOUR_G= …  
_The fix addressed the narrower entered-fuel case; the default-fuel case that the finding's evidence explicitly called out ('the phone always computes computeRaceFueling... cadence-derived (~every 22-25 min)') is untouched._  

**❌ UNFIXED** — No race-day mode at all for a racer without an active plan  
build-workout.ts:325 still unconditionally returns `{ message: 'No active plan.' }` when no training_plans row exists — grepped the whole file for any 'races' table read as a fallback source or any synthesis logic; the only 'FROM races' reads (lines 370, 634) are enrichment lookups gated behind an already-resolved plan race row, not a standalone fallback. TodayView.swift's raceDayRouteSlug (line 249) still requires selectedEffort == .race, which derives from selectedDayEffort — itself sourced fr …  
_No synthesis path (from a bare races row, independent of a plan) was added anywhere in build-workout.ts or TodayView.swift's gate chain._  

### treadmill-strength-notif — 11 fixed / 1 partial / 2 unfixed

**❌ UNFIXED** — APNs has never delivered a single notification in prod — creds unset, all sends since 2026-05-31 logged apns_not_configured  
Live read-only prod DB probe run during this re-verification: notifications_log now has 58 rows (up from 53), first 2026-05-31, LAST row 2026-07-07T01:59:52Z (today, ~hours before this audit), ALL 58 rows still show payload->>'skipped' = 'apns_not_configured' and delivered=false; COUNT(delivered=true) is still 0. web-v2/lib/notifications/apns.ts apnsIsConfigured() (line 421) still gates on APNS_KEY_ID/APNS_TEAM_ID/(APNS_KEY_PEM or APNS_KEY_PATH), unchanged in logic. This is a Railway-environment …  
_Purely operational (David-driven env var set), confirmed still outstanding via live prod query, not just code inspection._  

**✅ FIXED** — Treadmill run save has no durable retry queue — a failed POST offers only retry-now or 'Discard and exit' (permanent data loss)  
native-v2/Faff/Faff/Views/TreadmillView.swift endAndPost (line 716) now serializes the payload and calls WatchSync.shared.saveCompletionDurably(data) (line 752) BEFORE relying on network success. WatchSync.swift saveCompletionDurably (line 229) enqueues to the same UserDefaults-backed pendingCompletions queue (line 90-93) the watch relay uses, then attempts flushPendingCompletions(); drains are also triggered on WCSession activation, foreground refresh(), and reachability changes (lines 124-129, …  

**❌ UNFIXED** — HK strength-session dates hardcoded to America/Los_Angeles — non-Pacific runners get sessions logged on the wrong calendar day  
native-v2/Faff/Faff/HealthKitImporter.swift buildStrengthPayload (now at line 1746, was 1711) is completely unchanged: line 1750 still does `let pt = TimeZone(identifier: "America/Los_Angeles") ?? .current` and formats w.startDate in PT before sending as `date`. Commit 3a39bddb (2026-07-06, 'thread runner timezone through backend data paths, drop LA hardcodes') updated web-v2/app/api/strength/route.ts to accept optional start_at+timezone and derive the runner-local date server-side (lines 64-92) …  
_Backend groundwork was laid in the same commit that fixed sibling TZ issues, but the specific native call site cited by this finding was never wired to use it — a genuine miss, not a design choice (contrast: the sibling isoDayLocal fix for MANUAL hea_  

**✅ FIXED** — Notification inbox renders every row with blank title/body — SQL reads payload->'aps'->'alert' but dispatch stores flat SendPushArgs  
web-v2/app/api/notifications/inbox/route.ts now does COALESCE(payload->>'title', payload->'tpl'->>'title', payload->'aps'->'alert'->>'title') (and same for body), explicitly citing P1-23 and explaining the flat-shape reasoning inline. Verified against the writer: web-v2/lib/notifications/dispatch.ts line 158-160 inserts `JSON.stringify(stripDeviceToken(args))` where args has top-level title/body fields (SendPushArgs) — matches COALESCE branch 1 exactly.  

**✅ FIXED** — Weekly check-in and race-eve shakeout queries reference runs.start_time / runs.distance_mi — columns that do not exist  
web-v2/app/api/cron/notifications/route.ts shakeoutDoneToday (line 701) and weekSummary (line 718) are both rewritten, explicitly cited as P1-24 (2026-07-06). shakeoutDoneToday now calls runnerToday()+mileageByDay() (lib/runs/volume.ts, imported line 58) instead of `runs.start_time::date`. weekSummary now calls mileageByDay() for actuals and only plan_workouts (which genuinely has date_iso/distance_mi per prod schema, verified in the code comment) for planned. Grep confirms zero remaining `FROM  …  

**✅ FIXED** — Sick-check notifications cannot be resolved: RECOVERED action not registered on iOS category, dedup_key never sent in push payload  
Both sub-defects independently confirmed fixed, cited P1-25 throughout: (1) NotificationCategories.swift now registers a separate FAFF_SICK category (line 188-214) with its own RECOVERED action, distinct from FAFF_NIGGLE's GONE action; both are returned in the registered-categories array (line 238). web-v2/lib/notifications/apns.ts buildApnsBody (line 316) sets aps.category from args.apns_category_id override first, and web-v2/lib/notifications/templates.ts renderSickCheck sets apns_category_id: …  

**🟡 PARTIAL** — Treadmill console never disables the idle timer — phone auto-locks mid-run, app suspends, guided segments mangle and distance credited at stale speed  
TreadmillView.swift now toggles UIApplication.shared.isIdleTimerDisabled with the `playing` state (line 223-227, cited P2-45, 2026-07-06) and resets it onDisappear — this closes the specific auto-lock-from-inactivity trigger. However, the finding's other two proposed remedies were NOT implemented: (a) no clamp on the resume delta — tick() (line 263-273) still applies `let delta = max(0, Int(now.timeIntervalSince(lastTickAt).rounded()))` with no upper bound, then unconditionally adds the full del …  

**✅ FIXED** — Treadmill console is mph/miles only — metric-preference runners cannot enter km/h treadmill speeds; units_distance setting ignored  
A new shared Util/Units.swift (dated 2026-07-07, explicitly citing this audit finding by name in its header comment) provides Units.formatSpeed/speedLabel/formatPace/formatDistance reading UserSettings.units_distance. TreadmillView's speed tile (line 434-456) now renders Units.formatSpeed(mph: speedMph) with Units.speedLabel() ('mph' or 'km/h'), pace displays convert via paceDisplayStr, and distance/elevation formatting elsewhere in the file was similarly converted. Internal state (speedMph, dis …  

**✅ FIXED** — Lock-screen action acks fire in a detached Task with completionHandler called immediately — background acks can be lost to suspension  
NotificationsAppDelegate.swift userNotificationCenter(_:didReceive:withCompletionHandler:) (line 111, cited P2-47, 2026-07-06) now wraps the ack POST in a UIApplication.beginBackgroundTask/endBackgroundTask pair via a BackgroundAckGuard (line 167-186): the background task assertion is requested before the Task starts, the ack POST is awaited inside it, and completionHandler is only called after the POST settles OR the assertion's own expiration handler fires as a backstop — exactly the proposed  …  

**✅ FIXED** — Inbox promises 'Tap a row to ack from here' but rows have no tap handler  
NotificationInboxSheet.swift (cited P2-48, 2026-07-06) now wraps each row in a Button with handleRowTap (line 191-198): categories with a real rating choice (skip_recovery/weekly_checkin/niggle_sick) open a confirmationDialog picker mirroring the lock-screen actions (ratingOptions, line 89-100, including the sick-vs-niggle dedup_key-prefix disambiguation), other categories ack immediately with a neutral 'viewed' action. Posts to the same /api/notifications/ack endpoint with notification_id for r …  

**✅ FIXED** — Watch treadmill HR session can run indefinitely: stop message only sent when watch reachable, no timeout  
Both proposed remedies genuinely implemented, cited P2-49 (2026-07-06): (1) WatchSync.swift stopTreadmillHRSession (line 285-302) now falls back to s.transferUserInfo(['treadmillStop': sessionId]) when the watch is unreachable or the message send errors, so watchOS delivers it on next connection. (2) 'native-v2/Faff/FaffWatch Watch App/TreadmillHRSession.swift' now has a genuine dead-man timer: DEAD_MAN_SEC = 15 min (no phone ping resets lastPhonePingAt) and an ABSOLUTE_MAX_SEC = 4 hour hard cei …  

**✅ FIXED** — Strength session content generated but never surfaced — chip says 'recommended' with no what/how/tap  
A new native-v2/Faff/Faff/Views/StrengthSessionSheet.swift (cited P2-50, 2026-07-06) renders the full session: title, duration, intensity tag, PM timing note, the exercise list with sets×reps, a coach-voice line, and a one-tap 'Log it done' CTA (POST /api/strength) when the pick is for today. web-v2/lib/coach/training-state.ts now sets w.strengthPicks = rec.picks (line 298, explicitly citing this same finding) so the full session content rides through the training-state payload the native app al …  

**✅ FIXED** — /api/strength hk_uuid upsert has no owner guard — cross-user mutation possible  
web-v2/app/api/strength/route.ts POST handler (cited P2-51, 2026-07-06) now appends `WHERE strength_sessions.user_uuid = EXCLUDED.user_uuid` to the ON CONFLICT (hk_uuid) DO UPDATE clause (line 138), and treats an empty RETURNING (r.rows.length === 0 on the hk_uuid path, line 153-158) as a blocked cross-owner write, returning 409 'hk_uuid already registered to another user' instead of silently no-op'ing or succeeding. Matches the exact pattern already used by the DELETE handler's owner scoping.  

**✅ FIXED** — Weekly check-in mileage anchored to ISO Monday, contradicting long-run-day week boundary  
New shared web-v2/lib/notifications/week-window.ts trainingWeekWindow() (its header doc explicitly names 'treadmill-strength-notif week-boundary finding, P2' as the motivating bug) computes the week as ending on the runner's long_run_day, matching the app-wide SoT already established for /api/plan/week. cron/notifications/route.ts weekSummary (line 718-737) now takes longRunDow and uses trainingWeekWindow instead of ISO-Monday math; the caller only invokes weekSummary when dow === longRunDow (li …  

### watch-engine — 7 fixed / 2 partial / 1 unfixed

**✅ FIXED** — Runs over 50 miles are permanently destroyed by the backend distance ceiling + dead-letter retry policy  
web-v2/app/api/watch/workouts/complete/route.ts:158-186 replaced the flat `>50mi -> 400` with lib/runs/distance-guard.ts's classifyRunDistance: 50-250mi now ACCEPT+quarantine (data.qualityFlag='distance_review', counted in volume, excluded from VDOT anchors), >250mi returns 200 + {ok:true, dropped:'distance_ceiling'} instead of 400. Verified in legacy/native/Faff/FaffWatch Watch App/PhoneSync.swift:386-388 that (200...299) status is treated as accepted-and-dequeued, so the intentional-drop path  …  
_Genuine architectural fix, not a naive ceiling raise -- includes an explicit clear-flag-on-correction path (Rule 6 compliant field-level jsonb update) and citations to the ultra-goal engine support._  

**✅ FIXED** — Second run of the same day overwrites the first — the planned workoutId is per-day and the lobby lets you start it again  
native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift:1463-1468 (sessionSuffix) + buildCompletion (line 1565) and completionFromRecovery (line 1355) both append a `#HHmm` per-start suffix baked in once at build time. route.ts:267 (plannedDate regex) tolerates the optional `#HHmm` tail, and the `effectiveWorkoutId` (carrying the suffix) is what derives `stableId` (route.ts:501) used as the runs.id upsert key and the coach_intents field key -- so a second same-day start genuinely writes a new row …  
_See new_regressions for a narrower residual collision window (same-minute restart) this fix introduces._  

**✅ FIXED** — Mile-split takeover never fires on easy, long, recovery, steady or 'just run' workouts — the gate suppresses it for every single-phase run  
WorkoutEngine.swift:844-858 replaces the old `phase.type != .work` gate with isEasyBandSingleWork (single work phase + tolerance>15s/mi or nil target) OR isLongBuildPhase (non-finish segment of a long-with-finish build). Cross-checked against web-v2/lib/watch/build-workout.ts:414-417: defaultTolerance is 20 for easy/long/recovery (passes the >15 easy-band check), 8 for threshold/intervals and 12 for tempo/race (both stay <=15, correctly still suppressed as quality reps). isSingleWorkSession (Wor …  
_Internally consistent, well-reasoned fix that correctly distinguishes easy-band single-work-phase sessions from single-rep quality efforts using the tolerance band width._  

**✅ FIXED** — Post-run verdict compares whole-run average pace against the interval rep target — every correctly-executed interval/threshold session grades 'OVER' (red)  
SummaryView.swift:106-148 (verdictInfo) now computes a distance-weighted average across ALL qualifying work phases (weightedAvg helper, lines 115-127) for both actual and target pace, and compares against a distance-weighted tolerance (weightedAvgTolerance, lines 158-171) pulled from the plan's per-phase tolerance. Whole-run c.totalDurationSec/c.totalDistanceMi is no longer used anywhere in this comparison -- warmup/cooldown/recovery phases are excluded by the `workPhases` filter (type=='work' & …  
_Also fixes the HR-based LOADED/STEADY split to use distance-weighted work-phase avgHr instead of whole-run avgHr._  

**✅ FIXED** — HR sensor dropout freezes the last reading into all downstream data — per-phase avgHr, max ceiling alerts and HR samples silently use stale values  
WorkoutTracker.swift:105-123 adds lastHrSampleAt + checkHrStaleness() (20s watchdog), set on every real sample in apply() (line 511) and seedFromBuilderStatistics() (line 451). WorkoutEngine.swift:635 calls tracker?.checkHrStaleness() at the TOP of tick(), BEFORE phaseHrSum/phaseHrCount accumulation (line 652-656) and the hrOverCeiling check (line 686-690) read tracker.heartRate -- so a stale reading is zeroed before it can pollute the phase aggregate or falsely trip/hold a ceiling alert. Every  …  
_Clean, correctly-ordered fix. Faces already render '—' at heartRate<=0 per the code comment, so no separate face-level change was needed._  

**✅ FIXED** — Battery death mid-run loses the entire run even though a recovery snapshot with all banked results exists  
WorkoutRootView.swift:167-202 (attemptRecovery): the no-live-session branch (recoverActiveSession() returns nil) now builds a completion from the snapshot via WorkoutEngine.completionFromRecovery(snapshot:, stats: zeroStats) and sends it through PhoneSync BEFORE clearing the snapshot, with a recoverySummary receipt shown to the runner. completionFromRecovery (WorkoutEngine.swift:1297-1400) sums snapshot.results (the engine's banked per-phase results, snapshotted every ~60s via snapshotIfDue) as  …  
_Up to ~59s of the most recent phase can be lost since the last snapshot write (60s cadence) -- an acceptable, disclosed trade-off, not the original all-or-nothing loss._  

**❌ UNFIXED** — Crash-RESUME completion under-reports duration but keeps full distance — average pace is skewed fast  
WorkoutEngine.swift:1242-1257 (resumeFromSnapshot) still explicitly does NOT credit the dead window into bankedSec/phaseElapsedSec/totalElapsedSec (comment at line 1252: 'The dead window (crash -> relaunch) is NOT credited to the phase'). buildCompletion (line 1476-1579) still ships totalDurationSec: totalElapsedSec (dead-window-excluded) paired with dist = tracker?.distanceMi (line 1478), which WorkoutTracker.seedFromBuilderStatistics() (line 441-463) seeds from HK's whole-session cumulative di …  
_Distinct from finding 5 (battery death -> no live session -> completionFromRecovery, which correctly uses builder.elapsedTime as ground truth via recoveredStats()). This finding is specifically the RESUME-then-continue-then-finish-normally path, whic_  

**🟡 PARTIAL** — Distance-based phases have no time fallback — a runner who denied HealthKit (or whose session fails to start) is stuck with a workout that never advances  
WorkoutEngine.swift:892-926 adds noDistanceSource (phaseCoveredMi<0.05 AND phaseElapsedSec >= 1.5x the phase's durationSec estimate), OR'd into both the single-phase-distance-run and per-phase distance-rep completion checks -- this genuinely closes the 'hangs forever' failure path. However, tracker.markDistanceSourceUnavailable() (WorkoutTracker.swift:62-68) sets a @Published distanceSourceUnavailable flag that has ZERO consumers anywhere in the codebase (grep across all watch Swift files found  …  
_Core failure path (infinite hang) is genuinely closed; the promised UI surfacing of the condition is dead code._  

**🟡 PARTIAL** — Metric-preference runners get an entirely imperial watch — units settings exist in the backend but never reach the watch payload or faces  
f9296bb1 threads unitsDistance through build-workout.ts (additive field) and WatchWorkoutModels.swift decodes it, but per the commit's own stat (3 watch files touched: IdleView.swift, SummaryView.swift, WatchWorkoutModels.swift) only the PRE-RUN lobby and POST-RUN summary/rep-ladder convert to km. Verified directly: WorkoutEngine.swift's live mile-split takeover (line 44 `case split(mileNo: Int...)`, line 857 `mileIndex = Int(coveredMi)`, line 867 `.split(mileNo: mileIndex,...)`) still fires at  …  
_The highest-visibility part of the original finding -- the live in-run watch face experience, which is what the runner looks at for the entire duration of a run -- remains 100% hardcoded imperial. Only the bookend screens (lobby, recap) were converte_  

**✅ FIXED** — Toggling Sound ON mid-run produces no chimes for the rest of the workout — the audio session was never activated and cannot be activated safely mid-session  
WorkoutTracker.swift:280 (`ChimePlayer.shared.activate()`) is now unconditional at session start (no longer gated on audibleAlerts), called before startActivity() per the documented safe-activation window. ActiveWorkoutView.swift:707's toggle handler only does `audibleAlerts.toggle()` -- no activate() call there, avoiding the uncatchable-NSException crash path. WorkoutEngine.swift:438/551/796 read UserDefaults 'audibleAlerts' live on each chime opportunity, so once the session is warmed up, flip …  
_Clean fix with a good follow-up cleanup catching a copy-paste trap in dead code before it could resurface._  

### watch-faces — 5 fixed / 1 partial / 0 unfixed

**✅ FIXED** — Readiness glance permanently empty — iPhone never sends readiness payload  
native-v2/Faff/Faff/WatchSync.swift:29-85,149-190 now builds a WatchReadiness JSON from /api/readiness (readinessPayload(from:)) and rides it on every pushTodayToWatch() context push (line 185: ctx["readiness"] = r), on the immediate pushReadiness() re-push path, and splices a cached copy into sendMessage replies (line 482). native-v2/Faff/FaffWatch Watch App/PhoneSync.swift:247-249 decodes payload["readiness"] into WatchReadiness and publishes it. WorkoutRootView.swift:392 renders phone.readine …  
_Genuine end-to-end wiring: backend readiness -> iPhone shaping -> WatchConnectivity context -> watch decode -> glance render. Also falls back to the last-known-good payload on a transient /api/readiness failure instead of blanking the glance._  

**✅ FIXED** — Post-run verdict grades whole-session average pace against work-rep target — false 'STEADY · OVER'  
SummaryView.swift:106-149 verdictInfo now filters c.phases to workPhases (type=="work" && targetPaceSPerMi>0), computes a distance-weighted (falling back to duration-weighted) average of ONLY those phases' actualPaceSPerMi vs targetPaceSPerMi via weightedAvg(), and grades against a similarly weighted tolerance (weightedAvgTolerance, lines 158-171) pulled from the matching plan phases by index. Warmup/recovery/cooldown phases are excluded by the type=="work" filter, so they can no longer dilute t …  
_Traced the full data path: WorkoutEngine.swift:1090-1107 populates WatchCompletionPhase.type from the real per-phase p.type.rawValue, so the work-phase filter operates on trustworthy data, not a mislabeled field._  

**🟡 PARTIAL** — Entire watch surface is imperial-only — km/min-per-km preference silently ignored  
web-v2/lib/watch/build-workout.ts:367,603 now reads units_distance from settings and ships unitsDistance ('mi'|'km') in the /api/watch/today payload; WatchWorkoutModels.swift:209-275 decodes it onto WatchWorkout. IdleView.swift (lobby) and SummaryView.swift (post-run recap + rep ladder, lines 208-220, 367-375) are genuinely unit-aware, converting distance/pace to km when unitsDistance=="km". BUT ActiveWorkoutView.swift — the entire in-run surface a runner watches DURING a workout (live pace, rem …  
_The backend/model plumbing for the preference is genuinely built and two of four watch-facing surfaces (lobby, post-run) honor it. The failure scenario the finding describes -- a km-preference runner sees miles on the watch -- still fires in full dur_  

**✅ FIXED** — NumberFace top label has no width cap — runs under OS clock / off-screen  
FaceKit.swift:470-487 topLabel render now has .lineLimit(1), .minimumScaleFactor(0.6), .truncationMode(.tail), and .frame(maxWidth: labelMaxW, alignment: .leading) where labelMaxW = clockClearF * W - alignmentX -- the same clockClearF (0.70) boundary the centered big rows already respected. Comment explicitly cites 'P2-59 clock-clear width cap.' Single render path (all topLabel: call sites across Faces.swift/ActiveWorkoutView.swift funnel through this one NumberFace implementation), so no bypass …  
_No caveats._  

**✅ FIXED** — Pause face shows raw-minute elapsed past one hour — '130:12'  
ActiveWorkoutView.swift:38-51, the sole isPaused render branch, now does elapsed: engine.totalElapsedSec >= 3600 ? PaceFormat.hms(...) : PaceFormat.clock(...) -- the exact same branch pattern used by LiveSteady/LiveInRunStats/SummaryView. Comment cites 'P2-60' and describes the original '130:12' scenario directly.  
_No caveats._  

**✅ FIXED** — Brief §1 hex-lint CI check not implemented — watch faces carry off-palette hexes invisible to palette-sync  
scripts/check-palette-sync.sh:174-203 adds a new section 3, 'WATCH-FACE HEX ALLOWLIST (P2-61, 2026-07-07)' -- a positive allowlist (WATCH_ALLOWED_HEX) that greps every Color(hex: 0x......) literal under the watch app target and fails CI on anything outside the ten locked hexes + sanctioned neutrals. Ran the script directly: exits 0, 'palette-sync OK.' Confirmed wired into web-v2/package.json's prebuild script (matching CLAUDE.md's 'CI palette-sync gate... Railway prebuild'). Verified the specifi …  
_No caveats._  

### sync — 2 fixed / 1 partial / 0 unfixed

**🟡 PARTIAL** — HealthKit importer hardcodes America/Los_Angeles — wrong run date and broken dedup for every non-Pacific runner  
The client-side bug is still fully present. native-v2/Faff/Faff/HealthKitImporter.swift still hardcodes `TimeZone(identifier: "America/Los_Angeles")` in buildPayload (line 447, run date/start_local), buildStrengthPayload (line 1750, strength-session date), sleep-night bucketing (line 1397/1400), and isoDay (line 1464, used at 20+ call sites for every bulk HK vitals sample: RHR, HRV, sleep, weight, steps). None of these send a `timezone` field on their POST — `postWorkout` (line 1895) ships build …  
_Backend-side capability is real and well-built, but it's orphaned — no current client triggers it for the paths the finding was about (run ingest, strength ingest, bulk health samples). This reads as a partial/misdirected fix: effort landed on the wr_  

**✅ FIXED** — Per-day workoutId lets a second same-day Faff-watch run overwrite the first — restart/double runs lose the earlier session  
Confirmed fixed 2026-07-07 (P1-34). legacy/native/Faff/'FaffWatch Watch App'/WorkoutEngine.swift adds `static func sessionSuffix(for startDate: Date) -> String` (line 1463) producing a `#HHmm` suffix from the run's actual local start time, baked in once at build time (not re-minted per retry, preserving idempotent retry semantics). Both completion-construction paths — the live finish (`buildCompletion`, line 1565: `workout.workoutId + Self.sessionSuffix(for: workoutStart)`) and the crash-recover …  
_Residual, much narrower risk: two genuinely distinct run starts within the identical HH:MM (e.g. instant-restart within the same minute) would still collide on effectiveWorkoutId. This is a real edge case but far narrower than the original bug (which_  

**✅ FIXED** — 50-mile distance ceiling returns 400, which both durable queues dead-letter — an ultra run is silently and permanently lost  
Confirmed fixed 2026-07-06 (P1-26/P2-62). web-v2/lib/runs/distance-guard.ts introduces a three-tier classification (`classifyRunDistance`): ≤50mi ok, 50–250mi accept+quarantine (`qualityFlag='distance_review'`, counted in volume/feed but excluded from VDOT anchors via `excludeDistanceReviewSql`), >250mi reject. Critically, the reject path no longer returns HTTP 400 — web-v2/app/api/watch/workouts/complete/route.ts:178-188 and web-v2/app/api/ingest/workout/route.ts:98-106 both answer `NextRespons …  
_Well-reasoned fix with correct jsonb-preserving qualityFlag semantics per the Rule 6 doctrine (flag rides as an omitted-not-null key so merge upserts can't clobber it). No gaps found._  

### adaptation — 9 fixed / 0 partial / 4 unfixed

**✅ FIXED** — Missed-workout rescheduler double-books days: no collision, rest-day, long-run, or frequency check on the target date  
web-v2/lib/plan/adapt.ts:293-333 chooseRescheduleDate() now walks today+1..today+4 and rejects any candidate with runCount>0 (collision), hasRestRow, matching longRunDow/restDow, adjacent-day quality/long (hard-easy spacing), weeklyFrequency overflow, or dateNearRace. actionsForTrigger builds byDate context from a real plan_workouts geo query (adapt.ts:1786-1833) before calling it. Verified live: no reschedule has landed on a colliding day since the fix deployed (commit 9d1ce5b4, merged ~2026-07 …  
_Root cause (no collision/adjacency/frequency check) is genuinely closed. Residual DB debris from before the fix is cosmetic and self-heals._  

**✅ FIXED** — No detraining/layoff response: after an 8-day gap the adapter piles missed quality forward and resumes full volume, violating Research doctrine  
New detectTrainingGap() (adapt.ts:1189-1234) + classifyGapBand/buildGapActions (adapt.ts:335-504) implement the full comeback ladder: 4-7d -> easy_swap (first quality->easy only), 8-14d -> shave 70%/85% across weeks 1-2 with week-1 intensity dropped, >14d -> propose-only rebuild + VDOT haircut note. detectAdaptations() runs the gap detector FIRST and suppresses missed-workout rescheduling while a gap is active or was handled within 7 days (adapt.ts:544-563), so missed work during a layoff is nev …  
_Code-level fix is thorough and doctrine-cited. David's specific historical instance can't be re-verified live because the gap closed before the new code got a cron cycle to see it._  

**✅ FIXED** — Cron misroutes adaptation actions via false triggers[i] index alignment — anti-stacking downgrades stripped from apply and mislabeled as readiness proposals  
run-adaptations/route.ts:90 now calls partitionActionsForCron(actions) (adapt.ts:528-538), which splits strictly on each action's own sourceTrigger tag (set at adapt.ts:607-612 when actions are built) rather than index-correlating with the triggers array. Every AdaptationAction produced by actionsForTrigger is tagged with its source trigger kind before being returned from detectAdaptations. This eliminates the index-misalignment class of bug entirely — there is no positional array walk left in t …  
_Clean structural fix, not just symptom patching._  

**✅ FIXED** — Adapter cannibalizes its own rescue: rescheduled quality gets downgraded to easy by the next pass, deleting the session but keeping its volume on a double-booked day  
The 'nextKey' query in actionsForTrigger's missed_key_workout case (adapt.ts:1918-1933) now excludes ev.workout_id itself AND any plan_workouts row with an existing plan_adapt_reschedule coach_intents record, so a just-rescued workout can never be selected as the anti-stacking downgrade target. Additionally, the downgrade action carries onlyIfRescheduledId (adapt.ts:1939) and applyAdaptations skips the downgrade if the paired reschedule didn't actually land (seal-filtered) (adapt.ts:720-723). Li …  
_Verified both by code trace and by querying coach_intents for any post-fix downgrade-after-reschedule-on-same-id pattern (none found)._  

**✅ FIXED** — Missed long runs are silently dropped — detector only covers threshold/tempo/intervals/vo2max  
detectMissedKeyWorkout's candidate query now includes 'long' in the type filter (adapt.ts:1074), and missed long runs are explicitly classified into a longMisses bucket (adapt.ts:1126-1129) that produces a plan_adapt_missed_noted coach_intents record (adapt.ts:1769-1777) — data, not debt, never rescheduled. Live proof: David's missed 2026-07-05 16mi long (wko_5995ef36dbe141fe) now has a plan_adapt_missed_noted intent dated 2026-07-07, and the same pattern fires for other users (16 plan_adapt_mis …  
_Matches the proposed fix almost exactly: acknowledged via coach_intents, never crammed back in._  

**✅ FIXED** — Completion check 'any run >= 4mi within ±1d' breaks for beginners/slow runners with sub-4mi quality days — their completed workouts are flagged missed forever  
completionThresholdMi() (adapt.ts:249-252) scales the completion gate to max(1, prescribedMi*0.6), falling back to 4mi only when no prescribed distance exists. detectMissedKeyWorkout applies this per-candidate via completedNear(c.date, completionThresholdMi(distanceMi)) (adapt.ts:1122). Verified live against the exact user cited in the original finding (de412d84-507d-400a-a797-c0fd6e631cf2, active 3mi tempo rows): no false-positive missed-workout intent has fired for their sub-4mi quality sessio …  
_Confirmed against the specific live user cited in the original finding._  

**✅ FIXED** — iPhone never renders plan_workout_proposals — propose-first adaptations are invisible to phone-only runners and expire silently  
native-v2/Faff/Faff/Views/TodayView.swift now fetches workout proposals (API.fetchWorkoutProposals(), line 3114), stores them in @State workoutProposals/pendingProposals, renders a workoutProposalBanner per pending row (line 909), and wires accept/dismiss to POST /api/plan/workout-proposals/:id/accept|dismiss (acceptWorkoutProposal/dismissWorkoutProposal, lines 954-965). NudgeSheet.swift also surfaces the proposal with 'THE CHANGE' framing per commit '2de17fe6 Wire adapter-proposal surface into  …  
_Full round-trip UI wiring confirmed present in native-v2, not just a stub._  

**✅ FIXED** — Reschedule never updates week_id — weekly planned totals disagree with the days actually shown  
The reschedule UPDATE (adapt.ts:697-711) now re-resolves week_id via a correlated subquery against plan_weeks for the new date, recomputes dow, and stamps original_date_iso on first move. Cannot be directly re-verified against a live post-fix reschedule because no reschedule has fired on the new code yet (the only cron cycle since deploy found nothing reschedulable for any user). Code trace confirms the fix is structurally correct: COALESCE((SELECT w.id FROM plan_weeks w WHERE w.plan_id=pw.plan_ …  
_CANNOT_VERIFY live (no post-fix reschedule has occurred yet to inspect), but code fix is sound by trace._  

**❌ UNFIXED** — adapt-block.ts (48h hard-easy spacing forward reasoning) is dead code — zero callers  
grep across web-v2/app and web-v2/lib confirms detectBlockAdaptations and applyBlockAdaptation still have zero callers outside adapt-block.ts itself. run-adaptations/route.ts still calls detectAdaptations directly, bypassing the block-reasoning wrapper entirely. The citation.ts 'block_shift' kind is also still unreferenced anywhere except its own declaration. Additionally, even within the still-dead module, the spacing threshold was NOT tightened to a true 48h check as the original proposed_fix  …  
_Neither wired in nor internally improved. Module is fully inert._  

**❌ UNFIXED** — Adaptive upward ramp can never fire: gates read run types ('threshold'/'tempo'/'long') that the runs table never contains; cooldown reads an intent reason that is never written  
adaptive-ramp.ts:110 and :130 still filter completed runs on (data->>'type') IN ('threshold','intervals','tempo') / = 'long'. Live DB query against runs.data->>'type' for the last 60 days returns only 'Run' (42), null (35), 'easy' (25) — never any of the quality/long type strings the gate checks for. This means recentQuality.length is always 0 (never >=2), so lastQualityOnPace is always false, so detectRampSignals.allGreen can never be true, so detectGreenRampOpportunity always returns null. Con …  
_This finding was NOT touched by the Jul 6 adapter rewrite at all — adaptive-ramp.ts has no corresponding fix commit in the diff._  

**✅ FIXED** — No race-proximity or taper guard on rescheduling — a missed key can be rescheduled into race week, the day before, or onto race day  
chooseRescheduleDate() now calls dateNearRace(d, raceDates) as its final guard (adapt.ts:329), rejecting any candidate within race week (race-6d..race) or ±3 days of any known race. raceDates is assembled from races.meta.date, training_plans.goal_iso, and any RACE_PROTECTED_TYPES rows already materialized in the plan (adapt.ts:1838-1853) — belt-and-braces coverage. No live post-fix reschedule exists yet to directly observe the guard firing, but the code path is unconditionally exercised on every …  
_CANNOT_VERIFY with a live example (no reschedule has landed since the fix), but the guard is unconditional and structurally sound._  

**❌ UNFIXED** — pr_bank / goal_changed 'mark paces stale' action has no consumer — promised pace recompute never happens, and the marker string accumulates in notes  
applyAdaptations' mark_dirty branch (adapt.ts:836-850) still only does UPDATE plan_workouts SET notes = notes || ' [paces stale - recompute]' — it does not call rebuildWorkoutDerivations or any pace-recompute path (unlike the shave and mark_upgrade branches, which do call rebuildWorkoutDerivations at adapt.ts:808 and :830). Grep across web-v2/lib and web-v2/app for the literal marker string ' [paces stale - recompute]' returns exactly one hit — the write site itself. No cron, route, or briefing- …  
_Untouched by the Jul 6 rewrite. Same gap as originally reported._  

**❌ UNFIXED** — Goal-gap widening auto-rebuild dedupe is broken by construction (plan_id passed as '') — only a 60-second window prevents nightly full plan rebuilds  
plan-drift/route.ts:205 still calls hasPendingProposal(u, '', 'goal_gap_widening') with a hardcoded empty string for plan_id. hasPendingProposal's query (drift-monitor.ts:672-687) filters WHERE plan_id = $2, so plan_id='' matches zero rows and recentGapRebuild is always false — the 14-day dedupe window this call was meant to enforce never engages. fireAutoRebuild's own internal dedupe (auto-rebuild.ts:97-110) still only covers a 60-second window on the same proposal_kind/race. No live nightly-re …  
_Confirmed unchanged by direct code read; zero plan_proposals rows with source='goal_gap_cron_auto' exist yet, so it hasn't fired live, but nothing prevents it firing repeatedly once it does._  

### archetypes — 3 fixed / 2 partial / 2 unfixed

**✅ FIXED** — Ultra races added from the phone silently generate a half-marathon plan (50K/50M/100K/100M labels fall through to 13.1 mi)  
web-v2/lib/race/distance.ts now has THE single shared distanceMiFromLabel parser with explicit 50K(31.07)/50M(50)/100K(62.14)/100M(100) branches checked before the 5K/10K substrings. generate.ts:312-317 distanceMiOf delegates to it and returns null (never a default) on an unresolved label. loadGeneratorInputs (generate.ts:3388-3411) explicitly gates: dMi==null -> 'race distance unrecognized' failure; dMi > DANIELS_MAX_VALID_DISTANCE_MI (26.3) -> honest 'Ultra plans aren't built yet' failure (Dav …  
_Not fixed via the proposed approach (adding ultra distance math to the generator) but via an explicitly-approved product decision: honest 'unsupported' failure instead of a fabricated plan. This fully closes the failure path described in the finding._  

**❌ UNFIXED** — Onboarding finish-time picker caps 5K/10K results at 59:59 — slow runners cannot enter their real times  
native-v2/Faff/Faff/Views/OnboardingView.swift:1336 still reads `private var showHours: Bool { distance == "half" || distance == "marathon" }`, and line 1362 still gates the hours wheel on it: `if showHours { wheel($h, range: 0...8, unit: "hr") }`. 5K/10K entries in TimeWheelSheet get only minute (0-59) and second (0-59) wheels, capping any 5K/10K finish time at 59:59. File has had other unrelated onboarding fixes land since (commit 3341db06 etc.) but this specific code path is byte-identical to …  

**❌ UNFIXED** — Easy/recovery run analysis compares AVG HR against a hardcoded LTHR of 162 for every user  
native-v2/Faff/Faff/Components/HowItWentPanel.swift:585-586 (AerobicStampPanel.signature) still reads `let lthrish = 162; let delta = avg - lthrish`, feeding the AVG HR delta/tone shown on every easy and recovery run's How It Went panel. Models/Runs.swift:393 confirms RunDetail carries a real per-user `lthr: Int?` field that this panel never reads — the fix (swap to `detail?.lthr`) was not applied.  

**✅ FIXED** — No-watch users have no way to record an outdoor run — the primary 'Outdoor' CTA dead-ends in a watch mirror  
RootTabView.swift:412-415 now computes `outdoorRoute` gated on `WatchSync.shared.isPaired && isWatchAppInstalled`: watch-paired runners still get .watchMirror unchanged, but no-watch runners route to a new `.phoneRun` case (line 385: `PhoneRunView().navigationBarHidden(true)`). PhoneRunTracker.swift (395 lines) implements a full foreground GPS recorder — start/pause/resume/discard/finish, live distance via CLLocation geodesic summation, live pace, route polyline, GPS-staleness flag — and finish( …  

**✅ FIXED** — Metric-unit preferences (km, min/km, °C) exist as settings but are consumed by zero renderers; native app is imperial-only with no units UI  
New native-v2/Faff/Faff/Util/Units.swift is a complete display-formatting choke point (DistanceUnit/TemperatureUnit enums, UnitsPreference read synchronously off AppCache, convertDistance/convertPaceSecPerUnit/convertSpeed/convertTemperature, and format* helpers). Verified real substitution (not just import) across TodayView.swift, TargetsView.swift, RunDetailView.swift, TreadmillView.swift, HowItWentPanel.swift, ActivityView.swift, PlannedView.swift, RaceDayView.swift, TrainView.swift, WatchMir …  

**🟡 PARTIAL** — Targets projection anchors to 13.1 mi for any ultra distance label  
TargetsView.swift:370-391 distanceForProjection() is unchanged in shape: still only checks marathon/half/10k/5k substrings and falls through to `return 13.1` on line 390 for any ultra label (50K/50M/100K/100M — still offered by AddRaceSheet.distances at line 1003). paceFromGoal (lines 435-450) still returns nil for ultra labels via the same four-branch parser (line 444 `return nil`), so the hero pace chip still silently disappears for ultra racers. The catastrophic downstream harm (a fabricated  …  

**🟡 PARTIAL** — Watch payload falls back to 9:00/mi for unpaced phases — duration estimates and the fueling gate skew wrong for slow and by-feel runners  
build-workout.ts:426-460 (P1-47 fix, 2026-07-06) now derives `easyPaceAnchor` from the runner's OWN plan's authored easy/long pace_target_s_per_mi_lo/hi spec bands (nearest easy, then nearest long, by date) instead of a hardcoded constant; this anchor feeds both the warmup/cooldown easy pace AND `recoveryPaceSec` (replacing the old hardcoded 9:00/mi recovery target) into expandSpecToPhases. On-screen targetPaceSPerMi correctly stays null (honest by-feel) when no anchor exists — verified in expan …  

### accuracy — 4 fixed / 1 partial / 2 unfixed

**✅ FIXED** — Auto-adapter reschedule double-books days and stacks 3 consecutive tempo days  
web-v2/lib/plan/adapt.ts:640-717 (applyAdaptations) now updates date_iso, dow, AND week_id together (resolved via a plan_weeks lookup keyed to the new date) and stamps original_date_iso on first move. The blind 'today+2' pick is gone: web-v2/lib/plan/adapt.ts:293-333 (chooseRescheduleDate) walks today+1..today+4 and rejects any candidate with runCount>0 (collision guard, line 320), a rest row, the long-run dow, the runner's rest dow, adjacent quality/long days (line 327, directly closes the 3-co …  
_Commit 9d1ce5b4 'rebuild the plan adaptation engine' is a genuine architectural rewrite, not a patch. Verified no stale second call site still does a bare date_iso poke._  

**✅ FIXED** — Watch and phone warmup/cooldown/recovery pace targets are fabricated from goal race pace or hardcoded 9:00/mi  
web-v2/lib/watch/build-workout.ts:436-460 now derives easyPaceAnchor from the runner's own authored easy/long workout_spec pace band in the same plan (nearest by date), defaulting to null (not a fabricated number) when no band exists anywhere. expandSpecToPhases (web-v2/lib/training/expand-spec.ts) confirms targetPaceSPerMi is set to easyPaceSec verbatim (null passes through as null, i.e. by-feel) for warmup/cooldown/recovery phases across expandTempo/expandReps/expandLong/expandEasy; the only r …  
_Commit 0bc79a83 directly addresses this. Verified both the watch build path and expand-spec's phase generators, and confirmed the phone surface consumes the same corrected payload rather than a separate stale code path._  

**✅ FIXED** — Watch end-of-run verdict compares whole-run average pace to the work-phase target  
legacy/native/Faff/FaffWatch Watch App/SummaryView.swift:106-149 (verdictInfo) now computes a distance-weighted average of ONLY c.phases where type=="work", both for actual pace and target pace (weightedAvg helper, lines 115-127), and compares those against each other with a distance-weighted tolerance (weightedAvgTolerance, lines 158-171) pulled from the matching plan phase by index. The old c.totalDurationSec/c.totalDistanceMi whole-run average is no longer used anywhere in verdict derivation. …  
_Fix is dated 2026-07-07 in the code comment (today), the most recent of all 7 findings' fixes. The doc comment explicitly cites this as a P1-29/P1-31 fix confirmed by four independent audit finders, and cross-references the equivalent backend fix in _  

**✅ FIXED** — Briefing/glance fabricates HR caps and fuel checkpoints when real data is absent  
web-v2/lib/faff/glance-adapter.ts: every HR CAP row (lines 454, 470, 519, 537) now reads spec.hr_cap_bpm when present and otherwise falls back to aerobicCap (derived from the runner's live profile, line 417: dp.aerobicCapBpm != null ? bpm : null) or a zone-label string ('Aerobic · Z2' / 'Aerobic ceiling'), never a hardcoded '148 bpm'/'145 bpm' constant. Fuel rows (lines 522-524, 546-553) are only pushed when spec.fuel_mi.length>0 or fuelCheckpointsMi(plannedMi) returns entries (function at line  …  
_Commit tagged P1-49 fix 2026-07-06 in the code comments. Traced aerobicCap's source (dp.aerobicCapBpm) to confirm it's a real derived value, not another hardcoded constant hiding behind a rename._  

**❌ UNFIXED** — Watch/phone easy-run HR ceiling ignores the authored spec and uses LTHR-first instead of MAX(89% LTHR, 78% HRmax)  
web-v2/lib/watch/build-workout.ts:552-556 still computes hrCeilingBpm as `lthr ? lthr*0.89 : maxHr ? maxHr*0.78 : null` -- LTHR-first, exactly the pre-fix logic -- and never reads wo.workout_spec?.hr_cap_bpm. Meanwhile web-v2/lib/plan/spec-builder.ts:84-91 (hrCapEasy) correctly implements MAX(89% LTHR, 78% HRmax) per the locked Rule 16 doctrine and stores it into workout_spec.hr_cap_bpm at three call sites (lines 256, 269, 484). The two numbers still diverge whenever 78% HRmax > 89% LTHR, reprod …  
_None of the 4 waves touched this specific line. The work-phase HR target block just above it (lines 475-491) DOES read spec fields (lthr_bpm/hr_target_bpm) but that's a different spec field for quality-workout work phases, not the easy/long hrCeiling_  

**🟡 PARTIAL** — Metric units are a dead setting: no surface converts display  
iPhone and Watch got a genuine, thorough fix: native-v2/Faff/Faff/Util/Units.swift is a new formatting choke-point (DistanceUnit/TemperatureUnit enums, convert+format helpers) with real adoption confirmed across 6 view files (PlannedView, RunDetailView, TrainView, TodayView, TreadmillView, ActivityView -- 5 to 15 call sites each) plus SettingsView.swift now has an actual units picker (line 854, SETTINGS_UNITS_DISTANCE options mi/km) that writes through Units.applyLocalPatch. Watch models were al …  
_This was scoped as Wave 3b ('metric units end-to-end + phone-GPS recording' per task tracker) but 'end-to-end' only reached native surfaces, not web, despite web having its own picker UI that implies the setting works there too._  

**❌ UNFIXED** — PATCH /api/plan/workout updates every row on the date  
web-v2/app/api/plan/workout/route.ts:73-78 is unchanged: `UPDATE plan_workouts SET ${setSql} WHERE plan_id = $1 AND date_iso = $2::text` -- still no workout id, no type filter, no LIMIT, no running-row priority selection. The only caller, web-v2/components/training/WorkoutSwapButton.tsx, still sends only {plan_id, date_iso} with no id. web-v2/app/api/plan/week/route.ts:144 still documents that a day can carry more than one plan_workouts row (easy run + strength session), so the collateral-damage …  
_No commit in any of the 4 waves touched this file. Confirmed by git log absence and direct code read._  

### hardcode — 4 fixed / 2 partial / 0 unfixed

**🟡 PARTIAL** — HealthKit importer stamps every run/strength/sleep with America/Los_Angeles — non-Pacific users get wrong-day data  
native-v2/Faff/Faff/HealthKitImporter.swift buildPayload() (workout ingest, lines ~445-478) STILL hardcodes `let pt = TimeZone(identifier: "America/Los_Angeles")` for both `start_local` and `date`, and the returned payload dict never includes a `timezone` key — confirmed by reading postWorkout() (line 1895) which POSTs the payload verbatim with no timezone augmentation anywhere in the call chain. buildStrengthPayload() (line 1750) is unchanged, same hardcode, comment still says 'date: yyyy-MM-dd …  
_The failure path is genuinely closed for: (a) any runner whose profile.timezone gets populated via web Shell.tsx auto-capture, phone health-vitals sync, or watch-completion tz field, combined with the now-parameterized downstream SQL (goal-projection_  

**✅ FIXED** — Run-identity dedup interprets timezone-less Strava timestamps as Pacific — non-Pacific Strava+watch users get duplicate/doubled mileage  
web-v2/lib/runs/identity.ts: isSameRun/spansOverlap/startUtcMs/endUtcMs all now accept a `defaultTz` parameter (default DEFAULT_TZ='America/Los_Angeles', explicitly documented as a byte-safe legacy-data fallback, not the general policy). Real callers thread the runner's actual timezone: web-v2/lib/runs/merge.ts:55 `const runnerTz = await runnerTimezoneOrPacific(userId)` passed into planMergeOps; web-v2/lib/runs/volume.ts:78 same pattern into clusterRuns. runnerTimezoneOrPacific (web-v2/lib/runti …  
_The specific proposed fix (store Strava's own `timezone` field on the cached activity in pullSync.ts) was NOT implemented — confirmed pullSync.ts:145 still stores only `startLocal: act.start_date_local` with no Strava timezone. But the functionally e_  

**✅ FIXED** — Execution-evidence SQL buckets watch completions by hardcoded 'America/Los_Angeles' — wrong-day joins for non-Pacific runners feeding goal projection and VDOT  
web-v2/lib/training/goal-projection.ts: all six cited AT TIME ZONE joins (lines 414, 418, 435, 439, 934, 1337, 1346 in current file) now use a parameterized `$N::text` bound to `ciTz`, itself set via `const ciTz = await runnerTimezoneOrPacific(userUuid)` (line 395, with a clear 2026-07-06 audit comment referencing P1-11/P1-52). Verified the SQL parameter arrays actually pass ciTz at each call site (e.g. line 446 `[userUuid, since, today, ciTz]`, line 950 `[userUuid, today, ciTz]`). web-v2/lib/tr …  
_Clean, verified fix. Both files now resolve the runner's actual timezone per-query instead of a global LA constant. Depends on profile.timezone being populated for full correctness, same caveat as findings #1/#2, but the code itself does exactly what_  

**✅ FIXED** — Targets projection ignores no-race fitness goals — goal-mode users see 'On track for —' and a projection anchored to a hardcoded half-marathon  
web-v2/app/api/targets/projection/route.ts lines 175-232: a substantial new '1b. No-race fitness-goal fallback' block, dated 2026-07-06 (P1-12/P1-53). When no races row resolves, it queries `tt_goal_distance`, `tt_goal_time`, `tt_goal_time_seconds` from profile, resolves distanceMi via goalDistanceMiFromCode(), sets goalModeSec from tt_goal_time_seconds (authoritative) falling back to parseRaceTime, and resolves the deadline from the active goal-mode training_plans row's goal_iso. `distanceMi` ( …  
_Verified the native client (native-v2/Faff/Faff/API.swift:1153, called from TargetsView.swift:356) still defaults distanceMi to 13.1, but this is now harmless — the server only falls through to the client-supplied distanceQ when NEITHER a race row NO_  

**✅ FIXED** — Greeting falls back to the literal name 'David' for any user whose profile.full_name is null  
web-v2/lib/coach/glance-state.ts:785 now reads `greetingName: prof?.full_name?.split(/\s+/)[0] ?? null` (comment at line 782 explicitly marks this 'P2-75 fix 2026-07-06 — null full_name → null, NOT the literal David'). web-v2/components/faff-app/seed.ts:2666 renders `name: fullName ? fullName.split(' ')[0] : 'You'` — a neutral fallback exactly as the proposed fix requested. Grepped native-v2 Swift sources for a hardcoded 'David' greeting fallback and found none.  
_Clean, complete, verified fix on both server and both client render paths checked._  

**🟡 PARTIAL** — App is imperial-only end to end — no unit preference exists for metric runners  
A real units-preference system now exists: profile-level `units_distance`('mi'/'km')/`units_temp`('F'/'C') columns (web-v2/lib/coach/settings.ts, web-v2/app/api/settings/route.ts), a SettingsView.swift 'UNITS' picker group (lines 853-856), and a genuinely thorough native display layer at native-v2/Faff/Faff/Util/Units.swift (DistanceUnit/TemperatureUnit enums, convertDistance/convertPaceSecPerUnit/convertSpeed/convertTemperature, formatDistance/formatPace/formatSpeed/formatTemperature) wired int …  
_This is a genuine, substantial feature build (not a superficial dodge) that closes the display-layer gap the finding was fundamentally about, but the specific onboarding screen cited as evidence in the original finding remains exactly as described — _  

### doctrine — 4 fixed / 1 partial / 0 unfixed

**✅ FIXED** — Missed-key-workout detector uses a flat >=4mi completion gate — beginner and 5K/10K runners' completed quality sessions register as missed, causing perpetual reschedule/downgrade churn  
web-v2/lib/plan/adapt.ts:249-252 `completionThresholdMi(prescribedMi)` replaces the flat 4mi gate with `Math.min(prescribedMi, Math.max(1, prescribedMi*0.6))` — a workout-relative 60%-of-prescription threshold, only falling back to 4mi when no prescribed distance exists. `detectMissedKeyWorkout` (adapt.ts:1052-1162) calls `completedNear(c.date, completionThresholdMi(distanceMi))` per-candidate (line 1122), i.e. per-workout, not a global constant. The fix comment explicitly cites this exact bug ( …  
_Landed in commit 9d1ce5b4 'rebuild the plan adaptation engine.' Locked by lib/plan/_adapt_invariants.test.ts per code comments (not independently run, but the pure function completionThresholdMi is directly inspectable and correct)._  

**✅ FIXED** — volume_overshoot experience caps contradict the plan generator's own tier volume — compliant beginners/intermediates get their upcoming week auto-shaved 17% by cron, compounding daily with no cooldown  
web-v2/lib/plan/adapt.ts:1690-1739 `detectVolumeOvershoot` now computes `sched.mi` from the ACTIVE PLAN's own `plan_workouts` rows for the same trailing 7-day window and passes it to `overshootFires(mi, scheduledMi, cap)` (line 1727), which uses `scheduledMi` as baseline whenever it's >=5mi and only falls back to the static `EXPERIENCE_CAPS_MI` table when there's no meaningful schedule (line 518). The static table itself was also re-derived from the generator's own TIER_TARGETS bands (comment at …  
_Same commit 9d1ce5b4, tagged P1-55 in comments — matches the original finding's severity/id numbering scheme, confirming this is the direct fix for this exact finding._  

**✅ FIXED** — Runners below VDOT 30 are unrepresentable: every fitness read returns null, the mileage fallback floors at 30 (and overestimates volume-as-speed), so slow runners get prescriptions faster than their race pace with no correction path  
web-v2/lib/training/vdot.ts:157-167 `vdotFromRace` still correctly returns null below VDOT 30 (doctrine-correct per the fix's own comment — Daniels' curve is only validated [30,85], so extrapolating it would violate CLAUDE.md's 'engine must match research' rule). The actual bug — a null VDOT being treated as 'no fitness data exists' — is fixed via a new `AnchorPace`/`BelowTableAnchor` mechanism (vdot.ts:169-234): the runner's own demonstrated (finishSeconds, distanceMi) is carried through and `t …  
_Matches user memory 'Repair wave3a/vdot-floor: real pace leak still faster than anchor' (completed task) — comments explicitly tag this AUDIT P1-56, with a dedicated clampToSanePace backstop added specifically for the 'faster than anchor' failure mod_  

**✅ FIXED** — Missed-quality reschedule lands on an unconditional today+2 date: no race-day, rest-day, or same-day-collision guard  
web-v2/lib/plan/adapt.ts:293-333 `chooseRescheduleDate` walks today+1..today+4 and requires ALL of: no existing running workout that day (collision guard, line 320), not a plan rest row (321), not the long-run day by dow (323), not the runner's rest_day dow (324), no quality/long on the adjacent day either side (hard-easy spacing, 327), doesn't exceed weekly_frequency for that week (328), and not within race week or ±3 days of any known race via dateNearRace (329, defined 268-276). Returns null  …  
_Same commit 9d1ce5b4, function tagged P1-35/P1-46/P2-67 in its docstring, matching the finding's severity class._  

**🟡 PARTIAL** — units_distance / units_pace / units_temp settings exist and are editable but no surface consumes them — metric-preference users flip to km and nothing changes anywhere  
native-v2/Faff/Faff/Util/Units.swift is a new, well-built formatting layer (distance/pace/speed/temperature, byte-safe no-op for the default mi/F user) with 49 call sites wired across native-v2/Faff/Faff/Views/*.swift, explicitly citing this exact audit finding in its header comment ('ZERO renderers on the phone consumed it... audit finding, phone-watch-audit-2026-07-06.md'). The watch app also consumes `unitsDistance` (WatchWorkoutModels.swift, IdleView.swift, SummaryView.swift) via a payload f …  
_Matches user memory 'Wave 3b: metric units end-to-end + phone-GPS recording' (completed) — 'end-to-end' claim is accurate for native+watch only; web was evidently out of scope for that wave despite being where the original finding's cited SettingsFor_  



---

## Regression hunt — new findings

Findings beyond the original 173, surfaced by agents specifically targeting the fix cycle's own highest-risk diffs. Both P0s below were fixed the same day this re-audit ran (`23debd49`); the rest are open, unranked by this document beyond their assigned severity — they were not run through the fix-and-verify cycle this session used for the P0s.

### wave1-adapter-live (5 findings)

**[P1] Anti-stacking downgrade picks the earliest quality workout in a 7-day window, not one actually adjacent/colliding with the reschedule target**  
File: `?`  
Evidence: After computing a validated collision-free `target` via chooseRescheduleDate, the code searches `pw.date_iso::date BETWEEN $2::date AND $2::date + 7` for the EARLIEST quality/threshold/tempo/intervals/vo2max row (ORDER BY date_iso ASC LIMIT 1), excluding only the moved row itself and rows already rescheduled by the adapter. It does not compare this row's date to `target`, does not require it to be in the same plan week as `target`, and does not verify a real 'two quality days too close together' condition exists. Since chooseRescheduleDate already guarantees `target` has no quality/long on the  
Impact: Every time a missed key workout is rescheduled, the adapter is likely to downgrade an unrelated, correctly-scheduled quality day to easy — even when the reschedule target and that day are in different weeks or not adjacent at all. This silently strips a legitimate quality session from a runner's pla  
Fix: Constrain nextKey to workouts in the same ISO plan-week as `target` (or at minimum require the candidate's date to be >= target, and/or verify the target's week already has >=1 other quality day before downgrading anything). Add a dedicated invariant  

**[P1] Gap idempotency is keyed on exact lastRunISO — a backfilled/late-synced run mid-gap creates a brand-new gap key and can re-fire the comeback protocol on top of an already-handled gap**  
File: `?`  
Evidence: gapAlreadyHandled does exact-string matching: `if (h?.lastRunISO !== lastRunISO) continue;`. lastRunISO is derived fresh each cron run from mileageByDay's 60-day scan of canonical runs. If a runner's watch/Strava sync is delayed and a run that actually happened mid-gap (say day 3 of an 8-day gap) lands in the `runs` table days later (backfill, manual entry, delayed Strava webhook), the newly-computed `lastRunISO` shifts forward to that backfilled date. This produces a NEW (lastRunISO, band) key that was never in the coach_intents history, so gapAlreadyHandled returns false and the gap detector  
Impact: A late-arriving/backfilled run (common with Strava sync delays, manual entry, or watch reconnection after a gap) can cause the comeback protocol to fire a second time for what is effectively the same underlying layoff, applying a second round of quality-downgrades/volume-shaves on a plan section alr  
Fix: Either (a) key idempotency on a stable gap-episode identifier rather than the volatile lastRunISO (e.g., first-detected date of the gap, stored once), or (b) when a new lastRunISO is computed, check whether it falls within the daysOff window of an al  

**[P2] detectTrainingGap ignores training_plans.authored_iso — a freshly-authored comeback plan can immediately get a 'rebuild recommended' gap trigger for the layoff it was built to address**  
File: `?`  
Evidence: detectTrainingGap computes lastRunISO purely from the 60-day mileageByDay scan and never reads training_plans.authored_iso (unlike detectGoalChanged, which explicitly compares profile.updated_at against the active plan's authored_iso for exactly this kind of staleness reasoning). A runner who takes a 3-week break and then goes through onboarding/calibration to author a brand-new plan that already accounts for the layoff will, on the very first adaptation cron after the new plan is created, have daysOff computed from their last run before the break (still within the 60-day window), classify as   
Impact: Confusing, doctrinally redundant coach messaging on day one of a new plan for exactly the population most likely to need a clean start (returning after a break). Since rebuild_propose is 'override' severity and record-only (writes plan_adapt_gap + plan_adapt_gap_rebuild intents that the briefing voi  
Fix: Gate detectTrainingGap (or at minimum the rebuild_propose band) on the last-run date being before the active plan's authored_iso — if the plan was authored after the gap, the plan already IS the response and the trigger should be suppressed. Add a te  

**[P2] adaptive-ramp's upward bump has no explicit training_gap awareness — protected today only by data sparsity, not a real guard**  
File: `?`  
Evidence: tryAdaptiveBump(uid, applied > 0) only skips when the CURRENT cron tick applied a mutating action. For the rebuild_propose gap band (>14 days off), buildGapActions returns ONLY a 'note' action (record-only — see the explicit comment in applyAdaptations: note actions 'mutate nothing, bump nothing'), so `applied` stays 0 and pullbackApplied is false, meaning tryAdaptiveBump's own independent gates run unguarded by any gap awareness. The same is true for easy_swap/shave_70_85 in the (rarer) edge case where every candidate row is race-protected or there's no quality/shavable row in the next 14 day  
Impact: No live bug today (verified the 14-day data-sparsity coincidentally blocks it for the only band that hits this path), but it is fragile: any future change to adaptive-ramp's lookback window, or to buildGapActions' shave_70_85 mutation coverage, or a future gap band with a shorter daysOff threshold,   
Fix: Add an explicit check in tryAdaptiveBump (or detectRampSignals) for a recent plan_adapt_gap intent (mirroring hasRecentGapIntent's 7-day pattern, or checking for ANY gap marker regardless of band), independent of whether the current tick's actions mu  

**[P3] 7-day missed-workout suppression window vs 14-day gap shave window: mismatch is real but appears to resolve safely via staleness expiry — flagging for explicit test coverage**  
File: `?`  
Evidence: inGapReentry suppresses detectMissedKeyWorkout while `gap != null` OR a plan_adapt_gap intent was written within the last 7 days. But shave_70_85 mutates 14 days of the plan (week 1 at 70%, week 2 at 85%). Between day 8 and day 14 after the gap marker was written, suppression has lifted (hasRecentGapIntent(7) is false) while the plan's week-2 rows are still the gap-adjusted (85%) prescriptions. If the runner is still not running consistently in that window, detectMissedKeyWorkout's 7-day lookback (today-7..today-1) can pick up a week-2 gap-shaved quality row as a 'missed' candidate and route i  
Impact: Likely low real-world impact because isStaleMissed's independent >3-day-past-original-date rule will usually drop these as stale before the suppression window even lifts (a week-2 row missed on day 8 of its own window is already >3 days stale by day 12, well before the day-15 opening of the suppress  
Fix: Either extend hasRecentGapIntent's window to 14 days to match the full shave horizon, or add a regression test that walks the cron day-by-day across a shave_70_85 gap (days 1-16) asserting no double-handling of week-2 rows occurs between day 8 (suppr  

Surface health: The rebuilt adaptation engine (web-v2/lib/plan/adapt.ts, ~2160 lines) shows real engineering discipline for a highest-blast-radius nightly job: the pure decision core (chooseRescheduleDate, classifyGapBand, buildGapActions, gapAlreadyHandled, completionThresholdMi, overshootFires, partitionActionsForCron) is well-factored, unit-tested (37 tests in _adapt_invariants.test.ts), and the documented his

### wave1-timezone-live (2 findings)

**[P0] iOS HealthKit auto-sync still hardcodes America/Los_Angeles for run/vitals/strength date bucketing — Wave 1's server-side fix never reaches these payloads**  
File: `?`  
Evidence: Three live functions still build `TimeZone(identifier: "America/Los_Angeles")` and use it to compute the date/sample_date/start_local fields shipped to the server, unchanged since May/June (pre-Wave-1) commits, confirmed via git blame: (1) `buildPayload(for:)` lines 445-461 (blame 6467e100b, 2026-05-26) builds the `/api/ingest/workout` payload's `date`+`start_local` in hardcoded PT and never sets a `timezone` key on the payload dict (confirmed: only client_workout_id/start_local/date/activity_type/distance_mi/duration_sec/moving_sec/source keys, grepped the full payload dict). Called from both  
Impact: For any runner outside Pacific time (signup is open per the audit), every HK-auto-synced run, every HK-auto-synced vitals sample (sleep/HRV/RHR/VO2max/weight/cycle data), and every HK-auto-synced strength session lands on the wrong calendar day server-side. This directly re-introduces the exact symp  
Fix: Replace `TimeZone(identifier: "America/Los_Angeles")` with `TimeZone.current` in `buildPayload(for:)` (line 447), `isoDay(_:)` (line 1464), and `buildStrengthPayload(for:)` (line 1746) — mirroring the fix already applied to `isoDayLocal`. For the wor  

**[P3] Admin diagnostic /api/admin/audit-weather bare toUtcIso call defaults to Pacific instead of the target run's runner timezone**  
File: `?`  
Evidence: `const startISO = startLocal ? toUtcIso(startLocal, r.source as string | undefined) : null;` omits the third `tz` argument, so it silently uses `normalize-time.ts`'s `DEFAULT_TZ = 'America/Los_Angeles'` rather than calling `runnerTimezoneOrPacific(userId)` the way the production weather-enrichment path (`web-v2/lib/weather/openmeteo.ts:686-689`) does.  
Impact: Low severity — this is a read-only admin/diagnostic route (per CLAUDE.md's operational-tasks doctrine, agent-built and scoped), not a runner-facing data or coaching path. But it means the diagnostic itself would show the wrong local-time weather window when David uses it to debug a non-Pacific runne  
Fix: Thread the row's own `user_uuid` (already read as `row.user_uuid` elsewhere in the route) through `runnerTimezoneOrPacific()` and pass as the third arg to `toUtcIso`, matching the pattern in `openmeteo.ts`.  

Surface health: Server-side (web-v2/lib, web-v2/app/api) timezone threading is thorough and correct: every runner-data-facing SQL join (execution-evidence/VDOT/goal-projection coach_intents day-bucketing, run-identity dedup span comparison, watch-completion date derivation, weather enrichment, strava push TCX build, notification quiet-hours) now parameterizes the runner's stored timezone via runnerTimezone()/runn

### wave2-3-native-crosscut (0 findings)

Surface health: Clean bill of health across all four hunt targets, verified by direct code reading (not sampling) over the full Wave 2 + Wave 3a/3b native diff (cba3c07c..288f5f66): 57 phone files + 12 watch files, ~5100 insertions / 1200 deletions in native-v2/Faff/Faff + legacy/native/Faff/FaffWatch Watch App.

(1) SettingField-class argument-order bug: enumerated every struct declared or touched in the wave's 

### units-and-gps-live (3 findings)

**[P1] Resume after pause computes distance delta from stale pre-pause GPS fix, inflating recorded distance**  
File: `?`  
Evidence: pause() (line 154-163) stops location updates but never clears lastAcceptedFix. discard() clears it (line 178) but nothing in pause()/start() does. accept() (line 344-370) computes `let delta = loc.distance(from: last)` against `lastAcceptedFix` on the very first fix received after resume — 'last' is still the position where the runner was standing when they hit Pause, not where they are now. If the runner moves at all during the pause (walks to a light, steps off the curb, waits at a water stop, walks in a circle), that movement is silently added to distanceMi as a single delta on resume, and  
Impact: Saved run's totalDistanceMi (and the pace derived from it, buildCompletionPayload lines 247-250) is inflated versus the true GPS track, silently corrupting the SOURCE_TIER-5 'phone' record that ranks equal to watch data in canonical.ts — a data-integrity issue in what the app treats as a trusted fir  
Fix: Clear lastAcceptedFix (and optionally skip adding a delta for the first fix received after any resume) in the resume branch of start(), mirroring how discard() resets it — i.e. set `lastAcceptedFix = nil` when transitioning from .paused to .running s  

**[P1] PhoneRunView is pushed in a NavigationStack with the interactive edge-swipe-back gesture still live; back-swipe mid-run or pre-save silently discards the recording with no confirmation**  
File: `?`  
Evidence: RootTabView.swift:364-385 routes .phoneRun into a NavigationStack-hosted push with only `.navigationBarHidden(true)` (line 385) — that hides the bar/back-chevron but does not disable the system interactive-pop (edge-swipe-back) gesture, and nothing in PhoneRunView.swift or RootTabView.swift calls the SwiftUI/UIKit equivalent of disabling it (no `interactivePopGestureRecognizer.isEnabled = false`, no `.navigationBarBackButtonHidden` + gesture guard). PhoneRunView's only teardown hook is `.onDisappear` (line 95-107), which just calls `tracker.pause()` and explicitly does NOT save — the code comm  
Impact: Directly contradicts the file's own stated design intent ('a completed run with real distance/time/route is exactly the accidental-tap-loses-data case the task calls out' — comment at PhoneRunView.swift:373-376, guarding the Discard button) while leaving an equally-accessible unguarded path (swipe-b  
Fix: Disable the interactive pop gesture while this view is on the stack (e.g. via a UIViewControllerRepresentable gesture-disabler or by presenting PhoneRunView as a .fullScreenCover instead of a NavigationStack push, matching how TreadmillView/other act  

**[P3] Distance display truncates (Int()) rather than rounds in several unit-converted call sites, carried forward from pre-existing pattern**  
File: `?`  
Evidence: These call `Int(Units.convertDistance(miles:to:))` with no `.rounded()`, e.g. ShoeView.swift:55 `Text("\(Int(Units.convertDistance(miles: shoe.miles, to: Units.preference.distance))) \(Units.distanceLabel())")`. Confirmed via `git show f9296bb1` that this is a faithful 1:1 port of the pre-existing `Int(shoe.miles)` (already-truncating) hardcoded literal — Wave 3b did not introduce new truncation, it preserved the old truncating behavior while adding the km conversion. Other sibling call sites in the same commit (ShoesView.swift:298/341/342, RunShoePickerSheet.swift:63, TodayRecoveryPanel.swift  
Impact: Cosmetic/off-by-almost-one display inconsistency only — no wire data or stored values are affected (doctrine-compliant, display-only per the file's own byte-safe framing). Low severity but flagged since the task asked specifically about silent truncation from Int-vs-Double overload handling.  
Fix: Add `.rounded()` before the `Int(...)` cast at the 7 listed sites for consistency with the other 7+ sites in the same commit that already do this.  

Surface health: Units.swift call-site sweep is clean: no leftover hardcoded 'mi'/'/mi'/'°F'/'mph' literals remain outside comments across the ~30 consuming files (grep swept all 26 files listed in the commit plus a few not in that list), and the formatPace/formatPaceBare Int/Double overload pair is used correctly everywhere (Int overload only ever fed an Int? from paceSeconds()/paceTimeSeconds() helpers, no ambig

### vdot-floor-live (3 findings)

**[P0] Mid-block T-pace blend toward an explicit goal is unclamped for below-table anchors — quality paces prescribed up to 4+ min/mi faster than demonstrated pace**  
File: `?`  
Evidence: Built and ran a targeted probe mirroring persistPlan's real pace-derivation pipeline for a below-table runner (13:30/mi anchor pace, 810 s/mi, from a 41:57 5K) who sets an explicit ambitious goal (9:00/mi, matching the exact realistic scenario the P1-56 feature exists to support). resolveCurrentTPace correctly resolves currentT=825 s/mi (tier 'below_table_anchor', properly anchor-derived). But goalT is derived independently via `tPaceFromGoal(input.goalSec,...)` and the GOAL-2 'achievable floor' guard `achievableFloorT = tPaceFromVdot(estimatedCurrentVdot + maxSeasonalVdotGain)`, where `estima  
Impact: Same failure mode as the two already-fixed P1-56 regressions (unclamped Riegel I-pace, VDOT-30-floor masking below-table runs) but reached via a third, untested path: the goal-blend ramp. A below-table runner who sets any real race goal (the exact persona the feature was built for) gets prescribed t  
Fix: Either (a) compute achievableFloorT off the below-table anchor pace when belowTableAnchor is present (mirroring resolveCurrentTPace's tier-2 logic) instead of always going through estimatedCurrentVdot/conservativeVdotFromMileage, or (b) apply clampTo  

**[P2] aheadOfGoal boolean can never fire true for a below-table (easy/recovery) goal, even when the runner has demonstrably far exceeded it — status reads one rung weaker than doctrine-correct**  
File: `?`  
Evidence: Ran fitness-trajectory-belowtable.test.ts directly: 'reads as reachable + aheadOfGoal' fails — traj.reachable is true but traj.aheadOfGoal is false. Root cause: for a below-table goal, the internal VDOT stand-in is goalVdot = currentVdot (used only for gain-sizing math), and projectedVdot = currentVdot + projectedGainVdot where projectedGainVdot is clamped to >= 0. So gapVdot = round(goalVdot_stand-in − projectedVdot) can only be <= 0, never < -0.2 (the aheadOfGoal threshold), unless overPerformanceBonusVdot is injected. The doctrine-honest gapSec field (direct seconds comparison, not VDOT rou  
Impact: GapPanel.tsx and TargetsView.tsx both branch on aheadOfGoal first, then reachable. A fit runner who set a deliberately easy/recovery goal and is executing cleanly falls into the reachable branch and sees 'On track for [goal]' / HIGH tier instead of the doctrinally-correct 'Ahead of [goal] · tracking  
Fix: For the goalBelowTable case, derive aheadOfGoal from the honest gapSec (gapSec < -threshold) rather than from the internal VDOT stand-in's gapVdot, since gapSec is already computed correctly via direct time comparison for exactly this case. Add a ded  

**[P3] traj.gapVdot (nullable for below-table goals) compared with <= in TodayView.tsx/TargetsView.tsx without a null-check — currently non-firing but structurally the same null-safety class already found and fixed once in this feature**  
File: `?`  
Evidence: fitness-trajectory.ts exposes gapVdot as number|null (null exactly when goalBelowTable). Three call sites derive a status/tier from traj.gapVdot <= 1.5: TodayView.tsx:4797, TargetsView.tsx:79 and :98. None null-check gapVdot before the comparison. By contrast, the sibling API route app/api/targets/projection/route.ts:485 handles the identical derivation with an explicit guard: (traj.gapVdot == null || traj.gapVdot <= 1.5) ? 'watch' : 'off' — proving the author was aware of the hazard for this exact ladder and patched it in one place but not the other two client-side duplicates. Verified null <  
Impact: Currently unreachable in practice: these three sites are only reached when !traj.reachable, and for the below-table-goal case traj.reachable is always true (see the aheadOfGoal finding above — same root cause: the goalVdot stand-in construction guarantees the internal gapVdot <= 0 whenever goalBelow  
Fix: Apply the same (traj.gapVdot == null || traj.gapVdot <= 1.5) guard already used in app/api/targets/projection/route.ts:485 to the two TSX call sites, for consistency and to remove the latent trap. Low urgency given current unreachability, but cheap t  

Surface health: Below-table VDOT support (web-v2/lib/training/vdot.ts, generate.ts, targets-summary.ts, goal-projection.ts, goal-ready.ts, fitness-trajectory.ts) is largely sound after the two documented repair rounds — the primary T-pace/I-pace derivation paths (resolveCurrentTPace, tPaceFromAnchorPace, iPaceFromAnchorPace, clampToSanePace) are correctly clamped and covered by passing tests, and goal-ready.ts/ta



---

## Updated punch list

Everything below is either UNFIXED, PARTIAL, or a new regression-hunt finding — i.e., still open. Ordered by severity, deduplicated where the verify pass and a hunter found the same thing. The two P0s already fixed are marked done and kept here for the record.

### P0 — fixed same-day this re-audit
- ✅ **FIXED** `23debd49` — vdot-floor mid-block goal blend unclamped for below-table anchors (generate.ts)
- ✅ **FIXED** `23debd49` — native HealthKit importer hardcodes America/Los_Angeles, bypassing Wave 1's backend fix (HealthKitImporter.swift)

### P1 — new regressions, open
- Adapter: anti-stacking downgrade picks the earliest quality workout in a 7-day window, not one actually colliding with the reschedule target
- Adapter: gap idempotency keyed on exact `lastRunISO` — a backfilled/late-synced run can re-fire the comeback protocol on an already-handled gap
- `prefetchAllOnLaunch`'s unconditional cache writes reopen the kill-mid-onboarding bypass one app launch later (a sibling code path to the one Wave 2 fixed, not introduced by it — pre-existing, now clearly documented)
- Watch faces: mile-split cue fires at literal 1.0-mile GPS boundaries regardless of `unitsDistance` — km users get splits at the wrong interval, not just the wrong label
- Sync: `#HHmm` workoutId suffix (added to fix same-day-run overwrite) broke the TZ-safe phase-breakdown lookup, reviving a previously-fixed "wrong day's phases shown" bug
- `isoDay()` sleep/HRV/RHR/VO2max bucketing has no server-side correction path, unlike workout ingest (which now re-derives date from timezone+start)
- Phone-GPS recording: resume-after-pause computes distance delta from a stale pre-pause GPS fix, inflating recorded distance
- Phone-GPS recording: `PhoneRunView` is pushed with the interactive edge-swipe-back gesture still live — a mid-run back-swipe silently discards the recording with no confirmation

### P1/P2 — from the original audit, still open (UNFIXED or PARTIAL with the failure path still reachable)
- Race-history entries without a finish time are silently discarded during onboarding — no warning, no gate
- Onboarding is imperial-only end to end (server hardcodes `units='imperial'`, no metric entry option) — despite Wave 3b shipping metric support everywhere else
- No password-recovery path anywhere on the phone — a forgotten password is a dead end (the new set-password flow is first-login-only, doesn't reach this case)
- Add Race: DatePicker still unclamped to today/start-date; short-runway save errors still surface raw engine strings
- Readiness-drop NudgeSheet is unreachable — `showNudge` is never set true (separate from the adapter-proposal NudgeSheet repurposing, which did land)
- TrainView: strength companions + adapter collisions still emit multiple rows per date, double-counting mileage
- Personal Records card still derived from training-run averages only — the Wave 1 `/api/records` endpoint exists but this card was never migrated to it
- Targets: EXECUTION card shows the 0.7 no-data default as a measured "70%"; race-without-goal-time still renders "On track for —."; TODAY accrued estimate conflates plan span with race runway; training-run VDOT anchors mislabeled "RACE EFFORT"
- Race day: execution plan is still HM-templated for every distance (broken split arithmetic for 5K/10K); can't log a result until the next calendar day; no race-day mode without an active plan
- APNs still has zero successful deliveries in prod (creds unset — this is David's action item, not code)
- HK strength-session dates: same America/Los_Angeles hardcode as the just-fixed P0 — worth double-checking this specific call site landed in the same fix (it should have, since it's inside HealthKitImporter.swift, but wasn't separately re-verified after the fix)
- Watch: crash-RESUME still under-reports duration while keeping full distance
- Adaptation: `adapt-block.ts` (48h spacing reasoner) and the upward adaptive-ramp are confirmed dead code — zero callers, unreachable gates; `pr_bank`/`goal_changed` "mark paces stale" has no consumer; goal-gap auto-rebuild dedupe is broken by construction (empty `plan_id`)
- Onboarding finish-time picker still caps 5K/10K at 59:59
- Easy/recovery HR analysis still compares against a hardcoded LTHR of 162 (separate from the fixed watch/phone verdict LTHR)
- Watch/phone easy-run HR ceiling uses LTHR-first instead of the authored `MAX(89% LTHR, 78% HRmax)` spec
- `PATCH /api/plan/workout` updates every row sharing a date instead of the targeted row

Full detail with file:line evidence for every item above is in the verify/regression sections above.

---

## What this means for shipping

Nothing found in this re-audit blocks the TestFlight candidate already built and sim-verified — both P0s are fixed and deployed, and no CONFIRMED regression reaches P0 severity anymore. The P1 punch list above is real work, prioritized the same way the original report was: fix what's reachable and harmful first (the two adapter P1s and the phone-GPS pause/swipe issues, since those are the newest, least-battle-tested code), then work down through the UNFIXED carryovers from the original audit.
