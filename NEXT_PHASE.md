# Next phase — integration architecture

> **Status: PROPOSAL.** Nothing here is decided. Each section is a recommendation with the main tradeoff so you can redirect before any of it gets built. Read `STATUS.md` first for what shipped overnight.

The decisions that need to be made before more code lands:

1. iCloud sync vs localStorage-forever (M2 trigger)
2. Strava OAuth approach (when you hand over the credentials)
3. HealthKit data flow (iOS-side, but web schema implications)
4. iOS app build-out (when, in what order)
5. Watch surface (WorkoutKit native UI vs custom watchOS app)

---

## 1. Persistence: localStorage → iCloud Drive

**Where we are:** `web/lib/storage.ts` writes a single key `runcino:races:v1` to localStorage. Works for one machine, one browser. Gone if you clear site data.

**The right next step (per master plan):** `.runcino.json` files live on iCloud Drive. iOS reads/writes them via the app's shared container. Web reads them by pointing at `~/Library/Mobile Documents/iCloud~com~davidnitzsche~runcino/Documents` directly (Mac-only) or via a small dev-only file picker.

**Implementation sketch:**

```typescript
// web/lib/storage.ts becomes an interface; localStorage is one impl.
interface RaceStore {
  list(): Promise<SavedRace[]>;
  get(slug: string): Promise<SavedRace | null>;
  save(race: SavedRace): Promise<void>;
  delete(slug: string): Promise<void>;
}

// web/lib/storage-localstorage.ts  ← M0 (today)
// web/lib/storage-icloud.ts         ← M2 (after iOS app exists)
```

**Tradeoff:** iCloud Drive on the web is awkward. We can't write to it from a browser. Options:
- (a) Web stays read-only after M2; iOS owns writes. Web can build new plans but they only persist after AirDrop → iPhone → save.
- (b) Web writes to a known local directory; a small Mac helper app watches it and forwards to iCloud Drive.
- (c) Drop the web write path entirely; web becomes a viewer for iOS-managed plans + a one-shot plan generator that downloads `.runcino.json` (no autosave).

**Recommendation:** (c). Cleaner contract. Web's job is "build a plan and download the file." iOS's job is "import + render + push to Watch." localStorage stays as a convenience cache so the web preview keeps working between sessions, but iOS is the source of truth.

---

## 2. Strava OAuth — when you're ready

**Per master plan:** Strava is M2. Used for *reading* race history into the fitness summary, not as a database. Single user.

**What I need from you (in `web/.env.local`, NEVER paste in chat):**
```
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_REFRESH_TOKEN=...
STRAVA_ATHLETE_ID=...
```

The `_REFRESH_TOKEN` comes from running the OAuth flow once — I can build a `/api/strava/auth` route that walks you through it. Refresh token is long-lived; we use it server-side to mint short-lived access tokens on demand.

**What we'd build:**
1. `web/lib/strava.ts` — token refresh + paginated activity fetch
2. `web/app/api/strava/sync/route.ts` — pulls all activities of type `Run` since a given date, normalizes into `SavedRun` shape (separate from `SavedRace`)
3. `web/app/runs/page.tsx` — read-only run history; filters/sorts; PR detection
4. Tie-in: the Add Race form auto-suggests goal time based on recent race-distance PRs from Strava (replaces the "fitness summary" form altogether for Big Sur 2027)

**Tradeoff:** Strava's terms forbid persistent cache of activity data (`Athlete.id` and `activity.id` are OK; full payloads are not). For a personal tool we're well inside this — Strava-of-one. But document it in `docs/SCHEMA.md` so we don't accidentally ship a multi-athlete version.

---

## 3. HealthKit — phone-only, web reads the synced output

**Master plan position:** HealthKit is M1 (post-Big Sur). It's the auto-fitness-summary source replacing the manual form. iOS-only API.

**Data flow:**

```
iOS app (HealthKit) ──┐
                      ├──→ writes fitness_summary block in
Strava sync           ──┘   the next-built .runcino.json
                                       │
                                       ├──→ pushed to iCloud Drive
                                       │
                                       └──→ web reads on next session
```

**Schema implication:** The existing `fitness_summary` block in `.runcino.json` (see `docs/SCHEMA.md`) already has a `source: 'manual' | 'healthkit' | 'strava'` discriminator. Nothing to change in the contract — iOS just sets `source: 'healthkit'` and fills in the numbers from HKQuery. Web continues to *read* this block but can't *populate* it.

