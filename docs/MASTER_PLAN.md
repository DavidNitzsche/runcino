# Master Plan

The full Runcino vision, scoped honestly against what's shippable.
Read this first — everything else in `docs/` refines pieces of it.

---

## The vision in one paragraph

Runcino is a personal AI running coach. It plans your training,
builds your race-day pacing strategy, cues you through the race on
your Apple Watch, and learns from each race to make the next one
better. Claude reads your Health data, your past races, and your
calendar; does the thinking a human coach would do; and writes
everything to your wrist as native WorkoutKit workouts. No cloud
infrastructure, no accounts, no subscriptions. One runner, one
app, years of use.

---

## One app, phased capability

**It's one app: Runcino.** One iOS bundle, one Watch surface, one
`.runcino.json` schema, one Claude layer, one data store. What ships
over time is more capability — not more apps.

The unifying concept is **a workout is a workout**. Your Tuesday
tempo, your Saturday long run, and race day all import from the
same schema, render in the same UI, and push to your Watch through
the same WorkoutKit pipeline. The only difference is what created
them — you fed a race GPX, or Claude generated your next training
block.

### Capability phases (all in the same app)

| | **Race capability** | **Training capability** |
|---|---|---|
| What it enables | Drop a race GPX → get a landmark-aware, fueled, grade-adjusted pacing plan on your Watch | Claude writes and adapts your weekly plan; every session syncs to the Watch |
| Active use | Days before a race, plus race day | Every day |
| Claude's role | Goal recommendation, race-morning brief, fueling strategy, retrospective | Weekly plan authoring, adaptive replanning, coaching narrative |
| Data needed | Fitness summary, GPX, weather | HealthKit (HRV, sleep, load) heavy |
| Shippable in | 7 days (minimal) → 3 weeks (full) | 3–6 months (after Race is solid) |
| **Big Sur 2026** | **Minimal version ships** | Not yet — races don't need a full coach layer |

The "race" is just the final workout in a training block. Once
Training capability lands, race-day pacing is one natural outcome
of the same planning loop — not a separate feature set.

---

## Race capability — feature list

| # | Feature | Big Sur 2026 | After Big Sur |
|---|---|:---:|:---:|
| 1 | GPX parser + Minetti GAP + 6-phase grouping | ✓ | |
| 2 | Pace plan scaled to goal time | ✓ | |
| 3 | `.runcino.json` export | ✓ | |
| 4 | iOS import → CustomWorkout with pace-goal IntervalSteps | ✓ | |
| 5 | Fueling plan (gel timings anchored to phases + haptic cues on Watch) | ✓ | |
| 6 | Landmark cues (hand-curated for Big Sur: Bixby, Hurricane Point, Carmel) | ✓ | |
| 7 | Claude-written goal recommendation (manual fitness summary input) | ✓ | |
| 8 | Claude-written race-morning brief (weather + pacing adjustments) | ✓ | |
| 9 | Manual weather entry (NOAA forecast copy-paste) | ✓ | |
| 10 | Automatic weather fetch (NOAA API) — web/CLI **live now**; iOS wiring at M2 | partial | ✓ |
| 11 | HealthKit read — auto-fitness summary | | ✓ |
| 12 | Strava OAuth — race history auto-ingestion | | ✓ |
| 13 | HR zones per phase (HR wins if disagrees with pace) | | ✓ |
| 14 | Post-race retrospective (Claude analyzes actual vs. plan) | | ✓ |
| 15 | Personal Minetti calibration (learned from each race) | | ✓ |
| 16 | "What-if" pace adjustment in natural language | | ✓ |
| 17 | Shoe rotation suggestion from Strava mileage | | ✓ |
| 18 | Pre-race mental playthrough | | ✓ |

**What ships for Big Sur:** #1-9. Works end-to-end, Claude-powered where it matters, no external data dependencies.

**What ships after Big Sur** (2-3 more weeks): #10-18. HealthKit, Strava, real retrospective loop.

---

## Training capability — feature list (post-Big Sur)

Scoped but not started. Listed for planning continuity. Uses the
same iOS app, same Watch pipeline, same schema — new UI surfaces
and new Claude prompts.

