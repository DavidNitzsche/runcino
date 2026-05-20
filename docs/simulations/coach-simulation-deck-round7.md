# Coach Simulation Deck · Round 7 (2026-05-19 closing)

## Headline · Phase 1 backend gap work done · native client v0 building

Round 6 closed the web-app arc.  Round 7 closes **Phase 1 backend
gap work** for the iPhone bridge + watchOS app:

- **Token auth** · POST `/api/auth/token` + refresh + revoke
- **Workout-to-watch endpoint** · GET `/api/watch/today`
- **HealthKit ingest** · POST `/api/health/ingest`
- **Tier-2 → tier-1 lifts** · 7 GET endpoints native clients compose from
- **Naming-duplicate cleanups** · `/api/health/checkin` → `/api/checkin` consolidation

Plus the native client v0 starts: Xcode project created with the
locked decisions from the scoping pass (Individual enrollment, bundle
ID `run.faff.app`, "faff.run" app name), four new Swift files
implementing the login + today-fetch flow, build verified clean.

Web app continues to exist unchanged.  iPhone bridge + watchOS
app share the same backend intelligence stack (V6 voice, V7
cross-references, L7 signals, compute-vdot, etc.).

## Six-rule architecture status

| Rule | Status | Round 7 evidence |
|---|---|---|
| 1 · L6 source-of-truth | ✅ locked | Health-samples ingest preserves canonical caches (users.resting_hr, etc.) without clobbering legacy single-tenant profile rows |
| 2 · falsifier-required | ✅ locked | Tier-1 lift `/api/adaptive/vdot-verdict` surfaces `falsifier` field on bump-suggested + downgrade-investigate verdicts |
| 3 · surface attribution | ✅ locked | Tier-1 docs (`docs/api/tier-1-stable-public.md`) updated with sections for every Phase 1 endpoint · single canonical reference |
| 4 · operational vs decision vs external | ✅ locked | DB migrations (max_hr_updated_at, health_samples) self-executed via lib/db.ts bootstrap · no manual steps |
| 5 · per-finding context filters | ✅ locked | HealthKit ingest's max_hr ratchet-discipline applied (only update when newest AND higher) · matches suspect-ceiling logic |
| 6 · multi-writer jsonb preserves fields | ✅ locked | No new instances · clean |

Six structural rules hold.  No new bug classes encountered this round.

## Diff vs Round 6

### NEW BACKEND ENDPOINTS

```
/api/auth/token              POST · Bearer token issuance
/api/auth/token/refresh      POST · refresh rotation
/api/auth/token/revoke       POST · logout + cascade
/api/watch/today             GET  · structured workout for watchOS
/api/health/ingest           POST · HealthKit sample batch
/api/profile/activity-gap    GET  · E1/E4 gap state machine
/api/health/readiness        GET  · C6 readiness + V5 cross-ref
/api/health/z2-coverage      GET  · V5 Z2 stimulus check
/api/health/z2-sparkline     GET  · C2 sparkline + recalibration check
/api/races/[slug]/trajectory GET  · V3 trajectory
/api/races/[slug]/projection GET  · C9 projection chart data
/api/adaptive/vdot-verdict   GET  · L7 verdict (full adaptive surface)
```

12 new tier-1 endpoints.  All Bearer-auth-friendly (cookie also
accepted for desktop testing).

### NEW DB ARTIFACTS

```sql
-- Token-kind support on the existing sessions table
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'cookie';
ALTER TABLE sessions ADD COLUMN revoked_at TIMESTAMPTZ;
CREATE INDEX idx_sessions_user_kind ON sessions (user_id, kind);

-- Max HR change timestamp (powers V7 sparkline recalibration check)
ALTER TABLE users ADD COLUMN max_hr_updated_at TIMESTAMPTZ;

-- HealthKit time-series storage
CREATE TABLE health_samples (
  id, user_id, sample_type, value, sample_date,
  source DEFAULT 'apple_health', metadata JSONB,
  recorded_at, UNIQUE(user_id, sample_type, sample_date)
);
CREATE INDEX idx_health_samples_user_type_date;
```

### NEW NATIVE CLIENT

```
native/
├── .gitignore                          (Xcode/Swift build artifacts excluded)
└── Faff/
    ├── Faff.xcodeproj/                 (Xcode 26.5 project)
    └── Faff/
        ├── API.swift                   (networking layer · Bearer auth)
        ├── TokenStore.swift            (Keychain-backed token storage)
        ├── LoginView.swift             (SwiftUI email+password form)
        ├── TodayView.swift             (workout display from /api/watch/today)
        ├── ContentView.swift           (login/today coordinator)
        ├── FaffApp.swift               (untouched)
        ├── Assets.xcassets/
        └── Faff.entitlements           (HealthKit + App Group + Sign in with Apple)
```

iOS-only target.  watchOS app target added later (per scoping doc:
deferred until iPhone bridge runs end-to-end).

