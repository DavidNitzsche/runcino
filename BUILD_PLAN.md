# faff.run · Build plan

> One document. The full picture: what's real, what's mock, what's missing, and the dependency-ordered sequence to ship the rest.
>
> Supersedes `NEXT_PHASE.md` (which proposed shapes); this commits to a sequence. Read `STATUS.md` for the file-by-file diff of overnight work.
>
> **Last updated:** 2026-05-04 (post-overnight build)

---

## 1. Honest state of play

| Layer | What's real | What's mock or stub | What's missing |
|---|---|---|---|
| **web/lib (math)** | 16 modules. GPX parse, Minetti GAP, pacing, phase grouping, fueling (Claude + deterministic), course-facts validation, weather (NOAA), retrospective, training periodization, time fmt. 9 with vitest suites. | nothing — math is solid | nothing critical |
| **web/api routes** | 7 endpoints, all coded: `build-plan`, `goal`, `brief`, `weather`, `research`, `retrospective`, `plan-week`. Anthropic-keyed where applicable; deterministic fallbacks when no key. | nothing | nothing |
| **web/app pages** | `/` Overview, `/training`, `/races`, `/races/new`, `/races/[slug]`, `/health`, `/log` — all 5 nav tabs serve the dark faff.run theme. | 4 of 5 tabs render embedded design HTML with mock data (`/training`, `/health`, `/log`, parts of `/`). Stat cards on `/` deep-link into context. | Real React port of each embedded section as it acquires live data. |
| **iOS app** | Skeleton only — `faff.runApp.swift`, `FaffPlan.swift` (Codable mirror of schema), 3 Views, `WorkoutBuilder.swift`, Info.plist. **Never compiled.** | everything | All wiring: file import, plan render, watch sync. |
| **Watch surface** | `WorkoutBuilder.swift` skeleton refers to WorkoutKit's `CustomWorkout` API. | implementation never run | Schedule.preview integration, IntervalStep build-out, fuel/landmark steps as work intervals with haptic cues. |
| **Strava** | `lib/storage.ts` knows about `source: 'strava'` field in `FitnessSummary`. Schema accepts strava-flagged data. | nothing else | OAuth flow, refresh-token storage, paginated activity fetch, normalize-into-`SavedRun` mapper, `/api/strava/sync`, `/runs` page, `/runs/[id]`. |
| **HealthKit** | Schema's `fitness_summary.source: 'healthkit'` recognized. | nothing else | iOS-side: HKQuery (HRV, sleep, RHR, weekly mileage). Writes a `latest-fitness.json` to iCloud Drive that the web reads. |
| **NOAA weather** | `lib/weather.ts` + `/api/weather` — fetches forecast for race coords. | not surfaced in UI yet (only consumed by `build-plan` if weather text passed through). | Weather card on `/races/[slug]` (T-72h forecast + countdown), Claude race-morning brief auto-trigger 1h before start. |
| **iCloud sync** | `lib/storage.ts` is localStorage today; designed as a swappable adapter. | localStorage only — single browser, one machine. | iOS writes `__KEEP_DOT_FAFF.RUN_JSON__` files to the app's iCloud Drive container; web reads via a small Mac dev helper or Files-app picker. |
| **Anthropic / Claude** | SDK wired, used by `build-plan`, `goal`, `research`, `retrospective`, `plan-week`. Uses `claude-sonnet-4-6`. Deterministic stubs when `ANTHROPIC_API_KEY` is unset. | nothing | Pre-race brief auto-trigger, post-race retrospective auto-trigger, weekly plan adaptive replanning. |
| **Designs** | 21 HTML files. Canonical dark design system in `faff.css`. iPhone prototype + morning briefing live in this branch. | n/a | nothing — designs are the spec. |

**The shape of the work:** *the math + API are 90% done. The visible app is mostly mock-data designs embedded with `dangerouslySetInnerHTML`. The iOS surface is a skeleton with zero working code. The integrations (Strava, HealthKit, iCloud, Watch) are unwired but well-shaped.*

---

## 2. The six milestones

Each milestone is **shippable on its own** and unlocks the next one. Dates assume one focused session per week.

