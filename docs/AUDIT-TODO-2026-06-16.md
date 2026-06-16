# Audit TODO — 2026-06-16

Master action list from the full-app audit ([FULL-APP-AUDIT-2026-06-16.md](FULL-APP-AUDIT-2026-06-16.md)). 52 confirmed findings. Nothing changed yet — this is the plan.

**How to read it.** Part 1 is the cross-surface reconciliations: where web and iPhone/watch compute the same metric differently, so a direction has to be picked. Default per David: iPhone is the most-invested surface, so **web changes to match iPhone** — but confirm each, because two items are the reverse (the iPhone is the wrong side, flagged ⚠️). Parts 2–4 are single-source fixes with no direction question.

---

## Part 1 — Cross-surface reconciliations (need a direction call, item by item)

Each line: what each surface shows → the audit-canonical answer → proposed direction. Tick the box once you've confirmed the direction.

- [ ] **#51 · P1 · Goal projected finish time.** Web shows the goal-seeking trajectory (~1:30); iPhone shows raw current-fitness from the snapshot (~1:34) — ~5 min apart on the flagship number, plus an iPhone-internal contradiction (prose says 1:30, big number says 1:34). Audit-canonical = goal-seeking (plan-trusts-itself doctrine). **Proposed: iPhone → match web** (render `trajectoryProjectedSec` as the iPhone primary). ⚠️ **Exception to the default — iPhone is the wrong side here.** `K_TargetsProjection.swift:386`

- [ ] **#36 · P2 · Targets confidence band width.** Web widens the band to ±8% when the fitness anchor is >180 days stale; iPhone never applies that override → a narrower, falsely-confident band for the same runner. **Proposed: iPhone → match web** (thread `anchorDateISO` into the iPhone projection route). ⚠️ **Exception — iPhone is the wrong side.** `app/api/targets/projection/route.ts`

- [ ] **#34 · P1 · Today goal tile vs Targets gap panel (both web).** Today derives status/color/projected from the drift ladder; Targets derives it from the forward trajectory → same runner can read OFF TRACK (red) on Today and ON TRACK on Targets. Canonical = trajectory-derived. **Proposed: Today tile reads the same trajectory status/number as Targets** (web-internal, no iPhone side). `TodayView.tsx` + `TargetsView.tsx` + `seed.ts`

- [ ] **#6 + #54 · P2 · Easy-pace band.** Web Today modal / Poster (`prescriptions.ts`) uses E = T+60..110; the watch + the authored plan spec (`spec-builder.ts`) use T+80..120 — ~15–20 s/mi apart on the same easy day. Canonical = T+80..120 (Research/01, the Jun-8 floor-raise). **Proposed: web → match watch/spec** ✓ (web carries the stale faster band; matches the default). `prescriptions.ts` vs `spec-builder.ts`

- [ ] **#9 + #39 · P2 · Training-week boundary (web/backend totals).** `/api/plan/week` and the iPhone strip use the long-run-day boundary (shipped this session); `training-state.ts`, `glance-state.ts`, `log-state.ts`, and the web Overview week totals still hardcode Monday. **Proposed: the Monday readers → match the long-run-day SoT** ✓. For you (Sunday long) Mon–Sun coincide so nothing visibly changes; it's correctness for Saturday-long users. *(This is the incomplete half of this session's boundary fix.)* `training-state.ts`, `glance-state.ts`, `log-state.ts`, `seed.ts`

- [ ] **#46 · P2 · iPhone TrainView "this week".** TrainView reads the `plan_weeks` Monday boundary while the iPhone Today strip + Calendar use long-run-day → the three iPhone tabs can disagree on which 7 days are "this week." **Proposed: TrainView → long-run-day** ✓ (iPhone-internal; long-run-day is canonical). `TrainView.swift`

- [ ] **#52 · P2 · iPhone weekDone + recovery "banked mi".** TrainView weekDone and the recovery panel's banked-mi use the deprecated MAX-per-day heuristic instead of the canonical deduper, so they can disagree with Today's "WEEK MI." **Proposed: backend readers → `canonicalMileageByDay`** ✓ (per the volume source-of-truth rule). `training-state.ts`, `recovery-brief.ts`

- [ ] **#18 · P2 · RHR streak vs threshold line baselines (web Health).** The STREAKS card and the [N/M] progress line use different RHR baselines (one excludes the last 7 readings, one doesn't) → they can contradict. **Proposed: both read one `state.rhrBaseline`.** `readiness-brief.ts` + `health-actions.ts`

