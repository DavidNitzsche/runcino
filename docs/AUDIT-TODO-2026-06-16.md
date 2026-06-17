# Audit TODO — 2026-06-16

Master action list from the full-app audit ([FULL-APP-AUDIT-2026-06-16.md](FULL-APP-AUDIT-2026-06-16.md)). 52 confirmed findings. Nothing changed yet — this is the plan.

**How to read it.** Part 1 is the cross-surface reconciliations: where web and iPhone/watch compute the same metric differently, so a direction has to be picked. Default per David: iPhone is the most-invested surface, so **web changes to match iPhone** — but confirm each, because two items are the reverse (the iPhone is the wrong side, flagged ⚠️). Parts 2–4 are single-source fixes with no direction question.

---

## Part 1 — Cross-surface reconciliations (need a direction call, item by item)

Each line: what each surface shows → the audit-canonical answer → proposed direction. Tick the box once you've confirmed the direction.

- [~] **#51 · P1 · Goal projected finish time.** Web shows goal-seeking (~1:30); iPhone shows current fitness (1:34:54). Both legit, different questions (now vs race day). **DECISION (David 2026-06-16): SHOW BOTH, explicitly** — headline = current fitness, plus an explicit "Plan projects [traj] by race day" line, on both surfaces. ✅ iPhone: race-day line added to `K_TargetsProjection.swift`. ⬜ Web: flip `GapPanel` headline to current-fitness + add the race-day line (pending). Also resolves the aheadOfGoal intra-iPhone contradiction (race-day line is only shown when not-ahead; the headline number is always current fitness). Grounded: current VDOT 47.9 → predictRaceTime(13.1) = 1:34:54; goal 1:30 ≈ VDOT 50.9; gap 4:54.

- [ ] **#36 · P2 · Targets confidence band width.** Web widens the band to ±8% when the fitness anchor is >180 days stale; iPhone never applies that override → a narrower, falsely-confident band for the same runner. **Proposed: iPhone → match web** (thread `anchorDateISO` into the iPhone projection route). ⚠️ **Exception — iPhone is the wrong side.** `app/api/targets/projection/route.ts`

- [ ] **#34 · P1 · Today goal tile vs Targets gap panel (both web).** Today derives status/color/projected from the drift ladder; Targets derives it from the forward trajectory → same runner can read OFF TRACK (red) on Today and ON TRACK on Targets. Canonical = trajectory-derived. **Proposed: Today tile reads the same trajectory status/number as Targets** (web-internal, no iPhone side). `TodayView.tsx` + `TargetsView.tsx` + `seed.ts`

- [x] **#6 + #54 · P2 · Easy-pace band.** ✅ FIXED 2026-06-16 — `prescriptions.ts` raised to T+80/+120 in `paces()` + `derivePaces()`, matching spec-builder/watch. Web Today modal / Poster (`prescriptions.ts`) uses E = T+60..110; the watch + the authored plan spec (`spec-builder.ts`) use T+80..120 — ~15–20 s/mi apart on the same easy day. Canonical = T+80..120 (Research/01, the Jun-8 floor-raise). **Proposed: web → match watch/spec** ✓ (web carries the stale faster band; matches the default). `prescriptions.ts` vs `spec-builder.ts`

- [ ] **#9 + #39 · P2 · Training-week boundary (web/backend totals).** `/api/plan/week` and the iPhone strip use the long-run-day boundary (shipped this session); `training-state.ts`, `glance-state.ts`, `log-state.ts`, and the web Overview week totals still hardcode Monday. **Proposed: the Monday readers → match the long-run-day SoT** ✓. For you (Sunday long) Mon–Sun coincide so nothing visibly changes; it's correctness for Saturday-long users. *(This is the incomplete half of this session's boundary fix.)* `training-state.ts`, `glance-state.ts`, `log-state.ts`, `seed.ts`

- [ ] **#46 · P2 · iPhone TrainView "this week".** TrainView reads the `plan_weeks` Monday boundary while the iPhone Today strip + Calendar use long-run-day → the three iPhone tabs can disagree on which 7 days are "this week." **Proposed: TrainView → long-run-day** ✓ (iPhone-internal; long-run-day is canonical). `TrainView.swift`

- [ ] **#52 · P2 · iPhone weekDone + recovery "banked mi".** TrainView weekDone and the recovery panel's banked-mi use the deprecated MAX-per-day heuristic instead of the canonical deduper, so they can disagree with Today's "WEEK MI." **Proposed: backend readers → `canonicalMileageByDay`** ✓ (per the volume source-of-truth rule). `training-state.ts`, `recovery-brief.ts`

