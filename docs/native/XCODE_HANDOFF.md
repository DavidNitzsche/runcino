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

## Implementation phase order

1. **iPhone screens** (Login → Today → Settings → Race detail) — refine the v0 bridge
2. **Watch idle / start screen** — simulator-testable
3. **Watch workout screens** — state machine + phase rendering — simulator-testable
4. **Watch `HKWorkoutSession` integration** — live HR / pace / distance — **needs physical Apple Watch**
5. **Watch haptics + transitions** — **needs physical Apple Watch** for timing validation
6. **Watch summary + completion writeback** → backend POST

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

## Design / UI status

UI design direction is **unresolved and not locked.** Do **not** start SwiftUI screen
implementation against any prior design artifacts — build screens fresh against David's direct
direction in the new session. The iPhone bridge v0 (above) is the only UI code worth keeping as a
starting point.
