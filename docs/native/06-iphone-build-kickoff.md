# iPhone build kickoff · brief for the Xcode agent

> Decided 2026-05-19. **iPhone full companion, built first.** This is the
> brief a fresh Xcode/SwiftUI session works from. Source of truth for
> scope is `05-iphone-app-scope.md`; for visuals, `docs/design/iphone-handoff.html`.

## Goal

Grow the existing iPhone bridge (`native/Faff/Faff/`) into the full
companion app, light v4 design, building the backed screens first.

## Read first, in order

1. `docs/native/XCODE_HANDOFF.md` — project state, Apple Dev setup, existing code, blockers.
2. `docs/native/05-iphone-app-scope.md` — what the iPhone app is (full companion).
3. `docs/design/iphone-handoff.html` — every screen + app map + per-screen build table
   (job · **status** · data source · components). **Reference, not importable code:** read
   layout/hierarchy/data-source, then write SwiftUI.
4. `designs/V4_DESIGN_LAW.md` + `web/app/components/v4/tokens.ts` — the design system to
   translate into SwiftUI.

## Design system (light v4, non-negotiable)

- Warm `#EEECEA` ground, white cards + soft shadow, **no borders**.
- **Bebas Neue** numbers/titles · **Inter** body · **Oswald** sub-headers. Never substitute.
- Orange `#E85D26` brand (sparingly), green `#2CA82F` on-plan, amber `#D4900A` today,
  red `#F43F5E` errors.
- Coach voice: short, honest, no hype, no emoji, no em dashes (rest-day marker is the one
  allowed em dash).

## Start from

`native/Faff/Faff/` — the bridge v0 (`API.swift`, `TokenStore.swift`, `LoginView.swift`,
`TodayView.swift`) builds clean. Grow it; don't rewrite it.

## Build order — iPhone first, backed screens first

Do **not** build all screens at once. Finish and show each before moving on.

**Phase 1 — backed screens (green in the handoff), real data, simulator-testable:**

1. **Today** ← `api/overview` (grow `TodayView`). Coach line, hero workout, Send-to-Watch,
   readiness ring, week strip. State-driven.
2. **Workout detail** ← `api/plan` / `plan-week` + pace doctrine. + Send-to-Watch (WCSession).
3. **Plan** ← `api/plan` / `plan-week` / `plan-range` · **Health** ← `api/health/readiness`
   (+ `readiness-score.ts`) · **Races** ← `api/races` · **Settings** ← `api/profile` /
   `connectors` · **Coach read** ← `api/brief` (read-only, **NOT a chat**).

**Phase 2 — net-new (amber/grey), only after Phase 1:**

4. **Run recap** + **reconciliation** (HealthKit ingest exists; matching prescribed↔actual is new).
5. **Race Day mode** (race plan/pacing exists; live execution is new).
6. **iOS-native surfaces:** Live Activity (ActivityKit), widgets (WidgetKit), push (UserNotifications).

## Constraints

- **Simulator only for now.** Do not depend on a physical device. The watch live-data work is
  blocked on unresolved device pairing and is **out of scope** for this iPhone pass.
- **Coach is a READ**, not a chat (daily briefing + WHY/FOCUS/BACK OFF IF + signals). There is no
  conversational coach. Don't build one.
- **Security:** a real password was pasted in chat earlier and may not be rotated. Do not test
  auth with it; ask David to rotate first.
- **Git:** every commit immediately `git push origin main`. Never skip hooks.
- When unsure whether an endpoint exists, **grep `web/app/api` before assuming.** Don't invent data.

## First task

Build the **Today** screen against `api/overview`, growing the existing `TodayView`, matching the
"Today" mockup + build-table row in `iphone-handoff.html`. Show the SwiftUI before wiring, then iterate.
