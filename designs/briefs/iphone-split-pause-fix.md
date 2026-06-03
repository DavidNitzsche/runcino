# iPhone · pause-aware per-mile splits

**For:** iPhone agent
**From:** backend
**Status:** ready to build · backend defense already shipped
**Priority:** high · current bug is rendering wrong "slowest mile" on every paused run

---

## The bug, in plain English

When a runner pauses mid-run (red light, crosswalk, water stop), the Apple Watch correctly excludes that paused time from `workout.duration`. The watch is doing the right thing.

The iPhone reads HKWorkoutRoute (the GPS samples) and walks them to compute per-mile splits. **The iPhone uses raw GPS timestamps without consulting HKWorkoutEvent pause/resume events**, so split times include the paused intervals. This inflates the mile pace for whichever mile contained the pause.

**Symptom from David's 2026-06-03 run:**
- Run: 6.08 mi, 50:34 actual moving time, 8:18 avg pace
- Watch-reported mile 6 pace: **9:57**
- Math check: actual time after mile 5 marker = 471s = 7:51/mi. So mile 6 should have read closer to 7:51, not 9:57. The watch's official duration excludes the paused time, but iPhone's GPS-derived split includes it.
- Sum of all 6 split times: **3160s** vs run total `3034s` · 126s of inflation.

---

## What to change

**File:** `legacy/native/Faff/Faff/HealthKitManager.swift`
**Function:** `buildRoutePayload(workout: HKWorkout, locations rawLocs: [CLLocation]) -> RouteUpload?` (around line 653)

### Current code (the bug)

```swift
// Per-mile splits, walk the path accumulating distance + time.
let mileMeters = 1609.344
var splits: [RouteSplitUpload] = []
var distSoFar = 0.0, lastMileMark = 0.0
var mileStartTime = locs[0].timestamp, mileStartElev = locs[0].altitude
var mileNo = 1
for i in 1..<locs.count {
    distSoFar += locs[i].distance(from: locs[i - 1])
    while distSoFar >= lastMileMark + mileMeters {
        lastMileMark += mileMeters
        // ⚠️ Bug: raw GPS timestamp diff includes paused time
        let pace = Int(locs[i].timestamp.timeIntervalSince(mileStartTime).rounded())
        if pace >= 120 && pace <= 3600 {
            let elevFt = Int(((locs[i].altitude - mileStartElev) * 3.28084).rounded())
            splits.append(RouteSplitUpload(mile: mileNo, paceSPerMi: pace, avgHr: nil, elevDeltaFt: elevFt))
        }
        mileNo += 1
        mileStartTime = locs[i].timestamp
        mileStartElev = locs[i].altitude
    }
}
```

### The fix

Read `HKWorkoutEvent` pause/resume markers from the workout's event series, build a list of paused time ranges, and subtract any paused-time overlap from the per-mile elapsed time:

```swift
/// Returns paused-time intervals as (start, end) pairs.
nonisolated fileprivate static func pauseRanges(in workout: HKWorkout) -> [(Date, Date)] {
    var ranges: [(Date, Date)] = []
    var pausedAt: Date? = nil
    let events = workout.workoutEvents ?? []
    for ev in events {
        switch ev.type {
        case .pause:
            pausedAt = ev.dateInterval.start
        case .resume:
            if let start = pausedAt {
                ranges.append((start, ev.dateInterval.start))
                pausedAt = nil
            }
        default:
            break
        }
    }
    // Edge case: workout ended while paused · close the open range at workout end.
    if let start = pausedAt {
        ranges.append((start, workout.endDate))
    }
    return ranges
}

/// Subtract any pause overlap from a (start, end) span.
nonisolated fileprivate static func unpaused(
    from start: Date, to end: Date, pauses: [(Date, Date)]
) -> TimeInterval {
    var elapsed = end.timeIntervalSince(start)
    for (pStart, pEnd) in pauses {
        // Overlap = max(0, min(end, pEnd) - max(start, pStart))
        let overlapStart = max(start, pStart)
        let overlapEnd = min(end, pEnd)
        let overlap = overlapEnd.timeIntervalSince(overlapStart)
        if overlap > 0 { elapsed -= overlap }
    }
    return max(0, elapsed)
}

// In buildRoutePayload, BEFORE the for-loop:
let pauses = pauseRanges(in: workout)

// In the while-loop, REPLACE the pace computation:
let pace = Int(unpaused(from: mileStartTime, to: locs[i].timestamp, pauses: pauses).rounded())
```

