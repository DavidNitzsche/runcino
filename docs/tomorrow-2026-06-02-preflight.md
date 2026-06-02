# Pre-flight: Tomorrow's threshold session (Tue Jun 2, 2026)

Generated from the live production database via `buildWatchToday()` — this is the EXACT payload the watch will receive when you press START tomorrow.

## The session

**THRESHOLD · 6.0 mi · 3 × 1 mile reps · ~44 min**

Readiness: **55 / MODERATE**

| # | Phase | Type | Distance | Duration target | Pace target | Tolerance | Unit |
|---|---|---|---|---|---|---|---|
| 1 | Warmup | warmup | **1.4 mi** | 11:29 | 8:12/mi | ±25 s | distance |
| 2 | Rep 1/3 | work | **1.0 mi** | 6:47 | **6:47/mi** | ±8 s | distance |
| 3 | Recovery 1/2 | recovery | — | **2:00** | (jog) | — | **time** |
| 4 | Rep 2/3 | work | **1.0 mi** | 6:47 | **6:47/mi** | ±8 s | distance |
| 5 | Recovery 2/2 | recovery | — | **2:00** | (jog) | — | **time** |
| 6 | Rep 3/3 | work | **1.0 mi** | 6:47 | **6:47/mi** | ±8 s | distance |
| 7 | Cooldown | cooldown | **1.0 mi** | 8:12 | 8:12/mi | ±25 s | distance |

Total distance: 1.4 + 3(1.0) + 1.0 = **5.4 mi** of running + recoveries ≈ **6.0 mi**

---

## Face routing — what you'll see at each stage

Verified against `ActiveWorkoutView.swift` (lines 104-145):

| Phase | Watch face | Color grammar |
|---|---|---|
| 1. Warmup | **WarmupFace** | top label `WARMUP` · pace (green/grey) · HR · distance-remaining (blue, counts DOWN from 1.40) · bottom subtitle `1.0 mi · 6:47` (briefing for first rep) |
| 2. Rep 1/3 | **WorkIntervalFace** | top label `REP 1/3` · live pace (green when on-target, amber drifting, red off) · target `6:47` · total distance (blue) · rep-remaining (counts DOWN to 0) · strip at bottom (1 of 6 lit white) |
| 3. Recovery 1/2 | **RestFace** | top label `REST` (blue) · rest time-left (counts DOWN from 2:00) · live pace · HR ♥ |
| 4. Rep 2/3 | WorkIntervalFace | strip: 2 done green, 1 now white, 3 empty |
| 5. Recovery 2/2 | RestFace | counts DOWN from 2:00 |
| 6. Rep 3/3 | WorkIntervalFace | strip: 4 done green, 1 now white, 1 empty |
| 7. Cooldown | **SteadyRunFace** | top label `COOL DOWN` · pace · elapsed · distance (counts DOWN from 1.00) |
| (post) | **TodayDoneFace** then **CompleteFace** | 1.5s flash with ✓ icon + 3 rows · then summary with `Done` button |

---

## State machine behavior (what should happen automatically)

These are the auto-transitions the engine handles for tomorrow's session. NO tap-to-advance is needed once you press START.

- **Warmup → Rep 1**: auto-fires when `tracker.distanceMi - phaseStartMi >= 1.4` (distance trigger)
- **Rep 1 → Recovery 1**: auto-fires when rep covers 1.0 mi
- **Recovery 1 → Rep 2**: auto-fires when 120s elapse on the recovery (time trigger)
- **Rep 2 → Recovery 2**: same pattern
- **Recovery 2 → Rep 3**: 120s elapse
- **Rep 3 → Cooldown**: 1.0 mi covered
- **Cooldown → Plan Complete**: 1.0 mi covered
- **Plan Complete → Overtime**: engine doesn't stop; distance row flips purple (`.bonus`) and counts UP if you keep running
- **End tap**: writes the WatchCompletion to `/api/watch/workouts/complete`, shows CompleteFace

Each transition fires a haptic (`.transitionWork` / `.transitionRecovery` / `.transitionCooldown`).

---

## What was reported broken last run — and the status now

**Reported by you on the last bad run:**
1. Time went UP (not down)
2. Intervals never changed
3. Distance wasn't tracking

**Engine-level audit (read FAQ → code):**
1. `phaseRemainingSec = max(0, durationSec - phaseElapsedSec)` — math is correct, value decreases as elapsed grows. WarmupFace's `remaining` field is computed correctly. **The bug, if reproduced tomorrow, is at the FACE level (face showed wrong field) OR at the ENGINE level if `phaseElapsedSec` wasn't ticking.**
2. Auto-advance logic: `if phaseElapsedSec >= phase.durationSec { advance() }` (time) OR `if phaseCoveredMi >= phase.distanceMi { advance() }` (distance). Code is in place. **Most likely cause if it happens again: phase.durationSec is 0 (then condition is `0 >= 0` and it auto-advances instantly, then loops) OR tracker.distanceMi isn't updating.**
3. Distance comes from `WorkoutTracker.distanceMi` which is fed from HealthKit's `distanceWalkingRunning` query. In the sim it's a mock; on real hardware it's GPS+HK. **If GPS doesn't lock, distance stays at 0 — distance-based phases never advance.**

