# The Pacing Algorithm

Plain-English walk-through of how a GPX becomes a `.runcino.json`.
No code — just the math and the decisions.

---

## 1. Parse the GPX

A GPX file is XML with a `<trk><trkseg><trkpt lat lon><ele/>` tree.
We extract a flat array:

```
points = [
  { lat, lon, ele_m, cumulative_dist_m },
  …
]
```

Distance between consecutive points uses the haversine formula
(flat-earth approximation is fine at race scale). Elevation is
smoothed with a 3-point moving average, because GPS altitude jitters
by ±3m even when you're standing still.

---

## 2. Segment the course

Walk the points, start a new segment every 800m. Each segment gets:

```
segment = {
  start_mi, end_mi,
  distance_m: ~800,
  grade_pct: (ele_end − ele_start) / distance,  // signed %
  gain_ft, loss_ft
}
```

A marathon yields ~53 segments.

---

## 3. Minetti's cost-of-running curve

Minetti et al. (2002) measured the metabolic cost of running at
varying grades. The best-fit polynomial for energy cost
`C(g)` in J/(kg·m), where `g` is grade as a decimal:

```
C(g) = 155.4·g^5 − 30.4·g^4 − 43.3·g^3 + 46.3·g^2 + 19.5·g + 3.6
```

Valid for `g ∈ [-0.45, 0.45]` (outside that, extrapolation is
untrustworthy; we clamp).

`C(0) ≈ 3.6` — the flat-ground baseline. Define a **grade
adjustment factor**:

```
GAF(g) = C(g) / C(0)
```

Examples:
| Grade | GAF  | Meaning |
|-------|------|---------|
| -5%   | 0.78 | 5% downhill feels like 78% of flat effort at same pace |
| 0%    | 1.00 | baseline |
| +3%   | 1.42 | 3% up feels like 142% of flat effort |
| +5%   | 1.80 | Hurricane Point territory |
| +8%   | 2.45 | short, brutal climb |

This is the same curve Strava uses for its GAP calculation.

---

## 4. Convert goal time to a flat-equivalent pace

```
flat_pace_s_per_mi = goal_time_s / distance_mi
```

For Big Sur 3:50:00: `13800 / 26.22 ≈ 526 s/mi` ≈ `8:46/mi`.

This is the pace you'd run if the course were flat. It's never
actually run anywhere on the course — it's the reference.

---

## 5. Apply grade adjustment per segment

For each segment with grade `g`:

```
target_pace_s_per_mi = flat_pace × GAF(g)
```

Hurricane Point at +5% grade → `526 × 1.80 ≈ 947 s/mi` ≈ `15:47/mi`.

That's clearly too slow for 2 miles of climb — the raw Minetti
adjustment treats every segment independently, ignoring that you
bank time on the descents before and after. So we don't use raw
per-segment GAF directly.

---

## 6. Scale to goal time ("even effort" strategy)

The fix: compute the **total GAF-weighted time** as if we ran the
flat pace everywhere, then scale.

```
course_cost = sum over segments of (distance_i × GAF(grade_i))
flat_cost   = sum over segments of (distance_i × 1.0) = total_distance
effort_multiplier = goal_time / (flat_pace × course_cost)
```

Each segment's target pace is then:

```
target_pace_i = flat_pace × GAF(grade_i) × effort_multiplier
```

This scales the Minetti-adjusted paces so the sum of
`distance_i × target_pace_i` equals `goal_time`. You're running
**constant effort**; pace varies with the course.

For Big Sur 3:50:00, this yields Hurricane Point at ~9:55/mi, not
15:47/mi. The climb pace is slower than flat, but not cartoonishly
slow — because the descents after pay you back.

---

## 7. Alternative strategies

- **Even split** — `target_pace_i = flat_pace` for all `i`. Ignores
  the course. Wrong for Big Sur; fine for flat races.
- **Negative split** — first half `flat_pace + 5 sec/mi`, second half
  solves for the remainder. Then apply GAF scaling on each half
  independently.

---

## 8. Group segments into phases

53 rows is too many for a human. We collapse adjacent segments into
6–8 **phases** using a single heuristic:

Walk the segments. Start a new phase when **either**:
- Grade changes direction for more than 400m (up → down or down → up), **or**
- Pace differs from the current phase's mean by more than 15 sec/mi

Phases are labeled after the fact with landmark names (Hurricane
Point, Bixby Creek, Carmel Highlands) from a small hand-curated
dictionary of famous race courses. Unknown courses get generic
labels ("Climb", "Rolling descent", etc.) based on grade.

Merge any phase under 0.75 mi into its neighbor.

---

## 9. Compute cumulative splits

For each phase, `cumulative_time_s` = sum of prior phase durations +
its own. This is the projected split as you cross the end-of-phase
mile marker.

---

## 10. Emit `.runcino.json`

Populate the fields in [`SCHEMA.md`](SCHEMA.md) and write the
file. That's the whole Phase 1 pipeline.

---

## Trust, but verify

Minetti's curve was measured on a treadmill. Real-world running has
wind, footing, crowd, heat, nutrition. The algorithm gives you
a **plan**, not a prophecy — tolerance bounds (±10 sec/mi on the
Watch) exist because reality drifts. If actual race-day splits
deviate consistently, it's a signal to recalibrate the model —
not the runner.

---

## References

- Minetti, A. E., Moia, C., Roi, G. S., Susta, D., & Ferretti, G.
  (2002). "Energy cost of walking and running at extreme uphill
  and downhill slopes." *Journal of Applied Physiology*, 93(3),
  1039–1046.
- Strava engineering blog: "How Strava calculates Grade Adjusted
  Pace" (2018).