- [ ] **#55 · P3 · Warmup/cooldown pace basis.** Web glance implies ~8:30/mi (duration only); the watch paces warmup at goal+90 s/mi. **Proposed: shared easy-band basis on both.** `glance-adapter.ts` + `build-workout.ts`

---

## Part 2 — Correctness fixes (single source of truth — just fix, no direction call)

### P1
- [ ] **#28 · Goal drift detector throws on finish-time string.** `detectRecentRaceDrift` casts `meta.finishTime` ("1:32:45") to `::numeric` → Postgres throws → swallowed → the one signal that flips a goal off-track never fires for any inline-edited race row. Fix: parse via `parseRaceTime`, not an SQL cast. `goal-projection.ts:758-784`
- [ ] **#31 · Interval heat over-forgiveness.** Rep target uses the full continuous slowdown; Research/06 §2 says intervals get HALF (work:rest cooling). Loosens hot-day in-range bands ~13 s/mi. Fix: halve `slowdownPct` for ≥1:1 work:rest before `adjTarget`/band. `run-recap.ts:149`
- [ ] **#38 · Fabricated race net-elevation.** `netElevFt = -0.24 × gross gain` — a guess, not a measurement — drives the pacing plan + coach insight off a fake downhill (Big Sur, net +260 ft uphill, would pace as downhill). Fix: read net from trackpoints or the curated `net_elevation_ft` column (both exist). `raceDetail.ts:291`

### P2
- [ ] **#1 · Strava cadence stored at two scales.** Cron `pullSync` stores raw (~84 spm); webhook stores `×2` (~168). Cron-synced runs show half, dropped from the baseline. Fix: apply `×2` in pullSync. `pullSync.ts:154`
- [ ] **#7 · 1-mile VDOT off the Daniels table ~4–5 points.** Raw equations diverge at the mile (5:24 → VDOT 54.5 vs table 50). Mile-goal readiness verdict reads pessimistic. Fix: interpolate the table / short-distance correction. `lib/training/vdot.ts`
- [ ] **#29 · Strava-matched finish auto-fills `finishTime` with no provisional flag** → renders as an authoritative PR. Violates race-data rule 3. Fix: flag provisional or don't display as PR. `races-state.ts`
- [ ] **#30 · paceLabel renders "6:60/mi".** Seconds round to 60 instead of carrying. Fix: round total seconds first, then split. `run-recap.ts`
- [ ] **#32 · Long-run recap reports PLANNED easy mileage, not actual.** Fix: derive easy mi from actual distance run. `run-recap.ts`
- [ ] **#35 · Over-performance gate compares whole-run avg HR but credits work-phase pace** → over-credits the projection bonus. Fix: use work-phase avg HR. `goal-projection.ts`
- [ ] **#40 · Race elevation profile caption/axes hardcoded** for a 360→20 ft marathon on every race. Fix: read first/last ele from trackpoints, scale axis to race distance. `RaceView.tsx`
- [ ] **#44 · Pre-run HR target falls back to hardcoded population bands** instead of the runner's zones. Fix: derive from HRmax/LTHR or show "—". `TodayPreRunBodyV3.swift`
- [ ] **#45 · iPhone readiness "THIS WEEK" chip rounds miles to whole number** (27.5 → 28), against the 1-decimal rule. Fix: one decimal. `TodayReadinessPanel.swift`
- [ ] **#50 · Tempo workouts tagged paceLabel 'M' (marathon)** though run at threshold. Latent on watch, wrong at source. Fix: tag 'T'. `build-workout.ts`
- [ ] **#11 · Injury-builder ignores day prefs + weekly_frequency** (hardcodes Mon/Fri rest + Mon–Sun). Fix: honor `user_settings`. `injury-builder.ts`
- [ ] **#12 · Ultra goals get marathon block shape + "MP" race-pace tag** (two divergent `distanceCategoryOf`). Fix: one shared definition. `generate.ts`
- [ ] **#13 · Deload weeks (mod-3) misalign with cutback layout (mod-4)** → easy days squeezed on deload weeks. Fix: share one cutback index. `generate.ts`
- [ ] **#16 · Dynamic sleep target drives the label but not the score** → crediting phantom surplus next to a "target 8.5h" baseline. Fix: feed dynamic target into the score or the label, consistently. `readiness-brief.ts` + `readiness.ts`
- [ ] **#19 · HRV luteal-phase adjustment applied to the score but not streaks/threshold/recovery-phase.** Fix: propagate the filter to every HRV consumer. `readiness.ts` + `readiness-brief.ts` + `recovery-phase.ts`
- [ ] **#20 · HRV CV bands (5%/7%) likely miscalibrated** (literature is CV-of-RMSSD; code uses CV-of-LnRMSSD). Fix: compute CV on raw RMSSD or re-derive cutoffs. `readiness-brief.ts`

