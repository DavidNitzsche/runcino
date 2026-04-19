# `.runcino.json` Schema — v1.1.0

The contract between the web app (producer) and the iOS app
(consumer). Any breaking change requires a new `schema_version`.

## v1.1.0 notes

- Added `intervals[]` — flat sequenced list of typed steps (pace /
  fuel / landmark) that iOS uses to build WorkoutKit `IntervalStep`s.
- Added `brief` — Claude-authored race-morning narrative.
- Added `fitness_summary` — the inputs Claude used for the goal
  recommendation (so we can reproduce and retrospect).
- `phases[]` stays as the human-readable grouping; `intervals[]` is
  the machine version. They describe the same race.

---

## Why a file, not an API

One runner, one race. No server. A `.runcino.json` file travels
from the laptop to the iPhone via AirDrop / iCloud Drive / Files app.
Zero infrastructure. Zero privacy surface.

---

## Top-level shape

```jsonc
{
  "schema_version": "1.1.0",
  "generated_at": "ISO-8601 UTC",
  "generator": "runcino-web@0.1.0",

  "race":             { … },   // static race metadata
  "goal":             { … },   // target finish, strategy, warmup
  "fitness_summary":  { … },   // inputs Claude saw for the recommendation
  "tolerance":        { … },   // watch alert strictness
  "phases":           [ … ],   // 6–8 human-readable groupings
  "intervals":        [ … ],   // flat ordered steps for WorkoutKit
  "fueling":          { … },   // gel schedule + total carbs
  "brief":            null     // populated by race-morning Claude call
}
```

---

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

## `goal`

```jsonc
{
  "finish_time_s": 13800,
  "finish_time_display": "3:50:00",
  "strategy": "even_effort",        // "even_effort" | "even_split" | "negative_split"
  "flat_pace_s_per_mi": 526,        // goal / distance
  "warmup": { "enabled": false, "distance_mi": 0, "pace_s_per_mi": null },
  "claude_rationale": "Your LA 3:40 extrapolates to a flat-course equivalent…"
}
```

## `fitness_summary`

Inputs Claude saw. Stored so the recommendation is reproducible.

```jsonc
{
  "baseline_race": { "name": "LA Marathon", "finish_s": 13200, "months_ago": 5 },
  "weekly_mileage": 38,
  "weekly_mileage_trend_6wk": -4,
  "longest_recent_long_run_mi": 18,
  "longest_recent_long_run_age_wk": 3,
  "resting_hr_bpm": 48,
  "resting_hr_trend_8wk": -2,
  "age": null,
  "weight_lb": null,
  "source": "manual"                // "manual" | "healthkit" | "strava"
}
```

## `tolerance`

```jsonc
{ "pace_s_per_mi": 10 }
```

## `phases`

Human-readable groupings for the iOS plan view and the web table.

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
  "cumulative_time_s": 6340,
  "cumulative_time_display": "1:45:40",
  "note": "Steady climb. Don't chase pace — hold effort."
}
```

## `intervals`

Flat ordered list. iOS maps each entry to a `WorkoutKit.IntervalStep`.

**Shared fields:** `index`, `phase_idx`, `at_mi` (start position),
`kind`, `label`.

**Pace step:**
```jsonc
{
  "index": 5,
  "phase_idx": 2,
  "kind": "pace",
  "at_mi": 10.0,
  "distance_mi": 2.0,
  "target_pace_s_per_mi": 595,
  "tolerance_s_per_mi": 10,
  "label": "Hurricane climb"
}
```

**Fuel step:**
```jsonc
{
  "index": 4,
  "phase_idx": 1,
  "kind": "fuel",
  "at_mi": 8.0,
  "duration_s": 30,
  "item": "Maurten gel · water",
  "gel_number": 2,
  "label": "Gel 2"
}
```

**Landmark step:**
```jsonc
{
  "index": 3,
  "phase_idx": 1,
  "kind": "landmark",
  "at_mi": 10.0,
  "duration_s": 10,
  "label": "Bixby Bridge · 0.3 mi"
}
```

### Interval ordering rules

- `intervals[]` must be sorted by `at_mi` ascending.
- `intervals[0].at_mi` must be `0.0`; last pace step's
  `at_mi + distance_mi` must equal `race.distance_mi` (±0.01 mi).
- Fuel and landmark steps are "inserted" between pace steps —
  the preceding pace step's `distance_mi` is shortened so the
  sequence remains continuous in mile space.
- iOS builds `CustomWorkout.blocks` from this array directly.

## `fueling`

Summary of the fuel plan — the detailed anchors live in `intervals[]`.

```jsonc
{
  "carb_target_g_per_hr": 60,
  "total_carbs_g": 240,
  "gel_count": 5,
  "gel_carbs_g": 40,
  "gel_brand": "Maurten",
  "notes": "Gels anchored to phase boundaries, not clock. Mile 8 lands pre-Hurricane for Hurricane-climb absorption."
}
```

## `brief`

Race-morning narrative. `null` until generated.

```jsonc
{
  "generated_at": "2026-04-26T06:18:00Z",
  "weather_input": "42°F start, 58°F finish. NW wind 8 mph. Overcast until noon.",
  "narrative": "Tailwind through the redwoods, turns to light crosswind at Hurricane…",
  "plan_adjustments": [
    { "phase_idx": 4, "pace_delta_s_per_mi": +3, "reason": "crosswind exposure mile 14-18" }
  ]
}
```

---

## Example

See [`example.runcino.json`](example.runcino.json) — a full Big Sur
3:50:00 plan.

---

## Validation (iOS import)

Reject any file where:

- `schema_version` major doesn't match app's supported (currently `1.x`)
- `phases[]` empty or > 10
- `intervals[]` not sorted or non-continuous in mile space
- Any `target_pace_s_per_mi` outside `[240, 900]` (4:00 to 15:00/mi)
- `sum(phase.distance_mi × phase.pace / 3600)` disagrees with
  `goal.finish_time_s` by > 30 s
