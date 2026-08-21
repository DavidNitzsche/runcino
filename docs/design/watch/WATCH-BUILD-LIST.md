> **SUPERSEDED · 2026-08-21.** This document is background, not constraint.
> Do not build from it and do not reconcile against it.
>
> The watch is built from the approved design files:
> `/Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/`
> (53 boards, 15:49) and `../design_handoff_0821_addendum/` (six screens, 16:17).
> Audit and build sequencing: `docs/design/watch-0821/AUDIT.md`.
>
> Written 09:03-10:56 the same day, before the studio handoff existed. Its six
> extra metric hues came from a verbal "a bit more faff and fun" aimed at a
> black-and-white-plus-one-accent draft. David, with the handoff in front of
> him: "I know what I approved in the watch design files and that's what you
> should rely on." The handoff's rule 1 makes colour grade on the wrist, so
> per-metric hues and "a coloured number is read as a graded number" cannot
> both hold. The six day-state ramps DO survive - they fill a whole screen and
> cannot be misread as a verdict on one figure.

# Watch · the build list

Design direction approved 2026-08-21. This is what gets built, what each face
shows, where every number comes from, and what is missing before it can.

Grounded in the wire as it actually stands — `WatchWorkout` / `WatchPhase` in
`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`, and
`WatchCompletion` on the way back. Where something is not available, it says so
rather than assuming.

---

## 1 · The face grammar, as approved

Every running face is the same four boards:

| Board | What it is |
|---|---|
| **Page 1 · primary** | The ask, then the three that support it. Pace leads by being first and 20% larger, not by being coloured. Band strip under it. Progress strip at the bottom. |
| **Page 1 · off band** | Same board. The number turns amber, the mark leaves the lit segment, haptic at the crossing. |
| **Page 2 · performance** | All white, stepped 1.0 / 0.72. Nothing here is the ask, so nothing takes signal orange. |
| **Always-On** | Three quantities, dimmed, elapsed to the minute. No strip, no dots, no heart rate. |

Colour, settled: **white while behaving, amber when off, orange only for the
session's own progress strip.** No green on a running face — a green number
reads as a good number however it was derived.

