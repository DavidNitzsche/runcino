# iPhone app scoping doc · the full companion

> **Decided 2026-05-19 (design pass).** Supersedes the "minimal bridge"
> decision in `01-watchos-scoping.md` (Decisions §3). The iPhone is no
> longer a bridge-only app. It is a **full daily companion**.

## Why this changed

`01-watchos-scoping.md` locked the iPhone to login + push-today's-workout
+ HealthKit ingest + watch status, on the logic that "the web app exists
for everything else." David has now decided the iPhone should be a real
companion app, not a relay. The web stays the command center (deep
planning, analysis, history); the iPhone becomes the daily-driver surface
for capture, glance, and on-the-go review; the watch stays the executor.

## v1 scope · full companion

**Primary screens (tabbed):**

1. **Today** — what now, in two seconds. Coach line, today's workout hero,
   Send-to-Watch, readiness, week strip, race countdown. State-driven.
2. **Plan** — week + upcoming calendar/list. Light editing (move, swap,
   skip). Deep plan editing still defers to web.
3. **Coach** — daily read (NOT a chat). The briefing narrative the engine
   produces (`api/brief` DailyBriefing: label + signal-composed clauses),
   the WHY / FOCUS / BACK OFF IF coach blocks, and signals/explanations.
   Read-only. There is no conversational coach built or planned for v1; a
   chat is not in scope. The coach voice also stays embedded in Today
   (coach strip) and Workout detail (WHY block).
4. **Health** — recovery score, HRV/RHR/sleep trends, training load.
5. **More** → Races, Settings, Gear, Log.

**Pushed / modal screens:**

6. **Workout detail** — pre-run briefing, full structure, fueling,
   Send-to-Watch (the canonical primary action).
7. **Run recap** — auto-prompts after a synced run. Hero stats, prescribed
   vs actual reconciliation, splits, coach read, RPE capture, share.
8. **Race day mode** — during-race execution. Pace vs goal, splits,
   fueling reminders, distance to go. Watch is primary mid-race; phone is
   the larger secondary screen.
9. **Settings / Profile** — account, integrations, notification prefs,
   units, watch companion management.

**iPhone-native surfaces:**

- **Live Activity** (Lock Screen + Dynamic Island) during runs and race
  countdowns.
- **Widgets** (small / medium / large): today's workout, readiness, race
  countdown.
- **Push notifications**, category-tagged, coach voice, quiet-hours aware.

**Deferred to later:** body-composition, nutrition logging, cycle
tracking, routes, gear depth — present on web first, port if used.

## Design system

Light v4 (`designs/V4_DESIGN_LAW.md`): warm `#EEECEA` ground, white cards
with soft shadows, Bebas Neue numbers/titles, Inter body, Oswald
sub-headers; orange `#E85D26` brand, green on-plan, amber today, red
errors. Same coach voice as web. The iPhone is light; only the watch
execution face is dark.

## Architecture

- iPhone holds auth, talks to the backend, and remains the watch bridge
  (WatchConnectivity push of today's workout + HealthKit ingest of the
  finished workout). That bridge role is unchanged; the companion screens
  are added on top.
- Reads a mobile `getOverviewSnapshot` payload (today's workout,
  readiness, conditions, week strip, race countdown, alerts).
- Auto-logging is the default: runs arrive via Watch → HealthKit →
  backend; manual logging is a fallback.

## Build-ready visual + per-screen spec

`docs/design/iphone-handoff.html` — app map, every screen as a mockup in
the v4 system, the native surfaces, and a build table mapping each screen
to its job, data source, key components, and interactions.
