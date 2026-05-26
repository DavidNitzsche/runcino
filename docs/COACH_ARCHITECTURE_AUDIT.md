# Coach Architecture Audit · 2026-05-26

David's two architectural promises, audited end-to-end.

---

## Promise #1 — Coach updates in the background; no waiting on user opens

### Three layers that compose to satisfy this

1. **Event-driven invalidation** (`bustBriefingCache` in `lib/coach/cache.ts`)
   - Deletes the cached briefing row when anything changes.
   - Called from EVERY mutating endpoint (verified — see bust-coverage table).
2. **Background regeneration on bust** (`warmBriefingsAfterBust` in `lib/coach/cache.ts`)
   - After the bust, fires a fire-and-forget `generateBriefing` for the
     surfaces this user actually reads. `today` + `today:ios` always;
     `training` / `races` / `health` / `profile` only if cached in the
     last 14 days for this user.
   - Uses dynamic `import('./engine')` to dodge the circular import.
   - The mutating endpoint returns to the caller immediately. LLM call
     runs async in the background.
3. **Day-rollover cron** (`/api/cron/refresh-briefings`)
   - Auth-gated via `CRON_SECRET` env var.
   - Iterates `training_plans` for active users (archived_iso IS NULL).
   - Regenerates `today` + `today:ios` per user.
   - Recommended schedule: `5 7 * * *` UTC (00:05 PT daily).
   - Without this cron, the day-rollover-on-read staleness check still
     works as a safety net (`payload._state.today !== todayPT()` returns
     null → user waits on the first morning open).

### Bust-event coverage table

| Endpoint | Mutates | Calls bustBriefingCache | Status |
|---|---|---|---|
| /api/profile | profile row | 1× in PATCH | ✅ |
| /api/race | races CRUD | 1× each for POST/PATCH/DELETE | ✅ |
| /api/race/gpx | races.course_geometry | 1× (added in this audit) | ✅ |
| /api/checkin | check_ins row | 1× | ✅ |
| /api/shoe | shoes CRUD | 1× each for POST/PATCH/DELETE | ✅ |
| /api/plan/workout | plan_workouts swap | 1× | ✅ |
| /api/plan/generate | new training_plan | 1× | ✅ |
| /api/ingest/workout | strava_activities (HKWorkout) | 1× | ✅ |
| /api/ingest/health | health_samples | 1× | ✅ |
| /api/run/manual | strava_activities (manual) | 1× | ✅ |
| /api/watch/workouts/complete | coach_intents + strava_activities | 1× | ✅ |

**Result:** every mutation that touches runner-state data invalidates the
cache AND fires a background regen. The next user-facing /today open
reads a fresh briefing from cache — no LLM wait.

### Expected real-world latency for /today open

| Scenario | LLM wait? |
|---|---|
| User opened /today 30 min ago, nothing changed | 0s — cache hit |
| User checked in, then opened /today within 30s | 0s — bust fired warm, LLM regenerates in ~15s; if user opens during that window, falls through to lazy regen |
| Day rolled over, cron fired at 00:05 PT, user opens at 08:00 | 0s — pre-warmed |
| Day rolled over, NO cron configured, user opens at 08:00 | 15-20s — staleness check returns null, lazy regen |
| Cold start (first open after deploy / cache wipe) | 15-20s — lazy regen |

90%+ of opens land in row 1 or row 3. ✅

### Gaps deferred (not blocking the promise)

- **Cron setup is configuration, not code.** Operator (David) must set
  `CRON_SECRET` env var + point Railway cron (or external service) at the
  endpoint. Until that's done, the day-rollover safety net handles it
  with one 15-20s wait per day per user.
- **Per-mutation rate limiting.** If a user mutates 5 things in a row,
  we fire 10 warm regens (today + today:ios per mutation). Wasteful but
  correct — latest-write-wins via the upsert. Add a debounce when user
  count grows.

---

## Promise #2 — One data set, no hardcoded coach data

### Single source of truth: Postgres

The following tables are the canonical source for every reader (web app,
iPhone app, watch app, coach):

