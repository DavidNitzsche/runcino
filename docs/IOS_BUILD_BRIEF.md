# FAFF · iOS BUILD BRIEF

**The handoff doc for the design-driven iOS build loop. A fresh session reads this first, then builds.**

_Last verified against the repo: 2026-05-29. Repo root: `/Volumes/WP/06 Claude Code/Runcino`._

---

## 0 · How to use this doc

The workflow now: **David approves an iPhone design → a fresh session reads this brief → builds the screen in SwiftUI against data that already exists → compile-verifies → ships to TestFlight.**

This is the only doc a new session needs to start. Every claim below was verified by reading the actual code; each section points at the canonical files for its concern. When you build, read the specific files named — don't work from this summary alone.

A kickoff template for starting a fresh session is in §9.

---

## 1 · The architecture, in one paragraph

- **`web-v2/` is ONE Next.js app** holding both the web UI **and** the backend — HTTP endpoints in `app/api/**/route.ts`, the engine in `lib/**`. It's deployed to **`https://www.faff.run`** (Railway, auto-deploys on push to `main`).
- **`native-v2/Faff/` is the SwiftUI iPhone app** — a thin native **client** over that live backend. `API.swift` hardcodes `baseURL = https://www.faff.run` and GETs `/api/*`. On launch it fires every endpoint in parallel (`prefetchAllOnLaunch`) to warm a raw-bytes cache (`AppCache`); each View re-fetches in its `.task`.
- **Auth is single-user beta.** Routes fall back to `DEFAULT_USER_ID` (David's UUID) when no token is present, so a brand-new screen renders **real data with zero auth plumbing**. (Sign in with Apple exists → opaque Bearer token in keychain → `/api/auth/apple`; not required yet.)
- **The contract is hand-mirrored, not shared.** `lib/faff/glance-adapter.ts` ↔ `FaffAdapter.swift`; `lib/coach/*-state.ts` ↔ the wire structs in `API.swift`; `lib/faff/types.ts` ↔ the Swift models. Same inputs → same outputs, kept in sync by hand.
- **The Apple Watch is sacred and untouched** (Cardinal Rule #2). It ships in the same IPA; its source is symlinked in from `legacy/` at ship time.

---

## 2 · THE BUILD LOOP (the play)

**Doctrine: an approved design is built by mapping it to data that already exists.** Because the web app already renders every surface, the data a new iPhone screen needs almost always already has an endpoint.

**Decision tree for any approved design:**

1. **List what the design shows** — every value, label, series, and state on it.
2. **Look each up in the Contract Catalog (§4).** Does an endpoint already return it?
   - **YES** (the common case): pure SwiftUI work. Build the View from `FaffGraphic` primitives + `Theme` tokens; decode from the existing endpoint (extend the Swift wire struct in `API.swift` if the endpoint already emits a field you don't yet decode); wire the `.task` fetch. **No backend change.**
   - **NO**: backend-first. Extend the loader in `lib/coach/<surface>-state.ts` → expose it via the `route.ts` → add the field to `lib/faff/types.ts` → mirror the Swift wire model in `API.swift` → then build the View. The web surface (`app/<surface>/page.tsx`) is your reference implementation for how that data is computed.

**Mechanical steps per screen:**

1. Read this brief + the existing View (`Views/*.swift`) and any component (`Components/*.swift`) the design touches.
2. Build/modify the SwiftUI on `FaffGraphic` primitives + `Theme` tokens. **Never inline a hex** (read `Theme.*`); **never inline a string the server should own** (closed vocab + copy come from the payload).
3. Compile-verify (§6).
4. Commit + push to `main` (web auto-deploys; iOS pushes are harmless to the web).
5. Ship to TestFlight (§6) when David wants it on his phone.

---

## 3 · Repo map

### iOS — `native-v2/Faff/Faff/`
| File | Role |
|---|---|
| `API.swift` | **The networking boundary.** `baseURL` + every endpoint call + all wire models. Start here for any data question. |
| `Util/FaffAdapter.swift` | Pure data→design adapter — day-state resolver, hero verbs, Poster/Sibling/WeekStrip builders, training/health/races/profile helpers. Mirror of `glance-adapter.ts`. |
| `Theme.swift` | Design tokens (Paper active / Dark revert), 13 state gradients, HR zones, fonts, `.displayRecipe`. Mirror of web `globals.css`. |
| `Fonts.swift` | `Font.display/label/body` accessors (Oswald + Inter). |
| `Components/FaffGraphic.swift` | **The graphic primitive library** (§5). Mirror of `components/faff/graphic/index.tsx`. |
| `Views/` | One file per surface: `TodayView`, `TrainingView` (PLAN), `RacesView`, `HealthView`, `ProfileView` (ME), `LogView`, `RunDetailSheet`, `RaceDetailSheet`, `SettingsSheet`, `OnboardingSheet`, `ManualRunSheet`, `TipsView`. |
| `Components/` | `PosterCard`, `SiblingCard`, `WeekStripView`/`WeekStripV3`, `CoachBlock`/`CoachSlot`, `PageHeader`, `WorkoutTodayCard`, `WorkoutDetailModal`, `ReadinessRing`/`ReadinessHeroCard`, `PhaseStrip`, `VolumeArc`, `WeekAheadGrid`, `RaceCard`, `RaceDayTimeline`, `HRZoneRow`, `BodyMetricCard`, `MiniSparkline`, `FieldCard`, … |
| `Models/` | `Briefing`, `FaffPayloads` (PosterPayload/SiblingPayload/WeekStripPayload + the Faff* enums), `Races`, `Runs`, `Tips`, `Watch`. |
| `FaffApp.swift` | App entry + launch prefetch + notification delegate. |
| `AppCache.swift` | Raw-bytes per-surface cache (warm launch, no skeleton). |
| `WatchSync.swift` · `HealthKitImporter.swift` · `HRAlerter.swift` | Watch + HealthKit + HR. Leave unless the task is explicitly about them. |
| `project.yml` | XcodeGen spec — bundle id, deployment target, fonts, entitlements. The `.xcodeproj` is **generated** from this. |

### Backend — `web-v2/`
| Path | Role |
|---|---|
| `app/api/**/route.ts` | The HTTP endpoints (catalog §4). |
| `lib/coach/*-state.ts` | Per-surface loaders: `training-state`, `health-state`, `races-state`, `run-state`, `log-state`, `profile-state`, `readiness`, `state-loader`, `fact-reciter`, `glance-state`. |
| `lib/faff/` | `glance-adapter.ts` (data→design), `types.ts` (shared contracts), `state-tokens.ts` (gradient-var map), `personas.ts` (simulator fixtures only). |
| `lib/{plan,runs,strava,notifications,onboarding,training,races,watch,weather,auth,gpx,topics,db}` | Domain logic. |
| `app/<surface>/page.tsx` + `components/` | The web render = **reference implementation** for each screen. |

**Tokens source of truth:** `shared/tokens.json` (v1.4.0) → mirrored into web `globals.css` + iOS `Theme.swift`. Change token **values** there, not in the mirrors (Cardinal Rules #6/#8).

**Build/ship:** `scripts/ship-testflight-v2.sh`; build counter `legacy/native/.asc.build`; ASC creds `legacy/native/.asc.env`.

---

## 4 · CONTRACT CATALOG — what data already exists

All under `https://www.faff.run`. "Composer" = where the shape is built in `web-v2/`. Field lists are the key ones, not exhaustive — confirm against the named file when you build.

> There is **no `/api/today` composite route.** The Today screen is assembled **client-side** by `FaffAdapter` from `/api/briefing` + `/api/watch/today` + `/api/plan/week` + `/api/readiness` + `/api/today/skip`.

### TODAY
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/briefing?surface=&client=ios[&mode=]` | GET | `{ surface, mode, lead, voice[], topics[] (empty), block, _state }` · `client=ios` → shorter voice | `Briefing` | `lib/coach/fact-reciter.ts` |
| `/api/watch/today[?date=]` | GET | `{ workout: WatchWorkout \| null }` — phases[], pace/HR targets, fueling, readinessScore/Label | `WatchWorkout` (`TodayWorkoutWrapper`) | `lib/watch/build-workout.ts` |
| `/api/plan/week[?date=]` | GET | `{ plan_id, week_start_iso, week_end_iso, today_iso, days[] }`; day = `{date_iso,dow,type,distance_mi,sub_label,is_today,is_past,completedRunId,done_mi}` | `PlanWeek`/`PlanDay` | route + `lib/runs/merge.ts` |
| `/api/readiness` | GET | `{ score?, band?, label?, inputs[], sleep7Avg?, rhrCurrent?, rhrBaseline?, hrvCurrent?, hrvBaseline?, loadAcwr? }` | `ReadinessSnapshot` | `lib/coach/state-loader.ts` + `readiness.ts` |
| `/api/today/skip[?date=]` | GET·POST·DELETE | `{ skipped, date }` | `API.fetchTodaySkipped/postSkipToday/deleteSkipToday` | inline (`day_actions`) |
| `/api/coach/facts?surface=` | GET·POST | `{ block: { surface, state?, facts:[{label,value,valueColor?,meta?}] } }` — preferred deterministic coach endpoint | (decoded inline) | `lib/coach/fact-reciter.ts` |
| `/api/coach/proposal` | POST | accept/decline a workout swap → patches today's `plan_workouts` | — | inline |
| `/api/checkin` | POST | record `SOLID`/`TIRED`/`WRECKED` | `API.checkin` | inline |

### PLAN / TRAINING
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/training/state` | GET | `{ plan_id, today, race?, phases[], weeks[], currentPhase, currentWeekIdx, nextQuality, weekDone, weekPlanned }`; week = `{idx,phase,startDate,plannedMi,days[],isCurrent}` | `TrainingState` | `lib/coach/training-state.ts` |
| `/api/plan/workout` | PATCH | edit/move one workout `{plan_id,date_iso,type?,distance_mi?,sub_label?,new_date_iso?}` | — | inline |

### RACES
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/races` | GET | `{ races[] }`; race = `{slug,name,date,priority,distance_label,location,days_to_race}` | `RaceListResponse`/`RaceListItem` | `lib/coach/races-state.ts` |
| `/api/race/[slug]` | GET | `{ race: RaceRow, proximity, course_geometry, course_source }` | `RaceDetailResponse` | `races-state.ts` + inline geometry |
| `/api/race` | PATCH | submit race retro `{slug, …}` | `API.submitRaceRetro` | inline |

### HEALTH
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/health/state` | GET | `{ today, sleepSeries[], rhrSeries[], hrvSeries[], weightSeries[], sleep/rhr/hrv/weight/cadence/vo2 summaries, watchMode, watchItems[] }` | `HealthState` | `lib/coach/health-state.ts` |
| `/api/health/series?kind=&days=` | GET | `{ kind, days, points[] }` · kinds: hrv, resting_hr, sleep_hours, vo2_max, max_hr, body_mass, wrist_temp, respiratory_rate, spo2 | — | inline query |

### LOG / RUNS
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/log?limit=` | GET | `LogState { today, totals, weeks[], axes, filters }`; run = date/pace/hr/cadence/type/workoutType/phaseLabel/shoeName | `LogState` | `lib/coach/log-state.ts` |
| `/api/runs/[id]` | GET·PATCH | GET → `RunDetail` (distance/pace/hr/cadence/elev, splits[], phase_breakdown[], hrZonePcts, hr_zones_from_lthr, shoe_id, shoes[], route_polyline, form). PATCH `{shoe_id}` | `RunDetail` | `lib/coach/run-state.ts` |

### ME / PROFILE / SETTINGS
| Endpoint | Method | Returns (key fields) | Swift model | Composer |
|---|---|---|---|---|
| `/api/profile/state` | GET | `{ identity, physiology (incl. HR `zones` table + `lthr_method`), connections, shoes?, nextARace? }` | `ProfileState` | `lib/coach/profile-state.ts` |
| `/api/profile` | GET·PATCH | GET raw fields; PATCH whitelisted writes (height, sex, age, lthr, hrmax_observed, experience, toggles) | `ProfileFields` / `API.updateProfile` | inline |
| `/api/settings` | GET·PATCH | `{ units_distance, units_temp, units_pace, long_run_day, rest_day, quality_days[], briefing_time, push_enabled }` | `UserSettings` | inline |
| `/api/shoe` | GET | shoe rotation list | `ShoesResponse` | inline |

### CONTENT / ONBOARDING / AUTH / NOTIFS
| Endpoint | Method | Returns | Notes |
|---|---|---|---|
| `/api/tips` | GET | form-metric tip library | `lib/training/form-tips.ts` |
| `/api/learn/[slug]` | GET | `{ slug, title, eyebrow, body_md, citations_json, related_slugs }` | seed fallback |
| `/api/onboarding/complete` | POST | persists answers, seeds plan → `{success, redirect, plan?}` | **only route using `userIdFromRequest`** |
| `/api/auth/apple` | POST | `{ ok, token, expires_at, user_uuid }` | opaque Bearer token |
| `/api/auth/strava?action=connect` | GET | `{ url }` to open in Safari | callback writes tokens |
| `/api/notifications/register` | POST | `{device_token, platform, app_version}` | APNs token registration |
| `/api/notifications/ack` | POST | `{category, action, dedup_key}` | lock-screen action routing |

**Cross-cutting (verified):** auth falls back to `DEFAULT_USER_ID` so screens render without a token; **coach paths are 100% deterministic — zero LLM** (no Anthropic/OpenAI in `web-v2`; every "Anthropic" hit is a comment documenting its removal per Cardinal Rule #1).

---

## 5 · Design system

**Tokens — `Theme.swift` (mirror of web `globals.css`).** Paper skin is **ACTIVE**; Dark is the revert target. Never inline a hex — read:
- Canvas: `Theme.bg`, `.bgPage`, `.card`, `.card2`
- Ink: `.ink`, `.mute`, `.dim` · Lines: `.line`, `.line2`
- Semantic: `.green`, `.goal`, `.over`, `.dist`, `.rest`, `.learn`, `.race` · Zones: `Theme.Zone.z1…z5`
- 13 state gradients: `Theme.Gradient.{easy,quality,long,rest,done,race,phase,missed,ease,sick,niggle,new,skip}`
- Radii `rCard`/`rPill`/`rInput` exist, but the gut prefers **hairline rules + 3–4px corners**, not `rCard`(18).

**Revert (Cardinal Rule #8):** flip the 16 flat aliases at the top of `Theme.swift` from `Paper.` → `Dark.` and `FaffApp`'s `.preferredColorScheme(.light)` → `.dark`. Nothing else references raw colors.

**Fonts — `Fonts.swift` + `Theme.Font`.** Oswald-Bold (display) + Inter (body). **CONFIRMED bundled** — all 7 TTFs live in `Faff/Faff/Resources/Fonts/` and are wired via `project.yml` `UIAppFonts` + a dedicated resources build phase. Use `Font.display(size)` / `Font.label(size)` / `Font.body(size, weight)`, or the `.displayRecipe(size:)` modifier for hero verbs (applies Oswald 700 + −0.015em tracking + 0.86 line-height together).

**Graphic primitives — `FaffGraphic.swift` (the visual vocabulary; mirror of web `components/faff/graphic/index.tsx`).** Color is a registration **mark**, never a fill — except the race-week takeover.
- `FaffTone` — semantic accent axis (`green/amber/over/dist/rest/race/learn/mute/none`) with `.from(FaffValueColor)`, `.from(FaffDotColor)`, `.forType(planType)` mappers.
- `SpecLabel` — instrument-readout caps label (Inter-Bold, tracked, mute).
- `RegistrationDot` — status ● mark, optional crosshair ring.
- `FaffBracket` — the `[ EASY ]` motif.
- `Barcode` — variable-width bars; doubles as a progress bar (`fill` 0..1); deterministic from `seed`.
- `ActivityTrace` — EKG-style polyline (HR/pace/elevation); auto-scales; optional area fill + baseline.
- `IntensityBar` + `IntensitySegment` — segmented workout-structure strip (warm/work/rec/cool).
- `VerticalStripNumber` — big ticket-stub number + stacked caps label.
- `Stamp` — mono caps micro-chip (version / page / T-N), outlined or filled.
- `TickRule` — ruler-hairline divider with periodic ticks.
- `SpecRow` — **THE chip-killer**: a ruled data row (caps label + big tabular value + unit + meta + dot). Replaces every rounded "tile".
- `.cropFrame()` — view modifier: corner registration L-marks around any region.

**The locked aesthetic:** Swiss editorial / boarding-pass / instrument-readout. Warm paper, near-black warm ink, bold condensed Oswald display, Inter body. Flatten rounded cards into hairline-ruled `SpecRow`s; barcodes, crop/registration marks, brackets, EKG traces, stamps, ghosted oversized numerals. Canonical spec: `docs/DESIGN_OVERHAUL_2026-05-29.md` (cited in `FaffGraphic.swift`'s header).

---

## 6 · Build · verify · ship

**Generate the project** (the `.xcodeproj` is generated; `project.yml` is the source):
```
cd native-v2 && xcodegen generate
```

**Compile-verify** (fast, no upload — do this before every push that touches Swift):
```
cd native-v2 && xcodegen generate && \
  xcodebuild -scheme Faff -configuration Debug -destination 'generic/platform=iOS' build
```
(Use `-sdk iphonesimulator` for a sim build. `SWIFT_TREAT_WARNINGS_AS_ERRORS` is OFF.)

**Ship to TestFlight:**
```
scripts/ship-testflight-v2.sh           # uses next .asc.build number
scripts/ship-testflight-v2.sh 105        # force a specific build
```
Does: `xcodegen generate` → archive (Release) → export signed IPA → upload → wait/comply/autoship to internal testers. Cross-agent `mkdir` mutex prevents two ships colliding on a build number. Build number auto-increments from `legacy/native/.asc.build` (commit it after). Creds from `legacy/native/.asc.env` (ASC API key). Watch source is symlinked from `legacy/` at ship time.

**Config facts** (`project.yml`): bundle id `run.faff.app` (watch `run.faff.app.watchkitapp`); **iOS 17.0** min; Swift 5.9; team `F26TM6BCR3`; automatic signing; `MARKETING_VERSION` 2.0.0; **HealthKit entitlement + Info.plist purpose strings are REQUIRED** — don't strip them (caused ITMS-90683 rejections on builds 72/73/79); `MainActor` default isolation, strict concurrency `minimal`; iPhone-only (`TARGETED_DEVICE_FAMILY 1`).

> Shipping needs a Mac with Xcode + the ASC key configured — that's David's machine / the configured build env, not a generic sandbox.

---

## 7 · Cardinal rules (still in force)

1. **Zero LLM anywhere** — coach voice is deterministic facts only. _(Verified clean: no Anthropic/OpenAI in `web-v2`.)_
2. **Apple Watch is sacred** — don't touch the watch face/app; keep phone↔watch comms tight.
3. **Review hubs stay local** — `docs/` is never deployed (no `faff.run/decks/`).
4. **iPhone stays fully native** — no `WKWebView`, ever. Every gap is patched in SwiftUI.
5. **Always push to `main`** — Railway auto-deploys web from `web-v2`; chain `git commit && git push origin main`.
6. **Single source of truth for tokens** — edit `shared/tokens.json` + design CSS and regenerate; don't inline hexes.
7. **No doctrine cites in the UI** (no "Cite · Daniels §VDOT").
8. **Dark theme stays revertable** via token swap (web `data-skin`; iOS `Theme` Paper↔Dark aliases + `.preferredColorScheme`).

Plus the working posture: **make the call and document it**; don't stop for non-mission-critical issues (build errors, merge conflicts — fix and continue).

---

## 8 · Known open gaps (don't rediscover these)

- **PlanWeek vs TrainingState.** The simple `/api/plan/week` shape lacks phase metadata + the multi-week arc — those live in `/api/training/state`. `FaffAdapter` has documented fallbacks (`defaultPhaseBlocks`, empty volume arc). If a design needs the arc or phase strip, drive it from `TrainingState`, not `PlanWeek`.
- **Per-day prescribed pace/HR.** `FaffAdapter.paceTarget()` returns **type-based placeholders**. The web upgrades them by fetching `/api/prescription` per planned day; iOS doesn't wire that yet. If a design shows real prescribed pace/HR per day, wire `/api/prescription`.
- **#130** — `/today` persona smoke-verify (8 personas) is David's visual review, not automated.
- **#110** — onboarding fields → `BuildPlanInputs` plumbing is still in progress (non-visual; orthogonal to design work).
- **#127 / #128** — APNs cert + Railway env + cron, and the Strava webhook subscribe curl, are deferred to David (credentials/dashboards).

---

## 9 · Kickoff template (paste into a fresh session)

> Read `docs/IOS_BUILD_BRIEF.md`. We're building the iPhone **[SURFACE]** screen.
> Approved design attached: **[image / Figma / HTML]**.
> It should show: **[list every value / label / series / state]**.
> Build it in SwiftUI on the `FaffGraphic` primitives + `Theme` tokens, wire it to the existing contract (or flag the gap if data is missing), compile-verify, and push to `main`. Ship to TestFlight when I say so.