**What this means for the web add-race flow:** The fitness summary section in the form can become optional (or hidden behind "Manual entry"). Default behavior post-M1 is "use the latest HealthKit-derived summary on file." iOS writes a `latest-fitness.json` to iCloud; web reads it on form load.

---

## 4. iOS app — build order

`ios/Runcino/` already has the skeleton:
- `RuncinoApp.swift` (@main, WindowGroup)
- `Models/RuncinoPlan.swift` (Codable mirror of the schema)
- `Views/{ContentView, ImportView, PlanView}.swift`
- `Workout/WorkoutBuilder.swift` (CustomWorkout assembly)

**Build order I'd recommend:**

| Order | Feature | Why |
|---|---|---|
| 1 | Import (FileImporter for `.runcino.json` + `runcino://` URL scheme) | The "AirDrop → open" loop is the simplest, most-impactful end-to-end test |
| 2 | Plan view (read-only render of phases + intervals + fueling) | Mirrors the iPhone prototype Screen 2; verifies the schema is faithful enough to produce a usable display |
| 3 | Watch sync via WorkoutScheduler.preview() | The whole point — IntervalSteps with `pace` goal, fuel/landmark steps as work intervals with haptic cues |
| 4 | Live race-day view (Screen 3 in the prototype) | Reads from the running workout; surfaces target vs actual + next-up phase |
| 5 | HealthKit fitness summary read (M1) | Once Big Sur is done; closes the manual-entry loop |

**Tradeoff:** SwiftUI vs UIKit. SwiftUI for everything except WorkoutKit's CustomWorkout building (which is a UIKit-style imperative API). The skeleton already commits to SwiftUI — keep it.

---

## 5. Watch surface — native vs custom watchOS app

**Master plan says:** "WorkoutKit's native UI wins for now. Custom watchOS app deferred."

**Why this is right:** Apple's native Workout app has 8+ years of polish — auto-pause, GPS lock, HR strap pairing, post-workout summary. Reinventing that is a year of work for marginal gain. WorkoutKit lets us define the *workout structure* (paced intervals, fuel cues as work segments with haptic alerts) and the system runs it.

**What we lose:** branding, custom phase visualizations on the Watch, mid-workout interactivity beyond next/pause/skip. Acceptable tradeoff.

**One thing worth piloting at M3+:** a Watch complication that shows "next phase target pace" pulled from the active workout. Tiny scope, big feel-quality win on race day. ~2 days of work once iOS app is real.

---

## Concrete next-session asks for you

In rough priority order:

1. **Confirm or redirect on the persistence direction** (option (c) above — web is plan-builder, iOS is source of truth). 5-min decision; unblocks everything else.
2. **Drop Strava credentials in `web/.env.local`** when you're ready to start that lane. I'll wire it without further input.
3. **Pick the iOS build-order item to start with.** I'd start with #1 (import + plan view) — gets the AirDrop loop working end to end, validates the schema, takes about a session.
4. **Look at the iPhone prototype** (`designs/iphone-app.html`) and tell me what's wrong with the design language before iOS Swift commits to it.
5. **Decide on the design-system migration scope.** Do we update the existing `/training`, `/retrospective`, `/research` pages to the new dark theme tonight (next session), or wait until those features get rebuilt anyway?

---

## Things I noticed but didn't act on

- The pacing math has the short-final-phase edge case I called out in `STATUS.md` — `lib/pacing.ts` would benefit from a floor on per-mile pace delta from base for short trailing phases.
- `web/scripts/research-course.ts` exists but I didn't run it. It looks like a Claude-driven course-facts generator that could automate the `data/courses/<slug>.json` creation step. Worth wiring into `/races/new` as "auto-research this course" once we have an API key path that works in the form flow.
- The `ANTHROPIC_API_KEY` env var fallback is real but optional. With it, the goal recommender uses Claude; without, it returns a deterministic stub. The current Add-race flow doesn't surface the goal-rec UI — by design (manual goal time), but worth re-adding as an "Ask Claude for a goal" button when the fitness summary section comes back.
- `notes_from_sources.synthesized` warning text in `synthesizeCourseFacts` — every custom course gets this flag, which the detail page should surface ("Custom course — phases auto-detected") so users know phase boundaries are heuristic, not curated.

---

*Author: overnight build, 2026-05-02.*