| M | Window | What ships | What's still mock after this | Public-URL on Railway |
|---|---|---|---|---|
| **M0** ✓ | done overnight | Web app surface, /races flow, dark theme, Sombrero + Big Sur first-class, iPhone prototype HTML | All of `/`, `/training`, `/health`, `/log` | After push: yes |
| **M1** | 1 session (~3h) | Cards on `/` deep-link everywhere; key tiles peeled into real React; Railway live; build-plan produces shippable __KEEP_DOT_FAFF.RUN_JSON__ | training plan, health metrics, run history | yes |
| **M2** | 2 sessions (~6h) | iOS app: Import view + Plan view. AirDrop loop closes — laptop builds plan → AirDrop → phone renders it. | Watch sync, training/health/log data sources | partial — web only |
| **M3** | 2 sessions (~6h) | Watch sync via WorkoutKit. CustomWorkout with paced IntervalSteps + fuel haptics. End-to-end race-day capability. | training plan generation, post-race retro auto-trigger | yes |
| **M4** | 2 sessions (~6h) | Strava OAuth → `/runs` page populated; `/log` page wired to real run data. HealthKit read on iOS → `fitness_summary` block populates from real sleep/HRV/RHR. | training plan generation; iCloud sync | yes |
| **M5** | 3-4 sessions (~10h) | Training plan generation (`/training` becomes real). Adaptive replanning when HRV drops or runs missed. Post-race retrospectives auto-trigger and append to `/log` entries. | nothing — feature-complete v1. | yes |

**Total: ~30 hours of focused work to feature-complete v1.** Plus a 4-week soak before CIM Dec 2026 to find rough edges.

---

## 3. The six integrations

Each one has a clean shape; here's what each gives, what it costs, and when it lands.

### A. Anthropic / Claude — *already wired*
- **What it gives:** goal recommendation (`/api/goal`), race-morning brief (`/api/brief`), course-facts research with web search (`/api/research`), post-race retrospective (`/api/retrospective`), weekly plan generation (`/api/plan-week`), Claude-driven fuel-strategy refinement (`lib/fueling-claude.ts`).
- **Cost / risk:** API key in env, small per-call cost, occasional 502s (already caught — falls back to deterministic stubs).
- **Already done.** Just needs each route surfaced in UI.

