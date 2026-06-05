# iPhone Sync Ledger

Running log of changes that backend ships and what iPhone has to do (or not) to consume them. David's standing ask 2026-06-03: "keep a running memory/list somewhere on all of this."

Categories:
- **AUTO-RIPPLE** · backend change · iPhone gets it free via existing API calls
- **IPHONE ACTION** · new field / new endpoint / new copy · iPhone must wire
- **TF QUEUE** · sitting on David's TestFlight push clearance
- **DOCTRINE** · codified rules (not code changes)

When a row moves states (e.g. iPhone wires the field), update the status inline. Don't delete · the audit trail matters.

---

## IPHONE ACTION · pending

| Commit | Field / surface | iPhone work | Status |
|--------|-----------------|-------------|--------|
| 25281ea7 | `readinessBrief.prescription: { action, why }` | Render under hero · "WHAT TO DO TODAY" card with band-colored left border | NEEDS WIRING |
| 3109bdc9 | `confounders[].categoryTag` (optional) | Use as the chip label instead of `pillar` (which was self-referential) | NEEDS WIRING |
| ba7063dc | `HealthMetric.noData` (optional bool) | When true, render "—" instead of `current` value; caption "no data" instead of status text | LENIENT · iPhone can opt in |
| 48a64339 / 9357a5c0 | Mile-pace chart cooldown/warmup tail detection | Web has it inline (TodayView § EasyPanel). iPhone's per-mile chart could mirror: tail = ≥15% slower than median AND ≥45s absolute | OPTIONAL · web-side only for now |
| 8519b5ac | Check-in moved to TOP + time/run-aware prompt | iPhone's readiness panel should mirror: check-in card right after the Hero · prompt switches based on hour + `todayRunDone` (POST-RUN / heading into today / afternoon / tonight / restDay) | NEEDS WIRING |
| cfbc3347 | Tempo `Hold X` pace + Long fuel + Long coach copy now derived from workout_spec | iPhone planned-card coach line / fuel chip should mirror: read `workout_spec.tempo_pace_s_per_mi` / `fuel_mi` / distance · stop reading hardcoded KIT-style strings | NEEDS WIRING |
| cfbc3347 | Easy verdict "Easy day." dedup · first fact no longer repeats it | iPhone purpose card · skip the "Easy day." prefix when verdict already says it · or just use `facts` array as-is (the dedup is now at source) | AUTO-RIPPLE |
| 07c04d04 | `prescription.intent` ('cut'/'plan'/'send'/'rest') + `targetMinutes` / `targetMiles` | iPhone readiness panel: when todayRunDone, swap PrescriptionCard for a PostRunReflection that compares actual run vs intent+target. See web `PostRunReflection` for the four-tier copy ladder. | DEFERRED · gutted from web @ b4a059e1 |
| b4a059e1 | Reactive coach layer GUTTED from web UI · prescription card, post-run reflection, override callout, feeling check-in, standing advice all hidden | iPhone equivalents: do NOT wire any of the "what to do today" / post-run-reflection / morning check-in / coach-suggests-easier surfaces. The plan stands, the score informs, no reactive layer. Engine code intact for future re-enable. | REVERT-NOT-WIRED |
| `<pending HK fix>` → fixed round 84 (this commit) | HK sleep stages · capture `HKCategoryValueSleepAnalysisAsleepUnspecified` minutes AND legacy `.asleep` (rawValue 1) | iPhone HK reader previously rolled `asleepUnspecified` into lightMinutes and DROPPED the legacy `.asleep` value (rawValue 1) via `default: continue`. Apple Health's "Time Asleep" includes both — that's the 66min gap David QC'd 2026-06-05 (HK 7:55, Faff 6:47). The legacy `.asleep` bucket is what third-party trackers (AutoSleep, Pillow, Sleep++), manual Health entries, naps without staging, and Sleep-Focus-only nights write. Round 84 fix: split into its own `unspecifiedMinutes` accumulator (catches BOTH rawValue 1 and rawValue 6), include in `totalMinutes` so `sleep_hours` matches HK exactly, emit as new `sleep_unspecified_minutes` VitalSample (server whitelist at fad6fce2). | DONE · build 158 pending TF |

## AUTO-RIPPLE · iPhone gets it free