### Self-check before sending

After building the splits, before returning `RouteUpload`, add an assertion:

```swift
// 2026-06-03 · sanity check · splits must sum to workout.duration ± 5s
// (workout.duration excludes paused time per Apple). If the sum is off,
// our split derivation is still buggy · send no splits rather than bad
// splits. Backend will fall back to total stats only.
let splitsSum = splits.reduce(0) { $0 + $1.paceSPerMi }
let durationS = Int(workout.duration.rounded())
let reconcileDelta = abs(splitsSum - durationS)
if reconcileDelta > 5 {
    print("⚠️ [HealthKit] splits don't reconcile · sum=\(splitsSum)s vs duration=\(durationS)s (Δ\(reconcileDelta)s) · sending empty splits")
    splits = []
}
```

---

## Acceptance tests

Add to `legacy/native/Faff/FaffWatch Watch AppTests/WorkoutEngineTests.swift` (or wherever HealthKitManager tests live):

| Test | Setup | Expected |
|---|---|---|
| `testNoPauseRunSplitsReconcile` | 3-mile run, no pauses | `sum(splits.paceSPerMi)` equals `workout.duration` |
| `testSinglePauseMidMile` | 3-mile run, 30s pause during mile 2 | mile-2 pace doesn't include the 30s |
| `testMultiplePausesAcrossMiles` | 5-mile run with 2 pauses (20s in mile 2, 45s in mile 4) | mile 2 and mile 4 each exclude their respective pause time |
| `testRunEndingMidMile` | 6.08-mile run (last 0.08 is a partial mile) | partial sub-mile distance NOT emitted as its own "mile 7" split (matches current behavior · just verify the partial doesn't sneak in) |
| `testReconcileFailureSendsEmpty` | Forced-bad input where computed splits don't reconcile | `splits` returned empty rather than bad numbers |

---

## What the backend already does (your safety net)

Shipped at commit `<<commit-hash-pending>>`:

1. **Detection** at `/api/ingest/workout` · sums incoming split times, compares to `duration_sec`. If off by > 5s, drops the splits and stamps `splits_unreliable: true` on the run row, plus a `splits_validation` audit object with the math.
2. **Loud log** in Railway logs: `[ingest/workout] dropping unreliable splits · user=XXXXXXXX client_workout_id=YYY · splits_sum=3160s vs duration=3034s (delta 126s)`. Grep that to find every bad-split run.
3. **Renderer fallback** · downstream surfaces (slowest mile, drift, etc.) skip when `splits_unreliable === true`. Recap shows total stats only.

Once your fix lands, the warn log goes silent and surfaces start rendering split data again automatically. No backend coordination needed.

---

## Edge case · iPhone HK ingest specifically

`buildRoutePayload` is called from the HK sync path (`HealthKitManager`). The Faff watch app's live workout (sent via `WatchCompletionUpload`) uses `WorkoutEngine` and DOES capture pause events explicitly. Verify the Faff watch app's split derivation already handles pause correctly (probably does, since it ships `phases` not derived-from-GPS splits) · if there's a parallel bug there, ship the same fix.

---

## Citations

- Apple Developer · `HKWorkoutEvent` pause/resume types
- `HKWorkoutEventTypePause`, `HKWorkoutEventTypeResume` · canonical pause-tracking pattern
- `workout.duration` definition · explicitly excludes paused time per HK docs

---

## Open question

Backend currently uses 5-second tolerance for the reconcile check. iPhone agent: do you want the same tolerance on your self-check? Smaller (2s) is stricter but might fire false-positives on rounding edges. Larger (10s) tolerates more drift but might miss real bugs. **5s recommended for parity.**

---

## Ship coordination

When your fix lands:
1. iPhone sends pause-aware splits + self-check
2. Backend `splits_unreliable` log goes silent for new runs
3. Old paused runs (David's 2026-06-03 included) will keep wrong splits until iPhone re-syncs them on next HK fetch
4. No backfill migration needed · old runs are historical, training-trajectory is dominated by avg pace + total distance which were never wrong