### REFRAME · WATCH-PRIMARY ARCHITECTURE

Mid-round, David's reframe clarified that **the watch is the primary
product surface** and the iPhone is the bridge.  Three docs in
`/docs/native/`:

  · 00-practical-setup.md — Apple Developer enrollment, bundle IDs,
    capabilities, TestFlight, ordered + costed
  · 01-watchos-scoping.md — MVP scope (6 features in, 8 deferred),
    architecture (companion pattern), 7-step build order, honest
    constraints (no physical-hardware testing without David)
  · 02-reframed-priority-order.md — new priority map, supersedes
    iphone-integration-brief.md's prioritization

### APPLE DEVELOPER SETUP

All portal work complete (David executed in real-time this session):

  · Enrollment: Individual ($99/year)
  · App ID: `run.faff.app` with HealthKit + HealthKit Background
    Delivery + App Groups + Sign In with Apple + Push Notifications
    capabilities enabled
  · App Group: `group.run.faff.app` (associated with App ID)
  · App Store Connect record: "faff.run" (iOS-only; watchOS rides
    along when target lands)

iPhone connected to Mac, Developer Mode toggle deferred until first
install.  Apple Watch pairing already in place (David wears one
daily).

## L7 four signals · current state (unchanged from Round 6)

| Signal | Status | Awaiting |
|---|---|---|
| Signal 1 · threshold workouts | 🟡 framework live | first 3-workout sample meeting threshold |
| Signal 2 · Z2 pace at fixed HR | 🟡 framework live | 10+ Z2 mile-splits per 4-week window |
| Signal 3 · interval pace adherence | 🟡 framework live | next 3 interval sessions hitting threshold |
| Signal 4 · PR trajectory | 🟡 framework live | David's next race finish |

L7 combined verdict: silent.  Discipline holds when evidence is
insufficient.

## V7 cross-reference firing matrix · production observation

| Cross-ref | Status |
|---|---|
| V5 → C6 (consistent with) | wired · awaiting V5 fire + C6 yellow/red day |
| Signal 4 → VDOT (contributing to) | wired · awaiting 3+ PRs in 8-week window |
| V3 BEHIND → C8 (tied to · structural) | wired · awaiting trajectory shift |
| Suspect ceiling → Z2 sparkline (tied to) | wired · awaiting max HR validation accept |
| E1/E4 → L7 (INJURY_SUSPENDED) | wired · awaiting injury mark |

None observed firing yet — relevance conditions haven't landed on
real data during the live window.  Framework + test coverage proves
the conditions correctly produce the right output; live observation
is a 2-3 race / 8-week wait.

## API surface map (post Phase 1)

```
                            ~100 routes total (89 from S6 + ~11 new)
                                          │
            ┌────────────────┬─────────────┴─────────────┬──────────────┐
            │                │                           │              │
        Tier 1            Tier 2                     Tier 3         Tier 4
       (~42 ↑)            (~37)                       (22)            (2)
        │                   │                           │              │
   iPhone +              Web SSR +                   Admin-          Experi-
   watchOS               auth + OAuth +              only            mental
   callable              page bundles
```

Tier 1 grew by 12 endpoints this round.  Three duplicates removed (1
true, 2 reclassified as false positives).

## Native client state · what David sees + builds

`⌘B` builds clean.  Pending:
- iOS 26.5 simulator runtime still downloading (~5-10 GB)
- Production deploy (Railway) is currently down — blocks end-to-end test

When both clear:
- Launch via simulator (Xcode play button)
- LoginView → enter rotated faff.run credentials
- TodayView fetches today's workout from /api/watch/today
- Phases list renders with color-coded chips (warmup/work/recovery/cooldown)
- Refresh button + sign-out button in toolbar

Local-dev fallback: `DEBUG` builds default to `http://localhost:3000`
so the simulator can hit a local `npm run dev` server.  Bypasses
Railway entirely while it's down.  Env var `FAFF_API_BASE_URL` overrides
both defaults for one-off testing against staging or LAN IPs.

## Hardware-testing protocol (locked in scoping doc)

  · claude writes Swift code
  · David tests on physical Apple Watch + iPhone
  · Realistic expectation: real-run bugs (sensor behavior, sweat,
    GPS lock at workout starts) won't appear during stationary testing
  · Feedback loop: David reports from real runs, claude iterates
  · Reassessment trigger: if burden becomes unsustainable after
    first few weeks · default is "manageable" unless flagged

This round verified the front half of the loop: claude wrote code,
build verified clean.  Backside (real-run) waits on:
  · iOS 26.5 simulator runtime download finishing
  · Railway returning
  · Developer Mode enabled on physical iPhone (deferred · 2-min toggle)

## Commits this round