**Tomorrow's risk mitigations:**
- If GPS doesn't lock by the warmup end, the warmup will hang (distance-based, won't auto-advance). **Manual fallback: long-press to end-current-phase.** (See `endCurrentPhase()` in the engine.)
- The phase data above all have valid non-zero `durationSec` and `distanceMi` — so the "0 >= 0 instant loop" failure mode is NOT in this payload.

---

## Known bug NOT yet fixed (flagged tonight)

**Mile-split flash fires during work reps.** During reps 2 and 3, as total covered distance crosses mile 2 and mile 3, the engine fires a `.split` flash (the `MILE 2 / 6:47` takeover). This is noise during a structured rep — you should be focused on the rep's pace target, not a global mile split.

**Effect tomorrow:** you may see a brief mile-split flash mid-rep on reps 2 and 3. It's a 6-second takeover. The face will return to WorkIntervalFace afterward. Doesn't break the workout, just distracting.

**Fix:** 1-line guard in `WorkoutEngine.tick()` — defer to a separate change.

---

## Pre-flight checklist

- [x] Plan data exists for tomorrow (verified in `plan_workouts` table)
- [x] Plan converts to a valid `WatchWorkout` payload (all phases have non-zero duration/distance)
- [x] Each phase's `type` maps to a defined face via `ActiveWorkoutView.swift` routing
- [x] Pace targets are reasonable (Warmup 8:12, Reps 6:47, Cooldown 8:12)
- [x] Recovery durations are non-zero (120s each)
- [x] `completionEndpoint` is set (production URL `https://www.faff.run/...`)
- [x] iPhone-side: `/api/watch/today` returns this payload when the watch requests it via `requestTodayWorkout()`
- [ ] **You: confirm GPS lock before starting** (if no lock, distance-based phases won't advance)
- [ ] **You: verify the watch shows the WARMUP face after pressing START** (3-2-1 countdown first, then WarmupFace with "WARMUP" top label + 3 big number rows + "1.0 mi · 6:47" subtitle)

If anything looks wrong during the run, **long-press = end current phase** is your manual escape hatch.

---

## Raw payload (for reference)

This is what the watch will decode from `/api/watch/today`:

```json
{
  "workout": {
    "workoutId": "0645f40c-951d-4ccc-b86e-9979cd26c795-2026-06-02",
    "name": "THRESHOLD",
    "summary": "6.0 mi · Threshold · 3 × 1 mile reps",
    "totalEstimatedMinutes": 44,
    "phases": [
      { "type": "warmup",   "label": "Warmup",       "durationSec": 689, "targetPaceSPerMi": 492, "tolerancePaceSPerMi": 25, "haptic": "start",                "repUnit": "distance", "distanceMi": 1.4 },
      { "type": "work",     "label": "Rep 1/3",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi": 8,  "haptic": "transition-work",      "repUnit": "distance", "distanceMi": 1.0 },
      { "type": "recovery", "label": "Recovery 1/2", "durationSec": 120, "targetPaceSPerMi": null,"tolerancePaceSPerMi": null,"haptic": "transition-recovery", "repUnit": "time" },
      { "type": "work",     "label": "Rep 2/3",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi": 8,  "haptic": "transition-work",      "repUnit": "distance", "distanceMi": 1.0 },
      { "type": "recovery", "label": "Recovery 2/2", "durationSec": 120, "targetPaceSPerMi": null,"tolerancePaceSPerMi": null,"haptic": "transition-recovery", "repUnit": "time" },
      { "type": "work",     "label": "Rep 3/3",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi": 8,  "haptic": "transition-work",      "repUnit": "distance", "distanceMi": 1.0 },
      { "type": "cooldown", "label": "Cooldown",     "durationSec": 492, "targetPaceSPerMi": 492, "tolerancePaceSPerMi": 25, "haptic": "transition-cooldown",  "repUnit": "distance", "distanceMi": 1.0 }
    ],
    "completionEndpoint": "https://www.faff.run/api/watch/workouts/complete",
    "expiresAt": "2026-06-02T23:59:59.000Z",
    "distanceMi": 6,
    "paceLabel": "T",
    "isRace": false,
    "hrCeilingBpm": null,
    "displayHint": null,
    "readinessScore": 55,
    "readinessLabel": "MODERATE"
  }
}
```

---

## Bottom line

**The watch IS wired and will route the right faces to the right phases.** Payload is structurally valid. State machine code is correct (audited tonight). The two genuine risks for tomorrow's run:

1. **GPS not locking** before warmup ends → distance phases won't auto-advance. Mitigation: confirm GPS lock outside the door before pressing START; if it hangs mid-run, long-press to end the phase manually.
2. **Mile-split flash during reps 2 and 3** → cosmetic noise, doesn't break the workout. Known bug, not fixed yet.

Go run it. Tap me when you're back if anything misbehaves and we'll have concrete failure data to fix against.

---

## ADDENDUM — Post-RPE-revert re-verification (commit `2174f5ac`)

Re-walked the engine top-to-bottom after the Tier 2 RPE visual rescind. Confirming nothing in tomorrow's path is affected.

### Walkthrough · phase-by-phase

| Step | Trigger | Face | Tier 1 captured | Notes |
|---|---|---|---|---|
| Press START | tap | 3-2-1 countdown | — | engine: idle → countingDown → running, fires `Haptics.play(.start)` |
| 1. Warmup | enters phase 0 | **WarmupFace** · `WARMUP` label · pace + HR + distance-remaining (1.40 → 0, blue) · subtitle `1.0 mi · 6:47` | per-tick HR/cadence agg + 5-sec pace/HR samples | no `flash(.go)` — warmup type doesn't fire GO card |
| → auto-advance | `phaseCoveredMi >= 1.4` | — | recordCurrentPhase: target 8:12 ±25s · verdict = hit / drifted / missed; samples emitted | mile-split takeover MAY fire when total covered crosses mile 1 (warmup is not `.work` so the gate allows it — expected) |
| 2. Rep 1/3 | enters phase 1 | **WorkIntervalFace** · `REP 1/3` · live pace (drift-coloured) · target `6:47` · total dist · rep-remaining (1.00 → 0) · strip 1-of-7 white | same per-tick + 5-sec sampling | `flash(.go(rep: "REP 1 / 3", target: "6:47"))` for 1.5s on entry |
| → auto-advance | `phaseCoveredMi >= 1.0` | — | verdict: hit / drifted / missed / incomplete (if you long-press end) | `pendingRpeResultsIndex` set (dormant — no UI to surface) |
| 3. Recovery 1/2 | enters phase 2 | **RestFace** · `REST` blue · time-left (2:00 → 0) · pace · HR | per-tick + 5-sec sampling; verdict nil (no target) | last 10s: live ending countdown (full-screen `EndingCountdownView` 10 → 1) · tick haptic + chime each sec |
| → auto-advance | `phaseElapsedSec >= 120` | — | RPE prompt machinery flips `rpePromptVisible` → true but **NO view observes it**; auto-dismisses in 30s OR on next advance — zero visible effect | mile-split flash possible during this phase if total mileage crosses an integer; recovery is not `.work` so allowed |
| 4. Rep 2/3 | enters phase 3 | WorkIntervalFace · strip: 1+2 done green · 3 now white | same | mile-2 crossing during this rep: **suppressed** by work-phase gate (line 741) · bookkeeping still advances so the next allowed flash carries the correct mile + lap-pace |
| → advance, 5. Rec 2/2, 6. Rep 3/3 | mirrors 3 & 4 pattern | RestFace → WorkIntervalFace · strip: 4 done · 1 now · 1 left | same | same dormant-RPE flow on every work-end |
| 7. Cooldown | enters phase 6 | **SteadyRunFace** · `COOL DOWN` label · pace · elapsed · distance (1.00 → 0, blue) | per-tick + 5-sec sampling; verdict for 8:12 ±25s target | |
| Plan complete | `phaseCoveredMi >= 1.0` | SteadyRunFace stays; distance row flips purple, counts UP; `OVERTIME` top label | overtime not recorded as a phase | `Haptics.play(.end)` fires once; engine doesn't stop — keep running or tap End |
| Tap End | controls page → End → confirm | — | `buildCompletion` packages `WatchCompletion` with all 7 `WatchCompletionPhase` entries · POSTs to `https://www.faff.run/api/watch/workouts/complete` | tracker writes HKWorkout + GPS route async |
| Done | engine.state = .finished | **TodayDoneFace** flash 1.5s · then **CompleteFace** · `Done` button → IdleView | — | brief stamp: tomorrow's recap fires on the iPhone side from `runs.data.splits` |

### Engine dormancy audit (RPE plumbing kept, UI gone)

The engine's RPE state lives at lines 177-200, 795-800, 857-864, 954-962, 966-1003 of `WorkoutEngine.swift`. After the revert, it behaves like this on tomorrow's run:

1. Rep 1 completes → `recordCurrentPhase` runs Tier 1 derivations + appends to `results` → sets `pendingRpeResultsIndex = results.count - 1`
2. `advance()` increments currentIndex → enters Recovery 1 → at end of `advance()`, since `pendingRpeResultsIndex != nil` and recovery is `currentPhase?.type != .work`, calls `showRpePromptIfPending()`
3. `showRpePromptIfPending()` flips `@Published rpePromptVisible = true` and starts a 30-sec `Task.sleep` to auto-dismiss
4. **No view in the app reads `rpePromptVisible`** (the `ActiveWorkoutView` overlay ZStack branch was removed). The `@Published` change triggers an `ObservableObject.objectWillChange` notification — observers re-render — but no rendered view consumes the field, so the render is a no-op. Cycles only. No visual.
5. Either (a) 30s passes and `dismissRpePrompt()` clears state via `MainActor.run`, or (b) the next `advance()` (into Rep 2) calls `if rpePromptVisible { dismissRpePrompt() }` at the top before recordCurrentPhase. Both paths converge on `rpePromptVisible = false, pendingRpeResultsIndex = nil`.
6. `recordRpe(...)` is never called (no UI to call it). `WatchCompletionPhase.repRpe` stays `nil` on all 7 entries. Wire payload encodes `repRpe: null` for every phase (or omits if `nil` per Encodable convention).
7. Backend `deriveSplitsFromPhases` extracts `rep_rpe: null, rep_rpe_tag: null` → composers gate on `s.rep_rpe != null` → all 4 RPE composers no-op cleanly → dispatch falls through to `winVerdictHit` / `winTimeInTolerance` (Tier 1 composers, which ARE active).

**Confirmed: dormant plumbing is observable only as wasted SwiftUI render cycles. Zero visible side effects. Zero wire-shape effect (rep_rpe always null until UI returns).**

### Tier 1 wire-shape spot-check

Each work-rep `WatchCompletionPhase` will carry:
- `targetPaceSPerMi: 407` (6:47)
- `actualPaceSPerMi: <derived>`
- `actualDurationSec: <derived>`
- `actualDistanceMi: <derived>`
- `avgHr` / `maxHr` / `avgCadence: <derived>`
- `completed: true` (unless long-pressed end)
- `paceSamples: [...]` (5-sec cadence array, ~12 samples per 1.0mi rep at 6:47)
- `hrSamples: [...]` (same cadence)
- `timeInToleranceSec` / `timeOutOfToleranceSec` (5-sec bucketed)
- `verdict: "hit" | "drifted" | "missed" | "incomplete"`
- `repRpe: nil` · `repRpeTag: nil` (UI rescinded; field shape preserved)

Backend will receive `rep_rpe: null` for every phase row in `runs.data.splits[i]` — composers `winRpeMatched`, `winRpeUndershot`, `redFlagRpeVsVerdict`, `tagPattern`, `repTrajectory` all gate-out cleanly per the ack at `designs/briefs/backend-ack-rpe-rescind-2026-06-02.md`.

### What I'd watch for in the live run

1. **GPS lock by the door** — same flag as before. If GPS doesn't lock, the warmup hangs (distance-based, no fallback). Long-press to manually end the phase.
2. **The mile-split gate** — work phases should NOT flash `MILE 2 / 6:47` during reps 2 and 3 anymore (shipped at `e9fa6bdc`). Warmup, recoveries, and cooldown CAN still flash mile splits — that's intended.
3. **Recovery countdown last 10s** — the full-screen `EndingCountdownView` should overlay the RestFace from 10 → 1 with tick haptics + chime each sec. If it skips or shows "0", report.
4. **GO card on each rep entry** — 1.5s `flash(.go(rep: "REP n / 3", target: "6:47"))` should hit at the top of each work rep.
5. **`Haptics.play(.end)` once at plan complete** — single buzz at the cooldown's last tenth-mile crossing. Engine continues into overtime (distance row purple, counts UP).
6. **The whole RPE prompt has been removed visually** — if you see ANY 5-circle overlay at any point, that's a bug; report it.

### Pre-flight checklist update

- [x] Plan payload valid (unchanged from above)
- [x] Face routing matches the 7-phase table (re-verified line 104-145 `ActiveWorkoutView.swift`)
- [x] Tier 1 sampling + derivation paths intact post-revert
- [x] Mile-split work-phase gate intact (line 741 `WorkoutEngine.tick`)
- [x] Flag 6 expiresAt window enforcement intact (`WorkoutRootView`)
- [x] Engine compiles clean (no orphan `RpeFace` / `rpePromptVisible` view references)
- [x] Dormant RPE plumbing audited — zero observable side effects
- [x] Backend composer gating confirmed (`designs/briefs/backend-ack-rpe-rescind-2026-06-02.md`)
- [ ] **You: GPS lock before START**
- [ ] **You: WARMUP face appears after countdown**
- [ ] **You: no 5-circle overlay appears at any point** (revert sanity check)
