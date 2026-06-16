# Full App Audit — 2026-06-16

Read-only multi-agent audit of faff.run (web, iPhone, watch, coach engine). 12 finders across surface x dimension; 56 candidate findings; every one adversarially verified (4 refuted as false positives); 52 confirmed. Severity: 0 P0, 5 P1, 24 P2, 23 P3.

## Executive summary

The app is structurally sound where it matters most: the canonical volume reader, the race-data source-of-truth ladder, the VDOT formula constants, the readiness pillar weights, dedup/merge ordering, and the multi-writer jsonb preservation rules all verify clean against doctrine. No P0s. The headline issues are two recurring classes. First, **silent signal defeat in the projection engine**: a `::numeric` cast on a colon-delimited finish-time string throws and swallows the single drift signal that flips a goal off-track for any inline-edited race row (P1), and the heat model over-forgives interval reps because the work:rest halving from Research/06 was never applied (P1). Second, **cross-surface disagreement**: web and iPhone show different projected finish times and different on-track verdicts for the same race (P1 x2), the training-week boundary fix landed in one route but not in the four other week-total readers (P2 cluster), and a fabricated net-elevation heuristic drives a real pacing plan off a guessed downhill (P1). Most P2/P3 findings are bounded — gated on non-Sunday-long runners, ultra goals, mile-only goals, or luteal-phase users — and invisible in the primary user's testing, but they become live the moment the invite list widens.

## Findings

### P1

**Recent-race drift detector throws on a finish-time string cast and never fires**
- Surface: web — Targets goal-projection / drift engine
- File: `web-v2/lib/training/goal-projection.ts:758-784` (SELECT 762-765, WHERE 772-775, ORDER BY 776-781)
- What's wrong: `detectRecentRaceDrift` reads finish seconds via `COALESCE((actual_result->>'finishS')::numeric, NULLIF(meta->>'finishTime','')::numeric)`. `meta.finishTime` is always stored as an H:MM:SS display string (`result/route.ts:102` writes `fmtFinish(resolvedS)`; `race/route.ts:147-149` passes it through unchanged). When `actual_result.finishS` is null, Postgres evaluates the second arm and rejects the colon-delimited string with `invalid input syntax for type numeric`. The query throws, `.catch(() => ({rows:[]}))` at :784 swallows it, and the detector loop's `try/catch` at :208-214 returns no signal.
- Expected: parse the string the way the canonical loader does. `vdot-inputs.ts:148-149` already does it right: `ar.finishS ?? parseRaceTime(m.finishTime)`, where `parseRaceTime` (`vdot.ts:199-211`) matches `^(\d+):(\d{2})(?::(\d{2}))?$`. This is the "divergent reimplementation" class the `vdot-inputs.ts` header warns against.
- Impact: any race written through the inline RaceView hero edit (`RaceView.tsx:281 commitFinish` → PATCH `/api/race` sets `meta.finishTime` but never `actual_result.finishS`) defeats the one STRONG signal that flips a goal on-track → off-track. A runner whose only logged result is meta-only keeps reading ON TRACK while a real fitness gap exists. David's Disney HM is in `actual_result.finishS` so the first COALESCE arm saves him; every inline-edited row for any user is exposed.
- Fix direction: route the read through `loadVdotInputs`/`parseRaceTime` instead of an in-SQL `::numeric` cast.

**Interval rep target uses full continuous heat slowdown instead of the half-slowdown doctrine requires**
- Surface: web + iPhone — interval recap pacing read + per-rep in-range band
- File: `web-v2/lib/coach/run-recap.ts:149`
- What's wrong: `intervalPacing` computes `adjTarget = Math.round(targetSPerMi * (1 + slowdownPct/100))` with the full continuous slowdown, and `judgeWeather` (`weather-adjust.ts:188-195`) never halves `slowdownPct` for intervals — `workoutType` only switches copy framing, not the number. `heat-model.ts` has no work:rest factor.
- Expected: Research/06 §2 "Interval-vs-continuous rule" (lines 111-117): for repeats with ≥1:1 work:rest, `adjustment_intervals = adjustment_continuous × 0.5`, because recovery periods allow partial cooling.
- Impact: on hot interval days the recap over-forgives rep pace. Traced 80°F/70%/clear 45-min session: full slowdown 6.8% → adjTarget 7:10, band upper 434; doctrine-halved 3.4% → adjTarget 6:57, band upper 421 — the in-range upper edge loosens ~13 s/mi. This biases the "X of N reps in range" count, the "settled into the pace the conditions allowed" vs "faded past target" branch, and the `intervals_adjusted_target_s_per_mi` shipped to the iPhone per-rep graph. Same over-adjust-in-heat family the abandoned heat-on-VDOT read was killed for. Only loosens, only on warm interval days.
- Fix direction: apply half the continuous slowdown to the rep target before computing `adjTarget` and the band, for rep-based work with ≥1:1 work:rest.

**Today tile and Targets view disagree on goal status and projected time for the same runner**
- Surface: web Today goal tile vs web Targets gap panel
- File: `web-v2/components/faff-app/views/TodayView.tsx:4714-4727`; `TargetsView.tsx:77-80`; `seed.ts:2273,2277,2288-2295`; `goal-projection.ts:222-232,283-293`
- What's wrong: the Today tile derives status/color/projected number/delta from the drift-signal ladder (`goal.goalStatus`/`goal.projected`, set in seed.ts from `gp.status` and `gp.projectionSec`), while Targets derives status from the forward trajectory: `traj.reachable ? 'on-track' : traj.gapVdot <= 1.5 ? 'watching' : 'off-track'` (`TargetsView.tsx:77-80`). The two engines are computed independently in `computeGoalProjection` and can disagree on the same page load.
- Expected: both surfaces render one status and one projected time. `TargetsView.tsx:70-76` explicitly documents this hazard ("drift could flag off track while you are projected within reach, which reads as the page arguing with itself") and resolves it for Targets only — the Today tile was never migrated to trajectory-derived status.
- Impact: a runner with one stale A/B race ~11% slower than goal trips `detectRecentRaceDrift` STRONG → Today shows OFF TRACK (red) with a current-fitness projection, while the trajectory yields `reachable=true` → Targets shows ON TRACK with a faster projection. Same race, same session, two answers. Display-only, no data corruption.
- Fix direction: have Today consume the same trajectory-derived status/number as Targets, or write a single reconciled `goalStatus`/`projected` in seed.ts that both read.

**Race detail NET ELEVATION is fabricated from gross gain, driving the pacing plan off a guessed downhill**
- Surface: web — Races (race detail)
- File: `web-v2/components/faff-app/raceDetail.ts:291` (also `RaceView.tsx:471,47,156`)
- What's wrong: `const netElevFt = geom?.elevation_gain_ft ? -Math.round(geom.elevation_gain_ft * 0.24) : 0;`. The source field is GROSS gain (`gpx-parser.ts:42-46` sums only positive segments), so -0.24 × gross is not a measurement. It is displayed at `RaceView.tsx:471` (className `down` always applied), fed into `buildPacing` where `downhill = netElevFt < -100` flips the final-block pace factor, and into `insightFor` where `downhill = netElevFt < -200` selects the "bank nothing" downhill copy.
- Expected: compute net from `course_geometry` trackpoints (first vs last ele), exactly as `seed.ts:2347-2349` already does (`Math.round((lastEle - firstEle) * 3.28084)`), and as `course_library.net_elevation_ft` (migration 130) already stores curated. `raceDetail`'s own course_library SELECT (lines 264-265) omits the real `net_elevation_ft`.
- Impact: any course with gross gain >~417 ft is treated as net-downhill for pacing (>~833 ft for the insight), regardless of the real profile. Big Sur's curated net is +260 ft (net UPHILL) but the heuristic would show it as net downhill and feed inverted pacing/strategy. The `gainFt` and `netElevFt` stripstats are mathematically locked at net = -0.24 × gross, which is impossible for a real course. Gated on an uploaded GPX — but that is exactly the race-detail-page population.
- Fix direction: read net from trackpoints or the curated `net_elevation_ft` column; both already exist.

