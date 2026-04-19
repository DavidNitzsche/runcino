# Build Checklist

Day-by-day plan with approval gates. Each `[ ]` is a checkbox —
flip to `[x]` as we land it.

---

## Locked decisions

These are settled. Everything in the repo is built against them.

| Decision | Value |
|---|---|
| Units | `min/mi` (miles everywhere user-facing) |
| Baseline race | LA Marathon, 3:40:00 |
| Target race | Big Sur International Marathon |
| Target finish | 3:50:00 |
| Default strategy | Even effort (Minetti-adjusted) |
| Pace tolerance on Watch | ±10 sec/mi |
| Internal segment size | 800m |
| User-facing phases | 6–8, landmark-aware grouping |
| Bundle ID (iOS) | `com.davidnitzsche.runcino` |
| Deploy target | `localhost:3000` + sideloaded iOS app |

---

## Day 0 — Planning & mockups (**you are here**)

- [x] Monorepo directory scaffold
- [x] README.md, .gitignore
- [x] PROJECT_MAP.md
- [x] CHECKLIST.md (this file)
- [x] SCHEMA.md + example.runcino.json (Big Sur 3:50)
- [x] ALGORITHM.md (Minetti math explained)
- [x] Pitch-deck HTML mockup (`mockups/index.html`)
- [x] Web mockups: upload, plan
- [x] iOS mockups: import, plan, watch sync
- [ ] **APPROVAL GATE — David reviews mockups, approves, PR merges to `main`**

---

## Day 1 — Web scaffold + algorithm

- [ ] `npx create-next-app@latest web` (TS, Tailwind, App Router)
- [ ] Upgrade to Tailwind 4, Next 15
- [ ] Port design tokens from `mockups/assets/styles.css` into
      `web/app/globals.css`
- [ ] Install deps: `@turf/turf` (distance math), `vitest`
- [ ] `lib/gpx.ts` — parse GPX, return array of `{lat, lon, ele_m, dist_m}`
- [ ] `lib/minetti.ts` — cost-of-running function `c(grade) → relative cost`
- [ ] `lib/pacing.ts` — segment course at 800m, compute per-segment
      GAP, scale to goal time, apply strategy
- [ ] `lib/grouping.ts` — auto-group adjacent segments into 6–8 phases
      using grade-change + pace-jump heuristic
- [ ] `lib/export.ts` — build `.runcino.json` matching `SCHEMA.md`
- [ ] Unit tests for all four lib modules
- [ ] Download Big Sur GPX, drop in `web/public/sample-bigsur.gpx`
- [ ] CLI smoke: node script that runs the full pipeline on the sample
      and prints phases — **APPROVAL GATE before UI work**

---

## Day 2 — Web UI

- [ ] `app/page.tsx` — upload card (goal time, strategy,
      warmup toggle, GPX drag-drop)
- [ ] `app/plan/page.tsx` — plan table + chart + download
- [ ] `components/PlanTable.tsx`
- [ ] `components/ElevationChart.tsx` — hand-rolled SVG, dual
      axis (elevation area + pace line)
- [ ] `components/DownloadButton.tsx` — blob → `.runcino.json`
- [ ] Form → URL state (no server, no storage)
- [ ] Pixel-match the mockup
- [ ] Run `npm run dev`, upload Big Sur GPX, verify plan matches
      expectation

---

## Day 3 — Polish + schema freeze

- [ ] Tighten copy, fix spacing, responsive at 1024/1440/1920
- [ ] Keyboard nav through form
- [ ] Error states (bad GPX, unrealistic goal time)
- [ ] **Schema freeze:** bump `schema_version` to `1.0.0`, lock
      `docs/SCHEMA.md`, no changes after this point without a new
      version
- [ ] Regenerate `docs/example.runcino.json` from real pipeline
- [ ] **APPROVAL GATE — Phase 1 done, JSON frozen, move to iOS**

---

## Day 4 — iOS Xcode project + import

- [ ] Xcode → new iOS app, SwiftUI, iOS 17, bundle id
      `com.davidnitzsche.runcino`
- [ ] Declare UTType for `.runcino.json` in `Info.plist`
      (conforms to `public.json`)
- [ ] `Models/RuncinoPlan.swift` — `Codable` struct mirroring schema
- [ ] `Models/PlanDocument.swift` — `FileDocument` wrapper
- [ ] `Views/ImportView.swift` — `.fileImporter(isPresented:…)`
- [ ] `Views/PlanView.swift` — list of phases, pace, cumulative split
- [ ] Handoff to David for first build + sideload

---

## Day 5 — WorkoutKit integration

- [ ] Add WorkoutKit entitlement
- [ ] `Workout/PaceGoal.swift` — helper that turns `target_pace_s_per_mi`
      + tolerance into `WorkoutGoal.pace(…)`
- [ ] `Workout/WorkoutBuilder.swift` — phases → array of
      `IntervalStep(purpose: .work, step: IntervalStep.Step(goal: .pace…))`
- [ ] `CustomWorkout(activity: .running, location: .outdoor, displayName:
      "Big Sur 3:50", warmup: …, blocks: [IntervalBlock(…)], cooldown: nil)`
- [ ] Call `WorkoutScheduler.shared.preview(workout)` on tap → sheet
- [ ] Confirm workout lands on paired Apple Watch via Fitness app

---

## Day 6 — Dry run + bug fixes

- [ ] Sideload final build to David's iPhone
- [ ] David does a ~5 mi training run using the Big Sur plan on Watch
- [ ] Capture any bugs (wrong pace, missing phase, haptic timing)
- [ ] Fix, rebuild, resideload
- [ ] **APPROVAL GATE — Ready for race day**

---

## Race day (late April)

- [ ] Pull latest `.runcino.json` for current Big Sur date
- [ ] Import into iOS app, tap "Add to Apple Watch"
- [ ] Start workout on Watch at the starting line
- [ ] Run a good race