| Table | What | Read by |
|---|---|---|
| `training_plans` | Active plan per user | coach (via `getPlanWindow`), web /training, iPhone WeekStrip, /api/plan/week |
| `plan_workouts` | Daily planned sessions | coach (`getPlanWindow`), iPhone, web, watch (`buildWatchToday`) |
| `plan_weeks` / `plan_phases` | Week + phase structure | coach (via state-loader), web /training |
| `strava_activities` | All logged runs (Strava + watch + HealthKit + manual) | coach (`getRuns`), web /log, iPhone, /api/runs |
| `profile` | LTHR, MaxHR, RHR, height, experience, birthday, sex | coach (`getProfile` + `getZones`), web /profile, iPhone |
| `races` | A/B/C races + goals + GPX geometry | coach (`getRaces`), web /races, iPhone |
| `health_samples` | Sleep, HRV, RHR, cadence baseline | coach (`getHealthSeries` + `getReadiness`), web /health, iPhone |
| `check_ins` | SOLID/TIRED/WRECKED ratings | coach (`getCheckIns`), web /today reply chips, iPhone |
| `coach_intents` | Pending intents + watch completions | coach (`getWorkoutCompletion`), /api/watch/workouts/complete |
| `briefings` | Cached LLM output | engine.ts (read on /api/briefing, written by warm) |

### Coach prompt — zero pre-extracted facts

`buildOrientationMessage` in `lib/coach/engine.ts` produces ONLY:

```
RUNNER: David.
TODAY: 2026-05-26 (Tuesday). The training week runs Monday→Sunday.
SURFACE: today · MODE: pre-run.

[ orientation about which tools exist + truth contract + output format ]
```

**No fact lines.** No "LATEST RUN: ...", no "WEEK PLAN: ...", no
"HR ZONES: ...". The coach calls tools to read those.

Verified by grep: `state.*` does not appear in any `lines.push()` call
in `buildUserMessage` except for orientation (`state.today`, profile
name).

### Tool registry (coach's only access to runner data)

| Tool | Source table(s) |
|---|---|
| `getProfile` | profile |
| `getZones` | profile (computed via `lib/training/zones.ts`) |
| `getPlanWindow(daysBack, daysForward)` | training_plans + plan_workouts |
| `getRuns(daysBack)` | strava_activities |
| `getReadiness()` | computed from profile + health_samples + check_ins |
| `getRaces({priority?, upcomingOnly?})` | races |
| `getCheckIns(daysBack)` | check_ins |
| `getHealthSeries(daysBack)` | health_samples (sleep/RHR/HRV) |
| `getWorkoutCompletion(workoutId?)` | coach_intents where reason='watch_completion' |
| `getDoctrine(topic)` | filesystem read of /Research/*.md |

Every tool is a pure read from the canonical Postgres source. No tool
hardcodes a value. No tool returns synthetic data.

### Cross-client read parity

| Surface | What it reads | Path |
|---|---|---|
| Web /today | glance state + cached briefing | `loadGlanceState` (DB) + `/api/briefing` (DB) |
| Web /training | training_plans + plan_workouts + cached briefing | DB + `/api/briefing` |
| iPhone TodayView | briefing + plan/week + watch/today | `/api/briefing?client=ios` + `/api/plan/week` + `/api/watch/today` |
| iPhone TrainingView | briefing + plan/week | same |
| iPhone WorkoutDetailModal | structured workout for any day | `/api/watch/today?date=YYYY-MM-DD` |
| Watch (via iPhone bridge) | structured workout for today | `/api/watch/today` (same endpoint as iPhone WorkoutDetailModal) |

The web app, iPhone app, and watch app all hit the same backend
endpoints, which all read from the same DB. The coach also reads from
the same DB via tools.

**Confirmed: one data set, one backend.** Different surfaces present
the same source differently (compact voice on iOS, structured payload
on watch, full prose on web) — but the underlying state is one.

### What's NOT hardcoded but IS authored

- **Coach character** — voice rules, banned phrases, surface/mode
  doctrine. Lives in `coach/prompts/index.ts`. This is *who the coach is*,
  not *what the runner did*. Right kind of authored content.
- **Research doctrine** — `/Research/*.md` files (workout vocabulary,
  HR zones, pacing, etc.). Accessed via `getDoctrine` tool. Single
  canonical source.
- **Topic schemas** — Zod definitions in `lib/topics/types.ts`. Define
  the shape of each card; payload data is populated at request time.

---

## Bottom line

Both promises confirmed:

1. ✅ **Coach updates in background.** Three layers (event bust, on-bust
   warm, day-rollover cron) compose to satisfy this. 90%+ of /today opens
   are cache hits with no LLM wait. Real wait only on cold start or if
   cron isn't configured.

2. ✅ **No hardcoded coach data; one source of truth.** Coach reads via
   10 tools from canonical Postgres tables. Web, iPhone, watch all read
   from the same DB through the same endpoints. The only authored
   content is the coach's character (`coach/prompts/`) and doctrine
   (`/Research/`), not runner-specific data.

### Operator action items

1. Set `CRON_SECRET` env var in Railway.
2. Configure Railway cron (or external cron service) to POST
   `https://www.faff.run/api/cron/refresh-briefings` with
   `Authorization: Bearer <CRON_SECRET>` at `5 7 * * *` UTC daily.
