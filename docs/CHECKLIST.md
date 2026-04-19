# 7-Day Big Sur Sprint

Today is **2026-04-19**. Big Sur is **2026-04-26**.
Seven days. One runner. One app.

This checklist covers **M0 — Big Sur 2026** from
[`MASTER_PLAN.md`](MASTER_PLAN.md). Everything outside this
file is M1 or later.

---

## Locked decisions

| Decision | Value |
|---|---|
| Units | `min/mi` |
| Baseline | LA Marathon, 3:40:00 |
| Target race | Big Sur, 2026-04-26 |
| Target finish | 3:50:00 (recommendation — Claude can refine on Day 2) |
| Default strategy | Even effort (Minetti GAP) |
| Pace tolerance | ±10 sec/mi on Watch |
| User-facing phases | 6, landmark-anchored |
| Bundle ID | `com.davidnitzsche.runcino` |
| Architecture | iOS-primary, web as localhost GPX tool only |
| Claude API | Yes, everywhere it earns keep (goal, brief, fueling, landmarks) |

---

## What ships for Big Sur (and what doesn't)

**Ships:**
- GPX → Minetti → 6 phases → scaled pacing plan
- Claude-written goal recommendation (from hand-entered fitness summary)
- Claude-written race-morning brief (weather + pacing adjustments)
- Fueling plan — gel timings as 30-sec IntervalSteps with haptic cues
- Landmark cues — hand-curated Big Sur dictionary, rendered as short
  IntervalSteps with haptic alerts
- `.runcino.json` export from web, import on iOS
- iOS app that renders the plan and pushes `CustomWorkout` to the Watch

**Deferred (post-race, M1–M2):**
- HealthKit auto-fitness-summary
- Strava OAuth + race history
- Calendar / EventKit
- NOAA weather auto-fetch (manual paste for race morning)
- HR zones per phase (pace-only for Big Sur)
- Post-race retrospective + calibration
- iCloud Drive sync between web & iOS
- Full coaching (M3+)

---

## Day 0 — Today · Mockups & scope lock

- [x] Repo scaffold, git + GitHub setup
- [x] README, PROJECT_MAP, ALGORITHM docs
- [x] SCHEMA v1.0.0 + example Big Sur JSON
- [x] Pitch-deck mockup + web-upload + web-plan
- [x] Master plan (one app, phased capability)
- [ ] **Mockups for Claude-native features** — goal-setting, iOS plan
      with fueling + landmarks, Watch race-day screens
- [ ] **GATE — David approves mockups. PR merges to `main`.**

---

## Day 1 — Tue · Web core + Claude integration

- [ ] `npx create-next-app@latest web` (TS, Tailwind 4, App Router)
- [ ] Install deps: `@anthropic-ai/sdk`, `vitest`, `@turf/turf`
- [ ] `.env.local` with `ANTHROPIC_API_KEY`
- [ ] Port design tokens from `mockups/assets/styles.css`
- [ ] `lib/gpx.ts` — parse GPX, smooth elevation (3-pt moving avg)
- [ ] `lib/minetti.ts` — cost-of-running polynomial, GAF function
- [ ] `lib/pacing.ts` — 800m segmentation, per-segment GAP, effort
      scaling to goal time
- [ ] `lib/grouping.ts` — 6-phase auto-grouping, landmark dictionary
      lookup for Big Sur
- [ ] `lib/fueling.ts` — gel timing anchored to phase boundaries,
      60 g/hr target
- [ ] `lib/export.ts` — emit `.runcino.json` v1.1.0 (intervals array)
- [ ] Unit tests for all five lib modules — pipeline green
- [ ] Download Big Sur GPX into `public/sample-bigsur.gpx`
- [ ] CLI smoke: `npm run smoke` runs full pipeline, prints plan
- [ ] **GATE — plan looks right on the sample before any UI**

---

## Day 2 — Wed · Minimal web + Claude integration

**Scope cut:** web is a build tool, not a plan viewer. One page.
The fancy plan UI (table, chart, fueling sidebar) lives in iOS for
this sprint; the mockups in `mockups/web-*.html` are M2 targets.

- [ ] `app/page.tsx` — single page:
  - GPX drop zone
  - Fitness summary form (LA time, weekly mi, long run, resting HR)
  - "Ask Claude for a goal" button → server action hits `/api/goal`
  - Goal display (prose + time)
  - "Build plan" button → runs full pipeline, downloads `.runcino.json`
- [ ] `app/api/goal/route.ts` — Claude call, cached prompt, returns
      goal + rationale
- [ ] `app/api/brief/route.ts` — paste forecast, Claude writes brief,
      returns JSON fragment to merge into plan