**Goal-race projected finish time disagrees web vs iPhone (goal-seeking vs raw current-fitness)**
- Surface: web vs iPhone — Targets/Goal
- File: `web-v2/app/api/targets/projection/route.ts:171-194,364-403`; `goal-projection.ts:230-232`; `GapPanel.tsx:558-602`; `seed.ts:2273`; `native-v2/Faff/Faff/Components/Toolkit/K_TargetsProjection.swift:386`
- What's wrong: the web hero renders `traj.projectedSec` (`GapPanel.tsx:662`, TrajectoryHero) = `predictRaceTime(currentVdot + projectedGainVdot)` — the goal-seeking value. The iPhone renders `Text(formatTime(summary.projectionSec))` (`K_TargetsProjection.swift:386`) where `projectionSec` = the snapshot's raw `predictRaceTime(vdot)` (cron writes raw current fitness, `snapshot-projections/route.ts:93`). The goal-seeking value IS sent to iPhone as `trajectoryProjectedSec` but is used only inside the `aheadOfGoal` copy branch (`K_TargetsProjection.swift:428`), never as the primary number.
- Expected: both surfaces show the same projected finish. `route.ts:197-201` explicitly states the trajectory is "the ONE engine both surfaces read … so the native Goal tab shows the same number + status as web" — but the panel renders `projectionSec`, contradicting that intent. Per the plan-trusts-itself doctrine, the canonical value is `gp.projectionSec`/`traj.projectedSec`.
- Impact: on the surface whose whole purpose is "are you on track," the two surfaces contradict each other on the flagship number — for David, web ≈1:30 (goal-seeking) vs iPhone ≈1:34:xx (raw VDOT), ~5 min apart. There is even an intra-iPhone contradiction: the `aheadOfGoal` headline prose says "Trajectory hits 1:30:xx" while the big number above shows the raw ~1:34:xx.
- Fix direction: render `trajectoryProjectedSec` as the iPhone primary number when present.

### P2

**Strava avgCadence stored at two scales depending on ingest path (raw via pullSync, doubled via webhook)**
- Surface: web — coach run-state/log-state display + health-state cadence baseline
- File: `web-v2/lib/strava/pullSync.ts:154`; `web-v2/app/api/strava/webhook/route.ts:526`
- What's wrong: pullSync stores `avgCadence: act.average_cadence ?? null` (raw, per-leg ~84 spm); webhook stores `average_cadence * 2` (full ~168 spm, comment: "Strava reports halved"). Both write the same `runs` row keyed on the Strava activity id; the enhance branch is first-writer-wins for equal tier, so neither corrects the other. Display readers don't rescale (`run-state.ts:674`, `log-state.ts:242`). The dominant live path is the daily cron (`cron/strava-sync/route.ts:34` → `pullSyncAllUsers`), which uses the raw halved value.
- Expected: the webhook's `*2` is correct (Strava running cadence is per-leg). Watch and HK both store full SPM (~168). pullSync should apply the same `*2`.
- Impact: a cron-ingested run shows cadence at half (~84 vs ~168) in run detail and the activity feed. `health-state.ts:267` guards the baseline with `BETWEEN 130 AND 220`, so the ~84 value is silently dropped from the baseline and Strava-only runs contribute nothing to it. Cadence is a secondary form metric, not a load/safety driver.
- Fix direction: apply `*2` in pullSync to match webhook/watch/HK.

**Two divergent easy-pace bands ship simultaneously (T+60..110 vs T+80..120)**
- Surface: web Today modal / `/api/prescription` + Poster/watch fallback vs authored spec
- File: `web-v2/lib/training/prescriptions.ts:150,241-244` vs `web-v2/lib/plan/spec-builder.ts:226`
- What's wrong: the Jun-8 floor-raise (commit `0a900cdc`, David-reviewed) moved easy from T+60..110 to T+80..120 but landed ONLY in `spec-builder.ts:226`. `prescriptions.ts` still carries the old faster band in both `paces()` and `derivePaces()`. The web DayDetailModal/WeekStrip/WeekAhead always hit the stale `prescriptions` path; Poster and watch hit it only when a spec is absent.
- Expected: both engines use T+80..120. Research/01 §Pace conversion: E = MP+60..90 = T+78..108; spec-builder's T+80 lo is correct, prescriptions' T+60 lo is ~18 s/mi too fast.
- Impact: the runner sees a faster easy pace on the Today modal than the watch prescribes and than the plan stores — for David's goal-derived T (6:47), prescriptions easy 7:47-8:37 vs spec 8:07-8:47, ~15 s/mi midpoint gap. Recreates the exact source-of-truth confusion David flagged. Note: the watch's prescription fallback is also stale (the split is `prescriptions.ts` vs `spec-builder.ts`, not "Poster vs watch").
- Fix direction: raise `prescriptions.ts` offsets to +80/+120 in both `paces()` and `derivePaces()`.

**1-mile VDOT/projection diverges ~4-5 VDOT from the Daniels table the engine cites**
- Surface: web + iOS — 1-mile TT goal readiness verdict + mile projection
- File: `web-v2/lib/training/vdot.ts:31-53,77-90`; consumed by `goal-ready.ts:116`
- What's wrong: `vdot.ts` reimplements Daniels from the raw equations rather than the published table. Accurate for 5K/10K/HM/Marathon (within seconds), but the raw %VO2max curve diverges at the ~4-7 min mile. `vdotFromRace('5:24',1.0)` returns 54.5 where the table maps 5:24 → VDOT 50 (+4.5); `predictRaceTime(50,1.0)` returns 5:50 vs table 5:24 (+26s).
- Expected: Research/01 §VDOT lookup table — the mile should resolve to the published value (5:24 = VDOT 50). The mile path should interpolate the table or apply a short-distance correction. No such correction exists anywhere in `lib/training/`.
- Impact: a mile-goal runner's required VDOT (`goal-ready.ts:116`) is ~4-5 points too high, so the readiness verdict is pessimistic and "in-range"/"projectable" fires late. Bounded strictly to the single least-common goal distance; every longer distance is correct.
- Fix direction: interpolate the published table for the mile, or add a short-distance correction.

**Training-week boundary fix only landed in /api/plan/week; Today/Train/Overview totals still hardcode Monday**
- Surface: web backend, cross-surface — iPhone WeekStrip vs Today/Train tabs vs web Overview
- File: `web-v2/lib/coach/training-state.ts:324-343`; `web-v2/lib/coach/glance-state.ts:284-293`
- What's wrong: commit `ca898ee2` changed the week boundary to end on `long_run_day` in only `/api/plan/week/route.ts` (+ iOS TodayView). `training-state.ts:324-329` still hardcodes `shift = dow === 0 ? -6 : 1 - dow` (Monday) and sums weekDone/weekPlanned over a Mon-Sun window; `glance-state.ts:284-293` has the identical block. No shared `long_run_day` helper exists; 8 files still use the Monday computation.
- Expected: derive the boundary from `user_settings.long_run_day` in one place. The commit message claims "One source of truth, driven by the setting."
- Impact: for a Saturday-long runner the WeekStrip shows Sun-Sat while Train-tab weekDone/weekPlanned and web Overview show Mon-Sun — the same disagreement class the commit claims it fixed. Side-by-side visible on iPhone (Today-strip thisWeekMiles long-run-anchored vs Train-tab weekDone Monday-anchored). David (Sunday long) is unaffected.
- Fix direction: factor `(longRunDow+1)%7` into a shared helper called by `training-state.ts` + `glance-state.ts` + `state-loader.ts`.

**Web 'this week' volume + week strip + /log are hardcoded Mon-Sun while the canonical boundary moved to long_run_day**
- Surface: web — Overview WEEKLY VOLUME tile, week strip, and `/log`
- File: `web-v2/lib/coach/log-state.ts:110-116`; `glance-state.ts:284-293`; `seed.ts:932-934`
- What's wrong: `mondayOf()` (`log-state.ts:110`) always snaps to Monday; `glance-state.ts:284-293` builds the strip Mon-Sun; `adaptVolumeBars` (`seed.ts:932-934`) anchors `(getUTCDay()+6)%7` (Mon=0). None consult `long_run_day`, unlike `/api/plan/week/route.ts:46-55`.
- Expected: derive the web volume/strip boundary from the same `long_run_day` source so "this week" means the same 7 days everywhere.
- Impact: cross-surface disagreement on headline weekly mileage for any non-Sunday-long runner. Additionally, within web, `weekPlanned` reads `plan_weeks.week_start_iso` while `weekDone` uses the Mon-Sun `canonicalByDay` window, so a non-Sunday runner's web Today card can be internally inconsistent on top of disagreeing with the phone. Default `long_run_day` is `'sun'` so David is unaffected.
- Fix direction: shared `long_run_day` boundary helper (same as the training-state finding).

