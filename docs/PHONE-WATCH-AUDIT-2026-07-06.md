# Phone + Watch Full Audit — 2026-07-06

**Scope:** iPhone app (native-v2) + Watch app + the backend paths they call, audited for correctness, data accuracy, and universality (any runner, any goal, any race). Read-only — nothing was changed.

**Method:** Two multi-agent workflows. (1) Audit: 16 finder agents (one per surface / archetype / cross-cutting concern), findings deduped, all P1s adversarially verified by independent agents reading the cited code, P2s batch-verified. 69 agents, ~1,840 tool calls. (2) Benchmark: 5 web-research agents on Runna, Strava, NRC, Garmin Coach, TrainingPeaks/COROS/Athletica/TrainAsONE/Coopah + cross-app churn research, synthesized into a capability bar. Verification probes left read-only at `web-v2/_wfaudit_adapt{1,2,3}.mjs`.

**Result:** 173 findings — 56 P1, 78 P2, 39 P3. 113 confirmed by adversarial verification, 3 refuted (excluded), the rest pass-through/over-cap (marked UNVERIFIED below; most duplicate confirmed findings from independent finders, which is corroboration, not doubt).

---

## Executive summary

The plan **generator** is in strong shape — it is heavily gated (`_sweep_allusers`, `_maint_invariants`) and the audit found no new defects in plan math. The problems live in four places:

1. **The adaptation engine is the weakest system in the app and is actively harming the one live power user (David).** It chain-drags missed quality workouts forward two days at a time with no collision, rest-day, long-run, frequency, or race-proximity checks; it re-detects the same dragged workout every pass; a trigger/action index bug in the cron misroutes its own anti-stacking downgrades into mislabeled proposals that expire unseen; a later pass downgrades the workout an earlier pass rescued; missed long runs are invisible to it; and it has no concept of a layoff despite the return-from-layoff protocol being fully specified in `Research/22-plan-templates.md` §14. Its two mitigating layers (48h-spacing block reasoner, upward adaptive ramp) are dead code — zero callers, zero firings ever.

2. **Pacific-timezone hardcoding breaks every non-Pacific runner.** `America/Los_Angeles` is hardcoded in the HealthKit importer (run/strength/sleep dates), run-identity dedup (duplicate runs + doubled mileage for non-Pacific Strava+watch users), watch-completion date bucketing, and execution-evidence SQL feeding verdicts, goal projection, and VDOT. Signup is open; any East-coast or European runner gets wrong-day data everywhere.

3. **Trust-killers: numbers that are wrong or fabricated.** The watch and phone post-run verdict compares whole-run average pace against the work-rep target, so **every correctly-executed quality session grades OVER/red** (confirmed independently by four finders). The Activity consistency card shows a hardcoded "21-DAY RUN STREAK" and a hardcoded JAN–MAY month axis to every runner. Easy-run analysis compares HR to a hardcoded LTHR of 162. Briefings fabricate HR caps and fuel checkpoints when data is absent. Warmup/cooldown paces are derived from goal race pace or a hardcoded 9:00/mi, not the runner's easy pace. The PR card and race auto-match both violate the locked race-data source-of-truth rules (training data displayed as authoritative race performance). Per the benchmark, this class is the #1 documented churn driver: each fabricated or wrong number bleeds trust into every real number.

4. **Whole classes of runner are excluded.** Below VDOT 30 the fitness model goes blind (no VDOT, no predictions, prescriptions faster than race pace, no correction path). The onboarding time picker caps 5K/10K at 59:59. The missed-workout detector's flat ≥4mi completion gate flags beginners' completed sub-4mi quality days as missed forever. Metric preferences exist in settings and are consumed by zero renderers — the entire native + watch surface is imperial-only. No-watch users cannot record an outdoor run (the Outdoor CTA dead-ends in a watch mirror). Ultra distances silently fall through to a half-marathon plan. No-race goal mode shows a half-marathon projection and "On track for —." regardless of the actual goal.

Also headline-worthy: **APNs has never delivered a notification in prod** (creds unset; all 53 sends since 2026-05-31 logged `apns_not_configured`) and the notification stack behind it has four independent wire/SQL bugs, so fixing creds alone won't make it work. Race-day mode is dead for every app-created race because `races.meta.distanceMi` is never written. Three data-loss paths exist (failed treadmill save offers only discard; second same-day watch run overwrites the first; runs over 50mi are permanently destroyed by the ingest ceiling + dead-letter policy).

---

## David's week off — what happened and how to get back on track

**The facts.** Last run Jun 27 (14mi long). Zero running Jun 28–Jul 5 (8 days). Back Jul 6 with 6mi easy — exactly what the plan prescribed for that day. Goal race: America's Finest City Half, Aug 16 (6 weeks out). Readiness at the time of return: 41, pull-back band.

**What the app did (reconstructed from `coach_intents` + `adaptation_log`).**
- Jul 1 pass: rescheduled the missed Jun 30 intervals onto Jul 3 — which already had an 8mi easy. Its anti-stacking downgrade was misrouted by the cron index bug and expired unseen as a mislabeled "readiness" proposal.
- Jul 3 pass: rescheduled the missed Jul 2 tempo onto Jul 5 — the 16mi long day — and downgraded the just-rescued intervals to easy, deleting that quality session while keeping its 7.5mi shell on a 15.5mi double day.
- Jul 6 pass: dragged the tempo again onto Jul 8 (which has a 6mi easy), producing **three consecutive tempo days (Jul 7/8/9) in a ~53.5mi week** for a runner who covered 6 miles in the previous 9 days. The missed 16mi long was silently dropped.
- The plan's own design had week of Jul 6 as a **cutback week** — the adapter turned a scheduled recovery week into the biggest quality week of the block.

**What the doctrine says** (`Research/22-plan-templates.md:628-651` §14 Comeback Plans; `Research/09-cross-training.md:428-447` detraining timeline; `Research/01-pace-zones-vdot.md:319-320` layoff VDOT rules):
- 8 days off ≈ 0–4% VO2max cost, no meaningful lactate-threshold loss. At <2 weeks, **no VDOT/pace haircut** — current paces stand.
- 8–14 day layoff protocol: **~70% of pre-layoff volume in week 1, 85% in week 2, full volume in week 3.** Pre-layoff volume was ~45–47mi, so: ~32mi this week, ~40 next week, full by the week of Jul 20 — which is exactly the plan's peak week. The timeline converges on its own.

**Recommendation (no plan changes made — your call):**
- **This week (Jul 6–12, ~32mi):** ignore the crammed schedule. Mon 6E (done). Tue 6E. Wed 5E or rest. Thu: the one quality session — the planned Jul 9 tempo (1.5 WU · 3.5 @ T · 1.5 CD). Fri 6E. Sat rest. Sun: long run at ~11–12mi easy effort, skip the 4mi @ HM quality inside it. Do not run the Jul 7 or Jul 8 tempos.
- **Week of Jul 13 (~40mi):** plan as written but shave the easy days ~15%; keep both quality sessions and the 13mi long with 4 @ HM.
- **Week of Jul 20 onward:** back on the plan as written — peak week, then the built-in 2-week taper into Aug 16.
- **Bottom line: yes, fully back on track.** An 8-day gap 6 weeks out from a half costs you essentially nothing if re-entry is graded. The only way to lose fitness from this episode is to run the adapter's version of this week and get injured.

If you want, the three stale rows can be cleaned up (the dragged Jul 8 tempo deleted, the Jul 3 ghost rows) — that's a data write, needs your explicit go.

---

## Benchmark — where Faff sits vs the 2026 capability bar

Full research: `docs/research/running-app-benchmark-2026-07-06.md` (13-capability bar, trust factors, disruption-handling gold standard, beginner-to-advanced requirements).

| # | Capability (bar-setter) | Faff status |
|---|---|---|
| 1 | Plan repair after disruption (Runna Realignment: menu-driven, never silent) | **Worst quadrant** — silent + aggressive + unexplained. The adapter crams; no user choice, no rationale shown. |
| 2 | Forward recalculation of missed load (Garmin/Athletica: missed = data, never piles up) | **Missing** — no gap detector; missed work piles forward. Doctrine for the fix is already in Research/22 §14. |
| 3 | Readiness that changes the plan (Garmin gates the daily workout) | **Built but broken** — readiness_pullback exists and is doctrine-sound, but its actions are misrouted by the cron index bug and proposals can't render on iPhone. |
| 4 | Explanations on every plan change (Garmin What/How/Why) | **Partial** — coach_intents rows exist; nothing surfaces them to the runner. |
| 5 | Paces from current fitness, refreshed continuously (Runna Pace Insights) | **Strong** — measured-anchor VDOT is exactly the bar. Undermined below VDOT 30 and by the fabricated WU/CD paces. |
| 6 | Race-anchored periodization (Garmin DSW race mode) | **Strong** — the generator is the app's best asset. Broken only for ultras (silent HM fallthrough) and app-created races (dead race-day brief). |
| 7 | Full workout execution on the wrist (Runna watch) | **Strong core, trust-broken edges** — real segment engine, but every quality session grades red, readiness glance is permanently empty, imperial-only. |
| 8 | In-run pace coaching (Runna audio cues) | **Partial** — haptics/chimes exist; mile-split takeover suppressed on all single-phase runs; no grade/heat awareness (nobody has this — open ground). |
| 9 | Honest race prediction (Strava cohort model, hedged) | **Partial** — confidence labels exist but ON PACE can contradict LOW confidence in the same payload; unrealistic goals never resolve to "not happening." |
| 10 | Forward load simulation (COROS) | Missing; nice-to-have, not table stakes. |
| 11 | Injury/return pathway (Runna plans + TrainAsONE prevention) | **Doctrine written, engine absent** — Research/22 comeback protocol implemented nowhere. |
| 12 | Beginner on-ramp (NRC emotional coaching, effort-based) | **Weak** — VDOT<30 blindness, 4mi gate, 59:59 picker cap actively exclude the segment. |
| 13 | Manual escape hatch (Coopah humans; legible overrides) | **Partial** — skip/move exists; adapter actions are neither visible nor reversible. |

**The market gap Faff can own:** the benchmark's verbatim unmet want is *automatic adjustment + a one-line rationale + easy manual override*. Faff already has the pieces (adapter, coach_intents, coach voice, proposals) — they're just miswired. Fixing cluster 1 below doesn't just fix bugs; it ships the thing nobody else ships. The no-race "just run" mode also sits directly on a documented open segment.

---

## Punch list — recommended order

**Cluster 1 · Adapter triage (protects David before Aug 16 + every future user)**
1. Fix the cron trigger/action index misrouting (`app/api/cron/.../adapt`) so downgrades apply as intended.
2. Collision + rest-day + long-run + frequency check on reschedule target date (adapt.ts:1079).
3. Staleness expiry: a workout missed >3 days ago is dropped (becomes data), not dragged.
4. Layoff detector implementing Research/22 §14 (0–7d: swap first quality to easy; 8–14d: 70/85/100% ramp; >2wk: VDOT haircut + rebuild proposal) — propose-first, using existing shave/downgrade machinery.
5. Replace the flat ≥4mi completion gate with a workout-relative one (e.g., ≥60% of prescribed distance).
6. Add `long` to the missed-workout detector (as data for weekly volume, not reschedule).
7. Reconcile volume_overshoot experience caps with the generator's tier bands; add a cooldown so shaves don't compound daily.
8. Surface every adapter action to the runner with a one-line why + undo (the coach_intents rows already exist).

**Cluster 2 · Timezone universality (before any non-Pacific signup matters)**
9. Thread `user_settings.timezone` through: HealthKit importer date stamping, run-identity dedup, watch-completion bucketing, execution-evidence SQL, HK strength dates. One utility, five call sites.

**Cluster 3 · Trust repair (every number defensible)**
10. Post-run verdict: compare work-phase pace to work-phase target (fixes phone + watch; four independent findings).
11. Delete or make real: hardcoded 21-day streak + month axis, LTHR 162, fabricated HR caps/fuel checkpoints, fabricated WU/CD paces (derive from easy pace).
12. PR card reads `races.actual_result` first; race auto-match labeled provisional (both are re-instances of the locked SoT checklist).

**Cluster 4 · Data-loss paths**
13. Durable retry queue for treadmill saves (never offer discard as the only exit).
14. Per-start workout identity on the watch (second same-day run must not overwrite).
15. Replace the 50mi ingest ceiling + dead-letter destruction with quarantine-and-flag.
16. Onboarding: check completeOnboarding result; handle `/set-password` natively; gate `faff.onboarded` on server truth.

**Cluster 5 · Runner-range expansion**
17. VDOT floor: extend Daniels table below 30 or add an effort-based fallback tier so slow runners get honest paces.
18. Metric rendering end-to-end (settings already store it).
19. Phone-GPS outdoor recording for no-watch users.
20. Ultra distances: honest "unsupported" or a real plan — never a silent HM.
21. No-race goal mode: projection anchored to the chosen goal, not a hardcoded HM; plan-shaping settings rebuild goal-mode plans.

**Cluster 6 · Notifications (once APNs creds land — David-driven)**
22. Fix the four wire bugs: prefs wire-incompat, inbox `aps.alert` read, dead `runs.start_time` columns in weekly check-in/shakeout, sick-check RECOVERED category + dedup_key.

---

## Full findings appendix

Generated below by severity. Verdicts: CONFIRMED = adversarially verified by an independent agent reading the code; UNVERIFIED = over verification cap or P3 pass-through (most duplicate a CONFIRMED finding from another finder).


### P1 (56)