- [ ] **#18 · P2 · RHR streak vs threshold line baselines (web Health).** The STREAKS card and the [N/M] progress line use different RHR baselines (one excludes the last 7 readings, one doesn't) → they can contradict. **Proposed: both read one `state.rhrBaseline`.** `readiness-brief.ts` + `health-actions.ts`

- [ ] **#55 · P3 · Warmup/cooldown pace basis.** Web glance implies ~8:30/mi (duration only); the watch paces warmup at goal+90 s/mi. **Proposed: shared easy-band basis on both.** `glance-adapter.ts` + `build-workout.ts`

---

## Part 2 — Correctness fixes (single source of truth — just fix, no direction call)

### P1
- [x] **#28 · Goal drift detector throws on finish-time string.** ✅ FIXED 2026-06-16 — parse `meta.finishTime` via `parseRaceTime` + rank in JS; no SQL cast. `detectRecentRaceDrift` casts `meta.finishTime` ("1:32:45") to `::numeric` → Postgres throws → swallowed → the one signal that flips a goal off-track never fires for any inline-edited race row. Fix: parse via `parseRaceTime`, not an SQL cast. `goal-projection.ts:758-784`
- [x] **#31 · Interval heat over-forgiveness.** ✅ FIXED 2026-06-16 — rep target uses half the continuous slowdown (Research/06 §2); heat framing still keyed on the full warmth. Rep target uses the full continuous slowdown; Research/06 §2 says intervals get HALF (work:rest cooling). Loosens hot-day in-range bands ~13 s/mi. Fix: halve `slowdownPct` for ≥1:1 work:rest before `adjTarget`/band. `run-recap.ts:149`
- [x] **#38 · Fabricated race net-elevation.** ✅ FIXED 2026-06-16 — curated `net_elevation_ft` wins, else measured from trackpoints; dropped the −0.24×gross heuristic. `netElevFt = -0.24 × gross gain` — a guess, not a measurement — drives the pacing plan + coach insight off a fake downhill (Big Sur, net +260 ft uphill, would pace as downhill). Fix: read net from trackpoints or the curated `net_elevation_ft` column (both exist). `raceDetail.ts:291`

### P2
- [x] **#1 · Strava cadence stored at two scales.** ✅ FIXED 2026-06-16 — pullSync now `×2` to match the webhook (full SPM). Cron `pullSync` stores raw (~84 spm); webhook stores `×2` (~168). Cron-synced runs show half, dropped from the baseline. Fix: apply `×2` in pullSync. `pullSync.ts:154`
- [ ] **#7 · 1-mile VDOT off the Daniels table ~4–5 points.** Raw equations diverge at the mile (5:24 → VDOT 54.5 vs table 50). Mile-goal readiness verdict reads pessimistic. Fix: interpolate the table / short-distance correction. `lib/training/vdot.ts`
- [ ] **#29 · Strava-matched finish auto-fills `finishTime` with no provisional flag** → renders as an authoritative PR. Violates race-data rule 3. Fix: flag provisional or don't display as PR. `races-state.ts`
- [x] **#30 · paceLabel renders "6:60/mi".** ✅ FIXED 2026-06-16 — round total seconds before splitting. Seconds round to 60 instead of carrying. Fix: round total seconds first, then split. `run-recap.ts`
- [x] **#32 · Long-run recap reports PLANNED easy mileage, not actual.** ✅ FIXED 2026-06-16 — easy portion = actualMi − finishMi. Fix: derive easy mi from actual distance run. `run-recap.ts`
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

### New (found while tracing #51, 2026-06-16)
- [ ] **#N1 · P2 · Spurious 26.2mi (marathon) projection snapshot for a half race.** `projection_snapshots` writes TWO rows per day for `americas-finest-city` (a 13.1mi half): the correct `dist 13.1 → 1:34:54` AND a spurious `dist 26.2 → 3:17:31`. The iPhone reads the 13.1 row (correct), but the marathon row is wrong data for a half. Find why the snapshot writer emits a 26.2 projection for a 13.1 race (distance source mismatch). `snapshot-projections` writer + the race distance it reads.

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

## Projection panel redesign (locked 2026-06-16) — build as one unit, both surfaces

David-approved across the design dialogue. The canonical projection panel (iPhone `K_TargetsProjection.swift` + web `GapPanel.tsx`):

**Header (sparse — each fact once, no repetition):**
- Status chip (IN REACH / WATCHING / OFF / etc.)
- Eyebrow `AT TODAY'S FITNESS` + hero number = current-fitness projection (1:34:54)
- One line: `Plan projects 1:30:59 by race day — 59s short of 1:30:00.` (goal-relative + honest; ✅ already shipped on iPhone)
- Re-anchored confidence band (see below) — **drop the `MEDIUM` word** (the readout carries confidence)
- CUT: "Goal X. 4:54 to close. Most of it is movable." + "doable, not banked" (redundant)