| # | Feature |
|---|---|
| C1 | Weekly plan generation from goal race + current fitness |
| C2 | Periodization (base / build / peak / taper) |
| C3 | Long-run course generation — matches race terrain |
| C4 | Adaptive replanning — skipped runs, bad HRV, life intrusions |
| C5 | Recovery / readiness score (HRV-based) |
| C6 | Injury-risk gate — warn before load-spike tempos |
| C7 | Coaching narrative — "why this workout this week" |
| C8 | Daily workouts → Watch (reuses Race's sync plumbing) |
| C9 | Voice journal + transcript + weekly trajectory summary |
| C10 | Taper adjustment from race-week HealthKit data |

Philosophy question still open: Pfitzinger, Daniels, Hanson, or custom hybrid? Needs to be settled before C1.

---

## Deferred to "someday"

These came up in scoping and got cut. Not forgotten, just not urgent.

- Custom watchOS app / complication (WorkoutKit's native UI wins for now)
- macOS companion app (web dashboard on localhost is enough)
- Multi-athlete (this is a personal tool by design)
- Social / sharing (no)
- Race outfit + gear checklist
- Crowd / logistics intel from past race reports
- Live mid-race Claude adjustments via cellular Watch
- Apple Health round-trip (writing custom training-load metric back)

---

## Architecture (final)

```
            ┌─────────────────────┐
            │  Anthropic API      │
            │  (Claude sonnet-4)  │
            └──────────┬──────────┘
                       │
                       │  reasoning: goals, briefs, retro
                       │
     ┌─────────────────▼─────────────────┐
     │   iOS app (SwiftUI, iOS 17+)      │ ← primary surface
     │   com.davidnitzsche.runcino       │
     │                                   │
     │   • Reads:   HealthKit, EventKit, │
     │              Strava OAuth, NOAA   │
     │   • Stores:  plans in iCloud Drive│
     │   • Writes:  WorkoutKit           │
     │              CustomWorkouts       │
     └──┬──────────────────────────┬─────┘
        │                          │
        │ .runcino.json            │ WorkoutScheduler.preview()
        │ (iCloud sync)            │
        ▼                          ▼
  ┌─────────────┐           ┌──────────────┐
  │  web app    │           │ Apple Watch  │
  │ (localhost) │           │ (Fitness /   │
  │             │           │  Workout UI) │
  │ read-only   │           │              │
  │ dashboard   │           │ native       │
  │ & GPX tools │           │ CustomWorkout│
  └─────────────┘           └──────────────┘
```

**iOS app is the hub.** Web is a big-screen dashboard that reads
the same iCloud-synced `.runcino.json` files. Watch is Apple's
native Workout app running custom workouts we built.

For Big Sur 2026 (7 days), we cut:
- HealthKit → manual fitness summary input
- EventKit → not needed until Coach
- Strava → not needed until Coach
- NOAA fetch → manual forecast copy-paste
- iCloud sync → web app is skipped entirely for the sprint;
  JSON lives on-disk and on-device only

The shell of the architecture ships. The data connectors are scaffolded but not wired. That's the 7-day compromise.

---

## 12-month roadmap

| Milestone | Window | What ships (all in the same app) |
|---|---|---|
| **M0** — Big Sur 2026 | **7 days (now)** | Race capability minimal: pacing, fueling, landmarks, Claude goal + brief |
| **M1** — Post-race | +1 week | Retrospective, personal calibration, HealthKit read layer |
| **M2** — Race full | +4 weeks | Strava, weather auto-fetch, HR zones, iCloud sync, web dashboard |
| **M3** — Training MVP | +3 months | Weekly plan generation, periodization, Watch daily workouts |
| **M4** — CIM 2026 | December 2026 | Training + race battle-tested together |
| **M5** — Training full | Early 2027 | Adaptive replanning, injury gate, recovery score, voice journal |
| **M6** — 2027 season | Spring 2027 | The tool you use every race, every day |

---

## Non-goals (on purpose)

- Multi-user, teams, friends, social
- App Store distribution
- Cloud infrastructure of any kind (Anthropic API is the only remote call)
- Analytics, telemetry, crash reporting
- Subscription, payments, accounts
- Backwards compatibility with other training apps' exports
- Cross-platform (Android, Garmin, Polar) — Apple ecosystem only

---

## What this document is not

A product spec. Each milestone gets its own spec before we build it.
This is the compass — what we're building toward and why — so
scoping decisions in each sprint are made against a shared picture.