### P3
- [ ] **#8 · Training-VDOT zone reads (tempo/MP) over-reach research** (only races/TTs should set VDOT). Fix: bound/route through the soft estimate. `lib/training/vdot.ts`
- [ ] **#33 · Interval work-pace "avg" is an unweighted mean of rep paces**, not distance-weighted. Fix: weight by distance. `api/runs/[id]/recap/route.ts`
- [ ] **#37 · `detectVdotTrendDrift` "recent" smoothing is dead** (always newest snapshot). Fix: AVG over rn≤7 if smoothing intended. `goal-projection.ts`
- [ ] **#2 · `movingTimeS` vs `movingSec` key divergence** (webhook runs lack `movingTimeS`). Fix: one canonical key or COALESCE in readers. `webhook/route.ts`, `pullSync.ts`
- [ ] **#3 · `durationSec` holds elapsed (webhook) vs moving (watch/HK) — mixed semantics.** Fix: one key, one definition. `webhook/route.ts`, `runs/identity.ts`
- [ ] **#4 · Canonical-row predicate divergence** (volume filters only `mergedIntoId`; pullSync also filters `absorbed_into_canonical_at`). Fix: share one predicate. `runs/volume.ts`, `pullSync.ts`
- [ ] **#10 · `plan_weeks` rows don't end on long_run_day** → weekPlanned straddles the strip window for non-Sunday-long runners. Fix: anchor plan_weeks to the same boundary. `generate.ts`
- [ ] **#24 · Strength week hardcoded Mon–Sun** but the strip/plan week is long-run-day → count straddles the wrong week for non-Sunday-long runners. Fix: derive from `long_run_day`. `strength-recommender.ts`
- [ ] **#25 · `loadHabit` windows use `Date.now()` vs UTC-midnight DATEs** (TZ-inconsistent with the rest of the file). Fix: use `runnerToday`. `strength-recommender.ts`
- [ ] **#27 · `phaseFrequencyCap` returns 3 for maintenance but is always clamped to 2** → off-season can't reach the doctrine's 3/wk. Fix: wire `strength_days_per_week` or note it's intentionally inert. `strength-recommender.ts`

---

## Part 3 — Display & cosmetic (low risk)
- [ ] **#41 · Web Overview weekly-volume tile rounds to whole miles** (rest of app is 1-decimal). `seed.ts`
- [ ] **#42 · "8-wk avg" volume excludes zero-mileage weeks** from the denominator. `seed.ts`
- [ ] **#43 · Goal/Race-day progress bars filled by "fraction of year elapsed,"** not goal attainment, yet colored on/off-track. `seed.ts`
- [ ] **#47 · iPhone Train phase-arc weekly mileage renders whole integers** (weekly aggregate — defensible, lowest priority). `TrainView.swift`
- [ ] **#49 · iPhone Run Detail eyebrow hardcodes "AM"** (a 17:30 start reads "17:30 AM"). `RunDetailView.swift`

---

## Part 4 — Dead code / docs (no user impact)
- [ ] **#14 · Maintenance composer `weeklyMi` self-reference is dead code.** `generate.ts`
- [ ] **#17 · HRV streak fallback baseline includes the depressed days** (self-referential, under-counts streaks). `readiness-brief.ts`
- [ ] **#22 · `loadYesterdaySnapshot` is dead code.** `readiness-brief.ts`
- [ ] **#23 · `readiness.ts` docstring says "7-day rolling avg"; it's a 7-day median.** `readiness.ts`
- [ ] **#26 · `strength-status` summary can read "0/N + bonus"** — latent (never rendered). `strength-status.ts`
- [ ] **#48 · Dead pace-bucket color constants in `TodayPostRunBody`** disagree with the live `RouteMapView` palette. `TodayPostRunBody.swift`
- [ ] **#56 · Stale weight-percent comments in `readiness.ts`** (say 30%, weights are 28%). `readiness.ts`

---

## Verified clean (no action)
Canonical volume reader, race-data source-of-truth ladder, VDOT formula constants (5K–marathon), readiness pillar weights, dedup/merge ordering, multi-writer jsonb preservation (Rule 6), strength count/logged-fill logic. No P0s.