**THE READOUT (replaces the 4:54-TO-CLOSE attribution bar):** THREE levers + closing line — reframed so they don't contradict (David 2026-06-16: "if the plan trains to 51 how is it too short?"). The old "PLAN: built for it ✓" overclaimed — it means the plan's INTENSITY is goal-capable, not that it delivers the goal in time. Separate intensity (a ✓) from runway (the ✗):
- `EXECUTION` · Nailing every session · `100%` ✓ (executionQuality)
- `PLAN INTENSITY` · Hard enough · trains to VDOT 51 (> goal 50.9) · ✓ (planBuiltForGoal + plannedTargetVdot — difficulty is sufficient)
- `RUNWAY` · 6.7 wks realizes +2.3 of the +3.0 needed · `short` (the ✗ — buildWeeks × rate is the binding constraint, NOT the plan's difficulty or the runner's effort)
- line: "Not your effort, not the plan — the calendar. To reach 1:30: more build weeks/volume, or confirm fitness early (beat threshold paces under HR, or a tune-up)."

Mechanic to preserve in the copy: the plan's intensity ceiling (51) exceeds the goal (50.9), but adaptation is rate-limited (~0.35 VDOT/wk), so 6.7 weeks realizes +2.3 of the available +3.1 ceiling-gain — short of the +3.0 the goal needs. Intensity sufficient, time insufficient.

**Confidence band — RE-ANCHOR to the race-day projection** (David: re-anchor). Today it centers on the current-fitness projection (`vdotProjectionSec`, 1:34:54) so the band (1:31:56–1:37:52) is slower than the projection shown above it. Center it on `trajectory.projectedSec` (1:30:59 → ~1:28:15–1:33:43) so the band means "where you'll likely finish" and the goal sitting inside it IS the "in reach, not banked" signal. Backend: in `computeGoalProjection`, compute the trajectory BEFORE `computeConfidenceInterval` and pass `centerSec: trajectory?.projectedSec ?? vdotProjectionSec`.

**Backend payload:** surface the readout fields (executionQuality, planBuiltForGoal, plannedTargetVdot, projectedGainVdot, goalVdot, currentVdot, buildWeeks, gapVdot) into `ProjectionSummary` (iPhone) + the web seed so both render the readout from one source.

**Status:** ✅ show-both line + goal-relative honesty shipped on iPhone. ⬜ header de-dup, ⬜ THE READOUT, ⬜ band re-anchor, ⬜ drop MEDIUM, ⬜ web mirror — build together.

## Part 5 — Additions (David)

- [ ] **Web ← iPhone parity (design · content · tone) — standing goal.** The iPhone is the most-polished surface and is the reference now: the run-recap "HOW IT WENT" panel (per-rep range bars + needle, `TARGET 6:43 · +10s heat → 6:53`, "in range" labels, the coach-voice facts, the heat-context line — "63°F · a bit warm. Cost you about 2% on pace. Heat does that · your fitness is fine."), the information it surfaces, and the tone are all where they should be. **Bring the web up to mirror the iPhone wherever the web equivalent is behind or diverges.** This is the general form of Part 1's "web matches iPhone" — elevated from the disagreement fixes to a standing principle: when web and iPhone differ on *how something looks or reads* (not just the number), default to the iPhone.
  - **Needs a parity inventory** (offer: run it as a focused pass) — for each surface (Today + post-run recap, Train, Health, Goal/Targets, Run Detail), capture: what the iPhone shows and how it says it, vs what the web shows today, and the gap to close. Output a port list.
  - **Known targets** (grows as David flags them):
    - **Run-recap panel.** Web recap should render the same rep-range bars + needle, the heat-adjusted target line (`TARGET 6:43 · +10s heat → 6:53`), the "in range" framing, and the same coach-voice facts as the iPhone `HowItWentPanel`/`RepsPostPanel`. Both already read the shared `run-recap.ts`, so most of the gap is display, not data.
    - **Week strip — strength rules.** The web "THIS WEEK" strip shows none of the strength indicators the iPhone strip has: the blue "recommended" underline, green "done", and yellow "paused-on-readiness" states (shipped to iPhone this session). The web strip must render the same strength state from the same backend source (`recommendedStrengthDays` / strength recommender via training-state/glance), so strength reads identically on both. Ties to audit #24 (strength week should derive from `long_run_day`, not hardcoded Mon–Sun) — fix that at the source so both strips inherit it.

---

## Verified clean (no action)
Canonical volume reader, race-data source-of-truth ladder, VDOT formula constants (5K–marathon), readiness pillar weights, dedup/merge ordering, multi-writer jsonb preservation (Rule 6), strength count/logged-fill logic. No P0s.