Character lives where nothing is being judged: the lobby, the finish, and the
chrome (progress strip in the session's ramp, unit labels tinted, page dots).

---

## 2 · The fleet

### Before the run

| # | Face | Shows | Notes |
|---|---|---|---|
| 1 | **Lobby** | Session type (display), distance, target band, Start | Full-bleed day-state ramp + grain. The one screen with time to be beautiful. |
| 2 | **Rest day** | "Nothing today", the reason | A refusal, not an empty screen. Must not look like an outage. |
| 3 | **No session** | The engine's own sentence | Off-season, week off, injury, sick — the watch does not prescribe, it says why not. |
| 4 | **Countdown** | 3 · 2 · 1 | Into any session with a structured start. |

### Running · steady

| # | Face | Page 1 ask | Page 2 |
|---|---|---|---|
| 5 | **Easy** | Pace, against the easy band | Cadence, avg pace, power, climb |
| 6 | **Long** | Pace | Same |
| 7 | **Steady / just-run** | Pace, no band (nothing was prescribed) | Same |
| 8 | **Treadmill** | Belt pace, **amber with `~`** | Cadence, `~`belt pace. Two rows, not four held open. |

### Running · structured

| # | Face | Page 1 ask |
|---|---|---|
| 9 | **Warm-up** | Time remaining, easy band |
| 10 | **Work interval** | Pace against the rep's target, rep N of M, remaining |
| 11 | **Recovery interval** | Time remaining, HR falling |
| 12 | **Strides** | Rep count, effort |
| 13 | **Tempo / threshold** | Pace against T band |
| 14 | **Progression** | Pace against the current segment's band |

### Running · race

| # | Face | Page 1 ask |
|---|---|---|
| 15 | **Race** | Pace against goal pace, elapsed against goal split |

### Moments — these interrupt a face, they are not faces you sit on

| # | Moment | Trigger |
|---|---|---|
| 16 | **Go** | Session start |
| 17 | **Phase change** | Interval boundary — `WatchPhase.haptic` already carries the cue |
| 18 | **Split** | Mile or km |
| 19 | **Landmark** | Race-course marker |
| 20 | **Fuel** | `gelsMi` marker points, race only |
| 21 | **Pause** | Runner-initiated |
| 22 | **Heads-up** | Band crossing, HR ceiling breach |

### After

| # | Face | Shows |
|---|---|---|
| 23 | **Complete** | Distance, time, pace — full-bleed ramp. The loudest faff moment in the product. |
| 24 | **Summary** | The run, scrollable. Everything page 2 held plus what only matters afterwards. |

---

## 3 · Metrics · source and status

### Available now, no work needed

| Metric | Source | Notes |
|---|---|---|
| Heart rate | HealthKit, live | Collected on watch-started runs |
| Distance | HealthKit `distanceWalkingRunning` | GPS-fused outdoors, accelerometer indoors |
| Elapsed | Session clock | |
| Pace | Derived from distance and time | |
| **Target pace band** | `WatchPhase.targetPaceSPerMi` + `tolerancePaceSPerMi` | **Already on the wire.** This is what the band strip and the amber off-band state read. |
| **HR ceiling** | `WatchWorkout.hrCeilingBpm`, `WatchPhase.hrTargetBpm` | Already on the wire |
| Active energy | HealthKit | |
| **Cadence** | `CMPedometer.currentCadence` | Already collected — 45 of 45 watch runs in the last 90 days carry it. Not HealthKit; no new consent. |
| Race goal, strategy, gel points | `isRace`, `goalSec`, `strategyLabel`, `gelsMi`, `fueling` | Already on the wire — the race face and the fuel moment are feedable today |
| Readiness | `readinessScore` / `readinessLabel` | Already on the wire |

### Needs work

| Metric | Status | What it needs |
|---|---|---|
| **Indoor / treadmill** | **MISSING — blocks face 8** | `WatchWorkout` carries no indoor flag at all, so the watch cannot know it is a belt session. One additive boolean on the wire, set from the same source the phone uses. |
| Cadence **timeline** | Scalar only | Phases carry `paceSamples` and `hrSamples` but only an average cadence. Needs `cadenceSamples` on `WatchCompletionPhaseBody` — purely additive, the route passes phases through verbatim. |
| Running **power** | Unverified indoors | watchOS 9+, Series 6 / SE 2 or later. Apple documents the running-form family as OUTDOOR metrics and we have not confirmed they are produced during an indoor session. **Needs a device test on a belt.** Page 2 treadmill is drawn without it for this reason. |
| Stride length, ground contact, vertical oscillation | Same | Same gate, same test |
| Elevation | Barometric, outdoor | Absent indoors, correctly |

---

## 4 · Engineering, before any of this ships

1. **`locationType` is hardcoded `.outdoor`** (`WorkoutTracker.swift:221`). A treadmill run started on the watch is written to HealthKit as an outdoor workout, runs GPS at navigation accuracy on a stationary belt, and can produce a garbage polyline. Fix in flight.
2. **The indoor flag** — item above. Nothing else about face 8 is blocked.
3. **The palette lock.** `scripts/check-palette-sync.sh` currently enforces the older ten-colour brief on the watch and forbids orange. Moving the watch onto v5 means updating that gate. My job, flagging it so the change is deliberate rather than a surprise on a Railway build.
4. **A belt device test** — the only way to settle the running-form question.
5. **The Always-On board is a real render target**, not a dimmed copy. It needs building as its own view.

---

## 5 · Design, still outstanding

- **The finish screen (23).** Not drawn, and it is the strongest moment in the app.
- **Page 1 on a treadmill.** Page 2 treadmill is marked; page 1's distance is the belt-derived number and needs the `~` too. Pace is that distance over time, so it inherits.
- **The refusal faces (2, 3).** A rest day and an off-season week are different sentences and must not look like a failure.
- **The moments (16–22).** Each is a takeover; none are drawn.
- **The structured faces (9–14).** The work interval was approved as the density test; the rest follow its language.
- **The quality/race ramp collision.** On those two ramps, stop 1 is within a few points of attention amber and stop 2 is close to signal orange. Chrome on those days needs stop 3 or reduced opacity, or it reads as a live warning on exactly the hardest sessions.