**P1-1 · Onboarding save silently 'succeeds' on server error — completeOnboarding's Bool result is discarded**  
_onboarding · CONFIRMED · iPhone onboarding → POST /api/onboarding/complete · `native-v2/Faff/Faff/Views/OnboardingView.swift:1172`_  
Impact: A transient DB error during the txn means every onboarding answer is lost server-side (no timezone, no name, no weekly_frequency, no experience_level, no race history, no user_prefs row) while the runner sees success. users.onboarding_complete stays FALSE, but the native gate never re-checks the server, so onboarding never re-runs. A subsequent 'Set up a goal' then builds a plan with NULL frequency/experience — a 2-day/week beginner gets the legacy fill-every-slot 5-6-day intermediate plan.  
Evidence: OnboardingView.submit() runs `_ = try await API.completeOnboarding(payload: onboardingPayload)` and ignores the return value. API.completeOnboarding (API.swift:727-735) does NOT throw on HTTP failure — it returns `false` for any non-2xx (`guard (200..<300).contains(http.statusCode) else { return false }`). The `catch` branch that shows 'Couldn't save · check your connection' only fires on network throws or 401. The backend can 500 in two places (onboarding/complete/route.ts:353-360 'onboarding atomic txn failed', :468-473 'onboarding persist failed'). On any of these the client still calls onComplete(outcome), RootContainer.complete() sets `faff.onboarded=true`, and the runner enters the main app.  
Fix: In submit(), check the Bool (or better, make completeOnboarding throw on non-2xx and surface the server's error detail) and keep the runner on the confirm screen with the error shown; only call onComplete on a real 2xx.  
Verifier: Full failure path traced in code. (1) native-v2/Faff/Faff/Views/OnboardingView.swift:1172 discards the Bool (`_ = try await API.completeOnboarding(...)`) and unconditionally calls onComplete(outcome) at :1183. (2) native-v2/Faff/Faff/API.swift:727-735 returns false (does NOT throw) for any non-2xx; authedSend only throws on network errors and 401, so a server 500 — and even a validation 400 — flows into the success branch. The 'Couldn't save' catch is unreachable for HTTP 5xx. (3) web-v2/app/api/onboarding/complete/route.ts wraps users UPDATE (incl. onboarding_complete=TRUE at :322) + user_pre …  

**P1-2 · Native sign-in mishandles the '/set-password' redirect — invited runners keep their emailed temp password forever and are forced through full onboarding on every re-login**  
_onboarding · CONFIRMED · iPhone sign-in (EmailSignInSheet) → POST /api/auth/email · `native-v2/Faff/Faff/Views/EmailSignInSheet.swift:296`_  
Impact: An invite-approved runner who only uses the iPhone (the primary client): (1) is never prompted to replace the temp password David emailed them — it silently becomes their permanent credential; (2) after ANY session expiry or sign-out (FaffApp.swift:320-323 clears faff.onboarded on .faffSessionExpired), the next sign-in returns '/set-password' again — even though users.onboarding_complete is TRUE — and the app forces them through the entire 5-step onboarding wizard again. Re-submitting the wizard also overwrites profile fields (experience_level: 'incoming wins', route.ts:406) with whatever they re-pick.  
Evidence: The auth endpoint returns three redirects: '/today', '/onboarding', '/set-password' (auth/email/route.ts:109-112). For a non-admin invited runner, mustChangePassword is true whenever users.email_verified_at IS NULL, and email_verified_at is ONLY ever stamped by POST /api/auth/set-password (set-password/route.ts:32-36) — a web-only surface. The iPhone has zero set-password handling (grep of native-v2 for 'set-password'/'setPassword' returns nothing) and collapses the three-way redirect to `let skipOnboarding = (resp.redirect == "/today")`, so '/set-password' is treated as 'walk onboarding'.  
Fix: Handle redirect == '/set-password' on native: present a set-new-password screen that POSTs /api/auth/set-password (session token already valid), then route on that response's redirect ('/today' vs '/onboarding').  
Verifier: Traced end-to-end in code. (1) access-requests.ts:129 sets email_verified_at=NULL on invite approval; temp password emailed. (2) auth/email/route.ts:109-112 returns redirect '/set-password' on EVERY sign-in while email_verified_at is NULL for non-admins, overriding onboarding_complete=TRUE, while still minting and returning a valid session token. (3) Only POST /api/auth/set-password (web-only page under app/(auth)/set-password) ever stamps email_verified_at for non-admins; self-signup stamps at insert but native has no signup path (only sign-in + request-access). (4) grep of native-v2 for set- …  

**P1-3 · Killing the app mid-onboarding permanently skips onboarding — a stored token alone marks the device 'onboarded'**  
_onboarding · CONFIRMED · iPhone cold-start gate (RootContainer.decideInitialStep) · `native-v2/Faff/Faff/FaffApp.swift:365`_  
Impact: A brand-new invited runner interrupted at step 1 (phone call, app switch + iOS jetsam) ends up in the main app with users.onboarding_complete=FALSE: no timezone (server date logic falls back), no long-run day, no weekly frequency, no experience level, no name shown, and Today in a cold state they never chose. They cannot self-repair except by finding Settings values one by one; a later goal setup generates a plan from NULL calibration inputs.  
Evidence: decideInitialStep(): `if hasCachedSurfaces || TokenStore.shared.isSignedIn { defaults.set(true, forKey: "faff.onboarded"); enterMain(); return }`. EmailSignInSheet persists the session token BEFORE routing to onboarding (EmailSignInSheet.swift:289-297), and the Keychain-backed token survives both relaunch and full app reinstall (TokenStore.swift:2-7). So a new runner who signs in, lands on the onboarding wizard, and quits the app (or deletes and reinstalls to 'start over') is routed straight into the main app on next launch — the wizard never reappears, and there is no other entry point to it.  
Fix: When a token exists but faff.onboarded is unset, ask the server (users.onboarding_complete via /api/profile/state or the auth redirect) before deciding; route to .onboarding when it's false instead of stamping the device onboarded.  
Verifier: Failure path traced end-to-end. (1) EmailSignInSheet.swift persists the Keychain token via TokenStore.shared.set BEFORE calling onSignedIn(skipOnboarding); for a fresh account the server returns redirect '/onboarding' (web-v2/app/api/auth/email/route.ts:112), so the gate advances to .onboarding with faff.onboarded still unset. (2) FaffApp.swift:362-368 decideInitialStep: `hasCachedSurfaces || TokenStore.shared.isSignedIn` sets faff.onboarded=true and enters .main — a stored token alone marks the device onboarded, so kill-mid-wizard → relaunch skips the wizard. (3) TokenStore.swift stores the t …  

**P1-4 · Race-week tune-up workout renders as EASY across the Today hero and week strip**  
_today · CONFIRMED · iPhone Today hero + week strip · `native-v2/Faff/Faff/Theme.swift`_  
Impact: Every racer in race week opens Today on their tune-up day and sees a giant green 'EASY' headline with easy styling, while the step list below shows race-pace reps — contradictory coaching at the most sensitive week of the cycle. A beginner will run it easy and lose the sharpening stimulus; the 'NEXT HARD' readiness chip also fails to warn the day before.  
Evidence: FaffEffort.fromType (Theme.swift:388-399) has no case for 'race_week_tuneup' (or 'shakeout') and defaults to .easy. The generator emits 'race_week_tuneup' as THE taper-week quality day for every race distance (web-v2/lib/plan/generate.ts:1056, 1341-1345) and the canonical title map even defines it as 'TUNE-UP' (web-v2/lib/coach/workout-title.ts:52). TodayView's 88pt hero headline uses selectedEffort.title (TodayView.swift:383), the strip dot uses FaffEffort.fromType(d.type) (TodayView.swift:2316), and nextHardLabel's switch (TodayView.swift:1750-1769) only matches .tempo/.intervals/.long/.race, so the tune-up is also skipped by the NEXT HARD chip.  
Fix: Add 'race_week_tuneup' (and 'shakeout') cases to FaffEffort.fromType, or prefer purpose.typeTitle for the hero headline the way peekTitleWord already does; include race_week_tuneup in nextHardLabel's hard-day set and in plan/week's TYPE_PRIORITY (currently defaults to 2, below easy).  
Verifier: CONFIRMED via full trace. Generator emits type 'race_week_tuneup' as THE taper quality day for all race distances (web-v2/lib/plan/generate.ts:1341-1345) and persists it verbatim into plan_workouts.type (generate.ts:2784/2797). /api/plan/week returns the type raw (web-v2/app/api/plan/week/route.ts:190). FaffEffort.fromType (native-v2/Faff/Faff/Theme.swift:388-399) has no 'race_week_tuneup' case and defaults to .easy, so: the 88pt Today hero headline (TodayView.swift:383 via selectedDayEffort at :1415) shows 'EASY' with the easy gradient/teal mesh; the week-strip dot (makeStripDays, ~:2316) is  …  

**P1-5 · Runaway missed-workout adapter: stale quality run rides 2 days ahead forever, flattens every future quality session, and corrupts week buckets**  
_train · CONFIRMED · web-v2 adaptation cron -> iPhone Train tab / Today strip · `web-v2/lib/plan/adapt.ts`_  
Impact: Any runner who misses one tempo — or whose runs are simply under 4 miles (true beginners, casual 3-day runners: their 3 mi sessions can NEVER satisfy the >=4 mi completion check) — gets a month-old quality workout permanently riding 2 days ahead of today while the cron progressively converts every remaining quality session in their plan to easy. On the Today strip the stale threshold outranks and hides the authored easy run for that day (plan/week TYPE_PRIORITY). On the Train tab, training-state groups days by the stale week_id, so the ghost workout renders inside a month-old week; and each time its date equals today, that month-old week matches `days.some(d.date === today)` (training-state.ts:255) and becomes 'THIS WEEK', pinning the Train tab to a June week in July. The runner's race prep silently degenerates to all-easy.  
Evidence: adapt.ts:1067-1095 — a missed key workout is rescheduled to today+2 AND the next authored key workout in [today, today+7] is downgraded to easy ('Avoid stacking two quality days'). adapt.ts:225-236 — the reschedule is a bare `UPDATE plan_workouts SET date_iso = $1` that never updates dow or week_id and never checks whether the target date already has a run. adapt.ts:564-588 — 'completed' requires a logged run >= 4 mi within +/-1 day, so the rescheduled row is detected as missed again ~3 days later and re-rescheduled, forever. LIVE DB (read-only probe, 2026-07-06): 8 of 16 active plans carry the SAME quality row (original_date_iso 2026-06-09, sub_label 'Cruise Intervals', dow still 2) sitting on 2026-07-08 (= today+2), colliding with the authored easy run on that date; every active plan has >=4 downgraded quality rows, worst plans have 45-88 (pln_921083d889: 88, pln_79ea04de3c: 76); 12 ro …  
Fix: In applyAdaptations reschedule: update dow + week_id, refuse/replace on collision (mirror /api/today/reschedule semantics), and cap roll-forwards (e.g. one reschedule per workout, then drop it). Scale the >=4 mi completion floor to the workout's planned distance (e.g. >=60% of planned mi). Data repair: delete or re-home the riding rows on the 8 affected plans and restore downgraded rows from original_sub_label where the week hasn't passed.  
Verifier: Traced the full failure path in code and re-verified live (read-only, DATABASE_URL_RO).

CODE — every mechanism claim checks out:
1. web-v2/lib/plan/adapt.ts:1067-1096 — missed_key_workout action reschedules the workout to today+2 and downgrades the next authored quality workout in [today, today+7] to easy ("Avoid stacking two quality days").
2. adapt.ts:228-231 — reschedule is a bare `UPDATE plan_workouts SET date_iso = $1 WHERE id = $2`: never updates dow or week_id, never checks whether the target date already carries a workout. (Downgrades DO clear sub_label/is_quality coherently; reschedu …  

**P1-6 · training-state emits multiple rows per date (strength companions + adapter collisions); iPhone TrainView double-counts done mileage and renders phantom 'EASY 0 mi' rows**  
_train · CONFIRMED · iPhone Train tab (TrainView THIS WEEK card, week peek, EXECUTION strip) · `web-v2/lib/coach/training-state.ts`_  
Impact: Any runner on a plan generated since the strength-companion change sees: weekly progress like '10.0 / 24 mi' after one 5 mi run, an EXECUTION strip whose actual-vs-planned bars are inflated (a week can show >100% and green while under-run), two rows for one day in THIS WEEK ('EASY 5 mi' + 'EASY 0 mi'), and a 9-cell 7-day peek with duplicate-ID rendering glitches. Same inflation applies to adapter-collision dates (finding 1), where planned weekly mi also double-counts.  
Evidence: generate.ts:2826-2836 writes 2 'strength' plan_workouts rows per week on easy-run days (live DB: 122 strength rows across 5 active plans, e.g. pln_5e2d4b8978 easy+strength on 2026-07-08). training-state.ts:227-253 builds weeks[].days from ALL plan_workouts rows with no per-date collapse (unlike /api/plan/week route.ts:155-174 which collapses), and line 232/246 attaches the SAME actualByDate entry (the day's run mileage) to EVERY row sharing that date — the strength row inherits the run's doneMi. TrainView.swift:219 sums `curWeek.days.reduce { $0 + $1.doneMi }` and execRows (TrainView.swift:331) does the same, so a 5 mi easy run logged on a run+strength day counts as 10 mi. TrainView.swift:531 `ForEach(week.days, id: \.id)` uses TrainingPlanDay.id = date — duplicate IDs on shared dates (undefined SwiftUI diffing) and the 7-cell week peek renders 8-9 cells. Theme.swift:388-399 FaffEffort.f …  
Fix: In training-state.ts, either filter type='strength' out of days (they carry 0 mi and native strength UI reads recommendedStrengthDays instead) or collapse to primary-run-per-date like /api/plan/week does, and attach actualByDate to only one row per date. On iOS, make TrainingPlanDay.id unique (use plan_workouts id, already shipped in the payload).  
Verifier: Traced the full failure path and reproduced the evidence. (1) Writer: web-v2/lib/plan/generate.ts persistPlan (~2805-2836) inserts 2 type='strength' plan_workouts rows per week on easy-run days (distance 0, SESSION A/B). (2) Live DB (read-only probe): exactly 122 strength rows across 5 active plans (30+30+26+22+14), with easy+strength sharing dates including 2026-07-06 (today) on 4 plans — pln_5e2d4b8978afc5fd among them; adapter collisions (easy+easy, easy+threshold) also confirmed on other plans/dates. (3) training-state.ts:146-147 selects ALL plan_workouts with no type filter; lines 227-253 …  

**P1-7 · 'Personal records' card violates the race-data source-of-truth: derived purely from training-run averages, never reads races.actual_result, no provisional labeling**  
_activity · CONFIRMED · iPhone Activity · STATS tab · Personal records grid · `native-v2/Faff/Faff/Views/ActivityView.swift`_  
Impact: A runner whose curated HM race PR lives in races.actual_result never sees it here; instead the top 'record' is whatever run had the lowest average pace — a 0.3 mi GPS-glitched jog or a stroller-push sprint segment can headline as FASTEST PACE forever. This is exactly the bug class the 2026-05-19 lock was written against (Strava/training data displayed as authoritative record). Also 'LAST THRESHOLD' (:365-367) and 'RANGE TOTAL' (:369-373) are not records at all yet render under the 'Personal records' header.  
Evidence: computeRecords() at ActivityView.swift:324-375 builds the card exclusively from /api/log LogRuns (training data). 'FASTEST PACE' (:331-334, :349-351) is `min` over every run's whole-run average pace with no distance floor and no source labeling. The races table / races.actual_result is never consulted anywhere in the file (no API call to /api/races exists in ActivityView). CLAUDE.md race-data checklist: (1) this displays a PR — yes; (2) reads races.actual_result first — no; (3) fallback labeled provisional — no, it's headlined 'Personal records'.  
Fix: Feed the card from a PR endpoint that reads races.actual_result first (as web /races does), and relabel training-derived tiles ('fastest training run', with a minimum-distance floor). Move LAST THRESHOLD / RANGE TOTAL out from under the 'Personal records' header.  
Verifier: Traced the full failure path; every cited claim checks out.

1. Header is literally "Personal records": SectionLabel(title: "Personal records") at native-v2/Faff/Faff/Views/ActivityView.swift:207, feeding recordsGrid (:312-320) → computeRecords() (:324-375).

2. Data source is exclusively /api/log training runs: computeRecords operates on rangeRuns (:295-300), which flattens log?.weeks from the cached /api/log response. Grepped the whole file — there is no /api/races call and no reference to actual_result anywhere in ActivityView.swift. (API.swift does have fetchRaces/postRaceResult, so the cu …  

**P1-8 · Consistency section shows a hardcoded '21-DAY RUN STREAK' and hardcoded 'JAN FEB MAR APR MAY' month axis to every runner**  
_activity · CONFIRMED · iPhone Activity · STATS tab · Consistency heatmap · `native-v2/Faff/Faff/Views/ActivityView.swift`_  
Impact: A brand-new runner with 2 lifetime runs opens STATS in July and reads '21-DAY RUN STREAK' in amber over a heatmap axis labeled JAN–MAY while the cells actually span March–July. Fabricated streak claim plus a month axis that misdates every cell — the real data underneath is misread by anyone who trusts the labels.  
Evidence: ActivityView.swift:215 `Text("21-DAY RUN STREAK")` is a string literal — it never reads the real `/api/streak` response (which the FEED tab does fetch, :100-103, and StreakPill renders correctly). ActivityView.swift:230 `ForEach(["JAN","FEB","MAR","APR","MAY"], ...)` hardcodes the month axis under a heatmap that is genuinely computed from the last 18 weeks relative to today (:427-453).  
Fix: Drive the streak label from the already-fetched StreakResponse (hide when 0) and derive the month labels from the heatmap's actual 18-week date range.  
Verifier: Traced end-to-end in native-v2/Faff/Faff/Views/ActivityView.swift. Line 215: Text("21-DAY RUN STREAK") is an unconditional string literal in statsBody; the real streak IS fetched (loadStreak(), lines 100-103, /api/streak into @State streak) but only feedBody's StreakPill (line 469) reads it — statsBody never does. Line 230: ForEach(["JAN","FEB","MAR","APR","MAY"]) hardcodes the month axis, while derivedHeatmap (lines 427-453) computes 18 weeks anchored to Date() — on 2026-07-06 the cells span ~Mar 2–Jul 6, so the axis misdates every column; an 18-week (~4.2 month) window can never match a fixe …  

**P1-9 · Run detail 'Shoes' row shows the runner's preferred/highest-mileage shoe, not the shoe assigned to the run**  
_activity · CONFIRMED · iPhone Run detail · DETAILS tile · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: Any runner with 2+ shoes sees the wrong shoe on most run details: assign the Vaporfly to race day, open the run, and the DETAILS tile says the daily trainer (the preferred/highest-mileage shoe sorts first). It also displays a shoe when shoe_id is null (no assignment), fabricating an attribution — which then contradicts the shoe-mileage tracking feature the row is supposed to support. The row's chevron (:552 `chev: true`) also has no tap action, so the runner can't even correct it from here.  
Evidence: shoeShort at RunDetailView.swift:698-703 reads `run?.shoes?.first?.displayName`. But `shoes` is the full non-retired inventory bundled for the picker — web-v2/lib/coach/run-state.ts:620-654 selects ALL non-retired shoes and sorts preferred-first then live-mileage-desc; the actually-assigned shoe is `shoe_id` (run-state.ts:191, decoded in Models/Runs.swift:238 but never used in RunDetailView).  
Fix: Resolve `run.shoes.first(where: { $0.id == run.shoe_id })`; show '—' when shoe_id is null; wire the chevron to RunShoePickerSheet.  
Verifier: Traced end-to-end. RunDetailView.swift:699 shoeShort reads run?.shoes?.first?.displayName. The shoes array (web-v2/lib/coach/run-state.ts:630-654) is the FULL non-retired inventory bundled for the picker, sorted preferred-first then live-mileage-desc, so .first is the preferred/highest-mileage shoe, never guaranteed to be the assigned one. The actual assignment shoe_id (run-state.ts:191, 'P32 shoe assignment') is decoded in Models/Runs.swift (let shoe_id: Int?) but never referenced in RunDetailView (grep: only consumer is TodayPostRunBody.swift:120, a different surface). No nil-guard on shoe_i …  

**P1-10 · Quality-run verdicts for non-watch users judged on whole-run pace vs work-phase target, collapsing executionQuality and flipping status to BEHIND**  
_targets · CONFIRMED · backend goal-projection -> iPhone Targets hero + panel · `web-v2/lib/training/goal-projection.ts`_  
Impact: Any runner without the Faff watch app (Strava-only, HK-only, manual logging -- most of the universal population) who perfectly executes every tempo gets systematic 'slow' verdicts, executionQuality ~0.45-0.5, a discounted trajectory, and a red 'BEHIND' hero with copy 'Missed key runs are stalling the fitness gains' -- when they missed nothing. The one drift detector was fixed to abstain without watch data; the verdict/executionQuality path was not.  
Evidence: loadRecentTestPoints (goal-projection.ts:617-624) falls back to overall pace (`const actualS = workS && workS > 0 ? Math.round(workS) : overallS`) when no watch_completion payload exists (Strava-only / HealthKit-only / manual runs, per its own comment at :556-560), then judges it against pace_target_s_per_mi with the tight quality tolerance of 10 s/mi (:658). A tempo session is WU + work + CD, so overall pace reads 30-50 s/mi slower than the work target (the file itself says so at :944 for the drift detector, which was fixed for exactly this reason -- the verdict path was not). 'slow' scores 0.45 in executionQualityFromTestPoints (:329-330), which scales the trajectory gain (fitness-trajectory.ts:183) and drives status in app/api/targets/projection/route.ts:363-365, which TargetsView.swift:483-489 renders as the 88pt hero.  
Fix: In loadRecentTestPoints, when only overall pace is available for tempo/threshold/intervals, either abstain (verdict null, matching detectTempoPaceDrift's honest-absence doctrine) or compare against an overall-pace-adjusted target, and let executionQuality fall back to its no-signal default instead of scoring fabricated misses.  
Verifier: Full failure path traced in code. (1) goal-projection.ts:624 falls back to overall session pace when no watch_completion coach_intent exists — the SQL comment at :570-582 explicitly names Strava-only/HK-only/manual runs as the null case. (2) The comparison target pace_target_s_per_mi is the bare work-phase pace: spec-builder.ts tempo branch (:313-358) returns paceTargetSPerMi = tPaceSec (PACE-T-1), same for threshold/intervals. (3) The file's own comment at :944-949 quantifies the mismatch (overall pace on WU+T+CD reads ~30-50 s/mi slower than the tempo block) — that drift detector was fixed t …  

**P1-11 · Watch-completion date bucketing hardcodes America/Los_Angeles, breaking work-phase reads and verdicts for non-Pacific runners**  
_targets · CONFIRMED · backend goal-projection (test points, tempo drift, over-performance) · `web-v2/lib/training/goal-projection.ts`_  
Impact: A runner in Europe (UTC+1/+2) doing a 7:00am tempo posts a completion at ~22:00 the previous LA day; in Australia/Asia every morning run lands on the previous LA date. The work-phase pace subquery then finds nothing for the planned date, so the verdict falls to whole-run pace (see the overall-pace finding -> false 'slow' -> BEHIND status), the tempo-drift detector goes blind, and over-performance (the AHEAD gear) can never fire. Morning is the most common run time, so this systematically mis-coaches essentially every non-US-Pacific runner with a watch.  
Evidence: All four coach_intents joins bucket the completion timestamp with `(ci.ts AT TIME ZONE 'America/Los_Angeles')::date` and compare to pw.date_iso (runner-local): loadRecentTestPoints :582, detectTempoPaceDrift :976, computeOverPerformanceBonus :387 and :408. Everywhere else the module uses runnerToday(userUuid) for per-user timezone.  
Fix: Bucket ci.ts using the runner's stored timezone (same source runnerToday uses), or match completions to plan days by a +/-1-day window keyed on the runner-local date.  
Verifier: All cited sites verified. coach_intents.ts is timestamptz DEFAULT now() (db/migrations/101_coach_intents.sql:12); the watch-completion writer (app/api/watch/workouts/complete/route.ts:236) omits ts, so it is the UTC sync instant. All five predicates in web-v2/lib/training/goal-projection.ts (:387/:391/:408/:412, :582, :976/:985) bucket that instant via AT TIME ZONE 'America/Los_Angeles' and strict-equal against pw.date_iso (runner-local plan date). The same functions call runnerToday(userUuid) (:367, :545, :957), so per-user TZ infra exists but the SQL joins hardcode LA; no ±1-day window or ot …  

**P1-12 · No-race fitness-goal mode gets a half-marathon projection regardless of goal distance, an 88pt '—' hero, and 'On track for —.' coach copy**  
_targets · CONFIRMED · iPhone Targets (goal-mode runner) + /api/targets/projection · `native-v2/Faff/Faff/Views/TargetsView.swift`_  
Impact: A 5K-goal runner (a first-class supported mode: goal generates a plan, no race row) opens Targets and sees a giant orange '—' headline, a TODAY/RACE DAY pair showing half-marathon times against their 5K goal, and coach copy asserting on-track toward a dash. Wrong distance, broken hero, broken sentence -- the flagship prediction surface is incoherent for every goal-mode user.  
Evidence: /api/targets/projection resolves the goal exclusively from the races table (route.ts:113-159); tt_goal_* (the no-race goal flow) is never read, so goalSec is null for goal-mode runners. Client-side, distanceForProjection (TargetsView.swift:370-391) reads only the A-race/raceFacts and defaults to 13.1 -- it never looks at profile.fitnessGoal.distance. goalHeroBlock (:197-233) then renders TargetsProjectionPanel with a 13.1-distance projectionSec next to a goal tile saying e.g. '5K · TARGET 25:00'. With goalSec null, status is 'cold' (route statusFor :96), so goalStatusHeadline falls to raceHeadline which is '—' for a raceless runner (TargetsView.swift:468-471, 477-489), and the panel summary renders 'On track for —. You're doing the work...' (K_TargetsProjection.swift:392-397, projFormatTime nil -> '—').  
Fix: Make /api/targets/projection read tt_goal_distance/tt_goal_time when no goal race exists (mirroring generate.ts GOAL-MODE), have the iPhone pass fitnessGoal.distance to distance_mi, and guard summaryLine/hero for goalSec==null.  
Verifier: Traced end-to-end; every claimed link verified in code, no hidden guard found. (1) web-v2/app/api/targets/projection/route.ts resolves the goal ONLY from the races table (lines 113-159); no tt_goal_* read exists in the file, so a no-race goal-mode runner gets race=null, goalSec=null, daysAway=null, distanceMi=13.1 (query default), traj=null, status='cold' (statusFor line 96 / line 363-365). projectionSec is computed at 13.1 from the runner's vdot (snapshot/anchor/profile fallback). (2) Client TargetsView.swift distanceForProjection() (370-391) reads only nextARace/raceFacts and defaults to 13. …  

**P1-13 · Runners slower than ~VDOT 30 get no VDOT and no predictions ever; cold state tells them to race a 5K they already raced**  
_targets · CONFIRMED · backend vdot chain -> iPhone Targets cold state · `web-v2/lib/training/vdot.ts`_  
Impact: A very large share of real runners -- anyone racing 5K slower than ~30:40 (12+ min/mi runners are named explicitly in the universality lens) -- can race, set goals, and train forever while the Targets surface stays cold and repeatedly instructs them to produce a baseline they already produced. Their goal status, trajectory, confidence label, and other-distance equivalents never come online.  
Evidence: vdotFromRace returns null when the raw Daniels value is below 30 (vdot.ts:137 `if (vdot < 30 || vdot > 85) return null;`), so bestRecentVdot drops the candidate (:550-551) and the snapshot cron stores vdot=null. A 33:00 5K (10:38/mi) computes raw VDOT ~27.5 -> null. Inconsistently, the mile path clamps to 30 instead of returning null (:71-74). With vdot null the iPhone renders TargetsProjectionColdState: 'No projection yet · need a clean baseline run. Race a 5K...' (K_TargetsProjection.swift:695-699).  
Fix: Clamp race-derived VDOT at the table floor of 30 (matching the mile-table behavior and the documented [30,85] clamp) or extend the table downward, rather than returning null and silently discarding the runner's fitness evidence.  
Verifier: Traced the full failure path end-to-end. (1) vdot.ts:137 returns null for raw VDOT <30; hand-recomputed a 33:00 5K from vo2Cost/pctVO2 → raw VDOT 27.46 → null; VDOT 30 = 30:40 5K, so the cutoff claim is exact. (2) bestRecentVdot drops the null candidate (vdot.ts:550-551). (3) All Targets fallbacks converge on the same null: snapshot cron stores vdot=null (snapshot-projections/route.ts:63-64); /api/targets/projection falls back series → loadLatestVdotWithAnchor → profileState.physiology.vdot, but profile-state.ts:240-246 reads VDOT from the same projection_snapshots table, so every fallback is  …  

**P1-14 · Trajectory gain is not scaled by remaining runway, so a wildly unrealistic goal reads ON PACE weeks from race day and contradicts the LOW confidence label in the same payload**  
_targets · CONFIRMED · backend fitness-trajectory -> Targets hero status · `web-v2/lib/training/fitness-trajectory.ts`_  
Impact: A runner at VDOT 40 who sets a goal needing VDOT 44.5 with 3 weeks to race and clean execution projects the full 4.5-VDOT gain (research allows ~0.35), so gapVdot <= 0.2 -> reachable -> hero 'ON PACE' in green -- while the confidenceLabel field on the very same response computes LOW ('behind on this runway'). The doctrine is 'the plan gets me there until it's very clear I cannot'; a 4.5-point gap over one build week is exactly the 'very clear' case, and the surface says the opposite. Runners set goals off this.  
Evidence: plannedGainVdot = clamp((goalVdot - currentVdot) * executionQuality, 0, gainCap) (fitness-trajectory.ts:183) -- buildWeeks appears nowhere in the gain; it is computed (:164) but used only for rateShortfallPerWeek. gainCap is min(MAX_BLOCK_GAIN=5, plan ceiling). Meanwhile computeConfidenceLabel (goal-projection.ts:1230-1237) grades the same gap against runwayWeeks x 0.35 VDOT/wk (the module's own cited research rate, :35-37 'a focused block moves ~3-5 VDOT over 12-16 weeks').  
Fix: Cap plannedGainVdot additionally by buildWeeks x BASE_BUILD_RATE (the constant already exported at :51 and cited), or at minimum reconcile the hero status with computeConfidenceLabel so LOW-confidence goals cannot render ON PACE.  
Verifier: Traced end-to-end. fitness-trajectory.ts:183 computes plannedGainVdot = clamp((goalVdot-currentVdot)*executionQuality, 0, gainCap) with no runway term; buildWeeks (:164) feeds only rateShortfallPerWeek (:214-218). gainCap does not rescue the scenario: loadPlannedTargetVdot (plan-target.ts:45-52) reads race_week_tuneup rows prescribed at goal race effort and takes the HIGHEST implied VDOT, so a plan generated for the unrealistic goal yields plannedTargetVdot≈goalVdot (cap = full gap); with no plan, cap = MAX_BLOCK_GAIN 5.0. Failure path: VDOT 40, goal VDOT 44.5, 3 weeks out, all-'on' recent tes …  

**P1-15 · iPhone notification preferences are wire-incompatible with the backend — never load, never save**  
_settings · CONFIRMED · iPhone Profile > Notifications · `native-v2/Faff/Faff/Components/Toolkit/G_Settings.swift:159`_  
Impact: Every notification toggle on the iPhone is fake. A runner who turns off workout reminders or readiness alerts keeps receiving them, and the toggles silently reset to all-ON on next visit. Real prefs set on web are never shown on the phone. Rated P0-adjacent P1 by rubric; using P0 here because the entire settings category is silently non-functional for every user. Downgrade to P1 if preferred.  
Evidence: Swift NotificationPrefs (G_Settings.swift:159-176) has keys readiness_enabled, workout_reminder_enabled, recap_enabled, race_countdown_enabled, adaptation_enabled, reconnect_enabled, streak_enabled. Server /api/profile/notifications (web-v2/app/api/profile/notifications/route.ts:23-36) only allows master_enabled, race_day_enabled, race_eve_enabled, skip_recovery_enabled, weekly_checkin_enabled, niggle_sick_enabled, streak_enabled, strava_reconnect_enabled + time fields, and PATCH 400s on any other key ('Field not allowed'). Only streak_enabled overlaps. GET returns the server shape, which fails Swift's non-optional decode (API+Toolkit.swift:289-298 returns nil) so ProfileView falls back to NotificationPrefs.defaults (ProfileView.swift:202). PATCH encodes the whole Swift struct (API+Toolkit.swift:301-308) so it always 400s; ProfileView swallows it with try? (ProfileView.swift:108).  
Fix: Align the Swift model to the server's key set (master_enabled, race_day_enabled, race_eve_enabled, skip_recovery_enabled, weekly_checkin_enabled, niggle_sick_enabled, streak_enabled, strava_reconnect_enabled), send only changed keys in PATCH, and surface PATCH failures instead of try?-ignoring them.  
Verifier: Traced end to end; the wire incompatibility is real and unguarded. Swift NotificationPrefs (native-v2/Faff/Faff/Components/Toolkit/G_Settings.swift:159-203) uses 7 keys of which only streak_enabled exists in the server's ALLOWED_KEYS (web-v2/app/api/profile/notifications/route.ts:23-36); the other 6 phone categories (readiness/workout_reminder/recap/race_countdown/adaptation/reconnect) do not exist as server categories at all (see lib/notifications/prefs.ts:73-81). PATCH (API+Toolkit.swift:301-308) encodes the full struct so the server 400s on the first disallowed key every time; ProfileView.s …  

**P1-16 · Plan-shaping settings changes never rebuild goal-mode (no-race) plans**  
_settings · CONFIRMED · iPhone Settings > Training (long run / rest / quality days / days-per-week / experience / weekly target) + /api/settings + /api/profile · `web-v2/lib/plan/auto-rebuild.ts:187`_  
Impact: A fitness-goal runner (the tt_goal_* no-race flow — a core universality persona) changes their long-run day or weekly frequency in Settings: the value saves and displays, /api/plan/week re-buckets week boundaries by the new long_run_day, but every prescribed workout stays on the old days. No error, no 'Plan updated' toast, no path to apply the change short of recreating the goal. Week view and plan become mutually inconsistent.  
Evidence: rebuildActivePlanForPrefs bails with {ok:false, reason:'no_active_race_plan'} when the active plan has no race_id ('if (!plan?.race_id) return ...', auto-rebuild.ts:186-187). Goal-anchored plans are persisted with race_id = null by design (lib/plan/generate.ts:216 'persisted with race_id = null'; INSERT at generate.ts:2633). Both PATCH /api/settings (route.ts:58-63) and PATCH /api/profile (route.ts:257-261) route plan-shaping edits exclusively through rebuildActivePlanForPrefs.  
Fix: In rebuildActivePlanForPrefs, when the active plan has race_id=null but is goal-anchored, re-run generatePlan with the stored goalTarget instead of returning no_active_race_plan.  
Verifier: Traced end-to-end. (1) auto-rebuild.ts:181-187 bails with no_active_race_plan when the active plan's race_id is null, BEFORE the plan_proposals audit insert, so no pending row exists for retry. (2) Goal-mode plans are persisted with race_id=null: generate.ts:3145 ('raceSlug: raceSlug ?? null // null for goal-mode') feeding the INSERT at generate.ts:2633-2635; the goal flow (app/api/profile/goal/route.ts:120) calls generatePlan with goalTarget and no raceSlug. (3) Grep confirms rebuildActivePlanForPrefs has exactly two callers: PATCH /api/settings (route.ts:61; PLAN_SHAPING long_run_day/rest_da …  

**P1-17 · races.meta.distanceMi is never written, so goal pace, THE PLAN, splits, fueling, and the whole race-morning brief are dead for every app-created race**  
_raceday · CONFIRMED · backend race composition + iPhone RaceDayView · `/Volumes/WP/06 Claude Code/Runcino/web-v2/app/api/race/[slug]/execution-plan/route.ts`_  
Impact: Any runner who creates a race through onboarding or the app (i.e., everyone except manually-seeded rows) gets a gutted race page: goal time with no pace, no pacing plan, no per-mile splits, no fueling card, and in race week no warm-up timeline and no IF-IT-GOES-SIDEWAYS trigger. The entire race-execution product built in the 2026-06-09 Tier 1.1 audit silently never fires for new users.  
Evidence: Race creation writes only distanceLabel: POST /api/race (web-v2/app/api/race/route.ts:57-64) and onboarding (web-v2/app/api/onboarding/complete/route.ts:531-538) both build meta with distanceLabel and never distanceMi; a repo-wide grep finds no writer of meta.distanceMi. But the race-day composers gate on it with no label fallback: execution-plan/route.ts:47-53 does `const distanceMi = Number(meta.distanceMi) || null; if (!goalSec || !distanceMi) return 404` — so the warm-up timeline and B-goal trigger 404 even when a goal IS set. races-state.ts:119 sets `distance_mi: m.distanceMi ? Number(m.distanceMi) : null` (no label fallback, unlike its own local distanceMiFromLabel used elsewhere), which nulls race.distance_mi in /api/race/[slug]; that route then skips pacing (route.ts:128-129) and fueling (route.ts:151-152). On iPhone, RaceDayView.goalPace (RaceDayView.swift:1119-1123), planPhases …  
Fix: Either write meta.distanceMi at race create/edit (derive from distanceLabel), or add the distanceMiFromLabel fallback in races-state.ts:119 and execution-plan/route.ts:47 (same ladder result/route.ts already uses).  
Verifier: Traced end-to-end; every cited claim holds. (1) No writer of races.meta.distanceMi exists anywhere in web-v2: POST /api/race (app/api/race/route.ts:57-64) and onboarding (app/api/onboarding/complete/route.ts:531-538) write distanceLabel only, and PATCH's key whitelist (route.ts:175) cannot set distanceMi either; GPX/strava-course routes touch course_geometry, never meta. The comment in lib/coach/race-lookup.ts:143 claiming "plan generator sets distanceMi" is stale — generate.ts only reads it. (2) execution-plan/route.ts:47-53 returns 404 when meta.distanceMi is absent even with a parseable goa …  

**P1-18 · Recording the prescribed race-morning warm-up jog kills the race-day takeover on Today**  
_raceday · CONFIRMED · iPhone TodayView race-day gate + /api/plan/week · `/Volumes/WP/06 Claude Code/Runcino/native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A marathoner who records their warm-up jog on the watch (Just Run) or whose 1-mile shakeout auto-imports from HealthKit/Strava sees Today flip from RaceDayView to a post-run recap of the jog — on race morning, before the race. The categorical brief rule 'Race day. The race takes the page' is defeated by following the app's own warm-up instructions. The race workout is still on the watch, but gun time, corral details, splits and fueling vanish from the phone exactly when they are needed.  
Evidence: TodayView.swift:197 gates the race-day takeover on `!isDone`; isDone (TodayView.swift:1817-1819) is `todaySelectedDay?.completedRunId != nil`. /api/plan/week sets completedRunId from canonicalMileageByDay with NO distance/type matching — any canonical run on the calendar day counts (web-v2/app/api/plan/week/route.ts:103-120,198; lib/runs/volume.ts:53-65 has no minimum distance). The app's own execution plan tells the runner to 'Easy jog 1 mile' 45 minutes before the gun (lib/race/execution-plan.ts:418). isPostRunMode (TodayView.swift:1840-1843) then pins the post-run pivot 'until midnight rolls'.  
Fix: Race-day takeover should require the completed run to plausibly BE the race (e.g. distance >= 70% of race distance, mirroring the ±30% guard the watch-complete route already uses for workoutType stamping), not merely any run that day.  
Verifier: Traced end-to-end in code; every claimed link holds. (1) native-v2/Faff/Faff/Views/TodayView.swift:197 gates the race-day takeover on `!isDone`; isDone (lines 1817-1819) is exactly `todaySelectedDay?.completedRunId != nil` with no distance/type/plan matching, and isPostRunMode (1840-1843) pins the post-run pivot "until midnight rolls" with no race-day exception anywhere in the post-run branches. (2) web-v2/app/api/plan/week/route.ts sets completedRunId from canonicalMileageByDay's first canonical run on the calendar day — no matching against the planned workout; lib/runs/volume.ts CANONICAL_RO …  

**P1-19 · A nearby training run is auto-matched as the race finish time and shown as authoritative on iPhone (no provisional label)**  
_raceday · CONFIRMED · backend races-state matching + iPhone RaceDayView post-race hero · `/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/coach/races-state.ts`_  
Impact: The exact 'race passed with no run recorded' scenario goes wrong: a runner who DNS'd a 5K and jogs 4 easy miles the next day (dayDelta 1, miDelta 0.9) sees the race page proclaim 'FINISHED 40:12' as their 5K result; a day-before 2.6-mi shakeout can also match a 5K. Violates the locked race-data source-of-truth rule 3 (Strava-source data must never display as authoritative race performance) on the iPhone surface.  
Evidence: races-state.ts:166-199 matches a past race to any run within ±1 day and ±2.0 mi of the race distance (comment says 'within 1 mile', code allows 2.0; the only floor is distanceMi > 2.5 at line 159) and auto-fills race.finishTime from that run's moving time, setting finishProvisional=true. But the iPhone model never decodes finishProvisional (native-v2/Faff/Faff/Models/Races.swift:215 CodingKeys have no such key), and RaceDayView renders the hero finish + 'FINISHED' chip (RaceDayView.swift:526-547, 637, 664) and THE RETRO read-back (981-999) with no provisional marker.  
Fix: Tighten the match window (same-day only, miDelta well under 1.0 for short races) and decode/render finishProvisional on iPhone ('Training effort · log your chip time'), keeping THE RETRO prompt in the un-curated state.  
Verifier: Traced end to end. (1) Backend: web-v2/lib/coach/races-state.ts matches past races to any run with dayDelta<=1 (line 178) and miDelta<=2.0 (line 181, comment at 151 falsely says 1 mile); only floor is distanceMi>2.5 (line 159); no pace/race-likeness check. When no curated result exists (meta.finishTime and actual_result.finishS both null), finishTime is auto-filled from the run's moving time and finishProvisional=true is set (196-199). (2) Wire: /api/race/[slug]/route.ts:182 spreads the race, so finishProvisional IS on the wire. (3) iPhone: RaceDetail CodingKeys (native-v2/Faff/Faff/Models/Rac …  

**P1-20 · APNs has never delivered a single notification in prod — creds unset, all 53 sends since 2026-05-31 logged apns_not_configured**  
_treadmill-strength-notif · CONFIRMED · notifications · `web-v2/lib/notifications/apns.ts`_  
Impact: The entire notification surface — race-day wake, race-eve, sleep banking, skip-recovery, weekly check-in, niggle/sick checks, streaks, Strava reconnect — is dead for every runner. 22 devices have opted in and granted permission; the Settings toggles imply the feature works. A runner relying on the race-day 05:30 wake push gets nothing on race morning.  
Evidence: Read-only prod DB probe: notifications_log has 53 rows (first 2026-05-31, last 2026-07-06), ALL with payload {skipped:'apns_not_configured', tpl}, delivered=false; COUNT(delivered=true) = 0 ever; device_tokens has 22 active rows. apns.ts:388-394 apnsIsConfigured() requires APNS_KEY_ID/TEAM_ID/KEY_PEM which are absent on Railway (matches prior memory 'apns_configured:false'). dispatch.ts:117-126 logs and skips. Additionally APNS_PRODUCTION is not set, so when creds do land, apnsHost() (apns.ts:166-170) targets sandbox and every TestFlight/App Store token will 400 BadDeviceToken.  
Fix: Operational, David-driven: set APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_PEM AND APNS_PRODUCTION=1 on Railway, then verify via GET /api/cron/notifications health probe (apns_configured + apns_host) and a live send.  
Verifier: Every element of the finding verified independently, read-only.

1. Code path (traced): web-v2/lib/notifications/apns.ts:388-394 apnsIsConfigured() requires APNS_KEY_ID + APNS_TEAM_ID + (APNS_KEY_PEM|APNS_KEY_PATH). web-v2/lib/notifications/dispatch.ts:117-126 — when unconfigured, dispatchNotification inserts a notifications_log row with payload {skipped:'apns_not_configured', tpl}, delivered=false, and returns skipped without sending. Exactly the observed rows.

2. Prod DB (fresh RO probe via DATABASE_URL_RO): notifications_log = 53 rows, first 2026-05-31T05:34Z, last 2026-07-06T16:56Z (today …  

**P1-21 · Treadmill run save has no durable retry queue — a failed POST offers only retry-now or 'Discard and exit' (permanent data loss)**  
_treadmill-strength-notif · CONFIRMED · treadmill · `native-v2/Faff/Faff/Views/TreadmillView.swift`_  
Impact: Gyms are the canonical dead-signal environment (basement, airplane mode, no Wi-Fi). A runner finishes a 60-minute guided treadmill session, End fails, retries fail, and the run — distance, HR, phase actuals — is unrecoverable. The save-timeout fix (timeoutInterval=20, :744) made failure faster but not safer.  
Evidence: TreadmillView.swift:661-671 endAndPost: on POST failure sets postError and stops; :466-480 the only escape is a 'Discard and exit' button that dismisses without persisting the payload anywhere. postTreadmillCompletion (:737-752) does one attempt with a 20s timeout. Contrast: watch completions go through PhoneSync/WatchSync durable pendingCompletions queues (WatchSync.swift:142-147, 205-215) that survive app restarts and retry. The treadmill payload lives only in @State — killing the app, or tapping Discard, loses the workout forever. Also, tapping End again after a failure re-runs recordActual (:274-294) whose hrStreamer.closePhase() buffer is now empty, overwriting the final phase's avgHr/maxHr with nil on the retry payload.  
Fix: Persist the built payload (UserDefaults or file) before the first POST and drain it on next launch/foreground, mirroring the WatchSync pendingCompletions pattern; keep workoutId stable across drains (already done) so backend idempotency dedups.  
Verifier: Traced end-to-end. (1) No durable persistence: treadmill payload lives only in @State; endAndPost (TreadmillView.swift:644-672) does one POST via postTreadmillCompletion (:737-752, timeoutInterval=20, no retry in API.authedSend), and on failure the only exits are retry-now or the 'Discard and exit' button (:466-481) which dismisses without saving; app kill also loses everything. (2) Contrast verified: watch completions to the SAME endpoint use a UserDefaults-backed durable queue (WatchSync.swift:32-33 pendingKey, :142-147 enqueue, :205-222 flushPendingCompletions) that survives restarts and re …  

**P1-22 · HK strength-session dates hardcoded to America/Los_Angeles — non-Pacific runners get sessions logged on the wrong calendar day**  
_treadmill-strength-notif · CONFIRMED · strength · `native-v2/Faff/Faff/HealthKitImporter.swift`_  
Impact: Universality: a London runner lifting Tuesday 07:00 BST (23:00 PT Monday) gets the session logged on Monday. The recommender then sees Tuesday's recommended slot unlogged, rolls it forward, and tells the runner to lift again; the week strip shows the green tick on the wrong day; weekly count and 28-day habit windows drift. Any runner east of Pacific with morning sessions, or west with evening sessions, is affected.  
Evidence: HealthKitImporter.swift:1711-1718 buildStrengthPayload: `let pt = TimeZone(identifier: "America/Los_Angeles") ?? .current` then formats the HKWorkout start date in PT and POSTs it as the session date. The rest of the stack (strength-recommender.ts loadLoggedStrengthDates :678-686, roll-forward :807-831, habit detection :428-471, strength-status.ts) all key on this date being the runner-local day.  
Fix: Use TimeZone.current (device TZ) — the same convention the run-ingest paths use — or send the UTC instant and let the backend resolve via runnerTimezone(userId).  
Verifier: Traced the full path; the finding holds and there is no guard anywhere in the chain.

1. Client (native-v2/Faff/Faff/HealthKitImporter.swift:1707-1726): buildStrengthPayload formats HKWorkout.startDate with a DateFormatter hard-pinned to TimeZone(identifier: "America/Los_Angeles") (line 1711). The `?? .current` fallback never fires (valid IANA id), so the device's own timezone is never used. The struct comment at :1697 even documents the field as "yyyy-MM-dd (PT)" — a deliberate single-user-era choice, now stale. This is the ONLY ingest route for HK strength ("Strength · the only ingest route  …  

**P1-23 · Notification inbox renders every row with blank title/body — SQL reads payload->'aps'->'alert' but dispatch stores flat SendPushArgs**  
_treadmill-strength-notif · CONFIRMED · notifications · `web-v2/app/api/notifications/inbox/route.ts`_  
Impact: Once APNs is configured and pushes deliver, the iPhone inbox (bell sheet) will show contentless rows for every notification — the runner cannot tell what any past nudge said. Currently masked only because zero rows are ever delivered.  
Evidence: inbox/route.ts:32-33 selects `payload->'aps'->'alert'->>'title'` and `...->>'body'`. The ONLY writer of notifications_log is dispatch.ts (grep confirms): line 151-153 stores `JSON.stringify(stripDeviceToken(args))` — a flat object with top-level `title`/`body` keys and no `aps` wrapper (verified against prod rows: no 'aps' key exists in any payload). So title/body always select NULL → items ship as ''. NotificationInboxSheet.swift:92-101 hides empty title and body, leaving a bare colored dot + timestamp per row.  
Fix: Change the inbox SQL to `payload->>'title'` / `payload->>'body'` (with the aps path as COALESCE fallback for any legacy rows).  
Verifier: Traced the full path; every element of the finding holds.

1. Read side (web-v2/app/api/notifications/inbox/route.ts:31-33): the SELECT reads `payload->'aps'->'alert'->>'title'` and `...->>'body'`, then maps NULL to '' at lines 51-52 (`r.title ?? ''`).

2. Write side: grep for `INSERT INTO notifications_log` across web-v2 (*.ts, *.mjs) returns exactly two sites, both in lib/notifications/dispatch.ts:
   - Line 121-124: apns-not-configured stub — stores `{skipped:'apns_not_configured', tpl}` with delivered=false, so these rows are excluded by the inbox's `(delivered IS NULL OR delivered = true) …  

**P1-24 · Weekly check-in and race-eve shakeout queries reference runs.start_time / runs.distance_mi — columns that do not exist; both features can never fire correctly**  
_treadmill-strength-notif · CONFIRMED · notifications · `web-v2/app/api/cron/notifications/route.ts`_  
Impact: Category D (Sunday weekly check-in, 'WEEK DONE X/Y MI') silently never enqueues for any user — summary is always null. Race-eve always renders 'Shake-out skipped — that's fine.' even when the runner ran their shakeout, i.e. wrong coaching copy on the night before a race. Both are invisible today behind the APNs-unconfigured wall and will stay broken after creds land.  
Evidence: cron/notifications/route.ts:689 (`SELECT 1 FROM runs WHERE ... start_time::date = ...`) and :719-725 (`SELECT COALESCE(SUM(distance_mi),0) ... FROM runs WHERE ... start_time::date >= ...`). Verified against prod schema: runs columns are (id, user_uuid, data, detail, provenance, shoe_id, ...) — no start_time, no distance_mi; every other reader in the codebase uses data->>'date' / data->>'distanceMi' (e.g. strength-recommender.ts:650-663). Both queries throw 'column does not exist', are swallowed by the catch → weekSummary returns null (:740-742) and shakeoutDoneToday returns false (:693-695).  
Fix: Rewrite both against the jsonb shape (data->>'date', data->>'distanceMi', excluding mergedIntoId rows), and anchor the week to the long_run_day window (user_settings.long_run_day SoT) rather than ISO Monday.  
Verifier: Traced end-to-end. Prod schema (queried read-only via DATABASE_URL_RO): runs = (id, data, detail, fetched_at, detail_at, shoe_id, user_uuid, shoe_auto_assigned_at, weather_enriched_at, provenance, absorbed_into_canonical_at) — no start_time, no distance_mi (table is the renamed jsonb-body strava_activities per migration 129). shakeoutDoneToday (route.ts:685) selects start_time::date from runs → 'column does not exist' → bare catch returns false always. weekSummary (route.ts:698) sums distance_mi / counts start_time::date on runs → throws → catch returns null always (the plan_workouts.distance_ …  

**P1-25 · Sick-check notifications cannot be resolved: RECOVERED action is not registered on the iOS category, and dedup_key is never sent in the push payload so sick taps mis-route to the niggle path**  
_treadmill-strength-notif · CONFIRMED · notifications · `native-v2/Faff/Faff/NotificationCategories.swift`_  
Impact: A sick runner gets the 07:15 check with GONE as the only 'I'm well' option; tapping it routes to the niggle path (ack/route.ts:231-251) → 'no_active_niggle' no-op (or worse, clears an unrelated active niggle if one exists) → the sick episode stays open and re-fires every morning with no way to close it from the notification. All ack auditing is dead.  
Evidence: Three stacked defects: (1) NotificationCategories.swift:139-167 — the comment claims 'We register BOTH gone (niggle) and recovered (sick)' but the FAFF_NIGGLE actions array is [BETTER, SAME, WORSE, GONE]; RECOVERED is absent, and APNs actions come solely from the registered category (apns.ts:294-297 only sets aps.category), so templates.ts:256-261 renderSickCheck's RECOVERED button never renders. (2) apns.ts:298-304 builds faff = {kind, ...data}, and no template puts dedup_key in data — yet NotificationsAppDelegate.swift:113 reads faff["dedup_key"] (always nil) and ack/route.ts:203-206 relies on dedup_key.startsWith('sick-check:') to route sick vs niggle. (3) With dedupKey nil and notification_id never sent, stampLogAck (ack/route.ts:108-132) can never record ack_action/ack_at, so inbox 'acked' tags never appear.  
Fix: Add RECOVERED to the FAFF_NIGGLE registered actions (or split a FAFF_SICK category); include dedup_key in every template's data dict (or add it in sendPush's faff dict); then sick/niggle routing and ack stamping both work.  
Verifier: All three stacked defects verified by tracing the full path. (1) native-v2/Faff/Faff/NotificationCategories.swift:141-167 registers only BETTER/SAME/WORSE/GONE on FAFF_NIGGLE; the RECOVERED constant (line 52) is never attached to any category despite the comment at 139-140 claiming both are registered. iOS action buttons come solely from the registered category — web-v2/lib/notifications/apns.ts:295-297 only uses action_buttons to set aps.category, so renderSickCheck's RECOVERED button (templates.ts:260) can never render. (2) apns.ts:298-304 builds faff={kind,...data} and dispatch.ts:143 passe …  

**P1-26 · Runs over 50 miles are permanently destroyed by the backend distance ceiling + dead-letter retry policy**  
_watch-engine · CONFIRMED · Watch completion pipeline (watch → iPhone relay → backend) · `web-v2/app/api/watch/workouts/complete/route.ts`_  
Impact: A runner who records a 50-mile ultra (the plan engine explicitly supports ultra distances) finishes the biggest run of their year and the completion — phases, telemetry, GPS polyline, elevation — is silently and irreversibly discarded by every retry path. Only a bare HKWorkout in Apple Health survives, and the runner sees a stuck 'Uploading…' with no error.  
Evidence: web-v2/app/api/watch/workouts/complete/route.ts:158-160 returns 400 for any completion with totalDistanceMi > 50. Both durable retry lanes treat 4xx as permanent and delete the payload: the watch's direct-POST queue drops it at 'FaffWatch Watch App/PhoneSync.swift:363-368' ('Permanent client error … Drop from the durable queue') and the iPhone relay drops it at native-v2/Faff/Faff/WatchSync.swift:261-263 ('dead-letter by returning true so the caller drops it'). The watch UI never learns: PhoneSync's 4xx branch never sets syncState, so SummaryView (SummaryView.swift:62-68) shows 'Uploading…' indefinitely.  
Fix: Raise or remove the 50 mi hard-reject (clamp/flag instead of 400), or return 200 with a stored-but-flagged row; on the clients, surface 4xx drops as a visible 'failed' sync state instead of silence.  
Verifier: Traced end-to-end; every claim holds and the loss is even more total than stated. (1) web-v2/app/api/watch/workouts/complete/route.ts F20 guard returns 400 for totalDistanceMi > 50 before any write (comment: guards dedup absorber vs "100-mile phantom"; no legit-ultra carve-out). (2) Watch direct-POST lane: PhoneSync.swift URLSessionDataDelegate 400-499 branch removePending + cleanTempBody, drops from durable queue, never updates syncState. (3) iPhone relay lane: WatchSync.swift postCompletion returns true for non-401 4xx ("dead-letter... caller drops it"). (4) Claimed rescue path is also close …  

**P1-27 · Second run of the same day overwrites the first — the planned workoutId is per-day and the lobby lets you start it again**  
_watch-engine · CONFIRMED · Watch workout engine + completion backend · `web-v2/lib/watch/build-workout.ts`_  
Impact: Doubles are normal for real runners. Morning: 8 mi planned run recorded. Evening: runner taps START on the still-displayed session for a 3 mi shakeout. The evening completion overwrites the morning run's distance, duration, phases, splits and polyline — the morning run vanishes from training history and weekly volume.  
Evidence: web-v2/lib/watch/build-workout.ts:518 issues workoutId = `${userId}-${today}` (one id per calendar day). After a run finishes, Done calls model.reset() (WorkoutRootView.swift:349-351,135-140) and the lobby re-renders IdleView with the SAME phone.todayWorkout (WorkoutRootView.swift:379-389) — buildWatchToday has no 'already completed today' check, so START is live again. A second same-day start posts the identical workoutId; the backend is deliberately idempotent on it: coach_intents blob is replaced (route.ts:234-252) and the runs row upserts on the same stableId with EXCLUDED data winning (route.ts:441,490-496). The cross-day fork (route.ts:213-215) only fires when the DATE differs.  
Fix: Suffix the client-side workoutId with the start timestamp (or have the watch refuse/confirm re-starting a workout it already completed today), or fork the id server-side when a completion for that id already exists with a materially different startedAt.  
Verifier: Traced end-to-end. (1) build-workout.ts:518 issues workoutId=`${userId}-${today}`; buildWatchToday (line 294+) has no already-completed check — its only early returns are no-plan/no-workout/rest-day, so the same-day payload with the same id is re-issued on every fetch. (2) WorkoutRootView.swift: .finished renders SummaryView whose Done calls model.reset() (nils engine, clears didSendCompletion); router falls back to idleHome which renders IdleView(workout: phone.todayWorkout) with a live START on the identical payload. (3) complete/route.ts: the RK-2 fork only fires when plannedDate !== actual …  

**P1-28 · Mile-split takeover never fires on easy, long, recovery, steady or 'just run' workouts — the gate suppresses it for every single-phase run**  
_watch-engine · CONFIRMED · Watch workout engine · `native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift`_  
Impact: Every runner on an easy run, long run, recovery jog or unstructured 'just run' never receives the mile-split haptic/takeover — a core feedback feature that the code intends to deliver exactly there. It silently works only during warmups, cooldowns and interval recoveries.  
Evidence: WorkoutEngine.swift:793 gates the MILE N · m:ss flash with `let allowSplitFlash = currentPhase?.type != .work`. But the backend expands easy runs (expand-spec.ts:276-283), long runs (expand-spec.ts:256-263), recovery jogs (expand-spec.ts:295-302) and the long-run easy build (expand-spec.ts:233-241) all as type:'work' phases, and makeJustRun is type:.work too (WatchWorkoutModels.swift:593). The code comment at WorkoutEngine.swift:789-791 claims 'warmup / cooldown / recovery / just-run still get splits — those are where mile pace is the highest-value read', which the implementation contradicts: for the run types where mile splits matter most, the phase type is .work for the entire run, so the flash is suppressed from start to finish (the bookkeeping-only branch at :803-808 runs instead).  
Fix: Gate on 'structured work rep' rather than phase type — e.g. suppress only when the workout has >1 work phase or the phase has a tight target (allow when isSingleWorkSession or targetPace is nil/easy-band).  
Verifier: Traced end-to-end. (1) WorkoutEngine.swift:793-802 is the ONLY producer of the MILE N flash (grep-verified single call site), gated by `currentPhase?.type != .work`; the :803-808 branch is bookkeeping only, no haptic/flash. (2) Backend (web-v2/lib/training/expand-spec.ts — note: finding cited lib/watch/, correct path is lib/training/) expands easy (expandEasy), recovery (expandRecovery), plain long run, and the faster-finish long run (both easy-build AND finish segment) all as single/dual type:'work' phases, so the gate is false for the entire run. (3) makeJustRun (WatchWorkoutModels.swift:592 …  

**P1-29 · Post-run verdict compares whole-run average pace against the interval rep target — every correctly-executed interval/threshold session grades 'OVER' (red)**  
_watch-engine · CONFIRMED · Watch summary (SummaryView) · `native-v2/Faff/FaffWatch Watch App/SummaryView.swift`_  
Impact: Wrong coaching at the most emotionally salient moment: a runner who nails every rep of a quality session is told they ran OVER target on the summary screen after every structured workout. Only single-phase steady runs can ever grade 'GOOD'.  
Evidence: SummaryView.swift:89-103: `avg = Int(Double(c.totalDurationSec) / mi)` uses the WHOLE run (warmup + recoveries + cooldown included) but the comparison target is `workout.phases.first(where: { $0.type == .work }).targetPaceSPerMi` — the first interval rep's pace with its tight tolerance (8 s/mi for threshold/intervals per build-workout.ts:395-398). For a canonical session (10 min easy warmup, 5×7 min @ 6:31, 90 s jogs, cooldown) whole-run avg is ~7:45/mi vs 6:31±0:08 → verdict renders 'STEADY · OVER' or 'LOADED · OVER' in red even when every rep's own verdict was 'hit'.  
Fix: Derive the verdict from work-phase results (the per-phase verdicts already computed in WatchCompletionPhase) — e.g. majority of work reps 'hit' → GOOD — instead of whole-run avg vs first-rep target; or restrict this row to single-work-phase runs.  
Verifier: Traced end-to-end. SummaryView.swift:89-103 computes avg = totalDurationSec/totalDistanceMi (whole run: WorkoutEngine publishElapsed banks every phase incl. warmup/recoveries/cooldown into totalElapsedSec, used verbatim in the completion at WorkoutEngine.swift:1420) and compares it against the FIRST work phase's per-rep targetPaceSPerMi with tolerancePaceSPerMi ?? 15. build-workout.ts confirms threshold/intervals ship 8 s/mi tolerance (tempo/race 12) and each work rep carries rep pace as target. Render path is live: interval completions show workoutSummary as TabView page 1, verdict passed to  …  

**P1-30 · Readiness glance is permanently empty on every real device — iPhone never sends the readiness payload**  
_watch-faces · CONFIRMED · Watch readiness glance (home TabView page 3) · `native-v2/Faff/Faff/WatchSync.swift:117`_  
Impact: Every real runner who swipes to the readiness page — any user, any training state, with full HealthKit data — sees the dashed `– –` empty state with 'No readiness read today' forever (ReadinessGlanceView.swift:80-86 default branch). A whole advertised glance surface is dead in production, and the simulator fixture masks it in every dev pass, which is exactly why it has survived since the §8.3 punt.  
Evidence: The watch renders readiness from `phone.readiness` (legacy/native/Faff/FaffWatch Watch App/WorkoutRootView.swift:370: `ReadinessGlanceView(readiness: phone.readiness ?? Self.simulatorReadiness)`), which PhoneSync only populates from a `payload["readiness"]` key (PhoneSync.swift:247-249). The iPhone side never sets that key: WatchSync.swift:117 is literally the comment `// Readiness wires when §8.3 endpoint ships in P3.` and no `/api/watch/readiness` route exists in web-v2 (only `today` and `workouts`). The `simulatorReadiness` fallback (WorkoutRootView.swift:423-434) is `#if targetEnvironment(simulator)` only, so dev/sim screenshots show a healthy score 82 'PRIMED' card while hardware returns nil.  
Fix: Either wire readiness into the WatchSync context (the phone already fetches Today-view readiness from the backend; re-encode it as `ctx["readiness"]`), or remove the glance page until it ships. Also change the empty-state copy so a permanently-broken pipe doesn't read as 'you have no data today'.  
Verifier: Traced end-to-end. (1) Shipping watch app (native-v2/Faff/'FaffWatch Watch App' is a symlink to legacy/native/Faff/'FaffWatch Watch App') renders the glance from phone.readiness only (WorkoutRootView.swift:370); PhoneSync sets readiness solely from payload["readiness"] (PhoneSync.swift:247-249) and never fetches it over the network. (2) The shipping native-v2 iPhone WatchSync never sets a "readiness" key on either channel — applicationContext push (only authToken/syncedAt/workout/noWorkout; line 117 is the deferred-work comment) or the didReceiveMessage reply (lines 342-368). (3) web-v2/app/ap …  

**P1-31 · Post-run verdict row grades whole-session average pace against the work-rep target — red 'STEADY · OVER' on every correctly-executed quality session**  
_watch-faces · CONFIRMED · CompleteFace verdict row (brief v2 §9) via SummaryView · `legacy/native/Faff/FaffWatch Watch App/SummaryView.swift:89-103`_  
Impact: Wrong coaching on the highest-stakes surface: a runner who executes an interval or tempo session perfectly is told, in red, that they were OVER. Universality: this hits every structured-workout user of any speed — beginner or racer — the moment their plan includes a warmup. It also directly contradicts the per-rep ladder on page 2, which shows all reps ✓ hit.  
Evidence: `verdictInfo` computes `avg = Int(Double(c.totalDurationSec) / mi)` over the ENTIRE session (warmup + recovery jogs + cooldown included) and compares it to `workout.phases.first(where: { $0.type == .work })` target with the rep's tolerance (default 15 s/mi). For the shipped sampleCruise shape (4×1 mi @ 6:47 tol 8, with 1.8 mi warmup @ 8:12, three 2:00 recovery jogs, 1.2 mi cooldown — WatchFixtures.swift:333-357), the session average is ~7:20/mi, so d ≈ +33 s ≫ tol and the verdict renders 'STEADY · OVER' in red (.over) even when all four reps were nailed. Same failure for any tempo with warmup/cooldown. Only single-phase easy runs are graded correctly.  
Fix: Grade work phases against work targets: compute avg pace over `completion.phases.filter { $0.type == "work" }` (distance-weighted), or reuse the engine's per-phase verdicts (already computed — 'hit/drifted/missed' in RepLadderRow) and roll them up. Hide the row when work-phase actuals are unavailable.  
Verifier: Traced the full failure path; every element of the finding checks out.

1. This code ships. /Volumes/WP/06 Claude Code/Runcino/native-v2/Faff/"FaffWatch Watch App" is a symlink to /Volumes/WP/06 Claude Code/Runcino/legacy/native/Faff/"FaffWatch Watch App" (confirmed via ls -la), and ship-testflight-v2.sh builds native-v2 + this watch app into one ipa. So the cited legacy file IS the live watch surface.

2. The buggy computation is exactly as claimed (SummaryView.swift:89-103). `verdictInfo` computes avg = Int(Double(c.totalDurationSec) / mi) over the whole completion and compares to `workout.p …  

**P1-32 · Entire watch surface is imperial-only; the km/min-per-km preference users can set on web is silently ignored**  
_watch-faces · CONFIRMED · All watch faces, lobby, splits, takeovers, summary · `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift:800-835`_  
Impact: A metric-preference runner (most of the world outside the US) sets km on the web, then gets every in-run target, drift delta, split, and countdown in min/mi and miles on the wrist — numbers they cannot sanity-check mid-run. The pace-drift colors still work, but the actual coached values are unintelligible, and the settings toggle is a silent no-op on this surface. Fails the universality bar outright.  
Evidence: The backend exposes and persists `units_distance` ('mi'|'km') and `units_pace` ('min_per_mi'|'min_per_km') (web-v2/app/api/settings/route.ts:14; live picker at web-v2/components/settings/SettingsForm.tsx:65-69), but `/api/watch/today` carries no units field and the watch has zero metric code: `PaceFormat.mmss` is defined on seconds-per-MILE, every distance renders as miles (`distText`, ActiveWorkoutView.swift:194), auto-lap flashes 'MILE N' (ActiveWorkoutView.swift:929, MileSplitFace), warmup briefing prints '1.0 mi' (ActiveWorkoutView.swift:554), LandmarkFace subs '0.3 mi ahead', CalibrateFace sets 'MILE n'. grep for km/metric across the watch target returns nothing.  
Fix: Ship units in the watch payload (or WatchSync context), convert at the formatting layer (PaceFormat + distText + split cue text 'KM N'), and keep the wire format in s/mi as-is. Until then, at minimum suffix ambiguous values ('/mi', 'mi') so the unit is explicit.  
Verifier: Traced end-to-end; every cited fact checks out and the failure path is reachable for a real user.

1) The preference is real and user-settable: web-v2/app/api/settings/route.ts:14 whitelists 'units_distance'/'units_pace', typed 'mi'|'km' and 'min_per_mi'|'min_per_km' in web-v2/lib/coach/settings.ts:7-9 (defaults mi at :28-30), and the live picker exists at web-v2/components/settings/SettingsForm.tsx:65-69. Multi-user signup is open and TestFlight external testing is live, so a metric-preference user is a real, reachable user.

2) The watch payload carries no units: grep for 'units' across web- …  

**P1-33 · HealthKit importer hardcodes America/Los_Angeles — wrong run date and broken dedup for every non-Pacific runner**  
_sync · CONFIRMED · phone-watch-backend sync (HK ingest + dedup identity) · `native-v2/Faff/Faff/HealthKitImporter.swift`_  
Impact: Any runner east of Pacific time gets HK-imported runs stamped with the wrong calendar day whenever their local time is ahead of PT's date. Concrete: a Tokyo (or London-before-8am, Sydney, Berlin-before-9am) runner finishes a 7:00 AM run on July 6; the iPhone stamps date=2026-07-05 (PT). (1) The same physical run arriving via the Faff-watch lane is stamped 2026-07-06 (correct, runner-tz) — localDay mismatch means isSameRun can never fire, both rows stay canonical, and daily/weekly volume double-counts the run. (2) For an Apple-Workouts-app user (no Faff watch — HK is their ONLY ingest), every morning run lands on yesterday: today's plan day never marks complete, the log shows runs on wrong days, workoutType plan-stamping matches the wrong plan day, and sleep nights bucket to the wrong morning. This silently breaks the app for most of the world outside US-Pacific.  
Evidence: HealthKitImporter.swift:441-455 (buildPayload computes `date` + `start_local` with `TimeZone(identifier: "America/Los_Angeles")`), :1455-1461 (isoDay, used for every health sample_date), :1390-1394 (sleep-night bucketing calendar pinned to PT), :1711-1718 (buildStrengthPayload date in PT). The backend trusts these verbatim: web-v2/app/api/ingest/workout/route.ts:184-185 stores body.date/start_local unchanged and uses body.date for plan-day matching (:157) and autoMergeForDate (:390). Meanwhile the watch-completion path derives its date from the runner's real profile timezone (web-v2/app/api/watch/workouts/complete/route.ts:189-192 via runnerTimezone/toLocalWallIso). Dedup requires equal local days: web-v2/lib/runs/identity.ts:107 `if (localDay(a) !== localDay(b)) return false`.  
Fix: Replace all four hardcoded PT formatters with TimeZone.current (the device tz), and include the IANA `timezone` on the /api/ingest/workout payload (the route already stores data.timezone on the watch path and identity.ts:86 already honors data.timezone when interpreting bare startLocal). Server-side, prefer recomputing `date` from start_local + payload timezone (falling back to runnerTimezone) instead of trusting the client-computed PT date.  
Verifier: Traced end-to-end, no refuting guard found. (1) HealthKitImporter.swift:441-455 pins date/start_local to America/Los_Angeles (isoDay :1455-1461 same, strength path same). (2) ingest/workout/route.ts stores body.date verbatim (:184-185), matches the plan day on it (:157), and runs autoMergeForDate on the PT date (:390) — the merge sweep scans the wrong day. (3) watch/workouts/complete/route.ts:189-192 derives date from runnerTimezone(userId) (profile tz auto-populated from device tz via the health payload, HealthKitImporter:1509), so the two lanes are guaranteed to disagree whenever runner-loca …  

**P1-34 · Per-day workoutId lets a second same-day Faff-watch run overwrite the first — restart/double runs lose the earlier session**  
_sync · CONFIRMED · watch completion round-trip (duplicate-run creation / data loss) · `web-v2/app/api/watch/workouts/complete/route.ts`_  
Impact: Real scenario: runner starts the day's long run, the watch app crashes / they accidentally end it at mile 6, they restart and run the remaining 6. The second completion (6 mi) overwrites the first 6 mi row and its coach_intents phase blob — distance, phases, HR, splits of segment one are gone from the primary record; the day shows 6 mi not 12. Same for a genuine double (running today's workout tile twice). Partial backstop: IF the runner granted Apple Health access on the phone, the two HKWorkouts ingest as separate rows and the first segment's mileage reappears via the apple_watch sibling — but users who declined Health access (explicitly supported: no-Strava/no-HK users) lose the first run permanently, and the per-phase execution data is lost for everyone.  
Evidence: The server issues workoutId = `${userId}-${today}` — one id per calendar day (web-v2/lib/watch/build-workout.ts:518). The watch echoes it back on every completion (legacy watch WorkoutEngine.swift:1263-1268). The complete route's idempotency keys the runs row on that id (stableId at route.ts:441, upsert :490-496 `SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)`) and sweeps older coach_intents blobs for the same field (:243-251). The cross-day guard (:213-222) only forks the identity when the DATE differs — two completions on the SAME day always collide.  
Fix: Make the watch mint a per-SESSION suffix (e.g. `${workoutId}#${startedAt-minute}`), or extend the existing cross-day fork on the server: when a completion arrives for a workoutId whose stored row has a startedAt more than ~30 min away from the incoming one, fork with an `@HHmm` suffix instead of overwriting (re-POST idempotency is preserved because the same completion always carries the same startedAt).  
Verifier: Traced end-to-end. (1) Server issues per-day id `${userId}-${today}` (build-workout.ts:518) and buildWatchToday keeps serving it after a completion — no already-ran check. (2) Watch echoes it on normal finish (WorkoutEngine.swift:1415) and on crash-recovery END & SAVE (:1264-1268, snapshot?.workoutId). (3) No restart gate: WorkoutRootView .finished → Done → model.reset() → idle home offers today's workout again with the same cached id; only JUST RUN gets a unique UUID id. (4) Route collides same-day completions: cross-day fork (route.ts:213-215) only fires when the DATE differs; same effective …  

**P1-35 · Missed-workout rescheduler double-books days: no collision, rest-day, long-run, or frequency check on the target date**  
_adaptation · CONFIRMED · adaptation engine (missed_key_workout action) · `web-v2/lib/plan/adapt.ts`_  
Impact: Runner is silently prescribed impossible days (15.5-24mi doubles, back-to-back-to-back quality). A 3-day/week casual runner gets a 4th run day fabricated against their frequency preference. Phone shows only one of the two workouts (nondeterministically), so the runner can't even see what the engine did; weekly planned totals still count both.  
Evidence: actionsForTrigger 'missed_key_workout' (adapt.ts:1079-1095) computes rescheduledDate = today+2 and UPDATEs date_iso (adapt.ts:225-231) without ever checking what is already scheduled on that date. Live proof on David's plan pln_ca91f252bba50c74: Jul 1 pass moved missed Jun 30 intervals (wko_92b538a1cd7f7fcc) onto Jul 3, which already held an 8mi easy (wko_a25bb7855cc42959) — two workouts, 15.5mi total on one day. Jul 3 pass moved the missed Jul 2 tempo (wko_da2d9254b8a60d12) onto Jul 5 — the 16mi long-run day (24mi double, averted only because David also missed it). Jul 6 pass moved it again onto Jul 8, next to an existing 6mi easy AND between the Jul 7 and Jul 9 tempos, producing three consecutive quality days (22.5mi of tempo work). Neither /api/plan/week (collapses to one pill per day by TYPE_PRIORITY, week/route.ts:155-174) nor glance-state (planByDate Map, last-row-wins with no ORDE …  
Fix: Before writing newDate, load the target date's rows: skip occupied days, skip rest days deliberately placed, never land within 1 day of another quality/long session, and cap the search at plan/race boundaries. If no viable slot exists in the window, drop the workout with an explicit coach_intents note instead of stacking it.  
Verifier: Traced end-to-end and reproduced against the live DB (read-only). Code: actionsForTrigger 'missed_key_workout' (web-v2/lib/plan/adapt.ts:1079-1084) computes today+2 with zero awareness of the target date; applyAdaptations (adapt.ts:225-231) runs an unconditional UPDATE date_iso. No collision/rest-day/long-run/frequency guard exists anywhere in adapt.ts; no unique constraint on (plan_id,date_iso) in any migration; the trigger is in the apply-now bucket of cron/run-adaptations (route.ts:57), mutating plans daily for all users with no proposal gate. filterUnsealedWorkouts only protects the moved  …  

**P1-36 · No detraining/layoff response: after an 8-day gap the adapter piles missed quality forward and resumes full volume, violating Research doctrine**  
_adaptation · UNVERIFIED · adaptation engine (gap handling — missing entirely) · `web-v2/lib/plan/adapt.ts`_  
Impact: Any runner returning from vacation, illness or unlogged injury — the most injury-vulnerable moment in training — is handed MORE than the original load (original week + rescheduled quality stacked in). ACWR spikes well above the 1.5 high-risk line. This is the exact opposite of every return-from-layoff protocol in the app's own research base.  
Evidence: detectMissedKeyWorkout (adapt.ts:558-599) looks back only 7 days, LIMIT 1, and its only response is 'reschedule +2d, downgrade next key'. Nothing anywhere measures a training gap or reduces upcoming volume. David ran 6mi total between Jun 28 and Jul 5 (runs table), yet his return week Jul 6-12 now totals ~53.5mi with tempos on Jul 7, 8 AND 9 — while his own readiness evidence that morning read score 41, band 'pull-back', RHR elevated 5 days (plan_workout_proposals id 2 evidence). Doctrine: Research/09-cross-training.md §Maintaining Run Fitness During Forced Layoffs (lines 428-439) — 10-14 days off = -4 to -7% VO2max, lactate threshold dropping; Research/00a-distance-running-training.md ACWR table (lines 728-736) — detraining then spike = substantially elevated injury risk; Research/05 defines structured return protocols. For 2-week or 4-week gaps it degrades further: missed keys older th …  
Fix: Add a gap detector (days since last canonical run / rolling 7d vs 28d load). At >=7 days: stop rescheduling missed work, shave the next 1-2 weeks (doctrine-scaled: ~10% per week gap beyond the first), reinstate a shortened long run, and push quality out until 2-3 easy runs complete. At >=14 days: propose a plan re-anchor instead of per-workout patching.  
Verifier: over verification cap  

**P1-37 · Cron misroutes adaptation actions via false triggers[i] index alignment — anti-stacking downgrades stripped from apply and mislabeled as readiness proposals**  
_adaptation · UNVERIFIED · cron /api/cron/run-adaptations · `web-v2/app/api/cron/run-adaptations/route.ts`_  
Impact: The one safety valve the missed-workout path has (downgrade the next key to avoid stacking) is silently disabled whenever any readiness signal co-fires — which is precisely when the runner is most fatigued. What does surface carries wrong causal copy (readiness framing for a scheduling decision), eroding coach trust.  
Evidence: route.ts:82-99 filters actions with actions.filter((_, i) => triggers[i]?.kind !== 'readiness_pullback'), assuming actions correlate 1:1 with triggers. They do not: missed_key_workout emits 2 actions (reschedule + downgrade, adapt.ts:1081-1095), sick/injury emit 0, pullback emits 0-1. Live proof, twice: Jul 1 — triggers [missed_key_workout, readiness_pullback(no action)] → actions [reschedule, downgrade]; index 1 mapped to the pullback trigger, so the anti-stacking downgrade of the Jul 2 tempo was NOT applied (adaptation_log n:1) and was instead written to plan_workout_proposals id 1 with reason 'Readiness pullback · HRV below 5 days running' wrapping payload why 'Avoid stacking two quality days' — expired unactioned Jul 3. Jul 6 — identical: the downgrade of the Jul 7 tempo landed in proposal id 2 (still pending) labeled 'Readiness pullback · RHR above 5 days running', leaving tempos sc …  
Fix: Return {trigger, actions[]} pairs from detectAdaptations (or tag each action with its source trigger kind) and split apply/propose on the tag, never on array index.  
Verifier: over verification cap  

**P1-38 · Adapter cannibalizes its own rescue: rescheduled quality gets downgraded to easy by the next pass, deleting the session but keeping its volume on a double-booked day**  
_adaptation · UNVERIFIED · adaptation engine (multi-pass interaction) · `web-v2/lib/plan/adapt.ts`_  
Impact: Three cron passes produced: one quality session deleted-but-volume-kept, one quality session dragged 6 days into a 3-tempo pile-up, one long run vanished. The adapter's aggregate output after a gap is strictly worse than doing nothing. For longer gaps the same row ping-pongs forward indefinitely.  
Evidence: Passes are memoryless: nextKey lookup (adapt.ts:1068-1075) doesn't know a candidate was itself rescheduled yesterday. Sequence from coach_intents: Jul 1 rescheduled the missed intervals to Jul 3; Jul 3's pass, handling the separately-missed Jul 2 tempo, picked that same rescued intervals row as 'upcoming key' and downgraded it to easy (intent 2026-07-03 06:35 on wko_92b538a1cd7f7fcc). Net: the interval session was destroyed, but its 7.5mi shell (still carrying interval notes) stayed stacked on the 8mi easy day. Meanwhile wko_da2d9254b8a60d12 has been rescheduled twice (Jul 2→Jul 5→Jul 8) and will keep being dragged 2-3 days forward every pass it stays uncompleted — unbounded churn with a fresh coach_intents row each time.  
Fix: Track provenance: exclude workouts rescheduled within the last N days from both the missed detector and the nextKey downgrade target; cap reschedules per workout (1, maybe 2), after which the workout is dropped with an explicit log entry and the week is re-balanced instead.  
Verifier: over verification cap  

**P1-39 · Missed long runs are silently dropped — detector only covers threshold/tempo/intervals/vo2max**  
_adaptation · UNVERIFIED · adaptation engine (missed-workout detector) · `web-v2/lib/plan/adapt.ts`_  
Impact: For HM/marathon runners the long run is the highest-value session; the plan just pretends it never existed. The runner's long-run progression silently loses a rung with no compensating adjustment, and the training history view no longer reflects what was actually prescribed.  
Evidence: adapt.ts:569 — pw.type IN ('threshold','tempo','intervals','vo2max'). Type 'long' is excluded, and no other module addresses missed long runs. David's 16mi long with 5mi @ M (wko_5995ef36dbe141fe, Jul 5) — the single biggest session of his HM build, 6 weeks from americas-finest-city — sat in the past untouched: no reschedule, no adjustment to the next long (Jul 12 stays 13mi), no acknowledgment anywhere. Additionally, because reschedules mutate date_iso in place, Jun 30 and Jul 2 now show NO planned workout at all in history — the plan's past has been rewritten.  
Fix: Not-cramming a missed long is doctrine-correct, but the engine must respond: adjust the NEXT long run (hold or step back the progression per Research/00a volume rules), log a visible coach intent, and never mutate history — preserve original_date_iso (the column already exists in today/reschedule's insert) so past days keep their record.  
Verifier: over verification cap  

**P1-40 · Completion check 'any run >= 4mi within ±1d' breaks for beginners/slow runners with sub-4mi quality days — their completed workouts are flagged missed forever**  
_adaptation · UNVERIFIED · adaptation engine (universality) · `web-v2/lib/plan/adapt.ts`_  
Impact: For low-volume runners the adapter systematically dismantles the plan: quality sessions perpetually re-appear after being done, and upcoming quality is perpetually converted to easy. Their plan converges to all-easy with phantom rescheduled workouts. For all runners, type-blind >=4mi matching means a quality session is 'completed' by an unrelated easy run.  
Evidence: adapt.ts:580-589 marks a key workout completed only if some canonical run >= 4mi exists within ±1 day. A live user (de412d84-507d-400a-a797-c0fd6e631cf2) has active-plan quality workouts of 3.0mi. A beginner or 12+ min/mi runner who executes their 3mi tempo exactly as prescribed never produces a >=4mi run, so detectMissedKeyWorkout fires anyway: the workout they just completed gets rescheduled +2d (duplicate quality day appears) and their NEXT quality day gets downgraded to easy — every single week. The inverse also holds: any 4mi easy jog the day before intervals counts as having done the intervals.  
Fix: Scale the completion threshold to the prescribed workout (e.g. >= 60-70% of the workout's distance_mi, or match via the existing seal/run-matching logic) instead of a hard 4mi constant.  
Verifier: over verification cap  

**P1-41 · Ultra races added from the phone silently generate a half-marathon plan (50K/50M/100K/100M labels fall through to 13.1 mi)**  
_archetypes · UNVERIFIED · Phone (Add Race) → backend plan generation · `web-v2/lib/plan/generate.ts:298`_  
Impact: A runner who adds a 50K/50M/100K/100M A-race on the phone gets a plan built for a 13.1 mi race: half-marathon peak long run (~12 mi), half-marathon pace anchors, and a 13.1 mi race-day workout — silently, with no error. For an ultra racer this is training that cannot get them to the finish line. The Targets projection (finding below) compounds it by also projecting at 13.1.  
Evidence: native-v2/Faff/Faff/Views/TargetsView.swift:992 offers distances ["5K","10K","Half Marathon","Marathon","50K","50M","100K","100M","Other"]; API.swift:983 posts distance_label verbatim. web-v2/app/api/race/route.ts:60 stores only distanceLabel (no numeric distanceMi) then auto-runs generatePlan (route.ts:111). generate.ts distanceMiOf (line 298) resolves the label: '50k' matches none of the marathon/half/10k/5k branches ('5k' is not a substring of '50k'), the /([\d.]+)\s*mi/ regex needs 'mi', so it returns the 13.1 default; same for '50m', '100k', '100m'. lib/coach/race-lookup.ts:154-157 has the same hole ('50k' only parses when the label also contains 'ultra'; '50m'/'100m' need '50mi'/'100 mile') so downstream distance consumers get null. The engine itself supports 50k/100k (sweep DISTANCES in _sweep_allusers.test.ts:17, goalDistanceMiFromCode in lib/training/vdot.ts:342 both handle them …  
Fix: Add '50k'/'50 k'→31.07, '50m'/'50 mile'/'50mi'→50, '100k'→62.14, '100m'/'100 mile'→100 branches to generate.ts distanceMiOf and race-lookup.ts parseDistanceMi (check longer labels before '5k'/'10k' substrings), or better: resolve distance_label→distanceMi once at race POST time via the existing route.ts distanceMiFromLabel (extended for ultra labels) and persist meta.distanceMi. Add a live-path test that creates a race with each phone-offered label and asserts composed raceDistanceMi.  
Verifier: over verification cap  

**P1-42 · Onboarding finish-time picker caps 5K/10K results at 59:59 — slow runners cannot enter their real times**  
_archetypes · UNVERIFIED · Phone onboarding (race history → VDOT anchor) · `native-v2/Faff/Faff/Views/OnboardingView.swift:1328`_  
Impact: A slow beginner literally cannot report an honest recent 10K (or a >1h 5K walk-run). They either skip the step (losing their fitness anchor) or enter a capped 59:59, which fabricates a faster VDOT and produces training paces too hot for exactly the population most at risk of injury from overpaced plans.  
Evidence: TimeWheelSheet shows the hours wheel only for half/marathon: `private var showHours: Bool { distance == "half" || distance == "marathon" }` (line 1328); 5K/10K get only 0-59 min + 0-59 sec wheels (lines 1354-1356). A 10K takes over an hour for anyone slower than ~9:39/mi — squarely inside the app's stated 12+ min/mi archetype (a 12:30/mi 10K is ~1:17:40). These entries are serialized as raceHistory (line 158) and feed plan generation's fitness anchor (bestRecentVdot path, cf. lib/plan/_sweep_allusers.test.ts CC-4 and the goal-relative VDOT floor work).  
Fix: Always show the hours wheel (0...3 for 5K/10K is enough), or add it conditionally when the runner scrolls minutes to 59. Cheap: `showHours` → true for all distances with a distance-appropriate hour range.  
Verifier: over verification cap  

**P1-43 · Easy/recovery run analysis compares AVG HR against a hardcoded LTHR of 162 for every user**  
_archetypes · UNVERIFIED · Phone run detail + Today post-run (AEROBIC STAMP panel) · `native-v2/Faff/Faff/Components/HowItWentPanel.swift:585`_  
Impact: Easy runs are the most common run type, so this wrong number renders constantly. A young beginner with LTHR ~185 running easy at 170 bpm sees "+8 vs threshold" (warn) when they are comfortably aerobic; a 60-year-old with LTHR ~145 running at 155 sees a number colored against someone else's physiology. It is wrong coaching data presented as personal analysis, for every user whose LTHR ≠ 162 (i.e., nearly everyone except the original single user).  
Evidence: AerobicStampPanel.signature: `let lthrish = 162; let delta = avg - lthrish` then renders "AVG HR · N bpm · ±X vs threshold" with green/warn tone from that delta (lines 583-596). The panel is mounted for every easy and recovery run (HowItWentPanel.swift:59-60) from RunDetailView.swift:104 and TodayPostRunBody.swift:873. The run detail payload already carries the real per-user threshold — Models/Runs.swift:240/393 decodes `hr_zones_from_lthr.lthr` from the backend — but the signature ignores it.  
Fix: Use `detail?.hr_zones_from_lthr?.lthr` and hide the delta row when it is nil (keep the bare AVG HR value). One-line swap plus a nil guard.  
Verifier: over verification cap  

**P1-44 · No-watch users have no way to record an outdoor run — the primary 'Outdoor' CTA dead-ends in a watch mirror**  
_archetypes · UNVERIFIED · Phone run menu / no-goal mode 'Record a run' · `native-v2/Faff/Faff/Views/RootTabView.swift:159`_  
Impact: A runner without an Apple Watch (a large share of casual/beginner users, and the exact audience of the no-goal mode) taps the app's primary record button and lands on a screen instructing them to control a watch they don't own. No run is recorded; nothing explains the requirement. Their only paths are the treadmill console or importing runs recorded by other apps via Strava/HealthKit — none of which the UI points them to from this dead end.  
Evidence: RunActionMenu's primary white 'Outdoor' button always routes to `.watchMirror` (RootTabView.swift:159 `onOutdoor: { tabPaths[selected, default: []].append(.watchMirror) }`). WatchMirrorView is explicitly read-only — "The watch owns the timer + controls; the phone is read-only" (WatchMirrorView.swift:3-4) and renders "PAUSE · LAP · END ON YOUR WATCH" (line ~57) or the STANDING BY empty state. No code path checks WatchSync.isPaired/isWatchAppInstalled before offering Outdoor (grep across Views/ and Components/ finds pairing flags used only in WatchSync/TreadmillHRStreamer). The no-goal 'just run' hero's primary CTA "Record a run" (TodayView.swift:1928-1934) opens this same menu, so the TF-223 casual archetype hits the identical dead end.  
Fix: Gate the Outdoor action on WCSession pairing: if no watch is paired/installed, either present a phone-GPS recording flow (long-term) or, minimally, relabel/redirect to an honest state ("Outdoor runs record on Apple Watch — no watch paired. Runs from other apps sync automatically via Apple Health/Strava") instead of the live-mirror console.  
Verifier: over verification cap  

**P1-45 · Metric-unit preferences (km, min/km, °C) exist as settings but are consumed by zero renderers; native app is imperial-only with no units UI**  
_archetypes · UNVERIFIED · Web settings + all phone/watch rendering · `web-v2/components/settings/SettingsForm.tsx:65`_  
Impact: A metric-preference runner (most of the world outside the US) flips the setting and nothing anywhere changes — a silently broken, user-visible feature. On the native app there is not even a toggle: paces like "5:35/km" runners know become "8:59/mi" strings they can't reason about, distances and temperatures are imperial everywhere including watch in-run targets.  
Evidence: SettingsForm.tsx:65-72 offers Pickers for units_distance ('mi'|'km'), units_pace (min/mi|min/km), units_temp (F|C), and app/api/settings/route.ts:14 persists them. Repo-wide grep finds NO consumer of units_distance/units_pace/units_temp outside the settings form, the type definition (lib/coach/settings.ts:7) and defaults (profile-state.ts:360). Every phone surface hardcodes miles and /mi (e.g., TodayView.swift:1101/1553 `"%d:%02d/mi"`, TrainView trainMi, TodayPostRunBody.swift:462), the watch faces hardcode /MI (Faces.swift:569), and native SettingsView has no units field despite its own header comment "Settings · units, ..." (SettingsView.swift:3).  
Fix: Either wire the setting through a shared formatting layer (backend already centralizes pace strings in several adapters) and mirror it in native, or remove the dead pickers from the web settings form until units are actually supported so the setting stops lying.  
Verifier: over verification cap  

**P1-46 · Auto-adapter reschedule double-books days and stacks 3 consecutive tempo days — live on David's active plan**  
_accuracy · UNVERIFIED · backend plan adapter → phone Today/week strip + watch workout · `web-v2/lib/plan/adapt.ts`_  
Impact: The runner is prescribed 22.5 miles of T-pace across three consecutive days on a designated cutback week, six weeks before the A-race — the exact hard/easy violation the doctrine forbids — and weekly planned-mileage numbers on the TRAIN tab are inflated/mis-bucketed. Affects any runner whose adapter fires a reschedule (missed quality day), i.e. any real-life runner, not just David.  
Evidence: adapt.ts:229 executes `UPDATE plan_workouts SET date_iso = $1 WHERE id = $2` — it moves a workout to a new date without updating week_id or dow and without checking what already occupies the target date. The action builder (adapt.ts:1068-1096, missed_key_workout) picks `today + 2 days` blindly. Live DB evidence on David's active plan pln_ca91f252bba50c74 (probe 2026-07-06): 2026-07-08 carries TWO rows (easy:6 in week wk_b0334b4 AND tempo:8 still stamped week wk_2874738, the week that ended Jul 5); 2026-07-03 carries two easy rows (8mi + 7.5mi). Result: tempo on Jul 7, tempo on Jul 8, tempo on Jul 9 — three consecutive quality days on a week flagged is_cutback=true. /api/watch/today's ORDER BY (build-workout.ts:322-330) picks the tempo over the easy on Jul 8, and /api/plan/week's per-day collapse (app/api/plan/week/route.ts:155-175) shows tempo pills Tue/Wed/Thu. loadTrainingState groups  …  
Fix: In adapt.ts reschedule: resolve and set week_id + dow for the new date (same lookup app/api/today/reschedule/route.ts:126-135 already does), and before moving, check the target date for an existing running row — swap/downgrade the displaced row (the reschedule endpoint's replace logic is the model) and never land a quality day adjacent to another quality day; extend the existing single-LIMIT-1 downgrade guard to all quality rows within 1 day of the landing date. Add a cleanup/invariant that no date in an active plan holds two running rows.  
Verifier: over verification cap  

**P1-47 · Watch and phone warmup/cooldown/recovery pace targets are fabricated from goal race pace (or a hardcoded 9:00/mi), not the runner's easy pace**  
_accuracy · UNVERIFIED · watch active workout + phone Today pre-run structure · `web-v2/lib/watch/build-workout.ts`_  
Impact: Every runner doing a quality workout sees a warmup/cooldown target that contradicts the app's own easy-pace doctrine. Universality worst-cases: a no-race 'just run'/tt_goal user has no A-race row, so goal_seconds is null and a 12:00/mi runner gets 9:00/mi warmup, cooldown, and recovery-jog targets — 3 min/mi faster than their easy pace; an ambitious-goal slow runner is pushed even harder. Also skews the workout's estimated duration (phase durationSec = mi × wrong pace).  
Evidence: build-workout.ts:409-417: `easyPaceFallback = goal_seconds/goal_distance + 90` else 540, and `recoveryPaceSec: 540` (hardcoded). expandSpecToPhases (lib/training/expand-spec.ts:119-145, 161-201) stamps this as the targetPaceSPerMi (±30 tolerance) of every warmup/cooldown phase of tempo/interval workouts and 9:00/mi on every interval jog recovery, because spec-builder emits no easy-pace field on tempo/reps specs (spec-builder.ts:353, 390, 436 — only the work pace). Live check: David's Jul 7 tempo spec has warmup_mi:2 but no warmup pace; his goal (AFC Half 1:30:00 / 13.1mi) yields 412+90 = 502 s = 8:22/mi warmup target — faster than the floor of his own authored easy band (517-557 = 8:37-9:17, easy spec same plan). Phone renders it at TodayPreRunBodyV3.swift:484-485 ('Warm-up @ 8:22/mi'); watch displays the target per phase (WorkoutEngine.swift:907-921).  
Fix: Have spec-builder embed the runner's VDOT-derived easy band (it already computes it for easy/long specs) as warmup/cooldown/recovery pace fields on tempo/reps specs, and have build-workout fall back to the runner's easy spec pace (or lib/training paces from current VDOT) instead of goal-pace+90/540.  
Verifier: over verification cap  

**P1-48 · Watch end-of-run verdict compares whole-run average pace to the work-phase target — every structured workout with a warmup grades 'OVER'**  
_accuracy · UNVERIFIED · watch summary screen · `native-v2/Faff/FaffWatch Watch App/SummaryView.swift`_  
Impact: Every correctly executed tempo/threshold/interval session — for every runner — ends with a red/amber 'OVER' verdict on the watch; 'GOOD · ON-PACE' is unreachable for any workout that has a warmup. The runner is told they blew the workout when they nailed it. Interval sessions are graded even more wrongly (jog recoveries drag the average).  
Evidence: SummaryView.swift:89-103: `avg = totalDurationSec / totalDistanceMi` (whole session including warmup, recoveries, cooldown) is compared to `workout.phases.first(where: .work).targetPaceSPerMi` with the work phase's tight tolerance (8-12 s/mi). For David's Jul 7 tempo (2mi WU ~8:37 + 4mi @ 6:59 + 2mi CD ~8:37) a perfectly executed session averages ~7:48/mi vs target 6:59 ± 12 → d = +49 → 'STEADY · OVER' (or 'LOADED · OVER' if avg HR > 149, line 99).  
Fix: Compute the verdict from work-phase splits only — the engine already records per-phase results (WorkoutEngine phase results feed the per-rep ladder on page 2); average the work phases' actual paces against the work target, or hide the verdict when phases are heterogeneous.  
Verifier: over verification cap  

**P1-49 · Briefing/glance fabricates HR caps ('148 bpm' / '145 bpm') and fuel checkpoints ('mi 4 · 8 · 11') when real data is absent**  
_accuracy · UNVERIFIED · phone briefing + web today glance · `web-v2/lib/faff/glance-adapter.ts`_  
Impact: A true beginner with no HR data is coached to cap at 148 bpm — meaningless and potentially far off their physiology (could be recovery-zone or threshold depending on the runner). Any runner with a 5-7 mile long run gets fuel checkpoints beyond the end of the run.  
Evidence: glance-adapter.ts:438 `tail: spec.hr_cap_bpm != null ? … : '148 bpm'` (easy) and :499 `: '145 bpm'` (long) — spec.hr_cap_bpm is null exactly when the runner has neither LTHR nor HRmax (spec-builder.ts:84-96 returns null), i.e. the no-watch/no-HR-data beginner, who is then shown a population HR cap as if it were theirs. glance-adapter.ts:489 and :522 fall back to fuel checkpoints 'mi 4 · 8 · 11' whenever spec.fuel_mi is empty — which is every long run under 8 miles (spec-builder fuelMi returns [] for dist<8), so a beginner's 6-mile long run instructs fueling at miles 8 and 11. Consumed by /api/briefing (app/api/briefing/route.ts:38,95) which the iPhone renders (API.swift:116). This is the exact fabricated-bpm pattern the native side explicitly fixed (TodayPreRunBodyV3.swift:627-633 comment).  
Fix: Mirror the native fallback: when hr_cap_bpm is null show the zone label ('Stay aerobic · Z2'), never a number; when fuel_mi is empty show 'water only' or omit the FUEL row (runs <8mi need no gels per the spec-builder's own doctrine).  
Verifier: over verification cap  

**P1-50 · HealthKit importer stamps every run, strength session, and sleep record with America/Los_Angeles dates — all non-Pacific users get wrong-day data**  
_hardcode · UNVERIFIED · iPhone HealthKit ingest → backend plan matching (all users outside US Pacific time) · `native-v2/Faff/Faff/HealthKitImporter.swift`_  
Impact: A London runner's planned Tuesday 6:00am threshold run is stamped Monday (LA is 10pm Mon), attaches to Monday's plan row (rest/easy day), and Tuesday reads as missed — triggering wrong adherence, roll-forward, and adaptation. For Asia/Oceania users EVERY run before mid-afternoon local lands on the previous day: Today never shows today's run as done, weekly buckets and streaks are systematically shifted. Sleep and strength sessions bucket to the wrong day the same way.  
Evidence: native-v2/Faff/Faff/HealthKitImporter.swift:441-455 — `let pt = TimeZone(identifier: "America/Los_Angeles") ?? .current` then both `start_local` and `date` on the workout payload are formatted in LA time (comment says 'the server expects' PT). Same hardcode at :1391-1394 (sleep-day bucketing), :1458, and :1711-1716 (strength session `date`). The workout payload (built ~:462-471) carries NO timezone field. Server side, web-v2/app/api/ingest/workout/route.ts:59,154-157,184-185 takes `body.date` verbatim and matches `plan_workouts WHERE date_iso = $2` with it; the contract comment at :14 even says 'local date (PT)'. Device timezone is only shipped on the health-samples path (HealthKitImporter.swift:1502-1509), not on workouts.  
Fix: Stamp `date`/`start_local` using TimeZone.current (or profile timezone) and ship `timezone` on the workout/strength payloads; server should derive the bucketing date from start instant + runner timezone instead of trusting a PT-computed client date.  
Verifier: over verification cap  

**P1-51 · Run-identity dedup interprets timezone-less Strava timestamps as Pacific — non-Pacific Strava+watch users get duplicate runs and doubled mileage**  
_hardcode · UNVERIFIED · Backend run dedup / canonical volume (any non-Pacific user with both Strava and watch/HealthKit sources) · `web-v2/lib/runs/identity.ts`_  
Impact: For a runner outside Pacific time with Strava connected plus Apple Watch/HK import, the same physical run maps to UTC spans hours apart → `spansOverlap` (identity.ts:91-95) returns false → dedup false-negative → the run is counted twice. Weekly mileage, ACWR, and training-load coaching inflate ~2x; in Asia-morning cases the two copies even land on different calendar days. Weather enrichment on 'watch' rows is also queried at the wrong hour (normalize-time.ts comments document exactly this bug class for the PT case).  
Evidence: web-v2/lib/runs/identity.ts:64 `const DEFAULT_TZ = 'America/Los_Angeles'` and :86 `const tz = isIana(r.data?.timezone) ? ... : DEFAULT_TZ` — bare wall-clock startLocal is converted to UTC assuming PT when the row has no `data.timezone`. web-v2/lib/strava/pullSync.ts:144-145 stores `startLocal: act.start_date_local` (athlete-local wall time; spurious Z stripped at identity.ts:82) and never stores a timezone field. HK rows are LA wall time (previous finding) so they reconstruct to correct UTC, but a London runner's Strava row (London wall time interpreted as PT) reconstructs 8h late. Same DEFAULT_TZ fallback in web-v2/lib/runs/normalize-time.ts:45 (its own header comment at :39-43 admits `tz defaults to America/Los_Angeles because that's where David is`).  
Fix: Store Strava's `timezone` field on the cached activity data and stamp device timezone on watch/HK rows; make DEFAULT_TZ a per-user profile.timezone lookup rather than a global LA constant.  
Verifier: over verification cap  

**P1-52 · Execution-evidence SQL buckets watch completions by hardcoded 'America/Los_Angeles' — wrong-day joins for non-Pacific runners feeding goal projection and VDOT**  
_hardcode · UNVERIFIED · Backend goal projection + VDOT inputs (all users outside US Pacific time) · `web-v2/lib/training/goal-projection.ts`_  
Impact: A Sydney runner's 6:00am quality session (20:00 UTC previous day = previous LA date) never matches its own plan row: the demonstrated-fitness bonus in computeGoalProjection and the measured work-pace VDOT inputs silently drop or attach to the wrong workout. Their goal projection under- or mis-reads actual training evidence — wrong 'on track / behind' coaching on Targets for every runner east of about UTC-4 who runs mornings.  
Evidence: web-v2/lib/training/goal-projection.ts:387,391,408,412,582,976,985 and web-v2/lib/training/vdot-inputs.ts:225,229,243,247 all join coach_intents watch completions to plan/run days via `(ci.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date`. `ci.ts` is a UTC timestamp; the runner's own plan dates are local dates.  
Fix: Resolve the runner's profile.timezone and parameterize the AT TIME ZONE conversion (all these queries already have userUuid in scope).  
Verifier: over verification cap  

**P1-53 · Targets projection ignores no-race fitness goals — goal-mode users see 'On track for —' and a projection anchored to a hardcoded half-marathon**  
_hardcode · UNVERIFIED · iPhone Targets tab projection panel (no-race fitness-goal users, e.g. '5K in 23:50') · `web-v2/app/api/targets/projection/route.ts`_  
Impact: A runner who onboarded with a 5K fitness goal (the supported no-race goal mode that generates a full plan) opens Targets and sees a projection computed for 13.1 miles presented as their trajectory, a goal that renders as '—', and an on-track/behind verdict derived without their actual goal. The headline feature of the tab is silently broken for the entire goal-mode cohort.  
Evidence: web-v2/app/api/targets/projection/route.ts:113-158 resolves the goal ONLY from the `races` table (explicit slug or upcoming A-race); it never reads the tt_goal_* fitness-goal columns (grep for tt_goal in the route: zero hits), so `goalSec` is null and `distanceMi` falls back to the query default 13.1 (:109,158). Client side, native-v2/Faff/Faff/API.swift:1004 defaults `distanceMi: Double = 13.1` and TargetsView.swift:370-390 `distanceForProjection()` only reads A-race sources, returning 13.1 for goal-only users. With vdot present but goalSec null the server status is 'cold' (route.ts:94-101), and K_TargetsProjection.swift:296-306 falls through to exec/fitness levers, producing summaryLine at :393-397 = 'On track for —.' (projFormatTime(nil) → '—' at :263-264).  
Fix: When no race row resolves, fall back to profile tt_goal distance/time for goalSec + distanceMi (mirror what /api/profile/goal and generate.ts GOAL-MODE already read).  
Verifier: over verification cap  

**P1-54 · Missed-key-workout detector uses a flat >=4mi completion gate — beginner and 5K/10K runners' completed quality sessions register as missed, causing perpetual reschedule/downgrade churn**  
_doctrine · UNVERIFIED · backend plan adapter (cron, all users with an active plan) · `web-v2/lib/plan/adapt.ts:582-598`_  
Impact: A beginner or short-distance runner who completes every prescribed quality session watches the adapter repeatedly declare them missed, shuffle quality days around the week, and convert upcoming interval/threshold days to easy — within a few weeks their plan degrades toward all-easy and the coach narrative ('threshold on 2026-07-01 appears uncompleted') contradicts what they actually ran. Conversely, high-volume runners who skip quality but jog 5 easy miles never get the adaptation at all.  
Evidence: detectMissedKeyWorkout checks completion with `AND (data->>'distanceMi')::numeric >= 4` (adapt.ts:586) against ANY run in the ±1d window. But 5K/10K race plans emit 'intervals'/'threshold' quality days (generate.ts:1347-1354) whose total distance is routinely under 4mi — the 2026-06-15 vdotRunFloorMi fix (b10dab25) already established that ~3.1mi quality efforts are normal for 5K-goal runners, and the developing-tier 5K band is 16-24mi/wk across 3 days (goal-tiers.ts:191). The trigger's action (adapt.ts:1067-1095) then reschedules the 'missed' workout to today+2 and downgrades the NEXT upcoming key workout to easy. The cron (app/api/cron/run-adaptations/route.ts:91) auto-applies this without proposal. Nothing marks the workout resolved, so once the rescheduled date passes without a >=4mi run it re-fires, downgrading another key each cycle. Inverse bug in the same query: any easy >=4mi ru …  
Fix: Reuse the goal-relative floor already built for VDOT (vdotRunFloorMi / goalRunFloorMiForUser in lib/training/vdot-inputs.ts) or compare against the planned workout's own distance_mi (e.g. completed >= 0.6 x planned), and add a type/pace heuristic so easy runs don't satisfy quality days.  
Verifier: over verification cap  

**P1-55 · volume_overshoot experience caps contradict the plan generator's own tier volume — compliant beginners/intermediates get their upcoming week auto-shaved 17% by cron, compounding daily with no cooldown**  
_doctrine · UNVERIFIED · backend plan adapter (cron) vs plan generator · `web-v2/lib/plan/adapt.ts:128-133, 1050, 1149-1163`_  
Impact: A runner marked experience='beginner' with a 3:55 marathon goal who executes their generated plan perfectly hits ~40mi in a peak week; from the next morning the cron silently cuts every upcoming workout 17%, then 17% again the next day, gutting the long run and race-specific sessions the same engine prescribed. The app fights itself and the runner sees their plan shrink day after day with only a coach_intents line as explanation.  
Evidence: EXPERIENCE_CAPS_MI = {beginner: 25, intermediate: 45,...} and detectVolumeOvershoot fires when last-7d completed volume > cap x 1.25 (31.25mi for beginner, adapt.ts:1050). But classifyGoalTier clamps a beginner only DOWN to 'intermediate' (goal-tiers.ts:279-280), and the marathon intermediate tier band is 40-55mi peak weekly / 18-20mi long (goal-tiers.ts:212); even marathon 'developing' is 30-45mi. So the generator prescribes weeks that exceed the adapter's beginner cap for most of the build. actionsForTrigger returns kind:'shave' shaveFraction 0.17 over ALL next-7d workouts (adapt.ts:1149-1163), and the cron classifies volume_overshoot as apply-now, not propose-first (app/api/cron/run-adaptations/route.ts:60-91). detectVolumeOvershoot has no cooldown or dedupe: the trigger reads COMPLETED trailing volume, which stays above the cap for days after a big week, so each daily cron run shaves …  
Fix: Compare trailing volume against the ACTIVE PLAN's scheduled volume for that week (overshoot = ran meaningfully more than prescribed), not a static experience-level constant; add a per-week dedupe so one overshoot produces one shave.  
Verifier: over verification cap  

**P1-56 · Runners below VDOT 30 are unrepresentable: every fitness read returns null, the mileage fallback floors at 30 (and overestimates volume-as-speed), so slow runners (12+ min/mi) get prescriptions faster than their race pace with no correction path**  
_doctrine · UNVERIFIED · VDOT engine + plan generator (all surfaces display the resulting paces) · `web-v2/lib/training/vdot.ts:137`_  
Impact: A 3-day/week casual runner at 11:30-12:30/mi easy pace onboards, gets a plan whose 'easy' days are near or below their 5K race pace and whose threshold days are 3+ min/mi out of reach, and the calibration/self-heal machinery cannot fix it because their real fitness is below the table floor. This is the exact demographic (true beginner, slow runner) the universality requirement names, and for them nearly every prescribed pace in the app is wrong.  
Evidence: vdotFromRace returns null when vdot < 30 (vdot.ts:137) and vdotFromRun inherits the same [30,85] clamp (vdot.ts:405). A 38:00 5K (~12:14/mi, VDOT ~25) — a completely ordinary recreational result — yields null, so bestRecentVdot never populates and generate.ts:1842-1843 falls back to conservativeVdotFromMileage, which floors at 30 and maps pure volume to speed: 25mi/wk => VDOT 38 regardless of pace (spec-builder.ts:726-735, '30 // Daniels VDOT floor; sub-30 is indistinguishable from no-data'). Easy/long/recovery paces anchor to tPaceFromVdot(currentVdot)+80..120s (spec-builder.ts:233-246 via generate.ts:3157), so the slowest easy pace the engine can EVER prescribe is ~12:00-12:40/mi (VDOT 30 => T ~10:41/mi), and a slow 25mi/wk runner gets easy at ~10:10-10:50/mi. Quality is worse: BRK-1 (generate.ts:1892-1893) treats currentT <= goalT as a 'soft goal' and prescribes T sessions at the phan …  
Fix: Extend the VDOT table below 30 (Daniels' formula computes fine; keep the published-table label but allow raw values, or clamp to a wider [20,85]), stop treating sub-30 as no-data, and add an observed-easy-pace sanity check that caps prescribed paces relative to the runner's actual logged paces.  
Verifier: over verification cap  


### P2 (78)

**P2-1 · Readiness-drop NudgeSheet is unreachable — showNudge is never set true, hasNudge is never read**  
_today · CONFIRMED · iPhone Today nudges · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner whose readiness crashes overnight (score 45 after a bad night) gets zero proactive intervention: no bell pip, no morning-check sheet, and the hero still shows the full quality session. The entire 'coach steps in when readiness drops' feature is shipped but dead. The only readiness signal is the passive ring in the collapsed drag-sheet peek.  
Fix: Wire showNudge = true on first Today appearance of the day when readiness.score < 65 (once per day), or delete NudgeSheet and hasNudge and route low-readiness through the pendingProposals strip that does render.  

**P2-2 · STATS wall 'ALL TIME' totals silently capped at the 200 most recent runs**  
_activity · CONFIRMED · iPhone Activity · STATS tab · `native-v2/Faff/Faff/Views/ActivityView.swift`_  
Impact: Any runner with more than ~200 logged runs (one year at 4 runs/week) opens STATS, picks ALL TIME, and sees a confidently-rendered giant gradient number that undercounts their lifetime mileage — e.g. 3 years / 600 runs shows roughly a third of their real total, labeled 'ALL TIME'. Longest run / biggest week 'PRs' from earlier years silently vanish too. Runners with >1000 runs can never reach their full history at all.  
Fix: Have /api/log return true all-time aggregates (totalRuns/totalMi already exist server-side unfiltered — add total time/elev), and make the STATS tab read those instead of summing the windowed feed; or fetch a dedicated stats endpoint that aggregates in SQL.  

**P2-3 · Strava 'connected' state derived from ANY recent run, not from Strava linkage**  
_settings · CONFIRMED · iPhone Settings > Connections, Profile > Connected (backend /api/profile/state) · `web-v2/lib/coach/profile-state.ts:234`_  
Impact: A watch-only runner who never touched Strava sees 'Strava · Synced' in Settings and Profile, plus an auto-push toggle that writes strava_auto_push=true against zero stored tokens (pushes can never fire). Conversely, a genuinely linked runner off for 14+ days (injury, break) sees 'Connect' as if the link died. iPhone also mirrors the wrong flag into StravaConnection.set() (SettingsView.swift:204), unhiding Strava UI app-wide.  
Fix: Derive strava.connected from strava_tokens presence (or profile.strava_connected_at) with last-sync recency as a secondary 'note', not the connection test.  

**P2-4 · Add Race accepts past race dates and dates before the training start; failures surface raw engine jargon**  
_onboarding · CONFIRMED · iPhone AddRaceSheet → POST /api/race · `native-v2/Faff/Faff/Views/TargetsView.swift:999`_  
Impact: A new runner fresh out of onboarding who taps 'Set up a race' and fat-fingers the year (or adds a race 10 days out) gets a saved race row, zero plan, and the error 'target < 2 weeks away; use race-week briefing only' — jargon referencing a feature they can't see. A past-dated race silently lands in PAST RACES with no plan and no explanation. Empty Today follows either way.  
Fix: Clamp the race DatePicker to `in: startDate...` (and startDate to <= race date), and extend toFriendlyPlanError to translate the runway messages ('That race is too close to build a plan — we'll guide you through race week instead').  

**P2-5 · Onboarding is imperial-only — metric-preference runners must answer in miles/feet and are hard-defaulted to units='imperial'**  
_onboarding · CONFIRMED · iPhone onboarding + POST /api/onboarding/complete · `web-v2/app/api/onboarding/complete/route.ts:349`_  
Impact: A km-native runner (most of the world; the app is now multi-user with open access requests) must mentally convert their weekly volume to miles during onboarding — a 40 km/week runner who picks '35 to 45 miles' seeds a base ~60% too high, inflating the generated plan's volume from day one. Every surface then renders in miles until they discover the Settings units toggle.  
Fix: Ask units first (or infer from Locale.measurementSystem), render the mileage/longest-run buckets and height wheels in the runner's system, convert to miles for the payload, and pass the chosen units through to user_prefs instead of hardcoding 'imperial'.  

**P2-6 · Race-history entries without a finish time are silently discarded — runner believes their PR seeded the baseline**  
_onboarding · CONFIRMED · iPhone onboarding race-history step · `native-v2/Faff/Faff/Views/OnboardingView.swift:157`_  
Impact: A runner picks 'Yes, I've raced', selects 5K, taps Continue without opening the time wheel (the chips look complete). Their only fitness signal is silently dropped: profile.race_history lands empty, VDOT/voice-band calibration falls to beginner defaults, and the first goal-plan projection ('Current fitness') shows nothing. For a no-Strava, no-HealthKit runner this was the single opportunity to seed paces.  
Fix: Gate Continue on every entry having timeSec >= 60 (or visibly drop incomplete entries with an inline 'no time — this result won't be used' note before proceeding).  

**P2-7 · No password-recovery path anywhere — a forgotten password is a dead end on the phone**  
_onboarding · CONFIRMED · iPhone sign-in + backend auth routes · `native-v2/Faff/Faff/Views/EmailSignInSheet.swift:244`_  
Impact: Any runner who forgets their password is fully locked out of the app with no self-service recovery — their only path is knowing to email the admin out-of-band, which nothing in the UI tells them. Combined with the temp-password finding (invited users keep an emailed plaintext password), long-lived accounts hit this often: session expires after 60d, password long forgotten, account unreachable.  
Fix: Add a minimal email-based reset (token link or temp-password reissue for status='active' accounts) plus a 'Forgot password?' link in EmailSignInSheet; at minimum show contact instructions on repeated invalid-credential failures.  

**P2-8 · Today composition does not change for base/build/peak/taper/race-week/post-race/off-season states; the phase label itself is dead code**  
_today · CONFIRMED · iPhone Today vs C1 conditional layouts · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner 3 days from their marathon sees exactly the same page structure as a runner 4 months out: same hero, same readiness panel, no race-week schedule, no fueling/kit checklist, no taper framing. This directly violates the locked project posture ('Composition is state-driven, not template-driven … race week and four months out should look meaningfully different'). The race countdown exists only as a small chip inside the drag-up readiness panel.  
Fix: Introduce a phase resolver (purpose.phase + daysToRace already fetched) and at minimum: promote a race countdown block above the hero inside 14 days, swap in a race-week variant inside 7 days, and render the (already computed) phase context line.  

**P2-9 · Post-race state has no handling — days after the goal race render as bare generic REST, and the fetched RecoveryBrief is never displayed**  
_today · CONFIRMED · iPhone Today post-race · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner who finishes their marathon opens Today the next morning and gets a blank 'REST' with 'Rest day · nothing to recap' when they browse the strip — no acknowledgment the race happened, no recovery protocol, no guidance on when to run again. For a first-time marathoner this is the highest-risk window (running too soon) and the app goes silent. Weeks later the surface is still an endless REST until enough empty weeks make hasPlan false and it flips to the 'JUST RUN' cold-start hero.  
Fix: Add a post-race branch keyed off the completed A-race date (profile already carries race data): days-since-race framing, recovery guidance from the existing recoveryBrief payload, and a plan-your-next-race CTA when the plan is exhausted.  

**P2-10 · Pre-run detail body (TodayPreRunBodyV3) is unmounted — shoe picker, fueling plan, conditions grid, and adaptation context are unreachable on Today**  
_today · CONFIRMED · iPhone Today pre-run sheet + shoe tile · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: C1 'should' elements — recommended shoe (#18), fueling plan tile (#19), full conditions (#16 beyond two chips) — are absent from the live surface even though the code and backend exist. A runner heading out for an 18-mile long run gets no fueling guidance and cannot set today's shoe from the phone. When the coach adapts today's workout, nothing on Today acknowledges the change: the runner sees a different run than yesterday with zero explanation. Plus dead network cost: 4+ wasted fetches per app-foreground.  
Fix: Either re-home the shoe cell / fueling / adaptation acknowledgment into the hero or readiness panel, or delete preRunSheetContent, TodayPreRunBodyV3, the shoe-picker plumbing, and the orphaned fetches so the surface's real composition is honest.  

**P2-11 · Double-booked days (two run rows on one date) are silently collapsed to one — the second run is invisible on iPhone and can survive a replace-move**  
_today · CONFIRMED · iPhone Today week strip + DayActionSheet vs /api/plan/week · `web-v2/app/api/plan/week/route.ts`_  
Impact: After an adaptation leaves an easy 5 and a moved long 14 on the same Saturday, the phone shows only the long run: the easy run doesn't exist in the strip, hero, weekly planned-mileage chip, or the move sheet's occupancy labels — but backend weekly totals (build-workout.ts:373-377 sums all rows) still count it, so 'THIS WEEK planned' math disagrees across surfaces. A runner who taps 'Replace it' can also end up with a hidden leftover session they never see or clear.  
Fix: Unify the two priority maps into one shared constant; have plan/week emit a `secondaryRun` (or count) per day so clients can at least badge multi-booked days; make the client surface the conflict outcome ('That day already has a run — reload and retry') instead of a silent reload.  

**P2-12 · Missed-yesterday runs are never surfaced — no acknowledgment, nudge, or adjustment on Today**  
_today · CONFIRMED · iPhone Today missed-run handling · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A 3-day/week casual runner who missed yesterday's key long run opens Today and the app behaves as if nothing happened — no 'you missed your long run, want to move it to tomorrow?' even though the reschedule machinery (DayActionSheet + /api/today/reschedule) already exists and would make this a one-tap fix. For beginners, unaddressed misses compound into plan abandonment.  
Fix: On load, if yesterday had a run type with no completedRunId and no skip/sick action, render a one-line card: 'Yesterday's {tempo 5} didn't happen. Move it or let it go' wired to the existing DayActionSheet.  

**P2-13 · Metric preferences are ignored: Today hardcodes miles, min/mi and °F despite backend units settings**  
_today · CONFIRMED · iPhone Today + week ahead units · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: Any metric-preference runner (most of the world outside the US) reads every distance, target pace and temperature in the wrong unit system with no way to change it on the device. A runner who thinks in min/km cannot use the TARGET PACE hero stat at all — 5:38/mi means nothing actionable mid-run to them.  
Fix: Read the already-decoded UserSettings.units_* into a shared formatter (SettingsCache) and route all distance/pace/temp rendering through it; add the three unit rows to SettingsView.  

**P2-14 · Future-day skip has no undo and no visual acknowledgment on the selected day's hero**  
_today · CONFIRMED · iPhone Today skip/reschedule flow · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner who fat-fingers 'Skip this run' on Sunday's long run has no way to undo it from the phone — the day is greyed in the strip forever, tapping it shows the run as if still planned, and offering 'Skip or move' on an already-skipped day is incoherent. The plan-adherence record now contains a skip the runner never intended and cannot clear.  
Fix: When the selected day's PlanDay.skipped is true, render the skipped hero variant with an 'Undo skip' that calls DELETE /api/today/skip with {date}; add deleteSkip(date:) to API.swift.  

**P2-15 · WeekAheadView is unreachable (no navigation pushes .weekAhead) and carries a Sunday-mislabeled-as-MON bug plus a never-populated runId**  
_today · CONFIRMED · iPhone week ahead · `native-v2/Faff/Faff/Views/WeekAheadView.swift`_  
Impact: If any future session wires a 'This week' link (the view's header and design suggest it was meant to be linked from Train), every Sunday-long-run user — the default — sees their long run labeled MON, and tapping a done session opens the wrong screen. Today it is dead weight that will silently rot further.  
Fix: Either delete the view or fix dowFromIdx to the 0=Sun convention (reuse TodayView.dowLetter), populate runId from completedRunId, and soften the empty-state copy before wiring a route to it.  

**P2-16 · MAINTENANCE and RECOVERY plans display as 'BASE' phase with base-building copy on the iPhone Train tab**  
_train · CONFIRMED · iPhone Train tab (phase pill, hero headline, phase dividers, mesh) · `native-v2/Faff/Faff/Theme.swift`_  
Impact: A runner one week after their marathon (RECOVERY plan: 'Easy running only · no quality', week 1 at 15% volume) opens Train and is told they're in BASE phase building their aerobic engine — the opposite of the recovery doctrine the plan encodes. A no-race maintenance runner reads 'N WEEKS TO RACE' with no race booked.  
Fix: Add maintenance/recovery cases to TrainPhase (or a dedicated label + copy per phase key), and switch the FULL PLAN caption to 'N WEEKS' when state.race is nil.  

**P2-17 · Move-run flow lets a runner delete their race-day row via 'Replace it'**  
_train · CONFIRMED · iPhone Today skip/move sheet -> POST /api/today/reschedule · `web-v2/app/api/today/reschedule/route.ts`_  
Impact: Race week: a runner moves Saturday's shakeout to Sunday, taps 'Replace it', and the race row is deleted from plan_workouts — race-day mode, the race-day watch payload, and the plan's race anchor row vanish two days before the goal race. The confirmation never says the thing being replaced is the race itself.  
Fix: Exclude type='race' from replaceable targets server-side (return a distinct error), and hide race day from the DayActionSheet target list (or show it disabled with 'Race day').  

**P2-18 · No plan-end or no-plan state on the Train tab; post-plan weeks fabricate REST days on the Today strip**  
_train · CONFIRMED · iPhone Train tab + /api/plan/week · `native-v2/Faff/Faff/Views/TrainView.swift`_  
Impact: A runner the morning after completing their plan (or their race, before a recovery plan exists) opens Train and sees a giant 'BASE' headline, no this-week card, and a full-plan list with no NOW marker — no 'plan complete', no 'set your next goal'. Swiping forward on Today shows fake rest weeks stretching past the race, indistinguishable from prescribed rest.  
Fix: Detect weeks.isEmpty / all-weeks-past in TrainView and render an explicit plan-ended / no-plan state with a set-goal CTA; have /api/plan/week return days with a distinct 'none' type (or a plan_ended flag) beyond the plan range.  

**P2-19 · Kilometre preference is a dead toggle — stored, offered in web settings, consumed nowhere**  
_train · CONFIRMED · All plan/train surfaces (web + iPhone) · `web-v2/components/settings/SettingsForm.tsx`_  
Impact: A metric-preference runner (most of the world outside the US) sets Kilometers in settings, gets an ok:true response, and every plan surface — week strip, Train tab, planned detail, pace targets — continues to show miles and min/mi. The setting silently does nothing.  
Fix: Either honor units_distance/units_pace in the display layer (single formatting helper on each client) or remove the picker until it's wired — a saved-but-ignored setting is worse than no setting.  

**P2-20 · Mile-splits dashed target line is plotted on the wrong axis in pace mode — raw pace seconds against inverted (800 − secs) bar values**  
_activity · CONFIRMED · iPhone Run detail · MILE SPLITS chart · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: On every pace-led run with a planned work pace, the 'target pace' reference the chart is designed around is either invisible or a floating dashed artifact across the section above — the runner can never see how splits sat against target, and slow runners (paces near/over 13:20/mi, where 800−secs goes negative) get the most distorted geometry.  
Fix: Pass `Double(800 - splitTargetSecs)` (or better, plot on real pace seconds with an inverted domain) and clip MileBars' target path to its bounds.  

**P2-21 · %MHR / LTHR zone-method toggle is a no-op — the TIME IN ZONE chart never changes**  
_activity · CONFIRMED · iPhone Run detail · TIME IN ZONE · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: A runner who taps LTHR to see Friel-anchored zones gets an unchanged chart silently labeled as the selected method — they either distrust the app or, worse, read %MHR percentages as LTHR ones and misjudge whether their easy days were actually easy.  
Fix: Recompute zone buckets from per-split HR against hr_zones_from_lthr.ranges when method == .lthr, or remove the toggle until the recompute exists.  

**P2-22 · Untyped runs render as TEMPO in run detail: hot red mesh, pace-led splits, inconsistent with the feed's neutral 'RUN'**  
_activity · CONFIRMED · iPhone Run detail · mesh / splits mode · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: A casual no-goal runner logs a manual easy jog: the feed shows a neutral grey 'RUN', but opening it presents a hot tempo-red page whose splits are pace-led and colored as a hard session — wrong effort identity on the exact population (no-Strava, no-plan, manual/HK users) the app must be universal for, and it blocks the HR-led easy-day split view they'd otherwise get.  
Fix: Use `FaffEffort.fromType(run?.planned_spec?.kind ?? run?.type)` (matching hiwEffort) so untyped runs fall to .easy, and keep a neutral mesh while `run == nil`.  

**P2-23 · Split bar colors and 'highlight' are hardcoded to ~6:35/mi elite thresholds — meaningless for most runners**  
_activity · CONFIRMED · iPhone Run detail · MILE SPLITS (pace mode) · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: A 12:00/mi beginner's splits chart is a uniform pale-orange wall with zero color information and no split ever highlighted; a 5:30/mi runner sees every mile screaming max-red. The chart only communicates for runners who happen to run ~6:30-7:00 pace (i.e., David). Universality failure on the page's lead visualization.  
Fix: Bucket splits relative to the run's own pace distribution (as the route map already does with quintiles, RouteMapView.swift:273-281) or to the runner's target pace.  

**P2-24 · PRSheet is a fully hardcoded mock (Half Marathon 1:29:48, 'first sub-1:30', CIM sub-3 coach copy) with no data inputs, and is mounted nowhere**  
_activity · CONFIRMED · iPhone · PR celebration sheet · `native-v2/Faff/Faff/Views/PRSheet.swift`_  
Impact: Two failures in one: (a) real runners never get a PR celebration — a new user who smashes their 5K PR sees nothing; (b) the moment anyone wires this sheet up, every runner (a 35-minute 5K first-timer included) is shown David's fake HM PR and a coach line about CIM sub-3. Also violates the race-data SoT rule pre-emptively: a PR display must be driven by races.actual_result.  
Fix: Either delete the file until PR detection exists, or parameterize it (distance label, new/old times, delta, coach line) and drive it from races.actual_result-backed PR detection.  

**P2-25 · Metric-preference users get imperial-only Activity and run detail — backend units setting exists but is never honored**  
_activity · CONFIRMED · iPhone Activity + Run detail (and the /api/log · /api/runs/[id] wire) · `native-v2/Faff/Faff/Views/ActivityView.swift`_  
Impact: A metric runner (most of the world outside the US) sees every distance, pace, split, elevation, and temperature in imperial with no way to change it — 'FASTEST PACE 5:38' means nothing to someone who thinks in min/km, and a 10K reads as '6.2'. Structural blocker for the multi-user opening.  
Fix: Honor units_distance/units_pace/units_temp: either convert server-side in log-state/run-state per user settings, or ship raw seconds/meters and format client-side from the profile setting; expose the setting in SettingsView.  

**P2-26 · STATS 'RUNS' count ignores the MONTH/YEAR/ALL range picker while MILES/TIME/ELEV honor it; range labels also misname rolling windows**  
_activity · CONFIRMED · iPhone Activity · STATS tab · stat row · `native-v2/Faff/Faff/Views/ActivityView.swift`_  
Impact: A runner picks MONTH and reads '38 miles · 200 RUNS · 6h' — the run count is off by an order of magnitude versus the other stats in the same row, and early-month numbers are inflated by the prior month's tail while being labeled 'THIS MONTH'.  
Fix: Use `rangeRuns.count` for the RUNS stat; either implement calendar-month/year cutoffs or relabel to 'LAST 30 DAYS' / 'LAST 12 MONTHS'.  

**P2-27 · EXECUTION card shows the 0.7 no-data default as a measured '70%' with a warning tick**  
_targets · CONFIRMED · iPhone Targets projection panel · `native-v2/Faff/Faff/Components/Toolkit/K_TargetsProjection.swift`_  
Impact: A brand-new runner in week 1, or anyone whose quality days haven't matched a plan row yet, sees 'EXECUTION 70%' with an alert -- a precise-looking percentage fabricated from a constant, implying they've been measured under-executing before any workout was evaluated. Modeled default displayed as measurement.  
Fix: Thread a 'source: default|observed' flag alongside executionQuality (the pacing chunk already does exactly this) and render '—' or 'No read yet' when it's the default.  

**P2-28 · Race saved without a goal time renders 'On track for —.' coach copy**  
_targets · CONFIRMED · iPhone Targets projection panel · `native-v2/Faff/Faff/Components/Toolkit/K_TargetsProjection.swift`_  
Impact: A casual racer who adds a race without a time goal -- the normal case for 'just finish' runners -- gets a grammatically broken, falsely assertive coach sentence on the flagship panel. Coach-voice violation plus a claim ('on track') with nothing to be on track toward.  
Fix: When goalSec is null, switch summaryLine to a no-goal variant ('Racing NAME in N days. Set a time goal to track a projection against it.') and hide the goal-relative gap chrome.  

**P2-29 · TODAY accrued estimate conflates active-plan span with race runway, mis-stating progress when the plan is not race-aligned**  
_targets · CONFIRMED · /api/targets/projection accrued estimate · `web-v2/app/api/targets/projection/route.ts`_  
Impact: A runner two weeks into a 16-week plan who adds a tune-up race 6 weeks out gets completedWeeks = 16-6 = 10 -> completedFraction 0.63 -> the TODAY column claims ~63% of the projected fitness gain is already banked when ~12% of the work is done. The 'moving week by week' number the panel leads with is wrong whenever plan and race don't share endpoints.  
Fix: Derive completedFraction from the plan's own dates (weeks elapsed since MIN(date_iso) / totalPlanWeeks) instead of subtracting race runway, and only for the plan tied to this race (training_plans.race_id).  

**P2-30 · Ultra distances (50K-100M offered in Add Race) are predicted with the Daniels curve far outside its validity; client-side distance parse also defaults ultras and 'Other' to 13.1**  
_targets · CONFIRMED · iPhone Add Race / Targets projection + backend predictRaceTime · `web-v2/lib/training/vdot.ts`_  
Impact: An ultra racer's Targets hero grades their goal against a fantasy Daniels time (e.g. sub-13h 100-miler 'projected'), producing an absurd ON PACE/BEHIND verdict, and an 'Other'-distance racer is graded against a half-marathon projection. The picker invites exactly the runners the math can't serve.  
Fix: Gate predictRaceTime to <=26.22mi (return null beyond, letting the panel show the cold/no-projection state with honest copy), or add a Riegel-exponent extension cited from research before offering ultra distances in the picker.  

**P2-31 · Training-run VDOT anchors are labeled 'RACE EFFORT' in the anchor provenance row**  
_targets · CONFIRMED · iPhone Targets anchor row · `native-v2/Faff/Faff/Views/TargetsView.swift`_  
Impact: A tempo-derived, soft-capped training estimate is presented with race-grade provenance -- the exact source-labeling class the race-data checklist forbids (training data must never display as authoritative race performance). It also mislabels which evidence would 'a tune-up race re-rate'. Bonus hazard: a planned future race dated within a day of the run can be named as the anchor.  
Fix: Thread the anchor source ('race'|'run') through projection_snapshots/profile-state and label run anchors 'TRAINING EFFORT' (only match races rows when source='race' and the race is in the past).  

**P2-32 · Metric users: backend supports km/C units but iPhone hardcodes imperial everywhere and offers no units setting**  
_settings · CONFIRMED · iPhone Settings (weight/height/weekly target), Shoes, Health · `native-v2/Faff/Faff/Views/SettingsView.swift:603`_  
Impact: A metric-preference runner (most of the world) cannot view or enter their weight in kg, height in cm, or mileage target in km on the phone. If they set km on the web, the phone silently shows the same numbers as miles-labeled values — e.g. a '50' weekly target set thinking km is treated as 50 mi by the plan engine.  
Fix: Add a UNITS settings group writing units_* to /api/settings and thread the preference through the formatters (weight/height editors, target unit label, shoes, health cards).  

**P2-33 · Apple Health 'Connect' row is dead and 'Re-sync Health' reports fake 'Sync complete.' for never-connected users — no post-onboarding path to connect HealthKit from Settings**  
_settings · CONFIRMED · iPhone Settings > Connections · `native-v2/Faff/Faff/Views/SettingsView.swift:90`_  
Impact: A runner who skipped Health access during onboarding (privacy hesitation is common) goes to Settings → Connections — the natural place — taps 'Apple Health · Connect': nothing happens. Taps Re-sync: told 'Sync complete.' while nothing synced. Readiness, sleep, HRV stay empty forever with the app claiming success.  
Fix: Make the Apple Health row a Button that calls requestAuthAndImport when not connected; have forceHealthResync detect hasConnected==false and route to the auth flow or show 'Health not connected yet'.  

**P2-34 · No account-deletion path anywhere (app UI or backend) despite in-app account creation**  
_settings · CONFIRMED · iPhone Settings > Account + backend /api/auth · `web-v2/app/api/auth/signup/route.ts:125`_  
Impact: App Store Guideline 5.1.1(v) requires apps that support account creation to offer in-app account deletion — this is a standard rejection reason at review. Beyond compliance, a runner who wants their health/location data gone has no path.  
Fix: Add DELETE /api/auth/account (revoke sessions, delete/tombstone user rows: runs, health_samples, profile, shoes, tokens) and a confirmed 'Delete account' row in Settings > ACCOUNT.  

**P2-35 · available_days silently overrides long-run/rest/quality day edits made in Settings**  
_settings · CONFIRMED · iPhone Settings > Training + plan engine · `web-v2/lib/plan/generate.ts:3347`_  
Impact: A runner who told goal setup 'I can run Mon/Wed/Sat' later changes 'Long run' to Sunday in Settings: the save succeeds, the 'Plan updated' toast fires (rebuild ran), but the long run lands on Saturday. Settings keeps displaying 'Sunday'. The runner concludes the setting is broken; nothing explains the availability constraint.  
Fix: Expose available_days as an editable Settings field (or clear/merge it when the runner edits day preferences), and/or have the rebuild ack report the effective placement.  

**P2-36 · Deselecting all quality-day chips saves [] which permanently removes all quality workouts, while the row displays 'Not set'**  
_settings · CONFIRMED · iPhone Settings > Training > Quality days + plan engine · `web-v2/lib/plan/generate.ts:3339`_  
Impact: A runner clears the chips intending 'let the coach pick': every tempo/interval session vanishes from the rebuilt plan with zero feedback, and Settings claims the preference is unset. Their training silently loses all quality stimulus.  
Fix: Treat [] as unset (fall back to defaults) either in the editor (block save with zero selections) or in generate.ts (`quality_days?.length ? ... : ['tue','thu']`).  

**P2-37 · No way to retire, edit, or delete a shoe on iPhone even though the backend supports it**  
_settings · CONFIRMED · iPhone Shoe Garage · `native-v2/Faff/Faff/Views/ShoesView.swift:126`_  
Impact: A phone-only runner (no web use — the expected iPhone-first persona) whose shoe passes its cap is warned 'RETIRE SOON' but has no way to act: the worn shoe keeps appearing in every picker (Today override, run assignment), keeps accruing mileage, and typos in brand/model/cap made at creation are permanent.  
Fix: Add swipe/context actions (Retire, Edit, Delete, Mark race shoe) on ShoeDetail rows wired to PATCH/DELETE /api/shoe.  

**P2-38 · ProfileView sign-out skips the multi-user hygiene cleanup that SettingsView performs; cycle flag never cleared by either**  
_settings · CONFIRMED · iPhone Profile / Settings sign-out · `native-v2/Faff/Faff/Views/ProfileView.swift:177`_  
Impact: User A signs out via the Profile page button; user B signs in on the same device and the Health sleep pane shows A's last-night sleep hours until B's first HK sync — the exact cross-user leak already fixed once on the Settings path. B also inherits A's cycle-ingest enablement state.  
Fix: Extract one shared signOut() helper (clear token, onboarded flag, StravaConnection, lastNightHours stash, cycleEnabled, AppCache) used by both views; also POST /api/auth/logout to revoke the server session (currently never called — grep 'logout' in Swift returns nothing, while app/api/auth/logout/route.ts claims the iPhone relies on it).  

**P2-39 · Health '+ log' sheet is decorative — fields aren't editable and Save silently does nothing**  
_settings · CONFIRMED · iPhone Health tab log sheet · `native-v2/Faff/Faff/Views/HealthView.swift:922`_  
Impact: The users who most need manual logging are exactly the universality personas without a watch (no auto RHR/sleep/HR). They open the sheet from a prominent '+' button, can't enter anything, tap Save, get no error — and conclude logging worked or the app is broken. Also WEIGHT is hardcoded 'lb' (line 941).  
Fix: Either wire the fields to real endpoints or remove the '+' entry points until v2 lands; at minimum disable Save.  

**P2-40 · Manual timezone picker offers only 15 zones — most of the world can't pin their timezone**  
_settings · CONFIRMED · iPhone Settings > Timezone · `native-v2/Faff/Faff/Views/SettingsView.swift:686`_  
Impact: A runner in Brazil/India/South Africa/NZ who flips 'Auto-update on travel' off must pick a wrong timezone; their daily plan, readiness day-boundaries and briefing times all shift by hours. The save path validates any IANA name server-side, so this is purely a client list gap.  
Fix: Populate the picker from TimeZone.knownTimeZoneIdentifiers (searchable list), always including the currently-stored zone.  

**P2-41 · Race execution plan is half-marathon-templated: 'BY MILE 5' B-goal trigger, 'push the last 5K' strategy, and broken 5K split arithmetic for short races**  
_raceday · CONFIRMED · backend execution-plan composer + iPhone race-week brief · `/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/race/execution-plan.ts`_  
Impact: A 25:00-goal 5K runner in race week is told the abort checkpoint is mile 5 of a 3.1-mile race and offered a 32:00 B-goal (+28%); a 10K runner gets a checkpoint at mile 5 of 6.2 (too late to act). The doctrine cited (Research/08 §3.4) is the HM template applied to every distance. Currently partially masked by the distanceMi bug (finding 1), but becomes live the moment that is fixed.  
Fix: Scale the checkpoint (~40% of race distance), B-goal offset (% of goal), warm-up, and strategy copy by distance category; fix the repayMiles clamp for races barely over the 3-mile early window.  

**P2-42 · Runner cannot log their race result on race day — the retro only unlocks the next calendar day**  
_raceday · CONFIRMED · iPhone RaceDayView post-race state + races-state · `/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/coach/races-state.ts`_  
Impact: A runner who finishes their HM at 9am and wants to log the chip time that afternoon (the moment they actually do it) finds no entry point anywhere on the phone until the next day — delaying the VDOT recalibration, plan archive, and next-plan generation that /api/race/result triggers, and increasing the odds the result is never logged and the Strava-matched provisional time (finding 3) takes over.  
Fix: Treat a race as retro-eligible once the run for its day is completed or once local time is past the gun (e.g. days<=0), not only when date < today.  

**P2-43 · Phone fueling card and watch gel cues disagree whenever the runner has not entered their own fuel**  
_raceday · CONFIRMED · backend race composition (phone vs watch payloads) · `/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/watch/build-workout.ts`_  
Impact: On race morning a marathoner reads 'take one at mile 4 · 8 · 12 · 16 · 20' on the phone brief, then the watch buzzes FUEL at miles 5 · 9 · 13 — two competing gel timelines mid-race, exactly the 'competing fueling UI' failure the RaceDayView comments (line 1346-1353) say was already purged once.  
Fix: Make computeRaceFueling the single source for gelsMi in build-workout's race branch (it already handles the entered-fuel case), dropping the spec fuel_mi and computeFueling fallbacks.  

**P2-44 · No race-day mode at all for a racer without an active plan (short-runway races, casual users)**  
_raceday · CONFIRMED · iPhone Today takeover + watch payload gating · `/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/watch/build-workout.ts`_  
Impact: A runner who adds their A-race 10 days out (plan generation declines) or a casual runner with a parkrun on the calendar wakes up on race morning to a normal easy-day Today page and a watch that offers yesterday-style training or 'Nothing on the calendar' — no countdown takeover, no race workout, no goal-delta face. The race-day experience is entirely plan-mediated even though the races table knows today is race day (profile.nextARace.days_to_race == 0 is already available to the client).  
Fix: Let the Today gate fall back to nextARace.days_to_race == 0 alone (without requiring a plan race row), and have buildWatchToday synthesize a race payload from the races row when a plan is absent but an A/B race is today.  

**P2-45 · Treadmill console never disables the idle timer — phone auto-locks mid-run, app suspends, guided segments mangle and distance is credited at a stale speed**  
_treadmill-strength-notif · CONFIRMED · treadmill · `native-v2/Faff/Faff/Views/TreadmillView.swift`_  
Impact: Default iOS auto-lock is 30s–1min; a runner who racks the phone on the treadmill tray gets exactly this on their first guided session: interval workouts recorded with wrong per-phase durations/distances, total distance skewed by whichever speed was last entered, and no visible console for the rest of the run. In a forgot-to-End case the accumulated phantom distance can exceed the backend's 50 mi ceiling (complete/route.ts:158-160 → 400), after which the save can never succeed and the run is lost.  
Fix: Set UIApplication.shared.isIdleTimerDisabled = true while the session is playing (reset on end/disappear); clamp the resume delta (e.g. pause automatically when delta > ~120s) and cap client-side distance below the server ceiling.  

**P2-46 · Treadmill console is mph/miles only — metric-preference runners cannot enter km/h treadmill speeds; units_distance setting exists but is ignored**  
_treadmill-strength-notif · CONFIRMED · treadmill · `native-v2/Faff/Faff/Views/TreadmillView.swift`_  
Impact: Universality: treadmills in metric countries display km/h. A metric runner must mentally convert km/h→mph on every segment or their logged speed/distance is wrong by 1.6x. Entering their treadmill's '10.0' (km/h) as 10.0 mph records a 6:00/mi effort instead of 9:39/km easy jog — corrupting pace history, VDOT inputs and plan adherence.  
Fix: Read units_distance/units_pace from settings; render steppers, pace and distance in the runner's unit and convert once at payload-build time (wire stays mph/mi).  

**P2-47 · Lock-screen action acks fire in a detached Task with completionHandler called immediately — background acks (READY/SOLID/BETTER) can be lost to suspension**  
_treadmill-strength-notif · CONFIRMED · notifications · `native-v2/Faff/Faff/NotificationsAppDelegate.swift`_  
Impact: The whole point of inline actions is answering from the lock screen without opening the app. A runner taps SOLID on the weekly check-in; the process suspends mid-POST; the rating never lands; no retry exists. Same for un-skipping (READY) and niggle trends — the coach state silently misses the answer the runner believes they gave.  
Fix: Wrap the ack in a UIApplication.beginBackgroundTask / endBackgroundTask pair (or a background URLSession upload task), and only call completionHandler after the POST settles or the assertion expires.  

**P2-48 · Inbox promises 'Tap a row to ack from here' but rows have no tap handler — in-app acking is impossible**  
_treadmill-strength-notif · CONFIRMED · notifications · `native-v2/Faff/Faff/Views/NotificationInboxSheet.swift`_  
Impact: A runner who dismissed the lock-screen notification (the common case) opens the inbox expecting to answer the weekly check-in or niggle check and finds inert rows. Pending check-ins go permanently unanswered; the copy actively misleads.  
Fix: Either add per-category action buttons on unacked rows (POST /api/notifications/ack with the row's dedup_key/id) or change the header copy until that ships.  

**P2-49 · Watch treadmill HR session can run indefinitely: stop message is only sent when the watch is reachable, and the watch has no timeout**  
_treadmill-strength-notif · CONFIRMED · treadmill HR streaming · `native-v2/Faff/Faff/WatchSync.swift`_  
Impact: Runner ends the treadmill session while the watch is briefly out of range (phone on the treadmill, watch on wrist across the gym floor, or phone battery dies): the watch silently keeps an indoor workout session running for hours — major battery drain and continuous HR sampling — with nothing on the watch face explaining why unless they open the app. The 'runner's looking at their phone, not the watch' design premise makes discovery unlikely.  
Fix: Retry the stop via transferUserInfo (delivered on next connection) and add a watch-side dead-man timer (e.g. end the session if no phone ping for N minutes, phone sends a periodic keepalive while TreadmillView is active).  

**P2-50 · Strength session content (the 20-minute exercise prescriptions) is generated but never surfaced anywhere — the chip says 'recommended' with no what, no how, no tap**  
_treadmill-strength-notif · CONFIRMED · strength · `web-v2/lib/coach/strength-recommender.ts`_  
Impact: The documented failure mode this code was written to fix is still live: a runner sees 'Strength recommended' with no session content, no intensity (heavy PM vs maintenance), and no one-tap log — for beginners especially, the nudge stays wallpaper and the 17-skips-in-28-days pattern continues. Doctrine detail (heavy-PM-after-quality pairing) is computed then discarded.  
Fix: Forward picks (not just dates) through training-state/glance payloads and render a tappable session sheet (exercises + 'Log it' → POST /api/strength) from the chip.  

**P2-51 · /api/strength hk_uuid upsert has no owner guard — an authenticated user POSTing another user's hk_uuid mutates that user's row**  
_treadmill-strength-notif · CONFIRMED · strength · `web-v2/app/api/strength/route.ts`_  
Impact: Any authenticated user (multi-user signup is open) who guesses/replays another runner's HKWorkout UUID can rewrite that runner's strength session date/type/duration — corrupting their habit signal, weekly counts and roll-forward. Low likelihood, but it is a cross-user write with a one-line fix, inconsistent with the repo's own locked doctrine.  
Fix: Append `WHERE strength_sessions.user_uuid = EXCLUDED.user_uuid` to the DO UPDATE and treat rowCount=0 as a loud refusal, mirroring the watch/complete guard.  

**P2-52 · Weekly check-in mileage is anchored to ISO Monday, contradicting the app's long-run-day week boundary**  
_treadmill-strength-notif · CONFIRMED · notifications · `web-v2/app/api/cron/notifications/route.ts`_  
Impact: A Saturday-long runner's Sunday-20:00 check-in totals a Monday-Sunday window that splits their training week in two — actual vs planned miles in the notification won't match TRAIN/Today, and the SOLID/TIRED/WRECKED answer rates the wrong week. (Currently unreachable because of the runs.start_time column bug, but will surface as soon as that is fixed.)  
Fix: Reuse the long_run_day weekWindowFor helper when computing week_start, and fire the check-in on the runner's week-end day rather than hardcoded Sunday.  

**P2-53 · HR sensor dropout freezes the last reading into all downstream data — per-phase avgHr, max ceiling alerts and HR samples silently use stale values**  
_watch-engine · CONFIRMED · Watch workout engine + tracker · `native-v2/Faff/FaffWatch Watch App/WorkoutTracker.swift`_  
Impact: A loose band that stops reading at minute 10 of a 60-minute run yields a completion whose avgHr/maxHr and per-phase HR timelines are fabricated from a frozen value; the easy-face HR guardrail either red-alerts permanently or never alerts, and readiness/recap consumers ingest the poisoned HR as real.  
Fix: Track lastHrSampleAt in the tracker; zero/nil the published HR (and skip aggregate accumulation) when no sample has arrived for ~15-30 s, and surface '♥—' on the faces.  

**P2-54 · Battery death mid-run loses the entire run even though a recovery snapshot with all banked results exists**  
_watch-engine · CONFIRMED · Watch crash recovery · `native-v2/Faff/FaffWatch Watch App/WorkoutRootView.swift`_  
Impact: A runner whose watch battery dies at mile 16 of an 18-mile long run recharges, opens the app, and finds nothing — no run row, no partial credit, silently. The snapshot that could have salvaged 16 miles of banked phase data is deliberately deleted.  
Fix: In the no-session-but-snapshot branch, build completionFromRecovery(snapshot:, stats: zeros) from the snapshot's banked results and send it (status 'partial') before clearing the snapshot.  

**P2-55 · Crash-RESUME completion under-reports duration but keeps full distance — average pace is skewed fast**  
_watch-engine · CONFIRMED · Watch crash recovery · `native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift`_  
Impact: A 3-minute crash gap on a 60-minute run produces a stored run ~5% faster than reality; pace-graded consumers (verdicts, recap, VDOT-adjacent reads) see a run the athlete never ran.  
Fix: On resume, either credit the dead window into bankedSec (HK's builder.elapsedTime is available as ground truth) or report duration from the recovered builder at finish, matching the distance span.  

**P2-56 · Distance-based phases have no time fallback — a runner who denied HealthKit (or whose session fails to start) is stuck with a workout that never advances**  
_watch-engine · CONFIRMED · Watch workout engine · `native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift`_  
Impact: A privacy-conscious user who tapped Don't Allow on Health access starts a 5 mi easy run: the watch shows 0.00 mi, never advances, never fires the near-end cue, and the run only ends via manual End → status 'abandoned' with no distance. No message ever tells them why.  
Fix: Fall back to durationSec (e.g. at 1.5× the estimate) when a distance phase has seen no distance movement, and surface a 'no distance source' state when the session fails to start.  

**P2-57 · Metric-preference runners get an entirely imperial watch — units settings exist in the backend but never reach the watch payload or faces**  
_watch-engine · CONFIRMED · Watch workout engine + all faces · `web-v2/lib/watch/build-workout.ts`_  
Impact: A km-preference runner (most of the world) sees paces in min/mi, distance in miles, splits per mile, and targets like '6:47' that mean nothing in their mental model — on the surface where glance-speed comprehension matters most (mid-run, at arm's length).  
Fix: Thread a units flag through /api/watch/today into WatchWorkout and add a display-layer conversion (engine math can stay mi-internal); convert split-crossing boundaries to km when metric.  

**P2-58 · Toggling Sound ON mid-run produces no chimes for the rest of the workout — the audio session was never activated and cannot be activated safely mid-session**  
_watch-engine · CONFIRMED · Watch in-run controls / audio · `native-v2/Faff/FaffWatch Watch App/WorkoutTracker.swift`_  
Impact: A runner who starts muted and taps Sound ON at mile 2 (e.g. to hear interval countdown beeps) sees the button flip to 'Sound' but hears nothing for the entire run — the countdown/split/fuel chimes silently never play until the next workout.  
Fix: Restore unconditional ChimePlayer.activate() before startActivity() (activation alone is silent; the W-6 'audio blip' concern should be re-verified), or disable/annotate the toggle mid-run when the session isn't active.  

**P2-59 · NumberFace top label has no width cap — long race names and 'REP n/m · ♥nnn' labels run under the OS clock and off-screen**  
_watch-faces · CONFIRMED · LobbyFace (race day), WorkIntervalFace top label · `legacy/native/Faff/FaffWatch Watch App/FaceKit.swift:455-462`_  
Impact: Any runner whose goal race has a real-world name — 'CALIFORNIA INTERNATIONAL MARATHON', 'ROCK N ROLL HALF MARATHON' — gets a race-morning lobby whose title collides with the watchOS clock and clips past the right edge (fixedSize prevents truncation). Threshold sessions with an HR reference intrude into the clock zone on 41mm where the scaled canvas is tighter. This is the exact failure the codebase has already fixed twice elsewhere.  
Fix: Apply the same clock-clear width cap to topLabel in NumberFace (max width = clockClearF·W − alignmentX, lineLimit(1) + minimumScaleFactor + tail truncation), and/or cap the lobby race name like SummaryView does.  

**P2-60 · Pause face shows raw-minute elapsed past one hour — '130:12' on a paused long run**  
_watch-faces · CONFIRMED · LivePauseFace · `legacy/native/Faff/FaffWatch Watch App/ActiveWorkoutView.swift:42`_  
Impact: A marathoner or 3-hour long-run user (or any 12+ min/mi runner covering ordinary distances — slow pace makes >1 h runs the NORM, not the edge) who pauses at 2:10:12 sees '130:12', which at a glance reads as a pace or a corrupted number rather than elapsed time. The one face where the runner is standing still reading carefully is the one with the broken format.  
Fix: Use the same `totalElapsedSec >= 3600 ? PaceFormat.hms : PaceFormat.clock` branch as LiveSteady/LiveInRunStats.  

**P2-61 · Brief §1 hex-lint CI check is not implemented; watch faces carry ~10 off-palette hexes the palette-sync script cannot see**  
_watch-faces · CONFIRMED · Palette enforcement / Faces.swift + FaceKit.swift backgrounds · `scripts/check-palette-sync.sh:152-163`_  
Impact: The design system's central promise — byte-identical, ten-hex color authority with CI teeth — is unenforced exactly where drift happens. The washes are plausibly David-approved as part of the locked face redesign, but they are undocumented in the brief and invisible to the gate, so the next 25th-orange-style drift on any surface will also pass CI. Spec violation + enforcement gap rather than a runner-facing bug.  
Fix: Either add the wash/chrome hexes to the brief as a sanctioned 'watch face wash' group (like the phase-identity addendum) and assert them in check-palette-sync.sh, or implement the promised allowlist hex-lint (grep all hexes, fail on anything outside table+neutrals+rulings).  

**P2-62 · 50-mile distance ceiling returns 400, which both durable queues dead-letter — an ultra run is silently and permanently lost**  
_sync · CONFIRMED · watch completion round-trip + HK ingest (offline queueing / dead-letter policy) · `web-v2/app/api/watch/workouts/complete/route.ts`_  
Impact: The plan engine explicitly supports ultra runners (ultra fixes are in the plan-engine audit history). A runner who completes a 100K (62 mi) or 100-mile race on the Faff watch gets zero record of it: the completion is rejected, dead-lettered on both lanes, and the HK fallback is rejected by the same ceiling. No error is ever surfaced — the watch shows 'Sent'-adjacent state and the biggest run of the runner's life vanishes. Strava sync is the only path that could save it, and no-Strava users have none.  
Fix: Raise the ceiling (e.g. 150 mi) or replace the hard 400 with accept-and-flag (store with a `distance_suspect` flag excluded from volume until reviewed). At minimum, return the sub-threshold-style 200+dropped shape so the queues drop it intentionally and the client can surface 'run rejected' instead of silence.  

**P2-63 · iPhone never renders plan_workout_proposals — propose-first adaptations are invisible to phone-only runners and expire silently**  
_adaptation · CONFIRMED · phone rendering of adapter output · `web-v2/lib/plan/workout-proposals.ts`_  
Impact: The 'runner stays in the driver's seat' flow (built after David's explicit complaint about overnight changes) doesn't exist on the primary surface. Proposed pullbacks and (due to the misrouting bug) anti-stacking downgrades die in a table nobody sees, so the plan stays wrong AND the runner was never asked.  
Fix: Expose pending proposals in the glance/today payload the iPhone already fetches, and render an accept/keep banner in TodayView; or, until that ships, stop routing safety-critical downgrades through the proposal path.  

**P2-64 · Reschedule never updates week_id — weekly planned totals disagree with the days actually shown**  
_adaptation · CONFIRMED · adaptation engine → phone week header · `web-v2/lib/plan/adapt.ts`_  
Impact: David's current-week header on phone/web under-reports planned mileage by the 8mi tempo that visibly sits on Jul 8, while the prior week's total still contains a workout that no longer exists in that week. Any runner whose workout is rescheduled across a week boundary gets planned-vs-shown mismatches in every week_id-based aggregate.  
Fix: On reschedule, re-resolve week_id from the new date (plan_weeks row containing newDate), or migrate all weekly aggregates to date-window queries like /api/plan/week already uses.  

**P2-65 · adapt-block.ts (48h hard-easy spacing forward reasoning) is dead code — zero callers**  
_adaptation · CONFIRMED · adaptation engine (block-level reasoning) · `web-v2/lib/plan/adapt-block.ts`_  
Impact: The plan-engine's documented Phase 1.3 protection (hard-easy spacing after adaptations) is advertised in architecture docs and citations but never executes for any runner. Spacing violations ship straight to the plan.  
Fix: Wire the cron through detectBlockAdaptations/applyBlockAdaptation (fixing its <=1-day threshold to a true 48h check against the post-reschedule layout), or delete it and implement spacing checks inside actionsForTrigger.  

**P2-66 · Adaptive upward ramp can never fire: gates read run types ('threshold'/'tempo'/'long') that the runs table never contains; cooldown reads an intent reason that is never written**  
_adaptation · CONFIRMED · adaptation engine (adaptive-ramp) · `web-v2/lib/plan/adaptive-ramp.ts`_  
Impact: The entire push-up-when-green feature (David's explicit 2026-06-02 ask) is silently inert for every runner. Failure direction is safe, but it's a shipped feature that has never once executed, and the broken cooldown would make its eventual unblocking unsafe (daily bumps).  
Fix: Match completed runs to plan_workouts by date (as the seal logic does) instead of trusting a run-side type field that Strava/HK ingest never sets; align the cooldown reason string with the writer.  

**P2-67 · No race-proximity or taper guard on rescheduling — a missed key can be rescheduled into race week, the day before, or onto race day**  
_adaptation · CONFIRMED · adaptation engine (race awareness) · `web-v2/lib/plan/adapt.ts`_  
Impact: During the highest-stakes window (taper/race week) the adapter behaves exactly as it does in week 4 of base — for any racer at any distance, one missed session plus two cron passes can put quality inside the 72h pre-race window.  
Fix: Gate all missed-workout actions on days-to-race and phase: inside taper, missed quality is dropped (doctrine: fitness is banked, never crammed) with a coach note; never reschedule to a date >= race_date - 2.  

**P2-68 · pr_bank / goal_changed 'mark paces stale' action has no consumer — promised pace recompute never happens, and the marker string accumulates in notes**  
_adaptation · CONFIRMED · adaptation engine (pace recalibration loop) · `web-v2/lib/plan/adapt.ts`_  
Impact: A runner who PRs a race (>1.5 VDOT jump) or edits their goal is told internally that paces will update, but every future quality day keeps the old pace targets until some unrelated full rebuild happens. For a fast-improving beginner this leaves weeks of quality prescribed at stale, too-easy paces.  
Fix: Replace the marker with an actual recompute: call the same rebuildWorkoutDerivations path (adapt.ts:445) with the new VDOT/goal-derived T-pace for the marked rows, or route pr_bank/goal_changed through fireAutoRebuild.  

**P2-69 · Goal-gap widening auto-rebuild dedupe is broken by construction (plan_id passed as '') — only a 60-second window prevents nightly full plan rebuilds**  
_adaptation · CONFIRMED · cron /api/cron/plan-drift · `web-v2/app/api/cron/plan-drift/route.ts`_  
Impact: Any runner whose projection stays 'widening' for 3+ consecutive days gets their ENTIRE plan regenerated by generatePlan every night — dates, workout IDs and any accepted adaptations reshuffled daily. A runner in a rough patch (post-illness, heat wave) experiences a plan that won't hold still.  
Fix: Pass the real plan id and match on the reasons->>'drift_kind' actually written ('goal_gap_widening' inside a 'goal_time_changed' row), or add a 7-day cooldown on source='goal_gap_cron_auto'.  

**P2-70 · Targets projection anchors to 13.1 mi for any ultra distance label**  
_archetypes · CONFIRMED · Phone Targets tab (projection panel) · `native-v2/Faff/Faff/Views/TargetsView.swift:390`_  
Impact: A runner training for a 50K sees a fitness projection computed for a half marathon presented as their race projection — plausible-looking but wrong numbers on the goal surface.  
Fix: Extend both label parsers with the ultra distances the add sheet offers (and share one label→miles helper with the backend instead of four divergent copies: TargetsView, race/route.ts, race-lookup.ts, generate.ts).  

**P2-71 · Watch payload falls back to 9:00/mi for unpaced phases — duration estimates and the fueling gate skew wrong for slow and by-feel runners**  
_archetypes · CONFIRMED · Backend watch payload → phone hero est time, watch lobby time, fueling · `web-v2/lib/watch/build-workout.ts:411`_  
Impact: A 12:30/mi by-feel beginner's 6 mi long run shows ~54 min instead of ~75 min on both phone and watch, and runs that genuinely cross the 60-90+ min fueling thresholds can be gated as 'no fuel needed'. Calibration-mode runners (paces intentionally absent) are exactly the users hit.  
Fix: Derive the fallback pace from the runner's recent easy-pace median (the backend already computes it for the plan generator) or from profile VDOT, instead of a fixed 540.  

**P2-72 · Watch/phone easy-run HR ceiling ignores the authored spec and uses LTHR-first instead of the locked MAX(89% LTHR, 78% HRmax) doctrine**  
_accuracy · CONFIRMED · watch HR ceiling + phone Today HR cap vs plan spec · `web-v2/lib/watch/build-workout.ts`_  
Impact: For runners whose HRmax is high relative to LTHR (typically less aerobically trained — exactly the beginners), the watch red-alerts through honest easy runs the plan itself sanctions; two surfaces show different HR caps for the same run. This is a second zone engine diverging from the canonical one — the class of bug the codebase's own comments forbid.  
Fix: build-workout should read workout_spec.hr_cap_bpm when present (it already prefers spec for pace and quality HR), falling back to the shared hrCapEasy() helper — import it from spec-builder rather than re-deriving inline.  

**P2-73 · Metric units are a dead setting: units_distance/units_pace exist in the API but no surface sets them and no display converts — the whole app is miles-only**  
_accuracy · CONFIRMED · all surfaces (settings, Today, watch, run detail) · `web-v2/app/api/settings/route.ts`_  
Impact: Any metric-preference runner (most of the world outside the US) sees every distance, pace, and target in miles and min/mi with no way to change it — paces like '8:37/mi' are unusable numbers for a runner who thinks in min/km. Fails the universality bar and the app's own feature spec.  
Fix: Either implement the setting end-to-end (settings UI on phone+web, a format layer keyed off units_distance on each surface, km-based watch phases) or remove the dead keys from the API whitelist and spec until built — a setting that accepts writes and changes nothing is worse than absent.  

**P2-74 · PATCH /api/plan/workout updates every row on the date — moving/editing a run also rewrites co-located rows**  
_accuracy · CONFIRMED · web plan editor endpoint · `web-v2/app/api/plan/workout/route.ts`_  
Impact: Editing or moving 'the run on Wednesday' silently retypes/moves ALL rows on that date — e.g. on the live 2026-07-08 double-booked day, a PATCH would convert both the tempo and the easy row, or move both to the new date, compounding the adapter corruption. Distance edits overwrite both rows to the same value.  
Fix: Target a single row: require a workout id (the [id]/accept-standing route already takes one), or at minimum add the same running-row priority selection the read paths use plus LIMIT 1, and assert rowCount === 1.  

**P2-75 · Greeting falls back to the literal name 'David' for any user whose profile.full_name is null**  
_hardcode · CONFIRMED · Web Overview greeting + seed user block (any user with a cleared/missing name) · `web-v2/lib/coach/glance-state.ts`_  
Impact: A stranger who blanks their name in Settings (or any signup path that doesn't set full_name) is greeted 'David' across the Overview — another user's name leaking into their UI. Trivially wrong for a multi-user product now that signup is open.  
Fix: Fall back to a neutral string ('there' / null and let the client render 'You', which seed.ts already does).  

**P2-76 · App is imperial-only end to end — no unit preference exists for metric runners**  
_hardcode · CONFIRMED · All surfaces (onboarding, plan, watch, run detail, weather) for metric-preference users · `native-v2/Faff/Faff/Views/OnboardingView.swift`_  
Impact: A runner anywhere outside the US (or any km-native runner) must mentally convert every number in the app: weekly volume questions at onboarding, every pace target the watch coaches to mid-run, every recap. The universality brief lists metric-preference users explicitly; today there is no path for them. Not a data bug, but a whole-cohort UX exclusion.  
Fix: Add a units preference (profile column + formatter layer); at minimum stamp it at onboarding from Locale.current.measurementSystem.  

**P2-77 · Missed-quality reschedule lands on an unconditional today+2 date: no race-day, rest-day, or same-day-collision guard**  
_doctrine · CONFIRMED · backend plan adapter · `web-v2/lib/plan/adapt.ts:1078-1090`_  
Impact: A runner who misses Tuesday threshold in race week finds a full threshold session inserted on Friday, two days before their goal race; a 3-day/week runner can find quality dropped onto a day they told the app they never run, or stacked on top of their long-run day.  
Fix: Guard the reschedule: skip entirely inside the taper/race-week window, choose the runner's next available running day (respecting long_run_day/rest prefs), and drop the action if no valid day exists before the next quality or the race.  

**P2-78 · units_distance / units_pace / units_temp settings exist and are editable but no surface consumes them — metric-preference users flip to km and nothing changes anywhere**  
_doctrine · CONFIRMED · web settings + all rendering surfaces (web, iPhone, watch) · `web-v2/components/settings/SettingsForm.tsx:65-72`_  
Impact: A metric-country runner (most of the world) sets km + min/km in Settings, the save succeeds, and every screen — Today, plan, run recaps, watch targets, weather — continues in miles, min/mi, and Fahrenheit. The toggle silently does nothing, which reads as a broken app to any non-US user and makes prescribed paces effectively unusable for someone who thinks in min/km.  
Fix: Either wire a shared unit-formatting layer that reads user_settings on every distance/pace/temp render (web + native), or remove the dead pickers until conversion is actually implemented so the setting doesn't lie.  


### P3 (39)

**P3-1 · Terms & Privacy 'links' on the sign-in screen are decorative — they route nowhere**  
_onboarding · UNVERIFIED-P3 · iPhone sign-in · `native-v2/Faff/Faff/Views/SignInView.swift:126`_  
Impact: A new user tapping the underlined 'Privacy Policy' before entrusting health data gets nothing. Also an App Store review risk: apps that collect health data must have a reachable privacy policy; a dead link styled as tappable invites rejection during external TestFlight/App Review.  
Fix: Attach real URLs (Link or .environment(\.openURL)) to hosted Terms/Privacy pages, or unstyle the words until pages exist.  

**P3-2 · Apple Health row shows 'Connected' even when the runner denied every read permission**  
_onboarding · UNVERIFIED-P3 · iPhone onboarding connect step · `native-v2/Faff/Faff/Views/OnboardingView.swift:338`_  
Impact: A privacy-cautious runner who taps Connect but toggles everything off in the HK sheet sees green 'Connected', the app records a Health connection, and no data ever arrives — readiness/health surfaces stay empty with no hint that permissions are the cause. The '0 imported' final subtitle is the only (easily missed) signal.  
Fix: After the first import completes with zero samples of every type, flip the row to a 'Connected — nothing readable yet. Check Settings > Health > Data Access' state instead of plain Connected, and skip the health_connected_at patch when the import returned zero rows.  

**P3-3 · Real sub-10°F cold readings are discarded as sensor glitches, hiding temperature and the COOLER tag in winter**  
_today · UNVERIFIED-P3 · iPhone Today weather chip / conditions · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner in Minneapolis at 5°F in January — a real, common training condition — gets no temperature chip and no cold-adjustment cue, precisely when kit and pace guidance matter most. The 0°F-default bug this guard fixed should be distinguished by a sentinel, not by clipping the real range.  
Fix: Have the backend emit tempF as optional/null when unfetched instead of 0, then drop the >10 floor (keep a sanity floor like > -60).  

**P3-4 · Strength tile: done-state only tracks the current week, and strengthSuppressed is fetched but never rendered**  
_today · UNVERIFIED-P3 · iPhone Today strength tile + week strip underline · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner reviewing last week sees strength days they completed still marked as merely 'recommended' (blue, not green), under-crediting adherence; the week-level paused explanation the comment promises never appears, so a readiness-suppressed week just looks like the recommender forgot.  
Fix: Extend completedStrengthDays/pausedStrengthDays to all returned weeks in /api/training/state (or union client-side like recommendedStrengthDays), and either render the suppressed note or delete the state.  

**P3-5 · TodayShoeOverrideSheet is dead code duplicating TodayShoePicker**  
_today · UNVERIFIED-P3 · iPhone Today shoe override · `native-v2/Faff/Faff/Views/TodayShoeOverrideSheet.swift`_  
Impact: Two parallel shoe-picker implementations with different data sources guarantees drift; the next agent wiring 'shoe tile' has a 50% chance of mounting the broken one.  
Fix: Delete TodayShoeOverrideSheet.swift and keep TodayShoePicker (backed by /api/shoe) as the single implementation.  

**P3-6 · No pull-to-refresh on Today (C1 must #43); recovery from stale data requires backgrounding the app**  
_today · UNVERIFIED-P3 · iPhone Today sync affordance · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A runner who finishes a watch run and keeps the app foregrounded has no gesture to pull the completed run in; they must background/foreground the app or wait for a strip-day tap. Combined with the loud FailedLoadBanner only rendering when plan==nil (229), a stale-but-cached surface offers no manual recovery path.  
Fix: Add .refreshable { await loadAll() } to the pre-run ScrollView and the post-run/past-day scroll containers.  

**P3-7 · Train tab 'Plan adjustments' window hardcodes ISO-Monday week start, ignoring the runner's long-run-day boundary**  
_train · UNVERIFIED-P3 · iPhone Train tab adjustments expander · `native-v2/Faff/Faff/Views/TrainView.swift`_  
Impact: A Saturday-long runner whose plan was adapted on Sunday (their week's first day) doesn't see that adaptation in 'Plan adjustments this week' until Monday, and sees last week's Sunday adaptations attributed to this week.  
Fix: Derive the since-date from the same long-run-day window the backend uses (expose week_start in /api/training/state, which already loads settings).  

**P3-8 · PlannedView and WeekAheadView are orphaned routes; WeekAheadView labels every Sunday row 'MON'**  
_train · UNVERIFIED-P3 · iPhone plan detail navigation · `native-v2/Faff/Faff/Views/WeekAheadView.swift`_  
Impact: No direct user harm today (unreachable), but PlannedView is the only surface with the full session shape/paces/fuel breakdown — the Train tab's promise of a per-session detail page is silently gone, and if either view is re-linked the Sunday='MON' bug and the sign-out advice ship with it.  
Fix: Either re-link PlannedView from TrainView day rows (undone days) or delete both views; fix dowFromIdx to the 0=Sun basis if kept.  

**P3-9 · Tapping a far-future day in Train's calendar strands the Today week strip**  
_train · UNVERIFIED-P3 · iPhone Train tab -> Today tab handoff · `native-v2/Faff/Faff/Views/TodayView.swift`_  
Impact: A marathoner exploring week 10 in the Train calendar taps Tuesday's tempo and lands on Today with the hero showing that session but the week strip still highlighting the current week — the selected date isn't visible anywhere, and swiping the strip can silently reset the selection.  
Fix: Clamp Train-tab taps beyond the strip horizon to open a detail (e.g. reuse PlannedView) instead of jumping tabs, or extend allStripWeeks on demand to the jumped week.  

**P3-10 · ROUTE section renders an empty 'NO GPS TRACK' card for runs that have a start point but no polyline**  
_activity · UNVERIFIED-P3 · iPhone Run detail · ROUTE · `native-v2/Faff/Faff/Views/RunDetailView.swift`_  
Impact: Runners with Strava privacy zones or GPS-start-only records get a dead ROUTE section advertising a map that will never appear, on every such run.  
Fix: Gate the native section on `route_polyline != nil` (or make the server only set has_route when a decodable polyline exists).  

**P3-11 · Goal-mode runner with no VDOT gets no cold-state panel at all**  
_targets · UNVERIFIED-P3 · iPhone Targets (goal-mode) · `native-v2/Faff/Faff/Views/TargetsView.swift`_  
Impact: A new no-race goal runner (no baseline yet) sees just their goal card with zero explanation of why there's no projection or what unlocks it, while an identical race runner gets the 'need a clean baseline run' guidance.  
Fix: Render TargetsProjectionColdState in goalHeroBlock when projectionLoaded && vdot == nil, mirroring heroBlock.  

**P3-12 · WithinReachSheet is dead code built entirely from hardcoded fake race data**  
_targets · UNVERIFIED-P3 · iPhone (unmounted sheet) · `native-v2/Faff/Faff/Views/WithinReachSheet.swift`_  
Impact: No user impact today, but it is a loaded gun: if any future session mounts it (the onAccept/onLater API invites it), every runner sees a fabricated 5K PR and a fake measured gap -- the hardest form of modeled-as-measured. It also decays the codebase's 'values are REAL' doctrine stated in sibling components.  
Fix: Delete it, or park it under a Previews/mockups target until a real within-reach detector (races/actual_result + goal engine) feeds it.  

**P3-13 · Targets surface hardcodes miles and /mi although the settings backend defines a distance-units preference**  
_targets · UNVERIFIED-P3 · iPhone Targets · `native-v2/Faff/Faff/Views/TargetsView.swift`_  
Impact: A metric-preference runner (most of the world) reads every pace and distance on the prediction surface in imperial with no way to change it, despite Settings appearing to offer the preference -- the setting is a placebo on this surface.  
Fix: Either honor units_distance/units_pace in the Targets formatters or remove the units options from Settings until any surface consumes them (app-wide decision, flag to David).  

**P3-14 · Add-shoe: UI treats model as optional but server requires it — failure blamed on the network**  
_settings · UNVERIFIED-P3 · iPhone Shoe Garage > Add a shoe · `native-v2/Faff/Faff/Views/ShoesView.swift:275`_  
Impact: A runner adding 'Nike' with no model gets a persistent, misleading network error and can never save; nothing hints the model field is required.  
Fix: Require model client-side (disable Save) or make model optional server-side; surface the server error message.  

**P3-15 · TodayShoeOverrideSheet wear tint compares percent (0-100) against 0.8 — nearly every shoe shows the worn color**  
_settings · UNVERIFIED-P3 · iPhone Today shoe override sheet · `native-v2/Faff/Faff/Views/TodayShoeOverrideSheet.swift:114`_  
Impact: Any shoe with ≥1% wear (i.e. after a single run) renders the near-end-of-life tint in the Today picker, making the wear signal meaningless and inconsistent with the other picker.  
Fix: Compare pct > 80 (or normalize pctUsed to a ratio in the model).  

**P3-16 · Selecting Sex = 'Other' round-trips as 'Not set'**  
_settings · UNVERIFIED-P3 · iPhone Settings > YOU > Sex · `web-v2/lib/coach/biological-sex.ts:81`_  
Impact: A runner who explicitly answered the question sees their answer erased on next visit and may keep re-entering it. (Engine behavior is intentionally binary; only the display round-trip is broken.)  
Fix: Persist the literal 'other' on profile.sex (normalizeSex already buckets it to not_specified for engine reads) or store a separate display value.  

**P3-17 · Sleep summary cards mislabel their fallbacks (LAST NIGHT shows the 7-night average and vice versa)**  
_settings · UNVERIFIED-P3 · iPhone Health > Sleep · `native-v2/Faff/Faff/Views/HealthView.swift:413`_  
Impact: A runner whose last-night sample hasn't landed sees the weekly average presented as last night's sleep (and a single night presented as the weekly average), and cold-start users see synthetic sleep-proxy bars labeled as readiness history — plausible-looking but wrong numbers under explicit labels.  
Fix: Show '—' when the specific metric is missing instead of substituting the other metric; label proxy bars as sleep or hide until real scores exist.  

**P3-18 · Server validation errors are reported as connection/sign-in problems**  
_settings · UNVERIFIED-P3 · iPhone Settings field editor save path · `native-v2/Faff/Faff/Views/SettingsView.swift:559`_  
Impact: A runner typing 8 days/week (or 250 for max HR) is told to check their connection; they retry, fail again, and give up — the actual bounds are never surfaced. Also note the hint (3-7) and server bounds (1-7) disagree.  
Fix: Decode the error body on non-2xx and toast the server message; align the hint with the 1-7 server range.  

**P3-19 · Strava push history and usage sheets are unmounted — auto-push failures are invisible on iPhone**  
_settings · UNVERIFIED-P3 · iPhone Profile (dead code) / Strava auto-push observability · `native-v2/Faff/Faff/Views/StravaPushHistorySheet.swift:10`_  
Impact: A runner whose auto-push silently fails (expired write scope, revoked app) has zero visibility on the phone — runs just stop appearing on Strava with no error anywhere; and a runner wanting to unlink Strava has no in-app path.  
Fix: Re-mount the push history behind the Strava row (e.g. when connected, tap → manage sheet with history + disconnect), and add a disconnect endpoint/action.  

**P3-20 · Race finished at the line but GPS reading short records the marathon as status 'abandoned'**  
_raceday · UNVERIFIED-P3 · watch WorkoutEngine end-of-race path · `/Volumes/WP/06 Claude Code/Runcino/native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift`_  
Impact: A completed race can land labeled abandoned/incomplete in the completion payload and downstream execution scoring, even though the runner ran every meter. Cosmetic-to-coaching noise, not data loss (distance/time/HR still record).  
Fix: For isRace workouts, treat End within a small distance epsilon of the total (e.g. >= 97-98%) as completed.  

**P3-21 · Back chevron is a dead button when RaceDayView takes over the Today tab**  
_raceday · UNVERIFIED-P3 · iPhone Today race-day takeover · `/Volumes/WP/06 Claude Code/Runcino/native-v2/Faff/Faff/Views/RaceDayView.swift`_  
Impact: On race morning the most prominent control in the header does nothing — a runner trying to get back to the normal Today layout (e.g. to check readiness or the week strip) taps a dead chevron.  
Fix: Hide the back button when RaceDayView is the Today takeover (pass a flag), or make it route to the normal Today body.  

**P3-22 · Phone never learns whether the watch HR session actually started — reply key mismatch ('ok' vs 'status') leaves treadmillSessionConfirmed permanently false**  
_treadmill-strength-notif · UNVERIFIED-P3 · treadmill HR streaming · `native-v2/Faff/Faff/WatchSync.swift`_  
Impact: Latent: the property exists precisely to distinguish 'message sent' from 'watch actually started the session' (the P-6 doc note at :166-168), and any future consumer will read a permanently-false signal. Also note TreadmillHRSession.start silently no-ops on HKWorkoutSession failure (:81-87) while still replying 'started'.  
Fix: Check reply["status"] == "started" (and have the watch reply an honest failure status when session creation throws).  

**P3-23 · Treadmill speed capped at 12.0 mph (5:00/mi) — fast runners cannot log faster interval segments**  
_treadmill-strength-notif · UNVERIFIED-P3 · treadmill · `native-v2/Faff/Faff/Views/TreadmillView.swift`_  
Impact: A fast runner doing R-pace or stride work on a treadmill cannot enter their true speed; the logged pace/distance under-reports the session and per-phase actuals read slower than target.  
Fix: Raise the cap to 15 mph (or derive from the plan's fastest target pace + margin).  

**P3-24 · Watch TreadmillHRView elapsed clock only updates when a new HR sample arrives — frozen for users with no HR lock**  
_treadmill-strength-notif · UNVERIFIED-P3 · treadmill HR streaming · `legacy/native/Faff/FaffWatch Watch App/TreadmillHRView.swift`_  
Impact: Runner glances at wrist mid-treadmill and sees a stale elapsed time (and '—' BPM), reading as a hung app.  
Fix: Wrap the header in TimelineView(.periodic(1s)) like the main workout faces.  

**P3-25 · GET /api/strength window anchored to server CURRENT_DATE, not runner-local today**  
_treadmill-strength-notif · UNVERIFIED-P3 · strength · `web-v2/app/api/strength/route.ts`_  
Impact: Off-by-one-day list boundaries for runners west of UTC in the evening — a 14-day list can include/exclude an extra day vs what the recommender counted. Cosmetic-scale, but inconsistent with the file's own TZ doctrine.  
Fix: Use runnerToday(userId) as the anchor like the sibling readers.  

**P3-26 · Treadmill runs are never written to HealthKit — no Apple ring/Fitness credit for the session**  
_treadmill-strength-notif · UNVERIFIED-P3 · treadmill · `legacy/native/Faff/FaffWatch Watch App/TreadmillHRSession.swift`_  
Impact: A treadmill runner closes zero exercise-ring minutes and sees no Indoor Run in Apple Fitness for a 60-minute session — a visible inconsistency vs their outdoor runs that reads as data loss. (The HR samples do land, but the workout container doesn't.)  
Fix: Have the iPhone write an HKWorkout (indoor run, distance+duration+kcal) on successful POST, tagged with the workoutId in metadata so future HK-ingest paths can skip it as self-authored.  

**P3-27 · Fuel cues, HR-ceiling alerts and telemetry sampling all stop in overtime — the phase of a long run where fueling still matters**  
_watch-engine · UNVERIFIED-P3 · Watch workout engine · `native-v2/Faff/FaffWatch Watch App/WorkoutEngine.swift`_  
Impact: A runner finishing a 16-mile plan at 1:55 who keeps running to 2:10 misses the 2:00 gel cue; the easy-HR guardrail also freezes at its last pre-overtime state. Overtime minutes/miles appear in totals but carry no telemetry for the recap.  
Fix: Keep the fueling, HR-ceiling and sampling blocks live during overtime (guard only the phase-advance logic on planComplete).  

**P3-28 · Short-race lobby time formatting: sub-hour goals render as '0:47' and no-goal races show a bare unlabeled minute count**  
_watch-faces · UNVERIFIED-P3 · IdleView / LobbyFace time row · `legacy/native/Faff/FaffWatch Watch App/IdleView.swift:69-76`_  
Impact: Universality: 5K/10K racers — the casual end of the user base — see their goal with the seconds amputated ('0:24' for a 24:30 goal is a 30-second coaching error at 5K scale) or an unlabeled integer at the start line. Marathon-scale goals ('3:50') are unaffected.  
Fix: For race goals under an hour use mm:ss ('24:30'); keep h:mm at ≥1 h. When a race has no goalSec, keep the clock icon so the bare minutes read as duration.  

**P3-29 · Readiness glance hero uses Bebas Neue, outside the brief's Oswald/Inter-only typography rule**  
_watch-faces · UNVERIFIED-P3 · ReadinessGlanceView score hero · `legacy/native/Faff/FaffWatch Watch App/ReadinessGlanceView.swift:48`_  
Impact: Cross-surface inconsistency: the same readiness score renders in Oswald on iPhone/web and Bebas on the wrist. Low runner impact (the glance is currently dead per the P1 above), but it's a straightforward brief violation that should either be fixed alongside the glance rewire or ruled exempt in the brief addendum.  
Fix: Switch the glance hero/labels to WatchTheme.sub (Oswald) + Inter body, or add a watch-display ruling to the brief addendum covering Bebas/HelveticaNeue on the wrist.  

**P3-30 · Treadmill HR-session ack checks reply["ok"] but the watch replies {status:"started"} — the confirmed-ack flag can never become true**  
_sync · UNVERIFIED-P3 · phone-watch treadmill HR bridge · `native-v2/Faff/Faff/WatchSync.swift`_  
Impact: treadmillSessionConfirmed stays false even when the watch successfully starts the HR session, so the P-6 fix is inert. Currently no view binds to the flag (TreadmillView.swift:551 uses the reachability-only return value), so today this is dead code rather than user-visible — but any future consumer of the 'real ack' will read a permanently-false signal and conclude live HR never started.  
Fix: Check `reply["status"] as? String == "started"` (or add "ok" to the watch reply if a watch build is shipping anyway).  

**P3-31 · Watch stores the session auth token in UserDefaults and keeps a signed-out user's token until a new one arrives**  
_sync · UNVERIFIED-P3 · watch auth token propagation · `native-v2/Faff/FaffWatch Watch App/PhoneSync.swift`_  
Impact: On a shared device, user A signs out and user B signs in on the phone; until the next context push reaches the watch, a completion finished on the wrist posts with A's still-valid server session and lands in A's training history. Also a mild at-rest security gap relative to the phone's own standard (60-day token in plaintext on the watch).  
Fix: Have the iPhone push an explicit `authTokenCleared: true` context on sign-out (watch nils its stored token), and move the watch-side token into the watchOS keychain.  

**P3-32 · Completion queues cap at 50 with silent oldest-drop, and a dead-lettered direct upload leaves syncState stuck on 'Sending'**  
_sync · UNVERIFIED-P3 · offline completion queueing · `native-v2/Faff/FaffWatch Watch App/PhoneSync.swift`_  
Impact: A runner offline for a long stretch (or with a persistent 401 backing up the relay queue) can silently lose their oldest recorded runs once the 51st completion arrives. The stuck 'Sending…' case misleads the runner into thinking a permanently-rejected run is still in flight.  
Fix: Log + surface a count when the cap evicts; set syncState = .failed on the 4xx dead-letter branch.  

**P3-33 · Strength delete-diff guard covers only the all-empty HK read — a per-type query failure still triggers spurious DELETEs**  
_sync · UNVERIFIED-P3 · HealthKit strength import (delete-diff data-loss guard) · `native-v2/Faff/Faff/HealthKitImporter.swift`_  
Impact: Transient wrong data: a runner's yoga/pilates/core sessions disappear from strength_sessions until the next fully-successful sync re-POSTs them (they are still in HK and in-window, so this self-heals — hence P3, not the P1 the original empty-read wipe was). Recommender counts are briefly wrong in the interim.  
Fix: Propagate a per-type query error out of fetchStrengthWorkouts and skip the delete-diff for types whose query failed (track fresh UUIDs per session_type).  

**P3-34 · Downgrade leaves stale prescription notes on the converted workout**  
_adaptation · UNVERIFIED-P3 · adaptation engine → workout detail rendering · `web-v2/lib/plan/adapt.ts`_  
Impact: A runner opening the downgraded day sees an easy run captioned with interval execution instructions — contradictory coaching on the exact surface the downgrade was supposed to clean up (same bug class the 2026-06-01 'coherent downgrade' fix addressed for sub_label/spec).  
Fix: In the clearsQuality branch, replace notes with the standard easy/recovery/rest note text used at generation time (preserving the original in a parallel original_notes if provenance is wanted).  

**P3-35 · Long-run fallback labels read 'Marathon Pace' regardless of the runner's goal distance**  
_archetypes · UNVERIFIED-P3 · Phone Today hero (long-run step list) · `native-v2/Faff/Faff/Views/TodayView.swift:1086`_  
Impact: A 5K/10K racer or no-goal runner whose long-run phase arrives without a label sees marathon-specific vocabulary, contradicting the state-driven composition rule; minor because spec-authored workouts normally carry labels.  
Fix: Default `.long` to "Long Run"/"Steady" and delete the dead subLabel property.  

**P3-36 · Watch fallback prescription sizes reps from a fake weekly mileage (today's distance × 6, floor 25)**  
_accuracy · UNVERIFIED-P3 · watch workout fallback path (workout_spec absent) · `web-v2/lib/watch/build-workout.ts`_  
Impact: Low-frequency runners on spec-less rows get rep counts sized for a runner training at ~2.4x their volume. Limited blast radius since current generators always write workout_spec.  
Fix: Use the real summed week only (it is already queried), keep the 25mi floor solely when the plan sum is zero, and reuse the long_run_day week window from /api/plan/week.  

**P3-37 · Run-recap HR drift bars clamp to a fixed 120-170 bpm window**  
_accuracy · UNVERIFIED-P3 · phone post-run How It Went panel · `native-v2/Faff/Faff/Components/HowItWentPanel.swift`_  
Impact: A runner whose easy HR sits above 170 (young, high HRmax) sees both bars pinned at 100% with no visible drift difference; a runner below 120 sees both pinned at the minimum. The numeric readouts remain correct, so this is visualization-only.  
Fix: Scale the window off the runner's known HR anchors (rhr→hrmax, or the run's own min/max) instead of the fixed 120-170 band.  

**P3-38 · Multi-wave corral lever keyed to a hardcoded set of race slugs from David's race history**  
_hardcode · UNVERIFIED-P3 · Targets 'Hit list' levers (any user racing a multi-wave race not in the list) · `web-v2/lib/coach/projection-levers.ts`_  
Impact: The corral/wave-conditions reclaim lever (CORRAL_CONDITIONS_RECLAIM_PCT) simply never fires for any race a new user adds, including major multi-wave races like Chicago or Berlin. Degraded (missing) advice, not wrong advice — acknowledged stub.  
Fix: Land wave_options on race editorial as planned, or heuristically treat races above a field-size/major flag as multi-wave.  

**P3-39 · No return-from-layoff adaptation exists: after 8-14+ days off, the plan resumes at the fully-ramped scheduled week and VDOT anchors get no layoff drop, contradicting Research/22 §14 and Research/01**  
_doctrine · UNVERIFIED-P3 · plan adapter + VDOT inputs (doctrine gap, feeds coaching recommendation) · `web-v2/lib/plan/adapt.ts:85-95`_  
Impact: A runner who takes 12 days off (flu, vacation) mid-build comes back to a plan week that kept ramping in their absence — full volume plus that week's quality at pre-layoff paces — roughly 40% above the doctrinal re-entry load and at paces 3-5 VDOT too fast, the classic overuse-injury setup the comeback protocols exist to prevent.  
Fix: Add a layoff detector (days since last canonical run >= 8) that fires a propose-first 'comeback ramp': scale the next 1-3 weeks to 70/85/100% via the existing shave machinery, downgrade the first quality to easy per 22:634, and apply the Research/01 VDOT haircut to the effective anchor for >=14-day gaps.  


### Refuted by verification (excluded from counts)

- **MODELED shown as MEASURED: FITNESS 'Responding' verdict, 'fitness is responding on schedule' copy, and the TODAY accrued time are all plan-model outputs presented as observed fitness** — The code-level facts check out, but the finding fails on both its failure scenario and its claimed rule violation.

FACTS VERIFIED: (1) gotVdot IS the modeled projectedGainVdot (K_TargetsProjection.swift:372, comment :368-371 admits it), fitVerdict thresholds it against need (:383-388), and the on-state summary says "your fitness is responding on schedule" (:397). (2) The TODAY column renders traj
- **Per-day shoe override for a selected future day silently applies to TODAY (date vs date_iso key mismatch)** — The date/date_iso key mismatch is real at the code level: API.setShoeForDay (native-v2/Faff/Faff/API+Toolkit.swift:401-412) sends {"date", "shoe_id"} while the server (web-v2/app/api/today/shoe/route.ts) reads only body.date_iso and falls back to runnerToday(userId), then reconciles shoe_id onto today's already-logged runs (overriding prior auto-assigns). The error-swallowing claims (try? at both 
- **Settings timezone picker offers only 15 fixed zones — most of the world cannot set their real timezone** — The 15-zone SETTINGS_ZONES list exists (SettingsView.swift:686-691), but the claimed failure is not reachable for a real user. (1) Onboarding auto-captures the device's real IANA zone: OnboardingView.swift:110/142 sends TimeZone.current.identifier (e.g. Asia/Kolkata) in the /api/onboarding/complete payload, and the web flow does the same via Intl.DateTimeFormat().resolvedOptions().timeZone (Step3C

### Surface health one-liners

**onboarding:** The iPhone onboarding/sign-in surface is well-built where it was recently reworked: the wizard itself is thoughtful (no typed numbers, honest connect states, true-beginner support down to weekly_frequency=0 with a couch-to-3-day floor server-side), the backend write is atomic, plan generation has Monday-anchored fail-safes on both the goal and race routes, and every onboarding combination (race / fitness goal / just-run / beginner / no-Strava / no-HealthKit) can reach either a plan or the design

**today:** The iPhone Today surface is strong on its happy path — plan hero with real structured steps, week-strip paging across ~6 weeks with prefetch, race-day-morning takeover, post-run pivot, past-day recap, skipped-today state, no-goal 'just run' mode, and a working skip/move flow with conflict confirmation. Rest days degrade cleanly (stats, HR-cap and window chips all hide), missing-HR and no-watch users get honest '—'/'No overnight data' states, and the backend week endpoint properly dedupes multi-r

**train:** The Train surface's display code is in decent shape — week bucketing is genuinely centralized (week-window.ts / plan/week both derive the week ending on long_run_day; loadSettings defaults cover unset values), /api/plan/week correctly collapses multi-row dates into one pill with a hasStrength flag and emits skip signals, the skip/move sheet is well-guarded client-side (double-tap guard, conflict re-check on stale data, rest-row reconciliation server-side keeps one-row-per-day), and slow-runner p

**activity:** The iPhone Activity + run detail surface is visually mature and has clearly been through several honesty passes (fake demo splits/traces removed, treadmill/no-GPS gating, lenient decoding so weeks never silently vanish, HR-missing states degrade to hidden sections rather than fabricated bars, route map faithfully mirrors the web CartoDB + pace/HR-zone gradient). But it is still tuned for exactly one runner: the STATS wall silently caps 'ALL TIME' at the 200 most recent runs, the Personal records

**targets:** The Targets/prediction stack has a genuinely strong spine: one server engine (computeGoalProjection -> fitness-trajectory) feeds web and iPhone identically, the VDOT chain is well-cited with real guards (stale-anchor fade, training soft cap, goal-relative run floor, mile-table correction, stale +/-8% CI override), and the client does no local race math. But the surface is calibrated almost exclusively for its one production user: a fast, Pacific-timezone, Apple-Watch-wearing race runner. Step ou

**settings:** The Settings/Profile/Health/Shoes surface is structurally sound for the single-user imperial happy path (David): the consolidated field editor genuinely round-trips profile and settings fields, plan-shaping edits rebuild race plans, timezone pinning is travel-aware, and shoe creation/day-assignment write real data. But the surface fails the universality lens in several load-bearing places. Two whole feature categories are silently fake: iPhone notification preferences are wire-incompatible with 

**raceday:** The race-day surface has a well-built skeleton — a dedicated RaceDayView with a categorical Today takeover, a research-cited execution-plan composer, course-aware watch pacing with per-segment phases, goal-delta race face, distance-anchored gel cues, crash-recovery snapshots, and a race-specific expiry window so a dead phone can't brick the corral START. The watch path is the healthiest layer: the engine's race handling (no pause during races, finish-segment routing, gel idempotence, stale-plan 

**treadmill-strength-notif:** This surface splits sharply in two. The treadmill/strength backend write paths are in good shape — the watch-completion endpoint is heavily hardened (idempotency, cross-day forking, cross-user collision guards, Rule-6 merge upserts, retryable-vs-permanent ack semantics), the strength recommender is doctrine-cited with logged-aware counting and a sound roll-forward, and the HK strength delete-diff carries the empty-read data-loss guard. The two systemic weaknesses: (1) the notifications pipeline 

**watch-engine:** The watch workout engine is one of the most defensively-built surfaces in the app. Confirmed shipping source: native-v2/Faff/FaffWatch Watch App is a symlink to legacy/native/Faff/FaffWatch Watch App (project.yml + ship-testflight-v2.sh both reference it, with a build-for-testing gate). Core mechanics are sound: the phase state machine is forward-only with correct pause/resume clock accounting (pause time genuinely never counts; the paused takeover blocks End/skip actions so the pause-inflation 

**watch-faces:** The watch face system itself is in strong shape: the FaceKit NumberFace primitive genuinely implements the locked layout law (clock-baseline top label, TOP_MARGIN=BOTTOM_MARGIN symmetry, canonical gap, em-width sizing with the em-dash fix), placeholders for missing GPS/HR ("—:—"/"—" in mute) are handled consistently across every adapter, ResponsiveFace's uniform 205x251 scaling makes 41mm/45mm behave like the approved Ultra design, and the locked ten-color tokens are byte-correct in WatchTheme/F

**sync:** The phone-watch-backend sync surface is in strong shape for its primary runner: the completion round-trip is genuinely hardened (dual-lane delivery with durable queues on both sides, idempotent upserts keyed on workoutId, 200-only dequeue with retryable-vs-permanent 500/200 discrimination at watch/complete/route.ts:553-569, cross-day identity forking, transferFile fallback for >60KB payloads, background URLSession on the watch, token-expiry handling that holds queued completions through re-auth 

**adaptation:** The adaptation surface is the weakest engine in an otherwise carefully-audited plan system. The seed finding is fully confirmed and is worse than reported: the double-booking is real (both rows live in plan_workouts, both count in weekly totals; the phone week-strip and glance simply hide one row nondeterministically, so nothing is 'superseded'). Reconstructed from coach_intents + adaptation_log: the Jul 1 pass (n:1) rescheduled the missed Jun 30 intervals onto the already-occupied Jul 3; its an

**archetypes:** The phone+watch rendering layer is in solid shape for the archetypes the engine gates exercise directly: the no-goal just-run mode is genuinely implemented end to end (hidden Train tab with plan/race/goal re-check, dedicated hero, watch JUST RUN face), 3-day and low-frequency weeks render honestly (rest rows, no phantom tiles), missing data degrades gracefully almost everywhere (nil HR → hidden rows on watch faces, treadmill and summary; nil pace → hidden pills; zero-distance guards in watch sum

**accuracy:** Number accuracy on phone+watch is structurally good where prior audits already landed: the once-hardcoded iPhone HR target is verifiably fixed (TodayPreRunBodyV3 uses server-computed hrCeilingBpm/hrTargetBpm and falls back to zone labels, never invented bpm), weekly volume flows through the canonical dedup everywhere the phone reads it (plan/week and training-state both sum canonicalMileageByDay/mileageByDay), VDOT reads races.actual_result first with the [30,85] table clamp, and work-phase pace

**hardcode:** Cross-cutting multi-user hardcode audit. The 'me'-PK landmine is well contained: signup (app/api/auth/signup/route.ts:114-126) writes uuid-keyed users+profile rows, plan/coach readers scope by user_uuid (training_plans) and reach plan_weeks/plan_workouts via plan_id joins, so legacy rows with user_id='me' and NULL user_uuid on week/workout rows (verified in prod for the demo user's plan) do not leak or vanish. The apple-review@faff.run demo path was verified live against prod (read-only): user a

**doctrine:** OVERALL: The plan engine's core math is in strong shape for the mainstream case (heavily gated by _sweep_allusers and _maint_invariants), but the ADAPTER layer (lib/plan/adapt.ts) was never re-audited through the universality lens and carries three live defects that specifically punish beginners, short-distance racers, and slow runners: a flat 4mi completion gate, static experience volume caps that contradict the generator's own tier bands (with compounding daily auto-shaves), and an unguarded +