| Commit | What changed | Why iPhone doesn't need to touch |
|--------|--------------|----------------------------------|
| 030bfbe7 | `runForm.*.series28d`, `sleepStages.{light,awake}Series`, `vo2.series28d` | iPhone agent confirmed wired 2026-06-03 PM. Length-≥14 trigger fires reliably. |
| 25281ea7 | Mover math · `oneLineMover` string regenerated correctly | iPhone reads the string; engine recomputes it. |
| 25281ea7 | Mover label framing · "X pulled the score down 7 pts" | iPhone reads the authored label · no change to read path. |
| 3109bdc9 | HRV/RHR/HR_recovery tile expanded view dedup (skip baseline when ≡ observedSub) | Web Drawer only · iPhone has its own readiness panel. iPhone should check their parallel render code. |
| cbba0ce0 | Today header weekOf · "QUALITY phase · 74d to Americas Fin" | Web Shell only · iPhone has own header. Heads-up: drop "Week N of M" framing on iPhone too. |
| cbba0ce0 | AEROBIC STAMP subtitle re: pace-first verdict | Web TodayView. iPhone EasyPanel parallel · same Rule 17 framing applies. |
| 7942fc81 | ManualHealthSheet confirmation UX | Web-only sheet · no iPhone equivalent. |
| ba7063dc | SLEEP DEBT insight skips when <4 nights tracked | iPhone reads insights array · stale insights stop appearing automatically. |
| ba7063dc | watch_list topic gated on sleep7Avg != null | iPhone consumes topics array · gating happens server-side. |
| 472be22f | `vertical_ratio` derived from osc/stride backend-side · formula vert_osc_cm / stride_length_m, guard 0 < ratio < 20% | iPhone ships osc + stride samples (build 155); backend derives ratio with HK rows precedence. iPhone doesn't need to send the ratio explicitly. |
| 843833d3 | Backend SQL fix for form-metric `text = uuid` mismatch · restored render of existing samples | iPhone already reads; just data fix on server. |
| 1f21a0c5 → 0a98a133 | `runnerToday(userUuid)` reads `profile.timezone` across 30+ "today" callsites · recovery panel, readiness brief, ACWR, sleep streak, plan adapter | iPhone reads server-rendered output of all those callsites. Auto-corrects once profile.timezone populates (see TF entry below for the write path). |

## SHIPPED TO TESTFLIGHT (2026-06-02 → 2026-06-03)

