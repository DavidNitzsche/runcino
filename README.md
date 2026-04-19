# Runcino

> A personal Apple Watch race-pacing tool for David Nitzsche.
> Upload a GPX of your race, get a grade-adjusted pacing plan,
> sync it to your watch. That's it.

---

## What this is

Runcino (Italian for "little run") takes a race-day GPX file and
produces an elevation-aware pacing strategy that compiles straight
to an Apple Watch custom workout. No accounts, no cloud, no ads,
no "social." One runner, one race, one plan.

## What this isn't

- A training platform
- A Strava clone
- A social app
- A subscription SaaS

## Two-phase build

| Phase | Surface | What it does |
|-------|---------|--------------|
| **1** | Web (Next.js 15, local only) | Parse GPX, compute grade-adjusted pace per ~500m segment, export `.runcino.json` workout spec |
| **2** | iOS / watchOS (SwiftUI + WorkoutKit) | Import `.runcino.json`, render the plan, build a `CustomWorkout` with `IntervalStep.pace` goals, scheduled via `WorkoutScheduler.preview()` |

## Repo layout

```
runcino/
├── mockups/       ← HTML pitch-deck mockups (this branch)
├── docs/          ← project map, checklist, schema, algorithm notes
├── web/           ← Phase 1 build (Next.js) — not yet
└── ios/           ← Phase 2 build (Xcode) — not yet
```

See [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) for the full tree and
[`docs/CHECKLIST.md`](docs/CHECKLIST.md) for the day-by-day plan.

## Mockups

Open any file in `mockups/` directly in a browser. Start with
[`mockups/index.html`](mockups/index.html) — the pitch deck.

## Philosophy

**Minetti's equation, not machine learning.** The grade-adjustment
model is the same cost-of-running curve Strava uses for GAP — a
2002 paper by Minetti et al., well-validated for grades in
[-0.45, +0.45]. No training data required.

**Ship the JSON spec, then build twice.** The `.runcino.json`
workout spec is the contract between web and iOS. Freeze it first,
build both sides against it. See [`docs/SCHEMA.md`](docs/SCHEMA.md).

**Personal tool, personal scope.** No auth, no onboarding, no
privacy policy, no Vercel deploy. Runs on `localhost:3000` and on
my iPhone. That's the whole deployment surface.

---

## Real race context

- **Baseline:** LA Marathon, finished in 3:40
- **Target race:** Big Sur International Marathon (Highway 1,
  Carmel Highlands). Famous elevation profile — Hurricane Point at
  mile 10-12, rolling to the finish. The canonical test case for
  why GAP-aware pacing matters: even effort on that course requires
  pace to vary by ~45 sec/mi between climbs and descents.
- **Goal time:** TBD (see open question in `docs/CHECKLIST.md`)
