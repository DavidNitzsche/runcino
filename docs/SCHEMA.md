# `.runcino.json` Schema — v1.0.0

The contract between the web app (Phase 1, producer) and the iOS app
(Phase 2, consumer). Once frozen (end of Day 3), any change requires
a new `schema_version`.

## Why a file, not an API

One runner, one race. No server. A `.runcino.json` file travels
from my laptop to my iPhone via AirDrop / iCloud Drive / Files app.
Zero infrastructure. Zero privacy surface.

## Top-level shape

```jsonc
{
  "schema_version": "1.0.0",        // semver, required
  "generated_at": "ISO-8601 UTC",   // when the web app built this
  "generator": "runcino-web@0.1.0", // tool + version that produced it

  "race": { … },     // static race metadata
  "goal": { … },     // what David is trying to do
  "tolerance": { … },// how strict the watch alerts are
  "phases": [ … ]    // 6–8 landmark-anchored phases
}
```

## `race`

```jsonc
{
  "name": "Big Sur International Marathon",
  "date": "2026-04-26",
  "distance_mi": 26.22,
  "distance_m": 42195,
  "total_gain_ft": 2182,
  "total_loss_ft": 2050
}
```

- `distance_mi` and `distance_m` must agree (±0.01 mi rounding).
- Gain/loss are from the GPX after a 3-point moving-average smooth
  on elevation (raw GPS elevation is noisy).

## `goal`

```jsonc
{
  "finish_time_s": 13800,          // target total duration, seconds
  "finish_time_display": "3:50:00",
  "strategy": "even_effort",       // "even_effort" | "even_split" | "negative_split"
  "warmup": {
    "enabled": false,
    "distance_mi": 0,
    "pace_s_per_mi": null
  }
}
```

- `strategy` values:
  - `even_effort` — scale Minetti-adjusted paces to hit goal time.
    **Default.**
  - `even_split` — ignore course, target pace = goal / distance
    everywhere. Useful for flat courses; wrong for Big Sur.
  - `negative_split` — allocate first half at goal_pace + 5 sec/mi,
    second half faster to compensate.
- `warmup.enabled: true` means first `distance_mi` are held at
  `pace_s_per_mi` regardless of grade; remaining distance is scaled
  to hit goal time.

## `tolerance`

```jsonc
{
  "pace_s_per_mi": 10
}
```

Watch haptic fires if observed pace deviates from target phase pace
by more than this. Passed to WorkoutKit as `IntervalStep` pace goal
bounds: `target ± tolerance`.

## `phases`

Array of 6–8 segments. Contiguous — `phases[i].end_mi ==
phases[i+1].start_mi`. First phase starts at 0.0, last ends at
`race.distance_mi`.

```jsonc
{
  "index": 2,
  "label": "Hurricane Point climb",
  "start_mi": 10.0,
  "end_mi": 12.0,
  "distance_mi": 2.0,
  "target_pace_s_per_mi": 595,
  "target_pace_display": "9:55/mi",
  "mean_grade_pct": 4.8,
  "elevation_gain_ft": 520,
  "elevation_loss_ft": 30,
  "cumulative_time_s": 7580,
  "cumulative_time_display": "2:06:20",
  "cumulative_distance_mi": 12.0,
  "note": "Steady climb. Don't chase pace — hold effort."
}
```

- `target_pace_s_per_mi` is an integer (round to nearest second).
- `cumulative_time_s` is at `end_mi` (i.e. the projected split time
  passing that mile marker).
- `note` is an optional hint shown on the Watch under the pace.

## Example

See [`example.runcino.json`](example.runcino.json) — a full Big Sur
3:50:00 plan.

## Validation

The web app must emit only valid files. The iOS app must reject
anything where:

- `schema_version` is not `1.0.0`
- `phases` is empty or has > 10 entries
- Phases are non-contiguous
- Any `target_pace_s_per_mi` is outside `[240, 900]` (4:00 to 15:00/mi)
- `finish_time_s` disagrees with the sum of phase times by > 30 s