**injury-builder ignores user day preferences and weekly_frequency; hardcodes Mon/Fri rest + Mon-Sun week**
- Surface: web backend — INJURY-mode plan generation
- File: `web-v2/lib/plan/injury-builder.ts:69-120,152,198`
- What's wrong: `buildInjuryPlan` reads no preferences (no `loadSettings`/`long_run_day`/`rest_day`/`quality_days`/`weekly_frequency`). `injuryWeekShape` hardcodes `if (dow === 1 || dow === 5)` rest (Mon/Fri), `dow === 3` cross-train, else session — ~5 active days. The week is Monday-anchored (`startMonday = mondayOf(today)`, offset `(d.dow - 1 + 7) % 7`).
- Expected: CLAUDE.md requires plans to honor `user_settings`. `seed-from-onboarding.ts:629-630` and `generate.ts:2261-2284` both honor these via `loadSettings`/`layoutFromPrefs`. The walk-run content can stay protocol-driven, but day placement should follow prefs.
- Impact: an injured 3-day runner is prescribed 5 walk-run sessions; a Sunday-rest runner is forced onto a Mon/Fri-rest week. Gated behind an active injury AND an accepted coach proposal (`adapt.ts:1242` → `accept/route.ts:116`), so rarer than race/maintenance generators. (Note: `weekly_frequency` lives on `profile`, not `user_settings`, but the claim holds.)
- Fix direction: read rest day and frequency from settings; respect available days for session placement.

