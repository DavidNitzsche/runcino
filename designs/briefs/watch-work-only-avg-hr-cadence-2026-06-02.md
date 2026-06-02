# Brief · Watch → Backend · top-level avgHr / avgCadence now WORK-WEIGHTED

**From:** watch agent
**To:** backend agent
**Re:** semantic change on `WatchCompletion.avgHr` and `WatchCompletion.avgCadence`
**Date:** 2026-06-02
**Status:** Shipped · wire shape unchanged · meaning shifted

---

## TL;DR

`WatchCompletion.avgHr` and `WatchCompletion.avgCadence` (the top-level workout-wide fields) are now re-derived in `buildCompletion()` from **work-phase results only**, weighted by `actualDurationSec` per phase. Previously they came from `WorkoutTracker.avgHr` / `.avgCadence`, which pooled every per-second sample across recovery + warmup + cooldown.

**Wire shape unchanged.** Field names, types (`Int?`), nullability all identical. Per-phase `WatchCompletionPhase.avgHr` / `.avgCadence` (the splits-level fields you ingest into `runs.data.splits[i]`) are unchanged — those were already correctly isolated.

If any composer reads `runs.data.avg_hr` or `runs.data.avg_cadence` directly (the top-level), the value it sees post-deploy will skew higher than pre-deploy on interval/threshold sessions — because rest-jog samples no longer drag the average down. On steady runs the value is unchanged.

---

## What changed (watch-side)

Before:

```swift
return WatchCompletion(
    ...
    avgHr: tracker?.avgHr,         // lifetime pool across all phases
    avgCadence: tracker?.avgCadence,
    ...
)
```

After:

```swift
let workPhases = results.filter { $0.type == "work" }
let derivedAvgHr: Int? = {
    let weighted = workPhases.compactMap { p -> (Int, Int)? in
        guard let hr = p.avgHr, p.actualDurationSec > 0 else { return nil }
        return (hr, p.actualDurationSec)
    }
    guard !weighted.isEmpty else { return tracker?.avgHr }  // fallback
    let totalSec = weighted.reduce(0) { $0 + $1.1 }
    guard totalSec > 0 else { return tracker?.avgHr }
    let totalHrSec = weighted.reduce(0) { $0 + ($1.0 * $1.1) }
    return Int((Double(totalHrSec) / Double(totalSec)).rounded())
}()
// derivedAvgCadence: same pattern
```

Weighted by `actualDurationSec` because each per-phase aggregate is itself ~1 Hz sample-count-weighted — a 7-minute rep should count 7× a 1-minute rep, not 1:1.

---

## Why

The watch's `WorkoutTracker` pumps every CMPedometer / HR-stream sample into `cadSum` / `hrSum` regardless of which phase the runner is in. For an interval session, that pools:

- Threshold reps at ~188 spm / ~178 bpm
- Recovery jogs at ~165 spm / ~150 bpm
- Warmup + cooldown at ~170 spm / ~140 bpm

The pooled avg lands somewhere ~177 spm / ~158 bpm — meaningless. The iPhone summary card was reading these contaminated values.

`WatchCompletionPhase.avgHr` and `.avgCadence` were always isolated per phase (engine resets per-phase counters on advance), so the splits-level data was always correct. This change pulls the top-level into alignment with the splits.

---

## What this means for backend composers

| Composer source | Behavior change |
|---|---|
| Composers reading from `runs.data.splits[i].avg_hr` / `.avg_cadence` | **No change.** Per-phase numbers identical. |
| Composers reading from `runs.data.avg_hr` / `.avg_cadence` (top-level) | Number will skew higher post-deploy on interval/threshold sessions. Same on single-phase steady runs (only one work phase → re-derive = lifetime). |
| `winHrZone` / `winCadenceClimb` / anything that compares avgHr to zone thresholds | If the composer's threshold logic assumed contaminated-average semantics ("avgHr ~155 on this run"), it may now read higher and fall into a different zone. Worth a re-look on interval sessions. |

For tomorrow's threshold (3×1mi at 6:47, warmup + recoveries + cooldown):
- Old pooled avgHr would have landed ~160 bpm
- New work-weighted avgHr will read ~178 bpm (closer to the actual rep effort)
- Old pooled avgCadence ~177 spm
- New work-weighted avgCadence ~188 spm

---

## Edge cases handled

1. **No work phases recorded** (user ended in warmup) → fallback to `tracker.avgHr` / `.avgCadence` so the field isn't gratuitously nil
2. **All work-phase avgs are nil** (HR/cadence stream never produced samples) → same fallback
3. **Single-phase steady run with NO warmup/cooldown** → work-weighted == lifetime (same answer)
4. **Single-phase steady run WITH warmup/cooldown** → correctly excludes warmup/cooldown samples; this is the intended semantic shift
5. **Mid-rep abandon** (`completed: false`) → that rep's partial avg is still included in the weighted average; that's honest, the runner WAS running at that effort

---

## What's NOT changed

- `WatchCompletion.maxHr` — still `tracker.maxHr` (lifetime). Max HR can legitimately spike during warmup sprint or recovery effort. The max is the max.
- `WatchCompletion.totalDistanceMi` / `totalDurationSec` — unchanged.
- `WatchCompletionPhase.avgHr` / `.avgCadence` — unchanged, always isolated.
- The `_raw` passthrough — unchanged.
- Wire encoding (JSON field names + types) — unchanged.

---

## Action items for backend

**None required** unless you spot a composer that reads top-level `avg_hr` / `avg_cadence` and assumed contaminated-pool semantics. Most composers should be reading from `splits[i]` anyway (more precise, gates on per-rep verdicts). Quick audit suggested but not blocking.

---

## TL;DR (again)

> `WatchCompletion.avgHr` / `.avgCadence` re-derived from work-phase splits, duration-weighted. Wire shape unchanged. Per-phase splits unchanged. For interval sessions, top-level numbers will read higher because rest jogs no longer drag them down. Bug fix shipping pre-tomorrow's threshold run so the iPhone summary reads honest. Composers reading from splits are unaffected; composers reading from top-level should be aware.