| Build | Commit (iPhone) | What landed |
|-------|-----------------|-------------|
| 147 | 69eb6885 | All-mesh restyle for past-day flat layout · TodayPostRunBody onMesh context, 28 color sites swept |
| 148 | d0e296d2 | Recovery panel scrolls + past-day map allowsHitTesting(false) |
| 149 | 1354d9e6 | Latest live state bundled (round 73 design corrections, scrim, kill horizontal pan) |
| 150 | eee7104f | Round 69 8-issue cleanup (READINESS label, MON·EASY·DONE eyebrow, recovery line graph, FUELING pillar, THE PLAN cross-day bleed, scrim, horizontal pan, drag-sheet first-frame underflow guard) |
| 151 / 152 | 7a104dba / cbba0ce0 | Health page Direction A "Pinned Glance" port · pinned 128pt gauge + 5-way segmented control + 5 swappable sections + bar-card grids + 7-section backend wiring. 152 = re-ship of 151 to force fresh CDN fetch |
| 153 | 614269ad | Metric detail bottom sheet (tap card → slide-up panel) + chart consistency (bar + line tell the same story) + win-line white pill + ACWR solid capsule |
| 154 | 35392f0a | All 7 backend HealthState additive fields wired lenient (sleepStages, runForm, dailyReadiness, bodyTemp, vo2Trend, insights, overview.{story,watchingTomorrow,recoveryPhase}) + preferRealOrPad chart switch |
| 155 | 6ea0c21b | Form-metric ingest regression FIX · 4 new daily HK samples in `collectVitalSamples` (`ground_contact_time`, `vertical_oscillation`, `stride_length`, `run_power`) restoring the path that broke 2026-05-25. Pause-aware per-mile splits also bundled (78a10810). |
| 156 | 1a1dfae1 | TZ sync · `body.timezone = TimeZone.current.identifier` on POST /api/ingest/health + POST /api/watch/workouts/complete (iPhone splices into the watch's opaque Data via decode-mutate-encode) |

## TF PUSH QUEUE · sitting on David's clearance

| Commit (web side) | Item | Notes |
|--------|------|-------|
| 25281ea7 | Prescription card (NEW) | Not yet authored as an iPhone brief · DEFERRED, gutted from web reactive layer @ b4a059e1. |

## WATCH TF QUEUE · sitting on David's clearance

Mirror of the iPhone TF queue but for the watch app (`legacy/native/Faff/FaffWatch Watch App/`). The watch only runs whatever binary was last archived to TestFlight — every Swift change here needs a fresh TF push to take effect. Build counter: `legacy/native/.asc.build` (shared with iPhone build numbering).

When David ships a TF build, move rows from this section into a "shipped in build N" subsection or strike them through. Don't delete · the audit trail matters.

### Queued for next watch TF push

| Commit | What | Visible effect on watch / wire |
|--------|------|-------------------------------|
| d935c0d2 | Flag 6 · `expiresAt` enforcement on workout start | Stale workout payloads (>14h sliding window) refuse to start; user sees a soft refusal screen instead of yesterday's plan |
| e9fa6bdc | Mile-split flash gated off during work phases | No more `MILE 2 · 6:47` overlay mid-rep · still fires in warmup / recovery / cooldown / just-run |
| 031fe5fd | Watch payload ships `kcal` (HK active-energy total) | iPhone summary card kcal reads HK real number, not the distance × weight × hr-multiplier estimator |
| fe967374 | Treadmill HR bridge · iPhone↔watch indoor session | iPhone-driven indoor sessions can request watch HR via `treadmill_start` / `treadmill_end` PhoneSync messages |
| 5b8bcc80 | Tier 1 telemetry · per-phase 5-sec pace/HR samples + derivations | `WatchCompletionPhase` carries `paceSamples`, `hrSamples`, `timeInToleranceSec`, `timeOutOfToleranceSec`, `verdict`. Backend's typed ingest + `winVerdictHit` / `winTimeInTolerance` composers light up on first run with this build. |
| 2174f5ac | Tier 2 RPE visual rescinded (paired with original 2cc8bdd0) | Net zero new UI · both ship together. Data path `repRpe` / `repRpeTag` on wire kept dormant per `designs/briefs/watch-tier-2-rpe-rescinded-2026-06-02.md`. |
| b41f75ab | Top-level `avgHr` / `avgCadence` work-weighted | iPhone summary card avgs reflect actual work effort, not rest contamination. Wire shape unchanged; per-phase `splits[i].avg_*` was already isolated. |
| 75c7e172 | LiveEasy distance row prefers phase-remaining over workout-remaining | Tempo / easy-with-target / long-with-target runs: distance row during the work phase counts down from the PHASE target (5.0 → 0), not workout remaining (6.5 → 1.5). Bug surfaced on David's tempo run 2026-06-03. |
| _next_ | SummaryView labelText sanitizes plan-description names | CompleteFace top label now strips " · " / " @ " segments and caps at 14 chars · prevents the full plan string ("1 MI WU · 4 MI @ 10:12 · 1 MI CD") from overflowing the small top slot and colliding with the OS clock at top-right. Bug surfaced at end of David's 2026-06-03 run. |

### Shipped in build N (after next TF push, fill in N)

_(empty — populate after next archive lands in TestFlight)_

### Operating rules for the watch TF queue

- Every Swift change under `legacy/native/Faff/FaffWatch Watch App/` lands here until pushed to TestFlight.
- Backend-side changes that the watch CONSUMES (e.g. new `WatchWorkout` fields the payload now carries) belong in the iPhone TF queue · the watch decodes them via `WatchConnectivity` from the iPhone relay, which gets the payload from `/api/watch/today`. So a backend → watch field landing requires the iPhone build to ship, not necessarily a new watch build.
- A watch build IS required when the change is to: face layout, engine state machine, completion payload shape, PhoneSync messages, HK tracker logic, or any Swift file under the watch target.
- The mile-split / Tier 1 / Flag 6 work above shipped backend-side but the WATCH enforcement / sampling / gating is in Swift code → needs the watch build.

## DOCTRINE codified today (2026-06-03)

| Rule | What it says | File |
|------|--------------|------|
| 16 | Easy + long HR cap = max(89% LTHR, 78% maxHR) · same for both | `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md` |
| 17 | Easy verdict is PACE-first · HR descriptive, not gating | same |
| 18 | Missing data is missing · never fabricate, never imply | same |
| 16b | Heat band "hot" requires tempF ≥ 75°F · not just pace cost | `lib/coach/weather-adjust.ts § bandFor` |

## Operating principle

When in doubt: backend ships, iPhone reads. If iPhone needs to opt in, the contract is **lenient** · new fields are optional, old fields stay. Breaking changes get an explicit brief.