**Two divergent distanceCategoryOf definitions; ultra goals get marathon block shape + MP race-pace tag**
- Surface: web backend — race-prep plan generation, ultra goals
- File: `web-v2/lib/plan/generate.ts:385-390,868-869,393-398`
- What's wrong: `generate.ts:386` collapses everything `>= 20` into `'m'` with no ultra case, while `goal-tiers.ts:274` maps `>30` to `'ultra'`. `composePlan:1150` sizes blocks with generate's category (marathon shape, 3-wk taper, `racePaceTag 'MP'` for `>=25`) while `:1154` resolves the ultra TierTarget (peakLong up to 32mi). No clamping of `raceDistanceMi` to ≤30 exists on the path.
- Expected: one shared `distanceCategoryOf` so block shape, taper, and race-pace tag agree with the sized tier. Ultra race pace is well below MP. The file header (line 55) claims "incl. ultra," and `composeRecoveryPlan` (1570-1574) already has a correct ultra-aware categorizer.
- Impact: ultra goals (50K+) get marathon structure + MP-tagged long-run finishes + a full-distance race-day row while volume/long bands come from the ultra tier — internally inconsistent. Ultras are explicitly rare on this app.
- Fix direction: share one categorizer (import goal-tiers') across block sizing, taper, and pace tagging.

**volumeCurve deload weeks (mod-3 under TSB<-10) misalign with layoutWeek isCutback (always mod-4)**
- Surface: web backend — race-prep weekly layout under high fatigue
- File: `web-v2/lib/plan/generate.ts:540-543` vs `840-848`
- What's wrong: `volumeCurve` deloads at `(i+1)%cutbackEveryN` where `cutbackEveryN = tsbAtStart < -10 ? 3 : 4` (line 540). `layoutWeek` independently recomputes `isCutback = (weekIdx+1)%4` (line 840, hardcoded 4, no TSB passed in). When TSB<-10, volumeCurve cuts weeks at index 2/5/8/11 but layoutWeek relaxes the long-run floor only at 3/7/11. On a cut week not flagged cutback, `longFloor` is pinned to full `recentLongMi` against the reduced budget, and easy days absorb the cut (`remainingMi = max(0, weeklyMi - allocated)`, line 960).
- Expected: compute the deload schedule once and pass the same flag into layoutWeek. A third definition (`isCutbackByWeek`, line 1759, derived from actual volume drop) correctly tracks volumeCurve's deloads, so the persisted DB flag and layoutWeek's internal flag disagree for a TSB<-10 runner.
- Impact: only fires for `tsbAtStart < -10` (heavy fatigue). On those weeks the long run is sized to full peak against a cut budget, starving easy days — the opposite of a deload. Bounded by the easy-day floor (degrades, doesn't corrupt).
- Fix direction: thread `cutbackEveryN`/the deload flag into layoutWeek.

**Dynamic sleep target drives the displayed baseline label but not the score, contradicting the delta**
- Surface: web ReadinessBrief Drawer (the score reaches all surfaces; visible contradiction is web-only)
- File: `web-v2/lib/coach/readiness-brief.ts:312-314,1090`; `readiness.ts:44-66`; `Drawer.tsx:722,736-746`
- What's wrong: `computeDynamicSleepTarget` raises the target to 8.0h (ACWR>1.0) / 8.5h (>1.3), but `stateForScore` (line 313) injects no target field, so `computeReadiness` scores against a hardcoded `target = 7.5` (`readiness.ts:45`) — including the `observedSub` "+Xh vs target" delta (:66). `dynamicSleepTarget` is consumed only by `baselineLabel` (:1090).
- Expected: feed `dynamicSleepTarget` into the score so weight, delta, and label agree (Research/00b §284, load-scaled recovery), or stop displaying the elevated target.
- Impact: under load a 7.8h sleeper sees `observedSub` "+0.3h vs target" and positive sleep weight while the baseline label reads "target 8.5h" (implies short). The visible contradiction renders only on the web Drawer — the iPhone PillarCard never renders `baseline`. The score-inflation half (~6-point swing on a 0-100 score) reaches every surface including iPhone.
- Fix direction: use `dynamicSleepTarget` as the target inside `readiness.ts`.

**RHR streak detector and threshold line use different RHR baselines**
- Surface: Health — STREAKS card vs WHAT TO DO `[N/M]` progress line
- File: `web-v2/lib/coach/readiness-brief.ts:935-942`; `web-v2/lib/coach/health-actions.ts:161-183`
- What's wrong: `detectStreaks` computes its own baseline from `history.rhr` (full ~60-day array, excl-7 at length≥7), while `buildThresholdLine` uses `state.rhrBaseline` (`glance-state.ts:481-483`, last-30-day slice, excl-7 at length≥14, integer-rounded). Same +3-bpm rule, different baseline value.
- Expected: both read one canonical `state.rhrBaseline`. The `buildThresholdLine` comment (:154-160) claims it already uses "the same unified baseline … the streak detector uses" — which is the intent, not the reality.
- Impact: the STREAKS card and `[N/M]` line can report different trailing lengths when a day's RHR sits within ~1-2 bpm of the cutoff. Because glance slices 30 days and detectStreaks uses 60, the two excl-7 baselines average different windows and do not fully converge even for established users — more persistent than the finding's "7-13 day" framing.
- Fix direction: have `detectStreaks` read `state.rhrBaseline`.

**HRV luteal-phase baseline adjustment applied to the score but not to streaks, threshold line, or recovery-phase**
- Surface: Health — female luteal users
- File: `web-v2/lib/coach/readiness.ts:80-83`; `readiness-brief.ts:899-931`; `health-actions.ts:161-172`; `recovery-phase.ts:489-494`
- What's wrong: `readiness.ts:80` subtracts 5ms from the HRV baseline in luteal phase for the score only. `detectStreaks`, `buildThresholdLine`, and `recovery-phase computeStatusLine` all compare against unadjusted baselines. `synthesis.ts:186` even appends a "(luteal-adjusted)" label to the HRV story without changing the math, compounding the inconsistency.
- Expected: per CLAUDE.md per-finding context filters, the luteal adjustment should propagate to every HRV consumer. A 5ms shift on a ~60ms baseline ≈ 8.3% — enough to flip a borderline reading.
- Impact: a luteal female can see the HRV score pillar read "at baseline" while the STREAKS card and recovery tile flag the same HRV as below baseline. Narrow scope (female luteal users with cycle data, ±5ms, borderline readings).
- Fix direction: apply the luteal allowance in every HRV comparator, not just the score.

**HRV CV bands (5%/7%) borrowed from raw-RMSSD literature but applied to CV-of-LnRMSSD — likely never fires**
- Surface: Health — HRV CV tile + "HRV CV destabilizing" action
- File: `web-v2/lib/coach/readiness-brief.ts:421-423,1261`; `readiness-history.ts:170-172`; `health-actions.ts:502`
- What's wrong: CV is computed on the 7-day rolling LnRMSSD (correct per the literal Research/15 formula), but the 5%/7% cutoffs assume CV of raw RMSSD. Double variance-suppression (log transform + 7d smoothing) makes CV-of-rolling-Ln ~0.2% on a normal series, so `cv > 7` would require a ~±32% week-over-week swing. The code comments claim the numbers come from Research/15, but §15 gives only qualitative bands (Low/Rising/High) — the 5%/7% values are not in the doctrine.
- Expected: compute CV on raw RMSSD (to match the 5-7% literature) or re-derive cutoffs appropriate to rolling-LnRMSSD. The `[0,10]` tile axis was built for single-digit raw values that real rolling-Ln values hug the floor of.
- Impact: the Plews early-overreach CV signal (catches destabilization before HRV ms drops) under-fires across the tile band, the `hrv_cv_destabilizing` action, and watchTomorrow. Fails safe (no false alarms); one redundant detector among many; reactive-coach layer is de-prioritized.
- Fix direction: recalibrate the bands to the scale CV is actually measured on.

**Strava-matched finish time auto-fills race.finishTime with no provisional flag, then renders as an authoritative PR**
- Surface: web + iPhone — Targets PR grid / anchor line
- File: `web-v2/lib/coach/races-state.ts:136-148` → `seed.ts:1484-1494` (adaptPRs) → `TargetsView.tsx:184,202`
- What's wrong: when a past race has no curated finish, `loadRacesState` auto-fills `race.finishTime` from a date+distance-matched run's raw `movingTimeS`/`elapsedTimeS` with no provisional marker (RaceRow has no source field). `adaptPRs` stamps it `source:'race'` unconditionally, then the final map drops the source tag entirely, so even the internal race/training distinction never reaches the UI. Training-derived PRs get a "· training" suffix; the Strava-matched-to-race path gets none.
- Expected: CLAUDE.md Race-data Rule 3 — Strava-source data must never display as authoritative race performance without a provisional label ("Strava elapsed", "training effort · race to lock in"). Rule 4 also applies (a matched run can be a GPS over/under-measured activity).
- Impact: a past race the runner never logged a chip time for surfaces raw Strava elapsed as the official PR and anchors the goal-gap math. Fires only when a past race row + no curated result + a same-day same-distance run coincide. Multi-user signup is now live, so a casual importer hits it.
- Fix direction: carry a provisional marker through RaceRow → adaptPRs → the PR card, or don't seed the grid until `actual_result.finishS` exists.

**paceLabel renders "6:60/mi" — seconds round up to 60 without carrying to the minute**
- Surface: web + iPhone — post-run recap facts
- File: `web-v2/lib/coach/run-recap.ts:119-122`
- What's wrong: `${Math.floor(spm/60)}:${String(Math.round(spm % 60)).padStart(2,'0')}/mi` never carries a rounded-up 60. Reproduced: 419.6 → "6:60/mi", 479.5 → "7:60/mi". Reachable because `workPaceSPerMi` is an unweighted mean (`recap/route.ts:230-232`) and `actualPaceSPerMi` is `Number(data.paceSPerMi)` — both fractional. Feeds every workout type's lead line; iPhone renders `facts` verbatim. The route's `fmtPaceSlash` has the same flaw but is fed an int column.
- Expected: round to whole seconds first: `const t = Math.round(spm); ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}/mi`. 419.6 should read 7:00/mi.
- Impact: a nonsensical pace shown on the iPhone post-run card, web CompletedHero, and Activity drawer when the averaged work pace lands in the [59.5,60) fractional window (~1-in-120 of fractional paces). Purely cosmetic; no downstream logic consumes the label.
- Fix direction: round-then-divmod in `paceLabel` (and `fmtPaceSlash`).

**Structured long-run recap reports PLANNED easy mileage, not what was actually run**
- Surface: web + iPhone — long-run recap lead fact
- File: `web-v2/lib/coach/run-recap.ts:304`
- What's wrong: in the long-run finish branch, `easyMi = Math.round(input.plannedMi - finishMi)` where both operands are planned (`plannedMi` = `planRow.distance_mi`, `finishMi` = `finishMiSpec` from `workout_spec`). `actualMi` is never consulted, so the breakdown always sums to planned distance.
- Expected: derive easy mileage from actual distance (`actualMi - finishMi`). The non-finish long branch (line 315) and every other run type correctly use `input.actualMi.toFixed(1)`.
- Impact: a structured long run (HM/M finish) run short/long shows a breakdown that doesn't match the run — planned 16 (12 easy + 4 MP), run 14 → recap says "12mi easy + 4mi @ MP" = 16. Fires only when the run has a finish segment AND is run materially off-distance.
- Fix direction: anchor `easyMi` to actual distance like the non-finish branch.

**Over-performance gate compares whole-run avg HR against LTHR but credits work-phase pace**
- Surface: web — goal-seeking projection upgrade-gear bonus
- File: `web-v2/lib/training/goal-projection.ts:376,389-394,406-414`
- What's wrong: `computeOverPerformanceBonus` credits the work-phase pace (`AVG(actualPaceSPerMi) WHERE phase='work'`, line 376) but applies the "ran hot" rejection gate against the whole-run `avgHr` (line 389-394; `if (hr > lthr) continue` at 411). On a tempo with warm-up + cool-down, whole-run avg HR is materially below work-block HR (the route documents "168 work-weighted → 156 whole-run"), so an overcooked work block can pass the gate.
- Expected: gate on the work-phase avg HR (same phase the pace is read from). `phases[].avgHr` is available in the very row already queried. The function's own doc (lines 350-353) requires HR and pace from the same phase.
- Impact: inflates `overPerformanceBonusVdot` for sessions the gate meant to reject, raising `projectedVdot` and potentially flipping `aheadOfGoal=true` off an overcooked tempo. Mitigated by `MIN_SESSIONS=2` and the 4-VDOT cap; lives in projection space only (never moves paces).
- Fix direction: use the work-phase HR for the honesty gate.

**iPhone Targets confidence band never applies the >180-day stale-anchor ±8% override (web does)**
- Surface: iPhone — Targets confidence interval width
- File: `web-v2/app/api/targets/projection/route.ts:184-186,203-207,331-336`
- What's wrong: the iPhone route fetches `loadLatestVdotWithAnchor` but discards `anchor.anchorDateISO` and never passes it into `computeGoalProjection` or its standalone `computeConfidenceInterval`. The §13.7 override (`basePct → 8.0%` when anchor >180 days, `goal-projection.ts:1132-1143`) can never fire on iPhone; it always takes the ±2.5% HM span. Web threads `vdotAnchorDateISO` (`seed.ts:2269`).
- Expected: thread the anchor date the route already fetched into both calls, matching web. The override compares anchor age to today (not race day).
- Impact: for an anchor >180 days old, web shows a ±8% band and iPhone shows the same center with a falsely-confident ±2.5% band (rendered at `K_TargetsProjection.swift:410`). David's Disney anchor (Feb 1) crosses 180 days. Center time agrees; only band width diverges.
- Fix direction: pass `anchor.anchorDateISO` into both `computeGoalProjection` and `computeConfidenceInterval`.

**Race detail elevation-profile caption and axis labels are hardcoded for a 360→20ft marathon on every race**
- Surface: web — Races (race detail · elevation profile panel)
- File: `web-v2/components/faff-app/views/RaceView.tsx:593,600`
- What's wrong: line 593 is a static literal "Start 360 ft → Finish 20 ft"; line 600 is static marathon ticks "START / 10K / HALF · 13.1 / 30K / FINISH". The SVG curve (`r.elevPath`) is real and per-race, but the caption and axis are not bound to any field. The RaceDetailSeed type has no `elevStartFt`/`elevFinishFt`, though `elevPathFromGeometry` already iterates `trackPoints[].ele` so first/last ele are trivially available.
- Expected: read start/finish from trackpoints (first/last ele) and scale the distance ticks to `distanceMi` (on the seed).
- Impact: a half/10K race renders "HALF · 13.1 / 30K / FINISH" and "Start 360 ft → Finish 20 ft" on top of an otherwise-correct curve — misleading caption for non-marathon or non-360→20ft courses.
- Fix direction: derive the caption and ticks from `geom.trackPoints` and `distanceMi`.

**Pre-run HEART RATE target falls back to hardcoded population HR bands instead of the runner's zones**
- Surface: iPhone Today — pre-run body
- File: `native-v2/Faff/Faff/Components/TodayPreRunBodyV3.swift:626-648`
- What's wrong: `heartRateTarget` returns `.recovery: "<125 bpm · Z1"` unconditionally (no payload read), and fixed bands for the other types when the payload lacks an HR target. Recovery never gets an HR target in the payload (`build-workout.ts:495` sets `hrCeilingBpm` only for easy/long; recovery's `spec.hr_cap_bpm` is computed but never read by build-workout). MP-finish longs force `hrCeilingBpm=null`. The hardcoded tempo/interval bands fire only when both LTHR and HRmax are null (build-workout has a maxHr fallback layer the finding's evidence missed).
- Expected: derive HR targets from the runner's HRmax/LTHR or render "—" when unavailable (CLAUDE.md: no fabricated values). The Z-label is always correct; only the numeric bpm is fabricated.
- Impact: a runner reading "<125 bpm · Z1" on recovery or a band on an MP-finish long may chase a bpm that doesn't match their zones. For David (HRmax via override) only recovery and MP-finish-long cases misfire. Easy/long were already partially fixed.
- Fix direction: emit a recovery HR cap from the backend, or render "—" when no zone is available.

**Today readiness 'THIS WEEK' chip rounds weekly miles to a whole number (27.5 reads 28)**
- Surface: iPhone Today — readiness panel
- File: `native-v2/Faff/Faff/Components/TodayReadinessPanel.swift:178-182`
- What's wrong: `let rounded = Int(m.rounded())` half-up-rounds the done-so-far miles. The source (`TodayView.swift:2333` `weekDoneMi`) is a true 1-decimal canonical sum; this is the only surface that truncates it.
- Expected: keep one decimal to match the app-wide convention. Train (`TrainView.swift:219` `trainMi`) and Calendar render "27.5".
- Impact: weekly done-miles on the most-viewed surface disagrees with Train/Calendar by up to ~0.5 mi and rounds up, so a glance reads more mileage than was run. Underlying data is fine.
- Fix direction: render `%.1f` like the rest of the app.

**TrainView 'This week' uses the plan_weeks Monday boundary while Today strip + Calendar use long_run_day**
- Surface: iPhone Train vs Today/Calendar
- File: `native-v2/Faff/Faff/Views/TrainView.swift:209-219`
- What's wrong: the Train "This week" card sums `state.weeks.first(isCurrent).days` from TrainingState (plan_weeks, Monday-anchored — generators store `week_start_iso` via `mondayOf`), while Today WeekStrip and Calendar bucket from `/api/plan/week` (ends on `long_run_day`).
- Expected: all three agree on the boundary; `/api/plan/week` is the SoT and the iPhone "dropped its client Mon-Sun re-bucket." TrainView reading Monday-anchored training-state weeks is the outlier.
- Impact: for a Saturday-long runner the Sunday run lands in different weeks across tabs, and the weekly mileage total differs by that day's miles. Display-only; the SoT layer is correct. David (Sunday) unaffected.
- Fix direction: derive TrainView's week from `/api/plan/week`, or anchor plan_weeks to `long_run_day`.

**Tempo workouts tagged paceLabel 'M' (marathon) though run at threshold — user-visible on the iPhone run mirror**
- Surface: watch payload (`build-workout.ts`) consumed by watch + iPhone WatchMirrorView/TreadmillView
- File: `web-v2/lib/watch/build-workout.ts:247-258,538`
- What's wrong: `paceLabelFor` returns `'M'` for `tempo` (line 251) though tempo pace is threshold-derived (`spec-builder.ts:228` `tempo = tPaceSec + 12`; MP is the separate `tPaceSec + 18`). `paceLabelFor` itself returns `'T'` for `threshold`, proving intent. On the watch the tag is inert (no Face reads it), but the iPhone WatchMirrorView DOES render it: `FaffEffort.fromType("m")` has no `"m"` case → defaults to the teal EASY mesh for the whole screen, and `statBlock` shows a literal "M" under TARGET.
- Expected: tag `'T'` for tempo. Daniels tempo/T is threshold zone, not marathon.
- Impact: every tempo run renders the wrong full-screen mesh color and a literal "M" stat on the iPhone in-run mirror (a recurring weekly session type). WatchMirrorView/TreadmillView are secondary read-only run consoles. PlannedView happens to mask it (its default returns "tempo"). (The finding originally rated this P3 on a false "never rendered" premise; it is rendered, hence P2.)
- Fix direction: add the `'tempo' → 'T'` case in `paceLabelFor`.

**iPhone TrainView weekDone + recovery 'banked mi' use the deprecated MAX-per-day heuristic, not the canonical deduper**
- Surface: iPhone — Train, Today recovery panel vs Today "WEEK MI"
- File: `web-v2/lib/coach/training-state.ts:331-342`; `web-v2/lib/coach/recovery-brief.ts:487`; `web-v2/lib/runs/volume.ts:13-17`; `state-loader.ts:204-207`
- What's wrong: `loadTrainingState.weekDone` sums `MAX((data->>'distanceMi')::numeric) GROUP BY day` (only `NOT (data ? 'mergedIntoId')`), while `state-loader`/`glance-state` use `canonicalMileageByDay`. `recovery-brief.ts:487` prefers the MAX value (`trainingState?.weekDone ?? state.weekDone`). Within the same function, the per-day `days[].doneMi` IS canonical (queried via `getCanonicalRunIds`), so `loadTrainingState` returns a canonical per-day sum and a MAX-heuristic top-level total that can disagree.
- Expected: all "week miles" readers use `canonicalMileageByDay` per the locked Faff volume SoT rule.
- Impact: iPhone Train top-level number and Today recovery "banked mi" tile (`TodayRecoveryPanel.swift:375`) can disagree with the Today "WEEK MI" tile on days with divergent-distance HK↔Strava dupes or genuine same-distance doubles. The MAX query excludes merged rows, so divergence only manifests on unflagged-escaped dupes or same-distance doubles — conditional, not constant. TrainView's per-day card (sums `days[].doneMi`) is unaffected.
- Fix direction: `training-state.ts:weekDone` should call `canonicalMileageByDay`; recovery-brief should prefer the canonical value.

**Easy-pace offset drift in the no-spec fallback (mirror of the prescriptions finding, cross-surface framing)**
- Surface: web glance-adapter + watch/iPhone-Today fallback vs authored spec
- File: `web-v2/lib/plan/spec-builder.ts:224-226`; `web-v2/lib/training/prescriptions.ts:150,241-243`; `web-v2/lib/training/expand-spec.ts`
- What's wrong: authored spec uses T+80/+120; the no-spec fallback (`prescriptions.paces`/`derivePaces`) uses T+60/+110. `glance-adapter.ts` (`lib/faff/`, not `lib/plan/`) forks on spec presence — spec present uses `pace_target_s_per_mi_lo/_hi`, spec absent uses `derivePaces`. The watch's spec-absent easy *phase pace* is yet a third value (`build-workout.ts:395-397` `goalPace + 90`).
- Expected: the fallback offsets should match the authored spec floor (T+80/+120) so a workout's easy pace doesn't change once a spec is authored (Research/01 §VDOT-50).
- Impact: a cold-start/pre-migration easy run reads ~20 s/mi faster than the same run once a spec is authored. The no-spec path is transient (a backfill cron authors specs), so live exposure is limited to cold-start rows.
- Fix direction: bump `prescriptions.ts:150` + `derivePaces:241-242` to T+80/+120.

### P3

**movingTimeS vs movingSec key divergence: webhook-ingested runs have no movingTimeS**
- Surface: web — recovery anchor end-time SQL, log-state, races-state
- File: `web-v2/app/api/strava/webhook/route.ts:520-521`; `web-v2/lib/strava/pullSync.ts:146`
- What's wrong: pullSync writes `movingTimeS`; the webhook writes `movingSec`/`durationSec` but never `movingTimeS`. Strict `movingTimeS`-only readers get null: `recovery-brief.ts:679` (no COALESCE, end-time falls back to midpoint of today), `log-state.ts:238-239`, `races-state.ts:138`. Two more strict readers exist beyond the finding (`training-state.ts:167`, `recovery-phase.ts:212`). `run-state.ts:509` is safe (falls back to `durationSec`).
- Expected: one canonical key, or every reader COALESCEs `movingTimeS`/`movingSec`/`durationSec`.
- Impact: blank moving-time and a degraded recovery-window end anchor for webhook-sourced runs. Self-healing: the daily cron's pullSync enhance branch backfills `movingTimeS` within ~24h for any run inside the 30-day window. `vdot-inputs.ts:276` already carries a "was movingTimeS-only" fix comment.
- Fix direction: write a canonical moving-time key on all ingest paths.

**durationSec holds elapsed time from webhook but moving time from watch/HK/pullSync**
- Surface: web — runs identity dedup span math + per-run display
- File: `web-v2/app/api/strava/webhook/route.ts:498-520`; `web-v2/lib/runs/identity.ts:45-46,82`
- What's wrong: webhook stores `durationSec: elapsedSec`; watch/HK store moving/active. `identity.ts:45` reads `durationSec ?? movingTimeS ?? elapsedTimeS` and `endUtcMs = startUtcMs + durSec*1000` feeds `spansOverlap`. Mixed semantics in one key.
- Expected: one key, one definition. No dedup false-negative in the trustworthy path (longer elapsed makes overlap more likely; webhook is PROVIDER_LOCAL so it never hits the ±120s duration-equality fallback when paired with another trustworthy row).
- Impact: per-run "duration" reads elapsed for webhook runs but moving for others. One edge: a webhook row paired with an untrustworthy row could exceed the 120s equality test on a stop-heavy run (rare). Latent inconsistency, not active corruption.
- Fix direction: normalize to one definition (preferably elapsed) at ingest.

**Canonical volume reader filters only mergedIntoId; pullSync's matcher also filters absorbed_into_canonical_at**
- Surface: web — volume reader vs Strava pull matcher
- File: `web-v2/lib/runs/volume.ts:40`; `web-v2/lib/strava/pullSync.ts:240-241`
- What's wrong: `volume.ts` uses `NOT (data ? 'mergedIntoId')`; `findCanonicalRow` requires `absorbed_into_canonical_at IS NULL AND (data ? 'mergedIntoId') = false`. An orphan-state row (flag cleared, stamp set) is visible to volume but invisible to the matcher.
- Expected: one shared predicate. Volume can't double-count (read-time clustering collapses it); the only consequence is pullSync inserting a fresh dupe, healed on the next merge pass.
- Impact: a transient duplicate Strava insert in the orphan edge case. The orphan state is no longer freshly creatable (merge.ts atomically clears both flags since 2026-06-11), so this is legacy residue only.
- Fix direction: share the canonical-row predicate across both paths.

**Zone-aware training-VDOT read over-reaches the research (tempo→vdotFromTpace, MP→vdotFromMpace)**
- Surface: web + iOS — current-VDOT estimate from training runs
- File: `web-v2/lib/training/vdot.ts:368-372,129-158`
- What's wrong: `vdotFromRun` reads a sustained threshold effort directly into VDOT via `vdotFromTpace` and MP via `vdotFromMpace` — no cap, no field-test gate. Feeds `bestRecentVdot` → the live snapshot cron, plan generator, drift monitor.
- Expected: Research/01 §Triggers to retest treats a tempo feeling easier as a SOFT signal ("+1 VDOT estimated; field-test within 2 weeks"); only an all-out race or deliberate field test sets VDOT.
- Impact: `bestRecentVdot` takes the MAX so a training estimate can only inflate, never deflate. A hot-tempo runner clears the HR gate (`avgHr ≥ 0.80*maxHr`) and still over-reads ~2-3 VDOT. Latent for David (his tempos land on-target). The doctrine-correct version of this intent already exists (`3ba8529a`, confined to projection space) — this direct read is the superseded mechanism still driving the live current-VDOT snapshot.
- Fix direction: route training estimates through the capped, field-test-gated soft-estimate path.

**Plan weeks (plan_weeks rows) do not end on long_run_day, so weekPlanned straddles the WeekStrip window**
- Surface: web backend — plan persistence vs `/api/plan/week`
- File: `web-v2/lib/plan/generate.ts:2301-2304,1772-1773`
- What's wrong: plans are Monday-anchored (`startMondayISO = mondayOf(today)`); each plan_weeks row spans Mon-Sun. `/api/plan/week` slices a window ending on `long_run_day`. So a plan_weeks row and the strip window are different 7-day groupings for non-Sunday runners.
- Expected: anchor `plan_weeks.week_start_iso` to the day after `long_run_day` so a plan_weeks row equals the strip window.
- Impact: native Today (long-run-anchored) vs native Train + web (Monday-anchored) show different per-week planned totals for non-Sunday runners. (Note: the affected web/native surfaces differ from the finding's framing — web is internally consistent because both its surfaces are Monday-anchored.) Default `long_run_day='sun'` so David is a no-op.
- Fix direction: anchor plan generation to `long_run_day` (resolves several week-boundary findings at the root).

**Maintenance composer's per-week weeklyMi self-reference is dead code**
- Surface: web backend — maintenance plan composition
- File: `web-v2/lib/plan/generate.ts:1533`
- What's wrong: `weeklyMi: weeks[wi]?.weeklyMi ?? (wi === 3 ? ... : targetWeekly)` reads `weeks[wi]` before it's pushed, so it's always undefined and the fallback always evaluates. The intended "reuse already-computed weeklyMi" read never happens.
- Expected: drop the dead clause, or compute weeklyMi to match `maintenanceWeek(wi)`'s internal value (currently two parallel hardcoded expressions agree by coincidence for the fixed 4-week cycle). The pattern was likely copied from the race-prep composer (`weeklyMi: vols[wi]`) where `vols` is genuinely pre-computed.
- Impact: no incorrect output today; latent footgun if the cutback cadence changes (the 0.80 cutback is duplicated in two must-change-in-lockstep places).
- Fix direction: remove the dead clause.

**HRV streak fallback baseline includes the recent depressed days (self-referential drift)**
- Surface: Health — STREAKS card, headline, trendNote
- File: `web-v2/lib/coach/readiness-brief.ts:914`
- What's wrong: when Plews rolling data is unavailable, the baseline is the mean of the full history including the streak's own low days, which drags it down. The sibling RHR streak (:935) correctly excludes the last 7. A second instance exists at `readiness-snapshot.ts:123-134`.
- Expected: use the same recent-window-excluded baseline as the rest of the system. The "60-day average" copy strings are also mislabeled (the fallback only runs at history length 3-13).
- Impact: cold-start only (length 3-13; at ≥14 the superior Plews per-day-drop detector supersedes). Marginally shortens a reported day-count rather than missing a streak. Note: the finding's proposed `slice(0,-7)` fix is inapplicable in this window (empty slice at length 7). Real consistency defect, low practical impact.
- Fix direction: a window-appropriate baseline that excludes the active dip without breaking at small N.

**loadYesterdaySnapshot is dead code (no callers)**
- Surface: Health — none (unused)
- File: `web-v2/lib/coach/readiness-brief.ts:809-832`
- What's wrong: replaced by `computeYesterdayPillars` (per the comments at :349-362, :714-733) but the body remains; module-private with zero call sites (only the definition + two explanatory comments).
- Expected: safe to remove.
- Impact: none at runtime. Flagged because a future caller wiring to it would reintroduce the documented one-day-stale snapshot mover bug.
- Fix direction: delete it.

**readiness.ts header docstring says HRV is a '7-day rolling avg' but it is a 7-day median**
- Surface: Health — doc only
- File: `web-v2/lib/coach/readiness.ts:13`; `glance-state.ts:480,489`
- What's wrong: the header says "HRV 28% → 7-day rolling avg," but every producer (`glance-state.ts:480`, `state-loader.ts:273`, `health-state.ts:459`) computes `hrvCurrent` as a 7-day median. The user-facing label (:106) correctly reads "7d median."
- Expected: header should say "7-day median" (the Jun-8 partial-night fix). The "vs 30-day baseline" half is also loosely worded (the baseline excludes the recent 7).
- Impact: documentation drift only; no wrong number reaches the user.
- Fix direction: correct the header comment.

**Strength week is hardcoded Mon-Sun in the recommender but the strip/plan week is anchored to long_run_day**
- Surface: web backend / iPhone strip
- File: `web-v2/lib/coach/strength-recommender.ts:469-471,647-655`; `glance-state.ts:283-289`; `training-state.ts:296`
- What's wrong: the recommender windows `weekStart..weekStart+6` (it's not itself hardcoded Monday; it inherits whatever start it's handed). `glance-state` hands it a hardcoded Monday; `training-state` hands it the Monday-anchored `plan_weeks.week_start_iso`. So the strength week and the `/api/plan/week` strip week diverge for non-Sunday runners.
- Expected: derive the recommender's window from `long_run_day` (same SoT as `/api/plan/week`).
- Impact: the claimed harm (miscounted weekly target) does not surface — the "X/Y this week" count chip was removed on web and never existed on iPhone, and every strength display on every surface is per-day, date-matched (correct). The recommender's internal count is self-consistent. Latent/internal cosmetic inconsistency only; no-op for David.
- Fix direction: thread the `long_run_day` window when/if a weekly count is ever surfaced.

**loadHabit days-since / 7d / 14d windows use server Date.now() against UTC-midnight DATE values**
- Surface: web backend — habit state → dormant coach intent
- File: `web-v2/lib/coach/strength-recommender.ts:434,440,442`
- What's wrong: the SQL window is runner-TZ anchored (`runnerToday`), but `daysSince` and the 7/14-day distinct-windows use machine-clock `Date.now()` against a DATE column. (Correction to the finding's mechanism: node-postgres parses a bare DATE as LOCAL midnight, not UTC; but Railway's container defaults to UTC, so local==UTC in prod, and the comparison against a PDT runner still flips at UTC midnight ≈ 17:00 prior runner-local day.)
- Expected: compute `daysSince` and the windows relative to `runnerToday` on a calendar-day basis, matching the SQL window and the file's TZ discipline.
- Impact: the habit bucket and the "you haven't lifted in 3 weeks" dormant-intent trigger can flip by up to ~1 day at the 14d/21d thresholds, contingent on server TZ ≠ runner TZ. No displayed number is wrong.
- Fix direction: anchor the day math to `runnerToday`.

**strength-status buildSummary can emit '0/N this week' for a week the runner did train — but the summary string is never rendered**
- Surface: web backend — `StrengthWeekStatus.summary`
- File: `web-v2/lib/coach/strength-status.ts:183-196`; reachable via `glance-state.ts:761-763`
- What's wrong: a session logged on a day the recommender consequently stopped recommending lands in `bonus`, not `confirmed`, so `buildSummary` understates a met goal. (The exact "0/1 + 1 bonus" string requires `recommendedCount=1`; the simpler remaining-target-zero case yields "1 bonus session this week (none scheduled)" — both understate.)
- Expected: count a logged session on a viable day as confirmed, or suppress the misleading phrasing when bonus already satisfies the target.
- Impact: none today — `summary` is dead output. Every surface's per-day done glyph is driven by `confirmed ∪ bonus` (web) / `completedStrengthDays` (native), which render correctly. Becomes P2 the moment any surface renders `summary`.
- Fix direction: fix the bucketing or the phrasing before surfacing `summary`.

**phaseFrequencyCap returns 3 for maintenance mode but is always clamped to 2 by the hardcoded runner preference**
- Surface: web backend
- File: `web-v2/lib/coach/strength-recommender.ts:388` vs `251/513/258`
- What's wrong: `phaseFrequencyCap` returns 3 for maintenance/off-season, but `loadPreferences` unconditionally returns `daysPerWeek: DEFAULT_STRENGTH_DAYS_PER_WEEK` (=2) because `profile.strength_days_per_week` doesn't exist, and `target = Math.min(2, 3, ...)`. The 3-branch is unreachable.
- Expected: Research/07 §2.1 (off-season 2-3) allows 3. The file's own lines 510-511 already acknowledge the column is a stopgap.
- Impact: no wrong number (2 is valid for off-season); the "can go higher (3)" branch and its comments are dead — a maintainability trap.
- Fix direction: wire `profile.strength_days_per_week`, or note the branch is intentionally inert.

**Interval work-pace 'avg' in recap is an unweighted mean of rep paces, not distance-weighted**
- Surface: web + iPhone — interval/tempo recap lead "X mi @ Y avg"
- File: `web-v2/app/api/runs/[id]/recap/route.ts:230-234`
- What's wrong: `workPaceSPerMi = workPhases.reduce((s,p)=>s+p.actualPaceSPerMi,0)/workPhases.length` ignores per-rep distance; `workDistanceMi` is summed separately and printed alongside. A 1mi@6:00 + 0.5mi@7:00 set yields mean 6:30 but true avg 6:20.
- Expected: distance-weight (total work time / total work distance). The verdict path uses the separate `repPaces` array, not this mean.
- Impact: on mixed-distance interval sets the displayed average is a few s/mi off and inconsistent with the shown mileage. Vanishes for equal-length reps (this user's standard shape). Display-only.
- Fix direction: distance-weight the work pace.

**detectVdotTrendDrift 'recent' subquery: the rn<=7 smoothing predicate is dead**
- Surface: web — VDOT-trend drift detector
- File: `web-v2/lib/training/goal-projection.ts:847-858`
- What's wrong: `(SELECT vdot FROM ranked WHERE rn <= 7 ORDER BY snapshot_date DESC LIMIT 1)` keeps the 7 newest then re-selects the newest (rn=1). The `<=7` filter is a no-op; no smoothing is applied.
- Expected: if smoothing was intended, use AVG/median over `rn<=7`.
- Impact: no wrong number; the detector still fires on a genuine multi-point decline (the underlying `vdot` is a slow-fading MAX, inherently stable). Logic-clarity only.
- Fix direction: drop the dead predicate or implement real smoothing.

**Overview weekly-volume tile rounds miles to whole numbers**
- Surface: web — Overview WEEKLY VOLUME tile
- File: `web-v2/components/faff-app/seed.ts:949,968`
- What's wrong: `adaptVolumeBars` does `Math.round(byMon[iso] ?? 0)` per week and on the 8-wk avg, discarding the one-decimal precision `log-state.ts:305` produces.
- Expected: keep one decimal to match `/log` (`{week.totalMi.toFixed(1)}`) and the iPhone (`%.1f`).
- Impact: the Overview weekly number reads ~0.x mi off the same week on `/log` or the phone. Cosmetic.
- Fix direction: render one decimal.

**'8-wk avg' weekly volume excludes zero-mileage weeks from the denominator**
- Surface: web — Overview WEEKLY VOLUME tile
- File: `web-v2/components/faff-app/seed.ts:969-970`
- What's wrong: `const prior = bars.slice(0,-1).filter(b => b.mi > 0)` strips zero weeks from both numerator and denominator, so the labeled "8-wk avg" is an average of active weeks only. (Also: even unfiltered the denominator is 7 completed weeks, not 8.)
- Expected: divide by the full window, or relabel.
- Impact: overstates the trailing average for runners with any down weeks; the label promises an average it doesn't compute. Cosmetic.
- Fix direction: drop the `.filter` and relabel to the true window.

**Goal/Race-day progress bars are filled by 'fraction of a year elapsed', not goal attainment, yet colored on-track/off-track**
- Surface: web — Overview THE GAP tile (RACE DAY tile is neutral-colored, so only THE GAP misleads)
- File: `web-v2/components/faff-app/seed.ts:902`
- What's wrong: `goalPct = 100 - (days/365)*100` is calendar-time elapsed, but THE GAP bar (`TodayView.tsx:4728-4734`) renders it as fill width AND tints it with the on-track/off-track status color. A race 250 days out reads as ~32% "progress" with no fitness data. The sibling GoalReadyBody bar uses true fitness attainment (`currentVdot/requiredVdot`) — the correct pattern.
- Expected: a status-tinted bar should encode goal attainment, or be relabeled as a countdown.
- Impact: misleading visual encoding (length = calendar, color = status). No wrong scalar shown as text.
- Fix direction: drive the fill from fitness attainment, or use a neutral countdown color.

**Weekly planned-mileage aggregates render as whole integers in the phase-arc week list**
- Surface: iPhone Train — phase arc / week list
- File: `native-v2/Faff/Faff/Views/TrainView.swift:1319,1421`
- What's wrong: `Int(week.plannedMi.rounded())` and `/\(Int(row.plannedMi.rounded()))mi` round the 1-decimal weekly total to whole. The per-day and "this week" totals (`trainMi`) correctly preserve the decimal.
- Expected: one decimal for consistency. This is a compact list aggregate, so lower severity than a per-day mislabel.
- Impact: weekly totals lose the half-mile in the week list. Cosmetic.
- Fix direction: format with `trainMi`/`%.1f`.

**Dead pace-bucket/endpoint color constants in TodayPostRunBody disagree with the live RouteMapView palette**
- Surface: iPhone Today post-run — route map
- File: `native-v2/Faff/Faff/Components/TodayPostRunBody.swift:1165-1174`
- What's wrong: `PACE_BUCKETS`/`START_RING_COLOR`/`FINISH_FILL_COLOR`/`BASELINE_UNDER_COLOR`/`overlayText` have zero references; the live route + legend render from `RouteMapView.bucketColors`. `PACE_BUCKETS[0]` (0xFC4D64) ≠ `RouteMapView.bucketColors[0]` (0xF43F5E).
- Expected: remove the dead constants so they can't be revived with the wrong palette.
- Impact: none today. Latent cleanup risk.
- Fix direction: delete the dead constants.

**Run detail eyebrow hardcodes 'AM' for the run start time**
- Surface: iPhone Run Detail
- File: `native-v2/Faff/Faff/Views/RunDetailView.swift:661-663`
- What's wrong: the eyebrow appends a literal " AM" and leaves the hour in 24h form (`start_local` is `HH:mm:ss`). A 17:30 start renders "17:30 AM"; midnight renders "00:xx AM".
- Expected: format with a DateFormatter or derive AM/PM from the hour — "5:30 PM".
- Impact: cosmetic label error for any afternoon/evening run; affects no metric.
- Fix direction: use a `DateFormatter`.

**Threshold/interval warmup pace differs: web implies 8:30/mi (duration only), watch paces it at goal+90s/mi**
- Surface: web glance-adapter vs watch/iPhone-Today
- File: `web-v2/lib/faff/glance-adapter.ts:574,584`; `web-v2/lib/watch/build-workout.ts:395-397,402`
- What's wrong: web derives the WU/CD duration from a hardcoded 510 s/mi and shows only a duration; the watch builds the WU/CD phase pace from `goal_pace + 90`. (A known placeholder — `glance-adapter.ts:713-715` has a 2026-05-28 TODO.)
- Expected: same easy-pace basis for WU/CD (the authored spec easy band or a shared constant).
- Impact: not a head-to-head contradiction (web shows a duration, watch shows a pace; ~8 s/mi apart). The meaningful WORK rep pace agrees on both surfaces, and the iPhone Today headline surfaces the rep pace. Cosmetic/secondary.
- Fix direction: share one easy-pace basis for warmup/cooldown.

**Stale weight-percent comments in readiness.ts (comments say 30%, labels and weights are 28%)**
- Surface: web/iPhone/watch — readiness (shared)
- File: `web-v2/lib/coach/readiness.ts:42,73`
- What's wrong: comments label SLEEP and HRV as 30% while the emitted labels are 28% and the header table is 28/28/24/15/5=100%. RHR is also affected (`// RHR (25%)` at :117 vs the 24% label).
- Expected: comments should match the 28%/24% labels.
- Impact: none — every surface displays the correct label (single-source via `computeReadiness`). Comment hygiene; a future edit could trust the wrong comment.
- Fix direction: correct the comments (including the RHR/clamp comments, not just lines 42/73).

## Verified clean

- **Canonical volume reader** (`volume.ts`): reads canonical runs only, re-clusters at read time, sums each cluster once — an unflagged dupe cannot inflate the total. `getCanonicalRunIds`/`recentMileageMi`/`recentWeeklyMileageMi` all derive from this one reader.
- **Merge ordering** (`merge.ts autoMergeForDate`): clears run before sets, so the circular A↔B class is structurally prevented; clears the absorbed stamp together with `mergedIntoId`, fixing the promoted-canonical-invisible bug. `identity.test.ts` asserts a circular pair resolves to one canonical.
- **Rule 6 (multi-writer jsonb preservation)**: honored on every `runs.data` writer (watch/HK/webhook all use `data = runs.data || jsonb_strip_nulls(EXCLUDED.data)`); weather enrichment uses a scoped patch; `races.actual_result` write is field-level COALESCE merge.
- **Splits**: absorption is tier-independent and non-destructive (real splits never demoted); internal-consistency guards drop truncated splits when split-sum vs duration differs by >5s at ingest.
- **Cross-user activity-id collision**: guarded on all Strava write paths (owner pre-check, `WHERE runs.user_uuid = EXCLUDED.user_uuid` makes a cross-user conflict a no-op).
- **Sub-threshold tap-test runs**: dropped uniformly across all four ingest sites (<0.25mi AND <180s).
- **normalize-time.ts**: source decision tree matches per-source storage conventions; ingest weather enrichment normalizes before the Open-Meteo fetch.
- **VDOT formula constants**: `vo2Cost` and `pctVO2` match Research/01 byte-for-byte. Daniels race-time table accurate within seconds for 5K/10K/HM/Marathon at VDOT 30-85; worked examples match (21:25 5K → 46.0, 19:57 5K → 50.0). Table-edge clamping is sane (30-85, null beyond).
- **Race-result source-of-truth ladder**: `actual_result.finishS` → `meta.finishTime` → provisional Strava match; no `canonicalLabel` read in web-v2, race-day activities excluded from VDOT (C1-1e); `loadVdotInputs` throws rather than swallowing.
- **Pace derivation**: all paces are T-offsets (not the deprecated E=M+75/R=mile-pace shortcuts, which live only in legacy). Easy T+80..120, M=T+18, T=HM-5, I=Daniels 5K pace — all within a few seconds of doctrine. `parseRaceTime` H:MM/MM:SS heuristic is regression-tested; mile goals flow through exact integers.
- **bestRecentVdot**: stale-anchor fade is estimator smoothing (not physiology), fresh anchors unaffected, newer evidence wins on max, race beats training-estimate on ties (sort-only -1 penalty, displayed value unmodified).
- **Plan generation**: honors `long_run_day`/`rest_day`/`quality_days`/`weekly_frequency` via `loadSettings`; frequency caps correct in `layoutWeek` and `seed-from-onboarding`; `volumeCurve` 10% ramp cap; taper bands match Research/08; `sizeBlocks` phase ordering chronological; `totalWeeks` forced integer; persist wrapped in a transaction with rollback; `is_peak`/`is_cutback` derivation correct. `/api/plan/week` boundary math itself is correct for any `long_run_day`.
- **Readiness**: pillar weights sum to 100%; clamps match docs (RHR asymmetry intentional); cold-start gating consistent (LOAD-only treated as cold-start, no false READY); no fabricated values when data missing; HRV/RHR windows match displayed labels; ACWR uses canonical dedup + Gabbett bands; Plews HRV derivation (log → 7d rolling → SWC excluding today) matches Research/15; recovery-phase weights sum to 1.00, timelines match Pfitzinger/Daniels/Friel, sleep target fixed at 7.5h (correctly does NOT inherit the dynamic-target bug); race-week guard keeps medical hard rules; subjective override math correct; BASELINE/NET/TODAY composition is an honest within-definition delta.
- **HRmax absence**: not a defect on the readiness/health surface — every HR pillar is scored vs the runner's own rolling baseline.
- **Strength**: weekly target is a COUNT filled by logged sessions; a logged day is excluded from `unlogged` and is never a roll-forward source; all logged dates decrement the target (matches David's Jun-11 fix).

## Coverage

Audited all three surfaces (web command center, iPhone, watch payload) plus the shared coach engine across volume/dedup, VDOT/pace, plan generation, goal-projection/drift, readiness/health, strength, race-data integrity, run-recap, cross-surface consistency, and per-surface display — every finding grounded to file:line.