- [ ] Stub fallback — if no `ANTHROPIC_API_KEY`, use fixture responses
- [ ] **GATE — upload GPX, get a valid `.runcino.json` back**

---

## Day 3 — Thu · Schema freeze, CLI, polish

- [ ] `scripts/build-plan.ts` — CLI version for reproducibility:
      `npm run build-plan -- --gpx bigsur.gpx --goal 3:50:00`
- [ ] Error states — bad GPX, unrealistic goal, API failure
- [ ] Schema v1.1.0 freeze — no changes after today without bump
- [ ] Regenerate `docs/example.runcino.json` from real pipeline
- [ ] **GATE — web ships. Move fully to iOS.**

---

## Day 4 — Fri · iOS Xcode project + import

- [ ] Xcode → new iOS app, SwiftUI, iOS 17, bundle
      `com.davidnitzsche.runcino`
- [ ] Declare `.runcino.json` UTType in `Info.plist` (conforms to
      `public.json`, exported type)
- [ ] Add WorkoutKit + HealthKit entitlements (Health is placeholder
      for M1 — not read yet)
- [ ] `Models/RuncinoPlan.swift` — `Codable` struct mirroring schema
- [ ] `Models/PlanDocument.swift` — `FileDocument` wrapper
- [ ] `Views/ImportView.swift` — `.fileImporter` root screen
- [ ] `Views/PlanView.swift` — phases + fueling cues + landmarks
      as a scrollable list
- [ ] `Views/BriefView.swift` — morning brief display (reads a
      `brief` field from the JSON)
- [ ] Build + run on David's iPhone (first sideload)

---

## Day 5 — Sat · WorkoutKit CustomWorkout + Watch sync

- [ ] `Workout/IntervalFactory.swift` — turn `intervals[]` from JSON
      into an array of `IntervalStep`:
  - `kind: "pace"` → `IntervalStep(.work, step: .init(goal: .pace(
        target:, tolerance:)))`
  - `kind: "fuel"` → 30-sec `IntervalStep` with `alert: .time(0)`
        and a custom label shown on Watch
  - `kind: "landmark"` → 10-sec `IntervalStep`, same pattern
- [ ] `Workout/WorkoutBuilder.swift` — assemble `CustomWorkout(
        activity: .running, location: .outdoor, displayName:
        "Big Sur 3:50", warmup: nil, blocks: [IntervalBlock(
        iterations: 1, steps: [...])], cooldown: nil)`
- [ ] `Views/SyncView.swift` — "Add to Apple Watch" CTA →
      `WorkoutScheduler.shared.preview(workout)`
- [ ] Confirm workout appears in Watch's Workout app
- [ ] **GATE — test a short interval sequence on an actual Watch
      walk-through**

---

## Day 6 — Sun · Dry run + bug fixes (race day minus 0)

**Race is Sunday. This is race-day morning.**

- [ ] Check weather forecast, paste into `/brief` page, regenerate
      plan with adjusted paces
- [ ] Re-import the updated JSON into iOS app
- [ ] Push updated workout to Watch
- [ ] 2-mile warm-up with the Watch workout running — verify
      haptic cues fire for pace drift, landmarks, fueling
- [ ] Fix anything broken
- [ ] **GATE — runs cleanly at the start line**
- [ ] Run Big Sur. See how it went.

---

## Day 7 — Mon · Post-race

- [ ] Export actual workout from Watch to iPhone
- [ ] Capture qualitative notes (what was right, what was off)
- [ ] Commit race data as a fixture in the repo
- [ ] Open issues for M1 (retrospective, calibration, HealthKit)

---

## Hard constraints on the sprint

- **No feature creep.** If it's not on the "ships for Big Sur"
  list, it's M1 or later. No exceptions.
- **Tests stay green.** Unit tests on every lib module before UI.
- **No half-finished features.** If Day 5 slips, the fueling
  micro-steps come out, not the pacing. Pacing is the MVP floor.
- **David's time is the bottleneck.** I (Claude) write the code
  and mockups; David builds + sideloads iOS. Any task blocked on
  his local machine gets prioritized on his end.

---

## If the sprint slips

Fallback order (what to drop in order):

1. Morning brief UI — plan is still usable without it
2. Fueling micro-steps — can take gels by feel on race day
3. Landmark cues — course is well-signed anyway
4. Claude goal-setting — default to 3:50 hand-set

What absolutely ships Day 6 for Big Sur to be a win:
**GPX → 6-phase pacing plan → CustomWorkout on Watch with
pace goal + tolerance per phase.** That's the floor.