### B. Strava — *M4*
- **What it gives:** Auto-ingest of completed races + every-run history. Replaces the manual fitness-summary form.
- **What I need:** `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `STRAVA_ATHLETE_ID` in `web/.env.local`. (Refresh token comes from running OAuth once — I'll build a one-shot `/api/strava/connect` route that walks through it.)
- **What gets built:**
  - `web/lib/strava.ts` — token refresh + paginated activity fetch
  - `web/app/api/strava/sync/route.ts` — pulls activities since a given date, normalizes into `SavedRun`
  - `web/app/runs/page.tsx` — read-only run history (replaces the embedded `/log` design)
  - `web/app/runs/[id]/page.tsx` — per-run detail
  - `/races/new` form auto-fills "baseline race" from Strava PRs
- **Cost / risk:** Strava ToS forbid persistent multi-athlete cache. We're well inside that limit (single athlete) but document explicitly.

### C. HealthKit — *M4 (iOS)*
- **What it gives:** Auto fitness-summary (HRV trend, sleep, RHR, weekly mileage) replacing the manual form fields. Powers `/health` page real data.
- **What gets built (iOS):**
  - `Models/FitnessSummary.swift` — Codable struct for the schema's `fitness_summary` block
  - `Services/HealthKitReader.swift` — wraps HKQuery for the 8 metrics in the schema
  - On app launch, refresh `latest-fitness.json` in iCloud Drive container
- **What gets built (web):**
  - `lib/storage-icloud.ts` — file-system reader for the iCloud-synced JSON (Mac dev helper or Files-app picker)
  - `/health` page peeled from embed → real React reading the latest synced data
- **Cost / risk:** None. HealthKit is local + free. iOS-only; web reads only on the user's Mac.

### D. NOAA weather — *M3*
- **What it gives:** Race-day forecast (temp, wind, sky) for the coordinates of the bundled GPX. Fed into Claude race-morning brief.
- **Already wired:** `lib/weather.ts` + `/api/weather`.
- **What gets built:** Surface on `/races/[slug]` — a "race-week weather" tile that shows T-72h / T-24h / race-morning windows. Auto-trigger Claude brief 1h before gun time.

### E. iCloud Drive sync — *M2-M3 (gradual)*
- **What it gives:** `__KEEP_DOT_FAFF.RUN_JSON__` files travel between web (builder/editor) and iOS (consumer/runner) via the user's existing iCloud Drive. No backend.
- **Decision needed (you):** Three options, recap from `NEXT_PHASE.md`:
  - **(a)** Web read-only after iOS exists; iOS owns writes
  - **(b)** Web writes to a known dir; Mac helper forwards
  - **(c) Recommended:** Web is plan-builder + downloader; iOS is source of truth. Web's localStorage stays as a session cache. AirDrop is the bridge.
- **What gets built:** Trivial once option chosen. iOS already has FileImporter scaffold for `__KEEP_DOT_FAFF.RUN_JSON__`.

### F. WorkoutKit — *M3 (iOS)*
- **What it gives:** The race plan running on your wrist as a native workout — paced IntervalSteps, fuel cues as sub-second work intervals with haptic alerts, phase transitions as labeled section breaks.
- **What gets built (iOS):**
  - `Workout/WorkoutBuilder.swift` (skeleton exists) — fills in real CustomWorkout assembly
  - `Workout/PaceGoal.swift` — wraps `IntervalStep.goal = .pace(rangeFrom:rangeTo:)`
  - `Views/SyncView.swift` — "Send to Watch" CTA that calls `WorkoutScheduler.preview()`
- **Cost / risk:** Apple Watch Ultra / Series 9+ for full WorkoutKit support. Native UI is the workout app — no custom complications until M5+ (deferred per master plan).

---

## 4. The build sequence (30 steps)

Dependency-ordered. Tag in brackets is the milestone.

### Pre-flight (this session, ~10 min)
1. **[M1]** Wrap remaining hub tiles ("This week" → `/training`, "Today" → `/training/today`, instrument-grid items → relevant tabs) — all in `designs/hub.html` so the canonical source has them.
2. **[M1]** Same wrapping pass on `designs/training.html` (workout cards → `/training/today`), `designs/log.html` (run rows → `/runs/[id]` placeholders), `designs/health.html` (instrument tiles internal-anchor scrolls).
3. **[M1]** Verify all deep links resolve (no 404s from hub→inner→hub round trips).

### M1 · Web app live (~3h)
4. **[M1]** **Push to Railway.** Pick: deploy branch direct vs PR-then-merge. *Blocks public access.*
5. **[M1]** Peel `/races/[slug]` weather tile from mock to live `/api/weather` data.
6. **[M1]** Peel `/races/[slug]` countdown to use real Date diff (currently hardcoded to "1 day").
7. **[M1]** Add a "Generate Claude brief" button on race detail (T-24h auto-suggests; manual trigger always available).

### M2 · iOS Import + Plan (~6h)
8. **[M2]** Build `ios/faff.run` in Xcode — first compile. May need provisioning profile setup; you'd do this part on your Mac.
9. **[M2]** Wire `ImportView` to handle `__KEEP_DOT_FAFF.RUN_JSON__` files via `.fileImporter` modifier.
10. **[M2]** Implement `FaffPlan.swift` decoder against schema v1.1.0 (the file already exists; needs verification).
11. **[M2]** Build `PlanView` to render hero + phases + intervals + fueling — mirrors iPhone prototype Screen 2.
12. **[M2]** Validate against `web/public/big-sur-3-50__KEEP_DOT_FAFF.RUN_JSON__` (already in repo).
13. **[M2]** Smoke test: build a plan in the web app → AirDrop → opens in iOS → renders.

### M3 · Watch + race-day surface (~6h)
14. **[M3]** Implement `WorkoutBuilder.swift` — assemble `CustomWorkout` from intervals[] array.
15. **[M3]** Each pace interval → `IntervalStep(.work, goal: .pace(...))`. Each fuel/landmark → short work interval with haptic.
16. **[M3]** `SyncView.swift` — "Send to Watch" button calling `WorkoutScheduler.preview()`.
17. **[M3]** Test on actual Watch with a sub-1-mile dummy plan.
18. **[M3]** Build `Views/LiveRaceView.swift` — mirrors iPhone prototype Screen 3 (current phase, target/actual pace, gel countdown, predicted finish).
19. **[M3]** Decide: (a) hide LiveRaceView in favor of native Workout app, or (b) keep as a "during race" companion. Master plan says (a).

### M4 · External data (~6h)
20. **[M4]** Drop Strava credentials in `web/.env.local`.
21. **[M4]** Build `lib/strava.ts` + `/api/strava/connect` (one-shot OAuth) + `/api/strava/sync` (cron-able).
22. **[M4]** Build `/runs` page (list) + `/runs/[id]` (detail) — replaces current embedded `/log`.
23. **[M4]** Wire `/races/new` form: auto-fill baseline race from most-recent Strava race-distance PR.
24. **[M4]** **iOS:** add HealthKit entitlement. Build `HealthKitReader.swift` reading HRV / sleep / RHR / weekly mileage.
25. **[M4]** iOS app on launch refreshes `latest-fitness.json` in iCloud Drive container.
26. **[M4]** Web reads it (Mac dev path: read from `~/Library/Mobile Documents/iCloud~com~davidnitzsche~faff/Documents`). Peel `/health` page from embed to real React.

### M5 · Coaching loop (~10h)
27. **[M5]** Wire `/api/plan-week` into `/training` page. Generates 7-day plan from current fitness + days-until-next-race.
28. **[M5]** Adaptive replan trigger: HRV drop > 10% from baseline OR consecutive missed runs → re-call `plan-week` with adjusted load.
29. **[M5]** Post-race retrospective auto-trigger: when a Strava activity matches a `SavedRace.date`, call `/api/retrospective` and append to `/log/[id]` entry.
30. **[M5]** Personal Minetti calibration: each retrospective updates a per-runner `gaf-calibration.json`; future `build-plan` calls read from it.

---

## 5. Decisions blocking progress

In rough priority order. Each is a 30-second answer that unblocks a chunk of work.

| # | Question | Recommended | Unblocks |
|---|---|---|---|
| 1 | Push to Railway: direct to deploy branch, or PR first? | **Direct** — single user, low risk, fast feedback. | M1 step 4 (and the public URL) |
| 2 | Persistence: option (a) (web read-only post-iOS), (b) (Mac helper), or (c) (web=builder, iOS=truth, AirDrop bridge)? | **(c)** — cleanest contract. | M2 step 13, M4 step 25 |
| 3 | Strava: now or after iOS Import lands? | **After iOS Import** — exercises the manual flow first; Strava maps into a proven shape. | M4 step 20 |
| 4 | iOS first build target: Import + Plan view, or Watch sync? | **Import + Plan first** — closes the AirDrop loop and validates the schema. | M2 sequence |
| 5 | Apple Watch model? | Whatever you have today is fine for development; full WorkoutKit features need Series 9+ or Ultra. | M3 step 17 |
| 6 | Anthropic API key shared between local + Railway, or separate? | **Same key** — billing is per-key not per-env. | M1 step 7 |

---

## 6. What I'll do without further prompting

If you hit "go on the plan," here's what I'll execute autonomously, in order, committing as I go:

1. Wrap remaining hub + training + log + health tiles with deep links (steps 1–3 above)
2. Push 6 commits to Railway deploy branch (assuming Decision #1 = direct)
3. Surface NOAA weather tile + Claude brief button on race detail (steps 5–7)
4. Stop and prompt you for the iOS work (because that needs Xcode time on your Mac)

Everything else from M2 onward needs either your hands (Xcode), your decision (persistence option), or your credentials (Strava). I'll prompt before each.

---

*This is the plan. Read it, redirect any of the 6 decisions, then say "go" and I'll execute steps 1–7.*
