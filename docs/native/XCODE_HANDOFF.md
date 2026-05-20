# Faff.run Native — Xcode / iOS Handoff

Clean pickup doc for a fresh session working on the native app.
Codename "Runcino" is the **repo directory only** — the product brand is
**Faff.run** everywhere user-facing.

---

## Apple Developer

- **Enrolled** — Individual account
- **App ID**: `run.faff.app` (iOS) · `run.faff.app.watchkitapp` (watchOS)
- **App Group**: `group.run.faff.app` (created + tied to the App ID)
- **Capabilities enabled**: HealthKit · App Groups · Sign in with Apple · Background Modes
- **Not submitted to App Store** — David wants to test on his own device first, not ship yet.

---

## Xcode project

- **Xcode 26.5** · SwiftUI · Swift Testing + XCTest UI tests
- Uses **synchronized folders** (`PBXFileSystemSynchronizedRootGroup`) — drop files into the
  folder, no manual `project.pbxproj` edits
- Project lives under `native/Faff/` in the repo
- Xcode license was accepted via `sudo xcodebuild -license` (it had blocked git earlier — resolved)

---

## Swift code that exists (iPhone bridge v0 — builds clean)

Under `native/Faff/Faff/`:

| File | What it does |
|---|---|
| `API.swift` | `FaffAPI` singleton · `login` / `logout` / `fetchToday` · private `perform()` helper (renamed from `request()` to fix Swift overload-ambiguity) · DEBUG→`localhost` / RELEASE→`faff.run` base-URL switch + `FAFF_API_BASE_URL` env override |
| `TokenStore.swift` | Keychain wrapper for the opaque Bearer token |
| `LoginView.swift` | SwiftUI email + password form |
| `TodayView.swift` | Workout display with phases |

**This is the safe foundation to build on.**

---

## Backend (Phase 1 — done, 5 commits shipped)

- Token auth: opaque 32-byte Bearer tokens in the `sessions` table with a `kind` discriminator
  (`cookie` / `access` / `refresh`)
- Workout-to-watch endpoint
- HealthKit ingest endpoint
- tier-2 → tier-1 route lifts
- naming / duplicate cleanups

---

## Architecture plan for the watch (designed, not yet built)

- `HKWorkoutSession` + `HKLiveWorkoutBuilder` for workout execution
- `WatchConnectivity` (`WCSession`) for iPhone ↔ Watch sync
- Watch-primary reframe is locked in `docs/native/00-02`

---

## Implementation phase order — iPhone first (David's call, 2026-05-19)

Build the **iPhone full companion first.** It is fully simulator-testable against endpoints
that already exist, so it sidesteps the watch hardware-pairing blocker (below). Watch live-data
work resumes once device pairing is fixed. Within iPhone, build the **backed** screens first
(green in the handoff table) for real-data wins, then the net-new work.

**iPhone — backed screens first (green):**
1. **Today** (`api/overview`) — grow from the v0 `TodayView`. Coach line, hero workout card,
   Send-to-Watch (WCSession), readiness ring, week strip. State-driven.
2. **Workout detail** (`api/plan` / `plan-week` + pace doctrine) + Send-to-Watch action.
3. **Plan** (`api/plan` / `plan-week` / `plan-range`), **Health** (`api/health/readiness` +
   `readiness-score.ts`), **Races** (`api/races`), **Settings** (`api/profile` / `connectors`),
   **Coach read** (`api/brief` — read-only, NOT a chat).

**iPhone — net-new (amber/grey), after the backed loop:**
4. **Run recap** + **run reconciliation** (HealthKit ingest exists; matching prescribed↔actual is new).
5. **Race Day mode** (race plan/pacing exists; live execution is new).
6. **iOS-native surfaces:** Live Activity (ActivityKit), widgets (WidgetKit), push (UserNotifications).

**Watch — parallel / later, where simulator-testable:**
7. Idle/start → state machine → phase rendering (simulator-testable; FaffWatch shell + WCSession
   loop + pace-drift logic already in).
8. `HKLiveWorkoutBuilder` live HR / pace / **cadence** + haptics + completion writeback
   (`api/watch/today` and `api/watch/workouts/complete` exist) — **BLOCKED on a physical Apple
   Watch** (device pairing unresolved, see below).

---

## Known blockers

- **Physical device pairing failed** — "plugged iPhone in and nothing from Xcode." Never resolved;
  deferred until ready. Watch live-data work (phases 4–5) is blocked on this.
- Simulator covers phases 1–3; a physical Apple Watch is required for 4–6.

---

## ⚠️ Security flag

Earlier in the project David **pasted his real account password in chat** while testing
`/api/auth/token`. He was asked to rotate it; **rotation was never confirmed.**
Do NOT test with that credential, and remind David to rotate it if he hasn't.

---

## Git / workflow

- Dev branch: `claude/build-runcino-app-OIRJr` (NOT a sub-worktree; NOT literal `main` on GitHub)
- Convention: every commit immediately `git push origin main`
- Be aware: there is an active git **worktree** at `.claude/worktrees/objective-black-8f3e69` —
  confirm which checkout you're editing/serving before assuming file state.
- `/Research/` at the repo root is the canonical source of truth for all coaching doctrine.

---

## Design / UI status — LOCKED (2026-05-19)

The design is now locked. Build SwiftUI screens **against these artifacts**, not from scratch.

- **System:** light **v4** — `designs/V4_DESIGN_LAW.md` + `web/app/components/v4/tokens.ts`.
  Warm `#EEECEA` ground, white cards + soft shadow (no borders), **Bebas Neue** numbers/titles,
  **Inter** body, **Oswald** sub-headers; orange `#E85D26` brand, green `#2CA82F` on-plan,
  amber `#D4900A` today, red `#F43F5E` errors. The iPhone is light. Only the **watch execution
  face is dark** (`#000`).
- **iPhone spec:** `docs/design/iphone-handoff.html` — every screen, the app map, native
  surfaces, and a per-screen build table (job · **status** · data source · components).
- **Watch spec:** `docs/design/watch-handoff.html` — six dark states, per-metric source + token.
- **Scope:** `docs/native/05-iphone-app-scope.md` (iPhone full companion) and
  `01-watchos-scoping.md` (watch).

The HTML handoffs are **reference, not importable code**: read the layout, hierarchy, and
data-source/status columns, then write SwiftUI. The iPhone bridge v0 under `native/Faff/Faff/`
is the foundation to grow.