| Commit | Scope |
|---|---|
| `9fa7338` | Native scoping decisions locked · Individual enrollment, run.faff.app |
| `7802d0e` | Token auth · POST /api/auth/token + refresh + revoke |
| `6c00d15` | Workout-to-watch endpoint · GET /api/watch/today |
| `5cf6d4e` | HealthKit ingest · POST /api/health/ingest |
| `52465bd` | Tier-2 → tier-1 lifts · 7 GET endpoints |
| `28a5599` | Naming-duplicate cleanup · /api/checkin consolidation |
| `e627792` | Native · Faff iPhone bridge v0 (Xcode project + 4 Swift files) |
| `b25f350` | Native · fix API.swift overload ambiguity |
| `d09c450` | Native · API base URL · DEBUG → localhost, RELEASE → faff.run |

Plus the scoping/setup commits (`35d33f7`, `72e2fdf`) and the reframe
docs (`docs/native/00-02`).

## Lessons that compound across rounds

1. **Decisions before code · second time confirmed.**  The watchOS
   scoping doc + Apple Developer practical-setup checklist preceded
   any Swift code.  Result: when David sat down to create the Xcode
   project, every field was pre-decided · no bikeshedding mid-setup.
   Same pattern as the V6 voice rules preceding V7 wiring.  Cheaper
   in calendar time, even though it feels slower upfront.

2. **Synchronized folders in Xcode 16+ make the project file
   non-precious.**  Adding the four new Swift files needed zero
   project.pbxproj edits · Xcode auto-detected them.  Future agents
   (or me in future sessions) can just write Swift files into the
   `Faff/` folder and they're picked up.  Same architecture lesson
   from the web app: discipline at the structural layer compounds
   downstream.

3. **Bearer-token auth on existing infrastructure beats new
   infrastructure.**  Token auth (item 1) extended the existing
   sessions table with a `kind` discriminator instead of adding a
   separate user_refresh_tokens table.  Three token kinds (cookie,
   access, refresh) share the same machinery; cookie path is
   bit-for-bit unchanged.  Web flow stays working without
   modification.  Native flow gets the new path.  No migration
   surgery, no duplicated logic.

4. **The S6 audit's "duplicate" findings were 2/3 false positives.**
   `/api/goal` vs `/api/goals` and `/api/race-retrospect` vs
   `/api/retrospective` looked like duplicates by name but were
   structurally different features.  Only `/api/checkin` vs
   `/api/health/checkin` was a true duplicate.  Audit-by-name catches
   real cases AND false positives · per-pair investigation cheaper
   than reflexive consolidation.

5. **External dependencies (Railway, simulator downloads, Apple
   review) are first-class scheduling variables.**  We hit Railway
   downtime mid-test; the right move was switch to local-dev fallback
   without panic.  iOS 26.5 simulator runtime download = ~30-60 min
   wait that's unavoidable; pre-decided to do other work in parallel.
   Plan the work that's independent of external waits.

## What's queued for next session

### Phase 2 native client (watchOS scoping doc 7-step build order)

  1. ✅ Backend workout-to-watch endpoint (this round)
  2. ✅ iPhone bridge · fetch + push (this round, minus WatchConnectivity)
  → 3. Watch UI shell + state machine (simulator-testable)
  → 4. HKWorkoutSession integration (requires physical Apple Watch)
  → 5. Transition haptics (requires physical device for timing)
  → 6. HealthKit completion writeback
  → 7. TestFlight build · real run validation

Steps 3-6 are claude-writes-Swift territory.  Step 7 needs
TestFlight setup + first archive upload (~30 min David work).

### First-fires to watch for as data accumulates

  · L7 Signal 1+2+3 thresholds on next training block
  · Signal 4 on David's next race PR
  · V3 trajectory state shifts as L7 signals fire
  · V7 cross-references when conditions line up
  · E2 PostRaceCard on next race finish

### Operational

  · Railway uptime returns (when?)
  · iOS 26.5 simulator runtime download completes
  · Developer Mode enabled on David's iPhone (2-min toggle, deferred)
  · Add watchOS target via Xcode's `File → New → Target → watchOS → App`
    (see watchos-target-setup.md for the exact recipe)

## Closing observation

Six rounds of web-app development (Rounds 1-6) compounded into V6
(voice) + V7 (cross-references) + S6 (API stability).  Round 7 took
that foundation and shipped 12 native-callable endpoints, an Xcode
project, and the iPhone bridge v0 in a single session — start to
build-succeeded.

What made this round fast: every architectural decision was already
made.  The scoping docs (`docs/native/00-02`) front-loaded the
decision work.  Apple Developer enrollment, bundle ID, capability
list, MVP feature cut — all decided before any portal click or
Swift line.  The execution was mechanical.

Sequencing decisions before code · *again* · was the right call.

Phase 1 backend done.  Phase 2 native client v0 builds clean.
Next session continues Phase 2 with the watchOS target + first
run-through once Railway returns.

*Round 7 deck generated 2026-05-19 evening.  Diff baseline:
`coach-simulation-deck-round6.md`.  Session continues with
watchOS target prep doc next.*
